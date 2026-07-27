// ============================================================================
// API EXTERNA — uso interno (parceiros/automação fora do painel admin).
// Autenticação: chave estática fixa, enviada no header `X-Api-Key`.
// Chave: summit26_bi2cq40ggp9vyr62pxefccnn58elnfpe51v3vpp5
// (documentada + exibida na aba "API" do admin e no arquivo external-api.json)
//
// Endpoints:
//   GET  /backend/v1/external/compradores        — busca compradores + ingressos
//   GET  /backend/v1/external/participantes      — busca participantes credenciados
//   POST /backend/v1/external/compradores        — cria comprador + ingressos, dispara email
//   POST /backend/v1/external/credenciamento     — credencia (nosso sistema + INAC)
//   POST /backend/v1/external/reenviar-comprador    — redispara e-mail (template Email02)
//   POST /backend/v1/external/reenviar-participante — redispara e-mail de participante
//
// REGRA JSVM: cada handler declara suas próprias constantes/helpers (não dá
// pra compartilhar `const` de topo de arquivo entre handlers diferentes).
//
// AUDITORIA: os 4 endpoints POST (criação, credenciamento, os 2 reenvios)
// gravam uma linha em `webhooks_log` (evento api_criacao_comprador /
// api_credenciamento / api_reenvio_comprador / api_reenvio_participante),
// visível na tela Logs — inclusive na aba "Ações manuais". Os GETs (busca) não
// são logados, só leitura.
//
// Chave rotacionada em 2026-07-24 (a anterior foi invalidada).
// ============================================================================

// --- GET /external/compradores: busca comprador(es) + ingressos ------------
routerAdd('GET', '/backend/v1/external/compradores', (e) => {
  const API_KEY = 'summit26_bi2cq40ggp9vyr62pxefccnn58elnfpe51v3vpp5'
  const providedKey = e.request.header.get('X-Api-Key') || ''
  if (providedKey !== API_KEY) {
    return e.unauthorizedError('Chave de API inválida ou ausente (header X-Api-Key).')
  }

  const q = e.requestInfo().query || {}
  const email = (q.email || '').toString().trim().toLowerCase()
  const cpf = (q.cpf || '').toString().replace(/\D/g, '')
  const nome = (q.nome || '').toString().trim()
  const page = Math.max(1, parseInt(q.page, 10) || 1)
  const perPage = Math.min(100, Math.max(1, parseInt(q.perPage, 10) || 20))

  let filtro = ''
  const params = {}
  if (email) {
    filtro = 'email = {:email}'
    params.email = email
  } else if (cpf) {
    filtro = 'documento = {:cpf}'
    params.cpf = cpf
  } else if (nome) {
    filtro = 'nome ~ {:nome}'
    params.nome = nome
  } else {
    filtro = "id != ''"
  }

  let compradores = []
  try {
    compradores = $app.findRecordsByFilter(
      'compradores',
      filtro,
      '-created',
      perPage,
      (page - 1) * perPage,
      params,
    )
  } catch (err) {
    return e.badRequestError('Erro ao buscar compradores: ' + err.message)
  }

  const result = compradores.map((c) => {
    let ingressos = []
    try {
      ingressos = $app.findRecordsByFilter(
        'ingressos',
        'comprador_id = {:cid}',
        'created',
        200,
        0,
        { cid: c.id },
      )
    } catch (_) {}

    const ingressosInfo = ingressos.map((i) => ({
      id: i.id,
      pedido_id: i.getString('pedido_id'),
      tipo_ingresso: i.getString('tipo_ingresso'),
      status: i.getString('status'),
      disponivel: i.getString('status') === 'Pendente',
      participante_id: i.getString('participante_id') || null,
      inac_id: i.getString('inac_id') || null,
    }))

    return {
      id: c.id,
      nome: c.getString('nome'),
      email: c.getString('email'),
      documento: c.getString('documento'),
      uf: c.getString('uf'),
      cidade: c.getString('cidade'),
      telefone: c.getString('telefone'),
      ingressos: ingressosInfo,
      ingressos_disponiveis: ingressosInfo.filter((i) => i.disponivel).length,
    }
  })

  return e.json(200, { page: page, per_page: perPage, count: result.length, compradores: result })
})

// --- GET /external/participantes: busca participante(s) credenciado(s) -----
routerAdd('GET', '/backend/v1/external/participantes', (e) => {
  const API_KEY = 'summit26_bi2cq40ggp9vyr62pxefccnn58elnfpe51v3vpp5'
  const providedKey = e.request.header.get('X-Api-Key') || ''
  if (providedKey !== API_KEY) {
    return e.unauthorizedError('Chave de API inválida ou ausente (header X-Api-Key).')
  }

  const q = e.requestInfo().query || {}
  const email = (q.email || '').toString().trim().toLowerCase()
  const cpf = (q.cpf || '').toString().replace(/\D/g, '')
  const nome = (q.nome || '').toString().trim()
  const page = Math.max(1, parseInt(q.page, 10) || 1)
  const perPage = Math.min(100, Math.max(1, parseInt(q.perPage, 10) || 20))

  let filtro = ''
  const params = {}
  if (email) {
    filtro = 'email = {:email}'
    params.email = email
  } else if (cpf) {
    filtro = 'cpf ~ {:cpf}'
    params.cpf = cpf
  } else if (nome) {
    filtro = 'nome_completo ~ {:nome}'
    params.nome = nome
  } else {
    filtro = "id != ''"
  }

  let participantes = []
  try {
    participantes = $app.findRecordsByFilter(
      'participantes',
      filtro,
      '-created',
      perPage,
      (page - 1) * perPage,
      params,
    )
  } catch (err) {
    return e.badRequestError('Erro ao buscar participantes: ' + err.message)
  }

  const result = participantes.map((p) => {
    let ingressoInfo = null
    const ingressoId = p.getString('ingresso_id')
    if (ingressoId) {
      try {
        const ing = $app.findRecordById('ingressos', ingressoId)
        ingressoInfo = {
          id: ing.id,
          pedido_id: ing.getString('pedido_id'),
          tipo_ingresso: ing.getString('tipo_ingresso'),
          status: ing.getString('status'),
          comprador_id: ing.getString('comprador_id'),
        }
      } catch (_) {}
    }
    return {
      id: p.id,
      nome_completo: p.getString('nome_completo'),
      email: p.getString('email'),
      cpf: p.getString('cpf'),
      telefone: p.getString('telefone'),
      tem_empresa: p.getBool('tem_empresa'),
      nome_empresa: p.getString('nome_empresa'),
      cargo: p.getString('cargo'),
      profissao: p.getString('profissao'),
      preenchido_em: p.getString('preenchido_em'),
      ingresso: ingressoInfo,
    }
  })

  return e.json(200, {
    page: page,
    per_page: perPage,
    count: result.length,
    participantes: result,
  })
})

// --- POST /external/compradores: cria comprador + ingressos + dispara email -
routerAdd('POST', '/backend/v1/external/compradores', (e) => {
  const API_KEY = 'summit26_bi2cq40ggp9vyr62pxefccnn58elnfpe51v3vpp5'
  const providedKey = e.request.header.get('X-Api-Key') || ''
  if (providedKey !== API_KEY) {
    return e.unauthorizedError('Chave de API inválida ou ausente (header X-Api-Key).')
  }

  const decodeBody = (body) => {
    if (body == null) return ''
    if (typeof body === 'string') return body
    let bytes
    try {
      bytes = new Uint8Array(body)
    } catch (_) {
      bytes = body
    }
    let result = ''
    let i = 0
    const len = bytes.length
    while (i < len) {
      const b1 = bytes[i++]
      if (b1 < 0x80) {
        result += String.fromCharCode(b1)
      } else if ((b1 & 0xe0) === 0xc0 && i < len) {
        const b2 = bytes[i++]
        result += String.fromCharCode(((b1 & 0x1f) << 6) | (b2 & 0x3f))
      } else if ((b1 & 0xf0) === 0xe0 && i + 1 < len) {
        const b2 = bytes[i++]
        const b3 = bytes[i++]
        result += String.fromCharCode(((b1 & 0x0f) << 12) | ((b2 & 0x3f) << 6) | (b3 & 0x3f))
      } else if ((b1 & 0xf8) === 0xf0 && i + 2 < len) {
        const b2 = bytes[i++]
        const b3 = bytes[i++]
        const b4 = bytes[i++]
        let cp = ((b1 & 0x07) << 18) | ((b2 & 0x3f) << 12) | ((b3 & 0x3f) << 6) | (b4 & 0x3f)
        cp -= 0x10000
        result += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff))
      } else {
        // ignora byte inválido
      }
    }
    return result
  }

  const body = e.requestInfo().body || {}
  const nome = (body.nome || '').toString().trim()
  const email = (body.email || '').toString().trim().toLowerCase()
  const documento = (body.documento || '').toString().replace(/\D/g, '')
  const uf = (body.uf || '').toString().trim()
  const cidade = (body.cidade || '').toString().trim()
  const telefone = (body.telefone || '').toString().trim()
  const qtdGold = Math.max(0, parseInt(body.qtd_gold, 10) || 0)
  const qtdPlatinum = Math.max(0, parseInt(body.qtd_platinum, 10) || 0)

  if (!email) return e.badRequestError('email é obrigatório')
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return e.badRequestError('email inválido')
  if (qtdGold === 0 && qtdPlatinum === 0) {
    return e.badRequestError('Informe qtd_gold e/ou qtd_platinum (pelo menos 1 ingresso)')
  }

  let compradorId = ''
  const ingressosCriados = []

  try {
    $app.runInTransaction((txApp) => {
      const compradoresColl = txApp.findCollectionByNameOrId('compradores')
      const ingressosColl = txApp.findCollectionByNameOrId('ingressos')
      const linksColl = txApp.findCollectionByNameOrId('links_participante')

      let comprador
      try {
        comprador = txApp.findFirstRecordByData('compradores', 'email', email)
        if (nome) comprador.set('nome', nome)
        if (documento) comprador.set('documento', documento)
        if (uf) comprador.set('uf', uf)
        if (cidade) comprador.set('cidade', cidade)
        if (telefone) comprador.set('telefone', telefone)
        txApp.save(comprador)
      } catch (_) {
        comprador = new Record(compradoresColl)
        comprador.set('email', email)
        comprador.set('nome', nome)
        comprador.set('documento', documento)
        comprador.set('uf', uf)
        comprador.set('cidade', cidade)
        comprador.set('telefone', telefone)
        txApp.save(comprador)
      }
      compradorId = comprador.id

      const genPedidoId = () => {
        for (let attempt = 0; attempt < 50; attempt++) {
          const candidate = String(Math.floor(100000 + Math.random() * 900000))
          let exists = false
          try {
            txApp.findFirstRecordByData('ingressos', 'pedido_id', candidate)
            exists = true
          } catch (_) {
            exists = false
          }
          if (!exists) return candidate
        }
        throw new Error('Falha ao gerar pedido_id único')
      }

      const criarIngresso = (tipo) => {
        const ingresso = new Record(ingressosColl)
        ingresso.set('comprador_id', comprador.id)
        const pedidoId = genPedidoId()
        ingresso.set('pedido_id', pedidoId)
        ingresso.set('tipo_ingresso', tipo)
        ingresso.set('status', 'Pendente')
        ingresso.set('status_webhook', 'pendente')
        ingresso.set('origem', 'api-externa')
        txApp.save(ingresso)

        const link = new Record(linksColl)
        link.set('ingresso_id', ingresso.id)
        link.set('token', $security.randomString(32))
        link.set('usado', false)
        const exp = new Date()
        exp.setFullYear(exp.getFullYear() + 1)
        link.set('expira_em', exp.toISOString())
        txApp.save(link)

        ingressosCriados.push({ id: ingresso.id, pedido_id: pedidoId, tipo_ingresso: tipo })
      }

      for (let i = 0; i < qtdGold; i++) criarIngresso('GOLD')
      for (let i = 0; i < qtdPlatinum; i++) criarIngresso('PLATINUM')
    })
  } catch (err) {
    return e.badRequestError('Falha ao criar comprador/ingressos: ' + err.message)
  }

  // --- Disparo automático do e-mail de acesso (síncrono, 1 destinatário) ---
  const emailResult = { enviado: false, erro: '' }
  const apiKeySendgrid = $os.getenv('SENDGRID_API_KEY')
  if (!apiKeySendgrid) {
    emailResult.erro = 'SENDGRID_API_KEY não configurada'
  } else {
    try {
      const templateNome = 'Skip-Summit26-Send-Comprador'
      const res = $http.send({
        url: 'https://api.sendgrid.com/v3/templates?generations=dynamic&page_size=200',
        method: 'GET',
        headers: { Authorization: 'Bearer ' + apiKeySendgrid },
        timeout: 20,
      })
      const parsed = JSON.parse(decodeBody(res.body))
      const list = parsed.result || parsed.templates || []
      let templateId = ''
      for (const t of list) {
        if (t && t.name === templateNome && t.id) {
          templateId = t.id
          break
        }
      }
      if (!templateId) {
        emailResult.erro = 'Template "' + templateNome + '" não encontrado no SendGrid'
      } else {
        const tokenColl = $app.findCollectionByNameOrId('tokens_acesso')
        const token = $security.randomString(40)
        const tr = new Record(tokenColl)
        tr.set('comprador_id', compradorId)
        tr.set('token', token)
        tr.set('usado', false)
        const exp = new Date()
        exp.setDate(exp.getDate() + 60)
        tr.set('expira_em', exp.toISOString())
        $app.save(tr)

        const sendRes = $http.send({
          url: 'https://api.sendgrid.com/v3/mail/send',
          method: 'POST',
          headers: {
            Authorization: 'Bearer ' + apiKeySendgrid,
            'Content-Type': 'application/json',
          },
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
        emailResult.enviado = sendRes.statusCode >= 200 && sendRes.statusCode < 300
        if (!emailResult.enviado) {
          emailResult.erro = 'SendGrid HTTP ' + sendRes.statusCode
        }
      }
    } catch (err) {
      emailResult.erro = err.message
    }
  }

  // audit: registra a CRIAÇÃO via API nos Logs.
  try {
    const logColl = $app.findCollectionByNameOrId('webhooks_log')
    const log = new Record(logColl)
    log.set('evento', 'api_criacao_comprador')
    log.set('method', 'API')
    log.set('status', 200)
    log.set(
      'detalhe',
      'Comprador ' +
        (nome || email) +
        ' (' +
        email +
        ') criado via API externa — ' +
        ingressosCriados.length +
        ' ingresso(s). E-mail: ' +
        (emailResult.enviado ? 'enviado' : 'não enviado (' + emailResult.erro + ')'),
    )
    log.set(
      'payload',
      JSON.stringify({
        acao: 'api_criacao_comprador',
        comprador_id: compradorId,
        nome: nome,
        email: email,
        ingressos: ingressosCriados,
      }),
    )
    log.set('response', JSON.stringify(emailResult))
    $app.save(log)
  } catch (_) {}

  return e.json(200, {
    success: true,
    comprador_id: compradorId,
    ingressos: ingressosCriados,
    email: emailResult,
  })
})

// --- POST /external/credenciamento: credencia (sistema + INAC) -------------
routerAdd('POST', '/backend/v1/external/credenciamento', (e) => {
  const API_KEY = 'summit26_bi2cq40ggp9vyr62pxefccnn58elnfpe51v3vpp5'
  const providedKey = e.request.header.get('X-Api-Key') || ''
  if (providedKey !== API_KEY) {
    return e.unauthorizedError('Chave de API inválida ou ausente (header X-Api-Key).')
  }

  const decodeBody = (body) => {
    if (body == null) return ''
    if (typeof body === 'string') return body
    try {
      return new TextDecoder().decode(body)
    } catch (_) {}
    try {
      let s = ''
      for (let i = 0; i < body.length; i++) s += String.fromCharCode(body[i])
      return s
    } catch (_) {}
    return ''
  }
  const onlyDigits = (s) => (s || '').toString().replace(/\D/g, '')
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

  const body = e.requestInfo().body || {}
  const pedidoId = (body.pedido_id || '').toString().trim()
  const ingressoIdParam = (body.ingresso_id || '').toString().trim()

  if (!pedidoId && !ingressoIdParam) {
    return e.badRequestError('Informe pedido_id ou ingresso_id')
  }

  let ingresso
  try {
    if (ingressoIdParam) {
      ingresso = $app.findRecordById('ingressos', ingressoIdParam)
    } else {
      ingresso = $app.findFirstRecordByData('ingressos', 'pedido_id', pedidoId)
    }
  } catch (_) {
    return e.notFoundError('Ingresso não encontrado')
  }

  if (ingresso.getString('status') !== 'Pendente') {
    return e.badRequestError('Este ingresso não está com status Pendente (já credenciado?)')
  }
  if (ingresso.getString('participante_id')) {
    return e.badRequestError('Este ingresso já possui um participante')
  }

  const emailNorm = (body.email || '').toString().trim().toLowerCase()
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(emailNorm)) return e.badRequestError('email inválido')
  const cpfDigits = onlyDigits(body.cpf)
  if (cpfDigits.length !== 11) return e.badRequestError('cpf inválido')
  const nomeCompleto = (body.nome_completo || '').toString().trim()
  if (nomeCompleto.length < 3) return e.badRequestError('nome_completo é obrigatório')

  // e-mail único entre participantes
  try {
    $app.findFirstRecordByFilter('participantes', 'email = {:em}', { em: emailNorm })
    return e.badRequestError('Este e-mail já foi usado por outro participante.')
  } catch (_) {}

  // CPF não pode estar em outro credenciamento
  const fmtCpf = cpfDigits.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4')
  try {
    const recs = $app.findRecordsByFilter(
      'participantes',
      'cpf = {:fmt} || cpf = {:raw}',
      '',
      50,
      0,
      { fmt: fmtCpf, raw: cpfDigits },
    )
    for (const r of recs) {
      const iid = r.getString('ingresso_id')
      try {
        const ing2 = $app.findRecordById('ingressos', iid)
        if (ing2.getString('status') === 'Pré-Credenciado') {
          return e.badRequestError('Este CPF já foi usado em outro credenciamento.')
        }
      } catch (_) {}
    }
  } catch (_) {}

  const temEmpresa = body.tem_empresa === true || body.tem_empresa === 'true'

  try {
    $app.runInTransaction((txApp) => {
      const partColl = txApp.findCollectionByNameOrId('participantes')
      const part = new Record(partColl)
      part.set('ingresso_id', ingresso.id)
      part.set('nome_completo', nomeCompleto)
      part.set('email', emailNorm)
      part.set('cpf', body.cpf)
      part.set('telefone', body.telefone || '')
      part.set('tem_empresa', temEmpresa)
      part.set('nome_empresa', temEmpresa ? body.nome_empresa || '' : '')
      part.set('cargo', temEmpresa ? body.cargo || '' : '')
      part.set('profissao', temEmpresa ? '' : body.profissao || '')
      part.set('nicho', body.nicho || '')
      part.set('num_funcionarios', temEmpresa ? body.num_funcionarios || '' : '')
      part.set('faturamento_anual', temEmpresa ? body.faturamento_anual || '' : '')
      part.set('ia_uso_diario', parseInt(body.ia_uso_diario, 10) || 0)
      part.set('ia_profundidade', parseInt(body.ia_profundidade, 10) || 0)
      part.set('ia_ferramentas', body.ia_ferramentas || '')
      part.set('ia_desafio', body.ia_desafio || '')
      txApp.save(part)

      const ing = txApp.findRecordById('ingressos', ingresso.id)
      ing.set('participante_id', part.id)
      ing.set('status', 'Pré-Credenciado')
      ing.set('preenchido_em', new Date().toISOString())
      txApp.save(ing)
    })
  } catch (err) {
    return e.badRequestError('Falha ao salvar credenciamento: ' + err.message)
  }

  // --- INAC /add síncrono ---
  let qrcode = ''
  let inacOk = false
  let inacMsg = ''
  try {
    const ingAtual = $app.findRecordById('ingressos', ingresso.id)
    const INAC_WEBHOOK_URL = $os.getenv('INAC_WEBHOOK_URL')
    const INAC_AUTH_TOKEN = $os.getenv('INAC_AUTH_TOKEN')
    if (!INAC_WEBHOOK_URL || !INAC_AUTH_TOKEN) {
      inacMsg = 'INAC_WEBHOOK_URL/INAC_AUTH_TOKEN não configurados'
    } else {
      let tel = onlyDigits(body.telefone)
      if (tel && tel.length <= 11) tel = '55' + tel
      const categoryId =
        { GOLD: 6123, PLATINUM: 6125, PALESTRANTES: 7863, HACKATHON: 7864 }[
          ingAtual.getString('tipo_ingresso')
        ] || 6123
      const payload = {
        event_id: 375,
        category_id: categoryId,
        status: 'active',
        fields: [
          { id: 10133653, value: sanitize(nomeCompleto) },
          { id: 10133654, value: emailNorm },
          { id: 10133655, value: cpfDigits },
          { id: 10133656, value: tel },
          { id: 10133657, value: sanitize(body.nome_empresa || body.profissao || '') },
          { id: 10133665, value: ingAtual.getString('pedido_id') },
        ],
      }
      const res = $http.send({
        url: INAC_WEBHOOK_URL,
        method: 'POST',
        headers: { 'X-Auth-Token': INAC_AUTH_TOKEN, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        timeout: 15,
      })
      const respTxt = decodeBody(res.body)
      if (res.statusCode >= 200 && res.statusCode < 300) {
        const data = JSON.parse(respTxt)
        if (data && data.status === true && data.attendee) {
          inacOk = true
          qrcode = String(data.attendee.qrcode || '')
          ingAtual.set('inac_id', String(data.attendee.id || ''))
          ingAtual.set('inac_qr', qrcode)
          ingAtual.set('status_webhook', 'enviado')
          $app.save(ingAtual)
        } else {
          inacMsg = 'INAC respondeu sem attendee/status'
        }
      } else {
        inacMsg = 'INAC HTTP ' + res.statusCode
      }
      if (!inacOk) {
        ingAtual.set('status_webhook', 'erro')
        $app.save(ingAtual)
      }
    }
  } catch (err) {
    inacMsg = err.message
  }

  // audit: registra o CREDENCIAMENTO via API nos Logs.
  try {
    const logColl = $app.findCollectionByNameOrId('webhooks_log')
    const log = new Record(logColl)
    log.set('ingresso_id', ingresso.id)
    log.set('evento', 'api_credenciamento')
    log.set('method', 'API')
    log.set('status', 200)
    log.set(
      'detalhe',
      'Ingresso ' +
        ingresso.getString('pedido_id') +
        ' credenciado via API externa — ' +
        nomeCompleto +
        ' (' +
        emailNorm +
        '). INAC: ' +
        (inacOk ? 'ok (attendee credenciado)' : 'falhou (' + inacMsg + ')'),
    )
    log.set(
      'payload',
      JSON.stringify({
        acao: 'api_credenciamento',
        ingresso_id: ingresso.id,
        pedido_id: ingresso.getString('pedido_id'),
        nome_completo: nomeCompleto,
        email: emailNorm,
      }),
    )
    log.set('response', JSON.stringify({ inac_ok: inacOk, qrcode: qrcode, inac_msg: inacMsg }))
    $app.save(log)
  } catch (_) {}

  return e.json(200, {
    success: true,
    ingresso_id: ingresso.id,
    inac: { credenciado: inacOk, qrcode: qrcode, erro: inacOk ? '' : inacMsg },
  })
})

// --- POST /external/reenviar-comprador: redispara e-mail (template Email02) -
routerAdd('POST', '/backend/v1/external/reenviar-comprador', (e) => {
  const API_KEY = 'summit26_bi2cq40ggp9vyr62pxefccnn58elnfpe51v3vpp5'
  const providedKey = e.request.header.get('X-Api-Key') || ''
  if (providedKey !== API_KEY) {
    return e.unauthorizedError('Chave de API inválida ou ausente (header X-Api-Key).')
  }

  // Decodificador UTF-8 manual (o TextDecoder do JSVM não decodifica
  // multi-byte direito aqui — ver correção aplicada no preview de template).
  const decodeBody = (body) => {
    if (body == null) return ''
    if (typeof body === 'string') return body
    let bytes
    try {
      bytes = new Uint8Array(body)
    } catch (_) {
      bytes = body
    }
    let result = ''
    let i = 0
    const len = bytes.length
    while (i < len) {
      const b1 = bytes[i++]
      if (b1 < 0x80) {
        result += String.fromCharCode(b1)
      } else if ((b1 & 0xe0) === 0xc0 && i < len) {
        const b2 = bytes[i++]
        result += String.fromCharCode(((b1 & 0x1f) << 6) | (b2 & 0x3f))
      } else if ((b1 & 0xf0) === 0xe0 && i + 1 < len) {
        const b2 = bytes[i++]
        const b3 = bytes[i++]
        result += String.fromCharCode(((b1 & 0x0f) << 12) | ((b2 & 0x3f) << 6) | (b3 & 0x3f))
      } else if ((b1 & 0xf8) === 0xf0 && i + 2 < len) {
        const b2 = bytes[i++]
        const b3 = bytes[i++]
        const b4 = bytes[i++]
        let cp = ((b1 & 0x07) << 18) | ((b2 & 0x3f) << 12) | ((b3 & 0x3f) << 6) | (b4 & 0x3f)
        cp -= 0x10000
        result += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff))
      } else {
        // ignora byte inválido
      }
    }
    return result
  }

  const body = e.requestInfo().body || {}
  const compradorId = (body.comprador_id || '').toString().trim()
  const emailParam = (body.email || '').toString().trim().toLowerCase()
  if (!compradorId && !emailParam) return e.badRequestError('Informe comprador_id ou email')

  let comprador
  try {
    comprador = compradorId
      ? $app.findRecordById('compradores', compradorId)
      : $app.findFirstRecordByData('compradores', 'email', emailParam)
  } catch (_) {
    return e.notFoundError('Comprador não encontrado')
  }

  const email = comprador.getString('email')
  const nome = comprador.getString('nome')
  if (!email) return e.badRequestError('Este comprador não tem e-mail cadastrado')

  const apiKeySendgrid = $os.getenv('SENDGRID_API_KEY')
  if (!apiKeySendgrid) return e.badRequestError('SENDGRID_API_KEY não configurada')

  const templateNome = 'Skip-Summit26-Send-Comprador-Email02'
  let templateId = ''
  try {
    const res = $http.send({
      url: 'https://api.sendgrid.com/v3/templates?generations=dynamic&page_size=200',
      method: 'GET',
      headers: { Authorization: 'Bearer ' + apiKeySendgrid },
      timeout: 20,
    })
    const parsed = JSON.parse(decodeBody(res.body))
    const list = parsed.result || parsed.templates || []
    for (const t of list) {
      if (t && t.name === templateNome && t.id) {
        templateId = t.id
        break
      }
    }
  } catch (err) {
    return e.badRequestError('Falha ao consultar templates no SendGrid: ' + err.message)
  }
  if (!templateId) {
    return e.badRequestError('Template "' + templateNome + '" não encontrado no SendGrid')
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
    return e.badRequestError('Falha ao gerar token de acesso: ' + err.message)
  }

  let enviado = false
  let erro = ''
  try {
    const res = $http.send({
      url: 'https://api.sendgrid.com/v3/mail/send',
      method: 'POST',
      headers: { Authorization: 'Bearer ' + apiKeySendgrid, 'Content-Type': 'application/json' },
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
    if (!enviado) erro = 'SendGrid HTTP ' + res.statusCode
  } catch (err) {
    erro = err.message
  }

  // audit: registra o REENVIO via API nos Logs.
  try {
    const logColl = $app.findCollectionByNameOrId('webhooks_log')
    const log = new Record(logColl)
    log.set('evento', 'api_reenvio_comprador')
    log.set('method', 'API')
    log.set('status', enviado ? 200 : 0)
    log.set(
      'detalhe',
      'E-mail (' +
        templateNome +
        ') redisparado via API externa pro comprador ' +
        (nome || email) +
        ' (' +
        email +
        ') — ' +
        (enviado ? 'enviado' : 'falhou (' + erro + ')'),
    )
    log.set(
      'payload',
      JSON.stringify({
        acao: 'api_reenvio_comprador',
        comprador_id: comprador.id,
        email: email,
        template: templateNome,
      }),
    )
    log.set('response', enviado ? 'OK' : erro)
    $app.save(log)
  } catch (_) {}

  return e.json(200, {
    success: enviado,
    comprador_id: comprador.id,
    email: email,
    template: templateNome,
    erro: erro,
  })
})

// --- POST /external/reenviar-participante: redispara e-mail de participante -
routerAdd('POST', '/backend/v1/external/reenviar-participante', (e) => {
  const API_KEY = 'summit26_bi2cq40ggp9vyr62pxefccnn58elnfpe51v3vpp5'
  const providedKey = e.request.header.get('X-Api-Key') || ''
  if (providedKey !== API_KEY) {
    return e.unauthorizedError('Chave de API inválida ou ausente (header X-Api-Key).')
  }

  const decodeBody = (body) => {
    if (body == null) return ''
    if (typeof body === 'string') return body
    let bytes
    try {
      bytes = new Uint8Array(body)
    } catch (_) {
      bytes = body
    }
    let result = ''
    let i = 0
    const len = bytes.length
    while (i < len) {
      const b1 = bytes[i++]
      if (b1 < 0x80) {
        result += String.fromCharCode(b1)
      } else if ((b1 & 0xe0) === 0xc0 && i < len) {
        const b2 = bytes[i++]
        result += String.fromCharCode(((b1 & 0x1f) << 6) | (b2 & 0x3f))
      } else if ((b1 & 0xf0) === 0xe0 && i + 1 < len) {
        const b2 = bytes[i++]
        const b3 = bytes[i++]
        result += String.fromCharCode(((b1 & 0x0f) << 12) | ((b2 & 0x3f) << 6) | (b3 & 0x3f))
      } else if ((b1 & 0xf8) === 0xf0 && i + 2 < len) {
        const b2 = bytes[i++]
        const b3 = bytes[i++]
        const b4 = bytes[i++]
        let cp = ((b1 & 0x07) << 18) | ((b2 & 0x3f) << 12) | ((b3 & 0x3f) << 6) | (b4 & 0x3f)
        cp -= 0x10000
        result += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff))
      } else {
        // ignora byte inválido
      }
    }
    return result
  }

  const body = e.requestInfo().body || {}
  const participanteId = (body.participante_id || '').toString().trim()
  const emailParam = (body.email || '').toString().trim().toLowerCase()
  if (!participanteId && !emailParam) {
    return e.badRequestError('Informe participante_id ou email')
  }

  let participante
  try {
    participante = participanteId
      ? $app.findRecordById('participantes', participanteId)
      : $app.findFirstRecordByData('participantes', 'email', emailParam)
  } catch (_) {
    return e.notFoundError('Participante não encontrado')
  }

  const email = participante.getString('email')
  const nome = participante.getString('nome_completo')
  const ingressoId = participante.getString('ingresso_id')
  if (!email) return e.badRequestError('Este participante não tem e-mail cadastrado')
  if (!ingressoId) return e.badRequestError('Este participante não está vinculado a um ingresso')

  const apiKeySendgrid = $os.getenv('SENDGRID_API_KEY')
  if (!apiKeySendgrid) return e.badRequestError('SENDGRID_API_KEY não configurada')

  const templateNome = 'Skip-Summit26-Send-Participante'
  let templateId = ''
  try {
    const res = $http.send({
      url: 'https://api.sendgrid.com/v3/templates?generations=dynamic&page_size=200',
      method: 'GET',
      headers: { Authorization: 'Bearer ' + apiKeySendgrid },
      timeout: 20,
    })
    const parsed = JSON.parse(decodeBody(res.body))
    const list = parsed.result || parsed.templates || []
    for (const t of list) {
      if (t && t.name === templateNome && t.id) {
        templateId = t.id
        break
      }
    }
  } catch (err) {
    return e.badRequestError('Falha ao consultar templates no SendGrid: ' + err.message)
  }
  if (!templateId) {
    return e.badRequestError('Template "' + templateNome + '" não encontrado no SendGrid')
  }

  // {{token}} = token do INGRESSO do participante (links_participante) —
  // acha o existente ou cria um novo de 60 dias, igual ao fluxo do cron.
  let token = ''
  try {
    try {
      const link = $app.findFirstRecordByFilter('links_participante', 'ingresso_id = {:iid}', {
        iid: ingressoId,
      })
      token = link.getString('token')
    } catch (_) {
      const linksColl = $app.findCollectionByNameOrId('links_participante')
      token = $security.randomString(40)
      const lr = new Record(linksColl)
      lr.set('ingresso_id', ingressoId)
      lr.set('token', token)
      lr.set('usado', false)
      const exp = new Date()
      exp.setDate(exp.getDate() + 60)
      lr.set('expira_em', exp.toISOString())
      $app.save(lr)
    }
  } catch (err) {
    return e.badRequestError('Falha ao gerar token do ingresso: ' + err.message)
  }

  let enviado = false
  let erro = ''
  try {
    const res = $http.send({
      url: 'https://api.sendgrid.com/v3/mail/send',
      method: 'POST',
      headers: { Authorization: 'Bearer ' + apiKeySendgrid, 'Content-Type': 'application/json' },
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
    if (!enviado) erro = 'SendGrid HTTP ' + res.statusCode
  } catch (err) {
    erro = err.message
  }

  // audit: registra o REENVIO via API nos Logs.
  try {
    const logColl = $app.findCollectionByNameOrId('webhooks_log')
    const log = new Record(logColl)
    log.set('ingresso_id', ingressoId)
    log.set('evento', 'api_reenvio_participante')
    log.set('method', 'API')
    log.set('status', enviado ? 200 : 0)
    log.set(
      'detalhe',
      'E-mail (' +
        templateNome +
        ') redisparado via API externa pro participante ' +
        (nome || email) +
        ' (' +
        email +
        ') — ' +
        (enviado ? 'enviado' : 'falhou (' + erro + ')'),
    )
    log.set(
      'payload',
      JSON.stringify({
        acao: 'api_reenvio_participante',
        participante_id: participante.id,
        email: email,
        template: templateNome,
      }),
    )
    log.set('response', enviado ? 'OK' : erro)
    $app.save(log)
  } catch (_) {}

  return e.json(200, {
    success: enviado,
    participante_id: participante.id,
    email: email,
    template: templateNome,
    erro: erro,
  })
})
