-- Add support for property rent display and private property photos.
-- Safe to run more than once; existing property records are preserved.
alter table public.properties
  add column if not exists name text not null default 'Property',
  add column if not exists property_name text not null default 'Property',
  add column if not exists property_type text not null default 'house',
  add column if not exists address text not null default '',
  add column if not exists city text,
  add column if not exists monthly_rent numeric(14,2) not null default 0,
  add column if not exists image_path text;

alter table public.properties alter column property_name set default 'Property';

-- Keep the existing target_property argument names so PostgreSQL can replace
-- the landlord helper functions without changing their named arguments.
create or replace function public.is_landlord_property(target_property uuid)
returns boolean language sql stable security definer set search_path=public set row_security=off
as $$
  select exists (
    select 1 from public.properties p
    where p.id = target_property and p.landlord_id = auth.uid()
  );
$$;

create or replace function public.can_manage_property(target_property uuid)
returns boolean language sql stable security definer set search_path=public set row_security=off
as $$
  select public.is_landlord_property(target_property)
    or exists (
      select 1 from public.property_caretakers pc
      where pc.property_id = target_property and pc.caretaker_id = auth.uid()
    );
$$;

create or replace function public.can_access_property(target_property uuid)
returns boolean language sql stable security definer set search_path=public set row_security=off
as $$
  select public.can_manage_property(target_property)
    or exists (
      select 1 from public.units u
      join public.leases l on l.unit_id = u.id
      where u.property_id = target_property and l.tenant_id = auth.uid()
    );
$$;

revoke all on function public.is_landlord_property(uuid), public.can_manage_property(uuid), public.can_access_property(uuid) from public, anon;
grant execute on function public.is_landlord_property(uuid), public.can_manage_property(uuid), public.can_access_property(uuid) to authenticated;

insert into storage.buckets(id,name,public)
values('property-images','property-images',false)
on conflict(id) do update set public=false;

drop policy if exists yemilaz_property_images_read on storage.objects;
drop policy if exists yemilaz_property_images_upload on storage.objects;
drop policy if exists yemilaz_property_images_delete on storage.objects;

create policy yemilaz_property_images_read on storage.objects
for select to authenticated
using(bucket_id='property-images' and public.can_access_property((storage.foldername(name))[1]::uuid));

create policy yemilaz_property_images_upload on storage.objects
for insert to authenticated
with check(bucket_id='property-images' and public.is_landlord_property((storage.foldername(name))[1]::uuid));

create policy yemilaz_property_images_delete on storage.objects
for delete to authenticated
using(bucket_id='property-images' and public.is_landlord_property((storage.foldername(name))[1]::uuid));

notify pgrst, 'reload schema';
