routerAdd('POST', '/backend/v1/auth/magic-link', (e) => {
  const body = e.requestInfo().body
  const email = body.email
  if (!email) return e.badRequestError('Email is required')

  try {
    const comprador = $app.findFirstRecordByData('compradores', 'email', email)
    const tokensColl = $app.findCollectionByNameOrId('tokens_acesso')
    const record = new Record(tokensColl)
    const tokenStr = $security.randomString(32)

    record.set('comprador_id', comprador.id)
    record.set('token', tokenStr)
    record.set('usado', false)
    const expiry = new Date()
    expiry.setHours(expiry.getHours() + 24)
    record.set('expira_em', expiry.toISOString())

    $app.save(record)
    $app.logger().info('Magic Link generated', 'email', email, 'token', tokenStr)

    return e.json(200, { success: true, token: tokenStr })
  } catch (_) {
    return e.badRequestError(
      'Comprador não encontrado. Certifique-se de que o e-mail foi importado pelo administrador.',
    )
  }
})

routerAdd('POST', '/backend/v1/auth/magic-link/consume', (e) => {
  const body = e.requestInfo().body
  const token = body.token
  if (!token) return e.badRequestError('Token is required')

  try {
    const record = $app.findFirstRecordByData('tokens_acesso', 'token', token)
    if (record.getBool('usado')) return e.badRequestError('Token já foi utilizado')
    if (new Date(record.getString('expira_em')) < new Date())
      return e.badRequestError('Token expirado')

    record.set('usado', true)
    $app.save(record)

    const compradorId = record.getString('comprador_id')
    const comprador = $app.findRecordById('compradores', compradorId)

    const jwt = $security.createJWT(
      { comprador_id: compradorId },
      'SKIP_BUYER_SECRET_KEY',
      86400 * 30,
    )

    return e.json(200, {
      token: jwt,
      comprador: {
        id: comprador.id,
        nome: comprador.getString('nome'),
        email: comprador.getString('email'),
      },
    })
  } catch (_) {
    return e.badRequestError('Token inválido ou inexistente')
  }
})
