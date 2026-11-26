-- Normalize human-entered corrections using the existing calendar phone rule.
-- No source rows, clients, payments or financial records are updated here.
do $patch$
declare definition text;before_ text;begin
 select pg_get_functiondef('public.win_migration_api(text,text,jsonb)'::regprocedure) into definition;
 if position('coalesce(public.win_calendar_phone(p->>' in definition)=0 then
  before_=definition;
  definition=replace(definition,$old$'phone',p->>'phone'$old$,$new$'phone',case when p ? 'phone' then coalesce(public.win_calendar_phone(p->>'phone'),'') else r.data->>'phone' end$new$);
  if definition=before_ then raise exception 'PHONE_REVIEW_PATCH_NOT_FOUND';end if;
  execute definition;
 end if;
 select pg_get_functiondef('public.win_migration_apply(uuid,uuid)'::regprocedure) into definition;
 if position('MIGRATION_COMPLETE_NAME' in definition)=0 then
  before_=definition;
  definition=replace(definition,$old$if length(public.win_person_key(d->>'name'))<3$old$,$new$-- MIGRATION_COMPLETE_NAME: imported labels need a verified personal identity.
  if public.win_person_key(d->>'name') !~ '^[a-z]+ [a-z]' or public.win_person_key(d->>'name') ~ '(^| )(clase|clases|profe|invitado|padel)( |$)'$new$);
  if definition=before_ then raise exception 'NAME_REVIEW_PATCH_NOT_FOUND';end if;
  execute definition;
 end if;
end $patch$;
