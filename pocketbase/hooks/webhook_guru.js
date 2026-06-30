// ============================================================================
// WEBHOOK GURU — cria comprador + ingressos a partir de uma compra aprovada.
// ----------------------------------------------------------------------------
// IDEMPOTÊNCIA: a Guru manda 2-3 webhooks da mesma compra (created/approved...).
//   - Só `status === 'approved'` gera ingresso.
//   - transacao_id = payment.marketplace_id (estável entre os webhooks).
//   - Tudo numa única transação que termina inserindo pedidos_guru(transacao_id),
//     que tem índice ÚNICO. Webhook 'approved' repetido => insert falha =>
//     rollback total => zero ingresso duplicado. Responde 200 (idempotente).
//
// E-MAIL DE ACESSO: reusa o motor de disparo. Coloca o comprador em
//   acesso_status='na_fila' com o template GURU_ACCESS_TEMPLATE_ID, num disparo
//   dedicado ("Guru — acesso automático"). O cron existente envia em ≤1min,
//   com retry e auditoria. Se o template não estiver configurado, cria o
//   ingresso mesmo assim e só registra que o e-mail foi pulado.
//
// PÚBLICO (sem auth): a Guru não autentica com nosso login.
// ============================================================================
routerAdd('POST', '/backend/v1/webhooks/guru', (e) => {
  try {
    const body = e.requestInfo().body || {}
    const status = (body.status || '').toString().toLowerCase()

    const payment = body.payment || {}
    const transacaoId = (payment.marketplace_id || body.id || '').toString().trim()
    if (!transacaoId) return e.json(200, { ignored: true, reason: 'sem transacao_id' })

    // Só compra aprovada gera ingresso. Demais status: ignora (200, sem registrar,
    // para não travar o índice único antes do approved chegar).
    if (status !== 'approved') {
      return e.json(200, { ignored: true, status: status, transacao_id: transacaoId })
    }

    // Idempotência (pré-checagem; o índice único é a garantia final).
    try {
      $app.findFirstRecordByFilter('pedidos_guru', 'transacao_id = {:t}', { t: transacaoId })
      return e.json(200, { duplicate: true, transacao_id: transacaoId })
    } catch (_) {}

    const contact = body.contact || {}
    const email = (contact.email || '').toString().trim().toLowerCase()
    if (!email)
      return e.json(200, { ignored: true, reason: 'sem email', transacao_id: transacaoId })
    const nome = (contact.name || '').toString().trim()
    const doc = (contact.doc || '').toString().trim()
    const uf = (contact.address_state || '').toString().trim()
    const cidade = (contact.address_city || '').toString().trim()
    const ddd = (contact.phone_local_code || '').toString().trim()
    const fone = (contact.phone_number || '').toString().trim()
    const telefone = fone ? (ddd ? ddd + fone : fone) : ''

    // Itens -> ingressos. Usa items[] (suporta quantidade e order bumps); cai pro
    // product se items vier vazio. Ignora itens que não são ingresso do Summit.
    let items = Array.isArray(body.items) ? body.items.slice() : []
    if (items.length === 0 && body.product) items = [body.product]
    const planned = []
    for (let i = 0; i < items.length; i++) {
      const it = items[i] || {}
      const offerName = it.offer && it.offer.name ? it.offer.name : ''
      const rawName = ((it.name || '') + ' ' + offerName).toLowerCase()
      if (rawName.indexOf('summit') === -1) continue
      let tipo = ''
      if (rawName.indexOf('platinum') !== -1) tipo = 'PLATINUM'
      else if (rawName.indexOf('gold') !== -1) tipo = 'GOLD'
      else continue
      const qty = parseInt(it.qty, 10) || 1
      planned.push({ tipo: tipo, qty: qty })
    }

    // Template do e-mail de acesso: NOME fixo, resolvido para o id (d-...) do
    // SendGrid. O id é cacheado no disparo da Guru pra não consultar a cada webhook.
    const TEMPLATE_NAME = 'Skip-Summit26-Send-Comprador'
    let templateId = ''
    try {
      const gd = $app.findFirstRecordByFilter('disparos', "cluster = 'guru'")
      const cached = gd.getString('template_id')
      if (cached && cached.indexOf('d-') === 0) templateId = cached
    } catch (_) {}
    if (!templateId) {
      const apiKey = $os.getenv('SENDGRID_API_KEY')
      if (apiKey) {
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
            const t = list[i]
            if (t && t.id && (t.name || '').toLowerCase() === TEMPLATE_NAME.toLowerCase()) {
              templateId = t.id
              break
            }
          }
        } catch (_) {}
      }
    }

    // Pedido sem nenhum ingresso do Summit: registra (idempotência) e sai.
    if (planned.length === 0) {
      try {
        const pg = new Record($app.findCollectionByNameOrId('pedidos_guru'))
        pg.set('transacao_id', transacaoId)
        pg.set('status', status)
        pg.set('email', email)
        pg.set('ingressos', 0)
        pg.set('email_status', 'sem_ingresso')
        pg.set('payload', body)
        $app.save(pg)
      } catch (_) {}
      return e.json(200, { ok: true, ingressos: 0, reason: 'sem item summit' })
    }

    let compradorId = ''
    let totalIngressos = 0
    let emailEnfileirado = false

    try {
      $app.runInTransaction((txApp) => {
        const compradoresCollection = txApp.findCollectionByNameOrId('compradores')
        const ingressosCollection = txApp.findCollectionByNameOrId('ingressos')
        const linksCollection = txApp.findCollectionByNameOrId('links_participante')
        const pedidosColl = txApp.findCollectionByNameOrId('pedidos_guru')

        // pedido_id numérico de 6 dígitos, único.
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
          throw new Error('Falha ao gerar pedido_id único')
        }

        // Comprador: dedupe por email (índice único em compradores.email).
        let comprador
        let isNewComprador = false
        try {
          comprador = txApp.findFirstRecordByData('compradores', 'email', email)
          if (nome) comprador.set('nome', nome)
          if (doc) comprador.set('documento', doc)
          if (uf) comprador.set('uf', uf)
          if (cidade) comprador.set('cidade', cidade)
          if (telefone) comprador.set('telefone', telefone)
        } catch (_) {
          comprador = new Record(compradoresCollection)
          comprador.set('email', email)
          comprador.set('nome', nome)
          comprador.set('documento', doc)
          comprador.set('uf', uf)
          comprador.set('cidade', cidade)
          comprador.set('telefone', telefone)
          isNewComprador = true
        }

        // Enfileira o e-mail de acesso UMA ÚNICA VEZ por comprador: só se for novo
        // ou se ainda não foi enfileirado/enviado. Evita reenvio em compras
        // repetidas (segundo pedido do mesmo e-mail) e em qualquer reprocessamento.
        const statusAcesso = comprador.getString('acesso_status')
        const jaTemAcesso =
          !isNewComprador &&
          (statusAcesso === 'na_fila' || statusAcesso === 'enviando' || statusAcesso === 'enviado')
        if (templateId && !jaTemAcesso) {
          let guruDisparo
          try {
            guruDisparo = txApp.findFirstRecordByFilter('disparos', "cluster = 'guru'")
          } catch (_) {
            guruDisparo = new Record(txApp.findCollectionByNameOrId('disparos'))
            guruDisparo.set('nome', 'Guru — acesso automático')
            guruDisparo.set('template_id', templateId)
            guruDisparo.set('template_nome', 'Guru — acesso automático')
            guruDisparo.set('cluster', 'guru')
            guruDisparo.set('audience', 'compradores')
            guruDisparo.set('total', 0)
            guruDisparo.set('enviados', 0)
            guruDisparo.set('erros', 0)
            guruDisparo.set('status', 'em_andamento')
            txApp.save(guruDisparo)
          }
          comprador.set('acesso_status', 'na_fila')
          comprador.set('acesso_template_id', templateId)
          comprador.set('acesso_disparo_id', guruDisparo.id)
          comprador.set('acesso_tentativas', 0)
          comprador.set('acesso_erro', '')
          comprador.set('acesso_claim', '')
          guruDisparo.set('total', (parseInt(guruDisparo.get('total'), 10) || 0) + 1)
          guruDisparo.set('template_id', templateId)
          guruDisparo.set('status', 'em_andamento')
          txApp.save(guruDisparo)
          emailEnfileirado = true
        }

        txApp.save(comprador)
        compradorId = comprador.id

        // Ingressos + links de participante (mesma estrutura do import).
        for (let pi = 0; pi < planned.length; pi++) {
          const tipo = planned[pi].tipo
          const qty = planned[pi].qty
          for (let q = 0; q < qty; q++) {
            const ingresso = new Record(ingressosCollection)
            ingresso.set('comprador_id', comprador.id)
            ingresso.set('pedido_id', genPedidoId())
            ingresso.set('tipo_ingresso', tipo)
            ingresso.set('status', 'Pendente')
            ingresso.set('status_webhook', 'pendente')
            txApp.save(ingresso)
            totalIngressos++

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

        // Idempotência: insere o pedido (índice único em transacao_id).
        const pg = new Record(pedidosColl)
        pg.set('transacao_id', transacaoId)
        pg.set('status', status)
        pg.set('email', email)
        pg.set('comprador_id', comprador.id)
        pg.set('ingressos', totalIngressos)
        pg.set(
          'email_status',
          emailEnfileirado ? 'enfileirado' : templateId ? 'ja_enviado' : 'sem_template',
        )
        pg.set('payload', body)
        txApp.save(pg)
      })
    } catch (err) {
      const msg = (err && err.message ? err.message : '').toLowerCase()
      // Corrida de webhooks duplicados que estourou o índice único: idempotente.
      if (msg.indexOf('unique') !== -1 || msg.indexOf('constraint') !== -1) {
        return e.json(200, { duplicate: true, transacao_id: transacaoId })
      }
      return e.json(500, { error: err && err.message ? err.message : 'erro' })
    }

    return e.json(200, {
      ok: true,
      transacao_id: transacaoId,
      comprador_id: compradorId,
      ingressos: totalIngressos,
      email: emailEnfileirado ? 'enfileirado' : templateId ? 'ja_enviado' : 'sem_template',
    })
  } catch (err) {
    return e.json(500, { error: err && err.message ? err.message : 'erro' })
  }
})
