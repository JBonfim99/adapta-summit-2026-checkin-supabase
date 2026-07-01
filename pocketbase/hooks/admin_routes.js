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

    // Regra: um CPF só pode estar em UM credenciamento (ingresso pré-credenciado).
    const cpfDigitsChk = (body.cpf || '').toString().replace(/\D/g, '')
    if (cpfDigitsChk.length === 11) {
      const fmtChk = cpfDigitsChk.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4')
      let cpfTaken = false
      try {
        const recs = $app.findRecordsByFilter(
          'participantes',
          'cpf = {:fmt} || cpf = {:raw}',
          '',
          50,
          0,
          { fmt: fmtChk, raw: cpfDigitsChk },
        )
        for (let i = 0; i < recs.length; i++) {
          const iid = recs[i].getString('ingresso_id')
          try {
            const ing = $app.findRecordById('ingressos', iid)
            if (ing.getString('status') === 'Pré-Credenciado') {
              cpfTaken = true
              break
            }
          } catch (_) {}
        }
      } catch (_) {}
      if (cpfTaken) {
        return e.badRequestError('Este CPF já foi usado em outro credenciamento.')
      }
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

      const parseTs = (s) => {
        if (!s) return NaN
        let v = Date.parse(s)
        if (isNaN(v)) v = Date.parse(String(s).replace(' ', 'T'))
        return v
      }
      const hourly = {}
      let lastMs = 0
      let sumDelta = 0
      let nDelta = 0
      const deltas = []

      for (const ing of ingressos) {
        const isPreenchido = ing.getString('status') === 'Pré-Credenciado'
        const type = ing.getString('tipo_ingresso')

        if (isPreenchido) preenchidos++
        else pendentes++

        if (isPreenchido) {
          const peMs = parseTs(ing.getString('preenchido_em'))
          if (!isNaN(peMs)) {
            const hb = Math.floor(peMs / 3600000) * 3600000
            hourly[hb] = (hourly[hb] || 0) + 1
            if (peMs > lastMs) lastMs = peMs
            const crMs = parseTs(ing.getString('created'))
            if (!isNaN(crMs) && peMs >= crMs) {
              const d = peMs - crMs
              sumDelta += d
              nDelta++
              deltas.push(d)
            }
          }
        }

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

      // Série de credenciamentos por hora (48 buckets terminando na última hora
      // com atividade) + tempo médio/mediana de created -> preenchido_em.
      const endMs = lastMs
        ? Math.floor(lastMs / 3600000) * 3600000
        : Math.floor(Date.now() / 3600000) * 3600000
      const por_hora = []
      for (let i = 47; i >= 0; i--) {
        const b = endMs - i * 3600000
        por_hora.push({ hora: new Date(b).toISOString(), total: hourly[b] || 0 })
      }
      let tempo_medio_ms = nDelta ? Math.round(sumDelta / nDelta) : 0
      let tempo_mediana_ms = 0
      if (deltas.length) {
        deltas.sort((a, b) => a - b)
        const mid = Math.floor(deltas.length / 2)
        tempo_mediana_ms =
          deltas.length % 2 ? deltas[mid] : Math.round((deltas[mid - 1] + deltas[mid]) / 2)
      }

      return e.json(200, {
        compradores_total,
        total,
        preenchidos,
        pendentes,
        erros,
        platinum,
        gold,
        activity,
        por_hora,
        tempo_medio_ms,
        tempo_mediana_ms,
        credenciados_com_tempo: nDelta,
      })
    } catch (err) {
      return e.badRequestError(err.message)
    }
  },
  $apis.requireAuth(),
)

// Remove um ingresso e faz cascade: participante + link + logs + ingresso.
// A INAC é OBRIGATÓRIA quando o ingresso está credenciado (tem inac_id):
// chamamos a INAC ANTES e, se falhar, ABORTA — nada é removido localmente.
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

      // Se credenciado (tem inac_id), remove o attendee na INAC ANTES de tocar
      // no banco. Obrigatório: se não confirmar, aborta e nada é removido.
      const inacId = ingresso.getString('inac_id')
      let inacDeleted = false
      let inacMsg = ''
      if (inacId) {
        const INAC_WEBHOOK_URL = $os.getenv('INAC_WEBHOOK_URL') || ''
        const INAC_AUTH_TOKEN = $os.getenv('INAC_AUTH_TOKEN') || ''
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
              timeout: 15,
            })
            let ok2 = res.statusCode >= 200 && res.statusCode < 300
            let respTxt = ''
            try {
              respTxt = typeof res.body === 'string' ? res.body : new TextDecoder().decode(res.body)
            } catch (_) {}
            try {
              const d = JSON.parse(respTxt)
              if (d && d.status === false) ok2 = false
            } catch (_) {}
            inacDeleted = ok2
            inacMsg = 'HTTP ' + res.statusCode + (ok2 ? '' : ' ' + respTxt.substring(0, 200))
          } catch (err) {
            inacMsg = err && err.message ? err.message : 'erro'
          }
        }

        // Obrigatório: sem confirmação da INAC, aborta (nada removido).
        if (!inacDeleted) {
          return e.json(200, {
            success: false,
            inac_error: true,
            error:
              'Falha ao remover o credenciamento na INAC (' + inacMsg + '). Nada foi removido.',
          })
        }
      }

      // Snapshot pro log de auditoria (antes de apagar).
      const pedidoSnap = ingresso.getString('pedido_id')
      const tipoSnap = ingresso.getString('tipo_ingresso')
      let nomeSnap = ''
      try {
        const pidSnap = ingresso.getString('participante_id')
        if (pidSnap) {
          nomeSnap = $app.findRecordById('participantes', pidSnap).getString('nome_completo')
        }
      } catch (_) {}

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

        // 4) registra a EXCLUSÃO nos Logs (antes de apagar o ingresso).
        //    Não apagamos mais os logs históricos. Ao deletar o ingresso, o
        //    PocketBase zera a relação (cascadeDelete off), então guardamos o
        //    pedido no payload/detalhe pra continuar visível na tela de Logs.
        try {
          const logColl = txApp.findCollectionByNameOrId('webhooks_log')
          const log = new Record(logColl)
          log.set('ingresso_id', ing.id)
          log.set('evento', 'excluido_manual')
          log.set('method', 'MANUAL')
          log.set('status', 200)
          log.set(
            'detalhe',
            'Ingresso ' +
              pedidoSnap +
              ' (' +
              tipoSnap +
              ')' +
              (nomeSnap ? ' — ' + nomeSnap : '') +
              ' — excluído manualmente pelo admin.' +
              (inacId && inacDeleted ? ' Credencial removida na INAC.' : ''),
          )
          log.set(
            'payload',
            JSON.stringify({
              acao: 'exclusao',
              pedido_id: pedidoSnap,
              tipo: tipoSnap,
              participante: nomeSnap,
              inac_id: inacId || '',
              inac_deleted: inacDeleted,
            }),
          )
          log.set('response', inacId ? 'INAC: ' + inacMsg : 'Sem credencial na INAC.')
          txApp.save(log)
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

// Edita um ingresso JÁ CREDENCIADO (tem inac_id): atualiza os dados do
// participante e reflete na INAC via /edit. A INAC é OBRIGATÓRIA — chamamos
// ANTES de tocar no banco; se falhar, nada é alterado localmente.
routerAdd(
  'POST',
  '/backend/v1/admin/tickets/{id}/edit',
  (e) => {
    try {
      const ticketId = e.request.pathValue('id')
      if (!ticketId) return e.badRequestError('id é obrigatório')
      const body = e.requestInfo().body || {}

      let ingresso
      try {
        ingresso = $app.findRecordById('ingressos', ticketId)
      } catch (_) {
        return e.notFoundError('Ingresso não encontrado')
      }

      const inacId = ingresso.getString('inac_id')
      if (!inacId) {
        return e.badRequestError('Este ingresso não está credenciado na INAC.')
      }

      const partId = ingresso.getString('participante_id')
      let part
      try {
        part = $app.findRecordById('participantes', partId)
      } catch (_) {
        return e.badRequestError('Participante não encontrado para este ingresso.')
      }

      // Snapshot dos valores atuais (pro log de auditoria).
      const antes = {
        nome_completo: part.getString('nome_completo'),
        email: part.getString('email'),
        cpf: part.getString('cpf'),
        telefone: part.getString('telefone'),
        tem_empresa: part.getBool('tem_empresa'),
        nome_empresa: part.getString('nome_empresa'),
        cargo: part.getString('cargo'),
        profissao: part.getString('profissao'),
      }

      const onlyDigits = (s) => (s || '').replace(/\D/g, '')
      const nomeCompleto = (body.nome_completo || '').toString().trim()
      const emailNorm = (body.email || '').toString().trim().toLowerCase()
      const cpf = (body.cpf || '').toString().trim()
      const telefone = (body.telefone || '').toString().trim()
      const temEmpresa = body.tem_empresa === true || body.tem_empresa === 'true'
      const nomeEmpresa = temEmpresa ? (body.nome_empresa || '').toString().trim() : ''
      const cargo = temEmpresa ? (body.cargo || '').toString().trim() : ''
      const profissao = temEmpresa ? '' : (body.profissao || '').toString().trim()

      if (nomeCompleto.length < 3) return e.badRequestError('Nome é obrigatório')
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(emailNorm)) return e.badRequestError('E-mail inválido')
      if (onlyDigits(cpf).length !== 11) return e.badRequestError('CPF inválido')
      if (onlyDigits(telefone).length < 10) return e.badRequestError('Telefone inválido')
      if (temEmpresa && nomeEmpresa.length < 2) return e.badRequestError('Empresa é obrigatória')
      if (!temEmpresa && profissao.length < 2) return e.badRequestError('Profissão é obrigatória')

      // e-mail único entre participantes (ignora o próprio)
      let emailDup = false
      try {
        const other = $app.findFirstRecordByFilter('participantes', 'email = {:em}', {
          em: emailNorm,
        })
        if (other && other.id !== part.id) emailDup = true
      } catch (_) {}
      if (emailDup) {
        return e.badRequestError('Este e-mail já foi usado por outro participante. Use outro.')
      }

      // Regra: CPF não pode estar em outro credenciamento (ignora o próprio ingresso).
      const cpfDigitsE = onlyDigits(cpf)
      if (cpfDigitsE.length === 11) {
        const fmtE = cpfDigitsE.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4')
        let cpfTakenE = false
        try {
          const recs = $app.findRecordsByFilter(
            'participantes',
            'cpf = {:fmt} || cpf = {:raw}',
            '',
            50,
            0,
            { fmt: fmtE, raw: cpfDigitsE },
          )
          for (let i = 0; i < recs.length; i++) {
            const iid = recs[i].getString('ingresso_id')
            if (iid && iid === ticketId) continue
            try {
              const ing = $app.findRecordById('ingressos', iid)
              if (ing.getString('status') === 'Pré-Credenciado') {
                cpfTakenE = true
                break
              }
            } catch (_) {}
          }
        } catch (_) {}
        if (cpfTakenE) {
          return e.badRequestError('Este CPF já foi usado em outro credenciamento.')
        }
      }

      // ---- INAC /edit ANTES de tocar no banco (obrigatório) ----
      const INAC_WEBHOOK_URL = $os.getenv('INAC_WEBHOOK_URL') || ''
      const INAC_AUTH_TOKEN = $os.getenv('INAC_AUTH_TOKEN') || ''
      if (!INAC_AUTH_TOKEN) return e.badRequestError('INAC_AUTH_TOKEN não configurado')
      let editUrl = 'https://painel.credenciamento.digital/apiservicev1/attendees/edit'
      if (/\/attendees\/add\/?$/.test(INAC_WEBHOOK_URL)) {
        editUrl = INAC_WEBHOOK_URL.replace(/\/add\/?$/, '/edit')
      }
      let tel = onlyDigits(telefone)
      if (tel && tel.length <= 11) tel = '55' + tel
      const categoria = ingresso.getString('tipo_ingresso')
      const categoryId = categoria === 'PLATINUM' ? 6125 : 6123
      const payload = {
        id: parseInt(inacId, 10) || inacId,
        event_id: 375,
        category_id: categoryId,
        status: 'active',
        fields: [
          { id: 10133653, value: nomeCompleto },
          { id: 10133654, value: emailNorm },
          { id: 10133655, value: onlyDigits(cpf) },
          { id: 10133656, value: tel },
          { id: 10133657, value: nomeEmpresa || profissao },
          { id: 10133665, value: ingresso.getString('pedido_id') },
        ],
      }

      let inacOk = false
      let inacMsg = ''
      try {
        const res = $http.send({
          url: editUrl,
          method: 'PUT',
          headers: { 'X-Auth-Token': INAC_AUTH_TOKEN, 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          timeout: 15,
        })
        let ok2 = res.statusCode >= 200 && res.statusCode < 300
        let respTxt = ''
        try {
          respTxt = typeof res.body === 'string' ? res.body : new TextDecoder().decode(res.body)
        } catch (_) {}
        try {
          const d = JSON.parse(respTxt)
          if (d && d.status === false) ok2 = false
        } catch (_) {}
        inacOk = ok2
        inacMsg = 'HTTP ' + res.statusCode + (ok2 ? '' : ' ' + respTxt.substring(0, 200))
      } catch (err) {
        inacMsg = err && err.message ? err.message : 'erro'
      }

      if (!inacOk) {
        return e.json(200, {
          success: false,
          inac_error: true,
          error: 'Falha ao editar o credenciamento na INAC (' + inacMsg + '). Nada foi alterado.',
        })
      }

      // ---- INAC OK: atualiza o participante localmente ----
      try {
        part.set('nome_completo', nomeCompleto)
        part.set('email', emailNorm)
        part.set('cpf', cpf)
        part.set('telefone', telefone)
        part.set('tem_empresa', temEmpresa)
        part.set('nome_empresa', nomeEmpresa)
        part.set('cargo', cargo)
        part.set('profissao', profissao)
        part.set('nicho', (body.nicho || '').toString())
        part.set('num_funcionarios', temEmpresa ? (body.num_funcionarios || '').toString() : '')
        part.set('faturamento_anual', temEmpresa ? (body.faturamento_anual || '').toString() : '')
        part.set('ia_uso_diario', parseInt(body.ia_uso_diario, 10) || 0)
        part.set('ia_profundidade', parseInt(body.ia_profundidade, 10) || 0)
        part.set('ia_ferramentas', (body.ia_ferramentas || '').toString())
        part.set('ia_desafio', (body.ia_desafio || '').toString())
        $app.save(part)
      } catch (err) {
        return e.json(200, {
          success: false,
          error:
            'A INAC foi atualizada, mas falhou ao salvar localmente: ' +
            (err && err.message ? err.message : 'erro') +
            '. Tente novamente.',
        })
      }

      // audit: registra a EDIÇÃO manual nos Logs.
      try {
        const logColl = $app.findCollectionByNameOrId('webhooks_log')
        const log = new Record(logColl)
        log.set('ingresso_id', ingresso.id)
        log.set('evento', 'editado_manual')
        log.set('method', 'MANUAL')
        log.set('status', 200)
        log.set(
          'detalhe',
          'Ingresso ' +
            ingresso.getString('pedido_id') +
            ' — ' +
            nomeCompleto +
            ' — dados editados manualmente pelo admin.',
        )
        log.set(
          'payload',
          JSON.stringify({
            acao: 'edicao',
            pedido_id: ingresso.getString('pedido_id'),
            participante: nomeCompleto,
            antes: antes,
            depois: {
              nome_completo: nomeCompleto,
              email: emailNorm,
              cpf: cpf,
              telefone: telefone,
              tem_empresa: temEmpresa,
              nome_empresa: nomeEmpresa,
              cargo: cargo,
              profissao: profissao,
            },
          }),
        )
        log.set('response', 'INAC /edit OK (' + inacMsg + ')')
        $app.save(log)
      } catch (_) {}

      return e.json(200, { success: true })
    } catch (err) {
      return e.badRequestError(err.message)
    }
  },
  $apis.requireAuth(),
)

// Muda o tipo do ingresso (GOLD <-> PLATINUM). Se credenciado (tem inac_id),
// atualiza a categoria na INAC via /edit ANTES de salvar local (obrigatório,
// rollback se falhar). GOLD = categoria 6123, PLATINUM = 6125.
routerAdd(
  'POST',
  '/backend/v1/admin/tickets/{id}/change-type',
  (e) => {
    try {
      const ticketId = e.request.pathValue('id')
      if (!ticketId) return e.badRequestError('id é obrigatório')
      const body = e.requestInfo().body || {}
      const tipo = (body.tipo || '').toString().trim().toUpperCase()
      if (tipo !== 'GOLD' && tipo !== 'PLATINUM') {
        return e.badRequestError('tipo deve ser GOLD ou PLATINUM')
      }

      let ingresso
      try {
        ingresso = $app.findRecordById('ingressos', ticketId)
      } catch (_) {
        return e.notFoundError('Ingresso não encontrado')
      }

      const tipoAntes = ingresso.getString('tipo_ingresso')
      if (ingresso.getString('tipo_ingresso') === tipo) {
        return e.json(200, { success: true, unchanged: true })
      }

      const inacId = ingresso.getString('inac_id')

      // Credenciado: reflete a nova categoria na INAC antes de tocar no banco.
      if (inacId) {
        const partId = ingresso.getString('participante_id')
        let part
        try {
          part = $app.findRecordById('participantes', partId)
        } catch (_) {
          return e.badRequestError('Participante não encontrado para este ingresso credenciado.')
        }

        const INAC_WEBHOOK_URL = $os.getenv('INAC_WEBHOOK_URL') || ''
        const INAC_AUTH_TOKEN = $os.getenv('INAC_AUTH_TOKEN') || ''
        if (!INAC_AUTH_TOKEN) return e.badRequestError('INAC_AUTH_TOKEN não configurado')
        let editUrl = 'https://painel.credenciamento.digital/apiservicev1/attendees/edit'
        if (/\/attendees\/add\/?$/.test(INAC_WEBHOOK_URL)) {
          editUrl = INAC_WEBHOOK_URL.replace(/\/add\/?$/, '/edit')
        }
        const onlyDigits = (s) => (s || '').replace(/\D/g, '')
        let tel = onlyDigits(part.getString('telefone'))
        if (tel && tel.length <= 11) tel = '55' + tel
        const categoryId = tipo === 'PLATINUM' ? 6125 : 6123
        const payload = {
          id: parseInt(inacId, 10) || inacId,
          event_id: 375,
          category_id: categoryId,
          status: 'active',
          fields: [
            { id: 10133653, value: part.getString('nome_completo') || '' },
            { id: 10133654, value: part.getString('email') || '' },
            { id: 10133655, value: onlyDigits(part.getString('cpf')) },
            { id: 10133656, value: tel },
            {
              id: 10133657,
              value: part.getString('nome_empresa') || part.getString('profissao') || '',
            },
            { id: 10133665, value: ingresso.getString('pedido_id') },
          ],
        }

        let inacOk = false
        let inacMsg = ''
        try {
          const res = $http.send({
            url: editUrl,
            method: 'PUT',
            headers: { 'X-Auth-Token': INAC_AUTH_TOKEN, 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            timeout: 15,
          })
          let ok2 = res.statusCode >= 200 && res.statusCode < 300
          let respTxt = ''
          try {
            respTxt = typeof res.body === 'string' ? res.body : new TextDecoder().decode(res.body)
          } catch (_) {}
          try {
            const d = JSON.parse(respTxt)
            if (d && d.status === false) ok2 = false
          } catch (_) {}
          inacOk = ok2
          inacMsg = 'HTTP ' + res.statusCode + (ok2 ? '' : ' ' + respTxt.substring(0, 200))
        } catch (err) {
          inacMsg = err && err.message ? err.message : 'erro'
        }

        if (!inacOk) {
          return e.json(200, {
            success: false,
            inac_error: true,
            error: 'Falha ao atualizar a categoria na INAC (' + inacMsg + '). Nada foi alterado.',
          })
        }
      }

      // Atualiza o tipo localmente.
      try {
        ingresso.set('tipo_ingresso', tipo)
        $app.save(ingresso)
      } catch (err) {
        return e.json(200, {
          success: false,
          error:
            (inacId ? 'A INAC foi atualizada, mas ' : '') +
            'falhou ao salvar localmente: ' +
            (err && err.message ? err.message : 'erro'),
        })
      }

      // audit: registra a TROCA DE TIPO nos Logs.
      try {
        const logColl = $app.findCollectionByNameOrId('webhooks_log')
        const log = new Record(logColl)
        log.set('ingresso_id', ingresso.id)
        log.set('evento', 'tipo_alterado')
        log.set('method', 'MANUAL')
        log.set('status', 200)
        log.set(
          'detalhe',
          'Ingresso ' +
            ingresso.getString('pedido_id') +
            ' — tipo alterado de ' +
            tipoAntes +
            ' para ' +
            tipo +
            (inacId ? ' (INAC atualizada).' : '.'),
        )
        log.set(
          'payload',
          JSON.stringify({
            acao: 'tipo',
            pedido_id: ingresso.getString('pedido_id'),
            de: tipoAntes,
            para: tipo,
            inac_id: inacId || '',
          }),
        )
        log.set('response', inacId ? 'INAC /edit OK' : 'Sem credencial na INAC.')
        $app.save(log)
      } catch (_) {}

      return e.json(200, { success: true, tipo: tipo })
    } catch (err) {
      return e.badRequestError(err.message)
    }
  },
  $apis.requireAuth(),
)

// Remove um comprador com cascade: ingressos (pendentes) + participantes +
// links + logs + tokens_acesso (magic link) + o comprador. Bloqueia se houver
// qualquer ingresso credenciado (tem inac_id ou status Pré-Credenciado) — esses
// devem ser tratados pelos fluxos de ingresso (que falam com a INAC).
routerAdd(
  'POST',
  '/backend/v1/admin/buyers/{id}/delete',
  (e) => {
    try {
      const buyerId = e.request.pathValue('id')
      if (!buyerId) return e.badRequestError('id é obrigatório')

      let comprador
      try {
        comprador = $app.findRecordById('compradores', buyerId)
      } catch (_) {
        return e.notFoundError('Comprador não encontrado')
      }

      const nomeC = comprador.getString('nome')
      const emailC = comprador.getString('email')

      let ingressos = []
      try {
        ingressos = $app.findRecordsByFilter('ingressos', 'comprador_id = {:cid}', '', 5000, 0, {
          cid: buyerId,
        })
      } catch (_) {}

      // Bloqueia se houver ingresso credenciado.
      for (let i = 0; i < ingressos.length; i++) {
        const ing = ingressos[i]
        if (ing.getString('inac_id') || ing.getString('status') === 'Pré-Credenciado') {
          return e.json(200, {
            success: false,
            error:
              'Este comprador tem ingressos credenciados. Remova ou gerencie os ingressos credenciados antes de excluir o comprador.',
          })
        }
      }

      let removedIngressos = 0
      $app.runInTransaction((txApp) => {
        for (let i = 0; i < ingressos.length; i++) {
          let ing
          try {
            ing = txApp.findRecordById('ingressos', ingressos[i].id)
          } catch (_) {
            continue
          }
          const iid = ing.id
          try {
            const ps = txApp.findRecordsByFilter(
              'participantes',
              'ingresso_id = {:iid}',
              '',
              200,
              0,
              {
                iid: iid,
              },
            )
            for (let j = 0; j < ps.length; j++) {
              try {
                txApp.delete(ps[j])
              } catch (_) {}
            }
          } catch (_) {}
          try {
            const ls = txApp.findRecordsByFilter(
              'links_participante',
              'ingresso_id = {:iid}',
              '',
              200,
              0,
              { iid: iid },
            )
            for (let j = 0; j < ls.length; j++) {
              try {
                txApp.delete(ls[j])
              } catch (_) {}
            }
          } catch (_) {}
          try {
            const lg = txApp.findRecordsByFilter(
              'webhooks_log',
              'ingresso_id = {:iid}',
              '',
              1000,
              0,
              {
                iid: iid,
              },
            )
            for (let j = 0; j < lg.length; j++) {
              try {
                txApp.delete(lg[j])
              } catch (_) {}
            }
          } catch (_) {}
          try {
            txApp.delete(ing)
            removedIngressos++
          } catch (_) {}
        }

        // tokens_acesso (magic link) — relação obrigatória que bloqueava o delete.
        try {
          const ts = txApp.findRecordsByFilter(
            'tokens_acesso',
            'comprador_id = {:cid}',
            '',
            500,
            0,
            {
              cid: buyerId,
            },
          )
          for (let j = 0; j < ts.length; j++) {
            try {
              txApp.delete(ts[j])
            } catch (_) {}
          }
        } catch (_) {}

        // Registra a exclusão do comprador nos Logs (evento sem ingresso).
        try {
          const logColl = txApp.findCollectionByNameOrId('webhooks_log')
          const log = new Record(logColl)
          log.set('evento', 'comprador_excluido')
          log.set('method', 'MANUAL')
          log.set('status', 200)
          log.set(
            'detalhe',
            'Comprador ' +
              nomeC +
              ' (' +
              emailC +
              ') excluído manualmente pelo admin' +
              (removedIngressos ? ' — ' + removedIngressos + ' ingresso(s) removido(s).' : '.'),
          )
          log.set(
            'payload',
            JSON.stringify({
              acao: 'exclusao_comprador',
              nome: nomeC,
              email: emailC,
              ingressos_removidos: removedIngressos,
            }),
          )
          log.set('response', 'Sem INAC.')
          txApp.save(log)
        } catch (_) {}

        txApp.delete(txApp.findRecordById('compradores', buyerId))
      })

      return e.json(200, { success: true, removed_ingressos: removedIngressos })
    } catch (err) {
      return e.badRequestError(err.message)
    }
  },
  $apis.requireAuth(),
)
