"""Regression fixtures for WO-RK1 (RO 21011).  Run: python -m pytest collision_iq/tests -q"""
import os, tempfile
try:
    import pytest
except ImportError:                       # allow running without pytest (see run_tests.py)
    class _P:
        @staticmethod
        def fixture(scope=None):
            return lambda f: f
    pytest = _P()
from collision_iq.mitchell_ledger import parse_mitchell
from collision_iq.totals import Profile, expected_totals
from collision_iq import ems
from collision_iq.ceg_ppages import validate_clear_coat, lost_costs
from collision_iq.ems_verify import verify
from collision_iq.crossplatform import review

FX = os.path.join(os.path.dirname(__file__), "..", "fixtures", "RO_21011")
MITCH = os.path.join(FX, "Mitchell_Estimate_21011.pdf")
CCC_EMS = os.path.join(FX, "ab7f6e93")


@pytest.fixture(scope="module")
def M():
    return parse_mitchell(MITCH)


def test_F_RK1b_mitchell_ledger(M):
    assert len(M.lines) == 88
    assert M.pages_live == [2, 3, 4, 5] and M.pages_changelog == [12, 13]      # changelog partition via CEG column
    assert M.vin == "<VIN-REDACTED-RO-21011>" and M.supplement_no == "S2"
    notes = [l.line_no for l in M.lines if l.is_note]
    assert notes == [25, 27, 29, 82]
    assert [l.supp_tag for l in M.lines if l.line_no in (2, 12, 13)] == ["S1", "S2", None]
    hrs = lambda t: round(sum(x.hrs for l in M.lines for x in l.labor if x.type == t), 1)
    assert (hrs("Body"), hrs("Refinish"), hrs("Mechanical")) == (21.3, 16.7, 6.8)
    assert M.totals.gross_total == 11262.38 and M.totals.tax_total == 637.49 and M.totals.paint_rate == 42.0
    assert M.vendors[33] == "KSI Auto Parts"                                    # min_len=4 overprint rule


def test_F_RK1b_expected_totals_close(M):
    E = expected_totals(M, Profile.from_ledger(M))
    assert E["parts"]["total_amt"] == 6594.49 and E["tax"] == 637.49 and E["gross"] == 11262.38
    assert E["materials"]["paint_amt"] == 701.40
    assert sum(len(r["folded_from"]) for r in E["rows"]) == 7


def test_clear_coat_ceg_formula(M):
    cc = validate_clear_coat(M)
    assert cc["printed_hours"] == 3.1 and cc["hours"] == 3.1 and cc["status"] == "match" and cc["per_line_sum"] == 3.2


def test_lost_costs_mitchell(M):
    st = {x.key: x.status for x in lost_costs(M)}
    assert st["blend"] == "claimed" and st["bagging"] == "claimed" and st["anti_corrosion"] == "claimed" and st["paint_materials"] == "claimed"
    assert st["tint"] == "lost" and st["sand_buff"] == "lost" and st["mask_interior"] == "lost"


def test_F_RK1a_ccc_ems_reader():
    S = ems.read_ems(CCC_EMS)
    ok, _ = ems.gate(S); assert ok
    C = ems.ems_to_ledger(S)
    assert len(C.lines) == 148 and C.totals.gross_total == 19517.90 and C.totals.tax_total == 1083.93
    assert C.totals.units["Body"] == 47.7 and C.totals.labor_amount["Body"] == 3577.50 and C.totals.paint_materials == 1302.00
    cc = validate_clear_coat(C)
    assert cc["printed_hours"] == 2.9 and cc["hours"] == 2.9


def test_ems_roundtrip_and_verify_pass(M):
    with tempfile.TemporaryDirectory() as d:
        prefix = os.path.join(d, "rk21011")
        ems.write_ems(M, prefix, Profile.from_ledger(M))
        rep = verify(M, Profile.from_ledger(M), prefix)
        assert rep.status == "PASS" and rep.summary["unexplained"] == 0.0 and rep.lines == []


def test_verify_flags_wrong_profile(M):
    rep = verify(M, Profile.from_ledger(M), CCC_EMS)          # shop's own prelim: same VIN, different profile
    assert rep.status == "FAIL"
    refs = {f["ref"] for f in rep.profile}
    assert {"rate LAB", "paint materials rate", "LKQ markup"} <= refs


def test_negative_fixtures(M, tmp_path):
    # empty lin -> BLOCKED
    import shutil
    for ext in ("env", "lin", "veh", "ad1"):
        shutil.copy(f"{CCC_EMS}.{ext}", tmp_path / f"neg.{ext}")
    from collision_iq.ems import read_table, write_table
    t = read_table(str(tmp_path / "neg.lin")); write_table(str(tmp_path / "neg.lin"), t.fields, [])
    assert verify(M, Profile.from_ledger(M), str(tmp_path / "neg")).status == "BLOCKED"
    # different VIN -> BLOCKED
    for ext in ("env", "lin", "veh", "ad1", "pfl", "stl", "ttl"):
        shutil.copy(f"{CCC_EMS}.{ext}", tmp_path / f"vin.{ext}")
    t = read_table(str(tmp_path / "vin.veh")); t.records[0]["V_VIN"] = "1HGCM82633A004352"; write_table(str(tmp_path / "vin.veh"), t.fields, t.records, has_memo=True)
    assert verify(M, Profile.from_ledger(M), str(tmp_path / "vin")).status == "BLOCKED"


def test_crossplatform_review(M):
    C = ems.ems_to_ledger(ems.read_ems(CCC_EMS))
    rv = review(M, C)
    assert rv.clear_coat["printed_delta"] == -0.2                 # aggregate rule: one finding, not ten
    assert rv.identity["same_vin"] and rv.summary["gross_delta"] == 8255.52
    keys = {x["key"] for x in rv.lost_costs["bridge"]["one_sided"]}
    assert {"tint", "sand_buff", "mask_interior"} <= keys
