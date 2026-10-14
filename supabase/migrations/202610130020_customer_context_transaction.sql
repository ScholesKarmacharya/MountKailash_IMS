-- PostgREST executes STABLE RPCs in READ ONLY transactions, including POST.
-- This wrapper calls the existing authorized context reader, which takes
-- FOR SHARE locks through delivery_trip/customer validation. It therefore
-- needs a writable transaction even though it does not change business rows.
-- Preserve its implementation, owner, SECURITY DEFINER and restricted grants.
alter function public.delivery_customer_context(uuid,uuid) volatile;
notify pgrst, 'reload schema';
