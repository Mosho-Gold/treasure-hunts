-- Isolated expiring owner-test activations. No Etsy receipt or customer authorization is created.
create table if not exists public.foggy_test_devices (
  device_id text primary key,
  activation_token_hash text not null unique,
  expires_at timestamptz not null,
  revoked boolean not null default false,
  activated_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
alter table public.foggy_test_devices enable row level security;
-- No public access policies. Only the Foggy Edge Function's server-side service
-- credentials can issue, check, expire, or revoke test activations.
create index if not exists foggy_test_devices_expiry_idx on public.foggy_test_devices(expires_at);
