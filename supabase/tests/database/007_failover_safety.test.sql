begin;

set search_path = public, extensions;
select no_plan();

insert into public.compradores (
  id,
  nome,
  email,
  telefone,
  wa_status,
  wa_disparo_id
) values (
  'buyer_gate',
  'Buyer Gate',
  'buyer.gate@example.com',
  '11999998888',
  'na_fila',
  'wa_gate'
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
  'dispatch_gate',
  'template-gate',
  'Template Gate',
  'individual',
  'Dispatch Gate',
  'compradores',
  1,
  'em_andamento'
);

insert into public.envios (
  id,
  disparo_id,
  comprador_id,
  nome,
  email,
  status
) values (
  'delivery_gate',
  'dispatch_gate',
  'buyer_gate',
  'Buyer Gate',
  'buyer.gate@example.com',
  'na_fila'
);

insert into public.disparos_wa (
  id,
  nome,
  cluster,
  total,
  status,
  flow
) values (
  'wa_gate',
  'WhatsApp Gate',
  'individual',
  1,
  'em_andamento',
  '123'
);

update public.system_state
   set mode = 'standby',
       external_effects_enabled = false
 where singleton;

select is(
  (select count(*) from public.claim_email_dispatch_batch(100)),
  0::bigint,
  'standby never claims an email delivery'
);

select is(
  (select status from public.envios where id = 'delivery_gate'),
  'na_fila',
  'blocked email delivery status is untouched'
);

select is(
  (select count(*) from public.claim_whatsapp_dispatch_batch(100)),
  0::bigint,
  'standby never claims a WhatsApp delivery'
);

select is(
  (select wa_status from public.compradores where id = 'buyer_gate'),
  'na_fila',
  'blocked WhatsApp status is untouched'
);

update public.system_state
   set mode = 'active',
       external_effects_enabled = false
 where singleton;

select is(
  (select count(*) from public.claim_email_dispatch_batch(100)),
  0::bigint,
  'active mode alone does not claim email deliveries'
);

select is(
  (select count(*) from public.claim_whatsapp_dispatch_batch(100)),
  0::bigint,
  'active mode alone does not claim WhatsApp deliveries'
);

select is(
  (select count(*) from public.tokens_acesso where comprador_id = 'buyer_gate'),
  0::bigint,
  'blocked claims do not create access tokens'
);

select is(
  (select count(*) from public.integration_attempts),
  0::bigint,
  'blocked claims do not register integration attempts'
);

update public.system_state
   set external_effects_enabled = true
 where singleton;

select is(
  (select count(*) from public.claim_email_dispatch_batch(100)),
  1::bigint,
  'email claim is released only by active plus external effects'
);

select is(
  (select count(*) from public.claim_whatsapp_dispatch_batch(100)),
  1::bigint,
  'WhatsApp claim is released only by active plus external effects'
);

select * from finish();
rollback;
