// ============================================================================
// DISPARO DE ACESSO (magic link) AOS COMPRADORES VIA SENDGRID
// ----------------------------------------------------------------------------
// Arquitetura: o clique do admin apenas ENFILEIRA (UPDATE em massa, instantâneo).
// Um cron drena a fila em lotes de até 1000 (limite de personalizations do
// SendGrid), gera 1 token de acesso por comprador (validade 60 dias) e faz UMA
// chamada ao /v3/mail/send por lote. Carga ~1 chamada/min, sem cascata.
//
// REGRA JSVM: cada callback roda em VM isolada — nada de helper no topo. Todo
// helper (decodeBody, etc.) é declarado DENTRO do callback.
// ============================================================================

// --- Lista os dynamic templates do SendGrid (para o dropdown) ---------------
routerAdd(
  'GET',
  '/backend/v1/admin/sendgrid/templates',
  (e) => {
    const apiKey = $os.getenv('SENDGRID_API_KEY')
    if (!apiKey) return e.json(200, { templates: [], error: 'SENDGRID_API_KEY não configurada' })

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

    try {
      const res = $http.send({
        url: 'https://api.sendgrid.com/v3/templates?generations=dynamic&page_size=200',
        method: 'GET',
        headers: { Authorization: 'Bearer ' + apiKey },
        timeout: 20,
      })

      const txt = decodeBody(res.body)
      let parsed = {}
      try {
        parsed = JSON.parse(txt)
      } catch (_) {}

      const list = parsed.result || parsed.templates || []
      const templates = []
      for (const t of list) {
        if (!t || !t.id) continue
        if (t.generation && t.generation !== 'dynamic') continue
        templates.push({ id: t.id, name: t.name || t.id })
      }
      return e.json(200, { templates: templates })
    } catch (err) {
      return e.json(200, { templates: [], error: err.message })
    }
  },
  $apis.requireAuth(),
)

// --- Preview: quantos compradores o cluster atinge --------------------------
routerAdd(
  'POST',
  '/backend/v1/admin/dispatch/preview',
  (e) => {
    try {
      const body = e.requestInfo().body || {}
      const cluster = body.cluster

      let sql
      if (cluster === 'pendentes') {
        sql =
          "SELECT COUNT(*) as c FROM compradores WHERE email != '' AND id IN (SELECT comprador_id FROM ingressos WHERE status = 'Pendente')"
      } else {
        sql = "SELECT COUNT(*) as c FROM compradores WHERE email != ''"
      }

      const row = new DynamicModel({ c: 0 })
      $app.db().newQuery(sql).one(row)
      return e.json(200, { count: row.c })
    } catch (err) {
      return e.badRequestError(err.message)
    }
  },
  $apis.requireAuth(),
)

// --- Enqueue: marca o cluster como na_fila com o template escolhido ----------
routerAdd(
  'POST',
  '/backend/v1/admin/dispatch/enqueue',
  (e) => {
    try {
      const body = e.requestInfo().body || {}
      const cluster = body.cluster
      const templateId = (body.template_id || '').toString().trim()

      if (!templateId) return e.badRequestError('Selecione um template')
      if (templateId.indexOf('d-') !== 0) {
        return e.badRequestError('template_id inválido (deve começar com d-)')
      }

      let where
      if (cluster === 'pendentes') {
        where =
          "email != '' AND id IN (SELECT comprador_id FROM ingressos WHERE status = 'Pendente') AND (acesso_status IS NULL OR acesso_status != 'enviando')"
      } else {
        where = "email != '' AND (acesso_status IS NULL OR acesso_status != 'enviando')"
      }

      $app
        .db()
        .newQuery(
          "UPDATE compradores SET acesso_status = 'na_fila', acesso_template_id = {:tid}, acesso_tentativas = 0, acesso_erro = '' WHERE " +
            where,
        )
        .bind({ tid: templateId })
        .execute()

      const row = new DynamicModel({ c: 0 })
      $app
        .db()
        .newQuery(
          "SELECT COUNT(*) as c FROM compradores WHERE acesso_status = 'na_fila' AND acesso_template_id = {:tid}",
        )
        .bind({ tid: templateId })
        .one(row)

      return e.json(200, { enqueued: row.c })
    } catch (err) {
      return e.badRequestError(err.message)
    }
  },
  $apis.requireAuth(),
)

// --- Stats: contadores por status (para o painel ao vivo) -------------------
routerAdd(
  'GET',
  '/backend/v1/admin/dispatch/stats',
  (e) => {
    try {
      const count = (sql) => {
        const row = new DynamicModel({ c: 0 })
        $app.db().newQuery(sql).one(row)
        return row.c
      }
      const total = count("SELECT COUNT(*) as c FROM compradores WHERE email != ''")
      const na_fila = count("SELECT COUNT(*) as c FROM compradores WHERE acesso_status = 'na_fila'")
      const enviando = count(
        "SELECT COUNT(*) as c FROM compradores WHERE acesso_status = 'enviando'",
      )
      const enviado = count("SELECT COUNT(*) as c FROM compradores WHERE acesso_status = 'enviado'")
      const erro = count("SELECT COUNT(*) as c FROM compradores WHERE acesso_status = 'erro'")

      return e.json(200, { total, na_fila, enviando, enviado, erro })
    } catch (err) {
      return e.badRequestError(err.message)
    }
  },
  $apis.requireAuth(),
)

// --- Reenfileira os que ficaram em 'erro' -----------------------------------
routerAdd(
  'POST',
  '/backend/v1/admin/dispatch/retry-errors',
  (e) => {
    try {
      $app
        .db()
        .newQuery(
          "UPDATE compradores SET acesso_status = 'na_fila', acesso_tentativas = 0, acesso_erro = '' WHERE acesso_status = 'erro'",
        )
        .execute()

      const row = new DynamicModel({ c: 0 })
      $app
        .db()
        .newQuery("SELECT COUNT(*) as c FROM compradores WHERE acesso_status = 'na_fila'")
        .one(row)

      return e.json(200, { requeued: row.c })
    } catch (err) {
      return e.badRequestError(err.message)
    }
  },
  $apis.requireAuth(),
)

// --- CRON: drena a fila, 1 lote de até 1000 por minuto ----------------------
cronAdd('email_dispatch', '* * * * *', () => {
  const apiKey = $os.getenv('SENDGRID_API_KEY')
  if (!apiKey) return

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

  // 1. Recupera lotes presos em 'enviando' há mais de 10min (crash/deploy).
  //    Não toca em lotes ativos (updated recente), então é seguro contra overlap.
  try {
    const cut = new Date(Date.now() - 10 * 60 * 1000).toISOString().replace('T', ' ')
    $app
      .db()
      .newQuery(
        "UPDATE compradores SET acesso_status = 'na_fila' WHERE acesso_status = 'enviando' AND updated < {:cut}",
      )
      .bind({ cut: cut })
      .execute()
  } catch (_) {}

  // 2. Descobre o template do topo da fila.
  let first
  try {
    first = $app.findFirstRecordByFilter('compradores', 'acesso_status = {:s}', { s: 'na_fila' })
  } catch (_) {
    return // fila vazia
  }
  const templateId = first.getString('acesso_template_id')
  if (!templateId) {
    first.set('acesso_status', 'erro')
    first.set('acesso_erro', 'Sem template definido')
    try {
      $app.save(first)
    } catch (_) {}
    return
  }

  // 3. Pega até 1000 da fila com esse template.
  let batch
  try {
    batch = $app.findRecordsByFilter(
      'compradores',
      'acesso_status = {:s} && acesso_template_id = {:tid}',
      'created',
      1000,
      0,
      { s: 'na_fila', tid: templateId },
    )
  } catch (_) {
    return
  }
  if (!batch || batch.length === 0) return

  // IDs do PocketBase são [a-z0-9]{15}, seguros para montar IN (...) à mão.
  const idList = batch.map((c) => "'" + c.id + "'").join(',')

  // 4. Reivindica o lote (na_fila -> enviando) numa tacada.
  try {
    $app
      .db()
      .newQuery("UPDATE compradores SET acesso_status = 'enviando' WHERE id IN (" + idList + ')')
      .execute()
  } catch (_) {}

  // 5. Gera 1 token (60 dias) por comprador e monta as personalizations.
  const personalizations = []
  const exp = new Date()
  exp.setDate(exp.getDate() + 60)
  const expIso = exp.toISOString()

  try {
    $app.runInTransaction((txApp) => {
      const tokenColl = txApp.findCollectionByNameOrId('tokens_acesso')
      for (const c of batch) {
        const email = c.getString('email')
        if (!email) continue
        const token = $security.randomString(40)
        const tr = new Record(tokenColl)
        tr.set('comprador_id', c.id)
        tr.set('token', token)
        tr.set('usado', false)
        tr.set('expira_em', expIso)
        txApp.save(tr)

        const nome = c.getString('nome') || ''
        const firstname = (nome.split(' ')[0] || nome || '').trim()
        personalizations.push({
          to: [{ email: email, name: nome }],
          dynamic_template_data: { firstname: firstname, token: token },
        })
      }
    })
  } catch (err) {
    // Falha ao gerar tokens: devolve o lote pra fila e sai.
    try {
      $app
        .db()
        .newQuery("UPDATE compradores SET acesso_status = 'na_fila' WHERE id IN (" + idList + ')')
        .execute()
    } catch (_) {}
    return
  }

  if (personalizations.length === 0) {
    try {
      $app
        .db()
        .newQuery(
          "UPDATE compradores SET acesso_status = 'erro', acesso_erro = 'Sem email' WHERE id IN (" +
            idList +
            ')',
        )
        .execute()
    } catch (_) {}
    return
  }

  // 6. Uma chamada ao SendGrid com o lote inteiro (template dinâmico).
  let status = 0
  let respBody = ''
  let erroMsg = ''
  try {
    const res = $http.send({
      url: 'https://api.sendgrid.com/v3/mail/send',
      method: 'POST',
      headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: { email: 'duvidas@adapta.org', name: 'Adapta Summit 2026' },
        template_id: templateId,
        personalizations: personalizations,
      }),
      timeout: 30,
    })
    status = res.statusCode
    respBody = decodeBody(res.body)
  } catch (err) {
    erroMsg = err.message
  }

  const ok = status >= 200 && status < 300

  // 7. Marca o resultado do lote em massa.
  if (ok) {
    const now = new Date().toISOString()
    try {
      $app
        .db()
        .newQuery(
          "UPDATE compradores SET acesso_status = 'enviado', acesso_enviado_em = {:now}, acesso_erro = '' WHERE id IN (" +
            idList +
            ')',
        )
        .bind({ now: now })
        .execute()
    } catch (_) {}
  } else {
    const errTxt = ('HTTP ' + status + ' ' + (respBody || erroMsg || '')).substring(0, 300)
    try {
      $app
        .db()
        .newQuery(
          'UPDATE compradores SET acesso_tentativas = acesso_tentativas + 1, acesso_erro = {:err}, ' +
            "acesso_status = CASE WHEN acesso_tentativas + 1 >= 3 THEN 'erro' ELSE 'na_fila' END " +
            'WHERE id IN (' +
            idList +
            ')',
        )
        .bind({ err: errTxt })
        .execute()
    } catch (_) {}
  }
})
