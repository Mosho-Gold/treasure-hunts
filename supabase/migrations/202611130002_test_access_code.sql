insert into public.starfall_access_codes (
  code_hash,
  label,
  active,
  max_devices
)
values (
  '1ed3088ca93b6395a06dbafaf294d37514c425f4de2d4e56144d1a3f52a4f0d2',
  'Initial STARFALL test access code',
  true,
  3
)
on conflict (code_hash) do nothing;
