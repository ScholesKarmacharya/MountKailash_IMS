-- The admin HOUSE report uses the same locking ops_actor authorization check.
-- PostgREST must open a writable transaction for its FOR SHARE lock, while the
-- report still performs no business writes. Preserve grants, RLS and the body.
alter function public.house_workspace(timestamptz,timestamptz,uuid,uuid,uuid) volatile;
notify pgrst, 'reload schema';
