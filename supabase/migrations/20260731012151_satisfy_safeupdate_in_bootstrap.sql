-- Migration unit 1: schema_changes
-- Transaction mode: transactional
-- Boundary reason: default

SET check_function_bodies = false;

CREATE OR REPLACE FUNCTION private.buyer_for_token (
  p_token text
)
  RETURNS public.compradores
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION private.create_participant_for_ticket (
  p_ticket_id text,
  p_payload   jsonb,
  p_actor     text
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
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

CREATE OR REPLACE FUNCTION public.consume_buyer_token (
  p_token text
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.create_participant_link (
  p_buyer_token text,
  p_ticket_id   text,
  p_expires_at  timestamp with time zone DEFAULT (now() + '1 day'::interval)
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.credential_ticket (
  p_ticket_id text,
  p_payload   jsonb,
  p_actor     text
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
  return private.create_participant_for_ticket(
    p_ticket_id,
    p_payload || jsonb_build_object('termsAccepted', true),
    p_actor
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.finalize_sync_bootstrap (
  p_run_id uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  bootstrap public.sync_bootstrap_runs;
  table_name text;
  expected_count integer;
  actual_count integer;
  applied_count integer := 0;
  affected_count integer := 0;
  repaired_link_count integer := 0;
  collection_names constant text[] := array[
    'compradores',
    'ingressos',
    'participantes'
  ];
begin
  select * into bootstrap
    from public.sync_bootstrap_runs
   where id = p_run_id
   for update;

  if bootstrap.id is null then
    raise exception using errcode = 'P0001', message = 'BOOTSTRAP_RUN_NOT_FOUND';
  end if;
  if bootstrap.state <> 'ready' then
    raise exception using errcode = 'P0001', message = 'BOOTSTRAP_NOT_READY';
  end if;
  if (select mode from public.system_state where singleton) <> 'standby'
     or (select pocketbase_writes_blocked from public.system_state where singleton) then
    raise exception using errcode = 'P0001', message = 'SYNC_DISABLED';
  end if;

  foreach table_name in array collection_names
  loop
    expected_count := coalesce((bootstrap.counts->>table_name)::integer, 0);
    select count(*) into actual_count
      from public.sync_bootstrap_rows r
     where r.run_id = p_run_id
       and r.source_table = table_name;
    if actual_count <> expected_count then
      raise exception using
        errcode = 'P0001',
        message = format(
          'BOOTSTRAP_COUNT_MISMATCH:%s:%s:%s',
          table_name,
          expected_count,
          actual_count
        );
    end if;
  end loop;

  if exists (
    select 1
      from public.sync_bootstrap_rows ticket
     where ticket.run_id = p_run_id
       and ticket.source_table = 'ingressos'
       and not exists (
         select 1
           from public.sync_bootstrap_rows buyer
          where buyer.run_id = p_run_id
            and buyer.source_table = 'compradores'
            and buyer.record_id = ticket.payload->>'comprador_id'
       )
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'BOOTSTRAP_ORPHAN_INGRESSO';
  end if;

  if exists (
    select 1
      from public.sync_bootstrap_rows participant
     where participant.run_id = p_run_id
       and participant.source_table = 'participantes'
       and not exists (
         select 1
           from public.sync_bootstrap_rows ticket
          where ticket.run_id = p_run_id
            and ticket.source_table = 'ingressos'
            and ticket.record_id = participant.payload->>'ingresso_id'
       )
  ) or exists (
    select 1
      from public.sync_bootstrap_rows participant
     where participant.run_id = p_run_id
       and participant.source_table = 'participantes'
     group by participant.payload->>'ingresso_id'
    having count(*) > 1
  ) or exists (
    select 1
      from public.sync_bootstrap_rows ticket
     where ticket.run_id = p_run_id
       and ticket.source_table = 'ingressos'
       and coalesce(ticket.payload->>'participante_id', '') <> ''
       and not exists (
         select 1
           from public.sync_bootstrap_rows participant
          where participant.run_id = p_run_id
            and participant.source_table = 'participantes'
            and participant.record_id = ticket.payload->>'participante_id'
            and participant.payload->>'ingresso_id' = ticket.record_id
       )
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'BOOTSTRAP_PARTICIPANT_LINK_MISMATCH';
  end if;

  select count(*) into repaired_link_count
    from public.sync_bootstrap_rows participant
    join public.sync_bootstrap_rows ticket
      on ticket.run_id = p_run_id
     and ticket.source_table = 'ingressos'
     and ticket.record_id = participant.payload->>'ingresso_id'
   where participant.run_id = p_run_id
     and participant.source_table = 'participantes'
     and coalesce(ticket.payload->>'participante_id', '') <> participant.record_id;

  update public.sync_bootstrap_runs
     set state = 'applying',
         error = null
   where id = p_run_id;
  update public.system_state
     set bootstrap_state = 'applying',
         external_effects_enabled = false,
         last_sync_error = null
   where singleton;

  set constraints all deferred;
  perform set_config('app.sync_apply', 'true', true);

  delete from public.sync_tombstones
   where source_table = any(collection_names);

  update public.ingressos
     set participante_id = null,
         status = 'Pendente',
         preenchido_em = null
   where true;

  delete from public.participantes participant
   where not exists (
     select 1
       from public.sync_bootstrap_rows staged
      where staged.run_id = p_run_id
        and staged.source_table = 'participantes'
        and staged.record_id = participant.id
   );
  get diagnostics affected_count = row_count;
  applied_count := applied_count + affected_count;

  insert into public.compradores (
    id,
    nome,
    email,
    documento,
    uf,
    cidade,
    telefone,
    acesso_status,
    acesso_template_id,
    acesso_enviado_em,
    acesso_tentativas,
    acesso_erro,
    acesso_disparo_id,
    acesso_claim,
    wa_status,
    wa_disparo_id,
    wa_tentativas,
    wa_erro,
    wa_claim,
    wa_enviado_em,
    created_at,
    updated_at
  )
  select
    staged.record_id,
    staged.payload->>'nome',
    staged.payload->>'email',
    coalesce(staged.payload->>'documento', ''),
    coalesce(staged.payload->>'uf', ''),
    coalesce(staged.payload->>'cidade', ''),
    coalesce(staged.payload->>'telefone', ''),
    nullif(staged.payload->>'acesso_status', ''),
    nullif(staged.payload->>'acesso_template_id', ''),
    nullif(staged.payload->>'acesso_enviado_em', '')::timestamptz,
    coalesce(nullif(staged.payload->>'acesso_tentativas', '')::integer, 0),
    nullif(staged.payload->>'acesso_erro', ''),
    nullif(staged.payload->>'acesso_disparo_id', ''),
    nullif(staged.payload->>'acesso_claim', ''),
    nullif(staged.payload->>'wa_status', ''),
    nullif(staged.payload->>'wa_disparo_id', ''),
    coalesce(nullif(staged.payload->>'wa_tentativas', '')::integer, 0),
    nullif(staged.payload->>'wa_erro', ''),
    nullif(staged.payload->>'wa_claim', ''),
    nullif(staged.payload->>'wa_enviado_em', '')::timestamptz,
    private.json_timestamp(staged.payload, 'created_at', staged.source_updated_at),
    staged.source_updated_at
  from public.sync_bootstrap_rows staged
  where staged.run_id = p_run_id
    and staged.source_table = 'compradores'
  on conflict (id) do update set
    nome = excluded.nome,
    email = excluded.email,
    documento = excluded.documento,
    uf = excluded.uf,
    cidade = excluded.cidade,
    telefone = excluded.telefone,
    acesso_status = excluded.acesso_status,
    acesso_template_id = excluded.acesso_template_id,
    acesso_enviado_em = excluded.acesso_enviado_em,
    acesso_tentativas = excluded.acesso_tentativas,
    acesso_erro = excluded.acesso_erro,
    acesso_disparo_id = excluded.acesso_disparo_id,
    acesso_claim = excluded.acesso_claim,
    wa_status = excluded.wa_status,
    wa_disparo_id = excluded.wa_disparo_id,
    wa_tentativas = excluded.wa_tentativas,
    wa_erro = excluded.wa_erro,
    wa_claim = excluded.wa_claim,
    wa_enviado_em = excluded.wa_enviado_em,
    created_at = excluded.created_at,
    updated_at = excluded.updated_at;
  get diagnostics affected_count = row_count;
  applied_count := applied_count + affected_count;

  insert into public.ingressos (
    id,
    comprador_id,
    pedido_id,
    status,
    participante_id,
    preenchido_em,
    tipo_ingresso,
    status_webhook,
    inac_id,
    inac_qr,
    origem,
    cortesia_id,
    created_at,
    updated_at
  )
  select
    staged.record_id,
    staged.payload->>'comprador_id',
    staged.payload->>'pedido_id',
    'Pendente',
    null,
    null,
    coalesce(nullif(staged.payload->>'tipo_ingresso', ''), 'GOLD'),
    coalesce(nullif(staged.payload->>'status_webhook', ''), 'pendente'),
    nullif(staged.payload->>'inac_id', ''),
    nullif(staged.payload->>'inac_qr', ''),
    coalesce(nullif(staged.payload->>'origem', ''), 'pocketbase'),
    nullif(staged.payload->>'cortesia_id', ''),
    private.json_timestamp(staged.payload, 'created_at', staged.source_updated_at),
    staged.source_updated_at
  from public.sync_bootstrap_rows staged
  where staged.run_id = p_run_id
    and staged.source_table = 'ingressos'
  on conflict (id) do update set
    comprador_id = excluded.comprador_id,
    pedido_id = excluded.pedido_id,
    status = excluded.status,
    participante_id = excluded.participante_id,
    preenchido_em = excluded.preenchido_em,
    tipo_ingresso = excluded.tipo_ingresso,
    status_webhook = excluded.status_webhook,
    inac_id = excluded.inac_id,
    inac_qr = excluded.inac_qr,
    origem = excluded.origem,
    cortesia_id = excluded.cortesia_id,
    created_at = excluded.created_at,
    updated_at = excluded.updated_at;
  get diagnostics affected_count = row_count;
  applied_count := applied_count + affected_count;

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
    acesso_status,
    acesso_disparo_id,
    acesso_template_id,
    acesso_enviado_em,
    acesso_tentativas,
    acesso_erro,
    acesso_claim,
    ia_uso_diario,
    ia_profundidade,
    ia_ferramentas,
    ia_desafio,
    tem_empresa,
    profissao,
    terms_accepted_at,
    created_at,
    updated_at
  )
  select
    staged.record_id,
    staged.payload->>'ingresso_id',
    staged.payload->>'nome_completo',
    staged.payload->>'email',
    staged.payload->>'cpf',
    coalesce(staged.payload->>'telefone', ''),
    coalesce(staged.payload->>'nome_empresa', ''),
    coalesce(staged.payload->>'cargo', ''),
    coalesce(staged.payload->>'nicho', ''),
    coalesce(staged.payload->>'num_funcionarios', ''),
    coalesce(staged.payload->>'faturamento_anual', ''),
    case
      when jsonb_typeof(staged.payload->'areas_ajuda') = 'array'
        then staged.payload->'areas_ajuda'
      else '[]'::jsonb
    end,
    coalesce(staged.payload->>'expectativa_aprendizado', ''),
    coalesce(staged.payload->>'expectativa_experiencia', ''),
    nullif(staged.payload->>'acesso_status', ''),
    nullif(staged.payload->>'acesso_disparo_id', ''),
    nullif(staged.payload->>'acesso_template_id', ''),
    nullif(staged.payload->>'acesso_enviado_em', '')::timestamptz,
    coalesce(nullif(staged.payload->>'acesso_tentativas', '')::integer, 0),
    nullif(staged.payload->>'acesso_erro', ''),
    nullif(staged.payload->>'acesso_claim', ''),
    nullif(staged.payload->>'ia_uso_diario', '')::integer,
    nullif(staged.payload->>'ia_profundidade', '')::integer,
    coalesce(staged.payload->>'ia_ferramentas', ''),
    coalesce(staged.payload->>'ia_desafio', ''),
    nullif(staged.payload->>'tem_empresa', '')::boolean,
    coalesce(staged.payload->>'profissao', ''),
    coalesce(
      nullif(staged.payload->>'terms_accepted_at', '')::timestamptz,
      staged.source_updated_at
    ),
    private.json_timestamp(staged.payload, 'created_at', staged.source_updated_at),
    staged.source_updated_at
  from public.sync_bootstrap_rows staged
  where staged.run_id = p_run_id
    and staged.source_table = 'participantes'
  on conflict (id) do update set
    ingresso_id = excluded.ingresso_id,
    nome_completo = excluded.nome_completo,
    email = excluded.email,
    cpf = excluded.cpf,
    telefone = excluded.telefone,
    nome_empresa = excluded.nome_empresa,
    cargo = excluded.cargo,
    nicho = excluded.nicho,
    num_funcionarios = excluded.num_funcionarios,
    faturamento_anual = excluded.faturamento_anual,
    areas_ajuda = excluded.areas_ajuda,
    expectativa_aprendizado = excluded.expectativa_aprendizado,
    expectativa_experiencia = excluded.expectativa_experiencia,
    acesso_status = excluded.acesso_status,
    acesso_disparo_id = excluded.acesso_disparo_id,
    acesso_template_id = excluded.acesso_template_id,
    acesso_enviado_em = excluded.acesso_enviado_em,
    acesso_tentativas = excluded.acesso_tentativas,
    acesso_erro = excluded.acesso_erro,
    acesso_claim = excluded.acesso_claim,
    ia_uso_diario = excluded.ia_uso_diario,
    ia_profundidade = excluded.ia_profundidade,
    ia_ferramentas = excluded.ia_ferramentas,
    ia_desafio = excluded.ia_desafio,
    tem_empresa = excluded.tem_empresa,
    profissao = excluded.profissao,
    terms_accepted_at = excluded.terms_accepted_at,
    created_at = excluded.created_at,
    updated_at = excluded.updated_at;
  get diagnostics affected_count = row_count;
  applied_count := applied_count + affected_count;

  delete from public.ingressos ticket
   where not exists (
     select 1
       from public.sync_bootstrap_rows staged
      where staged.run_id = p_run_id
        and staged.source_table = 'ingressos'
        and staged.record_id = ticket.id
   );
  get diagnostics affected_count = row_count;
  applied_count := applied_count + affected_count;

  delete from public.compradores buyer
   where not exists (
     select 1
       from public.sync_bootstrap_rows staged
      where staged.run_id = p_run_id
        and staged.source_table = 'compradores'
        and staged.record_id = buyer.id
   );
  get diagnostics affected_count = row_count;
  applied_count := applied_count + affected_count;

  update public.ingressos ticket
     set comprador_id = staged.payload->>'comprador_id',
         pedido_id = staged.payload->>'pedido_id',
         status = case
           when participant.record_id is null then 'Pendente'
           else 'Pré-Credenciado'
         end,
         participante_id = participant.record_id,
         preenchido_em = case
           when participant.record_id is null then null
           else nullif(staged.payload->>'preenchido_em', '')::timestamptz
         end,
         tipo_ingresso = coalesce(nullif(staged.payload->>'tipo_ingresso', ''), 'GOLD'),
         status_webhook = coalesce(nullif(staged.payload->>'status_webhook', ''), 'pendente'),
         inac_id = nullif(staged.payload->>'inac_id', ''),
         inac_qr = nullif(staged.payload->>'inac_qr', ''),
         origem = coalesce(nullif(staged.payload->>'origem', ''), 'pocketbase'),
         cortesia_id = nullif(staged.payload->>'cortesia_id', ''),
         created_at = private.json_timestamp(
           staged.payload,
           'created_at',
           staged.source_updated_at
         ),
         updated_at = staged.source_updated_at
    from public.sync_bootstrap_rows staged
    left join public.sync_bootstrap_rows participant
      on participant.run_id = staged.run_id
     and participant.source_table = 'participantes'
     and participant.payload->>'ingresso_id' = staged.record_id
   where staged.run_id = p_run_id
     and staged.source_table = 'ingressos'
     and ticket.id = staged.record_id;
  get diagnostics affected_count = row_count;
  applied_count := applied_count + affected_count;

  foreach table_name in array collection_names
  loop
    expected_count := coalesce((bootstrap.counts->>table_name)::integer, 0);
    if table_name = 'compradores' then
      select count(*) into actual_count from public.compradores;
    elsif table_name = 'ingressos' then
      select count(*) into actual_count from public.ingressos;
    else
      select count(*) into actual_count from public.participantes;
    end if;
    if actual_count <> expected_count then
      raise exception using
        errcode = 'P0001',
        message = format(
          'BOOTSTRAP_FINAL_COUNT_MISMATCH:%s:%s:%s',
          table_name,
          expected_count,
          actual_count
        );
    end if;
  end loop;

  if exists (
    select 1
      from public.ingressos ticket
      left join public.compradores buyer on buyer.id = ticket.comprador_id
     where buyer.id is null
  ) or exists (
    select 1
      from public.participantes participant
      join public.ingressos ticket on ticket.id = participant.ingresso_id
     where ticket.participante_id is distinct from participant.id
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'BOOTSTRAP_FINAL_RELATION_MISMATCH';
  end if;

  update public.sync_bootstrap_runs
     set state = 'completed',
         applied_at = now(),
         error = null
   where id = p_run_id;
  update public.system_state
     set bootstrap_state = 'completed',
         last_reconciled_at = now(),
         last_sync_error = null,
         metadata = jsonb_set(metadata, '{bootstrap_counts}', bootstrap.counts, true)
   where singleton;

  return jsonb_build_object(
    'run_id', p_run_id,
    'state', 'completed',
    'counts', bootstrap.counts,
    'applied_events', applied_count,
    'repaired_participant_links', repaired_link_count
  );
exception
  when others then
    update public.sync_bootstrap_runs
       set state = 'failed',
           error = left(sqlerrm, 2000)
     where id = p_run_id;
    update public.system_state
       set bootstrap_state = 'failed',
           last_sync_error = left(sqlerrm, 2000),
           external_effects_enabled = false
     where singleton;
    return jsonb_build_object(
      'run_id', p_run_id,
      'state', 'failed',
      'error', sqlerrm
    );
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_buyer_tickets (
  p_token text
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.get_participant_link (
  p_token text
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.set_system_mode (
  p_mode                      text,
  p_user_id                   uuid,
  p_pocketbase_writes_blocked boolean DEFAULT false,
  p_reason                    text    DEFAULT ''::text
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
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
           from public.sync_events sync_event
          where sync_event.state in ('received', 'failed')
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
$function$;

CREATE OR REPLACE FUNCTION public.submit_participant (
  p_link_token text,
  p_payload    jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
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
$function$;