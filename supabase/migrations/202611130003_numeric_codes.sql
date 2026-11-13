update public.starfall_access_codes
set active = false
where label = 'Initial STARFALL test access code';

insert into public.starfall_access_codes (code_hash,label,active,max_devices)
values (
  '9859c8c6953be862c55bc4bb750d873cbd8c1dd2c042b34cdf3e39eebfc022a4',
  'STARFALL six digit test code',
  true,
  3
)
on conflict (code_hash) do update
set active = true,
    label = excluded.label,
    max_devices = excluded.max_devices;
