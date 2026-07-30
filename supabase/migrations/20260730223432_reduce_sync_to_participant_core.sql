-- Migration unit 1: schema_changes
-- Transaction mode: transactional
-- Boundary reason: default

SET check_function_bodies = false;

ALTER TABLE public.sync_bootstrap_rows
  DROP CONSTRAINT sync_bootstrap_rows_source_table_check;

CREATE OR REPLACE FUNCTION public.apply_sync_event (
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
  v_existing_state text;
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
       'webhooks_log',
       'disparos',
       'envios',
       'pedidos_guru',
       'disparos_wa',
       'cortesias'
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
    select state into v_existing_state
      from public.sync_events
     where event_id = v_event_id;
    if v_existing_state in ('applied', 'ignored') then
      return jsonb_build_object('eventId', v_event_id, 'state', 'duplicate');
    end if;
    update public.sync_events
       set state = 'received',
           error = null,
           received_at = now()
     where event_id = v_event_id;
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
  elsif v_table = 'webhooks_log' then
    select updated_at into v_current_updated_at
      from public.webhooks_log where id = v_record_id;
  elsif v_table = 'disparos' then
    select updated_at into v_current_updated_at
      from public.disparos where id = v_record_id;
  elsif v_table = 'envios' then
    select updated_at into v_current_updated_at
      from public.envios where id = v_record_id;
  elsif v_table = 'pedidos_guru' then
    select updated_at into v_current_updated_at
      from public.pedidos_guru where id = v_record_id;
  elsif v_table = 'disparos_wa' then
    select updated_at into v_current_updated_at
      from public.disparos_wa where id = v_record_id;
  else
    select updated_at into v_current_updated_at
      from public.cortesias where id = v_record_id;
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

    if v_table = 'cortesias' then
      update public.ingressos set cortesia_id = null where cortesia_id = v_record_id;
      delete from public.cortesias where id = v_record_id;
    elsif v_table = 'disparos_wa' then
      update public.compradores set wa_disparo_id = null where wa_disparo_id = v_record_id;
      delete from public.disparos_wa where id = v_record_id;
    elsif v_table = 'pedidos_guru' then
      delete from public.pedidos_guru where id = v_record_id;
    elsif v_table = 'envios' then
      delete from public.envios where id = v_record_id;
    elsif v_table = 'disparos' then
      update public.compradores set acesso_disparo_id = null where acesso_disparo_id = v_record_id;
      update public.participantes set acesso_disparo_id = null where acesso_disparo_id = v_record_id;
      delete from public.disparos where id = v_record_id;
    elsif v_table = 'webhooks_log' then
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
      created_at = excluded.created_at,
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
      created_at = excluded.created_at,
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
      created_at = excluded.created_at,
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
  elsif v_table = 'disparos' then
    insert into public.disparos (
      id,
      template_id,
      template_nome,
      cluster,
      nome,
      audience,
      total,
      enviados,
      erros,
      status,
      created_at,
      updated_at
    ) values (
      v_record_id,
      coalesce(v_payload->>'template_id', ''),
      coalesce(v_payload->>'template_nome', ''),
      coalesce(nullif(v_payload->>'cluster', ''), 'todos'),
      coalesce(v_payload->>'nome', ''),
      coalesce(nullif(v_payload->>'audience', ''), 'compradores'),
      coalesce(nullif(v_payload->>'total', '')::integer, 0),
      coalesce(nullif(v_payload->>'enviados', '')::integer, 0),
      coalesce(nullif(v_payload->>'erros', '')::integer, 0),
      coalesce(nullif(v_payload->>'status', ''), 'em_andamento'),
      private.json_timestamp(v_payload, 'created_at', v_source_updated_at),
      v_source_updated_at
    )
    on conflict (id) do update set
      template_id = excluded.template_id,
      template_nome = excluded.template_nome,
      cluster = excluded.cluster,
      nome = excluded.nome,
      audience = excluded.audience,
      total = excluded.total,
      enviados = excluded.enviados,
      erros = excluded.erros,
      status = excluded.status,
      updated_at = excluded.updated_at;
  elsif v_table = 'envios' then
    insert into public.envios (
      id,
      disparo_id,
      comprador_id,
      participante_id,
      nome,
      email,
      status,
      enviado_em,
      created_at,
      updated_at
    ) values (
      v_record_id,
      v_payload->>'disparo_id',
      nullif(v_payload->>'comprador_id', ''),
      nullif(v_payload->>'participante_id', ''),
      coalesce(v_payload->>'nome', ''),
      coalesce(v_payload->>'email', ''),
      coalesce(nullif(v_payload->>'status', ''), 'na_fila'),
      nullif(v_payload->>'enviado_em', '')::timestamptz,
      private.json_timestamp(v_payload, 'created_at', v_source_updated_at),
      v_source_updated_at
    )
    on conflict (id) do update set
      disparo_id = excluded.disparo_id,
      comprador_id = excluded.comprador_id,
      participante_id = excluded.participante_id,
      nome = excluded.nome,
      email = excluded.email,
      status = excluded.status,
      enviado_em = excluded.enviado_em,
      updated_at = excluded.updated_at;
  elsif v_table = 'pedidos_guru' then
    insert into public.pedidos_guru (
      id,
      transacao_id,
      status,
      email,
      comprador_id,
      ingressos,
      email_status,
      payload,
      created_at,
      updated_at
    ) values (
      v_record_id,
      v_payload->>'transacao_id',
      coalesce(v_payload->>'status', ''),
      coalesce(v_payload->>'email', ''),
      nullif(v_payload->>'comprador_id', ''),
      coalesce(nullif(v_payload->>'ingressos', '')::integer, 0),
      coalesce(v_payload->>'email_status', ''),
      coalesce(v_payload->'payload', '{}'::jsonb),
      private.json_timestamp(v_payload, 'created_at', v_source_updated_at),
      v_source_updated_at
    )
    on conflict (id) do update set
      transacao_id = excluded.transacao_id,
      status = excluded.status,
      email = excluded.email,
      comprador_id = excluded.comprador_id,
      ingressos = excluded.ingressos,
      email_status = excluded.email_status,
      payload = excluded.payload,
      updated_at = excluded.updated_at;
  elsif v_table = 'disparos_wa' then
    insert into public.disparos_wa (
      id,
      nome,
      cluster,
      total,
      enviados,
      erros,
      status,
      flow,
      flow_nome,
      mapping,
      created_at,
      updated_at
    ) values (
      v_record_id,
      coalesce(v_payload->>'nome', ''),
      coalesce(nullif(v_payload->>'cluster', ''), 'todos'),
      coalesce(nullif(v_payload->>'total', '')::integer, 0),
      coalesce(nullif(v_payload->>'enviados', '')::integer, 0),
      coalesce(nullif(v_payload->>'erros', '')::integer, 0),
      coalesce(nullif(v_payload->>'status', ''), 'em_andamento'),
      coalesce(v_payload->>'flow', ''),
      coalesce(v_payload->>'flow_nome', ''),
      case
        when jsonb_typeof(v_payload->'mapping') = 'array' then v_payload->'mapping'
        when jsonb_typeof(v_payload->'mapping') = 'string'
          then coalesce(nullif(v_payload->>'mapping', '')::jsonb, '[]'::jsonb)
        else '[]'::jsonb
      end,
      private.json_timestamp(v_payload, 'created_at', v_source_updated_at),
      v_source_updated_at
    )
    on conflict (id) do update set
      nome = excluded.nome,
      cluster = excluded.cluster,
      total = excluded.total,
      enviados = excluded.enviados,
      erros = excluded.erros,
      status = excluded.status,
      flow = excluded.flow,
      flow_nome = excluded.flow_nome,
      mapping = excluded.mapping,
      updated_at = excluded.updated_at;
  elsif v_table = 'cortesias' then
    insert into public.cortesias (
      id,
      anfitriao,
      token,
      tipo_ingresso,
      limite,
      usados,
      ativo,
      comprador_id,
      created_at,
      updated_at
    ) values (
      v_record_id,
      v_payload->>'anfitriao',
      v_payload->>'token',
      coalesce(nullif(v_payload->>'tipo_ingresso', ''), 'GOLD'),
      coalesce(nullif(v_payload->>'limite', '')::integer, 0),
      coalesce(nullif(v_payload->>'usados', '')::integer, 0),
      coalesce((v_payload->>'ativo')::boolean, true),
      nullif(v_payload->>'comprador_id', ''),
      private.json_timestamp(v_payload, 'created_at', v_source_updated_at),
      v_source_updated_at
    )
    on conflict (id) do update set
      anfitriao = excluded.anfitriao,
      token = excluded.token,
      tipo_ingresso = excluded.tipo_ingresso,
      limite = excluded.limite,
      usados = excluded.usados,
      ativo = excluded.ativo,
      comprador_id = excluded.comprador_id,
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

CREATE OR REPLACE FUNCTION public.claim_email_dispatch_batch (
  p_limit integer DEFAULT 1000
)
  RETURNS SETOF public.envios
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  claim_id text := encode(extensions.gen_random_bytes(16), 'hex');
begin
  if not exists (
    select 1
      from public.system_state
     where singleton
       and mode = 'active'
       and external_effects_enabled
  ) then
    return;
  end if;

  return query
  with candidates as (
    select e.id
      from public.envios e
       where e.status in ('na_fila', 'erro')
         and e.tentativas < 5
         and coalesce(e.proxima_tentativa_em, '-infinity'::timestamptz) <= now()
     order by e.created_at, e.id
     for update skip locked
     limit least(greatest(p_limit, 1), 1000)
  )
  update public.envios e
     set status = 'enviando',
         claim = claim_id,
         tentativas = e.tentativas + 1,
         erro = null
    from candidates c
   where e.id = c.id
  returning e.*;
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

CREATE OR REPLACE FUNCTION public.claim_whatsapp_dispatch_batch (
  p_limit integer DEFAULT 60
)
  RETURNS TABLE (
    buyer_id    text,
    nome        text,
    email       text,
    telefone    text,
    dispatch_id text,
    flow        text,
    mapping     jsonb,
    token       text,
    attempt     integer
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  claim_id text := encode(extensions.gen_random_bytes(16), 'hex');
begin
  if not exists (
    select 1
      from public.system_state
     where singleton
       and mode = 'active'
       and external_effects_enabled
  ) then
    return;
  end if;

  return query
  with candidates as (
    select c.id
      from public.compradores c
       where c.wa_status in ('na_fila', 'erro')
         and c.wa_tentativas < 5
     order by c.created_at, c.id
     for update skip locked
     limit least(greatest(p_limit, 1), 100)
  ),
  claimed as (
    update public.compradores c
       set wa_status = 'enviando',
           wa_claim = claim_id,
           wa_tentativas = c.wa_tentativas + 1,
           wa_erro = null
      from candidates x
     where c.id = x.id
    returning c.*
  )
  select
    c.id,
    c.nome,
    c.email,
    c.telefone,
    c.wa_disparo_id,
      d.flow,
      d.mapping,
      coalesce(t.token, ''),
      c.wa_tentativas
  from claimed c
  join public.disparos_wa d on d.id = c.wa_disparo_id
  left join lateral (
    select ta.token
      from public.tokens_acesso ta
     where ta.comprador_id = c.id
       and ta.usado = false
       and ta.expira_em > now()
     order by ta.created_at desc
     limit 1
  ) t on true;
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
  staged public.sync_bootstrap_rows;
  table_name text;
  existing_id text;
  expected_count integer;
  actual_count integer;
  applied_count integer := 0;
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
            and coalesce(ticket.payload->>'participante_id', '') = participant.record_id
       )
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
         preenchido_em = null;
  update public.compradores set updated_at = '1970-01-01 00:00:00+00';
  update public.ingressos set updated_at = '1970-01-01 00:00:00+00';
  update public.participantes set updated_at = '1970-01-01 00:00:00+00';

  for existing_id in
    select participant.id
      from public.participantes participant
     where not exists (
       select 1
         from public.sync_bootstrap_rows staged_participant
        where staged_participant.run_id = p_run_id
          and staged_participant.source_table = 'participantes'
          and staged_participant.record_id = participant.id
     )
  loop
    perform public.apply_sync_event(
      jsonb_build_object(
        'event_id', format('bootstrap:%s:delete:participantes:%s', p_run_id, existing_id),
        'table', 'participantes',
        'record_id', existing_id,
        'operation', 'delete',
        'source_updated_at', bootstrap.created_at,
        'payload', '{}'::jsonb
      )
    );
    applied_count := applied_count + 1;
  end loop;

  for staged in
    select *
      from public.sync_bootstrap_rows
     where run_id = p_run_id
       and source_table = 'compradores'
     order by record_id
  loop
    perform public.apply_sync_event(
      jsonb_build_object(
        'event_id', format('bootstrap:%s:final:compradores:%s', p_run_id, staged.record_id),
        'table', staged.source_table,
        'record_id', staged.record_id,
        'operation', 'update',
        'source_updated_at', staged.source_updated_at,
        'payload', staged.payload
      )
    );
    applied_count := applied_count + 1;
  end loop;

  for staged in
    select *
      from public.sync_bootstrap_rows
     where run_id = p_run_id
       and source_table = 'ingressos'
     order by record_id
  loop
    perform public.apply_sync_event(
      jsonb_build_object(
        'event_id', format('bootstrap:%s:ticket-stage:%s', p_run_id, staged.record_id),
        'table', staged.source_table,
        'record_id', staged.record_id,
        'operation', 'update',
        'source_updated_at', staged.source_updated_at,
        'payload', staged.payload || jsonb_build_object(
          'status', 'Pendente',
          'participante_id', '',
          'preenchido_em', ''
        )
      )
    );
    applied_count := applied_count + 1;
  end loop;

  for staged in
    select *
      from public.sync_bootstrap_rows
     where run_id = p_run_id
       and source_table = 'participantes'
     order by record_id
  loop
    perform public.apply_sync_event(
      jsonb_build_object(
        'event_id', format('bootstrap:%s:final:participantes:%s', p_run_id, staged.record_id),
        'table', staged.source_table,
        'record_id', staged.record_id,
        'operation', 'update',
        'source_updated_at', staged.source_updated_at,
        'payload', staged.payload
      )
    );
    applied_count := applied_count + 1;
  end loop;

  for existing_id in
    select ticket.id
      from public.ingressos ticket
     where not exists (
       select 1
         from public.sync_bootstrap_rows staged_ticket
        where staged_ticket.run_id = p_run_id
          and staged_ticket.source_table = 'ingressos'
          and staged_ticket.record_id = ticket.id
     )
  loop
    perform public.apply_sync_event(
      jsonb_build_object(
        'event_id', format('bootstrap:%s:delete:ingressos:%s', p_run_id, existing_id),
        'table', 'ingressos',
        'record_id', existing_id,
        'operation', 'delete',
        'source_updated_at', bootstrap.created_at,
        'payload', '{}'::jsonb
      )
    );
    applied_count := applied_count + 1;
  end loop;

  for existing_id in
    select buyer.id
      from public.compradores buyer
     where not exists (
       select 1
         from public.sync_bootstrap_rows staged_buyer
        where staged_buyer.run_id = p_run_id
          and staged_buyer.source_table = 'compradores'
          and staged_buyer.record_id = buyer.id
     )
  loop
    perform public.apply_sync_event(
      jsonb_build_object(
        'event_id', format('bootstrap:%s:delete:compradores:%s', p_run_id, existing_id),
        'table', 'compradores',
        'record_id', existing_id,
        'operation', 'delete',
        'source_updated_at', bootstrap.created_at,
        'payload', '{}'::jsonb
      )
    );
    applied_count := applied_count + 1;
  end loop;

  for staged in
    select *
      from public.sync_bootstrap_rows
     where run_id = p_run_id
       and source_table = 'ingressos'
     order by record_id
  loop
    perform public.apply_sync_event(
      jsonb_build_object(
        'event_id', format('bootstrap:%s:ticket-final:%s', p_run_id, staged.record_id),
        'table', staged.source_table,
        'record_id', staged.record_id,
        'operation', 'update',
        'source_updated_at', staged.source_updated_at,
        'payload', staged.payload
      )
    );
    applied_count := applied_count + 1;
  end loop;

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
    'applied_events', applied_count
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

ALTER TABLE public.sync_bootstrap_rows
  ADD CONSTRAINT sync_bootstrap_rows_source_table_check CHECK (source_table = ANY (ARRAY['compradores'::text, 'ingressos'::text, 'participantes'::text]));