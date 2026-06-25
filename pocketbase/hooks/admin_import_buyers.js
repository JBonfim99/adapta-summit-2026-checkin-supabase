routerAdd(
  'POST',
  '/backend/v1/admin/import-buyers',
  (e) => {
    const body = e.requestInfo().body || {}
    const rows = body.rows || []
    let imported = 0

    $app.runInTransaction((txApp) => {
      const compradoresCollection = txApp.findCollectionByNameOrId('compradores')
      const ingressosCollection = txApp.findCollectionByNameOrId('ingressos')
      const linksCollection = txApp.findCollectionByNameOrId('links_participante')

      const groups = {}
      for (const row of rows) {
        const doc = (row.documento || '').trim()
        const email = (row.email || '').trim().toLowerCase()
        if (!doc) continue
        if (!groups[doc]) {
          groups[doc] = {
            documento: doc,
            email: email || '',
            nome: row.nome || '',
            uf: row.uf || '',
            cidade: row.cidade || '',
            telefone: row.telefone || '',
            qtd_gold: 0,
            qtd_platinum: 0,
          }
        }
        groups[doc].qtd_gold += parseInt(row.qtd_gold || '0', 10) || 0
        groups[doc].qtd_platinum += parseInt(row.qtd_platinum || '0', 10) || 0
      }

      for (const doc of Object.keys(groups)) {
        const data = groups[doc]
        let comprador
        try {
          comprador = txApp.findFirstRecordByData('compradores', 'documento', doc)
          if (data.nome) comprador.set('nome', data.nome)
          if (data.email) comprador.set('email', data.email)
          if (data.uf) comprador.set('uf', data.uf)
          if (data.cidade) comprador.set('cidade', data.cidade)
          if (data.telefone) comprador.set('telefone', data.telefone)
          txApp.save(comprador)
        } catch (_) {
          comprador = new Record(compradoresCollection)
          comprador.set('documento', doc)
          comprador.set('email', data.email)
          comprador.set('nome', data.nome)
          comprador.set('uf', data.uf)
          comprador.set('cidade', data.cidade)
          comprador.set('telefone', data.telefone)
          txApp.save(comprador)
        }

        let currentSeq = 0
        try {
          const existing = txApp.findRecordsByFilter(
            'ingressos',
            `comprador_id = '${comprador.id}'`,
            '',
            1000,
            0,
          )
          currentSeq = existing.length
        } catch (_) {}

        for (let i = 0; i < data.qtd_gold; i++) {
          currentSeq++
          const seqStr = String(currentSeq).padStart(2, '0')
          const ingresso = new Record(ingressosCollection)
          ingresso.set('comprador_id', comprador.id)
          ingresso.set('pedido_id', `${doc}-${seqStr}`)
          ingresso.set('tipo_ingresso', 'GOLD')
          ingresso.set('status', 'Pendente')
          ingresso.set('status_webhook', 'pendente')
          txApp.save(ingresso)
          imported++

          const link = new Record(linksCollection)
          link.set('ingresso_id', ingresso.id)
          link.set('token', $security.randomString(32))
          link.set('usado', false)
          const exp = new Date()
          exp.setFullYear(exp.getFullYear() + 1)
          link.set('expira_em', exp.toISOString())
          txApp.save(link)
        }

        for (let i = 0; i < data.qtd_platinum; i++) {
          currentSeq++
          const seqStr = String(currentSeq).padStart(2, '0')
          const ingresso = new Record(ingressosCollection)
          ingresso.set('comprador_id', comprador.id)
          ingresso.set('pedido_id', `${doc}-${seqStr}`)
          ingresso.set('tipo_ingresso', 'PLATINUM')
          ingresso.set('status', 'Pendente')
          ingresso.set('status_webhook', 'pendente')
          txApp.save(ingresso)
          imported++

          const link = new Record(linksCollection)
          link.set('ingresso_id', ingresso.id)
          link.set('token', $security.randomString(32))
          link.set('usado', false)
          const exp = new Date()
          exp.setFullYear(exp.getFullYear() + 1)
          link.set('expira_em', exp.toISOString())
          txApp.save(link)
        }
      }
    })

    return e.json(200, { imported })
  },
  $apis.requireAuth(),
)
