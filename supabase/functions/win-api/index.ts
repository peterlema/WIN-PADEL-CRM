import { operationsError } from './operations.ts';
import { calendarError } from './calendar.ts';
import { createClient } from "npm:@supabase/supabase-js@2.119.2";

const allowedOrigins = new Set([
  "https://peterlema.github.io",
  "https://win-padel-crm.peterlema35.workers.dev",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
]);
function reply(obj: unknown, status=200, origin="") {
  const headers: Record<string,string> = {"Content-Type":"application/json","Cache-Control":"no-store","Vary":"Origin"};
  if (allowedOrigins.has(origin)) { headers["Access-Control-Allow-Origin"]=origin; headers["Access-Control-Allow-Headers"]="authorization, content-type"; headers["Access-Control-Allow-Methods"]="POST, OPTIONS"; }
  return new Response(status === 204 ? null : JSON.stringify(obj), {status, headers});
}
function adminClient() {
  const url=Deno.env.get("SUPABASE_URL");
  const candidates=Deno.env.get("SUPABASE_SECRET_KEYS");
  let key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (candidates) { try { const keys=JSON.parse(candidates); key=keys.default||key; } catch { /* use legacy env */ } }
  if(!url||!key) throw new Error("BACKEND_NOT_CONFIGURED");
  return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
}
const errors:Record<string,string>={SESSION_INVALID:"La sesión expiró. Volvé a ingresar.",NOT_AUTHORIZED:"Tu usuario no tiene permisos para esta acción.",BAR_STOCK_INSUFFICIENT:"No hay suficientes unidades disponibles. Actualizá Stock y precios.",BAR_COUNT_REQUIRED:"El producto necesita conteo inicial.",BAR_SHIFT_NOT_OPEN:"Abrí Caja Bar para registrar esta operación.",BAR_BANK_REQUIRED:"Confirmá la cuenta bancaria del Bar antes de cobrar transferencias.",BAR_COST_MANAGED:"El costo se calcula desde las compras recibidas; actualizá el catálogo.",SHIFT_ALREADY_OPEN:"Ya hay una caja abierta.",SHIFT_NOT_OPEN:"La caja ya no está abierta.",AMOUNT_INVALID:"Revisá el importe.",METHOD_INVALID:"Medio de pago no permitido.",CATEGORY_INVALID:"Categoría no permitida.",DIFFERENCE_REQUIRES_NOTE:"Explicá la diferencia del cierre.",NOTE_TOO_LONG:"La observación es demasiado larga.",PRODUCT_INVALID:"Revisá los datos del producto.",PRODUCT_NOT_FOUND:"El producto no existe.",CONFIG_INVALID:"Revisá los datos: nombre, importe o porcentaje.",CONFIG_NOT_FOUND:"El dato ya no existe. Actualizá la pantalla.",NAME_TAKEN:"Ya existe uno con ese nombre.",PRICE_DATE_PAST:"Los precios sólo se cambian desde hoy o una fecha futura.",ORDER_INVALID:"Revisá los productos y la forma de cobro.",PRICE_NOT_SET:"Hay un producto sin precio de venta configurado.",CUSTOMER_INVALID:"Elegí una cuenta válida o creá una persona.",CUSTOMER_AMBIGUOUS:"Hay varias personas con ese nombre. Elegí la cuenta por su teléfono.",COURT_INVALID:"Revisá la cancha y el turno seleccionado.",DATE_INVALID:"Fecha fuera de rango.",PAYMENT_INVALID:"Revisá el importe o el medio de pago.",ORDER_NOT_PENDING:"Ese consumo ya no está pendiente.",PAYMENT_EXCEEDS_BALANCE:"El cobro supera el saldo pendiente.",REQUEST_ID_REUSED:"Esta solicitud ya se usó con otros datos."};
Deno.serve(async req=>{
  const origin=req.headers.get("Origin")||"";
  if(origin&&!allowedOrigins.has(origin)) return reply({error:"Origen no autorizado"},403);
  if(req.method==="OPTIONS") return reply({},204,origin);
  if(req.method!=="POST") return reply({error:"Método no permitido"},405,origin);
  if(Number(req.headers.get("content-length")||0)>65536) return reply({error:"Solicitud demasiado grande"},413,origin);
  let data:Record<string,unknown>;
  try { data=await req.json(); if(!data||typeof data!=="object"||Array.isArray(data)) throw Error(); }
  catch {return reply({error:"Formato inválido"},400,origin);}
  const action=String(data.action||"");
  const db=adminClient();
  try {
    if(action==="login") {
      const username=String(data.username||"").trim();
      const pin=String(data.pin||"");
      if(username.length>100||!/^\d{6}$/.test(pin)) return reply({error:"Usuario o PIN incorrectos"},401,origin);
      const {data:rows,error}=await db.rpc("win_pin_login",{p_username:username,p_pin:pin});
      if(error) throw error;
      const result=rows?.[0];
      if(result?.login_status==="LOCKED") return reply({error:"Acceso temporalmente bloqueado. Reintentá más tarde."},429,origin);
      if(result?.login_status!=="OK") return reply({error:"Usuario o PIN incorrectos"},401,origin);
      return reply({token:result.session_token,user:{id:result.account_id,name:result.display_name,role:result.role},expiresAt:result.expires_at},200,origin);
    }
    const token=(req.headers.get("Authorization")||"").match(/^Bearer ([a-f0-9]{64})$/)?.[1]||"";
    if(!token) return reply({error:"Sesión requerida"},401,origin);
    const {data:sessions,error:sessionError}=await db.rpc("win_pin_session",{p_token:token});
    if(sessionError) throw sessionError;
    const identity=sessions?.[0];
    if(!identity) return reply({error:"Sesión inválida o vencida"},401,origin);
    if(action==="me") return reply({user:{id:identity.account_id,name:identity.display_name,role:identity.role},expiresAt:identity.expires_at},200,origin);
    if(action==="logout") { await db.rpc("win_pin_logout",{p_token:token});return reply({ok:true},200,origin); }
    if(action.startsWith("users.")) {
      const {data:result,error}=await db.rpc("win_users_api",{p_token:token,p_action:action.slice(6),p:data});
      if(error){
        const messages:Record<string,string>={SESSION_INVALID:"La sesión expiró. Volvé a ingresar.",NOT_AUTHORIZED:"Sólo un administrador puede gestionar usuarios y roles.",USER_PIN_INVALID:"Ingresá un PIN de exactamente seis dígitos.",USER_DATA_INVALID:"Completá el nombre y un usuario de entre 3 y 100 caracteres.",USER_ROLE_INVALID:"Elegí un perfil de permisos válido.",USER_NAME_TAKEN:"Ese usuario de ingreso ya existe.",USER_ROLE_TAKEN:"Ya existe un rol con ese nombre.",USER_NOT_FOUND:"El usuario ya no existe. Actualizá la lista.",USER_SELF_PROTECTED:"Tu propio usuario debe conservar el acceso de administrador.",USER_LAST_ADMIN:"Debe quedar al menos un administrador activo.",USER_REQUEST_REQUIRED:"Cerrá y volvé a abrir el formulario.",USER_REQUEST_REUSED:"Esta solicitud ya se usó con otros datos. Actualizá la lista.",USER_ACTION_INVALID:"Operación de usuarios no disponible."};
        const code=Object.keys(messages).find(k=>error.message.includes(k));
        return reply({error:code?messages[code]:"No se pudo guardar. Actualizá la lista antes de reintentar.",code:code||"USER_ERROR"},code==="NOT_AUTHORIZED"?403:code==="SESSION_INVALID"?401:409,origin);
      }
      return reply(result,200,origin);
    }
    if(action==="calendar.move") {
      const {data:result,error}=await db.rpc("win_calendar_move",{p_token:token,p:data});
      if(error){const failure=calendarError(error);return reply({error:failure.message,code:failure.code},failure.status,origin);}
      return reply(result,200,origin);
    }
    if(action.startsWith("bar.employee.")) {
      const {data:result,error}=await db.rpc("win_bar_employee_api",{p_token:token,p_action:action.slice(13),p:data});
      if(error){
        const messages:Record<string,string>={...errors,EMPLOYEE_PRICING_DISABLED:"Los precios para empleados están desactivados, pendientes de aprobación administrativa.",EMPLOYEE_NOT_AUTHORIZED:"El empleado debe estar identificado, activo y autorizado.",EMPLOYEE_PRICE_INVALID:"Revisá el precio fijo o porcentaje del producto.",EMPLOYEE_REASON_REQUIRED:"Ingresá un motivo de entre 5 y 400 caracteres.",EMPLOYEE_EXCEPTION_REQUIRED:"El precio requiere una autorización administrativa por estar debajo del costo o no tener costo confirmado.",EMPLOYEE_EXCEPTION_INVALID:"La autorización ya se utilizó, venció o cambió el precio o costo. Solicitá una nueva.",STALE_REVISION:"Otro administrador cambió este borrador. Actualizá antes de guardar.",PERIOD_INVALID:"Elegí un período de hasta un año.",BAR_REQUEST_REQUIRED:"Actualizá la pantalla antes de guardar."};
        const code=Object.keys(messages).find(k=>error.message.includes(k));
        return reply({error:code?messages[code]:"No se pudo completar la operación. Actualizá antes de reintentar.",code:code||"EMPLOYEE_ERROR"},code==="NOT_AUTHORIZED"?403:409,origin);
      }
      return reply(result,200,origin);
    }
    if(action.startsWith("bar.inventory.")) {
      const {data:result,error}=await db.rpc("win_bar_inventory_api",{p_token:token,p_action:action.slice(14),p:data});
      if(error){
        const messages:Record<string,string>={NOT_AUTHORIZED:"Tu usuario no tiene acceso a esta operación de Bar.",SESSION_INVALID:"La sesión expiró. Volvé a ingresar.",BAR_SHIFT_NOT_OPEN:"Abrí Caja Bar antes de cobrar o pagar. Caja Recepción es independiente.",BAR_BANK_REQUIRED:"Confirmá la cuenta bancaria exclusiva del Bar en Caja Bar antes de registrar transferencias.",BAR_STOCK_INSUFFICIENT:"No hay suficientes unidades disponibles. Revisá Stock y precios.",BAR_COUNT_REQUIRED:"El producto necesita un conteo inicial antes de operar.",BAR_DATA_INVALID:"Revisá los campos y el motivo de la operación.",BAR_PURCHASE_INVALID:"Revisá proveedor, fecha, productos, cantidades y costos. La compra histórica no admite pagos sin confirmación.",BAR_RECEIPT_INVALID:"Revisá las cantidades pendientes: no se puede recibir dos veces la misma mercadería.",BAR_CLOSE_INVALID:"Revisá el efectivo contado y explicá cualquier diferencia con al menos cinco caracteres.",BAR_REQUEST_REQUIRED:"Actualizá la pantalla para registrar una solicitud válida.",REQUEST_ID_REUSED:"La solicitud ya se utilizó con otros datos. Consultá el estado antes de repetir.",PAYMENT_INVALID:"Revisá el importe pagado y el saldo de la compra.",SHIFT_ALREADY_OPEN:"Caja Bar ya está abierta.",BAR_ACTION_INVALID:"Operación de inventario no disponible."};
        const code=Object.keys(messages).find(k=>error.message.includes(k));
        return reply({error:code?messages[code]:"No se pudo guardar. Consultá Actualizar antes de reintentar.",code:code||"BAR_ERROR"},code==="NOT_AUTHORIZED"?403:409,origin);
      }
      return reply(result,200,origin);
    }
    if(action.startsWith("calendar.")) {
      const {data:result,error}=await db.rpc("win_calendar_api",{p_token:token,p_action:action.slice(9),p:data});
      if(error){const failure=calendarError(error);return reply({error:failure.message,code:failure.code},failure.status,origin);}
      return reply(result,200,origin);
    }
    if(action.startsWith("ops.")) {
      const {data:result,error}=await db.rpc("win_ops_api",{p_token:token,p_action:action.slice(4),p_data:data});
      if(error){const calendarFailure=calendarError(error);const failure=calendarFailure.code!=="CALENDAR_ERROR"?calendarFailure:operationsError(error);return reply({error:failure.message},failure.status,origin);}
      return reply(result,200,origin);
    }
    if(action==="cash.close" || action==="cash.open") return reply({error:"Actualizá la página para usar apertura y conciliación completas."},409,origin);
    let name="", params:Record<string,unknown>={p_token:token};
    if(action==="admin.finance"){name="win_admin_finance_report";params.p_start=data.start;params.p_end=data.end;}
    else if(action==="admin.control"){name="win_admin_cash_control";params.p_start=data.start;params.p_end=data.end;}
    else if(action==="reception.overview") name="win_reception_overview";
    else if(action==="config.list") name="win_config_list";
    else if(action==="settings.get") name="win_settings_get";
    else if(action==="config.setting.set"){name="win_config_setting_set";Object.assign(params,{p_key:data.key,p_value:data.value});}
    else if(action==="config.item.save"){
      name="win_config_item_save";
      Object.assign(params,{p_id:data.id||null,p_unit:data.unit,p_name:data.name,p_category:data.category||"",p_price:data.price,p_active:data.active!==false,p_variant:data.variant||""});
    } else if(action==="config.coach.save"){
      name="win_config_coach_save";
      Object.assign(params,{p_id:data.id||null,p_name:data.name,p_win_pct:data.winPct,p_active:data.active!==false});
    } else if(action==="config.price.set"){
      name="win_config_price_set";
      Object.assign(params,{p_code:data.code,p_duration:data.duration,p_cash:data.cash,p_transfer:data.transfer,p_valid_from:data.validFrom});
    } else if(action==="config.price.cancel"){
      name="win_config_price_cancel";Object.assign(params,{p_code:data.code,p_duration:data.duration,p_valid_from:data.validFrom});
    }
    else if(action==="bar.customers") name="win_bar_customers";
    else if(action==="bar.customer.create"){name="win_bar_customer_create";params.p_name=data.name;}
    else if(action==="bar.courts"){name="win_bar_court_choices";params.p_day=data.date;}
    else if(action==="bar.court.pending"){name="win_bar_court_pending";params.p_court=data.court;params.p_day=data.date;params.p_start=data.start;}
    else if(action==="bar.court.day"){name="win_bar_court_day_pending";params.p_day=data.date;}
    else if(action==="bar.pending") name="win_bar_pending";
    else if(action==="bar.order.place"){
      name="win_bar_order_place";
      Object.assign(params,{p_request_id:data.requestId,p_items:data.items,p_destination:data.destination,
        p_customer_id:data.customerId||null,p_booking_id:data.bookingId||null,p_court:data.court||null,
        p_court_date:data.courtDate||null,p_court_start:data.courtStart||null,p_note:data.note||"",
        p_method:data.method||null,p_client_unknown:data.clientUnknown===true});
    }
    else if(action==="bar.order.pay"){
      name="win_bar_order_pay";
      Object.assign(params,{p_request_id:data.requestId,p_order_id:data.orderId,p_amount:data.amount,p_method:data.method});
    }
    else if(action==="bar.products") name="win_bar_products_list";
    else if(action==="bar.product.save"){
      name="win_bar_product_save";
      Object.assign(params,{p_product_id:data.id||null,p_name:data.name,p_variant:data.variant||"",p_category:data.category,p_price:data.salePrice??null,p_cost:data.unitCost??null,p_barcode:data.barcode||null,p_active:data.active??true});
    }
    else if(action==="cash.state") name="win_cash_state";
    else if(action==="imported.snapshot") name="win_imported_snapshot";
    else if(action==="cash.open"){name="win_cash_open";params.p_amount=data.amount;}
    else if(action==="cash.entry"){
      name="win_cash_entry";
      Object.assign(params,{p_request_id:data.requestId,p_shift_id:data.shiftId,p_kind:data.kind,p_unit:data.unit,p_method:data.method,p_amount:data.amount,p_note:data.note||""});
    } else if(action==="cash.close"){
      name="win_cash_close";Object.assign(params,{p_shift_id:data.shiftId,p_counted:data.counted,p_note:data.note||""});
    } else return reply({error:"Operación desconocida"},404,origin);
    const {data:result,error}=await db.rpc(name,params);
    if(error) {
      if(error.code==="23505") return reply({error:"Ya existe un producto con ese nombre y variante, o el código de barras ya está utilizado."},409,origin);
      const match=Object.keys(errors).find(k=>error.message.includes(k));
      return reply({error:match?errors[match]:"No se pudo completar la operación. Revisá el estado antes de reintentar."},match?409:500,origin);
    }
    return reply(result,200,origin);
  } catch(e) {
    console.error("win-api error:",e instanceof Error?e.message:"unknown");
    return reply({error:"Servicio temporalmente no disponible"},503,origin);
  }
});
