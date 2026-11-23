const messages:Record<string,string>={
 SESSION_INVALID:'La sesión expiró. Volvé a ingresar.',NOT_AUTHORIZED:'No tenés permisos para esta operación.',
 SHIFT_NOT_OPEN:'La caja original ya está cerrada. Actualizá el estado; no se reasignó el formulario a otra caja.',SHIFT_ALREADY_OPEN:'Ya hay una caja abierta.',
 REQUEST_REQUIRED:'Falta identificar la solicitud. Actualizá la pantalla.',REQUEST_ID_REUSED:'Esta solicitud ya se utilizó con otros datos. Consultá el historial antes de repetir.',
 AMOUNT_INVALID:'Revisá los importes. Usá valores reales, con hasta dos decimales.',CATEGORY_INVALID:'Seleccioná una categoría habilitada.',
 ACTIVITY_INVALID:'Revisá horario, duración y canchas de la actividad.',ACTIVITY_DATE_INVALID:'La actividad realizada no puede pertenecer a una jornada futura.',
 COURT_ACTIVITY_OVERLAP:'Ya hay una actividad registrada en esa cancha y horario. Revisá el historial.',COACH_OVERLAP:'El profesor ya tiene una clase registrada en ese horario.',
 AGENDA_LINK_REQUIRED:'Hay un turno del Calendario en esa franja. Vinculá el turno correcto o corregí el horario.',BOOKING_LINK_INVALID:'El turno vinculado no coincide con la fecha, cancha, tipo o duración.',
 BOOKING_ALREADY_PAID:'Ese turno ya tiene un cobro en Calendario. Dejá en cero el cobro de hoy para no duplicarlo.',
 COURTESY_REASON_REQUIRED:'Indicá el motivo de la cortesía o del valor de actividad cero.',ACTIVITY_VALUE_REQUIRED:'Indicá el valor de la actividad jugada del abono. Es independiente del cobro de hoy.',
 EVENT_SAME_DAY_REQUIRED:'El evento debe rendirse en su misma jornada comercial y registrar la parte recibida por WIN.',PARTICIPANTS_REQUIRED:'Ingresá la cantidad real de participantes.',
 COACH_INVALID:'Seleccioná un profesor habilitado.',CLASS_IS_NOT_CASH:'La clase es actividad; el dinero se registra con Rendición.',
 HISTORIC_RATE_MISSING:'No hay porcentaje configurado para esa fecha. Usá Excepción con los importes reales y motivo.',CLASS_PRICE_MISSING:'No hay tarifa para esa duración y fecha. Usá Excepción con los importes reales.',
 EXCEPTION_REASON_REQUIRED:'Explicá el motivo con al menos cinco caracteres.',CONCEPT_REQUIRED:'Completá el concepto o destinatario y motivo.',
 ALLOCATION_INVALID:'Revisá la imputación por jornada. No puede exceder el pendiente ni el dinero recibido más el crédito que decidiste aplicar.',
 CREDIT_INVALID:'La devolución supera el saldo a favor, o se mezcló con un cobro o imputación.',CREDIT_ALREADY_USED:'Ese saldo a favor ya se aplicó en otra rendición. Revisá primero su origen.',
 CASH_EXPENSE_INVALID:'Gastos y retiros se pagan sólo en efectivo y requieren concepto.',INSUFFICIENT_CASH:'El importe supera el efectivo disponible en esta caja.',
 RECEIPT_AMOUNT_INVALID:'Las partes de los comprobantes superan la transferencia de esta operación.',RECEIPT_INVALID:'Revisá la referencia real del comprobante.',
 RECEIPT_COUNT_REQUIRED:'Completá el monto y la cantidad real de comprobantes. Si hay transferencias, debe haber al menos un comprobante.',
 OPENING_DIFFERENCE_REASON:'El efectivo difiere del último cierre. Recontá e indicá qué encontraste.',BUSINESS_DATE_INVALID:'Elegí la jornada comercial de hoy o de ayer para la operación de madrugada.',
 CLOSE_EXCEPTION_REQUIRED:'Hay una diferencia: indicá motivo, verificaciones realizadas y confirmá que avisaste a Administración.',DAY_HAS_OPEN_SHIFT:'Esa jornada todavía tiene una caja abierta. Cerrá el turno antes del control general.',
 EXPORT_LIMIT:'El período supera 20.000 movimientos. Elegí un rango más corto para exportar el detalle completo.',PERIOD_INVALID:'Elegí un período válido de hasta 366 días.',CLOSED_CORRECTION_REQUIRED:'Los importes de una caja cerrada se corrigen mediante propuesta y aprobación de Administración.',
 OPERATION_NOT_FOUND:'El registro ya no está disponible. Actualizá el historial.',RESOLVE_AT_ORIGIN:'La incidencia se resuelve desde su operación de origen.',
 EDIT_AT_ORIGIN:'Este movimiento está vinculado a otro módulo o ya fue anulado. Revisá su operación de origen.',CORRECTION_NOT_PENDING:'Esa propuesta ya fue revisada.',
 AVAILABILITY_INVALID:'Revisá las fechas, los horarios y las canchas de la disponibilidad real.',PAYMENT_INVALID:'Revisá el cobro, el importe y el medio de pago.'
}
export function operationsError(error:{code?:string,message:string}){
 const key=Object.keys(messages).find(k=>error.message?.includes(k))
 if(key)return {message:messages[key],status:409}
 if(error.code==='23P01')return {message:'Hay una superposición de cancha. Revisá fecha, horario y duración.',status:409}
 if(error.code==='23505')return {message:'El registro o comprobante ya existe. Actualizá el historial antes de repetir.',status:409}
 if(['22P02','22007','22008','23514'].includes(error.code||''))return {message:'Revisá los campos obligatorios, las fechas y los importes.',status:400}
 console.error('operations RPC',error.code,error.message)
 return {message:'No se pudo confirmar la operación. Comprobá el guardado antes de reintentar.',status:500}
}
