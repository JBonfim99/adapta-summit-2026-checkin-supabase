begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select no_plan();

select has_table('public', 'compradores', 'compradores exists');
select has_table('public', 'ingressos', 'ingressos exists');
select has_table('public', 'participantes', 'participantes exists');
select has_table('public', 'tokens_acesso', 'tokens_acesso exists');
select has_table('public', 'links_participante', 'links_participante exists');
select has_table('public', 'webhooks_log', 'webhooks_log exists');
select has_table('public', 'admin_profiles', 'admin_profiles exists');
select has_table('public', 'system_state', 'system_state exists');
select has_table('public', 'integration_attempts', 'integration_attempts exists');
select has_table('public', 'ticket_operation_claims', 'ticket_operation_claims exists');
select has_table('public', 'sync_events', 'sync_events exists');
select has_table('public', 'sync_tombstones', 'sync_tombstones exists');

select has_column('public', 'compradores', 'email_normalized', 'buyer email is normalized');
select has_column('public', 'participantes', 'cpf_normalized', 'participant CPF is normalized');
select has_column('public', 'system_state', 'mode', 'system mode exists');

select ok(
  (select bool_and(c.relrowsecurity)
     from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in (
        'compradores',
        'ingressos',
        'participantes',
        'tokens_acesso',
        'links_participante',
        'webhooks_log',
        'admin_profiles',
        'system_state',
        'integration_attempts',
        'ticket_operation_claims',
        'sync_events',
        'sync_tombstones'
      )),
  'RLS is enabled on every application table'
);

select is(
  (select count(*)::integer
     from information_schema.role_table_grants
    where grantee = 'anon'
      and table_schema = 'public'
      and table_name in ('compradores', 'ingressos', 'participantes')),
  0,
  'anon has no direct table grants'
);

select is(
  (select count(*)::integer
     from information_schema.role_table_grants
    where grantee = 'authenticated'
      and table_schema = 'public'
      and table_name in ('compradores', 'ingressos', 'participantes')),
  0,
  'authenticated has no direct table grants'
);

select ok(
  has_table_privilege('service_role', 'public.compradores', 'select'),
  'service_role can access core tables'
);
select ok(
  not has_function_privilege(
    'anon',
    'public.submit_participant(text,jsonb)',
    'execute'
  ),
  'anon cannot execute transactional RPCs'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.submit_participant(text,jsonb)',
    'execute'
  ),
  'service_role can execute transactional RPCs'
);

select * from finish();
rollback;
