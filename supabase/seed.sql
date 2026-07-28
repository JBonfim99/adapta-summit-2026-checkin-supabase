-- Local-only fixtures. Production data is loaded by scripts/import-pocketbase.mjs.
insert into public.system_state (singleton, mode)
values (true, 'standby')
on conflict (singleton) do update set mode = excluded.mode;
