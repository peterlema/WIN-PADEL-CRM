"""Lossless cell extraction for migration preview; original XLSX files stay intact.
Usage: python3 scripts/read-migration-workbooks.py OUTPUT_JSON INPUT_XLSX ...
No formulas are evaluated and no monetary values are inferred from columns.
"""
import hashlib
import json
import pathlib
import sys
import zipfile
import xml.etree.ElementTree as ET

NS={'s':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
R='{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id'
def extract(path):
    data=path.read_bytes()
    with zipfile.ZipFile(path) as z:
        root=lambda name:ET.fromstring(z.read(name))
        strings=[''.join(e.itertext()) for e in root('xl/sharedStrings.xml').findall('s:si',NS)] if 'xl/sharedStrings.xml' in z.namelist() else []
        styles=root('xl/styles.xml')
        formats={int(e.attrib['numFmtId']):e.attrib['formatCode'] for e in styles.findall('s:numFmts/s:numFmt',NS)}
        xfs=[int(e.attrib.get('numFmtId',0)) for e in styles.findall('s:cellXfs/s:xf',NS)]
        rels={e.attrib['Id']:e.attrib['Target'] for e in root('xl/_rels/workbook.xml.rels')}
        sheets=[]
        for item in root('xl/workbook.xml').findall('s:sheets/s:sheet',NS):
            target=rels[item.attrib[R]]
            filename=target.lstrip('/') if target.startswith('/') else 'xl/'+target
            tree=root(filename);cells=[]
            for c in tree.findall('.//s:sheetData/s:row/s:c',NS):
                value=c.find('s:v',NS);typ=c.attrib.get('t')
                if typ=='inlineStr':v=''.join(c.find('s:is',NS).itertext())
                elif value is None:continue
                elif typ=='s':v=strings[int(value.text)]
                elif typ in ('str','e'):v=value.text
                else:
                    try:
                        v=float(value.text)
                        if v.is_integer():v=int(v)
                    except (ValueError,TypeError):v=value.text
                fmt_id=xfs[int(c.attrib.get('s',0))]
                record=dict(ref=c.attrib['r'],v=v,fmt=formats.get(fmt_id,fmt_id))
                f=c.find('s:f',NS)
                if f is not None:record['formula']=f.text
                cells.append(record)
            sheets.append(dict(name=item.attrib['name'],merges=[e.attrib['ref'] for e in tree.findall('s:mergeCells/s:mergeCell',NS)],cells=cells))
        return dict(sha256=hashlib.sha256(data).hexdigest(),sheets=sheets)
if __name__=='__main__':
    result={pathlib.Path(p).name:extract(pathlib.Path(p)) for p in sys.argv[2:]}
    pathlib.Path(sys.argv[1]).write_text(json.dumps(result,ensure_ascii=False,indent=2))
    print(json.dumps({name:[{'sheet':s['name'],'cells':len(s['cells'])} for s in w['sheets']] for name,w in result.items()}))
