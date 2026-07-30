create extension if not exists pg_cron with schema pg_catalog;

create or replace function private.expire_ticket_operation_claims()
returns void
language sql
security definer
set search_path = ''
as $$
  update public.ticket_operation_claims
     set state = 'expired',
         completed_at = now()
   where state = 'claimed'
     and expires_at <= now();
$$;

do $$
declare
  existing_job_id bigint;
begin
  select jobid
    into existing_job_id
    from cron.job
   where jobname = 'expire-ticket-operation-claims';

  if existing_job_id is not null then
    perform cron.unschedule(existing_job_id);
  end if;

  perform cron.schedule(
    'expire-ticket-operation-claims',
    '* * * * *',
    'select private.expire_ticket_operation_claims()'
  );
end
$$;

create or replace function private.invoke_sync_pull()
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

create or replace function private.invoke_dispatch_worker()
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
    url := rtrim(project_url, '/') || '/functions/v1/dispatch-worker',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', publishable_key,
      'X-Worker-Key', worker_secret
    ),
    body := '{"email_limit":1000,"whatsapp_workers":5,"whatsapp_limit":60}'::jsonb,
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
   where jobname = 'invoke-dispatch-worker';

  if existing_job_id is not null then
    perform cron.unschedule(existing_job_id);
  end if;

  perform cron.schedule(
    'invoke-dispatch-worker',
    '* * * * *',
    'select private.invoke_dispatch_worker()'
  );
end
$$;
