-- Migration unit 1: schema_changes
-- Transaction mode: transactional
-- Boundary reason: default

SET check_function_bodies = false;

CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

DROP FUNCTION public.create_participant_link(p_buyer_token text, p_ticket_id text, p_expires_at timestamp WITH time zone);

ALTER TABLE public.integration_attempts
  DROP CONSTRAINT integration_attempts_provider_check;

ALTER TABLE public.sync_events
  DROP CONSTRAINT sync_events_source_table_check;

CREATE FUNCTION private.broadcast_admin_change()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
  perform realtime.broadcast_changes(
    'admin:operations',
    tg_op,
    tg_op,
    tg_table_name,
    tg_table_schema,
    new,
    old
  );
  return null;
end;
$function$;

CREATE FUNCTION private.invoke_dispatch_worker()
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  project_url text;
  publishable_key text;
  worker_secret text;
begin
  select decrypted_secret into project_url
    from vault.decrypted_secrets
   where name = 'project_url'
   limit 1;
  select decrypted_secret into publishable_key
    from vault.decrypted_secrets
   where name = 'publishable_key'
   limit 1;
  select decrypted_secret into worker_secret
    from vault.decrypted_secrets
   where name = 'dispatch_worker_secret'
   limit 1;

  if project_url is null or publishable_key is null or worker_secret is null then
    return;
  end if;

  perform net.http_post(
    url := rtrim(project_url, '/') || '/functions/v1/dispatch-worker',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', publishable_key,
      'X-Worker-Key', worker_secret
    ),
    body := '{"email_limit":1000,"whatsapp_workers":5,"whatsapp_limit":60}'::jsonb,
    timeout_milliseconds := 25000
  );
end;
$function$;

CREATE FUNCTION private.unique_order_id (
  p_prefix text DEFAULT ''::text
)
  RETURNS text
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
declare
  candidate text;
begin
  for attempt in 1..100 loop
    candidate := p_prefix || lpad((floor(random() * 1000000))::integer::text, 6, '0');
    if not exists (
      select 1 from public.ingressos where pedido_id = candidate
    ) then
      return candidate;
    end if;
  end loop;
  raise exception using errcode = 'P0001', message = 'ORDER_ID_GENERATION_FAILED';
end;
$function$;

CREATE FUNCTION public.admin_participants_search (
  p_query    text    DEFAULT ''::text,
  p_status   text    DEFAULT NULL::text,
  p_type     text    DEFAULT NULL::text,
  p_page     integer DEFAULT 1,
  p_per_page integer DEFAULT 20
)
  RETURNS jsonb
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
  with filtered as (
    select
      i.*,
      c.nome as comprador_nome,
      c.email as comprador_email,
      p.nome_completo,
      p.email as participante_email,
      p.cpf,
      p.telefone,
      p.tem_empresa,
      p.nome_empresa,
      p.cargo,
      p.profissao,
      p.nicho,
      p.num_funcionarios,
      p.faturamento_anual,
      p.ia_uso_diario,
      p.ia_profundidade,
      p.ia_ferramentas,
      p.ia_desafio
    from public.ingressos i
    left join public.compradores c on c.id = i.comprador_id
    left join public.participantes p on p.id = i.participante_id
    where (p_status is null or p_status = 'all' or i.status = p_status)
      and (p_type is null or p_type = 'all' or i.tipo_ingresso = p_type)
      and (
        btrim(coalesce(p_query, '')) = ''
        or lower(concat_ws(
          ' ',
          i.pedido_id,
          i.tipo_ingresso,
          c.nome,
          c.email,
          c.documento,
          p.nome_completo,
          p.email,
          p.cpf,
          p.telefone,
          p.nome_empresa,
          p.cargo,
          p.profissao,
          p.nicho
        )) like '%' || lower(btrim(p_query)) || '%'
      )
  ),
  totals as (
    select count(*)::integer as total_items from filtered
  ),
  page_rows as (
    select *
      from filtered
     order by created_at desc, id desc
     limit least(greatest(p_per_page, 1), 500)
    offset (greatest(p_page, 1) - 1) * least(greatest(p_per_page, 1), 500)
  )
  select jsonb_build_object(
    'items',
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', r.id,
          'pedido_id', r.pedido_id,
          'tipo_ingresso', r.tipo_ingresso,
          'status', r.status,
          'inac_id', r.inac_id,
          'created', r.created_at,
          'updated', r.updated_at,
          'expand', jsonb_build_object(
            'comprador_id', case
              when r.comprador_id is null then null
              else jsonb_build_object(
                'id', r.comprador_id,
                'nome', r.comprador_nome,
                'email', r.comprador_email
              )
            end,
            'participante_id', case
              when r.participante_id is null then null
              else jsonb_build_object(
                'id', r.participante_id,
                'nome_completo', r.nome_completo,
                'email', r.participante_email,
                'cpf', r.cpf,
                'telefone', r.telefone,
                'tem_empresa', r.tem_empresa,
                'nome_empresa', r.nome_empresa,
                'cargo', r.cargo,
                'profissao', r.profissao,
                'nicho', r.nicho,
                'num_funcionarios', r.num_funcionarios,
                'faturamento_anual', r.faturamento_anual,
                'ia_uso_diario', r.ia_uso_diario,
                'ia_profundidade', r.ia_profundidade,
                'ia_ferramentas', r.ia_ferramentas,
                'ia_desafio', r.ia_desafio
              )
            end
          )
        )
        order by r.created_at desc, r.id desc
      ) filter (where r.id is not null),
      '[]'::jsonb
    ),
    'page', greatest(p_page, 1),
    'perPage', least(greatest(p_per_page, 1), 500),
    'totalItems', t.total_items,
    'totalPages', greatest(
      1,
      ceil(t.total_items::numeric / least(greatest(p_per_page, 1), 500))::integer
    )
  )
  from totals t
  left join page_rows r on true
  group by t.total_items;
$function$;

GRANT ALL ON FUNCTION public.admin_participants_search(text, text, text, integer, integer) TO service_role;

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

CREATE FUNCTION public.claim_whatsapp_dispatch_batch (
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

GRANT ALL ON FUNCTION public.claim_whatsapp_dispatch_batch(integer) TO service_role;

CREATE FUNCTION public.complete_email_dispatch (
  p_delivery_id text,
  p_success     boolean,
  p_error       text    DEFAULT NULL::text
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  delivery public.envios;
begin
  update public.envios
     set status = case when p_success then 'enviado' else 'erro' end,
         enviado_em = case when p_success then now() else enviado_em end,
         erro = case when p_success then null else left(coalesce(p_error, 'SEND_FAILED'), 1000) end,
         claim = null,
         proxima_tentativa_em = case
           when p_success then null
           else now() + make_interval(secs => least(900, 15 * (2 ^ greatest(tentativas - 1, 0))::integer))
         end
   where id = p_delivery_id
  returning * into delivery;

  if delivery.id is null then
    raise exception using errcode = 'P0001', message = 'DELIVERY_NOT_FOUND';
  end if;

  update public.disparos d
     set enviados = (
           select count(*) from public.envios e
            where e.disparo_id = d.id and e.status = 'enviado'
         ),
         erros = (
           select count(*) from public.envios e
            where e.disparo_id = d.id and e.status = 'erro'
         ),
         status = case
           when exists (
             select 1 from public.envios e
                where e.disparo_id = d.id
                  and (
                    e.status in ('na_fila', 'enviando')
                    or (e.status = 'erro' and e.tentativas < 5)
                  )
           ) then 'em_andamento'
           else 'concluido'
         end
   where d.id = delivery.disparo_id;
end;
$function$;

GRANT ALL ON FUNCTION public.complete_email_dispatch(text, boolean, text) TO service_role;

CREATE FUNCTION public.complete_whatsapp_dispatch (
  p_buyer_id text,
  p_success  boolean,
  p_error    text    DEFAULT NULL::text
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  dispatch_id text;
begin
  update public.compradores
     set wa_status = case when p_success then 'enviado' else 'erro' end,
         wa_enviado_em = case when p_success then now() else wa_enviado_em end,
         wa_erro = case when p_success then null else left(coalesce(p_error, 'SEND_FAILED'), 1000) end,
         wa_claim = null
   where id = p_buyer_id
  returning wa_disparo_id into dispatch_id;

  update public.disparos_wa d
     set enviados = (
           select count(*) from public.compradores c
            where c.wa_disparo_id = d.id and c.wa_status = 'enviado'
         ),
         erros = (
           select count(*) from public.compradores c
            where c.wa_disparo_id = d.id and c.wa_status = 'erro'
         ),
         status = case
           when exists (
             select 1 from public.compradores c
                where c.wa_disparo_id = d.id
                  and (
                    c.wa_status in ('na_fila', 'enviando')
                    or (c.wa_status = 'erro' and c.wa_tentativas < 5)
                  )
           ) then 'em_andamento'
           else 'concluido'
         end
   where d.id = dispatch_id;
end;
$function$;

GRANT ALL ON FUNCTION public.complete_whatsapp_dispatch(text, boolean, text) TO service_role;

CREATE FUNCTION public.create_admin_ticket (
  p_buyer_id    text,
  p_ticket_type text,
  p_order_id    text DEFAULT NULL::text,
  p_origin      text DEFAULT 'admin'::text
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  ticket public.ingressos;
  link public.links_participante;
  order_id text := btrim(coalesce(p_order_id, ''));
begin
  if p_ticket_type not in ('GOLD', 'PLATINUM', 'PALESTRANTES', 'HACKATHON') then
    raise exception using errcode = 'P0001', message = 'INVALID_TICKET_TYPE';
  end if;
  if not exists (select 1 from public.compradores where id = p_buyer_id) then
    raise exception using errcode = 'P0001', message = 'BUYER_NOT_FOUND';
  end if;
  if order_id <> '' and order_id !~ '^[0-9]{1,6}$' then
    raise exception using errcode = 'P0001', message = 'INVALID_ORDER_ID';
  end if;
  if order_id = '' then
    order_id := private.unique_order_id('');
  end if;

  insert into public.ingressos (
    comprador_id,
    pedido_id,
    tipo_ingresso,
    status,
    status_webhook,
    origem
  ) values (
    p_buyer_id,
    order_id,
    p_ticket_type,
    'Pendente',
    'pendente',
    coalesce(nullif(p_origin, ''), 'admin')
  )
  returning * into ticket;

  insert into public.links_participante (ingresso_id, token, expira_em)
  values (
    ticket.id,
    encode(extensions.gen_random_bytes(32), 'hex'),
    now() + interval '1 year'
  )
  returning * into link;

  return jsonb_build_object(
    'success', true,
    'id', ticket.id,
    'pedido_id', ticket.pedido_id,
    'link_token', link.token,
    'link_expires_at', link.expira_em
  );
end;
$function$;

GRANT ALL ON FUNCTION public.create_admin_ticket(text, text, text, text) TO service_role;

CREATE FUNCTION public.create_courtesy (
  p_host        text,
  p_ticket_type text,
  p_limit       integer
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  token_value text := encode(extensions.gen_random_bytes(10), 'hex');
  buyer public.compradores;
  courtesy public.cortesias;
begin
  if length(btrim(coalesce(p_host, ''))) < 2 then
    raise exception using errcode = 'P0001', message = 'HOST_INVALID';
  end if;
  if p_ticket_type not in ('GOLD', 'PLATINUM', 'PALESTRANTES', 'HACKATHON') then
    raise exception using errcode = 'P0001', message = 'TICKET_TYPE_INVALID';
  end if;
  if coalesce(p_limit, 0) < 0 then
    raise exception using errcode = 'P0001', message = 'LIMIT_INVALID';
  end if;

  insert into public.compradores (nome, email)
  values (
    'Cortesia - ' || btrim(p_host),
    'cortesia+' || token_value || '@cortesia.summit'
  )
  returning * into buyer;

  insert into public.cortesias (
    anfitriao,
    token,
    tipo_ingresso,
    limite,
    usados,
    ativo,
    comprador_id
  ) values (
    btrim(p_host),
    token_value,
    p_ticket_type,
    coalesce(p_limit, 0),
    0,
    true,
    buyer.id
  )
  returning * into courtesy;

  return to_jsonb(courtesy);
end;
$function$;

GRANT ALL ON FUNCTION public.create_courtesy(text, text, integer) TO service_role;

CREATE FUNCTION public.create_participant_link (
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

GRANT ALL ON FUNCTION public.create_participant_link(text, text, timestamp WITH time zone) TO service_role;

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

CREATE FUNCTION public.import_buyers_batch (
  p_rows jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  source_row jsonb;
  buyer public.compradores;
  ticket public.ingressos;
  email_value text;
  quantity integer;
  ticket_type text;
  imported integer := 0;
  touched_buyers jsonb := '[]'::jsonb;
begin
  if jsonb_typeof(coalesce(p_rows, '[]'::jsonb)) <> 'array' then
    raise exception using errcode = 'P0001', message = 'ROWS_INVALID';
  end if;

  for source_row in select value from jsonb_array_elements(p_rows)
  loop
    email_value := lower(btrim(coalesce(source_row->>'email', '')));
    if email_value = '' then
      continue;
    end if;

    insert into public.compradores (
      nome,
      email,
      documento,
      uf,
      cidade,
      telefone
    ) values (
      coalesce(nullif(btrim(source_row->>'nome'), ''), email_value),
      email_value,
      regexp_replace(coalesce(source_row->>'documento', source_row->>'cpf', ''), '\D', '', 'g'),
      coalesce(source_row->>'uf', ''),
      coalesce(source_row->>'cidade', ''),
      coalesce(source_row->>'telefone', '')
    )
    on conflict (email_normalized) do update
      set nome = coalesce(nullif(excluded.nome, ''), public.compradores.nome),
          documento = coalesce(nullif(excluded.documento, ''), public.compradores.documento),
          uf = coalesce(nullif(excluded.uf, ''), public.compradores.uf),
          cidade = coalesce(nullif(excluded.cidade, ''), public.compradores.cidade),
          telefone = coalesce(nullif(excluded.telefone, ''), public.compradores.telefone)
    returning * into buyer;

    if not touched_buyers @> jsonb_build_array(buyer.id) then
      touched_buyers := touched_buyers || jsonb_build_array(buyer.id);
    end if;

    for ticket_type, quantity in
      select *
        from (values
          ('GOLD', greatest(coalesce((source_row->>'qtd_gold')::integer, 0), 0)),
          ('PLATINUM', greatest(coalesce((source_row->>'qtd_platinum')::integer, 0), 0)),
          ('PALESTRANTES', greatest(coalesce((source_row->>'qtd_palestrantes')::integer, 0), 0)),
          ('HACKATHON', greatest(coalesce((source_row->>'qtd_hackathon')::integer, 0), 0))
        ) as requested(kind, amount)
    loop
      if quantity > 1000 then
        raise exception using errcode = 'P0001', message = 'QUANTITY_TOO_LARGE';
      end if;
      for ticket_index in 1..quantity
      loop
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
          'importacao'
        )
        returning * into ticket;

        insert into public.links_participante (ingresso_id, token, expira_em)
        values (
          ticket.id,
          encode(extensions.gen_random_bytes(32), 'hex'),
          now() + interval '1 year'
        );
        imported := imported + 1;
      end loop;
    end loop;
  end loop;

  return jsonb_build_object(
    'imported', imported,
    'buyer_ids', touched_buyers
  );
end;
$function$;

GRANT ALL ON FUNCTION public.import_buyers_batch(jsonb) TO service_role;

CREATE FUNCTION public.process_guru_order (
  p_transaction_id text,
  p_email          text,
  p_buyer          jsonb,
  p_items          jsonb,
  p_payload        jsonb
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
    case when total_tickets > 0 then 'pendente' else 'sem_ingresso' end,
    p_payload
  );

  return jsonb_build_object(
    'duplicate', false,
    'transacao_id', p_transaction_id,
    'comprador_id', buyer.id,
    'ingressos', total_tickets,
    'nome', buyer.nome,
    'email', buyer.email
  );
end;
$function$;

GRANT ALL ON FUNCTION public.process_guru_order(text, text, jsonb, jsonb, jsonb) TO service_role;

CREATE FUNCTION public.register_courtesy (
  p_token   text,
  p_payload jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  courtesy public.cortesias;
  buyer public.compradores;
  ticket public.ingressos;
  participant public.participantes;
  order_id text;
  normalized_email text := lower(btrim(coalesce(p_payload->>'email', '')));
  normalized_cpf text := private.normalize_cpf(coalesce(p_payload->>'cpf', ''));
begin
  select *
    into courtesy
    from public.cortesias
   where token = p_token
   for update;

  if courtesy.id is null then
    raise exception using errcode = 'P0001', message = 'COURTESY_NOT_FOUND';
  end if;
  if not courtesy.ativo then
    raise exception using errcode = 'P0001', message = 'COURTESY_INACTIVE';
  end if;
  if courtesy.limite > 0 and courtesy.usados >= courtesy.limite then
    raise exception using errcode = 'P0001', message = 'COURTESY_EXHAUSTED';
  end if;
  if exists (
    select 1 from public.participantes where email_normalized = normalized_email
  ) then
    raise exception using errcode = 'P0001', message = 'EMAIL_ALREADY_USED';
  end if;
  if exists (
    select 1 from public.participantes where cpf_normalized = normalized_cpf
  ) then
    raise exception using errcode = 'P0001', message = 'CPF_ALREADY_USED';
  end if;

  if courtesy.comprador_id is not null then
    select * into buyer
      from public.compradores
     where id = courtesy.comprador_id;
  end if;
  if buyer.id is null then
    insert into public.compradores (nome, email)
    values (
      'Cortesia - ' || courtesy.anfitriao,
      'cortesia+' || courtesy.token || '@cortesia.summit'
    )
    returning * into buyer;
    update public.cortesias
       set comprador_id = buyer.id
     where id = courtesy.id;
  end if;

  order_id := private.unique_order_id('C');
  insert into public.ingressos (
    comprador_id,
    pedido_id,
    tipo_ingresso,
    status,
    status_webhook,
    origem,
    cortesia_id
  ) values (
    buyer.id,
    order_id,
    courtesy.tipo_ingresso,
    'Pendente',
    'pendente',
    'cortesia',
    courtesy.id
  )
  returning * into ticket;

  insert into public.participantes (
    ingresso_id,
    nome_completo,
    email,
    cpf,
    telefone,
    terms_accepted_at,
    tem_empresa
  ) values (
    ticket.id,
    btrim(p_payload->>'nome_completo'),
    normalized_email,
    normalized_cpf,
    coalesce(p_payload->>'telefone', ''),
    now(),
    false
  )
  returning * into participant;

  update public.ingressos
     set participante_id = participant.id,
         status = 'Pré-Credenciado',
         preenchido_em = now()
   where id = ticket.id;

  update public.cortesias
     set usados = usados + 1
   where id = courtesy.id;

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
    'cortesia_registrada',
    'Courtesy participant persisted; INAC dispatch pending',
    jsonb_build_object('cortesia_id', courtesy.id)
  );

  return jsonb_build_object(
    'ticketId', ticket.id,
    'participantId', participant.id,
    'pedidoId', ticket.pedido_id,
    'tipoIngresso', ticket.tipo_ingresso,
    'nomeCompleto', participant.nome_completo
  );
end;
$function$;

GRANT ALL ON FUNCTION public.register_courtesy(text, jsonb) TO service_role;

CREATE TRIGGER compradores_broadcast_admin
  AFTER INSERT OR DELETE OR UPDATE ON public.compradores
  FOR EACH ROW
  EXECUTE FUNCTION private.broadcast_admin_change();

CREATE TABLE public.cortesias (
  id            text                     DEFAULT private.new_text_id() NOT NULL,
  anfitriao     text                     NOT NULL,
  token         text                     NOT NULL,
  tipo_ingresso text                     DEFAULT 'GOLD'::text NOT NULL,
  limite        integer                  DEFAULT 0 NOT NULL,
  usados        integer                  DEFAULT 0 NOT NULL,
  ativo         boolean                  DEFAULT true NOT NULL,
  comprador_id  text,
  created_at    timestamp with time zone DEFAULT now() NOT NULL,
  updated_at    timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public.cortesias
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.cortesias
  ADD CONSTRAINT cortesias_anfitriao_check CHECK (length(btrim(anfitriao)) >= 2);

ALTER TABLE public.cortesias
  ADD CONSTRAINT cortesias_check CHECK (usados >= 0 AND (limite = 0 OR usados <= limite));

ALTER TABLE public.cortesias
  ADD CONSTRAINT cortesias_comprador_id_fkey FOREIGN KEY (comprador_id) REFERENCES public.compradores(id) ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE public.cortesias
  ADD CONSTRAINT cortesias_limite_check CHECK (limite >= 0);

ALTER TABLE public.cortesias
  ADD CONSTRAINT cortesias_pkey PRIMARY KEY (id);

ALTER TABLE public.cortesias
  ADD CONSTRAINT cortesias_tipo_ingresso_check CHECK (tipo_ingresso = ANY (ARRAY['GOLD'::text, 'PLATINUM'::text, 'PALESTRANTES'::text, 'HACKATHON'::text]));

ALTER TABLE public.cortesias
  ADD CONSTRAINT cortesias_token_key UNIQUE (token);

GRANT ALL ON public.cortesias TO service_role;

CREATE INDEX cortesias_created_at_idx ON public.cortesias (created_at DESC, id DESC);

CREATE INDEX cortesias_ativas_idx ON public.cortesias (token)
  WHERE ativo = true;

CREATE TRIGGER cortesias_broadcast_admin
  AFTER INSERT OR DELETE OR UPDATE ON public.cortesias
  FOR EACH ROW
  EXECUTE FUNCTION private.broadcast_admin_change();

CREATE TRIGGER cortesias_set_updated_at
  BEFORE UPDATE ON public.cortesias
  FOR EACH ROW
  EXECUTE FUNCTION private.set_updated_at();

CREATE POLICY cortesias_service_role ON public.cortesias
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE TABLE public.cron_health (
  id                text                     DEFAULT 'dispatch'::text NOT NULL,
  last_run          timestamp with time zone DEFAULT now() NOT NULL,
  email_last_run    timestamp with time zone,
  whatsapp_last_run timestamp with time zone,
  metadata          jsonb                    DEFAULT '{}'::jsonb NOT NULL,
  created_at        timestamp with time zone DEFAULT now() NOT NULL,
  updated_at        timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public.cron_health
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.cron_health
  ADD CONSTRAINT cron_health_pkey PRIMARY KEY (id);

GRANT ALL ON public.cron_health TO service_role;

CREATE TRIGGER cron_health_set_updated_at
  BEFORE UPDATE ON public.cron_health
  FOR EACH ROW
  EXECUTE FUNCTION private.set_updated_at();

CREATE POLICY cron_health_service_role ON public.cron_health
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE TABLE public.disparos (
  id            text                     DEFAULT private.new_text_id() NOT NULL,
  template_id   text                     NOT NULL,
  template_nome text                     DEFAULT ''::text NOT NULL,
  cluster       text                     NOT NULL,
  nome          text                     DEFAULT ''::text NOT NULL,
  audience      text                     DEFAULT 'compradores'::text NOT NULL,
  total         integer                  DEFAULT 0 NOT NULL,
  enviados      integer                  DEFAULT 0 NOT NULL,
  erros         integer                  DEFAULT 0 NOT NULL,
  status        text                     DEFAULT 'em_andamento'::text NOT NULL,
  created_at    timestamp with time zone DEFAULT now() NOT NULL,
  updated_at    timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public.disparos
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.disparos
  ADD CONSTRAINT disparos_audience_check CHECK (audience = ANY (ARRAY['compradores'::text, 'participantes'::text]));

ALTER TABLE public.disparos
  ADD CONSTRAINT disparos_cluster_check
    CHECK (cluster = ANY (ARRAY['todos'::text, 'pendentes'::text, 'participantes_todos'::text, 'participantes_recentes'::text, 'individual'::text]));

ALTER TABLE public.disparos
  ADD CONSTRAINT disparos_enviados_check CHECK (enviados >= 0);

ALTER TABLE public.disparos
  ADD CONSTRAINT disparos_erros_check CHECK (erros >= 0);

ALTER TABLE public.disparos
  ADD CONSTRAINT disparos_pkey PRIMARY KEY (id);

ALTER TABLE public.disparos
  ADD CONSTRAINT disparos_status_check CHECK (status = ANY (ARRAY['em_andamento'::text, 'concluido'::text, 'erro'::text]));

ALTER TABLE public.disparos
  ADD CONSTRAINT disparos_total_check CHECK (total >= 0);

GRANT ALL ON public.disparos TO service_role;

CREATE INDEX disparos_created_at_idx ON public.disparos (created_at DESC, id DESC);

CREATE INDEX disparos_status_idx ON public.disparos (created_at, id)
  WHERE status = 'em_andamento'::text;

CREATE TRIGGER disparos_broadcast_admin
  AFTER INSERT OR DELETE OR UPDATE ON public.disparos
  FOR EACH ROW
  EXECUTE FUNCTION private.broadcast_admin_change();

CREATE TRIGGER disparos_set_updated_at
  BEFORE UPDATE ON public.disparos
  FOR EACH ROW
  EXECUTE FUNCTION private.set_updated_at();

CREATE POLICY disparos_service_role ON public.disparos
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE TABLE public.disparos_wa (
  id         text                     DEFAULT private.new_text_id() NOT NULL,
  nome       text                     DEFAULT ''::text NOT NULL,
  cluster    text                     NOT NULL,
  total      integer                  DEFAULT 0 NOT NULL,
  enviados   integer                  DEFAULT 0 NOT NULL,
  erros      integer                  DEFAULT 0 NOT NULL,
  status     text                     DEFAULT 'em_andamento'::text NOT NULL,
  flow       text                     DEFAULT ''::text NOT NULL,
  flow_nome  text                     DEFAULT ''::text NOT NULL,
  mapping    jsonb                    DEFAULT '[]'::jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public.disparos_wa
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.disparos_wa
  ADD CONSTRAINT disparos_wa_cluster_check CHECK (cluster = ANY (ARRAY['todos'::text, 'pendentes'::text, 'individual'::text]));

ALTER TABLE public.disparos_wa
  ADD CONSTRAINT disparos_wa_enviados_check CHECK (enviados >= 0);

ALTER TABLE public.disparos_wa
  ADD CONSTRAINT disparos_wa_erros_check CHECK (erros >= 0);

ALTER TABLE public.disparos_wa
  ADD CONSTRAINT disparos_wa_mapping_check CHECK (jsonb_typeof(mapping) = 'array'::text);

ALTER TABLE public.disparos_wa
  ADD CONSTRAINT disparos_wa_pkey PRIMARY KEY (id);

ALTER TABLE public.disparos_wa
  ADD CONSTRAINT disparos_wa_status_check CHECK (status = ANY (ARRAY['em_andamento'::text, 'concluido'::text, 'erro'::text]));

ALTER TABLE public.disparos_wa
  ADD CONSTRAINT disparos_wa_total_check CHECK (total >= 0);

GRANT ALL ON public.disparos_wa TO service_role;

CREATE INDEX disparos_wa_created_at_idx ON public.disparos_wa (created_at DESC, id DESC);

CREATE INDEX disparos_wa_status_idx ON public.disparos_wa (created_at, id)
  WHERE status = 'em_andamento'::text;

CREATE TRIGGER disparos_wa_broadcast_admin
  AFTER INSERT OR DELETE OR UPDATE ON public.disparos_wa
  FOR EACH ROW
  EXECUTE FUNCTION private.broadcast_admin_change();

CREATE TRIGGER disparos_wa_set_updated_at
  BEFORE UPDATE ON public.disparos_wa
  FOR EACH ROW
  EXECUTE FUNCTION private.set_updated_at();

CREATE POLICY disparos_wa_service_role ON public.disparos_wa
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE TABLE public.envios (
  id                   text                     DEFAULT private.new_text_id() NOT NULL,
  disparo_id           text                     NOT NULL,
  comprador_id         text,
  participante_id      text,
  nome                 text                     DEFAULT ''::text NOT NULL,
  email                text                     NOT NULL,
  status               text                     DEFAULT 'na_fila'::text NOT NULL,
  tentativas           integer                  DEFAULT 0 NOT NULL,
  erro                 text,
  claim                text,
  proxima_tentativa_em timestamp with time zone,
  enviado_em           timestamp with time zone,
  created_at           timestamp with time zone DEFAULT now() NOT NULL,
  updated_at           timestamp with time zone DEFAULT now() NOT NULL
);

CREATE FUNCTION public.claim_email_dispatch_batch (
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

GRANT ALL ON FUNCTION public.claim_email_dispatch_batch(integer) TO service_role;

ALTER TABLE public.envios
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.envios
  ADD CONSTRAINT envios_comprador_id_fkey FOREIGN KEY (comprador_id) REFERENCES public.compradores(id) ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE public.envios
  ADD CONSTRAINT envios_disparo_id_fkey FOREIGN KEY (disparo_id) REFERENCES public.disparos(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE public.envios
  ADD CONSTRAINT envios_participante_id_fkey FOREIGN KEY (participante_id) REFERENCES public.participantes(id) ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE public.envios
  ADD CONSTRAINT envios_pkey PRIMARY KEY (id);

ALTER TABLE public.envios
  ADD CONSTRAINT envios_status_check CHECK (status = ANY (ARRAY['na_fila'::text, 'enviando'::text, 'enviado'::text, 'erro'::text]));

ALTER TABLE public.envios
  ADD CONSTRAINT envios_tentativas_check CHECK (tentativas >= 0);

GRANT ALL ON public.envios TO service_role;

CREATE INDEX envios_fila_idx ON public.envios (COALESCE(proxima_tentativa_em, created_at), id)
  WHERE status = ANY (ARRAY['na_fila'::text, 'erro'::text]);

CREATE INDEX envios_disparo_idx ON public.envios (disparo_id, created_at, id);

CREATE TRIGGER envios_broadcast_admin
  AFTER INSERT OR DELETE OR UPDATE ON public.envios
  FOR EACH ROW
  EXECUTE FUNCTION private.broadcast_admin_change();

CREATE TRIGGER envios_set_updated_at
  BEFORE UPDATE ON public.envios
  FOR EACH ROW
  EXECUTE FUNCTION private.set_updated_at();

CREATE POLICY envios_service_role ON public.envios
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE TRIGGER ingressos_broadcast_admin
  AFTER INSERT OR DELETE OR UPDATE ON public.ingressos
  FOR EACH ROW
  EXECUTE FUNCTION private.broadcast_admin_change();

ALTER TABLE public.integration_attempts
  ADD CONSTRAINT integration_attempts_provider_check CHECK (provider = ANY (ARRAY['inac'::text, 'sendgrid'::text, 'botconversa'::text]));

CREATE TRIGGER participantes_broadcast_admin
  AFTER INSERT OR DELETE OR UPDATE ON public.participantes
  FOR EACH ROW
  EXECUTE FUNCTION private.broadcast_admin_change();

CREATE TABLE public.pedidos_guru (
  id           text                     DEFAULT private.new_text_id() NOT NULL,
  transacao_id text                     NOT NULL,
  status       text                     NOT NULL,
  email        text                     DEFAULT ''::text NOT NULL,
  comprador_id text,
  ingressos    integer                  DEFAULT 0 NOT NULL,
  email_status text                     DEFAULT ''::text NOT NULL,
  payload      jsonb                    DEFAULT '{}'::jsonb NOT NULL,
  created_at   timestamp with time zone DEFAULT now() NOT NULL,
  updated_at   timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public.pedidos_guru
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.pedidos_guru
  ADD CONSTRAINT pedidos_guru_comprador_id_fkey FOREIGN KEY (comprador_id) REFERENCES public.compradores(id) ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE public.pedidos_guru
  ADD CONSTRAINT pedidos_guru_ingressos_check CHECK (ingressos >= 0);

ALTER TABLE public.pedidos_guru
  ADD CONSTRAINT pedidos_guru_pkey PRIMARY KEY (id);

ALTER TABLE public.pedidos_guru
  ADD CONSTRAINT pedidos_guru_transacao_id_key UNIQUE (transacao_id);

GRANT ALL ON public.pedidos_guru TO service_role;

CREATE INDEX pedidos_guru_email_idx ON public.pedidos_guru (lower(email));

CREATE INDEX pedidos_guru_created_at_idx ON public.pedidos_guru (created_at DESC, id DESC);

CREATE TRIGGER pedidos_guru_set_updated_at
  BEFORE UPDATE ON public.pedidos_guru
  FOR EACH ROW
  EXECUTE FUNCTION private.set_updated_at();

CREATE POLICY pedidos_guru_service_role ON public.pedidos_guru
  TO service_role
  USING (true)
  WITH CHECK (true);

ALTER TABLE public.sync_events
  ADD CONSTRAINT sync_events_source_table_check
    CHECK
    (source_table = ANY (ARRAY['compradores'::text, 'ingressos'::text, 'participantes'::text, 'tokens_acesso'::text, 'links_participante'::text, 'webhooks_log'::text,
    'disparos'::text, 'envios'::text, 'pedidos_guru'::text, 'disparos_wa'::text, 'cortesias'::text]));

CREATE TRIGGER webhooks_log_broadcast_admin
  AFTER INSERT OR DELETE OR UPDATE ON public.webhooks_log
  FOR EACH ROW
  EXECUTE FUNCTION private.broadcast_admin_change();

DROP POLICY IF EXISTS admin_profiles_realtime_read ON realtime.messages;

CREATE POLICY admin_profiles_realtime_read
ON realtime.messages
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
      FROM public.admin_profiles p
     WHERE p.user_id = (SELECT auth.uid())
       AND p.active
  )
);

DO $$
DECLARE
  existing_job_id bigint;
BEGIN
  SELECT jobid
    INTO existing_job_id
    FROM cron.job
   WHERE jobname = 'invoke-dispatch-worker';

  IF existing_job_id IS NOT NULL THEN
    PERFORM cron.unschedule(existing_job_id);
  END IF;

  PERFORM cron.schedule(
    'invoke-dispatch-worker',
    '* * * * *',
    'select private.invoke_dispatch_worker()'
  );
END
$$;

REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role;
