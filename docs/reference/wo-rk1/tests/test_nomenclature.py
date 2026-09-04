"""WO-RK1 v3 — MOTOR <-> CEG nomenclature table.

The F-RK2 paired-VIN fixture left 27/18 unmatched lines whose only difference was
database naming ("Side support" vs "Bumper Cover Support"). The nomenclature pass
must pair those without inventing pairs: every nomenclature match has to agree on
the numbers (labor-hour set or price), and totals-level review figures must be
byte-identical to the pre-nomenclature run.
"""
import os
from collision_iq.mitchell_ledger import parse_mitchell
from collision_iq import ems
from collision_iq.matching import items_from_ledger, match
from collision_iq.crossplatform import review
from collision_iq.nomenclature import canonicalize, strip_note

FX = os.path.join(os.path.dirname(__file__), "..", "fixtures", "F-RK2_1259209948")
MPDF = os.path.join(FX, "Mitchell", "Mitchell Estimate 1259209948.pdf")
CEMS = os.path.join(FX, "CCC", "4b53232a")


def _pair_set():
    C = ems.ems_to_ledger(ems.read_ems(CEMS)); P = parse_mitchell(MPDF)
    return match(items_from_ledger(C), items_from_ledger(P), same_group_required=False)


def test_nomenclature_pairs_agree_on_numbers():
    noms = [m for m in _pair_set() if m.how == "nomenclature"]
    assert len(noms) >= 12
    for m in noms:
        hours_equal = m.a.labor == m.b.labor
        price_equal = (m.a.price is not None and m.a.price == m.b.price) or \
                      (m.a.misc_amt is not None and m.a.misc_amt == m.b.misc_amt)
        assert hours_equal or price_equal, (m.a.desc, m.b.desc)


def test_known_motor_ceg_pairs():
    got = {(m.a.desc, m.b.desc) for m in _pair_set() if m.how == "nomenclature"}
    for a, b in [("LT Side support", "L Frt Bumper Cover Support"),
                 ("LT R&I headlamp assy", "L Front Combination Lamp"),
                 ("RT Upper arm", "R Upr Frt Body Support"),
                 ("RT Diagonal brace", "R Frt Body Bracket"),
                 ("RT Protector", "R Fender Seal"),
                 ("REVVAdas Report", "Revv ADAS")]:
        assert (a, b) in got, (a, b)


def test_review_totals_unchanged_and_match_rate():
    C = ems.ems_to_ledger(ems.read_ems(CEMS)); P = parse_mitchell(MPDF)
    rv = review(C, P, "CCC", "Mitchell")
    # totals-level findings must not move when the matcher improves
    assert rv.summary["gross_delta"] == 358.38
    assert rv.parts_differential["delta"] == 326.43
    assert abs(rv.clear_coat["printed_delta"]) <= 0.1
    # match rate: >= 90% of Mitchell lines paired; the remainder are scope
    # artifacts (CCC folds 'Add w/Parking Sensor' onto the bumper line; 'Cover
    # Car' is an untaxed sublet CCC books differently), not nomenclature.
    pairs, ub = rv.summary["pairs"], rv.summary["unmatched_b"]
    assert pairs >= 75 and ub <= 6
    assert pairs / (pairs + ub) >= 0.90


def test_scope_gate_and_note_strip():
    # 'protector' only rewrites inside FENDER (or UNMAPPED); elsewhere untouched
    assert canonicalize("fender seal", "FENDER") == "protector"
    assert canonicalize("fender seal", "REAR BUMPER") == "fender seal"
    assert canonicalize("fender seal", "UNMAPPED") == "protector"
    # note stripping is a print-artifact rule, not nomenclature
    assert strip_note("Collision Access - Hood will not open wh") == "Collision Access"
    assert strip_note("Mask jambs (0.3 Hours and $3.00 per pane") == "Mask jambs"
    assert strip_note("Sight shield plate US built") == "Sight shield plate US built"
