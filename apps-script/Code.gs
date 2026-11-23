/** WIN Gestión V4.8 — VALIDAR EN COPIA ANTES DE PUBLICAR. Zona horaria: America/Argentina/Buenos_Aires.
 * Requiere propiedad de script WIN_SHEET_ID apuntando a la base seleccionada.
 * Realizar respaldo antes de actualizar.
 */
const WIN_TZ='America/Argentina/Buenos_Aires';
// Activar solo en la versión privada de pruebas y restaurar false en el editor tras versionar.
const WIN_PRUEBAS_CAJA=false;
const WIN_PRUEBAS_CACHE='WIN_DEMO_CAJA_05';
const WIN_TABS={config:'Configuracion',shifts:'Cierres',entries:'WIN Anotaciones',audit:'WIN Auditoria',ledger:'Asiento Diario',rend:'Rendiciones',moves:'Movimientos Caja',reviews:'Revisiones Admin',exports:'WIN Exportaciones',allocations:'WIN Cobros Distribuidos',classDetails:'WIN Detalle Clases',classLinks:'WIN Conciliacion Clases'};
const WIN_HEADERS={
 'Configuracion':['Tipo','Nombre','Activo'],
 'Cierres':['ID','Estado','Fecha','Responsable','Apertura','Cierre','Saldo inicial','Efectivo ingresos','Transferencia ingresos','Gastos efectivo','Gastos transferencia','Retiros','Saldo esperado','Saldo contado','Diferencia','Observaciones'],
 'WIN Anotaciones':['ID','ID turno','Fecha actividad','Fecha-hora registro','Responsable','Tipo','Categoria','Cantidad','Alumnos por clase','Profesor','Efectivo','Transferencia','Importe gasto/retiro','Medio egreso','Concepto','Observaciones','Estado','ID correccion'],
 'WIN Auditoria':['Fecha-hora','Responsable','Accion','ID anotacion','ID turno','Detalle'],
 'Asiento Diario':['Año','Mes','Día','Dia2','Tipo de movimiento','Categoría','Subcategoría','Detalle','Forma de pago','Importe','ID cierre','Responsable','Fecha-hora registro'],
 'Rendiciones':['ID cierre','Profesor','Cantidad','Efectivo','Transferencia','Observaciones'],
 'Movimientos Caja':['ID cierre','Tipo','Concepto','Medio','Importe','Responsable o receptor'],
 'Revisiones Admin':['Fecha actividad','Estado','Revisado por','Fecha-hora revisión','Observaciones','Huella datos'],
  'WIN Exportaciones':['Fecha','Huella','Generado el','Usuario','Cantidad asientos','Estado'],
 'WIN Cobros Distribuidos':['ID cobro','Fecha cobro','Fecha actividad','Profesor','Medio','Importe atribuido','Fecha-hora registro','Usuario','Observacion','Estado','Turno cobro'],
 'WIN Detalle Clases':['ID anotacion','Fecha actividad','Profesor','Cantidad clases','Alumnos por clase','Precio total clase','Porcentaje WIN','Importe WIN total','Tipo clase','Horario','Estado precio','Fecha-hora carga','Responsable','Observaciones'],
 'WIN Conciliacion Clases':['ID vínculo','ID cobro','Origen cobro','ID clase','Importe imputado','Fecha-hora','Usuario','Observaciones','Estado']
};
function winProps_(){
  if(!WIN_PRUEBAS_CAJA)return PropertiesService.getScriptProperties();
  const props=winDatosPrueba_().props;
  return {getProperty:k=>props[k]||null,setProperty:(k,v)=>{props[k]=v;},deleteProperty:k=>{delete props[k];}};
}
function winSheet_(){
  if(WIN_PRUEBAS_CAJA)return {getSheetByName:winHojaPrueba_};
  const id=winProps_().getProperty('WIN_SHEET_ID');
  if(!id)throw Error('Falta WIN_SHEET_ID en Propiedades del proyecto.');
  return SpreadsheetApp.openById(id);
}
let winDatosPruebaCache_=null;
function winDatosPrueba_(){
  if(!WIN_PRUEBAS_CAJA)throw Error('Simulación deshabilitada.');
  if(winDatosPruebaCache_)return winDatosPruebaCache_;
  const saved=CacheService.getUserCache().get(WIN_PRUEBAS_CACHE);
  if(saved)return (winDatosPruebaCache_=JSON.parse(saved));
  const sheets={},props={},usuarios=['Titular Demo','Colaborador Demo','Admin'];
  Object.keys(WIN_HEADERS).forEach(name=>{sheets[name]=[WIN_HEADERS[name].slice()];});
  const hash='demo:'+winHash_('demo:123456');
  usuarios.forEach(user=>{sheets.Configuracion.push(['Recepcion',user,true]);props['PIN_'+user]=hash;});
  sheets.Configuracion.push(['Profesor','Profesor Demo',true]);
  const ayer=Utilities.formatDate(new Date(Date.now()-86400000),WIN_TZ,'yyyy-MM-dd');
  sheets.Cierres.push(['DEMO-ANTERIOR','CERRADA',ayer,usuarios[0],ayer+' 10:00:00',ayer+' 20:00:00',
    10000,0,24000,0,0,0,10000,10000,0,'Caja de ejemplo']);
  sheets[WIN_TABS.entries].push(['DEMO-RESERVA','DEMO-ANTERIOR',ayer,ayer+' 16:00:00',usuarios[0],'Reserva','Regulares',1,0,'',0,24000,0,'','','','ACTIVA','']);
  sheets[WIN_TABS.audit].push([ayer+' 20:00:00',usuarios[0],'CONTROL_CIERRE_M01','','DEMO-ANTERIOR','{}']);
  return (winDatosPruebaCache_={sheets,props});
}
function winHojaPrueba_(name){
  const rows=winDatosPrueba_().sheets[name];
  if(!rows)return null;
  return {
    getDataRange:()=>({getValues:()=>rows.map(r=>r.slice())}),
    getLastRow:()=>rows.length,getMaxRows:()=>10000,getMaxColumns:()=>100,
    appendRow:r=>{rows.push(r.slice());},
    getRange:(row,col,n=1,m=1)=>{
      const get=()=>Array.from({length:n},(_,i)=>Array.from({length:m},(_,j)=>rows[row-1+i]?.[col-1+j]??''));
      const set=values=>values.forEach((r,i)=>{
        if(!rows[row-1+i])rows[row-1+i]=[];
        r.forEach((v,j)=>{rows[row-1+i][col-1+j]=v;});
      });
      return {getValues:get,getValue:()=>get()[0][0],setValues:set,setValue:v=>set([[v]])};
    }
  };
}
function winReiniciarPrueba(){
  if(!WIN_PRUEBAS_CAJA)throw Error('Simulación deshabilitada.');
  const lock=LockService.getUserLock();lock.waitLock(30000);
  try{CacheService.getUserCache().remove(WIN_PRUEBAS_CACHE);winDatosPruebaCache_=null;return true;}
  finally{lock.releaseLock();}
}
function winSimularMadrugada(){
  if(!WIN_PRUEBAS_CAJA)throw Error('Simulación deshabilitada.');
  return winLock_(()=>{
    if(winActive_())throw Error('Cerrá el turno de prueba abierto antes de simular la madrugada.');
    const jornada=winDiaAnterior_(winDate_()),contado=winCajaCierreAnterior_()?.contado??0;
    const id='DEMO-NOCHE-'+Utilities.getUuid().slice(0,8);
    winTab_('shifts').appendRow([id,'ABIERTA',jornada,'Titular Demo',jornada+' 22:00:00','',contado,0,0,0,0,0,contado,'','','']);
    return {jornada};
  });
}
function winTab_(key){if(winStage_)return winStagedTab_(key);const sh=winSheet_().getSheetByName(WIN_TABS[key]);if(!sh)throw Error('Falta hoja '+WIN_TABS[key]+'. Ejecutá prepararWINGestion_ desde el editor.');return sh;}
function winNow_(){return Utilities.formatDate(new Date(),WIN_TZ,'yyyy-MM-dd HH:mm:ss');}
function winDate_(){return Utilities.formatDate(new Date(),WIN_TZ,'yyyy-MM-dd');}
function winDiaAnterior_(fecha){
  const d=new Date(fecha+'T12:00:00Z');
  d.setUTCDate(d.getUTCDate()-1);
  return d.toISOString().slice(0,10);
}
function winFechaActividadCaja_(turno,registrado){
  const hoy=winDateKey_(registrado);
  const jornada=winDateKey_(turno[2]);
  return jornada===winDiaAnterior_(hoy)?jornada:hoy;
}
function winDateKey_(value){
  if(value instanceof Date && !isNaN(value.getTime())) return Utilities.formatDate(value,WIN_TZ,'yyyy-MM-dd');
  const s=String(value==null?'':value).trim();
  if(/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}$/.test(s))return s.slice(0,10);
  if(/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d=s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if(d) return d[3]+'-'+d[2].padStart(2,'0')+'-'+d[1].padStart(2,'0');
  return s;
}
function winStr_(v,max=400){return String(v==null?'':v).trim().slice(0,max);}
function winNum_(v,label,zero=true){const x=Number(v);if(typeof v==='boolean'||v===null||String(v).trim()===''||!Number.isFinite(x)||x<0||x>1e12||Math.abs(x*100-Math.round(x*100))>0.001||(!zero&&x===0))throw Error('Valor inválido: '+label);return x;}
function winQty_(v,label){const x=winNum_(v,label,false);if(!Number.isSafeInteger(x)||x>1000)throw Error('Cantidad inválida: '+label);return x;}
function winHash_(s){return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,s).map(b=>('0'+(b&255).toString(16)).slice(-2)).join('');}
function definirPIN_(nombre,pin){if(!/^[0-9]{6,10}$/.test(String(pin)))throw Error('PIN: 6 a 10 dígitos.');const salt=Utilities.getUuid();winProps_().setProperty('PIN_'+nombre,salt+':'+winHash_(salt+':'+pin));}
function winList_(type){return winTab_('config').getDataRange().getValues().slice(1).filter(r=>r[0]===type&&(r[2]===true||String(r[2]).toLowerCase()==='true')).map(r=>String(r[1]));}
function winAuth_(p){if(!p||!winList_('Recepcion').includes(p.responsable))throw Error('Usuario no habilitado.');const stored=winProps_().getProperty('PIN_'+p.responsable);if(!stored)throw Error('Falta configurar el PIN de '+p.responsable+'.');const a=stored.split(':');if(a.length!==2||winHash_(a[0]+':'+String(p.pin))!==a[1])throw Error('PIN incorrecto.');return p.responsable;}
function winLock_(fn){
  if(winStage_)return fn();
  const lock=WIN_PRUEBAS_CAJA?LockService.getUserLock():LockService.getScriptLock();
  lock.waitLock(30000);
  try{
    if(WIN_PRUEBAS_CAJA)winDatosPruebaCache_=null;
    winRecover_();
    const result=fn();
    if(WIN_PRUEBAS_CAJA&&winDatosPruebaCache_){
      const serialized=JSON.stringify(winDatosPruebaCache_);
      if(Utilities.newBlob(serialized).getBytes().length>95000)throw Error('La simulación llegó a su límite. Reiniciá los datos de prueba.');
      CacheService.getUserCache().put(WIN_PRUEBAS_CACHE,serialized,21600);
    }
    return result;
  }finally{lock.releaseLock();}
}
function prepararWINGestion_(){const ss=winSheet_();Object.keys(WIN_HEADERS).forEach(name=>{let sh=ss.getSheetByName(name);if(!sh)sh=ss.insertSheet(name);const headers=WIN_HEADERS[name];if(sh.getLastRow()===0){sh.getRange(1,1,1,headers.length).setValues([headers]);}else if(name==='WIN Anotaciones'||name==='WIN Auditoria'||name==='Cierres'||name==='Revisiones Admin'){const old=sh.getRange(1,1,1,headers.length).getValues()[0];if(name==='Revisiones Admin'&&old.slice(0,5).every((v,i)=>v===headers[i])&&(old[5]===''||old[5]===undefined)){sh.getRange(1,6).setValue(headers[5]);}else if(old.some((v,i)=>v!==headers[i]))throw Error('Encabezados incompatibles en '+name);}if(name==='WIN Cobros Distribuidos'&&sh.getRange(1,11).getValue()!=='Turno cobro')sh.getRange(1,11).setValue('Turno cobro');sh.getRange(1,1,1,headers.length).setFontWeight('bold').setBackground('#181818').setFontColor('#fff');sh.setFrozenRows(1);});const cfg=ss.getSheetByName('Configuracion');if(cfg.getLastRow()<2){const data=[...['Leo','Chino','Alejo','Lucas','Martín','Fede','Pablo','Pablo Corsiglia'].map(x=>['Profesor',x,true]),...['Admin','Bauti','Jose','Juani'].map(x=>['Recepcion',x,true]),...['Efectivo','Transferencia'].map(x=>['Medio',x,true]),...['Abonos','Regulares'].map(x=>['Reserva',x,true])];cfg.getRange(2,1,data.length,3).setValues(data);}return 'Preparación correcta: '+ss.getName();}
function comprobarConexionWIN_(){const ss=winSheet_();return {nombre:ss.getName(),id:ss.getId(),hojas:ss.getSheets().map(x=>x.getName())};}
function doGet(){
  const app=HtmlService.createHtmlOutputFromFile('Index');
  const title=WIN_PRUEBAS_CAJA?'WIN Gestión — Pruebas de caja':'WIN Gestión — Recepción';
  if(WIN_PRUEBAS_CAJA)app.setContent(app.getContent().replace('<body>','<body class="win-preview">'));
  return app.setTitle(title).addMetaTag('viewport','width=device-width, initial-scale=1');
}
// Catálogo del Excel aportado: 10 Egresos y Comisiones bajo R.N.
const WIN_EXPENSE_CATEGORIES=['Alquiler','Artículos de limpieza','Sueldos','Obra','Mkt','Remax','Socios','Servicios','Seguros','Gastos de recepción'];
const WIN_EXPENSE_SUGGESTIONS={Alquiler:['Septiembre','Octubre'],Sueldos:['Administración','Limpieza','Sereno','Recepción'],Obra:['Materiales','Electricista','Capataz','Insumos','Gráficas','Matafuegos'],Mkt:['Ig'],Remax:['Octubre'],Socios:['Fede'],Servicios:['Internet'],Seguros:['Emergencia Médica'],'Gastos de recepción':['ferreteria']};
function winExpenseCategory_(value){
  const name=winStr_(value,100).replace(/\s+/g,' ');
  if(name.toLowerCase()==='artíuclos de limpieza')return 'Artículos de limpieza';
  return WIN_EXPENSE_CATEGORIES.find(c=>c.toLowerCase()===name.toLowerCase())||name;
}
function winExpenseCategories_(){return [...new Set([...WIN_EXPENSE_CATEGORIES,...winList_('Gasto').map(winExpenseCategory_)])].filter(c=>c.toLowerCase()!=='comisiones');}
function winProfessor_(value){
  const name=winStr_(value).toLowerCase();
  const match=winList_('Profesor').find(p=>String(p).trim().toLowerCase()===name);
  if(!match)throw Error('Profesor no habilitado.');
  return String(match).trim().toLowerCase()==='chino'?'Chino':String(match).trim();
}
function opciones(){return {preciosClases:WIN_CLASS_PRICES,responsables:winList_('Recepcion'),profesores:[...new Set(winList_('Profesor').map(winProfessor_))],gastos:winExpenseCategories_(),gastosRecepcion:WIN_GASTOS_RECEPCION,subcategoriasGasto:WIN_EXPENSE_SUGGESTIONS,excepcionesGasto:[{nombre:'Comisiones',tipo:'R.N'}]};}
/** Adaptador único: no interpreta ni reescribe observaciones antiguas. */
function winExpenseNote_(value,subcategoria){
  if(arguments.length>1)return 'WIN48-GASTO:'+JSON.stringify({v:1,subcategoria:winStr_(subcategoria,100),texto:winStr_(value,400)});
  const raw=String(value||'');
  if(raw.startsWith('WIN48-GASTO:')){
    try{const note=JSON.parse(raw.slice('WIN48-GASTO:'.length));if(note.v===1&&typeof note.subcategoria==='string'&&typeof note.texto==='string')return {subcategoria:note.subcategoria,nota:note.texto};}catch(e){}
  }
  return {subcategoria:null,nota:raw};
}
function winRetiroNote_(value){
  const raw=String(value||''),prefix='WIN-M01-RETIRO:';
  if(raw.startsWith(prefix)){
    try{
      const note=JSON.parse(raw.slice(prefix.length));
      if(note.v===1&&typeof note.destinatario==='string'&&typeof note.nota==='string')return note;
    }catch(e){}
  }
  return {destinatario:'',nota:raw};
}

function winShifts_(){return winTab_('shifts').getDataRange().getValues();}
function winActive_(rows=winShifts_()){const idx=rows.findIndex((r,i)=>i>0&&r[1]==='ABIERTA');return idx<0?null:{row:idx+1,data:rows[idx]};}
function winEntries_(shiftId){return winFilasSeleccionadas_('entries',2,v=>v===shiftId).filter(r=>r[16]==='ACTIVA').map(winEntryObject_);}
function winEntryObject_(r){
  const tipo=String(r[5]),meta=winNotaMovimiento_(r[15]);
  const note=tipo==='Gasto'?winExpenseNote_(meta.nota):tipo==='Retiro'?winRetiroNote_(meta.nota):{nota:meta.nota,subcategoria:''};
  return {id:String(r[0]),turno:String(r[1]),fecha:winDateKey_(r[2]),registrado:winTimestamp_(r[3]),responsable:String(r[4]),
    tipo,categoria:String(r[6]),cantidad:Number(r[7])||0,alumnos:Number(r[8])||0,profesor:String(r[9]||''),efectivo:Number(r[10])||0,
    transferencia:Number(r[11])||0,importe:Number(r[12])||0,medio:String(r[13]||''),concepto:String(r[14]||''),nota:note.nota,
    subcategoria:tipo==='Retiro'?'':note.subcategoria,...(note.destinatario?{destinatario:note.destinatario}:{}),
    ...(meta.actividad?{actividad:meta.actividad}:{}),...(meta.soloCobro?{soloCobro:true}:{}),
    ...(meta.economia?{economia:meta.economia}:{}),...(meta.incidenciaClase?{incidenciaClase:meta.incidenciaClase}:{})};
}
function winTotals_(entries,initial){const t={efectivo:0,transferencia:0,gastosEfectivo:0,gastosTransferencia:0,retiros:0,abonos:0,regulares:0,clases:0,eventos:0,inscriptos:0,clasesPorAlumnos:[0,0,0,0]};entries.forEach(e=>{if(e.tipo==='Reserva'){t.efectivo+=e.efectivo;t.transferencia+=e.transferencia;if(e.categoria==='Abonos')t.abonos+=e.cantidad;else t.regulares+=e.cantidad;}else if(e.tipo==='Clase'){t.clases+=e.cantidad;if(e.alumnos>=1&&e.alumnos<=4)t.clasesPorAlumnos[e.alumnos-1]+=e.cantidad;}else if(e.tipo==='Rendicion'||e.tipo==='Otro ingreso'||e.tipo==='Tienda'||e.tipo==='Evento'){t.efectivo+=e.efectivo;t.transferencia+=e.transferencia;if(e.tipo==='Evento'){t.eventos++;t.inscriptos+=e.cantidad;}}else if(e.tipo==='Gasto'){if(e.medio==='Efectivo')t.gastosEfectivo+=e.importe;else t.gastosTransferencia+=e.importe;}else if(e.tipo==='Retiro'){t.retiros+=e.importe;}});t.esperado=initial+t.efectivo-t.gastosEfectivo-t.retiros;return t;}
/** Asociación histórica de lectura: solo con marca horaria y un único turno compatible.
 * No escribe ni inventa asociación por fecha de actividad. Los casos ambiguos quedan para Admin. */
function winAllocationRows_(shifts=winShifts_().slice(1)){
  return winNormalizarAllocationRows_(winTab_('allocations').getDataRange().getValues().slice(1),shifts);
}
function winNormalizarAllocationRows_(rows,shifts){
  const stamp=v=>v instanceof Date?Utilities.formatDate(v,WIN_TZ,'yyyy-MM-dd HH:mm:ss'):String(v||'').replace('T',' ').slice(0,19);
  return rows.map((row,i)=>{
    const r=row.slice();r._row=row._row||i+2;r[10]=String(r[10]||'').trim();
    if(!String(r[10]||'').trim()){
      const time=stamp(r[6]);
      const candidates=/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(time)?shifts.filter(t=>stamp(t[4])<=time&&time<=(t[1]==='CERRADA'?stamp(t[5]):winNow_())&&(String(r[7])===String(t[3])||String(r[7])==='Admin')):[];
      if(candidates.length===1){r[10]=String(candidates[0][0]);r._inferido=true;}
    }
    return r;
  });
}
/** Representación de lectura: nunca se duplica un cobro en WIN Anotaciones. */
function winDistributedReceipts_(rows){
  const groups={},byReceipt=new Map();
  rows.filter(r=>r[9]==='ACTIVO').forEach(r=>{
    const id=String(r[0]);
    if(!byReceipt.has(id))byReceipt.set(id,[]);
    byReceipt.get(id).push([r._row||0,...r]);
    const e=groups[id]||(groups[id]={id,tipo:'RendicionDistribuida',origen:'DISTRIBUIDO',turno:String(r[10]||''),fecha:winDateKey_(r[1]),registrado:winTimestamp_(r[6]),responsable:String(r[7]),profesor:String(r[3]),medio:String(r[4]),efectivo:0,transferencia:0,cantidad:0,alumnos:0,categoria:'',concepto:'',nota:String(r[8]||''),estado:'ACTIVA',distribucion:[]});
    const amount=Number(r[5])||0;
    if(r[4]==='Efectivo')e.efectivo+=amount;else if(r[4]==='Transferencia')e.transferencia+=amount;
    if(r[2]){
      const fecha=winDateKey_(r[2]),linea=e.distribucion.find(l=>l.fecha===fecha);
      if(linea)linea.importe=Math.round((linea.importe+amount)*100)/100;
      else e.distribucion.push({fecha,importe:amount});
    }else e.saldoFavor=Math.round(((e.saldoFavor||0)+amount)*100)/100;
  });
  return Object.values(groups).map(e=>({...e,medio:e.efectivo&&e.transferencia?'Mixto':e.efectivo?'Efectivo':'Transferencia',
    version:winHash_(JSON.stringify(byReceipt.get(e.id)))}));
}
function winShiftTotals_(turnoId,initial,entries){
  const allocations=winAllocationTurno_(turnoId);
  return winAddDistributedTotals_(winTotals_(entries||winEntries_(turnoId),initial),allocations);
}
function winPuedeCerrarTurno_(user,titular){
  return user==='Admin'||user===String(titular);
}
function winPuedeCorregirTurno_(user,titular,autor){
  return winPuedeCerrarTurno_(user,titular)||user===String(autor);
}
function winState_(responsable){
  const shifts=winShifts_(),a=winActive_(shifts);
  if(!a)return {turno:null,cierreAnterior:winCajaCierreAnterior_(shifts)};
  const r=a.data;
  const turno={id:String(r[0]),responsable:String(r[3]),fecha:winDateKey_(r[2]),apertura:winTimestamp_(r[4]),saldoInicial:Number(r[6])||0};
  const puedeCerrar=winPuedeCerrarTurno_(responsable,turno.responsable);
  const corregible=e=>winPuedeCorregirTurno_(responsable,turno.responsable,e.responsable);
  const entries=winEntries_(turno.id);
  const clases=entries.filter(e=>e.tipo==='Clase'&&corregible(e));
  if(clases.length){
    const details=new Map(winClassDetailRows_().map(row=>[String(row[0]),row]));
    clases.forEach(e=>{
      const d=details.get(e.id);
      if(d)e.detalleClase={precio:d[10]==='CONFIRMADO'?Number(d[5]):null,porcentaje:Number(d[6]),tipo:String(d[8]),horario:String(d[9]),importeWIN:Number(d[7])};
    });
  }
  const allocations=winAllocationTurno_(turno.id,shifts);
  const totales=winAddDistributedTotals_(winTotals_(entries,turno.saldoInicial),allocations);
  const entradas=[...entries,...winDistributedReceipts_(allocations)].map(e=>({...e,puedeCorregir:corregible(e)}))
    .sort((a,b)=>a.registrado.localeCompare(b.registrado)||a.id.localeCompare(b.id));
  return {turno,entradas,totales,puedeEditar:puedeCerrar,puedeCargar:true,puedeCerrar};
}
function cajaAbierta(p){const user=winAuth_(p);return winLock_(()=>winState_(user));}
function winAllocationTurno_(turnoId,shifts=winShifts_()){
  const filas=winFilasSeleccionadas_('allocations',11,v=>!String(v||'').trim()||String(v).trim()===String(turnoId));
  return winNormalizarAllocationRows_(filas,shifts.slice(1)).filter(r=>String(r[10]||'')===String(turnoId));
}
function winLastClose_(shifts=winShifts_()){const rows=shifts.slice(1).filter(r=>r[1]==='CERRADA');return rows.length?rows[rows.length-1]:null;}
function winCajaCierreAnterior_(shifts){
  const last=winLastClose_(shifts);
  if(!last)return null;
  const value=last[13];
  const amount=(typeof value==='number'||(typeof value==='string'&&value.trim()))?Number(value):NaN;
  return {id:String(last[0]),contado:Number.isFinite(amount)&&amount>=0?amount:null};
}
function winCajaDiferencia_(contado,esperado){
  return (Math.round(contado*100)-Math.round(esperado*100))/100;
}
function abrirCajaCore_(p){
  const user=winAuth_(p);
  return winLock_(()=>{
    if(winActive_())throw Error('Ya hay una caja abierta.');
    const previo=winCajaCierreAnterior_();
    if((previo?previo.id:'')!==String(p.cierreAnteriorId||'')){
      throw Error('El último cierre cambió. Volvé a comparar el efectivo.');
    }
    const contado=winNum_(p.saldoInicial,'efectivo contado en la apertura');
    const anterior=previo?previo.contado:null;
    const diferencia=anterior===null?null:winCajaDiferencia_(contado,anterior);
    const motivo=winStr_(p.motivoTraspaso,400);
    if(diferencia!==null&&diferencia!==0&&!motivo)throw Error('Explicá la diferencia de efectivo al recibir el turno.');
    const id='WG-'+Utilities.getUuid().slice(0,12).toUpperCase(), ts=winNow_();
    winTab_('shifts').appendRow([id,'ABIERTA',winDate_(),user,ts,'',contado,0,0,0,0,0,contado,'','','']);
    winTab_('audit').appendRow([ts,user,'APERTURA_M01','',id,JSON.stringify({
      cierreAnteriorId:previo?previo.id:null,saldoCierreAnterior:anterior,contado,diferencia,motivo,
      estado:diferencia===null?'SIN_REFERENCIA':diferencia?'INCIDENCIA_ABIERTA':'COINCIDE'
    })]);
    return winState_(user);
  });
}
function winValidateEntry_(x,previous=null){
  const type=winStr_(x.tipo),date=winDateKey_(x.fecha||previous?.[2]||winDate_());
  winValidDate_(date);if(date>winDate_())throw Error('No se permite actividad futura.');
  const e={tipo:type,fecha:date,categoria:'',cantidad:0,alumnos:0,profesor:'',efectivo:0,transferencia:0,importe:0,medio:'',concepto:winStr_(x.concepto),nota:winStr_(x.nota)};
  if(type==='Reserva'){
    if(!['Abonos','Regulares'].includes(x.categoria))throw Error('Categoría inválida.');
    e.categoria=x.categoria;e.cantidad=winQty_(x.cantidad,'reservas');
    e.efectivo=winNum_(x.efectivo,'efectivo');e.transferencia=winNum_(x.transferencia,'transferencia');
  }else if(type==='Clase'){
    e.cantidad=winQty_(x.cantidad,'clases');
    e.alumnos=x.tipoClase==='Clase-partido'&&(x.alumnos==null||x.alumnos===''||Number(x.alumnos)===0)?0:winQty_(x.alumnos,'alumnos');
    if(e.alumnos>4)throw Error('Elegí entre 1 y 4 alumnos.');
    e.profesor=winProfessor_(x.profesor);
  }else if(type==='Rendicion'){
    e.profesor=winProfessor_(x.profesor);
    e.efectivo=winNum_(x.efectivo,'efectivo');e.transferencia=winNum_(x.transferencia,'transferencia');
    if(e.efectivo+e.transferencia<=0)throw Error('Indicá un importe.');
    e.cantidad=x.cantidad===undefined||x.cantidad===''||Number(x.cantidad)===0?0:winQty_(x.cantidad,'clases rendidas');
  }else if(type==='Evento'){
    e.categoria=['Cancha abierta','Torneo'].find(c=>c.toLowerCase()===winStr_(x.categoria).toLowerCase())||'';
    if(!e.categoria)throw Error('Evento inválido.');
    e.cantidad=winQty_(x.cantidad,'inscriptos');
    e.concepto=winStr_(x.responsableEvento,120);if(!e.concepto)throw Error('Indicá el responsable del evento.');
    e.efectivo=winNum_(x.efectivo,'efectivo cobrado');e.transferencia=winNum_(x.transferencia,'transferencia cobrada');
    // Ambos en cero registran actividad, sin generar asientos financieros.
    // Una inscripción no multiplica el cobro. No genera otra rendición.
  }else if(type==='Tienda'||type==='Otro ingreso'){
    if(type==='Otro ingreso'&&!e.concepto)throw Error('Indicá concepto.');
    e.efectivo=winNum_(x.efectivo,'efectivo');e.transferencia=winNum_(x.transferencia,'transferencia');
    if(e.efectivo+e.transferencia<=0)throw Error('Indicá un importe.');
  }else if(type==='Gasto'||type==='Retiro'){
    if(!e.concepto)throw Error(type==='Retiro'?'Indicá el motivo del retiro.':'Indicá concepto.');
    if(type==='Gasto'){
      e.categoria=winExpenseCategory_(x.categoria);
      if(e.categoria.toLowerCase()==='comisiones')throw Error('Comisiones pertenece a R.N en el Excel; no se registra como gasto.');
      e.nota=winExpenseNote_(e.nota,x.subcategoria);
      if(e.categoria&&!winExpenseCategories_().includes(e.categoria)&&!Object.prototype.hasOwnProperty.call(WIN_GASTOS_RECEPCION,e.categoria)&&
        !(previous&&previous[5]==='Gasto'&&winExpenseCategory_(previous[6])===e.categoria))throw Error('Categoría de gasto inválida.');
    }else{
      const destinatario=winStr_(x.destinatario,120);
      const retiroHistorico=previous?.[5]==='Retiro'&&!winRetiroNote_(previous[15]).destinatario;
      if(!destinatario&&!retiroHistorico)throw Error('Indicá quién recibió el efectivo retirado.');
      if(destinatario)e.nota='WIN-M01-RETIRO:'+JSON.stringify({v:1,destinatario,nota:e.nota});
    }
    e.importe=winNum_(x.importe,'importe',false);e.medio=type==='Retiro'?'Efectivo':winStr_(x.medio);
    if(!['Efectivo','Transferencia'].includes(e.medio))throw Error('Medio inválido.');
  }else throw Error('Tipo inválido.');
  return e;
}
function guardarAnotacionCore_(p){
  const user=winAuth_(p);
  return winLock_(()=>{
    const a=winActive_();
    if(!a||String(a.data[0])!==String(p.turnoId))throw Error('La caja original de la carga ya no está abierta.');
    const ts=winNow_(),raw={...p.anotacion};
    const e=winValidateEntry_({...raw,fecha:raw.fecha||winFechaActividadCaja_(a.data,ts)});
    if(e.tipo==='Rendicion')throw Error('Usá el formulario único de Rendición.');
    if(['Reserva','Clase','Evento'].includes(e.tipo))winPrepararActividad_(e,raw,a.data,null,ts);
    winControlSalidaCaja_(e,a.data,null);
    const id='AN-'+Utilities.getUuid();
    winTab_('entries').appendRow([id,p.turnoId,e.fecha,ts,user,e.tipo,e.categoria,e.cantidad,e.alumnos,e.profesor,e.efectivo,e.transferencia,e.importe,e.medio,e.concepto,e.nota,'ACTIVA','']);
    if(e.tipo==='Clase'){
      if(e.cantidad!==1)throw Error('Registrá una clase por movimiento.');
      winSaveClassDetail_(id,e,raw,user);
      winAvisoClase_(id,p.turnoId,user,null,e);
    }
    return winState_(user);
  });
}
function anularAnotacionCore_(p){
  const user=winAuth_(p);
  return winLock_(()=>{
    const a=winActive_();
    if(!a||String(a.data[0])!==String(p.turnoId))throw Error('El turno está cerrado.');
    const sh=winTab_('entries'),rows=sh.getDataRange().getValues();
    const idx=rows.findIndex((r,i)=>i>0&&String(r[0])===String(p.id)&&String(r[1])===String(p.turnoId)&&r[16]==='ACTIVA');
    if(idx<1)throw Error('No se encontró una anotación activa.');
    const old=rows[idx];
    if(winNotaMovimiento_(old[15]).devolucionSaldo)throw Error('Esta devolución está vinculada a un saldo de profesor. Revisala con Administración.');
    if(!winPuedeCorregirTurno_(user,a.data[3],old[4]))throw Error('Como colaborador, solo podés anular tus propias cargas.');
    if(String(old[5])==='Rendicion')winValidateReceiptChange_(String(p.id),null);
    winValidarCreditoClase_(old,null);
    sh.getRange(idx+1,17).setValue('ANULADA');
    if(String(old[5])==='Clase'){winCancelClassDetail_(String(p.id));winAvisoClase_(String(p.id),p.turnoId,user,old,null);}
    winTab_('audit').appendRow([winNow_(),user,'ANULACION',p.id,p.turnoId,winStr_(p.motivo||'Corrección durante turno')]);
    return winState_(user);
  });
}
function cerrarCajaCore_(p){
  const user=winAuth_(p);
  return winLock_(()=>{
    const a=winActive_();
    if(!a||String(a.data[0])!==String(p.turnoId))throw Error('El turno no está abierto.');
    const r=a.data;
    if(!winPuedeCerrarTurno_(user,r[3]))throw Error('Solo el titular o Administración pueden cerrar la caja.');
    const t=winShiftTotals_(p.turnoId,Number(r[6])||0);
    const esperado=Math.round(t.esperado*100)/100, transferenciaEsperada=Math.round(t.transferencia*100)/100;
    const contado=winNum_(p.contado,'efectivo contado');
    const comprobado=winNum_(p.transferenciaComprobada,'monto de los comprobantes');
    const comprobantes=winNum_(p.cantidadComprobantes,'cantidad de comprobantes');
    if(!Number.isSafeInteger(comprobantes))throw Error('Ingresá una cantidad entera de comprobantes.');
    if((comprobantes===0)!==(comprobado===0))throw Error('Completá el importe y la cantidad real de comprobantes.');
    if(typeof p.efectivoVisto!=='number'||esperado!==p.efectivoVisto||
        transferenciaEsperada!==winNum_(p.transferenciaVista,'transferencia esperada vista')){
      throw Error('Los totales cambiaron. Actualizá y revisá los movimientos antes de cerrar.');
    }
    const diferencia=winCajaDiferencia_(contado,esperado);
    const diferenciaTransferencia=winCajaDiferencia_(comprobado,transferenciaEsperada);
    const excepcional=diferencia!==0||diferenciaTransferencia!==0;
    const observaciones=winStr_(p.observaciones,400);
    const verificaciones=winStr_(p.verificaciones,400);
    if(excepcional&&(!observaciones||!verificaciones||p.avisadoAdmin!==true)){
      throw Error('Para cerrar con diferencia, registrá el motivo y las verificaciones, y confirmá que avisaste a Administración.');
    }
    const ts=winNow_();
    winTab_('shifts').getRange(a.row,1,1,16).setValues([[p.turnoId,'CERRADA',r[2],r[3],r[4],ts,r[6],
      t.efectivo,transferenciaEsperada,t.gastosEfectivo,t.gastosTransferencia,t.retiros,esperado,contado,diferencia,observaciones]]);
    winTab_('audit').appendRow([ts,user,'CIERRE','',p.turnoId,'Contado: '+contado+' / diferencia: '+diferencia]);
    winTab_('audit').appendRow([ts,user,'CONTROL_CIERRE_M01','',p.turnoId,JSON.stringify({
      efectivoEsperado:esperado,efectivoContado:contado,diferencia,transferenciaEsperada,
      transferenciaComprobada:comprobado,diferenciaTransferencia,cantidadComprobantes:comprobantes,
      estado:excepcional?'INCIDENCIA_ABIERTA':'CONCILIADO',observaciones,
      verificaciones:excepcional?verificaciones:'',avisadoAdmin:excepcional
    })]);
    return {id:p.turnoId,fecha:winDateKey_(r[2]),esperado,contado,diferencia,diferenciaTransferencia,excepcional};
  });
}
/** Conciliación general por fecha de apertura del turno. Las actas se agregan a auditoría. */
function winJornadasCaja_(){
  const shifts=winShifts_().slice(1);
  const dias=new Map(),fechaPorTurno=new Map(),controlados=new Set(),controles=new Map();
  shifts.forEach(r=>{
    const fecha=winDateKey_(r[2]);
    if(!dias.has(fecha))dias.set(fecha,[]);
    dias.get(fecha).push(r);
    fechaPorTurno.set(String(r[0]),fecha);
  });
  const audit=winTab_('audit').getDataRange().getValues().slice(1);
  audit.forEach((r,orden)=>{
    if(r[2]==='CONTROL_CIERRE_M01'&&fechaPorTurno.has(String(r[4])))controlados.add(fechaPorTurno.get(String(r[4])));
    if(r[2]==='CONTROL_JORNADA_M01'){
      try{
        const dato=JSON.parse(r[5]);
        if(dato.fecha&&Array.isArray(dato.turnos))controles.set(dato.fecha,{...dato,autor:String(r[1]),registrado:winTimestamp_(r[0]),orden});
      }catch(e){}
    }
  });
  const correcciones=winCajaCorrecciones_(audit);
  correcciones.forEach(c=>{if(dias.has(c.jornada))controlados.add(c.jornada);});
  return {shifts,dias,controlados,controles,correcciones};
}
function winJornadaCajaPermite_(turnos,anterior,user){
  return turnos.every(r=>r[1]==='CERRADA')&&
    (anterior||winPuedeCerrarTurno_(user,turnos[turnos.length-1][3]));
}
function jornadasCaja(p){
  const user=winAuth_(p);
  return winLock_(()=>{
    const {dias,controlados,controles,correcciones}=winJornadasCaja_();
    const porFecha=new Map();
    correcciones.forEach(c=>{
      if(!porFecha.has(c.jornada))porFecha.set(c.jornada,[]);
      porFecha.get(c.jornada).push(c);
    });
    const hoy=winDate_();
    return [...controlados].filter(fecha=>fecha<=hoy).sort().reverse().flatMap(fecha=>{
      const turnos=dias.get(fecha),control=controles.get(fecha);
      const propuestas=porFecha.get(fecha)||[];
      const pendientes=propuestas.some(c=>c.estado==='PENDIENTE');
      const revisar=propuestas.some(c=>c.orden>(control?.orden??-1)&&c.estado!=='PENDIENTE'&&
        (c.estado==='RECHAZADA'||control?.propuestas===undefined||!control.propuestas.includes(c.id)));
      const mismosTurnos=control&&!revisar&&winEqual_(control.turnos,turnos.map(r=>String(r[0])));
      const anterior=fecha<hoy,habilitada=!!mismosTurnos||winJornadaCajaPermite_(turnos,anterior,user);
      if(anterior&&((mismosTurnos&&!pendientes)||!habilitada))return [];
      const estado=mismosTurnos?(control.estado==='INCIDENCIA_ABIERTA'?control.estado:pendientes?'CONCILIADO_PROVISIONALMENTE':'CONCILIADO'):'PENDIENTE';
      return [{fecha,anterior,estado,habilitada}];
    });
  });
}
function winDetalleJornadaCaja_(fecha,ctx){
  const turnos=ctx.dias.get(fecha);
  if(fecha>winDate_()||!ctx.controlados.has(fecha)||!turnos?.length)throw Error('No hay cierres con control de caja para esa jornada.');
  if(turnos.some(r=>r[1]!=='CERRADA'))throw Error('Cerrá todas las cajas de esta jornada antes de conciliar.');
  const importes=new Map(turnos.map(r=>[String(r[0]),0]));
  const efectivo=new Map(turnos.map(r=>[String(r[0]),0]));
  const candidatos=new Map(ctx.correcciones.filter(a=>a.estado==='PENDIENTE'&&a.jornada===fecha).map(a=>[a.movimiento,a]));
  const propuestas=[];
  const sumar=(id,importe)=>{
    if(importes.has(id))importes.set(id,importes.get(id)+Math.round((Number(importe)||0)*100));
  };
  winTab_('entries').getDataRange().getValues().slice(1).forEach(r=>{
    if(r[16]!=='ACTIVA'||!importes.has(String(r[1])))return;
    if(['Reserva','Rendicion','Otro ingreso','Tienda','Evento'].includes(r[5]))sumar(String(r[1]),r[11]);
    const c=candidatos.get(String(r[0]));
    if(c&&c.version===winReviewMovementVersion_(r)){
      sumar(c.turno,c.despues.transferencia-c.antes.transferencia);
      efectivo.set(c.turno,efectivo.get(c.turno)+winCajaDiferencia_(c.despues.saldo,c.antes.saldo));
      propuestas.push(c.id);
    }
  });
  const allocations=winAllocationRows_(ctx.shifts).filter(r=>importes.has(String(r[10]))&&r[9]==='ACTIVO');
  allocations.forEach(r=>{if(r[4]==='Transferencia')sumar(String(r[10]),r[5]);});
  const cobros=candidatos.size?new Map(winDistributedReceipts_(allocations).map(e=>[e.id,e])):new Map();
  candidatos.forEach(c=>{
    if(!c.nuevo&&(c.origen!=='DISTRIBUIDO'||cobros.get(c.movimiento)?.version!==c.version))return;
    sumar(c.turno,c.despues.transferencia-c.antes.transferencia);
    efectivo.set(c.turno,efectivo.get(c.turno)+winCajaDiferencia_(c.despues.saldo,c.antes.saldo));
    propuestas.push(c.id);
  });
  const desglose=turnos.map(r=>({responsable:String(r[3]),apertura:winTimestamp_(r[4]),transferencia:importes.get(String(r[0]))/100,
    ajusteEfectivo:efectivo.get(String(r[0]))}));
  const version=winHash_(JSON.stringify([...importes]));
  const base=ctx.controles.get(fecha)||null;
  const rechazadas=base&&ctx.correcciones.some(c=>c.jornada===fecha&&c.orden>base.orden&&c.estado==='RECHAZADA');
  const control=base?{...base,estado:base.diferencia?'INCIDENCIA_ABIERTA':propuestas.length?'CONCILIADO_PROVISIONALMENTE':'CONCILIADO'}:null;
  return {fecha,desglose,version,esperado:[...importes.values()].reduce((a,b)=>a+b,0)/100,
    control,propuestas,actualizado:!!control&&!rechazadas&&control.version===version};
}
function detalleJornadaCaja(p){
  winAuth_(p);
  return winLock_(()=>winDetalleJornadaCaja_(winValidDate_(winDateKey_(p.fecha)),winJornadasCaja_()));
}
function conciliarJornadaCajaCore_(p){
  const user=winAuth_(p),fecha=winValidDate_(winDateKey_(p.fecha)),ctx=winJornadasCaja_();
  const detalle=winDetalleJornadaCaja_(fecha,ctx),turnos=ctx.dias.get(fecha);
  const anterior=fecha<winDate_();
  if(!winJornadaCajaPermite_(turnos,anterior,user))throw Error('El titular del último turno o Administración confirma la jornada de hoy.');
  if(detalle.actualizado)throw Error('Esta jornada ya tiene un control registrado. Volvé a consultar el detalle.');
  if(p.version!==detalle.version)throw Error('Cambiaron los turnos o las transferencias. Volvé a consultar la jornada.');
  const comprobado=winNum_(p.comprobado,'total de comprobantes');
  const cantidad=winNum_(p.cantidad,'cantidad de comprobantes');
  if(!Number.isSafeInteger(cantidad)||(cantidad===0)!==(comprobado===0))throw Error('Revisá la cantidad entera y el importe real de los comprobantes.');
  const diferencia=winCajaDiferencia_(comprobado,detalle.esperado);
  const motivo=winStr_(p.motivo,400),verificaciones=winStr_(p.verificaciones,400);
  if(diferencia&&(!motivo||!verificaciones||p.avisadoAdmin!==true)){
    throw Error('Registrá el motivo, qué verificaste y confirmá el aviso a Administración.');
  }
  const registrado=winNow_(),estado=diferencia?'INCIDENCIA_ABIERTA':detalle.propuestas.length?'CONCILIADO_PROVISIONALMENTE':'CONCILIADO';
  const cierreFinal=winDateKey_(turnos[turnos.length-1][5]);
  const posteriorAlCierre=anterior&&(cierreFinal<winDateKey_(registrado)||
    (ctx.dias.get(winDateKey_(registrado))||[]).length>0);
  const acta={fecha,version:detalle.version,turnos:turnos.map(r=>String(r[0])),
    esperado:detalle.esperado,comprobado,cantidad,diferencia,estado,regularizado:posteriorAlCierre,propuestas:detalle.propuestas,
    motivo,verificaciones,avisadoAdmin:!!diferencia&&p.avisadoAdmin===true};
  winTab_('audit').appendRow([registrado,user,'CONTROL_JORNADA_M01','','',JSON.stringify(acta)]);
  return {fecha,estado,comprobado,diferencia,registrado,autor:user};
}
function conciliarJornadaCaja(p){return winMutation_(p,'conciliarJornadaCaja',conciliarJornadaCajaCore_);}

/** Los controles conservan la diferencia original. Administración agrega revisiones al historial. */
function winIncidenciasCaja_(){
  const porTurno=new Map(winShifts_().slice(1).map(r=>[String(r[0]),winDateKey_(r[2])]));
  const incidencias=new Map();
  const diferencias=(medio,esperado,verificado,diferencia)=>({medio,esperado,verificado,diferencia});
  const origenes={APERTURA_M01:'TRASPASO',CONTROL_CIERRE_M01:'CIERRE',CONTROL_JORNADA_M01:'JORNADA'};
  winTab_('audit').getDataRange().getValues().slice(1).forEach(r=>{
    const origen=origenes[r[2]],revision=r[2]==='REVISION_INCIDENCIA_CAJA_M01';
    if(!origen&&!revision)return;
    let datos;
    try{datos=JSON.parse(r[5]);}catch(e){return;}
    if(!datos||typeof datos!=='object')return;
    const fechaHora=winTimestamp_(r[0]),usuario=String(r[1]);
    if(revision){
      const anterior=incidencias.get(String(r[3]));
      if(!anterior||datos.versionAnterior!==anterior.version||!['INCIDENCIA_ABIERTA','EN_REVISION','RESUELTA'].includes(datos.estado))return;
      anterior.estado=datos.estado;
      anterior.revisiones.push({estado:datos.estado,nota:winStr_(datos.nota,400),usuario,fechaHora});
      anterior.version=winHash_(JSON.stringify([anterior.version,fechaHora,usuario,r[5]]));
      return;
    }
    if(datos.estado!=='INCIDENCIA_ABIERTA')return;
    const turnoId=String(r[4]||''),fecha=origen==='JORNADA'?datos.fecha:porTurno.get(turnoId)||winDateKey_(r[0]);
    if(!/^\d{4}-\d{2}-\d{2}$/.test(String(fecha||'')))return;
    const version=winHash_(JSON.stringify([r[2],turnoId,fechaHora,usuario,r[5]]));
    const id=origen==='JORNADA'?origen+'-'+version:origen+'-'+turnoId;
    if((origen!=='JORNADA'&&!turnoId)||incidencias.has(id))return;
    const detalle=origen==='TRASPASO'?
      [diferencias('Efectivo',datos.saldoCierreAnterior,datos.contado,datos.diferencia)]:
      origen==='CIERRE'?
        [diferencias('Efectivo',datos.efectivoEsperado,datos.efectivoContado,datos.diferencia),
          diferencias('Transferencias',datos.transferenciaEsperada,datos.transferenciaComprobada,datos.diferenciaTransferencia)]:
        [diferencias('Transferencias',datos.esperado,datos.comprobado,datos.diferencia)];
    const discrepancias=detalle.filter(d=>Number.isFinite(d.diferencia)&&d.diferencia!==0);
    if(!discrepancias.length)return;
    incidencias.set(id,{id,version,origen,turnoId,fecha,fechaHora,usuario,estado:datos.estado,
      diferencias:discrepancias,motivo:winStr_(datos.motivo||datos.observaciones,400),
      verificaciones:winStr_(datos.verificaciones,400),avisadoAdmin:datos.avisadoAdmin===true,revisiones:[]});
  });
  return [...incidencias.values()].reverse();
}
function adminIncidenciasCaja(p){
  winAdmin_(p);
  const filtro=p.filtro||'PENDIENTES';
  if(!['PENDIENTES','RESUELTAS','TODAS'].includes(filtro))throw Error('Filtro inválido.');
  const fecha=p.fecha?winValidDate_(winDateKey_(p.fecha)):'';
  const pagina=p.pagina===undefined?1:winNum_(p.pagina,'página',false);
  if(!Number.isSafeInteger(pagina))throw Error('Página inválida.');
  return winLock_(()=>{
    const coincidencias=winIncidenciasCaja_().filter(i=>(!fecha||i.fecha===fecha)&&
      (filtro==='TODAS'||(filtro==='RESUELTAS'?i.estado==='RESUELTA':i.estado!=='RESUELTA')));
    const total=coincidencias.length,paginas=Math.max(1,Math.ceil(total/25)),actual=Math.min(pagina,paginas);
    return {total,paginas,pagina:actual,incidencias:coincidencias.slice((actual-1)*25,actual*25)};
  });
}
function adminRevisarIncidenciaCajaCore_(p){
  const user=winAdmin_(p),id=winStr_(p.id,120),nota=winStr_(p.nota,400);
  if(!nota)throw Error('Indicá qué verificaste o cómo se resolvió la incidencia.');
  const registro=winIncidenciasCaja_().find(i=>i.id===id);
  if(!registro)throw Error('No se encontró la incidencia.');
  if(registro.version!==p.version)throw Error('La incidencia cambió. Actualizá la consulta.');
  const estado=winStr_(p.estado);
  const permitidos=registro.estado==='RESUELTA'?['INCIDENCIA_ABIERTA']:
    registro.estado==='INCIDENCIA_ABIERTA'?['EN_REVISION','RESUELTA']:['RESUELTA'];
  if(!permitidos.includes(estado))throw Error('Ese cambio de estado no está permitido.');
  const fechaHora=winNow_();
  winTab_('audit').appendRow([fechaHora,user,'REVISION_INCIDENCIA_CAJA_M01',id,registro.turnoId,
    JSON.stringify({anterior:registro.estado,estado,nota,versionAnterior:registro.version})]);
  return {id,estado,fechaHora,usuario:user};
}
function adminRevisarIncidenciaCaja(p){
  winAdmin_(p);
  return winMutation_(p,'adminRevisarIncidenciaCaja',adminRevisarIncidenciaCajaCore_);
}
/** Suma cada imputación una vez por fecha de cobro; nunca por fecha de actividad. */
function winAddDistributedTotals_(totals,rows){
  const cashBefore=totals.efectivo;
  rows.filter(r=>r[9]==='ACTIVO').forEach(r=>{
    if(r[4]==='Efectivo')totals.efectivo+=Number(r[5])||0;
    else if(r[4]==='Transferencia')totals.transferencia+=Number(r[5])||0;
  });
  if(typeof totals.esperado==='number')totals.esperado+=totals.efectivo-cashBefore;
  return totals;
}
function winBreakdown_(entries,allocations){
  const ingresos={},gastos={};
  const add=(target,categoria,medio,importe)=>{
    const r=target[categoria]||(target[categoria]={categoria,efectivo:0,transferencia:0,total:0});
    if(medio==='Efectivo')r.efectivo+=importe;else if(medio==='Transferencia')r.transferencia+=importe;
    r.total=r.efectivo+r.transferencia;
  };
  entries.forEach(e=>{
    const category={Reserva:'Reservas',Rendicion:'Clases',Evento:'Eventos',Tienda:'Tienda','Otro ingreso':'Otros Ingresos'}[e.tipo];
    if(category){add(ingresos,category,'Efectivo',e.efectivo);add(ingresos,category,'Transferencia',e.transferencia);}
    else if(e.tipo==='Gasto')add(gastos,e.categoria||'Gastos de recepción',e.medio,e.importe);
  });
  allocations.filter(r=>r[9]==='ACTIVO').forEach(r=>add(ingresos,r[2]?'Clases':'Saldos a favor de profesores',String(r[4]),Number(r[5])||0));
  return {ingresos:Object.values(ingresos),gastos:Object.values(gastos)};
}
function winMonetaryOccupancy_(period,breakdown){
  let horas=0;const end=new Date(period.hasta+'T12:00:00Z');
  for(let d=new Date(period.desde+'T12:00:00Z');d<=end;d.setUTCDate(d.getUTCDate()+1))horas+=d.getUTCDay()===0?48:60;
  const capacity=horas*60000,income=breakdown.ingresos.filter(r=>['Reservas','Clases'].includes(r.categoria)).reduce((sum,r)=>sum+r.total,0);
  return {ingresos:income,capacidadTeorica:capacity,horasCanchaTeoricas:horas,porcentaje:capacity?income/capacity*100:null,base:'Excel: 4 canchas a $60.000/h; lunes a sábado 15 h, domingo 12 h. Es aprovechamiento monetario, no uso físico medido.'};
}
function resumenDiarioCore_(p){winAdmin_(p);const fecha=winDateKey_(p.fecha||winDate_());const entries=winTab_('entries').getDataRange().getValues().slice(1).filter(r=>winDateKey_(r[2])===fecha&&r[16]==='ACTIVA').map(winEntryObject_);const allocs=winTab_('allocations').getDataRange().getValues().slice(1).filter(r=>winDateKey_(r[1])===fecha);return {fecha,totales:winAddDistributedTotals_(winTotals_(entries,0),allocs),movimientos:entries.length,desglose:winBreakdown_(entries,allocs)};}

/** Edición en turno abierto: conserva ID, fecha original de registro y registro de auditoría. */
function editarAnotacionCore_(p){
  const user=winAuth_(p);
  return winLock_(()=>{
    const a=winActive_();
    if(!a||String(a.data[0])!==String(p.turnoId)) throw Error('El turno ya está cerrado.');
    const sh=winTab_('entries'), rows=sh.getDataRange().getValues();
    const idx=rows.findIndex((r,i)=>i>0&&String(r[0])===String(p.id)&&String(r[1])===String(p.turnoId)&&r[16]==='ACTIVA');
    if(idx<1) throw Error('No se encontró la anotación activa.');
    const old=rows[idx];
    if(winNotaMovimiento_(old[15]).devolucionSaldo)throw Error('Esta devolución está vinculada a un saldo de profesor. Revisala con Administración.');
    if(!winPuedeCorregirTurno_(user,a.data[3],old[4]))throw Error('Como colaborador, solo podés editar tus propias cargas.');
    const raw={...p.anotacion},e=winValidateEntry_(raw,old);
    if(['Clase','Rendicion'].includes(e.tipo)&&String(old[9]).trim().toLowerCase()===e.profesor.trim().toLowerCase())e.profesor=String(old[9]);
    // El tipo no cambia: para cambiar de tipo, anular y crear otra anotación.
    if(e.tipo!==String(old[5])||(e.tipo==='Reserva'&&e.categoria!==String(old[6]||''))) throw Error('Para cambiar el tipo o categoría, anulá y creá una anotación nueva.');
    if(e.tipo==='Rendicion')winValidateReceiptChange_(String(p.id),e);
    if(['Reserva','Clase','Evento'].includes(e.tipo))winPrepararActividad_(e,raw,a.data,old,winNow_());
    winValidarCreditoClase_(old,e);
    winControlSalidaCaja_(e,a.data,old);
    const replacement=[old[0],old[1],e.fecha,old[3],old[4],e.tipo,e.categoria,e.cantidad,e.alumnos,e.profesor,e.efectivo,e.transferencia,e.importe,e.medio,e.concepto,e.nota,'ACTIVA','ED-'+Utilities.getUuid()];
    const before=winEntryObject_(old);
    const after=winEntryObject_(replacement);
    if(e.tipo!=='Clase'&&JSON.stringify(before)===JSON.stringify(after)) throw Error('No hay cambios para guardar.');
    // Registrar antes de sobrescribir: si falla auditoría, no se modifica la anotación.
    winTab_('audit').appendRow([winNow_(),user,'EDICION',String(p.id),String(p.turnoId),JSON.stringify({antes:before,despues:after}).slice(0,45000)]);
    sh.getRange(idx+1,1,1,replacement.length).setValues([replacement]);
    if(e.tipo==='Clase'){
      if(e.cantidad!==1)throw Error('Registrá una clase por movimiento.');
      winSaveClassDetail_(String(p.id),e,{...raw,porcentajeWIN:winReceptionPercent_(String(p.id),e.profesor,e.fecha)},user);
      winAvisoClase_(String(p.id),p.turnoId,user,old,e);
    }
    return winState_(user);
  });
}


/** V3 — Panel de administración. Todas las consultas se autorizan en el servidor.
 * Los importes se agrupan por fecha de ACTIVIDAD de cada anotación.
 * Los cierres se agrupan por fecha de CIERRE, independientemente de la actividad.
 */
function winAdmin_(p){
  const user=winAuth_(p);
  if(user!=='Admin') throw Error('Acceso exclusivo de Administración.');
  return user;
}
function winPeriod_(p){
  const desde=winDateKey_(p.desde),hasta=winDateKey_(p.hasta);
  const valid=/^\d{4}-\d{2}-\d{2}$/;
  if(!valid.test(desde)||!valid.test(hasta))throw Error('Seleccioná fechas válidas.');  winValidDate_(desde);winValidDate_(hasta);
  const a=Date.parse(desde+'T12:00:00Z'),b=Date.parse(hasta+'T12:00:00Z');
  if(!Number.isFinite(a)||!Number.isFinite(b)||a>b)throw Error('El período es inválido.');
  if((b-a)/86400000>366)throw Error('Consultá como máximo 367 días por vez.');
  return {desde,hasta};
}
function adminResumenCore_(p){
  winAdmin_(p);
  const periodo=winPeriod_(p);
  const all=winTab_('entries').getDataRange().getValues().slice(1);
  const rows=all.filter(r=>r[16]==='ACTIVA'&&winDateKey_(r[2])>=periodo.desde&&winDateKey_(r[2])<=periodo.hasta);
  const entries=rows.map(winEntryObject_);
  const totals=winTotals_(entries,0);
  const perDay={};const perTeacher={};
  entries.forEach(e=>{
    if(!perDay[e.fecha])perDay[e.fecha]={fecha:e.fecha,abonos:0,regulares:0,clases:0,ingresos:0,gastos:0,retiros:0};
    const d=perDay[e.fecha];
    if(e.tipo==='Reserva'){
      d[e.categoria==='Abonos'?'abonos':'regulares']+=e.cantidad;
      d.ingresos+=e.efectivo+e.transferencia;
    }else if(e.tipo==='Clase'){
      d.clases+=e.cantidad;
      if(!perTeacher[e.profesor])perTeacher[e.profesor]={profesor:e.profesor,dictadas:0,rendidas:0,efectivo:0,transferencia:0};
      perTeacher[e.profesor].dictadas+=e.cantidad;
    }else if(e.tipo==='Rendicion'){
      d.ingresos+=e.efectivo+e.transferencia;
      if(!perTeacher[e.profesor])perTeacher[e.profesor]={profesor:e.profesor,dictadas:0,rendidas:0,efectivo:0,transferencia:0};
      perTeacher[e.profesor].rendidas+=e.cantidad;
      perTeacher[e.profesor].efectivo+=e.efectivo;
      perTeacher[e.profesor].transferencia+=e.transferencia;
    }else if(e.tipo==='Otro ingreso'||e.tipo==='Tienda'||e.tipo==='Evento')d.ingresos+=e.efectivo+e.transferencia;
    else if(e.tipo==='Gasto')d.gastos+=e.importe;
    else if(e.tipo==='Retiro')d.retiros+=e.importe;
  });
  const allocs=winTab_('allocations').getDataRange().getValues().slice(1).filter(r=>r[9]==='ACTIVO');
  const cobrados=allocs.filter(r=>winDateKey_(r[1])>=periodo.desde&&winDateKey_(r[1])<=periodo.hasta);
  winAddDistributedTotals_(totals,cobrados);
  cobrados.forEach(r=>{const name=String(r[3]);const teacher=perTeacher[name]||(perTeacher[name]={profesor:name,dictadas:0,rendidas:0,efectivo:0,transferencia:0});if(r[4]==='Efectivo')teacher.efectivo+=Number(r[5])||0;else if(r[4]==='Transferencia')teacher.transferencia+=Number(r[5])||0;});
  const cobrosPeriodo=cobrados.reduce((a,r)=>a+(Number(r[5])||0),0);
  const atribuidoPeriodo=allocs.filter(r=>winDateKey_(r[2])>=periodo.desde&&winDateKey_(r[2])<=periodo.hasta).reduce((a,r)=>a+(Number(r[5])||0),0);
  allocs.forEach(r=>{const cobro=winDateKey_(r[1]);if(cobro>=periodo.desde&&cobro<=periodo.hasta){if(!perDay[cobro])perDay[cobro]={fecha:cobro,abonos:0,regulares:0,clases:0,ingresos:0,gastos:0,retiros:0};perDay[cobro].ingresos+=(Number(r[5])||0);}const fecha=winDateKey_(r[2]);if(fecha>=periodo.desde&&fecha<=periodo.hasta){if(!perDay[fecha])perDay[fecha]={fecha,abonos:0,regulares:0,clases:0,ingresos:0,gastos:0,retiros:0};perDay[fecha].atribuido=(perDay[fecha].atribuido||0)+(Number(r[5])||0);}});
  const closes=winTab_('shifts').getDataRange().getValues().slice(1).filter(r=>r[1]==='CERRADA'&&winDateKey_(r[5])>=periodo.desde&&winDateKey_(r[5])<=periodo.hasta).map(r=>({id:String(r[0]),responsable:String(r[3]),cierre:String(r[5]),esperado:Number(r[12])||0,contado:Number(r[13])||0,diferencia:Number(r[14])||0}));
  const desglose=winBreakdown_(entries,cobrados);
  return {periodo,desglose,ocupacionMonetaria:winMonetaryOccupancy_(periodo,desglose),ocupacionReal:null,totales:totals,movimientos:entries.length,cobrosDistribuidosPeriodo:cobrosPeriodo,atribuidoPeriodo:atribuidoPeriodo,
    dias:Object.values(perDay).sort((a,b)=>b.fecha.localeCompare(a.fecha)),
    profesores:Object.values(perTeacher).sort((a,b)=>a.profesor.localeCompare(b.profesor)),
    cierres:closes.reverse(),
    resultadoOperativo:totals.efectivo+totals.transferencia-totals.gastosEfectivo-totals.gastosTransferencia-
      cobrados.filter(r=>!r[2]).reduce((sum,r)=>sum+(Number(r[5])||0),0)};
}


/** WIN V3.1 — Consultas y revisión exclusiva de Admin.
 * Los movimientos históricos nunca se borran ni se reescriben al revisar.
 */
function adminControlDiarioCore_(p){
  winAdmin_(p);
  const fecha=winDateKey_(p.fecha);
  winValidDate_(fecha);
  const rows=winTab_('entries').getDataRange().getValues().slice(1)
    .filter(r=>winDateKey_(r[2])===fecha)
    .map(r=>({...winEntryObject_(r),estado:String(r[16]||'')}));
  const shifts=winTab_('shifts').getDataRange().getValues().slice(1)
    .filter(r=>winDateKey_(r[2])===fecha)
    .map(r=>({id:String(r[0]),estado:String(r[1]),responsable:String(r[3]),apertura:String(r[4]),cierre:String(r[5]||''),esperado:r[1]==='ABIERTA'?winShiftTotals_(String(r[0]),Number(r[6])||0).esperado:Number(r[12])||0,contado:r[13]===''?null:Number(r[13]),diferencia:r[14]===''?null:Number(r[14]),observaciones:String(r[15]||'')}));
  const reviews=winTab_('reviews').getDataRange().getValues().slice(1).filter(r=>winDateKey_(r[0])===fecha);
  const last=reviews.length?reviews[reviews.length-1]:null;
  const distribuidos=winTab_('allocations').getDataRange().getValues().slice(1)
    .filter(r=>r[9]==='ACTIVO'&&(winDateKey_(r[1])===fecha||winDateKey_(r[2])===fecha))
    .map(r=>({id:String(r[0]),fechaCobro:winDateKey_(r[1]),fechaActividad:winDateKey_(r[2]),profesor:String(r[3]),medio:String(r[4]),importe:Number(r[5])||0,registrado:winTimestamp_(r[6]),usuario:String(r[7]),observaciones:String(r[8]||''),turno:String(r[10]||'')}));
  const receipts=winDistributedReceipts_(winTab_('allocations').getDataRange().getValues().slice(1).filter(r=>winDateKey_(r[1])===fecha));
  return {fecha,movimientos:[...rows,...receipts],turnos:shifts,cobrosDistribuidos:distribuidos,revision:last?{estado:String(last[5]||'')===winFingerprint_(fecha)?String(last[1]):'PENDIENTE',usuario:String(last[2]),fechaHora:String(last[3]),observaciones:String(last[4]||'')}:null};
}
function adminRevisarDiaCore_(p){
  const user=winAdmin_(p);
  return winLock_(()=>{
    const fecha=winDateKey_(p.fecha);
    winValidDate_(fecha);
    if(fecha>winDate_())throw Error('No se puede revisar una fecha futura.');
    const status=winStr_(p.estado);
    if(!['REVISADO','OBSERVADO'].includes(status))throw Error('Estado inválido.');
    const shifts=winTab_('shifts').getDataRange().getValues().slice(1).filter(r=>winDateKey_(r[2])===fecha);
    if(!shifts.length)throw Error('No hay turnos registrados para esta fecha.');
    if(shifts.some(r=>r[1]!=='CERRADA'))throw Error('Hay turnos sin cerrar.');
    const notes=winStr_(p.observaciones,1000);
    if(status==='OBSERVADO'&&!notes)throw Error('Indicá la observación.');
    winTab_('reviews').appendRow([fecha,status,user,winNow_(),notes,winFingerprint_(fecha)]);
    winTab_('audit').appendRow([winNow_(),user,'REVISION_DIA','',shifts.map(r=>r[0]).join(', '),fecha+' '+status+' '+notes]);
    return adminControlDiarioCore_(p);
  });
}


/** V3.1.2: las escrituras se preparan en memoria y se confirman mediante
 * un diario recuperable. No borrar WIN_PENDING_V312 ni editar hojas durante
 * una recuperación pendiente. No se guardan PIN ni credenciales en el diario.
 */
let winStage_=null;
function winValidDate_(s){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(s))throw Error('Fecha inválida.');
  const d=new Date(s+'T12:00:00Z');
  if(!Number.isFinite(d.getTime())||d.toISOString().slice(0,10)!==s)throw Error('Fecha inexistente.');
  return s;
}
function winFingerprint_(fecha){
  const entries=winTab_('entries').getDataRange().getValues().slice(1).filter(r=>winDateKey_(r[2])===fecha);
  const shifts=winShifts_().slice(1).filter(r=>winDateKey_(r[2])===fecha);
  const allocations=winTab_('allocations').getDataRange().getValues().slice(1).filter(r=>r[9]==='ACTIVO'&&(winDateKey_(r[1])===fecha||winDateKey_(r[2])===fecha));
  return winHash_(JSON.stringify(allocations.length?{entries,shifts,allocations}:{entries,shifts}));
}
function winStagedTab_(key){
  if(!winStage_.tabs[key]){
    const real=winSheet_().getSheetByName(WIN_TABS[key]);
    if(!real)throw Error('Falta hoja '+WIN_TABS[key]);
    const rows=real.getDataRange().getValues();
    winStage_.tabs[key]={rows:rows.map(r=>r.slice()),before:rows.map(r=>r.slice())};
  }
  const data=winStage_.tabs[key];
  return {
    getDataRange:()=>({getValues:()=>data.rows.map(r=>r.slice())}),
    appendRow:r=>{data.rows.push(r.slice());},
    getRange:(row,col,n=1,m=1)=>({
      setValue:v=>{if(!data.rows[row-1])data.rows[row-1]=[];data.rows[row-1][col-1]=v;},
      setValues:values=>{if(values.length!==n||values.some(r=>r.length!==m))throw Error('Dimensiones inválidas.');values.forEach((r,i)=>{if(!data.rows[row-1+i])data.rows[row-1+i]=[];r.forEach((v,j)=>data.rows[row-1+i][col-1+j]=v);});}
    })
  };
}
function winCells_(row,n){return Array.from({length:n},(_,i)=>row&&row[i]!==undefined?row[i]:'');}
function winEqual_(a,b){return JSON.stringify(a)===JSON.stringify(b);}
function winRecover_(){
  const props=winProps_(),raw=props.getProperty('WIN_PENDING_V312');
  if(!raw)return;
  const op=JSON.parse(raw),ss=winSheet_();
  op.changes.forEach(c=>{['before','after'].forEach(k=>c[k]=c[k].map(v=>v&&typeof v==='object'&&v.winDate?new Date(v.winDate):v));});
  // Primero verificar todas las filas; un cambio externo bloquea la recuperación.
  op.changes.forEach(c=>{
    const sh=ss.getSheetByName(c.sheet);if(!sh)throw Error('Recuperación bloqueada: falta '+c.sheet);
    winCapacity_(sh,c.row,c.after.length);
    const current=sh.getRange(c.row,1,1,c.after.length).getValues()[0];
    if(!winEqual_(current,c.before)&&!winEqual_(current,c.after))throw Error('Recuperación bloqueada por cambio externo. Avisá a Admin; no repitas cargas.');
  });
  op.changes.forEach(c=>{
    const sh=ss.getSheetByName(c.sheet);
    const current=sh.getRange(c.row,1,1,c.after.length).getValues()[0];
    if(!winEqual_(current,c.after))sh.getRange(c.row,1,1,c.after.length).setValues([c.after]);
  });
  if(!WIN_PRUEBAS_CAJA)SpreadsheetApp.flush();
  props.deleteProperty('WIN_PENDING_V312');
}
function winMutationCore_(p,action,fn){
  const user=winAuth_(p);
  if(!p||!/^[a-zA-Z0-9-]{16,80}$/.test(String(p.requestId||'')))throw Error('Solicitud sin identificador. Actualizá la aplicación.');
  const clean={...p};delete clean.pin;delete clean.requestId;
  const hash=winHash_(JSON.stringify({action,p:clean}));
  return winLock_(()=>{
    const prior=winTab_('audit').getDataRange().getValues().slice(1).find(r=>r[2]==='SOLICITUD'&&r[3]===p.requestId);
    if(prior){
      const receipt=JSON.parse(prior[5]);
      if(prior[1]!==user||receipt.hash!==hash)throw Error('Identificador reutilizado con datos diferentes.');
      // Nuevo recibo: confirmar la operación anterior y consultar el estado actual.
      if(action==='adminRegistrarCobroDistribuido'&&receipt.responseType==='cobro-distribuido-v1')return {...receipt.result,distribucion:p.distribucion.map(d=>({fecha:winDateKey_(d.fecha),importe:Number(d.importe)})),estadoTurno:winState_(user)};
      if(action==='corregirCobroDistribuido'&&receipt.responseType==='correccion-cobro-v1')return {...receipt.result,estadoTurno:winState_(user)};
      if(action==='adminRevisarDia'&&receipt.responseType==='revision-dia-v1')return adminControlDiarioCore_({...p,fecha:receipt.result.fecha});
      if(receipt.result===null&&!['abrirCaja','guardarAnotacion','editarAnotacion','anularAnotacion'].includes(action))throw Error('Esta solicitud antigua ya fue procesada. Consultá el resultado antes de repetirla.');
      return receipt.result===null?winState_(user):receipt.result;
    }
    const staged={tabs:{}};let result;
    winStage_=staged;
    try{
      result=fn(p);
      const stateActions=['abrirCaja','guardarAnotacion','editarAnotacion','anularAnotacion'];
      // El recibo certifica la operación; el detalle voluminoso se vuelve a consultar.
      // Los recibos anteriores conservan exactamente su ruta de lectura.
      const compact=action==='adminRevisarDia';
      const stored=compact?{fecha:result.fecha,estado:result.revision.estado,usuario:result.revision.usuario,fechaHora:result.revision.fechaHora}:stateActions.includes(action)?null:result;
      const receipt={hash,result:stored};
      if(compact)receipt.responseType='revision-dia-v1';
      if(action==='adminRegistrarCobroDistribuido'&&Array.isArray(result.distribucion)){receipt.result={...result};delete receipt.result.distribucion;delete receipt.result.estadoTurno;receipt.responseType='cobro-distribuido-v1';}
      if(action==='corregirCobroDistribuido'){receipt.result={...result};delete receipt.result.estadoTurno;receipt.responseType='correccion-cobro-v1';}
      winTab_('audit').appendRow([winNow_(),user,'SOLICITUD',p.requestId,p.turnoId||'',JSON.stringify(receipt)]);
    }finally{winStage_=null;}
    const changes=[];
    Object.keys(staged.tabs).forEach(key=>{
      const t=staged.tabs[key];t.rows.forEach((r,i)=>{
        const n=Math.max(r.length,(t.before[i]||[]).length),before=winCells_(t.before[i],n),after=winCells_(r,n);
        if(!winEqual_(before,after)){
          // Las fórmulas no se aceptan en texto enviado por operadores.
          if(after.some(v=>typeof v==='string'&&/^\s*=/.test(v)))throw Error('No se permiten fórmulas en los campos de texto.');
          changes.push({sheet:WIN_TABS[key],row:i+1,before,after});
        }
      });
    });
    const encoded=changes.map(c=>({...c,before:c.before.map(winJournalCell_),after:c.after.map(winJournalCell_)}));
    const journal=JSON.stringify({requestId:p.requestId,changes:encoded});
    if(Utilities.newBlob(journal).getBytes().length>8500)throw Error('La operación es demasiado extensa; acortá las observaciones. No se guardó.');
    winProps_().setProperty('WIN_PENDING_V312',journal);
    try{winRecover_();}catch(e){throw Error('Operación pendiente de recuperación. Reintentá SIN cambiar los datos ni actualizar la página. Detalle: '+e.message);}
    return result;
  });
}
function abrirCaja(p){return winMutation_(p,'abrirCaja',abrirCajaCore_);}
function guardarAnotacion(p){return winMutation_(p,'guardarAnotacion',guardarAnotacionCore_);}
function editarAnotacion(p){return winMutation_(p,'editarAnotacion',editarAnotacionCore_);}
function anularAnotacion(p){return winMutation_(p,'anularAnotacion',anularAnotacionCore_);}
function cerrarCaja(p){return winMutation_(p,'cerrarCaja',cerrarCajaCore_);}
function adminRevisarDia(p){winAdmin_(p);return winMutation_(p,'adminRevisarDia',adminRevisarDiaCore_);}
function resumenDiario(p){winAdmin_(p);return winLock_(()=>resumenDiarioCore_(p));}
function adminResumen(p){winAdmin_(p);return winLock_(()=>adminResumenCore_(p));}
function adminControlDiario(p){winAdmin_(p);return winStage_?adminControlDiarioCore_(p):winLock_(()=>adminControlDiarioCore_(p));}

function winJournalCell_(v){return v instanceof Date?{winDate:v.toISOString()}:v;}

function winMutation_(p,action,fn){try{return winMutationCore_(p,action,fn);}catch(e){if(winProps_().getProperty('WIN_PENDING_V312'))throw e;throw Error('RECHAZADA: '+e.message);}}

function winCapacity_(sh,row,cols){if(row>sh.getMaxRows())sh.insertRowsAfter(sh.getMaxRows(),row-sh.getMaxRows());if(cols>sh.getMaxColumns())sh.insertColumnsAfter(sh.getMaxColumns(),cols-sh.getMaxColumns());}
/** WIN V4.1 — Cierre administrativo y asientos. No modifica movimientos ni caja. */
function winExportTab_(){
  return winTab_('exports');
}
function winDailyPack_(fecha){
  winValidDate_(fecha);
  const entries=winTab_('entries').getDataRange().getValues().slice(1)
    .filter(r=>r[16]==='ACTIVA'&&winDateKey_(r[2])===fecha).map(winEntryObject_);
  const turns=winTab_('shifts').getDataRange().getValues().slice(1).filter(r=>winDateKey_(r[2])===fecha);
  const professors={};const finance={};
  const allocRows=winTab_('allocations').getDataRange().getValues().slice(1).filter(r=>r[9]==='ACTIVO');
  const cobranzasDistribuidas=allocRows.filter(r=>winDateKey_(r[1])===fecha);
  const atribuidas=allocRows.filter(r=>winDateKey_(r[2])===fecha);
  let abonos=0,regulares=0,clases=0,alumnos=0,retirado=0;
  const add=(tipo,categoria,sub,detalle,medio,importe)=>{
    if(!importe)return;
    const key=JSON.stringify([tipo,categoria,sub,detalle,medio]);
    if(!finance[key])finance[key]={tipo,categoria,subcategoria:sub,detalle,medio,importe:0};
    finance[key].importe+=importe;
  };
  entries.forEach(e=>{
    if(e.tipo==='Reserva'){
      if(e.categoria==='Abonos')abonos+=e.cantidad;else regulares+=e.cantidad;
      add('Ingresos','Reservas',e.categoria,'WIN Gestión · '+e.categoria,'Efectivo',e.efectivo);
      add('Ingresos','Reservas',e.categoria,'WIN Gestión · '+e.categoria,'Transferencia',e.transferencia);
    }else if(e.tipo==='Clase'){
      clases+=e.cantidad;alumnos+=e.cantidad*e.alumnos;
      if(!professors[e.profesor])professors[e.profesor]={profesor:e.profesor,clases:0,alumnos:0,rendido:0};
      professors[e.profesor].clases+=e.cantidad;professors[e.profesor].alumnos+=e.cantidad*e.alumnos;
    }else if(e.tipo==='Rendicion'){
      if(!professors[e.profesor])professors[e.profesor]={profesor:e.profesor,clases:0,alumnos:0,rendido:0};
      professors[e.profesor].rendido+=e.efectivo+e.transferencia;
      add('Ingresos','Clases',e.profesor,'WIN Gestión · Rendición · '+e.profesor,'Efectivo',e.efectivo);
      add('Ingresos','Clases',e.profesor,'WIN Gestión · Rendición · '+e.profesor,'Transferencia',e.transferencia);
    }else if(e.tipo==='Evento'){
      add('Ingresos','Eventos',e.categoria,'WIN Gestión · '+e.categoria+' · '+e.concepto,'Efectivo',e.efectivo);
      add('Ingresos','Eventos',e.categoria,'WIN Gestión · '+e.categoria+' · '+e.concepto,'Transferencia',e.transferencia);
    }else if(e.tipo==='Tienda'){
      add('Ingresos','Tienda','Ventas','WIN Gestión · Ventas tienda','Efectivo',e.efectivo);
      add('Ingresos','Tienda','Ventas','WIN Gestión · Ventas tienda','Transferencia',e.transferencia);
    }else if(e.tipo==='Otro ingreso'){
      add('Ingresos','Otros Ingresos',e.concepto,'WIN Gestión · '+e.concepto,'Efectivo',e.efectivo);
      add('Ingresos','Otros Ingresos',e.concepto,'WIN Gestión · '+e.concepto,'Transferencia',e.transferencia);
    }else if(e.tipo==='Gasto'){
      add('Egresos',e.categoria==='Artículos de limpieza'?'Artíuclos de limpieza':e.categoria||'Gastos de recepción',e.subcategoria==null?e.concepto:e.subcategoria,'WIN Gestión · '+e.concepto,e.medio,-e.importe);
    }else if(e.tipo==='Retiro'){retirado+=e.importe;}
  });
  // Cada cobro se exporta UNA sola vez por fecha real de cobro; las atribuciones no generan asientos adicionales.
  cobranzasDistribuidas.filter(r=>r[2]).forEach(r=>{const name=String(r[3]);add('Ingresos','Clases',name,'WIN Gestión · Rendición distribuida · '+name,String(r[4]),Number(r[5])||0);const teacher=professors[name]||(professors[name]={profesor:name,clases:0,alumnos:0,rendido:0});teacher.rendido+=Number(r[5])||0;});
  const saldoFavor=cobranzasDistribuidas.filter(r=>!r[2]).reduce((sum,r)=>sum+(Number(r[5])||0),0);
  const items=Object.values(finance).sort((a,b)=>[a.tipo,a.categoria,a.subcategoria,a.medio].join('|').localeCompare([b.tipo,b.categoria,b.subcategoria,b.medio].join('|')));
  const ingresos=items.filter(x=>x.importe>0).reduce((s,x)=>s+x.importe,0);
  const egresos=-items.filter(x=>x.importe<0).reduce((s,x)=>s+x.importe,0);
  const fingerprint=winFingerprint_(fecha);
  const exports=winExportTab_().getDataRange().getValues().slice(1).filter(r=>winDateKey_(r[0])===fecha);
  const latest=exports.length?exports[exports.length-1]:null;
  const reviews=winTab_('reviews').getDataRange().getValues().slice(1).filter(r=>winDateKey_(r[0])===fecha);
  const lastReview=reviews.length?reviews[reviews.length-1]:null;
  const reviewed=!!lastReview&&lastReview[1]==='REVISADO'&&String(lastReview[5])===fingerprint;
  return {fecha,actividad:{abonos,regulares,clases,alumnos,eventos:entries.filter(e=>e.tipo==='Evento').length,inscriptos:entries.filter(e=>e.tipo==='Evento').reduce((sum,e)=>sum+e.cantidad,0)},profesores:Object.values(professors).sort((a,b)=>a.profesor.localeCompare(b.profesor)),
    asientos:items,finanzas:{ingresos,egresos,neto:ingresos-egresos,retiros:retirado,...(saldoFavor?{saldoFavor}:{})},
    control:{turnos:turns.length,abiertos:turns.filter(r=>r[1]!=='CERRADA').length,revisado:reviewed,
      cierre:turns.filter(r=>r[1]==='CERRADA').reduce((s,r)=>s+(Number(r[14])||0),0)},
    exportacion:latest?{fechaHora:String(latest[2]),usuario:String(latest[3]),vigente:String(latest[1])===fingerprint,versiones:exports.length,requiereConciliacion:exports.length>0&&String(latest[1])!==fingerprint}:null,
    distribucion:{cobradoHoy:cobranzasDistribuidas.reduce((a,r)=>a+(Number(r[5])||0),0),atribuidoAlDia:atribuidas.reduce((a,r)=>a+(Number(r[5])||0),0),detalle:atribuidas.map(r=>({id:String(r[0]),profesor:String(r[3]),fechaCobro:winDateKey_(r[1]),importe:Number(r[5])||0,medio:String(r[4])}))},
    huella:fingerprint};
}
function adminAsientosDia(p){winAdmin_(p);return winLock_(()=>winDailyPack_(winDateKey_(p.fecha)));}
function adminGenerarAsientosCore_(p){
  winAdmin_(p);
  const fecha=winDateKey_(p.fecha),pack=winDailyPack_(fecha);
  if(winCajaCorrecciones_(winTab_('audit').getDataRange().getValues()).some(a=>a.fecha===fecha&&a.estado==='PENDIENTE')){
    throw Error('Hay una corrección financiera provisional. Resolvela en Administración antes de exportar esta jornada.');
  }
  if(!pack.control.turnos||pack.control.abiertos)throw Error('Primero cerrá todos los turnos de la jornada.');
  if(!pack.control.revisado)throw Error('Primero marcá la jornada como REVISADO en Control de movimientos.');
  if(!pack.asientos.length)throw Error('No hay asientos financieros para exportar.');
  if(pack.exportacion&&pack.exportacion.vigente)return {...pack,yaGenerado:true};
  if(pack.exportacion&&pack.exportacion.requiereConciliacion&&!p.confirmarReexportacion)throw Error('Ya existe una exportación anterior. Revisá primero qué asientos fueron pegados en Excel para evitar duplicados.');
  winTab_('audit').appendRow([winNow_(),p.responsable,'GENERACION_ASIENTOS','',fecha,'Huella '+pack.huella+'; asientos '+pack.asientos.length]);
  winExportTab_().appendRow([fecha,pack.huella,winNow_(),p.responsable,pack.asientos.length,'GENERADA']);
  return {...pack,yaGenerado:false};
}
function adminGenerarAsientos(p){return winMutation_(p,'adminGenerarAsientos',adminGenerarAsientosCore_);}


/** V4.3 — Ajustes administrativos de transferencias de jornadas cerradas.
 * La referencia AJUSTE-ADMIN no corresponde a ningún turno real: no altera caja.
 * El movimiento queda en WIN Anotaciones, sujeto a huella, auditoría y exportación.
 */
function adminMovimientoCerradoCore_(p){
  const user=winAdmin_(p), fecha=winValidDate_(winDateKey_(p.fecha));
  if(fecha>winDate_())throw Error('La fecha no puede ser futura.');
  const shifts=winShifts_().slice(1).filter(r=>winDateKey_(r[2])===fecha);
  if(!shifts.length||shifts.some(r=>r[1]!=='CERRADA'))throw Error('La jornada debe existir y tener todos sus turnos cerrados.');
  const tipo=winStr_(p.tipo), concepto=winStr_(p.concepto,180), nota=winStr_(p.nota,400);
  const monto=winNum_(p.transferencia,'transferencia',false);
  let categoria='',profesor='',cantidad=0;
  if(tipo==='Reserva'){
    categoria=winStr_(p.categoria);
    if(!['Abonos','Regulares'].includes(categoria))throw Error('Elegí Abonos o Regulares.');
    // Cobro de una reserva ya contabilizada: no duplicar ocupación.
  }else if(tipo==='Otro ingreso'){
    if(!concepto)throw Error('Indicá el concepto del ingreso.');
  }else throw Error('Tipo de ajuste no permitido.');
  if(!winStr_(p.motivo,200))throw Error('Indicá por qué se registra después del cierre.');
  const id='WA-'+Utilities.getUuid().slice(0,12).toUpperCase();
  const observacion='AJUSTE POST-CIERRE: '+winStr_(p.motivo,200)+(nota?' · '+nota:'');
  winTab_('entries').appendRow([id,'AJUSTE-ADMIN',fecha,winNow_(),user,tipo,categoria,cantidad,0,profesor,0,monto,0,'',concepto,observacion,'ACTIVA','']);
  winTab_('audit').appendRow([winNow_(),user,'AJUSTE_POST_CIERRE',id,'AJUSTE-ADMIN',JSON.stringify({fecha,tipo,categoria,profesor,concepto,transferencia:monto,motivo:winStr_(p.motivo,200)})]);
  return {id,fecha,tipo,transferencia:monto,advertencia:'El día requiere nueva revisión. Si ya pegaste los asientos en Excel, no vuelvas a pegar la exportación completa.'};
}
function adminMovimientoCerrado(p){return winMutation_(p,'adminMovimientoCerrado',adminMovimientoCerradoCore_);}

/** Rendiciones unificadas: un cobro, varias imputaciones, siempre asociado
 * a un turno. Efectivo modifica caja; transferencia no. Los ingresos se
 * agrupan por fecha de cobro y nunca se duplican por fecha de actividad.
 */
function winTeacherKey_(value){return String(value||'').trim().toLowerCase();}
function winControlStart_(){
  const rows=winTab_('config').getDataRange().getValues().slice(1).filter(r=>r[0]==='Inicio control rendiciones'&&(r[2]===true||String(r[2]).toLowerCase()==='true'));
  const date=rows.length?winDateKey_(rows[rows.length-1][1]):'';
  if(date)winValidDate_(date);
  return date;
}
function adminEstadoControlRendiciones(p){winAdmin_(p);return winLock_(()=>({fechaInicio:winControlStart_()}));}
function adminConfigurarControlRendicionesCore_(p){
  const user=winAdmin_(p),date=winStr_(p.fechaInicio,30);
  if(date)winValidDate_(date);
  winTab_('config').appendRow(['Inicio control rendiciones',date,true]);
  winTab_('audit').appendRow([winNow_(),user,'INICIO_CONTROL_RENDICIONES','','',date||'Sin corte']);
  return {fechaInicio:date};
}
function adminConfigurarControlRendiciones(p){return winMutation_(p,'adminConfigurarControlRendiciones',adminConfigurarControlRendicionesCore_);}
/** Lectura histórica: la anotación activa es la fuente de profesor y fecha.
 * Las valoraciones conservan su porcentaje histórico. Nunca se resta dos veces
 * un cobro distribuido por tener además vínculos individuales.
 */
function winTeacherBalances_(profesor){
  const key=winTeacherKey_(profesor),rows=winTab_('entries').getDataRange().getValues().slice(1),dates={};
  const get=d=>dates[d]||(dates[d]={fecha:d,clases:0,esperado:0,distribuido:0,comun:0,conciliado:0,sinPrecio:0,sinImputar:0});
  const details=new Map(winClassDetailRows_().map(r=>[String(r[0]),r]));
  const classes=new Map();
  rows.filter(r=>r[16]==='ACTIVA'&&r[5]==='Clase'&&winTeacherKey_(r[9])===key).forEach(r=>{
    const id=String(r[0]),date=winDateKey_(r[2]),detail=details.get(id),d=get(date),qty=Number(r[7])||0;
    classes.set(id,date);d.clases+=qty;
    if(detail&&detail[10]==='CONFIRMADO')d.esperado+=winImporteClase_(r,detail);
    else d.sinPrecio+=qty;
  });
  const allLinks=winClassLinkRows_().filter(r=>r[8]==='ACTIVO');
  // Alias histórico de lectura; no se descuenta otra vez del dinero rendido.
  allLinks.filter(l=>classes.has(String(l[3]))).forEach(l=>get(classes.get(String(l[3]))).conciliado+=Number(l[4])||0);
  const links=allLinks.filter(r=>r[2]==='ANOTACION');
  rows.filter(r=>r[16]==='ACTIVA'&&r[5]==='Rendicion'&&winTeacherKey_(r[9])===key).forEach(r=>{
    let remaining=Math.round(((Number(r[10])||0)+(Number(r[11])||0))*100);
    links.filter(l=>String(l[1])===String(r[0])&&classes.has(String(l[3]))).forEach(l=>{
      const amount=Math.min(remaining,Math.max(0,Math.round((Number(l[4])||0)*100))),d=get(classes.get(String(l[3])));
      d.comun+=amount/100;remaining-=amount;
    });
    // Parte no vinculada: conservar la fecha histórica registrada, sin inventar imputaciones.
    if(remaining){get(winDateKey_(r[2])).comun+=remaining/100;get(winDateKey_(r[2])).sinImputar+=remaining/100;}
  });
  winTab_('allocations').getDataRange().getValues().slice(1).filter(r=>r[9]==='ACTIVO'&&r[2]&&winTeacherKey_(r[3])===key).forEach(r=>get(winDateKey_(r[2])).distribuido+=Number(r[5])||0);
  winSaldoMovs_(profesor).filter(r=>r.accion==='APLICAR').forEach(r=>{get(r.fecha).distribuido+=r.importe;});
  winRegularizations_(profesor).forEach(a=>{get(a.fecha).esperado+=a.delta;});
  return Object.values(dates).map(d=>({...d,esperado:Math.round(d.esperado*100)/100,cobrado:Math.round((d.comun+d.distribuido)*100)/100,pendiente:Math.round((d.esperado-d.comun-d.distribuido)*100)/100,pendienteConciliar:Math.max(0,Math.round((d.esperado-d.conciliado)*100)/100)})).sort((a,b)=>b.fecha.localeCompare(a.fecha));
}
function winRendicionContext_(p){
  const user=winAuth_(p),profesor=winProfessor_(p.profesor),a=winActive_();
  if(!a||String(a.data[0])!==String(p.turnoId))throw Error('Necesitás la caja abierta de esta rendición.');
  return {user,profesor,turno:a};
}
// API anterior conservada para clientes y consultas históricas.
function rendicionSaldosProfesor(p){winAuth_(p);return winLock_(()=>{const c=winRendicionContext_(p);return winTeacherBalances_(c.profesor);});}
function rendicionControlProfesor(p){
  winAuth_(p);return winLock_(()=>{
    const c=winRendicionContext_(p),fechaInicio=winControlStart_(),filas=winTeacherBalances_(c.profesor);
    const vigentes=filas.filter(d=>!fechaInicio||d.fecha>=fechaInicio);
    const total=field=>Math.round(vigentes.reduce((sum,d)=>sum+d[field],0)*100)/100;
    const esperado=total('esperado'),rendido=total('cobrado');
    return {profesor:c.profesor,fechaInicio,saldoFavor:Math.max(winSaldoProfesor_(c.profesor),0),filas:filas.map(d=>({fecha:d.fecha,clases:d.clases,esperado:d.esperado,rendido:d.cobrado,pendiente:d.pendiente,sinPrecio:d.sinPrecio})),totales:{esperado,rendido,pendiente:Math.round(vigentes.reduce((sum,d)=>sum+Math.max(0,d.pendiente),0)*100)/100,requiereRevision:vigentes.some(d=>d.sinPrecio>0||d.pendiente<0||d.sinImputar>0),sinPrecio:total('sinPrecio')}};
  });
}
function adminRegistrarCobroDistribuidoCore_(p){
  const user=winAuth_(p);
  const cobro=winValidDate_(winDateKey_(p.fechaCobro));
  if(cobro>winDate_())throw Error('La fecha de cobro no puede ser futura.');
  const a=winActive_();
  if(!a||String(a.data[0])!==String(p.turnoId))throw Error('Registrá la rendición desde la caja abierta de recepción.');
  if(cobro!==winDate_())throw Error('La rendición se registra con la fecha real de cobro de hoy; usá la fecha de actividad para atribuirla.');
  const profesor=winProfessor_(p.profesor);
  const forma=winMediosRendicion_(p),{medio,total}=forma;
  if(!Array.isArray(p.distribucion)||p.distribucion.length>31)throw Error('Ingresá hasta 31 fechas de actividad.');
  winCheckReceiptDuplicates_(p,{profesor,fechaCobro:cobro,...forma,distribucion:p.distribucion});
  const balances=new Map(winTeacherBalances_(profesor).map(d=>[d.fecha,d]));
  const start=winControlStart_();
  let suma=0;const fechas=new Set();
  const lineas=p.distribucion.map(x=>{
    const fecha=winValidDate_(winDateKey_(x.fecha));
    if(fecha>cobro)throw Error('La actividad no puede ser posterior al cobro.');
    if(fechas.has(fecha))throw Error('La fecha '+fecha+' está repetida. Agrupá su importe en una sola línea.');
    fechas.add(fecha);
    const importe=winNum_(x.importe,'importe atribuido',false);
    const balance=balances.get(fecha);
    if(!balance||Math.round(importe*100)>Math.max(0,Math.round(balance.pendiente*100)))throw Error('El importe supera el pendiente de rendición del '+fecha+'. Actualizá los saldos.');
    if(start&&fecha<start&&p.confirmarAnterior!==true)throw Error('Confirmá expresamente la atribución anterior al inicio del control.');
    suma=Math.round((suma+importe)*100)/100;
    return {fecha,importe};
  });
  const saldoFavor=winCajaDiferencia_(total,suma);
  const obs=winStr_(p.observacion,350);
  if(saldoFavor<0)throw Error('La distribución supera el dinero recibido.');
  if(saldoFavor>0&&(p.confirmarSaldoFavor!==true||!obs))throw Error('Confirmá el saldo a favor y agregá una observación para el excedente.');
  if(p.requiereRevision===true&&!obs)throw Error('Explicá la diferencia que necesita revisión.');
  const id='WD-'+Utilities.getUuid().toUpperCase(),ts=winNow_();
  const sh=winTab_('allocations');
  winRenglonesPago_(lineas,forma,saldoFavor).forEach(x=>sh.appendRow([id,cobro,x.fecha,profesor,x.medio,x.importe,ts,user,obs,'ACTIVO',String(a.data[0])]));
  winTab_('audit').appendRow([ts,user,'COBRO_DISTRIBUIDO',id,String(a.data[0]),JSON.stringify({fechaCobro:cobro,profesor,...forma,
    distribucion:lineas,saldoFavor,observacion:obs,requiereRevision:p.requiereRevision===true})]);
  return {id,fechaCobro:cobro,profesor,...forma,saldoFavor,distribucion:lineas,estadoTurno:winState_(user),
    aviso:'La rendición conserva su fecha real de ingreso.'};
}
function adminRegistrarCobroDistribuido(p){return winMutation_(p,'adminRegistrarCobroDistribuido',adminRegistrarCobroDistribuidoCore_);}
function winReceiptData_(receipt){return {id:receipt.id,profesor:receipt.profesor,fechaCobro:receipt.fecha,medio:receipt.medio,efectivo:receipt.efectivo,transferencia:receipt.transferencia,total:Math.round((receipt.efectivo+receipt.transferencia)*100)/100,turnoId:receipt.turno,distribucion:receipt.distribucion};}
function winReceiptSignature_(r){
  const lines={};(r.distribucion||[]).forEach(d=>{const date=winDateKey_(d.fecha);lines[date]=(lines[date]||0)+Math.round(Number(d.importe)*100);});
  return JSON.stringify([winTeacherKey_(r.profesor),winDateKey_(r.fechaCobro),r.medio,Math.round(Number(r.total)*100),r.medio==='Mixto'?Math.round(Number(r.efectivo)*100):null,Object.entries(lines).sort((a,b)=>a[0].localeCompare(b[0]))]);
}
function winLegacyReceiptCandidates_(){return winTab_('entries').getDataRange().getValues().slice(1).filter(r=>r[16]==='ACTIVA'&&r[5]==='Rendicion').map(r=>({id:String(r[0]),origen:'ANOTACION',profesor:String(r[9]),fechaRegistrada:winDateKey_(r[2]),total:(Number(r[10])||0)+(Number(r[11])||0),medios:[Number(r[10])>0?'Efectivo':'',Number(r[11])>0?'Transferencia':''].filter(Boolean)}));}
function winFindReceiptDuplicates_(candidate,excludeId='',source=null,legacy=null){
  const signature=winReceiptSignature_(candidate),exactos=[],posibles=[];
  (source||winDistributedReceipts_(winAllocationRows_())).filter(r=>r.id!==excludeId).forEach(r=>{
    const item=winReceiptData_(r);
    if(winReceiptSignature_(item)===signature)exactos.push(item);
    else if(winTeacherKey_(item.profesor)===winTeacherKey_(candidate.profesor)&&item.fechaCobro===winDateKey_(candidate.fechaCobro)&&(item.medio===candidate.medio||Math.round(item.total*100)===Math.round(Number(candidate.total)*100)))posibles.push(item);
  });
  (legacy||winLegacyReceiptCandidates_()).filter(r=>r.id!==excludeId&&winTeacherKey_(r.profesor)===winTeacherKey_(candidate.profesor)&&r.fechaRegistrada===winDateKey_(candidate.fechaCobro)&&(r.medios.includes(candidate.medio)||Math.round(r.total*100)===Math.round(Number(candidate.total)*100))).forEach(r=>posibles.push(r));
  return {exactos,posibles};
}
function comprobarCobroDistribuido(p){const user=winAuth_(p);return winLock_(()=>{
  if(p.excluirId){const receipt=winDistributedReceipts_(winAllocationRows_()).find(r=>r.id===p.excluirId);const shift=receipt&&winShifts_().slice(1).find(r=>String(r[0])===receipt.turno);if(!receipt||(user!=='Admin'&&(!shift||shift[1]!=='ABIERTA'||!winPuedeCorregirTurno_(user,shift[3],receipt.responsable))))throw Error('Corrección no autorizada.');}
  else winRendicionContext_(p);
  return winFindReceiptDuplicates_(p,p.excluirId||'');
});}
function winCheckReceiptDuplicates_(p,candidate,excludeId=''){
  const matches=winFindReceiptDuplicates_(candidate,excludeId);
  if(matches.exactos.length){
    if(p.autorizarDuplicado!==true||!winStr_(p.motivoDuplicado,200))throw Error('DUPLICADO EXACTO: ya existe esta rendición. No se guardó otro cobro.');
    const user=winAdmin_(p);
    winTab_('audit').appendRow([winNow_(),user,'AUTORIZA_DUPLICADO_COBRO',excludeId,p.turnoId||'',JSON.stringify({coincidencias:matches.exactos.map(r=>r.id),motivo:winStr_(p.motivoDuplicado,200)})]);
  }else if(matches.posibles.length&&p.confirmarCoincidencias!==true)throw Error('COINCIDENCIA PARCIAL: revisá las rendiciones existentes antes de confirmar un cobro diferente.');
}
function consultarEstadoSolicitud(p){
  const user=winAuth_(p);
  return winLock_(()=>{
    const original=p.solicitud;if(!original||original.responsable!==user)throw Error('Solicitud no autorizada.');
    const clean={...original};delete clean.pin;delete clean.requestId;
    const hash=winHash_(JSON.stringify({action:p.accion,p:clean}));
    const row=winTab_('audit').getDataRange().getValues().slice(1).find(r=>r[2]==='SOLICITUD'&&r[3]===original.requestId);
    if(!row)return {estado:'NO_REGISTRADA'};
    const receipt=JSON.parse(row[5]);if(row[1]!==user||receipt.hash!==hash)throw Error('Solicitud no autorizada.');
    let result=receipt.result;
    if(receipt.responseType==='cobro-distribuido-v1')result={...result,distribucion:original.distribucion.map(d=>({fecha:winDateKey_(d.fecha),importe:Number(d.importe)})),estadoTurno:winState_(user)};
    else if(receipt.responseType==='correccion-cobro-v1')result={...result,estadoTurno:winState_(user)};
    else if(receipt.responseType==='revision-dia-v1')result=adminControlDiarioCore_(original);
    else if(result===null&&['abrirCaja','guardarAnotacion','editarAnotacion','anularAnotacion'].includes(p.accion))result=winState_(user);
    else if(result===null)return {estado:'CONFIRMADA_SIN_RESULTADO'};
    if(p.accion==='adminRegistrarCobroDistribuido'&&result)result={...result,estadoTurno:winState_(user)};
    return {estado:'CONFIRMADA',resultado:result};
  });
}
function adminCobrosDia(p){
  winAdmin_(p);return winLock_(()=>{
    const fecha=winValidDate_(winDateKey_(p.fecha)),rows=winAllocationRows_();
    const all=winDistributedReceipts_(rows),shifts=winShifts_().slice(1),legacy=winLegacyReceiptCandidates_();
    const receipts=all.filter(r=>r.fecha===fecha);
    const cobros=receipts.map(r=>({...r,turnoCerrado:shifts.find(t=>String(t[0])===r.turno)?.[1]!=='ABIERTA',coincidencias:winFindReceiptDuplicates_(winReceiptData_(r),r.id,all,legacy),sinTurno:!r.turno}));
    const corrections=winTab_('audit').getDataRange().getValues().slice(1).filter(r=>r[2]==='CORRECCION_COBRO').map(r=>{try{return {fechaHora:String(r[0]),usuario:String(r[1]),...JSON.parse(r[5])};}catch(e){return null;}}).filter(r=>r&&r.fechaCobro===fecha);
    return {fecha,cobros,correcciones:corrections};
  });
}
function corregirCobroDistribuidoCore_(p){
  const user=winAuth_(p),id=winStr_(p.cobroId,80),rows=winAllocationRows_().filter(r=>String(r[0])===id&&r[9]==='ACTIVO');
  if(!rows.length)throw Error('La rendición ya no está vigente. Actualizá el listado.');
  const old=winDistributedReceipts_(rows)[0],before=winReceiptData_(old);
  if(!p.version||p.version!==old.version)throw Error('La rendición cambió o falta su versión. Actualizá el listado antes de corregir.');
  const shift=winShifts_().slice(1).find(r=>String(r[0])===old.turno);
  if(!shift){winAdmin_(p);if(p.accion!=='ANULAR'||p.confirmarSinTurno!==true)throw Error('La rendición no tiene turno identificable. Solo Admin puede autorizar su anulación financiera explícita.');}
  const closed=!shift||shift[1]!=='ABIERTA';
  if(closed){winAdmin_(p);if(p.confirmarCierre!==true)throw Error('Confirmá la corrección administrativa del turno cerrado.');}
  else if(!winPuedeCorregirTurno_(user,shift[3],old.responsable))throw Error('Como colaborador, solo podés corregir tus propias rendiciones.');
  const reason=winStr_(p.motivo,250);if(!reason)throw Error('Indicá el motivo de la corrección.');
  if(!['EDITAR','ANULAR'].includes(p.accion))throw Error('Corrección inválida.');
  const links=winClassLinkRows_();const linked=links.map((row,i)=>({row,index:i+2})).filter(l=>l.row[8]==='ACTIVO'&&String(l.row[1])===id&&l.row[2]==='DISTRIBUIDO');
  if(linked.length){winAdmin_(p);if(p.confirmarVinculos!==true)throw Error('La rendición tiene pagos asociados. Admin debe confirmar expresamente la reversión de esos vínculos.');linked.forEach(l=>winTab_('classLinks').getRange(l.index,9).setValue('ANULADO'));}
  const sh=winTab_('allocations');rows.forEach(r=>sh.getRange(r._row,10).setValue(p.accion==='ANULAR'?'ANULADO':'REEMPLAZADO'));
  let after=null;
  if(p.accion==='EDITAR'){
    const profesor=winProfessor_(p.profesor),forma=winMediosRendicion_(p),{total}=forma;
    if(!Array.isArray(p.distribucion)||p.distribucion.length>31)throw Error('Indicá hasta 31 fechas.');
    const balances=new Map(winTeacherBalances_(profesor).map(r=>[r.fecha,r])),seen=new Set();let sum=0;
    const lines=p.distribucion.map(d=>{
      const fecha=winValidDate_(winDateKey_(d.fecha)),importe=winNum_(d.importe,'importe asignado',false);
      if(fecha>old.fecha||seen.has(fecha))throw Error('Fecha de actividad inválida o repetida.');seen.add(fecha);
      if(Math.round(importe*100)>Math.max(0,Math.round((balances.get(fecha)?.pendiente||0)*100)))throw Error('El importe supera el pendiente.');
      sum+=Math.round(importe*100);return {fecha,importe};
    });
    const saldoFavor=winCajaDiferencia_(total,sum/100);
    if(saldoFavor<0||(saldoFavor>0&&p.confirmarSaldoFavor!==true))throw Error('Confirmá el excedente como saldo a favor o corregí las asignaciones.');
    after={id,profesor,fechaCobro:old.fecha,...forma,turnoId:old.turno,distribucion:lines,saldoFavor};
    winCheckReceiptDuplicates_({...p,turnoId:old.turno},after,id);
    winRenglonesPago_(lines,forma,saldoFavor).forEach(d=>sh.appendRow([id,old.fecha,d.fecha,profesor,d.medio,d.importe,
      old.registrado,old.responsable,winStr_(p.observacion,350),'ACTIVO',old.turno]));
  }
  if(old.saldoFavor&&winSaldoProfesor_(old.profesor)<0)throw Error('Ya se utilizó el saldo a favor de esta rendición. Revisá las compensaciones antes de modificarla.');
  const change={id,accion:p.accion,motivo:reason,fechaCobro:old.fecha,turnoId:old.turno,turnoCerrado:closed,sinTurno:!shift,vinculosAnulados:linked.map(l=>String(l.row[0])),antes:before,despues:after,deltaEfectivo:(after?.efectivo||0)-old.efectivo,deltaTransferencia:(after?.transferencia||0)-old.transferencia};
  winTab_('audit').appendRow([winNow_(),user,'CORRECCION_COBRO',id,old.turno,JSON.stringify(change)]);
  return {id,accion:p.accion,turnoCerrado:closed,deltaEfectivo:change.deltaEfectivo,deltaTransferencia:change.deltaTransferencia,estadoTurno:winState_(user)};
}
function corregirCobroDistribuido(p){return winMutation_(p,'corregirCobroDistribuido',corregirCobroDistribuidoCore_);}
function prepararWIN(p) {
  winAdmin_(p);
  return winLock_(()=>prepararWINGestion_());
}

/** WIN V4.6 — Economía de clases: libro auxiliar. No altera caja ni anotaciones históricas. */
function winClassDetailRows_(){return winTab_('classDetails').getDataRange().getValues().slice(1);}
function winClassLinkRows_(){return winTab_('classLinks').getDataRange().getValues().slice(1);}
function winClassDefaults_(profesor){return String(profesor).trim().toLowerCase()==='chino'?55:60;}
function winReceptionPercent_(id,profesor,fecha){
  const prior=id?winClassDetailRows_().find(r=>String(r[0])===id):null;
  if(prior&&winTeacherKey_(prior[2])===winTeacherKey_(profesor))return Number(prior[6]);
  const reglas=winComisionesClase_().filter(r=>winTeacherKey_(r.profesor)===winTeacherKey_(profesor)&&r.fecha<=fecha);
  return reglas.length?reglas[0].porcentaje:winClassDefaults_(profesor);
}
function winImporteClase_(registro,detalle){
  if(detalle[8]==='Clase-partido'||winNotaMovimiento_(registro[15]).economia)return Number(detalle[7])||0;
  return Math.round((Number(detalle[5])||0)*(Number(registro[7])||0)*(Number(detalle[6])||0))/100;
}
function winSaveClassDetail_(id,e,raw,user){
  const sh=winTab_('classDetails'),rows=sh.getDataRange().getValues();
  const idx=rows.findIndex((r,i)=>i>0&&String(r[0])===id);
  const prior=idx>0?rows[idx]:null;
  const isNew=!prior&&!raw.migracionHistorica;
  if(isNew&&raw.tipoClase!=='Clase-partido'&&(raw.precioClase===undefined||String(raw.precioClase).trim()===''))throw Error('El precio de cada clase nueva es obligatorio.');
  const priceText=raw.precioClase;
  const supplied=priceText!==undefined&&priceText!==null&&String(priceText).trim()!=='';
  const priced=supplied||(!!prior&&prior[10]==='CONFIRMADO');
  const price=supplied?winNum_(priceText,'precio total por clase'):prior&&prior[10]==='CONFIRMADO'?Number(prior[5]):0;
  const percent=raw.porcentajeWIN===undefined||String(raw.porcentajeWIN).trim()===''?prior?Number(prior[6]):winClassDefaults_(e.profesor):winNum_(raw.porcentajeWIN,'porcentaje WIN');
  if(percent>100)throw Error('El porcentaje WIN no puede superar 100.');
  const tipo=winStr_(raw.tipoClase||(prior&&prior[8])||'Tradicional',60),hora=winStr_(raw.horarioClase||(prior&&prior[9]),80),obs=winStr_(raw.nota||(prior&&prior[13]),300);
  if(!['Tradicional','Clase-partido'].includes(tipo))throw Error('Elegí Tradicional o Clase-partido.');
  if((isNew||hora)&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(hora))throw Error('La hora de inicio es obligatoria (HH:MM).');
  const manual=tipo==='Clase-partido'&&raw.importeWIN!==undefined&&String(raw.importeWIN).trim()!=='';
  if(tipo==='Clase-partido'&&(!prior||prior[8]!=='Clase-partido')&&!manual)throw Error('Ingresá el importe definitivo para WIN.');
  const economia=winNotaMovimiento_(e.nota).economia;
  const amount=economia?economia.win:tipo==='Clase-partido'?(manual?winNum_(raw.importeWIN,'importe WIN'):prior?Number(prior[7]):0):Math.round(price*e.cantidad*percent)/100;
  const row=[id,e.fecha,e.profesor,e.cantidad,e.alumnos,price,percent,amount,tipo,hora,(manual||priced)?'CONFIRMADO':'PENDIENTE',winNow_(),user,obs];
  if(idx>0){
    const linked=winClassLinkRows_().filter(r=>String(r[3])===id&&r[8]==='ACTIVO').reduce((a,r)=>a+(Number(r[4])||0),0);
    if(linked>0&&(String(prior[2])!==e.profesor||winDateKey_(prior[1])!==e.fecha))throw Error('No se puede cambiar profesor o fecha de una clase con pagos asociados.');
    if(amount+0.001<linked)throw Error('El importe WIN no puede ser menor al importe ya pagado.');
    sh.getRange(idx+1,1,1,row.length).setValues([row]);
  }else sh.appendRow(row);
}
function winCancelClassDetail_(id){
  if(winClassLinkRows_().some(r=>String(r[3])===id&&r[8]==='ACTIVO'))throw Error('La clase tiene pagos asociados. Administración debe revisar la corrección.');
  const sh=winTab_('classDetails'),rows=sh.getDataRange().getValues();
  const idx=rows.findIndex((r,i)=>i>0&&String(r[0])===id);
  if(idx>0)sh.getRange(idx+1,11).setValue('ANULADO');
}
/** Reconstruye un registro auxiliar por cada anotación de clase antigua, sin asignar precios ficticios. */
function adminMigrarClasesHistoricasCore_(p){
  const user=winAdmin_(p),existing=new Set(winClassDetailRows_().map(r=>String(r[0])));
  const old=winTab_('entries').getDataRange().getValues().slice(1).filter(r=>r[5]==='Clase'&&r[16]==='ACTIVA'&&!existing.has(String(r[0])));
  const lote=old.slice(0,5);
  lote.forEach(r=>{const e=winEntryObject_(r);winSaveClassDetail_(e.id,e,{migracionHistorica:true},user);});
  winTab_('audit').appendRow([winNow_(),user,'MIGRACION_CLASES','','','Clases históricas incorporadas sin precio: '+lote.length]);
  return {migradas:lote.length,pendientes:old.length-lote.length};
}
function adminMigrarClasesHistoricas(p){return winMutation_(p,'adminMigrarClasesHistoricas',adminMigrarClasesHistoricasCore_);}
function adminEconomiaClasesCore_(p){
  winAdmin_(p);const period=winPeriod_(p);
  const active=new Set(winTab_('entries').getDataRange().getValues().slice(1).filter(r=>r[5]==='Clase'&&r[16]==='ACTIVA').map(r=>String(r[0])));
  const details=winClassDetailRows_().filter(r=>active.has(String(r[0]))&&winDateKey_(r[1])>=period.desde&&winDateKey_(r[1])<=period.hasta);
  const linked=winClassLinkRows_().filter(r=>r[8]==='ACTIVO');
  const byClass={};linked.forEach(r=>{byClass[String(r[3])]=(byClass[String(r[3])]||0)+(Number(r[4])||0);});
  const classes=details.map(r=>{const amount=Number(r[7])||0,paid=byClass[String(r[0])]||0;return {id:String(r[0]),fecha:winDateKey_(r[1]),profesor:String(r[2]),cantidad:Number(r[3])||0,alumnos:Number(r[4])||0,precio:Number(r[5])||0,porcentaje:Number(r[6])||0,win:amount,conciliado:paid,pendiente:Math.max(0,amount-paid),tipo:String(r[8]),horario:String(r[9]),estado:String(r[10])};});
  const professors={};classes.forEach(c=>{const t=professors[c.profesor]||(professors[c.profesor]={profesor:c.profesor,clases:0,alumnos:0,win:0,conciliado:0,pendiente:0,sinPrecio:0});t.clases+=c.cantidad;t.alumnos+=c.cantidad*c.alumnos;t.win+=c.win;t.conciliado+=c.conciliado;t.pendiente+=c.pendiente;if(c.estado!=='CONFIRMADO')t.sinPrecio+=c.cantidad;});
  const cash=winTab_('entries').getDataRange().getValues().slice(1).filter(r=>r[16]==='ACTIVA'&&r[5]==='Rendicion').map(r=>({id:String(r[0]),fecha:winDateKey_(r[2]),profesor:String(r[9]),importe:(Number(r[10])||0)+(Number(r[11])||0),origen:'ANOTACION'}));
  const dist=winTab_('allocations').getDataRange().getValues().slice(1).filter(r=>r[9]==='ACTIVO');
  const groups={};dist.forEach(r=>{const id=String(r[0]);if(!groups[id])groups[id]={id,fecha:winDateKey_(r[1]),profesor:String(r[3]),importe:0,origen:'DISTRIBUIDO'};groups[id].importe+=Number(r[5])||0;});
  const receipts=[...cash,...Object.values(groups)].filter(c=>c.fecha>=period.desde&&c.fecha<=period.hasta);
  const byReceipt={};linked.forEach(r=>{const key=String(r[2])+'|'+String(r[1]);byReceipt[key]=(byReceipt[key]||0)+(Number(r[4])||0);});
  receipts.forEach(c=>{c.conciliado=byReceipt[c.origen+'|'+c.id]||0;c.sinConciliar=Math.max(0,c.importe-c.conciliado);});
  return {periodo:period,clases:classes,profesores:Object.values(professors).sort((a,b)=>a.profesor.localeCompare(b.profesor)),cobros:receipts,totales:{clases:classes.reduce((s,c)=>s+c.cantidad,0),alumnos:classes.reduce((s,c)=>s+c.cantidad*c.alumnos,0),win:classes.reduce((s,c)=>s+c.win,0),conciliado:classes.reduce((s,c)=>s+c.conciliado,0),pendiente:classes.reduce((s,c)=>s+c.pendiente,0),sinPrecio:classes.filter(c=>c.estado!=='CONFIRMADO').reduce((s,c)=>s+c.cantidad,0)},nota:'Los cobros históricos sin vínculo no se asignan automáticamente a clases.'};
}
function adminEconomiaClases(p){winAdmin_(p);return winLock_(()=>adminEconomiaClasesCore_(p));}
function adminPrecioClaseCore_(p){
 const user=winAdmin_(p),id=winStr_(p.id),rows=winTab_('entries').getDataRange().getValues().slice(1);
 const raw=rows.find(r=>String(r[0])===id&&r[5]==='Clase'&&r[16]==='ACTIVA');if(!raw)throw Error('Clase no encontrada o anulada.');
 const e=winEntryObject_(raw);winSaveClassDetail_(id,e,{precioClase:p.precioClase,porcentajeWIN:p.porcentajeWIN,tipoClase:p.tipoClase,horarioClase:p.horarioClase,importeWIN:p.importeWIN,nota:p.nota},user);
 winTab_('audit').appendRow([winNow_(),user,'PRECIO_CLASE',id,e.turno,JSON.stringify({precio:p.precioClase,porcentaje:p.porcentajeWIN,tipo:p.tipoClase})]);
 return {id,estado:'ACTUALIZADO'};
}
function adminPrecioClase(p){return winMutation_(p,'adminPrecioClase',adminPrecioClaseCore_);}
function adminVincularRendicionCore_(p){
 const user=winAdmin_(p),id=winStr_(p.cobroId),origen=winStr_(p.origen),classId=winStr_(p.claseId),amount=winNum_(p.importe,'importe a conciliar',false);
 if(!['ANOTACION','DISTRIBUIDO'].includes(origen))throw Error('Origen inválido.');
 const report=winEconomiaFull_();
 const c=report.clases.find(x=>x.id===classId),receipt=report.cobros.find(x=>x.id===id&&x.origen===origen);
 if(!c||!receipt)throw Error('No se encontró la clase o el cobro.');
 if(c.profesor!==receipt.profesor)throw Error('Profesor distinto entre clase y rendición.');
 if(c.estado!=='CONFIRMADO')throw Error('Primero confirmá el precio de la clase.');
 if(amount>c.pendiente+0.001||amount>receipt.sinConciliar+0.001)throw Error('El importe excede el saldo pendiente de la clase o el cobro.');
 const linkId='WC-'+Utilities.getUuid().slice(0,12).toUpperCase();
 winTab_('classLinks').appendRow([linkId,id,origen,classId,amount,winNow_(),user,winStr_(p.nota,300),'ACTIVO']);
 winTab_('audit').appendRow([winNow_(),user,'CONCILIAR_CLASE',classId,id,'Vínculo '+linkId+' / '+amount]);
 return {id:linkId,importe:amount};
}
function adminVincularRendicion(p){return winMutation_(p,'adminVincularRendicion',adminVincularRendicionCore_);}

function winEconomiaFull_(){
  const entries=winTab_('entries').getDataRange().getValues().slice(1).filter(r=>r[16]==='ACTIVA');
  const details=winClassDetailRows_();const links=winClassLinkRows_().filter(r=>r[8]==='ACTIVO');
  const classes=details.filter(r=>entries.some(e=>String(e[0])===String(r[0])&&e[5]==='Clase')).map(r=>{
    const paid=links.filter(x=>String(x[3])===String(r[0])).reduce((s,x)=>s+(Number(x[4])||0),0);
    return {id:String(r[0]),profesor:String(r[2]),estado:String(r[10]),pendiente:Math.max(0,(Number(r[7])||0)-paid)};
  });
  const receipts=entries.filter(r=>r[5]==='Rendicion').map(r=>({id:String(r[0]),origen:'ANOTACION',profesor:String(r[9]),importe:(Number(r[10])||0)+(Number(r[11])||0)}));
  const grouped={};winTab_('allocations').getDataRange().getValues().slice(1).filter(r=>r[9]==='ACTIVO').forEach(r=>{const id=String(r[0]);if(!grouped[id])grouped[id]={id,origen:'DISTRIBUIDO',profesor:String(r[3]),importe:0};grouped[id].importe+=Number(r[5])||0;});
  receipts.push(...Object.values(grouped));receipts.forEach(r=>{r.sinConciliar=Math.max(0,r.importe-links.filter(x=>String(x[1])===r.id&&String(x[2])===r.origen).reduce((s,x)=>s+(Number(x[4])||0),0));});
  return {clases:classes,cobros:receipts};
}

/** Impide dejar vínculos activos contra un cobro anulado o insuficiente. */
function winValidateReceiptChange_(id,e){
 const links=winClassLinkRows_().filter(r=>r[8]==='ACTIVO'&&String(r[1])===id&&String(r[2])==='ANOTACION');
 if(!links.length)return;
 if(!e)throw Error('La rendición tiene clases conciliadas. Desvinculalas antes de anular.');
 const current=winTab_('entries').getDataRange().getValues().slice(1).find(r=>String(r[0])===id);
 if(!current||String(current[9])!==e.profesor)throw Error('No se puede cambiar el profesor de una rendición conciliada.');
 const linked=links.reduce((sum,r)=>sum+(Number(r[4])||0),0);
 if(e.efectivo+e.transferencia+0.001<linked)throw Error('El cobro no puede ser menor al importe ya conciliado.');
}

/** Misma columna histórica: no se fabrican marcas faltantes. */
function winTimestamp_(value){return value instanceof Date&&!isNaN(value.getTime())?Utilities.formatDate(value,WIN_TZ,'yyyy-MM-dd HH:mm:ss'):String(value||'');}
const WIN_CLASS_PRICES={1:60000,2:70000,3:90000,4:100000};
function winRegularizations_(profesor){
 return winTab_('audit').getDataRange().getValues().slice(1).filter(r=>r[2]==='REGULARIZACION_SALDO_V1').map(r=>{const a=JSON.parse(r[5]);return {...a,responsable:String(r[1]),registrado:winTimestamp_(r[0])};}).filter(a=>winTeacherKey_(a.profesor)===winTeacherKey_(profesor));
}
function winBalanceVersion_(profesor){return winHash_(JSON.stringify(winTeacherBalances_(profesor)));}
function adminConsultarSaldoProfesor(p){winAdmin_(p);return winLock_(()=>{const profesor=winProfessor_(p.profesor);return {profesor,filas:winTeacherBalances_(profesor),version:winBalanceVersion_(profesor),regularizaciones:winRegularizations_(profesor)};});}
/** Ajuste administrativo NO financiero, append-only en auditoría existente. */
function adminRegularizarSaldoCore_(p){
 const user=winAdmin_(p),profesor=winProfessor_(p.profesor),fecha=winValidDate_(winDateKey_(p.fecha)),motivo=winStr_(p.motivo,300);
 if(fecha>winDate_())throw Error('La fecha de actividad no puede ser futura.');
 if(!motivo||p.confirmar!==true)throw Error('Confirmá el saldo real e indicá el motivo.');
 if(p.version!==winBalanceVersion_(profesor))throw Error('El saldo cambió. Consultá nuevamente antes de regularizar.');
 const row=winTeacherBalances_(profesor).find(d=>d.fecha===fecha),anterior=row?row.pendiente:0,nuevo=winNum_(p.nuevoSaldo,'saldo real'),delta=Math.round((nuevo-anterior)*100)/100;
 if(!delta)throw Error('El saldo no cambia.');
 const result={id:'REG-'+Utilities.getUuid(),profesor,fecha,anterior,nuevo,delta,motivo};
 winTab_('audit').appendRow([winNow_(),user,'REGULARIZACION_SALDO_V1',result.id,'',JSON.stringify(result)]);
 return result;
}
function adminRegularizarSaldo(p){return winMutation_(p,'adminRegularizarSaldo',adminRegularizarSaldoCore_);}
/** Consulta acotada por período; no interviene en el cálculo acumulado. */
function historialProfesor(p){
 const user=winAuth_(p),mes=String(p.mes||'');
 if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(mes))throw Error('Seleccioná mes y año.');
 return winLock_(()=>{
 const profesor=p.profesor?winProfessor_(p.profesor):'',rows=winTab_('entries').getDataRange().getValues().slice(1),details=new Map(winClassDetailRows_().map(r=>[String(r[0]),r]));
 const clases=rows.filter(r=>r[5]==='Clase'&&winDateKey_(r[2]).slice(0,7)===mes&&(!profesor||winTeacherKey_(r[9])===winTeacherKey_(profesor))).map(r=>({...winEntryObject_(r),estado:String(r[16]),importeWIN:Number(details.get(String(r[0]))?.[7])||0}));
 const comunes=rows.filter(r=>r[5]==='Rendicion'&&winDateKey_(r[2]).slice(0,7)===mes&&(!profesor||winTeacherKey_(r[9])===winTeacherKey_(profesor))).map(r=>({...winEntryObject_(r),estado:String(r[16])}));
 const distribuidos=winAllocationRows_().filter(r=>winDateKey_(r[1]).slice(0,7)===mes&&(!profesor||winTeacherKey_(r[3])===winTeacherKey_(profesor)));
 const activos=winDistributedReceipts_(distribuidos),inactivos=distribuidos.filter(r=>r[9]!=='ACTIVO').map(r=>({id:String(r[0]),fecha:winDateKey_(r[1]),tipo:'RendicionDistribuida',profesor:String(r[3]),registrado:winTimestamp_(r[6]),responsable:String(r[7]),estado:String(r[9]),efectivo:r[4]==='Efectivo'?Number(r[5]):0,transferencia:r[4]==='Transferencia'?Number(r[5]):0,distribucion:[{fecha:winDateKey_(r[2]),importe:Number(r[5])}]}));
 return {mes,clases,rendiciones:[...comunes,...activos.map(r=>({...r,estado:'ACTIVO'})),...inactivos]};
 });
}

/** Las propuestas viven en auditoría. Solo una aprobación cambia el movimiento original. */
function winCajaCorrecciones_(audit){
  const map=new Map();  audit.forEach((r,orden)=>{
    if(!['PROPUESTA_CAJA','DECISION_CAJA'].includes(r[2]))return;
    let d;try{d=JSON.parse(r[5]);}catch(e){return;}
    if(!d||!d.id)return;
    if(r[2]==='PROPUESTA_CAJA'){
      map.set(d.id,{...d,estado:'PENDIENTE',autor:String(r[1]),registrado:winTimestamp_(r[0]),orden});
    }else if(map.has(d.id)){
      Object.assign(map.get(d.id),{estado:d.estado,resolucion:d.nota,resueltoPor:String(r[1]),resueltoEl:winTimestamp_(r[0]),orden});
    }
  });
  return [...map.values()];
}
function winFinanzasMovimiento_(r){
  const e=winEntryObject_(r);
  return {efectivo:e.efectivo,transferencia:e.transferencia,importe:e.importe,medio:e.medio,
    saldo:winTotals_([e],0).esperado};
}
function solicitarCorreccionCaja(p){
  return winMutation_(p,'solicitarCorreccionCaja',q=>{
    const user=winAuth_(q),nota=winStr_(q.motivo,300),id=winStr_(q.id,90);
    if(!nota)throw Error('Indicá qué pasó y por qué hay que corregirlo.');
    const anteriores=winCajaCorrecciones_(winTab_('audit').getDataRange().getValues());
    if(q.accion==='ALTA'||q.origen==='DISTRIBUIDO'){
      const borrador=q.accion==='ALTA'?winCobroOmitido_(q,user,nota,anteriores):winPropuestaRendicion_(q,nota,id,anteriores);
      return winGuardarPropuestaCaja_(borrador,user);
    }
    const rows=winTab_('entries').getDataRange().getValues();
    const r=rows.find((r,i)=>i>0&&String(r[0])===id&&r[16]==='ACTIVA');
    if(!r||r[5]==='Clase'||winNotaMovimiento_(r[15]).devolucionSaldo)throw Error('Elegí un movimiento financiero vigente de una caja cerrada.');
    if(q.version!==winReviewMovementVersion_(r))throw Error('El movimiento cambió. Volvé a consultarlo.');
    const turno=winShifts_().find(r2=>String(r2[0])===String(r[1])&&r2[1]==='CERRADA');
    if(!turno)throw Error('La caja original debe estar cerrada.');
    if(anteriores.some(d=>d.movimiento===id&&d.estado==='PENDIENTE'))throw Error('Ya hay una corrección pendiente para este movimiento.');
    const next=r.slice(),salida=['Gasto','Retiro'].includes(r[5]);
    if(salida){
      next[12]=winNum_(q.importe,'importe',false);
      if(r[5]==='Gasto'&&['Efectivo','Transferencia'].includes(q.medio))next[13]=q.medio;
    }else{
      next[10]=winNum_(q.efectivo,'efectivo');
      next[11]=winNum_(q.transferencia,'transferencia');
      if(r[5]==='Rendicion')winValidateReceiptChange_(id,winEntryObject_(next));
    }
    const antes=winFinanzasMovimiento_(r),despues=winFinanzasMovimiento_(next);
    if(winEqual_(antes,despues))throw Error('Los importes y el medio de pago no cambiaron.');
    return winGuardarPropuestaCaja_({movimiento:id,turno:String(r[1]),jornada:winDateKey_(turno[2]),fecha:winDateKey_(r[2]),
      tipo:r[5],antes,despues,nota,version:q.version},user);
  });
}
function winGuardarPropuestaCaja_(borrador,user){
  const registro={...borrador,id:'PC-'+Utilities.getUuid()};
  winTab_('audit').appendRow([winNow_(),user,'PROPUESTA_CAJA',registro.movimiento,registro.turno,JSON.stringify(registro)]);
  return {id:registro.id,jornada:registro.jornada,estado:'PENDIENTE'};
}
function adminCorreccionesCaja(p){
  winAdmin_(p);
  return winLock_(()=>winCajaCorrecciones_(winTab_('audit').getDataRange().getValues())
    .filter(r=>p.todas===true||r.estado==='PENDIENTE').reverse().slice(0,75));
}
function adminResolverCorreccionCaja(p){
  winAdmin_(p);
  return winMutation_(p,'adminResolverCorreccionCaja',q=>{
    const user=winAdmin_(q),estado=q.estado,nota=winStr_(q.nota,300);
    if(!['APROBADA','RECHAZADA'].includes(estado)||!nota)throw Error('Confirmá la decisión e indicá el motivo.');
    const registro=winCajaCorrecciones_(winTab_('audit').getDataRange().getValues()).find(a=>a.id===q.id);
    if(!registro||registro.estado!=='PENDIENTE')throw Error('La propuesta ya no está pendiente.');
    if(estado==='APROBADA'&&!winShifts_().some(s=>String(s[0])===registro.turno&&s[1]==='CERRADA'))throw Error('La caja original debe estar cerrada.');
    if(estado==='APROBADA'&&registro.origen==='DISTRIBUIDO')winAprobarRendicionCaja_(registro,user,nota);
    else if(estado==='APROBADA'&&registro.nuevo){
      winComprobarCobroOmitido_(registro.nuevo);
      const next=registro.nuevo.slice();next[17]=registro.id;
      winTab_('entries').appendRow(next);
      winTab_('audit').appendRow([winNow_(),user,'REVISION_MOVIMIENTO_CERRADO',registro.movimiento,registro.turno,
        JSON.stringify({motivo:nota,accion:'alta',antes:null,despues:next})]);
    }else if(estado==='APROBADA'){
      const sh=winTab_('entries'),rows=sh.getDataRange().getValues();
      const i=rows.findIndex((r,i)=>i>0&&String(r[0])===registro.movimiento);
      const r=rows[i];
      if(i<1||r[16]!=='ACTIVA'||winReviewMovementVersion_(r)!==registro.version)throw Error('El movimiento cambió. Rechazá esta propuesta y consultá los datos actuales.');
      const {efectivo,transferencia,importe,medio}=registro.despues;
      const next=r.slice();next.splice(10,4,efectivo,transferencia,importe,medio);next[17]=registro.id;
      if(r[5]==='Rendicion')winValidateReceiptChange_(registro.movimiento,winEntryObject_(next));
      // El cierre físico se conserva. Los reportes usan el movimiento aprobado.
      sh.getRange(i+1,1,1,next.length).setValues([next]);
      winTab_('audit').appendRow([winNow_(),user,'REVISION_MOVIMIENTO_CERRADO',registro.movimiento,registro.turno,
        JSON.stringify({motivo:nota,accion:'editar',antes:r,despues:next})]);
    }
    winTab_('audit').appendRow([winNow_(),user,'DECISION_CAJA',registro.movimiento,registro.turno,
      JSON.stringify({id:registro.id,estado,nota})]);
    return {id:registro.id,estado,jornada:registro.jornada,fecha:registro.fecha};
  });
}

function winNotaMovimiento_(value,datos){
  const prefix='WIN-M02:';
  const raw=String(value||'');
  if(datos)return prefix+JSON.stringify({v:1,nota:raw,...datos});
  if(raw.startsWith(prefix)){
    try{
      const x=JSON.parse(raw.slice(prefix.length));
      if(x.v===1&&typeof x.nota==='string')return x;
    }catch(e){}
  }
  return {nota:raw};
}
function winHorarioMinutos_(value,label){
  const s=winStr_(value,10);
  if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(s))throw Error('Indicá '+label+' en formato de 24 horas.');
  return Number(s.slice(0,2))*60+Number(s.slice(3));
}
function winHorarioTexto_(value){
  const t=value%1440;
  return String(Math.floor(t/60)).padStart(2,'0')+':'+String(t%60).padStart(2,'0');
}
function winDiaSiguiente_(value){
  const d=new Date(value+'T12:00:00Z');
  d.setUTCDate(d.getUTCDate()+1);
  return d.toISOString().slice(0,10);
}
function winActividadIntervalo_(fecha,actividad){
  const inicio=Date.parse((actividad.diaSiguiente?winDiaSiguiente_(fecha):fecha)+'T00:00:00Z')/60000+
    winHorarioMinutos_(actividad.hora,'la hora de actividad');
  return [inicio,inicio+actividad.duracion];
}
function winValidarSuperposicion_(e,actividad,id){
  const [inicio,fin]=winActividadIntervalo_(e.fecha,actividad);
  let detalles;
  for(const r of winTab_('entries').getDataRange().getValues().slice(1)){
    if(r[16]!=='ACTIVA'||String(r[0])===id||!['Reserva','Clase','Evento'].includes(r[5]))continue;
    const fecha=winDateKey_(r[2]);
    if(Math.abs(Date.parse(fecha)-Date.parse(e.fecha))>2*86400000)continue;
    const mismoProfesor=e.tipo==='Clase'&&r[5]==='Clase'&&winTeacherKey_(e.profesor)===winTeacherKey_(r[9]);
    let otra=winNotaMovimiento_(r[15]).actividad;
    if(!otra&&mismoProfesor){
      if(!detalles)detalles=new Map(winClassDetailRows_().map(x=>[String(x[0]),x]));
      const d=detalles.get(String(r[0]));
      if(d&&/^([01]\d|2[0-3]):[0-5]\d$/.test(d[9])){
        otra={hora:d[9],duracion:d[8]==='Clase-partido'?90:60,canchas:[]};
      }
    }
    if(!otra)continue;
    const cancha=actividad.canchas.find(c=>(otra.canchas||[]).includes(c));
    if(!cancha&&!mismoProfesor)continue;
    const [desde,hasta]=winActividadIntervalo_(fecha,otra);
    if(inicio<hasta&&desde<fin){
      throw Error((cancha?cancha:'El profesor '+e.profesor)+' ya figura en '+String(r[5]).toLowerCase()+
        ' del '+fecha+' a las '+otra.hora+' ('+otra.duracion+' min). Revisá fecha, cancha u horario.');
    }
  }
}
function winPrepararActividad_(e,raw,turno,old,ts){
  const prev=old?winNotaMovimiento_(old[15]):null;
  if(e.tipo==='Reserva'&&e.categoria==='Abonos'&&raw.jugado===false){
    if(e.efectivo+e.transferencia<=0)throw Error('Un abono sin juego requiere un cobro recibido.');
    e.cantidad=0;
    e.nota=winNotaMovimiento_(e.nota,{soloCobro:true});
    return;
  }
  e.cantidad=['Clase','Reserva'].includes(e.tipo)?1:e.cantidad;
  const a=raw.actividad;
  if(!a){
    // Permite corregir importes de un movimiento anterior a los horarios y canchas.
    if(old&&!prev.actividad)return;
    throw Error('Completá la cancha y el horario de la actividad.');
  }
  const canchas=Array.isArray(a.canchas)?[...new Set(a.canchas)]:[];
  if(!canchas.length||canchas.some(c=>!['C1','C2','C3','C4'].includes(c))||
    (e.tipo!=='Evento'&&canchas.length!==1))throw Error(e.tipo==='Evento'?'Elegí las canchas del evento.':'Elegí una cancha.');
  const hora=winStr_(a.hora,5),inicio=winHorarioMinutos_(hora,'la hora de inicio');
  let duracion;
  if(e.tipo==='Evento'){
    const fin=winHorarioMinutos_(a.fin,'la hora de finalización');
    if(fin===inicio)throw Error('Elegí una finalización distinta del inicio.');
    duracion=(fin-inicio+1440)%1440;
    if(e.fecha!==winDateKey_(turno[2]))throw Error('Registrá el evento en la jornada comercial de su caja.');
  }else{
    duracion=winNum_(a.duracion,'duración',false);
    if(e.tipo==='Reserva'&&![60,90,120].includes(duracion))throw Error('Elegí 60, 90 o 120 minutos.');
    if(!Number.isSafeInteger(duracion)||duracion>720)throw Error('Duración inválida.');
  }
  const actividad={canchas,hora,duracion,fin:winHorarioTexto_(inicio+duracion),diaSiguiente:a.diaSiguiente===true};
  if((actividad.diaSiguiente?winDiaSiguiente_(e.fecha):e.fecha)>winDateKey_(ts))throw Error('No se admite actividad futura.');
  if(e.tipo==='Reserva'&&e.categoria==='Regulares'&&e.efectivo+e.transferencia===0&&!e.nota){
    throw Error('Indicá el motivo de la cortesía en Observación.');
  }
  winValidarSuperposicion_(e,actividad,old?String(old[0]):'');
  const datos={actividad};
  if(e.tipo==='Clase'){
    const tipo=winStr_(raw.tipoClase,30),habitual=WIN_CLASS_PRICES[e.alumnos]||0;
    const porcentaje=winReceptionPercent_(old?String(old[0]):'',e.profesor,e.fecha);
    const nota=winStr_(raw.motivoExcepcion,300),revision=winStr_(raw.incidenciaClase,300);
    if(tipo==='Clase-partido'){
      const win=winNum_(raw.importeWIN,'importe de WIN');
      Object.assign(datos,{economia:{win},incidenciaClase:revision});
    }else{
      const cobrado=raw.excepcion===true?winNum_(raw.cobradoClase,'importe real de la clase'):habitual;
      const profesorHabitual=Math.round(habitual*(100-porcentaje))/100;
      const remuneracion=raw.excepcion===true&&winStr_(raw.remuneracionClase)!==''?
        winNum_(raw.remuneracionClase,'remuneración del profesor'):profesorHabitual;
      if(raw.excepcion===true&&!nota)throw Error('Indicá el motivo del acuerdo, descuento o cortesía.');
      const win=Math.max(0,winCajaDiferencia_(cobrado,remuneracion)),aFavor=Math.max(0,winCajaDiferencia_(remuneracion,cobrado));
      Object.assign(datos,{economia:{habitual,cobrado,remuneracion,porcentaje,win,aFavor,motivo:nota},incidenciaClase:revision});
      raw.precioClase=cobrado;
    }
    raw.horarioClase=hora;
    raw.porcentajeWIN=porcentaje;
  }
  e.nota=winNotaMovimiento_(e.nota,datos);
}
const WIN_GASTOS_RECEPCION={
  'Artículos de limpieza':[],'Bar':['Compras','Inversión'],'Equipamiento pádel':['Inversión'],
  'Equipamiento club':['Mantenimiento y reparaciones'],'Gastos menores':[],'Otros gastos':[]
};
function winControlSalidaCaja_(e,turno,old){
  if(!['Gasto','Retiro'].includes(e.tipo))return;
  const anterior=old?winEntryObject_(old):null;
  if(e.tipo==='Gasto'){
    const mantieneHistorico=anterior&&anterior.tipo==='Gasto'&&anterior.categoria===e.categoria&&anterior.medio===e.medio;
    if(!mantieneHistorico){
      if(e.medio!=='Efectivo')throw Error('Desde recepción solo se registran gastos en efectivo.');
      if(!Object.prototype.hasOwnProperty.call(WIN_GASTOS_RECEPCION,e.categoria))throw Error('Elegí una categoría de gastos de recepción.');
      const permitidas=WIN_GASTOS_RECEPCION[e.categoria];
      if(permitidas.length&&!permitidas.includes(winExpenseNote_(e.nota).subcategoria))throw Error('Elegí una subcategoría válida.');
    }
  }
  if(e.medio==='Efectivo'){
    const entradas=winEntries_(String(turno[0])).filter(r=>!old||r.id!==String(old[0]));
    const disponible=winShiftTotals_(String(turno[0]),Number(turno[6])||0,entradas).esperado;
    if(winCajaDiferencia_(disponible,e.importe)<0)throw Error('El importe supera el efectivo disponible en la caja ('+disponible.toLocaleString('es-AR')+').');
  }
}

function winComisionesClase_(){
  return winTab_('audit').getDataRange().getValues().slice(1).flatMap(r=>{
    if(r[2]!=='COMISION_CLASE_M02')return [];
    try{return [JSON.parse(r[5])];}catch(e){return [];}
  }).reverse().sort((a,b)=>b.fecha.localeCompare(a.fecha));
}
function precioClaseRecepcion(p){
  winAuth_(p);
  return winLock_(()=>{
    const profesor=winProfessor_(p.profesor),fecha=winValidDate_(winDateKey_(p.fecha));
    return {porcentaje:winReceptionPercent_(winStr_(p.id,90),profesor,fecha),precios:WIN_CLASS_PRICES};
  });
}
function adminConfigurarComisionClase(p){
  winAdmin_(p);
  return winMutation_(p,'adminConfigurarComisionClase',q=>{
    const user=winAdmin_(q),profesor=winProfessor_(q.profesor),fecha=winValidDate_(winDateKey_(q.fecha));
    const porcentaje=winNum_(q.porcentaje,'porcentaje WIN'),motivo=winStr_(q.motivo,300);
    if(porcentaje>100||!motivo)throw Error('Ingresá un porcentaje de 0 a 100 y el motivo.');
    const dato={profesor,fecha,porcentaje,motivo};
    winTab_('audit').appendRow([winNow_(),user,'COMISION_CLASE_M02','','',JSON.stringify(dato)]);
    return dato;
  });
}
function winConservarDatosOperativos_(e,old,raw){
  if(!old||e.tipo!==old[5])return;
  const meta=winNotaMovimiento_(old[15]);
  const {actividad,soloCobro,incidenciaClase,economia}=meta;
  if(actividad){
    const siguiente={...actividad};
    if(e.tipo==='Clase'&&raw.horarioClase){
      siguiente.hora=raw.horarioClase;
      siguiente.fin=winHorarioTexto_(winHorarioMinutos_(siguiente.hora,'la hora de inicio')+siguiente.duracion);
    }
    if(e.fecha!==winDateKey_(old[2])||siguiente.hora!==actividad.hora)winValidarSuperposicion_(e,siguiente,String(old[0]));
    const datos={actividad:siguiente,incidenciaClase};
    if(economia&&raw.tipoClase==='Tradicional'){
      const precio=winNum_(raw.precioClase,'precio de clase'),rem=winNum_(raw.remuneracionClase??economia.remuneracion??0,'remuneración');
      datos.economia={...economia,cobrado:precio,remuneracion:rem,win:Math.max(0,winCajaDiferencia_(precio,rem)),
        aFavor:Math.max(0,winCajaDiferencia_(rem,precio))};
    }else if(economia&&raw.tipoClase==='Clase-partido'){
      datos.economia={win:winNum_(raw.importeWIN,'importe WIN')};
    }
    e.nota=winNotaMovimiento_(e.nota,datos);
  }else if(soloCobro&&raw.soloCobro===true)e.nota=winNotaMovimiento_(e.nota,{soloCobro:true});
}

function winMediosRendicion_(p){
  const total=winNum_(p.total,'total recibido',false);
  if(p.efectivo===undefined&&p.transferencia===undefined){
    if(!['Efectivo','Transferencia'].includes(p.medio))throw Error('Elegí un medio de pago.');
    return {total,medio:p.medio,efectivo:p.medio==='Efectivo'?total:0,transferencia:p.medio==='Transferencia'?total:0};
  }
  const efectivo=winNum_(p.efectivo??0,'efectivo recibido'),transferencia=winNum_(p.transferencia??0,'transferencias recibidas');
  if(winCajaDiferencia_(efectivo+transferencia,total)!==0)throw Error('El total no coincide con los medios de pago.');
  return {total,efectivo,transferencia,medio:efectivo&&transferencia?'Mixto':efectivo?'Efectivo':'Transferencia'};
}
function winRenglonesPago_(lineas,forma,saldo){
  let cash=Math.round(forma.efectivo*100);
  const sinAsignar=saldo>0?[...lineas,{fecha:'',importe:saldo}]:lineas;
  return sinAsignar.flatMap(l=>{
    const monto=Math.round(l.importe*100),efectivo=Math.min(cash,monto);
    cash-=efectivo;
    const medio=[];
    if(efectivo)medio.push({fecha:l.fecha,medio:'Efectivo',importe:efectivo/100});
    if(monto>efectivo)medio.push({fecha:l.fecha,medio:'Transferencia',importe:(monto-efectivo)/100});
    return medio;
  });
}
function winSaldoMovs_(profesor){
  const key=winTeacherKey_(profesor);
  return winTab_('audit').getDataRange().getValues().slice(1).flatMap(r=>{
    if(r[2]!=='SALDO_PROFESOR_M02')return [];
    try{const op=JSON.parse(r[5]);return winTeacherKey_(op.profesor)===key?[op]:[];}catch(e){return [];}
  });
}
function winSaldoProfesor_(profesor){
  const key=winTeacherKey_(profesor);
  let centavos=0;
  winTab_('allocations').getDataRange().getValues().slice(1).forEach(r=>{
    if(r[9]==='ACTIVO'&&!r[2]&&winTeacherKey_(r[3])===key)centavos+=Math.round((Number(r[5])||0)*100);
  });
  winTab_('entries').getDataRange().getValues().slice(1).forEach(r=>{
    if(r[16]==='ACTIVA'&&r[5]==='Clase'&&winTeacherKey_(r[9])===key){
      centavos+=Math.round((winNotaMovimiento_(r[15]).economia?.aFavor||0)*100);
    }
  });
  winSaldoMovs_(profesor).forEach(r=>{centavos-=Math.round(r.importe*100);});
  return centavos/100;
}
function winValidarCreditoClase_(anterior,siguiente){
  if(anterior?.[5]!=='Clase')return;
  const credito=winNotaMovimiento_(anterior[15]).economia?.aFavor||0;
  if(!credito)return;
  const profesor=String(anterior[9]);
  const conservaProfesor=siguiente?.tipo==='Clase'&&winTeacherKey_(siguiente.profesor)===winTeacherKey_(profesor);
  const nuevo=conservaProfesor?(winNotaMovimiento_(siguiente.nota).economia?.aFavor||0):0;
  const reduccion=winCajaDiferencia_(credito,nuevo);
  if(reduccion>0&&reduccion>winSaldoProfesor_(profesor)){
    throw Error('La clase generó saldo a favor que ya se usó. Revisá primero sus compensaciones o devoluciones.');
  }
}
function moverSaldoProfesor(p){
  return winMutation_(p,'moverSaldoProfesor',q=>{
    const {user,profesor,turno}=winRendicionContext_(q),motivo=winStr_(q.motivo,250);
    if(!motivo)throw Error('Indicá el motivo de la compensación o devolución.');
    if(!['APLICAR','DEVOLVER'].includes(q.accion))throw Error('Acción inválida de saldo a favor.');
    const importe=winNum_(q.importe,'importe de saldo',false);
    if(importe>winSaldoProfesor_(profesor))throw Error('El importe supera el saldo a favor disponible del profesor.');
    const ts=winNow_(),id='SP-'+Utilities.getUuid();
    let fecha='';
    if(q.accion==='APLICAR'){
      fecha=winValidDate_(winDateKey_(q.fecha));
      const pendiente=winTeacherBalances_(profesor).find(d=>d.fecha===fecha)?.pendiente||0;
      if(importe>pendiente||fecha>winDate_())throw Error('El importe supera el pendiente de esa jornada.');
    }else{
      const e=winValidateEntry_({tipo:'Retiro',importe,concepto:'Devolución de saldo a favor',destinatario:profesor,nota:motivo,
        fecha:winFechaActividadCaja_(turno.data,ts)});
      winControlSalidaCaja_(e,turno.data,null);
      winTab_('entries').appendRow([id,q.turnoId,e.fecha,ts,user,'Retiro','',0,0,profesor,0,0,importe,'Efectivo',e.concepto,
        winNotaMovimiento_(e.nota,{devolucionSaldo:true}),'ACTIVA','']);
    }
    winTab_('audit').appendRow([ts,user,'SALDO_PROFESOR_M02',id,q.turnoId,JSON.stringify({accion:q.accion,profesor,fecha,importe,motivo})]);
    return {id,importe,accion:q.accion};
  });
}

/** Historial a demanda: primero se consulta la columna de registro y después las filas seleccionadas. */
function winFilasSeleccionadas_(clave,columna,acepta){
  const sh=winTab_(clave);
  const marcar=(r,fila)=>{if(clave==='allocations')r._row=fila;return r;};
  if(typeof sh.getLastRow!=='function'||winStage_)return sh.getDataRange().getValues().slice(1)
    .map((r,i)=>marcar(r,i+2)).filter(r=>acepta(r[columna-1]));
  const total=sh.getLastRow();
  if(total<2)return [];
  const ancho=WIN_HEADERS[WIN_TABS[clave]].length,filas=[];
  const indices=sh.getRange(2,columna,total-1,1).getValues();
  let inicio=0;
  for(let i=0;i<=indices.length;i++){
    const coincide=i<indices.length&&acepta(indices[i][0]);
    if(coincide&&inicio===0)inicio=i+2;
    else if(!coincide&&inicio){
      sh.getRange(inicio,1,i+2-inicio,ancho).getValues().forEach((r,j)=>filas.push(marcar(r,inicio+j)));
      inicio=0;
    }
  }
  return filas;
}
function winMovimientoHistoria_(r,turnos,admin){
  const e={...winEntryObject_(r),estado:String(r[16]),version:winReviewMovementVersion_(r),
    modificado:!!r[17],caja:turnos.get(String(r[1]))?.[3]||'',cajaCerrada:turnos.get(String(r[1]))?.[1]==='CERRADA'};
  if(!admin)delete e.economia;
  return e;
}
function historialRecepcion(p){
  const user=winAuth_(p);
  return winLock_(()=>{
    const desde=winValidDate_(winDateKey_(p.desde)),hasta=winValidDate_(winDateKey_(p.hasta));
    if(desde>hasta||Date.parse(hasta)-Date.parse(desde)>92*86400000)throw Error('Elegí un período válido de hasta 93 días.');
    const medio=p.medio||'Todos',tipo=winStr_(p.tipo,30),texto=winStr_(p.buscar,160).toLowerCase();
    const pagina=p.pagina===undefined?1:winNum_(p.pagina,'página',false);
    if(!Number.isSafeInteger(pagina))throw Error('Página inválida.');
    const turnos=new Map(winShifts_().slice(1).map(s=>[String(s[0]),s]));
    const enPeriodo=valor=>{const d=winDateKey_(valor);return d>=desde&&d<=hasta;};
    const rangoRegistros=winFilasSeleccionadas_('entries',4,enPeriodo);
    const filas=rangoRegistros.map(r=>winMovimientoHistoria_(r,turnos,user==='Admin'));
    if(!tipo||tipo==='Rendicion'){
      const vistos=winNormalizarAllocationRows_(winFilasSeleccionadas_('allocations',7,enPeriodo),[...turnos.values()]);
      const idsActivos=new Set(vistos.filter(r=>r[9]==='ACTIVO').map(r=>String(r[0])));
      const anulados=vistos.filter(r=>r[9]==='ANULADO'&&!idsActivos.has(String(r[0]))).map(r=>{const v=r.slice();v[9]='ACTIVO';return v;});
      const sumarRecepciones=(registros,estado)=>winDistributedReceipts_(registros).forEach(e=>{
        filas.push({...e,estado,caja:String(turnos.get(e.turno)?.[3]||''),cajaCerrada:turnos.get(e.turno)?.[1]==='CERRADA'});
      });
      sumarRecepciones(vistos,'ACTIVA');sumarRecepciones(anulados,'ANULADA');
    }
    const validas=filas.filter(e=>{
      const pagos=(medio==='Todos'||(['Retiro','Gasto'].includes(e.tipo)?e.medio===medio:medio==='Efectivo'?e.efectivo>0:e.transferencia>0));
      const clase=e.tipo==='RendicionDistribuida'?'Rendicion':e.tipo==='Reserva'?e.categoria:e.tipo;
      return pagos&&(!tipo||clase===tipo)&&(!texto||[e.tipo,e.concepto,e.profesor,e.nota,e.categoria,e.responsable,e.caja,e.destinatario,
        ...(e.actividad?.canchas||[]),e.actividad?.hora].join(' ').toLowerCase().includes(texto));
    }).sort((a,b)=>b.registrado.localeCompare(a.registrado)||b.id.localeCompare(a.id));
    const total=validas.length,paginas=Math.max(1,Math.ceil(total/25)),actual=Math.min(pagina,paginas);
    return {total,paginas,pagina:actual,movimientos:validas.slice((actual-1)*25,actual*25)};
  });
}
function auditoriaMovimientoRecepcion(p){
  const user=winAuth_(p),id=winStr_(p.id,100);
  if(!id)throw Error('Falta identificar el movimiento.');
  const acciones=new Set(['EDICION','ANULACION','CORRECCION_COBRO','CORRECCION_ACTIVIDAD_CERRADA','REVISION_MOVIMIENTO_CERRADO','PROPUESTA_CAJA','DECISION_CAJA']);
  return winLock_(()=>winFilasSeleccionadas_('audit',4,v=>String(v)===id).filter(r=>acciones.has(r[2])).reverse().slice(0,25).map(r=>{
    let dato;
    try{dato=JSON.parse(r[5]);}catch(e){dato={motivo:String(r[5]||'')};}
    const normalizar=x=>{
      if(!x)return null;
      const e=Array.isArray(x)?winEntryObject_(x):{...x};
      if(user!=='Admin'){delete e.economia;delete e.importeWIN;delete e.precio;delete e.porcentaje;}
      return {efectivo:e.efectivo,transferencia:e.transferencia,importe:e.importe,medio:e.medio,nota:e.nota,concepto:e.concepto,
        actividad:e.actividad,profesor:e.profesor,alumnos:e.alumnos,estado:e.estado};
    };
    return {fechaHora:winTimestamp_(r[0]),usuario:String(r[1]),accion:String(r[2]),motivo:dato.motivo||dato.nota||'',
      antes:normalizar(dato.antes),despues:normalizar(dato.despues),estado:dato.estado||''};
  }));
}
function winAvisosRecepcion_(audit){
  const avisos=new Map();
  audit.forEach(r=>{
    if(!['AVISO_RECEPCION','CIERRE_AVISO_RECEPCION','COBRO_DISTRIBUIDO'].includes(r[2]))return;
    let d;try{d=JSON.parse(r[5]);}catch(e){return;}
    const id=String(r[3]),usuario=String(r[1]),fechaHora=winTimestamp_(r[0]);
    if(r[2]==='AVISO_RECEPCION'||r[2]==='COBRO_DISTRIBUIDO'&&d.requiereRevision===true){
      avisos.set(id,{id,tipo:d.tipo||'RENDICION',mensaje:d.mensaje||('Rendición de '+d.profesor+' · '+d.observacion),
        autor:usuario,fechaHora,origen:d.origen||id,resuelto:false});
    }else if(r[2]==='CIERRE_AVISO_RECEPCION'&&avisos.has(id)){
      Object.assign(avisos.get(id),{resuelto:true,resueltoPor:usuario,resueltoEl:fechaHora,nota:d.nota||''});
    }
  });
  return [...avisos.values()].reverse();
}
function avisosRecepcion(p){
  winAuth_(p);
  return winLock_(()=>{
    const todos=winAvisosRecepcion_(winTab_('audit').getDataRange().getValues());
    const pendientes=todos.filter(a=>!a.resuelto).length;
    return {pendientes,avisos:todos.filter(a=>a.resuelto===(p.resueltos===true)).slice(0,60)};
  });
}
function guardarAvisoRecepcion(p){
  return winMutation_(p,'guardarAvisoRecepcion',q=>{
    const user=winAuth_(q),mensaje=winStr_(q.mensaje,400);
    if(!mensaje)throw Error('Escribí el aviso para el siguiente turno.');
    const id='AV-'+Utilities.getUuid();
    winTab_('audit').appendRow([winNow_(),user,'AVISO_RECEPCION',id,'',JSON.stringify({tipo:'MANUAL',mensaje})]);
    return {id};
  });
}
function resolverAvisoRecepcion(p){
  return winMutation_(p,'resolverAvisoRecepcion',q=>{
    const user=winAuth_(q),nota=winStr_(q.nota,400),audit=winTab_('audit').getDataRange().getValues();
    const a=winAvisosRecepcion_(audit).find(r=>r.id===q.id);
    if(!a||a.resuelto)throw Error('El aviso ya se resolvió o no existe.');
    if(a.tipo!=='MANUAL')throw Error('Registrá la resolución en la incidencia de origen.');
    winTab_('audit').appendRow([winNow_(),user,'CIERRE_AVISO_RECEPCION',a.id,'',JSON.stringify({nota,origen:a.origen})]);
    return {id:a.id};
  });
}
function winAvisoClase_(id,turno,user,old,e){
  const anterior=old?winNotaMovimiento_(old[15]).incidenciaClase:'';
  const actual=e?winNotaMovimiento_(e.nota).incidenciaClase:'';
  if((anterior||'')===(actual||''))return;
  const audit=winTab_('audit'),avisos=winAvisosRecepcion_(audit.getDataRange().getValues());
  const ultimo=avisos.find(a=>a.tipo==='CLASE'&&a.origen===id&&!a.resuelto);
  if(ultimo)audit.appendRow([winNow_(),user,'CIERRE_AVISO_RECEPCION',ultimo.id,turno,JSON.stringify({nota:'Se actualizó la incidencia desde la clase.',origen:id})]);
  if(actual)audit.appendRow([winNow_(),user,'AVISO_RECEPCION','AV-'+Utilities.getUuid(),turno,
    JSON.stringify({tipo:'CLASE',origen:id,mensaje:'Clase de '+e.profesor+' · '+e.fecha+' · '+actual})]);
}

function revisarOrigenAviso(p){
  return winMutation_(p,'revisarOrigenAviso',q=>{
    const user=winAuth_(q),nota=winStr_(q.nota,400),audit=winTab_('audit');
    const a=winAvisosRecepcion_(audit.getDataRange().getValues()).find(r=>r.origen===q.origen&&r.tipo===q.tipo&&!r.resuelto);
    if(!a||!nota||a.tipo==='MANUAL')throw Error('Indicá cómo se resolvió la incidencia pendiente.');
    const tabla=a.tipo==='CLASE'?'entries':'allocations';
    if(!winFilasSeleccionadas_(tabla,1,value=>String(value)===a.origen).length)throw Error('No se encontró la operación de origen.');
    audit.appendRow([winNow_(),user,'CIERRE_AVISO_RECEPCION',a.id,'',JSON.stringify({nota,origen:a.origen})]);
    return {id:a.id};
  });
}

function cajasCerradasRecepcion(p){
  winAuth_(p);
  return winLock_(()=>{
    const fecha=winValidDate_(winDateKey_(p.fecha));
    return winShifts_().slice(1).filter(r=>r[1]==='CERRADA'&&winDateKey_(r[2])===fecha)
      .map(r=>({id:String(r[0]),responsable:String(r[3]),apertura:winTimestamp_(r[4]),cierre:winTimestamp_(r[5])}));
  });
}
function winComprobarCobroOmitido_(nuevo){
  const existentes=winEntries_(String(nuevo[1]));
  const e=winEntryObject_(nuevo);
  if(existentes.some(r=>r.tipo===e.tipo&&r.fecha===e.fecha&&r.concepto.toLowerCase()===e.concepto.toLowerCase()&&
    r.categoria===e.categoria&&r.efectivo===e.efectivo&&r.transferencia===e.transferencia)){
    throw Error('Ya figura un cobro idéntico en esa caja. Revisá el movimiento original.');
  }
}
function winCobroOmitido_(p,user,nota,anteriores){
  const turno=winShifts_().slice(1).find(r=>String(r[0])===p.turnoId&&r[1]==='CERRADA');
  if(!turno)throw Error('Elegí una caja cerrada.');
  const jornada=winDateKey_(turno[2]),tipo=winStr_(p.tipo,30),concepto=winStr_(p.concepto,150);
  if(!['Reserva','Tienda','Otro ingreso'].includes(tipo)||!concepto)throw Error('Identificá el cobro real omitido y su motivo.');
  const e=winValidateEntry_({...p,fecha:jornada,cantidad:1,concepto});
  if(e.efectivo+e.transferencia<=0)throw Error('Ingresá el dinero efectivamente recibido.');
  const id='AN-'+Utilities.getUuid(),turnoId=String(turno[0]);
  const nuevo=[id,turnoId,jornada,winNow_(),user,tipo,e.categoria,0,0,'',e.efectivo,e.transferencia,0,'',e.concepto,e.nota,'ACTIVA',''];
  winComprobarCobroOmitido_(nuevo);
  if(anteriores.some(a=>a.estado==='PENDIENTE'&&a.nuevo&&a.turno===turnoId&&
    winEqual_(a.nuevo.slice(5,16),nuevo.slice(5,16))))throw Error('Ya hay una propuesta pendiente para este cobro.');
  return {movimiento:id,turno:turnoId,jornada,fecha:jornada,tipo,nota,nuevo,antes:{efectivo:0,transferencia:0,saldo:0},
    despues:winFinanzasMovimiento_(nuevo)};
}
function winPropuestaRendicion_(q,nota,id,anteriores){
  const rows=winAllocationRows_().filter(r=>r[9]==='ACTIVO'&&String(r[0])===id);
  const original=winDistributedReceipts_(rows)[0];
  if(!original||original.version!==q.version)throw Error('La rendición cambió. Consultala nuevamente.');
  const caja=winShifts_().slice(1).find(r=>String(r[0])===original.turno&&r[1]==='CERRADA');
  if(!caja)throw Error('Elegí una rendición de una caja cerrada identificable.');
  if(anteriores.some(a=>a.estado==='PENDIENTE'&&a.movimiento===id))throw Error('Ya hay una propuesta pendiente para este cobro.');
  const efectivo=winNum_(q.efectivo,'efectivo verificado'),transferencia=winNum_(q.transferencia,'transferencias verificadas');
  if(efectivo===original.efectivo&&transferencia===original.transferencia)throw Error('Los importes no cambiaron.');
  const total=Math.round((efectivo+transferencia)*100)/100;
  const asignado=original.distribucion.reduce((a,l)=>a+l.importe,0),saldoFavor=winCajaDiferencia_(total,asignado);
  if(saldoFavor<0)throw Error('La corrección exige revisar las asignaciones del profesor en Administración.');
  if(total<=0)throw Error('Administración debe revisar una posible anulación de la rendición.');
  return {movimiento:id,origen:'DISTRIBUIDO',turno:original.turno,jornada:winDateKey_(caja[2]),fecha:original.fecha,tipo:'Rendición',
    nota,version:q.version,antes:{efectivo:original.efectivo,transferencia:original.transferencia,saldo:original.efectivo},
    despues:{efectivo,transferencia,saldo:efectivo},datos:{profesor:original.profesor,distribucion:original.distribucion,total,saldoFavor}};
}
function winAprobarRendicionCaja_(registro,user,nota){
  const rows=winAllocationRows_().filter(r=>r[9]==='ACTIVO'&&String(r[0])===registro.movimiento);
  const original=winDistributedReceipts_(rows)[0];
  if(!original||original.version!==registro.version)throw Error('La rendición cambió. Rechazá la propuesta y volvé a consultar.');
  const forma=winMediosRendicion_({...registro.despues,total:registro.datos.total});
  const sh=winTab_('allocations');
  rows.forEach(r=>sh.getRange(r._row,10).setValue('REEMPLAZADO'));
  const {distribucion,saldoFavor}=registro.datos;
  winRenglonesPago_(distribucion,forma,saldoFavor).forEach(l=>sh.appendRow([original.id,original.fecha,l.fecha,original.profesor,
    l.medio,l.importe,original.registrado,original.responsable,original.nota,'ACTIVO',original.turno]));
  if(winSaldoProfesor_(original.profesor)<0)throw Error('Ya se utilizó el saldo a favor de esta rendición.');
  winTab_('audit').appendRow([winNow_(),user,'CORRECCION_COBRO',original.id,original.turno,JSON.stringify({
    fechaCobro:original.fecha,accion:'EDITAR',motivo:nota,turnoCerrado:true,antes:registro.antes,despues:registro.despues,
    deltaEfectivo:winCajaDiferencia_(registro.despues.efectivo,registro.antes.efectivo),
    deltaTransferencia:winCajaDiferencia_(registro.despues.transferencia,registro.antes.transferencia)})]);
}