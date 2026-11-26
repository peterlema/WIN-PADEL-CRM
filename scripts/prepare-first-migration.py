"""Read-only, deterministic preview. Real files/output must stay outside git.

Usage: python3 scripts/prepare-first-migration.py RAW_WORKBOOKS_JSON EXISTING_JSON OUTPUT_JSON
RAW_WORKBOOKS_JSON preserves original cell values, coordinates and file SHA256.
No financial sections, demo rows, users or credentials are imported.
"""
import collections
import hashlib
import json
import re
import sys
import unicodedata


def key(s):
    return ' '.join(re.findall(r'[a-z]+', unicodedata.normalize('NFKD', str(s)).encode('ascii', 'ignore').decode().lower()))


def phone(value):
    n = re.sub(r'\D', '', str(value or ''))
    if n.startswith('00'): n = n[2:]
    if n.startswith('01115') and len(n) == 13: n = '11' + n[5:]
    if len(n) == 11 and n.startswith('0'): n = n[1:]
    if len(n) == 12 and n.startswith('54'): n = '549' + n[2:]
    if len(n) == 10 and not n.startswith('15'): n = '549' + n
    if len(n) == 13 and n.startswith('549') and n[3] not in '05': return n
    # Explicit Brazilian international number, never assume it is Argentine.
    if len(n) in (12, 13) and n.startswith('55'): return n
    return None


def clock(v):
    if isinstance(v, (int, float)):
        minutes = round(v * 1440) if 0 <= v < 1 else round(v * 60)
        return f'{minutes//60:02}:{minutes%60:02}' if minutes < 1440 else None
    m = re.fullmatch(r'\s*(\d{1,2})(?::(\d{2}))?\s*(?:hs|hrs)?\s*', str(v).lower())
    return f'{int(m[1]):02}:{int(m[2] or 0):02}' if m and int(m[1]) < 24 and int(m[2] or 0) < 60 else None


def cells(sheet):
    return {c['ref']: c['v'] for c in sheet['cells'] if str(c['v']).strip()}


def prepare(workbooks, existing):
    clientfile = next(n for n in workbooks if n.startswith('reporte_clientes'))
    abonofile = next(n for n in workbooks if n.startswith('abonos'))
    cs = cells(workbooks[clientfile]['sheets'][0])
    clients = []
    for r in range(39, 709):
        name = str(cs.get(f'A{r}', '')).strip()
        raw = {col: cs.get(f'{col}{r}') for col in 'ABCDE'}
        ph = phone(raw['C']); reason = []
        if len(key(name).split()) < 2 or re.search(r'clase|profe|invitad|padel|señora|mujer|\by\b|\bhijo\b|papá|[().,0-9]', name, re.I): reason.append('Identificación incompleta o ambigua')
        if not ph: reason.append('Teléfono ausente o inválido')
        clients.append(dict(kind='CLIENT', file=clientfile, sha256=workbooks[clientfile]['sha256'], sheet='Resumen', row=r, cell=f'A{r}', name=name, phone=ph, raw=raw, reasons=reason, status='REVIEW' if reason else 'CONFIRMED'))
    byname = collections.defaultdict(list); byphone = collections.defaultdict(list)
    for c in clients:
        byname[key(c['name'])].append(c)
        if c['phone']: byphone[c['phone']].append(c)
    for c in clients:
        if c['status'] != 'CONFIRMED': continue
        if len({x['phone'] for x in byname[key(c['name'])] if x['phone']}) > 1:
            c['reasons'].append('Mismo nombre con teléfonos diferentes: comparar personas')
        if len({key(x['name']) for x in byphone[c['phone']]}) > 1:
            c['reasons'].append('Teléfono compartido por identificaciones diferentes: no fusionar')
        if c['reasons']: c['status'] = 'REVIEW'
    seen = {}
    for c in clients:
        if c['status'] != 'CONFIRMED': continue
        identity = (key(c['name']), c['phone'])
        if identity in seen:
            c['status'] = 'DUPLICATE'; c['duplicateOf'] = seen[identity]['cell']; c['reasons'] = ['Mismo nombre y teléfono normalizados']
        else: seen[identity] = c
    def match(name, ph):
        matches = [c for c in clients if c['status']=='CONFIRMED' and key(c['name']) == key(name) and c['phone'] == ph]
        return matches[0]['cell'] if len(matches)==1 else None
    abonos = []; waits = []
    days = ['lunes','martes','miercoles','jueves','viernes','sabado','domingo']
    for sheet in workbooks[abonofile]['sheets']:
        if sheet['name'] not in days: continue
        v = cells(sheet)
        for court, cols in enumerate(['ABCDE','GHIJK','MNOPQ','STUVW'], 1):
            t,n,o,p,q = cols
            # Every explicit time cell is a separate block, including special slots.
            times = []
            for ref, value in v.items():
                if re.sub(r'\d','',ref) != t: continue
                row = int(re.sub(r'\D','',ref))
                start = end = None
                m = re.fullmatch(r'(\d{1,2}(?::\d\d)?)\s+a\s+(\d{1,2}(?::\d\d)?)\s*(?:hs|hrs)?',str(value).strip(), re.I)
                if m: start,end=clock(m[1]),clock(m[2])
                else: start=clock(value)
                if start or '20 o 21:30' in str(value): times.append((row,start,end,value))
            times.sort()
            for index,(row,start,end,time_raw) in enumerate(times):
                stop=min(times[index+1][0] if index+1<len(times) else row+5,row+5)
                # Special single-row slots must not collect the next headers.
                name_rows=[r for r in range(row,stop) if v.get(f'{n}{r}') and str(v[f'{n}{r}']).strip().lower() not in ('cliente',) and not re.search(r'^(vuelve|baja|paga |adeuda|posible|quiere|por ahora)',str(v[f'{n}{r}']),re.I)]
                if not name_rows: continue
                nr=name_rows[0]; name=str(v[f'{n}{nr}']).strip()
                raw={f'{col}{r}':v[f'{col}{r}'] for r in range(row,stop) for col in cols if f'{col}{r}' in v}
                notes=[str(val).strip() for ref,val in raw.items() if ref not in (f'{n}{nr}',f'{t}{row}') and not phone(val)]
                phones=list(dict.fromkeys(phone(val) for ref,val in raw.items() if re.sub(r'\d','',ref) in (p,q) and phone(val)))
                ph=phones[0] if len(phones)==1 else None
                status='CONFIRMED'; reasons=[]; note=' | '.join(notes)
                if re.search(r'\bbaja\b',note,re.I):status='BAJA'
                elif key(name)=='win padel':status='INTERNAL'
                elif re.search(r'vuelve',note,re.I):status='RETURN_PENDING'
                elif re.search(r'posible',note,re.I):status='POSSIBLE'
                elif re.search(r'paga doble|quiere|por ahora|clase|adeuda',note,re.I):status='REVIEW';reasons.append('Observación que requiere confirmación administrativa')
                if start and end:
                    h,m=map(int,start.split(':'));hh,mm=map(int,end.split(':'));duration=(hh*60+mm)-(h*60+m)
                else:duration=None;reasons.append('Horario especial sin duración o inicio inequívoco')
                if not ph: reasons.append('Falta teléfono inequívoco')
                linked=match(name,ph) if ph else None
                if not linked:reasons.append('Sin coincidencia segura de nombre y teléfono con cliente validado')
                if reasons and status=='CONFIRMED':status='REVIEW'
                abonos.append(dict(kind='ABONO',file=abonofile,sha256=workbooks[abonofile]['sha256'],sheet=sheet['name'],row=nr,cell=f'{n}{nr}',name=name,phone=ph,court=f'C{court}',weekday=days.index(sheet['name'])+1,start=start,end=end,duration=duration,status=status,reasons=reasons,note=note,raw=raw,clientCell=linked,timeRaw=time_raw))
    sheet=next(s for s in workbooks[abonofile]['sheets'] if s['name']=='LISTA DE ESPERA');v=cells(sheet)
    for r in range(2,46):
        if not any(f'{col}{r}' in v for col in 'ABCDEF'):continue
        raw={f'{col}{rr}':v[f'{col}{rr}'] for rr in [r] for col in 'ABCDEF' if f'{col}{rr}' in v}
        day=v.get(f'E{r}','')
        tm=v.get(f'F{r}','')
        times=[clock(tm)] if clock(tm) else re.findall(r'\d{1,2}(?::\d\d)?',str(tm))
        times=[clock(t) for t in times if clock(t)]
        waits.append(dict(kind='WAITLIST',file=abonofile,sha256=workbooks[abonofile]['sha256'],sheet=sheet['name'],row=r,cell=f'A{r}',name=str(v.get(f'A{r}','')).strip(),phone=phone(v.get(f'C{r}')),channel=v.get(f'B{r}',''),reference=v.get(f'D{r}',''),days=str(day or ''),times=times,timeRaw=tm,raw=raw,status='REVIEW' if not phone(v.get(f'C{r}')) or not day or not times else 'CONFIRMED',reasons=[],clientCell=match(v.get(f'A{r}',''),phone(v.get(f'C{r}')))))
    for c in clients+abonos+waits:
        c['sourceKey']=c['file']+':'+c['sheet']+':'+c['cell']
    prefix=clients[0]["file"]+":Resumen:"
    for c in abonos+waits:
        if c.get("clientCell"): c["clientSourceKey"]=prefix+c["clientCell"]
    summary={k:dict(collections.Counter(c['status'] for c in rows)) for k,rows in [('clients',clients),('abonos',abonos),('waitlist',waits)]}
    return dict(summary=summary,clients=clients,abonos=abonos,waitlist=waits,existing=existing)


if __name__=='__main__':
    result=prepare(json.load(open(sys.argv[1])),json.load(open(sys.argv[2])))
    with open(sys.argv[3],'w') as f: json.dump(result,f,ensure_ascii=False,indent=2)
    print(json.dumps(result['summary'],ensure_ascii=False))
