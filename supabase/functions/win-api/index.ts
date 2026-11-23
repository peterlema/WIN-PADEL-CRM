import { createClient } from "npm:@supabase/supabase-js@2.119.2";

const allowedOrigins = new Set(["https://peterlema.github.io", "http://localhost:5173", "http://127.0.0.1:5173"]);
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
const errors:Record<string,string>={SESSION_INVALID:"La sesión expiró. Volvé a ingresar.",NOT_AUTHORIZED:"Tu usuario no tiene permisos para esta acción.",SHIFT_ALREADY_OPEN:"Ya hay una caja abierta.",SHIFT_NOT_OPEN:"La caja ya no está abierta.",AMOUNT_INVALID:"Revisá el importe.",METHOD_INVALID:"Medio de pago no permitido.",CATEGORY_INVALID:"Categoría no permitida.",REQUEST_ID_REUSED:"La solicitud ya fue usada con otros datos.",DIFFERENCE_REQUIRES_NOTE:"Explicá la diferencia del cierre.",NOTE_TOO_LONG:"La observación es demasiado larga."};
Deno.serve(async req=>{
  const origin=req.headers.get("Origin")||"";
  if(origin&&!allowedOrigins.has(origin)) return reply({error:"Origen no autorizado"},403);
  if(req.method==="OPTIONS") return reply({},204,origin);
  if(req.method!=="POST") return reply({error:"Método no permitido"},405,origin);
  if(Number(req.headers.get("content-length")||0)>8192) return reply({error:"Solicitud demasiado grande"},413,origin);
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
    let name="", params:Record<string,unknown>={p_token:token};
    if(action==="admin.finance"){name="win_admin_finance_report";params.p_start=data.start;params.p_end=data.end;}
    else if(action==="reception.overview") name="win_reception_overview";
    else if(action==="cash.state") name="win_cash_state";
    else if(action==="cash.open"){name="win_cash_open";params.p_amount=data.amount;}
    else if(action==="cash.entry"){
      name="win_cash_entry";
      Object.assign(params,{p_request_id:data.requestId,p_shift_id:data.shiftId,p_kind:data.kind,p_unit:data.unit,p_method:data.method,p_amount:data.amount,p_note:data.note||""});
    } else if(action==="cash.close"){
      name="win_cash_close";Object.assign(params,{p_shift_id:data.shiftId,p_counted:data.counted,p_note:data.note||""});
    } else return reply({error:"Operación desconocida"},404,origin);
    const {data:result,error}=await db.rpc(name,params);
    if(error) {
      const match=Object.keys(errors).find(k=>error.message.includes(k));
      return reply({error:match?errors[match]:"No se pudo completar la operación. Revisá el estado antes de reintentar."},match?409:500,origin);
    }
    return reply(result,200,origin);
  } catch(e) {
    console.error("win-api error:",e instanceof Error?e.message:"unknown");
    return reply({error:"Servicio temporalmente no disponible"},503,origin);
  }
});
