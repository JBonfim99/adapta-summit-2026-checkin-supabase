alter table public.system_state
  add column external_effects_enabled boolean not null default false,
  add column last_sync_poll_at timestamptz,
  add column sync_outbox_backlog integer not null default 0
    check (sync_outbox_backlog >= 0),
  add column bootstrap_state text not null default 'not_started'
    check (bootstrap_state in ('not_started', 'collecting', 'ready', 'applying', 'completed', 'failed')),
  add column last_sync_error text,
  add column sync_lease_token text,
  add column sync_lease_until timestamptz;

update public.system_state
   set external_effects_enabled = false
 where singleton;

create table public.system_state_audit (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users (id) on delete set null,
  action text not null,
  previous_state jsonb not null,
  new_state jsonb not null,
  reason text not null default '',
  created_at timestamptz not null default now()
);

create index system_state_audit_created_at_idx
  on public.system_state_audit (created_at desc, id desc);

alter table public.system_state_audit enable row level security;
revoke all on public.system_state_audit from public, anon, authenticated;
revoke all on sequence public.system_state_audit_id_seq from public, anon, authenticated;
grant all on public.system_state_audit to service_role;
grant usage, select on sequence public.system_state_audit_id_seq to service_role;

create policy system_state_audit_service_role
on public.system_state_audit
for all
to service_role
using (true)
with check (true);

drop function if exists public.set_system_mode(text, uuid, boolean);

create function public.set_system_mode(
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
    select 1
      from public.admin_profiles ap
     where ap.user_id = p_user_id
       and ap.active
       and ap.role = 'admin'
  ) then
    raise exception using errcode = '42501', message = 'ADMIN_REQUIRED';
  end if;

  select * into previous_state
    from public.system_state
   where singleton
   for update;

  if p_mode = 'active' then
    if not p_pocketbase_writes_blocked then
      raise exception using errcode = 'P0001', message = 'POCKETBASE_WRITES_MUST_BE_BLOCKED';
    end if;
    if previous_state.bootstrap_state <> 'completed'
       or previous_state.sync_outbox_backlog <> 0
       or previous_state.last_sync_error is not null
       or previous_state.last_sync_poll_at is null
       or previous_state.last_sync_poll_at < now() - interval '90 seconds'
       or previous_state.last_reconciled_at is null
       or previous_state.last_reconciled_at < now() - interval '15 minutes'
       or exists (
         select 1
           from public.sync_events
          where state in ('received', 'failed')
       ) then
      raise exception using errcode = 'P0001', message = 'SYNC_NOT_READY_FOR_FAILOVER';
    end if;
  end if;

  update public.system_state
     set mode = p_mode,
         external_effects_enabled = false,
         activated_at = case when p_mode = 'active' then now() else activated_at end,
         activated_by = case when p_mode = 'active' then p_user_id else activated_by end,
         pocketbase_writes_blocked = p_pocketbase_writes_blocked
   where singleton
   returning * into state;

  insert into public.system_state_audit (
    user_id,
    action,
    previous_state,
    new_state,
    reason
  ) values (
    p_user_id,
    'mode_changed',
    to_jsonb(previous_state),
    to_jsonb(state),
    btrim(coalesce(p_reason, ''))
  );

  return to_jsonb(state);
end;
$$;

create function public.set_external_effects(
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
    select 1
      from public.admin_profiles ap
     where ap.user_id = p_user_id
       and ap.active
       and ap.role = 'admin'
  ) then
    raise exception using errcode = '42501', message = 'ADMIN_REQUIRED';
  end if;

  select * into previous_state
    from public.system_state
   where singleton
   for update;

  if p_enabled then
    if p_confirmation <> 'HABILITAR COMUNICACOES' then
      raise exception using errcode = 'P0001', message = 'EXTERNAL_EFFECTS_CONFIRMATION_REQUIRED';
    end if;
    if btrim(coalesce(p_reason, '')) = '' then
      raise exception using errcode = 'P0001', message = 'EXTERNAL_EFFECTS_REASON_REQUIRED';
    end if;
    if previous_state.mode <> 'active'
       or not previous_state.pocketbase_writes_blocked
       or previous_state.bootstrap_state <> 'completed'
       or previous_state.sync_outbox_backlog <> 0
       or previous_state.last_sync_error is not null
       or previous_state.last_sync_poll_at is null
       or previous_state.last_sync_poll_at < now() - interval '90 seconds'
       or previous_state.last_reconciled_at is null
       or previous_state.last_reconciled_at < now() - interval '15 minutes'
       or exists (
         select 1
           from public.sync_events
          where state in ('received', 'failed')
       ) then
      raise exception using errcode = 'P0001', message = 'EXTERNAL_EFFECTS_PRECONDITIONS_FAILED';
    end if;
  end if;

  update public.system_state
     set external_effects_enabled = p_enabled
   where singleton
   returning * into state;

  insert into public.system_state_audit (
    user_id,
    action,
    previous_state,
    new_state,
    reason
  ) values (
    p_user_id,
    case when p_enabled then 'external_effects_enabled' else 'external_effects_disabled' end,
    to_jsonb(previous_state),
    to_jsonb(state),
    btrim(coalesce(p_reason, ''))
  );

  return to_jsonb(state);
end;
$$;

create or replace function public.claim_email_dispatch_batch(p_limit integer default 1000)
returns setof public.envios
language plpgsql
security definer
set search_path = ''
as $$
declare
  claim_id text := encode(extensions.gen_random_bytes(16), 'hex');
begin
  if not exists (
    select 1
      from public.system_state
     where singleton
       and mode = 'active'
       and external_effects_enabled
  ) then
    return;
  end if;

  return query
  with candidates as (
    select e.id
      from public.envios e
     where e.status in ('na_fila', 'erro')
       and e.tentativas < 5
       and coalesce(e.proxima_tentativa_em, '-infinity'::timestamptz) <= now()
     order by e.created_at, e.id
     for update skip locked
     limit least(greatest(p_limit, 1), 1000)
  )
  update public.envios e
     set status = 'enviando',
         claim = claim_id,
         tentativas = e.tentativas + 1,
         erro = null
    from candidates c
   where e.id = c.id
  returning e.*;
end;
$$;

create or replace function public.claim_whatsapp_dispatch_batch(p_limit integer default 60)
returns table (
  buyer_id text,
  nome text,
  email text,
  telefone text,
  dispatch_id text,
  flow text,
  mapping jsonb,
  token text,
  attempt integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  claim_id text := encode(extensions.gen_random_bytes(16), 'hex');
begin
  if not exists (
    select 1
      from public.system_state
     where singleton
       and mode = 'active'
       and external_effects_enabled
  ) then
    return;
  end if;

  return query
  with candidates as (
    select c.id
      from public.compradores c
     where c.wa_status in ('na_fila', 'erro')
       and c.wa_tentativas < 5
     order by c.created_at, c.id
     for update skip locked
     limit least(greatest(p_limit, 1), 100)
  ),
  claimed as (
    update public.compradores c
       set wa_status = 'enviando',
           wa_claim = claim_id,
           wa_tentativas = c.wa_tentativas + 1,
           wa_erro = null
      from candidates x
     where c.id = x.id
    returning c.*
  )
  select
    c.id,
    c.nome,
    c.email,
    c.telefone,
    c.wa_disparo_id,
    d.flow,
    d.mapping,
    coalesce(t.token, ''),
    c.wa_tentativas
  from claimed c
  join public.disparos_wa d on d.id = c.wa_disparo_id
  left join lateral (
    select ta.token
      from public.tokens_acesso ta
     where ta.comprador_id = c.id
       and ta.usado = false
       and ta.expira_em > now()
     order by ta.created_at desc
     limit 1
  ) t on true;
end;
$$;

drop view public.sync_health;

create view public.sync_health
with (security_invoker = true)
as
select
  s.mode,
  s.external_effects_enabled,
  s.pocketbase_writes_blocked,
  s.last_sync_poll_at,
  s.last_sync_event_at,
  s.last_reconciled_at,
  s.sync_outbox_backlog,
  s.bootstrap_state,
  s.last_sync_error,
  extract(epoch from (now() - s.last_sync_poll_at))::integer as lag_seconds,
  count(*) filter (where e.state = 'failed') as failed_events,
  count(*) filter (where e.state = 'received') as pending_events,
  max(e.applied_at) as last_applied_at
from public.system_state s
left join public.sync_events e on true
where s.singleton
group by
  s.mode,
  s.external_effects_enabled,
  s.pocketbase_writes_blocked,
  s.last_sync_poll_at,
  s.last_sync_event_at,
  s.last_reconciled_at,
  s.sync_outbox_backlog,
  s.bootstrap_state,
  s.last_sync_error;

revoke all on public.sync_health from public, anon, authenticated;
grant select on public.sync_health to service_role;

revoke execute on function public.set_system_mode(text, uuid, boolean, text)
  from public, anon, authenticated;
revoke execute on function public.set_external_effects(boolean, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.set_system_mode(text, uuid, boolean, text)
  to service_role;
grant execute on function public.set_external_effects(boolean, uuid, text, text)
  to service_role;
