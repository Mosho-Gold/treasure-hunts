create table if not exists public.starfall_etsy_oauth_sessions (
  state text primary key,
  code_verifier text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists public.starfall_etsy_config (
  id integer primary key default 1 check (id = 1),
  refresh_token text,
  etsy_user_id text,
  shop_id text,
  starfall_listing_id text,
  updated_at timestamptz not null default now()
);

alter table public.starfall_etsy_oauth_sessions enable row level security;
alter table public.starfall_etsy_config enable row level security;
