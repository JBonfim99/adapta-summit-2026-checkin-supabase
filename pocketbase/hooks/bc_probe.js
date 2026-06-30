// TEMPORÁRIO — busca a spec OpenAPI do BotConversa com o Accept correto
// (drf-yasg serve como application/openapi+json) e extrai os paths exatos.
// REMOVER depois.  Uso: /backend/v1/bc-probe
routerAdd('GET', '/backend/v1/bc-probe', (e) => {
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

  const get = (url, accept) => {
    const out = { url: url, accept: accept, status: 0, ctype: '', body: '' }
    try {
      const res = $http.send({ url: url, method: 'GET', headers: { Accept: accept }, timeout: 20 })
      out.status = res.statusCode
      try {
        out.ctype = res.headers && res.headers['Content-Type'] ? res.headers['Content-Type'][0] : ''
      } catch (_) {}
      out.body = decodeBody(res.body)
    } catch (err) {
      out.body = 'ERRO: ' + (err && err.message ? err.message : 'falha')
    }
    return out
  }

  const url = 'https://backend.botconversa.com.br/swagger/?format=openapi'
  const accepts = ['application/openapi+json', '*/*', 'application/json, */*']

  const result = {}
  for (let i = 0; i < accepts.length; i++) {
    const r = get(url, accepts[i])
    if (r.status === 200 && r.body && r.body.charAt(0) === '{') {
      try {
        const spec = JSON.parse(r.body)
        const paths = spec.paths || {}
        const keys = Object.keys(paths)
        const summary = []
        for (let k = 0; k < keys.length; k++) {
          const methods = Object.keys(paths[keys[k]] || {})
          summary.push(methods.join(',').toUpperCase() + '  ' + keys[k])
        }
        result.spec = {
          accept_used: accepts[i],
          title: spec.info ? spec.info.title : '',
          host: spec.host || '',
          basePath: spec.basePath || '',
          schemes: spec.schemes || [],
          paths: summary,
        }
      } catch (err) {
        result.parse_error = String(err)
        result.head = r.body.substring(0, 1000)
      }
      break
    } else {
      result['try_' + i] = {
        accept: accepts[i],
        status: r.status,
        ctype: r.ctype,
        head: r.body.substring(0, 150),
      }
    }
  }

  return e.json(200, result)
})
