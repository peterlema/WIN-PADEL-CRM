# Recepción y reservas: reglas pedidas y estado

Pantallas: Recepción (`#/demo` en modo demo), Caja, Calendario. Versión visible al pie de la web.

## Reglas confirmadas por el dueño del negocio
1. **Duraciones:** reservas y abonos de 60, 90 o 120 min (90 por defecto); clase particular 60 min; clase partido 90 min.
2. **Precio de la cancha:** $ 100.000 por transferencia o $ 90.000 en efectivo, por turno de 90 min (tabla `win_price_list`, con precio por duración y vigencia). Los precios de 60 y 120 min están por definir: hasta cargarlos, esos turnos no se pueden cobrar.
3. **Al cargar una reserva** el recepcionista informa: nombre completo, WhatsApp y método de pago previsto. **Después del turno** marca el método de pago real.
4. **Abonos fijos:** turno semanal fijo (cancha, día, hora) que se repite indefinidamente hasta que se da de baja. Cada pago queda registrado.
5. **Comprobantes:** poder subir la foto del comprobante de transferencia (almacenamiento privado, enlazado al cobro).
6. **Efectivo entregado:** registrar quién lo recibió. Definir horarios por día y por persona para sugerir/validar quién recibió el dinero.

## Estado
| Regla | Pantalla (v0.7.0) | Base de datos (Supabase) |
|---|---|---|
| Duraciones 60/90/120 y clases 60/90 | Hecho (Recepción y Calendario) | v3 |
| Precio 100k/90k | Hecho (se muestra y se cobra) | Idem: tabla `win_price_list` con vigencia |
| Nombre y WhatsApp al reservar | Hecho (popup de reserva); el método de pago ya no se pide al reservar | v3: `20261124_win_courts_v3_payment_method_at_collection.sql` |
| Cobro real cuando termina el turno | Hecho (detalle de la reserva; el método se elige al cobrar y la recepción sólo puede cobrar cuando el turno terminó) | v3: `win_court_payments`, un cobro por turno |
| Abonos fijos + cobro por juego | Hecho (checkbox «Abono fijo», saltear día, dar de baja) | Idem: `win_court_abonos`, `win_court_abono_skips` |
| Foto de comprobante | Hecho (subida con foto comprimida, ver comprobante) | Idem + función `win-courts` actualizada y bucket privado; la subida real aún no se probó contra Storage |
| Quién recibió el efectivo + horarios por persona | Hecho (selector y ventana «Horarios de recepción» para Administración) | Idem: `win_receiver_schedule` |
| Rol BAR sólo Bar | Hecho | Servidor: matriz de permisos de peterlema |

Pendiente de etapas siguientes: rendición de profesores, Administración, conectar el cobro en efectivo con la caja del turno, y Recepción contra la base real (hoy sólo en modo demo).

## Por definir
- Resuelto: el abono cobra el mismo precio y se cobra por cada juego.
- Horarios por persona: se implementó una grilla semanal fija (día, desde, hasta), editable por Administración; sin horarios, el efectivo lo recibe quien registra el cobro.
