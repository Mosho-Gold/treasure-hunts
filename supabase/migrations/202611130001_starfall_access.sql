create extension if not exists pgcrypto;

create table if not exists public.starfall_access_codes (
  id uuid primary key default gen_random_uuid(),
  code_hash text not null unique,
  label text,
  active boolean not null default true,
  max_devices integer not null default 3 check (max_devices between 1 and 20),
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.starfall_access_devices (
  id uuid primary key default gen_random_uuid(),
  access_code_id uuid not null references public.starfall_access_codes(id) on delete cascade,
  device_id text not null,
  activation_token_hash text not null unique,
  activated_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique(access_code_id, device_id)
);

alter table public.starfall_access_codes enable row level security;
alter table public.starfall_access_devices enable row level security;

-- No public RLS policies are intentionally created.
-- The Edge Function uses the project's secret key server-side.

create index if not exists starfall_access_devices_code_idx
  on public.starfall_access_devices(access_code_id);

-- Helper for creating customer codes from the SQL editor or an admin integration.
-- Example:
-- select public.starfall_create_access_code('STAR-7K4P-2NM8', 'Etsy order 1234', 3, null);
create or replace function public.starfall_create_access_code(
  raw_code text,
  code_label text default null,
  device_limit integer default 3,
  valid_until timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id uuid;
  normalized text;
begin
  normalized := upper(regexp_replace(coalesce(raw_code,''), '[^A-Z0-9]', '', 'g'));
  if length(normalized) < 8 then
    raise exception 'Access code must contain at least 8 letters/numbers';
  end if;

  insert into public.starfall_access_codes(code_hash,label,max_devices,expires_at)
  values (
    encode(digest(normalized, 'sha256'), 'hex'),
    code_label,
    greatest(1, least(coalesce(device_limit,3),20)),
    valid_until
  )
  returning id into new_id;

  return new_id;
end;
$$;

revoke all on function public.starfall_create_access_code(text,text,integer,timestamptz) from public, anon, authenticated;
