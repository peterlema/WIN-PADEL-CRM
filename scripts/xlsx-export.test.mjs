import assert from 'node:assert/strict'
import {writeFileSync,mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {execFileSync} from 'node:child_process'
import {workbookBlob} from '../src/xlsxExport.js'
const dir=mkdtempSync(join(tmpdir(),'win-xlsx-')),file=join(dir,'estado.xlsx')
try{
 writeFileSync(file,new Uint8Array(await workbookBlob('Movimientos',['Producto','Cantidad','Consumo'],[['=SUM(A1:A2)',2,1500.5],['Agua & café <x>',1,1000]]).arrayBuffer()))
 const script="import zipfile,sys,xml.etree.ElementTree as E\nz=zipfile.ZipFile(sys.argv[1]);assert z.testzip() is None\ns=E.fromstring(z.read('xl/worksheets/sheet1.xml'));ns={'m':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}\nassert len(s.findall('.//m:row',ns))==3\nassert s.find('.//m:f',ns) is None\nassert s.find('.//m:c[@r=\\\"A2\\\"]/m:is/m:t',ns).text=='=SUM(A1:A2)'\nassert float(s.find('.//m:c[@r=\\\"C2\\\"]/m:v',ns).text)==1500.5\nassert s.find('.//m:c[@r=\\\"A3\\\"]/m:is/m:t',ns).text=='Agua & café <x>'"
 execFileSync('python3',['-c',script,file])
 console.log('PASS Excel OOXML: ZIP/CRC válidos, números conservados, texto escapado y fórmulas de usuario inertes.')
}finally{rmSync(dir,{recursive:true})}
