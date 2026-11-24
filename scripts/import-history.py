"""Read a bounded Sheets snapshot; produce source-keyed history, never live cash.

Input JSON: {tab: {values: [header, ...rows]}} from Sheets UNFORMATTED_VALUE.
Output is private JSON, not repository content. All original values are retained.
"""
import argparse, collections, datetime as dt, hashlib, json
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path

SOURCE = '1kYR8t-3dyXC0gFRiMMjBV7sV-byOgfIlGl2mCMwP-zE'
TABS = {'WIN Anotaciones': 'entry', 'WIN Detalle Clases': 'class_detail',
        'WIN Cobros Distribuidos': 'allocation', 'Cierres': 'shift'}
BASE = dt.datetime(1899, 12, 30)
def date(v):
    if v in (None, ''): return None
    if not isinstance(v, (int, float)): raise ValueError(f'Unexpected date: {v!r}')
    return (BASE + dt.timedelta(days=v)).date().isoformat()
def stamp(v):
    if v in (None, ''): return None
    return (BASE + dt.timedelta(days=v)).replace(microsecond=0).isoformat() + '-03:00'
def hour(v):
    if v in (None, ''): return None
    if isinstance(v, (int, float)):
        m = round((v % 1) * 1440) % 1440
        return f'{m//60:02}:{m%60:02}'
    return v if isinstance(v, str) and len(v) == 5 and v[2] == ':' else None
def num(v): return Decimal(str(v or 0))
def amount(v): return float(num(v).quantize(Decimal('.01'), rounding=ROUND_HALF_UP))
def meta(v):
    if isinstance(v, str) and v.startswith('WIN-M02:'):
        p = json.loads(v[8:])
        if p.get('v') == 1: return p
    return {'nota': v or ''}
def pad(r, n): return r + [None] * max(0, n-len(r))

def build(source):
    groups = {tab: [pad(r, len(v['values'][0])) for r in v['values'][1:] if r and r[0]]
              for tab, v in source.items() if tab in TABS}
    for tab, rows in groups.items():
        keys = [str(r[0]) if TABS[tab] != 'allocation' else json.dumps([r[i] for i in (0,2,3,4)], ensure_ascii=False) for r in rows]
        if len(set(keys)) != len(keys): raise ValueError(f'Duplicate origin key in {tab}; review instead of guessing')
    details = {r[0]: r for r in groups['WIN Detalle Clases']}
    shifts = {r[0]: r for r in groups['Cierres']}
    output = []
    for tab, rows in groups.items():
        entity = TABS[tab]
        for row_number, r in enumerate(rows, 2):
            origin = str(r[0]) if entity != 'allocation' else json.dumps([r[i] for i in (0,2,3,4)], ensure_ascii=False, separators=(',', ':'))
            f = {}
            if entity == 'entry':
                detail = details.get(r[0]); m = meta(r[15]); activity = m.get('actividad') or {}; econ = m.get('economia')
                typ = {'Reserva': 'ABONO' if r[6] == 'Abonos' else 'RESERVA', 'Clase': 'CLASE', 'Rendicion':'RENDICION',
                       'Evento':'EVENTO', 'Tienda':'TIENDA', 'Gasto':'GASTO', 'Retiro':'RETIRO', 'Otro ingreso':'OTRO'}.get(r[5])
                if not typ: raise ValueError(f'Unknown operation {r[5]}')
                qty = int(r[7] or 0)
                confirmed = bool(detail and detail[10] == 'CONFIRMADO')
                win = gross = teacher_pay = None
                if typ == 'CLASE' and confirmed:
                    if detail[8] not in ('Tradicional', 'Clase-partido') or not 0 <= num(detail[6]) <= 100:
                        raise ValueError(f'Invalid class economics {r[0]}')
                    win = amount(detail[7]) if detail[8] == 'Clase-partido' or econ else amount(num(detail[5])*qty*num(detail[6])/100)
                    if econ and 'cobrado' in econ and 'remuneracion' in econ:
                        gross, teacher_pay = amount(econ['cobrado']), amount(econ['remuneracion'])
                    elif detail[8] == 'Tradicional':
                        gross = amount(num(detail[5])*qty); teacher_pay = amount(num(gross)-num(win))
                elif typ in ('RESERVA','ABONO','EVENTO','TIENDA','OTRO'):
                    win = gross = amount(num(r[10])+num(r[11]))
                # The shift records the commercial collection day. If missing, preserve
                # the original financial date and explicitly mark that fallback.
                sh = shifts.get(r[1])
                payment_date = date(sh[2]) if sh else date(r[2])
                f = dict(type=typ, status='ACTIVE' if r[16]=='ACTIVA' else 'VOID', activity_date=date(r[2]),
                    payment_date=payment_date, date_basis='shift' if sh else 'legacy_financial_date',
                    occurred_at=stamp(r[3]), author=r[4], shift_id=r[1], teacher=r[9] or None,
                    quantity=qty if typ in ('CLASE','RESERVA','ABONO') else 1, participants=int(r[8] or 0) if typ=='CLASE' else (qty if typ=='EVENTO' else None),
                    cash=amount(r[10]), transfer=amount(r[11]), expense=amount(r[12]), expense_method=r[13], category=r[6],
                    note=m.get('nota') or '', concept=r[14] or '', win_net=win, gross=gross, teacher_pay=teacher_pay,
                    win_pct=amount(detail[6]) if typ=='CLASE' and confirmed else None,
                    class_kind=detail[8] if typ=='CLASE' and detail else None,
                    unknown_price=typ=='CLASE' and not confirmed,
                    tiny_price=typ=='CLASE' and confirmed and 0<num(detail[5])<1000,
                    start_time=hour(activity.get('hora')) or (hour(detail[9]) if typ=='CLASE' and detail else None),
                    duration_min=activity.get('duracion'), courts=activity.get('canchas') or [],
                    solo_cobro=bool(m.get('soloCobro')), missing_shift=sh is None)
            elif entity == 'allocation':
                f = dict(type='RENDICION', status='ACTIVE' if r[9]=='ACTIVO' else 'VOID', payment_date=date(r[1]),
                    activity_date=date(r[2]), teacher=r[3], method=r[4], amount=amount(r[5]), occurred_at=stamp(r[6]),
                    author=r[7], note=r[8] or '', shift_id=r[10], receipt_id=r[0])
            elif entity == 'shift':
                f = dict(date=date(r[2]), author=r[3], state=r[1], opened_at=stamp(r[4]), closed_at=stamp(r[5]),
                    expected_cash=amount(r[12]), counted_cash=amount(r[13]), difference=amount(r[14]), note=r[15] or '')
            raw = json.dumps(r, ensure_ascii=False, separators=(',', ':'))
            output.append(dict(source_id=SOURCE, entity=entity, origin_id=origin, source_row=row_number,
                               raw=r, facts=f, content_hash=hashlib.sha256(raw.encode()).hexdigest()))
    return output

if __name__ == '__main__':
    p=argparse.ArgumentParser();p.add_argument('source');p.add_argument('output');args=p.parse_args()
    result=build(json.loads(Path(args.source).read_text()))
    Path(args.output).write_text(json.dumps(result,ensure_ascii=False,separators=(',', ':')))
    print(json.dumps(dict(rows=len(result),entities=dict(collections.Counter(r['entity'] for r in result)))))
