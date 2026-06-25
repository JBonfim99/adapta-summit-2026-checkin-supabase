// ---------------------------------------------------------------------------
// Integração com o INAC (entrega de pré-credenciamento p/ geração de QR Code).
//
// A URL de disparo vem da env var INAC_WEBHOOK_URL (Skip > Environment).
// Sem autenticação. Sem URL configurada, nada é enviado, NENHUM log é criado,
// e o ingresso fica com status_webhook = 'pendente' (dá pra reenviar depois).
//
// Regra dos logs: um log só é gravado quando o webhook é EFETIVAMENTE disparado
// (após o participante finalizar). Cada log descreve um evento com detalhe.
//
// OBS: no JSVM do PocketBase os callbacks rodam em VMs separadas, então toda a
// lógica está inline em cada callback (nada de função no topo do arquivo).
// ---------------------------------------------------------------------------

// Dispara automaticamente quando um participante é criado (após "Finalizar").
onRecordAfterCreateSuccess((e) => {
  const INAC_WEBHOOK_URL = $os.getenv('INAC_WEBHOOK_URL')

  const part = e.record
  const ingresso = $app.findRecordById('ingressos', part.getString('ingresso_id'))

  // Sem URL: não dispara e não loga. Só deixa pendente para reenvio futuro.
  if (!INAC_WEBHOOK_URL) {
    ingresso.set('status_webhook', 'pendente')
    $app.save(ingresso)
    e.next()
    return
  }

  const payload = {
    nome_completo: part.getString('nome_completo'),
    email: part.getString('email'),
    cpf: part.getString('cpf').replace(/\D/g, ''),
    telefone: part.getString('telefone').replace(/\D/g, ''),
    nome_empresa: part.getString('nome_empresa'),
    ingresso_id: ingresso.id,
    ingresso_categoria: ingresso.getString('tipo_ingresso'),
  }

  let status = 0
  let respBody = ''
  let erroMsg = ''
  try {
    const res = $http.send({
      url: INAC_WEBHOOK_URL,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      timeout: 10,
    })
    status = res.statusCode
    respBody = res.body ? new TextDecoder().decode(res.body) : ''
  } catch (err) {
    erroMsg = err.message
  }

  const ok = status >= 200 && status < 300

  // Log do evento — só aqui, porque o webhook foi efetivamente disparado.
  const logColl = $app.findCollectionByNameOrId('webhooks_log')
  const log = new Record(logColl)
  log.set('ingresso_id', ingresso.id)
  log.set('evento', ok ? 'webhook_enviado' : 'webhook_erro')
  log.set(
    'detalhe',
    ok
      ? `Webhook enviado ao INAC após finalização (HTTP ${status})`
      : erroMsg
        ? `Falha de rede ao enviar webhook: ${erroMsg}`
        : `INAC respondeu com erro (HTTP ${status})`,
  )
  log.set('status', status)
  log.set('method', 'POST')
  log.set('payload', JSON.stringify(payload))
  log.set('response', (respBody || erroMsg || '').substring(0, 500))
  $app.save(log)

  ingresso.set('status_webhook', ok ? 'enviado' : 'erro')
  $app.save(ingresso)

  e.next()
}, 'participantes')

// Reenvio manual a partir da tela de Logs.
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

      if (!INAC_WEBHOOK_URL) {
        return e.badRequestError('INAC_WEBHOOK_URL não configurada')
      }

      const part = $app.findRecordById('participantes', partId)

      const payload = {
        nome_completo: part.getString('nome_completo'),
        email: part.getString('email'),
        cpf: part.getString('cpf').replace(/\D/g, ''),
        telefone: part.getString('telefone').replace(/\D/g, ''),
        nome_empresa: part.getString('nome_empresa'),
        ingresso_id: ingresso.id,
        ingresso_categoria: ingresso.getString('tipo_ingresso'),
      }

      let status = 0
      let respBody = ''
      let erroMsg = ''
      try {
        const res = $http.send({
          url: INAC_WEBHOOK_URL,
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          timeout: 10,
        })
        status = res.statusCode
        respBody = res.body ? new TextDecoder().decode(res.body) : ''
      } catch (err) {
        erroMsg = err.message
      }

      const ok = status >= 200 && status < 300

      const logColl = $app.findCollectionByNameOrId('webhooks_log')
      const log = new Record(logColl)
      log.set('ingresso_id', ingresso.id)
      log.set('evento', ok ? 'webhook_reenviado' : 'webhook_reenvio_erro')
      log.set(
        'detalhe',
        ok
          ? `Reenvio manual bem-sucedido (HTTP ${status})`
          : erroMsg
            ? `Falha de rede no reenvio manual: ${erroMsg}`
            : `INAC respondeu com erro no reenvio (HTTP ${status})`,
      )
      log.set('status', status)
      log.set('method', 'POST')
      log.set('payload', JSON.stringify(payload))
      log.set('response', (respBody || erroMsg || '').substring(0, 500))
      $app.save(log)

      ingresso.set('status_webhook', ok ? 'enviado' : 'erro')
      $app.save(ingresso)

      if (ok) {
        return e.json(200, { success: true })
      }
      return e.json(502, { success: false, status: status, error: respBody || erroMsg })
    } catch (err) {
      return e.badRequestError(err.message)
    }
  },
  $apis.requireAuth(),
)
