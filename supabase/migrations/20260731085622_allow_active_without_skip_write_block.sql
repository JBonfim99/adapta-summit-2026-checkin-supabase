-- The fallback must never command the primary Skip application to change its
-- write mode. `p_pocketbase_writes_blocked` remains in the RPC signature for
-- backwards compatibility, but is deliberately ignored.
create or replace function public.set_system_mode(
  p_mode text,
  p_user_id uuid,
  p_pocketbase_writes_blocked boolean default false,
  p_reason text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  state public.system_state;
  previous_state public.system_state;
begin
  if p_mode not in ('standby', 'active', 'maintenance') then
    raise exception using errcode = 'P0001', message = 'INVALID_SYSTEM_MODE';
  end if;
  if not exists (
    select 1 from public.admin_profiles ap
     where ap.user_id = p_user_id and ap.active and ap.role = 'admin'
  ) then
    raise exception using errcode = '42501', message = 'ADMIN_REQUIRED';
  end if;

  select * into previous_state from public.system_state where singleton for update;

  if p_mode = 'active' and (
    previous_state.bootstrap_state <> 'completed'
    or previous_state.sync_outbox_backlog <> 0
    or previous_state.last_sync_error is not null
    or previous_state.last_sync_poll_at is null
    or previous_state.last_sync_poll_at < now() - interval '90 seconds'
    or previous_state.last_reconciled_at is null
    or previous_state.last_reconciled_at < now() - interval '15 minutes'
    or exists (select 1 from public.sync_events sync_event where sync_event.state in ('received', 'failed'))
  ) then
    raise exception using errcode = 'P0001', message = 'SYNC_NOT_READY_FOR_FAILOVER';
  end if;

  update public.system_state
     set mode = p_mode,
         external_effects_enabled = false,
         activated_at = case when p_mode = 'active' then now() else activated_at end,
         activated_by = case when p_mode = 'active' then p_user_id else activated_by end,
         pocketbase_writes_blocked = false
   where singleton
   returning * into state;

  insert into public.system_state_audit (user_id, action, previous_state, new_state, reason)
  values (p_user_id, 'mode_changed', to_jsonb(previous_state), to_jsonb(state), btrim(coalesce(p_reason, '')));
  return to_jsonb(state);
end;
$$;

create or replace function public.set_external_effects(
  p_enabled boolean,
  p_user_id uuid,
  p_confirmation text default '',
  p_reason text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  state public.system_state;
  previous_state public.system_state;
begin
  if not exists (
    select 1 from public.admin_profiles ap
     where ap.user_id = p_user_id and ap.active and ap.role = 'admin'
  ) then
    raise exception using errcode = '42501', message = 'ADMIN_REQUIRED';
  end if;

  select * into previous_state from public.system_state where singleton for update;

  if p_enabled then
    if p_confirmation <> 'HABILITAR COMUNICACOES' then
      raise exception using errcode = 'P0001', message = 'EXTERNAL_EFFECTS_CONFIRMATION_REQUIRED';
    end if;
    if btrim(coalesce(p_reason, '')) = '' then
      raise exception using errcode = 'P0001', message = 'EXTERNAL_EFFECTS_REASON_REQUIRED';
    end if;
    if previous_state.mode <> 'active'
       or previous_state.bootstrap_state <> 'completed'
       or previous_state.sync_outbox_backlog <> 0
       or previous_state.last_sync_error is not null
       or previous_state.last_sync_poll_at is null
       or previous_state.last_sync_poll_at < now() - interval '90 seconds'
       or previous_state.last_reconciled_at is null
       or previous_state.last_reconciled_at < now() - interval '15 minutes'
       or exists (select 1 from public.sync_events sync_event where sync_event.state in ('received', 'failed')) then
      raise exception using errcode = 'P0001', message = 'EXTERNAL_EFFECTS_PRECONDITIONS_FAILED';
    end if;
  end if;

  update public.system_state set external_effects_enabled = p_enabled where singleton returning * into state;
  insert into public.system_state_audit (user_id, action, previous_state, new_state, reason)
  values (
    p_user_id,
    case when p_enabled then 'external_effects_enabled' else 'external_effects_disabled' end,
    to_jsonb(previous_state), to_jsonb(state), btrim(coalesce(p_reason, ''))
  );
  return to_jsonb(state);
end;
$$;

update public.system_state
   set pocketbase_writes_blocked = false
 where singleton;
