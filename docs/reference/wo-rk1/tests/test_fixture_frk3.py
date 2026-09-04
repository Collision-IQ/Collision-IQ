"""F-RK3 — third clear-coat fixture (slot; activates when the documents arrive).

Open question it settles: Mitchell's own clear-coat aggregate rounded ONCE on
RO 21011 but PER LINE on F-RK2. Until a third Mitchell estimate with 3+ refinish
panels decides which behavior is standard, `validate_clear_coat` reports
`within_rounding` at |delta| <= 0.1 h.

To activate: drop a folder `fixtures/F-RK3_<id>/` containing a Mitchell estimate
PDF (and, if available, its EMS export). Requirements for the document:
  - 3 or more refinish panels (so first-panel 40% vs additional 20% both occur),
  - at least one jamb/edge/underside add, if possible,
  - any carrier, any vehicle; redaction not required for a test fixture.
The test then asserts the validator resolves to 'match' under exactly one of the
two rounding modes, and that mode becomes the recorded standard.
"""
import os, glob
from collision_iq.mitchell_ledger import parse_mitchell
from collision_iq.ceg_ppages import validate_clear_coat

FIXDIR = os.path.join(os.path.dirname(__file__), "..", "fixtures")


def test_frk3_clear_coat_rounding_mode():
    dirs = glob.glob(os.path.join(FIXDIR, "F-RK3_*"))
    if not dirs:
        print("SKIP (no F-RK3 fixture yet — see module docstring for what to drop in)")
        return
    pdfs = [p for p in glob.glob(os.path.join(dirs[0], "**", "*.pdf"), recursive=True)]
    assert pdfs, "F-RK3 folder present but no Mitchell PDF found"
    led = parse_mitchell(pdfs[0])
    cc = validate_clear_coat(led)
    # with a third document the aggregate must land exactly under one mode;
    # within_rounding is no longer an acceptable terminal state for this fixture
    assert cc["status"] == "match", cc
