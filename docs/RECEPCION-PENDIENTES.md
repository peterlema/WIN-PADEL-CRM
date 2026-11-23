# Recepción y reservas: reglas pedidas y estado

Pantallas: Recepción (`#/demo` en modo demo), Caja, Calendario. Versión visible al pie de la web.

## Reglas confirmadas por el dueño del negocio
1. **Turnos de cancha de 90 minutos, siempre.** Las reservas y abonos duran 90 min. Las clases mantienen su duración propia (60 por defecto).
2. **Precio de la cancha:** $ 100.000 por transferencia o $ 90.000 en efectivo, por turno de 90 min. Debe quedar registrado en Supabase (tabla de precios con vigencia).
3. **Al cargar una reserva** el recepcionista informa: nombre completo, WhatsApp y método de pago previsto. **Después del turno** marca el método de pago real.
4. **Abonos fijos:** turno semanal fijo (cancha, día, hora) que se repite indefinidamente hasta que se da de baja. Cada pago queda registrado.
5. **Comprobantes:** poder subir la foto del comprobante de transferencia (almacenamiento privado, enlazado al cobro).
6. **Efectivo entregado:** registrar quién lo recibió. Definir horarios por día y por persona para sugerir/validar quién recibió el dinero.

## Estado
| Regla | Pantalla (demo) | Base de datos (Supabase) |
|---|---|---|
| Turnos de 90 min | Hecho en Recepción y Calendario | Pendiente: la función `win_courts_book` hoy acepta 60/90/120 para RESERVA |
| Precio 100k/90k | Pendiente | Pendiente |
| Nombre, WhatsApp, método | Pendiente | Pendiente |
| Método de pago real tras el turno | Pendiente | Pendiente |
| Abonos fijos + pagos | Pendiente | Pendiente |
| Foto de comprobante | Pendiente | Pendiente (Storage privado + Edge Function) |
| Quién recibió el efectivo + horarios por persona | Pendiente | Pendiente |

## Por definir
- Precio del abono: ¿el mismo (100k/90k) por cada turno jugado, o distinto?
- Cobro del abono: ¿mensual anticipado o por cada juego?
- Horarios por persona: ¿grilla semanal fija (día, desde, hasta) o cambia por semana?
