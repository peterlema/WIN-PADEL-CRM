-- Source for the compatibility correction already recorded in production as 20261125011135.
-- Preserves legacy total keys alongside the daily Bar totals. No business rows change.
CREATE OR REPLACE FUNCTION public.win_bar_shift_totals(p_shift uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 select jsonb_build_object('openingCash',s.opening_cash,
 'transfersReceived',coalesce(sum(m.amount_signed) filter(where m.payment_method='TRANSFER' and m.amount_signed>0),0),
 'transfersPaid',-coalesce(sum(m.amount_signed) filter(where m.payment_method='TRANSFER' and m.amount_signed<0),0),
 'transfersNet',coalesce(sum(m.amount_signed) filter(where m.payment_method='TRANSFER'),0),
 'cardsReceived',coalesce(sum(m.amount_signed) filter(where m.payment_method='CARD' and m.amount_signed>0),0),
 'cashNet',coalesce(sum(m.amount_signed) filter(where m.payment_method='CASH'),0),
 'cashSales',coalesce(sum(m.amount_signed) filter(where m.kind='SALE' and m.payment_method='CASH'),0),
 'transferSales',coalesce(sum(m.amount_signed) filter(where m.kind='SALE' and m.payment_method='TRANSFER'),0),
 'cardSales',coalesce(sum(m.amount_signed) filter(where m.kind='SALE' and m.payment_method='CARD'),0),
 'supplierPayments',-coalesce(sum(m.amount_signed) filter(where m.kind='PURCHASE_PAYMENT'),0),
 'expenses',-coalesce(sum(m.amount_signed) filter(where m.kind='EXPENSE'),0),
 'withdrawals',-coalesce(sum(m.amount_signed) filter(where m.kind='WITHDRAWAL'),0),
 'cashOut',-coalesce(sum(m.amount_signed) filter(where m.amount_signed<0 and m.payment_method='CASH'),0),
 'transferOut',-coalesce(sum(m.amount_signed) filter(where m.amount_signed<0 and m.payment_method='TRANSFER'),0),
 'cardOut',-coalesce(sum(m.amount_signed) filter(where m.amount_signed<0 and m.payment_method='CARD'),0),
 'cashExpected',s.opening_cash+coalesce(sum(m.amount_signed) filter(where m.payment_method='CASH'),0),
 'cashCounted',s.counted_cash,'difference',s.counted_cash-s.opening_cash-coalesce(sum(m.amount_signed) filter(where m.payment_method='CASH'),0))
 from public.win_bar_cash_shifts s left join public.win_bar_cash_movements m on m.shift_id=s.id where s.id=p_shift group by s.id
$function$
