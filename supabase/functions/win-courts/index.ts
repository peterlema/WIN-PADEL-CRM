// Edge Function win-courts: calendario de canchas y reservas.
// Función aparte de win-api. Toda la autenticación y las reglas viven en PostgreSQL
// (funciones win_courts_*, que validan el token de sesión con win_pin_session).
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
  CUSTOMER_REQUIRED: [400, "Completá nombre y apellido y WhatsApp."],
  PRICE_MISSING: [409, "No hay un precio de cancha vigente para esa fecha."],
  PAY_TOO_EARLY: [409, "El cobro se marca cuando termina el turno."],
  ALREADY_PAID: [409, "Ese turno ya tiene el cobro registrado."],
  PAYMENT_INVALID: [400, "Revisá los datos del cobro."],
  RECEIVER_INVALID: [400, "La persona que recibió el efectivo no está habilitada."],
  ABONO_CONFLICT: [409, "Ese horario ya lo ocupa otra reserva o abono en alguna fecha. Revisá el calendario."],
  BOOKING_PAID: [409, "Ese turno ya tiene el cobro registrado y no se puede cancelar ni saltear."],
  SCHEDULE_INVALID: [400, "Revisá el día y el horario."],
};
const MIME_EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
const RECEIPT_PATH = /^[0-9]{4}-[0-9]{2}\/[0-9a-f-]{36}\.(jpg|png|webp)$/;
const BUCKET = "win-comprobantes";

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

  const db0 = () => adminClient();
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
      p_customer_name: String(data.customerName || ""), p_customer_whatsapp: String(data.whatsapp || ""),
      p_method: String(data.method || ""),
    });
  } else if (action === "courts.cancel") {
    const bookingId = String(data.bookingId || "");
    if (!UUID.test(bookingId)) return bad(origin);
    name = "win_courts_cancel";
    Object.assign(params, { p_booking_id: bookingId, p_reason: String(data.reason || "") });
  } else if (action === "courts.pay") {
    const requestId = String(data.requestId || "");
    const bookingId = data.bookingId ? String(data.bookingId) : null;
    const abonoId = data.abonoId ? String(data.abonoId) : null;
    const date = data.date ? String(data.date) : null;
    const receivedBy = data.receivedBy ? String(data.receivedBy) : null;
    const receiptPath = data.receiptPath ? String(data.receiptPath) : null;
    if (!UUID.test(requestId) || (bookingId && !UUID.test(bookingId)) || (abonoId && !UUID.test(abonoId))
      || (date && !DATE.test(date)) || (receivedBy && !UUID.test(receivedBy)) || (receiptPath && !RECEIPT_PATH.test(receiptPath))) return bad(origin);
    name = "win_courts_pay";
    Object.assign(params, { p_request_id: requestId, p_booking_id: bookingId, p_abono_id: abonoId, p_date: date,
      p_method: String(data.method || ""), p_received_by: receivedBy, p_receipt_path: receiptPath });
  } else if (action === "courts.abono.create") {
    const requestId = String(data.requestId || "");
    const date = String(data.date || "");
    if (!UUID.test(requestId) || !DATE.test(date)) return bad(origin);
    name = "win_courts_abono_create";
    Object.assign(params, { p_request_id: requestId, p_court: String(data.court || ""), p_date: date, p_start: String(data.start || ""),
      p_customer_name: String(data.customerName || ""), p_customer_whatsapp: String(data.whatsapp || ""),
      p_method: String(data.method || ""), p_note: String(data.note || ""),
      p_duration: Number.isInteger(Number(data.duration)) ? Number(data.duration) : 90 });
  } else if (action === "courts.abono.end") {
    const abonoId = String(data.abonoId || "");
    const from = String(data.from || "");
    if (!UUID.test(abonoId) || !DATE.test(from)) return bad(origin);
    name = "win_courts_abono_end";
    Object.assign(params, { p_abono_id: abonoId, p_from: from, p_reason: String(data.reason || "") });
  } else if (action === "courts.abono.skip") {
    const abonoId = String(data.abonoId || "");
    const date = String(data.date || "");
    if (!UUID.test(abonoId) || !DATE.test(date)) return bad(origin);
    name = "win_courts_abono_skip";
    Object.assign(params, { p_abono_id: abonoId, p_date: date, p_reason: String(data.reason || ""), p_undo: data.undo === true });
  } else if (action === "courts.receivers") {
    name = "win_courts_receivers";
  } else if (action === "courts.schedule.list") {
    name = "win_courts_schedule_list";
  } else if (action === "courts.schedule.set") {
    const accountId = String(data.accountId || "");
    const weekday = Number(data.weekday);
    if (!UUID.test(accountId) || !Number.isInteger(weekday)) return bad(origin);
    name = "win_courts_schedule_set";
    Object.assign(params, { p_account_id: accountId, p_weekday: weekday, p_from: String(data.from || ""), p_to: String(data.to || "") });
  } else if (action === "courts.schedule.delete") {
    const id = String(data.id || "");
    if (!UUID.test(id)) return bad(origin);
    name = "win_courts_schedule_delete"; params.p_id = id;
  } else if (action === "courts.receipt.url" || action === "courts.receipt.view") {
    // Comprobantes: el navegador nunca toca el bucket; recibe URLs firmadas de corta duración.
    try {
      const db = db0();
      if (action === "courts.receipt.url") {
        const ext = MIME_EXT[String(data.contentType || "")];
        if (!ext) return bad(origin, "Subí una foto JPG, PNG o WEBP.");
        const check = await db.rpc("win_courts_can_create", { p_token: token });
        if (check.error) throw check.error;
        const path = `${new Date().toISOString().slice(0, 7)}/${crypto.randomUUID()}.${ext}`;
        const up = await db.storage.from(BUCKET).createSignedUploadUrl(path);
        if (up.error) throw up.error;
        return reply({ path, uploadUrl: up.data.signedUrl, token: up.data.token }, 200, origin);
      }
      const path = String(data.path || "");
      if (!RECEIPT_PATH.test(path)) return bad(origin);
      const check = await db.rpc("win_courts_receipt_check", { p_token: token, p_path: path });
      if (check.error) throw check.error;
      const signed = await db.storage.from(BUCKET).createSignedUrl(path, 120);
      if (signed.error) throw signed.error;
      return reply({ url: signed.data.signedUrl }, 200, origin);
    } catch (e) {
      const msg = e && typeof e === "object" && "message" in e ? String((e as { message: string }).message) : "";
      const code = Object.keys(errors).find((k) => msg.includes(k));
      if (code) return reply({ error: errors[code][1], code }, errors[code][0], origin);
      console.error("win-courts receipt error:", msg);
      return reply({ error: "No se pudo procesar el comprobante." }, 500, origin);
    }
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
