routerAdd(
  'POST',
  '/backend/v1/admin/import-buyers',
  (e) => {
    const body = e.requestInfo().body || {}
    const rows = body.rows || []
    const enviarEmail = body.enviar_email === true || body.enviar_email === 'true'
    const providedDisparoId = (body.disparo_id || '').toString()
    let imported = 0

    // --- Preparação do e-mail (resolve template pelo NOME e cria/reaproveita o
    //     disparo). Só o 1º lote resolve/cria; os demais reusam o disparo_id. ---
    const templateNome = 'Skip-Summit26-Send-Comprador'
    let templateId = ''
    let disparoId = ''
    let emailSkipped = false
    let emailReason = ''
    let queued = 0

    if (enviarEmail) {
      if (providedDisparoId) {
        try {
          const d = $app.findRecordById('disparos', providedDisparoId)
          disparoId = d.id
          templateId = d.getString('template_id')
        } catch (_) {
          emailSkipped = true
          emailReason = 'Disparo não encontrado'
        }
      } else {
        const apiKey = $os.getenv('SENDGRID_API_KEY')
        if (!apiKey) {
          emailSkipped = true
          emailReason = 'SENDGRID_API_KEY não configurada'
        } else {
          const decodeBody = (b) => {
            if (b == null) return ''
            if (typeof b === 'string') return b
            try {
              return new TextDecoder().decode(b)
            } catch (_) {}
            try {
              let s = ''
              for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i])
              return s
            } catch (_) {}
            return ''
          }
          try {
            const res = $http.send({
              url: 'https://api.sendgrid.com/v3/templates?generations=dynamic&page_size=200',
              method: 'GET',
              headers: { Authorization: 'Bearer ' + apiKey },
              timeout: 20,
            })
            let parsed = {}
            try {
              parsed = JSON.parse(decodeBody(res.body))
            } catch (_) {}
            const list = parsed.result || parsed.templates || []
            for (let i = 0; i < list.length; i++) {
              if (list[i] && list[i].name === templateNome && list[i].id) {
                templateId = list[i].id
                break
              }
            }
            if (!templateId) {
              emailSkipped = true
              emailReason = 'Template "' + templateNome + '" não encontrado no SendGrid'
            }
          } catch (err) {
            emailSkipped = true
            emailReason =
              'Falha ao consultar o SendGrid: ' + (err && err.message ? err.message : 'erro')
          }
        }
        if (templateId) {
          try {
            const disparosColl = $app.findCollectionByNameOrId('disparos')
            const disparo = new Record(disparosColl)
            disparo.set(
              'nome',
              'Importação de compradores — ' + new Date().toISOString().substring(0, 10),
            )
            disparo.set('template_id', templateId)
            disparo.set('template_nome', templateNome)
            disparo.set('cluster', 'importacao')
            disparo.set('audience', 'compradores')
            disparo.set('total', 0)
            disparo.set('enviados', 0)
            disparo.set('erros', 0)
            disparo.set('status', 'em_andamento')
            $app.save(disparo)
            disparoId = disparo.id
          } catch (err) {
            emailSkipped = true
            emailReason = 'Falha ao criar o disparo'
          }
        }
      }
    }
    const doEmail = enviarEmail && !emailSkipped && !!templateId && !!disparoId

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
            qtd_palestrantes: 0,
            qtd_hackathon: 0,
          }
        }
        if (!groups[email].documento && doc) groups[email].documento = doc
        groups[email].qtd_gold += parseInt(row.qtd_gold || '0', 10) || 0
        groups[email].qtd_platinum += parseInt(row.qtd_platinum || '0', 10) || 0
        groups[email].qtd_palestrantes += parseInt(row.qtd_palestrantes || '0', 10) || 0
        groups[email].qtd_hackathon += parseInt(row.qtd_hackathon || '0', 10) || 0
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

        // Marca o comprador na fila de e-mail (só desta rodada).
        if (doEmail && comprador.getString('acesso_status') !== 'enviando') {
          comprador.set('acesso_status', 'na_fila')
          comprador.set('acesso_template_id', templateId)
          comprador.set('acesso_disparo_id', disparoId)
          comprador.set('acesso_tentativas', 0)
          comprador.set('acesso_erro', '')
          comprador.set('acesso_claim', '')
          txApp.save(comprador)
          queued++
        }

        // Um laço por tipo: para criar um tipo novo, basta somar aqui.
        const porTipo = [
          { tipo: 'GOLD', qtd: data.qtd_gold },
          { tipo: 'PLATINUM', qtd: data.qtd_platinum },
          { tipo: 'PALESTRANTES', qtd: data.qtd_palestrantes },
          { tipo: 'HACKATHON', qtd: data.qtd_hackathon },
        ]

        for (let t = 0; t < porTipo.length; t++) {
          for (let i = 0; i < porTipo[t].qtd; i++) {
            const ingresso = new Record(ingressosCollection)
            ingresso.set('comprador_id', comprador.id)
            ingresso.set('pedido_id', genPedidoId())
            ingresso.set('tipo_ingresso', porTipo[t].tipo)
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
      }
    })

    // Atualiza o total do disparo (soma incremental entre os lotes).
    if (doEmail && queued > 0) {
      try {
        const d = $app.findRecordById('disparos', disparoId)
        d.set('total', (Number(d.get('total')) || 0) + queued)
        $app.save(d)
      } catch (_) {}
    }

    return e.json(200, {
      imported: imported,
      email: {
        enabled: enviarEmail,
        disparo_id: disparoId,
        template_id: templateId,
        template_nome: templateNome,
        queued: queued,
        skipped: emailSkipped,
        reason: emailReason,
      },
    })
  },
  $apis.requireAuth(),
)
