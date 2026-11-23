-- Autenticación WIN por usuario + PIN. No usa correo.
-- Tabla privada; solo backend privilegiado puede verificar el hash.
create schema if not exists win_auth;
revoke all on schema win_auth from public, anon, authenticated;
create table if not exists win_auth.login_accounts (
 id uuid primary key default gen_random_uuid(),
 username text not null unique,
 username_key text generated always as (lower(btrim(username))) stored unique,
 pin_hash text not null,
 display_name text not null,
 role text not null check(role in ('ADMIN','MANAGER','RECEPTION','BAR')),
 enabled boolean not null default false,
 failed_attempts integer not null default 0 check(failed_attempts >= 0),
 locked_until timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 constraint username_format check(length(btrim(username)) between 3 and 100)
);
alter table win_auth.login_accounts enable row level security;
revoke all on all tables in schema win_auth from public, anon, authenticated;
grant usage on schema win_auth to service_role;
grant select,insert,update on win_auth.login_accounts to service_role;
-- No access or RLS policies for anon/authenticated.
-- Admin account is created separately through a privileged statement;
-- PIN must NEVER be inserted into SQL committed to GitHub.
