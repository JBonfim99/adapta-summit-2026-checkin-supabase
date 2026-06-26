// Valida o link de credenciamento. Se já foi usado (participante já preencheu),
// retorna usado:true para o front redirecionar à página de detalhes do ingresso
// em vez de mostrar erro. Só erra de fato se o link não existe ou expirou.
routerAdd('GET', '/backend/v1/participant/link/{token}', (e) => {
  const token = e.request.pathValue('token')
  try {
    const link = $app.findFirstRecordByData('links_participante', 'token', token)
    if (new Date(link.getString('expira_em')) < new Date()) {
      return e.badRequestError('Link inválido ou expirado')
    }
    const ingresso = $app.findRecordById('ingressos', link.getString('ingresso_id'))
    return e.json(200, {
      ingresso_id: ingresso.id,
      tipo_ingresso: ingresso.getString('tipo_ingresso'),
      usado: link.getBool('usado'),
    })
  } catch (err) {
    return e.badRequestError('Link não encontrado')
  }
})

// Detalhes do ingresso (read-only) a partir do token do ingresso. Resolve mesmo
// com o link já 'usado' — o objetivo aqui é VER os dados, não preencher.
routerAdd('GET', '/backend/v1/participant/ticket/{token}', (e) => {
  const token = e.request.pathValue('token')
  try {
    const link = $app.findFirstRecordByData('links_participante', 'token', token)
    if (new Date(link.getString('expira_em')) < new Date()) {
      return e.badRequestError('Link expirado')
    }
    const ingresso = $app.findRecordById('ingressos', link.getString('ingresso_id'))

    let participante = null
    const pid = ingresso.getString('participante_id')
    if (pid) {
      try {
        const p = $app.findRecordById('participantes', pid)
        participante = {
          nome_completo: p.getString('nome_completo'),
          email: p.getString('email'),
          cpf: p.getString('cpf'),
          telefone: p.getString('telefone'),
          nome_empresa: p.getString('nome_empresa'),
          cargo: p.getString('cargo'),
        }
      } catch (_) {}
    }

    return e.json(200, {
      tipo_ingresso: ingresso.getString('tipo_ingresso'),
      status: ingresso.getString('status'),
      pedido_id: ingresso.getString('pedido_id'),
      preenchido: !!participante,
      participante: participante,
    })
  } catch (err) {
    return e.badRequestError('Ingresso não encontrado')
  }
})

routerAdd('POST', '/backend/v1/participant/submit', (e) => {
  const body = e.requestInfo().body
  const token = body.token

  try {
    $app.runInTransaction((txApp) => {
      const link = txApp.findFirstRecordByData('links_participante', 'token', token)
      if (link.getBool('usado') || new Date(link.getString('expira_em')) < new Date()) {
        throw new Error('Link inválido ou expirado')
      }

      const ingresso = txApp.findRecordById('ingressos', link.getString('ingresso_id'))

      const partColl = txApp.findCollectionByNameOrId('participantes')
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

      txApp.save(part)

      ingresso.set('participante_id', part.id)
      ingresso.set('status', 'Pré-Credenciado')
      ingresso.set('preenchido_em', new Date().toISOString())
      txApp.save(ingresso)

      link.set('usado', true)
      txApp.save(link)
    })

    return e.json(200, { success: true })
  } catch (err) {
    return e.badRequestError(err.message)
  }
})
