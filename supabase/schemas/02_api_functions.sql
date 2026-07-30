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
      order by i.created_at desc, i.id desc
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

create or replace function public.create_admin_buyer_access_link(
  p_buyer_id text,
  p_expires_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  buyer public.compradores;
  access_token text;
begin
  select id, nome, email
    into buyer
    from public.compradores
   where id = p_buyer_id;

  if buyer.id is null then
    raise exception using errcode = 'P0001', message = 'BUYER_NOT_FOUND';
  end if;

  access_token := encode(extensions.gen_random_bytes(32), 'hex');

  insert into public.tokens_acesso (comprador_id, token, expira_em)
  values (buyer.id, access_token, p_expires_at);

  insert into public.webhooks_log (
    evento,
    method,
    status,
    detalhe,
    payload,
    metadata
  ) values (
    'admin_link_acesso',
    'ADMIN',
    200,
    format('Link de acesso gerado no admin para %s (%s)', buyer.nome, buyer.email),
    jsonb_build_object('comprador_id', buyer.id, 'expira_em', p_expires_at)::text,
    jsonb_build_object('comprador_id', buyer.id, 'expira_em', p_expires_at)
  );

  return jsonb_build_object(
    'token', access_token,
    'email', buyer.email,
    'nome', buyer.nome,
    'expira_em', p_expires_at
  );
end;
$$;

create or replace function public.create_participant_link(
  p_buyer_token text,
  p_ticket_id text,
  p_expires_at timestamptz default (now() + interval '1 day')
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

  insert into public.links_participante (ingresso_id, token, expira_em)
  values (ticket.id, encode(extensions.gen_random_bytes(32), 'hex'), p_expires_at)
  returning * into link;

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
  normalized_email text;
  normalized_cpf text;
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

  if participant.id is null then
    raise exception using errcode = 'P0001', message = 'PARTICIPANT_NOT_FOUND';
  end if;

  if p_operation = 'edit' then
    normalized_email := lower(btrim(coalesce(p_payload->>'email', participant.email)));
    normalized_cpf := private.normalize_cpf(coalesce(p_payload->>'cpf', participant.cpf));
    if exists (
      select 1
        from public.participantes p
       where p.email_normalized = normalized_email
         and p.id <> participant.id
    ) then
      raise exception using errcode = 'P0001', message = 'EMAIL_ALREADY_USED';
    end if;
    if exists (
      select 1
        from public.participantes p
       where p.cpf_normalized = normalized_cpf
         and p.id <> participant.id
    ) then
      raise exception using errcode = 'P0001', message = 'CPF_ALREADY_USED';
    end if;
  end if;

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
  participant public.participantes;
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

  select *
    into participant
    from public.participantes
   where id = ticket.participante_id;

  if claim.operation = 'edit' then
    update public.participantes
       set nome_completo = coalesce(claim.payload->>'nome_completo', nome_completo),
           email = coalesce(claim.payload->>'email', email),
           cpf = coalesce(claim.payload->>'cpf', cpf),
           telefone = coalesce(claim.payload->>'telefone', telefone),
           tem_empresa = case
             when claim.payload ? 'tem_empresa'
               then (claim.payload->>'tem_empresa')::boolean
             else tem_empresa
           end,
           nome_empresa = coalesce(claim.payload->>'nome_empresa', nome_empresa),
           cargo = coalesce(claim.payload->>'cargo', cargo),
           profissao = coalesce(
             claim.payload->>'profissao',
             claim.payload->>'empresa',
             profissao
           ),
           nicho = coalesce(claim.payload->>'nicho', nicho),
           num_funcionarios = coalesce(
             claim.payload->>'num_funcionarios',
             num_funcionarios
           ),
           faturamento_anual = coalesce(
             claim.payload->>'faturamento_anual',
             faturamento_anual
           ),
           areas_ajuda = case
             when jsonb_typeof(claim.payload->'areas_ajuda') = 'array'
               then claim.payload->'areas_ajuda'
             else areas_ajuda
           end,
           expectativa_aprendizado = coalesce(
             claim.payload->>'expectativa_aprendizado',
             expectativa_aprendizado
           ),
           expectativa_experiencia = coalesce(
             claim.payload->>'expectativa_experiencia',
             expectativa_experiencia
           ),
           ia_uso_diario = case
             when claim.payload ? 'ia_uso_diario'
               then nullif(claim.payload->>'ia_uso_diario', '')::integer
             else ia_uso_diario
           end,
           ia_profundidade = case
             when claim.payload ? 'ia_profundidade'
               then nullif(claim.payload->>'ia_profundidade', '')::integer
             else ia_profundidade
           end,
           ia_ferramentas = coalesce(claim.payload->>'ia_ferramentas', ia_ferramentas),
           ia_desafio = coalesce(claim.payload->>'ia_desafio', ia_desafio)
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
    select *
      into participant
      from public.participantes
     where id = participant_id;

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
      payload,
      metadata
    ) values (
      ticket.id,
      200,
      'MANUAL',
      'excluido_manual',
      'Ingresso ' || ticket.pedido_id || ' (' || ticket.tipo_ingresso ||
        ') excluido definitivamente.',
      jsonb_build_object(
        'acao', 'exclusao',
        'pedido_id', ticket.pedido_id,
        'tipo', ticket.tipo_ingresso,
        'participante', participant.nome_completo,
        'inac_id', coalesce(ticket.inac_id, ''),
        'inac_deleted', ticket.inac_id is not null,
        'actor', claim.actor
      )::text,
      jsonb_build_object(
        'actor', claim.actor,
        'claim_id', claim.id,
        'snapshot', to_jsonb(ticket) || jsonb_build_object('participante', to_jsonb(participant)),
        'provider_result', p_provider_result
      )
    );

    update public.ingressos
       set participante_id = null,
           status = 'Pendente',
           preenchido_em = null,
           status_webhook = 'pendente',
           inac_id = null,
           inac_qr = null
     where id = ticket.id;
    delete from public.participantes where id = participant_id;
    delete from public.ingressos where id = ticket.id;

    return jsonb_build_object(
      'success', true,
      'claimId', claim.id,
      'removed_participante', participant_id is not null,
      'inac_id_present', ticket.inac_id is not null,
      'snapshot', to_jsonb(ticket)
    );
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
    payload,
    metadata
  ) values (
    ticket.id,
    200,
    case when claim.actor like 'helpdesk:%' then 'HELPDESK' else 'MANUAL' end,
    case
      when claim.actor like 'helpdesk:%' and claim.operation = 'edit'
        then 'helpdesk_edicao'
      when claim.actor like 'helpdesk:%' and claim.operation = 'change_type'
        then 'helpdesk_tipo_alterado'
      when claim.operation = 'edit' then 'editado_manual'
      when claim.operation = 'change_type' then 'tipo_alterado'
      else 'ticket_' || claim.operation
    end,
    case
      when claim.operation = 'edit'
        then 'Ingresso ' || ticket.pedido_id || ' - dados editados por ' || claim.actor
      when claim.operation = 'change_type'
        then 'Ingresso ' || ticket.pedido_id || ' - tipo alterado de ' ||
          ticket.tipo_ingresso || ' para ' || coalesce(claim.payload->>'tipo', '') ||
          ' por ' || claim.actor
      else 'Operacao concluida por ' || claim.actor
    end,
    jsonb_build_object(
      'acao', claim.operation,
      'pedido_id', ticket.pedido_id,
      'actor', claim.actor,
      'antes', case
        when claim.operation = 'edit' then to_jsonb(participant)
        else jsonb_build_object('tipo', ticket.tipo_ingresso)
      end,
      'depois', claim.payload
    )::text,
    jsonb_build_object(
      'actor', claim.actor,
      'claim_id', claim.id,
      'payload', claim.payload,
      'provider_result', p_provider_result
    )
  );

  return jsonb_build_object('success', true, 'claimId', claim.id);
end;
$$;

create or replace function public.set_system_mode(
  p_mode text,
  p_user_id uuid,
  p_pocketbase_writes_blocked boolean default false,
  p_reason text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  state public.system_state;
  previous_state public.system_state;
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

  select * into previous_state
    from public.system_state
   where singleton
   for update;

  if p_mode = 'active' then
    if not p_pocketbase_writes_blocked then
      raise exception using errcode = 'P0001', message = 'POCKETBASE_WRITES_MUST_BE_BLOCKED';
    end if;
    if previous_state.bootstrap_state <> 'completed'
       or previous_state.sync_outbox_backlog <> 0
       or previous_state.last_sync_error is not null
       or previous_state.last_sync_poll_at is null
       or previous_state.last_sync_poll_at < now() - interval '90 seconds'
       or previous_state.last_reconciled_at is null
       or previous_state.last_reconciled_at < now() - interval '15 minutes'
       or exists (
         select 1
           from public.sync_events
          where state in ('received', 'failed')
       ) then
      raise exception using errcode = 'P0001', message = 'SYNC_NOT_READY_FOR_FAILOVER';
    end if;
  end if;

  update public.system_state
     set mode = p_mode,
         external_effects_enabled = false,
         activated_at = case when p_mode = 'active' then now() else activated_at end,
         activated_by = case when p_mode = 'active' then p_user_id else activated_by end,
         pocketbase_writes_blocked = p_pocketbase_writes_blocked
   where singleton
   returning * into state;

  insert into public.system_state_audit (
    user_id,
    action,
    previous_state,
    new_state,
    reason
  ) values (
    p_user_id,
    'mode_changed',
    to_jsonb(previous_state),
    to_jsonb(state),
    btrim(coalesce(p_reason, ''))
  );

  return to_jsonb(state);
end;
$$;

create or replace function public.set_external_effects(
  p_enabled boolean,
  p_user_id uuid,
  p_confirmation text default '',
  p_reason text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  state public.system_state;
  previous_state public.system_state;
begin
  if not exists (
    select 1
      from public.admin_profiles ap
     where ap.user_id = p_user_id
       and ap.active
       and ap.role = 'admin'
  ) then
    raise exception using errcode = '42501', message = 'ADMIN_REQUIRED';
  end if;

  select * into previous_state
    from public.system_state
   where singleton
   for update;

  if p_enabled then
    if p_confirmation <> 'HABILITAR COMUNICACOES' then
      raise exception using errcode = 'P0001', message = 'EXTERNAL_EFFECTS_CONFIRMATION_REQUIRED';
    end if;
    if btrim(coalesce(p_reason, '')) = '' then
      raise exception using errcode = 'P0001', message = 'EXTERNAL_EFFECTS_REASON_REQUIRED';
    end if;
    if previous_state.mode <> 'active'
       or not previous_state.pocketbase_writes_blocked
       or previous_state.bootstrap_state <> 'completed'
       or previous_state.sync_outbox_backlog <> 0
       or previous_state.last_sync_error is not null
       or previous_state.last_sync_poll_at is null
       or previous_state.last_sync_poll_at < now() - interval '90 seconds'
       or previous_state.last_reconciled_at is null
       or previous_state.last_reconciled_at < now() - interval '15 minutes'
       or exists (
         select 1
           from public.sync_events
          where state in ('received', 'failed')
       ) then
      raise exception using errcode = 'P0001', message = 'EXTERNAL_EFFECTS_PRECONDITIONS_FAILED';
    end if;
  end if;

  update public.system_state
     set external_effects_enabled = p_enabled
   where singleton
   returning * into state;

  insert into public.system_state_audit (
    user_id,
    action,
    previous_state,
    new_state,
    reason
  ) values (
    p_user_id,
    case when p_enabled then 'external_effects_enabled' else 'external_effects_disabled' end,
    to_jsonb(previous_state),
    to_jsonb(state),
    btrim(coalesce(p_reason, ''))
  );

  return to_jsonb(state);
end;
$$;
