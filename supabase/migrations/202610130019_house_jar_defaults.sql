-- The existing product model defines FULL_JAR as refillable 20L water.
-- Names/SKUs need not contain a capacity (the live jar uses SKU "2").
-- Apply the default to unconfigured jar products without overriding any
-- explicit HOUSE pricing decision recorded after migration 18.
update public.products p set house_eligible=true
where p.kind='FULL_JAR' and not p.house_eligible and p.house_version=1
 and not exists(select 1 from public.audit_events a
  where a.entity='products' and a.entity_id=p.id and a.action='HOUSE_PRICING_SAVED');

create or replace function public.house_revision() returns trigger
language plpgsql set search_path='' as $$
begin
 if tg_table_name='customers' then
  if tg_op='UPDATE' and (old.supply_type,old.house_status) is distinct from (new.supply_type,new.house_status) then
   new.house_version:=old.house_version+1;
  end if;
 else
  if tg_op='INSERT' then
   new.reference_price:=coalesce(new.reference_price,new.default_price);
   new.house_eligible:=new.house_eligible or new.kind='FULL_JAR';
  elsif (old.house_eligible,old.reference_price) is distinct from (new.house_eligible,new.reference_price) then
   new.house_version:=old.house_version+1;
  end if;
 end if;
 return new;
end $$;
revoke all on function public.house_revision() from public,anon,authenticated,service_role;
