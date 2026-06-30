// TEMPORÁRIO — sonda a API do BotConversa pra eu confirmar os shapes (flows,
// custom fields, detalhe de fluxo). Público de propósito (só pra leitura do
// retorno; não expõe dados de usuário nosso). REMOVER após o mapeamento ficar pronto.
// Uso: /backend/v1/bc-probe            -> lista flows + custom_fields
//      /backend/v1/bc-probe?flow=123   -> + detalhe do fluxo 123
routerAdd('GET', '/backend/v1/bc-probe', (e) => {
  const key = $os.getenv('BOTCONVERSA_API_KEY')
  if (!key) {
    return e.json(200, { error: 'BOTCONVERSA_API_KEY não configurada no ambiente.' })
  }

  const decodeBody = (b) => {
    if (b == null) return ''
    if (typeof b === 'string') return b
    try {
      return new TextDecoder().decode(b)
    } catch (_) {}
    try {
      let s = ''
      for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i])
      return s
    } catch (_) {}
    return ''
  }

  const base = 'https://backend.botconversa.com.br/api/v1/webhooks'
  const probe = (url) => {
    const out = { url: url, status: 0, body: '' }
    try {
      const res = $http.send({
        url: url,
        method: 'GET',
        headers: { 'API-KEY': key, 'Content-Type': 'application/json' },
        timeout: 15,
      })
      out.status = res.statusCode
      out.body = decodeBody(res.body).substring(0, 4000)
    } catch (err) {
      out.body = 'ERRO: ' + (err && err.message ? err.message : 'falha')
    }
    return out
  }

  const result = {
    flows: probe(base + '/flows/'),
    custom_fields: probe(base + '/custom_fields/'),
  }

  let flowId = ''
  try {
    flowId = (e.request.url.query().get('flow') || '').toString().replace(/[^0-9a-zA-Z_-]/g, '')
  } catch (_) {}
  if (flowId) {
    result.flow_detail = probe(base + '/flows/' + flowId + '/')
  }

  return e.json(200, result)
})
