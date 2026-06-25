routerAdd('GET', '/backend/v1/buyer/tickets', (e) => {
  const authHeader = e.request.header.get('Authorization') || ''
  const token = authHeader.replace('Bearer ', '').trim()
  if (!token) return e.unauthorizedError('Missing token')

  let link
  try {
    link = $app.findFirstRecordByFilter('tokens_acesso', 'token = {:t} && expira_em > {:now}', {
      t: token,
      now: new Date().toISOString(),
    })
  } catch (err) {
    return e.unauthorizedError('Invalid token')
  }

  const tickets = $app.findRecordsByFilter(
    'ingressos',
    'comprador_id = {:c}',
    '-created',
    1000,
    0,
    { c: link.getString('comprador_id') },
  )

  const items = []
  for (const t of tickets) {
    const exported = JSON.parse(JSON.stringify(t.publicExport()))

    if (t.getString('status') === 'Pendente') {
      try {
        const pl = $app.findFirstRecordByFilter(
          'links_participante',
          'ingresso_id = {:id} && expira_em > {:now} && usado = false',
          { id: t.id, now: new Date().toISOString() },
        )
        exported.pending_link = pl.getString('token')
      } catch (err) {}
    }

    const pId = t.getString('participante_id')
    if (pId) {
      try {
        const p = $app.findRecordById('participantes', pId)
        if (!exported.expand) exported.expand = {}
        exported.expand.participante_id = JSON.parse(JSON.stringify(p.publicExport()))
      } catch (err) {}
    }

    items.push(exported)
  }

  return e.json(200, { items })
})

routerAdd('POST', '/backend/v1/buyer/tickets/{id}/invite', (e) => {
  const authHeader = e.request.header.get('Authorization') || ''
  const token = authHeader.replace('Bearer ', '').trim()
  if (!token) return e.unauthorizedError('Missing token')

  let link
  try {
    link = $app.findFirstRecordByFilter('tokens_acesso', 'token = {:t} && expira_em > {:now}', {
      t: token,
      now: new Date().toISOString(),
    })
  } catch (err) {
    return e.unauthorizedError('Invalid token')
  }

  const ticketId = e.request.pathValue('id')
  let ticket
  try {
    ticket = $app.findRecordById('ingressos', ticketId)
  } catch (err) {
    return e.notFoundError('Ticket not found')
  }

  if (ticket.getString('comprador_id') !== link.getString('comprador_id')) {
    return e.forbiddenError('Not your ticket')
  }

  const force = e.request.url.query().get('force') === 'true'
  let inviteToken

  if (!force) {
    try {
      const pl = $app.findFirstRecordByFilter(
        'links_participante',
        'ingresso_id = {:id} && expira_em > {:now} && usado = false',
        { id: ticketId, now: new Date().toISOString() },
      )
      inviteToken = pl.getString('token')
    } catch (err) {}
  }

  if (!inviteToken) {
    const linksCollection = $app.findCollectionByNameOrId('links_participante')
    const newLink = new Record(linksCollection)
    newLink.set('ingresso_id', ticketId)
    newLink.set('token', $security.randomString(32))
    const exp = new Date()
    exp.setTime(exp.getTime() + 24 * 60 * 60 * 1000)
    newLink.set('expira_em', exp.toISOString())
    newLink.set('usado', false)
    $app.save(newLink)
    inviteToken = newLink.getString('token')
  }

  return e.json(200, { token: inviteToken })
})
