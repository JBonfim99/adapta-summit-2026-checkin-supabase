// ARQUIVO TEMPORÁRIO DE TESTE — remover antes de publicar de vez.
// Roda uma vez (próximo tick do cron) e testa os 6 endpoints da API externa
// chamando o próprio backend via HTTP (exatamente como um chamador de fora
// faria), logando o resultado consolidado via console.log.
cronAdd('external_api_selftest_once', '* * * * *', () => {
  const BASE = 'https://adapta-summit-2026-d2d58.shrd00.internal.goskip.dev'
  const KEY = 'summit26_sgzef29bc7sykc55e5b8prffzgqgaldc7ctxdnl7'

  const decodeBody = (body) => {
    if (body == null) return ''
    if (typeof body === 'string') return body
    let bytes
    try {
      bytes = new Uint8Array(body)
    } catch (_) {
      bytes = body
    }
    let result = ''
    let i = 0
    const len = bytes.length
    while (i < len) {
      const b1 = bytes[i++]
      if (b1 < 0x80) {
        result += String.fromCharCode(b1)
      } else if ((b1 & 0xe0) === 0xc0 && i < len) {
        const b2 = bytes[i++]
        result += String.fromCharCode(((b1 & 0x1f) << 6) | (b2 & 0x3f))
      } else if ((b1 & 0xf0) === 0xe0 && i + 1 < len) {
        const b2 = bytes[i++]
        const b3 = bytes[i++]
        result += String.fromCharCode(((b1 & 0x0f) << 12) | ((b2 & 0x3f) << 6) | (b3 & 0x3f))
      } else if ((b1 & 0xf8) === 0xf0 && i + 2 < len) {
        const b2 = bytes[i++]
        const b3 = bytes[i++]
        const b4 = bytes[i++]
        let cp = ((b1 & 0x07) << 18) | ((b2 & 0x3f) << 12) | ((b3 & 0x3f) << 6) | (b4 & 0x3f)
        cp -= 0x10000
        result += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff))
      } else {
        // ignora byte inválido
      }
    }
    return result
  }

  const call = (method, path, headers, bodyObj) => {
    try {
      const res = $http.send({
        url: BASE + path,
        method: method,
        headers: headers || {},
        body: bodyObj ? JSON.stringify(bodyObj) : '',
        timeout: 20,
      })
      const txt = decodeBody(res.body)
      let json = null
      try {
        json = JSON.parse(txt)
      } catch (_) {}
      return { status: res.statusCode, json: json, raw: json ? undefined : txt.substring(0, 200) }
    } catch (err) {
      return { status: 0, error: err.message }
    }
  }

  const results = {}

  // 1) Auth: chave errada em cada um dos 6 -> espera 401
  const rotas = [
    ['GET', '/backend/v1/external/compradores'],
    ['GET', '/backend/v1/external/participantes'],
    ['POST', '/backend/v1/external/compradores'],
    ['POST', '/backend/v1/external/credenciamento'],
    ['POST', '/backend/v1/external/reenviar-comprador'],
    ['POST', '/backend/v1/external/reenviar-participante'],
  ]
  results.auth_401 = {}
  for (const [m, p] of rotas) {
    const r = call(
      m,
      p,
      { 'X-Api-Key': 'chave-errada', 'Content-Type': 'application/json' },
      m === 'POST' ? {} : null,
    )
    results.auth_401[p] = { status: r.status, ok_esperado_401: r.status === 401 }
  }

  const AUTH = { 'X-Api-Key': KEY, 'Content-Type': 'application/json' }

  // 2) GET compradores (leitura, sem filtro)
  results.get_compradores = call('GET', '/backend/v1/external/compradores?perPage=1', AUTH)

  // 3) GET participantes (leitura, sem filtro)
  results.get_participantes = call('GET', '/backend/v1/external/participantes?perPage=1', AUTH)

  // 4) POST compradores — validação (sem email) -> espera 400
  results.post_compradores_validacao = call('POST', '/backend/v1/external/compradores', AUTH, {
    qtd_gold: 1,
  })

  // 5) POST compradores — validação (sem quantidade) -> espera 400
  results.post_compradores_sem_qtd = call('POST', '/backend/v1/external/compradores', AUTH, {
    email: 'teste.api.claude.pode.apagar@adapta.org',
  })

  // 6) POST compradores — happy path, dado de teste claramente marcado (1 GOLD)
  const testeEmail = 'teste.api.claude.pode.apagar@adapta.org'
  const criar = call('POST', '/backend/v1/external/compradores', AUTH, {
    nome: 'TESTE API CLAUDE - PODE APAGAR',
    email: testeEmail,
    qtd_gold: 1,
    qtd_platinum: 0,
  })
  results.post_compradores_happy_path = criar

  // 7) POST reenviar-comprador — usando o comprador de teste recém-criado
  if (criar.json && criar.json.comprador_id) {
    results.post_reenviar_comprador = call(
      'POST',
      '/backend/v1/external/reenviar-comprador',
      AUTH,
      { comprador_id: criar.json.comprador_id },
    )
  } else {
    results.post_reenviar_comprador = { skipped: true, motivo: 'comprador de teste não foi criado' }
  }

  // 8) POST reenviar-comprador — não encontrado -> espera 404
  results.post_reenviar_comprador_404 = call(
    'POST',
    '/backend/v1/external/reenviar-comprador',
    AUTH,
    { comprador_id: 'idquenaoexiste123' },
  )

  // 9) POST reenviar-participante — não encontrado -> espera 404
  results.post_reenviar_participante_404 = call(
    'POST',
    '/backend/v1/external/reenviar-participante',
    AUTH,
    { participante_id: 'idquenaoexiste123' },
  )

  // 10) POST credenciamento — sem pedido_id/ingresso_id -> espera 400
  results.post_credenciamento_validacao = call(
    'POST',
    '/backend/v1/external/credenciamento',
    AUTH,
    { nome_completo: 'Teste' },
  )

  // 11) POST credenciamento — pedido_id inexistente -> espera 404
  results.post_credenciamento_404 = call('POST', '/backend/v1/external/credenciamento', AUTH, {
    pedido_id: '000000',
    nome_completo: 'Teste',
    email: 'x@x.com',
    cpf: '00000000000',
  })

  // 12) POST credenciamento — usando o pedido_id do ingresso de teste recém-criado,
  //     MAS com CPF inválido de propósito -> só testa validação, NÃO credencia de
  //     verdade (evita criar um attendee real na INAC por causa de um teste).
  if (criar.json && criar.json.ingressos && criar.json.ingressos[0]) {
    results.post_credenciamento_validacao_cpf = call(
      'POST',
      '/backend/v1/external/credenciamento',
      AUTH,
      {
        pedido_id: criar.json.ingressos[0].pedido_id,
        nome_completo: 'Teste API Claude',
        email: testeEmail,
        cpf: '123', // inválido de propósito
      },
    )
  }

  console.log('EXTERNAL_API_SELFTEST: ' + JSON.stringify(results))
})
