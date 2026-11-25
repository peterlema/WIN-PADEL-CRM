// Minimal OOXML workbook, uncompressed ZIP. Text is inlineStr, never an Excel formula.
const encoder=new TextEncoder()
const xml=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c])).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'')
const column=n=>{let s='';for(n++;n;n=Math.floor((n-1)/26))s=String.fromCharCode(65+(n-1)%26)+s;return s}
function crc(bytes){let n=0xffffffff;for(const b of bytes){n^=b;for(let i=0;i<8;i++)n=(n>>>1)^(n&1?0xedb88320:0)}return(n^0xffffffff)>>>0}
function header(size,values){const a=new Uint8Array(size),v=new DataView(a.buffer);for(const [off,n,len]of values)len===2?v.setUint16(off,n,true):v.setUint32(off,n,true);return a}
function zip(files){
 const chunks=[],central=[];let offset=0,size=0
 for(const [name,text]of Object.entries(files)){
  const n=encoder.encode(name),b=encoder.encode(text),sum=crc(b)
  const local=header(30,[[0,0x04034b50,4],[4,20,2],[6,0x800,2],[14,sum,4],[18,b.length,4],[22,b.length,4],[26,n.length,2]])
  chunks.push(local,n,b)
  const c=header(46,[[0,0x02014b50,4],[4,20,2],[6,20,2],[8,0x800,2],[16,sum,4],[20,b.length,4],[24,b.length,4],[28,n.length,2],[42,offset,4]])
  central.push(c,n);offset+=local.length+n.length+b.length;size+=c.length+n.length
 }
 const end=header(22,[[0,0x06054b50,4],[8,Object.keys(files).length,2],[10,Object.keys(files).length,2],[12,size,4],[16,offset,4]])
 return new Blob([...chunks,...central,end],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'})
}
export function workbookBlob(sheet,head,rows){
 const sheetRows=[head,...rows].map((row,i)=>'<row r="'+(i+1)+'">'+row.map((value,j)=>{const ref=column(j)+(i+1);return typeof value==='number'&&Number.isFinite(value)?'<c r="'+ref+'"><v>'+value+'</v></c>':'<c r="'+ref+'" t="inlineStr"><is><t xml:space="preserve">'+xml(value)+'</t></is></c>'}).join('')+'</row>').join('')
 return zip({
 '[Content_Types].xml':'<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
 '_rels/.rels':'<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
 'xl/workbook.xml':'<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="'+xml(sheet.slice(0,31))+'" sheetId="1" r:id="rId1"/></sheets></workbook>',
 'xl/_rels/workbook.xml.rels':'<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
 'xl/worksheets/sheet1.xml':'<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetData>'+sheetRows+'</sheetData><autoFilter ref="A1:'+column(head.length-1)+(rows.length+1)+'"/></worksheet>'
 })
}
export function downloadWorkbook(filename,sheet,head,rows){
 const url=URL.createObjectURL(workbookBlob(sheet,head,rows)),a=document.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000)
}
