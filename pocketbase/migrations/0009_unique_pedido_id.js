migrate(
  (app) => {
    // 1. Resolve pedido_id duplicados ou vazios ANTES de impor o índice único.
    //    Mantém a primeira ocorrência de cada pedido_id e regenera o resto.
    const ingressos = app.findRecordsByFilter('ingressos', "id != ''", '', 100000, 0)
    const used = {}

    for (const ing of ingressos) {
      const pid = ing.getString('pedido_id')
      if (pid && !used[pid]) {
        used[pid] = true
        continue
      }
      // vazio ou duplicado -> gera um novo número único de 6 dígitos
      let candidate
      do {
        candidate = String(Math.floor(100000 + Math.random() * 900000))
      } while (used[candidate])
      used[candidate] = true
      ing.set('pedido_id', candidate)
      app.save(ing)
    }

    // 2. Índice único em pedido_id.
    const coll = app.findCollectionByNameOrId('ingressos')
    coll.addIndex('idx_ingressos_pedido_id', true, 'pedido_id', '')
    app.save(coll)
  },
  (app) => {
    const coll = app.findCollectionByNameOrId('ingressos')
    coll.removeIndex('idx_ingressos_pedido_id')
    app.save(coll)
  },
)
