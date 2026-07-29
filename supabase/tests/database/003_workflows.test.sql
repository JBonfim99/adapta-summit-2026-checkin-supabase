begin;

set search_path = public, extensions;
select no_plan();

insert into public.compradores (id, nome, email)
values ('buyer_workflow', 'Buyer Workflow', 'buyer.workflow@example.com');

insert into public.ingressos (id, comprador_id, pedido_id, tipo_ingresso)
values
  ('ticket_workflow_1', 'buyer_workflow', 'ORDER-WORKFLOW-1', 'GOLD'),
  ('ticket_workflow_2', 'buyer_workflow', 'ORDER-WORKFLOW-2', 'PLATINUM'),
  ('ticket_workflow_3', 'buyer_workflow', 'ORDER-WORKFLOW-3', 'GOLD');

insert into public.tokens_acesso (id, comprador_id, token, expira_em)
values ('buyer_token_workflow', 'buyer_workflow', 'buyer-token-workflow', now() + interval '1 day');

insert into public.links_participante (id, ingresso_id, token, expira_em)
values
  ('link_workflow_1', 'ticket_workflow_1', 'token-workflow-1', now() + interval '1 day'),
  ('link_workflow_2', 'ticket_workflow_2', 'token-workflow-2', now() + interval '1 day');

select lives_ok(
  $$
    select public.create_participant_link(
      'buyer-token-workflow',
      'ticket_workflow_3'
    )
  $$,
  'a new participant link can be generated'
);

select is(
  (select length(token) from public.links_participante where ingresso_id = 'ticket_workflow_3'),
  64,
  'the generated participant token has 32 random bytes'
);
select ok(
  (
    select expira_em between now() + interval '23 hours' and now() + interval '25 hours'
      from public.links_participante
     where ingresso_id = 'ticket_workflow_3'
  ),
  'buyer invitations expire in 24 hours'
);

select lives_ok(
  $$
    select public.submit_participant(
      'token-workflow-1',
      '{
        "nome_completo": "Participant Workflow",
        "email": "participant.workflow@example.com",
        "cpf": "123.456.789-01",
        "telefone": "11999999999",
        "termsAccepted": true
      }'::jsonb
    )
  $$,
  'participant submission succeeds'
);

select is(
  (select status from public.ingressos where id = 'ticket_workflow_1'),
  'Pré-Credenciado',
  'ticket is credentialled atomically'
);
select ok(
  (select participante_id is not null from public.ingressos where id = 'ticket_workflow_1'),
  'ticket references its participant'
);
select ok(
  (select usado from public.links_participante where id = 'link_workflow_1'),
  'participant link is consumed'
);

select throws_ok(
  $$
    select public.submit_participant(
      'token-workflow-1',
      '{
        "nome_completo": "Second Submit",
        "email": "second.submit@example.com",
        "cpf": "98765432100",
        "telefone": "11999999999",
        "termsAccepted": true
      }'::jsonb
    )
  $$,
  'P0001',
  'INVALID_OR_EXPIRED_LINK',
  'the same ticket cannot be submitted twice'
);

select throws_ok(
  $$
    select public.submit_participant(
      'token-workflow-2',
      '{
        "nome_completo": "Duplicate Email",
        "email": "PARTICIPANT.WORKFLOW@example.com",
        "cpf": "98765432100",
        "telefone": "11999999999",
        "termsAccepted": true
      }'::jsonb
    )
  $$,
  'P0001',
  'EMAIL_ALREADY_USED',
  'participant email uniqueness is enforced in the transaction'
);

select * from finish();
rollback;
