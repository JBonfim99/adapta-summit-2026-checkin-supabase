// ============================================================================
// DISPARO WHATSAPP via BotConversa — 100% backend, isolado do e-mail (campos wa_*).
// ----------------------------------------------------------------------------
// DOIS MODOS (definidos por disparos_wa.flow):
//
//  (A) flow vazio = PRÉ-CREDENCIAMENTO (padrão). 1 POST por pessoa pro catch
//      webhook de automação, payload { full_name, email, phone, token }.
//
//  (B) flow = id de um fluxo BotConversa. Por contato:
//        1) acha/cria o subscriber por telefone (has_opt_in_whatsapp obrigatório);
//        2) seta os custom fields conforme o mapeamento (disparos_wa.mapping);
//        3) envia o fluxo (send_flow).
//      Usa a API REST: https://backend.botconversa.com.br/api/v1/webhook
//      Auth: header API-KEY = env BOTCONVERSA_API_KEY.
//
// Fila: campos wa_* na coleção compradores. enqueue = UPDATE em massa; cron drena
// 1 a 1 com retry/erro. Histórico/contadores + flow/mapping em disparos_wa.
// REGRA JSVM: helpers declarados DENTRO de cada callback.
// ============================================================================

// --- Lista de fluxos do BotConversa (pra dropdown) --------------------------
routerAdd(
  'GET',
  '/backend/v1/admin/whatsapp/flows',
  (e) => {
    const key = $os.getenv('BOTCONVERSA_API_KEY') || ''
    if (!key)
      return e.json(200, { ok: false, error: 'BOTCONVERSA_API_KEY não configurada', flows: [] })
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
    try {
      const res = $http.send({
        url: 'https://backend.botconversa.com.br/api/v1/webhook/flows/',
        method: 'GET',
        headers: { 'API-KEY': key, 'Content-Type': 'application/json' },
        timeout: 15,
      })
      if (res.statusCode === 200) {
        const arr = JSON.parse(decodeBody(res.body)) || []
        // Remove o fluxo de pré-credenciamento (já é a opção padrão do dropdown).
        const filtered = []
        for (let i = 0; i < arr.length; i++) {
          const nm = (arr[i] && arr[i].name ? String(arr[i].name) : '').toLowerCase().trim()
          if (nm === 'summit_precred') continue
          filtered.push(arr[i])
        }
        return e.json(200, { ok: true, flows: filtered })
      }
      return e.json(200, { ok: false, error: 'HTTP ' + res.statusCode, flows: [] })
    } catch (err) {
      return e.json(200, { ok: false, error: err && err.message ? err.message : 'erro', flows: [] })
    }
  },
  $apis.requireAuth(),
)

// --- Lista de custom fields (variáveis) do BotConversa ----------------------
routerAdd(
  'GET',
  '/backend/v1/admin/whatsapp/custom-fields',
  (e) => {
    const key = $os.getenv('BOTCONVERSA_API_KEY') || ''
    if (!key)
      return e.json(200, { ok: false, error: 'BOTCONVERSA_API_KEY não configurada', fields: [] })
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
    try {
      const res = $http.send({
        url: 'https://backend.botconversa.com.br/api/v1/webhook/custom_fields/',
        method: 'GET',
        headers: { 'API-KEY': key, 'Content-Type': 'application/json' },
        timeout: 15,
      })
      if (res.statusCode === 200) {
        const arr = JSON.parse(decodeBody(res.body))
        return e.json(200, { ok: true, fields: arr })
      }
      return e.json(200, { ok: false, error: 'HTTP ' + res.statusCode, fields: [] })
    } catch (err) {
      return e.json(200, {
        ok: false,
        error: err && err.message ? err.message : 'erro',
        fields: [],
      })
    }
  },
  $apis.requireAuth(),
)

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

      // Fluxo: '' ou 'PRE' = pré-credenciamento (catch). Senão, id do fluxo.
      let flow = (body.flow == null ? '' : body.flow).toString().trim()
      if (flow === 'PRE') flow = ''
      const flowNome = (body.flow_nome || '').toString().trim()

      // Mapeamento de variáveis (só faz sentido com flow != '').
      let mapping = []
      if (flow && Array.isArray(body.mapping)) {
        for (let i = 0; i < body.mapping.length; i++) {
          const m = body.mapping[i] || {}
          const fid = (m.field_id == null ? '' : m.field_id).toString().trim()
          const src = (m.source || '').toString().trim()
          if (!fid || !src) continue
          mapping.push({ field_id: fid, source: src, value: (m.value || '').toString() })
        }
      }

      let where = "email != ''"
      if (cluster === 'pendentes') {
        where =
          "email != '' AND id IN (SELECT comprador_id FROM ingressos WHERE status = 'Pendente')"
      } else if (cluster === 'individual') {
        const rid = (body.recipient_id || '').toString().replace(/[^a-zA-Z0-9]/g, '')
        if (!rid) return e.badRequestError('recipient_id é obrigatório')
        where = "id = '" + rid + "' AND email != ''"
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
      disparo.set('flow', flow)
      disparo.set('flow_nome', flowNome)
      disparo.set('mapping', mapping.length ? JSON.stringify(mapping) : '')
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

// --- Envio INDIVIDUAL IMEDIATO (sem fila): catch padrão OU fluxo via API -----
routerAdd(
  'POST',
  '/backend/v1/admin/whatsapp/send-individual',
  (e) => {
    const BC_URL_COMPRADOR =
      'https://new-backend.botconversa.com.br/api/v1/webhooks-automation/catch/192716/WquemD9Wrf0h/'
    const BC_API = 'https://backend.botconversa.com.br/api/v1/webhook'
    const BC_KEY = $os.getenv('BOTCONVERSA_API_KEY') || ''
    const ACESSO_BASE = 'https://summit2026.goskip.app/acesso?token='

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
    const bcGet = (url) => {
      try {
        const r = $http.send({
          url: url,
          method: 'GET',
          headers: { 'API-KEY': BC_KEY, 'Content-Type': 'application/json' },
          timeout: 12,
        })
        return { status: r.statusCode, body: decodeBody(r.body) }
      } catch (err) {
        return { status: 0, body: '', err: err && err.message ? err.message : 'erro' }
      }
    }
    const bcPost = (url, obj) => {
      try {
        const r = $http.send({
          url: url,
          method: 'POST',
          headers: { 'API-KEY': BC_KEY, 'Content-Type': 'application/json' },
          body: JSON.stringify(obj),
          timeout: 12,
        })
        return { status: r.statusCode, body: decodeBody(r.body) }
      } catch (err) {
        return { status: 0, body: '', err: err && err.message ? err.message : 'erro' }
      }
    }

    try {
      const body = e.requestInfo().body || {}
      const rid = (body.recipient_id || '').toString().replace(/[^a-zA-Z0-9]/g, '')
      const nomeCampanha = (body.nome || '').toString().trim()

      let flow = (body.flow == null ? '' : body.flow).toString().trim()
      if (flow === 'PRE') flow = ''
      const flowNome = (body.flow_nome || '').toString().trim()
      let mapping = []
      if (flow && Array.isArray(body.mapping)) {
        for (let i = 0; i < body.mapping.length; i++) {
          const m = body.mapping[i] || {}
          const fid = (m.field_id == null ? '' : m.field_id).toString().trim()
          const src = (m.source || '').toString().trim()
          if (!fid || !src) continue
          mapping.push({ field_id: fid, source: src, value: (m.value || '').toString() })
        }
      }
      const flowMode = !!flow

      if (!rid) return e.badRequestError('recipient_id é obrigatório')

      let c
      try {
        c = $app.findRecordById('compradores', rid)
      } catch (_) {
        return e.json(200, { success: false, error: 'Comprador não encontrado' })
      }

      const email = c.getString('email')
      const nome = c.getString('nome') || ''
      let fone = (c.getString('telefone') || '').replace(/\D/g, '')
      if (fone && fone.length <= 11) fone = '55' + fone

      let status = 0
      let erroMsg = ''

      if (!flowMode) {
        // ---- MODO A: pré-credenciamento (catch webhook) ----
        if (!email) return e.json(200, { success: false, error: 'Comprador sem e-mail' })
        let token = ''
        try {
          token = $security.randomString(40)
          const tr = new Record($app.findCollectionByNameOrId('tokens_acesso'))
          tr.set('comprador_id', c.id)
          tr.set('token', token)
          tr.set('usado', false)
          const exp = new Date()
          exp.setDate(exp.getDate() + 60)
          tr.set('expira_em', exp.toISOString())
          $app.save(tr)
        } catch (_) {
          token = ''
        }
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
      } else {
        // ---- MODO B: fluxo via API (cria/atualiza contato + variáveis + send_flow) ----
        if (!BC_KEY)
          return e.json(200, { success: false, error: 'BOTCONVERSA_API_KEY não configurada' })
        if (!fone) return e.json(200, { success: false, error: 'Comprador sem telefone' })

        let needToken = false
        for (let mi = 0; mi < mapping.length; mi++) {
          const s = mapping[mi] && mapping[mi].source
          if (s === 'token' || s === 'link_acesso') needToken = true
        }
        let token = ''
        if (needToken) {
          try {
            token = $security.randomString(40)
            const tr = new Record($app.findCollectionByNameOrId('tokens_acesso'))
            tr.set('comprador_id', c.id)
            tr.set('token', token)
            tr.set('usado', false)
            const exp = new Date()
            exp.setDate(exp.getDate() + 60)
            tr.set('expira_em', exp.toISOString())
            $app.save(tr)
          } catch (_) {
            token = ''
          }
        }

        const resolveSource = (source, staticVal) => {
          if (source === 'static') return staticVal || ''
          if (source === 'nome') return nome
          if (source === 'primeiro_nome') {
            const n = nome.trim()
            return n ? n.split(/\s+/)[0] : ''
          }
          if (source === 'email') return email
          if (source === 'telefone') return fone
          if (source === 'documento') return c.getString('documento') || ''
          if (source === 'pedido_id') {
            try {
              const ing = $app.findFirstRecordByFilter('ingressos', 'comprador_id = {:cid}', {
                cid: c.id,
              })
              return ing ? ing.getString('pedido_id') || '' : ''
            } catch (_) {
              return ''
            }
          }
          if (source === 'token') return token || ''
          if (source === 'link_acesso') return token ? ACESSO_BASE + token : ''
          return ''
        }

        let subId = 0
        const gp = bcGet(BC_API + '/subscriber/get_by_phone/' + fone + '/')
        if (gp.status === 200) {
          try {
            subId = parseInt(JSON.parse(gp.body).id, 10) || 0
          } catch (_) {}
        }
        let crStatus = 0
        if (!subId) {
          const parts = nome ? nome.split(/\s+/) : []
          const fn = parts.length ? parts[0] : 'Contato'
          const ln = parts.length > 1 ? parts.slice(1).join(' ') : ''
          const cr = bcPost(BC_API + '/subscriber/', {
            phone: fone,
            first_name: fn,
            last_name: ln,
            has_opt_in_whatsapp: true,
          })
          crStatus = cr.status
          const gp2 = bcGet(BC_API + '/subscriber/get_by_phone/' + fone + '/')
          if (gp2.status === 200) {
            try {
              subId = parseInt(JSON.parse(gp2.body).id, 10) || 0
            } catch (_) {}
          }
        }

        if (!subId) {
          status = crStatus || gp.status || 0
          erroMsg = 'Sem subscriber (get=' + gp.status + ' create=' + crStatus + ')'
        } else {
          for (let mi = 0; mi < mapping.length; mi++) {
            const m = mapping[mi]
            if (!m || !m.field_id) continue
            const val = resolveSource(m.source, m.value)
            if (val === '' || val == null) continue
            bcPost(BC_API + '/subscriber/' + subId + '/custom_fields/' + m.field_id + '/', {
              value: String(val),
            })
          }
          const sf = bcPost(BC_API + '/subscriber/' + subId + '/send_flow/', {
            flow: parseInt(flow, 10),
          })
          status = sf.status
          if (sf.err) erroMsg = sf.err
        }
      }

      const ok = status >= 200 && status < 300
      const nowStr = new Date().toISOString()

      let disparoId = ''
      try {
        const d = new Record($app.findCollectionByNameOrId('disparos_wa'))
        d.set('nome', nomeCampanha || 'Individual — ' + (nome || email || rid))
        d.set('cluster', 'individual')
        d.set('total', 1)
        d.set('enviados', ok ? 1 : 0)
        d.set('erros', ok ? 0 : 1)
        d.set('status', 'concluido')
        d.set('flow', flow)
        d.set('flow_nome', flowNome)
        d.set('mapping', mapping.length ? JSON.stringify(mapping) : '')
        $app.save(d)
        disparoId = d.id
      } catch (_) {}

      try {
        c.set('wa_disparo_id', disparoId)
        c.set('wa_status', ok ? 'enviado' : 'erro')
        c.set('wa_enviado_em', ok ? nowStr : '')
        c.set('wa_erro', ok ? '' : ('HTTP ' + status + ' ' + (erroMsg || '')).substring(0, 300))
        c.set('wa_claim', '')
        $app.save(c)
      } catch (_) {}

      if (ok) return e.json(200, { success: true })
      return e.json(200, {
        success: false,
        status: status,
        error: erroMsg || 'HTTP ' + status,
      })
    } catch (err) {
      return e.json(200, { success: false, error: err && err.message ? err.message : 'erro' })
    }
  },
  $apis.requireAuth(),
)

// --- CRON: drena a fila do WhatsApp (workers concorrentes) ------------------
// Cada cron roda no próprio goroutine -> WA_WORKERS rodam EM PARALELO, cada um
// drenando uma fatia distinta da fila (claim atômico). A soma dos orçamentos
// (WA_WORKERS * BC_BUDGET) fica abaixo do limite de 650 req/min do BotConversa.
const WA_WORKERS = 5
for (let w = 0; w < WA_WORKERS; w++) {
  cronAdd('whatsapp_dispatch_' + w, '* * * * *', () => {
    const BC_URL_COMPRADOR =
      'https://new-backend.botconversa.com.br/api/v1/webhooks-automation/catch/192716/WquemD9Wrf0h/'
    const BC_API = 'https://backend.botconversa.com.br/api/v1/webhook'
    const BC_KEY = $os.getenv('BOTCONVERSA_API_KEY') || ''
    const ACESSO_BASE = 'https://summit2026.goskip.app/acesso?token='

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
    const bcGet = (url) => {
      try {
        const r = $http.send({
          url: url,
          method: 'GET',
          headers: { 'API-KEY': BC_KEY, 'Content-Type': 'application/json' },
          timeout: 12,
        })
        return { status: r.statusCode, body: decodeBody(r.body) }
      } catch (err) {
        return { status: 0, body: '', err: err && err.message ? err.message : 'erro' }
      }
    }
    const bcPost = (url, obj) => {
      try {
        const r = $http.send({
          url: url,
          method: 'POST',
          headers: { 'API-KEY': BC_KEY, 'Content-Type': 'application/json' },
          body: JSON.stringify(obj),
          timeout: 12,
        })
        return { status: r.statusCode, body: decodeBody(r.body) }
      } catch (err) {
        return { status: 0, body: '', err: err && err.message ? err.message : 'erro' }
      }
    }

    // Orçamento POR WORKER. WA_WORKERS(5) x BC_BUDGET(120) = 600 req/min no total,
    // abaixo dos 650/min do BotConversa. Ao atingir, devolve o restante pra fila.
    const BC_BUDGET = 120
    let bcCount = 0

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

    const resolveSource = (source, c, fone, staticVal, token) => {
      if (source === 'static') return staticVal || ''
      if (source === 'nome') return c.getString('nome') || ''
      if (source === 'primeiro_nome') {
        const n = (c.getString('nome') || '').trim()
        return n ? n.split(/\s+/)[0] : ''
      }
      if (source === 'email') return c.getString('email') || ''
      if (source === 'telefone') return fone || ''
      if (source === 'documento') return c.getString('documento') || ''
      if (source === 'pedido_id') {
        try {
          const ing = $app.findFirstRecordByFilter('ingressos', 'comprador_id = {:cid}', {
            cid: c.id,
          })
          return ing ? ing.getString('pedido_id') || '' : ''
        } catch (_) {
          return ''
        }
      }
      if (source === 'token') return token || ''
      if (source === 'link_acesso') return token ? ACESSO_BASE + token : ''
      return ''
    }

    const processOneBatch = (deadline) => {
      let first
      try {
        first = $app.findFirstRecordByFilter('compradores', 'wa_status = {:s}', { s: 'na_fila' })
      } catch (_) {
        return 'empty'
      }
      const disparoId = first.getString('wa_disparo_id')

      // Carrega o disparo pra saber o modo (flow) e o mapeamento.
      let flowId = ''
      let mapping = []
      if (disparoId) {
        try {
          const d = $app.findRecordById('disparos_wa', disparoId)
          flowId = d.getString('flow') || ''
          const mraw = d.getString('mapping') || ''
          if (mraw) {
            try {
              mapping = JSON.parse(mraw) || []
            } catch (_) {
              mapping = []
            }
          }
        } catch (_) {}
      }
      const flowMode = flowId && flowId !== 'PRE'
      let needToken = false
      for (let mi = 0; mi < mapping.length; mi++) {
        const s = mapping[mi] && mapping[mi].source
        if (s === 'token' || s === 'link_acesso') needToken = true
      }

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
        // Respeita o rate limit do BotConversa: para ao atingir o teto da execução.
        if (bcCount >= BC_BUDGET) {
          for (let j = i; j < batch.length; j++) {
            const cc = batch[j]
            cc.set('wa_status', 'na_fila')
            cc.set('wa_claim', '')
            try {
              $app.save(cc)
            } catch (_) {}
          }
          atualizaDisparo(disparoId)
          return 'budget'
        }
        bcCount += flowMode ? 4 + mapping.length : 1

        const c = batch[i]
        const nome = c.getString('nome') || ''
        let fone = (c.getString('telefone') || '').replace(/\D/g, '')
        if (fone && fone.length <= 11) fone = '55' + fone

        let status = 0
        let erroMsg = ''

        if (!flowMode) {
          // ---- MODO A: pré-credenciamento (catch webhook) ----
          const email = c.getString('email')
          if (!email) {
            c.set('wa_status', 'erro')
            c.set('wa_erro', 'Sem email')
            c.set('wa_claim', '')
            try {
              $app.save(c)
            } catch (_) {}
            continue
          }
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
        } else {
          // ---- MODO B: fluxo via API (cria/atualiza contato + variáveis + send_flow) ----
          if (!BC_KEY) {
            c.set('wa_status', 'erro')
            c.set('wa_erro', 'BOTCONVERSA_API_KEY não configurada')
            c.set('wa_claim', '')
            try {
              $app.save(c)
            } catch (_) {}
            continue
          }
          if (!fone) {
            c.set('wa_status', 'erro')
            c.set('wa_erro', 'Sem telefone')
            c.set('wa_claim', '')
            try {
              $app.save(c)
            } catch (_) {}
            continue
          }

          let token = ''
          if (needToken) {
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
          }

          // 1) acha/cria subscriber
          let subId = 0
          const gp = bcGet(BC_API + '/subscriber/get_by_phone/' + fone + '/')
          if (gp.status === 200) {
            try {
              subId = parseInt(JSON.parse(gp.body).id, 10) || 0
            } catch (_) {}
          }
          let crStatus = 0
          if (!subId) {
            const parts = nome ? nome.split(/\s+/) : []
            const fn = parts.length ? parts[0] : 'Contato'
            const ln = parts.length > 1 ? parts.slice(1).join(' ') : ''
            const cr = bcPost(BC_API + '/subscriber/', {
              phone: fone,
              first_name: fn,
              last_name: ln,
              has_opt_in_whatsapp: true,
            })
            crStatus = cr.status
            const gp2 = bcGet(BC_API + '/subscriber/get_by_phone/' + fone + '/')
            if (gp2.status === 200) {
              try {
                subId = parseInt(JSON.parse(gp2.body).id, 10) || 0
              } catch (_) {}
            }
          }

          if (!subId) {
            status = crStatus || gp.status || 0
            erroMsg = 'Sem subscriber (get=' + gp.status + ' create=' + crStatus + ')'
          } else {
            // 2) seta custom fields (variáveis) conforme mapeamento
            for (let mi = 0; mi < mapping.length; mi++) {
              const m = mapping[mi]
              if (!m || !m.field_id) continue
              const val = resolveSource(m.source, c, fone, m.value, token)
              if (val === '' || val == null) continue
              bcPost(BC_API + '/subscriber/' + subId + '/custom_fields/' + m.field_id + '/', {
                value: String(val),
              })
            }
            // 3) envia o fluxo
            const sf = bcPost(BC_API + '/subscriber/' + subId + '/send_flow/', {
              flow: parseInt(flowId, 10),
            })
            status = sf.status
            if (sf.err) erroMsg = sf.err
          }
        }

        // ---- persistência do resultado (comum aos dois modos) ----
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
      if (r === 'budget') break
    }
  })
}
