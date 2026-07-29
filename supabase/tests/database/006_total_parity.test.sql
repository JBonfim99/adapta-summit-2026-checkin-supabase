begin;

set search_path = public, extensions;
select no_plan();

create temporary table parity_total_values (
  helpdesk jsonb,
  first_credential jsonb,
  second_credential jsonb
);

insert into parity_total_values (helpdesk)
select public.create_helpdesk_credential(
  '{
    "nome_completo": "Pessoa Helpdesk",
    "email": "pessoa.helpdesk@example.com",
    "cpf": "11144477735",
    "telefone": "(17) 95432-1098",
    "empresa": "Operacoes"
  }'::jsonb,
  'PLATINUM',
  'Operador Teste',
  'Teste de paridade'
);

select matches(
  (select helpdesk->>'pedidoId' from parity_total_values),
  '^H[0-9A-Z]{6}$',
  'helpdesk orders use H plus six uppercase alphanumeric characters'
);

select is(
  (
    public.helpdesk_search('954321098')
      ->'compradores'->0->'ingressos'->0->'participante'->>'empresa'
  ),
  'Operacoes',
  'helpdesk search normalizes phone numbers and returns the profession fallback'
);

select is(
  (
    public.helpdesk_search('pessoa.helpdesk')
      ->'compradores'->0->'ingressos'->0->>'match'
  ),
  'true',
  'helpdesk participant matches mark the matching ticket'
);

insert into public.compradores (id, nome, email)
values ('buyer_total_parity', 'Buyer Total Parity', 'buyer.total.parity@example.com');

insert into public.ingressos (id, comprador_id, pedido_id, tipo_ingresso)
values
  ('ticket_total_first', 'buyer_total_parity', 'TPAR01', 'GOLD'),
  ('ticket_total_second', 'buyer_total_parity', 'TPAR02', 'GOLD');

update parity_total_values
set first_credential = public.credential_ticket(
  'ticket_total_first',
  '{
    "nome_completo": "Primeira Pessoa",
    "email": "primeira.pessoa@example.com",
    "cpf": "52998224725",
    "telefone": "11999990001",
    "tem_empresa": false,
    "profissao": "Engenharia"
  }'::jsonb,
  'admin:test'
);

update parity_total_values
set second_credential = public.credential_ticket(
  'ticket_total_second',
  '{
    "nome_completo": "Segunda Pessoa",
    "email": "segunda.pessoa@example.com",
    "cpf": "16899535009",
    "telefone": "11999990002",
    "tem_empresa": false,
    "profissao": "Produto"
  }'::jsonb,
  'admin:test'
);

select throws_ok(
  $$
    select public.claim_ticket_operation(
      'ticket_total_second',
      'edit',
      'admin:test',
      '{"email":"primeira.pessoa@example.com","cpf":"16899535009"}'::jsonb
    )
  $$,
  'P0001',
  'EMAIL_ALREADY_USED',
  'duplicate participant email is rejected before an external edit can start'
);

create temporary table edit_claim as
select public.claim_ticket_operation(
  'ticket_total_first',
  'edit',
  'admin:test',
  '{
    "nome_completo": "Primeira Pessoa Editada",
    "email": "primeira.editada@example.com",
    "cpf": "52998224725",
    "telefone": "11977776666",
    "tem_empresa": true,
    "nome_empresa": "Adapta",
    "cargo": "Lider",
    "profissao": "",
    "nicho": "Tecnologia",
    "num_funcionarios": "51-100",
    "faturamento_anual": "10-50M",
    "areas_ajuda": ["IA", "Vendas"],
    "expectativa_aprendizado": "Aplicacoes",
    "expectativa_experiencia": "Networking",
    "ia_uso_diario": 8,
    "ia_profundidade": 7,
    "ia_ferramentas": "ChatGPT",
    "ia_desafio": "Escala"
  }'::jsonb
) as value;

select lives_ok(
  format(
    $sql$
      select public.complete_ticket_operation(
        %L::uuid,
        true,
        '{"success":true,"provider":"mock"}'::jsonb
      )
    $sql$,
    (select value->>'claimId' from edit_claim)
  ),
  'participant edit completes after provider confirmation'
);

select is(
  (
    select concat_ws(
      '|',
      nome_completo,
      nome_empresa,
      cargo,
      nicho,
      num_funcionarios,
      faturamento_anual,
      ia_ferramentas,
      ia_desafio
    )
      from public.participantes
     where ingresso_id = 'ticket_total_first'
  ),
  'Primeira Pessoa Editada|Adapta|Lider|Tecnologia|51-100|10-50M|ChatGPT|Escala',
  'admin edit persists every participant field'
);

create temporary table delete_claim as
select public.claim_ticket_operation(
  'ticket_total_first',
  'delete',
  'admin:test',
  '{}'::jsonb
) as value;

select lives_ok(
  format(
    $sql$
      select public.complete_ticket_operation(
        %L::uuid,
        true,
        '{"success":true,"provider":"mock"}'::jsonb
      )
    $sql$,
    (select value->>'claimId' from delete_claim)
  ),
  'credentialled ticket deletion completes after provider confirmation'
);

select is(
  (select count(*)::integer from public.ingressos where id = 'ticket_total_first'),
  0,
  'credentialled ticket is deleted definitively'
);

select is(
  (
    select count(*)::integer
      from public.participantes
     where email_normalized = 'primeira.editada@example.com'
  ),
  0,
  'the linked participant is deleted with the ticket'
);

select ok(
  (
    select ingresso_id is null
      and metadata->'snapshot'->>'pedido_id' = 'TPAR01'
      from public.webhooks_log
     where evento = 'excluido_manual'
       and metadata->'snapshot'->>'pedido_id' = 'TPAR01'
     order by created_at desc
     limit 1
  ),
  'ticket deletion leaves an orphan audit event with a full snapshot'
);

select is(
  (
    public.process_guru_order(
      'guru-total-1',
      'guru.total@example.com',
      '{"nome":"Guru Total"}'::jsonb,
      '[{"type":"GOLD","quantity":1}]'::jsonb,
      '{"status":"approved"}'::jsonb,
      'd-guru-total',
      'Skip-Summit26-Send-Comprador'
    )->>'email_enfileirado'
  ),
  'true',
  'Guru creates its official email delivery in the order transaction'
);

select is(
  (
    public.process_guru_order(
      'guru-total-2',
      'guru.total@example.com',
      '{"nome":"Guru Total"}'::jsonb,
      '[{"type":"PLATINUM","quantity":1}]'::jsonb,
      '{"status":"approved"}'::jsonb,
      'd-guru-total',
      'Skip-Summit26-Send-Comprador'
    )->>'email_status'
  ),
  'ja_enviado',
  'a second Guru purchase does not enqueue duplicate buyer access'
);

select is(
  (
    select count(*)::integer
      from public.envios e
      join public.disparos d on d.id = e.disparo_id
     where d.cluster = 'guru'
       and e.email = 'guru.total@example.com'
  ),
  1,
  'Guru reuses one queue and one access delivery per buyer'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.create_helpdesk_credential(jsonb,text,text,text)',
    'EXECUTE'
  ),
  'anonymous users cannot execute the helpdesk credential RPC directly'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.helpdesk_search(text)',
    'EXECUTE'
  ),
  'authenticated users cannot execute the helpdesk search RPC directly'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.process_guru_order(text,text,jsonb,jsonb,jsonb,text,text)',
    'EXECUTE'
  ),
  'anonymous users cannot execute the Guru RPC directly'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.delete_pending_ticket(text,text)',
    'EXECUTE'
  ),
  'the service role can execute internal ticket RPCs'
);

select * from finish();
rollback;
