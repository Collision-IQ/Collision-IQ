"""MOTOR <-> CEG part-nomenclature table (WO-RK1 v3).

The two estimating databases name the same physical part differently ("Side support"
vs "Bumper Cover Support"). After the part-number and description passes, the matcher
retries unmatched lines with descriptions rewritten through this table. Everything here
is database vocabulary — no carrier, shop, make, model or RO literals.

Phrases are stored in `vocab.norm_desc` output form (lower case, sides and noise
tokens stripped, abbreviations expanded). Each entry maps every phrase in the set to
one canonical phrase. `scope` (optional) restricts an entry to a CCC group so that a
generic word ("protector") cannot rewrite lines in unrelated sections; an UNMAPPED
group on either side satisfies any scope (Mitchell sections that have no CCC group).

Provenance follows the ceg_ppages MOTOR-seed convention: entries proven by a fixture
carry it in `fixture`; `verified=False` entries are candidates awaiting a document.
"""
from __future__ import annotations
import re
from dataclasses import dataclass


@dataclass(frozen=True)
class Entry:
    canonical: str          # phrase every synonym rewrites to
    synonyms: tuple         # phrases in norm_desc form (canonical implied)
    scope: str = ""         # CCC group gate, "" = any
    fixture: str = ""       # document that proved the pairing
    verified: bool = True


TABLE: list[Entry] = [
    # F-RK2 1259209948 — paired VIN, CCC (MOTOR) vs Mitchell (CEG), labor untouched.
    Entry("side support",      ("front bumper cover support",),          "FRONT BUMPER & GRILLE", "F-RK2"),
    Entry("absorber clip",     ("front bumper clip",),                   "FRONT BUMPER & GRILLE", "F-RK2"),
    Entry("headlamp",          ("front combination lamp", "combination lamp"), "FRONT LAMPS",     "F-RK2"),
    Entry("upper arm",         ("upper front body support",),            "RADIATOR SUPPORT",      "F-RK2"),
    Entry("diagonal brace",    ("front body bracket",),                  "RADIATOR SUPPORT",      "F-RK2"),
    Entry("protector",         ("fender seal",),                         "FENDER",                "F-RK2"),
    Entry("revv adas",         ("revvadas report", "revv adas report"),  "VEHICLE DIAGNOSTICS",   "F-RK2"),
]

_BY_PHRASE: dict[str, Entry] = {}
for _e in TABLE:
    _BY_PHRASE[_e.canonical] = _e
    for _s in _e.synonyms:
        _BY_PHRASE[_s] = _e
# longest phrase first so "front bumper cover support" wins over any shorter overlap
_PHRASES = sorted(_BY_PHRASE, key=len, reverse=True)

# CCC appends free-text notes after ' - ' and truncates parentheticals at column
# width ("Mask jambs (0.3 Hours and $3.00 per pane"). Both are print artifacts,
# not nomenclature; cut them before normalizing. Document-shape rule, both fixtures.
_NOTE_RE = re.compile(r"\s+-\s+.*$|\s*\(.*$")


def strip_note(desc: str) -> str:
    """Remove trailing ' - <note>' or '(<qualifier>...' from a raw description."""
    return _NOTE_RE.sub("", desc).strip()


def canonicalize(desc_norm: str, group_a: str = "", group_b: str = "") -> str:
    """Rewrite every scoped synonym phrase in a normalized description to its
    canonical phrase. A scope is satisfied when either line's group equals it or
    is UNMAPPED/empty (Mitchell sections without a CCC group)."""
    out = desc_norm
    for ph in _PHRASES:
        if ph not in out:
            continue
        e = _BY_PHRASE[ph]
        groups = [g for g in (group_a, group_b) if g]
        if e.scope and groups and not any(g in (e.scope, "UNMAPPED") for g in groups):
            continue
        out = re.sub(rf"(?<![\w]){re.escape(ph)}(?![\w])", e.canonical, out)
    return out
