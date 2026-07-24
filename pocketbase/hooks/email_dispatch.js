// ============================================================================
// DISPARO DE ACESSO/COMUNICAÇÃO VIA SENDGRID — 100% BACKEND
// ----------------------------------------------------------------------------
// Audiências (clusters):
//   compradores:   'todos' | 'pendentes'            -> coleção compradores
//   participantes: 'participantes_todos' |
//                  'participantes_recentes' (X dias) -> coleção participantes
//
// A fila vive como campos na coleção do destinatário (acesso_*): enqueue = UPDATE
// em massa (instantâneo), claim atômico, cron drena as DUAS coleções.
// processOneBatch é parametrizado por (coleção, campo de nome, tokenMode).
//
// {{firstname}} = primeiro nome do destinatário (nome/nome_completo).
// {{token}}:
//   comprador    -> token de acesso novo (tokens_acesso, 60d) — login na plataforma.
//   participante -> token do INGRESSO dele (links_participante; acha o existente
//                   ou cria um de 60d).
//
// AUDITORIA: cada envio vira linha imutável em `envios`.
// RETRY: 2xx=enviado; 429/5xx/rede=reenfileira (até 5x, backoff de 1 tick);
//        demais 4xx=erro na hora.
// REGRA JSVM: helpers declarados DENTRO de cada callback.
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

// --- Preview HTML de um template (pro ícone de olho no dropdown) ------------
routerAdd(
  'GET',
  '/backend/v1/admin/sendgrid/templates/{id}/preview',
  (e) => {
    const templateId = e.request.pathValue('id')
    if (!templateId) return e.badRequestError('id é obrigatório')

    const apiKey = $os.getenv('SENDGRID_API_KEY')
    if (!apiKey) return e.json(200, { html: '', error: 'SENDGRID_API_KEY não configurada' })

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
        url: 'https://api.sendgrid.com/v3/templates/' + templateId,
        method: 'GET',
        headers: { Authorization: 'Bearer ' + apiKey },
        timeout: 20,
      })
      const txt = decodeBody(res.body)
      if (res.statusCode < 200 || res.statusCode >= 300) {
        return e.json(200, { html: '', error: 'SendGrid HTTP ' + res.statusCode })
      }
      let parsed = {}
      try {
        parsed = JSON.parse(txt)
      } catch (_) {}
      const versions = parsed.versions || []
      let version = versions.find((v) => v && (v.active === 1 || v.active === true))
      if (!version) version = versions[0]
      if (!version) return e.json(200, { html: '', error: 'Template sem versão ativa' })

      return e.json(200, {
        html: version.html_content || '',
        subject: version.subject || '',
        name: parsed.name || templateId,
      })
    } catch (err) {
      return e.json(200, { html: '', error: err.message })
    }
  },
  $apis.requireAuth(),
)

// --- HEARTBEAT + HEALTH -----------------------------------------------------
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

// --- Preview ----------------------------------------------------------------
routerAdd(
  'POST',
  '/backend/v1/admin/dispatch/preview',
  (e) => {
    try {
      const body = e.requestInfo().body || {}
      const cluster = body.cluster
      const dias = parseInt(body.dias, 10) || 7

      let sql
      if (cluster === 'pendentes') {
        sql =
          "SELECT COUNT(*) as c FROM compradores WHERE email != '' AND id IN (SELECT comprador_id FROM ingressos WHERE status = 'Pendente')"
      } else if (cluster === 'participantes_todos') {
        sql = "SELECT COUNT(*) as c FROM participantes WHERE email != ''"
      } else if (cluster === 'participantes_recentes') {
        const cut = new Date(Date.now() - dias * 86400000).toISOString().replace('T', ' ')
        const row = new DynamicModel({ c: 0 })
        $app
          .db()
          .newQuery(
            "SELECT COUNT(*) as c FROM participantes WHERE email != '' AND created >= {:cut}",
          )
          .bind({ cut: cut })
          .one(row)
        return e.json(200, { count: row.c })
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

// --- Busca destinatário (para disparo individual) ---------------------------
routerAdd(
  'POST',
  '/backend/v1/admin/dispatch/search-recipient',
  (e) => {
    try {
      const body = e.requestInfo().body || {}
      const q = (body.q || '').toString().trim()
      const audience = body.audience === 'participantes' ? 'participantes' : 'compradores'
      const nameField = audience === 'participantes' ? 'nome_completo' : 'nome'
      if (!q) return e.json(200, { results: [] })
      let recs = []
      try {
        recs = $app.findRecordsByFilter(
          audience,
          nameField + ' ~ {:q} || email ~ {:q}',
          nameField,
          10,
          0,
          { q: q },
        )
      } catch (_) {}
      const results = []
      for (const r of recs) {
        results.push({ id: r.id, nome: r.getString(nameField), email: r.getString('email') })
      }
      return e.json(200, { results: results })
    } catch (err) {
      return e.badRequestError(err.message)
    }
  },
  $apis.requireAuth(),
)

// --- Enqueue ----------------------------------------------------------------
routerAdd(
  'POST',
  '/backend/v1/admin/dispatch/enqueue',
  (e) => {
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
    const atualizaDisparo = (did, collName) => {
      if (!did) return
      try {
        const q = (st) => {
          const r = new DynamicModel({ c: 0 })
          $app
            .db()
            .newQuery(
              'SELECT COUNT(*) as c FROM ' +
                collName +
                ' WHERE acesso_disparo_id = {:did} AND acesso_status = {:st}',
            )
            .bind({ did: did, st: st })
            .one(r)
          return r.c
        }
        const enviados = q('enviado')
        const erros = q('erro')
        const rest1 = q('na_fila')
        const rest2 = q('enviando')
        const disparo = $app.findRecordById('disparos', did)
        disparo.set('enviados', enviados)
        disparo.set('erros', erros)
        disparo.set('status', rest1 + rest2 > 0 ? 'em_andamento' : 'concluido')
        $app.save(disparo)
      } catch (_) {}
    }
    const processOneBatch = (collName, nameField, tokenMode) => {
      const apiKey = $os.getenv('SENDGRID_API_KEY')
      if (!apiKey) return 'empty'
      let first
      try {
        first = $app.findFirstRecordByFilter(collName, 'acesso_status = {:s}', { s: 'na_fila' })
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
        atualizaDisparo(disparoId, collName)
        return 'done'
      }
      const claim = $security.randomString(20)
      try {
        const sub = disparoId
          ? 'SELECT id FROM ' +
            collName +
            " WHERE acesso_status = 'na_fila' AND acesso_disparo_id = {:k} ORDER BY created LIMIT 1000"
          : 'SELECT id FROM ' +
            collName +
            " WHERE acesso_status = 'na_fila' AND acesso_template_id = {:k} ORDER BY created LIMIT 1000"
        $app
          .db()
          .newQuery(
            'UPDATE ' +
              collName +
              " SET acesso_status = 'enviando', acesso_claim = {:claim} WHERE id IN (" +
              sub +
              ')',
          )
          .bind({ claim: claim, k: disparoId || templateId })
          .execute()
      } catch (_) {
        return 'done'
      }
      let batch
      try {
        batch = $app.findRecordsByFilter(collName, 'acesso_claim = {:claim}', 'created', 1000, 0, {
          claim: claim,
        })
      } catch (_) {
        return 'done'
      }
      if (!batch || batch.length === 0) return 'done'

      const registraEnvios = (st, quando) => {
        try {
          const enviosColl = $app.findCollectionByNameOrId('envios')
          $app.runInTransaction((txApp) => {
            for (const c of batch) {
              const em = c.getString('email')
              if (!em) continue
              const ev = new Record(enviosColl)
              ev.set('disparo_id', disparoId)
              ev.set('comprador_id', c.id)
              ev.set('nome', c.getString(nameField) || '')
              ev.set('email', em)
              ev.set('status', st)
              ev.set('enviado_em', quando)
              txApp.save(ev)
            }
          })
        } catch (_) {}
      }

      const personalizations = []
      const exp = new Date()
      exp.setDate(exp.getDate() + 60)
      const expIso = exp.toISOString()
      try {
        $app.runInTransaction((txApp) => {
          const tokenColl =
            tokenMode === 'comprador' ? txApp.findCollectionByNameOrId('tokens_acesso') : null
          const linkColl =
            tokenMode === 'participante'
              ? txApp.findCollectionByNameOrId('links_participante')
              : null
          for (const c of batch) {
            const email = c.getString('email')
            if (!email) continue
            const nome = c.getString(nameField) || ''
            const dtd = { firstname: (nome.split(' ')[0] || nome || '').trim() }
            if (tokenMode === 'comprador') {
              const token = $security.randomString(40)
              const tr = new Record(tokenColl)
              tr.set('comprador_id', c.id)
              tr.set('token', token)
              tr.set('usado', false)
              tr.set('expira_em', expIso)
              txApp.save(tr)
              dtd.token = token
            } else if (tokenMode === 'participante') {
              // {{token}} = token do ingresso do participante (links_participante).
              const ingressoId = c.getString('ingresso_id')
              let token = ''
              if (ingressoId) {
                try {
                  const link = $app.findFirstRecordByFilter(
                    'links_participante',
                    'ingresso_id = {:iid}',
                    { iid: ingressoId },
                  )
                  token = link.getString('token')
                } catch (_) {
                  token = $security.randomString(40)
                  const lr = new Record(linkColl)
                  lr.set('ingresso_id', ingressoId)
                  lr.set('token', token)
                  lr.set('usado', false)
                  lr.set('expira_em', expIso)
                  txApp.save(lr)
                }
              }
              dtd.token = token
            }
            personalizations.push({
              to: [{ email: email, name: nome }],
              dynamic_template_data: dtd,
            })
          }
        })
      } catch (_) {
        try {
          $app
            .db()
            .newQuery(
              'UPDATE ' +
                collName +
                " SET acesso_status = 'na_fila', acesso_claim = '' WHERE acesso_claim = {:claim}",
            )
            .bind({ claim: claim })
            .execute()
        } catch (_) {}
        return 'done'
      }
      if (personalizations.length === 0) {
        try {
          $app
            .db()
            .newQuery(
              'UPDATE ' +
                collName +
                " SET acesso_status = 'erro', acesso_erro = 'Sem email', acesso_claim = '' WHERE acesso_claim = {:claim}",
            )
            .bind({ claim: claim })
            .execute()
        } catch (_) {}
        atualizaDisparo(disparoId, collName)
        return 'done'
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
      const nowStr = new Date().toISOString()
      if (ok) {
        try {
          $app
            .db()
            .newQuery(
              'UPDATE ' +
                collName +
                " SET acesso_status = 'enviado', acesso_enviado_em = {:now}, acesso_erro = '', acesso_claim = '' WHERE acesso_claim = {:claim}",
            )
            .bind({ now: nowStr, claim: claim })
            .execute()
        } catch (_) {}
        registraEnvios('enviado', nowStr)
      } else if (retryable) {
        const errTxt = ('HTTP ' + status + ' ' + (respBody || erroMsg || '')).substring(0, 300)
        try {
          $app
            .db()
            .newQuery(
              'UPDATE ' +
                collName +
                ' SET acesso_tentativas = acesso_tentativas + 1, acesso_erro = {:err}, ' +
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
              'UPDATE ' +
                collName +
                " SET acesso_tentativas = acesso_tentativas + 1, acesso_erro = {:err}, acesso_status = 'erro', acesso_claim = '' WHERE acesso_claim = {:claim}",
            )
            .bind({ err: errTxt, claim: claim })
            .execute()
        } catch (_) {}
        registraEnvios('erro', nowStr)
      }
      atualizaDisparo(disparoId, collName)
      return retryable ? 'retry' : 'done'
    }

    try {
      const body = e.requestInfo().body || {}
      const cluster = body.cluster || 'todos'
      const templateId = (body.template_id || '').toString().trim()
      const templateNome = (body.template_nome || '').toString().trim()
      const nomeCampanha = (body.nome || '').toString().trim()
      const dias = parseInt(body.dias, 10) || 7

      if (!templateId) return e.badRequestError('Selecione um template')
      if (templateId.indexOf('d-') !== 0) {
        return e.badRequestError('template_id inválido (deve começar com d-)')
      }

      let coll = 'compradores'
      let audience = 'compradores'
      let where = "email != ''"
      if (cluster === 'pendentes') {
        where =
          "email != '' AND id IN (SELECT comprador_id FROM ingressos WHERE status = 'Pendente')"
      } else if (cluster === 'participantes_todos') {
        coll = 'participantes'
        audience = 'participantes'
        where = "email != ''"
      } else if (cluster === 'participantes_recentes') {
        coll = 'participantes'
        audience = 'participantes'
        const cut = new Date(Date.now() - dias * 86400000).toISOString().replace('T', ' ')
        where = "email != '' AND created >= '" + cut + "'"
      } else if (cluster === 'individual') {
        // Mira um único destinatário pelo id (comprador ou participante).
        const rid = (body.recipient_id || '').toString().replace(/[^a-zA-Z0-9]/g, '')
        if (!rid) return e.badRequestError('recipient_id é obrigatório')
        if (body.audience === 'participantes') {
          coll = 'participantes'
          audience = 'participantes'
        }
        where = "id = '" + rid + "' AND email != ''"
      }
      where += " AND (acesso_status IS NULL OR acesso_status != 'enviando')"

      const disparosColl = $app.findCollectionByNameOrId('disparos')
      const disparo = new Record(disparosColl)
      disparo.set('nome', nomeCampanha)
      disparo.set('template_id', templateId)
      disparo.set('template_nome', templateNome || templateId)
      disparo.set('cluster', cluster)
      disparo.set('audience', audience)
      disparo.set('total', 0)
      disparo.set('enviados', 0)
      disparo.set('erros', 0)
      disparo.set('status', 'em_andamento')
      $app.save(disparo)
      const disparoId = disparo.id

      $app
        .db()
        .newQuery(
          'UPDATE ' +
            coll +
            " SET acesso_status = 'na_fila', acesso_template_id = {:tid}, " +
            "acesso_disparo_id = {:did}, acesso_tentativas = 0, acesso_erro = '', acesso_claim = '' WHERE " +
            where,
        )
        .bind({ tid: templateId, did: disparoId })
        .execute()

      const row = new DynamicModel({ c: 0 })
      $app
        .db()
        .newQuery('SELECT COUNT(*) as c FROM ' + coll + ' WHERE acesso_disparo_id = {:did}')
        .bind({ did: disparoId })
        .one(row)

      disparo.set('total', row.c)
      if (row.c === 0) disparo.set('status', 'concluido')
      $app.save(disparo)

      if (row.c > 0) {
        try {
          if (audience === 'participantes')
            processOneBatch('participantes', 'nome_completo', 'participante')
          else processOneBatch('compradores', 'nome', 'comprador')
        } catch (_) {}
      }

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
  '/backend/v1/admin/dispatch/{disparoId}/retry',
  (e) => {
    try {
      const disparoId = e.request.pathValue('disparoId')
      if (!disparoId) return e.badRequestError('disparoId é obrigatório')

      let coll = 'compradores'
      try {
        const d = $app.findRecordById('disparos', disparoId)
        if (d.getString('audience') === 'participantes') coll = 'participantes'
      } catch (_) {}

      $app
        .db()
        .newQuery(
          'UPDATE ' +
            coll +
            " SET acesso_status = 'na_fila', acesso_tentativas = 0, acesso_erro = '', acesso_claim = '' " +
            "WHERE acesso_disparo_id = {:did} AND acesso_status = 'erro'",
        )
        .bind({ did: disparoId })
        .execute()

      const row = new DynamicModel({ c: 0 })
      $app
        .db()
        .newQuery(
          'SELECT COUNT(*) as c FROM ' +
            coll +
            " WHERE acesso_disparo_id = {:did} AND acesso_status = 'na_fila'",
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

// --- CRON: drena compradores e participantes em loop ------------------------
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
  const atualizaDisparo = (did, collName) => {
    if (!did) return
    try {
      const q = (st) => {
        const r = new DynamicModel({ c: 0 })
        $app
          .db()
          .newQuery(
            'SELECT COUNT(*) as c FROM ' +
              collName +
              ' WHERE acesso_disparo_id = {:did} AND acesso_status = {:st}',
          )
          .bind({ did: did, st: st })
          .one(r)
        return r.c
      }
      const enviados = q('enviado')
      const erros = q('erro')
      const rest1 = q('na_fila')
      const rest2 = q('enviando')
      const disparo = $app.findRecordById('disparos', did)
      disparo.set('enviados', enviados)
      disparo.set('erros', erros)
      disparo.set('status', rest1 + rest2 > 0 ? 'em_andamento' : 'concluido')
      $app.save(disparo)
    } catch (_) {}
  }
  const processOneBatch = (collName, nameField, tokenMode) => {
    let first
    try {
      first = $app.findFirstRecordByFilter(collName, 'acesso_status = {:s}', { s: 'na_fila' })
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
      atualizaDisparo(disparoId, collName)
      return 'done'
    }
    const claim = $security.randomString(20)
    try {
      const sub = disparoId
        ? 'SELECT id FROM ' +
          collName +
          " WHERE acesso_status = 'na_fila' AND acesso_disparo_id = {:k} ORDER BY created LIMIT 1000"
        : 'SELECT id FROM ' +
          collName +
          " WHERE acesso_status = 'na_fila' AND acesso_template_id = {:k} ORDER BY created LIMIT 1000"
      $app
        .db()
        .newQuery(
          'UPDATE ' +
            collName +
            " SET acesso_status = 'enviando', acesso_claim = {:claim} WHERE id IN (" +
            sub +
            ')',
        )
        .bind({ claim: claim, k: disparoId || templateId })
        .execute()
    } catch (_) {
      return 'done'
    }
    let batch
    try {
      batch = $app.findRecordsByFilter(collName, 'acesso_claim = {:claim}', 'created', 1000, 0, {
        claim: claim,
      })
    } catch (_) {
      return 'done'
    }
    if (!batch || batch.length === 0) return 'done'

    const registraEnvios = (st, quando) => {
      try {
        const enviosColl = $app.findCollectionByNameOrId('envios')
        $app.runInTransaction((txApp) => {
          for (const c of batch) {
            const em = c.getString('email')
            if (!em) continue
            const ev = new Record(enviosColl)
            ev.set('disparo_id', disparoId)
            ev.set('comprador_id', c.id)
            ev.set('nome', c.getString(nameField) || '')
            ev.set('email', em)
            ev.set('status', st)
            ev.set('enviado_em', quando)
            txApp.save(ev)
          }
        })
      } catch (_) {}
    }

    const personalizations = []
    const exp = new Date()
    exp.setDate(exp.getDate() + 60)
    const expIso = exp.toISOString()
    try {
      $app.runInTransaction((txApp) => {
        const tokenColl =
          tokenMode === 'comprador' ? txApp.findCollectionByNameOrId('tokens_acesso') : null
        const linkColl =
          tokenMode === 'participante' ? txApp.findCollectionByNameOrId('links_participante') : null
        for (const c of batch) {
          const email = c.getString('email')
          if (!email) continue
          const nome = c.getString(nameField) || ''
          const dtd = { firstname: (nome.split(' ')[0] || nome || '').trim() }
          if (tokenMode === 'comprador') {
            const token = $security.randomString(40)
            const tr = new Record(tokenColl)
            tr.set('comprador_id', c.id)
            tr.set('token', token)
            tr.set('usado', false)
            tr.set('expira_em', expIso)
            txApp.save(tr)
            dtd.token = token
          } else if (tokenMode === 'participante') {
            const ingressoId = c.getString('ingresso_id')
            let token = ''
            if (ingressoId) {
              try {
                const link = $app.findFirstRecordByFilter(
                  'links_participante',
                  'ingresso_id = {:iid}',
                  { iid: ingressoId },
                )
                token = link.getString('token')
              } catch (_) {
                token = $security.randomString(40)
                const lr = new Record(linkColl)
                lr.set('ingresso_id', ingressoId)
                lr.set('token', token)
                lr.set('usado', false)
                lr.set('expira_em', expIso)
                txApp.save(lr)
              }
            }
            dtd.token = token
          }
          personalizations.push({ to: [{ email: email, name: nome }], dynamic_template_data: dtd })
        }
      })
    } catch (_) {
      try {
        $app
          .db()
          .newQuery(
            'UPDATE ' +
              collName +
              " SET acesso_status = 'na_fila', acesso_claim = '' WHERE acesso_claim = {:claim}",
          )
          .bind({ claim: claim })
          .execute()
      } catch (_) {}
      return 'done'
    }
    if (personalizations.length === 0) {
      try {
        $app
          .db()
          .newQuery(
            'UPDATE ' +
              collName +
              " SET acesso_status = 'erro', acesso_erro = 'Sem email', acesso_claim = '' WHERE acesso_claim = {:claim}",
          )
          .bind({ claim: claim })
          .execute()
      } catch (_) {}
      atualizaDisparo(disparoId, collName)
      return 'done'
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
    const nowStr = new Date().toISOString()
    if (ok) {
      try {
        $app
          .db()
          .newQuery(
            'UPDATE ' +
              collName +
              " SET acesso_status = 'enviado', acesso_enviado_em = {:now}, acesso_erro = '', acesso_claim = '' WHERE acesso_claim = {:claim}",
          )
          .bind({ now: nowStr, claim: claim })
          .execute()
      } catch (_) {}
      registraEnvios('enviado', nowStr)
    } else if (retryable) {
      const errTxt = ('HTTP ' + status + ' ' + (respBody || erroMsg || '')).substring(0, 300)
      try {
        $app
          .db()
          .newQuery(
            'UPDATE ' +
              collName +
              ' SET acesso_tentativas = acesso_tentativas + 1, acesso_erro = {:err}, ' +
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
            'UPDATE ' +
              collName +
              " SET acesso_tentativas = acesso_tentativas + 1, acesso_erro = {:err}, acesso_status = 'erro', acesso_claim = '' WHERE acesso_claim = {:claim}",
          )
          .bind({ err: errTxt, claim: claim })
          .execute()
      } catch (_) {}
      registraEnvios('erro', nowStr)
    }
    atualizaDisparo(disparoId, collName)
    return retryable ? 'retry' : 'done'
  }

  // Recupera presos em 'enviando' há mais de 10min, nas duas coleções.
  try {
    const cut = new Date(Date.now() - 10 * 60 * 1000).toISOString().replace('T', ' ')
    ;['compradores', 'participantes'].forEach((coll) => {
      try {
        $app
          .db()
          .newQuery(
            'UPDATE ' +
              coll +
              " SET acesso_status = 'na_fila', acesso_claim = '' WHERE acesso_status = 'enviando' AND updated < {:cut}",
          )
          .bind({ cut: cut })
          .execute()
      } catch (_) {}
    })
  } catch (_) {}

  const drainStep = () => {
    const r = processOneBatch('compradores', 'nome', 'comprador')
    if (r !== 'empty') return r
    return processOneBatch('participantes', 'nome_completo', 'participante')
  }

  const startMs = Date.now()
  while (Date.now() - startMs < 50000) {
    const r = drainStep()
    if (r === 'empty') break
    if (r === 'retry') break
  }
})
