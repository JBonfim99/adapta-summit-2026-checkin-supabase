// ---------------------------------------------------------------------------
// CRIAÇÃO dos compradores ausentes detectados pela reconciliação (linhas
// classificadas como "comprador_nao_encontrado"). Cria o comprador + os
// ingressos dele + o links_participante de cada ingresso.
//
// Complementa /backend/v1/admin/reconciliar-ingressos, que é SÓ LEITURA.
//
// Idempotente: antes de criar, checa de novo se o comprador já existe (por
// email e depois por documento). Rodar duas vezes não duplica — a segunda
// passada devolve esses casos em "ja_existiam".
//
// NÃO dispara e-mail de acesso. Quem for criado aqui fica com os ingressos
// Pendente e o link gerado; o envio é um passo separado.
// ---------------------------------------------------------------------------
routerAdd(
  'POST',
  '/backend/v1/admin/reconciliar-criar-compradores',
  (e) => {
    const body = e.requestInfo().body || {}
    const rows = Array.isArray(body.rows) ? body.rows : []

    const out = {
      criados: 0,
      ingressos_criados: 0,
      ja_existiam: 0,
      indefinidos: [],
      erros: [],
    }

    // Deriva quantos ingressos GOLD e quantos PLATINUM criar. O CSV de
    // referência traz só a coluna "categorias" ("Gold", "Platinum" ou
    // "Gold / Platinum") e o TOTAL de ingressos — nunca a quantidade por
    // categoria. Então:
    //   - só Gold / só Platinum -> tudo na mesma categoria
    //   - misto com 2 ingressos -> 1 de cada (é o único arranjo possível)
    //   - misto com 1 ingresso  -> PLATINUM (caso de upgrade: comprou GOLD e
    //                             trocou por PLATINUM; o total já vem
    //                             descontado da transação de upgrade)
    //   - misto com 3+          -> INDEFINIDO. Pode ser 2+1 ou 1+2 e não dá
    //                             pra saber pelo CSV. Não cria nada e devolve
    //                             na lista de indefinidos pra conferência
    //                             manual na origem (Guru).
    // Criar com a categoria errada é pior do que não criar: a pessoa seria
    // credenciada na categoria errada no dia do evento.
    const derivarSplit = (categorias, total) => {
      if (total <= 0) return null
      const c = (categorias || '').toString().toLowerCase()
      const temGold = c.indexOf('gold') !== -1
      const temPlatinum = c.indexOf('platinum') !== -1
      if (temGold && !temPlatinum) return { gold: total, platinum: 0 }
      if (temPlatinum && !temGold) return { gold: 0, platinum: total }
      if (temGold && temPlatinum) {
        if (total === 1) return { gold: 0, platinum: 1 }
        if (total === 2) return { gold: 1, platinum: 1 }
        return null
      }
      // Categoria irreconhecível no CSV — não chuta.
      return null
    }

    const usedPedidoIds = {}
    const genPedidoId = (txApp) => {
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

    for (const row of rows) {
      const email = (row.email || '').toString().trim().toLowerCase()
      const cpf = (row.cpf || '').toString().replace(/\D/g, '')
      const nome = (row.nome || '').toString().trim()
      const uf = (row.uf || '').toString().trim()
      const cidade = (row.cidade || '').toString().trim()
      const telefone = (row.telefone || '').toString().trim()
      const categorias = (row.categorias || '').toString().trim()
      const total = parseInt(row.ingressos_esperado, 10) || 0

      if (!email) {
        out.erros.push({ nome: nome, email: email, cpf: cpf, erro: 'Linha sem email' })
        continue
      }

      // Recheca a existência (idempotência + corrida entre lotes).
      let jaExiste = false
      try {
        $app.findFirstRecordByData('compradores', 'email', email)
        jaExiste = true
      } catch (_) {}
      if (!jaExiste && cpf) {
        try {
          $app.findFirstRecordByData('compradores', 'documento', cpf)
          jaExiste = true
        } catch (_) {}
      }
      if (jaExiste) {
        out.ja_existiam++
        continue
      }

      const split = derivarSplit(categorias, total)
      if (!split) {
        out.indefinidos.push({
          nome: nome,
          email: email,
          cpf: cpf,
          categorias: categorias,
          esperado: total,
          motivo:
            total <= 0
              ? 'Total de ingressos zerado'
              : 'Categoria mista com ' + total + ' ingressos: não dá pra saber quantos de cada',
        })
        continue
      }

      try {
        let ingressosDaLinha = 0
        $app.runInTransaction((txApp) => {
          const compradoresCollection = txApp.findCollectionByNameOrId('compradores')
          const ingressosCollection = txApp.findCollectionByNameOrId('ingressos')
          const linksCollection = txApp.findCollectionByNameOrId('links_participante')

          const comprador = new Record(compradoresCollection)
          comprador.set('email', email)
          comprador.set('documento', cpf)
          comprador.set('nome', nome)
          comprador.set('uf', uf)
          comprador.set('cidade', cidade)
          comprador.set('telefone', telefone)
          txApp.save(comprador)

          const criarIngresso = (tipo) => {
            const ingresso = new Record(ingressosCollection)
            ingresso.set('comprador_id', comprador.id)
            ingresso.set('pedido_id', genPedidoId(txApp))
            ingresso.set('tipo_ingresso', tipo)
            ingresso.set('status', 'Pendente')
            ingresso.set('status_webhook', 'pendente')
            ingresso.set('origem', 'reconciliacao')
            txApp.save(ingresso)
            ingressosDaLinha++

            const link = new Record(linksCollection)
            link.set('ingresso_id', ingresso.id)
            link.set('token', $security.randomString(32))
            link.set('usado', false)
            const exp = new Date()
            exp.setFullYear(exp.getFullYear() + 1)
            link.set('expira_em', exp.toISOString())
            txApp.save(link)
          }

          for (let i = 0; i < split.gold; i++) criarIngresso('GOLD')
          for (let i = 0; i < split.platinum; i++) criarIngresso('PLATINUM')
        })

        out.criados++
        out.ingressos_criados += ingressosDaLinha
      } catch (err) {
        out.erros.push({
          nome: nome,
          email: email,
          cpf: cpf,
          erro: err && err.message ? err.message : 'Erro ao criar',
        })
      }
    }

    return e.json(200, out)
  },
  $apis.requireAuth(),
)
