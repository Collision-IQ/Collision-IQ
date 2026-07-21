#!/usr/bin/env python3
"""Draft tailored follow-up emails for stalled demo deals in HubSpot.

Queries deals sitting in the follow-up stage (default label:
"Demo Completed - No Decision"), pulls each deal's notes and associated
contact, infers the prospect's primary legacy-platform concern (CCC ONE,
Mitchell, Audatex/Qapter, or generic), and generates a 3-paragraph follow-up
draft for the sales rep.

Drafts are written to ./output/followups/{deal_id}.txt. With --attach, each
draft is also logged to the deal's timeline as a Note engagement so reps see
it in HubSpot.

Environment variables:
    HUBSPOT_ACCESS_TOKEN   required — private app token. Scopes: deal read,
                           contact read, note write; --ensure-stage also needs
                           the deal-pipeline write scope (pick them in the
                           private app's scope browser).

Usage:
    python scripts/deal_followup_gen.py                    # drafts to files only
    python scripts/deal_followup_gen.py --attach           # also log notes to deals
    python scripts/deal_followup_gen.py --ensure-stage     # create the stage if missing
    python scripts/deal_followup_gen.py --stage-label "Proposal Sent"
"""

from __future__ import annotations

import argparse
import os
import re
import sys
from pathlib import Path
from typing import Dict, List, Optional

import requests

DEFAULT_STAGE_LABEL = "Demo Completed - No Decision"
SENDER_NAME = "Vinny"

# --------------------------------------------------------------------------- #
# HubSpot client
# --------------------------------------------------------------------------- #


class HubSpotError(RuntimeError):
    pass


class HubSpotClient:
    BASE = "https://api.hubapi.com"

    def __init__(self, token: str):
        self.session = requests.Session()
        self.session.headers.update({"Authorization": f"Bearer {token}", "Content-Type": "application/json"})

    def _req(self, method: str, path: str, payload: Optional[dict] = None) -> dict:
        try:
            resp = self.session.request(method, f"{self.BASE}{path}", json=payload, timeout=30)
        except requests.RequestException as exc:
            raise HubSpotError(f"network error calling {path}: {exc}") from exc
        if resp.status_code >= 400:
            try:
                detail = resp.json().get("message", resp.text[:300])
            except ValueError:
                detail = resp.text[:300]
            raise HubSpotError(f"{method} {path} -> HTTP {resp.status_code}: {detail}")
        return resp.json() if resp.content else {}

    # -- pipeline / stage --------------------------------------------------- #

    def find_stage(self, stage_label: str) -> Optional[dict]:
        """Return {'pipelineId', 'stageId'} for the labeled stage, or None."""
        data = self._req("GET", "/crm/v3/pipelines/deals")
        for pipeline in data.get("results", []):
            for stage in pipeline.get("stages", []):
                if stage.get("label", "").strip().lower() == stage_label.strip().lower():
                    return {"pipelineId": pipeline["id"], "stageId": stage["id"], "pipelineLabel": pipeline["label"]}
        return None

    def create_stage(self, stage_label: str) -> dict:
        """Create the stage at the end of the default (first) deal pipeline."""
        data = self._req("GET", "/crm/v3/pipelines/deals")
        pipelines = data.get("results", [])
        if not pipelines:
            raise HubSpotError("no deal pipelines exist in this portal")
        pipeline = pipelines[0]
        open_stages = [s for s in pipeline["stages"] if not s.get("metadata", {}).get("isClosed") == "true"]
        stage = self._req("POST", f"/crm/v3/pipelines/deals/{pipeline['id']}/stages", {
            "label": stage_label,
            "displayOrder": len(open_stages),  # after existing open stages, before closed ones
            "metadata": {"probability": "0.5"},
        })
        return {"pipelineId": pipeline["id"], "stageId": stage["id"], "pipelineLabel": pipeline["label"]}

    # -- deals & context ---------------------------------------------------- #

    def deals_in_stage(self, stage_id: str) -> List[dict]:
        result = self._req("POST", "/crm/v3/objects/deals/search", {
            "filterGroups": [{"filters": [{"propertyName": "dealstage", "operator": "EQ", "value": stage_id}]}],
            "properties": ["dealname", "amount", "closedate", "hs_lastmodifieddate"],
            "limit": 100,
        })
        return result.get("results", [])

    def _associated_ids(self, deal_id: str, to_type: str) -> List[str]:
        data = self._req("GET", f"/crm/v4/objects/deals/{deal_id}/associations/{to_type}")
        return [str(r["toObjectId"]) for r in data.get("results", [])]

    def deal_notes(self, deal_id: str) -> List[str]:
        ids = self._associated_ids(deal_id, "notes")
        if not ids:
            return []
        result = self._req("POST", "/crm/v3/objects/notes/batch/read", {
            "properties": ["hs_note_body"],
            "inputs": [{"id": i} for i in ids],
        })
        bodies = [r.get("properties", {}).get("hs_note_body") or "" for r in result.get("results", [])]
        # notes are HTML; strip tags for analysis
        return [re.sub(r"<[^>]+>", " ", b).strip() for b in bodies if b.strip()]

    def deal_primary_contact(self, deal_id: str) -> Optional[dict]:
        ids = self._associated_ids(deal_id, "contacts")
        if not ids:
            return None
        result = self._req("POST", "/crm/v3/objects/contacts/batch/read", {
            "properties": ["firstname", "lastname", "email", "company", "legacy_system", "shop_ro_volume"],
            "inputs": [{"id": ids[0]}],
        })
        rows = result.get("results", [])
        return rows[0].get("properties") if rows else None

    def attach_note_to_deal(self, deal_id: str, html_body: str, timestamp_ms: int) -> str:
        result = self._req("POST", "/crm/v3/objects/notes", {
            "properties": {"hs_note_body": html_body, "hs_timestamp": str(timestamp_ms)},
            "associations": [{
                "to": {"id": deal_id},
                # 214 = HubSpot-defined "note to deal" association type
                "types": [{"associationCategory": "HUBSPOT_DEFINED", "associationTypeId": 214}],
            }],
        })
        return result.get("id", "?")


# --------------------------------------------------------------------------- #
# Concern inference + drafting
# --------------------------------------------------------------------------- #

CONCERN_KEYWORDS = {
    "ccc": ["ccc", "ccc one", "ccc-one"],
    "mitchell": ["mitchell", "qapter", "audatex"],
    "pricing": ["price", "pricing", "cost", "budget", "expensive", "contract", "lock-in", "lock in"],
    "adoption": ["training", "onboarding", "learning curve", "adoption", "team", "estimators pushed back"],
    "carrier": ["drp", "carrier", "insurer", "insurance partner", "scorecard"],
}


def infer_concern(notes: List[str], legacy_system: Optional[str]) -> str:
    """Pick the primary concern from note text.

    Platform mentions (CCC / Mitchell) always win over secondary concerns —
    "carriers force Mitchell" is a Mitchell conversation, not a carrier one.
    The contact's legacy_system property is the fallback when notes are silent.
    """
    text = " ".join(notes).lower()
    scores = {k: sum(text.count(kw) for kw in kws) for k, kws in CONCERN_KEYWORDS.items()}

    platform = {k: scores[k] for k in ("ccc", "mitchell")}
    if any(platform.values()):
        return max(platform, key=lambda k: platform[k])

    secondary = {k: v for k, v in scores.items() if k not in platform}
    if any(secondary.values()):
        return max(secondary, key=lambda k: secondary[k])

    if legacy_system:
        return "ccc" if "ccc" in legacy_system.lower() else "mitchell"
    return "generic"


# Paragraph 2 variants — the legacy-platform concern, addressed head-on.
CONCERN_PARAGRAPHS = {
    "ccc": (
        "On the CCC ONE question specifically: nothing about your platform of record changes. "
        "CCC stays exactly where it is — your DRP agreements, carrier uploads, and audit workflow "
        "are untouched. Collision IQ only replaces the manual work that happens before CCC gets "
        "involved: your writers stop keying lines from photos and start reviewing a drafted sheet "
        "that already has the ADAS calibrations and one-time-use parts on it."
    ),
    "mitchell": (
        "On the Mitchell requirement: your carrier agreements dictate the platform of record, and "
        "we don't ask you to break them. What the carrier doesn't dictate is how the first draft "
        "gets built. Collision IQ drafts from intake photos and flags the items a desk estimate "
        "can't see — calibrations, inspections, one-time-use fasteners — so your first submission "
        "through Mitchell is more complete and your supplement count stops dragging the scorecard."
    ),
    "pricing": (
        "On cost: flat monthly pricing per location, no per-estimate metering, no multi-year "
        "lock-in, cancel monthly. You can put your own numbers into the ROI calculator and see "
        "the payback before we ever talk pricing on a call — most shops find the recovered "
        "supplement items alone cover the subscription in the first week of ROs."
    ),
    "adoption": (
        "On team adoption: there's no new system of record to learn. Estimators keep working in "
        "the platform they know — Collision IQ just hands them a drafted sheet instead of a blank "
        "one. Shops are typically writing AI-drafted estimates within days, and the veterans "
        "usually become the biggest advocates because it deletes the part of the job they hate."
    ),
    "carrier": (
        "On the carrier relationship: your DRP standing is the asset, and this strengthens it. "
        "Fewer late supplements means faster approvals, earlier parts orders, and cycle-time "
        "numbers your scorecard reports in your favor. The carrier sees the same platform and "
        "process it requires today — just a more complete first submission."
    ),
    "generic": (
        "The core of it: your estimating platform of record stays exactly where it is. Collision "
        "IQ layers in front — photos in at drop-off, drafted estimate lines out in seconds, with "
        "the ADAS and structural items already on the first sheet instead of supplement three."
    ),
}


def draft_followup(deal: dict, contact: Optional[dict], concern: str, notes_count: int) -> str:
    """3-paragraph follow-up: recap, concern addressed, low-friction next step."""
    first = (contact or {}).get("firstname") or "there"
    shop = (contact or {}).get("company") or deal.get("properties", {}).get("dealname", "your shop")

    p1 = (
        f"Hi {first} — thanks again for walking through the demo with us. "
        f"Since {shop} is weighing next steps, I wanted to close the loop on the main "
        f"question that was still open when we wrapped up, rather than let it sit."
    )
    p2 = CONCERN_PARAGRAPHS[concern]
    p3 = (
        "No pressure toward a decision this week — but rather than another meeting, send over "
        "photos from one live RO and we'll return the drafted sheet so you can judge it against "
        f"what your team wrote. If it doesn't hold up, that's a fair answer too. — {SENDER_NAME}"
    )
    return "\n\n".join([p1, p2, p3])


def draft_as_note_html(draft: str, concern: str) -> str:
    paras = "".join(f"<p>{p}</p>" for p in draft.split("\n\n"))
    return (
        f"<p><strong>[Collision IQ follow-up draft — concern: {concern}]</strong> "
        f"Review and personalize before sending.</p>{paras}"
    )


# --------------------------------------------------------------------------- #
# Main
# --------------------------------------------------------------------------- #


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Draft follow-ups for stalled demo deals in HubSpot.")
    parser.add_argument("--stage-label", default=DEFAULT_STAGE_LABEL, help="Deal stage label to query")
    parser.add_argument("--ensure-stage", action="store_true", help="Create the stage if it does not exist")
    parser.add_argument("--attach", action="store_true", help="Also attach each draft to the deal as a Note")
    parser.add_argument("--output", type=Path, default=Path("output/followups"), help="Directory for draft files")
    args = parser.parse_args(argv)

    token = os.environ.get("HUBSPOT_ACCESS_TOKEN")
    if not token:
        print("[error] HUBSPOT_ACCESS_TOKEN is not set")
        return 1

    client = HubSpotClient(token)

    stage = client.find_stage(args.stage_label)
    if not stage and args.ensure_stage:
        print(f"[info] stage '{args.stage_label}' not found — creating it")
        stage = client.create_stage(args.stage_label)
        print(f"[ok]   created stage {stage['stageId']} in pipeline '{stage['pipelineLabel']}'")
    if not stage:
        print(f"[error] no deal stage labeled '{args.stage_label}' exists (rerun with --ensure-stage to create it)")
        return 1

    deals = client.deals_in_stage(stage["stageId"])
    print(f"[info] {len(deals)} deal(s) in '{args.stage_label}'")
    if not deals:
        return 0

    args.output.mkdir(parents=True, exist_ok=True)
    import time
    now_ms = int(time.time() * 1000)

    drafted = 0
    for deal in deals:
        deal_id = deal["id"]
        name = deal.get("properties", {}).get("dealname", deal_id)
        try:
            notes = client.deal_notes(deal_id)
            contact = client.deal_primary_contact(deal_id)
        except HubSpotError as exc:
            print(f"[warn] {name}: could not load context ({exc}) — skipping")
            continue

        concern = infer_concern(notes, (contact or {}).get("legacy_system"))
        draft = draft_followup(deal, contact, concern, len(notes))

        out_path = args.output / f"{deal_id}.txt"
        header = (
            f"DEAL:    {name} (id {deal_id})\n"
            f"CONTACT: {(contact or {}).get('email', 'none associated')}\n"
            f"CONCERN: {concern}  (from {len(notes)} note(s))\n" + "=" * 72 + "\n\n"
        )
        out_path.write_text(header + draft + "\n", encoding="utf-8")
        print(f"[ok]   {name:<40} concern={concern:<9} -> {out_path}")
        drafted += 1

        if args.attach:
            try:
                note_id = client.attach_note_to_deal(deal_id, draft_as_note_html(draft, concern), now_ms)
                print(f"[ok]     attached note {note_id} to deal {deal_id}")
            except HubSpotError as exc:
                print(f"[warn]   could not attach note to {name}: {exc}")

    print(f"\n[done] {drafted}/{len(deals)} follow-up drafts written to {args.output}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
