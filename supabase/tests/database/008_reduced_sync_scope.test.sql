begin;

set search_path = public, extensions;
select no_plan();

update public.system_state
   set mode = 'standby',
       external_effects_enabled = false,
       pocketbase_writes_blocked = false,
       bootstrap_state = 'not_started'
 where singleton;

insert into public.compradores (
  id,
  nome,
  email
) values (
  'buyer_reduced_sync',
  'Buyer Before Bootstrap',
  'buyer.reduced.sync@example.com'
);

insert into public.ingressos (
  id,
  comprador_id,
  pedido_id,
  tipo_ingresso
) values (
  'ticket_reduced_sync',
  'buyer_reduced_sync',
  'REDUCED-001',
  'GOLD'
);

insert into public.participantes (
  id,
  ingresso_id,
  nome_completo,
  email,
  cpf,
  telefone,
  terms_accepted_at
) values (
  'participant_reduced_sync',
  'ticket_reduced_sync',
  'Participant Before Bootstrap',
  'participant.reduced.sync@example.com',
  '52998224725',
  '11900000000',
  '2029-01-01T00:00:00Z'
);

update public.ingressos
   set status = 'Pré-Credenciado',
       participante_id = 'participant_reduced_sync',
       preenchido_em = '2029-01-01T00:00:00Z'
 where id = 'ticket_reduced_sync';

insert into public.tokens_acesso (
  id,
  comprador_id,
  token,
  usado,
  expira_em
) values (
  'token_reduced_sync',
  'buyer_reduced_sync',
  'token-reduced-sync',
  false,
  '2031-01-01T00:00:00Z'
);

insert into public.links_participante (
  id,
  ingresso_id,
  token,
  usado,
  expira_em
) values (
  'link_reduced_sync',
  'ticket_reduced_sync',
  'link-reduced-sync',
  false,
  '2031-01-01T00:00:00Z'
);

insert into public.webhooks_log (
  id,
  ingresso_id,
  status,
  method,
  evento,
  detalhe
) values (
  'webhook_reduced_sync',
  'ticket_reduced_sync',
  200,
  'POST',
  'sentinel',
  'must survive bootstrap'
);

insert into public.disparos (
  id,
  template_id,
  template_nome,
  cluster,
  nome,
  audience,
  total,
  status
) values (
  'dispatch_reduced_sync',
  'template-reduced-sync',
  'Template Reduced Sync',
  'individual',
  'Dispatch Reduced Sync',
  'compradores',
  1,
  'em_andamento'
);

insert into public.envios (
  id,
  disparo_id,
  comprador_id,
  participante_id,
  nome,
  email,
  status
) values (
  'delivery_reduced_sync',
  'dispatch_reduced_sync',
  'buyer_reduced_sync',
  'participant_reduced_sync',
  'Delivery Reduced Sync',
  'delivery.reduced.sync@example.com',
  'na_fila'
);

insert into public.pedidos_guru (
  id,
  transacao_id,
  status,
  email,
  comprador_id,
  ingressos,
  email_status
) values (
  'guru_reduced_sync',
  'transaction-reduced-sync',
  'approved',
  'guru.reduced.sync@example.com',
  'buyer_reduced_sync',
  1,
  'sent'
);

insert into public.disparos_wa (
  id,
  nome,
  cluster,
  total,
  status,
  flow,
  mapping
) values (
  'wa_reduced_sync',
  'WhatsApp Reduced Sync',
  'individual',
  1,
  'em_andamento',
  'flow-reduced-sync',
  '[]'::jsonb
);

insert into public.cortesias (
  id,
  anfitriao,
  token,
  tipo_ingresso,
  limite,
  usados,
  ativo,
  comprador_id
) values (
  'courtesy_reduced_sync',
  'Host Reduced Sync',
  'courtesy-reduced-sync',
  'PLATINUM',
  1,
  1,
  true,
  'buyer_reduced_sync'
);

create temporary table reduced_sync_run (id uuid not null);

with created_run as (
  insert into public.sync_bootstrap_runs (
    state,
    source_cursor,
    counts,
    preview_completed_at
  ) values (
    'ready',
    '{"created":"2029-12-31T23:59:59Z","id":"cursor-reduced-sync"}'::jsonb,
    '{"compradores":1,"ingressos":1,"participantes":1}'::jsonb,
    now()
  )
  returning id
)
insert into reduced_sync_run (id)
select id from created_run;

insert into public.sync_bootstrap_rows (
  run_id,
  source_table,
  record_id,
  payload,
  source_updated_at
)
select
  id,
  'compradores',
  'buyer_reduced_sync',
  '{
    "id": "buyer_reduced_sync",
    "nome": "Buyer After Bootstrap",
    "email": "buyer.reduced.sync@example.com",
    "documento": "12345678901",
    "uf": "SP",
    "cidade": "São Paulo",
    "telefone": "11999999999",
    "acesso_status": "na_fila",
    "acesso_template_id": "template-access",
    "acesso_enviado_em": "2030-01-01T10:00:00Z",
    "acesso_tentativas": 3,
    "acesso_erro": "retry",
    "acesso_disparo_id": "dispatch_reduced_sync",
    "acesso_claim": "claim-access",
    "wa_status": "na_fila",
    "wa_disparo_id": "wa_reduced_sync",
    "wa_tentativas": 2,
    "wa_erro": "retry-wa",
    "wa_claim": "claim-wa",
    "wa_enviado_em": "2030-01-01T10:30:00Z",
    "created_at": "2028-01-01T00:00:00Z",
    "updated_at": "2030-01-01T12:00:00Z"
  }'::jsonb,
  '2030-01-01T12:00:00Z'::timestamptz
from reduced_sync_run;

insert into public.sync_bootstrap_rows (
  run_id,
  source_table,
  record_id,
  payload,
  source_updated_at
)
select
  id,
  'ingressos',
  'ticket_reduced_sync',
  '{
    "id": "ticket_reduced_sync",
    "comprador_id": "buyer_reduced_sync",
    "pedido_id": "REDUCED-001",
    "status": "Pré-Credenciado",
    "participante_id": "participant_reduced_sync",
    "preenchido_em": "2030-01-01T11:30:00Z",
    "tipo_ingresso": "PLATINUM",
    "status_webhook": "erro",
    "inac_id": "inac-reduced-sync",
    "inac_qr": "qr-reduced-sync",
    "origem": "pocketbase",
    "cortesia_id": "courtesy_reduced_sync",
    "created_at": "2028-01-02T00:00:00Z",
    "updated_at": "2030-01-01T12:01:00Z"
  }'::jsonb,
  '2030-01-01T12:01:00Z'::timestamptz
from reduced_sync_run;

insert into public.sync_bootstrap_rows (
  run_id,
  source_table,
  record_id,
  payload,
  source_updated_at
)
select
  id,
  'participantes',
  'participant_reduced_sync',
  '{
    "id": "participant_reduced_sync",
    "ingresso_id": "ticket_reduced_sync",
    "nome_completo": "Participant After Bootstrap",
    "email": "participant.reduced.sync@example.com",
    "cpf": "52998224725",
    "telefone": "11988887777",
    "nome_empresa": "Adapta",
    "cargo": "Liderança",
    "nicho": "Tecnologia",
    "num_funcionarios": "51-100",
    "faturamento_anual": "10-50M",
    "areas_ajuda": ["IA", "Vendas"],
    "expectativa_aprendizado": "Aplicações práticas",
    "expectativa_experiencia": "Networking",
    "acesso_status": "na_fila",
    "acesso_disparo_id": "dispatch_reduced_sync",
    "acesso_template_id": "participant-template",
    "acesso_enviado_em": "2030-01-01T11:00:00Z",
    "acesso_tentativas": 4,
    "acesso_erro": "participant-retry",
    "acesso_claim": "participant-claim",
    "ia_uso_diario": 8,
    "ia_profundidade": 7,
    "ia_ferramentas": "ChatGPT",
    "ia_desafio": "Escala",
    "tem_empresa": true,
    "profissao": "Empresária",
    "terms_accepted_at": "2030-01-01T11:15:00Z",
    "created_at": "2028-01-03T00:00:00Z",
    "updated_at": "2030-01-01T12:02:00Z"
  }'::jsonb,
  '2030-01-01T12:02:00Z'::timestamptz
from reduced_sync_run;

create temporary table reduced_sync_result as
select public.finalize_sync_bootstrap(id) as result
from reduced_sync_run;

select is(
  (select result->>'state' from reduced_sync_result),
  'completed',
  'three-collection bootstrap completes'
);

select is(
  (select result->'counts' from reduced_sync_result),
  '{"compradores":1,"ingressos":1,"participantes":1}'::jsonb,
  'bootstrap result exposes only the three core counts'
);

select is(
  (
    select jsonb_build_object(
      'nome', nome,
      'email', email,
      'documento', documento,
      'uf', uf,
      'cidade', cidade,
      'telefone', telefone,
      'acesso_status', acesso_status,
      'acesso_template_id', acesso_template_id,
      'acesso_enviado_em', acesso_enviado_em,
      'acesso_tentativas', acesso_tentativas,
      'acesso_erro', acesso_erro,
      'acesso_disparo_id', acesso_disparo_id,
      'acesso_claim', acesso_claim,
      'wa_status', wa_status,
      'wa_disparo_id', wa_disparo_id,
      'wa_tentativas', wa_tentativas,
      'wa_erro', wa_erro,
      'wa_claim', wa_claim,
      'wa_enviado_em', wa_enviado_em,
      'created_at', created_at,
      'updated_at', updated_at
    )
    from public.compradores
    where id = 'buyer_reduced_sync'
  ),
  jsonb_build_object(
    'nome', 'Buyer After Bootstrap',
    'email', 'buyer.reduced.sync@example.com',
    'documento', '12345678901',
    'uf', 'SP',
    'cidade', 'São Paulo',
    'telefone', '11999999999',
    'acesso_status', 'na_fila',
    'acesso_template_id', 'template-access',
    'acesso_enviado_em', '2030-01-01T10:00:00Z'::timestamptz,
    'acesso_tentativas', 3,
    'acesso_erro', 'retry',
    'acesso_disparo_id', 'dispatch_reduced_sync',
    'acesso_claim', 'claim-access',
    'wa_status', 'na_fila',
    'wa_disparo_id', 'wa_reduced_sync',
    'wa_tentativas', 2,
    'wa_erro', 'retry-wa',
    'wa_claim', 'claim-wa',
    'wa_enviado_em', '2030-01-01T10:30:00Z'::timestamptz,
    'created_at', '2028-01-01T00:00:00Z'::timestamptz,
    'updated_at', '2030-01-01T12:00:00Z'::timestamptz
  ),
  'all buyer fields are preserved'
);

select is(
  (
    select jsonb_build_object(
      'comprador_id', comprador_id,
      'pedido_id', pedido_id,
      'status', status,
      'participante_id', participante_id,
      'preenchido_em', preenchido_em,
      'tipo_ingresso', tipo_ingresso,
      'status_webhook', status_webhook,
      'inac_id', inac_id,
      'inac_qr', inac_qr,
      'origem', origem,
      'cortesia_id', cortesia_id,
      'created_at', created_at,
      'updated_at', updated_at
    )
    from public.ingressos
    where id = 'ticket_reduced_sync'
  ),
  jsonb_build_object(
    'comprador_id', 'buyer_reduced_sync',
    'pedido_id', 'REDUCED-001',
    'status', 'Pré-Credenciado',
    'participante_id', 'participant_reduced_sync',
    'preenchido_em', '2030-01-01T11:30:00Z'::timestamptz,
    'tipo_ingresso', 'PLATINUM',
    'status_webhook', 'erro',
    'inac_id', 'inac-reduced-sync',
    'inac_qr', 'qr-reduced-sync',
    'origem', 'pocketbase',
    'cortesia_id', 'courtesy_reduced_sync',
    'created_at', '2028-01-02T00:00:00Z'::timestamptz,
    'updated_at', '2030-01-01T12:01:00Z'::timestamptz
  ),
  'all ticket fields and the final participant link are preserved'
);

select is(
  (
    select jsonb_build_object(
      'ingresso_id', ingresso_id,
      'nome_completo', nome_completo,
      'email', email,
      'cpf', cpf,
      'telefone', telefone,
      'nome_empresa', nome_empresa,
      'cargo', cargo,
      'nicho', nicho,
      'num_funcionarios', num_funcionarios,
      'faturamento_anual', faturamento_anual,
      'areas_ajuda', areas_ajuda,
      'expectativa_aprendizado', expectativa_aprendizado,
      'expectativa_experiencia', expectativa_experiencia,
      'acesso_status', acesso_status,
      'acesso_disparo_id', acesso_disparo_id,
      'acesso_template_id', acesso_template_id,
      'acesso_enviado_em', acesso_enviado_em,
      'acesso_tentativas', acesso_tentativas,
      'acesso_erro', acesso_erro,
      'acesso_claim', acesso_claim,
      'ia_uso_diario', ia_uso_diario,
      'ia_profundidade', ia_profundidade,
      'ia_ferramentas', ia_ferramentas,
      'ia_desafio', ia_desafio,
      'tem_empresa', tem_empresa,
      'profissao', profissao,
      'terms_accepted_at', terms_accepted_at,
      'created_at', created_at,
      'updated_at', updated_at
    )
    from public.participantes
    where id = 'participant_reduced_sync'
  ),
  jsonb_build_object(
    'ingresso_id', 'ticket_reduced_sync',
    'nome_completo', 'Participant After Bootstrap',
    'email', 'participant.reduced.sync@example.com',
    'cpf', '52998224725',
    'telefone', '11988887777',
    'nome_empresa', 'Adapta',
    'cargo', 'Liderança',
    'nicho', 'Tecnologia',
    'num_funcionarios', '51-100',
    'faturamento_anual', '10-50M',
    'areas_ajuda', '["IA","Vendas"]'::jsonb,
    'expectativa_aprendizado', 'Aplicações práticas',
    'expectativa_experiencia', 'Networking',
    'acesso_status', 'na_fila',
    'acesso_disparo_id', 'dispatch_reduced_sync',
    'acesso_template_id', 'participant-template',
    'acesso_enviado_em', '2030-01-01T11:00:00Z'::timestamptz,
    'acesso_tentativas', 4,
    'acesso_erro', 'participant-retry',
    'acesso_claim', 'participant-claim',
    'ia_uso_diario', 8,
    'ia_profundidade', 7,
    'ia_ferramentas', 'ChatGPT',
    'ia_desafio', 'Escala',
    'tem_empresa', true,
    'profissao', 'Empresária',
    'terms_accepted_at', '2030-01-01T11:15:00Z'::timestamptz,
    'created_at', '2028-01-03T00:00:00Z'::timestamptz,
    'updated_at', '2030-01-01T12:02:00Z'::timestamptz
  ),
  'all participant fields are preserved'
);

select is(
  (
    select jsonb_build_object(
      'tokens_acesso', exists (
        select 1 from public.tokens_acesso where id = 'token_reduced_sync'
      ),
      'links_participante', exists (
        select 1 from public.links_participante where id = 'link_reduced_sync'
      ),
      'webhooks_log', exists (
        select 1 from public.webhooks_log where id = 'webhook_reduced_sync'
      ),
      'disparos', exists (
        select 1 from public.disparos where id = 'dispatch_reduced_sync'
      ),
      'envios', exists (
        select 1 from public.envios where id = 'delivery_reduced_sync'
      ),
      'pedidos_guru', exists (
        select 1 from public.pedidos_guru where id = 'guru_reduced_sync'
      ),
      'disparos_wa', exists (
        select 1 from public.disparos_wa where id = 'wa_reduced_sync'
      ),
      'cortesias', exists (
        select 1 from public.cortesias where id = 'courtesy_reduced_sync'
      )
    )
  ),
  '{
    "tokens_acesso": true,
    "links_participante": true,
    "webhooks_log": true,
    "disparos": true,
    "envios": true,
    "pedidos_guru": true,
    "disparos_wa": true,
    "cortesias": true
  }'::jsonb,
  'the eight excluded tables are not truncated or replaced'
);

select is(
  (select count(*) from public.claim_email_dispatch_batch(100)),
  0::bigint,
  'imported and local email queues remain inert in standby'
);

select is(
  (select count(*) from public.claim_whatsapp_dispatch_batch(100)),
  0::bigint,
  'imported and local WhatsApp queues remain inert in standby'
);

select throws_ok(
  $$
    insert into public.sync_bootstrap_rows (
      run_id,
      source_table,
      record_id,
      payload,
      source_updated_at
    )
    select
      id,
      'tokens_acesso',
      'excluded_staging_row',
      '{}'::jsonb,
      now()
    from reduced_sync_run
  $$,
  '23514',
  null,
  'bootstrap staging rejects collections outside the core trio'
);

select is(
  (
    select jsonb_build_object(
      'mode', mode,
      'external_effects_enabled', external_effects_enabled,
      'bootstrap_state', bootstrap_state
    )
    from public.system_state
    where singleton
  ),
  '{
    "mode": "standby",
    "external_effects_enabled": false,
    "bootstrap_state": "completed"
  }'::jsonb,
  'bootstrap keeps failover and external effects safely disabled'
);

select * from finish();
rollback;
