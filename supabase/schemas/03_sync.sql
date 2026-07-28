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
$$;

create or replace view public.sync_health
with (security_invoker = true)
as
select
  s.mode,
  s.pocketbase_writes_blocked,
  s.last_sync_event_at,
  extract(epoch from (now() - s.last_sync_event_at))::integer as lag_seconds,
  count(*) filter (where e.state = 'failed') as failed_events,
  count(*) filter (where e.state = 'received') as pending_events,
  max(e.applied_at) as last_applied_at
from public.system_state s
left join public.sync_events e on true
where s.singleton
group by
  s.mode,
  s.pocketbase_writes_blocked,
  s.last_sync_event_at;
