routerAdd('GET', '/backend/v1/participant/link/{token}', (e) => {
  const token = e.request.pathValue('token')
  try {
    const record = $app.findFirstRecordByData('links_participante', 'token', token)
    if (record.getBool('usado')) return e.badRequestError('Link já foi utilizado')
    if (new Date(record.getString('expira_em')) < new Date())
      return e.badRequestError('Link expirado')

    const ingresso = $app.findRecordById('ingressos', record.getString('ingresso_id'))

    return e.json(200, {
      ingresso_id: ingresso.id,
      tipo_ingresso: ingresso.getString('tipo_ingresso'),
      status: ingresso.getString('status'),
    })
  } catch (_) {
    return e.badRequestError('Link inválido')
  }
})

routerAdd('POST', '/backend/v1/participant/submit', (e) => {
  const body = e.requestInfo().body
  const token = body.token

  try {
    const link = $app.findFirstRecordByData('links_participante', 'token', token)
    if (link.getBool('usado')) return e.badRequestError('Link já utilizado')
    if (new Date(link.getString('expira_em')) < new Date())
      return e.badRequestError('Link expirado')

    const ingresso = $app.findRecordById('ingressos', link.getString('ingresso_id'))
    if (
      ingresso.getString('status') !== 'pendente' &&
      ingresso.getString('status') !== 'erro_webhook'
    ) {
      return e.badRequestError('Ingresso já processado')
    }

    const partColl = $app.findCollectionByNameOrId('participantes')
    const part = new Record(partColl)

    part.set('ingresso_id', ingresso.id)
    part.set('nome_completo', body.nome_completo)
    part.set('email', body.email)
    part.set('cpf', body.cpf)
    part.set('telefone', body.telefone)
    part.set('nome_empresa', body.nome_empresa)
    part.set('cargo', body.cargo)
    part.set('nicho', body.nicho)
    part.set('num_funcionarios', body.num_funcionarios)
    part.set('faturamento_anual', body.faturamento_anual)
    part.set('areas_ajuda', body.areas_ajuda || [])
    part.set('expectativa_aprendizado', body.expectativa_aprendizado || '')
    part.set('expectativa_experiencia', body.expectativa_experiencia || '')

    $app.runInTransaction((txApp) => {
      txApp.save(part)

      ingresso.set('participante_id', part.id)
      ingresso.set('status', 'preenchido')
      ingresso.set('preenchido_em', new Date().toISOString())
      txApp.save(ingresso)

      link.set('usado', true)
      txApp.save(link)
    })

    return e.json(200, { success: true })
  } catch (err) {
    return e.badRequestError('Falha ao salvar dados: ' + err.message)
  }
})
