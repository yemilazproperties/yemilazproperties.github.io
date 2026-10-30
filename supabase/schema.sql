-- Yemilaz Properties: v2 schema and RLS repair.
-- Run in Supabase SQL Editor. Existing records are preserved. This replaces
-- policies on these application tables to remove the legacy recursive rules.
create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  email text not null default '',
  role text not null default 'tenant',
  created_at timestamptz not null default now()
);
alter table public.profiles add column if not exists full_name text not null default '';
alter table public.profiles add column if not exists email text not null default '';
alter table public.profiles add column if not exists role text not null default 'tenant';
alter table public.profiles add column if not exists created_at timestamptz not null default now();

create table if not exists public.properties (
  id uuid primary key default gen_random_uuid(),
  landlord_id uuid references public.profiles(id) on delete cascade,
  name text not null default 'Property',
  property_type text not null default 'residential',
  address text not null default '',
  city text,
  monthly_rent numeric(14,2) not null default 0,
  image_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.properties add column if not exists landlord_id uuid references public.profiles(id) on delete cascade;
alter table public.properties add column if not exists name text not null default 'Property';
alter table public.properties add column if not exists property_type text not null default 'residential';
alter table public.properties add column if not exists address text not null default '';
alter table public.properties add column if not exists city text;
alter table public.properties add column if not exists monthly_rent numeric(14,2) not null default 0;
alter table public.properties add column if not exists image_path text;
alter table public.properties add column if not exists created_at timestamptz not null default now();
alter table public.properties add column if not exists updated_at timestamptz not null default now();

create table if not exists public.property_caretakers (
  property_id uuid not null references public.properties(id) on delete cascade,
  caretaker_id uuid not null references public.profiles(id) on delete cascade,
  assigned_at timestamptz not null default now(),
  primary key (property_id, caretaker_id)
);
create table if not exists public.units (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  unit_name text not null,
  bedrooms smallint,
  monthly_rent numeric(14,2) not null default 0,
  created_at timestamptz not null default now(),
  unique (property_id, unit_name)
);
create table if not exists public.leases (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references public.units(id) on delete restrict,
  tenant_id uuid not null references public.profiles(id) on delete restrict,
  start_date date not null,
  end_date date not null,
  annual_rent numeric(14,2) not null default 0,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  check (end_date >= start_date)
);
create table if not exists public.agreements (
  id uuid primary key default gen_random_uuid(),
  lease_id uuid not null references public.leases(id) on delete cascade,
  uploaded_by uuid not null references public.profiles(id) on delete restrict,
  storage_path text not null,
  status text not null default 'draft',
  sent_at timestamptz,
  tenant_signed_at timestamptz,
  signed_name text,
  created_at timestamptz not null default now()
);
alter table public.agreements add column if not exists signed_name text;
create table if not exists public.maintenance_requests (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references public.units(id) on delete cascade,
  reported_by uuid not null references public.profiles(id) on delete restrict,
  title text not null,
  description text,
  status text not null default 'open',
  priority text not null default 'normal',
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  lease_id uuid not null references public.leases(id) on delete cascade,
  amount numeric(14,2) not null check (amount > 0),
  due_date date not null,
  paid_at timestamptz,
  method text not null default 'bank_transfer',
  reference text,
  status text not null default 'pending',
  reported_by uuid not null references public.profiles(id) on delete restrict,
  verified_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

-- Compatibility for early tables, without discarding existing records.
alter table public.units add column if not exists property_id uuid references public.properties(id) on delete cascade;
alter table public.units add column if not exists unit_name text not null default 'Unit';
alter table public.units add column if not exists bedrooms smallint;
alter table public.units add column if not exists monthly_rent numeric(14,2) not null default 0;
alter table public.units add column if not exists created_at timestamptz not null default now();
alter table public.leases add column if not exists start_date date not null default current_date;
alter table public.leases add column if not exists unit_id uuid references public.units(id) on delete restrict;
alter table public.leases add column if not exists tenant_id uuid references public.profiles(id) on delete restrict;
alter table public.leases add column if not exists end_date date not null default (current_date + interval '1 year');
alter table public.leases add column if not exists annual_rent numeric(14,2) not null default 0;
alter table public.leases add column if not exists status text not null default 'pending';
alter table public.leases add column if not exists created_at timestamptz not null default now();
alter table public.agreements add column if not exists status text not null default 'draft';
alter table public.agreements add column if not exists sent_at timestamptz;
alter table public.agreements add column if not exists tenant_signed_at timestamptz;
alter table public.agreements add column if not exists created_at timestamptz not null default now();
alter table public.agreements add column if not exists lease_id uuid references public.leases(id) on delete cascade;
alter table public.agreements add column if not exists uploaded_by uuid references public.profiles(id) on delete restrict;
alter table public.agreements add column if not exists storage_path text not null default '';
alter table public.maintenance_requests add column if not exists description text;
alter table public.maintenance_requests add column if not exists unit_id uuid references public.units(id) on delete cascade;
alter table public.maintenance_requests add column if not exists reported_by uuid references public.profiles(id) on delete restrict;
alter table public.maintenance_requests add column if not exists title text not null default 'Maintenance request';
alter table public.maintenance_requests add column if not exists status text not null default 'open';
alter table public.maintenance_requests add column if not exists priority text not null default 'normal';
alter table public.maintenance_requests add column if not exists created_at timestamptz not null default now();
alter table public.maintenance_requests add column if not exists resolved_at timestamptz;
alter table public.property_caretakers add column if not exists property_id uuid references public.properties(id) on delete cascade;
alter table public.property_caretakers add column if not exists caretaker_id uuid references public.profiles(id) on delete cascade;
alter table public.property_caretakers add column if not exists assigned_at timestamptz not null default now();
alter table public.payments add column if not exists lease_id uuid references public.leases(id) on delete cascade;
alter table public.payments add column if not exists amount numeric(14,2) not null default 0;
alter table public.payments add column if not exists due_date date not null default current_date;
alter table public.payments add column if not exists paid_at timestamptz;
alter table public.payments add column if not exists method text not null default 'bank_transfer';
alter table public.payments add column if not exists reference text;
alter table public.payments add column if not exists status text not null default 'pending';
alter table public.payments add column if not exists reported_by uuid references public.profiles(id) on delete restrict;
alter table public.payments add column if not exists verified_by uuid references public.profiles(id) on delete set null;
alter table public.payments add column if not exists created_at timestamptz not null default now();

-- Convert the earlier admin label to the supported landlord role, then enforce
-- the app's role vocabulary while retaining tenant/caretaker records.
do $$ declare c record; begin
  for c in select conname from pg_constraint where conrelid='public.profiles'::regclass and contype='c' and pg_get_constraintdef(oid) ilike '%role%' loop
    execute format('alter table public.profiles drop constraint %I',c.conname);
  end loop;
end $$;
update public.profiles set role='landlord' where role='admin';
alter table public.profiles add constraint profiles_role_check check (role in ('landlord','caretaker','tenant'));

create index if not exists properties_landlord_idx on public.properties(landlord_id);
create index if not exists property_caretakers_caretaker_idx on public.property_caretakers(caretaker_id,property_id);
create index if not exists units_property_idx on public.units(property_id);
create index if not exists leases_tenant_idx on public.leases(tenant_id,unit_id);
create index if not exists agreements_lease_idx on public.agreements(lease_id);
create index if not exists maintenance_unit_idx on public.maintenance_requests(unit_id,status);
create index if not exists payments_lease_due_idx on public.payments(lease_id,due_date,status);

-- Existing property rows are assigned only when there is exactly one landlord.
update public.properties set landlord_id=(select id from public.profiles where role='landlord' order by created_at limit 1)
where landlord_id is null and (select count(*) from public.profiles where role='landlord')=1;

create or replace function public.create_profile_for_auth_user()
returns trigger language plpgsql security definer set search_path=public
as $$ begin
  insert into public.profiles(id,full_name,email,role)
  values(new.id,coalesce(new.raw_user_meta_data->>'full_name',''),coalesce(new.email,''),'tenant')
  on conflict(id) do nothing;
  return new;
end $$;
drop trigger if exists yemilaz_auth_user_profile on auth.users;
create trigger yemilaz_auth_user_profile after insert on auth.users for each row execute function public.create_profile_for_auth_user();

create or replace function public.can_manage_property(target_property uuid)
returns boolean language sql stable security definer set search_path=public set row_security=off
as $$ select exists(select 1 from public.properties p where p.id=target_property and p.landlord_id=auth.uid())
or exists(select 1 from public.property_caretakers pc where pc.property_id=target_property and pc.caretaker_id=auth.uid()) $$;
create or replace function public.can_access_property(target_property uuid)
returns boolean language sql stable security definer set search_path=public set row_security=off
as $$ select public.can_manage_property(target_property) or exists(
  select 1 from public.units u join public.leases l on l.unit_id=u.id
  where u.property_id=target_property and l.tenant_id=auth.uid()) $$;
create or replace function public.is_landlord_property(target_property uuid)
returns boolean language sql stable security definer set search_path=public set row_security=off
as $$ select exists(select 1 from public.properties p where p.id=target_property and p.landlord_id=auth.uid()) $$;
create or replace function public.can_access_unit(target uuid)
returns boolean language sql stable security definer set search_path=public set row_security=off
as $$ select exists(select 1 from public.units u where u.id=target and
  (public.can_manage_property(u.property_id) or exists(select 1 from public.leases l where l.unit_id=u.id and l.tenant_id=auth.uid()))) $$;
create or replace function public.is_landlord_unit(target uuid)
returns boolean language sql stable security definer set search_path=public set row_security=off
as $$ select exists(select 1 from public.units u join public.properties p on p.id=u.property_id where u.id=target and p.landlord_id=auth.uid()) $$;
create or replace function public.can_access_lease(target uuid)
returns boolean language sql stable security definer set search_path=public set row_security=off
as $$ select exists(select 1 from public.leases l join public.units u on u.id=l.unit_id
  where l.id=target and (l.tenant_id=auth.uid() or public.can_manage_property(u.property_id))) $$;
create or replace function public.can_manage_lease(target uuid)
returns boolean language sql stable security definer set search_path=public set row_security=off
as $$ select exists(select 1 from public.leases l join public.units u on u.id=l.unit_id
  join public.properties p on p.id=u.property_id where l.id=target and p.landlord_id=auth.uid()) $$;
create or replace function public.can_manage_unit(target uuid)
returns boolean language sql stable security definer set search_path=public set row_security=off
as $$ select exists(select 1 from public.units u join public.properties p on p.id=u.property_id
  where u.id=target and (p.landlord_id=auth.uid() or exists(select 1 from public.property_caretakers pc where pc.property_id=p.id and pc.caretaker_id=auth.uid()))) $$;
create or replace function public.can_view_profile(target uuid)
returns boolean language sql stable security definer set search_path=public set row_security=off
as $$ select target=auth.uid() or exists(
  select 1 from public.leases l join public.units u on u.id=l.unit_id join public.properties p on p.id=u.property_id
  where l.tenant_id=target and (p.landlord_id=auth.uid() or exists(select 1 from public.property_caretakers pc where pc.property_id=p.id and pc.caretaker_id=auth.uid())))
or exists(select 1 from public.property_caretakers pc join public.properties p on p.id=pc.property_id
  where pc.caretaker_id=target and p.landlord_id=auth.uid()) $$;

create or replace function public.protect_profile_role()
returns trigger language plpgsql security definer set search_path=public
as $$ begin
  if auth.uid() is not null and (new.id is distinct from old.id or new.email is distinct from old.email or
    new.role is distinct from old.role or new.created_at is distinct from old.created_at) then
    raise exception 'Account holders may only edit their profile name';
  end if;
  return new;
end $$;
drop trigger if exists yemilaz_profile_role_guard on public.profiles;
create trigger yemilaz_profile_role_guard before update on public.profiles for each row execute function public.protect_profile_role();

create or replace function public.protect_tenant_agreement_update()
returns trigger language plpgsql security definer set search_path=public set row_security=off
as $$ begin
  if exists(select 1 from public.leases l where l.id=old.lease_id and l.tenant_id=auth.uid()) then
    if new.lease_id is distinct from old.lease_id or new.uploaded_by is distinct from old.uploaded_by or
      new.storage_path is distinct from old.storage_path or new.status not in ('tenant_signed','declined') then
      raise exception 'Tenants may only sign or decline an agreement'; end if;
    new.tenant_signed_at=now();
  end if;
  return new;
end $$;
drop trigger if exists yemilaz_agreement_guard on public.agreements;
create trigger yemilaz_agreement_guard before update on public.agreements for each row execute function public.protect_tenant_agreement_update();

-- Replace legacy recursive policies on the application tables. The helper
-- functions above run as the database owner, so policy checks don't recurse.
do $$ declare p record; begin
  for p in select schemaname,tablename,policyname from pg_policies where schemaname='public' and tablename in
    ('profiles','properties','property_caretakers','units','leases','agreements','maintenance_requests','payments') loop
    execute format('drop policy %I on %I.%I',p.policyname,p.schemaname,p.tablename);
  end loop;
end $$;
alter table public.profiles enable row level security;
alter table public.properties enable row level security;
alter table public.property_caretakers enable row level security;
alter table public.units enable row level security;
alter table public.leases enable row level security;
alter table public.agreements enable row level security;
alter table public.maintenance_requests enable row level security;
alter table public.payments enable row level security;

create policy profiles_select_related on public.profiles for select to authenticated using(public.can_view_profile(id));
create policy profiles_update_self on public.profiles for update to authenticated using(id=auth.uid()) with check(id=auth.uid());
create policy properties_select_team on public.properties for select to authenticated using(public.can_access_property(id));
create policy properties_insert_owner on public.properties for insert to authenticated with check(landlord_id=auth.uid());
create policy properties_update_owner on public.properties for update to authenticated using(public.is_landlord_property(id)) with check(public.is_landlord_property(id));
create policy properties_delete_owner on public.properties for delete to authenticated using(public.is_landlord_property(id));
create policy assignments_select_team on public.property_caretakers for select to authenticated using(public.can_manage_property(property_id) or caretaker_id=auth.uid());
create policy assignments_manage_owner on public.property_caretakers for all to authenticated using(public.is_landlord_property(property_id)) with check(public.is_landlord_property(property_id));
create policy units_select_access on public.units for select to authenticated using(public.can_access_unit(id));
create policy units_manage_owner on public.units for all to authenticated using(public.is_landlord_property(property_id)) with check(public.is_landlord_property(property_id));
create policy leases_select_related on public.leases for select to authenticated using(public.can_access_lease(id));
create policy leases_insert_owner on public.leases for insert to authenticated with check(public.is_landlord_unit(unit_id));
create policy leases_update_owner on public.leases for update to authenticated using(public.can_manage_lease(id)) with check(public.can_manage_lease(id));
create policy leases_delete_owner on public.leases for delete to authenticated using(public.can_manage_lease(id));
create policy agreements_select_related on public.agreements for select to authenticated using(public.can_access_lease(lease_id));
create policy agreements_insert_owner on public.agreements for insert to authenticated with check(uploaded_by=auth.uid() and public.can_manage_lease(lease_id));
create policy agreements_update_owner on public.agreements for update to authenticated using(public.can_manage_lease(lease_id)) with check(public.can_manage_lease(lease_id));
create policy agreements_update_tenant on public.agreements for update to authenticated using(public.can_access_lease(lease_id)) with check(public.can_access_lease(lease_id));
create policy maintenance_select_access on public.maintenance_requests for select to authenticated using(public.can_access_unit(unit_id));
create policy maintenance_insert_access on public.maintenance_requests for insert to authenticated with check(reported_by=auth.uid() and public.can_access_unit(unit_id));
create policy maintenance_update_team on public.maintenance_requests for update to authenticated using(public.can_manage_unit(unit_id)) with check(public.can_manage_unit(unit_id));
create policy payments_select_related on public.payments for select to authenticated using(public.can_access_lease(lease_id));
create policy payments_insert_tenant on public.payments for insert to authenticated with check(reported_by=auth.uid() and status='pending' and public.can_access_lease(lease_id));
create policy payments_insert_owner on public.payments for insert to authenticated with check(reported_by=auth.uid() and public.can_manage_lease(lease_id));
create policy payments_update_owner on public.payments for update to authenticated using(public.can_manage_lease(lease_id)) with check(public.can_manage_lease(lease_id));
create policy payments_delete_owner on public.payments for delete to authenticated using(public.can_manage_lease(lease_id));

insert into storage.buckets(id,name,public) values('rental-agreements','rental-agreements',false) on conflict(id) do update set public=false;
drop policy if exists yemilaz_agreements_read on storage.objects;
drop policy if exists yemilaz_agreements_upload on storage.objects;
drop policy if exists yemilaz_agreements_delete on storage.objects;
create policy yemilaz_agreements_read on storage.objects for select to authenticated using(bucket_id='rental-agreements' and public.can_access_lease((storage.foldername(name))[1]::uuid));
create policy yemilaz_agreements_upload on storage.objects for insert to authenticated with check(bucket_id='rental-agreements' and public.can_manage_lease((storage.foldername(name))[1]::uuid));
create policy yemilaz_agreements_delete on storage.objects for delete to authenticated using(bucket_id='rental-agreements' and public.can_manage_lease((storage.foldername(name))[1]::uuid));

-- Property photos remain in a private bucket and are served through short-lived signed URLs.
insert into storage.buckets(id,name,public) values('property-images','property-images',false) on conflict(id) do update set public=false;
drop policy if exists yemilaz_property_images_read on storage.objects;
drop policy if exists yemilaz_property_images_upload on storage.objects;
drop policy if exists yemilaz_property_images_delete on storage.objects;
create policy yemilaz_property_images_read on storage.objects for select to authenticated using(bucket_id='property-images' and public.can_access_property((storage.foldername(name))[1]::uuid));
create policy yemilaz_property_images_upload on storage.objects for insert to authenticated with check(bucket_id='property-images' and public.is_landlord_property((storage.foldername(name))[1]::uuid));
create policy yemilaz_property_images_delete on storage.objects for delete to authenticated using(bucket_id='property-images' and public.is_landlord_property((storage.foldername(name))[1]::uuid));

grant usage on schema public to authenticated;
grant select,update on public.profiles to authenticated;
grant select,insert,update,delete on public.properties,public.property_caretakers,public.units,public.leases,public.agreements,public.maintenance_requests,public.payments to authenticated;
revoke all on public.profiles,public.properties,public.property_caretakers,public.units,public.leases,public.agreements,public.maintenance_requests,public.payments from anon;
revoke all on function public.can_manage_property(uuid),public.can_access_property(uuid),public.is_landlord_property(uuid),public.can_access_unit(uuid),public.is_landlord_unit(uuid),public.can_access_lease(uuid),public.can_manage_lease(uuid),public.can_manage_unit(uuid),public.can_view_profile(uuid) from public,anon;
grant execute on function public.can_manage_property(uuid),public.can_access_property(uuid),public.is_landlord_property(uuid),public.can_access_unit(uuid),public.is_landlord_unit(uuid),public.can_access_lease(uuid),public.can_manage_lease(uuid),public.can_manage_unit(uuid),public.can_view_profile(uuid) to authenticated;

-- Email sending runs in Edge Functions with RESEND_API_KEY and SUPABASE_SERVICE_ROLE_KEY secrets.
