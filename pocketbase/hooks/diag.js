// TEMPORÁRIO — diagnóstico dos ingressos com erro de webhook. Não expõe PII crua
// (só domínio do email, tamanhos e flags). REMOVER após análise.
routerAdd('GET', '/backend/v1/diag-erros', (e) => {
  const onlyDigits = (s) => (s || '').replace(/\D/g, '')
  const norm = (s) => (s || '').toString().substring(0, 200)

  let ings = []
  try {
    ings = $app.findRecordsByFilter('ingressos', "status_webhook = 'erro'", '-created', 300, 0)
  } catch (_) {}

  const items = []
  const byResponse = {}
  let totalErro = 0

  for (let i = 0; i < ings.length; i++) {
    const ing = ings[i]
    if (ing.getString('inac_id')) continue
    totalErro++

    let part = null
    const partId = ing.getString('participante_id')
    if (partId) {
      try {
        part = $app.findRecordById('participantes', partId)
      } catch (_) {}
    }

    let resp = ''
    let httpStatus = 0
    let detalhe = ''
    try {
      const logs = $app.findRecordsByFilter(
        'webhooks_log',
        'ingresso_id = {:id}',
        '-created',
        1,
        0,
        { id: ing.id },
      )
      if (logs && logs.length) {
        resp = logs[0].getString('response')
        httpStatus = parseInt(logs[0].get('status'), 10) || 0
        detalhe = logs[0].getString('detalhe')
      }
    } catch (_) {}

    let cpfLen = 0
    let telLen = 0
    let tel55 = false
    let emailOk = false
    let emailDom = ''
    let nomePalavras = 0
    let temEmpresa = false
    let empresaVazia = true
    let profissaoVazia = true
    let nichoVazio = true
    let cargoVazio = true
    const semParticipante = !part

    if (part) {
      const cpf = onlyDigits(part.getString('cpf'))
      cpfLen = cpf.length
      let tel = onlyDigits(part.getString('telefone'))
      telLen = tel.length
      if (tel && tel.length <= 11) tel = '55' + tel
      tel55 = tel.indexOf('55') === 0
      const email = part.getString('email')
      emailOk = email.indexOf('@') > 0
      emailDom = emailOk ? email.split('@')[1] : ''
      const nome = part.getString('nome_completo')
      nomePalavras = nome.trim() ? nome.trim().split(/\s+/).length : 0
      temEmpresa = part.getBool('tem_empresa')
      empresaVazia = !part.getString('nome_empresa')
      profissaoVazia = !part.getString('profissao')
      nichoVazio = !part.getString('nicho')
      cargoVazio = !part.getString('cargo')
    }

    const key = 'HTTP ' + httpStatus + ' | ' + norm(resp).substring(0, 90)
    byResponse[key] = (byResponse[key] || 0) + 1

    items.push({
      pedido_id: ing.getString('pedido_id'),
      tipo: ing.getString('tipo_ingresso'),
      http: httpStatus,
      detalhe: detalhe,
      response: norm(resp),
      sem_participante: semParticipante,
      tem_empresa: temEmpresa,
      empresa_vazia: empresaVazia,
      profissao_vazia: profissaoVazia,
      nicho_vazio: nichoVazio,
      cargo_vazio: cargoVazio,
      cpf_len: cpfLen,
      tel_len: telLen,
      tel_55: tel55,
      email_ok: emailOk,
      email_dom: emailDom,
      nome_palavras: nomePalavras,
    })
  }

  const byResponseArr = []
  for (const k in byResponse) byResponseArr.push({ resp: k, count: byResponse[k] })
  byResponseArr.sort((a, b) => b.count - a.count)

  return e.json(200, { total_erro: totalErro, por_resposta: byResponseArr, itens: items })
})
