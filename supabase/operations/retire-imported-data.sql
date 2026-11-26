
-- Run only after verifying the private full backup. All targets derive from its source lineage.
begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
do $cleanup$
declare r record;fp text;old_fp text;removed jsonb:='{}';n bigint;actor uuid;key_ text;
begin
 perform pg_catalog.pg_advisory_xact_lock(438011,2);
 if to_regclass('win_backup_20261126_manual.archive') is null or not exists(select 1 from win_backup_20261126_manual.archive where verified) then raise exception 'VERIFIED_BACKUP_REQUIRED';end if;
 if exists(select 1 from public.win_migration_rows where revision<>1) then raise exception 'REVIEWED_IMPORT_NEEDS_COMPARISON';end if;
 create temporary table retire_clients(id uuid primary key) on commit drop;
 create temporary table retire_abonos(id uuid primary key) on commit drop;
 create temporary table retire_waitlist(id uuid primary key) on commit drop;
 insert into retire_clients select distinct c.id from public.win_customers c join win_backup_20261126_manual.public__win_migration_rows m on m.kind='CLIENT' and m.customer_id=c.id
 join win_backup_20261126_manual.public__win_customers b on b.id=c.id and to_jsonb(b)=to_jsonb(c)
 where c.created_by=m.created_by and c.created_at=m.created_at and c.note='Origen: Playmix · ficha sin pagos históricos';
 insert into retire_abonos select distinct a.id from public.win_court_abonos a join win_backup_20261126_manual.public__win_migration_rows m on m.kind='ABONO' and m.abono_id=a.id
 join win_backup_20261126_manual.public__win_court_abonos b on b.id=a.id and to_jsonb(b)=to_jsonb(a)
 where a.request_id=m.id and a.created_by=m.created_by and a.created_at=m.created_at;
 insert into retire_waitlist select distinct w.id from public.win_calendar_waitlist w join win_backup_20261126_manual.public__win_migration_rows m on m.kind='WAITLIST' and m.waitlist_id=w.id
 join win_backup_20261126_manual.public__win_calendar_waitlist b on b.id=w.id and to_jsonb(b)=to_jsonb(w)
 where w.source_key=m.source_key and w.created_by=m.created_by and w.created_at=m.created_at;
 -- A new reference aborts the entire transaction; it never cascades into a real operation.
 if exists(select 1 from public.win_court_bookings where source_abono_id in(select id from retire_abonos) or customer_id in(select id from retire_clients))
 or exists(select 1 from public.win_court_payments where abono_id in(select id from retire_abonos))
 or exists(select 1 from public.win_ops_records where abono_id in(select id from retire_abonos))
 or exists(select 1 from public.win_bar_orders where customer_id in(select id from retire_clients))
 or exists(select 1 from public.win_bar_private_accounts where customer_id in(select id from retire_clients))
 or exists(select 1 from public.win_bar_employee_access where customer_id in(select id from retire_clients))
 or exists(select 1 from public.win_calendar_participants where customer_id in(select id from retire_clients))
 or exists(select 1 from public.win_court_abonos where customer_id in(select id from retire_clients) and id not in(select id from retire_abonos))
 or exists(select 1 from public.win_calendar_waitlist where customer_id in(select id from retire_clients) and id not in(select id from retire_waitlist))
 then raise exception 'IMPORTED_RECORD_HAS_OPERATIONAL_REFERENCE';end if;
 if exists(select 1 from public.win_migration_rows m join win_backup_20261126_manual.public__win_migration_rows b on m.id=b.id where to_jsonb(m)<>to_jsonb(b)) then raise exception 'IMPORT_CHANGED_AFTER_BACKUP';end if;
 create temporary table protected_before(schema_name text,table_name text,fingerprint text) on commit drop;
 for r in select ns.nspname,c.relname from pg_class c join pg_namespace ns on ns.oid=c.relnamespace
 where ns.nspname in('public','win_auth') and c.relkind='r' and c.relname not in(
 'win_customers','win_court_abonos','win_calendar_waitlist','win_migration_rows','win_history_rows',
 'win_resumen_admin','win_clases_profesor_dia','win_turnos','win_movimientos','win_cobros_distribuidos','win_incidencias',
 'win_calendar_opportunities','win_court_abono_skips','win_calendar_requests','win_cash_audit','login_sessions') order by ns.nspname,c.relname loop
  execute format('lock table %I.%I in share mode',r.nspname,r.relname);
  execute format('select md5(coalesce(string_agg(to_jsonb(t)::text,E''\n'' order by to_jsonb(t)::text),'''')) from %I.%I t',r.nspname,r.relname) into fp;
  insert into protected_before values(r.nspname,r.relname,fp);
 end loop;
 -- Verify every affected live record against the full backup before deleting it.
 delete from public.win_calendar_opportunities where waitlist_id in(select id from retire_waitlist) or abono_id in(select id from retire_abonos);
 get diagnostics n=row_count;removed=removed||jsonb_build_object('opportunities',n);
 delete from public.win_court_abono_skips where abono_id in(select id from retire_abonos);
 get diagnostics n=row_count;removed=removed||jsonb_build_object('skips',n);
 delete from public.win_calendar_requests q using win_backup_20261126_manual.public__win_calendar_requests b where q.request_id=b.request_id and to_jsonb(q)=to_jsonb(b) and q.action like 'registry.%';
 get diagnostics n=row_count;removed=removed||jsonb_build_object('reviewRequests',n);
 delete from public.win_migration_rows m using win_backup_20261126_manual.public__win_migration_rows b where m.id=b.id and m.source_key=b.source_key and to_jsonb(m)=to_jsonb(b);
 get diagnostics n=row_count;removed=removed||jsonb_build_object('reviewRows',n);
 delete from public.win_calendar_waitlist where id in(select id from retire_waitlist);
 get diagnostics n=row_count;removed=removed||jsonb_build_object('waitlist',n);
 delete from public.win_court_abonos where id in(select id from retire_abonos);
 get diagnostics n=row_count;removed=removed||jsonb_build_object('abonos',n);
 delete from public.win_customers where id in(select id from retire_clients);
 get diagnostics n=row_count;removed=removed||jsonb_build_object('customers',n);
 delete from public.win_history_rows h using win_backup_20261126_manual.public__win_history_rows b
 where h.source_id=b.source_id and h.entity=b.entity and h.origin_id=b.origin_id and h.content_hash=b.content_hash and to_jsonb(h)=to_jsonb(b)
 and h.source_id='1kYR8t-3dyXC0gFRiMMjBV7sV-byOgfIlGl2mCMwP-zE';
 get diagnostics n=row_count;removed=removed||jsonb_build_object('historyRows',n);
 -- These six immutable staging captures are documented as the original Apps Script import.
 -- No operational API writes to them; compare complete row contents, never truncate a table.
 foreach key_ in array array['win_resumen_admin','win_clases_profesor_dia','win_turnos','win_movimientos','win_cobros_distribuidos','win_incidencias'] loop
  execute format('delete from public.%I live using win_backup_20261126_manual.%I backed where to_jsonb(live)=to_jsonb(backed)',key_,'public__'||key_);
  get diagnostics n=row_count;removed=removed||jsonb_build_object(key_,n);
 end loop;
 if exists(select 1 from public.win_migration_rows m join win_backup_20261126_manual.public__win_migration_rows b on m.id=b.id)
 or exists(select 1 from public.win_court_abonos a join win_backup_20261126_manual.public__win_migration_rows m on m.abono_id=a.id)
 or exists(select 1 from public.win_calendar_waitlist w join win_backup_20261126_manual.public__win_migration_rows m on m.waitlist_id=w.id)
 or exists(select 1 from public.win_customers c join win_backup_20261126_manual.public__win_migration_rows m on m.kind='CLIENT' and m.customer_id=c.id)
 then raise exception 'IMPORTED_ROWS_REMAIN_REQUIRING_REVIEW';end if;
 for r in select * from protected_before loop
  execute format('select md5(coalesce(string_agg(to_jsonb(t)::text,E''\n'' order by to_jsonb(t)::text),'''')) from %I.%I t',r.schema_name,r.table_name) into fp;
  if fp<>r.fingerprint then raise exception 'REAL_DATA_CHANGED: %.%',r.schema_name,r.table_name;end if;
 end loop;
 select id into actor from win_auth.login_accounts where role='ADMIN' and enabled order by created_at limit 1;
 if actor is null then raise exception 'ADMIN_REQUIRED';end if;
 insert into public.win_cash_audit(actor_id,action,entity_type,entity_id,detail)values(actor,'IMPORTED_DATA_RETIRED','RECOVERY','manual-start-20261201',
 jsonb_build_object('removed',removed,'backup','win_backup_20261126_manual','protectedTablesUnchanged',(select count(*) from protected_before),'financialWrites',false,'realOperationsPreserved',true));
end $cleanup$;
commit;
