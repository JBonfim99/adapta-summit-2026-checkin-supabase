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

      for (const row of rows) {
        const email = (row.email || '').trim().toLowerCase()
        if (!email) continue

        let comprador
        try {
          comprador = txApp.findFirstRecordByData('compradores', 'email', email)
          comprador.set('nome', row.nome || comprador.getString('nome'))
          if (row.documento) comprador.set('documento', row.documento)
          if (row.uf) comprador.set('uf', row.uf)
          if (row.cidade) comprador.set('cidade', row.cidade)
          if (row.telefone) comprador.set('telefone', row.telefone)
          txApp.save(comprador)
        } catch (_) {
          comprador = new Record(compradoresCollection)
          comprador.set('email', email)
          comprador.set('nome', row.nome || '')
          if (row.documento) comprador.set('documento', row.documento)
          if (row.uf) comprador.set('uf', row.uf)
          if (row.cidade) comprador.set('cidade', row.cidade)
          if (row.telefone) comprador.set('telefone', row.telefone)
          txApp.save(comprador)
        }

        const qtdGold = parseInt(row.qtd_gold || '0', 10) || 0
        const qtdPlatinum = parseInt(row.qtd_platinum || '0', 10) || 0

        for (let i = 0; i < qtdGold; i++) {
          const ingresso = new Record(ingressosCollection)
          ingresso.set('comprador_id', comprador.id)
          ingresso.set('pedido_id', `IMP-${Date.now()}-${$security.randomString(6)}`)
          ingresso.set('tipo_ingresso', 'GOLD')
          ingresso.set('status', 'Pendente')
          txApp.save(ingresso)
          imported++
        }

        for (let i = 0; i < qtdPlatinum; i++) {
          const ingresso = new Record(ingressosCollection)
          ingresso.set('comprador_id', comprador.id)
          ingresso.set('pedido_id', `IMP-${Date.now()}-${$security.randomString(6)}`)
          ingresso.set('tipo_ingresso', 'PLATINUM')
          ingresso.set('status', 'Pendente')
          txApp.save(ingresso)
          imported++
        }
      }
    })

    return e.json(200, { imported })
  },
  $apis.requireAuth(),
)
