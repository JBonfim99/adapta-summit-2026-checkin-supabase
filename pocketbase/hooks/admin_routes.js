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
        const temEmpresa = body.tem_empresa === true || body.tem_empresa === 'true'
        part.set('tem_empresa', temEmpresa)
        part.set('nome_empresa', temEmpresa ? body.nome_empresa || '' : '')
        part.set('cargo', temEmpresa ? body.cargo || '' : '')
        part.set('profissao', temEmpresa ? '' : body.profissao || '')
        part.set('nicho', body.nicho || '')
        part.set('num_funcionarios', temEmpresa ? body.num_funcionarios || '' : '')
        part.set('faturamento_anual', temEmpresa ? body.faturamento_anual || '' : '')
        part.set('ia_uso_diario', parseInt(body.ia_uso_diario, 10) || 0)
        part.set('ia_profundidade', parseInt(body.ia_profundidade, 10) || 0)
        part.set('ia_ferramentas', body.ia_ferramentas || '')
        part.set('ia_desafio', body.ia_desafio || '')
        txApp.save(part)

        ingresso.set('participante_id', part.id)
        ingresso.set('status', 'Pré-Credenciado')
        ingresso.set('preenchido_em', new Date().toISOString())
        txApp.save(ingresso)
      })
    } catch (err) {
      const m = (err && err.message) || ''
      if (/unique/i.test(m) || m.indexOf('idx_participantes_email') !== -1) {
        return e.badRequestError(
          'Este e-mail já foi usado por outro participante. Use outro e-mail.',
        )
      }
      return e.badRequestError(m)
    }

    // Pós-commit: chama a INAC /add (síncrono), persiste inac_id/inac_qr e
    // devolve o qrcode. Idempotente: só chama se ainda não houver inac_id.
    let qrcode = ''
    try {
      const ingresso = $app.findRecordById('ingressos', ingressoId)
      if (ingresso.getString('inac_id')) {
        qrcode = ingresso.getString('inac_qr')
      } else {
        const INAC_WEBHOOK_URL = $os.getenv('INAC_WEBHOOK_URL')
        const INAC_AUTH_TOKEN = $os.getenv('INAC_AUTH_TOKEN')
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
        const onlyDigits = (s) => (s || '').replace(/\D/g, '')
        let tel = onlyDigits(body.telefone)
        if (tel && tel.length <= 11) tel = '55' + tel
        const categoria = ingresso.getString('tipo_ingresso')
        const categoryId = categoria === 'PLATINUM' ? 6125 : 6123
        const payload = {
          event_id: 375,
          category_id: categoryId,
          status: 'active',
          fields: [
            { id: 10133653, value: body.nome_completo || '' },
            { id: 10133654, value: emailNorm },
            { id: 10133655, value: onlyDigits(body.cpf) },
            { id: 10133656, value: tel },
            { id: 10133657, value: body.nome_empresa || body.profissao || '' },
            { id: 10133665, value: ingresso.getString('pedido_id') },
          ],
        }

        const logColl = $app.findCollectionByNameOrId('webhooks_log')
        const logAttempt = (evento, detalhe, status, resp) => {
          try {
            const log = new Record(logColl)
            log.set('ingresso_id', ingresso.id)
            log.set('evento', evento)
            log.set('detalhe', detalhe)
            log.set('status', status)
            log.set('method', 'POST')
            log.set('payload', JSON.stringify(payload))
            log.set('response', (resp || '').substring(0, 500))
            $app.save(log)
          } catch (_) {}
        }

        let inacId = ''
        let inacQr = ''
        let apiOk = false

        if (!INAC_WEBHOOK_URL || !INAC_AUTH_TOKEN) {
          ingresso.set('status_webhook', 'pendente')
          $app.save(ingresso)
          logAttempt('webhook_erro', 'INAC_WEBHOOK_URL/INAC_AUTH_TOKEN não configurados', 0, '')
        } else {
          // Retry: até 3 tentativas, com 1,5s entre elas. Cada tentativa é logada.
          const MAX = 3
          for (let attempt = 1; attempt <= MAX && !apiOk; attempt++) {
            let status = 0
            let respBody = ''
            let erroMsg = ''
            try {
              const res = $http.send({
                url: INAC_WEBHOOK_URL,
                method: 'POST',
                headers: { 'X-Auth-Token': INAC_AUTH_TOKEN, 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
                timeout: 12,
              })
              status = res.statusCode
              respBody = decodeBody(res.body)
            } catch (err) {
              erroMsg = err.message
            }

            if (status >= 200 && status < 300) {
              try {
                const data = JSON.parse(respBody)
                if (data && data.status === true && data.attendee) {
                  apiOk = true
                  inacId = String(data.attendee.id || '')
                  inacQr = String(data.attendee.qrcode || '')
                }
              } catch (_) {}
            }

            if (apiOk) {
              logAttempt(
                'webhook_enviado',
                `INAC /add OK (id ${inacId}) na tentativa ${attempt}/${MAX}`,
                status,
                respBody,
              )
            } else {
              logAttempt(
                'webhook_erro',
                `Tentativa ${attempt}/${MAX} falhou — ` +
                  (erroMsg ? `rede: ${erroMsg}` : `HTTP ${status}`),
                status,
                respBody || erroMsg,
              )
              if (attempt < MAX) {
                const until = Date.now() + 1500
                while (Date.now() < until) {
                  // backoff
                }
              }
            }
          }

          if (apiOk && inacQr) {
            ingresso.set('inac_id', inacId)
            ingresso.set('inac_qr', inacQr)
            ingresso.set('status_webhook', 'enviado')
            qrcode = inacQr
          } else {
            ingresso.set('status_webhook', 'erro')
          }
          $app.save(ingresso)
        }
      }
    } catch (_) {}

    return e.json(200, { success: true, qrcode: qrcode })
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

      let compradores_total = 0
      try {
        const r = new DynamicModel({ c: 0 })
        $app.db().newQuery('SELECT COUNT(*) as c FROM compradores').one(r)
        compradores_total = r.c
      } catch (_) {}

      return e.json(200, {
        compradores_total,
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

// Remove um ingresso e faz cascade: o participante vinculado, o link de
// participante e os logs de webhook desse ingresso são apagados junto.
// Remove mesmo que o ingresso esteja Pré-Credenciado.
// OBS: não remove o attendee no INAC (só limpa o nosso lado).
routerAdd(
  'POST',
  '/backend/v1/admin/tickets/{id}/delete',
  (e) => {
    try {
      const ticketId = e.request.pathValue('id')
      if (!ticketId) return e.badRequestError('id é obrigatório')

      let ingresso
      try {
        ingresso = $app.findRecordById('ingressos', ticketId)
      } catch (_) {
        return e.notFoundError('Ingresso não encontrado')
      }

      // Se estiver pré-credenciado (tem inac_id), remove o attendee na INAC.
      // Best-effort: NÃO bloqueia a remoção local se a INAC falhar.
      const inacId = ingresso.getString('inac_id')
      let inacDeleted = false
      let inacMsg = ''
      if (inacId) {
        const INAC_WEBHOOK_URL = $os.getenv('INAC_WEBHOOK_URL') || ''
        const INAC_AUTH_TOKEN = $os.getenv('INAC_AUTH_TOKEN') || ''
        // Deriva a URL de delete da de add; fallback pro endpoint conhecido.
        let delUrl = 'https://painel.credenciamento.digital/apiservicev1/attendees/delete'
        if (/\/attendees\/add\/?$/.test(INAC_WEBHOOK_URL)) {
          delUrl = INAC_WEBHOOK_URL.replace(/\/add\/?$/, '/delete')
        }
        if (!INAC_AUTH_TOKEN) {
          inacMsg = 'INAC_AUTH_TOKEN não configurado'
        } else {
          try {
            const res = $http.send({
              url: delUrl,
              method: 'DELETE',
              headers: { 'X-Auth-Token': INAC_AUTH_TOKEN, 'Content-Type': 'application/json' },
              body: JSON.stringify({ id: parseInt(inacId, 10) || inacId, event_id: 375 }),
              timeout: 12,
            })
            inacDeleted = res.statusCode >= 200 && res.statusCode < 300
            inacMsg = 'HTTP ' + res.statusCode
          } catch (err) {
            inacMsg = err && err.message ? err.message : 'erro'
          }
        }
      }

      let removedParticipante = false

      $app.runInTransaction((txApp) => {
        const ing = txApp.findRecordById('ingressos', ticketId)
        const pid = ing.getString('participante_id')

        // 1) participante vinculado direto pelo ingresso
        if (pid) {
          try {
            txApp.delete(txApp.findRecordById('participantes', pid))
            removedParticipante = true
          } catch (_) {}
        }

        // 2) participantes que apontam pra esse ingresso (defensivo)
        try {
          const orphans = txApp.findRecordsByFilter(
            'participantes',
            'ingresso_id = {:iid}',
            '',
            200,
            0,
            { iid: ing.id },
          )
          for (let i = 0; i < orphans.length; i++) {
            try {
              txApp.delete(orphans[i])
              removedParticipante = true
            } catch (_) {}
          }
        } catch (_) {}

        // 3) links de participante desse ingresso
        try {
          const links = txApp.findRecordsByFilter(
            'links_participante',
            'ingresso_id = {:iid}',
            '',
            200,
            0,
            { iid: ing.id },
          )
          for (let i = 0; i < links.length; i++) {
            try {
              txApp.delete(links[i])
            } catch (_) {}
          }
        } catch (_) {}

        // 4) logs de webhook desse ingresso
        try {
          const logs = txApp.findRecordsByFilter(
            'webhooks_log',
            'ingresso_id = {:iid}',
            '',
            1000,
            0,
            { iid: ing.id },
          )
          for (let i = 0; i < logs.length; i++) {
            try {
              txApp.delete(logs[i])
            } catch (_) {}
          }
        } catch (_) {}

        // 5) o ingresso
        txApp.delete(ing)
      })

      return e.json(200, {
        success: true,
        removed_participante: removedParticipante,
        inac_id_present: !!inacId,
        inac_deleted: inacDeleted,
        inac_msg: inacMsg,
      })
    } catch (err) {
      return e.badRequestError(err.message)
    }
  },
  $apis.requireAuth(),
)
