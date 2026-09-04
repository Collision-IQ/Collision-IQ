"""Text normalization shared by all extractors.

Mitchell Cloud Estimating renders bold rows with every glyph duplicated in the
raw text layer ("$$1111,,226622..3388").  All money / structural matching must run
on de-duplicated text.  `min_len=4` protects legitimate short doubles in data
("AA", "S300") ; use `min_len=2` only for structural-phrase tests.
"""
from __future__ import annotations
import re

_MONEY = re.compile(r"-?\$?\d[\d,]*\.\d{2}")
_HOURS = re.compile(r"^\d+\.\d$")


def dedupe_token(tok: str, min_len: int = 4) -> str:
    if len(tok) >= min_len and len(tok) % 2 == 0 and tok[0::2] == tok[1::2]:
        return tok[0::2]
    return tok


def normalize(text: str, min_len: int = 4) -> str:
    return " ".join(dedupe_token(t, min_len) for t in text.split())


def money(tok: str) -> float | None:
    t = dedupe_token(tok.strip(), 4)
    neg = t.startswith("-")
    t = t.lstrip("-$").replace(",", "")
    if not re.fullmatch(r"\d+\.\d{2}", t):
        return None
    v = float(t)
    return -v if neg else v


def hours(tok: str) -> float | None:
    """Parse a labor units token: '1.7', '2.6#', '0.5*#', '1.0r#', 'INC', 'INC#'."""
    t = dedupe_token(tok.strip(), 4)
    core = re.sub(r"[#*r]+$", "", t)
    if core.upper() == "INC":
        return 0.0
    if _HOURS.match(core):
        return float(core)
    return None


def flags(tok: str) -> dict:
    t = tok.strip()
    return {
        "inc": t.upper().startswith("INC"),
        "judgment": "*" in t,
        "labor_note": "#" in t,
        "ceg_rr_time": t.rstrip("#*").endswith("r"),
    }
