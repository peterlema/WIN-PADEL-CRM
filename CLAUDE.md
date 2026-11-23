# Reglas del repositorio

- Rama de trabajo: `main`, salvo indicación contraria. La copia de Google Apps Script va en una rama independiente.
- Prohibido commitear datos de clientes, PIN de empleados, credenciales ni archivos `.env`.
- Supabase: en el front sólo URL y clave pública (anon). Toda tabla nueva lleva RLS activado.
- Commits: incluir `Hecho-por: <Nombre>` (persona que trabaja con Claude) y, si lo pidió otra persona, `Pedido-por: <Nombre>`.
- Tablas en la UI: ancho de columnas acorde al contenido (`width: 1%` + `white-space: nowrap` en columnas cortas); nunca columnas más anchas que su contenido.
- Interfaz en español rioplatense.
