// TEMPORÁRIO — busca a spec OpenAPI do BotConversa (via $http.send no backend,
// que permite setar Accept e a query ?format=openapi) e extrai os paths exatos.
// Também sonda alguns endpoints candidatos. REMOVER depois.
// Uso: /backend/v1/bc-probe
routerAdd('GET', '/backend/v1/bc-probe', (e) => {
  const key = $os.getenv('BOTCONVERSA_API_KEY') || ''

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

  const get = (url, headers) => {
    const out = { url: url, status: 0, ctype: '', body: '' }
    try {
      const res = $http.send({ url: url, method: 'GET', headers: headers || {}, timeout: 20 })
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

  const result = { key_present: key.length > 0 }

  // 1) Tenta puxar a spec OpenAPI e extrair os paths
  const specUrls = [
    'https://backend.botconversa.com.br/swagger/?format=openapi',
    'https://backend.botconversa.com.br/swagger.json',
    'https://backend.botconversa.com.br/openapi.json',
  ]
  result.spec = null
  for (let i = 0; i < specUrls.length; i++) {
    const r = get(specUrls[i], { Accept: 'application/json' })
    const looksJson = r.body && r.body.charAt(0) === '{'
    if (r.status === 200 && looksJson) {
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
          source: specUrls[i],
          title: spec.info ? spec.info.title : '',
          host: spec.host || '',
          basePath: spec.basePath || '',
          schemes: spec.schemes || [],
          servers: spec.servers || [],
          paths: summary,
        }
      } catch (err) {
        result.spec = {
          source: specUrls[i],
          parse_error: String(err),
          head: r.body.substring(0, 800),
        }
      }
      break
    } else {
      result['spec_try_' + i] = {
        url: specUrls[i],
        status: r.status,
        ctype: r.ctype,
        head: r.body.substring(0, 200),
      }
    }
  }

  return e.json(200, result)
})
