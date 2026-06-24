routerAdd('GET', '/backend/v1/participant/link/{token}', (e) => {
  const token = e.request.pathValue('token')

  try {
    const link = $app.findFirstRecordByData('links_participante', 'token', token)
    if (link.getBool('usado')) {
      return e.badRequestError('Este link já foi usado.')
    }
    const now = new Date()
    const expiresAt = new Date(link.getString('expira_em'))
    if (now > expiresAt) {
      return e.badRequestError('Este link expirou.')
    }

    const ingresso = $app.findRecordById('ingressos', link.getString('ingresso_id'))

    return e.json(200, {
      id: ingresso.id,
      tipo_ingresso: ingresso.getString('tipo_ingresso'),
      status: ingresso.getString('status'),
    })
  } catch (err) {
    return e.badRequestError('Link inválido ou não encontrado.')
  }
})

routerAdd('POST', '/backend/v1/participant/submit', (e) => {
  const body = e.requestInfo().body || {}
  const {
    token,
    nome_completo,
    email,
    cpf,
    telefone,
    nome_empresa,
    cargo,
    nicho,
    num_funcionarios,
    faturamento_anual,
    areas_ajuda,
    expectativa_aprendizado,
    expectativa_experiencia,
  } = body

  if (!token) return e.badRequestError('Token não fornecido.')

  try {
    return $app.runInTransaction((txApp) => {
      const link = txApp.findFirstRecordByData('links_participante', 'token', token)

      if (link.getBool('usado')) {
        throw new BadRequestError('Este link já foi utilizado.')
      }

      const now = new Date()
      const expiresAt = new Date(link.getString('expira_em'))
      if (now > expiresAt) {
        throw new BadRequestError('Este link expirou.')
      }

      const ingresso = txApp.findRecordById('ingressos', link.getString('ingresso_id'))

      if (ingresso.getString('status') === 'preenchido') {
        throw new BadRequestError('Este ingresso já foi preenchido.')
      }

      // Create the participant
      const participantesCol = txApp.findCollectionByNameOrId('participantes')
      const participante = new Record(participantesCol)

      participante.set('nome_completo', nome_completo)
      participante.set('email', email)
      participante.set('cpf', cpf)
      participante.set('telefone', telefone)
      participante.set('nome_empresa', nome_empresa)
      participante.set('cargo', cargo)
      participante.set('nicho', nicho)
      participante.set('num_funcionarios', num_funcionarios)
      participante.set('faturamento_anual', faturamento_anual)
      participante.set('areas_ajuda', areas_ajuda || [])
      participante.set('expectativa_aprendizado', expectativa_aprendizado)
      participante.set('expectativa_experiencia', expectativa_experiencia)
      participante.set('ingresso_id', ingresso.id)

      txApp.save(participante)

      // Update the ticket to lock it
      ingresso.set('status', 'preenchido')
      ingresso.set('participante_id', participante.id)
      ingresso.set('preenchido_em', new Date().toISOString())
      txApp.save(ingresso)

      // Invalidate the token
      link.set('usado', true)
      txApp.save(link)

      return e.json(200, { success: true })
    })
  } catch (err) {
    if (err instanceof BadRequestError) {
      throw err
    }
    $app.logger().error('Erro ao salvar participante', 'error', err.message)
    return e.internalServerError('Ocorreu um erro ao processar seus dados.')
  }
})
