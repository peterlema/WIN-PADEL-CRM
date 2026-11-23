# Integración Supabase — WIN Gestión V5 (desarrollo)

## Estado confirmado — 23/11/2026
- Proyecto Supabase: `cqvoherekzntmhyzdidj`
- URL de API: `https://cqvoherekzntmhyzdidj.supabase.co` (identificador público, **no** es una credencial).
- Migración remota ejecutada: `win_dev_initial_pos_inventory`.
- Esquema aislado **`win_dev`** (sin exposición a la Data API por defecto), tablas verificadas vacías: `products`, `sales`, `sale_lines`, `sale_payments`, `stock_movements`.
- RLS activado en las cinco tablas y privilegios revocados a `public`, `anon` y `authenticated`; sin políticas de acceso para usuarios finales.
- No se copiaron movimientos reales, clientes ni datos de caja; no se hicieron cambios en Google Apps Script de Recepción.

## Enlace GitHub ↔ Supabase
Esta rama contiene la referencia y el contrato de arquitectura de la base. **No existe todavía conexión de ejecución** entre Google Apps Script y Supabase: faltan el servicio backend autorizado, credenciales almacenadas fuera del repositorio y pruebas de operaciones integradas. No publicar como producto funcional.

## Contrato de datos inicial
- `products`: catálogo por unidad de negocio, SKU y costo/precio.
- `sales`: cabecera de ventas, request_id único, turno de Google Apps Script, operador, totales y estado.
- `sale_lines`: detalle de cada venta y snapshots históricos de precio/costo.
- `sale_payments`: medios e importes de pago.
- `stock_movements`: inventario con signo y referencia, request_id único.

## Seguridad y conexión futura
- Mantener Supabase en **servidor de confianza**, nunca colocar clave secreta/service role en `Index.html`, GitHub ni el navegador.
- En una integración temporal con Google Apps Script, usar `PropertiesService.getScriptProperties()` para secretos y `UrlFetchApp` solo desde código servidor. Preferir un endpoint/función que valide autorización y registre en una operación transaccional ventas + líneas + pagos + stock.
- No escribir simultáneamente en dos orígenes financieros hasta definir estrategia de consistencia, reintentos, conciliación e identificación única del turno y cobro.
- Supabase no reemplaza aún los cierres ni la fuente contable actual (Google Sheets).
- Acordar el esquema de roles/autenticación, políticas RLS y el origen de verdad de cada entidad antes de habilitar API.
- Revisar con Supabase Advisors antes de exposición al público y hacer pruebas con datos ficticios.

## Próximos pasos
1. Validar la versión exacta de Apps Script y manifiesto.
2. Implementar endpoints de lectura/pruebas y escrituras atómicas, sin exponer tablas.
3. Implementar catálogo, ventas y stock en un entorno de prueba; simular venta mixta, anulación y reintentos.
4. Definir publicación y conciliación con caja; habilitar producción solo con autorización.
