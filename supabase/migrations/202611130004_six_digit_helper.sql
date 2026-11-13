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
  normalized := regexp_replace(coalesce(raw_code,''), '[^0-9]', '', 'g');
  if normalized !~ '^[0-9]{6}$' then
    raise exception 'Access code must be exactly 6 digits';
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
