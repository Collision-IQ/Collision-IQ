import pdfplumber, re, collections

ARTIFACTS = {"R8d":"R&I","D8iR":"D&R","8i":"&","Bind":"Blnd","AIIPurpose":"AllPurpose","Removai":"Removal","blfd":"b1fd"}
OPS = ["R&I","RPR","REPL","BLND","REFN","SUBL","O/H"]
SUFFIX = {"M","T","X","INCL.","INCL","m"}
ALIAS = [  # squashed-string alias groups (word-order/name variants), universal
    {"DENIBANDPOLISH","DENIBPOLISH","FINISHSANDPOLISH","SANDPOLISH","FINISHSANDPOLISHREFINISHPERPANEL","FINISHSANDPOLISH05REFINISHPERPANEL"},
    {"TINTCOLOR","COLORTINT"},
    {"PREREPAIRSCAN","PREREPAIRDIAGNOSTICSCANREPAIRFACILITY","PREREPAIRDIAGNOSTICSCAN"},
    {"POSTREPAIRSCAN","POSTREPAIRDIAGNOSTICSCANREPAIRFACILITY","POSTREPAIRDIAGNOSTICSCAN"},
    {"MASKJAMBS","MASKJAMBSHOURSANDPERPANEL","MASKJAMBS03HOURSAND300PERPANEL"},
    {"4WHEELALIGNMENT","PERFORMVEHICLEALIGNMENT"},
]
def repair(s):
    for k,v in ARTIFACTS.items(): s=s.replace(k,v)
    return s
def squash(s):
    s = repair(s).upper()
    s = re.sub(r'PT\d{8}[A-Z](\d{3})?','',s)
    s = re.sub(r'^\s*[#*]+\s*','',s)
    s = re.sub(r'^(R&I|RPR|REPL|BLND|REFN|SUBL|O/H)\b','',s).strip()
    s = re.sub(r'[0-9]+(\.[0-9]+)?','',s)
    s = re.sub(r'[^A-Z]','',s)
    s = s.replace('INCL','')
    for o in ("RI","RPR","REPL","BLND","REFN","SUBL","OH"):
        if s.startswith(o) and len(s)>len(o)+2: s=s[len(o):]; break
    STEMS = [("SANDPOLISH","SANDPOLISH"),("DENIB","SANDPOLISH"),
             ("TINT","COLORTINT"),
             ("MASKJAMB","MASKJAMBS"),
             ("PREREPAIR","PRESCAN"),("POSTREPAIR","POSTSCAN"),
             ("WHEELALIGNMENT","ALIGNMENT"),("PERFORMVEHICLEALIGNMENT","ALIGNMENT"),
             ("CAVITYWAX","CAVITYWAX"),("HAZARDOUSWASTE","HAZARDOUSWASTE"),("MASKINGTAPE","MASKINGTAPE")]
    for stem,canon in STEMS:
        if stem in s: return canon, ""
    side=""
    if s.startswith("RT"): side, s = "RT", s[2:]
    elif s.startswith("LT"): side, s = "LT", s[2:]
    return s, side

def header_cols(page):
    hdr={}
    for w in page.extract_words():
        if w['text'] in ("Qty","Extended","Labor","Paint") and w['top']<220:
            hdr[w['text']]=(w['x0'],w['x1'])
    return hdr if len(hdr)==4 else None

def parse(path):
    rows=[]
    with pdfplumber.open(path) as pdf:
        hdr=None
        for pno,page in enumerate(pdf.pages,1):
            h=header_cols(page)
            if h: hdr=h
            if not hdr: continue
            qx=(hdr['Qty'][0]-25,hdr['Qty'][1]+8); px=(hdr['Extended'][0]-22,hdr['Extended'][1]+16)
            lx=(hdr['Labor'][0]-24,hdr['Labor'][1]+18); tx=(hdr['Paint'][0]-24,hdr['Paint'][1]+18)
            allw=sorted(page.extract_words(), key=lambda w:(w['top'],w['x0']))
            clusters=[]
            for w in allw:
                if clusters and w['top']-clusters[-1][0] <= 3.5:
                    clusters[-1][1].append(w)
                else:
                    clusters.append([w['top'],[w]])
            cursec=None; prev=None
            for _,ws in clusters:
                ws.sort(key=lambda w:w['x0'])
                texts=[w['text'] for w in ws]; joined=' '.join(texts)
                rj=repair(joined)
                if rj.replace(' ','').replace(',','').replace('&','').isalpha() and rj==rj.upper() and len(rj)<40:
                    cursec=squash(rj)[0]; prev=None; continue
                if re.match(r'(?i)^note\b', rj) or ('Page' in rj and '/20' in rj) or 'SUBTOTALS' in rj: 
                    prev=None; continue
                is_line = re.match(r'^\d{1,3}$',texts[0]) and (len(texts)>1)
                lineno = int(texts[0]) if is_line else None
                if is_line and prev is not None and lineno <= prev['line']:
                    is_line = False                      # wrapped text starting with a number
                if not is_line:
                    if prev is not None and not re.match(r'(?i)^note\b', rj):
                        prev['rawdesc'] += ' '+rj        # continuation
                    continue
                row=dict(page=pno,line=int(texts[0]),section=cursec,qty=None,price=None,
                         labor=None,paint=None,part=None,desc=[])
                nums=[]
                for w in ws[1:]:
                    t=w['text']; mid=(w['x0']+w['x1'])/2
                    rt=repair(t)
                    pm=re.search(r'PT\d{8}[A-Z](\d{3})?',rt)
                    if pm:
                        base=pm.group(0)
                        if pm.group(1) is None:
                            base=re.match(r'PT\d{8}[A-Z]',base).group(0)
                        row['part']=base
                        rest=rt[pm.end():]
                        if re.match(r'^-?[\d,]+\.?\d*$',rest):   # glued qty/price after part
                            v=float(rest.replace(',','')); mid2=w['x1']
                            row['qty']=row['qty'] if row['qty'] is not None else (v if v<10 else row['qty'])
                        continue
                    if re.match(r'^-?[\d,]+\.?\d*$',t):
                        v=float(t.replace(',',''))
                        if qx[0]<=mid<=qx[1]: row['qty']=v
                        elif px[0]<=mid<=px[1]: row['price']=v
                        elif lx[0]<=mid<=lx[1]: row['labor']=v
                        elif tx[0]<=mid<=tx[1]: row['paint']=v
                        else: row['desc'].append(t)
                    elif t.upper() in SUFFIX: pass
                    else: row['desc'].append(rt)
                row['rawdesc']=re.split(r'(?i)\bnote\b', ' '.join(row['desc']))[0].strip()
                if not row['rawdesc']: continue
                if all(v is None for v in (row['qty'],row['price'],row['labor'],row['paint'])) \
                   and row['part'] is None and row['rawdesc']==row['rawdesc'].upper() \
                   and not re.search(r'[a-z]', row['rawdesc']):
                    cursec=squash(row['rawdesc'])[0]; prev=None; continue   # numbered section header
                row['key'],row['side']=squash(row['rawdesc'])
                if not row['key']: continue
                rows.append(row); prev=row
    for r in rows: r['key'],_s = squash(r['rawdesc']); r['side']=r['side'] or _s
    return rows

def run():
    shop=parse('/home/claude/t2/Shop 22047.pdf'); usaa=parse('/home/claude/t2/USAA EOR 22047.pdf')
    usaa=[u for u in usaa if not u['rawdesc'].startswith('#') or u['line']>7 or u['price'] or u['labor'] or u['paint'] or True]
    used=set(); pairs=[]
    upart={}
    for i,u in enumerate(usaa):
        if u['part']: upart.setdefault(u['part'],[]).append(i)
    for s in shop:
        s['paired']=None
        if s['part']:
            for i in upart.get(s['part'],[]):
                if i not in used: used.add(i); s['paired']=i; break
    bykey=collections.defaultdict(list)
    for i,u in enumerate(usaa): bykey[u['key']].append(i)
    scount=collections.Counter(s['key'] for s in shop if s['paired'] is None)
    ucount=collections.Counter(u['key'] for i,u in enumerate(usaa) if i not in used)
    agg_keys={k for k in scount if k in ucount and scount[k]>ucount[k]}
    for s in shop:
        if s['paired'] is not None: continue
        if s['key'] in agg_keys: continue
        cands=[i for i in bykey.get(s['key'],[]) if i not in used]
        cands.sort(key=lambda i:(usaa[i]['section']!=s['section'], usaa[i]['side']!=s['side']))
        if cands: used.add(cands[0]); s['paired']=cands[0]
    for s in shop:
        if s['paired'] is not None or s['key'] in agg_keys: continue
        for i,u in enumerate(usaa):
            if i in used: continue
            a,b=s['key'],u['key']
            if len(a)>=12 and len(b)>=12 and (a.startswith(b) or b.startswith(a)):
                used.add(i); s['paired']=i; break
    findings=[]
    for s in shop:
        if s['paired'] is None:
            findings.append(('MISSED',s,None,[])); continue
        u=usaa[s['paired']]; d=[]
        for f in ('price','labor','paint'):
            a,b=s[f] or 0,u[f] or 0
            if abs(a-b)>0.001: d.append((f.upper(),a,b))
        if s['part'] and u['part'] and s['part']!=u['part']: d.append(('PART#',s['part'],u['part']))
        if d: findings.append(('DELTA',s,u,d))
    # aggregation pass: same-key leftovers on both sides -> one summed delta
    left_s=collections.defaultdict(list); left_u=collections.defaultdict(list)
    for s in shop:
        if s['paired'] is None: left_s[s['key']].append(s)
    for i,u in enumerate(usaa):
        if i not in used: left_u[u['key']].append((i,u))
    resolved=set()
    for key,ss in left_s.items():
        if key in left_u:
            us=[u for _,u in left_u[key]]
            for i,_ in left_u[key]: used.add(i)
            tot=lambda rows,f: sum(r[f] or 0 for r in rows)
            d=[]
            for f in ('price','labor','paint'):
                a,b=tot(ss,f),tot(us,f)
                if abs(a-b)>0.001: d.append((f.upper()+'*',a,b))
            findings[:] = [x for x in findings if not (x[0]=='MISSED' and x[1] in ss)]
            if d: findings.append(('AGG',ss[0],us[0],d))
    lower_only=[u for i,u in enumerate(usaa) if i not in used]
    return shop,usaa,findings,lower_only

shop,usaa,findings,lower_only=run()
fmap={}
for kind,s,u,d in findings: fmap.setdefault(s['line'],(kind,d))
def has(line,kind=None,field=None,a=None,b=None):
    if line not in fmap: return False
    k,d=fmap[line]
    if kind and k!=kind: return False
    if field:
        for f,x,y in d:
            if f==field and (a is None or abs(x-a)<0.01) and (b is None or abs(y-b)<0.01): return True
        return False
    return True

guards=[
 # MUST NOT flag (were false positives in 8dc93aaccf)
 ("no-FP upper panel RT", not has(47)), ("no-FP upper panel LT", not has(48)),
 ("no-FP battery RT", not has(6)),      ("no-FP battery LT", not has(7)),
 ("no-FP applique pillar RT (0.5=0.5)", not has(22)), ("no-FP applique pillar LT", not has(23)),
 ("no-FP applique glass RT (0.2=0.2)", not has(27)),  ("no-FP applique glass LT", not has(28)),
 ("no-FP tint (0.5=0.5)", not has(105)),
 ("no-FP tailgate clearcoat (1.3=1.3)", not has(60)),
 ("no-FP outer bracket LT", not has(42)), ("no-FP support bracket LT", not has(46)),
 ("no-FP side trim panel RT", not has(49)), ("no-FP lower molding LT", not has(44)),
 ("no-FP nameplate RIVIAN", not has(63)), ("no-FP flatliner (6.0=6.0)", not has(58)),
 ("no-FP buff light bar", not has(70)), ("no-FP TruPoint", not has(88)),
 # MUST flag with correct typed cell
 ("side panel RT paint 2.6->1.3", has(31,'DELTA','PAINT',2.6,1.3)),
 ("side panel LT paint 2.6->1.3", has(32,'DELTA','PAINT',2.6,1.3)),
 ("roof rail RT paint 2.0->1.0", has(16,'DELTA','PAINT',2.0,1.0)),
 ("roof rail LT paint 2.0->1.0", has(17,'DELTA','PAINT',2.0,1.0)),
 ("roof molding RT labor 1.0->0.5", has(18,'DELTA','LABOR',1.0,0.5)),
 ("roof molding LT labor 1.0->0.5", has(19,'DELTA','LABOR',1.0,0.5)),
 ("back glass labor 1.0->0.5", has(26,'DELTA','LABOR',1.0,0.5)),
 ("pre scan 1.0->0.5", has(84,'DELTA','LABOR',1.0,0.5)),
 ("post scan 1.0->0.5", has(93,'DELTA','LABOR',1.0,0.5)),
 ("side bracket RT price", has(76,'DELTA','PRICE',99.0,96.22)),
 ("side bracket LT price", has(77,'DELTA','PRICE',99.0,96.22)),
 ("bumper cover part# change", has(75,'DELTA','PART#')),
 ("tailgate mldg part# change", has(61,'DELTA','PART#')),
 ("mask jambs labor 1.5->0.3", has(104,'DELTA','LABOR',1.5,0.3)),
 ("sand&polish 2.5 -> denib 1.5", has(106,'DELTA')),
 ("maintain HV price 5->0", has(108,'DELTA','PRICE',5.0,0.0)),
 ("tape aggregated 42.48->20", any(k=='AGG' and 'Tape' in s['rawdesc'] and any(f=='PRICE*' and abs(a-42.48)<0.01 and abs(b-20.0)<0.01 for f,a,b in d) for k,s,u,d in findings)),
 ("cavity wax price clean (15.40=15.40)", not any(s['line']==65 and any(f.startswith('PRICE') for f,_,_ in d) for k,s,u,d in findings) ),
 # MUST be MISSED
 ("in-proc scan MISSED", has(85,'MISSED')), ("DTC research MISSED", has(97,'MISSED')),
 ("road test MISSED", has(98,'MISSED')), ("ADAS research MISSED", has(99,'MISSED')),
 ("procedure research MISSED", has(2,'MISSED')), ("torque MISSED", has(14,'MISSED')),
 ("test fit tailgate MISSED", has(66,'MISSED')), ("test fit bumper MISSED", has(82,'MISSED')),
 ("pre-wash MISSED", has(101,'MISSED')), ("mask refinish MISSED", has(103,'MISSED')),
 ("clean delivery MISSED", has(107,'MISSED')), ("solid waste MISSED", has(110,'MISSED')),
]
passed=sum(1 for _,ok in guards if ok)
print(f"GUARDS: {passed}/{len(guards)} passed\n")
for name,ok in guards:
    if not ok: print("  FAIL:",name)
print("\nAll findings:")
for kind,s,u,d in findings:
    if kind=='MISSED': print(f"  MISSED L{s['line']:>3} {s['rawdesc'][:44]}")
    else:
        for f,a,b in d: print(f"  DELTA  L{s['line']:>3} {s['rawdesc'][:38]:40s} {f}: {a} -> {b}")
print(f"\nLOWER-ONLY ({len(lower_only)}):", [f"L{u['line']}" for u in lower_only])
