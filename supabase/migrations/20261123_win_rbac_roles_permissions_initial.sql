-- WIN RBAC roles. This migration is safe to apply after the PIN accounts migrations.
create table if not exists win_auth.role_permissions (
 role_code text not null,
 module_code text not null,
 action_code text not null,
 primary key (role_code,module_code,action_code),
 constraint win_permission_role_check check(role_code in ('ADMIN','MANAGER','RECEPTION','ACADEMY_COORDINATOR','COACH','BAR')),
 constraint win_permission_module_check check(module_code in ('CASH','COURTS','ACADEMY','LESSONS','BAR','SHOP','REPORTS','USERS')),
 constraint win_permission_action_check check(action_code in ('VIEW','CREATE','UPDATE','CANCEL','OPEN','CLOSE','SALE','MANAGE','OWN_VIEW','OWN_UPDATE'))
);
alter table win_auth.role_permissions enable row level security;
revoke all on win_auth.role_permissions from public,anon,authenticated;
grant select,insert,update,delete on win_auth.role_permissions to service_role;

alter table win_auth.login_accounts drop constraint if exists login_accounts_role_check;
alter table win_auth.login_accounts add constraint login_accounts_role_check
 check(role in ('ADMIN','MANAGER','RECEPTION','ACADEMY_COORDINATOR','COACH','BAR'));
alter table public.win_staff drop constraint if exists win_staff_role_check;
alter table public.win_staff add constraint win_staff_role_check
 check(role in ('ADMIN','MANAGER','RECEPTION','ACADEMY_COORDINATOR','COACH','BAR'));

insert into win_auth.role_permissions(role_code,module_code,action_code) values
 ('ACADEMY_COORDINATOR','ACADEMY','MANAGE'),
 ('ACADEMY_COORDINATOR','ACADEMY','VIEW'),
 ('ACADEMY_COORDINATOR','COURTS','CREATE'),
 ('ACADEMY_COORDINATOR','COURTS','VIEW'),
 ('ACADEMY_COORDINATOR','LESSONS','CREATE'),
 ('ACADEMY_COORDINATOR','LESSONS','UPDATE'),
 ('ACADEMY_COORDINATOR','LESSONS','VIEW'),
 ('BAR','BAR','SALE'),
 ('BAR','BAR','VIEW'),
 ('COACH','LESSONS','OWN_UPDATE'),
 ('COACH','LESSONS','OWN_VIEW'),
 ('MANAGER','ACADEMY','MANAGE'),
 ('MANAGER','ACADEMY','VIEW'),
 ('MANAGER','BAR','MANAGE'),
 ('MANAGER','BAR','SALE'),
 ('MANAGER','BAR','VIEW'),
 ('MANAGER','CASH','CLOSE'),
 ('MANAGER','CASH','CREATE'),
 ('MANAGER','CASH','OPEN'),
 ('MANAGER','CASH','VIEW'),
 ('MANAGER','COURTS','CANCEL'),
 ('MANAGER','COURTS','CREATE'),
 ('MANAGER','COURTS','VIEW'),
 ('MANAGER','LESSONS','VIEW'),
 ('MANAGER','REPORTS','VIEW'),
 ('MANAGER','SHOP','MANAGE'),
 ('MANAGER','SHOP','VIEW'),
 ('RECEPTION','ACADEMY','VIEW'),
 ('RECEPTION','CASH','CLOSE'),
 ('RECEPTION','CASH','CREATE'),
 ('RECEPTION','CASH','OPEN'),
 ('RECEPTION','CASH','VIEW'),
 ('RECEPTION','COURTS','CANCEL'),
 ('RECEPTION','COURTS','CREATE'),
 ('RECEPTION','COURTS','VIEW'),
 ('RECEPTION','LESSONS','VIEW'),
 ('RECEPTION','SHOP','VIEW')
on conflict do nothing;

create or replace function public.win_can_access(p_account_id uuid,p_module text,p_action text)
returns boolean language sql stable security invoker set search_path=''
as $fn$
 select exists(select 1 from win_auth.login_accounts a where a.id=p_account_id and a.enabled
  and (a.role='ADMIN' or exists (select 1 from win_auth.role_permissions rp
    where rp.role_code=a.role and rp.module_code=p_module and rp.action_code=p_action)));
$fn$;
revoke all on function public.win_can_access(uuid,text,text) from public,anon,authenticated;
grant execute on function public.win_can_access(uuid,text,text) to service_role;

create or replace function public.win_role_permissions(p_token text)
returns jsonb language plpgsql stable security invoker set search_path=''
as $fn$
declare uid uuid; role_name text; arr jsonb;
begin
 select s.account_id,s.role into uid,role_name from public.win_pin_session(p_token) s;
 if uid is null then raise exception 'SESSION_INVALID'; end if;
 if role_name='ADMIN' then return jsonb_build_object('all',true,'role',role_name,'grants','[]'::jsonb); end if;
 select coalesce(jsonb_agg(jsonb_build_object('module',module_code,'action',action_code) order by module_code,action_code),'[]'::jsonb) into arr
 from win_auth.role_permissions where role_code=role_name;
 return jsonb_build_object('all',false,'role',role_name,'grants',arr);
end;$fn$;
revoke all on function public.win_role_permissions(text) from public,anon,authenticated;
grant execute on function public.win_role_permissions(text) to service_role;

-- Gerson account is bootstrapped disabled with a random, unknown PIN.
-- Do not activate without securely provisioning a separate PIN.
insert into win_auth.login_accounts(username,display_name,role,pin_hash,enabled)
values('Gerson','Gerson','BAR',extensions.crypt(encode(extensions.gen_random_bytes(24),'hex'),extensions.gen_salt('bf',12)),false)
on conflict(username) do nothing;
insert into public.win_staff(user_id,display_name,role,active)
select id,display_name,role,false from win_auth.login_accounts where username_key='gerson'
on conflict(user_id) do nothing;
