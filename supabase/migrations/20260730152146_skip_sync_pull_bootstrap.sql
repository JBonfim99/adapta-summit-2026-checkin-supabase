create table public.sync_bootstrap_runs (
  id uuid primary key default gen_random_uuid(),
  state text not null default 'collecting'
    check (state in ('collecting', 'ready', 'applying', 'completed', 'failed')),
  source_cursor jsonb not null default '{}'::jsonb,
  counts jsonb not null default '{}'::jsonb,
  current_collection text,
  next_cursor text,
  preview_completed_at timestamptz,
  applied_at timestamptz,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index sync_bootstrap_runs_active_idx
  on public.sync_bootstrap_runs ((true))
  where state in ('collecting', 'ready', 'applying');
create index sync_bootstrap_runs_created_at_idx
  on public.sync_bootstrap_runs (created_at desc, id);

create table public.sync_bootstrap_rows (
  run_id uuid not null
    references public.sync_bootstrap_runs (id) on delete cascade,
  source_table text not null check (
    source_table in (
      'compradores',
      'ingressos',
      'participantes',
      'tokens_acesso',
      'links_participante',
      'webhooks_log',
      'disparos',
      'envios',
      'pedidos_guru',
      'disparos_wa',
      'cortesias'
    )
  ),
  record_id text not null,
  payload jsonb not null,
  source_updated_at timestamptz not null,
  created_at timestamptz not null default now(),
  primary key (run_id, source_table, record_id)
);

create index sync_bootstrap_rows_table_idx
  on public.sync_bootstrap_rows (run_id, source_table, record_id);

create trigger sync_bootstrap_runs_set_updated_at
before update on public.sync_bootstrap_runs
for each row execute function private.set_updated_at();

alter table public.sync_bootstrap_runs enable row level security;
alter table public.sync_bootstrap_rows enable row level security;
revoke all on public.sync_bootstrap_runs from public, anon, authenticated;
revoke all on public.sync_bootstrap_rows from public, anon, authenticated;
grant all on public.sync_bootstrap_runs to service_role;
grant all on public.sync_bootstrap_rows to service_role;

create policy sync_bootstrap_runs_service_role
on public.sync_bootstrap_runs
for all
to service_role
using (true)
with check (true);

create policy sync_bootstrap_rows_service_role
on public.sync_bootstrap_rows
for all
to service_role
using (true)
with check (true);

create function public.claim_sync_lease(
  p_token text,
  p_ttl_seconds integer default 25
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  affected_rows integer := 0;
begin
  if btrim(coalesce(p_token, '')) = '' then
    return false;
  end if;

  update public.system_state
     set sync_lease_token = p_token,
         sync_lease_until = now() + make_interval(
           secs => least(greatest(coalesce(p_ttl_seconds, 25), 5), 55)
         )
   where singleton
     and (
       sync_lease_until is null
       or sync_lease_until <= now()
       or sync_lease_token = p_token
     );
  get diagnostics affected_rows = row_count;
  return affected_rows > 0;
end;
$$;

create function public.release_sync_lease(p_token text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.system_state
     set sync_lease_token = null,
         sync_lease_until = null
   where singleton
     and sync_lease_token = p_token;
$$;

create function public.record_sync_poll(
  p_backlog integer,
  p_error text default null
)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.system_state
     set last_sync_poll_at = case when p_error is null then now() else last_sync_poll_at end,
         last_reconciled_at = case
           when p_error is null and greatest(coalesce(p_backlog, 0), 0) = 0 then now()
           else last_reconciled_at
         end,
         sync_outbox_backlog = greatest(coalesce(p_backlog, 0), 0),
         last_sync_error = nullif(left(coalesce(p_error, ''), 2000), '')
   where singleton;
$$;

create function public.finalize_sync_bootstrap(p_run_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  bootstrap public.sync_bootstrap_runs;
  staged public.sync_bootstrap_rows;
  table_name text;
  expected_count integer;
  actual_count integer;
  applied_count integer := 0;
  collection_names constant text[] := array[
    'compradores',
    'ingressos',
    'participantes',
    'tokens_acesso',
    'links_participante',
    'webhooks_log',
    'disparos',
    'envios',
    'pedidos_guru',
    'disparos_wa',
    'cortesias'
  ];
  pre_ticket_order constant text[] := array[
    'compradores',
    'disparos',
    'disparos_wa',
    'cortesias'
  ];
  post_ticket_order constant text[] := array[
    'participantes',
    'tokens_acesso',
    'links_participante',
    'envios',
    'pedidos_guru',
    'webhooks_log'
  ];
begin
  select * into bootstrap
    from public.sync_bootstrap_runs
   where id = p_run_id
   for update;

  if bootstrap.id is null then
    raise exception using errcode = 'P0001', message = 'BOOTSTRAP_RUN_NOT_FOUND';
  end if;
  if bootstrap.state <> 'ready' then
    raise exception using errcode = 'P0001', message = 'BOOTSTRAP_NOT_READY';
  end if;
  if (select mode from public.system_state where singleton) <> 'standby'
     or (select pocketbase_writes_blocked from public.system_state where singleton) then
    raise exception using errcode = 'P0001', message = 'SYNC_DISABLED';
  end if;

  foreach table_name in array collection_names
  loop
    expected_count := coalesce((bootstrap.counts->>table_name)::integer, 0);
    select count(*) into actual_count
      from public.sync_bootstrap_rows r
     where r.run_id = p_run_id
       and r.source_table = table_name;
    if actual_count <> expected_count then
      raise exception using
        errcode = 'P0001',
        message = format(
          'BOOTSTRAP_COUNT_MISMATCH:%s:%s:%s',
          table_name,
          expected_count,
          actual_count
        );
    end if;
  end loop;

  update public.sync_bootstrap_runs
     set state = 'applying',
         error = null
   where id = p_run_id;
  update public.system_state
     set bootstrap_state = 'applying',
         external_effects_enabled = false,
         last_sync_error = null
   where singleton;

  set constraints all deferred;
  perform set_config('app.sync_apply', 'true', true);

  delete from public.envios;
  delete from public.links_participante;
  delete from public.tokens_acesso;
  delete from public.webhooks_log;
  delete from public.pedidos_guru;
  delete from public.cortesias;
  delete from public.participantes;
  delete from public.ingressos;
  delete from public.compradores;
  delete from public.disparos;
  delete from public.disparos_wa;
  delete from public.sync_tombstones
   where source_table = any(collection_names);

  foreach table_name in array pre_ticket_order
  loop
    for staged in
      select *
        from public.sync_bootstrap_rows
       where run_id = p_run_id
         and source_table = table_name
       order by record_id
    loop
      perform public.apply_sync_event(
        jsonb_build_object(
          'event_id', format('bootstrap:%s:final:%s:%s', p_run_id, table_name, staged.record_id),
          'table', staged.source_table,
          'record_id', staged.record_id,
          'operation', 'update',
          'source_updated_at', staged.source_updated_at,
          'payload', staged.payload
        )
      );
      applied_count := applied_count + 1;
    end loop;
  end loop;

  for staged in
    select *
      from public.sync_bootstrap_rows
     where run_id = p_run_id
       and source_table = 'ingressos'
     order by record_id
  loop
    perform public.apply_sync_event(
      jsonb_build_object(
        'event_id', format('bootstrap:%s:ticket-stage:%s', p_run_id, staged.record_id),
        'table', staged.source_table,
        'record_id', staged.record_id,
        'operation', 'update',
        'source_updated_at', staged.source_updated_at,
        'payload', staged.payload || jsonb_build_object(
          'status', 'Pendente',
          'participante_id', '',
          'preenchido_em', ''
        )
      )
    );
    applied_count := applied_count + 1;
  end loop;

  foreach table_name in array post_ticket_order
  loop
    for staged in
      select *
        from public.sync_bootstrap_rows
       where run_id = p_run_id
         and source_table = table_name
       order by record_id
    loop
      perform public.apply_sync_event(
        jsonb_build_object(
          'event_id', format('bootstrap:%s:final:%s:%s', p_run_id, table_name, staged.record_id),
          'table', staged.source_table,
          'record_id', staged.record_id,
          'operation', 'update',
          'source_updated_at', staged.source_updated_at,
          'payload', staged.payload
        )
      );
      applied_count := applied_count + 1;
    end loop;
  end loop;

  for staged in
    select *
      from public.sync_bootstrap_rows
     where run_id = p_run_id
       and source_table = 'ingressos'
     order by record_id
  loop
    perform public.apply_sync_event(
      jsonb_build_object(
        'event_id', format('bootstrap:%s:ticket-final:%s', p_run_id, staged.record_id),
        'table', staged.source_table,
        'record_id', staged.record_id,
        'operation', 'update',
        'source_updated_at', staged.source_updated_at,
        'payload', staged.payload
      )
    );
    applied_count := applied_count + 1;
  end loop;

  update public.sync_bootstrap_runs
     set state = 'completed',
         applied_at = now(),
         error = null
   where id = p_run_id;
  update public.system_state
     set bootstrap_state = 'completed',
         last_reconciled_at = now(),
         last_sync_error = null,
         metadata = jsonb_set(metadata, '{bootstrap_counts}', bootstrap.counts, true)
   where singleton;

  return jsonb_build_object(
    'run_id', p_run_id,
    'state', 'completed',
    'counts', bootstrap.counts,
    'applied_events', applied_count
  );
exception
  when others then
    update public.sync_bootstrap_runs
       set state = 'failed',
           error = left(sqlerrm, 2000)
     where id = p_run_id;
    update public.system_state
       set bootstrap_state = 'failed',
           last_sync_error = left(sqlerrm, 2000),
           external_effects_enabled = false
     where singleton;
    return jsonb_build_object(
      'run_id', p_run_id,
      'state', 'failed',
      'error', sqlerrm
    );
end;
$$;

create function private.invoke_sync_pull()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  project_url text;
  publishable_key text;
  worker_secret text;
begin
  select decrypted_secret into project_url
    from vault.decrypted_secrets
   where name = 'project_url'
   limit 1;
  select decrypted_secret into publishable_key
    from vault.decrypted_secrets
   where name = 'publishable_key'
   limit 1;
  select decrypted_secret into worker_secret
    from vault.decrypted_secrets
   where name = 'dispatch_worker_secret'
   limit 1;

  if project_url is null or publishable_key is null or worker_secret is null then
    return;
  end if;

  perform net.http_post(
    url := rtrim(project_url, '/') || '/functions/v1/sync-pull',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', publishable_key,
      'X-Worker-Key', worker_secret
    ),
    body := '{"action":"poll"}'::jsonb,
    timeout_milliseconds := 25000
  );
end;
$$;

do $$
declare
  existing_job_id bigint;
begin
  select jobid
    into existing_job_id
    from cron.job
   where jobname = 'invoke-sync-pull';

  if existing_job_id is not null then
    perform cron.unschedule(existing_job_id);
  end if;

  perform cron.schedule(
    'invoke-sync-pull',
    '30 seconds',
    'select private.invoke_sync_pull()'
  );
end
$$;

revoke execute on function public.claim_sync_lease(text, integer)
  from public, anon, authenticated;
revoke execute on function public.release_sync_lease(text)
  from public, anon, authenticated;
revoke execute on function public.record_sync_poll(integer, text)
  from public, anon, authenticated;
revoke execute on function public.finalize_sync_bootstrap(uuid)
  from public, anon, authenticated;
grant execute on function public.claim_sync_lease(text, integer)
  to service_role;
grant execute on function public.release_sync_lease(text)
  to service_role;
grant execute on function public.record_sync_poll(integer, text)
  to service_role;
grant execute on function public.finalize_sync_bootstrap(uuid)
  to service_role;
