#!/usr/bin/env python3
"""Generate personalized 3-step cold email sequences for collision shop leads.

Reads a JSON target list (default: ./data/leads.json), renders a 3-email drip
per lead with jinja2, and writes one draft file per shop to
./output/email_campaigns/{shop_id}.txt.

If the leads file is missing, three realistic dummy leads are written so the
pipeline can be exercised end-to-end.

Usage:
    python scripts/lead_outreach_gen.py
    python scripts/lead_outreach_gen.py --leads data/leads.json --output output/email_campaigns
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import List, Optional

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
    city: str
    state: str
    num_locations: int = Field(ge=1)
    monthly_ros: int = Field(ge=1, description="Approx. repair orders per month across all locations")
    certifications: List[str] = Field(default_factory=list)
    notes: Optional[str] = None

    @property
    def first_name(self) -> str:
        return self.contact_name.split()[0]

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
        "city": "Denver",
        "state": "CO",
        "num_locations": 3,
        "monthly_ros": 210,
        "certifications": ["Subaru Certified"],
        "notes": "Heavy DRP mix; cycle time pressure from two national carriers.",
    },
    {
        "shop_id": "bayline-autobody-tampa",
        "shop_name": "Bayline Auto Body Group",
        "contact_name": "Dana Whitfield",
        "contact_role": "Chief Operating Officer",
        "city": "Tampa",
        "state": "FL",
        "num_locations": 12,
        "monthly_ros": 980,
        "certifications": ["Tesla Approved", "Rivian Certified"],
        "notes": "Regional MSO scaling via acquisition; standardizing estimating across shops.",
    },
    {
        "shop_id": "ironworks-collision-columbus",
        "shop_name": "Ironworks Collision",
        "contact_name": "Sam Kowalski",
        "contact_role": "Lead Estimator",
        "city": "Columbus",
        "state": "OH",
        "num_locations": 1,
        "monthly_ros": 95,
        "certifications": ["I-CAR Gold Class"],
        "notes": "Owner-operated independent; lead estimator also handles parts ordering.",
    },
]

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
    return 0 if written else 1


if __name__ == "__main__":
    sys.exit(main())
