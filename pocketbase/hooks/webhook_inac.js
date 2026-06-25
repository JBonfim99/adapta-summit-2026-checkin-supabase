// ---------------------------------------------------------------------------
// Integração com o INAC (entrega de pré-credenciamento p/ geração de QR Code).
//
// A URL de disparo vem da env var INAC_WEBHOOK_URL (Skip > Environment).
// Sem autenticação. Sem URL configurada, nada é enviado, nenhum log é criado,
// e o ingresso fica com status_webhook = 'pendente'.
//
// Retentativa (fluxo automático — participante e adição pelo painel):
//   - até 4 tentativas no total (1 inicial + 3 retentativas)
//   - timeout de 10s por tentativa
//   - espera de 2s entre as tentativas
//   - cada tentativa é gravada em Logs
//   - o erro NUNCA é exibido ao usuário: o disparo roda após o commit, então a
//     resposta de sucesso já foi enviada. Só fica registrado nos logs.
//
// OBS: no JSVM do PocketBase os callbacks rodam em VMs separadas, então toda a
// lógica está inline em cada callback.
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

  const logColl = $app.findCollectionByNameOrId('webhooks_log')
  const MAX_ATTEMPTS = 4 // 1 inicial + 3 retentativas
  let delivered = false

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
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

    const log = new Record(logColl)
    log.set('ingresso_id', ingresso.id)
    log.set('evento', ok ? 'webhook_enviado' : 'webhook_erro')
    log.set(
      'detalhe',
      `Tentativa ${attempt}/${MAX_ATTEMPTS} — ` +
        (ok
          ? `enviado ao INAC (HTTP ${status})`
          : erroMsg
            ? `falha de rede: ${erroMsg}`
            : `INAC retornou erro (HTTP ${status})`),
    )
    log.set('status', status)
    log.set('method', 'POST')
    log.set('payload', JSON.stringify(payload))
    log.set('response', (respBody || erroMsg || '').substring(0, 500))
    $app.save(log)

    if (ok) {
      delivered = true
      break
    }

    // Espera 2s antes da próxima tentativa (exceto após a última).
    if (attempt < MAX_ATTEMPTS) {
      const waitUntil = Date.now() + 2000
      while (Date.now() < waitUntil) {
        // aguarda
      }
    }
  }

  ingresso.set('status_webhook', delivered ? 'enviado' : 'erro')
  $app.save(ingresso)

  e.next()
}, 'participantes')

// Reenvio manual a partir da tela de Logs (ação explícita do admin: tentativa
// única, com retorno do resultado para quem clicou).
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
            : `INAC retornou erro no reenvio (HTTP ${status})`,
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
