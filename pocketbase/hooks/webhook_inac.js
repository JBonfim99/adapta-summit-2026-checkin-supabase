// ---------------------------------------------------------------------------
// Integração com o INAC (entrega de pré-credenciamento p/ geração de QR Code).
//
// A URL de disparo vem da env var INAC_WEBHOOK_URL (Skip > Environment).
// Sem autenticação. Enquanto a env estiver vazia, nada é enviado e o ingresso
// fica com status_webhook = 'pendente' (dá pra reenviar pela tela de Envios).
//
// OBS: no JSVM do PocketBase os callbacks rodam em VMs separadas, então NÃO dá
// pra usar funções/constantes declaradas no topo do arquivo dentro deles. Por
// isso toda a lógica está inline em cada callback.
// ---------------------------------------------------------------------------

// Dispara automaticamente quando um participante é criado (após o submit).
onRecordAfterCreateSuccess((e) => {
  const INAC_WEBHOOK_URL = $os.getenv('INAC_WEBHOOK_URL')

  const part = e.record
  const ingresso = $app.findRecordById('ingressos', part.getString('ingresso_id'))

  const payload = {
    nome_completo: part.getString('nome_completo'),
    email: part.getString('email'),
    cpf: Number(part.getString('cpf').replace(/\D/g, '')),
    telefone: Number(part.getString('telefone').replace(/\D/g, '')),
    nome_empresa: part.getString('nome_empresa'),
    ingresso_id: ingresso.id,
    ingresso_categoria: ingresso.getString('tipo_ingresso'),
  }

  let status = 0
  let body = ''
  if (!INAC_WEBHOOK_URL) {
    body = 'INAC_WEBHOOK_URL não configurada — envio ignorado'
  } else {
    try {
      const res = $http.send({
        url: INAC_WEBHOOK_URL,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        timeout: 10,
      })
      status = res.statusCode
      body = res.body ? new TextDecoder().decode(res.body) : ''
    } catch (err) {
      status = 0
      body = err.message
    }
  }

  const logColl = $app.findCollectionByNameOrId('webhooks_log')
  const log = new Record(logColl)
  log.set('ingresso_id', ingresso.id)
  log.set('status', status)
  log.set('method', 'POST')
  log.set('response', (body || '').substring(0, 500))
  $app.save(log)

  let statusWebhook
  if (status >= 200 && status < 300) statusWebhook = 'enviado'
  else if (status === 0) statusWebhook = 'pendente'
  else statusWebhook = 'erro'

  ingresso.set('status_webhook', statusWebhook)
  $app.save(ingresso)

  e.next()
}, 'participantes')

// Reenvio manual a partir da tela de Envios.
routerAdd(
  'POST',
  '/backend/v1/admin/retry-webhook/{ingressoId}',
  (e) => {
    const INAC_WEBHOOK_URL = $os.getenv('INAC_WEBHOOK_URL')

    try {
      const id = e.request.pathValue('ingressoId')
      const ingresso = $app.findRecordById('ingressos', id)
      const partId = ingresso.getString('participante_id')
      if (!partId) return e.badRequestError('Ingresso sem participante')

      const part = $app.findRecordById('participantes', partId)

      const payload = {
        nome_completo: part.getString('nome_completo'),
        email: part.getString('email'),
        cpf: Number(part.getString('cpf').replace(/\D/g, '')),
        telefone: Number(part.getString('telefone').replace(/\D/g, '')),
        nome_empresa: part.getString('nome_empresa'),
        ingresso_id: ingresso.id,
        ingresso_categoria: ingresso.getString('tipo_ingresso'),
      }

      let status = 0
      let body = ''
      if (!INAC_WEBHOOK_URL) {
        body = 'INAC_WEBHOOK_URL não configurada — envio ignorado'
      } else {
        try {
          const res = $http.send({
            url: INAC_WEBHOOK_URL,
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            timeout: 10,
          })
          status = res.statusCode
          body = res.body ? new TextDecoder().decode(res.body) : ''
        } catch (err) {
          status = 0
          body = err.message
        }
      }

      const logColl = $app.findCollectionByNameOrId('webhooks_log')
      const log = new Record(logColl)
      log.set('ingresso_id', ingresso.id)
      log.set('status', status)
      log.set('method', 'POST')
      log.set('response', (body || '').substring(0, 500))
      $app.save(log)

      let statusWebhook
      if (status >= 200 && status < 300) statusWebhook = 'enviado'
      else if (status === 0) statusWebhook = 'pendente'
      else statusWebhook = 'erro'

      ingresso.set('status_webhook', statusWebhook)
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
