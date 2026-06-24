routerAdd('GET', '/backend/v1/buyer/tickets', (e) => {
  let compradorId
  try {
    const authHeader = e.request.header.get('Authorization') || ''
    const token = authHeader.replace('Bearer ', '')
    if (!token) throw new Error('Missing token')
    const payload = $security.parseUnverifiedJWT(token)
    if (!payload.comprador_id) throw new Error('Invalid payload')
    compradorId = payload.comprador_id
  } catch (err) {
    return e.unauthorizedError('Unauthorized')
  }

  try {
    const records = $app.findRecordsByFilter(
      'ingressos',
      `comprador_id = '${compradorId}'`,
      '-created',
      1000,
      0,
    )
    $apis.enrichRecords(e, records, 'participante_id')

    return e.json(200, { items: records })
  } catch (err) {
    return e.badRequestError(err.message)
  }
})

routerAdd('POST', '/backend/v1/buyer/tickets/{id}/invite', (e) => {
  let compradorId
  try {
    const authHeader = e.request.header.get('Authorization') || ''
    const token = authHeader.replace('Bearer ', '')
    if (!token) throw new Error()
    const payload = $security.parseUnverifiedJWT(token)
    compradorId = payload.comprador_id
    if (!compradorId) throw new Error()
  } catch (_) {
    return e.unauthorizedError('Unauthorized')
  }

  try {
    const ticketId = e.request.pathValue('id')
    const ingresso = $app.findRecordById('ingressos', ticketId)

    if (ingresso.getString('comprador_id') !== compradorId) {
      return e.forbiddenError('Not your ticket')
    }

    if (
      ingresso.getString('status') === 'preenchido' ||
      ingresso.getString('status') === 'enviado'
    ) {
      return e.badRequestError('Ingresso já preenchido')
    }

    const linksColl = $app.findCollectionByNameOrId('links_participante')
    const record = new Record(linksColl)
    const tokenStr = $security.randomString(32)

    record.set('ingresso_id', ticketId)
    record.set('token', tokenStr)
    record.set('usado', false)

    const expiry = new Date()
    expiry.setHours(expiry.getHours() + 168) // 7 days
    record.set('expira_em', expiry.toISOString())

    $app.save(record)

    return e.json(200, { token: tokenStr })
  } catch (err) {
    return e.badRequestError(err.message)
  }
})
