// ---------------------------------------------------------------------------
// RECONCILIAÇÃO de ingressos: compara, por comprador, o total de ingressos
// que ele TEM no nosso sistema com o total que ele DEVERIA ter segundo uma
// planilha de referência (ex: export do Guru). Só leitura — não altera nada.
// Processado em lotes vindos do frontend (tela /admin/reconciliar).
// ---------------------------------------------------------------------------
routerAdd(
  'POST',
  '/backend/v1/admin/reconciliar-ingressos',
  (e) => {
    const body = e.requestInfo().body || {}
    const rows = Array.isArray(body.rows) ? body.rows : []

    const out = {
      classificacoes: { ok: 0, excesso: 0, faltando: 0, comprador_nao_encontrado: 0 },
      anomalias: [],
    }

    for (const row of rows) {
      const email = (row.email || '').toString().trim().toLowerCase()
      const cpf = (row.cpf || '').toString().replace(/\D/g, '')
      const nome = (row.nome || '').toString().trim()
      const categorias = (row.categorias || '').toString().trim()
      const esperado = parseInt(row.ingressos_esperado, 10) || 0

      let comprador = null
      if (email) {
        try {
          comprador = $app.findFirstRecordByData('compradores', 'email', email)
        } catch (_) {}
      }
      if (!comprador && cpf) {
        try {
          comprador = $app.findFirstRecordByData('compradores', 'documento', cpf)
        } catch (_) {}
      }

      if (!comprador) {
        out.classificacoes.comprador_nao_encontrado++
        out.anomalias.push({
          nome: nome,
          email: email,
          cpf: cpf,
          categorias: categorias,
          esperado: esperado,
          atual: 0,
          classificacao: 'comprador_nao_encontrado',
          tickets: [],
        })
        continue
      }

      let tickets = []
      try {
        tickets = $app.findRecordsByFilter(
          'ingressos',
          'comprador_id = "' + comprador.id + '"',
          'created',
          50,
          0,
        )
      } catch (_) {
        tickets = []
      }

      const atual = tickets.length
      const delta = atual - esperado
      let classificacao = 'ok'
      if (delta > 0) classificacao = 'excesso'
      else if (delta < 0) classificacao = 'faltando'

      out.classificacoes[classificacao]++

      if (classificacao !== 'ok') {
        out.anomalias.push({
          nome: nome,
          email: email,
          cpf: cpf,
          categorias: categorias,
          comprador_id: comprador.id,
          esperado: esperado,
          atual: atual,
          delta: delta,
          classificacao: classificacao,
          tickets: tickets.map((t) => ({
            id: t.id,
            pedido_id: t.getString('pedido_id'),
            tipo_ingresso: t.getString('tipo_ingresso'),
            status: t.getString('status'),
            participante_id: t.getString('participante_id'),
            inac_id: t.getString('inac_id'),
            origem: t.getString('origem'),
            created: t.getString('created'),
          })),
        })
      }
    }

    return e.json(200, out)
  },
  $apis.requireAuth(),
)
