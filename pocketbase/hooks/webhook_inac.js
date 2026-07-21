// ---------------------------------------------------------------------------
// Integração com a INAC (endpoint /add — gera o QR Code de credenciamento).
//
// A chamada à INAC é SÍNCRONA nos endpoints de credenciamento
// (participant_routes.js e admin_routes.js). Este arquivo mantém os REENVIOS
// manuais (tela de Logs): individual e em lote. URL e token vêm de
// INAC_WEBHOOK_URL / INAC_AUTH_TOKEN. Idempotente: se já tem inac_id, não reenvia.
//
// Observação: os reenvios respondem SEMPRE 200 (mesmo quando a INAC recusa),
// com { success:false, ... }. Isso garante que a resposta carregue os cabeçalhos
// de CORS (um 5xx do app/gateway pode voltar sem eles e o browser bloqueia).
// O timeout do $http.send é curto pra responder bem antes do limite do gateway.
// ---------------------------------------------------------------------------

// --- REENVIO INDIVIDUAL ------------------------------------------------------
routerAdd(
  'POST',
  '/backend/v1/admin/retry-webhook/{ingressoId}',
  (e) => {
    const INAC_WEBHOOK_URL = $os.getenv('INAC_WEBHOOK_URL')
    const INAC_AUTH_TOKEN = $os.getenv('INAC_AUTH_TOKEN')

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
      const id = e.request.pathValue('ingressoId')
      const ingresso = $app.findRecordById('ingressos', id)
      const partId = ingresso.getString('participante_id')
      if (!partId) return e.json(200, { success: false, error: 'Ingresso sem participante' })

      // Idempotência: já credenciado na INAC, não reenvia.
      if (ingresso.getString('inac_id')) {
        return e.json(200, { success: true, already: true, qrcode: ingresso.getString('inac_qr') })
      }

      if (!INAC_WEBHOOK_URL || !INAC_AUTH_TOKEN) {
        return e.json(200, {
          success: false,
          error: 'INAC_WEBHOOK_URL/INAC_AUTH_TOKEN não configurados',
        })
      }

      const part = $app.findRecordById('participantes', partId)
      const onlyDigits = (s) => (s || '').replace(/\D/g, '')
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
      let tel = onlyDigits(part.getString('telefone'))
      if (tel && tel.length <= 11) tel = '55' + tel
      const categoryId = ingresso.getString('tipo_ingresso') === 'PLATINUM' ? 6125 : 6123

      const payload = {
        event_id: 375,
        category_id: categoryId,
        status: 'active',
        fields: [
          { id: 10133653, value: sanitize(part.getString('nome_completo')) },
          { id: 10133654, value: part.getString('email') },
          { id: 10133655, value: onlyDigits(part.getString('cpf')) },
          { id: 10133656, value: tel },
          {
            id: 10133657,
            value: sanitize(part.getString('nome_empresa') || part.getString('profissao')),
          },
          { id: 10133665, value: ingresso.getString('pedido_id') },
        ],
      }

      let status = 0
      let respBody = ''
      let erroMsg = ''
      try {
        const res = $http.send({
          url: INAC_WEBHOOK_URL,
          method: 'POST',
          headers: { 'X-Auth-Token': INAC_AUTH_TOKEN, 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          timeout: 10,
        })
        status = res.statusCode
        respBody = decodeBody(res.body)
      } catch (err) {
        erroMsg = err.message
      }

      let inacId = ''
      let inacQr = ''
      let apiOk = false
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

      if (apiOk && inacQr) {
        ingresso.set('inac_id', inacId)
        ingresso.set('inac_qr', inacQr)
      }
      ingresso.set('status_webhook', apiOk ? 'enviado' : 'erro')
      $app.save(ingresso)

      const logColl = $app.findCollectionByNameOrId('webhooks_log')
      const log = new Record(logColl)
      log.set('ingresso_id', ingresso.id)
      log.set('evento', apiOk ? 'webhook_reenviado' : 'webhook_reenvio_erro')
      log.set(
        'detalhe',
        apiOk
          ? `Reenvio manual OK (id ${inacId})`
          : erroMsg
            ? `Falha de rede no reenvio: ${erroMsg}`
            : `INAC retornou erro no reenvio (HTTP ${status})`,
      )
      log.set('status', status)
      log.set('method', 'POST')
      log.set('payload', JSON.stringify(payload))
      log.set('response', (respBody || erroMsg || '').substring(0, 2000))
      $app.save(log)

      if (apiOk) {
        return e.json(200, { success: true, qrcode: inacQr })
      }
      // 200 (não 5xx) para a resposta carregar CORS; o front lê success:false.
      return e.json(200, {
        success: false,
        status: status,
        error: respBody || erroMsg,
        payload: payload,
        response: respBody || erroMsg,
      })
    } catch (err) {
      return e.json(200, { success: false, error: err && err.message ? err.message : 'erro' })
    }
  },
  $apis.requireAuth(),
)

// --- REENVIO EM LOTE: retenta os ingressos com status_webhook = 'erro' --------
// Processa até 10 por chamada (clique de novo se sobrar) pra não estourar o
// limite de tempo do gateway.
routerAdd(
  'POST',
  '/backend/v1/admin/retry-webhook-all',
  (e) => {
    const INAC_WEBHOOK_URL = $os.getenv('INAC_WEBHOOK_URL')
    const INAC_AUTH_TOKEN = $os.getenv('INAC_AUTH_TOKEN')
    if (!INAC_WEBHOOK_URL || !INAC_AUTH_TOKEN) {
      return e.json(200, { tried: 0, ok: 0, failed: 0, error: 'INAC não configurado' })
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
    const onlyDigits = (s) => (s || '').replace(/\D/g, '')
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

    let list = []
    try {
      list = $app.findRecordsByFilter(
        'ingressos',
        "status_webhook = 'erro' && participante_id != ''",
        'created',
        10,
        0,
      )
    } catch (_) {
      list = []
    }

    const logColl = $app.findCollectionByNameOrId('webhooks_log')
    let tried = 0
    let ok = 0
    let failed = 0

    for (let i = 0; i < list.length; i++) {
      const ingresso = list[i]
      if (ingresso.getString('inac_id')) continue
      const partId = ingresso.getString('participante_id')
      if (!partId) continue
      let part
      try {
        part = $app.findRecordById('participantes', partId)
      } catch (_) {
        continue
      }
      tried++

      let tel = onlyDigits(part.getString('telefone'))
      if (tel && tel.length <= 11) tel = '55' + tel
      const categoryId = ingresso.getString('tipo_ingresso') === 'PLATINUM' ? 6125 : 6123
      const payload = {
        event_id: 375,
        category_id: categoryId,
        status: 'active',
        fields: [
          { id: 10133653, value: sanitize(part.getString('nome_completo')) },
          { id: 10133654, value: part.getString('email') },
          { id: 10133655, value: onlyDigits(part.getString('cpf')) },
          { id: 10133656, value: tel },
          {
            id: 10133657,
            value: sanitize(part.getString('nome_empresa') || part.getString('profissao')),
          },
          { id: 10133665, value: ingresso.getString('pedido_id') },
        ],
      }

      let status = 0
      let respBody = ''
      let erroMsg = ''
      try {
        const res = $http.send({
          url: INAC_WEBHOOK_URL,
          method: 'POST',
          headers: { 'X-Auth-Token': INAC_AUTH_TOKEN, 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          timeout: 8,
        })
        status = res.statusCode
        respBody = decodeBody(res.body)
      } catch (err) {
        erroMsg = err.message
      }

      let inacId = ''
      let inacQr = ''
      let apiOk = false
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

      if (apiOk && inacQr) {
        ingresso.set('inac_id', inacId)
        ingresso.set('inac_qr', inacQr)
      }
      ingresso.set('status_webhook', apiOk ? 'enviado' : 'erro')
      try {
        $app.save(ingresso)
      } catch (_) {}

      try {
        const log = new Record(logColl)
        log.set('ingresso_id', ingresso.id)
        log.set('evento', apiOk ? 'webhook_reenviado' : 'webhook_reenvio_erro')
        log.set(
          'detalhe',
          apiOk
            ? `Reenvio em lote OK (id ${inacId})`
            : erroMsg
              ? `Falha de rede no reenvio: ${erroMsg}`
              : `INAC retornou erro no reenvio (HTTP ${status})`,
        )
        log.set('status', status)
        log.set('method', 'POST')
        log.set('payload', JSON.stringify(payload))
        log.set('response', (respBody || erroMsg || '').substring(0, 2000))
        $app.save(log)
      } catch (_) {}

      if (apiOk) ok++
      else failed++
    }

    return e.json(200, { tried: tried, ok: ok, failed: failed })
  },
  $apis.requireAuth(),
)

// --- SYNC DE CATEGORIA (upgrade em lote): PUT /edit pros ingressos que -------
// já tinham inac_id (já credenciados na INAC) e foram convertidos GOLD->PLATINUM
// por uma migration de lote (marcados com a tag "pending-inac-edit" em `origem`,
// já que migrations não têm $http pra chamar a INAC na hora). Processa até 10
// por chamada (clique de novo se sobrar). Idempotente: só remove a tag da
// `origem` quando o /edit responde OK; se falhar, a tag fica e o próximo clique
// tenta de novo.
routerAdd(
  'POST',
  '/backend/v1/admin/sync-inac-upgrades',
  (e) => {
    const INAC_WEBHOOK_URL = $os.getenv('INAC_WEBHOOK_URL')
    const INAC_AUTH_TOKEN = $os.getenv('INAC_AUTH_TOKEN')
    if (!INAC_WEBHOOK_URL || !INAC_AUTH_TOKEN) {
      return e.json(200, { tried: 0, ok: 0, failed: 0, error: 'INAC não configurado' })
    }
    const INAC_EDIT_URL = INAC_WEBHOOK_URL.replace('/attendees/add', '/attendees/edit')

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
    const onlyDigits = (s) => (s || '').replace(/\D/g, '')
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

    let list = []
    try {
      list = $app.findRecordsByFilter(
        'ingressos',
        "tipo_ingresso = 'PLATINUM' && origem ~ 'pending-inac-edit'",
        'created',
        10,
        0,
      )
    } catch (_) {
      list = []
    }

    const logColl = $app.findCollectionByNameOrId('webhooks_log')
    let tried = 0
    let ok = 0
    let failed = 0
    const skipped = []

    for (let i = 0; i < list.length; i++) {
      const ingresso = list[i]
      const inacId = ingresso.getString('inac_id')
      const partId = ingresso.getString('participante_id')
      if (!inacId || !partId) {
        skipped.push({
          ingresso_id: ingresso.id,
          motivo: !inacId ? 'sem inac_id' : 'sem participante',
        })
        continue
      }
      let part
      try {
        part = $app.findRecordById('participantes', partId)
      } catch (_) {
        skipped.push({ ingresso_id: ingresso.id, motivo: 'participante não encontrado' })
        continue
      }
      tried++

      let tel = onlyDigits(part.getString('telefone'))
      if (tel && tel.length <= 11) tel = '55' + tel
      const payload = {
        id: parseInt(inacId, 10),
        event_id: 375,
        category_id: 6125, // Platinum
        status: 'active',
        fields: [
          { id: 10133653, value: sanitize(part.getString('nome_completo')) },
          { id: 10133654, value: part.getString('email') },
          { id: 10133655, value: onlyDigits(part.getString('cpf')) },
          { id: 10133656, value: tel },
          {
            id: 10133657,
            value: sanitize(part.getString('nome_empresa') || part.getString('profissao')),
          },
          { id: 10133665, value: ingresso.getString('pedido_id') },
        ],
      }

      let status = 0
      let respBody = ''
      let erroMsg = ''
      try {
        const res = $http.send({
          url: INAC_EDIT_URL,
          method: 'PUT',
          headers: { 'X-Auth-Token': INAC_AUTH_TOKEN, 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          timeout: 10,
        })
        status = res.statusCode
        respBody = decodeBody(res.body)
      } catch (err) {
        erroMsg = err.message
      }

      const apiOk = status >= 200 && status < 300

      if (apiOk) {
        // Remove só a tag de pendência da origem, preserva o resto.
        const origemAtual = ingresso.getString('origem') || ''
        const origemLimpa = origemAtual
          .split(';')
          .filter((t) => t && t !== 'pending-inac-edit')
          .join(';')
        ingresso.set('origem', origemLimpa)
        ingresso.set('status_webhook', 'enviado')
      } else {
        ingresso.set('status_webhook', 'erro')
      }
      try {
        $app.save(ingresso)
      } catch (_) {}

      try {
        const log = new Record(logColl)
        log.set('ingresso_id', ingresso.id)
        log.set('evento', apiOk ? 'webhook_editado' : 'webhook_edicao_erro')
        log.set(
          'detalhe',
          apiOk
            ? `Categoria atualizada na INAC p/ Platinum (attendee ${inacId})`
            : erroMsg
              ? `Falha de rede no /edit: ${erroMsg}`
              : `INAC recusou o /edit (HTTP ${status})`,
        )
        log.set('status', status)
        log.set('method', 'PUT')
        log.set('payload', JSON.stringify(payload))
        log.set('response', (respBody || erroMsg || '').substring(0, 2000))
        $app.save(log)
      } catch (_) {}

      if (apiOk) ok++
      else failed++
    }

    return e.json(200, { tried: tried, ok: ok, failed: failed, skipped: skipped })
  },
  $apis.requireAuth(),
)
