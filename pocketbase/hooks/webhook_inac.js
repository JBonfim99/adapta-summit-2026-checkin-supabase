// ---------------------------------------------------------------------------
// Integração com o INAC (entrega de pré-credenciamento p/ geração de QR Code).
//
// A URL de disparo será fornecida depois. Enquanto INAC_WEBHOOK_URL estiver
// vazia, nada é enviado e o ingresso fica com status_webhook = 'pendente'
// (dá pra reenviar depois pela tela de Envios).
// ---------------------------------------------------------------------------

const INAC_WEBHOOK_URL = '' // TODO: preencher com a URL do INAC

function buildInacPayload(part, ingresso) {
  return {
    event: 'adapta-summit-2026',
    participant_id: part.id,
    ticket_id: ingresso.id,
    order_id: ingresso.getString('pedido_id'),
    ticket_type: ingresso.getString('tipo_ingresso'),
    name: part.getString('nome_completo'),
    email: part.getString('email'),
    cpf: part.getString('cpf'),
    phone: part.getString('telefone'),
    company: part.getString('nome_empresa'),
    role: part.getString('cargo'),
  }
}

function deliverToInac(ingresso, part) {
  if (!INAC_WEBHOOK_URL) {
    return { status: 0, body: 'INAC_WEBHOOK_URL não configurada — envio ignorado' }
  }

  try {
    const res = $http.send({
      url: INAC_WEBHOOK_URL,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildInacPayload(part, ingresso)),
      timeout: 10,
    })
    return {
      status: res.statusCode,
      body: res.body ? new TextDecoder().decode(res.body) : '',
    }
  } catch (err) {
    return { status: 0, body: err.message }
  }
}

function logWebhook(ingressoId, status, body) {
  const logColl = $app.findCollectionByNameOrId('webhooks_log')
  const log = new Record(logColl)
  log.set('ingresso_id', ingressoId)
  log.set('status', status)
  log.set('method', 'POST')
  log.set('response', (body || '').substring(0, 500))
  $app.save(log)
}

function webhookStatusFor(httpStatus) {
  if (httpStatus >= 200 && httpStatus < 300) return 'enviado'
  if (httpStatus === 0) return 'pendente' // não enviado (URL ausente ou falha de rede)
  return 'erro'
}

// Dispara automaticamente quando um participante é criado (após o submit).
onRecordAfterCreateSuccess((e) => {
  const part = e.record
  const ingresso = $app.findRecordById('ingressos', part.getString('ingresso_id'))

  const { status, body } = deliverToInac(ingresso, part)
  logWebhook(ingresso.id, status, body)

  ingresso.set('status_webhook', webhookStatusFor(status))
  $app.save(ingresso)

  e.next()
}, 'participantes')

// Reenvio manual a partir da tela de Envios.
routerAdd(
  'POST',
  '/backend/v1/admin/retry-webhook/{ingressoId}',
  (e) => {
    try {
      const id = e.request.pathValue('ingressoId')
      const ingresso = $app.findRecordById('ingressos', id)
      const partId = ingresso.getString('participante_id')
      if (!partId) return e.badRequestError('Ingresso sem participante')

      const part = $app.findRecordById('participantes', partId)

      const { status, body } = deliverToInac(ingresso, part)
      logWebhook(ingresso.id, status, body)

      ingresso.set('status_webhook', webhookStatusFor(status))
      $app.save(ingresso)

      if (status >= 200 && status < 300) {
        return e.json(200, { success: true })
      }
      return e.json(502, { success: false, status: status, error: body })
    } catch (err) {
      return e.badRequestError(err.message)
    }
  },
  $apis.requireAuth(),
)
