"""Cross-platform estimate review (Mitchell <-> CCC) for repair-cost disputes.

Given two ledgers (either platform each), produce:
  profile      - rates / paint-materials / tax side by side
  pairs        - matched lines with labor hours by type on each side and the delta
                 (database differential: same operation, MOTOR time vs CEG time)
  unmatched    - lines present on one estimate only (carrier-only detection included)
  clear_coat   - aggregate comparison + guide validation on both sides (never line-by-line)
  lost_costs   - per estimate under its own guide, plus the BRIDGE:
                   * both_lost   : allowed by both guides, claimed by neither  -> strongest add
                   * one_sided   : claimed on one estimate, lost on the other -> supplement item
  differential - hours by labor type over matched pairs only (isolates database time differences
                 from scope differences)

No rule references a carrier, shop, make or RO.  Two estimates for the same VIN written on
different platforms with identical scope will show scope-neutral labor deltas in `differential`.
"""
from __future__ import annotations
from dataclasses import dataclass, field, asdict
from .mitchell_ledger import Ledger
from .matching import items_from_ledger, items_from_rows, match
from .rekey import build_rows
from .ceg_ppages import validate_clear_coat, lost_costs, PLATFORM_GUIDE, GUIDES


@dataclass
class Review:
    a_label: str
    b_label: str
    identity: dict = field(default_factory=dict)
    profile: list = field(default_factory=list)
    pairs: list = field(default_factory=list)
    unmatched_a: list = field(default_factory=list)
    unmatched_b: list = field(default_factory=list)
    clear_coat: dict = field(default_factory=dict)
    lost_costs: dict = field(default_factory=dict)
    differential: dict = field(default_factory=dict)
    parts_differential: dict = field(default_factory=dict)
    summary: dict = field(default_factory=dict)

    def to_dict(self): return asdict(self)


def _rate_rows(a: Ledger, b: Ledger) -> list[dict]:
    keys = sorted(set(a.totals.rates) | set(b.totals.rates), key=lambda k: {"Body": 0, "Refinish": 1, "Paint": 1, "Mechanical": 2}.get(k, 9))
    rows = []
    seen = set()
    for k in keys:
        kk = "Refinish" if k == "Paint" else k
        if kk in seen: continue
        seen.add(kk)
        ra = a.totals.rates.get(kk, a.totals.rates.get("Paint" if kk == "Refinish" else kk))
        rb = b.totals.rates.get(kk, b.totals.rates.get("Paint" if kk == "Refinish" else kk))
        if kk in [r["item"] for r in rows]: continue
        rows.append({"item": kk + " rate", "a": ra, "b": rb, "delta": None if ra is None or rb is None else round(rb - ra, 2)})
    rows.append({"item": "Paint materials rate", "a": a.totals.paint_rate, "b": b.totals.paint_rate,
                 "delta": None if a.totals.paint_rate is None or b.totals.paint_rate is None else round(b.totals.paint_rate - a.totals.paint_rate, 2)})
    rows.append({"item": "Tax rate", "a": a.totals.tax_rate, "b": b.totals.tax_rate, "delta": None})
    rows.append({"item": "Gross total", "a": a.totals.gross_total, "b": b.totals.gross_total,
                 "delta": None if a.totals.gross_total is None or b.totals.gross_total is None else round(b.totals.gross_total - a.totals.gross_total, 2)})
    return rows


def review(a: Ledger, b: Ledger, a_label: str | None = None, b_label: str | None = None) -> Review:
    rv = Review(a_label or a.platform, b_label or b.platform)
    rv.identity = {"vin_a": a.vin, "vin_b": b.vin, "same_vin": a.vin.strip().upper() == b.vin.strip().upper(),
                   "claim_a": a.claim_no, "claim_b": b.claim_no, "guide_a": PLATFORM_GUIDE[a.platform], "guide_b": PLATFORM_GUIDE[b.platform]}
    rv.profile = _rate_rows(a, b)

    def items(led):
        # Mitchell prints refinish as separate 'Refinish Only' lines; fold them onto their panel first
        if led.platform == "mitchell":
            rows, _ = build_rows(led)
            return items_from_rows([r.to_dict() for r in rows])
        return items_from_ledger(led)
    ia, ib = items(a), items(b)
    diff = {}
    for m in match(ia, ib, same_group_required=False):
        if m.how == "unmatched_a":
            rv.unmatched_a.append({"key": m.a.key, "group": m.a.group, "op": m.a.op_class, "desc": m.a.desc, "labor": m.a.labor, "price": m.a.price, "misc": m.a.misc_amt})
        elif m.how == "unmatched_b":
            rv.unmatched_b.append({"key": m.b.key, "group": m.b.group, "op": m.b.op_class, "desc": m.b.desc, "labor": m.b.labor, "price": m.b.price, "misc": m.b.misc_amt})
        else:
            codes = sorted(set(m.a.labor) | set(m.b.labor))
            lab = {c: {"a": m.a.labor.get(c, 0.0), "b": m.b.labor.get(c, 0.0), "delta": round(m.b.labor.get(c, 0.0) - m.a.labor.get(c, 0.0), 1)} for c in codes}
            for c, v in lab.items():
                d = diff.setdefault(c, {"a": 0.0, "b": 0.0, "pairs": 0, "pairs_differing": 0})
                d["a"] = round(d["a"] + v["a"], 1); d["b"] = round(d["b"] + v["b"], 1); d["pairs"] += 1
                if abs(v["delta"]) > 0.049: d["pairs_differing"] += 1
            rv.pairs.append({"a": m.a.key, "b": m.b.key, "how": m.how, "score": round(m.score, 2), "desc_a": m.a.desc, "desc_b": m.b.desc,
                             "op_a": m.a.op_class, "op_b": m.b.op_class, "labor": lab,
                             "price_a": m.a.price, "price_b": m.b.price,
                             "price_delta": None if m.a.price is None or m.b.price is None else round(m.b.price - m.a.price, 2)})
    for c, d in diff.items():
        d["delta"] = round(d["b"] - d["a"], 1)
    rv.differential = diff
    # parts price differential over pairs matched by part number (same OEM number, two databases)
    pp = [p for p in rv.pairs if p["how"] == "part_no" and p["price_a"] is not None and p["price_b"] is not None]
    rv.parts_differential = {"pairs": len(pp), "a": round(sum(p["price_a"] for p in pp), 2), "b": round(sum(p["price_b"] for p in pp), 2),
                             "delta": round(sum(p["price_b"] - p["price_a"] for p in pp), 2),
                             "pairs_differing": sum(1 for p in pp if abs(p["price_b"] - p["price_a"]) > 0.005)}

    # clear coat: aggregate rule
    ca, cb = validate_clear_coat(a), validate_clear_coat(b)
    rv.clear_coat = {"a": {k: ca[k] for k in ("guide", "hours", "printed_hours", "printed_lines", "status", "per_line")},
                     "b": {k: cb[k] for k in ("guide", "hours", "printed_hours", "printed_lines", "status", "per_line")},
                     "printed_delta": round(cb["printed_hours"] - ca["printed_hours"], 1),
                     "rule": "compared as section aggregate; per-line clear-coat adds are never matched line-by-line"}

    # lost costs and bridge
    la = {x.key: x for x in lost_costs(a)}
    lb = {x.key: x for x in lost_costs(b)}
    both_lost, one_sided = [], []
    for k in sorted(set(la) | set(lb)):
        sa, sb = la.get(k), lb.get(k)
        st_a, st_b = (sa.status if sa else "n/a"), (sb.status if sb else "n/a")
        if st_a == "lost" and st_b == "lost":
            both_lost.append({"key": k, "operation": sa.operation, "cite_a": sa.citation, "cite_b": sb.citation, "allowance": sa.allowance or sb.allowance})
        elif "lost" in (st_a, st_b) and "claimed" in (st_a, st_b):
            src = sa if st_a == "claimed" else sb
            tgt = sb if st_a == "claimed" else sa
            one_sided.append({"key": k, "operation": src.operation, "claimed_on": rv.a_label if st_a == "claimed" else rv.b_label,
                              "claimed_lines": src.claimed_by, "lost_on": rv.b_label if st_a == "claimed" else rv.a_label,
                              "cite_lost_side": tgt.citation, "allowance": tgt.allowance, "verified_rule": tgt.verified_rule})
    rv.lost_costs = {"a": [asdict(x) for x in la.values()], "b": [asdict(x) for x in lb.values()],
                     "bridge": {"both_lost": both_lost, "one_sided": one_sided}}
    rv.summary = {"pairs": len(rv.pairs), "unmatched_a": len(rv.unmatched_a), "unmatched_b": len(rv.unmatched_b),
                  "clear_coat_printed_delta": rv.clear_coat["printed_delta"],
                  "bridge_both_lost": len(both_lost), "bridge_one_sided": len(one_sided),
                  "parts_price_delta_same_partno": rv.parts_differential.get("delta"),
                  "gross_delta": rv.profile[-1]["delta"]}
    return rv
