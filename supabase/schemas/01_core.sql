create table public.compradores (
  id text primary key default private.new_text_id(),
  nome text not null check (length(btrim(nome)) > 0),
  email text not null check (position('@' in email) > 1),
  email_normalized text generated always as (lower(btrim(email))) stored,
  documento text not null default '',
  uf text not null default '',
  cidade text not null default '',
  telefone text not null default '',
  acesso_status text check (
    acesso_status is null
    or acesso_status in ('na_fila', 'enviando', 'enviado', 'erro')
  ),
  acesso_template_id text,
  acesso_enviado_em timestamptz,
  acesso_tentativas integer not null default 0 check (acesso_tentativas >= 0),
  acesso_erro text,
  acesso_disparo_id text,
  acesso_claim text,
  wa_status text check (
    wa_status is null
    or wa_status in ('na_fila', 'enviando', 'enviado', 'erro')
  ),
  wa_disparo_id text,
  wa_tentativas integer not null default 0 check (wa_tentativas >= 0),
  wa_erro text,
  wa_claim text,
  wa_enviado_em timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index compradores_email_unique
  on public.compradores (email_normalized);
create index compradores_documento_idx
  on public.compradores (private.normalize_cpf(documento))
  where documento <> '';
create index compradores_busca_nome_idx
  on public.compradores using gin (to_tsvector('simple', nome));
create index compradores_acesso_fila_idx
  on public.compradores (created_at, id)
  where acesso_status in ('na_fila', 'erro');

create table public.ingressos (
  id text primary key default private.new_text_id(),
  comprador_id text not null
    references public.compradores (id) on update cascade on delete restrict,
  pedido_id text not null,
  status text not null default 'Pendente'
    check (status in ('Pendente', 'Pré-Credenciado')),
  participante_id text,
  preenchido_em timestamptz,
  tipo_ingresso text not null default 'GOLD'
    check (tipo_ingresso in ('GOLD', 'PLATINUM', 'PALESTRANTES', 'HACKATHON')),
  status_webhook text not null default 'pendente'
    check (status_webhook in ('pendente', 'enviado', 'erro')),
  inac_id text,
  inac_qr text,
  origem text not null default 'pocketbase',
  cortesia_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ingressos_pedido_unique unique (pedido_id),
  constraint ingressos_participante_unique unique (participante_id),
  constraint ingressos_participante_status_check check (
    (status = 'Pendente' and participante_id is null)
    or (status = 'Pré-Credenciado' and participante_id is not null)
  )
);

create index ingressos_comprador_id_idx on public.ingressos (comprador_id);
create index ingressos_participante_id_idx
  on public.ingressos (participante_id)
  where participante_id is not null;
create index ingressos_pendentes_idx
  on public.ingressos (comprador_id, created_at, id)
  where status = 'Pendente';
create index ingressos_webhook_fila_idx
  on public.ingressos (updated_at, id)
  where status_webhook in ('pendente', 'erro');

create table public.participantes (
  id text primary key default private.new_text_id(),
  ingresso_id text not null
    references public.ingressos (id) on update cascade on delete restrict,
  nome_completo text not null check (length(btrim(nome_completo)) > 0),
  email text not null check (position('@' in email) > 1),
  email_normalized text generated always as (lower(btrim(email))) stored,
  cpf text not null,
  cpf_normalized text generated always as (private.normalize_cpf(cpf)) stored,
  telefone text not null,
  nome_empresa text not null default '',
  cargo text not null default '',
  nicho text not null default '',
  num_funcionarios text not null default '',
  faturamento_anual text not null default '',
  areas_ajuda jsonb not null default '[]'::jsonb
    check (jsonb_typeof(areas_ajuda) = 'array'),
  expectativa_aprendizado text not null default '',
  expectativa_experiencia text not null default '',
  acesso_status text check (
    acesso_status is null
    or acesso_status in ('na_fila', 'enviando', 'enviado', 'erro')
  ),
  acesso_disparo_id text,
  acesso_template_id text,
  acesso_enviado_em timestamptz,
  acesso_tentativas integer not null default 0 check (acesso_tentativas >= 0),
  acesso_erro text,
  acesso_claim text,
  ia_uso_diario integer,
  ia_profundidade integer,
  ia_ferramentas text not null default '',
  ia_desafio text not null default '',
  tem_empresa boolean,
  profissao text not null default '',
  terms_accepted_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint participantes_ingresso_unique unique (ingresso_id),
  constraint participantes_cpf_length check (length(cpf_normalized) = 11)
);

create unique index participantes_email_unique
  on public.participantes (email_normalized);
create unique index participantes_cpf_unique
  on public.participantes (cpf_normalized);
create index participantes_busca_nome_idx
  on public.participantes using gin (to_tsvector('simple', nome_completo));
create index participantes_acesso_fila_idx
  on public.participantes (created_at, id)
  where acesso_status in ('na_fila', 'erro');

alter table public.ingressos
  add constraint ingressos_participante_id_fkey
  foreign key (participante_id)
  references public.participantes (id)
  on update cascade
  on delete restrict
  deferrable initially deferred;

create table public.tokens_acesso (
  id text primary key default private.new_text_id(),
  comprador_id text not null
    references public.compradores (id) on update cascade on delete cascade,
  token text not null,
  usado boolean not null default false,
  expira_em timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tokens_acesso_token_unique unique (token)
);

create index tokens_acesso_comprador_id_idx on public.tokens_acesso (comprador_id);
create index tokens_acesso_validos_idx
  on public.tokens_acesso (token, expira_em)
  where usado = false;

create table public.links_participante (
  id text primary key default private.new_text_id(),
  ingresso_id text not null
    references public.ingressos (id) on update cascade on delete cascade,
  token text not null,
  usado boolean not null default false,
  expira_em timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint links_participante_token_unique unique (token)
);

create index links_participante_ingresso_id_idx on public.links_participante (ingresso_id);
create index links_participante_validos_idx
  on public.links_participante (token, expira_em)
  where usado = false;

create table public.webhooks_log (
  id text primary key default private.new_text_id(),
  ingresso_id text
    references public.ingressos (id) on update cascade on delete set null,
  status integer,
  method text,
  response text,
  evento text,
  detalhe text,
  payload text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index webhooks_log_ingresso_id_idx on public.webhooks_log (ingresso_id);
create index webhooks_log_created_at_idx on public.webhooks_log (created_at desc, id desc);
create index webhooks_log_evento_idx on public.webhooks_log (evento, created_at desc);

create table public.disparos (
  id text primary key default private.new_text_id(),
  template_id text not null,
  template_nome text not null default '',
  cluster text not null
    check (cluster in (
      'todos',
      'pendentes',
      'participantes_todos',
      'participantes_recentes',
      'individual'
    )),
  nome text not null default '',
  audience text not null default 'compradores'
    check (audience in ('compradores', 'participantes')),
  total integer not null default 0 check (total >= 0),
  enviados integer not null default 0 check (enviados >= 0),
  erros integer not null default 0 check (erros >= 0),
  status text not null default 'em_andamento'
    check (status in ('em_andamento', 'concluido', 'erro')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index disparos_created_at_idx on public.disparos (created_at desc, id desc);
create index disparos_status_idx
  on public.disparos (created_at, id)
  where status = 'em_andamento';

create table public.envios (
  id text primary key default private.new_text_id(),
  disparo_id text not null
    references public.disparos (id) on update cascade on delete cascade,
  comprador_id text
    references public.compradores (id) on update cascade on delete set null,
  participante_id text
    references public.participantes (id) on update cascade on delete set null,
  nome text not null default '',
  email text not null,
  status text not null default 'na_fila'
    check (status in ('na_fila', 'enviando', 'enviado', 'erro')),
  tentativas integer not null default 0 check (tentativas >= 0),
  erro text,
  claim text,
  proxima_tentativa_em timestamptz,
  enviado_em timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index envios_disparo_idx on public.envios (disparo_id, created_at, id);
create index envios_comprador_id_idx on public.envios (comprador_id);
create index envios_participante_id_idx on public.envios (participante_id);
create index envios_fila_idx
  on public.envios (coalesce(proxima_tentativa_em, created_at), id)
  where status in ('na_fila', 'erro');

create table public.pedidos_guru (
  id text primary key default private.new_text_id(),
  transacao_id text not null unique,
  status text not null,
  email text not null default '',
  comprador_id text
    references public.compradores (id) on update cascade on delete set null,
  ingressos integer not null default 0 check (ingressos >= 0),
  email_status text not null default '',
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index pedidos_guru_email_idx on public.pedidos_guru (lower(email));
create index pedidos_guru_created_at_idx on public.pedidos_guru (created_at desc, id desc);
create index pedidos_guru_comprador_id_idx on public.pedidos_guru (comprador_id);

create table public.disparos_wa (
  id text primary key default private.new_text_id(),
  nome text not null default '',
  cluster text not null check (cluster in ('todos', 'pendentes', 'individual')),
  total integer not null default 0 check (total >= 0),
  enviados integer not null default 0 check (enviados >= 0),
  erros integer not null default 0 check (erros >= 0),
  status text not null default 'em_andamento'
    check (status in ('em_andamento', 'concluido', 'erro')),
  flow text not null default '',
  flow_nome text not null default '',
  mapping jsonb not null default '[]'::jsonb
    check (jsonb_typeof(mapping) = 'array'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index disparos_wa_created_at_idx on public.disparos_wa (created_at desc, id desc);
create index disparos_wa_status_idx
  on public.disparos_wa (created_at, id)
  where status = 'em_andamento';

create table public.cortesias (
  id text primary key default private.new_text_id(),
  anfitriao text not null check (length(btrim(anfitriao)) >= 2),
  token text not null unique,
  tipo_ingresso text not null default 'GOLD'
    check (tipo_ingresso in ('GOLD', 'PLATINUM', 'PALESTRANTES', 'HACKATHON')),
  limite integer not null default 0 check (limite >= 0),
  usados integer not null default 0 check (usados >= 0 and (limite = 0 or usados <= limite)),
  ativo boolean not null default true,
  comprador_id text
    references public.compradores (id) on update cascade on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index cortesias_created_at_idx on public.cortesias (created_at desc, id desc);
create index cortesias_ativas_idx on public.cortesias (token) where ativo = true;
create index cortesias_comprador_id_idx on public.cortesias (comprador_id);

create table public.cron_health (
  id text primary key default 'dispatch',
  last_run timestamptz not null default now(),
  email_last_run timestamptz,
  whatsapp_last_run timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.cron_health (id) values ('dispatch')
on conflict (id) do nothing;

create table public.admin_profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null,
  role text not null default 'operator'
    check (role in ('admin', 'operator', 'viewer')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.system_state (
  singleton boolean primary key default true check (singleton),
  mode text not null default 'standby'
    check (mode in ('standby', 'active', 'maintenance')),
  activated_at timestamptz,
  activated_by uuid references auth.users (id) on delete set null,
  last_sync_event_at timestamptz,
  last_reconciled_at timestamptz,
  pocketbase_writes_blocked boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

insert into public.system_state (singleton) values (true)
on conflict (singleton) do nothing;

create index system_state_activated_by_idx on public.system_state (activated_by);

create table public.integration_attempts (
  id bigint generated always as identity primary key,
  ingresso_id text
    references public.ingressos (id) on update cascade on delete set null,
  participant_id text
    references public.participantes (id) on update cascade on delete set null,
    provider text not null check (provider in ('inac', 'sendgrid', 'botconversa')),
  operation text not null,
  idempotency_key text not null,
  attempt integer not null default 1 check (attempt > 0),
  request_payload jsonb not null default '{}'::jsonb,
  response_status integer,
  response_payload jsonb,
  success boolean not null default false,
  error text,
  duration_ms integer check (duration_ms is null or duration_ms >= 0),
  created_at timestamptz not null default now(),
  constraint integration_attempts_idempotency_unique
    unique (provider, idempotency_key, attempt)
);

create index integration_attempts_ingresso_idx
  on public.integration_attempts (ingresso_id, created_at desc);
create index integration_attempts_participant_idx
  on public.integration_attempts (participant_id);
create index integration_attempts_failed_idx
  on public.integration_attempts (provider, created_at, id)
  where success = false;

create table public.ticket_operation_claims (
  id uuid primary key default gen_random_uuid(),
  ingresso_id text not null
    references public.ingressos (id) on update cascade on delete cascade,
  operation text not null check (operation in ('edit', 'change_type', 'delete')),
  actor text not null,
  expected_updated_at timestamptz not null,
  payload jsonb not null default '{}'::jsonb,
  state text not null default 'claimed'
    check (state in ('claimed', 'completed', 'failed', 'expired')),
  expires_at timestamptz not null default (now() + interval '2 minutes'),
  result jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create unique index ticket_operation_claims_active_idx
  on public.ticket_operation_claims (ingresso_id)
  where state = 'claimed';
create index ticket_operation_claims_expiry_idx
  on public.ticket_operation_claims (expires_at)
  where state = 'claimed';

create table public.sync_events (
  event_id text primary key,
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
  operation text not null check (operation in ('create', 'update', 'delete')),
  payload jsonb not null default '{}'::jsonb,
  source_updated_at timestamptz not null,
  received_at timestamptz not null default now(),
  applied_at timestamptz,
  state text not null default 'received'
    check (state in ('received', 'applied', 'ignored', 'failed')),
  error text
);

create index sync_events_pending_idx
  on public.sync_events (received_at, event_id)
  where state in ('received', 'failed');
create index sync_events_lag_idx
  on public.sync_events (source_updated_at desc, event_id);
create index sync_events_record_idx
  on public.sync_events (source_table, record_id, source_updated_at desc);

create table public.sync_tombstones (
  source_table text not null,
  record_id text not null,
  source_updated_at timestamptz not null,
  event_id text not null references public.sync_events (event_id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (source_table, record_id)
);

create index sync_tombstones_event_id_idx
  on public.sync_tombstones (event_id);

create trigger compradores_set_updated_at
before update on public.compradores
for each row execute function private.set_updated_at();

create trigger ingressos_set_updated_at
before update on public.ingressos
for each row execute function private.set_updated_at();

create trigger participantes_set_updated_at
before update on public.participantes
for each row execute function private.set_updated_at();

create trigger tokens_acesso_set_updated_at
before update on public.tokens_acesso
for each row execute function private.set_updated_at();

create trigger links_participante_set_updated_at
before update on public.links_participante
for each row execute function private.set_updated_at();

create trigger webhooks_log_set_updated_at
before update on public.webhooks_log
for each row execute function private.set_updated_at();

create trigger disparos_set_updated_at
before update on public.disparos
for each row execute function private.set_updated_at();

create trigger envios_set_updated_at
before update on public.envios
for each row execute function private.set_updated_at();

create trigger pedidos_guru_set_updated_at
before update on public.pedidos_guru
for each row execute function private.set_updated_at();

create trigger disparos_wa_set_updated_at
before update on public.disparos_wa
for each row execute function private.set_updated_at();

create trigger cortesias_set_updated_at
before update on public.cortesias
for each row execute function private.set_updated_at();

create trigger cron_health_set_updated_at
before update on public.cron_health
for each row execute function private.set_updated_at();

create trigger admin_profiles_set_updated_at
before update on public.admin_profiles
for each row execute function private.set_updated_at();

create trigger system_state_set_updated_at
before update on public.system_state
for each row execute function private.set_updated_at();
