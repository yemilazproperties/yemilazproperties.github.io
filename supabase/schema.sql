-- Yemilaz Properties: initial Supabase schema
-- Run in Supabase SQL Editor for a fresh project or as a one-time setup migration.
-- Existing property rows need to be assigned to a landlord after account setup.
-- Keep the service role key server-side only.
create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  email text not null default '',
  role text not null default 'tenant' check (role in ('landlord','caretaker','tenant')),
  created_at timestamptz not null default now()
);

create table if not exists public.properties (
  id uuid primary key default gen_random_uuid(),
  landlord_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  property_type text not null default 'residential' check (property_type in ('residential','commercial','mixed_use')),
  address text not null,
  city text,
  monthly_rent numeric(14,2) not null default 0 check (monthly_rent >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- CREATE TABLE IF NOT EXISTS does not add columns to an existing table. This
-- additive migration fixes legacy properties tables that predate landlord_id.
alter table public.properties
  add column if not exists landlord_id uuid references public.profiles(id) on delete cascade;

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
  monthly_rent numeric(14,2) not null default 0 check (monthly_rent >= 0),
  created_at timestamptz not null default now(),
  unique (property_id, unit_name)
);

create table if not exists public.leases (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references public.units(id) on delete restrict,
  tenant_id uuid not null references public.profiles(id) on delete restrict,
  start_date date not null,
  end_date date not null,
  annual_rent numeric(14,2) not null check (annual_rent >= 0),
  status text not null default 'pending' check (status in ('pending','active','ended')),
  created_at timestamptz not null default now(),
  check (end_date >= start_date)
);

create table if not exists public.agreements (
  id uuid primary key default gen_random_uuid(),
  lease_id uuid not null references public.leases(id) on delete cascade,
  uploaded_by uuid not null references public.profiles(id) on delete restrict,
  storage_path text not null,
  status text not null default 'draft' check (status in ('draft','sent','tenant_signed','landlord_review','active','declined')),
  sent_at timestamptz,
  tenant_signed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.maintenance_requests (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references public.units(id) on delete cascade,
  reported_by uuid not null references public.profiles(id) on delete restrict,
  title text not null,
  description text,
  status text not null default 'open' check (status in ('open','in_progress','resolved')),
  priority text not null default 'normal' check (priority in ('low','normal','urgent')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index if not exists properties_landlord_idx on public.properties (landlord_id);
create index if not exists property_caretakers_caretaker_idx on public.property_caretakers (caretaker_id, property_id);
create index if not exists units_property_idx on public.units (property_id);
create index if not exists leases_tenant_idx on public.leases (tenant_id, unit_id);
create index if not exists agreements_lease_idx on public.agreements (lease_id);
create index if not exists maintenance_unit_idx on public.maintenance_requests (unit_id, status);

-- Create a basic tenant profile for each new Auth user. Privileged roles are
-- assigned separately by the landlord, never from user-controlled signup metadata.
create or replace function public.create_profile_for_auth_user()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, email, role)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name',''), coalesce(new.email,''), 'tenant')
  on conflict (id) do nothing;
  return new;
end;
$$;
drop trigger if exists hearth_auth_user_profile on auth.users;
create trigger hearth_auth_user_profile after insert on auth.users
for each row execute function public.create_profile_for_auth_user();

-- Prevent profile owners from promoting themselves to landlord/caretaker.
create or replace function public.protect_profile_role()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is not null and new.role is distinct from old.role then
    raise exception 'Only an administrator can change a profile role';
  end if;
  return new;
end;
$$;
drop trigger if exists hearth_profile_role_guard on public.profiles;
create trigger hearth_profile_role_guard before update on public.profiles
for each row execute function public.protect_profile_role();

-- Tenant updates can only record a signature transition, not replace document paths.
create or replace function public.protect_tenant_agreement_update()
returns trigger language plpgsql security definer set search_path = public
as $$
declare is_tenant boolean;
begin
  select exists (select 1 from public.leases l where l.id=old.lease_id and l.tenant_id=auth.uid()) into is_tenant;
  if is_tenant then
    if new.lease_id is distinct from old.lease_id
       or new.uploaded_by is distinct from old.uploaded_by
       or new.storage_path is distinct from old.storage_path
       or new.created_at is distinct from old.created_at
       or new.status not in ('tenant_signed','declined') then
      raise exception 'Tenants may only sign or decline their agreement';
    end if;
    new.tenant_signed_at := case when new.status='tenant_signed' then now() else null end;
  end if;
  return new;
end;
$$;
drop trigger if exists hearth_agreement_tenant_guard on public.agreements;
create trigger hearth_agreement_tenant_guard before update on public.agreements
for each row execute function public.protect_tenant_agreement_update();

-- SECURITY DEFINER helper functions avoid recursive RLS policy evaluation.
create or replace function public.is_landlord_of(target_property uuid)
returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.properties p where p.id = target_property and p.landlord_id = auth.uid()) $$;

create or replace function public.is_caretaker_of(target_property uuid)
returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.property_caretakers pc where pc.property_id = target_property and pc.caretaker_id = auth.uid()) $$;

create or replace function public.can_manage_property(target_property uuid)
returns boolean language sql stable security definer set search_path = public
as $$ select public.is_landlord_of(target_property) or public.is_caretaker_of(target_property) $$;

create or replace function public.can_access_unit(target_unit uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.units u
    where u.id = target_unit and (
      public.can_manage_property(u.property_id) or exists (
        select 1 from public.leases l where l.unit_id = u.id and l.tenant_id = auth.uid()
      )
    )
  )
$$;

alter table public.profiles enable row level security;
alter table public.properties enable row level security;
alter table public.property_caretakers enable row level security;
alter table public.units enable row level security;
alter table public.leases enable row level security;
alter table public.agreements enable row level security;
alter table public.maintenance_requests enable row level security;

drop policy if exists "Users can read their own profile" on public.profiles;
create policy "Users can read their own profile" on public.profiles for select to authenticated using (id = auth.uid());
drop policy if exists "Landlords can read profiles attached to their properties" on public.profiles;
create policy "Landlords can read profiles attached to their properties" on public.profiles for select to authenticated using (
  exists (select 1 from public.leases l join public.units u on u.id=l.unit_id where l.tenant_id=profiles.id and public.is_landlord_of(u.property_id)) or
  exists (select 1 from public.property_caretakers pc where pc.caretaker_id=profiles.id and public.is_landlord_of(pc.property_id))
);
drop policy if exists "Caretakers can read tenant profiles at assigned properties" on public.profiles;
create policy "Caretakers can read tenant profiles at assigned properties" on public.profiles for select to authenticated using (
  exists (select 1 from public.leases l join public.units u on u.id=l.unit_id join public.property_caretakers pc on pc.property_id=u.property_id where l.tenant_id=profiles.id and pc.caretaker_id=auth.uid())
);
drop policy if exists "Users can update their own profile" on public.profiles;
create policy "Users can update their own profile" on public.profiles for update to authenticated using (id=auth.uid()) with check (id=auth.uid());

drop policy if exists "Landlords manage their properties" on public.properties;
create policy "Landlords manage their properties" on public.properties for all to authenticated using (
  landlord_id=auth.uid() and exists (select 1 from public.profiles pr where pr.id=auth.uid() and pr.role='landlord')
) with check (
  landlord_id=auth.uid() and exists (select 1 from public.profiles pr where pr.id=auth.uid() and pr.role='landlord')
);
drop policy if exists "Caretakers can view assigned properties" on public.properties;
create policy "Caretakers can view assigned properties" on public.properties for select to authenticated using (public.is_caretaker_of(id));
drop policy if exists "Users can view assigned caretakers" on public.property_caretakers;
create policy "Users can view assigned caretakers" on public.property_caretakers for select to authenticated using (public.can_manage_property(property_id));
drop policy if exists "Landlords manage caretaker assignments" on public.property_caretakers;
create policy "Landlords manage caretaker assignments" on public.property_caretakers for all to authenticated using (public.is_landlord_of(property_id)) with check (public.is_landlord_of(property_id));

drop policy if exists "Landlords manage units" on public.units;
create policy "Landlords manage units" on public.units for all to authenticated using (public.is_landlord_of(property_id)) with check (public.is_landlord_of(property_id));
drop policy if exists "Caretakers can view assigned units" on public.units;
create policy "Caretakers can view assigned units" on public.units for select to authenticated using (public.is_caretaker_of(property_id));
drop policy if exists "Tenants can view their leased units" on public.units;
create policy "Tenants can view their leased units" on public.units for select to authenticated using (
  exists (select 1 from public.leases l where l.unit_id=units.id and l.tenant_id=auth.uid())
);
drop policy if exists "Property team views leases" on public.leases;
create policy "Property team views leases" on public.leases for select to authenticated using (
  exists (select 1 from public.units u where u.id=unit_id and public.can_manage_property(u.property_id))
);
drop policy if exists "Tenants view their leases" on public.leases;
create policy "Tenants view their leases" on public.leases for select to authenticated using (tenant_id=auth.uid());
drop policy if exists "Landlords create leases" on public.leases;
create policy "Landlords create leases" on public.leases for insert to authenticated with check (
  exists (select 1 from public.units u where u.id=unit_id and public.is_landlord_of(u.property_id))
);
drop policy if exists "Landlords update leases" on public.leases;
create policy "Landlords update leases" on public.leases for update to authenticated using (
  exists (select 1 from public.units u where u.id=unit_id and public.is_landlord_of(u.property_id))
) with check (
  exists (select 1 from public.units u where u.id=unit_id and public.is_landlord_of(u.property_id))
);

drop policy if exists "Landlords manage agreements" on public.agreements;
create policy "Landlords manage agreements" on public.agreements for all to authenticated using (
  exists (select 1 from public.leases l join public.units u on u.id=l.unit_id where l.id=lease_id and public.is_landlord_of(u.property_id))
) with check (
  exists (select 1 from public.leases l join public.units u on u.id=l.unit_id where l.id=lease_id and public.is_landlord_of(u.property_id))
);
drop policy if exists "Tenants can view agreements for their leases" on public.agreements;
create policy "Tenants can view agreements for their leases" on public.agreements for select to authenticated using (
  exists (select 1 from public.leases l where l.id=lease_id and l.tenant_id=auth.uid())
);
drop policy if exists "Tenants can sign their agreements" on public.agreements;
create policy "Tenants can sign their agreements" on public.agreements for update to authenticated using (
  exists (select 1 from public.leases l where l.id=lease_id and l.tenant_id=auth.uid())
) with check (
  exists (select 1 from public.leases l where l.id=lease_id and l.tenant_id=auth.uid())
);

drop policy if exists "Property team views maintenance" on public.maintenance_requests;
create policy "Property team views maintenance" on public.maintenance_requests for select to authenticated using (public.can_access_unit(unit_id));
drop policy if exists "Tenants and team create maintenance requests" on public.maintenance_requests;
create policy "Tenants and team create maintenance requests" on public.maintenance_requests for insert to authenticated with check (
  reported_by=auth.uid() and public.can_access_unit(unit_id)
);
drop policy if exists "Property team updates maintenance" on public.maintenance_requests;
create policy "Property team updates maintenance" on public.maintenance_requests for update to authenticated using (
  exists (select 1 from public.units u where u.id=unit_id and public.can_manage_property(u.property_id))
) with check (
  exists (select 1 from public.units u where u.id=unit_id and public.can_manage_property(u.property_id))
);

-- Private bucket for lease PDFs. Upload and download authorization must be enforced
-- through Storage policies in production; this bucket is private by default.
insert into storage.buckets (id, name, public) values ('rental-agreements','rental-agreements',false)
on conflict (id) do nothing;

-- Supabase Data API permissions are separate from RLS policies. These grants
-- allow authenticated requests to reach the tables; the policies above still
-- restrict which rows each role can read or change. Anonymous access is omitted.
grant usage on schema public to authenticated;
grant select, update on public.profiles to authenticated;
grant select, insert, update, delete on public.properties to authenticated;
grant select, insert, update, delete on public.property_caretakers to authenticated;
grant select, insert, update, delete on public.units to authenticated;
grant select, insert, update on public.leases to authenticated;
grant select, insert, update on public.agreements to authenticated;
grant select, insert, update on public.maintenance_requests to authenticated;
revoke all on public.profiles, public.properties, public.property_caretakers, public.units, public.leases, public.agreements, public.maintenance_requests from anon;
revoke all on function public.is_landlord_of(uuid) from public, anon;
revoke all on function public.is_caretaker_of(uuid) from public, anon;
revoke all on function public.can_manage_property(uuid) from public, anon;
revoke all on function public.can_access_unit(uuid) from public, anon;
grant execute on function public.is_landlord_of(uuid) to authenticated;
grant execute on function public.is_caretaker_of(uuid) to authenticated;
grant execute on function public.can_manage_property(uuid) to authenticated;
grant execute on function public.can_access_unit(uuid) to authenticated;

-- Email invitations and agreement notices should be sent from a Supabase Edge Function
-- using the Resend/Postmark provider key held in server-side secrets. Never expose a
-- Supabase service-role key or email-provider key in the browser.
