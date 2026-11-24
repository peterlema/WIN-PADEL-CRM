create or replace function public.win_bar_price_snapshot_guard() returns trigger language plpgsql set search_path='' as $$
declare employee uuid; cost_ numeric;provisional_ boolean;
begin
 if tg_op='UPDATE' then
  -- The complete snapshot is immutable after insertion, including its cost origin.
  if (to_jsonb(new)-'amount') is distinct from (to_jsonb(old)-'amount') then raise exception 'BAR_PRICE_IMMUTABLE';end if;
  return new;
 end if;
 select employee_id into employee from public.win_bar_orders where id=new.order_id;
 if employee is null then
  new.public_unit_price=new.unit_price;new.discount_unit_amount=0;new.employee_policy_snapshot=null;new.employee_exception_id=null;
 elsif new.public_unit_price is null or new.discount_unit_amount is null or new.public_unit_price-new.discount_unit_amount<>new.unit_price or new.employee_policy_snapshot is null then raise exception 'EMPLOYEE_SNAPSHOT_INVALID';end if;
 -- Capture cost and its provisional flag together, before the delivery ledger is inserted.
 select unit_cost,cost_is_provisional into cost_,provisional_ from public.win_products where id=new.product_id and business_unit='CAFE_BAR';
 if not found then raise exception 'PRODUCT_NOT_FOUND';end if;
 new.unit_cost=cost_;new.cost_is_provisional=provisional_;
 return new;
end;$$;
