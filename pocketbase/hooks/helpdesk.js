// ========================= HELP DESK (/helpdesk) =========================
// Área operacional de balcão, protegida por SENHA ÚNICA (env HELPDESK_PASSWORD).
// Não usa login de usuário do PocketBase: a senha vai no header X-Helpdesk-Key
// (com fallback em _key no body/query) e é conferida em TODA rota.
//
// O que a área faz:
//   1) Busca global (nome, e-mail, documento/CPF, telefone ou nº do pedido)
//   2) Credencia quem ainda não tem credencial (participante + INAC /add)
//   3) Altera ingresso: dados da pessoa (INAC /edit) e tipo GOLD <-> PLATINUM
//   4) Mostra/gera o QR Code da credencial
//
// TODA ação vira registro em webhooks_log com evento helpdesk_* e method
// HELPDESK, com o nome do atendente — aparece em /admin/logs (filtro "Help desk").
//
// ATENÇÃO: o JSVM do PocketBase roda cada callback num VM isolado, então NADA
// de helper no topo do arquivo — todos os utilitários são declarados dentro de
// cada handler. É por isso que há repetição aqui.

// --- Login: só confere a senha (a sessão fica guardada no navegador) ---
routerAdd('POST', '/backend/v1/helpdesk/login', (e) => {
  const secret = (n) => {
    let v = ''
    try {
      v = $os.getenv(n) || ''
    } catch (_) {}
    if (!v) {
      try {
        if (typeof $secrets !== 'undefined' && $secrets && $secrets.get) v = $secrets.get(n) || ''
      } catch (_) {}
    }
    return v
  }
  const readH = (n) => {
    try {
      const v = e.request.header.get(n)
      if (v) return v.toString()
    } catch (_) {}
    try {
      const h = e.requestInfo().headers || {}
      const k = n.toLowerCase().replace(/-/g, '_')
      if (h[k]) return h[k].toString()
    } catch (_) {}
    return ''
  }

  const expected = secret('HELPDESK_PASSWORD')
  if (!expected) {
    return e.json(503, {
      message: 'Área de help desk não configurada. Falta a variável HELPDESK_PASSWORD no servidor.',
    })
  }
  const body = e.requestInfo().body || {}
  let sent = readH('X-Helpdesk-Key')
  if (!sent && body._key) sent = String(body._key)
  if (sent !== expected) return e.json(401, { message: 'Senha incorreta.' })
  return e.json(200, { ok: true })
})

// --- Busca global: encontra o COMPRADOR por qualquer campo dele ou de
//     qualquer participante dos ingressos dele, e devolve TODOS os ingressos.
routerAdd('GET', '/backend/v1/helpdesk/search', (e) => {
  const secret = (n) => {
    let v = ''
    try {
      v = $os.getenv(n) || ''
    } catch (_) {}
    if (!v) {
      try {
        if (typeof $secrets !== 'undefined' && $secrets && $secrets.get) v = $secrets.get(n) || ''
      } catch (_) {}
    }
    return v
  }
  const readH = (n) => {
    try {
      const v = e.request.header.get(n)
      if (v) return v.toString()
    } catch (_) {}
    try {
      const h = e.requestInfo().headers || {}
      const k = n.toLowerCase().replace(/-/g, '_')
      if (h[k]) return h[k].toString()
    } catch (_) {}
    return ''
  }
  const readQ = (n) => {
    try {
      const q = e.requestInfo().query || {}
      const v = q[n]
      if (v == null) return ''
      return (Array.isArray(v) ? v[0] : v).toString()
    } catch (_) {}
    return ''
  }

  const expected = secret('HELPDESK_PASSWORD')
  if (!expected) return e.json(503, { message: 'Área de help desk não configurada.' })
  let sent = readH('X-Helpdesk-Key')
  if (!sent) sent = readQ('_key')
  if (sent !== expected) return e.json(401, { message: 'Senha incorreta.' })

  try {
    const raw = readQ('q').trim()
    if (raw.length < 3) {
      return e.json(200, { ok: true, compradores: [], aviso: 'Digite pelo menos 3 caracteres.' })
    }
    const q = raw.toLowerCase()
    const dig = raw.replace(/\D/g, '')

    const clean = (col) =>
      'REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(' +
      col +
      ",'.',''),'-',''),'/',''),' ',''),'(',''),')','')"

    const params = { like: '%' + q + '%' }

    // Duas famílias de condição, porque a origem do match muda o que a tela
    // mostra: se casou pelos dados do COMPRADOR, todos os ingressos dele
    // interessam; se casou pelos dados de um PARTICIPANTE (ou pelo nº do
    // pedido), só aquele ingresso interessa.
    const orsComprador = ['lower(c.nome) LIKE {:like}', 'lower(c.email) LIKE {:like}']
    const orsIngresso = [
      'lower(p.nome_completo) LIKE {:like}',
      'lower(p.email) LIKE {:like}',
      'lower(i.pedido_id) LIKE {:like}',
    ]
    if (dig.length >= 3) {
      params.dig = '%' + dig + '%'
      orsComprador.push(clean('c.documento') + ' LIKE {:dig}')
      orsComprador.push(clean('c.telefone') + ' LIKE {:dig}')
      orsIngresso.push(clean('p.cpf') + ' LIKE {:dig}')
      orsIngresso.push(clean('p.telefone') + ' LIKE {:dig}')
    }

    const vistos = {}
    const ordem = []
    const addCid = (id) => {
      if (id && !vistos[id]) {
        vistos[id] = true
        ordem.push(id)
      }
    }

    // 1) compradores que casam pelos próprios dados (inclusive sem ingresso)
    const matchComprador = {}
    const m1 = arrayOf(new DynamicModel({ cid: '' }))
    $app
      .db()
      .newQuery(
        'SELECT c.id as cid FROM compradores c WHERE (' + orsComprador.join(' OR ') + ') LIMIT 40',
      )
      .bind(params)
      .all(m1)
    for (let i = 0; i < m1.length; i++) {
      matchComprador[m1[i].cid] = true
      addCid(m1[i].cid)
    }

    // 2) ingressos que casam pelo participante ou pelo número do pedido
    const matchIngresso = {}
    const m2 = arrayOf(new DynamicModel({ iid: '', cid: '' }))
    $app
      .db()
      .newQuery(
        'SELECT i.id as iid, i.comprador_id as cid FROM ingressos i ' +
          'LEFT JOIN participantes p ON p.id = i.participante_id ' +
          'WHERE (' +
          orsIngresso.join(' OR ') +
          ') LIMIT 100',
      )
      .bind(params)
      .all(m2)
    for (let i = 0; i < m2.length; i++) {
      matchIngresso[m2[i].iid] = true
      addCid(m2[i].cid)
    }

    if (ordem.length === 0) return e.json(200, { ok: true, compradores: [] })

    const safeIds = []
    for (let i = 0; i < ordem.length && i < 25; i++) {
      const s = String(ordem[i]).replace(/[^a-zA-Z0-9]/g, '')
      if (s) safeIds.push(s)
    }
    const inList = "'" + safeIds.join("','") + "'"

    const comps = arrayOf(
      new DynamicModel({ id: '', nome: '', email: '', documento: '', telefone: '' }),
    )
    $app
      .db()
      .newQuery(
        "SELECT id, nome, COALESCE(email,'') as email, COALESCE(documento,'') as documento, " +
          "COALESCE(telefone,'') as telefone FROM compradores WHERE id IN (" +
          inList +
          ')',
      )
      .all(comps)

    const rows = arrayOf(
      new DynamicModel({
        id: '',
        comprador_id: '',
        pedido_id: '',
        tipo_ingresso: '',
        status: '',
        inac_id: '',
        inac_qr: '',
        status_webhook: '',
        origem: '',
        created: '',
        part_id: '',
        nome_completo: '',
        email: '',
        cpf: '',
        telefone: '',
        nome_empresa: '',
        profissao: '',
      }),
    )
    $app
      .db()
      .newQuery(
        'SELECT i.id as id, i.comprador_id as comprador_id, i.pedido_id as pedido_id, ' +
          "i.tipo_ingresso as tipo_ingresso, i.status as status, COALESCE(i.inac_id,'') as inac_id, " +
          "COALESCE(i.inac_qr,'') as inac_qr, COALESCE(i.status_webhook,'') as status_webhook, " +
          "COALESCE(i.origem,'') as origem, i.created as created, " +
          "COALESCE(p.id,'') as part_id, COALESCE(p.nome_completo,'') as nome_completo, " +
          "COALESCE(p.email,'') as email, COALESCE(p.cpf,'') as cpf, " +
          "COALESCE(p.telefone,'') as telefone, COALESCE(p.nome_empresa,'') as nome_empresa, " +
          "COALESCE(p.profissao,'') as profissao " +
          'FROM ingressos i LEFT JOIN participantes p ON p.id = i.participante_id ' +
          'WHERE i.comprador_id IN (' +
          inList +
          ') ORDER BY i.created ASC',
      )
      .all(rows)

    // De onde veio cada check-in: balcão (com o nome do atendente), admin
    // manual, API externa — ou preenchimento da própria pessoa.
    const origemPorIngresso = {}
    const idsSeguros = []
    for (let i = 0; i < rows.length; i++) {
      const s = String(rows[i].id).replace(/[^a-zA-Z0-9]/g, '')
      if (s) idsSeguros.push(s)
    }
    if (idsSeguros.length > 0) {
      const marcos = arrayOf(
        new DynamicModel({ ingresso_id: '', evento: '', payload: '', created: '' }),
      )
      $app
        .db()
        .newQuery(
          "SELECT ingresso_id, evento, COALESCE(payload,'') as payload, created " +
            "FROM webhooks_log WHERE ingresso_id IN ('" +
            idsSeguros.join("','") +
            "') AND evento IN ('helpdesk_novo_credenciamento','helpdesk_credenciamento'," +
            "'checkin_manual_admin','api_credenciamento') ORDER BY created ASC",
        )
        .all(marcos)
      for (let i = 0; i < marcos.length; i++) {
        const m = marcos[i]
        if (origemPorIngresso[m.ingresso_id]) continue
        let operador = ''
        try {
          const p = JSON.parse(m.payload || '{}')
          operador = (p && p.operador) || ''
        } catch (_) {}
        let txt = ''
        if (m.evento === 'helpdesk_novo_credenciamento') txt = 'Criado do zero no balcão'
        else if (m.evento === 'helpdesk_credenciamento') txt = 'Check-in feito no balcão'
        else if (m.evento === 'checkin_manual_admin') txt = 'Check-in feito à mão no admin'
        else if (m.evento === 'api_credenciamento') txt = 'Check-in feito pela API externa'
        if (txt && operador) txt += ' por ' + operador
        origemPorIngresso[m.ingresso_id] = txt
      }
    }

    const origemDoIngresso = (r) => {
      if (origemPorIngresso[r.id]) return origemPorIngresso[r.id]
      if (r.origem === 'cortesia') return 'Ingresso de cortesia'
      if (r.origem === 'reconciliacao') return 'Ingresso criado na reconciliação'
      if (r.origem === 'api-externa') return 'Ingresso criado pela API externa'
      if (r.origem === 'helpdesk') return 'Ingresso criado no balcão'
      if (r.part_id) return 'Preenchido pela própria pessoa'
      return ''
    }

    const porComprador = {}
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]
      if (!porComprador[r.comprador_id]) porComprador[r.comprador_id] = []
      porComprador[r.comprador_id].push({
        id: r.id,
        pedido_id: r.pedido_id,
        tipo_ingresso: r.tipo_ingresso || 'GOLD',
        status: r.status,
        credenciado: !!r.inac_id,
        tem_qr: !!r.inac_qr,
        status_webhook: r.status_webhook,
        origem: r.origem,
        // true = este ingresso é resposta direta da busca
        match: !!matchComprador[r.comprador_id] || !!matchIngresso[r.id],
        origem_info: origemDoIngresso(r),
        participante: r.part_id
          ? {
              id: r.part_id,
              nome_completo: r.nome_completo,
              email: r.email,
              cpf: r.cpf,
              telefone: r.telefone,
              empresa: r.nome_empresa || r.profissao || '',
            }
          : null,
      })
    }

    const byId = {}
    for (let i = 0; i < comps.length; i++) byId[comps[i].id] = comps[i]

    const out = []
    for (let i = 0; i < safeIds.length; i++) {
      const c = byId[safeIds[i]]
      if (!c) continue
      const lista = porComprador[c.id] || []
      let encontrados = 0
      for (let j = 0; j < lista.length; j++) if (lista[j].match) encontrados++
      out.push({
        id: c.id,
        nome: c.nome,
        email: c.email,
        documento: c.documento,
        telefone: c.telefone,
        match_comprador: !!matchComprador[c.id],
        total_ingressos: lista.length,
        ingressos_encontrados: encontrados,
        ingressos: lista,
      })
    }

    return e.json(200, { ok: true, compradores: out })
  } catch (err) {
    return e.json(400, { message: err.message })
  }
})

// --- Credenciar: cria o participante do ingresso pendente e gera o QR ---
routerAdd('POST', '/backend/v1/helpdesk/credenciar', (e) => {
  const secret = (n) => {
    let v = ''
    try {
      v = $os.getenv(n) || ''
    } catch (_) {}
    if (!v) {
      try {
        if (typeof $secrets !== 'undefined' && $secrets && $secrets.get) v = $secrets.get(n) || ''
      } catch (_) {}
    }
    return v
  }
  const readH = (n) => {
    try {
      const v = e.request.header.get(n)
      if (v) return v.toString()
    } catch (_) {}
    try {
      const h = e.requestInfo().headers || {}
      const k = n.toLowerCase().replace(/-/g, '_')
      if (h[k]) return h[k].toString()
    } catch (_) {}
    return ''
  }
  const digits = (s) => (s || '').toString().replace(/\D/g, '')
  const sanitize = (s) => {
    if (s == null) return ''
    let t = String(s)
    t = t.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, '')
    t = t.replace(
      /[\u200D\u20E3\u2190-\u21FF\u2300-\u27BF\u2600-\u26FF\u2B00-\u2BFF\uFE00-\uFE0F]/g,
      '',
    )
    t = t.replace(/[\u0000-\u001F\u007F]/g, '')
    return t.replace(/\s+/g, ' ').trim()
  }
  const decode = (b) => {
    if (b == null) return ''
    if (typeof b === 'string') return b
    try {
      return new TextDecoder().decode(b)
    } catch (_) {}
    return ''
  }
  const cpfFmt = (s) => {
    const d = digits(s)
    if (d.length !== 11) return (s || '').toString().trim()
    return d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4')
  }
  const validCPF = (s) => {
    const c = digits(s)
    if (c.length !== 11 || /^(\d)\1{10}$/.test(c)) return false
    let sum = 0
    for (let i = 0; i < 9; i++) sum += parseInt(c[i], 10) * (10 - i)
    let d1 = 11 - (sum % 11)
    if (d1 >= 10) d1 = 0
    if (d1 !== parseInt(c[9], 10)) return false
    sum = 0
    for (let i = 0; i < 10; i++) sum += parseInt(c[i], 10) * (11 - i)
    let d2 = 11 - (sum % 11)
    if (d2 >= 10) d2 = 0
    return d2 === parseInt(c[10], 10)
  }
  const log = (ingId, evento, detalhe, payloadObj, response, status) => {
    try {
      const coll = $app.findCollectionByNameOrId('webhooks_log')
      const rec = new Record(coll)
      if (ingId) rec.set('ingresso_id', ingId)
      rec.set('evento', evento)
      rec.set('method', 'HELPDESK')
      rec.set('status', typeof status === 'number' ? status : 200)
      rec.set('detalhe', detalhe || '')
      rec.set('payload', JSON.stringify(payloadObj || {}))
      rec.set('response', (response || '').toString().substring(0, 500))
      $app.save(rec)
    } catch (_) {}
  }

  const body = e.requestInfo().body || {}
  const expected = secret('HELPDESK_PASSWORD')
  if (!expected) return e.json(503, { message: 'Área de help desk não configurada.' })
  let sent = readH('X-Helpdesk-Key')
  if (!sent && body._key) sent = String(body._key)
  if (sent !== expected) return e.json(401, { message: 'Senha incorreta.' })

  const operador =
    (body.operador || '').toString().replace(/\s+/g, ' ').trim() || 'não identificado'
  const ingressoId = (body.ingresso_id || '').toString()
  if (!ingressoId) return e.json(400, { message: 'Ingresso não informado.' })

  const nome = (body.nome_completo || '').toString().replace(/\s+/g, ' ').trim()
  const email = (body.email || '').toString().trim().toLowerCase()
  const cpf = cpfFmt((body.cpf || '').toString())
  const telefone = (body.telefone || '').toString().trim()
  const empresa = (body.empresa || '').toString().trim()

  if (nome.length < 3) return e.json(400, { message: 'Informe o nome completo.' })
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return e.json(400, { message: 'E-mail inválido.' })
  if (!validCPF(cpf)) return e.json(400, { message: 'CPF inválido.' })
  if (digits(telefone).length < 10) {
    return e.json(400, { message: 'Telefone inválido (informe com DDD).' })
  }

  let ingresso
  try {
    ingresso = $app.findRecordById('ingressos', ingressoId)
  } catch (_) {
    return e.json(404, { message: 'Ingresso não encontrado.' })
  }
  if (ingresso.getString('participante_id')) {
    return e.json(400, {
      message: 'Este ingresso já tem uma pessoa vinculada. Use "Alterar ingresso".',
    })
  }

  try {
    $app.findFirstRecordByFilter('participantes', 'email = {:em}', { em: email })
    return e.json(400, { message: 'Este e-mail já foi usado em outro credenciamento.' })
  } catch (_) {}

  try {
    const recs = $app.findRecordsByFilter(
      'participantes',
      'cpf = {:fmt} || cpf = {:raw}',
      '',
      50,
      0,
      { fmt: cpf, raw: digits(cpf) },
    )
    for (let i = 0; i < recs.length; i++) {
      const iid = recs[i].getString('ingresso_id')
      if (iid === ingressoId) continue
      try {
        const ing = $app.findRecordById('ingressos', iid)
        if (ing.getString('status') === 'Pré-Credenciado') {
          return e.json(400, { message: 'Este CPF já foi usado em outro credenciamento.' })
        }
      } catch (_) {}
    }
  } catch (_) {}

  try {
    $app.runInTransaction((txApp) => {
      const ing = txApp.findRecordById('ingressos', ingressoId)
      if (ing.getString('participante_id')) throw new Error('Este ingresso já possui participante.')

      const partColl = txApp.findCollectionByNameOrId('participantes')
      const part = new Record(partColl)
      part.set('ingresso_id', ing.id)
      part.set('nome_completo', nome)
      part.set('email', email)
      part.set('cpf', cpf)
      part.set('telefone', telefone)
      part.set('tem_empresa', false)
      part.set('nome_empresa', '')
      part.set('cargo', '')
      part.set('profissao', empresa)
      part.set('nicho', '')
      part.set('ia_uso_diario', 0)
      part.set('ia_profundidade', 0)
      part.set('terms_accepted_at', new Date().toISOString())
      txApp.save(part)

      ing.set('participante_id', part.id)
      ing.set('status', 'Pré-Credenciado')
      ing.set('preenchido_em', new Date().toISOString())
      txApp.save(ing)
    })
  } catch (err) {
    const m = (err && err.message) || 'Erro ao salvar.'
    if (/unique/i.test(m) || m.indexOf('idx_participantes_email') !== -1) {
      return e.json(400, { message: 'Este e-mail já foi usado em outro credenciamento.' })
    }
    return e.json(400, { message: m })
  }

  // pós-commit: cria a credencial na INAC e guarda o QR
  // "avisos" carrega tudo que deu errado DEPOIS da ação principal — nada aqui
  // pode falhar em silêncio, o balcão precisa saber o que sobrou pendente.
  const avisos = []
  let qrcode = ''
  let inacOk = false
  let inacMsg = ''
  const pedidoId = ingresso.getString('pedido_id')
  const tipo = ingresso.getString('tipo_ingresso')

  try {
    const ing2 = $app.findRecordById('ingressos', ingressoId)
    if (ing2.getString('inac_id')) {
      qrcode = ing2.getString('inac_qr')
      inacOk = true
      inacMsg = 'já existia na INAC'
    } else {
      const base = secret('INAC_WEBHOOK_URL')
      const addUrl = base || 'https://painel.credenciamento.digital/apiservicev1/attendees/add'
      const token = secret('INAC_AUTH_TOKEN')
      let tel = digits(telefone)
      if (tel && tel.length <= 11) tel = '55' + tel
      const payload = {
        event_id: 375,
        category_id:
          { GOLD: 6123, PLATINUM: 6125, PALESTRANTES: 7863, HACKATHON: 7864 }[tipo] || 6123,
        status: 'active',
        fields: [
          { id: 10133653, value: sanitize(nome) },
          { id: 10133654, value: email },
          { id: 10133655, value: digits(cpf) },
          { id: 10133656, value: tel },
          { id: 10133657, value: sanitize(empresa) },
          { id: 10133665, value: pedidoId },
        ],
      }

      if (!token) {
        inacMsg = 'o token de acesso à INAC não está configurado no servidor'
        avisos.push(
          'A pessoa foi cadastrada aqui, mas NENHUMA credencial foi emitida: o token da INAC não está configurado no servidor. Avise o suporte agora — enquanto isso nenhum QR Code vai ser gerado.',
        )
        ing2.set('status_webhook', 'erro')
        $app.save(ing2)
      } else {
        let status = 0
        let respTxt = ''
        try {
          const res = $http.send({
            url: addUrl,
            method: 'POST',
            headers: { 'X-Auth-Token': token, 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            timeout: 15,
          })
          status = res.statusCode
          respTxt = decode(res.body)
        } catch (err) {
          inacMsg = (err && err.message) || 'erro de rede'
        }
        let inacId = ''
        if (status >= 200 && status < 300) {
          try {
            const data = JSON.parse(respTxt)
            if (data && data.status === true && data.attendee) {
              inacId = String(data.attendee.id || '')
              qrcode = String(data.attendee.qrcode || '')
            }
          } catch (_) {}
        }
        inacOk = !!qrcode
        if (!inacMsg) {
          inacMsg = 'HTTP ' + status + (inacOk ? '' : ' ' + respTxt.substring(0, 200))
        }
        if (inacOk) {
          ing2.set('inac_id', inacId)
          ing2.set('inac_qr', qrcode)
          ing2.set('status_webhook', 'enviado')
        } else {
          ing2.set('status_webhook', 'erro')
        }
        try {
          $app.save(ing2)
        } catch (errSave) {
          avisos.push(
            'A credencial foi criada na INAC (id ' +
              inacId +
              '), mas NÃO foi possível gravar isso aqui: ' +
              ((errSave && errSave.message) || 'erro desconhecido') +
              '. Mostre o QR desta tela para a pessoa e avise o suporte. NÃO clique em gerar de novo — isso duplicaria a credencial dela.',
          )
        }

        log(
          ingressoId,
          inacOk ? 'webhook_enviado' : 'webhook_erro',
          (inacOk ? 'INAC /add OK (id ' + inacId + ')' : 'Falha no INAC /add — ' + inacMsg) +
            ' — via help desk (' +
            operador +
            ')',
          payload,
          respTxt,
          status,
        )
      }
    }
  } catch (err) {
    inacMsg = (err && err.message) || 'erro inesperado ao falar com a INAC'
    avisos.push(
      'A pessoa foi cadastrada aqui, mas houve um erro ao gerar a credencial: ' +
        inacMsg +
        '. Use o botão "Gerar credencial" no ingresso para tentar de novo.',
    )
  }

  // Registro de auditoria da ação principal, com confirmação de gravação.
  let logOk = true
  try {
    const collA = $app.findCollectionByNameOrId('webhooks_log')
    const recA = new Record(collA)
    recA.set('ingresso_id', ingressoId)
    recA.set('evento', 'helpdesk_credenciamento')
    recA.set('method', 'HELPDESK')
    recA.set('status', 200)
    recA.set(
      'detalhe',
      'Help desk (' +
        operador +
        ') — ingresso ' +
        pedidoId +
        ' (' +
        tipo +
        ') — credenciou ' +
        nome +
        (inacOk ? ' — QR gerado.' : ' — FALHA ao gerar o QR na INAC.'),
    )
    recA.set(
      'payload',
      JSON.stringify({
        origem: 'helpdesk',
        acao: 'credenciamento',
        operador: operador,
        pedido_id: pedidoId,
        tipo: tipo,
        dados: {
          nome_completo: nome,
          email: email,
          cpf: cpf,
          telefone: telefone,
          empresa: empresa,
        },
      }),
    )
    recA.set('response', inacOk ? 'INAC /add OK' : 'INAC: ' + inacMsg)
    $app.save(recA)
  } catch (errL) {
    logOk = false
    avisos.push(
      'A ação foi concluída, mas o registro dela no histórico falhou: ' +
        ((errL && errL.message) || 'erro desconhecido') +
        '. Anote o pedido ' +
        pedidoId +
        ' e avise o suporte.',
    )
  }

  return e.json(200, {
    ok: true,
    qrcode: qrcode,
    inac_ok: inacOk,
    inac_msg: inacMsg,
    nome: nome,
    pedido_id: pedidoId,
    tipo_ingresso: tipo,
    avisos: avisos,
    log_ok: logOk,
  })
})

// --- Alterar os dados da pessoa de um ingresso ---
routerAdd('POST', '/backend/v1/helpdesk/ticket/{id}/editar', (e) => {
  const secret = (n) => {
    let v = ''
    try {
      v = $os.getenv(n) || ''
    } catch (_) {}
    if (!v) {
      try {
        if (typeof $secrets !== 'undefined' && $secrets && $secrets.get) v = $secrets.get(n) || ''
      } catch (_) {}
    }
    return v
  }
  const readH = (n) => {
    try {
      const v = e.request.header.get(n)
      if (v) return v.toString()
    } catch (_) {}
    try {
      const h = e.requestInfo().headers || {}
      const k = n.toLowerCase().replace(/-/g, '_')
      if (h[k]) return h[k].toString()
    } catch (_) {}
    return ''
  }
  const digits = (s) => (s || '').toString().replace(/\D/g, '')
  const sanitize = (s) => {
    if (s == null) return ''
    let t = String(s)
    t = t.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, '')
    t = t.replace(
      /[\u200D\u20E3\u2190-\u21FF\u2300-\u27BF\u2600-\u26FF\u2B00-\u2BFF\uFE00-\uFE0F]/g,
      '',
    )
    t = t.replace(/[\u0000-\u001F\u007F]/g, '')
    return t.replace(/\s+/g, ' ').trim()
  }
  const decode = (b) => {
    if (b == null) return ''
    if (typeof b === 'string') return b
    try {
      return new TextDecoder().decode(b)
    } catch (_) {}
    return ''
  }
  const cpfFmt = (s) => {
    const d = digits(s)
    if (d.length !== 11) return (s || '').toString().trim()
    return d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4')
  }
  const validCPF = (s) => {
    const c = digits(s)
    if (c.length !== 11 || /^(\d)\1{10}$/.test(c)) return false
    let sum = 0
    for (let i = 0; i < 9; i++) sum += parseInt(c[i], 10) * (10 - i)
    let d1 = 11 - (sum % 11)
    if (d1 >= 10) d1 = 0
    if (d1 !== parseInt(c[9], 10)) return false
    sum = 0
    for (let i = 0; i < 10; i++) sum += parseInt(c[i], 10) * (11 - i)
    let d2 = 11 - (sum % 11)
    if (d2 >= 10) d2 = 0
    return d2 === parseInt(c[10], 10)
  }
  const log = (ingId, evento, detalhe, payloadObj, response, status) => {
    try {
      const coll = $app.findCollectionByNameOrId('webhooks_log')
      const rec = new Record(coll)
      if (ingId) rec.set('ingresso_id', ingId)
      rec.set('evento', evento)
      rec.set('method', 'HELPDESK')
      rec.set('status', typeof status === 'number' ? status : 200)
      rec.set('detalhe', detalhe || '')
      rec.set('payload', JSON.stringify(payloadObj || {}))
      rec.set('response', (response || '').toString().substring(0, 500))
      $app.save(rec)
    } catch (_) {}
  }

  const body = e.requestInfo().body || {}
  const expected = secret('HELPDESK_PASSWORD')
  if (!expected) return e.json(503, { message: 'Área de help desk não configurada.' })
  let sent = readH('X-Helpdesk-Key')
  if (!sent && body._key) sent = String(body._key)
  if (sent !== expected) return e.json(401, { message: 'Senha incorreta.' })

  const operador =
    (body.operador || '').toString().replace(/\s+/g, ' ').trim() || 'não identificado'
  const ticketId = e.request.pathValue('id')

  const nome = (body.nome_completo || '').toString().replace(/\s+/g, ' ').trim()
  const email = (body.email || '').toString().trim().toLowerCase()
  const cpf = cpfFmt((body.cpf || '').toString())
  const telefone = (body.telefone || '').toString().trim()
  const empresa = (body.empresa || '').toString().trim()

  if (nome.length < 3) return e.json(400, { message: 'Informe o nome completo.' })
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return e.json(400, { message: 'E-mail inválido.' })
  if (!validCPF(cpf)) return e.json(400, { message: 'CPF inválido.' })
  if (digits(telefone).length < 10) {
    return e.json(400, { message: 'Telefone inválido (informe com DDD).' })
  }

  let ingresso
  try {
    ingresso = $app.findRecordById('ingressos', ticketId)
  } catch (_) {
    return e.json(404, { message: 'Ingresso não encontrado.' })
  }
  const partId = ingresso.getString('participante_id')
  if (!partId) {
    return e.json(400, { message: 'Este ingresso ainda não tem pessoa. Use "Credenciar".' })
  }
  let part
  try {
    part = $app.findRecordById('participantes', partId)
  } catch (_) {
    return e.json(400, { message: 'Participante não encontrado para este ingresso.' })
  }

  try {
    const outro = $app.findFirstRecordByFilter('participantes', 'email = {:em}', { em: email })
    if (outro && outro.id !== part.id) {
      return e.json(400, { message: 'Este e-mail já foi usado em outro credenciamento.' })
    }
  } catch (_) {}

  try {
    const recs = $app.findRecordsByFilter(
      'participantes',
      'cpf = {:fmt} || cpf = {:raw}',
      '',
      50,
      0,
      { fmt: cpf, raw: digits(cpf) },
    )
    for (let i = 0; i < recs.length; i++) {
      const iid = recs[i].getString('ingresso_id')
      if (iid === ticketId) continue
      try {
        const ing = $app.findRecordById('ingressos', iid)
        if (ing.getString('status') === 'Pré-Credenciado') {
          return e.json(400, { message: 'Este CPF já foi usado em outro credenciamento.' })
        }
      } catch (_) {}
    }
  } catch (_) {}

  const antes = {
    nome_completo: part.getString('nome_completo'),
    email: part.getString('email'),
    cpf: part.getString('cpf'),
    telefone: part.getString('telefone'),
    empresa: part.getString('nome_empresa') || part.getString('profissao') || '',
  }

  const inacId = ingresso.getString('inac_id')
  let inacMsg = 'sem credencial na INAC (alteração local)'

  if (inacId) {
    const base = secret('INAC_WEBHOOK_URL')
    const token = secret('INAC_AUTH_TOKEN')
    let editUrl = 'https://painel.credenciamento.digital/apiservicev1/attendees/edit'
    if (/\/attendees\/add\/?$/.test(base)) editUrl = base.replace(/\/add\/?$/, '/edit')
    if (!token) return e.json(500, { message: 'INAC_AUTH_TOKEN não configurado.' })

    let tel = digits(telefone)
    if (tel && tel.length <= 11) tel = '55' + tel
    const payload = {
      id: parseInt(inacId, 10) || inacId,
      event_id: 375,
      category_id:
        { GOLD: 6123, PLATINUM: 6125, PALESTRANTES: 7863, HACKATHON: 7864 }[
          ingresso.getString('tipo_ingresso')
        ] || 6123,
      status: 'active',
      fields: [
        { id: 10133653, value: sanitize(nome) },
        { id: 10133654, value: email },
        { id: 10133655, value: digits(cpf) },
        { id: 10133656, value: tel },
        { id: 10133657, value: sanitize(empresa) },
        { id: 10133665, value: ingresso.getString('pedido_id') },
      ],
    }

    let status = 0
    let respTxt = ''
    let erroMsg = ''
    try {
      const res = $http.send({
        url: editUrl,
        method: 'PUT',
        headers: { 'X-Auth-Token': token, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        timeout: 15,
      })
      status = res.statusCode
      respTxt = decode(res.body)
    } catch (err) {
      erroMsg = (err && err.message) || 'erro de rede'
    }
    let ok = status >= 200 && status < 300
    try {
      const d = JSON.parse(respTxt)
      if (d && d.status === false) ok = false
    } catch (_) {}
    inacMsg = erroMsg ? erroMsg : 'HTTP ' + status + (ok ? '' : ' ' + respTxt.substring(0, 200))

    if (!ok) {
      log(
        ticketId,
        'helpdesk_erro',
        'Help desk (' +
          operador +
          ') — falha ao alterar os dados na INAC do ingresso ' +
          ingresso.getString('pedido_id') +
          '. Nada foi alterado.',
        {
          origem: 'helpdesk',
          acao: 'edicao_falha',
          operador: operador,
          tentativa: { nome, email },
        },
        respTxt || erroMsg,
        status,
      )
      return e.json(502, {
        message: 'Não foi possível atualizar a credencial na INAC (' + inacMsg + '). Nada mudou.',
      })
    }
  }

  try {
    part.set('nome_completo', nome)
    part.set('email', email)
    part.set('cpf', cpf)
    part.set('telefone', telefone)
    if (part.getBool('tem_empresa')) part.set('nome_empresa', empresa)
    else part.set('profissao', empresa)
    $app.save(part)
  } catch (err) {
    return e.json(500, {
      message:
        'A INAC foi atualizada, mas falhou ao salvar aqui: ' +
        ((err && err.message) || 'erro') +
        '. Chame o suporte.',
    })
  }

  // Registro de auditoria da ação principal, com confirmação de gravação.
  const avisos = []
  let logOk = true
  try {
    const collA = $app.findCollectionByNameOrId('webhooks_log')
    const recA = new Record(collA)
    recA.set('ingresso_id', ticketId)
    recA.set('evento', 'helpdesk_edicao')
    recA.set('method', 'HELPDESK')
    recA.set('status', 200)
    recA.set(
      'detalhe',
      'Help desk (' +
        operador +
        ') — ingresso ' +
        ingresso.getString('pedido_id') +
        ' — dados alterados: ' +
        antes.nome_completo +
        ' -> ' +
        nome,
    )
    recA.set(
      'payload',
      JSON.stringify({
        origem: 'helpdesk',
        acao: 'edicao',
        operador: operador,
        pedido_id: ingresso.getString('pedido_id'),
        antes: antes,
        depois: {
          nome_completo: nome,
          email: email,
          cpf: cpf,
          telefone: telefone,
          empresa: empresa,
        },
      }),
    )
    recA.set('response', inacId ? 'INAC /edit OK (' + inacMsg + ')' : inacMsg)
    $app.save(recA)
  } catch (errL) {
    logOk = false
    avisos.push(
      'A alteração foi salva, mas o registro dela no histórico falhou: ' +
        ((errL && errL.message) || 'erro desconhecido') +
        '. Anote o pedido ' +
        ingresso.getString('pedido_id') +
        ' e avise o suporte.',
    )
  }

  return e.json(200, { ok: true, avisos: avisos, log_ok: logOk })
})

// --- Trocar o tipo do ingresso (GOLD <-> PLATINUM) ---
routerAdd('POST', '/backend/v1/helpdesk/ticket/{id}/tipo', (e) => {
  const secret = (n) => {
    let v = ''
    try {
      v = $os.getenv(n) || ''
    } catch (_) {}
    if (!v) {
      try {
        if (typeof $secrets !== 'undefined' && $secrets && $secrets.get) v = $secrets.get(n) || ''
      } catch (_) {}
    }
    return v
  }
  const readH = (n) => {
    try {
      const v = e.request.header.get(n)
      if (v) return v.toString()
    } catch (_) {}
    try {
      const h = e.requestInfo().headers || {}
      const k = n.toLowerCase().replace(/-/g, '_')
      if (h[k]) return h[k].toString()
    } catch (_) {}
    return ''
  }
  const digits = (s) => (s || '').toString().replace(/\D/g, '')
  const sanitize = (s) => {
    if (s == null) return ''
    let t = String(s)
    t = t.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, '')
    t = t.replace(
      /[\u200D\u20E3\u2190-\u21FF\u2300-\u27BF\u2600-\u26FF\u2B00-\u2BFF\uFE00-\uFE0F]/g,
      '',
    )
    t = t.replace(/[\u0000-\u001F\u007F]/g, '')
    return t.replace(/\s+/g, ' ').trim()
  }
  const decode = (b) => {
    if (b == null) return ''
    if (typeof b === 'string') return b
    try {
      return new TextDecoder().decode(b)
    } catch (_) {}
    return ''
  }
  const log = (ingId, evento, detalhe, payloadObj, response, status) => {
    try {
      const coll = $app.findCollectionByNameOrId('webhooks_log')
      const rec = new Record(coll)
      if (ingId) rec.set('ingresso_id', ingId)
      rec.set('evento', evento)
      rec.set('method', 'HELPDESK')
      rec.set('status', typeof status === 'number' ? status : 200)
      rec.set('detalhe', detalhe || '')
      rec.set('payload', JSON.stringify(payloadObj || {}))
      rec.set('response', (response || '').toString().substring(0, 500))
      $app.save(rec)
    } catch (_) {}
  }

  const body = e.requestInfo().body || {}
  const expected = secret('HELPDESK_PASSWORD')
  if (!expected) return e.json(503, { message: 'Área de help desk não configurada.' })
  let sent = readH('X-Helpdesk-Key')
  if (!sent && body._key) sent = String(body._key)
  if (sent !== expected) return e.json(401, { message: 'Senha incorreta.' })

  const operador =
    (body.operador || '').toString().replace(/\s+/g, ' ').trim() || 'não identificado'
  const ticketId = e.request.pathValue('id')
  const tipo = (body.tipo || '').toString().trim().toUpperCase()
  if (['GOLD', 'PLATINUM', 'PALESTRANTES', 'HACKATHON'].indexOf(tipo) === -1) {
    return e.json(400, { message: 'Tipo deve ser GOLD, PLATINUM, PALESTRANTES ou HACKATHON.' })
  }

  // Motivo é obrigatório: troca de tipo sem justificativa não passa daqui.
  const motivo = (body.motivo || '').toString().replace(/\s+/g, ' ').trim()
  if (motivo.length < 5) {
    return e.json(400, {
      message: 'Escreva o motivo da troca de tipo (pelo menos 5 letras). A troca não foi feita.',
    })
  }

  let ingresso
  try {
    ingresso = $app.findRecordById('ingressos', ticketId)
  } catch (_) {
    return e.json(404, { message: 'Ingresso não encontrado.' })
  }
  const tipoAntes = ingresso.getString('tipo_ingresso')
  if (tipoAntes === tipo) return e.json(200, { ok: true, unchanged: true })

  const inacId = ingresso.getString('inac_id')
  let inacMsg = 'sem credencial na INAC'

  if (inacId) {
    const partId = ingresso.getString('participante_id')
    let part
    try {
      part = $app.findRecordById('participantes', partId)
    } catch (_) {
      return e.json(400, { message: 'Participante não encontrado para este ingresso.' })
    }

    const base = secret('INAC_WEBHOOK_URL')
    const token = secret('INAC_AUTH_TOKEN')
    let editUrl = 'https://painel.credenciamento.digital/apiservicev1/attendees/edit'
    if (/\/attendees\/add\/?$/.test(base)) editUrl = base.replace(/\/add\/?$/, '/edit')
    if (!token) return e.json(500, { message: 'INAC_AUTH_TOKEN não configurado.' })

    let tel = digits(part.getString('telefone'))
    if (tel && tel.length <= 11) tel = '55' + tel
    const payload = {
      id: parseInt(inacId, 10) || inacId,
      event_id: 375,
      category_id:
        { GOLD: 6123, PLATINUM: 6125, PALESTRANTES: 7863, HACKATHON: 7864 }[tipo] || 6123,
      status: 'active',
      fields: [
        { id: 10133653, value: sanitize(part.getString('nome_completo')) },
        { id: 10133654, value: part.getString('email') },
        { id: 10133655, value: digits(part.getString('cpf')) },
        { id: 10133656, value: tel },
        {
          id: 10133657,
          value: sanitize(part.getString('nome_empresa') || part.getString('profissao') || ''),
        },
        { id: 10133665, value: ingresso.getString('pedido_id') },
      ],
    }

    let status = 0
    let respTxt = ''
    let erroMsg = ''
    try {
      const res = $http.send({
        url: editUrl,
        method: 'PUT',
        headers: { 'X-Auth-Token': token, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        timeout: 15,
      })
      status = res.statusCode
      respTxt = decode(res.body)
    } catch (err) {
      erroMsg = (err && err.message) || 'erro de rede'
    }
    let ok = status >= 200 && status < 300
    try {
      const d = JSON.parse(respTxt)
      if (d && d.status === false) ok = false
    } catch (_) {}
    inacMsg = erroMsg ? erroMsg : 'HTTP ' + status + (ok ? '' : ' ' + respTxt.substring(0, 200))

    if (!ok) {
      log(
        ticketId,
        'helpdesk_erro',
        'Help desk (' +
          operador +
          ') — falha ao trocar o tipo na INAC do ingresso ' +
          ingresso.getString('pedido_id') +
          '. Nada foi alterado.',
        {
          origem: 'helpdesk',
          acao: 'tipo_falha',
          operador: operador,
          de: tipoAntes,
          para: tipo,
          motivo: motivo,
        },
        respTxt || erroMsg,
        status,
      )
      return e.json(502, {
        message: 'Não foi possível trocar o tipo na INAC (' + inacMsg + '). Nada mudou.',
      })
    }
  }

  try {
    ingresso.set('tipo_ingresso', tipo)
    $app.save(ingresso)
  } catch (err) {
    return e.json(500, {
      message:
        (inacId ? 'A INAC foi atualizada, mas ' : '') +
        'falhou ao salvar aqui: ' +
        ((err && err.message) || 'erro'),
    })
  }

  // Registro de auditoria da ação principal, com confirmação de gravação.
  const avisos = []
  let logOk = true
  try {
    const collA = $app.findCollectionByNameOrId('webhooks_log')
    const recA = new Record(collA)
    recA.set('ingresso_id', ticketId)
    recA.set('evento', 'helpdesk_tipo_alterado')
    recA.set('method', 'HELPDESK')
    recA.set('status', 200)
    recA.set(
      'detalhe',
      'Help desk (' +
        operador +
        ') — ingresso ' +
        ingresso.getString('pedido_id') +
        ' — tipo alterado de ' +
        tipoAntes +
        ' para ' +
        tipo +
        (inacId ? ' (INAC atualizada)' : '') +
        ' — motivo: ' +
        motivo,
    )
    recA.set(
      'payload',
      JSON.stringify({
        origem: 'helpdesk',
        acao: 'tipo',
        operador: operador,
        pedido_id: ingresso.getString('pedido_id'),
        de: tipoAntes,
        para: tipo,
        motivo: motivo,
      }),
    )
    recA.set('response', inacId ? 'INAC /edit OK (' + inacMsg + ')' : inacMsg)
    $app.save(recA)
  } catch (errL) {
    logOk = false
    avisos.push(
      'A troca de tipo foi feita, mas o registro dela no histórico falhou: ' +
        ((errL && errL.message) || 'erro desconhecido') +
        '. Anote o pedido ' +
        ingresso.getString('pedido_id') +
        ' e avise o suporte.',
    )
  }

  return e.json(200, { ok: true, tipo: tipo, avisos: avisos, log_ok: logOk })
})

// --- Ver o QR Code da credencial (registra a consulta) ---
routerAdd('GET', '/backend/v1/helpdesk/ticket/{id}/qr', (e) => {
  const secret = (n) => {
    let v = ''
    try {
      v = $os.getenv(n) || ''
    } catch (_) {}
    if (!v) {
      try {
        if (typeof $secrets !== 'undefined' && $secrets && $secrets.get) v = $secrets.get(n) || ''
      } catch (_) {}
    }
    return v
  }
  const readH = (n) => {
    try {
      const v = e.request.header.get(n)
      if (v) return v.toString()
    } catch (_) {}
    try {
      const h = e.requestInfo().headers || {}
      const k = n.toLowerCase().replace(/-/g, '_')
      if (h[k]) return h[k].toString()
    } catch (_) {}
    return ''
  }
  const readQ = (n) => {
    try {
      const q = e.requestInfo().query || {}
      const v = q[n]
      if (v == null) return ''
      return (Array.isArray(v) ? v[0] : v).toString()
    } catch (_) {}
    return ''
  }
  const expected = secret('HELPDESK_PASSWORD')
  if (!expected) return e.json(503, { message: 'Área de help desk não configurada.' })
  let sent = readH('X-Helpdesk-Key')
  if (!sent) sent = readQ('_key')
  if (sent !== expected) return e.json(401, { message: 'Senha incorreta.' })

  const operador = readQ('operador').replace(/\s+/g, ' ').trim() || 'não identificado'
  const ticketId = e.request.pathValue('id')

  let ingresso
  try {
    ingresso = $app.findRecordById('ingressos', ticketId)
  } catch (_) {
    return e.json(404, { message: 'Ingresso não encontrado.' })
  }

  let nomePart = ''
  const partId = ingresso.getString('participante_id')
  if (partId) {
    try {
      nomePart = $app.findRecordById('participantes', partId).getString('nome_completo')
    } catch (_) {}
  }

  const qr = ingresso.getString('inac_qr')
  const avisos = []
  let logOk = true
  if (qr) {
    try {
      const collA = $app.findCollectionByNameOrId('webhooks_log')
      const recA = new Record(collA)
      recA.set('ingresso_id', ticketId)
      recA.set('evento', 'helpdesk_qr')
      recA.set('method', 'HELPDESK')
      recA.set('status', 200)
      recA.set(
        'detalhe',
        'Help desk (' +
          operador +
          ') — QR Code consultado — ingresso ' +
          ingresso.getString('pedido_id') +
          (nomePart ? ' — ' + nomePart : ''),
      )
      recA.set(
        'payload',
        JSON.stringify({
          origem: 'helpdesk',
          acao: 'qr_consultado',
          operador: operador,
          pedido_id: ingresso.getString('pedido_id'),
        }),
      )
      recA.set('response', 'QR entregue no balcão.')
      $app.save(recA)
    } catch (errL) {
      logOk = false
      avisos.push(
        'O QR Code apareceu normalmente, mas esta consulta não foi registrada no histórico: ' +
          ((errL && errL.message) || 'erro desconhecido') +
          '. Avise o suporte.',
      )
    }
  }

  return e.json(200, {
    ok: true,
    qrcode: qr,
    pedido_id: ingresso.getString('pedido_id'),
    tipo_ingresso: ingresso.getString('tipo_ingresso'),
    nome: nomePart,
    tem_participante: !!partId,
    avisos: avisos,
    log_ok: logOk,
  })
})

// --- Gerar a credencial de quem já preencheu mas ficou sem QR (retry INAC) ---
routerAdd('POST', '/backend/v1/helpdesk/ticket/{id}/gerar-qr', (e) => {
  const secret = (n) => {
    let v = ''
    try {
      v = $os.getenv(n) || ''
    } catch (_) {}
    if (!v) {
      try {
        if (typeof $secrets !== 'undefined' && $secrets && $secrets.get) v = $secrets.get(n) || ''
      } catch (_) {}
    }
    return v
  }
  const readH = (n) => {
    try {
      const v = e.request.header.get(n)
      if (v) return v.toString()
    } catch (_) {}
    try {
      const h = e.requestInfo().headers || {}
      const k = n.toLowerCase().replace(/-/g, '_')
      if (h[k]) return h[k].toString()
    } catch (_) {}
    return ''
  }
  const digits = (s) => (s || '').toString().replace(/\D/g, '')
  const sanitize = (s) => {
    if (s == null) return ''
    let t = String(s)
    t = t.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, '')
    t = t.replace(
      /[\u200D\u20E3\u2190-\u21FF\u2300-\u27BF\u2600-\u26FF\u2B00-\u2BFF\uFE00-\uFE0F]/g,
      '',
    )
    t = t.replace(/[\u0000-\u001F\u007F]/g, '')
    return t.replace(/\s+/g, ' ').trim()
  }
  const decode = (b) => {
    if (b == null) return ''
    if (typeof b === 'string') return b
    try {
      return new TextDecoder().decode(b)
    } catch (_) {}
    return ''
  }
  const log = (ingId, evento, detalhe, payloadObj, response, status) => {
    try {
      const coll = $app.findCollectionByNameOrId('webhooks_log')
      const rec = new Record(coll)
      if (ingId) rec.set('ingresso_id', ingId)
      rec.set('evento', evento)
      rec.set('method', 'HELPDESK')
      rec.set('status', typeof status === 'number' ? status : 200)
      rec.set('detalhe', detalhe || '')
      rec.set('payload', JSON.stringify(payloadObj || {}))
      rec.set('response', (response || '').toString().substring(0, 500))
      $app.save(rec)
    } catch (_) {}
  }

  const body = e.requestInfo().body || {}
  const expected = secret('HELPDESK_PASSWORD')
  if (!expected) return e.json(503, { message: 'Área de help desk não configurada.' })
  let sent = readH('X-Helpdesk-Key')
  if (!sent && body._key) sent = String(body._key)
  if (sent !== expected) return e.json(401, { message: 'Senha incorreta.' })

  const operador =
    (body.operador || '').toString().replace(/\s+/g, ' ').trim() || 'não identificado'
  const ticketId = e.request.pathValue('id')

  let ingresso
  try {
    ingresso = $app.findRecordById('ingressos', ticketId)
  } catch (_) {
    return e.json(404, { message: 'Ingresso não encontrado.' })
  }
  if (ingresso.getString('inac_qr')) {
    return e.json(200, { ok: true, qrcode: ingresso.getString('inac_qr'), ja_existia: true })
  }
  const partId = ingresso.getString('participante_id')
  if (!partId) {
    return e.json(400, { message: 'Este ingresso ainda não tem pessoa. Use "Credenciar".' })
  }
  let part
  try {
    part = $app.findRecordById('participantes', partId)
  } catch (_) {
    return e.json(400, { message: 'Participante não encontrado para este ingresso.' })
  }

  const base = secret('INAC_WEBHOOK_URL')
  const addUrl = base || 'https://painel.credenciamento.digital/apiservicev1/attendees/add'
  const token = secret('INAC_AUTH_TOKEN')
  if (!token) return e.json(500, { message: 'INAC_AUTH_TOKEN não configurado.' })

  let tel = digits(part.getString('telefone'))
  if (tel && tel.length <= 11) tel = '55' + tel
  const payload = {
    event_id: 375,
    category_id:
      { GOLD: 6123, PLATINUM: 6125, PALESTRANTES: 7863, HACKATHON: 7864 }[
        ingresso.getString('tipo_ingresso')
      ] || 6123,
    status: 'active',
    fields: [
      { id: 10133653, value: sanitize(part.getString('nome_completo')) },
      { id: 10133654, value: part.getString('email') },
      { id: 10133655, value: digits(part.getString('cpf')) },
      { id: 10133656, value: tel },
      {
        id: 10133657,
        value: sanitize(part.getString('nome_empresa') || part.getString('profissao') || ''),
      },
      { id: 10133665, value: ingresso.getString('pedido_id') },
    ],
  }

  let status = 0
  let respTxt = ''
  let erroMsg = ''
  try {
    const res = $http.send({
      url: addUrl,
      method: 'POST',
      headers: { 'X-Auth-Token': token, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      timeout: 15,
    })
    status = res.statusCode
    respTxt = decode(res.body)
  } catch (err) {
    erroMsg = (err && err.message) || 'erro de rede'
  }

  let inacId = ''
  let qrcode = ''
  if (status >= 200 && status < 300) {
    try {
      const data = JSON.parse(respTxt)
      if (data && data.status === true && data.attendee) {
        inacId = String(data.attendee.id || '')
        qrcode = String(data.attendee.qrcode || '')
      }
    } catch (_) {}
  }
  const ok = !!qrcode
  const msg = erroMsg ? erroMsg : 'HTTP ' + status + (ok ? '' : ' ' + respTxt.substring(0, 200))

  const avisos = []

  if (!ok) {
    log(
      ticketId,
      'helpdesk_erro',
      'Help desk (' +
        operador +
        ') — FALHA ao gerar credencial — ingresso ' +
        ingresso.getString('pedido_id') +
        ' — ' +
        part.getString('nome_completo'),
      {
        origem: 'helpdesk',
        acao: 'gerar_qr_falha',
        operador: operador,
        pedido_id: ingresso.getString('pedido_id'),
      },
      'INAC: ' + msg,
      status || 200,
    )
    try {
      ingresso.set('status_webhook', 'erro')
      $app.save(ingresso)
    } catch (_) {}
    return e.json(502, {
      message:
        'A INAC não confirmou a credencial. Motivo: ' +
        msg +
        '. Tente de novo em alguns segundos; se repetir, chame o suporte antes de tentar outra vez.',
    })
  }

  ingresso.set('inac_id', inacId)
  ingresso.set('inac_qr', qrcode)
  ingresso.set('status_webhook', 'enviado')
  try {
    $app.save(ingresso)
  } catch (errSave) {
    avisos.push(
      'A credencial foi criada na INAC (id ' +
        inacId +
        '), mas NÃO foi possível gravar isso aqui: ' +
        ((errSave && errSave.message) || 'erro desconhecido') +
        '. Mostre o QR desta tela para a pessoa e avise o suporte. NÃO gere de novo — isso duplicaria a credencial dela.',
    )
  }

  // Registro de auditoria da ação principal, com confirmação de gravação.
  let logOk = true
  try {
    const collA = $app.findCollectionByNameOrId('webhooks_log')
    const recA = new Record(collA)
    recA.set('ingresso_id', ticketId)
    recA.set('evento', 'helpdesk_qr_gerado')
    recA.set('method', 'HELPDESK')
    recA.set('status', status || 200)
    recA.set(
      'detalhe',
      'Help desk (' +
        operador +
        ') — credencial gerada — ingresso ' +
        ingresso.getString('pedido_id') +
        ' — ' +
        part.getString('nome_completo'),
    )
    recA.set(
      'payload',
      JSON.stringify({
        origem: 'helpdesk',
        acao: 'gerar_qr',
        operador: operador,
        pedido_id: ingresso.getString('pedido_id'),
        inac_id: inacId,
      }),
    )
    recA.set('response', 'INAC /add OK — ' + msg)
    $app.save(recA)
  } catch (errL) {
    logOk = false
    avisos.push(
      'A credencial foi gerada, mas o registro dela no histórico falhou: ' +
        ((errL && errL.message) || 'erro desconhecido') +
        '. Anote o pedido ' +
        ingresso.getString('pedido_id') +
        ' e avise o suporte.',
    )
  }

  return e.json(200, { ok: true, qrcode: qrcode, avisos: avisos, log_ok: logOk })
})

// --- Novo credenciamento: pessoa que NÃO está na base (comprou na porta, ou
//     o ingresso não foi importado). Cria comprador (ou reaproveita pelo
//     e-mail), cria o ingresso com pedido_id prefixado com H, cria o
//     participante e já emite a credencial na INAC. Exige motivo escrito.
routerAdd('POST', '/backend/v1/helpdesk/novo-credenciamento', (e) => {
  const secret = (n) => {
    let v = ''
    try {
      v = $os.getenv(n) || ''
    } catch (_) {}
    if (!v) {
      try {
        if (typeof $secrets !== 'undefined' && $secrets && $secrets.get) v = $secrets.get(n) || ''
      } catch (_) {}
    }
    return v
  }
  const readH = (n) => {
    try {
      const v = e.request.header.get(n)
      if (v) return v.toString()
    } catch (_) {}
    try {
      const h = e.requestInfo().headers || {}
      const k = n.toLowerCase().replace(/-/g, '_')
      if (h[k]) return h[k].toString()
    } catch (_) {}
    return ''
  }
  const digits = (s) => (s || '').toString().replace(/\D/g, '')
  const sanitize = (s) => {
    if (s == null) return ''
    let t = String(s)
    t = t.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, '')
    t = t.replace(
      /[\u200D\u20E3\u2190-\u21FF\u2300-\u27BF\u2600-\u26FF\u2B00-\u2BFF\uFE00-\uFE0F]/g,
      '',
    )
    t = t.replace(/[\u0000-\u001F\u007F]/g, '')
    return t.replace(/\s+/g, ' ').trim()
  }
  const decode = (b) => {
    if (b == null) return ''
    if (typeof b === 'string') return b
    try {
      return new TextDecoder().decode(b)
    } catch (_) {}
    return ''
  }
  const cpfFmt = (s) => {
    const d = digits(s)
    if (d.length !== 11) return (s || '').toString().trim()
    return d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4')
  }
  const validCPF = (s) => {
    const c = digits(s)
    if (c.length !== 11 || /^(\d)\1{10}$/.test(c)) return false
    let sum = 0
    for (let i = 0; i < 9; i++) sum += parseInt(c[i], 10) * (10 - i)
    let d1 = 11 - (sum % 11)
    if (d1 >= 10) d1 = 0
    if (d1 !== parseInt(c[9], 10)) return false
    sum = 0
    for (let i = 0; i < 10; i++) sum += parseInt(c[i], 10) * (11 - i)
    let d2 = 11 - (sum % 11)
    if (d2 >= 10) d2 = 0
    return d2 === parseInt(c[10], 10)
  }

  const body = e.requestInfo().body || {}
  const expected = secret('HELPDESK_PASSWORD')
  if (!expected) return e.json(503, { message: 'Área de help desk não configurada.' })
  let sent = readH('X-Helpdesk-Key')
  if (!sent && body._key) sent = String(body._key)
  if (sent !== expected) return e.json(401, { message: 'Senha incorreta.' })

  const operador = (body.operador || '').toString().replace(/\s+/g, ' ').trim()
  const quem = operador || 'não identificado'

  const nome = (body.nome_completo || '').toString().replace(/\s+/g, ' ').trim()
  const email = (body.email || '').toString().trim().toLowerCase()
  const cpf = cpfFmt((body.cpf || '').toString())
  const telefone = (body.telefone || '').toString().trim()
  const empresa = (body.empresa || '').toString().trim()
  const tipo = (body.tipo || '').toString().trim().toUpperCase()
  const motivo = (body.motivo || '').toString().replace(/\s+/g, ' ').trim()

  if (['GOLD', 'PLATINUM', 'PALESTRANTES', 'HACKATHON'].indexOf(tipo) === -1) {
    return e.json(400, { message: 'Escolha o tipo do ingresso.' })
  }
  if (motivo.length < 5) {
    return e.json(400, {
      message:
        'Escreva o motivo deste novo credenciamento (pelo menos 5 letras). Nada foi criado ainda.',
    })
  }
  if (nome.length < 3) return e.json(400, { message: 'Informe o nome completo.' })
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return e.json(400, { message: 'E-mail inválido.' })
  if (!validCPF(cpf)) return e.json(400, { message: 'CPF inválido.' })
  if (digits(telefone).length < 10) {
    return e.json(400, { message: 'Telefone inválido (informe com DDD).' })
  }

  // Já existe alguém credenciado com esse e-mail ou CPF? Então não é caso de
  // novo credenciamento — a pessoa tem que ser achada na busca.
  try {
    $app.findFirstRecordByFilter('participantes', 'email = {:em}', { em: email })
    return e.json(400, {
      message:
        'Este e-mail já está em um credenciamento. Busque a pessoa na tela inicial em vez de criar um novo.',
    })
  } catch (_) {}

  try {
    const recs = $app.findRecordsByFilter(
      'participantes',
      'cpf = {:fmt} || cpf = {:raw}',
      '',
      50,
      0,
      { fmt: cpf, raw: digits(cpf) },
    )
    for (let i = 0; i < recs.length; i++) {
      const iid = recs[i].getString('ingresso_id')
      try {
        const ing = $app.findRecordById('ingressos', iid)
        if (ing.getString('status') === 'Pré-Credenciado') {
          return e.json(400, {
            message:
              'Este CPF já está em um credenciamento (pedido ' +
              ing.getString('pedido_id') +
              '). Busque a pessoa na tela inicial em vez de criar um novo.',
          })
        }
      } catch (_) {}
    }
  } catch (_) {}

  // pedido_id único, prefixo H de "help desk"
  let pedidoId = ''
  for (let i = 0; i < 30; i++) {
    const cand = 'H' + $security.randomString(6).toUpperCase()
    let existe = false
    try {
      $app.findFirstRecordByData('ingressos', 'pedido_id', cand)
      existe = true
    } catch (_) {}
    if (!existe) {
      pedidoId = cand
      break
    }
  }
  if (!pedidoId) {
    return e.json(500, {
      message: 'Não foi possível gerar um número de pedido novo. Tente de novo em alguns segundos.',
    })
  }

  let ingressoId = ''
  let compradorCriado = false

  try {
    $app.runInTransaction((txApp) => {
      // comprador: reaproveita pelo e-mail (o índice de e-mail é único)
      let compradorId = ''
      try {
        const c = txApp.findFirstRecordByFilter('compradores', 'email = {:em}', { em: email })
        compradorId = c.id
      } catch (_) {}
      if (!compradorId) {
        const compColl = txApp.findCollectionByNameOrId('compradores')
        const comp = new Record(compColl)
        comp.set('nome', nome)
        comp.set('email', email)
        comp.set('documento', digits(cpf))
        comp.set('telefone', telefone)
        txApp.save(comp)
        compradorId = comp.id
        compradorCriado = true
      }

      const ingColl = txApp.findCollectionByNameOrId('ingressos')
      const ing = new Record(ingColl)
      ing.set('comprador_id', compradorId)
      ing.set('pedido_id', pedidoId)
      ing.set('tipo_ingresso', tipo)
      ing.set('status', 'Pendente')
      ing.set('status_webhook', 'pendente')
      ing.set('origem', 'helpdesk')
      txApp.save(ing)
      ingressoId = ing.id

      const partColl = txApp.findCollectionByNameOrId('participantes')
      const part = new Record(partColl)
      part.set('ingresso_id', ing.id)
      part.set('nome_completo', nome)
      part.set('email', email)
      part.set('cpf', cpf)
      part.set('telefone', telefone)
      part.set('tem_empresa', false)
      part.set('nome_empresa', '')
      part.set('cargo', '')
      part.set('profissao', empresa)
      part.set('nicho', '')
      part.set('ia_uso_diario', 0)
      part.set('ia_profundidade', 0)
      part.set('terms_accepted_at', new Date().toISOString())
      txApp.save(part)

      ing.set('participante_id', part.id)
      ing.set('status', 'Pré-Credenciado')
      ing.set('preenchido_em', new Date().toISOString())
      txApp.save(ing)
    })
  } catch (err) {
    const m = (err && err.message) || 'erro desconhecido'
    if (/unique/i.test(m) && m.indexOf('compradores') !== -1) {
      return e.json(400, {
        message: 'Já existe um comprador com este e-mail. Busque por ele na tela inicial.',
      })
    }
    return e.json(400, { message: 'Não foi possível criar o credenciamento: ' + m })
  }

  // credencial na INAC
  const avisos = []
  let qrcode = ''
  let inacOk = false
  let inacMsg = ''

  const base = secret('INAC_WEBHOOK_URL')
  const addUrl = base || 'https://painel.credenciamento.digital/apiservicev1/attendees/add'
  const token = secret('INAC_AUTH_TOKEN')

  if (!token) {
    inacMsg = 'o token de acesso à INAC não está configurado no servidor'
    avisos.push(
      'A pessoa foi cadastrada aqui (pedido ' +
        pedidoId +
        '), mas NENHUMA credencial foi emitida: o token da INAC não está configurado no servidor. Avise o suporte agora.',
    )
  } else {
    let tel = digits(telefone)
    if (tel && tel.length <= 11) tel = '55' + tel
    const payload = {
      event_id: 375,
      category_id:
        { GOLD: 6123, PLATINUM: 6125, PALESTRANTES: 7863, HACKATHON: 7864 }[tipo] || 6123,
      status: 'active',
      fields: [
        { id: 10133653, value: sanitize(nome) },
        { id: 10133654, value: email },
        { id: 10133655, value: digits(cpf) },
        { id: 10133656, value: tel },
        { id: 10133657, value: sanitize(empresa) },
        { id: 10133665, value: pedidoId },
      ],
    }

    let status = 0
    let respTxt = ''
    let erroMsg = ''
    try {
      const res = $http.send({
        url: addUrl,
        method: 'POST',
        headers: { 'X-Auth-Token': token, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        timeout: 15,
      })
      status = res.statusCode
      respTxt = decode(res.body)
    } catch (err) {
      erroMsg = (err && err.message) || 'erro de rede'
    }

    let inacId = ''
    if (status >= 200 && status < 300) {
      try {
        const data = JSON.parse(respTxt)
        if (data && data.status === true && data.attendee) {
          inacId = String(data.attendee.id || '')
          qrcode = String(data.attendee.qrcode || '')
        }
      } catch (_) {}
    }
    inacOk = !!qrcode
    inacMsg = erroMsg ? erroMsg : 'HTTP ' + status + (inacOk ? '' : ' ' + respTxt.substring(0, 200))
    if (!inacOk) {
      avisos.push(
        'A pessoa foi cadastrada (pedido ' +
          pedidoId +
          '), mas o QR Code NÃO saiu. Motivo: ' +
          inacMsg +
          '. Busque por ela na tela inicial e use "Gerar credencial".',
      )
    }

    try {
      const ing2 = $app.findRecordById('ingressos', ingressoId)
      if (inacOk) {
        ing2.set('inac_id', inacId)
        ing2.set('inac_qr', qrcode)
        ing2.set('status_webhook', 'enviado')
      } else {
        ing2.set('status_webhook', 'erro')
      }
      $app.save(ing2)
    } catch (errSave) {
      avisos.push(
        'A credencial foi criada na INAC, mas NÃO foi possível gravar isso aqui: ' +
          ((errSave && errSave.message) || 'erro desconhecido') +
          '. Mostre o QR desta tela e avise o suporte. NÃO gere de novo — isso duplicaria a credencial.',
      )
    }
  }

  // Registro de auditoria da ação principal, com confirmação de gravação.
  let logOk = true
  try {
    const collA = $app.findCollectionByNameOrId('webhooks_log')
    const recA = new Record(collA)
    recA.set('ingresso_id', ingressoId)
    recA.set('evento', 'helpdesk_novo_credenciamento')
    recA.set('method', 'HELPDESK')
    recA.set('status', 200)
    recA.set(
      'detalhe',
      'Help desk (' +
        quem +
        ') — NOVO credenciamento criado do zero — pedido ' +
        pedidoId +
        ' (' +
        tipo +
        ') — ' +
        nome +
        (compradorCriado ? ' — comprador novo criado' : ' — vinculado a comprador existente') +
        (inacOk ? ' — QR gerado.' : ' — SEM QR (falha na INAC).') +
        ' — motivo: ' +
        motivo,
    )
    recA.set(
      'payload',
      JSON.stringify({
        origem: 'helpdesk',
        acao: 'novo_credenciamento',
        operador: quem,
        pedido_id: pedidoId,
        tipo: tipo,
        motivo: motivo,
        comprador_criado: compradorCriado,
        dados: {
          nome_completo: nome,
          email: email,
          cpf: cpf,
          telefone: telefone,
          empresa: empresa,
        },
      }),
    )
    recA.set('response', inacOk ? 'INAC /add OK' : 'INAC: ' + inacMsg)
    $app.save(recA)
  } catch (errL) {
    logOk = false
    avisos.push(
      'O credenciamento foi criado, mas o registro dele no histórico falhou: ' +
        ((errL && errL.message) || 'erro desconhecido') +
        '. Anote o pedido ' +
        pedidoId +
        ' e avise o suporte.',
    )
  }

  return e.json(200, {
    ok: true,
    qrcode: qrcode,
    inac_ok: inacOk,
    inac_msg: inacMsg,
    nome: nome,
    pedido_id: pedidoId,
    tipo_ingresso: tipo,
    comprador_criado: compradorCriado,
    avisos: avisos,
    log_ok: logOk,
  })
})

// --- Reenvio do e-mail do COMPRADOR (template Email02: link de acesso para
//     ele preencher os participantes). Mesmo disparo já usado fora do balcão.
routerAdd('POST', '/backend/v1/helpdesk/comprador/{id}/reenviar', (e) => {
  const secret = (n) => {
    let v = ''
    try {
      v = $os.getenv(n) || ''
    } catch (_) {}
    if (!v) {
      try {
        if (typeof $secrets !== 'undefined' && $secrets && $secrets.get) v = $secrets.get(n) || ''
      } catch (_) {}
    }
    return v
  }
  const readH = (n) => {
    try {
      const v = e.request.header.get(n)
      if (v) return v.toString()
    } catch (_) {}
    try {
      const h = e.requestInfo().headers || {}
      const k = n.toLowerCase().replace(/-/g, '_')
      if (h[k]) return h[k].toString()
    } catch (_) {}
    return ''
  }
  // O TextDecoder do JSVM erra acentos: decodifica UTF-8 na mão.
  const decodeBody = (b) => {
    if (b == null) return ''
    if (typeof b === 'string') return b
    let bytes
    try {
      bytes = new Uint8Array(b)
    } catch (_) {
      bytes = b
    }
    let out = ''
    let i = 0
    const len = bytes.length
    while (i < len) {
      const b1 = bytes[i++]
      if (b1 < 0x80) {
        out += String.fromCharCode(b1)
      } else if ((b1 & 0xe0) === 0xc0 && i < len) {
        const b2 = bytes[i++]
        out += String.fromCharCode(((b1 & 0x1f) << 6) | (b2 & 0x3f))
      } else if ((b1 & 0xf0) === 0xe0 && i + 1 < len) {
        const b2 = bytes[i++]
        const b3 = bytes[i++]
        out += String.fromCharCode(((b1 & 0x0f) << 12) | ((b2 & 0x3f) << 6) | (b3 & 0x3f))
      } else if ((b1 & 0xf8) === 0xf0 && i + 2 < len) {
        const b2 = bytes[i++]
        const b3 = bytes[i++]
        const b4 = bytes[i++]
        let cp = ((b1 & 0x07) << 18) | ((b2 & 0x3f) << 12) | ((b3 & 0x3f) << 6) | (b4 & 0x3f)
        cp -= 0x10000
        out += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff))
      }
    }
    return out
  }

  const body = e.requestInfo().body || {}
  const expected = secret('HELPDESK_PASSWORD')
  if (!expected) return e.json(503, { message: 'Área de help desk não configurada.' })
  let sent = readH('X-Helpdesk-Key')
  if (!sent && body._key) sent = String(body._key)
  if (sent !== expected) return e.json(401, { message: 'Senha incorreta.' })

  const operador = (body.operador || '').toString().replace(/\s+/g, ' ').trim()
  const quem = operador || 'não identificado'
  const compradorId = e.request.pathValue('id')

  let comprador
  try {
    comprador = $app.findRecordById('compradores', compradorId)
  } catch (_) {
    return e.json(404, { message: 'Comprador não encontrado.' })
  }

  const email = comprador.getString('email')
  const nome = comprador.getString('nome')
  if (!email) {
    return e.json(400, {
      message: 'Este comprador não tem e-mail cadastrado, então não há para onde reenviar.',
    })
  }

  const sg = secret('SENDGRID_API_KEY')
  if (!sg) {
    return e.json(500, {
      message:
        'O envio de e-mails não está configurado no servidor (SENDGRID_API_KEY). Avise o suporte.',
    })
  }

  const templateNome = 'Skip-Summit26-Send-Comprador-Email02'
  let templateId = ''
  try {
    const res = $http.send({
      url: 'https://api.sendgrid.com/v3/templates?generations=dynamic&page_size=200',
      method: 'GET',
      headers: { Authorization: 'Bearer ' + sg },
      timeout: 20,
    })
    const parsed = JSON.parse(decodeBody(res.body))
    const list = parsed.result || parsed.templates || []
    for (let i = 0; i < list.length; i++) {
      if (list[i] && list[i].name === templateNome && list[i].id) {
        templateId = list[i].id
        break
      }
    }
  } catch (err) {
    return e.json(502, {
      message:
        'Não foi possível falar com o serviço de e-mail: ' +
        ((err && err.message) || 'erro desconhecido') +
        '. Nada foi enviado.',
    })
  }
  if (!templateId) {
    return e.json(502, {
      message: 'O modelo de e-mail "' + templateNome + '" não foi encontrado. Nada foi enviado.',
    })
  }

  let token = ''
  try {
    const tokenColl = $app.findCollectionByNameOrId('tokens_acesso')
    token = $security.randomString(40)
    const tr = new Record(tokenColl)
    tr.set('comprador_id', comprador.id)
    tr.set('token', token)
    tr.set('usado', false)
    const exp = new Date()
    exp.setDate(exp.getDate() + 60)
    tr.set('expira_em', exp.toISOString())
    $app.save(tr)
  } catch (err) {
    return e.json(500, {
      message:
        'Falha ao gerar o link de acesso: ' +
        ((err && err.message) || 'erro desconhecido') +
        '. Nada foi enviado.',
    })
  }

  let enviado = false
  let erro = ''
  try {
    const res = $http.send({
      url: 'https://api.sendgrid.com/v3/mail/send',
      method: 'POST',
      headers: { Authorization: 'Bearer ' + sg, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: { email: 'duvidas@adapta.org', name: 'Adapta Summit 2026' },
        template_id: templateId,
        personalizations: [
          {
            to: [{ email: email, name: nome }],
            dynamic_template_data: {
              firstname: (nome.split(' ')[0] || nome || '').trim(),
              token: token,
            },
          },
        ],
      }),
      timeout: 20,
    })
    enviado = res.statusCode >= 200 && res.statusCode < 300
    if (!enviado) erro = 'o serviço de e-mail recusou (HTTP ' + res.statusCode + ')'
  } catch (err) {
    erro = (err && err.message) || 'falha de rede'
  }

  const avisos = []
  let logOk = true
  try {
    const collA = $app.findCollectionByNameOrId('webhooks_log')
    const recA = new Record(collA)
    recA.set('evento', 'helpdesk_reenvio_comprador')
    recA.set('method', 'HELPDESK')
    recA.set('status', enviado ? 200 : 0)
    recA.set(
      'detalhe',
      'Help desk (' +
        quem +
        ') — reenviou o e-mail do comprador (' +
        templateNome +
        ') para ' +
        (nome || email) +
        ' (' +
        email +
        ') — ' +
        (enviado ? 'enviado' : 'FALHOU: ' + erro),
    )
    recA.set(
      'payload',
      JSON.stringify({
        origem: 'helpdesk',
        acao: 'reenvio_comprador',
        operador: quem,
        comprador_id: comprador.id,
        email: email,
        template: templateNome,
      }),
    )
    recA.set('response', enviado ? 'OK' : erro)
    $app.save(recA)
  } catch (errL) {
    logOk = false
    avisos.push(
      'O e-mail foi processado, mas o registro no histórico falhou: ' +
        ((errL && errL.message) || 'erro desconhecido') +
        '. Avise o suporte.',
    )
  }

  if (!enviado) {
    return e.json(502, {
      message:
        'O e-mail NÃO foi enviado para ' +
        email +
        '. Motivo: ' +
        erro +
        '. Tente de novo em alguns segundos; se repetir, chame o suporte.',
    })
  }

  return e.json(200, { ok: true, email: email, avisos: avisos, log_ok: logOk })
})

// --- Reenvio do INGRESSO para o participante (template Send-Participante:
//     link do ingresso/credencial da própria pessoa).
routerAdd('POST', '/backend/v1/helpdesk/ticket/{id}/reenviar', (e) => {
  const secret = (n) => {
    let v = ''
    try {
      v = $os.getenv(n) || ''
    } catch (_) {}
    if (!v) {
      try {
        if (typeof $secrets !== 'undefined' && $secrets && $secrets.get) v = $secrets.get(n) || ''
      } catch (_) {}
    }
    return v
  }
  const readH = (n) => {
    try {
      const v = e.request.header.get(n)
      if (v) return v.toString()
    } catch (_) {}
    try {
      const h = e.requestInfo().headers || {}
      const k = n.toLowerCase().replace(/-/g, '_')
      if (h[k]) return h[k].toString()
    } catch (_) {}
    return ''
  }
  const decodeBody = (b) => {
    if (b == null) return ''
    if (typeof b === 'string') return b
    let bytes
    try {
      bytes = new Uint8Array(b)
    } catch (_) {
      bytes = b
    }
    let out = ''
    let i = 0
    const len = bytes.length
    while (i < len) {
      const b1 = bytes[i++]
      if (b1 < 0x80) {
        out += String.fromCharCode(b1)
      } else if ((b1 & 0xe0) === 0xc0 && i < len) {
        const b2 = bytes[i++]
        out += String.fromCharCode(((b1 & 0x1f) << 6) | (b2 & 0x3f))
      } else if ((b1 & 0xf0) === 0xe0 && i + 1 < len) {
        const b2 = bytes[i++]
        const b3 = bytes[i++]
        out += String.fromCharCode(((b1 & 0x0f) << 12) | ((b2 & 0x3f) << 6) | (b3 & 0x3f))
      } else if ((b1 & 0xf8) === 0xf0 && i + 2 < len) {
        const b2 = bytes[i++]
        const b3 = bytes[i++]
        const b4 = bytes[i++]
        let cp = ((b1 & 0x07) << 18) | ((b2 & 0x3f) << 12) | ((b3 & 0x3f) << 6) | (b4 & 0x3f)
        cp -= 0x10000
        out += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff))
      }
    }
    return out
  }

  const body = e.requestInfo().body || {}
  const expected = secret('HELPDESK_PASSWORD')
  if (!expected) return e.json(503, { message: 'Área de help desk não configurada.' })
  let sent = readH('X-Helpdesk-Key')
  if (!sent && body._key) sent = String(body._key)
  if (sent !== expected) return e.json(401, { message: 'Senha incorreta.' })

  const operador = (body.operador || '').toString().replace(/\s+/g, ' ').trim()
  const quem = operador || 'não identificado'
  const ticketId = e.request.pathValue('id')

  let ingresso
  try {
    ingresso = $app.findRecordById('ingressos', ticketId)
  } catch (_) {
    return e.json(404, { message: 'Ingresso não encontrado.' })
  }
  const partId = ingresso.getString('participante_id')
  if (!partId) {
    return e.json(400, {
      message:
        'Este ingresso ainda não tem participante. Reenvie o e-mail do COMPRADOR (botão no card dele) ou credencie a pessoa aqui mesmo.',
    })
  }
  let part
  try {
    part = $app.findRecordById('participantes', partId)
  } catch (_) {
    return e.json(400, { message: 'Participante não encontrado para este ingresso.' })
  }

  const email = part.getString('email')
  const nome = part.getString('nome_completo')
  if (!email) return e.json(400, { message: 'Este participante não tem e-mail cadastrado.' })

  const sg = secret('SENDGRID_API_KEY')
  if (!sg) {
    return e.json(500, {
      message:
        'O envio de e-mails não está configurado no servidor (SENDGRID_API_KEY). Avise o suporte.',
    })
  }

  const templateNome = 'Skip-Summit26-Send-Participante'
  let templateId = ''
  try {
    const res = $http.send({
      url: 'https://api.sendgrid.com/v3/templates?generations=dynamic&page_size=200',
      method: 'GET',
      headers: { Authorization: 'Bearer ' + sg },
      timeout: 20,
    })
    const parsed = JSON.parse(decodeBody(res.body))
    const list = parsed.result || parsed.templates || []
    for (let i = 0; i < list.length; i++) {
      if (list[i] && list[i].name === templateNome && list[i].id) {
        templateId = list[i].id
        break
      }
    }
  } catch (err) {
    return e.json(502, {
      message:
        'Não foi possível falar com o serviço de e-mail: ' +
        ((err && err.message) || 'erro desconhecido') +
        '. Nada foi enviado.',
    })
  }
  if (!templateId) {
    return e.json(502, {
      message: 'O modelo de e-mail "' + templateNome + '" não foi encontrado. Nada foi enviado.',
    })
  }

  // token do ingresso: reaproveita o existente ou cria um novo de 60 dias
  let token = ''
  try {
    try {
      const link = $app.findFirstRecordByFilter('links_participante', 'ingresso_id = {:iid}', {
        iid: ticketId,
      })
      token = link.getString('token')
    } catch (_) {
      const linksColl = $app.findCollectionByNameOrId('links_participante')
      token = $security.randomString(40)
      const lr = new Record(linksColl)
      lr.set('ingresso_id', ticketId)
      lr.set('token', token)
      lr.set('usado', false)
      const exp = new Date()
      exp.setDate(exp.getDate() + 60)
      lr.set('expira_em', exp.toISOString())
      $app.save(lr)
    }
  } catch (err) {
    return e.json(500, {
      message:
        'Falha ao gerar o link do ingresso: ' +
        ((err && err.message) || 'erro desconhecido') +
        '. Nada foi enviado.',
    })
  }

  let enviado = false
  let erro = ''
  try {
    const res = $http.send({
      url: 'https://api.sendgrid.com/v3/mail/send',
      method: 'POST',
      headers: { Authorization: 'Bearer ' + sg, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: { email: 'duvidas@adapta.org', name: 'Adapta Summit 2026' },
        template_id: templateId,
        personalizations: [
          {
            to: [{ email: email, name: nome }],
            dynamic_template_data: {
              firstname: (nome.split(' ')[0] || nome || '').trim(),
              token: token,
            },
          },
        ],
      }),
      timeout: 20,
    })
    enviado = res.statusCode >= 200 && res.statusCode < 300
    if (!enviado) erro = 'o serviço de e-mail recusou (HTTP ' + res.statusCode + ')'
  } catch (err) {
    erro = (err && err.message) || 'falha de rede'
  }

  const avisos = []
  let logOk = true
  try {
    const collA = $app.findCollectionByNameOrId('webhooks_log')
    const recA = new Record(collA)
    recA.set('ingresso_id', ticketId)
    recA.set('evento', 'helpdesk_reenvio_participante')
    recA.set('method', 'HELPDESK')
    recA.set('status', enviado ? 200 : 0)
    recA.set(
      'detalhe',
      'Help desk (' +
        quem +
        ') — reenviou o ingresso ' +
        ingresso.getString('pedido_id') +
        ' (' +
        templateNome +
        ') para ' +
        (nome || email) +
        ' (' +
        email +
        ') — ' +
        (enviado ? 'enviado' : 'FALHOU: ' + erro),
    )
    recA.set(
      'payload',
      JSON.stringify({
        origem: 'helpdesk',
        acao: 'reenvio_participante',
        operador: quem,
        pedido_id: ingresso.getString('pedido_id'),
        participante_id: part.id,
        email: email,
        template: templateNome,
      }),
    )
    recA.set('response', enviado ? 'OK' : erro)
    $app.save(recA)
  } catch (errL) {
    logOk = false
    avisos.push(
      'O e-mail foi processado, mas o registro no histórico falhou: ' +
        ((errL && errL.message) || 'erro desconhecido') +
        '. Avise o suporte.',
    )
  }

  if (!enviado) {
    return e.json(502, {
      message:
        'O e-mail NÃO foi enviado para ' +
        email +
        '. Motivo: ' +
        erro +
        '. Tente de novo em alguns segundos; se repetir, chame o suporte.',
    })
  }

  return e.json(200, { ok: true, email: email, avisos: avisos, log_ok: logOk })
})
