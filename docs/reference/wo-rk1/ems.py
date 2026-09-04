"""CIECA EMS 2.01 reader / writer and CCC-EMS -> Ledger adapter.

Reader:  read_ems(prefix)  -> EmsSet   (prefix = path without extension, e.g. '.../ab7f6e93')
         ems_to_ledger(EmsSet) -> Ledger(platform='ccc')
Writer:  write_ems(ledger, out_prefix, profile) -> list of written paths

The 14 dBase tables are self-describing; the reader trusts the file header, never fixed offsets.
The writer uses the captured schema in ems_schema.py so it needs no template files at runtime.

This is an OPEN STANDARD interchange file.  It is not an AWF and makes no attempt to imitate one.
"""
from __future__ import annotations
import struct, os, hashlib, datetime as dt
from dataclasses import dataclass, field
from .ems_schema import SCHEMA
from .mitchell_ledger import Ledger, Line, Labor, Totals
from .vocab import LABOR_TYPE_INV, LABOR_TYPE, OPERATION, PART_TYPE
from . import totals as T

LBR_OP_LABEL = {"OP0": "#", "OP2": "R&I", "OP4": "Algn", "OP5": "O/H", "OP6": "Refn", "OP9": "Rpr", "OP11": "Repl", "OP13": "Refn", "OP15": "Blnd", "OP16": "Subl"}
PLATFORM_BY_EST_SYSTEM = {"C": "ccc", "M": "mitchell", "A": "audatex"}


# --------------------------------------------------------------------------- dBase primitives
@dataclass
class Table:
    name: str
    fields: list            # [(name, type, len, dec)]
    records: list = field(default_factory=list)   # list[dict]


def _decode(val: bytes, typ: str, dec: int):
    s = val.decode("latin1").strip()
    if typ == "N":
        if not s: return 0.0 if dec else 0
        try:
            return float(s) if dec else int(float(s))
        except ValueError:
            return 0
    if typ == "L":
        return s.upper() in ("T", "Y")
    if typ == "D":
        return s
    return s


def read_table(path: str) -> Table:
    with open(path, "rb") as f:
        hdr = f.read(32)
        nrec, hlen, rlen = struct.unpack("<IHH", hdr[4:12])
        fields, pos = [], 32
        while True:
            f.seek(pos); fd = f.read(32)
            if not fd or fd[0] == 0x0D: break
            fields.append((fd[:11].split(b"\0")[0].decode(), chr(fd[11]), fd[16], fd[17])); pos += 32
        f.seek(hlen)
        recs = []
        for _ in range(nrec):
            raw = f.read(rlen)
            if len(raw) < rlen: break
            if raw[0:1] == b"*": continue          # deleted
            d, o = {}, 1
            for n, t, l, dec in fields:
                d[n] = _decode(raw[o:o + l], t, dec); o += l
            recs.append(d)
    return Table(os.path.splitext(path)[1].lstrip(".").lower(), fields, recs)


def _encode(v, typ: str, ln: int, dec: int) -> bytes:
    if typ == "N":
        if v is None or v == "": s = ""
        else:
            s = f"{float(v):.{dec}f}" if dec else str(int(round(float(v))))
        return s.rjust(ln)[:ln].encode("latin1")
    if typ == "L":
        return (b"T" if v else b"F")
    if typ == "D":
        s = v.strftime("%Y%m%d") if isinstance(v, (dt.date, dt.datetime)) else (str(v) if v else "")
        return s.ljust(ln)[:ln].encode("latin1")
    if typ == "M":
        return b" " * ln
    return str(v if v is not None else "").ljust(ln)[:ln].encode("latin1", "replace")


def write_table(path: str, fields: list, records: list[dict], has_memo=False):
    rlen = 1 + sum(f[2] for f in fields)
    hlen = 32 + 32 * len(fields) + 1
    today = dt.date.today()
    hdr = bytearray(32)
    hdr[0] = 0x83 if has_memo else 0x03
    hdr[1], hdr[2], hdr[3] = today.year - 1900, today.month, today.day
    struct.pack_into("<IHH", hdr, 4, len(records), hlen, rlen)
    with open(path, "wb") as f:
        f.write(hdr)
        for n, t, l, dec in fields:
            fd = bytearray(32)
            fd[:11] = n.encode().ljust(11, b"\0")
            fd[11] = ord(t); fd[16] = l; fd[17] = dec
            f.write(fd)
        f.write(b"\x0D")
        for r in records:
            f.write(b" ")
            for n, t, l, dec in fields:
                f.write(_encode(r.get(n), t, l, dec))
        f.write(b"\x1A")


# --------------------------------------------------------------------------- read set
@dataclass
class EmsSet:
    prefix: str
    tables: dict = field(default_factory=dict)

    def __getitem__(self, k): return self.tables[k].records

    def has(self, k): return k in self.tables and bool(self.tables[k].records)


def read_ems(prefix: str) -> EmsSet:
    s = EmsSet(prefix)
    d = os.path.dirname(prefix) or "."
    base = os.path.basename(prefix).lower()
    for fn in os.listdir(d):
        stem, ext = os.path.splitext(fn)
        ext = ext.lstrip(".").lower()
        # Mitchell names the admin/vehicle tables with a one-letter suffix (9508501A.AD1, 9508501V.VEH)
        if (stem.lower() == base or (stem[:-1].lower() == base and stem[-1].isalpha())) and ext in SCHEMA:
            s.tables[ext] = read_table(os.path.join(d, fn))
    return s


def gate(ems: EmsSet) -> tuple[bool, str]:
    """Fail closed: no report unless the set identifies itself and has line records."""
    if not ems.has("env"): return False, "env table missing"
    env = ems["env"][0]
    if not env.get("EMS_VER"): return False, "EMS_VER blank"
    if not ems.has("lin"): return False, "lin table missing or empty"
    return True, f"EST_SYSTEM={env.get('EST_SYSTEM')} SW={env.get('SW_VERSION')} EMS={env.get('EMS_VER')} lines={len(ems['lin'])}"


def ems_to_ledger(ems: EmsSet) -> Ledger:
    """CCC EMS -> Ledger.  Multi-record lines (LAB + LAR) collapse to one Line with labor[]."""
    veh = ems["veh"][0] if ems.has("veh") else {}
    ad1 = ems["ad1"][0] if ems.has("ad1") else {}
    env = ems["env"][0] if ems.has("env") else {}
    led = Ledger(platform=PLATFORM_BY_EST_SYSTEM.get((env.get("EST_SYSTEM") or "C").strip(), "ccc"), source_file=ems.prefix)
    led.vin = veh.get("V_VIN", "")
    led.claim_no = ad1.get("CLM_NO", "")
    led.estimate_id = env.get("ESTFILE_ID", "")
    led.supplement_no = env.get("SUPP_NO", "")
    led.vehicle = f"{veh.get('V_MODEL_YR','')} {veh.get('V_MAKEDESC') or veh.get('V_MAKECODE','')} {veh.get('V_MODEL','')}".strip()
    section = ""
    by_no: dict[int, Line] = {}
    for r in ems["lin"]:
        no = int(r["LINE_NO"])
        is_header = (not r["LBR_OP"] and not r["PART_TYPE"] and not r["MOD_LBR_TY"]
                     and not r["ACT_PRICE"] and not r["MISC_AMT"] and r["LINE_DESC"].isupper())
        if is_header:
            section = r["LINE_DESC"].strip()
            continue
        L = by_no.get(no)
        if L is None:
            L = Line(line_no=no, supp_tag=None, item_no=r.get("DB_REF", "") or ("MANUAL" if r["LBR_OP"] == "OP0" else ""),
                     section=section, description=r["LINE_DESC"].strip(),
                     operation=LBR_OP_LABEL.get(r["LBR_OP"].strip(), r["LBR_OP"].strip()))
            L.part_type = r["PART_TYPE"].strip()
            if L.part_type == "PAE": L.part_type = ""          # Mitchell EMS: 'existing' = no part
            L.part_no = r["OEM_PARTNO"].strip(); L.part_no_src = L.part_no
            L.qty = int(r["PART_QTY"]) if r["PART_QTY"] else None
            price = float(r["ACT_PRICE"] or 0)
            L.price = price if price else None
            L.price_judgment = bool(r["PRICE_J"])
            L.taxable = bool(r["TAX_PART"])
            L.misc_amt = float(r["MISC_AMT"] or 0) or None
            if r.get("PART_DESCJ") or r.get("PART_DES_J"): L.item_no = "MANUAL"
            if r.get("DB_REF", "").strip() == "900501": L.is_note = True
            L.misc_sublet = bool(r["MISC_SUBLT"])
            L.misc_tax = bool(r["MISC_TAX"])
            by_no[no] = L
            led.lines.append(L)
        if r["MOD_LBR_TY"]:
            ltype = LABOR_TYPE_INV.get(r["MOD_LBR_TY"].strip(), r["MOD_LBR_TY"].strip())
            L.labor.append(Labor(type=ltype, hrs=float(r["MOD_LB_HRS"] or 0), inc=bool(r["LBR_INC"]),
                                 judgment=bool(r["LBR_HRS_J"]), clear_coat_calc=False))
    # totals
    tot = led.totals
    if ems.has("pfl"):
        for r in ems["pfl"]:
            lt = LABOR_TYPE_INV.get(r["LBR_TYPE"].strip())
            if lt: tot.rates[lt] = float(r["LBR_RATE"])
    if ems.has("stl"):
        for r in ems["stl"]:
            cd = r["TTL_TYPECD"].strip()
            lt = LABOR_TYPE_INV.get(cd)
            hrs = float(r["TTL_HRS"] or r["T_HRS"] or 0)
            amt = float(r["TTL_AMT"] or r["T_AMT"] or 0)
            if lt and (hrs or amt):
                tot.units[lt] = hrs; tot.labor_amount[lt] = amt
                if r.get("T_ADDLBR"): tot.sublet[lt] = float(r["T_ADDLBR"])     # Mitchell: sublet/add'l booked per labor type
            if cd == "PAT": tot.parts_taxable = float(r["T_AMT"])
            if cd == "MAT": tot.paint_materials = float(r["T_AMT"]); tot.paint_units = float(r["TTL_HRS"] or r["T_HRS"] or 0)
            if cd == "PAS": tot.sublet["ALL"] = float(r["TTL_AMT"] or r["T_AMT"] or 0)
    if ems.has("pfm"):
        for r in ems["pfm"]:
            if r["MATL_TYPE"].strip() == "MAPA":
                tot.paint_rate = float(r["CAL_LBRRTE"] or r["CAL_PRETHR"] or 0)     # CCC: CAL_LBRRTE; Mitchell: hr-rate-with-threshold
                if r.get("CAL_THRAMT") and float(r["CAL_THRAMT"]) < 1000: tot.paint_rate_max_units = float(r["CAL_THRAMT"])
    if ems.has("pft") and ems["pft"][0].get("TY1_RATE1"):
        tot.tax_rate = float(ems["pft"][0]["TY1_RATE1"]) / 100.0
    elif ems.has("pfl") and ems["pfl"][0].get("LBR_TAXP"):
        tot.tax_rate = float(ems["pfl"][0]["LBR_TAXP"]) / 100.0
    if ems.has("ttl"):
        t = ems["ttl"][0]
        tot.gross_total = float(t["G_TTL_AMT"]); tot.tax_total = float(t["G_TAX"])
        tot.deductible = str(t["G_DED_AMT"])
    return led


# --------------------------------------------------------------------------- write set
def _blank(fields) -> dict:
    return {n: (0 if t == "N" else False if t == "L" else "") for n, t, l, d in fields}


def _tax_block(prefix: str, rate_pct: float) -> dict:
    d = {}
    for i, ty in enumerate(("LS", "TL", "MP", "CT", "O1"), start=1):
        d[f"{prefix}_TX_TY{i}"] = ty
        d[f"{prefix}_TX_IN{i}"] = "Y" if i == 1 else "N"
    return d


def write_ems(ledger: Ledger, out_prefix: str, profile: T.Profile, shop: dict | None = None,
              source_system: str = "M") -> list[str]:
    """Write the 14 dBase tables + memo stub for `ledger` using `profile` (rates / tax / materials).

    source_system: CIECA EST_SYSTEM code of the platform the estimate was WRITTEN in
                   ('M' Mitchell, 'C' CCC, 'A' Audatex).  SW_VERSION identifies this generator.
    shop: optional dict of ad2 repair-facility fields (RF_CO_NM, RF_ADDR1, ...) to stamp.
    """
    exp = T.expected_totals(ledger, profile)
    uid = hashlib.sha1(f"{ledger.claim_no}|{ledger.estimate_id}|{ledger.supplement_no}".encode()).hexdigest()[:8]
    now = dt.datetime.now()
    rate_pct = profile.tax_rate * 100
    out: dict[str, list[dict]] = {}

    # env
    r = _blank(SCHEMA["env"])
    r.update(EST_SYSTEM=source_system, SW_VERSION="CIQ-RK1", DB_VERSION="", UNQFILE_ID=uid, RO_ID=uid,
             ESTFILE_ID=ledger.estimate_id[:38], SUPP_NO=(ledger.supplement_no or "E01")[:3], EST_CTRY="USA",
             TRANS_TYPE="E", STATUS=False, CREATE_DT=now, CREATE_TM=now.strftime("%H%M%S"),
             INCL_ADMIN=True, INCL_VEH=True, INCL_EST=True, INCL_PROFL=True, INCL_TOTAL=True, INCL_VENDR=True, EMS_VER="2.01")
    out["env"] = [r]

    # veh
    r = _blank(SCHEMA["veh"])
    yr = ledger.vehicle[:4] if ledger.vehicle[:4].isdigit() else ""
    make = ledger.vehicle.split(" ")[1] if yr and len(ledger.vehicle.split(" ")) > 1 else ""
    model = " ".join(ledger.vehicle.split(" ")[2:]) if yr else ledger.vehicle
    r.update(V_VIN=ledger.vin, V_MODEL_YR=yr[-2:], V_MAKECODE=make.upper()[:12], V_MAKEDESC=make[:20], V_MODEL=model[:50])
    out["veh"] = [r]

    # ad1 / ad2
    r = _blank(SCHEMA["ad1"]); r.update(CLM_NO=ledger.claim_no[:30], CLM_CTRY="USA", DED_STATUS="Y" if (ledger.totals.deductible or "").lower().startswith("waiv") else "", CUST_PR="O")
    out["ad1"] = [r]
    r = _blank(SCHEMA["ad2"]); r.update(shop or {}); out["ad2"] = [r]

    # profile tables
    pfl = []
    for code, desc in (("LAB", "Body"), ("LAR", "Paint"), ("LAM", "Mechanical"), ("LAS", "Structural"), ("LAF", "Frame"),
                       ("LAD", "Diagnostic"), ("LAE", "Electrical"), ("LAG", "Glass"), ("LA1", ""), ("LA2", ""), ("LA3", ""), ("LA4", ""), ("LAU", "")):
        rr = _blank(SCHEMA["pfl"]); rr.update(LBR_TYPE=code, LBR_DESC=desc, LBR_RATE=profile.rates.get(code, 0.0),
                                              LBR_TAX_IN=True, LBR_TAXP=rate_pct, LBR_ADJP=0); rr.update(_tax_block("LBR", rate_pct)); pfl.append(rr)
    out["pfl"] = pfl
    pfp = []
    for code in ("PAT", "PAN", "PAL", "PAA", "PAR", "PAC", "PAG", "PAO", "PAS", "PAP"):
        rr = _blank(SCHEMA["pfp"]); rr.update(PRT_TYPE=code, PRT_TAX_IN=True, PRT_TAX_RT=rate_pct, PRT_MKUPP=profile.lkq_markup_pct if code == "PAL" else 0.0)
        rr.update(_tax_block("PRT", rate_pct)); pfp.append(rr)
    out["pfp"] = pfp
    pfm = []
    for code, desc, rate, cap in (("MASH", "Shop", 0.0, 999999.99), ("MAPA", "Paint", profile.paint_rate, profile.paint_cap_dollars)):
        rr = _blank(SCHEMA["pfm"]); rr.update(MATL_TYPE=code, CAL_CODE="4", CAL_DESC=desc, CAL_MAXDLR=cap, CAL_LBRRTE=rate,
                                              CAL_OPCODE="OP6 OP15" if code == "MAPA" else "OP9", TAX_IND=True, MAT_TAXP=rate_pct); rr.update(_tax_block("MAT", rate_pct)); pfm.append(rr)
    out["pfm"] = pfm
    r = _blank(SCHEMA["pfh"]); r.update(TAX_PRETHR=rate_pct, TAX_THRAMT=999999.99, TAX_PSTTHR=rate_pct, TAX_BTR_IN=True, TAX_LBR_RT=rate_pct, ADJ_BTR_IN=True); out["pfh"] = [r]
    r = _blank(SCHEMA["pft"])
    for i, ty in enumerate(("LS", "TL", "MP", "CT", "O1", "O2"), start=1):
        r[f"TAX_TYPE{i}"] = ty; r[f"TY{i}_TIER1"] = 1; r[f"TY{i}_THRES1"] = 9999.99; r[f"TY{i}_RATE1"] = rate_pct if i == 1 else 0
    out["pft"] = [r]
    r = _blank(SCHEMA["pfo"]); r.update(TX_TOW_TY="OTTW", TX_STOR_TY="OTST")
    for i, ty in enumerate(("LS", "TL", "MP", "CT", "O1", "O2"), start=1):
        r[f"TOW_T_TY{i}"] = ty; r[f"TOW_T_IN{i}"] = "N"; r[f"STOR_T_TY{i}"] = ty; r[f"STOR_T_IN{i}"] = "N"
    out["pfo"] = [r]

    # lin  (one record per labor entry; section headers as description-only records, CCC style)
    lin, seq, cur_sec = [], 0, None
    for row in exp["rows"]:
        if row["group"] != cur_sec:
            cur_sec = row["group"]; seq += 1
            rr = _blank(SCHEMA["lin"]); rr.update(LINE_NO=seq, LINE_IND="E01", TRAN_CODE="1", UNQ_SEQ=seq, WHO_PAYS="CP", LINE_DESC=cur_sec[:40])
            lin.append(rr)
        seq += 1
        labor = row["labor"] or [None]
        for i, lab in enumerate(labor):
            rr = _blank(SCHEMA["lin"])
            rr.update(LINE_NO=seq, LINE_IND="E01", TRAN_CODE="1", UNQ_SEQ=seq, WHO_PAYS="CP", LINE_DESC=row["desc_ccc"][:40],
                      LBR_OP=row["lbr_op"], LBR_TAX=True, PAINT_STG=0, PAINT_TONE=0)
            if i == 0:
                rr.update(PART_TYPE=row["part_type_ems"], OEM_PARTNO=row["part_no"][:25], PART_QTY=row["qty"] or 0,
                          DB_PRICE=row["price"] or 0, ACT_PRICE=row["price"] or 0, TAX_PART=row["tax"], PRICE_J=row["price_judgment"],
                          MISC_AMT=row["misc_amt"] or 0, MISC_SUBLT=bool(row["misc_amt"] and row["misc_sublet"]), MISC_TAX=bool(row["misc_amt"] and row["tax"]),
                          CERT_PART=(row["part_type_ems"] == "PAC"), ALT_PART_I=(row["lbr_op"] == "OP0"))
            if lab:
                rr.update(MOD_LBR_TY=lab["ems"], MOD_LB_HRS=lab["hrs"], DB_HRS=lab["hrs"], LBR_INC=lab["inc"], LBR_HRS_J=lab["judgment"],
                          LBR_AMT=round(lab["hrs"] * profile.rates.get(lab["ems"], 0.0), 2), PAINT_STG=2 if lab["ems"] == "LAR" else 0)
            lin.append(rr)
    out["lin"] = lin

    # stl / ttl
    stl = []
    def srow(ttype, code, amt=0.0, hrs=0.0, tax=0.0):
        rr = _blank(SCHEMA["stl"]); rr.update(TTL_TYPE=ttype, TTL_TYPECD=code, T_AMT=amt, T_HRS=hrs, TAX_AMT=tax, TTL_TYPAMT=tax, TTL_HRS=hrs, TTL_AMT=amt); return rr
    lt = exp["labor"]
    stl.append(srow("LA", "LAT", lt["total_amt"], lt["total_hrs"], lt["total_tax"]))
    for code in ("LAB", "LAR", "LAS", "LAF", "LAD", "LAE", "LAM", "LAG", "LA1", "LA2", "LA3", "LA4", "LAU"):
        b = lt["by_type"].get(code, {"hrs": 0, "amt": 0, "tax": 0}); stl.append(srow("LA", code, b["amt"], b["hrs"], b["tax"]))
    pt = exp["parts"]
    stl.append(srow("PA", "PAT", pt["total_amt"], 0, pt["total_tax"]))
    for code in ("PAN", "PAL", "PAA", "PAR", "PAC", "PAG", "PAO", "PAS", "PAP"):
        b = pt["by_type"].get(code, {"amt": 0, "tax": 0})
        if code == "PAS":
            sub = pt["by_type"].get("SUBLET", {"amt": 0, "tax": 0}); b = {"amt": b["amt"] + sub["amt"], "tax": b["tax"] + sub["tax"]}
        stl.append(srow("PA", code, b["amt"], 0, b["tax"]))
    m = exp["materials"]
    stl.append(srow("TOT", "MAPA", m["paint_amt"], m["paint_hrs"], m["paint_tax"]))
    stl.append(srow("TOT", "MASH")); stl.append(srow("TOT", "MAHW")); stl.append(srow("TOT", "MA2S")); stl.append(srow("TOT", "MA3S"))
    stl.append(srow("TOT", "MA2T")); stl.append(srow("TOT", "MABL"))
    stl.append(srow("TOT", "MAT", m["paint_amt"], m["paint_hrs"], m["paint_tax"]))
    for code in ("OTST", "OTTW"): rr = _blank(SCHEMA["stl"]); rr.update(TTL_TYPE=code); stl.append(rr)
    rr = _blank(SCHEMA["stl"]); rr.update(TTL_TYPE="OTAC", T_AMT=exp["other_costs"], TAX_AMT=exp["other_costs_tax"], TTL_TYPAMT=exp["other_costs_tax"], TTL_AMT=exp["other_costs"]); stl.append(rr)
    for code in ("OTAA", "OTBE"): rr = _blank(SCHEMA["stl"]); rr.update(TTL_TYPE=code); stl.append(rr)
    rr = _blank(SCHEMA["stl"]); rr.update(TTL_TYPE="UPD", TTL_AMT=exp["gross"]); stl.append(rr)
    out["stl"] = stl
    r = _blank(SCHEMA["ttl"]); r.update(G_TTL_AMT=exp["gross"], N_TTL_AMT=exp["gross"], G_TAX=exp["tax"], G_UPD_AMT=exp["gross"], GST_AMT=0.0); out["ttl"] = [r]

    # ven
    ven = []
    for name in sorted({v for v in ledger.vendors.values() if v}):
        rr = _blank(SCHEMA["ven"]); rr.update(VND_CO_NM=name[:35]); ven.append(rr)
    out["ven"] = ven or [_blank(SCHEMA["ven"])]

    written = []
    os.makedirs(os.path.dirname(out_prefix) or ".", exist_ok=True)
    for ext, recs in out.items():
        p = f"{out_prefix}.{ext}"
        write_table(p, SCHEMA[ext], recs, has_memo=(ext == "veh"))
        written.append(p)
    # memo stub for veh
    dbt = bytearray(512); struct.pack_into("<I", dbt, 0, 1); dbt[8:16] = os.path.basename(out_prefix)[:8].encode().ljust(8, b"\0"); dbt[20] = 0x02
    with open(f"{out_prefix}.dbt", "wb") as f: f.write(dbt)
    written.append(f"{out_prefix}.dbt")
    return written
