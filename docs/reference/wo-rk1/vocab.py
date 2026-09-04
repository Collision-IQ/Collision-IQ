"""Platform vocabulary maps.  Everything here is estimating-platform vocabulary
(Mitchell CEG / CCC-MOTOR / CIECA EMS).  No carrier, shop, make, model or RO literals.

EMS codes were confirmed against a CCC ONE 5.61 EMS export (fixture RO 21011):
LBR_OP  OP0 manual, OP2 R&I, OP4 Align, OP9 Repair, OP11 Replace, OP15 Blend, OP16 Sublet
PART_TYPE PAN new OEM, PAA aftermarket, PAC certified aftermarket, PAL recycled/LKQ,
          PAR remanufactured, PAO other/misc (manual $ lines), PAG glass, PAS sublet
MOD_LBR_TY LAB body, LAR refinish, LAM mechanical, LAS structural, LAF frame,
          LAD diagnostic, LAE electrical, LAG glass
"""
from __future__ import annotations
import re

# --- Mitchell operation -> (CCC op label, EMS LBR_OP) -------------------------
OPERATION = {
    "Remove / Replace":     ("Repl", "OP11"),
    "Remove / Install":     ("R&I",  "OP2"),
    "Repair":               ("Rpr",  "OP9"),
    "Blend":                ("Blnd", "OP15"),
    "Refinish Only":        ("Refn", ""),        # folds into parent as LAR hours
    "Overhaul":             ("O/H",  ""),
    "Check / Adjust":       ("Adj",  ""),
    "Align":                ("Algn", "OP4"),
    "Additional Labor":     ("#",    "OP0"),
    "Additional Operation": ("#",    "OP0"),
    "Additional Cost":      ("#",    "OP0"),
    "Sublet":               ("Subl", "OP16"),
}

# --- Mitchell part type -> (CCC label, EMS PART_TYPE) --------------------------
PART_TYPE = {
    "New":                  ("OEM",     "PAN"),
    "Aftermarket New":      ("A/M",     "PAA"),
    "Aftermarket Certified":("CAPA A/M","PAC"),
    "Qual Recycled Part":   ("LKQ",     "PAL"),
    "Recycled":             ("LKQ",     "PAL"),
    "Remanufactured":       ("Recond",  "PAR"),
    "Recond":               ("Recond",  "PAR"),
    "OEM Surplus Part":     ("OPT OEM", "PAN"),
    "Existing":             ("",        ""),
    "Sublet":               ("Subl",    "PAS"),
}

# --- labor type -> EMS MOD_LBR_TY -------------------------------------------------
LABOR_TYPE = {
    "Body": "LAB", "Refinish": "LAR", "Paint": "LAR", "Mechanical": "LAM",
    "Structural": "LAS", "Frame": "LAF", "Diagnostic": "LAD", "Electrical": "LAE", "Glass": "LAG",
}
LABOR_TYPE_INV = {v: k for k, v in LABOR_TYPE.items()}

# --- Mitchell section -> CCC group, in CCC print order -------------------------
CCC_GROUP_ORDER = [
    "FRONT BUMPER & GRILLE", "FRONT LAMPS", "RADIATOR SUPPORT", "COOLING",
    "AIR CONDITIONER & HEATER", "HOOD", "FENDER", "FRONT INNER STRUCTURE", "FRAME",
    "WHEELS", "FRONT SUSPENSION", "ELECTRICAL", "ENGINE / TRANSAXLE", "WINDSHIELD",
    "COWL", "INSTRUMENT PANEL", "RESTRAINT SYSTEMS", "SEATS & TRACKS",
    "PILLARS, ROCKER & FLOOR", "FRONT DOOR", "REAR DOOR", "ROOF", "QUARTER PANEL",
    "REAR BODY & FLOOR", "REAR LAMPS", "REAR BUMPER", "FUEL SYSTEM",
    "VEHICLE DIAGNOSTICS", "MISCELLANEOUS OPERATIONS",
]
SECTION = {
    "Front Bumper": "FRONT BUMPER & GRILLE",
    "Grille": "FRONT BUMPER & GRILLE",
    "Bumper and Grille": "FRONT BUMPER & GRILLE",
    "Front Lamps": "FRONT LAMPS",
    "Front Panel": "RADIATOR SUPPORT",
    "Radiator Support": "RADIATOR SUPPORT",
    "Cooling": "COOLING",
    "A/C / Heater / Ventilation": "AIR CONDITIONER & HEATER",
    "Air Conditioning Components": "AIR CONDITIONER & HEATER",
    "Hood": "HOOD",
    "Front Fender": "FENDER",
    "Front Inner Structure - Unibody": "FRONT INNER STRUCTURE",
    "Frame": "FRAME",
    "Wheel/Wheel Alignment": "WHEELS",
    "Front Suspension": "FRONT SUSPENSION",
    "Air Bag System": "RESTRAINT SYSTEMS",
    "Air Cleaner": "ENGINE / TRANSAXLE",
    "Engine/Fuel Tank": "ENGINE / TRANSAXLE",
    "Electrical": "ELECTRICAL",
    "Windshield": "WINDSHIELD",
    "Cowl and Dash": "COWL",
    "Rocker / Pillars / Floor": "PILLARS, ROCKER & FLOOR",
    "Rocker Panel/Side Body Panel/Center Pillar": "PILLARS, ROCKER & FLOOR",
    "Front Door": "FRONT DOOR",
    "Rear Door": "REAR DOOR",
    "Roof": "ROOF",
    "Quarter Panel": "QUARTER PANEL",
    "Rear Body": "REAR BODY & FLOOR",
    "Rear Lamps": "REAR LAMPS",
    "Rear Bumper": "REAR BUMPER",
    "Seats": "SEATS & TRACKS",
    "Additional Costs & Materials": "MISCELLANEOUS OPERATIONS",
    "Additional Operations": "MISCELLANEOUS OPERATIONS",
    "Special / Manual Entry": "MISCELLANEOUS OPERATIONS",
}
# Manual/additional lines whose description names a diagnostic operation route to VEHICLE DIAGNOSTICS.
DIAGNOSTIC_TOKENS = ("scan", "calibrat", "reset", "initializ", "function test", "adas", "aim distance", "diagnos")


def ccc_group(mitchell_section: str, description: str = "") -> str:
    grp = SECTION.get(mitchell_section.strip())
    if grp is None:
        return "UNMAPPED"
    if grp == "MISCELLANEOUS OPERATIONS" and any(t in description.lower() for t in DIAGNOSTIC_TOKENS):
        return "VEHICLE DIAGNOSTICS"
    return grp


def group_rank(grp: str) -> int:
    return CCC_GROUP_ORDER.index(grp) if grp in CCC_GROUP_ORDER else len(CCC_GROUP_ORDER)


# --- description normalisation for cross-platform matching ------------------------
ABBREV = {
    "frt": "front", "lwr": "lower", "upr": "upper", "otr": "outer", "inr": "inner",
    "mldg": "molding", "moulding": "molding", "assy": "assembly", "w/o": "without",
    "w/": "with", "r": "rt", "l": "lt", "right": "rt", "left": "lt", "opng": "opening",
    "rr": "rear", "cvr": "cover", "brkt": "bracket", "hdlp": "headlamp", "lp": "lamp",
    "-m": "", "reinf": "reinforcement", "rep": "repair", "proc": "process", "hdlamp": "headlamp",
}
SIDE_TOKENS = {"rt", "lt"}
# platform / database wording that carries no matching value
NOISE_TOKENS = {"outside", "assembly", "assy", "alu", "(alu)", "uhs", "(uhs)", "uhss", "(uhss)", "hss", "built", "us", "without", "with",
                "sport", "f", "hybrid", "liter", "local", "part", "complete", "plus", "3m", "per", "ounces", "type", "1", "2", "the", "a",
                "w", "o", "-m", "m", "&", "and", "or", "for", "to", "of", "panel", "unibody", "(unibody)", "-"}


def norm_desc(desc: str) -> tuple[str, str]:
    """-> (side, normalized description without side/noise tokens)."""
    toks = [ABBREV.get(t, t) for t in desc.lower().replace(",", " ").replace("-", " ").replace("/", " ").split()]
    side = next((t for t in toks if t in SIDE_TOKENS), "")
    core = [t.strip("()") for t in toks if t not in SIDE_TOKENS and t not in ("", "r&i", "r&r", "repl", "refn")
            and t.strip("()") not in NOISE_TOKENS and not re.fullmatch(r"[\d.]+", t)]
    return side, " ".join(core)
