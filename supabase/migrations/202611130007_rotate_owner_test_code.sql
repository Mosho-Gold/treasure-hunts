update public.starfall_access_codes
set active = false
where code_hash = '9859c8c6953be862c55bc4bb750d873cbd8c1dd2c042b34cdf3e39eebfc022a4';

insert into public.starfall_access_codes (
  code_hash,
  label,
  active,
  max_devices,
  expires_at
)
values (
  'cc2211ca13b09ffc9960df73764ceccafa700cfabfff1a712663edcca11e8ffe',
  'STARFALL owner test access code',
  true,
  3,
  null
)
on conflict (code_hash) do update
set active = true,
    label = excluded.label,
    max_devices = excluded.max_devices,
    expires_at = null;
