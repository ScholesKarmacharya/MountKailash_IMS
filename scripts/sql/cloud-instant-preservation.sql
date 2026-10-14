-- Fingerprints only: no row contents, identifiers or device secrets are emitted.
-- The only new original-table column in migration 26 is excluded consistently.
-- Only a session-local temporary table is written; all public-table reads use
-- one consistent snapshot and the entire diagnostic transaction is rolled back.
begin isolation level repeatable read;
create temporary table instant_original_fingerprints(entity text, original_count bigint, original_fingerprint text) on commit drop;
do $$
declare t record; projection text;
begin
 for t in select c.relname from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relkind='r' and c.relname<>'instant_deliveries' order by c.relname loop
  projection:=case when t.relname='customers' then 'to_jsonb(r)-''is_one_time''' else 'to_jsonb(r)' end;
  execute format('insert into pg_temp.instant_original_fingerprints select %L,count(*),md5(string_agg((%s)::text,''|'' order by (%s)::text)) from public.%I r',t.relname,projection,projection,t.relname);
 end loop;
end $$;
select * from pg_temp.instant_original_fingerprints order by entity;
rollback;
