"""F-RK2 — paired-VIN fixture: the same estimate written in CCC (MOTOR) and in Mitchell (CEG), labor untouched.
Holdout defects it caught: 'CEG' column in a live table (was treated as changelog), extended vs unit price on
multi-qty lines, Mitchell sublet markup ('Parts Adjustments'), hyphenated vs bare OEM part numbers, Mitchell
EMS 2.0 layout (suffixed table names, STL/PFM variants)."""
import os
from collision_iq.mitchell_ledger import parse_mitchell
from collision_iq.totals import Profile, expected_totals
from collision_iq import ems
from collision_iq.crossplatform import review
from collision_iq.ceg_ppages import validate_clear_coat

FX = os.path.join(os.path.dirname(__file__), "..", "fixtures", "F-RK2_1259209948")
MPDF = os.path.join(FX, "Mitchell", "Mitchell Estimate 1259209948.pdf")
MEMS = os.path.join(FX, "Mitchell", "9508501")
CEMS = os.path.join(FX, "CCC", "4b53232a")


def test_mitchell_pdf_matches_mitchell_native_ems():
    P = parse_mitchell(MPDF); ML = ems.ems_to_ledger(ems.read_ems(MEMS))
    assert P.pages_changelog == [] and len(P.lines) == 93 == len(ML.lines)     # CEG column is not a changelog marker
    assert P.vin == ML.vin == "<VIN-REDACTED-F-RK2>" and P.claim_no == ML.claim_no
    def hrs(led, t):
        names = (t, "Paint") if t == "Refinish" else (t,)
        return round(sum(x.hrs for l in led.lines for x in l.labor if x.type in names and not x.inc), 1)
    for t in ("Body", "Refinish", "Mechanical"):
        assert hrs(P, t) == hrs(ML, t)
    pdf = {l.line_no: l for l in P.lines}; em = {l.line_no: l for l in ML.lines}
    for n in em:                                       # unit price + qty, not extended price
        assert (pdf[n].price or 0) == (em[n].price or 0), n
    assert pdf[22].qty == 4 and pdf[22].price == 1.98 and pdf[22].ext_price == 7.92


def test_mitchell_totals_close_with_sublet_markup():
    P = parse_mitchell(MPDF); prof = Profile.from_ledger(P)
    assert prof.sublet_markup_pct == 0.25 and P.totals.parts_adjustments == 273.86
    E = expected_totals(P, prof)
    assert E["gross"] == 12496.54 and E["tax"] == 707.35


def test_mitchell_ems_reader_variant():
    S = ems.read_ems(MEMS); ok, msg = ems.gate(S); assert ok and "EST_SYSTEM=M" in msg
    ML = ems.ems_to_ledger(S)
    assert ML.platform == "mitchell" and ML.totals.gross_total == 12496.54 and ML.totals.paint_rate == 60.0
    assert ML.totals.units["Body"] == 24.6 and ML.totals.sublet["Mechanical"] == 569.5


def test_paired_review():
    P = parse_mitchell(MPDF); C = ems.ems_to_ledger(ems.read_ems(CEMS))
    rv = review(C, P, "CCC", "Mitchell")
    assert rv.identity["same_vin"]
    assert rv.summary["pairs"] >= 60          # matcher floor on this pair; 95 % needs the MOTOR<->CEG nomenclature table
    assert rv.parts_differential["pairs"] >= 20 and rv.parts_differential["delta"] == 326.43
    assert rv.summary["gross_delta"] == 358.38
    assert abs(rv.clear_coat["printed_delta"]) <= 0.1
    cc = validate_clear_coat(P); assert cc["status"] in ("match", "within_rounding")
