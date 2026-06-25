// ============================================================================
// DISPARO DE ACESSO (magic link) AOS COMPRADORES VIA SENDGRID
// ----------------------------------------------------------------------------
// Fluxo: o clique do admin cria uma CAMPANHA (registro em `disparos`) e
// ENFILEIRA os compradores-alvo (UPDATE em massa, instantâneo), marcando cada
// um com o acesso_disparo_id da campanha. Um cron drena a fila em lotes de até
// 1000 (limite de personalizations do SendGrid), gera 1 token (60 dias) por
// comprador e faz UMA chamada ao /v3/mail/send por lote. Ao fim de cada lote,
// recalcula os contadores da campanha e grava no registro `disparos` — o painel
// acompanha por realtime, sem polling.
//
// REGRA JSVM: cada callback roda em VM isolada — todo helper é declarado DENTRO
// do callback (nada no topo do arquivo).
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

// --- Enqueue: cria a campanha e enfileira o cluster -------------------------
routerAdd(
  'POST',
  '/backend/v1/admin/dispatch/enqueue',
  (e) => {
    try {
      const body = e.requestInfo().body || {}
      const cluster = body.cluster === 'pendentes' ? 'pendentes' : 'todos'
      const templateId = (body.template_id || '').toString().trim()
      const templateNome = (body.template_nome || '').toString().trim()

      if (!templateId) return e.badRequestError('Selecione um template')
      if (templateId.indexOf('d-') !== 0) {
        return e.badRequestError('template_id inválido (deve começar com d-)')
      }

      // 1. Cria o registro da campanha.
      const disparosColl = $app.findCollectionByNameOrId('disparos')
      const disparo = new Record(disparosColl)
      disparo.set('template_id', templateId)
      disparo.set('template_nome', templateNome || templateId)
      disparo.set('cluster', cluster)
      disparo.set('total', 0)
      disparo.set('enviados', 0)
      disparo.set('erros', 0)
      disparo.set('status', 'em_andamento')
      $app.save(disparo)
      const disparoId = disparo.id

      // 2. Enfileira o cluster, marcando o acesso_disparo_id da campanha.
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
          "UPDATE compradores SET acesso_status = 'na_fila', acesso_template_id = {:tid}, " +
            "acesso_disparo_id = {:did}, acesso_tentativas = 0, acesso_erro = '' WHERE " +
            where,
        )
        .bind({ tid: templateId, did: disparoId })
        .execute()

      // 3. Conta quantos entraram e grava o total na campanha.
      const row = new DynamicModel({ c: 0 })
      $app
        .db()
        .newQuery('SELECT COUNT(*) as c FROM compradores WHERE acesso_disparo_id = {:did}')
        .bind({ did: disparoId })
        .one(row)

      disparo.set('total', row.c)
      if (row.c === 0) disparo.set('status', 'concluido')
      $app.save(disparo)

      return e.json(200, { enqueued: row.c, disparo_id: disparoId })
    } catch (err) {
      return e.badRequestError(err.message)
    }
  },
  $apis.requireAuth(),
)

// --- Retry por campanha: reenfileira os 'erro' de um disparo -----------------
routerAdd(
  'POST',
  '/backend/v1/admin/dispatch/{disparoId}/retry',
  (e) => {
    try {
      const disparoId = e.request.pathValue('disparoId')
      if (!disparoId) return e.badRequestError('disparoId é obrigatório')

      $app
        .db()
        .newQuery(
          "UPDATE compradores SET acesso_status = 'na_fila', acesso_tentativas = 0, acesso_erro = '' " +
            "WHERE acesso_disparo_id = {:did} AND acesso_status = 'erro'",
        )
        .bind({ did: disparoId })
        .execute()

      const row = new DynamicModel({ c: 0 })
      $app
        .db()
        .newQuery(
          "SELECT COUNT(*) as c FROM compradores WHERE acesso_disparo_id = {:did} AND acesso_status = 'na_fila'",
        )
        .bind({ did: disparoId })
        .one(row)

      try {
        const disparo = $app.findRecordById('disparos', disparoId)
        if (row.c > 0) {
          disparo.set('status', 'em_andamento')
          $app.save(disparo)
        }
      } catch (_) {}

      return e.json(200, { requeued: row.c })
    } catch (err) {
      return e.badRequestError(err.message)
    }
  },
  $apis.requireAuth(),
)

// --- TICK manual: processa UM lote sob demanda e devolve diagnóstico --------
// Usado pela tela (que chama enquanto há campanha em andamento) e serve de
// fallback caso o cron não rode no ambiente. Espelha a lógica do cron.
routerAdd(
  'POST',
  '/backend/v1/admin/dispatch/tick',
  (e) => {
    const apiKey = $os.getenv('SENDGRID_API_KEY')
    if (!apiKey) return e.json(200, { ran: false, reason: 'no_api_key' })

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

    const atualizaDisparo = (did) => {
      if (!did) return
      try {
        const cEnv = new DynamicModel({ c: 0 })
        $app
          .db()
          .newQuery(
            "SELECT COUNT(*) as c FROM compradores WHERE acesso_disparo_id = {:did} AND acesso_status = 'enviado'",
          )
          .bind({ did: did })
          .one(cEnv)
        const cErr = new DynamicModel({ c: 0 })
        $app
          .db()
          .newQuery(
            "SELECT COUNT(*) as c FROM compradores WHERE acesso_disparo_id = {:did} AND acesso_status = 'erro'",
          )
          .bind({ did: did })
          .one(cErr)
        const cRest = new DynamicModel({ c: 0 })
        $app
          .db()
          .newQuery(
            "SELECT COUNT(*) as c FROM compradores WHERE acesso_disparo_id = {:did} AND (acesso_status = 'na_fila' OR acesso_status = 'enviando')",
          )
          .bind({ did: did })
          .one(cRest)
        const disparo = $app.findRecordById('disparos', did)
        disparo.set('enviados', cEnv.c)
        disparo.set('erros', cErr.c)
        disparo.set('status', cRest.c > 0 ? 'em_andamento' : 'concluido')
        $app.save(disparo)
      } catch (_) {}
    }

    // Recupera presos em 'enviando' há mais de 10min.
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

    let first
    try {
      first = $app.findFirstRecordByFilter('compradores', 'acesso_status = {:s}', { s: 'na_fila' })
    } catch (_) {
      return e.json(200, { ran: false, reason: 'fila_vazia' })
    }
    const templateId = first.getString('acesso_template_id')
    const disparoId = first.getString('acesso_disparo_id')
    if (!templateId) {
      first.set('acesso_status', 'erro')
      first.set('acesso_erro', 'Sem template definido')
      try {
        $app.save(first)
      } catch (_) {}
      atualizaDisparo(disparoId)
      return e.json(200, { ran: false, reason: 'sem_template' })
    }

    let batch
    try {
      if (disparoId) {
        batch = $app.findRecordsByFilter(
          'compradores',
          'acesso_status = {:s} && acesso_disparo_id = {:did}',
          'created',
          1000,
          0,
          { s: 'na_fila', did: disparoId },
        )
      } else {
        batch = $app.findRecordsByFilter(
          'compradores',
          'acesso_status = {:s} && acesso_template_id = {:tid}',
          'created',
          1000,
          0,
          { s: 'na_fila', tid: templateId },
        )
      }
    } catch (err) {
      return e.json(200, { ran: false, reason: 'erro_busca', error: err.message })
    }
    if (!batch || batch.length === 0) return e.json(200, { ran: false, reason: 'fila_vazia' })

    const idList = batch.map((c) => "'" + c.id + "'").join(',')

    try {
      $app
        .db()
        .newQuery("UPDATE compradores SET acesso_status = 'enviando' WHERE id IN (" + idList + ')')
        .execute()
    } catch (_) {}

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
      try {
        $app
          .db()
          .newQuery("UPDATE compradores SET acesso_status = 'na_fila' WHERE id IN (" + idList + ')')
          .execute()
      } catch (_) {}
      return e.json(200, { ran: false, reason: 'erro_token', error: err.message })
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
      atualizaDisparo(disparoId)
      return e.json(200, { ran: false, reason: 'sem_email' })
    }

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

    atualizaDisparo(disparoId)

    return e.json(200, {
      ran: true,
      reason: ok ? 'ok' : 'sendgrid_falhou',
      batch: batch.length,
      sg_status: status,
      sg_ok: ok,
      sg_error: ok ? '' : (respBody || erroMsg || '').substring(0, 300),
    })
  },
  $apis.requireAuth(),
)

// --- CRON: drena a fila, 1 lote (1 campanha) de até 1000 por minuto ---------
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

  // Recalcula os contadores de uma campanha e grava no registro `disparos`.
  const atualizaDisparo = (did) => {
    if (!did) return
    try {
      const cEnv = new DynamicModel({ c: 0 })
      $app
        .db()
        .newQuery(
          "SELECT COUNT(*) as c FROM compradores WHERE acesso_disparo_id = {:did} AND acesso_status = 'enviado'",
        )
        .bind({ did: did })
        .one(cEnv)

      const cErr = new DynamicModel({ c: 0 })
      $app
        .db()
        .newQuery(
          "SELECT COUNT(*) as c FROM compradores WHERE acesso_disparo_id = {:did} AND acesso_status = 'erro'",
        )
        .bind({ did: did })
        .one(cErr)

      const cRest = new DynamicModel({ c: 0 })
      $app
        .db()
        .newQuery(
          "SELECT COUNT(*) as c FROM compradores WHERE acesso_disparo_id = {:did} AND (acesso_status = 'na_fila' OR acesso_status = 'enviando')",
        )
        .bind({ did: did })
        .one(cRest)

      const disparo = $app.findRecordById('disparos', did)
      disparo.set('enviados', cEnv.c)
      disparo.set('erros', cErr.c)
      disparo.set('status', cRest.c > 0 ? 'em_andamento' : 'concluido')
      $app.save(disparo)
    } catch (_) {}
  }

  // 1. Recupera lotes presos em 'enviando' há mais de 10min (crash/deploy).
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

  // 2. Descobre a campanha do topo da fila.
  let first
  try {
    first = $app.findFirstRecordByFilter('compradores', 'acesso_status = {:s}', { s: 'na_fila' })
  } catch (_) {
    return // fila vazia
  }
  const templateId = first.getString('acesso_template_id')
  const disparoId = first.getString('acesso_disparo_id')
  if (!templateId) {
    first.set('acesso_status', 'erro')
    first.set('acesso_erro', 'Sem template definido')
    try {
      $app.save(first)
    } catch (_) {}
    atualizaDisparo(disparoId)
    return
  }

  // 3. Pega até 1000 da fila DESSA campanha (homogêneo: mesmo template).
  let batch
  try {
    if (disparoId) {
      batch = $app.findRecordsByFilter(
        'compradores',
        'acesso_status = {:s} && acesso_disparo_id = {:did}',
        'created',
        1000,
        0,
        { s: 'na_fila', did: disparoId },
      )
    } else {
      // Legado (enfileirado antes do histórico): agrupa por template.
      batch = $app.findRecordsByFilter(
        'compradores',
        'acesso_status = {:s} && acesso_template_id = {:tid}',
        'created',
        1000,
        0,
        { s: 'na_fila', tid: templateId },
      )
    }
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
    atualizaDisparo(disparoId)
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

  // 8. Recalcula e grava os contadores da campanha (acompanhamento ao vivo).
  atualizaDisparo(disparoId)
})
