create extension if not exists pgcrypto with schema extensions;

create schema if not exists private;

revoke all on schema private from public, anon, authenticated;
grant usage on schema private to postgres, service_role;

create or replace function private.new_text_id()
returns text
language sql
volatile
set search_path = ''
as $$
  select replace(gen_random_uuid()::text, '-', '');
$$;

create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(current_setting('app.sync_apply', true), '') <> 'true' then
    new.updated_at = now();
  end if;
  return new;
end;
$$;

create or replace function private.normalize_cpf(value text)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select regexp_replace(value, '[^0-9]', '', 'g');
$$;
