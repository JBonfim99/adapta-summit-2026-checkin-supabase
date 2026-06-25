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

      // Gera um pedido_id numérico de 6 dígitos, único (checa o banco + os já
      // gerados nesta importação, e regenera em caso de colisão).
      const usedPedidoIds = {}
      const genPedidoId = () => {
        for (let attempt = 0; attempt < 50; attempt++) {
          const candidate = String(Math.floor(100000 + Math.random() * 900000))
          if (usedPedidoIds[candidate]) continue
          let exists = false
          try {
            txApp.findFirstRecordByData('ingressos', 'pedido_id', candidate)
            exists = true
          } catch (_) {
            exists = false
          }
          if (!exists) {
            usedPedidoIds[candidate] = true
            return candidate
          }
        }
        throw new Error('Falha ao gerar pedido_id único após várias tentativas')
      }

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

        for (let i = 0; i < data.qtd_gold; i++) {
          const ingresso = new Record(ingressosCollection)
          ingresso.set('comprador_id', comprador.id)
          ingresso.set('pedido_id', genPedidoId())
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
          const ingresso = new Record(ingressosCollection)
          ingresso.set('comprador_id', comprador.id)
          ingresso.set('pedido_id', genPedidoId())
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
