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

      // Dedup do comprador por EMAIL (índice único em compradores.email).
      const groups = {}
      for (const row of rows) {
        const email = (row.email || '').trim().toLowerCase()
        const doc = (row.documento || '').trim()
        if (!email) continue
        if (!groups[email]) {
          groups[email] = {
            email: email,
            documento: doc,
            nome: row.nome || '',
            uf: row.uf || '',
            cidade: row.cidade || '',
            telefone: row.telefone || '',
            qtd_gold: 0,
            qtd_platinum: 0,
          }
        }
        // Mantém o primeiro documento não-vazio visto para este email.
        if (!groups[email].documento && doc) groups[email].documento = doc
        groups[email].qtd_gold += parseInt(row.qtd_gold || '0', 10) || 0
        groups[email].qtd_platinum += parseInt(row.qtd_platinum || '0', 10) || 0
      }

      for (const email of Object.keys(groups)) {
        const data = groups[email]
        let comprador
        try {
          comprador = txApp.findFirstRecordByData('compradores', 'email', email)
          if (data.nome) comprador.set('nome', data.nome)
          if (data.documento) comprador.set('documento', data.documento)
          if (data.uf) comprador.set('uf', data.uf)
          if (data.cidade) comprador.set('cidade', data.cidade)
          if (data.telefone) comprador.set('telefone', data.telefone)
          txApp.save(comprador)
        } catch (_) {
          comprador = new Record(compradoresCollection)
          comprador.set('email', email)
          comprador.set('documento', data.documento)
          comprador.set('nome', data.nome)
          comprador.set('uf', data.uf)
          comprador.set('cidade', data.cidade)
          comprador.set('telefone', data.telefone)
          txApp.save(comprador)
        }

        // Prefixo do pedido: documento quando houver, senão o próprio email.
        const prefix = data.documento || email

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
          ingresso.set('pedido_id', `${prefix}-${seqStr}`)
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
          ingresso.set('pedido_id', `${prefix}-${seqStr}`)
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
