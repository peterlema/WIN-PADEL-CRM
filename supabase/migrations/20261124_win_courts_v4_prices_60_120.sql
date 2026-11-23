-- WIN Gestión: precios de cancha por duración (24/11/2026)
-- 60 min: $ 60.000 efectivo / $ 70.000 transferencia.
-- 120 min: $ 120.000 efectivo / $ 120.000 transferencia.
-- (90 min ya estaba: $ 90.000 / $ 100.000.) Aplicar después de v3. Es repetible.
insert into public.win_price_list (code, duration_min, amount_cash, amount_transfer, valid_from)
values ('COURT_TURN', 60, 60000, 70000, date '2020-01-01'),
       ('COURT_TURN', 120, 120000, 120000, date '2020-01-01')
on conflict (code, duration_min, valid_from) do nothing;
