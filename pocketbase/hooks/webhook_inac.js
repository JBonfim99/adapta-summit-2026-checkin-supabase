onRecordAfterCreateSuccess((e) => {
  const part = e.record
  const ingressoId = part.getString('ingresso_id')
  const ingresso = $app.findRecordById('ingressos', ingressoId)

  const payload = {
    name: part.getString('nome_completo'),
    email: part.getString('email'),
    cpf: part.getString('cpf'),
    phone: part.getString('telefone'),
    ticket_type: ingresso.getString('tipo_ingresso'),
    order_id: ingresso.getString('pedido_id'),
  }

  let status = 500
  let respBody = ''

  try {
    const res = $http.send({
      url: 'https://httpbin.org/post',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      timeout: 10,
    })
    status = res.statusCode
    respBody = res.body ? new TextDecoder().decode(res.body) : ''
  } catch (err) {
    respBody = err.message
  }

  const logColl = $app.findCollectionByNameOrId('webhooks_log')
  const log = new Record(logColl)
  log.set('ingresso_id', ingresso.id)
  log.set('status', status)
  log.set('method', 'POST')
  log.set('response', respBody.substring(0, 500))
  $app.save(log)

  if (status >= 200 && status < 300) {
    ingresso.set('status', 'enviado')
  } else {
    ingresso.set('status', 'erro_webhook')
  }
  $app.save(ingresso)

  e.next()
}, 'participantes')

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

      const payload = {
        name: part.getString('nome_completo'),
        email: part.getString('email'),
        cpf: part.getString('cpf'),
        phone: part.getString('telefone'),
        ticket_type: ingresso.getString('tipo_ingresso'),
        order_id: ingresso.getString('pedido_id'),
      }

      let status = 500
      let respBody = ''
      try {
        const res = $http.send({
          url: 'https://httpbin.org/post',
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        status = res.statusCode
        respBody = res.body ? new TextDecoder().decode(res.body) : ''
      } catch (err) {
        respBody = err.message
      }

      const logColl = $app.findCollectionByNameOrId('webhooks_log')
      const log = new Record(logColl)
      log.set('ingresso_id', ingresso.id)
      log.set('status', status)
      log.set('method', 'POST')
      log.set('response', respBody.substring(0, 500))
      $app.save(log)

      if (status >= 200 && status < 300) {
        ingresso.set('status', 'enviado')
        $app.save(ingresso)
        return e.json(200, { success: true })
      } else {
        ingresso.set('status', 'erro_webhook')
        $app.save(ingresso)
        return e.json(500, { success: false, error: respBody })
      }
    } catch (err) {
      return e.badRequestError(err.message)
    }
  },
  $apis.requireAuth(),
)
