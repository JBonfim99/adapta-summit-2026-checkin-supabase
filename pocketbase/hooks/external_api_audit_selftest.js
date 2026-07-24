// ARQUIVO TEMPORÁRIO DE TESTE — remover antes de publicar de vez.
// Verifica que o endpoint de reenvio grava a auditoria em webhooks_log.
cronAdd('external_api_audit_selftest', '* * * * *', () => {
  const BASE = 'https://adapta-summit-2026-d2d58.shrd00.internal.goskip.dev'
  const KEY = 'summit26_sgzef29bc7sykc55e5b8prffzgqgaldc7ctxdnl7'

  try {
    $http.send({
      url: BASE + '/backend/v1/external/reenviar-comprador',
      method: 'POST',
      headers: { 'X-Api-Key': KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ comprador_id: 'mzano03pwa3z2b5' }),
      timeout: 20,
    })
  } catch (err) {
    console.log('EXTERNAL_API_AUDIT_SELFTEST: falha ao chamar endpoint - ' + err.message)
    return
  }

  let logs = []
  try {
    logs = $app.findRecordsByFilter(
      'webhooks_log',
      "evento = 'api_reenvio_comprador'",
      '-created',
      3,
      0,
    )
  } catch (_) {}

  const resumo = logs.map((l) => ({
    id: l.id,
    evento: l.getString('evento'),
    detalhe: l.getString('detalhe'),
    created: l.getString('created'),
  }))

  console.log(
    'EXTERNAL_API_AUDIT_SELFTEST: ' + JSON.stringify({ encontrados: logs.length, logs: resumo }),
  )
})
