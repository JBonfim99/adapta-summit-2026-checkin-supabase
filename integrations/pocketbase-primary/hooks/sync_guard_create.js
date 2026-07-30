onRecordCreate(
  (e) => {
    let writesBlocked = false
    try {
      const control = $app.findFirstRecordByFilter('sync_control', "id != ''")
      writesBlocked = control.getBool('block_writes')
    } catch (_) {}
    if (writesBlocked) {
      throw new ForbiddenError('O Skip esta em modo somente leitura. Use o fallback Supabase.')
    }
    e.next()
  },
  'compradores',
  'ingressos',
  'participantes',
  'tokens_acesso',
  'links_participante',
  'webhooks_log',
  'disparos',
  'envios',
  'pedidos_guru',
  'disparos_wa',
  'cortesias',
)
