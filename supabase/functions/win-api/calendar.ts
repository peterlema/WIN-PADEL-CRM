const messages: Record<string,string> = {
 SESSION_INVALID:'La sesión venció. Volvé a ingresar.',NOT_AUTHORIZED:'Tu usuario no tiene permiso para esta operación.',
 REQUEST_REQUIRED:'Falta identificar la solicitud. Cerrá y volvé a abrir el formulario.',REQUEST_ID_REUSED:'La solicitud ya se usó con otros datos. Consultá el resultado antes de continuar.',
 BOOKING_INVALID:'Revisá la fecha, cancha, horario y duración.',DURATION_INVALID:'Revisá la duración.',PHONE_INVALID:'Revisá el teléfono: incluí el código de área.',
 CUSTOMER_REQUIRED:'Elegí un cliente existente o completá su nombre y teléfono.',CUSTOMER_OR_REQUEST_CONFLICT:'Ya existe ese teléfono o la solicitud se está procesando. Buscá el cliente y actualizá.',
 CUSTOMER_AMBIGUOUS:'Hay varias personas con ese nombre. Elegí la cuenta existente por su teléfono.',
 COURT_TAKEN:'La cancha está ocupada en ese horario. Actualizá la agenda.',ABONO_CONFLICT:'El horario coincide con otra reserva o abono en alguna fecha.',
 COACH_OVERLAP:'El profesor ya tiene una clase en ese horario.',COACH_INVALID:'Elegí un profesor habilitado y entre 1 y 4 alumnos.',
 PRICE_MISSING:'No hay una tarifa vigente para esa duración. Indicá el precio acordado.',PRICE_REASON_REQUIRED:'Explicá el cambio de precio acordado.',
 CLASS_PRICE_MISSING:'Falta tarifa o porcentaje para esa fecha. Cargá una excepción con importes acordados y motivo.',
 EXCEPTION_REASON_REQUIRED:'Completá los importes reales y el motivo de la excepción.',COURTESY_REASON_REQUIRED:'Explicá el motivo de la cortesía.',
 AMOUNT_INVALID:'Revisá el importe. Usá un valor positivo o cero y hasta dos decimales.',PRICE_BELOW_PAID:'El precio no puede quedar por debajo de lo ya pagado. Revisá los cobros asociados.',
 ALREADY_PAID:'Esta fecha ya está pagada. No se registró otro cobro.',PAYMENT_INVALID:'Ingresá el importe que recibiste.',PAYMENT_EXCEEDS_BALANCE:'El cobro supera el saldo pendiente.',
 CLASS_IS_NOT_CASH:'Las clases se registran como actividad. El dinero ingresa con la rendición del profesor.',
 SHIFT_NOT_OPEN:'La caja cambió o ya no está abierta. Actualizá antes de cobrar.',BOOKING_NOT_FOUND:'La actividad ya no está disponible. Actualizá la agenda.',
 STALE_REVISION:'Otra persona modificó esta actividad. Reabrí la ficha para ver la versión actual.',
 ACTIVITY_NOT_FINISHED:'Confirmá la actividad cuando termine su horario.',ACTIVITY_ALREADY_PERFORMED:'La actividad ya ocurrió o fue confirmada. Revisá su historial.',
 PERFORMED_SLOT_FIXED:'Una actividad realizada conserva fecha, cancha, profesor y horario. Podés corregir alumnos, importes y observaciones.',
 ABONO_SLOT_FIXED:'Esta fecha pertenece a un abono fijo. Para liberar su horario usá Saltar semana o Baja del abono.',
 ABONO_REQUIRED:'Esta operación necesita una fecha de abono.',OCCURRENCE_SKIPPED:'Esta semana ya fue salteada.',
 ADMIN_LATE_SKIP_REQUIRED:'Faltan menos de 24 horas. Administración debe autorizar y realizar el traslado del pago con su usuario.',
 NO_VALID_DESTINATION:'No se encontró una fecha válida del mismo abono para aplicar todo el importe. No se realizó ningún cambio.',
 LEGACY_PAYMENT_REVIEW:'Este anticipo anterior necesita identificar su cobro original antes de trasladarlo. No se modificó el dinero.',
 ALLOCATION_EXCEEDS_PAYMENT:'El importe ya está aplicado a otra fecha. Actualizá y revisá el historial.',
 ALLOCATION_REVIEW_REQUIRED:'El cobro se aplicó a varias fechas. Revisá su distribución antes de corregir el importe.',
 OUTSIDE_HOURS:'La actividad queda fuera del horario configurado.',BOOKING_IN_PAST:'Sólo Administración puede cargar una actividad que ya terminó.',
 WAITLIST_INVALID:'Revisá días, franjas horarias, duración y estado de la solicitud.',PERIOD_INVALID:'El período no es válido.',
 NOTE_TOO_LONG:'La observación puede tener hasta 400 caracteres.',REASON_REQUIRED:'Indicá un motivo de al menos cinco caracteres.',
 PARTICIPANTS_REQUIRED:'Podés vincular hasta cuatro participantes.',CATEGORY_MOVED_TO_CALENDAR:'Creá y administrá reservas, abonos y clases desde Calendario.',
 EDIT_AT_ORIGIN:'Abrí la actividad original en Calendario para corregirla.',ACTION_INVALID:'Operación no disponible.'
};
export function calendarError(error: {message?:string;code?:string}) {
 const code=Object.keys(messages).find(key=>String(error.message||'').includes(key));
 return {code:code||'CALENDAR_ERROR',message:code?messages[code]:'No se pudo confirmar la operación. Consultá su estado antes de repetir.',status:code==='SESSION_INVALID'?401:code==='NOT_AUTHORIZED'?403:code?409:500};
}
