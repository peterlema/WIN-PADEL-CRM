-- User management is private. Named roles inherit an existing, server-enforced profile.
create table if not exists win_auth.user_roles (
 id uuid primary key default gen_random_uuid(),
 name text not null check(length(btrim(name)) between 2 and 60),
 base_role text not null check(base_role in ('ADMIN','MANAGER','RECEPTION','ACADEMY_COORDINATOR','COACH','BAR')),
 builtin boolean not null default false,
 created_by uuid references win_auth.login_accounts(id),
 created_at timestamptz not null default now()
);
create unique index if not exists win_user_roles_name_key on win_auth.user_roles(lower(btrim(name)));
alter table win_auth.user_roles enable row level security;
revoke all on win_auth.user_roles from public,anon,authenticated;
grant select,insert,update on win_auth.user_roles to service_role;
insert into win_auth.user_roles(name,base_role,builtin) values
 ('Administrador','ADMIN',true),('Encargado','MANAGER',true),('Recepción','RECEPTION',true),
 ('Coordinación de academia','ACADEMY_COORDINATOR',true),('Profesor','COACH',true),('Bar','BAR',true)
on conflict do nothing;
alter table win_auth.login_accounts add column if not exists user_role_id uuid references win_auth.user_roles(id);
update win_auth.login_accounts a set user_role_id=r.id from win_auth.user_roles r
 where a.user_role_id is null and r.builtin and r.base_role=a.role;

create table if not exists win_auth.user_management_audit (
 id uuid primary key default gen_random_uuid(),
 actor_id uuid not null references win_auth.login_accounts(id),
 action text not null, target_id uuid not null, before_record jsonb, after_record jsonb,
 occurred_at timestamptz not null default now()
);
create table if not exists win_auth.user_management_requests (
 request_id uuid primary key,actor_id uuid not null references win_auth.login_accounts(id),
 action text not null,payload jsonb not null,result jsonb not null,created_at timestamptz not null default now()
);
alter table win_auth.user_management_audit enable row level security;
alter table win_auth.user_management_requests enable row level security;
revoke all on win_auth.user_management_audit,win_auth.user_management_requests from public,anon,authenticated;
grant select,insert on win_auth.user_management_audit,win_auth.user_management_requests to service_role;

create or replace function public.win_users_api(p_token text,p_action text,p jsonb default '{}')
returns jsonb language plpgsql security invoker set search_path=''
as $fn$
declare actor uuid; actor_role text; target uuid; request uuid; role_id uuid; profile text;
 old_user win_auth.login_accounts%rowtype; user_ win_auth.login_accounts%rowtype;
 username_ text; name_ text; pin_ text; enabled_ boolean;
 safe_payload jsonb; saved win_auth.user_management_requests%rowtype; result_ jsonb;
 before_ jsonb; after_ jsonb; changed_credentials boolean;
begin
 select s.account_id,s.role into actor,actor_role from public.win_pin_session(p_token) s;
 if actor is null then raise exception 'SESSION_INVALID';end if;
 if actor_role<>'ADMIN' then raise exception 'NOT_AUTHORIZED';end if;
 if p_action='list' then
  return jsonb_build_object('currentUserId',actor,
   'users',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'username',a.username,'name',a.display_name,'role',a.role,'roleId',a.user_role_id,'enabled',a.enabled,'lockedUntil',a.locked_until) order by lower(a.display_name)) from win_auth.login_accounts a),'[]'::jsonb),
   'roles',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'name',r.name,'baseRole',r.base_role,'builtin',r.builtin) order by r.builtin desc,lower(r.name)) from win_auth.user_roles r),'[]'::jsonb),
   'permissions',coalesce((select jsonb_agg(jsonb_build_object('role',rp.role_code,'module',rp.module_code,'action',rp.action_code)) from win_auth.role_permissions rp),'[]'::jsonb));
 end if;
 if p_action not in ('save','role.save') then raise exception 'USER_ACTION_INVALID';end if;
 request=nullif(p->>'requestId','')::uuid;
 if request is null then raise exception 'USER_REQUEST_REQUIRED';end if;
 -- Serialize administrator changes, including last-admin checks and request deduplication.
 perform pg_advisory_xact_lock(hashtext('win_user_management'));
 -- Recheck after acquiring the lock in case another administrator changed the actor.
 if not exists(select 1 from public.win_pin_session(p_token) s where s.account_id=actor and s.role='ADMIN') then raise exception 'NOT_AUTHORIZED';end if;
 safe_payload=(p-'pin'-'action')||jsonb_build_object('pinChanged',coalesce(p->>'pin','')<>'');
 select * into saved from win_auth.user_management_requests where request_id=request;
 if found then
  if saved.actor_id<>actor or saved.action<>p_action or saved.payload<>safe_payload then raise exception 'USER_REQUEST_REUSED';end if;
  return saved.result;
 end if;
 if p_action='role.save' then
  name_=btrim(p->>'name');profile=p->>'baseRole';
  if name_ is null or length(name_) not between 2 and 60 or profile is null or profile not in ('ADMIN','MANAGER','RECEPTION','ACADEMY_COORDINATOR','COACH','BAR') then raise exception 'USER_ROLE_INVALID';end if;
  if exists(select 1 from win_auth.user_roles where lower(btrim(name))=lower(name_)) then raise exception 'USER_ROLE_TAKEN';end if;
  insert into win_auth.user_roles(name,base_role,created_by) values(name_,profile,actor) returning id into target;
  after_=jsonb_build_object('name',name_,'baseRole',profile);
 else
  target=nullif(p->>'id','')::uuid;role_id=nullif(p->>'roleId','')::uuid;
  username_=btrim(p->>'username');name_=btrim(p->>'name');pin_=coalesce(p->>'pin','');enabled_=coalesce((p->>'enabled')::boolean,true);
  select r.base_role into profile from win_auth.user_roles r where r.id=role_id;
  if profile is null then raise exception 'USER_ROLE_INVALID';end if;
  if username_ is null or length(username_) not between 3 and 100 or name_ is null or length(name_) not between 1 and 120 then raise exception 'USER_DATA_INVALID';end if;
  if (target is null or pin_<>'') and pin_!~'^[0-9]{6}$' then raise exception 'USER_PIN_INVALID';end if;
  if exists(select 1 from win_auth.login_accounts where username_key=lower(username_) and id is distinct from target) then raise exception 'USER_NAME_TAKEN';end if;
  if target is not null then
   select * into old_user from win_auth.login_accounts where id=target for update;
   if not found then raise exception 'USER_NOT_FOUND';end if;
   if target=actor and (not enabled_ or profile<>'ADMIN') then raise exception 'USER_SELF_PROTECTED';end if;
   if old_user.role='ADMIN' and old_user.enabled and (not enabled_ or profile<>'ADMIN') and not exists(select 1 from win_auth.login_accounts where id<>target and role='ADMIN' and enabled) then raise exception 'USER_LAST_ADMIN';end if;
   before_=jsonb_build_object('username',old_user.username,'name',old_user.display_name,'role',old_user.role,'roleId',old_user.user_role_id,'enabled',old_user.enabled);
   update win_auth.login_accounts set username=username_,display_name=name_,role=profile,user_role_id=role_id,enabled=enabled_,
    pin_hash=case when pin_<>'' then extensions.crypt(pin_,extensions.gen_salt('bf',12)) else pin_hash end,
    failed_attempts=case when pin_<>'' then 0 else failed_attempts end,locked_until=case when pin_<>'' then null else locked_until end,updated_at=now()
    where id=target returning * into user_;
   changed_credentials=pin_<>'' or old_user.role<>profile or old_user.username<>username_ or old_user.user_role_id is distinct from role_id or old_user.enabled<>enabled_;
   if changed_credentials then update win_auth.login_sessions set revoked_at=now() where account_id=target and revoked_at is null;end if;
  else
   insert into win_auth.login_accounts(username,display_name,role,user_role_id,pin_hash,enabled)
    values(username_,name_,profile,role_id,extensions.crypt(pin_,extensions.gen_salt('bf',12)),enabled_) returning * into user_;
   target=user_.id;changed_credentials=false;
  end if;
  insert into public.win_staff(user_id,display_name,role,active) values(target,name_,profile,enabled_)
   on conflict(user_id) do update set display_name=excluded.display_name,role=excluded.role,active=excluded.active;
  after_=jsonb_build_object('username',user_.username,'name',user_.display_name,'role',user_.role,'roleId',user_.user_role_id,'enabled',user_.enabled,'pinChanged',pin_<>'');
 end if;
 insert into win_auth.user_management_audit(actor_id,action,target_id,before_record,after_record) values(actor,p_action,target,before_,after_);
 result_=jsonb_build_object('id',target,'ok',true,'signInAgain',p_action='save' and target=actor and coalesce(changed_credentials,false));
 insert into win_auth.user_management_requests(request_id,actor_id,action,payload,result) values(request,actor,p_action,safe_payload,result_);
 return result_;
end;$fn$;
revoke all on function public.win_users_api(text,text,jsonb) from public,anon,authenticated;
grant execute on function public.win_users_api(text,text,jsonb) to service_role;
