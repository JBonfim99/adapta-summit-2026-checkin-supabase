// ---------------------------------------------------------------------------
// Integração com a INAC (endpoint /add — gera o QR Code de credenciamento).
//
// IMPORTANTE: a chamada à INAC agora é SÍNCRONA, feita nos endpoints de
// credenciamento (participant_routes.js: /participant/submit e admin_routes.js:
// /admin/participant/create), para podermos esperar a resposta, renderizar o QR
// na hora e persistir inac_id/inac_qr no ingresso. Por isso NÃO há mais um hook
// onRecordAfterCreateSuccess aqui (evita chamada dupla).
//
// Este arquivo mantém apenas o REENVIO MANUAL (tela de Logs): repete a /add para
// ingressos que falharam. URL e token vêm das env vars INAC_WEBHOOK_URL e
// INAC_AUTH_TOKEN. Idempotente: se o ingresso já tem inac_id, não reenvia.
// ---------------------------------------------------------------------------
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
      if (!partId) return e.badRequestError('Ingresso sem participante')

      // Idempotência: já credenciado na INAC, não reenvia.
      if (ingresso.getString('inac_id')) {
        return e.json(200, {
          success: true,
          already: true,
          qrcode: ingresso.getString('inac_qr'),
        })
      }

      if (!INAC_WEBHOOK_URL || !INAC_AUTH_TOKEN) {
        return e.badRequestError('INAC_WEBHOOK_URL/INAC_AUTH_TOKEN não configurados')
      }

      const part = $app.findRecordById('participantes', partId)
      const onlyDigits = (s) => (s || '').replace(/\D/g, '')
      let tel = onlyDigits(part.getString('telefone'))
      if (tel && tel.length <= 11) tel = '55' + tel
      const categoria = ingresso.getString('tipo_ingresso')
      const categoryId = categoria === 'PLATINUM' ? 6125 : 6123

      const payload = {
        event_id: 375,
        category_id: categoryId,
        status: 'active',
        fields: [
          { id: 10133653, value: part.getString('nome_completo') },
          { id: 10133654, value: part.getString('email') },
          { id: 10133655, value: onlyDigits(part.getString('cpf')) },
          { id: 10133656, value: tel },
          { id: 10133657, value: part.getString('nome_empresa') || part.getString('profissao') },
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
          timeout: 20,
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
      log.set('response', (respBody || erroMsg || '').substring(0, 500))
      $app.save(log)

      if (apiOk) {
        return e.json(200, { success: true, qrcode: inacQr })
      }
      return e.json(502, { success: false, status: status, error: respBody || erroMsg })
    } catch (err) {
      return e.badRequestError(err.message)
    }
  },
  $apis.requireAuth(),
)
