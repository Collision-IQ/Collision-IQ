"""Command line entry points.

  python -m collision_iq.cli rekey    <mitchell.pdf> <outdir>                 -> rekey sheet PDF + ledger/rows JSON + EMS file set
  python -m collision_iq.cli verify   <mitchell.pdf> <ems_prefix> <outdir>    -> EMS verification PDF + JSON
  python -m collision_iq.cli review   <a> <b> <outdir> [--label-a X --label-b Y]
                                       a/b: a Mitchell PDF or an EMS prefix (path without extension)
  python -m collision_iq.cli ledger   <mitchell.pdf|ems_prefix>               -> ledger JSON to stdout
"""
from __future__ import annotations
import argparse, json, os, sys
from dataclasses import asdict
from .mitchell_ledger import parse_mitchell
from . import ems as E, reports
from .totals import Profile, expected_totals
from .ceg_ppages import validate_clear_coat, lost_costs
from .ems_verify import verify
from .crossplatform import review


def load(path: str):
    if path.lower().endswith(".pdf"):
        return parse_mitchell(path)
    S = E.read_ems(path)
    ok, msg = E.gate(S)
    if not ok:
        sys.exit(f"EMS gate failed: {msg}")
    return E.ems_to_ledger(S)


def _ro(led) -> str:
    return (led.claim_no or led.estimate_id or "estimate").replace("/", "_")


def cmd_rekey(a):
    led = parse_mitchell(a.mitchell_pdf)
    if not led.lines:
        sys.exit("no line items extracted — report suppressed (fail closed)")
    prof = Profile.from_ledger(led)
    exp = expected_totals(led, prof)
    cc = validate_clear_coat(led)
    lc = lost_costs(led)
    os.makedirs(a.outdir, exist_ok=True)
    stem = os.path.join(a.outdir, f"RO_{_ro(led)}")
    reports.rekey_sheet_pdf(stem + "_rekey_sheet.pdf", led, prof, exp, cc, lc)
    json.dump({"ledger": led.to_dict(), "profile": asdict(prof), "expected": exp, "clear_coat": cc,
               "lost_costs": [asdict(x) for x in lc]}, open(stem + "_ledger.json", "w"), indent=1, default=str)
    ems_prefix = os.path.join(stem + "_ems", _ro(led).replace("-", "")[:8])
    files = E.write_ems(led, ems_prefix, prof) if not a.no_ems else []
    print(f"rekey sheet: {stem}_rekey_sheet.pdf\nledger:      {stem}_ledger.json\nEMS files:   {len(files)} -> {ems_prefix}.*\n"
          f"expected gross {exp['gross']:.2f} vs Mitchell {led.totals.gross_total}  unexplained {round(exp['gross'] - (led.totals.gross_total or 0), 2)}\n"
          f"clear coat printed {cc['printed_hours']} recomputed {cc['hours']} -> {cc['status']}")


def cmd_verify(a):
    led = parse_mitchell(a.mitchell_pdf); prof = Profile.from_ledger(led)
    rep = verify(led, prof, a.ems_prefix)
    os.makedirs(a.outdir, exist_ok=True)
    stem = os.path.join(a.outdir, f"RO_{_ro(led)}_ems_verification")
    reports.verify_pdf(stem + ".pdf", rep, led)
    json.dump(rep.to_dict(), open(stem + ".json", "w"), indent=1, default=str)
    print(f"{rep.status}  {rep.gate}\n{json.dumps(rep.summary)}\nreport: {stem}.pdf")


def cmd_review(a):
    la, lb = load(a.a), load(a.b)
    rv = review(la, lb, a.label_a, a.label_b)
    os.makedirs(a.outdir, exist_ok=True)
    stem = os.path.join(a.outdir, f"RO_{_ro(la)}_crossplatform_review")
    reports.review_pdf(stem + ".pdf", rv)
    json.dump(rv.to_dict(), open(stem + ".json", "w"), indent=1, default=str)
    print(json.dumps(rv.summary, indent=1)); print(f"report: {stem}.pdf")


def cmd_ledger(a):
    print(json.dumps(load(a.path).to_dict(), indent=1, default=str))


def main(argv=None):
    p = argparse.ArgumentParser(prog="collision_iq"); sp = p.add_subparsers(dest="cmd", required=True)
    q = sp.add_parser("rekey"); q.add_argument("mitchell_pdf"); q.add_argument("outdir"); q.add_argument("--no-ems", action="store_true"); q.set_defaults(f=cmd_rekey)
    q = sp.add_parser("verify"); q.add_argument("mitchell_pdf"); q.add_argument("ems_prefix"); q.add_argument("outdir"); q.set_defaults(f=cmd_verify)
    q = sp.add_parser("review"); q.add_argument("a"); q.add_argument("b"); q.add_argument("outdir"); q.add_argument("--label-a"); q.add_argument("--label-b"); q.set_defaults(f=cmd_review)
    q = sp.add_parser("ledger"); q.add_argument("path"); q.set_defaults(f=cmd_ledger)
    a = p.parse_args(argv); a.f(a)


if __name__ == "__main__":
    main()
