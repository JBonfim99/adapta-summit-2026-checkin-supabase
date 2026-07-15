// ===================== CORTESIAS (área de convites) =====================
// Um anfitrião (Max, Patrick, etc.) recebe um link com cota. Quem usa preenche
// só nome, email e CPF e é credenciado na hora (INAC /add), recebendo o QR.
// Reaproveita o mesmo fluxo de add da INAC usado no /participant/submit.

// --- Público: dados do convite (para a tela do convidado) ---
routerAdd('GET', '/backend/v1/cortesia/info/{token}', (e) => {
  const token = e.request.pathValue('token')
  try {
    const c = $app.findFirstRecordByData('cortesias', 'token', token)
    const limite = Number(c.get('limite')) || 0
    const usados = Number(c.get('usados')) || 0
    return e.json(200, {
      anfitriao: c.getString('anfitriao'),
      tipo_ingresso: c.getString('tipo_ingresso') || 'GOLD',
      ativo: c.getBool('ativo'),
      esgotado: limite > 0 && usados >= limite,
      restantes: limite > 0 ? Math.max(0, limite - usados) : null,
    })
  } catch (_) {
    return e.notFoundError('Convite não encontrado')
  }
})

// --- Público: registra o convidado e credencia na hora ---
routerAdd('POST', '/backend/v1/cortesia/registrar', (e) => {
  const body = e.requestInfo().body || {}
  const token = (body.token || '').toString()
  const nome = (body.nome_completo || '').toString().trim()
  const emailNorm = (body.email || '').toString().trim().toLowerCase()
  const cpfDigits = (body.cpf || '').toString().replace(/\D/g, '')
  const telefone = (body.telefone || '').toString().trim()
  const telDigits = telefone.replace(/\D/g, '')

  if (nome.length < 3) return e.badRequestError('Informe o nome completo.')
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(emailNorm)) return e.badRequestError('E-mail inválido.')
  if (telDigits.length < 10) return e.badRequestError('Informe um telefone válido com DDD.')
  if (!body.terms_accepted) {
    return e.badRequestError('É necessário aceitar a autorização de uso de imagem e dados.')
  }

  const isValidCPF = (s) => {
    const c = (s || '').replace(/\D/g, '')
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
  if (!isValidCPF(cpfDigits)) return e.badRequestError('CPF inválido.')
  const cpfFmt = cpfDigits.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4')

  let cortesia
  try {
    cortesia = $app.findFirstRecordByData('cortesias', 'token', token)
  } catch (_) {
    return e.badRequestError('Convite não encontrado.')
  }
  if (!cortesia.getBool('ativo')) return e.badRequestError('Este convite não está mais ativo.')
  const limite0 = Number(cortesia.get('limite')) || 0
  const usados0 = Number(cortesia.get('usados')) || 0
  if (limite0 > 0 && usados0 >= limite0) {
    return e.badRequestError('As cortesias deste convite se esgotaram.')
  }

  // e-mail único entre participantes
  try {
    $app.findFirstRecordByFilter('participantes', 'email = {:em}', { em: emailNorm })
    return e.badRequestError('Este e-mail já foi usado em outro credenciamento.')
  } catch (_) {}

  // CPF não pode já estar credenciado
  try {
    const recs = $app.findRecordsByFilter(
      'participantes',
      'cpf = {:fmt} || cpf = {:raw}',
      '',
      50,
      0,
      { fmt: cpfFmt, raw: cpfDigits },
    )
    for (let i = 0; i < recs.length; i++) {
      const iid = recs[i].getString('ingresso_id')
      try {
        const ing = $app.findRecordById('ingressos', iid)
        if (ing.getString('status') === 'Pré-Credenciado') {
          return e.badRequestError('Este CPF já foi usado em outro credenciamento.')
        }
      } catch (_) {}
    }
  } catch (_) {}

  const tipo = cortesia.getString('tipo_ingresso') || 'GOLD'
  let ingressoId = ''
  let pedidoId = ''

  try {
    $app.runInTransaction((txApp) => {
      const c2 = txApp.findRecordById('cortesias', cortesia.id)
      const lim2 = Number(c2.get('limite')) || 0
      const us2 = Number(c2.get('usados')) || 0
      if (!c2.getBool('ativo')) throw new Error('Este convite não está mais ativo.')
      if (lim2 > 0 && us2 >= lim2) throw new Error('As cortesias deste convite se esgotaram.')

      // comprador sintético da cortesia (recria se sumiu)
      let compradorId = c2.getString('comprador_id')
      let compradorOk = false
      try {
        txApp.findRecordById('compradores', compradorId)
        compradorOk = true
      } catch (_) {}
      if (!compradorOk) {
        const compColl = txApp.findCollectionByNameOrId('compradores')
        const comp = new Record(compColl)
        comp.set('nome', 'Cortesia — ' + c2.getString('anfitriao'))
        comp.set('email', 'cortesia+' + c2.getString('token') + '@cortesia.summit')
        txApp.save(comp)
        compradorId = comp.id
        c2.set('comprador_id', compradorId)
      }

      // pedido_id único (prefixo C)
      let cand = ''
      for (let i = 0; i < 30; i++) {
        const x = 'C' + $security.randomString(6).toUpperCase()
        let exists = false
        try {
          txApp.findFirstRecordByData('ingressos', 'pedido_id', x)
          exists = true
        } catch (_) {}
        if (!exists) {
          cand = x
          break
        }
      }
      if (!cand) cand = 'C' + Date.now().toString(36).toUpperCase()
      pedidoId = cand

      const ingColl = txApp.findCollectionByNameOrId('ingressos')
      const ing = new Record(ingColl)
      ing.set('comprador_id', compradorId)
      ing.set('pedido_id', cand)
      ing.set('tipo_ingresso', tipo)
      ing.set('status', 'Pendente')
      ing.set('origem', 'cortesia')
      ing.set('cortesia_id', c2.id)
      txApp.save(ing)
      ingressoId = ing.id

      const partColl = txApp.findCollectionByNameOrId('participantes')
      const part = new Record(partColl)
      part.set('ingresso_id', ing.id)
      part.set('nome_completo', nome)
      part.set('email', emailNorm)
      part.set('cpf', cpfFmt)
      part.set('telefone', telefone)
      part.set('tem_empresa', false)
      part.set('nicho', '')
      part.set('ia_uso_diario', 0)
      part.set('ia_profundidade', 0)
      part.set('terms_accepted_at', new Date().toISOString())
      txApp.save(part)

      ing.set('participante_id', part.id)
      ing.set('status', 'Pré-Credenciado')
      ing.set('preenchido_em', new Date().toISOString())
      txApp.save(ing)

      c2.set('usados', us2 + 1)
      txApp.save(c2)
    })
  } catch (err) {
    const m = (err && err.message) || 'Erro ao registrar.'
    if (/unique/i.test(m) || m.indexOf('idx_participantes_email') !== -1) {
      return e.badRequestError('Este e-mail já foi usado em outro credenciamento.')
    }
    return e.badRequestError(m)
  }

  // pós-commit: INAC /add para gerar o QR (mesmo fluxo do submit)
  let qrcode = ''
  try {
    const ingresso = $app.findRecordById('ingressos', ingressoId)
    if (ingresso.getString('inac_id')) {
      qrcode = ingresso.getString('inac_qr')
    } else {
      const INAC_WEBHOOK_URL = $os.getenv('INAC_WEBHOOK_URL')
      const INAC_AUTH_TOKEN = $os.getenv('INAC_AUTH_TOKEN')
      const decodeBody = (b) => {
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
      const categoria = ingresso.getString('tipo_ingresso')
      const categoryId = categoria === 'PLATINUM' ? 6125 : 6123
      let tel = telDigits
      if (tel && tel.length <= 11) tel = '55' + tel
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
      const payload = {
        event_id: 375,
        category_id: categoryId,
        status: 'active',
        fields: [
          { id: 10133653, value: sanitize(nome) },
          { id: 10133654, value: emailNorm },
          { id: 10133655, value: cpfDigits },
          { id: 10133656, value: tel },
          { id: 10133657, value: '' },
          { id: 10133665, value: ingresso.getString('pedido_id') },
        ],
      }

      const logColl = $app.findCollectionByNameOrId('webhooks_log')
      const logAttempt = (evento, detalhe, status, resp) => {
        try {
          const log = new Record(logColl)
          log.set('ingresso_id', ingresso.id)
          log.set('evento', evento)
          log.set('detalhe', detalhe)
          log.set('status', status)
          log.set('method', 'POST')
          log.set('payload', JSON.stringify(payload))
          log.set('response', (resp || '').substring(0, 500))
          $app.save(log)
        } catch (_) {}
      }

      let inacId = ''
      let inacQr = ''
      let apiOk = false

      if (!INAC_WEBHOOK_URL || !INAC_AUTH_TOKEN) {
        ingresso.set('status_webhook', 'pendente')
        $app.save(ingresso)
        logAttempt('webhook_erro', 'INAC não configurado [cortesia]', 0, '')
      } else {
        const MAX = 3
        for (let attempt = 1; attempt <= MAX && !apiOk; attempt++) {
          let status = 0
          let respBody = ''
          let erroMsg = ''
          try {
            const res = $http.send({
              url: INAC_WEBHOOK_URL,
              method: 'POST',
              headers: { 'X-Auth-Token': INAC_AUTH_TOKEN, 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
              timeout: 12,
            })
            status = res.statusCode
            respBody = decodeBody(res.body)
          } catch (err) {
            erroMsg = err.message
          }

          if (status >= 200 && status < 300) {
            try {
              const data = JSON.parse(respBody)
              if (data && data.status === true && data.attendee) {
                apiOk = true
                inacId = String(data.attendee.id || '')
                inacQr = String(data.attendee.qrcode || '')
              }
            } catch (_) {}
          }

          if (apiOk) {
            logAttempt(
              'webhook_enviado',
              `INAC /add OK (id ${inacId}) [cortesia] tentativa ${attempt}/${MAX}`,
              status,
              respBody,
            )
          } else {
            logAttempt(
              'webhook_erro',
              `Tentativa ${attempt}/${MAX} falhou [cortesia] — ` +
                (erroMsg ? `rede: ${erroMsg}` : `HTTP ${status}`),
              status,
              respBody || erroMsg,
            )
            if (attempt < MAX) {
              const until = Date.now() + 1500
              while (Date.now() < until) {
                // backoff
              }
            }
          }
        }

        if (apiOk && inacQr) {
          ingresso.set('inac_id', inacId)
          ingresso.set('inac_qr', inacQr)
          ingresso.set('status_webhook', 'enviado')
          qrcode = inacQr
        } else {
          ingresso.set('status_webhook', 'erro')
        }
        $app.save(ingresso)
      }
    }
  } catch (_) {}

  return e.json(200, {
    success: true,
    qrcode: qrcode,
    pedido_id: pedidoId,
    tipo_ingresso: tipo,
    nome_completo: nome,
  })
})

// --- Admin: cria uma cortesia (+ comprador sintético) ---
routerAdd(
  'POST',
  '/backend/v1/admin/cortesias/create',
  (e) => {
    try {
      const body = e.requestInfo().body || {}
      const anfitriao = (body.anfitriao || '').toString().trim()
      if (anfitriao.length < 2) return e.badRequestError('Informe o nome do anfitrião.')
      let tipo = (body.tipo_ingresso || 'GOLD').toString().toUpperCase()
      if (tipo !== 'GOLD' && tipo !== 'PLATINUM') tipo = 'GOLD'
      let limite = parseInt(body.limite, 10)
      if (isNaN(limite) || limite < 0) limite = 0

      let token = ''
      for (let i = 0; i < 30; i++) {
        const x = $security.randomString(10)
        let exists = false
        try {
          $app.findFirstRecordByData('cortesias', 'token', x)
          exists = true
        } catch (_) {}
        if (!exists) {
          token = x
          break
        }
      }
      if (!token) token = $security.randomString(14)

      const compColl = $app.findCollectionByNameOrId('compradores')
      const comp = new Record(compColl)
      comp.set('nome', 'Cortesia — ' + anfitriao)
      comp.set('email', 'cortesia+' + token + '@cortesia.summit')
      $app.save(comp)

      const coll = $app.findCollectionByNameOrId('cortesias')
      const c = new Record(coll)
      c.set('anfitriao', anfitriao)
      c.set('token', token)
      c.set('tipo_ingresso', tipo)
      c.set('limite', limite)
      c.set('usados', 0)
      c.set('ativo', true)
      c.set('comprador_id', comp.id)
      $app.save(c)

      return e.json(200, {
        success: true,
        id: c.id,
        token: token,
        anfitriao: anfitriao,
        tipo_ingresso: tipo,
        limite: limite,
      })
    } catch (err) {
      return e.badRequestError(err.message)
    }
  },
  $apis.requireAuth(),
)

// --- Admin: lista cortesias ---
routerAdd(
  'GET',
  '/backend/v1/admin/cortesias',
  (e) => {
    try {
      const recs = $app.findRecordsByFilter('cortesias', "id != ''", '-created', 500, 0)
      const out = []
      for (let i = 0; i < recs.length; i++) {
        const c = recs[i]
        out.push({
          id: c.id,
          anfitriao: c.getString('anfitriao'),
          token: c.getString('token'),
          tipo_ingresso: c.getString('tipo_ingresso') || 'GOLD',
          limite: Number(c.get('limite')) || 0,
          usados: Number(c.get('usados')) || 0,
          ativo: c.getBool('ativo'),
          created: c.getString('created'),
        })
      }
      return e.json(200, { cortesias: out })
    } catch (err) {
      return e.badRequestError(err.message)
    }
  },
  $apis.requireAuth(),
)

// --- Admin: ativa/desativa uma cortesia ---
routerAdd(
  'POST',
  '/backend/v1/admin/cortesias/{id}/toggle',
  (e) => {
    try {
      const id = e.request.pathValue('id')
      const c = $app.findRecordById('cortesias', id)
      c.set('ativo', !c.getBool('ativo'))
      $app.save(c)
      return e.json(200, { success: true, ativo: c.getBool('ativo') })
    } catch (err) {
      return e.badRequestError(err.message)
    }
  },
  $apis.requireAuth(),
)

// --- Admin: registros (convidados) de uma cortesia ---
routerAdd(
  'GET',
  '/backend/v1/admin/cortesias/{id}/registros',
  (e) => {
    try {
      const id = e.request.pathValue('id')
      // limite 0 = sem teto: retorna TODOS os registros da cortesia.
      const ings = $app.findRecordsByFilter('ingressos', 'cortesia_id = {:cid}', '-created', 0, 0, {
        cid: id,
      })
      const out = []
      for (let i = 0; i < ings.length; i++) {
        const ing = ings[i]
        let nome = ''
        let email = ''
        let cpf = ''
        const pid = ing.getString('participante_id')
        if (pid) {
          try {
            const p = $app.findRecordById('participantes', pid)
            nome = p.getString('nome_completo')
            email = p.getString('email')
            cpf = p.getString('cpf')
          } catch (_) {}
        }
        out.push({
          ingresso_id: ing.id,
          pedido_id: ing.getString('pedido_id'),
          status: ing.getString('status'),
          credenciado: !!ing.getString('inac_id'),
          nome: nome,
          email: email,
          cpf: cpf,
          created: ing.getString('created'),
        })
      }
      return e.json(200, { registros: out })
    } catch (err) {
      return e.badRequestError(err.message)
    }
  },
  $apis.requireAuth(),
)
