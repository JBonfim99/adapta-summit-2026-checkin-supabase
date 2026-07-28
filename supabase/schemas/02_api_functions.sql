create or replace function private.buyer_for_token(p_token text)
returns public.compradores
language plpgsql
security definer
set search_path = ''
as $$
declare
  result public.compradores;
begin
  select c.*
    into result
    from public.tokens_acesso t
    join public.compradores c on c.id = t.comprador_id
   where t.token = p_token
     and t.usado = false
     and t.expira_em > now();

  if result.id is null then
    raise exception using errcode = 'P0001', message = 'INVALID_OR_EXPIRED_TOKEN';
  end if;

  return result;
end;
$$;

create or replace function public.consume_buyer_token(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  buyer public.compradores;
begin
  buyer := private.buyer_for_token(p_token);

  return jsonb_build_object(
    'id', buyer.id,
    'nome', buyer.nome,
    'email', buyer.email,
    'token', p_token
  );
end;
$$;

create or replace function public.get_buyer_tickets(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  buyer public.compradores;
  tickets jsonb;
begin
  buyer := private.buyer_for_token(p_token);

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', i.id,
        'pedido_id', i.pedido_id,
        'type', i.tipo_ingresso,
        'tipo_ingresso', i.tipo_ingresso,
        'status', i.status,
        'participantName', p.nome_completo,
        'participantEmail', p.email,
        'participantCpf', p.cpf,
        'participante_id', i.participante_id,
        'inac_id', i.inac_id,
        'inac_qr', i.inac_qr,
        'pendingLink', active_link.token
      )
      order by i.created_at, i.id
    ),
    '[]'::jsonb
  )
  into tickets
  from public.ingressos i
  left join public.participantes p on p.id = i.participante_id
  left join lateral (
    select lp.token
      from public.links_participante lp
     where lp.ingresso_id = i.id
       and lp.usado = false
       and lp.expira_em > now()
     order by lp.created_at desc
     limit 1
  ) active_link on true
  where i.comprador_id = buyer.id;

  return jsonb_build_object('buyer', jsonb_build_object(
    'id', buyer.id,
    'nome', buyer.nome,
    'email', buyer.email
  ), 'tickets', tickets);
end;
$$;

create or replace function public.create_participant_link(
  p_buyer_token text,
  p_ticket_id text,
  p_expires_at timestamptz default (now() + interval '7 days')
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  buyer public.compradores;
  ticket public.ingressos;
  link public.links_participante;
begin
  buyer := private.buyer_for_token(p_buyer_token);

  select *
    into ticket
    from public.ingressos
   where id = p_ticket_id
     and comprador_id = buyer.id
   for update;

  if ticket.id is null then
    raise exception using errcode = 'P0001', message = 'TICKET_NOT_FOUND';
  end if;
  if ticket.status <> 'Pendente' or ticket.participante_id is not null then
    raise exception using errcode = 'P0001', message = 'TICKET_ALREADY_CREDENTIALLED';
  end if;

  select *
    into link
    from public.links_participante
   where ingresso_id = ticket.id
     and usado = false
     and expira_em > now()
   order by created_at desc
   limit 1
   for update;

  if link.id is null then
    insert into public.links_participante (ingresso_id, token, expira_em)
    values (ticket.id, encode(gen_random_bytes(32), 'hex'), p_expires_at)
    returning * into link;
  end if;

  return jsonb_build_object(
    'token', link.token,
    'expiresAt', link.expira_em,
    'ticketId', ticket.id
  );
end;
$$;

create or replace function public.get_participant_link(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  select jsonb_build_object(
    'id', i.id,
    'pedido_id', i.pedido_id,
    'tipo_ingresso', i.tipo_ingresso,
    'status', i.status,
    'comprador', jsonb_build_object(
      'id', c.id,
      'nome', c.nome,
      'email', c.email
    ),
    'used', lp.usado,
    'expiresAt', lp.expira_em
  )
  into result
  from public.links_participante lp
  join public.ingressos i on i.id = lp.ingresso_id
  join public.compradores c on c.id = i.comprador_id
  where lp.token = p_token
    and lp.usado = false
    and lp.expira_em > now();

  if result is null then
    raise exception using errcode = 'P0001', message = 'INVALID_OR_EXPIRED_LINK';
  end if;

  return result;
end;
$$;

create or replace function private.create_participant_for_ticket(
  p_ticket_id text,
  p_payload jsonb,
  p_actor text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  ticket public.ingressos;
  participant_id text := private.new_text_id();
  accepted_at timestamptz;
  normalized_email text := lower(btrim(p_payload->>'email'));
  normalized_cpf text := private.normalize_cpf(coalesce(p_payload->>'cpf', ''));
begin
  select *
    into ticket
    from public.ingressos
   where id = p_ticket_id
   for update;

  if ticket.id is null then
    raise exception using errcode = 'P0001', message = 'TICKET_NOT_FOUND';
  end if;
  if ticket.status <> 'Pendente' or ticket.participante_id is not null then
    raise exception using errcode = 'P0001', message = 'TICKET_ALREADY_CREDENTIALLED';
  end if;
  if normalized_email = '' or position('@' in normalized_email) <= 1 then
    raise exception using errcode = 'P0001', message = 'INVALID_EMAIL';
  end if;
  if length(normalized_cpf) <> 11 then
    raise exception using errcode = 'P0001', message = 'INVALID_CPF';
  end if;
  if exists (
    select 1 from public.participantes p where p.email_normalized = normalized_email
  ) then
    raise exception using errcode = 'P0001', message = 'EMAIL_ALREADY_USED';
  end if;
  if exists (
    select 1 from public.participantes p where p.cpf_normalized = normalized_cpf
  ) then
    raise exception using errcode = 'P0001', message = 'CPF_ALREADY_USED';
  end if;

  accepted_at := coalesce(
    nullif(p_payload->>'terms_accepted_at', '')::timestamptz,
    case when coalesce((p_payload->>'termsAccepted')::boolean, false) then now() end
  );
  if accepted_at is null then
    raise exception using errcode = 'P0001', message = 'TERMS_REQUIRED';
  end if;

  insert into public.participantes (
    id,
    ingresso_id,
    nome_completo,
    email,
    cpf,
    telefone,
    nome_empresa,
    cargo,
    nicho,
    num_funcionarios,
    faturamento_anual,
    areas_ajuda,
    expectativa_aprendizado,
    expectativa_experiencia,
    ia_uso_diario,
    ia_profundidade,
    ia_ferramentas,
    ia_desafio,
    tem_empresa,
    profissao,
    terms_accepted_at
  ) values (
    participant_id,
    ticket.id,
    btrim(p_payload->>'nome_completo'),
    btrim(p_payload->>'email'),
    p_payload->>'cpf',
    coalesce(p_payload->>'telefone', ''),
    coalesce(p_payload->>'nome_empresa', p_payload->>'empresa', ''),
    coalesce(p_payload->>'cargo', ''),
    coalesce(p_payload->>'nicho', ''),
    coalesce(p_payload->>'num_funcionarios', ''),
    coalesce(p_payload->>'faturamento_anual', ''),
    case
      when jsonb_typeof(p_payload->'areas_ajuda') = 'array' then p_payload->'areas_ajuda'
      else '[]'::jsonb
    end,
    coalesce(p_payload->>'expectativa_aprendizado', ''),
    coalesce(p_payload->>'expectativa_experiencia', ''),
    nullif(p_payload->>'ia_uso_diario', '')::integer,
    nullif(p_payload->>'ia_profundidade', '')::integer,
    coalesce(p_payload->>'ia_ferramentas', ''),
    coalesce(p_payload->>'ia_desafio', ''),
    nullif(p_payload->>'tem_empresa', '')::boolean,
    coalesce(p_payload->>'profissao', ''),
    accepted_at
  );

  update public.ingressos
     set participante_id = participant_id,
         status = 'Pré-Credenciado',
         preenchido_em = now(),
         status_webhook = 'pendente'
   where id = ticket.id;

  insert into public.webhooks_log (
    ingresso_id,
    status,
    method,
    evento,
    detalhe,
    metadata
  ) values (
    ticket.id,
    202,
    'POST',
    'participant_submitted',
    'Participant persisted; INAC dispatch pending',
    jsonb_build_object('actor', p_actor, 'participant_id', participant_id)
  );

  return jsonb_build_object(
    'success', true,
    'ticketId', ticket.id,
    'participantId', participant_id,
    'tipoIngresso', ticket.tipo_ingresso,
    'pedidoId', ticket.pedido_id
  );
end;
$$;

create or replace function public.submit_participant(
  p_link_token text,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  link public.links_participante;
  result jsonb;
begin
  select *
    into link
    from public.links_participante
   where token = p_link_token
   for update;

  if link.id is null or link.usado or link.expira_em <= now() then
    raise exception using errcode = 'P0001', message = 'INVALID_OR_EXPIRED_LINK';
  end if;

  result := private.create_participant_for_ticket(
    link.ingresso_id,
    p_payload,
    'participant'
  );

  update public.links_participante
     set usado = true
   where id = link.id;

  return result;
end;
$$;

create or replace function public.credential_ticket(
  p_ticket_id text,
  p_payload jsonb,
  p_actor text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  return private.create_participant_for_ticket(
    p_ticket_id,
    p_payload || jsonb_build_object('termsAccepted', true),
    p_actor
  );
end;
$$;

create or replace function public.claim_ticket_operation(
  p_ticket_id text,
  p_operation text,
  p_actor text,
  p_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  ticket public.ingressos;
  participant public.participantes;
  claim public.ticket_operation_claims;
begin
  if p_operation not in ('edit', 'change_type', 'delete') then
    raise exception using errcode = 'P0001', message = 'INVALID_OPERATION';
  end if;

  update public.ticket_operation_claims
     set state = 'expired'
   where ingresso_id = p_ticket_id
     and state = 'claimed'
     and expires_at <= now();

  select *
    into ticket
    from public.ingressos
   where id = p_ticket_id
   for update;

  if ticket.id is null then
    raise exception using errcode = 'P0001', message = 'TICKET_NOT_FOUND';
  end if;
  if ticket.participante_id is null then
    raise exception using errcode = 'P0001', message = 'TICKET_NOT_CREDENTIALLED';
  end if;

  select *
    into participant
    from public.participantes
   where id = ticket.participante_id;

  insert into public.ticket_operation_claims (
    ingresso_id,
    operation,
    actor,
    expected_updated_at,
    payload
  ) values (
    ticket.id,
    p_operation,
    p_actor,
    ticket.updated_at,
    p_payload
  )
  returning * into claim;

  return jsonb_build_object(
    'claimId', claim.id,
    'ticket', to_jsonb(ticket),
    'participant', to_jsonb(participant)
  );
exception
  when unique_violation then
    raise exception using errcode = 'P0001', message = 'TICKET_OPERATION_IN_PROGRESS';
end;
$$;

create or replace function public.complete_ticket_operation(
  p_claim_id uuid,
  p_success boolean,
  p_provider_result jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  claim public.ticket_operation_claims;
  ticket public.ingressos;
  participant_id text;
begin
  select *
    into claim
    from public.ticket_operation_claims
   where id = p_claim_id
   for update;

  if claim.id is null or claim.state <> 'claimed' then
    raise exception using errcode = 'P0001', message = 'INVALID_OPERATION_CLAIM';
  end if;
  if claim.expires_at <= now() then
    update public.ticket_operation_claims set state = 'expired' where id = claim.id;
    raise exception using errcode = 'P0001', message = 'OPERATION_CLAIM_EXPIRED';
  end if;

  if not p_success then
    update public.ticket_operation_claims
       set state = 'failed',
           result = p_provider_result,
           completed_at = now()
     where id = claim.id;
    return jsonb_build_object('success', false, 'claimId', claim.id);
  end if;

  select *
    into ticket
    from public.ingressos
   where id = claim.ingresso_id
   for update;

  if ticket.updated_at <> claim.expected_updated_at then
    update public.ticket_operation_claims
       set state = 'failed',
           result = jsonb_build_object('error', 'STALE_TICKET'),
           completed_at = now()
     where id = claim.id;
    raise exception using errcode = 'P0001', message = 'STALE_TICKET';
  end if;

  if claim.operation = 'edit' then
    update public.participantes
       set nome_completo = coalesce(claim.payload->>'nome_completo', nome_completo),
           email = coalesce(claim.payload->>'email', email),
           cpf = coalesce(claim.payload->>'cpf', cpf),
           telefone = coalesce(claim.payload->>'telefone', telefone),
           nome_empresa = coalesce(
             claim.payload->>'nome_empresa',
             claim.payload->>'empresa',
             nome_empresa
           ),
           cargo = coalesce(claim.payload->>'cargo', cargo)
     where id = ticket.participante_id;
  elsif claim.operation = 'change_type' then
    if claim.payload->>'tipo' not in ('GOLD', 'PLATINUM', 'PALESTRANTES', 'HACKATHON') then
      raise exception using errcode = 'P0001', message = 'INVALID_TICKET_TYPE';
    end if;
    update public.ingressos
       set tipo_ingresso = claim.payload->>'tipo'
     where id = ticket.id;
  elsif claim.operation = 'delete' then
    participant_id := ticket.participante_id;
    update public.ingressos
       set participante_id = null,
           status = 'Pendente',
           preenchido_em = null,
           status_webhook = 'pendente',
           inac_id = null,
           inac_qr = null
     where id = ticket.id;
    delete from public.participantes where id = participant_id;
  end if;

  update public.ticket_operation_claims
     set state = 'completed',
         result = p_provider_result,
         completed_at = now()
   where id = claim.id;

  insert into public.webhooks_log (
    ingresso_id,
    status,
    method,
    evento,
    detalhe,
    metadata
  ) values (
    ticket.id,
    200,
    'POST',
    'ticket_' || claim.operation,
    'Ticket operation completed after provider confirmation',
    jsonb_build_object(
      'actor', claim.actor,
      'claim_id', claim.id,
      'provider_result', p_provider_result
    )
  );

  return jsonb_build_object('success', true, 'claimId', claim.id);
end;
$$;

create or replace function public.set_system_mode(
  p_mode text,
  p_user_id uuid,
  p_pocketbase_writes_blocked boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  state public.system_state;
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

  update public.system_state
     set mode = p_mode,
         activated_at = case when p_mode = 'active' then now() else activated_at end,
         activated_by = case when p_mode = 'active' then p_user_id else activated_by end,
         pocketbase_writes_blocked = p_pocketbase_writes_blocked
   where singleton
   returning * into state;

  return to_jsonb(state);
end;
$$;
