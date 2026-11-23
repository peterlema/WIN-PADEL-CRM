-- Recepción también vende y cobra en Bar / Buffet (ver productos y registrar ventas y cobros de pendientes).
-- No incluye editar productos ni precios. Afecta a todas las cuentas con rol RECEPTION.
insert into win_auth.role_permissions(role_code,module_code,action_code) values
 ('RECEPTION','BAR','VIEW'),
 ('RECEPTION','BAR','SALE')
on conflict do nothing;
