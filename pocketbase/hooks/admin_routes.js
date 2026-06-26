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

// Cria um ingresso avulso para um comprador. pedido_id é numérico de até 6
// dígitos: se informado, valida formato + unicidade; se omitido, gera único.
routerAdd(
  'POST',
  '/backend/v1/admin/tickets',
  (e) => {
    try {
      const body = e.requestInfo().body || {}
      const compradorId = body.comprador_id
      const tipo = body.tipo_ingresso
      let pedidoId = (body.pedido_id || '').toString().trim()

      if (!compradorId) return e.badRequestError('comprador_id é obrigatório')
      if (tipo !== 'GOLD' && tipo !== 'PLATINUM') {
        return e.badRequestError('tipo_ingresso deve ser GOLD ou PLATINUM')
      }

      let comprador
      try {
        comprador = $app.findRecordById('compradores', compradorId)
      } catch (err) {
        return e.notFoundError('Comprador não encontrado')
      }

      if (pedidoId) {
        if (!/^[0-9]{1,6}$/.test(pedidoId)) {
          return e.badRequestError('ID do pedido deve ter no máximo 6 dígitos numéricos')
        }
        let taken = false
        try {
          $app.findFirstRecordByData('ingressos', 'pedido_id', pedidoId)
          taken = true
        } catch (_) {}
        if (taken) return e.badRequestError('Já existe um ingresso com esse ID de pedido')
      } else {
        let candidate = ''
        for (let attempt = 0; attempt < 50; attempt++) {
          const c = String(Math.floor(100000 + Math.random() * 900000))
          let exists = false
          try {
            $app.findFirstRecordByData('ingressos', 'pedido_id', c)
            exists = true
          } catch (_) {}
          if (!exists) {
            candidate = c
            break
          }
        }
        if (!candidate) return e.badRequestError('Falha ao gerar ID de pedido único')
        pedidoId = candidate
      }

      let createdId = ''
      $app.runInTransaction((txApp) => {
        const ingColl = txApp.findCollectionByNameOrId('ingressos')
        const ingresso = new Record(ingColl)
        ingresso.set('comprador_id', comprador.id)
        ingresso.set('pedido_id', pedidoId)
        ingresso.set('tipo_ingresso', tipo)
        ingresso.set('status', 'Pendente')
        ingresso.set('status_webhook', 'pendente')
        txApp.save(ingresso)
        createdId = ingresso.id

        const linksColl = txApp.findCollectionByNameOrId('links_participante')
        const link = new Record(linksColl)
        link.set('ingresso_id', ingresso.id)
        link.set('token', $security.randomString(32))
        link.set('usado', false)
        const exp = new Date()
        exp.setFullYear(exp.getFullYear() + 1)
        link.set('expira_em', exp.toISOString())
        txApp.save(link)
      })

      return e.json(200, { success: true, id: createdId, pedido_id: pedidoId })
    } catch (err) {
      return e.badRequestError(err.message)
    }
  },
  $apis.requireAuth(),
)

// Pré-credenciamento manual pelo admin: cria o participante e atrela a um
// ingresso PENDENTE. A criação do participante dispara o hook de webhook+log
// (ver webhook_inac.js), e o ingresso passa a Pré-Credenciado.
routerAdd(
  'POST',
  '/backend/v1/admin/participant/create',
  (e) => {
    const body = e.requestInfo().body || {}
    const ingressoId = body.ingresso_id
    if (!ingressoId) return e.badRequestError('ingresso_id é obrigatório')

    // Regra: e-mail único entre participantes (pode coincidir com o de um comprador).
    const emailNorm = (body.email || '').toString().trim().toLowerCase()
    let emailDup = false
    try {
      $app.findFirstRecordByFilter('participantes', 'email = {:em}', { em: emailNorm })
      emailDup = true
    } catch (_) {}
    if (emailDup) {
      return e.badRequestError('Este e-mail já foi usado por outro participante. Use outro e-mail.')
    }

    try {
      $app.runInTransaction((txApp) => {
        const ingresso = txApp.findRecordById('ingressos', ingressoId)
        if (ingresso.getString('status') !== 'Pendente') {
          throw new Error('Este ingresso não está com status Pendente')
        }
        if (ingresso.getString('participante_id')) {
          throw new Error('Este ingresso já possui um participante')
        }

        const partColl = txApp.findCollectionByNameOrId('participantes')
        const part = new Record(partColl)
        part.set('ingresso_id', ingresso.id)
        part.set('nome_completo', body.nome_completo)
        part.set('email', emailNorm)
        part.set('cpf', body.cpf)
        part.set('telefone', body.telefone)
        part.set('nome_empresa', body.nome_empresa)
        part.set('cargo', body.cargo)
        part.set('nicho', body.nicho)
        part.set('num_funcionarios', body.num_funcionarios)
        part.set('faturamento_anual', body.faturamento_anual)
        part.set('areas_ajuda', body.areas_ajuda || [])
        part.set('expectativa_aprendizado', body.expectativa_aprendizado || '')
        part.set('expectativa_experiencia', body.expectativa_experiencia || '')
        txApp.save(part)

        ingresso.set('participante_id', part.id)
        ingresso.set('status', 'Pré-Credenciado')
        ingresso.set('preenchido_em', new Date().toISOString())
        txApp.save(ingresso)
      })

      return e.json(200, { success: true })
    } catch (err) {
      const m = (err && err.message) || ''
      if (/unique/i.test(m) || m.indexOf('idx_participantes_email') !== -1) {
        return e.badRequestError(
          'Este e-mail já foi usado por outro participante. Use outro e-mail.',
        )
      }
      return e.badRequestError(m)
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
