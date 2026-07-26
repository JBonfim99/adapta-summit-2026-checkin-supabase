// ========================= HELP DESK (/helpdesk) =========================
// Área operacional de balcão, protegida por SENHA ÚNICA (env HELPDESK_PASSWORD).
// Não usa login de usuário do PocketBase: a senha vai no header X-Helpdesk-Key
// (com fallback em _key no body/query) e é comparada com a env em TODA rota.
//
// O que a área faz:
//   1) Busca global (nome, e-mail, documento/CPF, telefone, nº do pedido)
//   2) Credencia quem ainda não tem credencial (cria participante + INAC /add)
//   3) Altera ingresso: dados da pessoa (INAC /edit) e tipo GOLD <-> PLATINUM
//   4) Mostra/gera o QR Code da credencial
//
// TODA ação é registrada em webhooks_log com evento helpdesk_* e method
// HELPDESK, incluindo o nome do atendente que operou (aparece em /admin/logs).

// ---------------------------------------------------------------- utilitários

const hdSecret = (name) => {
  let v = ''
  try {
    v = $os.getenv(name) || ''
  } catch (_) {}
  if (!v) {
    try {
      if (typeof $secrets !== 'undefined' && $secrets && $secrets.get) {
        v = $secrets.get(name) || ''
      }
    } catch (_) {}
  }
  return v
}

const hdHeader = (e, name) => {
  try {
    const v = e.request.header.get(name)
    if (v) return v.toString()
  } catch (_) {}
  try {
    const h = e.requestInfo().headers || {}
    const k = name.toLowerCase().replace(/-/g, '_')
    if (h[k]) return h[k].toString()
  } catch (_) {}
  return ''
}

const hdQuery = (e, name) => {
  try {
    const q = e.requestInfo().query || {}
    const v = q[name]
    if (v == null) return ''
    return (Array.isArray(v) ? v[0] : v).toString()
  } catch (_) {}
  return ''
}

// Valida a senha única. Retorna null quando OK, ou a resposta de erro pronta.
const hdGuard = (e, body) => {
  const expected = hdSecret('HELPDESK_PASSWORD')
  if (!expected) {
    return e.json(503, {
      message:
        'Área de help desk ainda não configurada. Defina a variável HELPDESK_PASSWORD no servidor.',
    })
  }
  let sent = hdHeader(e, 'X-Helpdesk-Key')
  if (!sent && body && body._key) sent = String(body._key)
  if (!sent) sent = hdQuery(e, '_key')
  if (sent !== expected) return e.json(401, { message: 'Senha incorreta.' })
  return null
}

const hdOperador = (e, body) => {
  let op = ''
  if (body && body.operador) op = String(body.operador)
  if (!op) op = hdQuery(e, 'operador')
  op = op.replace(/\s+/g, ' ').trim()
  return op || 'não identificado'
}

const hdDigits = (s) => (s || '').toString().replace(/\D/g, '')

const hdSanitize = (s) => {
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

const hdDecode = (b) => {
  if (b == null) return ''
  if (typeof b === 'string') return b
  try {
    return new TextDecoder().decode(b)
  } catch (_) {}
  try {
    let s = ''
    for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i])
    return s
  } catch (_) {}
  return ''
}

const hdCpfFmt = (s) => {
  const d = hdDigits(s)
  if (d.length !== 11) return (s || '').toString().trim()
  return d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4')
}

const hdValidCPF = (s) => {
  const c = hdDigits(s)
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

// Registra a ação no mesmo log que alimenta /admin/logs.
const hdLog = (ingressoId, evento, detalhe, payloadObj, response, status) => {
  try {
    const coll = $app.findCollectionByNameOrId('webhooks_log')
    const log = new Record(coll)
    if (ingressoId) log.set('ingresso_id', ingressoId)
    log.set('evento', evento)
    log.set('method', 'HELPDESK')
    log.set('status', typeof status === 'number' ? status : 200)
    log.set('detalhe', detalhe || '')
    log.set('payload', JSON.stringify(payloadObj || {}))
    log.set('response', (response || '').toString().substring(0, 500))
    $app.save(log)
  } catch (_) {}
}

// ------------------------------------------------------------------ INAC

const hdInac = () => {
  const base = hdSecret('INAC_WEBHOOK_URL')
  const addUrl = base || 'https://painel.credenciamento.digital/apiservicev1/attendees/add'
  let editUrl = 'https://painel.credenciamento.digital/apiservicev1/attendees/edit'
  if (/\/attendees\/add\/?$/.test(base)) editUrl = base.replace(/\/add\/?$/, '/edit')
  return { add: addUrl, edit: editUrl, token: hdSecret('INAC_AUTH_TOKEN') }
}

// Monta o payload da INAC a partir dos dados da pessoa + ingresso.
const hdInacPayload = (dados, pedidoId, tipo, inacId) => {
  let tel = hdDigits(dados.telefone)
  if (tel && tel.length <= 11) tel = '55' + tel
  const payload = {
    event_id: 375,
    category_id: tipo === 'PLATINUM' ? 6125 : 6123,
    status: 'active',
    fields: [
      { id: 10133653, value: hdSanitize(dados.nome_completo) },
      { id: 10133654, value: (dados.email || '').toString().trim().toLowerCase() },
      { id: 10133655, value: hdDigits(dados.cpf) },
      { id: 10133656, value: tel },
      { id: 10133657, value: hdSanitize(dados.empresa || '') },
      { id: 10133665, value: pedidoId },
    ],
  }
  if (inacId) payload.id = parseInt(inacId, 10) || inacId
  return payload
}

const hdInacSend = (url, method, payload) => {
  const cfg = hdInac()
  if (!cfg.token) {
    return { ok: false, status: 0, body: '', msg: 'INAC_AUTH_TOKEN não configurado' }
  }
  let status = 0
  let respTxt = ''
  let erroMsg = ''
  try {
    const res = $http.send({
      url: url,
      method: method,
      headers: { 'X-Auth-Token': cfg.token, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      timeout: 15,
    })
    status = res.statusCode
    respTxt = hdDecode(res.body)
  } catch (err) {
    erroMsg = (err && err.message) || 'erro de rede'
  }
  let ok = status >= 200 && status < 300
  let data = null
  try {
    data = JSON.parse(respTxt)
    if (data && data.status === false) ok = false
  } catch (_) {}
  return {
    ok: ok,
    status: status,
    body: respTxt || erroMsg,
    data: data,
    msg: erroMsg ? erroMsg : 'HTTP ' + status + (ok ? '' : ' ' + respTxt.substring(0, 200)),
  }
}

// Cria o attendee na INAC e grava inac_id/inac_qr no ingresso. Idempotente.
const hdInacAdd = (ingresso, dados, operador, contexto) => {
  if (ingresso.getString('inac_id')) {
    return { ok: true, qrcode: ingresso.getString('inac_qr'), msg: 'já existia na INAC' }
  }
  const cfg = hdInac()
  const payload = hdInacPayload(
    dados,
    ingresso.getString('pedido_id'),
    ingresso.getString('tipo_ingresso'),
    '',
  )
  const r = hdInacSend(cfg.add, 'POST', payload)

  let inacId = ''
  let inacQr = ''
  if (r.ok && r.data && r.data.attendee) {
    inacId = String(r.data.attendee.id || '')
    inacQr = String(r.data.attendee.qrcode || '')
  }

  if (inacQr) {
    ingresso.set('inac_id', inacId)
    ingresso.set('inac_qr', inacQr)
    ingresso.set('status_webhook', 'enviado')
  } else {
    ingresso.set('status_webhook', 'erro')
  }
  try {
    $app.save(ingresso)
  } catch (_) {}

  hdLog(
    ingresso.id,
    inacQr ? 'webhook_enviado' : 'webhook_erro',
    (inacQr ? 'INAC /add OK (id ' + inacId + ')' : 'Falha no INAC /add — ' + r.msg) +
      ' — via help desk (' +
      operador +
      ')' +
      (contexto ? ' [' + contexto + ']' : ''),
    payload,
    r.body,
    r.status || 0,
  )

  return { ok: !!inacQr, qrcode: inacQr, inac_id: inacId, msg: r.msg, status: r.status }
}

// ------------------------------------------------------------------ helpers de leitura

const hdParticipanteDe = (ingresso) => {
  const pid = ingresso.getString('participante_id')
  if (!pid) return null
  try {
    return $app.findRecordById('participantes', pid)
  } catch (_) {
    return null
  }
}

const hdDadosDoParticipante = (p) => ({
  nome_completo: p.getString('nome_completo'),
  email: p.getString('email'),
  cpf: p.getString('cpf'),
  telefone: p.getString('telefone'),
  empresa: p.getString('nome_empresa') || p.getString('profissao') || '',
})

// Valida o formulário de pessoa usado tanto no credenciamento quanto na edição.
const hdValidaPessoa = (body) => {
  const nome = (body.nome_completo || '').toString().replace(/\s+/g, ' ').trim()
  const email = (body.email || '').toString().trim().toLowerCase()
  const cpf = (body.cpf || '').toString().trim()
  const telefone = (body.telefone || '').toString().trim()
  const empresa = (body.empresa || '').toString().trim()

  if (nome.length < 3) return { erro: 'Informe o nome completo.' }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { erro: 'E-mail inválido.' }
  if (!hdValidCPF(cpf)) return { erro: 'CPF inválido.' }
  if (hdDigits(telefone).length < 10) return { erro: 'Telefone inválido (informe com DDD).' }

  return {
    dados: {
      nome_completo: nome,
      email: email,
      cpf: hdCpfFmt(cpf),
      telefone: telefone,
      empresa: empresa,
    },
  }
}

// E-mail único entre participantes (ignorando um id, quando informado).
const hdEmailEmUso = (email, ignoraPartId) => {
  try {
    const rec = $app.findFirstRecordByFilter('participantes', 'email = {:em}', { em: email })
    if (rec && rec.id !== ignoraPartId) return true
  } catch (_) {}
  return false
}

// CPF não pode estar em outro credenciamento (ignorando um ingresso).
const hdCpfEmUso = (cpf, ignoraIngressoId) => {
  const raw = hdDigits(cpf)
  if (raw.length !== 11) return false
  const fmt = hdCpfFmt(raw)
  try {
    const recs = $app.findRecordsByFilter(
      'participantes',
      'cpf = {:fmt} || cpf = {:raw}',
      '',
      50,
      0,
      {
        fmt: fmt,
        raw: raw,
      },
    )
    for (let i = 0; i < recs.length; i++) {
      const iid = recs[i].getString('ingresso_id')
      if (iid && iid === ignoraIngressoId) continue
      try {
        const ing = $app.findRecordById('ingressos', iid)
        if (ing.getString('status') === 'Pré-Credenciado') return true
      } catch (_) {}
    }
  } catch (_) {}
  return false
}

// ============================== ROTAS ==============================

// --- Login: só confere a senha e devolve OK (a sessão fica no navegador) ---
routerAdd('POST', '/backend/v1/helpdesk/login', (e) => {
  const body = e.requestInfo().body || {}
  const bad = hdGuard(e, body)
  if (bad) return bad
  return e.json(200, { ok: true })
})

// --- Busca global: nome, e-mail, documento/CPF, telefone ou nº do pedido ---
// Encontra o COMPRADOR (por qualquer campo dele ou de qualquer participante
// dos ingressos dele) e devolve TODOS os ingressos desse comprador.
routerAdd('GET', '/backend/v1/helpdesk/search', (e) => {
  const bad = hdGuard(e, null)
  if (bad) return bad

  try {
    const raw = hdQuery(e, 'q').trim()
    if (raw.length < 3) {
      return e.json(200, { ok: true, compradores: [], aviso: 'Digite pelo menos 3 caracteres.' })
    }
    const q = raw.toLowerCase()
    const dig = hdDigits(raw)

    const clean = (col) =>
      'REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(' +
      col +
      ",'.',''),'-',''),'/',''),' ',''),'(',''),')','')"

    const params = { like: '%' + q + '%' }
    const ors = [
      'lower(c.nome) LIKE {:like}',
      'lower(c.email) LIKE {:like}',
      'lower(p.nome_completo) LIKE {:like}',
      'lower(p.email) LIKE {:like}',
      'lower(i.pedido_id) LIKE {:like}',
    ]
    if (dig.length >= 3) {
      params.dig = '%' + dig + '%'
      ors.push(clean('c.documento') + ' LIKE {:dig}')
      ors.push(clean('c.telefone') + ' LIKE {:dig}')
      ors.push(clean('p.cpf') + ' LIKE {:dig}')
      ors.push(clean('p.telefone') + ' LIKE {:dig}')
    }
    const WHERE = '(' + ors.join(' OR ') + ')'

    // 1) compradores que batem via ingressos/participantes
    const cids = {}
    const ordem = []
    const addCid = (id) => {
      if (id && !cids[id]) {
        cids[id] = true
        ordem.push(id)
      }
    }

    const m1 = arrayOf(new DynamicModel({ cid: '' }))
    $app
      .db()
      .newQuery(
        'SELECT DISTINCT i.comprador_id as cid FROM ingressos i ' +
          'LEFT JOIN compradores c ON c.id = i.comprador_id ' +
          'LEFT JOIN participantes p ON p.id = i.participante_id ' +
          'WHERE ' +
          WHERE +
          ' LIMIT 40',
      )
      .bind(params)
      .all(m1)
    for (let i = 0; i < m1.length; i++) addCid(m1[i].cid)

    // 2) compradores que batem por dados próprios (inclusive sem ingresso)
    const orsC = ['lower(c.nome) LIKE {:like}', 'lower(c.email) LIKE {:like}']
    if (dig.length >= 3) {
      orsC.push(clean('c.documento') + ' LIKE {:dig}')
      orsC.push(clean('c.telefone') + ' LIKE {:dig}')
    }
    const m2 = arrayOf(new DynamicModel({ cid: '' }))
    $app
      .db()
      .newQuery('SELECT c.id as cid FROM compradores c WHERE (' + orsC.join(' OR ') + ') LIMIT 40')
      .bind(params)
      .all(m2)
    for (let i = 0; i < m2.length; i++) addCid(m2[i].cid)

    if (ordem.length === 0) return e.json(200, { ok: true, compradores: [] })

    const safeIds = []
    for (let i = 0; i < ordem.length && i < 25; i++) {
      const s = String(ordem[i]).replace(/[^a-zA-Z0-9]/g, '')
      if (s) safeIds.push(s)
    }
    const inList = "'" + safeIds.join("','") + "'"

    // dados dos compradores
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

    // todos os ingressos desses compradores
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
          "COALESCE(p.email,'') as email, COALESCE(p.cpf,'') as cpf, COALESCE(p.telefone,'') as telefone, " +
          "COALESCE(p.nome_empresa,'') as nome_empresa, COALESCE(p.profissao,'') as profissao " +
          'FROM ingressos i LEFT JOIN participantes p ON p.id = i.participante_id ' +
          'WHERE i.comprador_id IN (' +
          inList +
          ') ORDER BY i.created ASC',
      )
      .all(rows)

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
      out.push({
        id: c.id,
        nome: c.nome,
        email: c.email,
        documento: c.documento,
        telefone: c.telefone,
        ingressos: porComprador[c.id] || [],
      })
    }

    return e.json(200, { ok: true, compradores: out })
  } catch (err) {
    return e.json(400, { message: err.message })
  }
})

// --- Credenciar: cria o participante do ingresso pendente e gera o QR ---
routerAdd('POST', '/backend/v1/helpdesk/credenciar', (e) => {
  const body = e.requestInfo().body || {}
  const bad = hdGuard(e, body)
  if (bad) return bad
  const operador = hdOperador(e, body)

  const ingressoId = (body.ingresso_id || '').toString()
  if (!ingressoId) return e.json(400, { message: 'Ingresso não informado.' })

  const v = hdValidaPessoa(body)
  if (v.erro) return e.json(400, { message: v.erro })
  const d = v.dados

  let ingresso
  try {
    ingresso = $app.findRecordById('ingressos', ingressoId)
  } catch (_) {
    return e.json(404, { message: 'Ingresso não encontrado.' })
  }
  if (ingresso.getString('participante_id')) {
    return e.json(400, {
      message: 'Este ingresso já tem uma pessoa vinculada. Use "Alterar" para mudar os dados.',
    })
  }
  if (hdEmailEmUso(d.email, '')) {
    return e.json(400, { message: 'Este e-mail já foi usado em outro credenciamento.' })
  }
  if (hdCpfEmUso(d.cpf, ingressoId)) {
    return e.json(400, { message: 'Este CPF já foi usado em outro credenciamento.' })
  }

  try {
    $app.runInTransaction((txApp) => {
      const ing = txApp.findRecordById('ingressos', ingressoId)
      if (ing.getString('participante_id')) throw new Error('Este ingresso já possui participante.')

      const partColl = txApp.findCollectionByNameOrId('participantes')
      const part = new Record(partColl)
      part.set('ingresso_id', ing.id)
      part.set('nome_completo', d.nome_completo)
      part.set('email', d.email)
      part.set('cpf', d.cpf)
      part.set('telefone', d.telefone)
      part.set('tem_empresa', false)
      part.set('nome_empresa', '')
      part.set('cargo', '')
      part.set('profissao', d.empresa)
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

  // pós-commit: gera a credencial na INAC
  let qrcode = ''
  let inacMsg = ''
  let inacOk = false
  try {
    const ing2 = $app.findRecordById('ingressos', ingressoId)
    const r = hdInacAdd(ing2, d, operador, 'credenciamento no balcão')
    qrcode = r.qrcode || ''
    inacMsg = r.msg || ''
    inacOk = !!r.ok
  } catch (err) {
    inacMsg = (err && err.message) || 'erro'
  }

  hdLog(
    ingressoId,
    'helpdesk_credenciamento',
    'Help desk (' +
      operador +
      ') — ingresso ' +
      ingresso.getString('pedido_id') +
      ' (' +
      ingresso.getString('tipo_ingresso') +
      ') — credenciou ' +
      d.nome_completo +
      (inacOk ? ' — QR gerado.' : ' — FALHA ao gerar o QR na INAC.'),
    {
      origem: 'helpdesk',
      acao: 'credenciamento',
      operador: operador,
      pedido_id: ingresso.getString('pedido_id'),
      tipo: ingresso.getString('tipo_ingresso'),
      dados: d,
    },
    inacOk ? 'INAC /add OK' : 'INAC: ' + inacMsg,
    200,
  )

  return e.json(200, {
    ok: true,
    qrcode: qrcode,
    inac_ok: inacOk,
    inac_msg: inacMsg,
    nome: d.nome_completo,
    pedido_id: ingresso.getString('pedido_id'),
    tipo_ingresso: ingresso.getString('tipo_ingresso'),
  })
})

// --- Alterar os dados da pessoa de um ingresso já credenciado ---
routerAdd('POST', '/backend/v1/helpdesk/ticket/{id}/editar', (e) => {
  const body = e.requestInfo().body || {}
  const bad = hdGuard(e, body)
  if (bad) return bad
  const operador = hdOperador(e, body)
  const ticketId = e.request.pathValue('id')

  const v = hdValidaPessoa(body)
  if (v.erro) return e.json(400, { message: v.erro })
  const d = v.dados

  let ingresso
  try {
    ingresso = $app.findRecordById('ingressos', ticketId)
  } catch (_) {
    return e.json(404, { message: 'Ingresso não encontrado.' })
  }
  const part = hdParticipanteDe(ingresso)
  if (!part) {
    return e.json(400, { message: 'Este ingresso ainda não tem pessoa. Use "Credenciar".' })
  }
  if (hdEmailEmUso(d.email, part.id)) {
    return e.json(400, { message: 'Este e-mail já foi usado em outro credenciamento.' })
  }
  if (hdCpfEmUso(d.cpf, ticketId)) {
    return e.json(400, { message: 'Este CPF já foi usado em outro credenciamento.' })
  }

  const antes = hdDadosDoParticipante(part)
  const inacId = ingresso.getString('inac_id')
  let inacMsg = 'sem credencial na INAC (alteração local)'

  if (inacId) {
    const cfg = hdInac()
    const payload = hdInacPayload(
      d,
      ingresso.getString('pedido_id'),
      ingresso.getString('tipo_ingresso'),
      inacId,
    )
    const r = hdInacSend(cfg.edit, 'PUT', payload)
    inacMsg = r.msg
    if (!r.ok) {
      hdLog(
        ticketId,
        'helpdesk_erro',
        'Help desk (' +
          operador +
          ') — falha ao alterar os dados na INAC do ingresso ' +
          ingresso.getString('pedido_id') +
          '. Nada foi alterado.',
        { origem: 'helpdesk', acao: 'edicao_falha', operador: operador, tentativa: d },
        r.body,
        r.status || 0,
      )
      return e.json(502, {
        message: 'Não foi possível atualizar a credencial na INAC (' + r.msg + '). Nada mudou.',
      })
    }
  }

  try {
    part.set('nome_completo', d.nome_completo)
    part.set('email', d.email)
    part.set('cpf', d.cpf)
    part.set('telefone', d.telefone)
    if (part.getBool('tem_empresa')) part.set('nome_empresa', d.empresa)
    else part.set('profissao', d.empresa)
    $app.save(part)
  } catch (err) {
    return e.json(500, {
      message:
        'A INAC foi atualizada, mas falhou ao salvar aqui: ' +
        ((err && err.message) || 'erro') +
        '. Chame o suporte.',
    })
  }

  hdLog(
    ticketId,
    'helpdesk_edicao',
    'Help desk (' +
      operador +
      ') — ingresso ' +
      ingresso.getString('pedido_id') +
      ' — dados alterados: ' +
      antes.nome_completo +
      ' -> ' +
      d.nome_completo,
    {
      origem: 'helpdesk',
      acao: 'edicao',
      operador: operador,
      pedido_id: ingresso.getString('pedido_id'),
      antes: antes,
      depois: d,
    },
    inacId ? 'INAC /edit OK (' + inacMsg + ')' : inacMsg,
    200,
  )

  return e.json(200, { ok: true })
})

// --- Trocar o tipo do ingresso (GOLD <-> PLATINUM) ---
routerAdd('POST', '/backend/v1/helpdesk/ticket/{id}/tipo', (e) => {
  const body = e.requestInfo().body || {}
  const bad = hdGuard(e, body)
  if (bad) return bad
  const operador = hdOperador(e, body)
  const ticketId = e.request.pathValue('id')
  const tipo = (body.tipo || '').toString().trim().toUpperCase()
  if (tipo !== 'GOLD' && tipo !== 'PLATINUM') {
    return e.json(400, { message: 'Tipo deve ser GOLD ou PLATINUM.' })
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
    const part = hdParticipanteDe(ingresso)
    if (!part) return e.json(400, { message: 'Participante não encontrado para este ingresso.' })
    const cfg = hdInac()
    const payload = hdInacPayload(
      hdDadosDoParticipante(part),
      ingresso.getString('pedido_id'),
      tipo,
      inacId,
    )
    const r = hdInacSend(cfg.edit, 'PUT', payload)
    inacMsg = r.msg
    if (!r.ok) {
      hdLog(
        ticketId,
        'helpdesk_erro',
        'Help desk (' +
          operador +
          ') — falha ao trocar o tipo na INAC do ingresso ' +
          ingresso.getString('pedido_id') +
          '. Nada foi alterado.',
        { origem: 'helpdesk', acao: 'tipo_falha', operador: operador, de: tipoAntes, para: tipo },
        r.body,
        r.status || 0,
      )
      return e.json(502, {
        message: 'Não foi possível trocar o tipo na INAC (' + r.msg + '). Nada mudou.',
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

  hdLog(
    ticketId,
    'helpdesk_tipo_alterado',
    'Help desk (' +
      operador +
      ') — ingresso ' +
      ingresso.getString('pedido_id') +
      ' — tipo alterado de ' +
      tipoAntes +
      ' para ' +
      tipo +
      (inacId ? ' (INAC atualizada).' : '.'),
    {
      origem: 'helpdesk',
      acao: 'tipo',
      operador: operador,
      pedido_id: ingresso.getString('pedido_id'),
      de: tipoAntes,
      para: tipo,
    },
    inacId ? 'INAC /edit OK (' + inacMsg + ')' : inacMsg,
    200,
  )

  return e.json(200, { ok: true, tipo: tipo })
})

// --- Ver o QR Code da credencial (registra a consulta) ---
routerAdd('GET', '/backend/v1/helpdesk/ticket/{id}/qr', (e) => {
  const bad = hdGuard(e, null)
  if (bad) return bad
  const operador = hdOperador(e, null)
  const ticketId = e.request.pathValue('id')

  let ingresso
  try {
    ingresso = $app.findRecordById('ingressos', ticketId)
  } catch (_) {
    return e.json(404, { message: 'Ingresso não encontrado.' })
  }
  const part = hdParticipanteDe(ingresso)
  const qr = ingresso.getString('inac_qr')

  if (qr) {
    hdLog(
      ticketId,
      'helpdesk_qr',
      'Help desk (' +
        operador +
        ') — QR Code consultado — ingresso ' +
        ingresso.getString('pedido_id') +
        (part ? ' — ' + part.getString('nome_completo') : ''),
      {
        origem: 'helpdesk',
        acao: 'qr_consultado',
        operador: operador,
        pedido_id: ingresso.getString('pedido_id'),
      },
      'QR entregue no balcão.',
      200,
    )
  }

  return e.json(200, {
    ok: true,
    qrcode: qr,
    pedido_id: ingresso.getString('pedido_id'),
    tipo_ingresso: ingresso.getString('tipo_ingresso'),
    nome: part ? part.getString('nome_completo') : '',
    tem_participante: !!part,
  })
})

// --- Gerar a credencial de quem já preencheu mas ficou sem QR (retry INAC) ---
routerAdd('POST', '/backend/v1/helpdesk/ticket/{id}/gerar-qr', (e) => {
  const body = e.requestInfo().body || {}
  const bad = hdGuard(e, body)
  if (bad) return bad
  const operador = hdOperador(e, body)
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
  const part = hdParticipanteDe(ingresso)
  if (!part) {
    return e.json(400, { message: 'Este ingresso ainda não tem pessoa. Use "Credenciar".' })
  }

  const d = hdDadosDoParticipante(part)
  const r = hdInacAdd(ingresso, d, operador, 'gerar credencial no balcão')

  hdLog(
    ticketId,
    r.ok ? 'helpdesk_qr_gerado' : 'helpdesk_erro',
    'Help desk (' +
      operador +
      ') — ' +
      (r.ok ? 'credencial gerada' : 'FALHA ao gerar credencial') +
      ' — ingresso ' +
      ingresso.getString('pedido_id') +
      ' — ' +
      d.nome_completo,
    {
      origem: 'helpdesk',
      acao: 'gerar_qr',
      operador: operador,
      pedido_id: ingresso.getString('pedido_id'),
      dados: d,
    },
    r.ok ? 'INAC /add OK' : 'INAC: ' + r.msg,
    200,
  )

  if (!r.ok) {
    return e.json(502, {
      message: 'A INAC não confirmou a credencial (' + r.msg + '). Tente de novo em instantes.',
    })
  }
  return e.json(200, { ok: true, qrcode: r.qrcode })
})
