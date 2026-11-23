// Edge Function win-courts: calendario de canchas y reservas.
// Función aparte de win-api. Toda la autenticación y las reglas viven en PostgreSQL
// (funciones win_courts_*, que validan el token de sesión con win_pin_session).
// Despliegue: supabase functions deploy win-courts --no-verify-jwt --project-ref <ref>
import { createClient } from "npm:@supabase/supabase-js@2.119.2";

const allowedOrigins = new Set(["https://peterlema.github.io", "http://localhost:5173", "http://127.0.0.1:5173"]);
function reply(obj: unknown, status = 200, origin = "") {
  const headers: Record<string, string> = { "Content-Type": "application/json", "Cache-Control": "no-store", "Vary": "Origin" };
  if (allowedOrigins.has(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Headers"] = "authorization, content-type";
    headers["Access-Control-Allow-Methods"] = "POST, OPTIONS";
  }
  return new Response(status === 204 ? null : JSON.stringify(obj), { status, headers }); // 204 no admite cuerpo
}
function adminClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const candidates = Deno.env.get("SUPABASE_SECRET_KEYS");
  let key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (candidates) { try { const keys = JSON.parse(candidates); key = keys.default || key; } catch { /* use legacy env */ } }
  if (!url || !key) throw new Error("BACKEND_NOT_CONFIGURED");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

// Errores de negocio que levantan las funciones SQL -> [HTTP, mensaje para la persona].
const errors: Record<string, [number, string]> = {
  SESSION_INVALID: [401, "La sesión expiró. Volvé a ingresar."],
  NOT_AUTHORIZED: [403, "Tu usuario no tiene permisos para esta acción."],
  COURT_TAKEN: [409, "Esa cancha ya está ocupada en ese horario. Actualizá el calendario."],
  REQUEST_ID_REUSED: [409, "Esa solicitud ya se usó con otros datos. Volvé a cargar la reserva."],
  BOOKING_INVALID: [400, "Revisá los datos de la reserva."],
  DURATION_INVALID: [400, "La duración no está permitida para ese tipo de reserva."],
  BOOKING_IN_PAST: [409, "No se pueden cargar reservas que ya terminaron."],
  REASON_REQUIRED: [400, "Indicá el motivo de la cancelación."],
  BOOKING_NOT_FOUND: [404, "La reserva no existe o ya fue cancelada."],
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-\d{2}$/;
const bad = (origin: string, msg = "Revisá los datos enviados.") => reply({ error: msg }, 400, origin);

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin") || "";
  if (origin && !allowedOrigins.has(origin)) return reply({ error: "Origen no autorizado" }, 403);
  if (req.method === "OPTIONS") return reply({}, 204, origin);
  if (req.method !== "POST") return reply({ error: "Método no permitido" }, 405, origin);
  if (Number(req.headers.get("content-length") || 0) > 8192) return reply({ error: "Solicitud demasiado grande" }, 413, origin);

  let data: Record<string, unknown>;
  try {
    data = await req.json();
    if (!data || typeof data !== "object" || Array.isArray(data)) throw Error();
  } catch { return reply({ error: "Formato inválido" }, 400, origin); }

  const token = (req.headers.get("Authorization") || "").match(/^Bearer ([a-f0-9]{64})$/)?.[1] || "";
  if (!token) return reply({ error: "Sesión requerida" }, 401, origin);

  const action = String(data.action || "");
  let name = "";
  let params: Record<string, unknown> = { p_token: token };

  if (action === "courts.day") {
    const date = String(data.date || "");
    if (!DATE.test(date)) return bad(origin);
    name = "win_courts_day"; params.p_date = date;
  } else if (action === "courts.month") {
    const month = String(data.month || "");
    if (!MONTH.test(month)) return bad(origin);
    name = "win_courts_month"; params.p_month = month + "-01";
  } else if (action === "courts.book") {
    const requestId = String(data.requestId || "");
    const date = String(data.date || "");
    const duration = Number(data.duration);
    if (!UUID.test(requestId) || !DATE.test(date) || !Number.isInteger(duration)) return bad(origin);
    name = "win_courts_book";
    Object.assign(params, {
      p_request_id: requestId, p_court: String(data.court || ""), p_date: date,
      p_start: String(data.start || ""), p_duration: duration, p_kind: String(data.kind || ""),
      p_holder: String(data.holder || ""), p_note: String(data.note || ""),
    });
  } else if (action === "courts.cancel") {
    const bookingId = String(data.bookingId || "");
    if (!UUID.test(bookingId)) return bad(origin);
    name = "win_courts_cancel";
    Object.assign(params, { p_booking_id: bookingId, p_reason: String(data.reason || "") });
  } else {
    return reply({ error: "Operación desconocida" }, 404, origin);
  }

  try {
    const db = adminClient();
    const { data: result, error } = await db.rpc(name, params);
    if (error) {
      const code = Object.keys(errors).find((k) => String(error.message).includes(k));
      if (code) return reply({ error: errors[code][1], code }, errors[code][0], origin);
      console.error("win-courts rpc error:", error.message);
      return reply({ error: "No se pudo completar la operación. Revisá el estado antes de reintentar." }, 500, origin);
    }
    return reply(result, 200, origin);
  } catch (e) {
    console.error("win-courts error:", e instanceof Error ? e.message : "unknown");
    return reply({ error: "Servicio temporalmente no disponible" }, 503, origin);
  }
});
