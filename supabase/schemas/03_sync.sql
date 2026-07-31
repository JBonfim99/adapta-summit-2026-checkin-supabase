create or replace function private.json_timestamp(
  p_payload jsonb,
  p_primary_key text,
  p_fallback timestamptz
)
returns timestamptz
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    nullif(p_payload->>p_primary_key, '')::timestamptz,
    p_fallback
  );
$$;

create or replace function public.claim_sync_lease(
  p_token text,
  p_ttl_seconds integer default 25
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  affected_rows integer := 0;
begin
  if btrim(coalesce(p_token, '')) = '' then
    return false;
  end if;

  update public.system_state
     set sync_lease_token = p_token,
         sync_lease_until = now() + make_interval(
           secs => least(greatest(coalesce(p_ttl_seconds, 25), 5), 55)
         )
   where singleton
     and (
       sync_lease_until is null
       or sync_lease_until <= now()
       or sync_lease_token = p_token
     );
  get diagnostics affected_rows = row_count;
  return affected_rows > 0;
end;
$$;

create or replace function public.release_sync_lease(p_token text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.system_state
     set sync_lease_token = null,
         sync_lease_until = null
   where singleton
     and sync_lease_token = p_token;
$$;

create or replace function public.record_sync_poll(
  p_backlog integer,
  p_error text default null
)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.system_state
     set last_sync_poll_at = case when p_error is null then now() else last_sync_poll_at end,
         last_reconciled_at = case
           when p_error is null and greatest(coalesce(p_backlog, 0), 0) = 0 then now()
           else last_reconciled_at
         end,
         sync_outbox_backlog = greatest(coalesce(p_backlog, 0), 0),
         last_sync_error = nullif(left(coalesce(p_error, ''), 2000), '')
   where singleton;
$$;

create or replace function public.apply_sync_event(p_event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
$$;

create or replace function public.finalize_sync_bootstrap(p_run_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
         preenchido_em = null;

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
$$;

create or replace view public.sync_health
with (security_invoker = true)
as
select
  s.mode,
  s.external_effects_enabled,
  s.pocketbase_writes_blocked,
  s.last_sync_poll_at,
  s.last_sync_event_at,
  s.last_reconciled_at,
  s.sync_outbox_backlog,
  s.bootstrap_state,
  s.last_sync_error,
  extract(epoch from (now() - s.last_sync_poll_at))::integer as lag_seconds,
  count(*) filter (where e.state = 'failed') as failed_events,
  count(*) filter (where e.state = 'received') as pending_events,
  max(e.applied_at) as last_applied_at
from public.system_state s
left join public.sync_events e on true
where s.singleton
group by
  s.mode,
  s.external_effects_enabled,
  s.pocketbase_writes_blocked,
  s.last_sync_poll_at,
  s.last_sync_event_at,
  s.last_reconciled_at,
  s.sync_outbox_backlog,
  s.bootstrap_state,
  s.last_sync_error;
