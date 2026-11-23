# Reglas del repositorio

- Rama de trabajo: `main`, salvo indicación contraria. La copia de Google Apps Script va en una rama independiente.
- Prohibido commitear datos de clientes, PIN de empleados, credenciales ni archivos `.env`.
- Supabase: en el front sólo URL y clave pública (anon). Toda tabla nueva lleva RLS activado.
- Commits: incluir `Hecho-por: <Nombre>` (persona que trabaja con Claude) y, si lo pidió otra persona, `Pedido-por: <Nombre>`.
- Tablas en la UI: ancho de columnas acorde al contenido (`width: 1%` + `white-space: nowrap` en columnas cortas); nunca columnas más anchas que su contenido.
- Interfaz en español rioplatense.

## Decisiones

- La web (React + Supabase) reemplaza al Google Apps Script. El Apps Script sigue en producción y no se borra ni se modifica hasta que la web esté terminada y probada; la rama `backup/win-gestion-desarrollo-2026-11-23` queda intacta.
- La V5 (café/bar, stock, compras) documentada en `desarrollo/v5-cafe-bar` se implementa en Supabase, respetando sus invariantes.
- Acceso: email + clave con Supabase Auth. Sin PIN por ahora.
- Orden de migración: caja, clases y rendiciones, reportes y administración, V5, historial desde Sheets.
