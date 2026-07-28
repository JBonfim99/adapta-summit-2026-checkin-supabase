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
