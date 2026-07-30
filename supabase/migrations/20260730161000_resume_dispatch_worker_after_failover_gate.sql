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
