routerAdd('GET', '/backend/v1/buyer/tickets', (e) => {
  const authHeader = e.request.header.get('Authorization') || ''
  const token = authHeader.replace('Bearer ', '').trim()
  if (!token) return e.unauthorizedError('Token missing')

  let tokenRecord
  try {
    tokenRecord = $app.findFirstRecordByData('tokens_acesso', 'token', token)
  } catch (_) {
    return e.unauthorizedError('Invalid token')
  }

  if (new Date(tokenRecord.getString('expira_em')) < new Date()) {
    return e.unauthorizedError('Token expired')
  }

  const compradorId = tokenRecord.getString('comprador_id')

  const records = $app.findRecordsByFilter(
    'ingressos',
    `comprador_id = '${compradorId}'`,
    '-created',
    100,
    0,
  )

  $apis.enrichRecords(e, records, 'participante_id')

  const activeLinks = $app.findRecordsByFilter(
    'links_participante',
    `ingresso_id.comprador_id = '${compradorId}' && usado = false && expira_em > @now`,
    '-created',
    100,
    0,
  )

  const activeLinksMap = {}
  for (const link of activeLinks) {
    if (!activeLinksMap[link.getString('ingresso_id')]) {
      activeLinksMap[link.getString('ingresso_id')] = link.getString('token')
    }
  }

  const items = records.map((r) => {
    const json = JSON.parse(JSON.stringify(r))
    json.pending_link = activeLinksMap[r.id] || null
    return json
  })

  return e.json(200, { items })
})

routerAdd('POST', '/backend/v1/buyer/tickets/{ticketId}/invite', (e) => {
  const authHeader = e.request.header.get('Authorization') || ''
  const authToken = authHeader.replace('Bearer ', '').trim()
  if (!authToken) return e.unauthorizedError('Token missing')

  let tokenRecord
  try {
    tokenRecord = $app.findFirstRecordByData('tokens_acesso', 'token', authToken)
  } catch (_) {
    return e.unauthorizedError('Invalid token')
  }

  const compradorId = tokenRecord.getString('comprador_id')
  const ticketId = e.request.pathValue('ticketId')

  let ticket
  try {
    ticket = $app.findRecordById('ingressos', ticketId)
  } catch (_) {
    return e.notFoundError('Ticket not found')
  }

  if (ticket.getString('comprador_id') !== compradorId) {
    return e.forbiddenError('Not your ticket')
  }
  if (ticket.getString('status') !== 'pendente') {
    return e.badRequestError('Ticket already filled')
  }

  const oldLinks = $app.findRecordsByFilter(
    'links_participante',
    `ingresso_id = '${ticketId}' && usado = false`,
    '',
    100,
    0,
  )
  for (const old of oldLinks) {
    old.set('usado', true)
    $app.save(old)
  }

  const linkCol = $app.findCollectionByNameOrId('links_participante')
  const linkRecord = new Record(linkCol)
  const newToken = $security.randomString(32)
  linkRecord.set('ingresso_id', ticketId)
  linkRecord.set('token', newToken)
  linkRecord.set('usado', false)

  const expire = new Date()
  expire.setDate(expire.getDate() + 7)
  linkRecord.set('expira_em', expire.toISOString().replace('T', ' ').substring(0, 19) + 'Z')

  $app.save(linkRecord)

  return e.json(200, { token: newToken })
})

routerAdd('POST', '/backend/v1/buyer/tickets/{ticketId}/revoke', (e) => {
  const authHeader = e.request.header.get('Authorization') || ''
  const authToken = authHeader.replace('Bearer ', '').trim()
  if (!authToken) return e.unauthorizedError('Token missing')

  let tokenRecord
  try {
    tokenRecord = $app.findFirstRecordByData('tokens_acesso', 'token', authToken)
  } catch (_) {
    return e.unauthorizedError('Invalid token')
  }

  const compradorId = tokenRecord.getString('comprador_id')
  const ticketId = e.request.pathValue('ticketId')

  let ticket
  try {
    ticket = $app.findRecordById('ingressos', ticketId)
  } catch (_) {
    return e.notFoundError('Ticket not found')
  }

  if (ticket.getString('comprador_id') !== compradorId) {
    return e.forbiddenError('Not your ticket')
  }

  const oldLinks = $app.findRecordsByFilter(
    'links_participante',
    `ingresso_id = '${ticketId}' && usado = false`,
    '',
    100,
    0,
  )
  for (const old of oldLinks) {
    old.set('usado', true)
    $app.save(old)
  }

  return e.json(200, { success: true })
})
