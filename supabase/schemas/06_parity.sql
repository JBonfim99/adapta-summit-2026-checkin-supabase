create or replace function private.unique_order_id(p_prefix text default '')
returns text
language plpgsql
volatile
set search_path = ''
as $$
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
$$;

create or replace function public.create_admin_ticket(
  p_buyer_id text,
  p_ticket_type text,
  p_order_id text default null,
  p_origin text default 'admin'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
$$;

create or replace function private.unique_helpdesk_order_id()
returns text
language plpgsql
volatile
set search_path = ''
as $$
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
$$;

create or replace function public.create_helpdesk_credential(
  p_payload jsonb,
  p_ticket_type text,
  p_operator text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
$$;

create or replace function public.delete_pending_ticket(
  p_ticket_id text,
  p_actor text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
$$;

create or replace function public.helpdesk_search(p_query text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
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
$$;

create or replace function public.register_courtesy(
  p_token text,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
$$;

create or replace function public.create_courtesy(
  p_host text,
  p_ticket_type text,
  p_limit integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
$$;

create or replace function public.admin_participants_search(
  p_query text default '',
  p_status text default null,
  p_type text default null,
  p_page integer default 1,
  p_per_page integer default 20
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
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
$$;

create or replace function public.process_guru_order(
  p_transaction_id text,
  p_email text,
  p_buyer jsonb,
  p_items jsonb,
  p_payload jsonb,
  p_template_id text default '',
  p_template_name text default 'Skip-Summit26-Send-Comprador'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
$$;

revoke execute on function public.create_helpdesk_credential(jsonb, text, text, text)
  from public, anon, authenticated;
revoke execute on function public.delete_pending_ticket(text, text)
  from public, anon, authenticated;
revoke execute on function public.helpdesk_search(text)
  from public, anon, authenticated;
revoke execute on function public.process_guru_order(text, text, jsonb, jsonb, jsonb, text, text)
  from public, anon, authenticated;

grant execute on function public.create_helpdesk_credential(jsonb, text, text, text)
  to service_role;
grant execute on function public.delete_pending_ticket(text, text)
  to service_role;
grant execute on function public.helpdesk_search(text)
  to service_role;
grant execute on function public.process_guru_order(text, text, jsonb, jsonb, jsonb, text, text)
  to service_role;

create or replace function public.claim_email_dispatch_batch(p_limit integer default 1000)
returns setof public.envios
language plpgsql
security definer
set search_path = ''
as $$
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
$$;

create or replace function public.import_buyers_batch(p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
$$;

create or replace function public.complete_email_dispatch(
  p_delivery_id text,
  p_success boolean,
  p_error text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
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
$$;

create or replace function public.claim_whatsapp_dispatch_batch(p_limit integer default 60)
returns table (
  buyer_id text,
  nome text,
  email text,
  telefone text,
  dispatch_id text,
    flow text,
    mapping jsonb,
    token text,
    attempt integer
)
language plpgsql
security definer
set search_path = ''
as $$
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
$$;

create or replace function public.complete_whatsapp_dispatch(
  p_buyer_id text,
  p_success boolean,
  p_error text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
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
$$;

create or replace function private.broadcast_admin_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
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
$$;

create policy admin_profiles_realtime_read
on realtime.messages
for select
to authenticated
using (
  exists (
    select 1
      from public.admin_profiles p
     where p.user_id = (select auth.uid())
       and p.active
  )
);

create trigger compradores_broadcast_admin
after insert or update or delete on public.compradores
for each row execute function private.broadcast_admin_change();

create trigger ingressos_broadcast_admin
after insert or update or delete on public.ingressos
for each row execute function private.broadcast_admin_change();

create trigger participantes_broadcast_admin
after insert or update or delete on public.participantes
for each row execute function private.broadcast_admin_change();

create trigger webhooks_log_broadcast_admin
after insert or update or delete on public.webhooks_log
for each row execute function private.broadcast_admin_change();

create trigger disparos_broadcast_admin
after insert or update or delete on public.disparos
for each row execute function private.broadcast_admin_change();

create trigger envios_broadcast_admin
after insert or update or delete on public.envios
for each row execute function private.broadcast_admin_change();

create trigger disparos_wa_broadcast_admin
after insert or update or delete on public.disparos_wa
for each row execute function private.broadcast_admin_change();

create trigger cortesias_broadcast_admin
after insert or update or delete on public.cortesias
for each row execute function private.broadcast_admin_change();
