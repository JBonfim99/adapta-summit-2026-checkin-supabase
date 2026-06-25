// ============================================================================
// DISPARO DE ACESSO (magic link) AOS COMPRADORES VIA SENDGRID
// ----------------------------------------------------------------------------
// Fluxo: o clique do admin cria uma CAMPANHA (registro em `disparos`) e
// ENFILEIRA os compradores-alvo (UPDATE em massa, instantâneo). O frontend então
// orquestra o esvaziamento da fila chamando /dispatch/process em sequência —
// um lote de até 1000 por chamada, o próximo logo após o anterior. Até 1000
// pessoas saem num único lote (imediato); acima disso, lotes sequenciais.
//
// CONCORRÊNCIA: cada lote é reivindicado atomicamente (acesso_claim = id único)
// antes de processar, então cron e frontend podem rodar juntos sem nunca pegar
// o mesmo comprador. O cron é só rede de segurança (aba fechada).
//
// RETRY INTELIGENTE: 2xx = enviado; 429/5xx/erro de rede = reenfileira (até 5
// tentativas) e sinaliza retryable pro orquestrador dar backoff; demais 4xx
// (config: remetente/template/auth) = marca erro na hora, sem desperdiçar tries.
//
// REGRA JSVM: cada callback roda em VM isolada — todo helper é declarado DENTRO
// do callback.
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

// --- PROCESS: reivindica e processa UM lote (até 1000). O frontend chama em
//     sequência até esvaziar a fila. Retorna info pro orquestrador. -----------
routerAdd(
  'POST',
  '/backend/v1/admin/dispatch/process',
  (e) => {
    const apiKey = $os.getenv('SENDGRID_API_KEY')
    if (!apiKey) return e.json(200, { ran: false, reason: 'no_api_key', remaining: 0 })

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

    const countNaFila = () => {
      const r = new DynamicModel({ c: 0 })
      $app
        .db()
        .newQuery("SELECT COUNT(*) as c FROM compradores WHERE acesso_status = 'na_fila'")
        .one(r)
      return r.c
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

    // Campanha do topo da fila.
    let first
    try {
      first = $app.findFirstRecordByFilter('compradores', 'acesso_status = {:s}', { s: 'na_fila' })
    } catch (_) {
      return e.json(200, { ran: false, reason: 'fila_vazia', remaining: 0 })
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
      return e.json(200, { ran: false, reason: 'sem_template', remaining: countNaFila() })
    }

    // Reivindica atomicamente até 1000 dessa campanha.
    const claim = $security.randomString(20)
    try {
      let sub
      if (disparoId) {
        sub =
          "SELECT id FROM compradores WHERE acesso_status = 'na_fila' AND acesso_disparo_id = {:did} ORDER BY created LIMIT 1000"
        $app
          .db()
          .newQuery(
            "UPDATE compradores SET acesso_status = 'enviando', acesso_claim = {:claim} WHERE id IN (" +
              sub +
              ')',
          )
          .bind({ claim: claim, did: disparoId })
          .execute()
      } else {
        sub =
          "SELECT id FROM compradores WHERE acesso_status = 'na_fila' AND acesso_template_id = {:tid} ORDER BY created LIMIT 1000"
        $app
          .db()
          .newQuery(
            "UPDATE compradores SET acesso_status = 'enviando', acesso_claim = {:claim} WHERE id IN (" +
              sub +
              ')',
          )
          .bind({ claim: claim, tid: templateId })
          .execute()
      }
    } catch (err) {
      return e.json(200, {
        ran: false,
        reason: 'erro_claim',
        error: err.message,
        remaining: countNaFila(),
      })
    }

    // Carrega exatamente o que reivindiquei.
    let batch
    try {
      batch = $app.findRecordsByFilter(
        'compradores',
        'acesso_claim = {:claim}',
        'created',
        1000,
        0,
        { claim: claim },
      )
    } catch (err) {
      return e.json(200, {
        ran: false,
        reason: 'erro_busca',
        error: err.message,
        remaining: countNaFila(),
      })
    }
    if (!batch || batch.length === 0) {
      return e.json(200, { ran: false, reason: 'fila_vazia', remaining: countNaFila() })
    }

    // Gera 1 token (60 dias) por comprador e monta as personalizations.
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
          .newQuery(
            "UPDATE compradores SET acesso_status = 'na_fila', acesso_claim = '' WHERE acesso_claim = {:claim}",
          )
          .bind({ claim: claim })
          .execute()
      } catch (_) {}
      return e.json(200, {
        ran: false,
        reason: 'erro_token',
        error: err.message,
        remaining: countNaFila(),
      })
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
      return e.json(200, { ran: false, reason: 'sem_email', remaining: countNaFila() })
    }

    // Uma chamada ao SendGrid com o lote inteiro.
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
    // Retryável: rate limit, erro de servidor do SendGrid ou falha de rede.
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
    } else {
      // 4xx de configuração (400/401/403/413...): não adianta retentar.
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
    }

    atualizaDisparo(disparoId)

    return e.json(200, {
      ran: true,
      reason: ok ? 'ok' : retryable ? 'retry' : 'erro_permanente',
      batch: batch.length,
      remaining: countNaFila(),
      sg_status: status,
      sg_ok: ok,
      retryable: retryable,
      sg_error: ok ? '' : (respBody || erroMsg || '').substring(0, 300),
    })
  },
  $apis.requireAuth(),
)

// --- CRON: rede de segurança (aba fechada). Mesma lógica de claim atômico. ---
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
      const disparo = $app.findRecordById('disparos', did)
      disparo.set('enviados', cEnv.c)
      disparo.set('erros', cErr.c)
      disparo.set('status', cRest.c > 0 ? 'em_andamento' : 'concluido')
      $app.save(disparo)
    } catch (_) {}
  }

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

  let first
  try {
    first = $app.findFirstRecordByFilter('compradores', 'acesso_status = {:s}', { s: 'na_fila' })
  } catch (_) {
    return
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

  const claim = $security.randomString(20)
  try {
    let sub
    if (disparoId) {
      sub =
        "SELECT id FROM compradores WHERE acesso_status = 'na_fila' AND acesso_disparo_id = {:did} ORDER BY created LIMIT 1000"
      $app
        .db()
        .newQuery(
          "UPDATE compradores SET acesso_status = 'enviando', acesso_claim = {:claim} WHERE id IN (" +
            sub +
            ')',
        )
        .bind({ claim: claim, did: disparoId })
        .execute()
    } else {
      sub =
        "SELECT id FROM compradores WHERE acesso_status = 'na_fila' AND acesso_template_id = {:tid} ORDER BY created LIMIT 1000"
      $app
        .db()
        .newQuery(
          "UPDATE compradores SET acesso_status = 'enviando', acesso_claim = {:claim} WHERE id IN (" +
            sub +
            ')',
        )
        .bind({ claim: claim, tid: templateId })
        .execute()
    }
  } catch (_) {
    return
  }

  let batch
  try {
    batch = $app.findRecordsByFilter('compradores', 'acesso_claim = {:claim}', 'created', 1000, 0, {
      claim: claim,
    })
  } catch (_) {
    return
  }
  if (!batch || batch.length === 0) return

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
    return
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
    return
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
  }

  atualizaDisparo(disparoId)
})
