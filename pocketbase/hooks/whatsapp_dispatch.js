// ============================================================================
// DISPARO WHATSAPP via BotConversa — 100% backend, isolado do e-mail (campos wa_*).
// ----------------------------------------------------------------------------
// O BotConversa NÃO tem batch: é 1 webhook por pessoa. Mandamos, por comprador:
//   { full_name, email, token }   (token = acesso de 60d, mesmo modelo do e-mail)
// para a URL de automação do BotConversa (catch webhook).
//
// Fila: campos wa_* na coleção compradores. enqueue = UPDATE em massa; cron drena
// 1 a 1 com retry/erro. Histórico/contadores em disparos_wa.
// Por enquanto só COMPRADORES (clusters todos/pendentes). Participantes depois.
// REGRA JSVM: helpers declarados DENTRO de cada callback.
// ============================================================================

// --- Preview (contagem do público) ------------------------------------------
routerAdd(
  'POST',
  '/backend/v1/admin/whatsapp/preview',
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

// --- Enqueue ----------------------------------------------------------------
routerAdd(
  'POST',
  '/backend/v1/admin/whatsapp/enqueue',
  (e) => {
    try {
      const body = e.requestInfo().body || {}
      const cluster = body.cluster || 'todos'
      const nomeCampanha = (body.nome || '').toString().trim()

      let where = "email != ''"
      if (cluster === 'pendentes') {
        where =
          "email != '' AND id IN (SELECT comprador_id FROM ingressos WHERE status = 'Pendente')"
      }
      where += " AND (wa_status IS NULL OR wa_status != 'enviando')"

      const coll = $app.findCollectionByNameOrId('disparos_wa')
      const disparo = new Record(coll)
      disparo.set('nome', nomeCampanha)
      disparo.set('cluster', cluster)
      disparo.set('total', 0)
      disparo.set('enviados', 0)
      disparo.set('erros', 0)
      disparo.set('status', 'em_andamento')
      $app.save(disparo)
      const disparoId = disparo.id

      $app
        .db()
        .newQuery(
          "UPDATE compradores SET wa_status = 'na_fila', wa_disparo_id = {:did}, " +
            "wa_tentativas = 0, wa_erro = '', wa_claim = '' WHERE " +
            where,
        )
        .bind({ did: disparoId })
        .execute()

      const row = new DynamicModel({ c: 0 })
      $app
        .db()
        .newQuery('SELECT COUNT(*) as c FROM compradores WHERE wa_disparo_id = {:did}')
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

// --- Retry por campanha -----------------------------------------------------
routerAdd(
  'POST',
  '/backend/v1/admin/whatsapp/{disparoId}/retry',
  (e) => {
    try {
      const disparoId = e.request.pathValue('disparoId')
      if (!disparoId) return e.badRequestError('disparoId é obrigatório')

      $app
        .db()
        .newQuery(
          "UPDATE compradores SET wa_status = 'na_fila', wa_tentativas = 0, wa_erro = '', " +
            "wa_claim = '' WHERE wa_disparo_id = {:did} AND wa_status = 'erro'",
        )
        .bind({ did: disparoId })
        .execute()

      const row = new DynamicModel({ c: 0 })
      $app
        .db()
        .newQuery(
          "SELECT COUNT(*) as c FROM compradores WHERE wa_disparo_id = {:did} AND wa_status = 'na_fila'",
        )
        .bind({ did: disparoId })
        .one(row)

      try {
        const d = $app.findRecordById('disparos_wa', disparoId)
        if (row.c > 0) {
          d.set('status', 'em_andamento')
          $app.save(d)
        }
      } catch (_) {}

      return e.json(200, { requeued: row.c })
    } catch (err) {
      return e.badRequestError(err.message)
    }
  },
  $apis.requireAuth(),
)

// --- CRON: drena a fila do WhatsApp, 1 POST por pessoa ----------------------
cronAdd('whatsapp_dispatch', '* * * * *', () => {
  // URL de automação do BotConversa para COMPRADORES (catch webhook).
  const BC_URL_COMPRADOR =
    'https://new-backend.botconversa.com.br/api/v1/webhooks-automation/catch/192716/WquemD9Wrf0h/'

  const atualizaDisparo = (did) => {
    if (!did) return
    try {
      const q = (st) => {
        const r = new DynamicModel({ c: 0 })
        $app
          .db()
          .newQuery(
            'SELECT COUNT(*) as c FROM compradores WHERE wa_disparo_id = {:did} AND wa_status = {:st}',
          )
          .bind({ did: did, st: st })
          .one(r)
        return r.c
      }
      const enviados = q('enviado')
      const erros = q('erro')
      const rest1 = q('na_fila')
      const rest2 = q('enviando')
      const d = $app.findRecordById('disparos_wa', did)
      d.set('enviados', enviados)
      d.set('erros', erros)
      d.set('status', rest1 + rest2 > 0 ? 'em_andamento' : 'concluido')
      $app.save(d)
    } catch (_) {}
  }

  const processOneBatch = (deadline) => {
    let first
    try {
      first = $app.findFirstRecordByFilter('compradores', 'wa_status = {:s}', { s: 'na_fila' })
    } catch (_) {
      return 'empty'
    }
    const disparoId = first.getString('wa_disparo_id')
    const claim = $security.randomString(20)
    try {
      const sub = disparoId
        ? "SELECT id FROM compradores WHERE wa_status = 'na_fila' AND wa_disparo_id = {:k} ORDER BY created LIMIT 60"
        : "SELECT id FROM compradores WHERE wa_status = 'na_fila' ORDER BY created LIMIT 60"
      $app
        .db()
        .newQuery(
          "UPDATE compradores SET wa_status = 'enviando', wa_claim = {:claim} WHERE id IN (" +
            sub +
            ')',
        )
        .bind({ claim: claim, k: disparoId || '' })
        .execute()
    } catch (_) {
      return 'done'
    }

    let batch
    try {
      batch = $app.findRecordsByFilter('compradores', 'wa_claim = {:claim}', 'created', 60, 0, {
        claim: claim,
      })
    } catch (_) {
      return 'done'
    }
    if (!batch || batch.length === 0) return 'done'

    const tokenColl = $app.findCollectionByNameOrId('tokens_acesso')
    const exp = new Date()
    exp.setDate(exp.getDate() + 60)
    const expIso = exp.toISOString()
    let anyRetry = false

    for (let i = 0; i < batch.length; i++) {
      // Respeita a janela do cron: devolve os restantes pra fila e sai.
      if (Date.now() > deadline) {
        for (let j = i; j < batch.length; j++) {
          const cc = batch[j]
          cc.set('wa_status', 'na_fila')
          cc.set('wa_claim', '')
          try {
            $app.save(cc)
          } catch (_) {}
        }
        atualizaDisparo(disparoId)
        return 'timeout'
      }

      const c = batch[i]
      const email = c.getString('email')
      const nome = c.getString('nome') || ''
      if (!email) {
        c.set('wa_status', 'erro')
        c.set('wa_erro', 'Sem email')
        c.set('wa_claim', '')
        try {
          $app.save(c)
        } catch (_) {}
        continue
      }

      // Token de acesso (60 dias).
      let token = ''
      try {
        token = $security.randomString(40)
        const tr = new Record(tokenColl)
        tr.set('comprador_id', c.id)
        tr.set('token', token)
        tr.set('usado', false)
        tr.set('expira_em', expIso)
        $app.save(tr)
      } catch (_) {
        token = ''
      }

      // Telefone no padrão WhatsApp: só dígitos, com 55 quando vier sem DDI.
      let fone = (c.getString('telefone') || '').replace(/\D/g, '')
      if (fone && fone.length <= 11) fone = '55' + fone

      let status = 0
      let erroMsg = ''
      try {
        const res = $http.send({
          url: BC_URL_COMPRADOR,
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ full_name: nome, email: email, phone: fone, token: token }),
          timeout: 12,
        })
        status = res.statusCode
      } catch (err) {
        erroMsg = err.message
      }

      const ok = status >= 200 && status < 300
      const retryable = !ok && (status === 429 || status >= 500 || status === 0)
      const nowStr = new Date().toISOString()
      if (ok) {
        c.set('wa_status', 'enviado')
        c.set('wa_enviado_em', nowStr)
        c.set('wa_erro', '')
        c.set('wa_claim', '')
        try {
          $app.save(c)
        } catch (_) {}
      } else {
        const tent = (parseInt(c.get('wa_tentativas'), 10) || 0) + 1
        c.set('wa_tentativas', tent)
        c.set('wa_erro', ('HTTP ' + status + ' ' + (erroMsg || '')).substring(0, 300))
        if (retryable && tent < 5) {
          c.set('wa_status', 'na_fila')
          anyRetry = true
        } else {
          c.set('wa_status', 'erro')
        }
        c.set('wa_claim', '')
        try {
          $app.save(c)
        } catch (_) {}
      }
    }

    atualizaDisparo(disparoId)
    return anyRetry ? 'retry' : 'done'
  }

  // Recupera presos em 'enviando' há mais de 10min.
  try {
    const cut = new Date(Date.now() - 10 * 60 * 1000).toISOString().replace('T', ' ')
    $app
      .db()
      .newQuery(
        "UPDATE compradores SET wa_status = 'na_fila', wa_claim = '' WHERE wa_status = 'enviando' AND updated < {:cut}",
      )
      .bind({ cut: cut })
      .execute()
  } catch (_) {}

  const startMs = Date.now()
  const deadline = startMs + 45000
  while (Date.now() - startMs < 48000) {
    const r = processOneBatch(deadline)
    if (r === 'empty') break
    if (r === 'retry') break
    if (r === 'timeout') break
  }
})
