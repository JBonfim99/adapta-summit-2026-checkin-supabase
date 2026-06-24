routerAdd('POST', '/backend/v1/participant/submit', (e) => {
  const body = e.requestInfo().body
  const token = body.token

  if (!token) return e.badRequestError('Missing token')

  let link
  try {
    link = $app.findFirstRecordByFilter('links_participante', 'token = {:t} && usado = false', {
      t: token,
    })
  } catch (err) {
    return e.badRequestError('Token inválido ou já usado')
  }

  const ticketId = link.getString('ingresso_id')
  let ticket
  try {
    ticket = $app.findRecordById('ingressos', ticketId)
  } catch (err) {
    return e.badRequestError('Ingresso não encontrado')
  }

  $app.runInTransaction((txApp) => {
    let p
    const pId = ticket.getString('participante_id')
    if (pId) {
      try {
        p = txApp.findRecordById('participantes', pId)
      } catch (err) {}
    }

    if (!p) {
      const participantes = txApp.findCollectionByNameOrId('participantes')
      p = new Record(participantes)
    }

    p.set('nome_completo', body.nome_completo || '')
    p.set('email', body.email || '')
    p.set('cpf', body.cpf || '')
    p.set('telefone', body.telefone || '')
    p.set('nome_empresa', body.nome_empresa || '')
    p.set('cargo', body.cargo || '')
    p.set('nicho', body.nicho || '')
    p.set('num_funcionarios', body.num_funcionarios || '')
    p.set('faturamento_anual', body.faturamento_anual || '')
    p.set('areas_ajuda', body.areas_ajuda || [])
    p.set('expectativa_aprendizado', body.expectativa_aprendizado || '')
    p.set('expectativa_experiencia', body.expectativa_experiencia || '')
    p.set('ingresso_id', ticketId)

    txApp.save(p)

    ticket.set('participante_id', p.id)
    if (ticket.getString('status') === 'pendente') {
      ticket.set('status', 'preenchido')
      ticket.set('preenchido_em', new Date().toISOString())
    }
    txApp.save(ticket)

    link.set('usado', true)
    txApp.save(link)
  })

  return e.json(200, { success: true })
})

routerAdd('GET', '/backend/v1/participant/link/{token}', (e) => {
  const token = e.request.pathValue('token')
  let link
  try {
    link = $app.findFirstRecordByFilter(
      'links_participante',
      'token = {:t} && usado = false && expira_em > {:now}',
      { t: token, now: new Date().toISOString() },
    )
  } catch (err) {
    return e.badRequestError('Token inválido ou expirado')
  }

  let ticket
  try {
    ticket = $app.findRecordById('ingressos', link.getString('ingresso_id'))
  } catch (err) {
    return e.badRequestError('Ingresso não encontrado')
  }

  return e.json(200, {
    tipo_ingresso: ticket.getString('tipo_ingresso'),
    pedido_id: ticket.getString('pedido_id'),
  })
})
