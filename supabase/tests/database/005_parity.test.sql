begin;

set search_path = public, extensions;
select no_plan();

select has_table('public', 'disparos', 'email dispatches exist');
select has_table('public', 'envios', 'email delivery queue exists');
select has_table('public', 'pedidos_guru', 'Guru orders exist');
select has_table('public', 'disparos_wa', 'WhatsApp dispatches exist');
select has_table('public', 'cortesias', 'courtesy links exist');
select has_table('public', 'cron_health', 'local worker health exists');
select has_extension('pg_net', 'pg_net is enabled for the scheduled worker');

select is(
  (select count(*)::integer from cron.job where jobname = 'invoke-dispatch-worker'),
  1,
  'dispatch worker is scheduled once per minute'
);

select is(
  (
    select count(*)::integer
      from pg_policies
     where schemaname = 'realtime'
       and tablename = 'messages'
       and policyname = 'admin_profiles_realtime_read'
  ),
  1,
  'authenticated admins can receive private Realtime broadcasts'
);

select ok(
  (select bool_and(c.relrowsecurity)
     from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in (
        'disparos',
        'envios',
        'pedidos_guru',
        'disparos_wa',
        'cortesias',
        'cron_health'
      )),
  'RLS is enabled on every parity table'
);

select is(
  (select count(*)::integer
     from information_schema.role_table_grants
    where grantee in ('anon', 'authenticated')
      and table_schema = 'public'
      and table_name in (
        'disparos',
        'envios',
        'pedidos_guru',
        'disparos_wa',
        'cortesias',
        'cron_health'
      )),
  0,
  'browser roles have no direct grants on parity tables'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.register_courtesy(text,jsonb)',
    'execute'
  ),
  'service role can execute courtesy transaction'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.register_courtesy(text,jsonb)',
    'execute'
  ),
  'anon cannot execute parity transactions directly'
);

create temporary table parity_values as
select public.create_courtesy('Host Test', 'GOLD', 1) as courtesy;

select lives_ok(
  format(
    $sql$
      select public.register_courtesy(
        %L,
        '{
          "nome_completo": "Courtesy One",
          "email": "courtesy.one@example.com",
          "cpf": "12345678901",
          "telefone": "11999999999"
        }'::jsonb
      )
    $sql$,
    (select courtesy->>'token' from parity_values)
  ),
  'courtesy registration is transactional'
);

select throws_ok(
  format(
    $sql$
      select public.register_courtesy(
        %L,
        '{
          "nome_completo": "Courtesy Two",
          "email": "courtesy.two@example.com",
          "cpf": "98765432100",
          "telefone": "11988888888"
        }'::jsonb
      )
    $sql$,
    (select courtesy->>'token' from parity_values)
  ),
  'P0001',
  'COURTESY_EXHAUSTED',
  'courtesy quota is enforced while locked'
);

select is(
  (
    public.import_buyers_batch(
      '[{
        "nome": "Import Parity",
        "email": "import.parity@example.com",
        "qtd_gold": 1,
        "qtd_platinum": 1,
        "qtd_palestrantes": 1,
        "qtd_hackathon": 1
      }]'::jsonb
    )->>'imported'
  )::integer,
  4,
  'import creates all four ticket types'
);

select is(
  (select count(distinct tipo_ingresso)::integer
     from public.ingressos i
     join public.compradores c on c.id = i.comprador_id
    where c.email_normalized = 'import.parity@example.com'),
  4,
  'imported tickets preserve their categories'
);

select ok(
  (
    select bool_and(
      lp.expira_em between now() + interval '364 days' and now() + interval '366 days'
    )
      from public.links_participante lp
      join public.ingressos i on i.id = lp.ingresso_id
      join public.compradores c on c.id = i.comprador_id
     where c.email_normalized = 'import.parity@example.com'
  ),
  'initial ticket links expire in one year'
);

select is(
  (
    public.process_guru_order(
      'guru-parity-1',
      'guru.parity@example.com',
      '{"nome":"Guru Parity"}'::jsonb,
      '[{"type":"GOLD","quantity":2}]'::jsonb,
      '{"status":"approved"}'::jsonb
    )->>'ingressos'
  )::integer,
  2,
  'Guru transaction creates requested tickets'
);

select is(
  public.process_guru_order(
    'guru-parity-1',
    'guru.parity@example.com',
    '{"nome":"Guru Parity"}'::jsonb,
    '[{"type":"GOLD","quantity":2}]'::jsonb,
    '{"status":"approved"}'::jsonb
  )->>'duplicate',
  'true',
  'Guru transaction is idempotent'
);

insert into public.disparos (
  id,
  template_id,
  template_nome,
  cluster,
  total
) values (
  'dispatch_parity',
  'd-parity',
  'Parity',
  'individual',
  1
);

insert into public.envios (
  id,
  disparo_id,
  nome,
  email
) values (
  'delivery_parity',
  'dispatch_parity',
  'Delivery Parity',
  'delivery.parity@example.com'
);

select is(
  (select status from public.claim_email_dispatch_batch(10) where id = 'delivery_parity'),
  'enviando',
  'email queue claim is atomic'
);

select lives_ok(
  $$ select public.complete_email_dispatch('delivery_parity', true, null) $$,
  'email delivery can be completed'
);

select is(
  (select status from public.disparos where id = 'dispatch_parity'),
  'concluido',
  'email dispatch counters are finalized'
);

insert into public.compradores (id, nome, email, telefone)
values ('buyer_wa_parity', 'Buyer WA', 'buyer.wa.parity@example.com', '11999999999');

insert into public.disparos_wa (id, nome, cluster, total, flow)
values ('dispatch_wa_parity', 'WA Parity', 'individual', 1, 'PRE');

update public.compradores
   set wa_status = 'na_fila',
       wa_disparo_id = 'dispatch_wa_parity'
 where id = 'buyer_wa_parity';

select is(
  (
    select buyer_id
      from public.claim_whatsapp_dispatch_batch(10)
     where buyer_id = 'buyer_wa_parity'
  ),
  'buyer_wa_parity',
  'WhatsApp queue claim is atomic'
);

select lives_ok(
  $$ select public.complete_whatsapp_dispatch('buyer_wa_parity', true, null) $$,
  'WhatsApp delivery can be completed'
);

select is(
  public.apply_sync_event(
    '{
      "event_id": "sync-dispatch-parity",
      "table": "disparos",
      "record_id": "sync_dispatch_parity",
      "operation": "create",
      "source_updated_at": "2026-07-28T20:00:00Z",
      "payload": {
        "template_id": "d-sync",
        "template_nome": "Sync",
        "cluster": "todos",
        "total": 10
      }
    }'::jsonb
  )->>'state',
  'applied',
  'new operational tables participate in hot-standby sync'
);

select throws_ok(
  $$
    select public.apply_sync_event(
      '{
        "event_id": "sync-cron-health-forbidden",
        "table": "cron_health",
        "record_id": "dispatch",
        "operation": "update",
        "source_updated_at": "2026-07-28T20:00:00Z",
        "payload": {}
      }'::jsonb
    )
  $$,
  'P0001',
  'INVALID_SYNC_EVENT',
  'cron health remains local to the fallback'
);

select * from finish();
rollback;
