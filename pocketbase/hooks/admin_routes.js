// A rota de importação canônica é /backend/v1/admin/import-buyers
// (ver admin_import_buyers.js). A antiga /admin/import foi removida por ser
// código morto e divergente (não criava links de participante).

// Gera (ou reaproveita) o link de pré-credenciamento de um ingresso.
// Roda no backend com auth de admin porque a collection links_participante
// tem API rules = null (acesso direto só por superuser).
routerAdd(
  'POST',
  '/backend/v1/admin/ticket/{ingressoId}/invite-link',
  (e) => {
    try {
      const ticketId = e.request.pathValue('ingressoId')

      let ingresso
      try {
        ingresso = $app.findRecordById('ingressos', ticketId)
      } catch (err) {
        return e.notFoundError('Ingresso não encontrado')
      }

      let inviteToken
      try {
        const pl = $app.findFirstRecordByFilter(
          'links_participante',
          'ingresso_id = {:id} && expira_em > {:now} && usado = false',
          { id: ingresso.id, now: new Date().toISOString() },
        )
        inviteToken = pl.getString('token')
      } catch (err) {}

      if (!inviteToken) {
        const linksCollection = $app.findCollectionByNameOrId('links_participante')
        const newLink = new Record(linksCollection)
        newLink.set('ingresso_id', ingresso.id)
        newLink.set('token', $security.randomString(32))
        newLink.set('usado', false)
        const exp = new Date()
        exp.setTime(exp.getTime() + 30 * 24 * 60 * 60 * 1000)
        newLink.set('expira_em', exp.toISOString())
        $app.save(newLink)
        inviteToken = newLink.getString('token')
      }

      return e.json(200, { token: inviteToken })
    } catch (err) {
      return e.badRequestError(err.message)
    }
  },
  $apis.requireAuth(),
)

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
