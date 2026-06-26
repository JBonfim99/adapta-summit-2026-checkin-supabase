// ============================================================================
// DISPARO DE ACESSO (magic link) AOS COMPRADORES VIA SENDGRID
// ----------------------------------------------------------------------------
// O BACKEND é dono do processo. No enqueue, o próprio backend drena a fila em
// lotes sequenciais de até 1000 (limite do SendGrid), respeitando um teto de
// tempo por requisição. O CRON roda toda hora como garantia: drena vários lotes
// por tick. Logo, se a requisição for cortada, a aba fechar ou o PC desligar, o
// disparo continua e termina sozinho. O frontend só observa (realtime).
//
// CONCORRÊNCIA: cada lote é reivindicado atomicamente (acesso_claim único) antes
// de processar — enqueue e cron podem rodar juntos sem nunca pegar o mesmo
// comprador (ninguém recebe e-mail repetido).
//
// RETRY INTELIGENTE: 2xx = enviado; 429/5xx/rede = reenfileira (até 5 tentativas,
// o cron retenta no próximo tick); demais 4xx (config) = marca erro na hora.
//
// REGRA JSVM: cada callback roda em VM isolada — todo helper é declarado DENTRO
// do callback. Por isso a lógica de lote aparece duplicada em enqueue e no cron.
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

// --- HEARTBEAT + HEALTH: verifica se o cron roda neste ambiente -------------
cronAdd('cron_heartbeat', '* * * * *', () => {
  try {
    let rec
    try {
      rec = $app.findFirstRecordByFilter('cron_health', "id != ''")
    } catch (_) {
      rec = new Record($app.findCollectionByNameOrId('cron_health'))
    }
    rec.set('last_run', new Date().toISOString())
    $app.save(rec)
  } catch (_) {}
})

routerAdd('GET', '/backend/v1/dispatch/health', (e) => {
  let lastRun = ''
  try {
    const rec = $app.findFirstRecordByFilter('cron_health', "id != ''")
    lastRun = rec.getString('last_run')
  } catch (_) {}
  return e.json(200, { last_run: lastRun, now: new Date().toISOString() })
})

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

// --- Enqueue: cria a campanha, enfileira e JÁ DRENA (com teto de tempo) ------
routerAdd(
  'POST',
  '/backend/v1/admin/dispatch/enqueue',
  (e) => {
    // ---- helpers inline (regra JSVM) ----
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
        const d = $app.findRecordById('disparos', did)
        d.set('enviados', cEnv.c)
        d.set('erros', cErr.c)
        d.set('status', cRest.c > 0 ? 'em_andamento' : 'concluido')
        $app.save(d)
      } catch (_) {}
    }

    // Processa UM lote. Retorna: 'empty' | 'sent' | 'retry' | 'perm' | 'skip'.
    const processOneBatch = (apiKey) => {
      let first
      try {
        first = $app.findFirstRecordByFilter('compradores', 'acesso_status = {:s}', {
          s: 'na_fila',
        })
      } catch (_) {
        return 'empty'
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
        return 'skip'
      }

      const claim = $security.randomString(20)
      try {
        const sub = disparoId
          ? "SELECT id FROM compradores WHERE acesso_status = 'na_fila' AND acesso_disparo_id = {:k} ORDER BY created LIMIT 1000"
          : "SELECT id FROM compradores WHERE acesso_status = 'na_fila' AND acesso_template_id = {:k} ORDER BY created LIMIT 1000"
        $app
          .db()
          .newQuery(
            "UPDATE compradores SET acesso_status = 'enviando', acesso_claim = {:claim} WHERE id IN (" +
              sub +
              ')',
          )
          .bind({ claim: claim, k: disparoId || templateId })
          .execute()
      } catch (_) {
        return 'retry'
      }

      let batch
      try {
        batch = $app.findRecordsByFilter(
          'compradores',
          'acesso_claim = {:claim}',
          'created',
          1000,
          0,
          {
            claim: claim,
          },
        )
      } catch (_) {
        return 'retry'
      }
      if (!batch || batch.length === 0) return 'empty'

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
      } catch (_) {
        try {
          $app
            .db()
            .newQuery(
              "UPDATE compradores SET acesso_status = 'na_fila', acesso_claim = '' WHERE acesso_claim = {:claim}",
            )
            .bind({ claim: claim })
            .execute()
        } catch (_) {}
        return 'retry'
      }

      if (personalizations.length === 0) {
        try {
          $app
            .db()
            .newQuery(
              "UPDATE compradores SET acesso_status = 'erro', acesso_erro = 'Sem email', acesso_claim = '' WHERE acesso_claim = {:claim}",
            )
            .bind({ claim: claim })
            .execute()
        } catch (_) {}
        atualizaDisparo(disparoId)
        return 'skip'
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
      const retryable = !ok && (status === 429 || status >= 500 || status === 0)

      if (ok) {
        const now = new Date().toISOString()
        try {
          $app
            .db()
            .newQuery(
              "UPDATE compradores SET acesso_status = 'enviado', acesso_enviado_em = {:now}, acesso_erro = '', acesso_claim = '' WHERE acesso_claim = {:claim}",
            )
            .bind({ now: now, claim: claim })
            .execute()
        } catch (_) {}
        atualizaDisparo(disparoId)
        return 'sent'
      } else if (retryable) {
        const errTxt = ('HTTP ' + status + ' ' + (respBody || erroMsg || '')).substring(0, 300)
        try {
          $app
            .db()
            .newQuery(
              'UPDATE compradores SET acesso_tentativas = acesso_tentativas + 1, acesso_erro = {:err}, ' +
                "acesso_status = CASE WHEN acesso_tentativas + 1 >= 5 THEN 'erro' ELSE 'na_fila' END, " +
                "acesso_claim = '' WHERE acesso_claim = {:claim}",
            )
            .bind({ err: errTxt, claim: claim })
            .execute()
        } catch (_) {}
        atualizaDisparo(disparoId)
        return 'retry'
      } else {
        const errTxt = ('HTTP ' + status + ' ' + (respBody || erroMsg || '')).substring(0, 300)
        try {
          $app
            .db()
            .newQuery(
              "UPDATE compradores SET acesso_tentativas = acesso_tentativas + 1, acesso_erro = {:err}, acesso_status = 'erro', acesso_claim = '' WHERE acesso_claim = {:claim}",
            )
            .bind({ err: errTxt, claim: claim })
            .execute()
        } catch (_) {}
        atualizaDisparo(disparoId)
        return 'perm'
      }
    }

    const drain = (apiKey, budgetMs) => {
      // Recupera presos em 'enviando' há mais de 10min (crash/deploy).
      try {
        const cut = new Date(Date.now() - 10 * 60 * 1000).toISOString().replace('T', ' ')
        $app
          .db()
          .newQuery(
            "UPDATE compradores SET acesso_status = 'na_fila', acesso_claim = '' WHERE acesso_status = 'enviando' AND updated < {:cut}",
          )
          .bind({ cut: cut })
          .execute()
      } catch (_) {}

      const start = Date.now()
      while (Date.now() - start < budgetMs) {
        const r = processOneBatch(apiKey)
        if (r === 'empty') break
        if (r === 'retry') break // deixa o cron retentar no próximo tick (sem busy-wait)
        // 'sent' | 'perm' | 'skip' → próximo lote imediatamente
      }
    }

    // ---- corpo do enqueue ----
    try {
      const body = e.requestInfo().body || {}
      const cluster = body.cluster === 'pendentes' ? 'pendentes' : 'todos'
      const templateId = (body.template_id || '').toString().trim()
      const templateNome = (body.template_nome || '').toString().trim()

      if (!templateId) return e.badRequestError('Selecione um template')
      if (templateId.indexOf('d-') !== 0) {
        return e.badRequestError('template_id inválido (deve começar com d-)')
      }

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
            "acesso_disparo_id = {:did}, acesso_tentativas = 0, acesso_erro = '', acesso_claim = '' WHERE " +
            where,
        )
        .bind({ tid: templateId, did: disparoId })
        .execute()

      const row = new DynamicModel({ c: 0 })
      $app
        .db()
        .newQuery('SELECT COUNT(*) as c FROM compradores WHERE acesso_disparo_id = {:did}')
        .bind({ did: disparoId })
        .one(row)

      disparo.set('total', row.c)
      if (row.c === 0) disparo.set('status', 'concluido')
      $app.save(disparo)

      // Drena já, no backend (teto ~20s). O resto, se houver, o cron termina.
      const apiKey = $os.getenv('SENDGRID_API_KEY')
      if (apiKey && row.c > 0) {
        try {
          drain(apiKey, 20000)
        } catch (_) {}
      }

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
          "UPDATE compradores SET acesso_status = 'na_fila', acesso_tentativas = 0, acesso_erro = '', acesso_claim = '' " +
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

// --- CRON: garantia. Drena vários lotes por tick (teto ~45s). ---------------
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
      const d = $app.findRecordById('disparos', did)
      d.set('enviados', cEnv.c)
      d.set('erros', cErr.c)
      d.set('status', cRest.c > 0 ? 'em_andamento' : 'concluido')
      $app.save(d)
    } catch (_) {}
  }

  const processOneBatch = () => {
    let first
    try {
      first = $app.findFirstRecordByFilter('compradores', 'acesso_status = {:s}', { s: 'na_fila' })
    } catch (_) {
      return 'empty'
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
      return 'skip'
    }

    const claim = $security.randomString(20)
    try {
      const sub = disparoId
        ? "SELECT id FROM compradores WHERE acesso_status = 'na_fila' AND acesso_disparo_id = {:k} ORDER BY created LIMIT 1000"
        : "SELECT id FROM compradores WHERE acesso_status = 'na_fila' AND acesso_template_id = {:k} ORDER BY created LIMIT 1000"
      $app
        .db()
        .newQuery(
          "UPDATE compradores SET acesso_status = 'enviando', acesso_claim = {:claim} WHERE id IN (" +
            sub +
            ')',
        )
        .bind({ claim: claim, k: disparoId || templateId })
        .execute()
    } catch (_) {
      return 'retry'
    }

    let batch
    try {
      batch = $app.findRecordsByFilter(
        'compradores',
        'acesso_claim = {:claim}',
        'created',
        1000,
        0,
        {
          claim: claim,
        },
      )
    } catch (_) {
      return 'retry'
    }
    if (!batch || batch.length === 0) return 'empty'

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
    } catch (_) {
      try {
        $app
          .db()
          .newQuery(
            "UPDATE compradores SET acesso_status = 'na_fila', acesso_claim = '' WHERE acesso_claim = {:claim}",
          )
          .bind({ claim: claim })
          .execute()
      } catch (_) {}
      return 'retry'
    }

    if (personalizations.length === 0) {
      try {
        $app
          .db()
          .newQuery(
            "UPDATE compradores SET acesso_status = 'erro', acesso_erro = 'Sem email', acesso_claim = '' WHERE acesso_claim = {:claim}",
          )
          .bind({ claim: claim })
          .execute()
      } catch (_) {}
      atualizaDisparo(disparoId)
      return 'skip'
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
    const retryable = !ok && (status === 429 || status >= 500 || status === 0)

    if (ok) {
      const now = new Date().toISOString()
      try {
        $app
          .db()
          .newQuery(
            "UPDATE compradores SET acesso_status = 'enviado', acesso_enviado_em = {:now}, acesso_erro = '', acesso_claim = '' WHERE acesso_claim = {:claim}",
          )
          .bind({ now: now, claim: claim })
          .execute()
      } catch (_) {}
      atualizaDisparo(disparoId)
      return 'sent'
    } else if (retryable) {
      const errTxt = ('HTTP ' + status + ' ' + (respBody || erroMsg || '')).substring(0, 300)
      try {
        $app
          .db()
          .newQuery(
            'UPDATE compradores SET acesso_tentativas = acesso_tentativas + 1, acesso_erro = {:err}, ' +
              "acesso_status = CASE WHEN acesso_tentativas + 1 >= 5 THEN 'erro' ELSE 'na_fila' END, " +
              "acesso_claim = '' WHERE acesso_claim = {:claim}",
          )
          .bind({ err: errTxt, claim: claim })
          .execute()
      } catch (_) {}
      atualizaDisparo(disparoId)
      return 'retry'
    } else {
      const errTxt = ('HTTP ' + status + ' ' + (respBody || erroMsg || '')).substring(0, 300)
      try {
        $app
          .db()
          .newQuery(
            "UPDATE compradores SET acesso_tentativas = acesso_tentativas + 1, acesso_erro = {:err}, acesso_status = 'erro', acesso_claim = '' WHERE acesso_claim = {:claim}",
          )
          .bind({ err: errTxt, claim: claim })
          .execute()
      } catch (_) {}
      atualizaDisparo(disparoId)
      return 'perm'
    }
  }

  // Recupera presos em 'enviando' há mais de 10min.
  try {
    const cut = new Date(Date.now() - 10 * 60 * 1000).toISOString().replace('T', ' ')
    $app
      .db()
      .newQuery(
        "UPDATE compradores SET acesso_status = 'na_fila', acesso_claim = '' WHERE acesso_status = 'enviando' AND updated < {:cut}",
      )
      .bind({ cut: cut })
      .execute()
  } catch (_) {}

  // Drena vários lotes neste tick (teto ~45s).
  const start = Date.now()
  while (Date.now() - start < 45000) {
    const r = processOneBatch()
    if (r === 'empty') break
    if (r === 'retry') break // próximo tick retenta
  }
})
