#!/usr/bin/env python3
"""Generate personalized 3-step cold email sequences for collision shop leads.

Reads a JSON target list (default: ./data/leads.json), renders a 3-email drip
per lead with jinja2, and writes one draft file per shop to
./output/email_campaigns/{shop_id}.txt.

With --sync-hubspot, additionally pushes each lead into HubSpot as a contact
(created or updated by email) with custom properties, and optionally enrolls
the contact in an outbound Sequence.

Environment variables for HubSpot sync:
    HUBSPOT_ACCESS_TOKEN   required — private app token with scopes:
                           crm.objects.contacts.write, crm.schemas.contacts.write
                           (+ automation.sequences.enrollments.write for sequences)
    HUBSPOT_SEQUENCE_ID    optional — Sequence to enroll new contacts into
    HUBSPOT_SENDER_EMAIL   optional — connected inbox that sends the sequence
                           (required by HubSpot if HUBSPOT_SEQUENCE_ID is set;
                           sequence enrollment via API needs a Sales Hub
                           Professional/Enterprise seat)

Usage:
    python scripts/lead_outreach_gen.py                 # text drafts only
    python scripts/lead_outreach_gen.py --sync-hubspot  # drafts + CRM sync
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Dict, List, Optional

import requests
from jinja2 import Environment
from pydantic import BaseModel, Field, ValidationError

MAX_BODY_WORDS = 120

# --------------------------------------------------------------------------- #
# Models
# --------------------------------------------------------------------------- #


class Lead(BaseModel):
    """One target shop / contact."""

    shop_id: str = Field(min_length=1, pattern=r"^[A-Za-z0-9_\-]+$")
    shop_name: str = Field(min_length=1)
    contact_name: str = Field(min_length=1)
    contact_role: str = Field(min_length=1)  # e.g. "General Manager", "COO", "Lead Estimator"
    contact_email: Optional[str] = Field(default=None, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
    city: str
    state: str
    num_locations: int = Field(ge=1)
    monthly_ros: int = Field(ge=1, description="Approx. repair orders per month across all locations")
    legacy_system: Optional[str] = None  # e.g. "CCC ONE", "Mitchell", "Audatex/Qapter"
    certifications: List[str] = Field(default_factory=list)
    notes: Optional[str] = None

    @property
    def first_name(self) -> str:
        return self.contact_name.split()[0]

    @property
    def last_name(self) -> str:
        parts = self.contact_name.split()
        return " ".join(parts[1:]) if len(parts) > 1 else ""

    @property
    def footprint(self) -> str:
        """Human phrase for shop size, used inside email copy."""
        if self.num_locations == 1:
            return f"a single high-volume shop in {self.city}"
        return f"{self.num_locations} locations in the {self.city} market"

    @property
    def is_estimator(self) -> bool:
        return "estimator" in self.contact_role.lower()


# --------------------------------------------------------------------------- #
# Email templates (jinja2). Bodies must stay under 120 words each.
# --------------------------------------------------------------------------- #

EMAIL_TEMPLATES = [
    {
        "day": 0,
        "label": "Email 1 - Cycle Time & Teardown Bottleneck",
        "subject": "{{ lead.shop_name }} - the 30 minutes per estimate problem",
        "body": """\
{{ lead.first_name }} --

Running {{ lead.footprint }}, you already know where the day goes: estimators \
typing lines into CCC while cars sit waiting on teardown.

{% if lead.is_estimator -%}
At roughly {{ lead.monthly_ros }} ROs a month, that's hours of keystrokes per \
day that never touch a repair decision.
{%- else -%}
At roughly {{ lead.monthly_ros }} ROs a month, manual entry alone is quietly \
eating a writer's worth of capacity.
{%- endif %}

Collision IQ turns drop-off photos into draft estimate lines in seconds -- \
parts, labor, refinish. Your estimators review and adjust instead of \
transcribing. Shops using it start blueprinting and ordering parts a full day \
earlier, which is where cycle time actually moves.

Worth a look at how it would run on your files?

-- {{ sender.name }}, {{ sender.company }}""",
    },
    {
        "day": 3,
        "label": "Email 2 - Supplement Reduction Proof Point",
        "subject": "Re: {{ lead.shop_name }} - catching ADAS items before supplement #3",
        "body": """\
{{ lead.first_name }} --

Quick follow-up with the part that pays for itself: supplements.

Most missed items aren't estimating errors -- they're things a photo estimate \
was never going to surface. Occupant-safety inspections, one-time-use \
fasteners, and ADAS calibrations behind a bumper or windshield job.

Collision IQ flags those at photo intake. It cross-checks detected damage \
against required operations and calibration triggers, so structural and ADAS \
items land on the first sheet instead of supplement three.

Fewer supplements means faster carrier approvals, earlier parts orders, and \
margin that stays on the RO instead of leaking into admin time{% if lead.certifications %} -- \
especially on {{ lead.certifications[0] }} work{% endif %}.

Happy to show you the exact flag logic.

-- {{ sender.name }}""",
    },
    {
        "day": 7,
        "label": "Email 3 - 15-Minute Live Demo Offer",
        "subject": "15 minutes, your photos, {{ lead.first_name }}",
        "body": """\
{{ lead.first_name }} --

Last note from me, and it's a simple offer.

Send over photos from any recent hit -- something with hidden damage or a \
calibration you had to fight for -- and I'll run them through Collision IQ \
live on a 15-minute call. You watch the lines get written on your own \
vehicle, not a canned demo car.

No slide deck, no procurement conversation. If it's not obviously useful for \
{{ lead.footprint }}, we shake hands and you keep the output.

Just reply with a day that works and I'll send a link.

-- {{ sender.name }}, {{ sender.company }}""",
    },
]

SENDER = {"name": "Vinny", "company": "Collision IQ"}

# --------------------------------------------------------------------------- #
# Dummy data
# --------------------------------------------------------------------------- #

DUMMY_LEADS = [
    {
        "shop_id": "summit-collision-denver",
        "shop_name": "Summit Collision Center",
        "contact_name": "Marcus Reyes",
        "contact_role": "General Manager",
        "contact_email": "marcus.reyes@example-summitcollision.com",
        "city": "Denver",
        "state": "CO",
        "num_locations": 3,
        "monthly_ros": 210,
        "legacy_system": "CCC ONE",
        "certifications": ["Subaru Certified"],
        "notes": "Heavy DRP mix; cycle time pressure from two national carriers.",
    },
    {
        "shop_id": "bayline-autobody-tampa",
        "shop_name": "Bayline Auto Body Group",
        "contact_name": "Dana Whitfield",
        "contact_role": "Chief Operating Officer",
        "contact_email": "dana.whitfield@example-bayline.com",
        "city": "Tampa",
        "state": "FL",
        "num_locations": 12,
        "monthly_ros": 980,
        "legacy_system": "Mitchell",
        "certifications": ["Tesla Approved", "Rivian Certified"],
        "notes": "Regional MSO scaling via acquisition; standardizing estimating across shops.",
    },
    {
        "shop_id": "ironworks-collision-columbus",
        "shop_name": "Ironworks Collision",
        "contact_name": "Sam Kowalski",
        "contact_role": "Lead Estimator",
        "contact_email": "sam@example-ironworkscollision.com",
        "city": "Columbus",
        "state": "OH",
        "num_locations": 1,
        "monthly_ros": 95,
        "legacy_system": "CCC ONE",
        "certifications": ["I-CAR Gold Class"],
        "notes": "Owner-operated independent; lead estimator also handles parts ordering.",
    },
]

# --------------------------------------------------------------------------- #
# HubSpot sync
# --------------------------------------------------------------------------- #

# Custom contact properties the sync writes. Created automatically if missing.
CUSTOM_PROPERTIES = [
    {"name": "shop_ro_volume", "label": "Shop RO Volume (monthly)", "type": "number", "fieldType": "number"},
    {"name": "legacy_system", "label": "Legacy Estimating System", "type": "string", "fieldType": "text"},
    {"name": "target_sequence_step_1", "label": "Target Sequence - Step 1 Draft", "type": "string", "fieldType": "textarea"},
]


class HubSpotError(RuntimeError):
    pass


class HubSpotClient:
    """Minimal HubSpot CRM client over HTTP (no SDK dependency)."""

    BASE = "https://api.hubapi.com"

    def __init__(self, token: str):
        self.session = requests.Session()
        self.session.headers.update({"Authorization": f"Bearer {token}", "Content-Type": "application/json"})

    def _req(self, method: str, path: str, payload: Optional[dict] = None,
             ok_statuses: tuple = (200, 201, 204)) -> dict:
        try:
            resp = self.session.request(method, f"{self.BASE}{path}", json=payload, timeout=30)
        except requests.RequestException as exc:
            raise HubSpotError(f"network error calling {path}: {exc}") from exc
        if resp.status_code not in ok_statuses:
            try:
                detail = resp.json().get("message", resp.text[:300])
            except ValueError:
                detail = resp.text[:300]
            raise HubSpotError(f"{method} {path} -> HTTP {resp.status_code}: {detail}")
        return resp.json() if resp.content else {}

    # -- schema ------------------------------------------------------------- #

    def ensure_contact_properties(self) -> None:
        """Create any missing custom contact properties (idempotent)."""
        for spec in CUSTOM_PROPERTIES:
            try:
                self.session.get(f"{self.BASE}/crm/v3/properties/contacts/{spec['name']}", timeout=30).raise_for_status()
                continue  # exists
            except requests.RequestException:
                pass  # missing (or transient error — creation below will surface it)
            self._req("POST", "/crm/v3/properties/contacts", {
                "name": spec["name"],
                "label": spec["label"],
                "type": spec["type"],
                "fieldType": spec["fieldType"],
                "groupName": "contactinformation",
            }, ok_statuses=(201, 409))  # 409 = created concurrently, fine
            print(f"[ok]   ensured contact property: {spec['name']}")

    # -- contacts ----------------------------------------------------------- #

    def upsert_contacts(self, inputs: List[dict]) -> Dict[str, str]:
        """Batch create-or-update contacts keyed by email. Returns email -> contact id."""
        result = self._req("POST", "/crm/v3/objects/contacts/batch/upsert", {
            "inputs": [{"idProperty": "email", "id": i["email"], "properties": i["properties"]} for i in inputs],
        }, ok_statuses=(200, 201))
        mapping: Dict[str, str] = {}
        for row in result.get("results", []):
            email = row.get("properties", {}).get("email", "")
            if email:
                mapping[email.lower()] = row["id"]
        return mapping

    # -- sequences ---------------------------------------------------------- #

    def enroll_in_sequence(self, contact_id: str, sequence_id: str, sender_email: str) -> None:
        """Enroll a contact in a Sequence.

        Requires a Sales Hub Professional/Enterprise seat and the
        automation.sequences.enrollments.write scope; sender_email must be a
        connected inbox belonging to the token's user.
        """
        self._req("POST", "/automation/v4/sequences/enrollments", {
            "sequenceId": sequence_id,
            "contactId": contact_id,
            "senderEmail": sender_email,
        }, ok_statuses=(200, 201, 204))


def lead_to_contact_properties(lead: Lead, email1_subject: str, email1_body: str) -> dict:
    props = {
        "email": lead.contact_email,
        "firstname": lead.first_name,
        "lastname": lead.last_name,
        "jobtitle": lead.contact_role,
        "company": lead.shop_name,
        "city": lead.city,
        "state": lead.state,
        "shop_ro_volume": str(lead.monthly_ros),
        "target_sequence_step_1": f"Subject: {email1_subject}\n\n{email1_body}",
    }
    if lead.legacy_system:
        props["legacy_system"] = lead.legacy_system
    return props


def sync_leads_to_hubspot(leads: List[Lead], env: Environment) -> None:
    token = os.environ.get("HUBSPOT_ACCESS_TOKEN")
    if not token:
        raise SystemExit("[error] --sync-hubspot requires HUBSPOT_ACCESS_TOKEN to be set")

    syncable = [l for l in leads if l.contact_email]
    skipped = [l for l in leads if not l.contact_email]
    for lead in skipped:
        print(f"[warn] {lead.shop_id}: no contact_email — skipping HubSpot sync for this lead")
    if not syncable:
        print("[warn] no leads with contact_email; nothing to sync")
        return

    client = HubSpotClient(token)
    print("\n[sync] ensuring custom contact properties exist...")
    client.ensure_contact_properties()

    inputs = []
    for lead in syncable:
        subject = env.from_string(EMAIL_TEMPLATES[0]["subject"]).render(lead=lead, sender=SENDER)
        body = env.from_string(EMAIL_TEMPLATES[0]["body"]).render(lead=lead, sender=SENDER)
        inputs.append({"email": lead.contact_email, "properties": lead_to_contact_properties(lead, subject, body)})

    print(f"[sync] upserting {len(inputs)} contact(s)...")
    id_by_email = client.upsert_contacts(inputs)
    for lead in syncable:
        cid = id_by_email.get(lead.contact_email.lower(), "?")
        print(f"[ok]   {lead.contact_email:<45} -> contact id {cid}")

    sequence_id = os.environ.get("HUBSPOT_SEQUENCE_ID")
    sender_email = os.environ.get("HUBSPOT_SENDER_EMAIL")
    if not sequence_id:
        print("[info] HUBSPOT_SEQUENCE_ID not set — skipping sequence enrollment")
        return
    if not sender_email:
        print("[warn] HUBSPOT_SEQUENCE_ID is set but HUBSPOT_SENDER_EMAIL is not — skipping enrollment")
        return

    print(f"[sync] enrolling contacts in sequence {sequence_id}...")
    for lead in syncable:
        cid = id_by_email.get(lead.contact_email.lower())
        if not cid:
            continue
        try:
            client.enroll_in_sequence(cid, sequence_id, sender_email)
            print(f"[ok]   enrolled {lead.contact_email}")
        except HubSpotError as exc:
            # Enrollment failing shouldn't lose the contact sync — warn and move on.
            print(f"[warn] could not enroll {lead.contact_email}: {exc}")


# --------------------------------------------------------------------------- #
# Generation
# --------------------------------------------------------------------------- #


def load_leads(leads_path: Path) -> List[Lead]:
    """Load and validate leads; create the file with dummy data if missing."""
    if not leads_path.exists():
        print(f"[warn] {leads_path} not found -- seeding {len(DUMMY_LEADS)} dummy leads")
        leads_path.parent.mkdir(parents=True, exist_ok=True)
        leads_path.write_text(json.dumps(DUMMY_LEADS, indent=2), encoding="utf-8")

    try:
        # utf-8-sig tolerates the BOM that Notepad/PowerShell prepend on Windows
        raw = json.loads(leads_path.read_text(encoding="utf-8-sig"))
    except json.JSONDecodeError as exc:
        raise SystemExit(f"[error] {leads_path} is not valid JSON: {exc}")

    if not isinstance(raw, list):
        raise SystemExit(f"[error] {leads_path} must contain a JSON array of lead objects")

    leads: List[Lead] = []
    for i, entry in enumerate(raw):
        try:
            leads.append(Lead.model_validate(entry))
        except ValidationError as exc:
            name = entry.get("shop_name", f"entry #{i}") if isinstance(entry, dict) else f"entry #{i}"
            print(f"[warn] skipping invalid lead ({name}): {exc.errors()[0]['msg']}")
    return leads


def render_sequence(env: Environment, lead: Lead) -> str:
    """Render the full 3-email drip for one lead as a single text document."""
    lines = [
        "=" * 72,
        f"CAMPAIGN: Collision IQ - Throughput & Margin Drip",
        f"LEAD:     {lead.contact_name} ({lead.contact_role})",
        f"SHOP:     {lead.shop_name} - {lead.city}, {lead.state} "
        f"({lead.num_locations} location{'s' if lead.num_locations != 1 else ''}, ~{lead.monthly_ros} ROs/mo)",
        "=" * 72,
    ]
    for tmpl in EMAIL_TEMPLATES:
        subject = env.from_string(tmpl["subject"]).render(lead=lead, sender=SENDER)
        body = env.from_string(tmpl["body"]).render(lead=lead, sender=SENDER)

        word_count = len(body.split())
        if word_count > MAX_BODY_WORDS:
            print(
                f"[warn] {lead.shop_id}: '{tmpl['label']}' body is {word_count} words "
                f"(limit {MAX_BODY_WORDS}) -- tighten template"
            )

        lines += [
            "",
            f"--- {tmpl['label']} (send day {tmpl['day']}) ".ljust(72, "-"),
            f"Subject: {subject}",
            "",
            body,
            "",
        ]
    return "\n".join(lines)


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Generate 3-step cold email drips for collision shop leads.")
    parser.add_argument("--leads", type=Path, default=Path("data/leads.json"), help="Path to leads JSON file")
    parser.add_argument(
        "--output", type=Path, default=Path("output/email_campaigns"), help="Directory for generated drafts"
    )
    parser.add_argument(
        "--sync-hubspot", action="store_true",
        help="Also upsert leads as HubSpot contacts (and enroll in a sequence if configured)",
    )
    args = parser.parse_args(argv)

    leads = load_leads(args.leads)
    if not leads:
        print("[error] no valid leads to process")
        return 1

    args.output.mkdir(parents=True, exist_ok=True)
    env = Environment(trim_blocks=True, lstrip_blocks=True, keep_trailing_newline=False, autoescape=False)

    written = 0
    for lead in leads:
        out_path = args.output / f"{lead.shop_id}.txt"
        try:
            out_path.write_text(render_sequence(env, lead), encoding="utf-8")
        except OSError as exc:
            print(f"[warn] could not write {out_path}: {exc}")
            continue
        print(f"[ok]   {lead.shop_name:<28} -> {out_path}")
        written += 1

    print(f"\n[done] {written}/{len(leads)} sequences written to {args.output}")

    if args.sync_hubspot:
        try:
            sync_leads_to_hubspot(leads, env)
        except HubSpotError as exc:
            print(f"[error] HubSpot sync failed: {exc}")
            return 1

    return 0 if written else 1


if __name__ == "__main__":
    sys.exit(main())
