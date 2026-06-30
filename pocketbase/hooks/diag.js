// TEMPORÁRIO — diagnóstico dos ingressos com erro de webhook. Não expõe PII crua.
// REMOVER após análise.
routerAdd('GET', '/backend/v1/diag-erros', (e) => {
  const onlyDigits = (s) => (s || '').replace(/\D/g, '')
  const norm = (s) => (s || '').toString().substring(0, 200)

  const cpfValido = (raw) => {
    const cpf = onlyDigits(raw)
    if (cpf.length !== 11) return false
    let allSame = true
    for (let i = 1; i < 11; i++) {
      if (cpf.charAt(i) !== cpf.charAt(0)) {
        allSame = false
        break
      }
    }
    if (allSame) return false
    let sum = 0
    for (let i = 0; i < 9; i++) sum += parseInt(cpf.charAt(i), 10) * (10 - i)
    let d1 = 11 - (sum % 11)
    if (d1 >= 10) d1 = 0
    if (d1 !== parseInt(cpf.charAt(9), 10)) return false
    sum = 0
    for (let i = 0; i < 10; i++) sum += parseInt(cpf.charAt(i), 10) * (11 - i)
    let d2 = 11 - (sum % 11)
    if (d2 >= 10) d2 = 0
    if (d2 !== parseInt(cpf.charAt(10), 10)) return false
    return true
  }

  // Mapa: cpf (dígitos) -> qtde de ingressos JÁ credenciados (inac_id) com esse cpf.
  const credMap = {}
  try {
    const cred = $app.findRecordsByFilter('ingressos', "inac_id != ''", '-created', 5000, 0)
    for (let i = 0; i < cred.length; i++) {
      const pid = cred[i].getString('participante_id')
      if (!pid) continue
      try {
        const p = $app.findRecordById('participantes', pid)
        const c = onlyDigits(p.getString('cpf'))
        if (c) credMap[c] = (credMap[c] || 0) + 1
      } catch (_) {}
    }
  } catch (_) {}

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
      }
    } catch (_) {}

    let cpfLen = 0
    let cpfOk = false
    let dupCred = 0
    let telLen = 0
    let tel55 = false
    if (part) {
      const cpfDigits = onlyDigits(part.getString('cpf'))
      cpfLen = cpfDigits.length
      cpfOk = cpfValido(cpfDigits)
      dupCred = credMap[cpfDigits] || 0
      let tel = onlyDigits(part.getString('telefone'))
      telLen = tel.length
      if (tel && tel.length <= 11) tel = '55' + tel
      tel55 = tel.indexOf('55') === 0
    }

    const key = 'HTTP ' + httpStatus + ' | ' + norm(resp).substring(0, 90)
    byResponse[key] = (byResponse[key] || 0) + 1

    items.push({
      pedido_id: ing.getString('pedido_id'),
      tipo: ing.getString('tipo_ingresso'),
      http: httpStatus,
      response: norm(resp),
      cpf_len: cpfLen,
      cpf_valido: cpfOk,
      dup_cpf_credenciado: dupCred,
      tel_len: telLen,
      tel_55: tel55,
    })
  }

  const byResponseArr = []
  for (const k in byResponse) byResponseArr.push({ resp: k, count: byResponse[k] })
  byResponseArr.sort((a, b) => b.count - a.count)

  return e.json(200, { total_erro: totalErro, por_resposta: byResponseArr, itens: items })
})
