-- Migration unit 1: schema_changes
-- Transaction mode: transactional
-- Boundary reason: default

SET check_function_bodies = false;

DROP FUNCTION public.process_guru_order(p_transaction_id text, p_email text, p_buyer jsonb, p_items jsonb, p_payload jsonb);

ALTER TABLE public.disparos
  DROP CONSTRAINT disparos_cluster_check;

CREATE FUNCTION private.unique_helpdesk_order_id()
  RETURNS text
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
declare
  alphabet constant text := '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  candidate text;
begin
  for attempt in 1..100 loop
    select 'H' || string_agg(
      substr(alphabet, 1 + floor(random() * length(alphabet))::integer, 1),
      ''
    )
      into candidate
      from generate_series(1, 6);
    if not exists (select 1 from public.ingressos where pedido_id = candidate) then
      return candidate;
    end if;
  end loop;
  raise exception using errcode = 'P0001', message = 'ORDER_ID_GENERATION_FAILED';
end;
$function$;

CREATE OR REPLACE FUNCTION public.claim_ticket_operation (
  p_ticket_id text,
  p_operation text,
  p_actor     text,
  p_payload   jsonb DEFAULT '{}'::jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.complete_ticket_operation (
  p_claim_id        uuid,
  p_success         boolean,
  p_provider_result jsonb   DEFAULT '{}'::jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
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
$function$;

CREATE FUNCTION public.create_helpdesk_credential (
  p_payload     jsonb,
  p_ticket_type text,
  p_operator    text,
  p_reason      text
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  buyer public.compradores;
  ticket public.ingressos;
  participant_result jsonb;
  normalized_email text := lower(btrim(coalesce(p_payload->>'email', '')));
  buyer_created boolean := false;
begin
  if p_ticket_type not in ('GOLD', 'PLATINUM', 'PALESTRANTES', 'HACKATHON') then
    raise exception using errcode = 'P0001', message = 'INVALID_TICKET_TYPE';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 5 then
    raise exception using errcode = 'P0001', message = 'REASON_REQUIRED';
  end if;

  select *
    into buyer
    from public.compradores
   where email_normalized = normalized_email
   for update;

  if buyer.id is null then
    insert into public.compradores (nome, email, documento, telefone)
    values (
      btrim(p_payload->>'nome_completo'),
      normalized_email,
      private.normalize_cpf(coalesce(p_payload->>'cpf', '')),
      coalesce(p_payload->>'telefone', '')
    )
    on conflict (email_normalized) do nothing
    returning * into buyer;
    buyer_created := buyer.id is not null;
    if buyer.id is null then
      select *
        into buyer
        from public.compradores
       where email_normalized = normalized_email
       for update;
    end if;
  end if;

  insert into public.ingressos (
    comprador_id,
    pedido_id,
    tipo_ingresso,
    status,
    status_webhook,
    origem
  ) values (
    buyer.id,
    private.unique_helpdesk_order_id(),
    p_ticket_type,
    'Pendente',
    'pendente',
    'helpdesk'
  )
  returning * into ticket;

  participant_result := private.create_participant_for_ticket(
    ticket.id,
    p_payload || jsonb_build_object('termsAccepted', true),
    'helpdesk:' || coalesce(nullif(btrim(p_operator), ''), 'nao identificado')
  );

  return participant_result || jsonb_build_object(
    'pedidoId', ticket.pedido_id,
    'tipoIngresso', ticket.tipo_ingresso,
    'buyerCreated', buyer_created,
    'buyerId', buyer.id
  );
end;
$function$;

GRANT ALL ON FUNCTION public.create_helpdesk_credential(jsonb, text, text, text) TO service_role;

CREATE FUNCTION public.delete_pending_ticket (
  p_ticket_id text,
  p_actor     text
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  ticket public.ingressos;
begin
  select *
    into ticket
    from public.ingressos
   where id = p_ticket_id
   for update;

  if ticket.id is null then
    raise exception using errcode = 'P0001', message = 'TICKET_NOT_FOUND';
  end if;
  if ticket.participante_id is not null or ticket.inac_id is not null then
    raise exception using errcode = 'P0001', message = 'TICKET_IS_CREDENTIALLED';
  end if;

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
      'actor', p_actor
    )::text,
    jsonb_build_object('actor', p_actor, 'snapshot', to_jsonb(ticket))
  );

  delete from public.ingressos where id = ticket.id;
  return jsonb_build_object(
    'success', true,
    'removed_participante', false,
    'inac_id_present', false,
    'inac_deleted', false
  );
end;
$function$;

GRANT ALL ON FUNCTION public.delete_pending_ticket(text, text) TO service_role;

CREATE FUNCTION public.helpdesk_search (
  p_query text
)
  RETURNS jsonb
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
  with input as (
    select
      lower(btrim(coalesce(p_query, ''))) as query,
      regexp_replace(coalesce(p_query, ''), '\D', '', 'g') as digits
  ),
  buyer_matches as (
    select c.id, row_number() over (order by c.created_at, c.id) as position
      from public.compradores c
      cross join input x
     where lower(c.nome) like '%' || x.query || '%'
        or lower(c.email) like '%' || x.query || '%'
        or (
          length(x.digits) >= 3
          and (
            private.normalize_cpf(c.documento) like '%' || x.digits || '%'
            or regexp_replace(c.telefone, '\D', '', 'g') like '%' || x.digits || '%'
          )
        )
     order by c.created_at, c.id
     limit 40
  ),
  ticket_matches as (
    select i.id, i.comprador_id, row_number() over (order by i.created_at, i.id) as position
      from public.ingressos i
      left join public.participantes p on p.id = i.participante_id
      cross join input x
     where lower(coalesce(p.nome_completo, '')) like '%' || x.query || '%'
        or lower(coalesce(p.email, '')) like '%' || x.query || '%'
        or lower(i.pedido_id) like '%' || x.query || '%'
        or (
          length(x.digits) >= 3
          and (
            coalesce(p.cpf_normalized, '') like '%' || x.digits || '%'
            or regexp_replace(coalesce(p.telefone, ''), '\D', '', 'g')
              like '%' || x.digits || '%'
          )
        )
     order by i.created_at, i.id
     limit 100
  ),
  buyer_order as (
    select id, min(position) as position
      from (
        select id, position from buyer_matches
        union all
        select comprador_id, 40 + position from ticket_matches
      ) matches
     group by id
     order by min(position)
     limit 25
  ),
  origin_events as (
    select distinct on (w.ingresso_id)
      w.ingresso_id,
      w.evento,
      coalesce(w.metadata->>'operador', '') as operador
    from public.webhooks_log w
    join public.ingressos i on i.id = w.ingresso_id
    join buyer_order bo on bo.id = i.comprador_id
    where w.evento in (
      'helpdesk_novo_credenciamento',
      'helpdesk_credenciamento',
      'checkin_manual_admin',
      'api_credenciamento'
    )
    order by w.ingresso_id, w.created_at
  ),
  tickets as (
    select
      i.*,
      p.id as part_id,
      p.nome_completo,
      p.email as participant_email,
      p.cpf,
      p.telefone as participant_phone,
      p.nome_empresa,
      p.profissao,
      bm.id is not null as buyer_match,
      tm.id is not null as ticket_match,
      case
        when oe.evento = 'helpdesk_novo_credenciamento'
          then 'Criado do zero no balcão'
        when oe.evento = 'helpdesk_credenciamento'
          then 'Check-in feito no balcão'
        when oe.evento = 'checkin_manual_admin'
          then 'Check-in feito à mão no admin'
        when oe.evento = 'api_credenciamento'
          then 'Check-in feito pela API externa'
        when i.origem = 'cortesia' then 'Ingresso de cortesia'
        when i.origem = 'reconciliacao' then 'Ingresso criado na reconciliação'
        when i.origem = 'api-externa' then 'Ingresso criado pela API externa'
        when i.origem = 'helpdesk' then 'Ingresso criado no balcão'
        when p.id is not null then 'Preenchido pela própria pessoa'
        else ''
      end ||
      case
        when oe.operador <> '' and oe.evento is not null then ' por ' || oe.operador
        else ''
      end as origem_info
    from public.ingressos i
    join buyer_order bo on bo.id = i.comprador_id
    left join public.participantes p on p.id = i.participante_id
    left join buyer_matches bm on bm.id = i.comprador_id
    left join ticket_matches tm on tm.id = i.id
    left join origin_events oe on oe.ingresso_id = i.id
  ),
  buyers as (
    select
      c.*,
      bo.position,
      bm.id is not null as buyer_match
    from buyer_order bo
    join public.compradores c on c.id = bo.id
    left join buyer_matches bm on bm.id = c.id
  )
  select jsonb_build_object(
    'ok', true,
    'compradores',
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', b.id,
          'nome', b.nome,
          'email', b.email,
          'documento', b.documento,
          'telefone', b.telefone,
          'match_comprador', b.buyer_match,
          'total_ingressos', (select count(*) from tickets t where t.comprador_id = b.id),
          'ingressos_encontrados', (
            select count(*) from tickets t
             where t.comprador_id = b.id and (t.buyer_match or t.ticket_match)
          ),
          'ingressos', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'id', t.id,
                'pedido_id', t.pedido_id,
                'tipo_ingresso', t.tipo_ingresso,
                'status', t.status,
                'credenciado', t.inac_id is not null,
                'tem_qr', t.inac_qr is not null and t.inac_qr <> '',
                'status_webhook', t.status_webhook,
                'origem', t.origem,
                'match', t.buyer_match or t.ticket_match,
                'origem_info', t.origem_info,
                'participante', case
                  when t.part_id is null then null
                  else jsonb_build_object(
                    'id', t.part_id,
                    'nome_completo', t.nome_completo,
                    'email', t.participant_email,
                    'cpf', t.cpf,
                    'telefone', t.participant_phone,
                    'empresa', coalesce(nullif(t.nome_empresa, ''), t.profissao, '')
                  )
                end
              )
              order by t.created_at, t.id
            )
            from tickets t
            where t.comprador_id = b.id
          ), '[]'::jsonb)
        )
        order by b.position
      ),
      '[]'::jsonb
    )
  )
  from buyers b;
$function$;

GRANT ALL ON FUNCTION public.helpdesk_search(text) TO service_role;

CREATE FUNCTION public.process_guru_order (
  p_transaction_id text,
  p_email          text,
  p_buyer          jsonb,
  p_items          jsonb,
  p_payload        jsonb,
  p_template_id    text  DEFAULT ''::text,
  p_template_name  text  DEFAULT 'Skip-Summit26-Send-Comprador'::text
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  buyer public.compradores;
  order_item jsonb;
  ticket public.ingressos;
  quantity integer;
  ticket_type text;
  total_tickets integer := 0;
  dispatch public.disparos;
  email_state text := 'sem_ingresso';
  email_enqueued boolean := false;
begin
  if exists (
    select 1 from public.pedidos_guru where transacao_id = p_transaction_id
  ) then
    return jsonb_build_object('duplicate', true, 'transacao_id', p_transaction_id);
  end if;

  select *
    into buyer
    from public.compradores
   where email_normalized = lower(btrim(p_email))
   for update;

  if buyer.id is null then
    insert into public.compradores (
      nome,
      email,
      documento,
      uf,
      cidade,
      telefone
    ) values (
        coalesce(nullif(p_buyer->>'nome', ''), lower(btrim(p_email))),
      lower(btrim(p_email)),
      coalesce(p_buyer->>'documento', ''),
      coalesce(p_buyer->>'uf', ''),
      coalesce(p_buyer->>'cidade', ''),
      coalesce(p_buyer->>'telefone', '')
    )
    returning * into buyer;
  else
    update public.compradores
       set nome = coalesce(nullif(p_buyer->>'nome', ''), nome),
           documento = coalesce(nullif(p_buyer->>'documento', ''), documento),
           uf = coalesce(nullif(p_buyer->>'uf', ''), uf),
           cidade = coalesce(nullif(p_buyer->>'cidade', ''), cidade),
           telefone = coalesce(nullif(p_buyer->>'telefone', ''), telefone)
     where id = buyer.id
    returning * into buyer;
  end if;

  for order_item in
    select value from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    ticket_type := order_item->>'type';
    quantity := least(greatest(coalesce((order_item->>'quantity')::integer, 1), 1), 100);
    if ticket_type not in ('GOLD', 'PLATINUM') then
      continue;
    end if;
    for item_index in 1..quantity loop
      insert into public.ingressos (
        comprador_id,
        pedido_id,
        tipo_ingresso,
        status,
        status_webhook,
        origem
      ) values (
        buyer.id,
        private.unique_order_id(''),
        ticket_type,
        'Pendente',
        'pendente',
        'guru'
      )
      returning * into ticket;

      insert into public.links_participante (ingresso_id, token, expira_em)
      values (
        ticket.id,
        encode(extensions.gen_random_bytes(32), 'hex'),
        now() + interval '1 year'
      );
      total_tickets := total_tickets + 1;
    end loop;
  end loop;

  if total_tickets > 0 then
    if coalesce(p_template_id, '') = '' then
      email_state := 'sem_template';
    elsif buyer.acesso_status in ('na_fila', 'enviando', 'enviado') then
      email_state := 'ja_enviado';
    else
      select *
        into dispatch
        from public.disparos
       where cluster = 'guru'
       for update;

      if dispatch.id is null then
        insert into public.disparos (
          template_id,
          template_nome,
          cluster,
          nome,
          audience,
          total,
          status
        ) values (
          p_template_id,
          coalesce(nullif(p_template_name, ''), 'Guru - acesso automatico'),
          'guru',
          'Guru - acesso automatico',
          'compradores',
          0,
          'em_andamento'
        )
        returning * into dispatch;
      end if;

      update public.disparos
         set template_id = p_template_id,
             template_nome = coalesce(nullif(p_template_name, ''), template_nome),
             total = total + 1,
             status = 'em_andamento'
       where id = dispatch.id;

      insert into public.envios (
        disparo_id,
        comprador_id,
        nome,
        email,
        status
      ) values (
        dispatch.id,
        buyer.id,
        buyer.nome,
        buyer.email,
        'na_fila'
      );

      update public.compradores
         set acesso_status = 'na_fila',
             acesso_disparo_id = dispatch.id,
             acesso_template_id = p_template_id,
             acesso_tentativas = 0,
             acesso_erro = null,
             acesso_claim = null
       where id = buyer.id;

      email_state := 'enfileirado';
      email_enqueued := true;
    end if;
  end if;

  insert into public.pedidos_guru (
    transacao_id,
    status,
    email,
    comprador_id,
    ingressos,
    email_status,
    payload
  ) values (
    p_transaction_id,
    'approved',
    lower(btrim(p_email)),
    buyer.id,
    total_tickets,
    email_state,
    p_payload
  );

  return jsonb_build_object(
    'duplicate', false,
    'transacao_id', p_transaction_id,
    'comprador_id', buyer.id,
    'ingressos', total_tickets,
    'nome', buyer.nome,
    'email', buyer.email,
    'email_status', email_state,
    'email_enfileirado', email_enqueued
  );
end;
$function$;

GRANT ALL ON FUNCTION public.process_guru_order(text, text, jsonb, jsonb, jsonb, text, text) TO service_role;

ALTER TABLE public.disparos
  ADD CONSTRAINT disparos_cluster_check
    CHECK (cluster = ANY (ARRAY['todos'::text, 'pendentes'::text, 'participantes_todos'::text, 'participantes_recentes'::text, 'individual'::text, 'guru'::text]));

CREATE UNIQUE INDEX disparos_guru_unique ON public.disparos (cluster)
  WHERE cluster = 'guru'::text;
