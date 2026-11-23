/** WIN Gestión V4.13 — agregar como archivo ReportesActividad.gs.
 * Requiere el Code.gs V4.8 compartido por Pedro el 02/11/2026.
 * Solo lecturas. No altera caja, rendiciones, regularizaciones ni exportaciones.
 */
function adminResumenActividad(p){
  winAdmin_(p);
  return winLock_(()=>{
    const report=adminResumenCore_(p);
    report.generado=winGeneratedActivity_(report.periodo);
    report.cierres=(report.cierres||[]).map(c=>({...c,cierre:winReportStamp_(c.cierre)}));
    return report;
  });
}
function winGeneratedActivity_(period){
  const inPeriod=date=>date>=period.desde&&date<=period.hasta;
  const cents=value=>Math.round((Number(value)||0)*100);
  const details=new Map();
  winClassDetailRows_().forEach(r=>{
    const id=String(r[0]);
    if(details.has(id))throw Error('Detalle de clase duplicado: '+id+'. Administración debe revisar antes de comparar.');
    details.set(id,r);
  });
  const days={},teachers={},categories={},classDays=new Map();
  const key=(date,name)=>JSON.stringify([date,name.trim().toLowerCase()]);
  const day=date=>days[date]||(days[date]={fecha:date,total:0,clases:0,otros:0,sinPrecio:0});
  const teacher=name=>teachers[name]||(teachers[name]={profesor:name,dictadas:0,generado:0,sinPrecio:0});
  let total=0,classTotal=0,unknown=0;
  const add=(date,category,amount)=>{
    total+=amount;categories[category]=(categories[category]||0)+amount;
    const d=day(date);d.total+=amount;if(category==='Clases')d.clases+=amount;else d.otros+=amount;
  };
  winTab_('entries').getDataRange().getValues().slice(1).forEach(r=>{
    const date=winDateKey_(r[2]);
    if(r[16]!=='ACTIVA'||!inPeriod(date))return;
    day(date);
    if(r[5]==='Clase'){
      const qty=Number(r[7])||0,t=teacher(String(r[9])),detail=details.get(String(r[0]));
      t.dictadas+=qty;
      const name=String(r[9]||'');
      const k=key(date,name);
      if(!classDays.has(k))classDays.set(k,{fecha:date,profesor:name,clases:0,alumnos:0,grupos:{},generado:0,sinPrecio:0,pagos:[]});
      const group=classDays.get(k), size=Number(r[8])||0;
      group.clases+=qty;group.alumnos+=qty*size;
      group.grupos[size]=(group.grupos[size]||0)+qty;
      // La anotación activa determina fecha y profesor. El detalle conserva precio y porcentaje histórico.
      if(!detail||detail[10]!=='CONFIRMADO'){
        group.sinPrecio+=qty;t.sinPrecio+=qty;unknown+=qty;day(date).sinPrecio+=qty;return;
      }
      const price=Number(detail[5]),percent=Number(detail[6]),manual=Number(detail[7]);
      const amount=detail[8]==='Clase-partido'||winNotaMovimiento_(r[15]).economia?cents(manual):Math.round(price*qty*percent);
      if(!Number.isFinite(amount)||amount<0||(!['Tradicional','Clase-partido'].includes(String(detail[8])))||(!Number.isFinite(percent)||percent<0||percent>100)){
        throw Error('Detalle económico inválido en la clase '+String(r[0])+'. Revisá su valoración.');
      }
      group.generado+=amount/100;t.generado+=amount;classTotal+=amount;add(date,'Clases',amount);
    }else{
      const category={Reserva:'Reservas',Evento:'Eventos',Tienda:'Tienda','Otro ingreso':'Otros Ingresos'}[r[5]];
      if(category)add(date,category,cents(r[10])+cents(r[11]));
      // Rendiciones, asignaciones y regularizaciones no generan actividad otra vez.
    }
  });
  winTab_('allocations').getDataRange().getValues().slice(1).forEach(r=>{
    if(r[9]!=='ACTIVO')return;
    const group=classDays.get(key(winDateKey_(r[2]),String(r[3]||'')));
    if(group)group.pagos.push({fecha:winDateKey_(r[1]),importe:cents(r[5])/100,medio:String(r[4]||'')});
  });
  return {clasesPorProfesorDia:[...classDays.values()],total:total/100,clases:classTotal/100,sinPrecio:unknown,incompleto:unknown>0,
    dias:Object.values(days).map(d=>({...d,total:d.total/100,clases:d.clases/100,otros:d.otros/100})).sort((a,b)=>a.fecha.localeCompare(b.fecha)),
    profesores:Object.values(teachers).map(t=>({...t,generado:t.generado/100})).sort((a,b)=>a.profesor.localeCompare(b.profesor)),
    categorias:Object.entries(categories).map(([categoria,amount])=>({categoria,total:amount/100})),
    criterio:'Clases: parte de WIN por fecha de actividad y precio confirmado. Otras categorías: importes registrados por fecha de actividad. No incluye rendiciones ni ajustes históricos de saldo.'};
}

/** V4.13 — Corrección administrativa de actividad de clases cerradas.
 * No modifica cobros, distribución, dinero de cierres ni fecha/profesor de la clase.
 */
function winAdminClassRecord_(id){
  const rows=winTab_('entries').getDataRange().getValues();
  const idx=rows.findIndex((r,i)=>i>0&&String(r[0])===String(id)&&r[5]==='Clase');
  if(idx<1)throw Error('Clase no encontrada. Actualizá la jornada.');
  const row=rows[idx],details=winClassDetailRows_().filter(d=>String(d[0])===String(id));
  if(details.length>1)throw Error('La clase tiene detalles duplicados. Requiere revisión.');
  const detail=details[0]||null;
  return {idx,row,detail,version:winHash_(JSON.stringify({row,detail}))};
}
function winAdminClassView_(record){
  const e=winEntryObject_(record.row),d=record.detail;
  const shift=winShifts_().slice(1).find(r=>String(r[0])===e.turno);
  return {...e,estado:String(record.row[16]),version:record.version,
    turnoCerrado:!!shift&&shift[1]==='CERRADA',
    detalle:d?{precio:d[10]==='CONFIRMADO'?Number(d[5]):null,porcentaje:Number(d[6]),importeWIN:Number(d[7]),tipo:String(d[8]),horario:winReportHour_(d[9]),estado:String(d[10])}:null};
}
function adminClasesDiaActualizadas(p){
  winAdmin_(p);return winLock_(()=>{
    const fecha=winValidDate_(winDateKey_(p.fecha));
    const classes=winTab_('entries').getDataRange().getValues().slice(1)
      .filter(r=>r[5]==='Clase'&&winDateKey_(r[2])===fecha)
      .map(r=>winAdminClassView_(winAdminClassRecord_(r[0])));
    return {fecha,consultado:winNow_(),clases:classes};
  });
}
function adminCorregirClaseCerradaCore_(p){
  const user=winAdmin_(p),rec=winAdminClassRecord_(winStr_(p.id,100)),old=rec.row;
  if(!p.version||p.version!==rec.version)throw Error('La clase cambió. Consultá nuevamente antes de corregir.');
  if(old[16]!=='ACTIVA')throw Error('Solo se corrigen clases activas.');
  const shift=winShifts_().slice(1).find(r=>String(r[0])===String(old[1]));
  if(!shift||shift[1]!=='CERRADA')throw Error('Esta acción requiere una clase de un turno cerrado. Para turno abierto usá Editar en recepción.');
  const reason=winStr_(p.motivo,300);if(!reason)throw Error('Indicá el motivo de la corrección.');
  const e=winValidateEntry_({tipo:'Clase',fecha:winDateKey_(old[2]),cantidad:Number(old[7]),alumnos:p.alumnos,tipoClase:p.tipoClase,profesor:String(old[9]),nota:p.nota},old);
  const prior=rec.detail;
  const kind=winStr_(p.tipoClase,60);if(!['Tradicional','Clase-partido'].includes(kind))throw Error('Tipo de clase inválido.');
  const percent=prior?Number(prior[6]):winClassDefaults_(e.profesor);
  const price=kind==='Tradicional'?winNum_(p.precioClase,'precio total de clase'):0;
  const manual=kind==='Clase-partido'?winNum_(p.importeWIN,'importe para WIN'):0;
  const time=winStr_(p.horarioClase,5);if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(time))throw Error('Indicá la hora de inicio HH:MM.');
  winConservarDatosOperativos_(e,old,{...p,precioClase:price,importeWIN:manual,horarioClase:time});
  winValidarCreditoClase_(old,e);
  const expected=winNotaMovimiento_(e.nota).economia?.win??(kind==='Clase-partido'?manual:Math.round(price*e.cantidad*percent)/100);
  const beforeView=winAdminClassView_(rec);
  if(prior&&Number(old[8])===e.alumnos&&prior[10]==='CONFIRMADO'&&String(prior[8])===kind&&String(prior[9])===time&&Number(prior[5])===price&&Number(prior[7])===expected&&String(old[15]||'')===e.nota)throw Error('No hay cambios para guardar.');
  const beforeBalance=winTeacherBalances_(e.profesor).find(d=>d.fecha===e.fecha)?.pendiente||0;
  // La escritura se mantiene dentro del diario recuperable e idempotente de V4.8.
  winSaveClassDetail_(String(old[0]),e,{precioClase:price,porcentajeWIN:percent,tipoClase:kind,horarioClase:time,importeWIN:manual,nota:e.nota},user);
  const correction='AC-'+Utilities.getUuid();
  const replacement=old.slice();replacement[8]=e.alumnos;replacement[15]=e.nota;replacement[17]=correction;
  // Marcar la anotación también invalida huellas de revisión/exportación en cambios solo de precio.
  winTab_('entries').getRange(rec.idx+1,1,1,replacement.length).setValues([replacement]);
  const afterBalance=winTeacherBalances_(e.profesor).find(d=>d.fecha===e.fecha)?.pendiente||0;
  if(afterBalance<Math.min(0,beforeBalance)-0.001)throw Error('La corrección dejaría una rendición superior a la deuda registrada de esa fecha. Revisá primero sus imputaciones; no se modificó el cobro.');
  const afterView=winAdminClassView_(winAdminClassRecord_(old[0]));
  winTab_('audit').appendRow([winNow_(),user,'CORRECCION_ACTIVIDAD_CERRADA',String(old[0]),String(old[1]),JSON.stringify({correction,motivo:reason,antes:beforeView,despues:afterView,pendienteAntes:beforeBalance,pendienteDespues:afterBalance})]);
  return {id:String(old[0]),fecha:e.fecha,profesor:e.profesor,pendienteAntes:beforeBalance,pendienteDespues:afterBalance,accion:'CORREGIDA'};
}
function adminCorregirClaseCerrada(p){winAdmin_(p);return winMutation_(p,'adminCorregirClaseCerrada',adminCorregirClaseCerradaCore_);}
/** Consulta fresca: muestra las anotaciones consideradas además de los asientos financieros. */
function adminAsientosDiaActualizada(p){
  winAdmin_(p);return winLock_(()=>{
    const fecha=winValidDate_(winDateKey_(p.fecha)),pack=winDailyPack_(fecha);
    const clases=winTab_('entries').getDataRange().getValues().slice(1)
      .filter(r=>r[5]==='Clase'&&r[16]==='ACTIVA'&&winDateKey_(r[2])===fecha)
      .map(r=>winAdminClassView_(winAdminClassRecord_(r[0])));
    const cantidad=clases.reduce((s,c)=>s+c.cantidad,0),alumnos=clases.reduce((s,c)=>s+c.cantidad*c.alumnos,0);
    if(pack.actividad.clases!==cantidad||pack.actividad.alumnos!==alumnos)throw Error('La jornada presenta una inconsistencia de actividad. No exportes hasta revisar.');
    return {...pack,clasesDetalle:clases,consultado:winNow_(),generado:winGeneratedActivity_({desde:fecha,hasta:fecha})};
  });
}

/** Sheets puede devolver una celda de hora como Date del 30/12/1899.
 * Solo presentación. Nunca modifica la fecha ni hora guardada.
 */
function winReportHour_(value){
  if(value instanceof Date&&!isNaN(value.getTime()))return Utilities.formatDate(value,WIN_TZ,'HH:mm');
  const text=String(value||'').trim();
  const simple=text.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if(simple&&Number(simple[1])<24&&Number(simple[2])<60)return simple[1].padStart(2,'0')+':'+simple[2];
  // Compatibilidad con cadenas antiguas Date.toString(): conservar la hora de pared original.
  const legacy=text.match(/\b(\d{2}):(\d{2}):\d{2} GMT[+-]\d{4}/);
  return legacy?legacy[1]+':'+legacy[2]:'';
}
function winReportStamp_(value){
  if(value instanceof Date&&!isNaN(value.getTime()))return Utilities.formatDate(value,WIN_TZ,'dd/MM/yyyy HH:mm');
  const text=String(value||'').trim();if(!text)return '';
  const iso=text.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}:\d{2})(?::\d{2})?$/);
  if(iso)return iso[3]+'/'+iso[2]+'/'+iso[1]+' '+iso[4];
  if(/^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/.test(text))return text;
  const date=new Date(text);
  return !isNaN(date.getTime())?Utilities.formatDate(date,WIN_TZ,'dd/MM/yyyy HH:mm'):'Fecha no disponible';
}
function adminControlDiarioActualizado(p){
  winAdmin_(p);return winLock_(()=>{
    const result=adminControlDiarioCore_(p);
    const shifts=new Map(winShifts_().slice(1).map(r=>[String(r[0]),r]));
    result.turnos=result.turnos.map(t=>{const raw=shifts.get(t.id);return {...t,apertura:winReportStamp_(raw?raw[4]:t.apertura),cierre:winReportStamp_(raw?raw[5]:t.cierre)};});
    if(result.revision)result.revision.fechaHora=winReportStamp_(result.revision.fechaHora);
    const rows=winTab_('entries').getDataRange().getValues().slice(1);
    const byId=new Map(rows.map(r=>[String(r[0]),r]));
    const dayClosed=result.turnos.length>0&&result.turnos.every(t=>t.estado==='CERRADA');
    result.diaCerrado=dayClosed;
    result.movimientos=result.movimientos.map(m=>{
      const row=byId.get(m.id);
      if(!row||row[16]!=='ACTIVA'||!dayClosed||(row[1]!=='AJUSTE-ADMIN'&&shifts.get(String(row[1]))?.[1]!=='CERRADA'))return m;
      const d=row[5]==='Clase'?winAdminClassView_(winAdminClassRecord_(m.id)).detalle:null;
      return {...m,version:winReviewMovementVersion_(row),detalle:d};
    });
    result.ajusteEfectivo=winTab_('audit').getDataRange().getValues().slice(1)
      .filter(r=>r[2]==='REVISION_MOVIMIENTO_CERRADO')
      .reduce((sum,r)=>{
        const change=JSON.parse(r[5]);
        const cash=row=>row&&row[16]==='ACTIVA'&&winDateKey_(row[2])===result.fecha?winTotals_([winEntryObject_(row)],0).esperado:0;
        return sum+cash(change.despues)-cash(change.antes);
      },0);

    return result;
  });
}

function winClassRequests_(){
  const requests=new Map();
  winTab_('audit').getDataRange().getValues().slice(1).forEach(r=>{
    if(r[2]==='SOLICITUD_CLASE_CERRADA'){
      const request=JSON.parse(r[5]);
      requests.set(request.solicitud,{...request,solicitante:String(r[1]),estado:'Pendiente'});
    }
    if(r[2]==='RESOLUCION_CLASE_CERRADA'){
      const resolution=JSON.parse(r[5]),request=requests.get(resolution.solicitud);
      if(request)Object.assign(request,resolution,{revisor:String(r[1])});
    }
  });
  return [...requests.values()].reverse();
}
function consultarSolicitudesClase(p){
  const user=winAuth_(p);
  return winLock_(()=>{
    const requests=winClassRequests_();
    const fecha=winValidDate_(winDateKey_(p.fecha));
    const clases=winTab_('entries').getDataRange().getValues().slice(1)
      .filter(r=>r[4]===user&&r[5]==='Clase'&&r[16]==='ACTIVA'&&winDateKey_(r[2])===fecha&&fecha<winDate_())
      .map(r=>winAdminClassView_(winAdminClassRecord_(r[0])))
      .filter(c=>c.turnoCerrado&&c.detalle?.estado==='CONFIRMADO'&&c.detalle.horario);
    return {clases,solicitudes:requests.filter(r=>user==='Admin'||r.solicitante===user)};
  });
}
function solicitarCorreccionClase(p){
  return winMutation_(p,'solicitarCorreccionClase',q=>{
    const user=winAuth_(q),rec=winAdminClassRecord_(winStr_(q.id,100)),view=winAdminClassView_(rec);
    if(rec.row[4]!==user||rec.row[16]!=='ACTIVA'||!view.turnoCerrado||view.fecha>=winDate_())throw Error('Solo podés solicitar cambios en tus clases activas de un turno anterior cerrado.');
    if(rec.version!==q.version)throw Error('La clase cambió. Volvé a consultar.');
    if(view.detalle?.estado!=='CONFIRMADO'||!view.detalle.horario)throw Error('La clase requiere revisión administrativa.');
    if(winClassRequests_().some(r=>r.id===view.id&&r.estado==='Pendiente'))throw Error('La clase ya tiene una solicitud pendiente.');
    const alumnos=Number(q.alumnos),motivo=winStr_(q.motivo,300);
    if(!Number.isInteger(alumnos)||alumnos<1||alumnos>4||!motivo)throw Error('Indicá cantidad de alumnos y motivo.');
    const d=view.detalle,importe=winNum_(q.importe,'importe');
    const propuesta={id:view.id,version:rec.version,alumnos,motivo,tipoClase:d.tipo,horarioClase:d.horario,nota:view.nota,
      precioClase:d.tipo==='Tradicional'?importe:0,importeWIN:d.tipo==='Clase-partido'?importe:0};
    const request={...propuesta,solicitud:Utilities.getUuid(),profesor:view.profesor,fecha:view.fecha,antesAlumnos:view.alumnos,antesImporte:d.importeWIN,
      nuevoImporte:d.tipo==='Clase-partido'?importe:Math.round(importe*view.cantidad*d.porcentaje)/100};
    winTab_('audit').appendRow([winNow_(),user,'SOLICITUD_CLASE_CERRADA',view.id,view.turno,JSON.stringify(request)]);
    return {solicitud:request.solicitud};
  });
}
function resolverSolicitudClase(p){
  winAdmin_(p);
  return winMutation_(p,'resolverSolicitudClase',q=>{
    const user=winAdmin_(q),request=winClassRequests_().find(r=>r.solicitud===q.solicitud);
    if(!request||request.estado!=='Pendiente')throw Error('La solicitud ya fue resuelta o no existe.');
    if(!['Aprobada','Rechazada'].includes(q.estado))throw Error('Decisión inválida.');
    const motivo=winStr_(q.motivo,300);
    if(q.estado==='Rechazada'&&!motivo)throw Error('Indicá el motivo del rechazo.');
    if(q.estado==='Aprobada')adminCorregirClaseCerradaCore_({...q,...request});
    winTab_('audit').appendRow([winNow_(),user,'RESOLUCION_CLASE_CERRADA',request.id,'',JSON.stringify({solicitud:request.solicitud,estado:q.estado,respuesta:motivo})]);
    return {estado:q.estado};
  });
}

function winReviewMovementVersion_(row){
  const detail=row[5]==='Clase'?winAdminClassRecord_(row[0]).detail:null;
  return winHash_(JSON.stringify({row,detail}));
}
function winRequireClosedDay_(fecha){
  const shifts=winShifts_().slice(1).filter(r=>winDateKey_(r[2])===fecha);
  if(!shifts.length||shifts.some(r=>r[1]!=='CERRADA'))throw Error('La fecha debe tener todos sus turnos cerrados.');
}
function adminGestionarMovimientoCerrado(p){
  winAdmin_(p);
  return winMutation_(p,'adminGestionarMovimientoCerrado',q=>{
    const user=winAdmin_(q),reason=winStr_(q.motivo,300);
    if(!reason)throw Error('Indicá el motivo.');
    if(!['alta','editar','anular'].includes(q.accion))throw Error('Acción inválida.');
    const sh=winTab_('entries'),rows=sh.getDataRange().getValues();
    const index=q.accion==='alta'?-1:rows.findIndex((r,i)=>i>0&&String(r[0])===String(q.id)&&r[16]==='ACTIVA');
    const old=index>0?rows[index]:null;
    if(q.accion!=='alta'&&(!old||winReviewMovementVersion_(old)!==q.version))throw Error('El movimiento cambió. Volvé a consultar.');
    if(old){
      if(winNotaMovimiento_(old[15]).devolucionSaldo)throw Error('La devolución está vinculada a un saldo de profesor y requiere revisar ambos registros.');
      winRequireClosedDay_(winDateKey_(old[2]));
      const shift=winShifts_().slice(1).find(r=>String(r[0])===String(old[1]));
      if(old[1]!=='AJUSTE-ADMIN'&&shift?.[1]!=='CERRADA')throw Error('El turno original debe estar cerrado.');
    }
    const id=old?String(old[0]):'WA-'+Utilities.getUuid(),turno=old?old[1]:'AJUSTE-ADMIN';
    const raw=q.movimiento||{},voided=q.accion==='anular';
    const fecha=voided?winDateKey_(old[2]):winValidDate_(winDateKey_(raw.fecha));
    if(fecha>winDate_())throw Error('Fecha futura.');
    winRequireClosedDay_(fecha);
    const onlyPayment=raw.tipo==='Reserva'&&raw.soloCobro===true;
    const e=voided?null:winValidateEntry_({...raw,fecha,cantidad:onlyPayment?1:raw.cantidad},old);
    if(e)winConservarDatosOperativos_(e,old,raw);
    winValidarCreditoClase_(old,e);
    if(onlyPayment&&e){
      if(e.efectivo+e.transferencia<=0)throw Error('Indicá el importe del cobro omitido.');
      e.cantidad=0;
    }
    const previousDetail=old?.[5]==='Clase'?winAdminClassRecord_(id).detail:null;
    const balances=new Map();
    [old?.[5]==='Clase'?String(old[9]):null,e?.tipo==='Clase'?e.profesor:null].filter(Boolean).forEach(name=>{
      if(!balances.has(name))balances.set(name,winTeacherBalances_(name));
    });
    if(old?.[5]==='Rendicion')winValidateReceiptChange_(id,e?.tipo==='Rendicion'?e:null);
    if(old?.[5]==='Clase'&&e?.tipo!=='Clase')winCancelClassDetail_(id);
    if(e?.tipo==='Clase'){
      if(e.cantidad!==1)throw Error('Registrá una clase por movimiento.');
      if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(raw.horarioClase||'')))throw Error('Indicá el horario de la clase.');
      const mode=raw.tipoClase;
      if(!['Tradicional','Clase-partido'].includes(mode))throw Error('Elegí el tipo de clase.');
      if(mode==='Clase-partido')winNum_(raw.importeWIN,'importe para WIN');
      else winNum_(raw.precioClase,'precio total');
      winSaveClassDetail_(id,e,raw,user);
    }
    const correction='AC-'+Utilities.getUuid();
    const next=voided?old.slice():[id,turno,fecha,old?old[3]:winNow_(),old?old[4]:user,e.tipo,e.categoria,e.cantidad,e.alumnos,e.profesor,e.efectivo,e.transferencia,e.importe,e.medio,e.concepto,e.nota,'ACTIVA',correction];
    if(voided){next[16]='ANULADA';next[17]=correction;}
    if(old)sh.getRange(index+1,1,1,next.length).setValues([next]);else sh.appendRow(next);
    balances.forEach((before,name)=>{
      const previous=new Map(before.map(d=>[d.fecha,d.pendiente]));
      if(winTeacherBalances_(name).some(d=>d.pendiente<Math.min(0,previous.get(d.fecha)||0)-0.001))throw Error('La corrección dejaría una rendición excedida. Revisá las imputaciones de esa clase.');
    });
    const newDetail=e?.tipo==='Clase'?winAdminClassRecord_(id).detail:null;
    winTab_('audit').appendRow([winNow_(),user,'REVISION_MOVIMIENTO_CERRADO',id,turno,JSON.stringify({motivo:reason,accion:q.accion,antes:old,despues:next,detalleAnterior:previousDetail,detalleNuevo:newDetail})]);
    return {id,fecha};
  });
}