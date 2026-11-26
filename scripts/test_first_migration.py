import importlib.util
import pathlib
import unittest

spec=importlib.util.spec_from_file_location('migration',pathlib.Path(__file__).with_name('prepare-first-migration.py'))
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

class SourceTests(unittest.TestCase):
    def test_phone(self):
        for raw in ['11 5555 1234','+54 11 5555-1234','54 9 11 5555 1234','0111555551234']:
            self.assertEqual(m.phone(raw),'5491155551234')
        for raw in ['—',None,'1234','+54 9 280499',822800]:self.assertIsNone(m.phone(raw))
        self.assertEqual(m.phone('55 4199984514'),'554199984514')
    def test_clock(self):
        self.assertEqual(m.clock(0.7708333333333334),'18:30')
        self.assertEqual(m.clock(20),'20:00')
        self.assertEqual(m.clock('9:30hs'),'09:30')
        self.assertIsNone(m.clock('20 o 21:30'))
    def test_blocks_and_incomplete_contact(self):
        sheet=lambda name,values:dict(name=name,cells=[dict(ref=k,v=v) for k,v in values.items()])
        c={}
        for r in range(39,709):c.update({f'A{r}':'Clase Leo',f'C{r}':'—'})
        c.update(A39='Persona Trápaga',C39='11 5555 1234',A40='Persona Trápaga',C40='+54 11 5555 1234')
        w={'reporte_clientes.xlsx':dict(sha256='c',sheets=[sheet('Resumen',c)]),'abonos.xlsx':dict(sha256='a',sheets=[sheet('demo',{'A12':'17 a 18:30hs','B13':'No importar'}),sheet('lunes',{'A12':'17 a 18:30hs','B13':'Persona Trápaga','E13':1155551234,'A5':0.375,'B5':'Especial sin duración','D5':1155551234}),sheet('LISTA DE ESPERA',{'A2':'Nombre','E2':'Martes','F2':20,'E41':'Jueves','F41':'19:00 hrs'})])}
        result=m.prepare(w,{})
        self.assertEqual(result['clients'][0]['status'],'CONFIRMED')
        self.assertEqual(result['clients'][1]['status'],'DUPLICATE')
        self.assertEqual(len(result['abonos']),2)
        ordinary=next(a for a in result['abonos'] if a['cell']=='B13')
        self.assertEqual(ordinary['phone'],'5491155551234')
        self.assertEqual(ordinary['status'],'CONFIRMED')
        self.assertEqual(ordinary['duration'],90)
        self.assertTrue(ordinary['clientSourceKey'].endswith(':Resumen:A39'))
        self.assertEqual(next(a for a in result['abonos'] if a['cell']=='B5')['status'],'REVIEW')
        self.assertEqual(len(result['waitlist']),2)
        self.assertEqual(result['waitlist'][1]['name'],'')
        self.assertEqual(result['waitlist'][1]['times'],['19:00'])

if __name__=='__main__':unittest.main()
