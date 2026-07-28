begin;

set search_path = public, extensions;
select no_plan();

insert into public.compradores (id, nome, email)
values ('buyer_constraints', 'Buyer Constraints', 'buyer.constraints@example.com');

select throws_ok(
  $$
    insert into public.ingressos (
      id,
      comprador_id,
      pedido_id,
      tipo_ingresso
    ) values (
      'ticket_invalid_type',
      'buyer_constraints',
      'ORDER-INVALID',
      'DIAMOND'
    )
  $$,
  '23514',
  null,
  'invalid ticket type is rejected'
);

insert into public.ingressos (
  id,
  comprador_id,
  pedido_id,
  tipo_ingresso
) values (
  'ticket_constraints',
  'buyer_constraints',
  'ORDER-CONSTRAINTS',
  'GOLD'
);

select throws_ok(
  $$
    insert into public.participantes (
      id,
      ingresso_id,
      nome_completo,
      email,
      cpf,
      telefone,
      terms_accepted_at
    ) values (
      'participant_invalid_cpf',
      'ticket_constraints',
      'Invalid CPF',
      'invalid.cpf@example.com',
      '123',
      '11999999999',
      now()
    )
  $$,
  '23514',
  null,
  'CPF must contain exactly 11 digits'
);

select throws_ok(
  $$
    insert into public.compradores (id, nome, email)
    values ('buyer_duplicate_email', 'Duplicate', 'BUYER.CONSTRAINTS@example.com')
  $$,
  '23505',
  null,
  'buyer email uniqueness is case insensitive'
);

select * from finish();
rollback;
