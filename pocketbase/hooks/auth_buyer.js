routerAdd('POST', '/backend/v1/auth/magic-link', (e) => {
  const body = e.requestInfo().body
  const email = body.email
  if (!email) return e.badRequestError('E-mail é obrigatório')

  let comprador
  try {
    comprador = $app.findFirstRecordByData('compradores', 'email', email)
  } catch (_) {
    return e.badRequestError('Comprador não encontrado')
  }

  const tokenStr = $security.randomString(32)
  const col = $app.findCollectionByNameOrId('tokens_acesso')
  const tokenRecord = new Record(col)
  tokenRecord.set('comprador_id', comprador.id)
  tokenRecord.set('token', tokenStr)
  tokenRecord.set('usado', false)

  const expira = new Date()
  expira.setHours(expira.getHours() + 24)
  tokenRecord.set('expira_em', expira.toISOString())

  $app.save(tokenRecord)

  return e.json(200, { token: tokenStr })
})

routerAdd('POST', '/backend/v1/auth/magic-link/consume', (e) => {
  const body = e.requestInfo().body
  const token = body.token
  if (!token) return e.badRequestError('Token é obrigatório')

  let tokenRecord
  try {
    tokenRecord = $app.findFirstRecordByData('tokens_acesso', 'token', token)
  } catch (_) {
    return e.badRequestError('Token inválido')
  }

  if (tokenRecord.getBool('usado')) {
    return e.badRequestError('Token já utilizado')
  }

  const expiraEm = new Date(tokenRecord.getString('expira_em'))
  if (expiraEm < new Date()) {
    return e.badRequestError('Token expirado')
  }

  tokenRecord.set('usado', true)
  $app.save(tokenRecord)

  const comprador = $app.findRecordById('compradores', tokenRecord.getString('comprador_id'))

  return e.json(200, {
    token: token,
    comprador: {
      id: comprador.id,
      nome: comprador.getString('nome'),
      email: comprador.getString('email'),
    },
  })
})
