-- Migration unit 1: schema_changes
-- Transaction mode: transactional
-- Boundary reason: default

SET check_function_bodies = false;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLES FROM anon;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE UPDATE ON SEQUENCES FROM anon;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLES FROM authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE UPDATE ON SEQUENCES FROM authenticated;

CREATE SCHEMA private AUTHORIZATION postgres;

GRANT USAGE ON SCHEMA private TO service_role;

CREATE FUNCTION private.create_participant_for_ticket (
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

CREATE FUNCTION private.expire_ticket_operation_claims()
  RETURNS void
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
  update public.ticket_operation_claims
     set state = 'expired',
         completed_at = now()
   where state = 'claimed'
     and expires_at <= now();
$function$;

CREATE FUNCTION private.json_timestamp (
  p_payload     jsonb,
  p_primary_key text,
  p_fallback    timestamp with time zone
)
  RETURNS timestamp WITH time zone
  LANGUAGE sql
  IMMUTABLE
  SET search_path TO ''
  AS $function$
  select coalesce(
    nullif(p_payload->>p_primary_key, '')::timestamptz,
    p_fallback
  );
$function$;

CREATE FUNCTION private.new_text_id()
  RETURNS text
  LANGUAGE sql
  SET search_path TO ''
  AS $function$
  select replace(gen_random_uuid()::text, '-', '');
$function$;

CREATE FUNCTION private.normalize_cpf (
  value text
)
  RETURNS text
  LANGUAGE sql
  IMMUTABLE
  STRICT
  SET search_path TO ''
  AS $function$
  select regexp_replace(value, '[^0-9]', '', 'g');
$function$;

CREATE FUNCTION private.set_updated_at()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
begin
  if coalesce(current_setting('app.sync_apply', true), '') <> 'true' then
    new.updated_at = now();
  end if;
  return new;
end;
$function$;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT DELETE, INSERT, SELECT, UPDATE ON TABLES TO service_role;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT SELECT, USAGE ON SEQUENCES TO service_role;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON ROUTINES TO service_role;

CREATE FUNCTION public.apply_sync_event (
  p_event jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  v_event_id text := p_event->>'event_id';
  v_table text := p_event->>'table';
  v_record_id text := p_event->>'record_id';
  v_operation text := p_event->>'operation';
  v_payload jsonb := coalesce(p_event->'payload', '{}'::jsonb);
  v_source_updated_at timestamptz :=
    coalesce(nullif(p_event->>'source_updated_at', '')::timestamptz, now());
  v_current_updated_at timestamptz;
  v_inserted integer;
begin
  if (select mode from public.system_state where singleton) <> 'standby'
     or (select pocketbase_writes_blocked from public.system_state where singleton) then
    raise exception using errcode = 'P0001', message = 'SYNC_DISABLED';
  end if;

  if v_event_id is null
     or v_record_id is null
     or v_table not in (
       'compradores',
       'ingressos',
       'participantes',
       'tokens_acesso',
       'links_participante',
       'webhooks_log'
     )
     or v_operation not in ('create', 'update', 'delete') then
    raise exception using errcode = 'P0001', message = 'INVALID_SYNC_EVENT';
  end if;

  insert into public.sync_events (
    event_id,
    source_table,
    record_id,
    operation,
    payload,
    source_updated_at
  ) values (
    v_event_id,
    v_table,
    v_record_id,
    v_operation,
    v_payload,
    v_source_updated_at
  )
  on conflict (event_id) do nothing;

  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then
    return jsonb_build_object('eventId', v_event_id, 'state', 'duplicate');
  end if;

  if exists (
    select 1
      from public.sync_tombstones t
     where t.source_table = v_table
       and t.record_id = v_record_id
       and t.source_updated_at >= v_source_updated_at
  ) then
    update public.sync_events
       set state = 'ignored',
           applied_at = now()
     where event_id = v_event_id;
    return jsonb_build_object('eventId', v_event_id, 'state', 'ignored');
  end if;

  if v_table = 'compradores' then
    select updated_at into v_current_updated_at
      from public.compradores where id = v_record_id;
  elsif v_table = 'ingressos' then
    select updated_at into v_current_updated_at
      from public.ingressos where id = v_record_id;
  elsif v_table = 'participantes' then
    select updated_at into v_current_updated_at
      from public.participantes where id = v_record_id;
  elsif v_table = 'tokens_acesso' then
    select updated_at into v_current_updated_at
      from public.tokens_acesso where id = v_record_id;
  elsif v_table = 'links_participante' then
    select updated_at into v_current_updated_at
      from public.links_participante where id = v_record_id;
  else
    select updated_at into v_current_updated_at
      from public.webhooks_log where id = v_record_id;
  end if;

  if v_current_updated_at is not null and v_current_updated_at > v_source_updated_at then
    update public.sync_events
       set state = 'ignored',
           applied_at = now()
     where event_id = v_event_id;
    return jsonb_build_object('eventId', v_event_id, 'state', 'ignored');
  end if;

  perform set_config('app.sync_apply', 'true', true);

  if v_operation = 'delete' then
    insert into public.sync_tombstones (
      source_table,
      record_id,
      source_updated_at,
      event_id
    ) values (
      v_table,
      v_record_id,
      v_source_updated_at,
      v_event_id
    )
    on conflict (source_table, record_id) do update
      set source_updated_at = excluded.source_updated_at,
          event_id = excluded.event_id
      where excluded.source_updated_at > public.sync_tombstones.source_updated_at;

    if v_table = 'webhooks_log' then
      delete from public.webhooks_log where id = v_record_id;
    elsif v_table = 'links_participante' then
      delete from public.links_participante where id = v_record_id;
    elsif v_table = 'tokens_acesso' then
      delete from public.tokens_acesso where id = v_record_id;
    elsif v_table = 'participantes' then
      update public.ingressos
         set participante_id = null,
             status = 'Pendente',
             preenchido_em = null
       where participante_id = v_record_id;
      delete from public.participantes where id = v_record_id;
    elsif v_table = 'ingressos' then
      delete from public.ingressos where id = v_record_id;
    elsif v_table = 'compradores' then
      delete from public.compradores where id = v_record_id;
    end if;
  elsif v_table = 'compradores' then
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
    ) values (
      v_record_id,
      v_payload->>'nome',
      v_payload->>'email',
      coalesce(v_payload->>'documento', ''),
      coalesce(v_payload->>'uf', ''),
      coalesce(v_payload->>'cidade', ''),
      coalesce(v_payload->>'telefone', ''),
      nullif(v_payload->>'acesso_status', ''),
      nullif(v_payload->>'acesso_template_id', ''),
      nullif(v_payload->>'acesso_enviado_em', '')::timestamptz,
      coalesce(nullif(v_payload->>'acesso_tentativas', '')::integer, 0),
      nullif(v_payload->>'acesso_erro', ''),
      nullif(v_payload->>'acesso_disparo_id', ''),
      nullif(v_payload->>'acesso_claim', ''),
      nullif(v_payload->>'wa_status', ''),
      nullif(v_payload->>'wa_disparo_id', ''),
      coalesce(nullif(v_payload->>'wa_tentativas', '')::integer, 0),
      nullif(v_payload->>'wa_erro', ''),
      nullif(v_payload->>'wa_claim', ''),
      nullif(v_payload->>'wa_enviado_em', '')::timestamptz,
      private.json_timestamp(v_payload, 'created_at', v_source_updated_at),
      v_source_updated_at
    )
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
      updated_at = excluded.updated_at;
  elsif v_table = 'ingressos' then
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
    ) values (
      v_record_id,
      v_payload->>'comprador_id',
      v_payload->>'pedido_id',
      coalesce(nullif(v_payload->>'status', ''), 'Pendente'),
      nullif(v_payload->>'participante_id', ''),
      nullif(v_payload->>'preenchido_em', '')::timestamptz,
      coalesce(nullif(v_payload->>'tipo_ingresso', ''), 'GOLD'),
      coalesce(nullif(v_payload->>'status_webhook', ''), 'pendente'),
      nullif(v_payload->>'inac_id', ''),
      nullif(v_payload->>'inac_qr', ''),
      coalesce(nullif(v_payload->>'origem', ''), 'pocketbase'),
      nullif(v_payload->>'cortesia_id', ''),
      private.json_timestamp(v_payload, 'created_at', v_source_updated_at),
      v_source_updated_at
    )
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
      updated_at = excluded.updated_at;
  elsif v_table = 'participantes' then
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
    ) values (
      v_record_id,
      v_payload->>'ingresso_id',
      v_payload->>'nome_completo',
      v_payload->>'email',
      v_payload->>'cpf',
      coalesce(v_payload->>'telefone', ''),
      coalesce(v_payload->>'nome_empresa', ''),
      coalesce(v_payload->>'cargo', ''),
      coalesce(v_payload->>'nicho', ''),
      coalesce(v_payload->>'num_funcionarios', ''),
      coalesce(v_payload->>'faturamento_anual', ''),
      case
        when jsonb_typeof(v_payload->'areas_ajuda') = 'array'
          then v_payload->'areas_ajuda'
        else '[]'::jsonb
      end,
      coalesce(v_payload->>'expectativa_aprendizado', ''),
      coalesce(v_payload->>'expectativa_experiencia', ''),
      nullif(v_payload->>'acesso_status', ''),
      nullif(v_payload->>'acesso_disparo_id', ''),
      nullif(v_payload->>'acesso_template_id', ''),
      nullif(v_payload->>'acesso_enviado_em', '')::timestamptz,
      coalesce(nullif(v_payload->>'acesso_tentativas', '')::integer, 0),
      nullif(v_payload->>'acesso_erro', ''),
      nullif(v_payload->>'acesso_claim', ''),
      nullif(v_payload->>'ia_uso_diario', '')::integer,
      nullif(v_payload->>'ia_profundidade', '')::integer,
      coalesce(v_payload->>'ia_ferramentas', ''),
      coalesce(v_payload->>'ia_desafio', ''),
      nullif(v_payload->>'tem_empresa', '')::boolean,
      coalesce(v_payload->>'profissao', ''),
      coalesce(
        nullif(v_payload->>'terms_accepted_at', '')::timestamptz,
        v_source_updated_at
      ),
      private.json_timestamp(v_payload, 'created_at', v_source_updated_at),
      v_source_updated_at
    )
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
      updated_at = excluded.updated_at;

    update public.ingressos
       set participante_id = v_record_id,
           status = 'Pré-Credenciado'
     where id = v_payload->>'ingresso_id'
       and (
         participante_id is null
         or participante_id = v_record_id
       );
  elsif v_table = 'tokens_acesso' then
    insert into public.tokens_acesso (
      id,
      comprador_id,
      token,
      usado,
      expira_em,
      created_at,
      updated_at
    ) values (
      v_record_id,
      v_payload->>'comprador_id',
      v_payload->>'token',
      coalesce((v_payload->>'usado')::boolean, false),
      (v_payload->>'expira_em')::timestamptz,
      private.json_timestamp(v_payload, 'created_at', v_source_updated_at),
      v_source_updated_at
    )
    on conflict (id) do update set
      comprador_id = excluded.comprador_id,
      token = excluded.token,
      usado = excluded.usado,
      expira_em = excluded.expira_em,
      updated_at = excluded.updated_at;
  elsif v_table = 'links_participante' then
    insert into public.links_participante (
      id,
      ingresso_id,
      token,
      usado,
      expira_em,
      created_at,
      updated_at
    ) values (
      v_record_id,
      v_payload->>'ingresso_id',
      v_payload->>'token',
      coalesce((v_payload->>'usado')::boolean, false),
      (v_payload->>'expira_em')::timestamptz,
      private.json_timestamp(v_payload, 'created_at', v_source_updated_at),
      v_source_updated_at
    )
    on conflict (id) do update set
      ingresso_id = excluded.ingresso_id,
      token = excluded.token,
      usado = excluded.usado,
      expira_em = excluded.expira_em,
      updated_at = excluded.updated_at;
  else
    insert into public.webhooks_log (
      id,
      ingresso_id,
      status,
      method,
      response,
      evento,
      detalhe,
      payload,
      metadata,
      created_at,
      updated_at
    ) values (
      v_record_id,
      nullif(v_payload->>'ingresso_id', ''),
      nullif(v_payload->>'status', '')::integer,
      nullif(v_payload->>'method', ''),
      nullif(v_payload->>'response', ''),
      nullif(v_payload->>'evento', ''),
      nullif(v_payload->>'detalhe', ''),
      nullif(v_payload->>'payload', ''),
      coalesce(v_payload->'metadata', '{}'::jsonb),
      private.json_timestamp(v_payload, 'created_at', v_source_updated_at),
      v_source_updated_at
    )
    on conflict (id) do update set
      ingresso_id = excluded.ingresso_id,
      status = excluded.status,
      method = excluded.method,
      response = excluded.response,
      evento = excluded.evento,
      detalhe = excluded.detalhe,
      payload = excluded.payload,
      metadata = excluded.metadata,
      updated_at = excluded.updated_at;
  end if;

  delete from public.sync_tombstones
   where source_table = v_table
     and record_id = v_record_id
     and source_updated_at < v_source_updated_at;

  update public.sync_events
     set state = 'applied',
         applied_at = now()
   where event_id = v_event_id;

  update public.system_state
     set last_sync_event_at = greatest(
       coalesce(last_sync_event_at, '-infinity'::timestamptz),
       v_source_updated_at
     )
   where singleton;

  return jsonb_build_object('eventId', v_event_id, 'state', 'applied');
exception
  when others then
    update public.sync_events
       set state = 'failed',
           error = sqlerrm
     where event_id = v_event_id;
    raise;
end;
$function$;

GRANT ALL ON FUNCTION public.apply_sync_event(jsonb) TO service_role;

CREATE FUNCTION public.claim_ticket_operation (
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
$function$;

GRANT ALL ON FUNCTION public.claim_ticket_operation(text, text, text, jsonb) TO service_role;

CREATE FUNCTION public.complete_ticket_operation (
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
$function$;

GRANT ALL ON FUNCTION public.complete_ticket_operation(uuid, boolean, jsonb) TO service_role;

CREATE FUNCTION public.consume_buyer_token (
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

GRANT ALL ON FUNCTION public.consume_buyer_token(text) TO service_role;

CREATE FUNCTION public.create_participant_link (
  p_buyer_token text,
  p_ticket_id   text,
  p_expires_at  timestamp with time zone DEFAULT (now() + '7 days'::interval)
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
$function$;

GRANT ALL ON FUNCTION public.create_participant_link(text, text, timestamp WITH time zone) TO service_role;

CREATE FUNCTION public.credential_ticket (
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

GRANT ALL ON FUNCTION public.credential_ticket(text, jsonb, text) TO service_role;

CREATE FUNCTION public.get_buyer_tickets (
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
$function$;

GRANT ALL ON FUNCTION public.get_buyer_tickets(text) TO service_role;

CREATE FUNCTION public.get_participant_link (
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

GRANT ALL ON FUNCTION public.get_participant_link(text) TO service_role;

CREATE FUNCTION public.set_system_mode (
  p_mode                      text,
  p_user_id                   uuid,
  p_pocketbase_writes_blocked boolean DEFAULT false
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
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
$function$;

GRANT ALL ON FUNCTION public.set_system_mode(text, uuid, boolean) TO service_role;

CREATE FUNCTION public.submit_participant (
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

GRANT ALL ON FUNCTION public.submit_participant(text, jsonb) TO service_role;

CREATE TABLE public.admin_profiles (
  user_id      uuid                     NOT NULL,
  display_name text                     NOT NULL,
  role         text                     DEFAULT 'operator'::text NOT NULL,
  active       boolean                  DEFAULT true NOT NULL,
  created_at   timestamp with time zone DEFAULT now() NOT NULL,
  updated_at   timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public.admin_profiles
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.admin_profiles
  ADD CONSTRAINT admin_profiles_pkey PRIMARY KEY (user_id);

ALTER TABLE public.admin_profiles
  ADD CONSTRAINT admin_profiles_role_check CHECK (role = ANY (ARRAY['admin'::text, 'operator'::text, 'viewer'::text]));

ALTER TABLE public.admin_profiles
  ADD CONSTRAINT admin_profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

GRANT ALL ON public.admin_profiles TO service_role;

CREATE TRIGGER admin_profiles_set_updated_at
  BEFORE UPDATE ON public.admin_profiles
  FOR EACH ROW
  EXECUTE FUNCTION private.set_updated_at();

CREATE POLICY admin_profiles_service_role ON public.admin_profiles
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE TABLE public.compradores (
  id                 text                     DEFAULT private.new_text_id() NOT NULL,
  nome               text                     NOT NULL,
  email              text                     NOT NULL,
  email_normalized   text                     GENERATED ALWAYS AS (lower(btrim(email))) STORED,
  documento          text                     DEFAULT ''::text NOT NULL,
  uf                 text                     DEFAULT ''::text NOT NULL,
  cidade             text                     DEFAULT ''::text NOT NULL,
  telefone           text                     DEFAULT ''::text NOT NULL,
  acesso_status      text,
  acesso_template_id text,
  acesso_enviado_em  timestamp with time zone,
  acesso_tentativas  integer                  DEFAULT 0 NOT NULL,
  acesso_erro        text,
  acesso_disparo_id  text,
  acesso_claim       text,
  wa_status          text,
  wa_disparo_id      text,
  wa_tentativas      integer                  DEFAULT 0 NOT NULL,
  wa_erro            text,
  wa_claim           text,
  wa_enviado_em      timestamp with time zone,
  created_at         timestamp with time zone DEFAULT now() NOT NULL,
  updated_at         timestamp with time zone DEFAULT now() NOT NULL
);

CREATE FUNCTION private.buyer_for_token (
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

ALTER TABLE public.compradores
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.compradores
  ADD CONSTRAINT compradores_acesso_status_check CHECK (acesso_status IS NULL OR (acesso_status = ANY (ARRAY['na_fila'::text, 'enviando'::text, 'enviado'::text, 'erro'::text])));

ALTER TABLE public.compradores
  ADD CONSTRAINT compradores_acesso_tentativas_check CHECK (acesso_tentativas >= 0);

ALTER TABLE public.compradores
  ADD CONSTRAINT compradores_email_check CHECK (POSITION(('@'::text) IN (email)) > 1);

ALTER TABLE public.compradores
  ADD CONSTRAINT compradores_nome_check CHECK (length(btrim(nome)) > 0);

ALTER TABLE public.compradores
  ADD CONSTRAINT compradores_pkey PRIMARY KEY (id);

ALTER TABLE public.compradores
  ADD CONSTRAINT compradores_wa_status_check CHECK (wa_status IS NULL OR (wa_status = ANY (ARRAY['na_fila'::text, 'enviando'::text, 'enviado'::text, 'erro'::text])));

ALTER TABLE public.compradores
  ADD CONSTRAINT compradores_wa_tentativas_check CHECK (wa_tentativas >= 0);

GRANT ALL ON public.compradores TO service_role;

CREATE INDEX compradores_acesso_fila_idx ON public.compradores (created_at, id)
  WHERE acesso_status = ANY (ARRAY['na_fila'::text, 'erro'::text]);

CREATE UNIQUE INDEX compradores_email_unique ON public.compradores (email_normalized);

CREATE INDEX compradores_documento_idx ON public.compradores (private.normalize_cpf(documento))
  WHERE documento <> ''::text;

CREATE INDEX compradores_busca_nome_idx ON public.compradores USING gin (to_tsvector('simple'::regconfig, nome));

CREATE TRIGGER compradores_set_updated_at
  BEFORE UPDATE ON public.compradores
  FOR EACH ROW
  EXECUTE FUNCTION private.set_updated_at();

CREATE POLICY compradores_service_role ON public.compradores
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE TABLE public.ingressos (
  id              text                     DEFAULT private.new_text_id() NOT NULL,
  comprador_id    text                     NOT NULL,
  pedido_id       text                     NOT NULL,
  status          text                     DEFAULT 'Pendente'::text NOT NULL,
  participante_id text,
  preenchido_em   timestamp with time zone,
  tipo_ingresso   text                     DEFAULT 'GOLD'::text NOT NULL,
  status_webhook  text                     DEFAULT 'pendente'::text NOT NULL,
  inac_id         text,
  inac_qr         text,
  origem          text                     DEFAULT 'pocketbase'::text NOT NULL,
  cortesia_id     text,
  created_at      timestamp with time zone DEFAULT now() NOT NULL,
  updated_at      timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public.ingressos
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.ingressos
  ADD CONSTRAINT ingressos_comprador_id_fkey FOREIGN KEY (comprador_id) REFERENCES public.compradores(id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE public.ingressos
  ADD CONSTRAINT ingressos_participante_status_check CHECK (status = 'Pendente'::text AND participante_id IS NULL OR status = 'Pré-Credenciado'::text AND participante_id IS
    NOT NULL);

ALTER TABLE public.ingressos
  ADD CONSTRAINT ingressos_participante_unique UNIQUE (participante_id);

ALTER TABLE public.ingressos
  ADD CONSTRAINT ingressos_pedido_unique UNIQUE (pedido_id);

ALTER TABLE public.ingressos
  ADD CONSTRAINT ingressos_pkey PRIMARY KEY (id);

ALTER TABLE public.ingressos
  ADD CONSTRAINT ingressos_status_check CHECK (status = ANY (ARRAY['Pendente'::text, 'Pré-Credenciado'::text]));

ALTER TABLE public.ingressos
  ADD CONSTRAINT ingressos_status_webhook_check CHECK (status_webhook = ANY (ARRAY['pendente'::text, 'enviado'::text, 'erro'::text]));

ALTER TABLE public.ingressos
  ADD CONSTRAINT ingressos_tipo_ingresso_check CHECK (tipo_ingresso = ANY (ARRAY['GOLD'::text, 'PLATINUM'::text, 'PALESTRANTES'::text, 'HACKATHON'::text]));

GRANT ALL ON public.ingressos TO service_role;

CREATE INDEX ingressos_pendentes_idx ON public.ingressos (comprador_id, created_at, id)
  WHERE status = 'Pendente'::text;

CREATE INDEX ingressos_comprador_id_idx ON public.ingressos (comprador_id);

CREATE INDEX ingressos_participante_id_idx ON public.ingressos (participante_id)
  WHERE participante_id IS NOT NULL;

CREATE INDEX ingressos_webhook_fila_idx ON public.ingressos (updated_at, id)
  WHERE status_webhook = ANY (ARRAY['pendente'::text, 'erro'::text]);

CREATE TRIGGER ingressos_set_updated_at
  BEFORE UPDATE ON public.ingressos
  FOR EACH ROW
  EXECUTE FUNCTION private.set_updated_at();

CREATE POLICY ingressos_service_role ON public.ingressos
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE TABLE public.integration_attempts (
  id               bigint                   GENERATED ALWAYS AS IDENTITY NOT NULL,
  ingresso_id      text,
  participant_id   text,
  provider         text                     NOT NULL,
  operation        text                     NOT NULL,
  idempotency_key  text                     NOT NULL,
  attempt          integer                  DEFAULT 1 NOT NULL,
  request_payload  jsonb                    DEFAULT '{}'::jsonb NOT NULL,
  response_status  integer,
  response_payload jsonb,
  success          boolean                  DEFAULT false NOT NULL,
  error            text,
  duration_ms      integer,
  created_at       timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public.integration_attempts
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.integration_attempts
  ADD CONSTRAINT integration_attempts_attempt_check CHECK (attempt > 0);

ALTER TABLE public.integration_attempts
  ADD CONSTRAINT integration_attempts_duration_ms_check CHECK (duration_ms IS NULL OR duration_ms >= 0);

ALTER TABLE public.integration_attempts
  ADD CONSTRAINT integration_attempts_idempotency_unique UNIQUE (PROVIDER, idempotency_key, attempt);

ALTER TABLE public.integration_attempts
  ADD CONSTRAINT integration_attempts_ingresso_id_fkey FOREIGN KEY (ingresso_id) REFERENCES public.ingressos(id) ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE public.integration_attempts
  ADD CONSTRAINT integration_attempts_pkey PRIMARY KEY (id);

ALTER TABLE public.integration_attempts
  ADD CONSTRAINT integration_attempts_provider_check CHECK (provider = ANY (ARRAY['inac'::text, 'sendgrid'::text]));

GRANT ALL ON public.integration_attempts TO service_role;

CREATE INDEX integration_attempts_failed_idx ON public.integration_attempts (PROVIDER, created_at, id)
  WHERE success = false;

CREATE INDEX integration_attempts_ingresso_idx ON public.integration_attempts (ingresso_id, created_at DESC);

CREATE POLICY integration_attempts_service_role ON public.integration_attempts
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE TABLE public.links_participante (
  id          text                     DEFAULT private.new_text_id() NOT NULL,
  ingresso_id text                     NOT NULL,
  token       text                     NOT NULL,
  usado       boolean                  DEFAULT false NOT NULL,
  expira_em   timestamp with time zone NOT NULL,
  created_at  timestamp with time zone DEFAULT now() NOT NULL,
  updated_at  timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public.links_participante
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.links_participante
  ADD CONSTRAINT links_participante_ingresso_id_fkey FOREIGN KEY (ingresso_id) REFERENCES public.ingressos(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE public.links_participante
  ADD CONSTRAINT links_participante_pkey PRIMARY KEY (id);

ALTER TABLE public.links_participante
  ADD CONSTRAINT links_participante_token_unique UNIQUE (token);

GRANT ALL ON public.links_participante TO service_role;

CREATE INDEX links_participante_ingresso_id_idx ON public.links_participante (ingresso_id);

CREATE INDEX links_participante_validos_idx ON public.links_participante (token, expira_em)
  WHERE usado = false;

CREATE TRIGGER links_participante_set_updated_at
  BEFORE UPDATE ON public.links_participante
  FOR EACH ROW
  EXECUTE FUNCTION private.set_updated_at();

CREATE POLICY links_participante_service_role ON public.links_participante
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE TABLE public.participantes (
  id                      text                     DEFAULT private.new_text_id() NOT NULL,
  ingresso_id             text                     NOT NULL,
  nome_completo           text                     NOT NULL,
  email                   text                     NOT NULL,
  email_normalized        text                     GENERATED ALWAYS AS (lower(btrim(email))) STORED,
  cpf                     text                     NOT NULL,
  cpf_normalized          text                     GENERATED ALWAYS AS (private.normalize_cpf(cpf)) STORED,
  telefone                text                     NOT NULL,
  nome_empresa            text                     DEFAULT ''::text NOT NULL,
  cargo                   text                     DEFAULT ''::text NOT NULL,
  nicho                   text                     DEFAULT ''::text NOT NULL,
  num_funcionarios        text                     DEFAULT ''::text NOT NULL,
  faturamento_anual       text                     DEFAULT ''::text NOT NULL,
  areas_ajuda             jsonb                    DEFAULT '[]'::jsonb NOT NULL,
  expectativa_aprendizado text                     DEFAULT ''::text NOT NULL,
  expectativa_experiencia text                     DEFAULT ''::text NOT NULL,
  acesso_status           text,
  acesso_disparo_id       text,
  acesso_template_id      text,
  acesso_enviado_em       timestamp with time zone,
  acesso_tentativas       integer                  DEFAULT 0 NOT NULL,
  acesso_erro             text,
  acesso_claim            text,
  ia_uso_diario           integer,
  ia_profundidade         integer,
  ia_ferramentas          text                     DEFAULT ''::text NOT NULL,
  ia_desafio              text                     DEFAULT ''::text NOT NULL,
  tem_empresa             boolean,
  profissao               text                     DEFAULT ''::text NOT NULL,
  terms_accepted_at       timestamp with time zone NOT NULL,
  created_at              timestamp with time zone DEFAULT now() NOT NULL,
  updated_at              timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public.participantes
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.participantes
  ADD CONSTRAINT participantes_acesso_status_check CHECK (acesso_status IS NULL OR (acesso_status = ANY (ARRAY['na_fila'::text, 'enviando'::text, 'enviado'::text, 'erro'::text])));

ALTER TABLE public.participantes
  ADD CONSTRAINT participantes_acesso_tentativas_check CHECK (acesso_tentativas >= 0);

ALTER TABLE public.participantes
  ADD CONSTRAINT participantes_areas_ajuda_check CHECK (jsonb_typeof(areas_ajuda) = 'array'::text);

ALTER TABLE public.participantes
  ADD CONSTRAINT participantes_cpf_length CHECK (length(cpf_normalized) = 11);

ALTER TABLE public.participantes
  ADD CONSTRAINT participantes_email_check CHECK (POSITION(('@'::text) IN (email)) > 1);

ALTER TABLE public.participantes
  ADD CONSTRAINT participantes_ingresso_id_fkey FOREIGN KEY (ingresso_id) REFERENCES public.ingressos(id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE public.participantes
  ADD CONSTRAINT participantes_ingresso_unique UNIQUE (ingresso_id);

ALTER TABLE public.participantes
  ADD CONSTRAINT participantes_nome_completo_check CHECK (length(btrim(nome_completo)) > 0);

ALTER TABLE public.participantes
  ADD CONSTRAINT participantes_pkey PRIMARY KEY (id);

ALTER TABLE public.ingressos
  ADD CONSTRAINT ingressos_participante_id_fkey FOREIGN KEY (participante_id) REFERENCES public.participantes(id) ON UPDATE CASCADE ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE public.integration_attempts
  ADD CONSTRAINT integration_attempts_participant_id_fkey FOREIGN KEY (participant_id) REFERENCES public.participantes(id) ON UPDATE CASCADE ON DELETE SET NULL;

GRANT ALL ON public.participantes TO service_role;

CREATE UNIQUE INDEX participantes_cpf_unique ON public.participantes (cpf_normalized);

CREATE INDEX participantes_acesso_fila_idx ON public.participantes (created_at, id)
  WHERE acesso_status = ANY (ARRAY['na_fila'::text, 'erro'::text]);

CREATE UNIQUE INDEX participantes_email_unique ON public.participantes (email_normalized);

CREATE INDEX participantes_busca_nome_idx ON public.participantes USING gin (to_tsvector('simple'::regconfig, nome_completo));

CREATE TRIGGER participantes_set_updated_at
  BEFORE UPDATE ON public.participantes
  FOR EACH ROW
  EXECUTE FUNCTION private.set_updated_at();

CREATE POLICY participantes_service_role ON public.participantes
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE TABLE public.sync_events (
  event_id          text                     NOT NULL,
  source_table      text                     NOT NULL,
  record_id         text                     NOT NULL,
  operation         text                     NOT NULL,
  payload           jsonb                    DEFAULT '{}'::jsonb NOT NULL,
  source_updated_at timestamp with time zone NOT NULL,
  received_at       timestamp with time zone DEFAULT now() NOT NULL,
  applied_at        timestamp with time zone,
  state             text                     DEFAULT 'received'::text NOT NULL,
  error             text
);

ALTER TABLE public.sync_events
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.sync_events
  ADD CONSTRAINT sync_events_operation_check CHECK (operation = ANY (ARRAY['create'::text, 'update'::text, 'delete'::text]));

ALTER TABLE public.sync_events
  ADD CONSTRAINT sync_events_pkey PRIMARY KEY (event_id);

ALTER TABLE public.sync_events
  ADD CONSTRAINT sync_events_source_table_check
    CHECK (source_table = ANY (ARRAY['compradores'::text, 'ingressos'::text, 'participantes'::text, 'tokens_acesso'::text, 'links_participante'::text, 'webhooks_log'::text]));

ALTER TABLE public.sync_events
  ADD CONSTRAINT sync_events_state_check CHECK (state = ANY (ARRAY['received'::text, 'applied'::text, 'ignored'::text, 'failed'::text]));

GRANT ALL ON public.sync_events TO service_role;

CREATE INDEX sync_events_pending_idx ON public.sync_events (received_at, event_id)
  WHERE state = ANY (ARRAY['received'::text, 'failed'::text]);

CREATE INDEX sync_events_record_idx ON public.sync_events (source_table, record_id, source_updated_at DESC);

CREATE INDEX sync_events_lag_idx ON public.sync_events (source_updated_at DESC, event_id);

CREATE POLICY sync_events_service_role ON public.sync_events
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE TABLE public.sync_tombstones (
  source_table      text                     NOT NULL,
  record_id         text                     NOT NULL,
  source_updated_at timestamp with time zone NOT NULL,
  event_id          text                     NOT NULL,
  created_at        timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public.sync_tombstones
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.sync_tombstones
  ADD CONSTRAINT sync_tombstones_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.sync_events(event_id) ON DELETE RESTRICT;

ALTER TABLE public.sync_tombstones
  ADD CONSTRAINT sync_tombstones_pkey PRIMARY KEY (source_table, record_id);

GRANT ALL ON public.sync_tombstones TO service_role;

CREATE POLICY sync_tombstones_service_role ON public.sync_tombstones
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE TABLE public.system_state (
  singleton                 boolean                  DEFAULT true NOT NULL,
  mode                      text                     DEFAULT 'standby'::text NOT NULL,
  activated_at              timestamp with time zone,
  activated_by              uuid,
  last_sync_event_at        timestamp with time zone,
  last_reconciled_at        timestamp with time zone,
  pocketbase_writes_blocked boolean                  DEFAULT false NOT NULL,
  metadata                  jsonb                    DEFAULT '{}'::jsonb NOT NULL,
  updated_at                timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public.system_state
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.system_state
  ADD CONSTRAINT system_state_activated_by_fkey FOREIGN KEY (activated_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.system_state
  ADD CONSTRAINT system_state_mode_check CHECK (mode = ANY (ARRAY['standby'::text, 'active'::text, 'maintenance'::text]));

ALTER TABLE public.system_state
  ADD CONSTRAINT system_state_pkey PRIMARY KEY (singleton);

ALTER TABLE public.system_state
  ADD CONSTRAINT system_state_singleton_check CHECK (singleton);

GRANT ALL ON public.system_state TO service_role;

CREATE TRIGGER system_state_set_updated_at
  BEFORE UPDATE ON public.system_state
  FOR EACH ROW
  EXECUTE FUNCTION private.set_updated_at();

CREATE POLICY system_state_service_role ON public.system_state
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE TABLE public.ticket_operation_claims (
  id                  uuid                     DEFAULT gen_random_uuid() NOT NULL,
  ingresso_id         text                     NOT NULL,
  operation           text                     NOT NULL,
  actor               text                     NOT NULL,
  expected_updated_at timestamp with time zone NOT NULL,
  payload             jsonb                    DEFAULT '{}'::jsonb NOT NULL,
  state               text                     DEFAULT 'claimed'::text NOT NULL,
  expires_at          timestamp with time zone DEFAULT (now() + '00:02:00'::interval) NOT NULL,
  result              jsonb,
  created_at          timestamp with time zone DEFAULT now() NOT NULL,
  completed_at        timestamp with time zone
);

ALTER TABLE public.ticket_operation_claims
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.ticket_operation_claims
  ADD CONSTRAINT ticket_operation_claims_ingresso_id_fkey FOREIGN KEY (ingresso_id) REFERENCES public.ingressos(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE public.ticket_operation_claims
  ADD CONSTRAINT ticket_operation_claims_operation_check CHECK (operation = ANY (ARRAY['edit'::text, 'change_type'::text, 'delete'::text]));

ALTER TABLE public.ticket_operation_claims
  ADD CONSTRAINT ticket_operation_claims_pkey PRIMARY KEY (id);

ALTER TABLE public.ticket_operation_claims
  ADD CONSTRAINT ticket_operation_claims_state_check CHECK (state = ANY (ARRAY['claimed'::text, 'completed'::text, 'failed'::text, 'expired'::text]));

GRANT ALL ON public.ticket_operation_claims TO service_role;

CREATE INDEX ticket_operation_claims_expiry_idx ON public.ticket_operation_claims (expires_at)
  WHERE state = 'claimed'::text;

CREATE UNIQUE INDEX ticket_operation_claims_active_idx ON public.ticket_operation_claims (ingresso_id)
  WHERE state = 'claimed'::text;

CREATE POLICY ticket_operation_claims_service_role ON public.ticket_operation_claims
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE TABLE public.tokens_acesso (
  id           text                     DEFAULT private.new_text_id() NOT NULL,
  comprador_id text                     NOT NULL,
  token        text                     NOT NULL,
  usado        boolean                  DEFAULT false NOT NULL,
  expira_em    timestamp with time zone NOT NULL,
  created_at   timestamp with time zone DEFAULT now() NOT NULL,
  updated_at   timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public.tokens_acesso
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.tokens_acesso
  ADD CONSTRAINT tokens_acesso_comprador_id_fkey FOREIGN KEY (comprador_id) REFERENCES public.compradores(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE public.tokens_acesso
  ADD CONSTRAINT tokens_acesso_pkey PRIMARY KEY (id);

ALTER TABLE public.tokens_acesso
  ADD CONSTRAINT tokens_acesso_token_unique UNIQUE (token);

GRANT ALL ON public.tokens_acesso TO service_role;

CREATE INDEX tokens_acesso_validos_idx ON public.tokens_acesso (token, expira_em)
  WHERE usado = false;

CREATE INDEX tokens_acesso_comprador_id_idx ON public.tokens_acesso (comprador_id);

CREATE TRIGGER tokens_acesso_set_updated_at
  BEFORE UPDATE ON public.tokens_acesso
  FOR EACH ROW
  EXECUTE FUNCTION private.set_updated_at();

CREATE POLICY tokens_acesso_service_role ON public.tokens_acesso
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE TABLE public.webhooks_log (
  id          text                     DEFAULT private.new_text_id() NOT NULL,
  ingresso_id text,
  status      integer,
  method      text,
  response    text,
  evento      text,
  detalhe     text,
  payload     text,
  metadata    jsonb                    DEFAULT '{}'::jsonb NOT NULL,
  created_at  timestamp with time zone DEFAULT now() NOT NULL,
  updated_at  timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public.webhooks_log
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.webhooks_log
  ADD CONSTRAINT webhooks_log_ingresso_id_fkey FOREIGN KEY (ingresso_id) REFERENCES public.ingressos(id) ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE public.webhooks_log
  ADD CONSTRAINT webhooks_log_pkey PRIMARY KEY (id);

GRANT ALL ON public.webhooks_log TO service_role;

CREATE INDEX webhooks_log_created_at_idx ON public.webhooks_log (created_at DESC, id DESC);

CREATE INDEX webhooks_log_ingresso_id_idx ON public.webhooks_log (ingresso_id);

CREATE INDEX webhooks_log_evento_idx ON public.webhooks_log (evento, created_at DESC);

CREATE TRIGGER webhooks_log_set_updated_at
  BEFORE UPDATE ON public.webhooks_log
  FOR EACH ROW
  EXECUTE FUNCTION private.set_updated_at();

CREATE POLICY webhooks_log_service_role ON public.webhooks_log
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE VIEW public.sync_health WITH (security_invoker=true) AS SELECT s.mode,
    s.pocketbase_writes_blocked,
    s.last_sync_event_at,
    (EXTRACT(epoch FROM (now() - s.last_sync_event_at)))::integer AS lag_seconds,
    count(*) FILTER (WHERE (e.state = 'failed'::text)) AS failed_events,
    count(*) FILTER (WHERE (e.state = 'received'::text)) AS pending_events,
    max(e.applied_at) AS last_applied_at
   FROM (public.system_state s
     LEFT JOIN public.sync_events e ON (true))
  WHERE s.singleton
  GROUP BY s.mode, s.pocketbase_writes_blocked, s.last_sync_event_at;

GRANT ALL ON public.sync_health TO service_role;

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;

DO $$
DECLARE
  existing_job_id bigint;
BEGIN
  SELECT jobid
    INTO existing_job_id
    FROM cron.job
   WHERE jobname = 'expire-ticket-operation-claims';

  IF existing_job_id IS NOT NULL THEN
    PERFORM cron.unschedule(existing_job_id);
  END IF;

  PERFORM cron.schedule(
    'expire-ticket-operation-claims',
    '* * * * *',
    'select private.expire_ticket_operation_claims()'
  );
END
$$;

-- pg-delta does not currently retain bulk REVOKE statements from declarative
-- schemas, so the least-privilege boundary is repeated explicitly here.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon, authenticated;

GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role;
