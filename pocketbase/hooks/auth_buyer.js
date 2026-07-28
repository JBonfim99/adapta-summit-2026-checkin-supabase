// Solicitação de magic link pelo próprio comprador (tela de login). Em vez de
// devolver o token, ENVIA o e-mail via SendGrid usando o template nomeado
// "Skip-Summit26-Magiclink-acesso" (o link já está embutido no template,
// composto com a variável {{token}}). Token válido por 60 dias.
routerAdd('POST', '/backend/v1/auth/magic-link', (e) => {
  const decodeBody = (body) => {
    if (body == null) return ''
    if (typeof body === 'string') return body
    try {
      return new TextDecoder().decode(body)
    } catch (_) {}
    try {
      let s = ''
      for (let i = 0; i < body.length; i++) s += String.fromCharCode(body[i])
      return s
    } catch (_) {}
    return ''
  }

  const body = e.requestInfo().body
  const email = body.email
  if (!email) return e.badRequestError('E-mail é obrigatório')

  // 1) Comprador. 2) Se não for, participante (quem já fez check-in recebe de
  //    volta o link do próprio ingresso). 3) Ninguém: erro explicando os dois.
  let comprador = null
  let participante = null
  try {
    comprador = $app.findFirstRecordByData('compradores', 'email', email)
  } catch (_) {
    try {
      participante = $app.findFirstRecordByData('participantes', 'email', email)
    } catch (_) {
      return e.badRequestError(
        'Não encontramos este e-mail nem na base de compradores nem na base de participantes. ' +
          'Se você recebeu o ingresso de outra pessoa, peça para quem comprou reenviar o seu link. ' +
          'Em caso de dúvida, fale com duvidas@adapta.org.',
      )
    }
  }

  const apiKey = $os.getenv('SENDGRID_API_KEY')
  if (!apiKey) return e.badRequestError('Envio de e-mail indisponível no momento.')

  const expira = new Date()
  expira.setDate(expira.getDate() + 60)

  const destinoEmail = comprador ? comprador.getString('email') : participante.getString('email')
  const destinoNome = comprador
    ? comprador.getString('nome')
    : participante.getString('nome_completo')
  const templateNome = comprador
    ? 'Skip-Summit26-Magiclink-acesso'
    : 'Skip-Summit26-Send-Participante'

  // Token: comprador -> acesso à plataforma (tokens_acesso).
  //        participante -> token do ingresso dele (links_participante).
  let tokenStr = ''
  if (comprador) {
    tokenStr = $security.randomString(40)
    const col = $app.findCollectionByNameOrId('tokens_acesso')
    const tokenRecord = new Record(col)
    tokenRecord.set('comprador_id', comprador.id)
    tokenRecord.set('token', tokenStr)
    tokenRecord.set('usado', false)
    tokenRecord.set('expira_em', expira.toISOString())
    $app.save(tokenRecord)
  } else {
    const ingressoId = participante.getString('ingresso_id')
    if (!ingressoId) {
      return e.badRequestError(
        'Encontramos o seu cadastro, mas ele não está ligado a nenhum ingresso. ' +
          'Fale com duvidas@adapta.org.',
      )
    }
    try {
      const link = $app.findFirstRecordByFilter('links_participante', 'ingresso_id = {:iid}', {
        iid: ingressoId,
      })
      tokenStr = link.getString('token')
    } catch (_) {
      tokenStr = $security.randomString(40)
      const linkColl = $app.findCollectionByNameOrId('links_participante')
      const lr = new Record(linkColl)
      lr.set('ingresso_id', ingressoId)
      lr.set('token', tokenStr)
      lr.set('usado', false)
      lr.set('expira_em', expira.toISOString())
      $app.save(lr)
    }
  }

  // Resolve o ID do template pelo nome.
  let templateId = ''
  try {
    const resT = $http.send({
      url: 'https://api.sendgrid.com/v3/templates?generations=dynamic&page_size=200',
      method: 'GET',
      headers: { Authorization: 'Bearer ' + apiKey },
      timeout: 20,
    })
    let parsed = {}
    try {
      parsed = JSON.parse(decodeBody(resT.body))
    } catch (_) {}
    const list = parsed.result || parsed.templates || []
    for (const t of list) {
      if (t && t.name && t.name.trim() === templateNome) {
        templateId = t.id
        break
      }
    }
  } catch (_) {}

  if (!templateId) {
    return e.badRequestError(
      'Não foi possível enviar o e-mail agora. Tente novamente em instantes.',
    )
  }

  // Envia.
  let status = 0
  try {
    const res = $http.send({
      url: 'https://api.sendgrid.com/v3/mail/send',
      method: 'POST',
      headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: { email: 'duvidas@adapta.org', name: 'Adapta Summit 2026' },
        template_id: templateId,
        personalizations: [
          {
            to: [{ email: destinoEmail, name: destinoNome }],
            dynamic_template_data: {
              token: tokenStr,
              firstname: (destinoNome.split(' ')[0] || destinoNome || '').trim(),
            },
          },
        ],
      }),
      timeout: 30,
    })
    status = res.statusCode
  } catch (_) {
    return e.badRequestError(
      'Não foi possível enviar o e-mail agora. Tente novamente em instantes.',
    )
  }

  if (status < 200 || status >= 300) {
    return e.badRequestError(
      'Não foi possível enviar o e-mail agora. Tente novamente em instantes.',
    )
  }

  return e.json(200, { sent: true })
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

  const expiraEm = new Date(tokenRecord.getString('expira_em'))
  if (expiraEm < new Date()) {
    return e.badRequestError('Token expirado')
  }

  // OBS: o token NÃO é marcado como `usado` aqui de propósito. Ele é reutilizado
  // como bearer de sessão por /buyer/tickets e /invite (que validam só token +
  // expira_em). A validade efetiva é a expiração.
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
