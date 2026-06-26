// Valida o link de credenciamento. Se já foi usado (participante já preencheu),
// retorna usado:true para o front redirecionar à página de detalhes do ingresso
// em vez de mostrar erro. Só erra de fato se o link não existe ou expirou.
routerAdd('GET', '/backend/v1/participant/link/{token}', (e) => {
  const token = e.request.pathValue('token')
  try {
    const link = $app.findFirstRecordByData('links_participante', 'token', token)
    if (new Date(link.getString('expira_em')) < new Date()) {
      return e.badRequestError('Link inválido ou expirado')
    }
    const ingresso = $app.findRecordById('ingressos', link.getString('ingresso_id'))
    return e.json(200, {
      ingresso_id: ingresso.id,
      tipo_ingresso: ingresso.getString('tipo_ingresso'),
      usado: link.getBool('usado'),
    })
  } catch (err) {
    return e.badRequestError('Link não encontrado')
  }
})

// Detalhes do ingresso (read-only) a partir do token do ingresso. Resolve mesmo
// com o link já 'usado' — o objetivo aqui é VER os dados, não preencher.
routerAdd('GET', '/backend/v1/participant/ticket/{token}', (e) => {
  const token = e.request.pathValue('token')
  try {
    const link = $app.findFirstRecordByData('links_participante', 'token', token)
    if (new Date(link.getString('expira_em')) < new Date()) {
      return e.badRequestError('Link expirado')
    }
    const ingresso = $app.findRecordById('ingressos', link.getString('ingresso_id'))

    let participante = null
    const pid = ingresso.getString('participante_id')
    if (pid) {
      try {
        const p = $app.findRecordById('participantes', pid)
        participante = {
          nome_completo: p.getString('nome_completo'),
          email: p.getString('email'),
          cpf: p.getString('cpf'),
          telefone: p.getString('telefone'),
          nome_empresa: p.getString('nome_empresa'),
          cargo: p.getString('cargo'),
        }
      } catch (_) {}
    }

    return e.json(200, {
      tipo_ingresso: ingresso.getString('tipo_ingresso'),
      status: ingresso.getString('status'),
      pedido_id: ingresso.getString('pedido_id'),
      preenchido: !!participante,
      participante: participante,
      inac_qr: ingresso.getString('inac_qr'),
    })
  } catch (err) {
    return e.badRequestError('Ingresso não encontrado')
  }
})

// Checa se um e-mail já está em uso por OUTRO participante (case-insensitive).
// Público: o formulário do participante não é autenticado. Retorna só um booleano.
routerAdd('POST', '/backend/v1/participant/email-check', (e) => {
  const body = e.requestInfo().body || {}
  const email = (body.email || '').toString().trim().toLowerCase()
  if (!email) return e.json(200, { available: true })
  let dup = false
  try {
    $app.findFirstRecordByFilter('participantes', 'email = {:em}', { em: email })
    dup = true
  } catch (_) {}
  return e.json(200, { available: !dup })
})

routerAdd('POST', '/backend/v1/participant/submit', (e) => {
  const body = e.requestInfo().body
  const token = body.token
  const emailNorm = (body.email || '').toString().trim().toLowerCase()

  // Regra: e-mail único entre participantes (pode coincidir com o de um comprador).
  let emailDup = false
  try {
    $app.findFirstRecordByFilter('participantes', 'email = {:em}', { em: emailNorm })
    emailDup = true
  } catch (_) {}
  if (emailDup) {
    return e.badRequestError('Este e-mail já foi usado por outro participante. Use outro e-mail.')
  }

  let ingressoId = ''
  try {
    $app.runInTransaction((txApp) => {
      const link = txApp.findFirstRecordByData('links_participante', 'token', token)
      if (link.getBool('usado') || new Date(link.getString('expira_em')) < new Date()) {
        throw new Error('Link inválido ou expirado')
      }

      const ingresso = txApp.findRecordById('ingressos', link.getString('ingresso_id'))
      ingressoId = ingresso.id

      const partColl = txApp.findCollectionByNameOrId('participantes')
      const part = new Record(partColl)
      part.set('ingresso_id', ingresso.id)
      part.set('nome_completo', body.nome_completo)
      part.set('email', emailNorm)
      part.set('cpf', body.cpf)
      part.set('telefone', body.telefone)
      part.set('nome_empresa', body.nome_empresa)
      part.set('cargo', body.cargo)
      part.set('nicho', body.nicho)
      part.set('num_funcionarios', body.num_funcionarios)
      part.set('faturamento_anual', body.faturamento_anual)
      part.set('areas_ajuda', body.areas_ajuda || [])
      part.set('expectativa_aprendizado', body.expectativa_aprendizado || '')
      part.set('expectativa_experiencia', body.expectativa_experiencia || '')

      txApp.save(part)

      ingresso.set('participante_id', part.id)
      ingresso.set('status', 'Pré-Credenciado')
      ingresso.set('preenchido_em', new Date().toISOString())
      txApp.save(ingresso)

      link.set('usado', true)
      txApp.save(link)
    })
  } catch (err) {
    const m = (err && err.message) || ''
    if (/unique/i.test(m) || m.indexOf('idx_participantes_email') !== -1) {
      return e.badRequestError('Este e-mail já foi usado por outro participante. Use outro e-mail.')
    }
    return e.badRequestError(m)
  }

  // Pós-commit: chama a INAC /add (síncrono) para gerar o QR, persiste
  // inac_id/inac_qr no ingresso e devolve o qrcode para renderizar na hora.
  // Idempotente: só chama se o ingresso ainda não tiver inac_id.
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
      const onlyDigits = (s) => (s || '').replace(/\D/g, '')
      let tel = onlyDigits(body.telefone)
      if (tel && tel.length <= 11) tel = '55' + tel
      const categoria = ingresso.getString('tipo_ingresso')
      const categoryId = categoria === 'PLATINUM' ? 6125 : 6123
      const payload = {
        event_id: 375,
        category_id: categoryId,
        status: 'active',
        fields: [
          { id: 10133653, value: body.nome_completo || '' },
          { id: 10133654, value: emailNorm },
          { id: 10133655, value: onlyDigits(body.cpf) },
          { id: 10133656, value: tel },
          { id: 10133657, value: body.nome_empresa || '' },
          { id: 10133665, value: ingresso.id },
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
        logAttempt('webhook_erro', 'INAC_WEBHOOK_URL/INAC_AUTH_TOKEN não configurados', 0, '')
      } else {
        // Retry: até 3 tentativas, com 1,5s entre elas. Cada tentativa é logada.
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
              `INAC /add OK (id ${inacId}) na tentativa ${attempt}/${MAX}`,
              status,
              respBody,
            )
          } else {
            logAttempt(
              'webhook_erro',
              `Tentativa ${attempt}/${MAX} falhou — ` +
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

  return e.json(200, { success: true, qrcode: qrcode })
})
