-- Independent Foggy orders and device activations; Starfall tables remain unchanged.
create table if not exists public.foggy_etsy_orders (
  receipt_id text primary key,
  listing_id text not null,
  buyer_user_id text,
  order_status text not null,
  max_devices integer not null default 3 check (max_devices between 1 and 20),
  verified_at timestamptz not null default now(),
  last_checked_at timestamptz not null default now()
);
create table if not exists public.foggy_etsy_devices (
  id uuid primary key default gen_random_uuid(),
  receipt_id text not null references public.foggy_etsy_orders(receipt_id) on delete cascade,
  device_id text not null,
  activation_token_hash text not null unique,
  activated_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique(receipt_id,device_id)
);
alter table public.foggy_etsy_orders enable row level security;
alter table public.foggy_etsy_devices enable row level security;
create index if not exists foggy_etsy_devices_receipt_idx on public.foggy_etsy_devices(receipt_id);
-- No public RLS policies: this table is accessible only by server-side service credentials.
