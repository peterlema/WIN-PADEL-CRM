import importlib.util, unittest
from copy import deepcopy
from pathlib import Path
spec=importlib.util.spec_from_file_location('history',Path(__file__).with_name('import-history.py'))
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

class HistoryTest(unittest.TestCase):
 def source(self):
  e=['e1','s1',46314,46315.5,'Operador','Clase','',2,3,'Profe',0,0,0,'','','','ACTIVA','']
  detail=['e1',46314,'Profe',2,3,90000,60,108000,'Tradicional',.5,'CONFIRMADO',46315.5,'Operador','']
  shift=['s1','CERRADA',46315,'Operador',46315.4,46315.6,0,0,0,0,0,0,0,0,0,'']
  allocation=['p1',46316,46314,'Profe','Transferencia',108000,46316.5,'Operador','','ACTIVO','s1']
  return {t:{'values':[[str(i) for i in range(len(r))],r]} for t,r in zip(m.TABS,[e,detail,allocation,shift])}
 def test_quantity_and_dates(self):
  rows=m.build(self.source());e=next(r['facts'] for r in rows if r['entity']=='entry');a=next(r['facts'] for r in rows if r['entity']=='allocation')
  self.assertEqual(e['win_net'],108000);self.assertEqual(e['gross'],180000);self.assertEqual(e['teacher_pay'],72000)
  self.assertEqual(e['quantity'],2);self.assertNotEqual(e['activity_date'],e['payment_date']);self.assertNotEqual(a['activity_date'],a['payment_date'])
 def test_unknown_price_remains_null(self):
  s=self.source();s['WIN Detalle Clases']['values'][1][10]='PENDIENTE'
  f=next(r['facts'] for r in m.build(s) if r['entity']=='entry')
  self.assertTrue(f['unknown_price']);self.assertIsNone(f['win_net']);self.assertIsNone(f['gross']);self.assertIsNone(f['teacher_pay'])
 def test_stable_origin_and_no_implicit_schedule(self):
  s=self.source();r=m.build(s);self.assertEqual(r,m.build(deepcopy(s)))
  f=next(x['facts'] for x in r if x['entity']=='entry');self.assertEqual(f['courts'],[]);self.assertIsNone(f['duration_min'])
 def test_duplicate_origin_stops_import(self):
  s=self.source();s['WIN Anotaciones']['values'].append(deepcopy(s['WIN Anotaciones']['values'][1]))
  with self.assertRaises(ValueError):m.build(s)
 def test_void_retained(self):
  s=self.source();s['WIN Anotaciones']['values'][1][16]='ANULADA'
  f=next(r['facts'] for r in m.build(s) if r['entity']=='entry');self.assertEqual(f['status'],'VOID')
 def test_composite_allocation_key(self):
  s=self.source();r=deepcopy(s['WIN Cobros Distribuidos']['values'][1]);r[2]+=1;s['WIN Cobros Distribuidos']['values'].append(r)
  rows=[r for r in m.build(s) if r['entity']=='allocation'];self.assertEqual(len({r['origin_id'] for r in rows}),2)

if __name__=='__main__':unittest.main()
