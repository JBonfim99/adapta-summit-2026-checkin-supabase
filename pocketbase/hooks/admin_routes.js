// A rota de importação canônica é /backend/v1/admin/import-buyers
// (ver admin_import_buyers.js). A antiga /admin/import foi removida por ser
// código morto e divergente (não criava links de participante).

routerAdd(
  'GET',
  '/backend/v1/admin/stats',
  (e) => {
    try {
      const ingressos = $app.findRecordsByFilter('ingressos', "id != ''", '', 10000, 0)
      const total = ingressos.length
      let preenchidos = 0
      let pendentes = 0
      let erros = 0
      const platinum = { total: 0, preenchidos: 0, pendentes: 0 }
      const gold = { total: 0, preenchidos: 0, pendentes: 0 }

      for (const ing of ingressos) {
        const isPreenchido = ing.getString('status') === 'Pré-Credenciado'
        const type = ing.getString('tipo_ingresso')

        if (isPreenchido) preenchidos++
        else pendentes++

        if (ing.getString('status_webhook') === 'erro') erros++

        if (type === 'PLATINUM') {
          platinum.total++
          if (isPreenchido) platinum.preenchidos++
          else platinum.pendentes++
        } else if (type === 'GOLD') {
          gold.total++
          if (isPreenchido) gold.preenchidos++
          else gold.pendentes++
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
        preenchidos,
        pendentes,
        erros,
        platinum,
        gold,
        activity,
      })
    } catch (err) {
      return e.badRequestError(err.message)
    }
  },
  $apis.requireAuth(),
)
