// Registra erros de JavaScript do navegador em webhooks_log. Sem isso, uma
// exceção no cliente vira tela branca e nenhum rastro no servidor.
// Rota pública de propósito: quem quebra é o visitante, não um usuário logado.
routerAdd('POST', '/backend/v1/client-error', (e) => {
  try {
    const body = e.requestInfo().body || {}
    const corta = (v, n) => (v == null ? '' : String(v).substring(0, n))

    const coll = $app.findCollectionByNameOrId('webhooks_log')
    const rec = new Record(coll)
    rec.set('evento', 'erro_navegador')
    rec.set('method', 'CLIENT')
    rec.set('status', 500)
    rec.set(
      'detalhe',
      corta(body.message || 'erro sem mensagem', 250) +
        ' — em ' +
        corta(body.url, 120) +
        (body.traduzido ? ' [PÁGINA TRADUZIDA PELO NAVEGADOR]' : ''),
    )
    rec.set(
      'payload',
      JSON.stringify({
        url: corta(body.url, 300),
        traduzido: !!body.traduzido,
        idioma: corta(body.idioma, 30),
        user_agent: corta(body.user_agent, 300),
      }),
    )
    rec.set('response', corta(body.stack, 500))
    $app.save(rec)
  } catch (_) {
    // Falha ao registrar nunca pode virar um segundo erro para o visitante.
  }

  return e.json(200, { ok: true })
})
