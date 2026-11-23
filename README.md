# WIN Padel CRM

Repositorio privado para el desarrollo y versionado de WIN Gestión.

La copia de Google Apps Script se importa en una rama independiente antes de cualquier modificación. Este repositorio no contiene datos de clientes, PIN de empleados ni credenciales de producción.

## Web WIN Gestión

Aplicación web (Vite + React) con acceso por email y clave mediante Supabase Auth. Las claves las guarda Supabase cifradas; el código del repositorio no las contiene.

### Puesta en marcha

1. `npm install`
2. Copiar `.env.example` a `.env.local` y completar `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` (clave pública; nunca la `service_role`).
3. En Supabase: Authentication > Users > «Add user» para crear cada usuario administrativo. La web no tiene registro público.
4. `npm run dev` para desarrollo, `npm run build` para generar `dist/`.
