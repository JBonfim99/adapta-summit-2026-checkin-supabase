alter table public.compradores enable row level security;
alter table public.ingressos enable row level security;
alter table public.participantes enable row level security;
alter table public.tokens_acesso enable row level security;
alter table public.links_participante enable row level security;
alter table public.webhooks_log enable row level security;
alter table public.disparos enable row level security;
alter table public.envios enable row level security;
alter table public.pedidos_guru enable row level security;
alter table public.disparos_wa enable row level security;
alter table public.cortesias enable row level security;
alter table public.cron_health enable row level security;
alter table public.admin_profiles enable row level security;
alter table public.system_state enable row level security;
alter table public.integration_attempts enable row level security;
alter table public.ticket_operation_claims enable row level security;
alter table public.sync_events enable row level security;
alter table public.sync_tombstones enable row level security;

revoke all on all tables in schema public from public, anon, authenticated;
revoke all on all sequences in schema public from public, anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;

grant usage on schema public to anon, authenticated, service_role;
grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;

alter default privileges for role postgres in schema public
  revoke all on tables from public, anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on sequences from public, anon, authenticated;
alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated;
alter default privileges for role postgres in schema public
  grant all on tables to service_role;
alter default privileges for role postgres in schema public
  grant usage, select on sequences to service_role;
alter default privileges for role postgres in schema public
  grant execute on functions to service_role;

create policy admin_profiles_service_role
on public.admin_profiles
for all
to service_role
using (true)
with check (true);

create policy system_state_service_role
on public.system_state
for all
to service_role
using (true)
with check (true);

create policy compradores_service_role
on public.compradores
for all
to service_role
using (true)
with check (true);

create policy ingressos_service_role
on public.ingressos
for all
to service_role
using (true)
with check (true);

create policy participantes_service_role
on public.participantes
for all
to service_role
using (true)
with check (true);

create policy tokens_acesso_service_role
on public.tokens_acesso
for all
to service_role
using (true)
with check (true);

create policy links_participante_service_role
on public.links_participante
for all
to service_role
using (true)
with check (true);

create policy webhooks_log_service_role
on public.webhooks_log
for all
to service_role
using (true)
with check (true);

create policy disparos_service_role
on public.disparos
for all
to service_role
using (true)
with check (true);

create policy envios_service_role
on public.envios
for all
to service_role
using (true)
with check (true);

create policy pedidos_guru_service_role
on public.pedidos_guru
for all
to service_role
using (true)
with check (true);

create policy disparos_wa_service_role
on public.disparos_wa
for all
to service_role
using (true)
with check (true);

create policy cortesias_service_role
on public.cortesias
for all
to service_role
using (true)
with check (true);

create policy cron_health_service_role
on public.cron_health
for all
to service_role
using (true)
with check (true);

create policy integration_attempts_service_role
on public.integration_attempts
for all
to service_role
using (true)
with check (true);

create policy ticket_operation_claims_service_role
on public.ticket_operation_claims
for all
to service_role
using (true)
with check (true);

create policy sync_events_service_role
on public.sync_events
for all
to service_role
using (true)
with check (true);

create policy sync_tombstones_service_role
on public.sync_tombstones
for all
to service_role
using (true)
with check (true);
