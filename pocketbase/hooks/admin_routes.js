routerAdd(
  'POST',
  '/backend/v1/admin/import',
  (e) => {
    const body = e.requestInfo().body
    const rows = body.rows
    if (!Array.isArray(rows)) return e.badRequestError('Invalid data')

    const compColl = $app.findCollectionByNameOrId('compradores')
    const ingColl = $app.findCollectionByNameOrId('ingressos')

    let count = 0
    for (const row of rows) {
      if (!row.email_comprador || !row.pedido_id) continue

      let comp
      try {
        comp = $app.findFirstRecordByData('compradores', 'email', row.email_comprador)
      } catch (_) {
        comp = new Record(compColl)
        comp.set('email', row.email_comprador)
        comp.set('nome', row.nome_comprador || row.email_comprador.split('@')[0])
        $app.save(comp)
      }

      try {
        $app.findFirstRecordByData('ingressos', 'pedido_id', row.pedido_id)
      } catch (_) {
        const ing = new Record(ingColl)
        ing.set('comprador_id', comp.id)
        ing.set('pedido_id', row.pedido_id)
        ing.set('tipo_ingresso', row.tipo_ingresso || 'GOLD')
        ing.set('status', 'Pendente')
        $app.save(ing)
        count++
      }
    }

    return e.json(200, { imported: count })
  },
  $apis.requireAuth(),
)

routerAdd(
  'GET',
  '/backend/v1/admin/stats',
  (e) => {
    try {
      const ingressos = $app.findRecordsByFilter('ingressos', "id != ''", '', 10000, 0)
      let total = ingressos.length
      let preenchidos = 0
      let enviados = 0
      let pendentes = 0
      let erros = 0
      let vip = { total: 0, preenchidos: 0, pendentes: 0 }
      let standard = { total: 0, preenchidos: 0, pendentes: 0 }

      for (const ing of ingressos) {
        const st = ing.getString('status')
        const type = ing.getString('tipo_ingresso')
        if (st === 'Pendente' || st === 'pendente') pendentes++
        else if (st === 'Pré-Credenciado' || st === 'preenchido') preenchidos++
        else if (st === 'enviado') enviados++
        else if (st === 'erro_webhook') erros++

        if (type === 'PLATINUM' || type === 'VIP') {
          vip.total++
          if (st === 'Pendente' || st === 'pendente') vip.pendentes++
          else vip.preenchidos++
        } else {
          standard.total++
          if (st === 'Pendente' || st === 'pendente') standard.pendentes++
          else standard.preenchidos++
        }
      }

      const parts = $app.findRecordsByFilter('participantes', "id != ''", '-created', 5, 0)
      const activity = parts.map((p) => ({
        id: p.id,
        nome: p.getString('nome_completo'),
        ingresso_id: p.getString('ingresso_id'),
      }))

      return e.json(200, {
        total,
        preenchidos: preenchidos + enviados + erros,
        pendentes,
        erros,
        vip,
        standard,
        activity,
      })
    } catch (err) {
      return e.badRequestError(err.message)
    }
  },
  $apis.requireAuth(),
)
