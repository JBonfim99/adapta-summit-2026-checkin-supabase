// Busca de participantes/ingressos para a tela de Gestão de Participantes.
// Feita em SQL porque filtrar pela API do PocketBase por campos de relação
// aninhados retorna 400. Retorna no MESMO formato do getList (com expand).
//
// Performance:
//  - SEM busca textual: conta direto na ingressos (sem joins) e lista com
//    ORDER BY created DESC LIMIT usando o índice idx_ingressos_created -> lê só
//    as 10 linhas da página.
//  - COM busca textual: o scan roda SEM ORDER BY (varredura sequencial, rápida),
//    ordena/pagina em memória e só então busca os dados completos das ~10 linhas
//    da página. Evita o acesso aleatório que o índice de created causaria.
routerAdd(
  'GET',
  '/backend/v1/admin/participants/search',
  (e) => {
    try {
      const info = e.requestInfo()
      const query = info.query || {}
      const readQ = (k) => {
        const v = query[k]
        if (v == null) return ''
        return (Array.isArray(v) ? v[0] : v).toString()
      }

      const q = readQ('q').trim().toLowerCase()
      const status = readQ('status')
      const tipo = readQ('tipo')
      let page = parseInt(readQ('page'), 10)
      if (isNaN(page) || page < 1) page = 1
      let perPage = parseInt(readQ('perPage'), 10)
      if (isNaN(perPage) || perPage < 1) perPage = 10
      if (perPage > 500) perPage = 500
      const offset = (page - 1) * perPage

      const FROMJOIN =
        'FROM ingressos i ' +
        'LEFT JOIN compradores c ON c.id = i.comprador_id ' +
        'LEFT JOIN participantes p ON p.id = i.participante_id'

      const SELCOLS =
        'i.id as id, i.pedido_id as pedido_id, i.tipo_ingresso as tipo_ingresso, i.status as status, ' +
        "COALESCE(i.inac_id,'') as inac_id, " +
        "COALESCE(c.email,'') as comprador_email, " +
        "COALESCE(i.comprador_id,'') as comprador_id, COALESCE(c.nome,'') as comprador_nome, " +
        "COALESCE(p.id,'') as part_id, COALESCE(p.nome_completo,'') as nome_completo, COALESCE(p.email,'') as email, COALESCE(p.cpf,'') as cpf, COALESCE(p.telefone,'') as telefone, " +
        "COALESCE(p.tem_empresa,0) as tem_empresa, COALESCE(p.nome_empresa,'') as nome_empresa, COALESCE(p.cargo,'') as cargo, COALESCE(p.profissao,'') as profissao, COALESCE(p.nicho,'') as nicho, " +
        "COALESCE(p.num_funcionarios,'') as num_funcionarios, COALESCE(p.faturamento_anual,'') as faturamento_anual, " +
        'COALESCE(p.ia_uso_diario,0) as ia_uso_diario, COALESCE(p.ia_profundidade,0) as ia_profundidade, ' +
        "COALESCE(p.ia_ferramentas,'') as ia_ferramentas, COALESCE(p.ia_desafio,'') as ia_desafio"

      const newRowModel = () =>
        new DynamicModel({
          id: '',
          pedido_id: '',
          tipo_ingresso: '',
          status: '',
          inac_id: '',
          comprador_email: '',
          comprador_id: '',
          comprador_nome: '',
          part_id: '',
          nome_completo: '',
          email: '',
          cpf: '',
          telefone: '',
          tem_empresa: 0,
          nome_empresa: '',
          cargo: '',
          profissao: '',
          nicho: '',
          num_funcionarios: '',
          faturamento_anual: '',
          ia_uso_diario: 0,
          ia_profundidade: 0,
          ia_ferramentas: '',
          ia_desafio: '',
        })

      const mapRow = (r) => {
        const hasPart = !!r.part_id
        return {
          id: r.id,
          pedido_id: r.pedido_id,
          tipo_ingresso: r.tipo_ingresso,
          status: r.status,
          inac_id: r.inac_id,
          expand: {
            // id/nome vão junto: telas de ação (reenvio) precisam do id real,
            // não só do e-mail para exibir.
            comprador_id: r.comprador_email
              ? { id: r.comprador_id, nome: r.comprador_nome, email: r.comprador_email }
              : undefined,
            participante_id: hasPart
              ? {
                  id: r.part_id,
                  nome_completo: r.nome_completo,
                  email: r.email,
                  cpf: r.cpf,
                  telefone: r.telefone,
                  tem_empresa: r.tem_empresa === true || r.tem_empresa === 1,
                  nome_empresa: r.nome_empresa,
                  cargo: r.cargo,
                  profissao: r.profissao,
                  nicho: r.nicho,
                  num_funcionarios: r.num_funcionarios,
                  faturamento_anual: r.faturamento_anual,
                  ia_uso_diario: r.ia_uso_diario,
                  ia_profundidade: r.ia_profundidade,
                  ia_ferramentas: r.ia_ferramentas,
                  ia_desafio: r.ia_desafio,
                }
              : undefined,
          },
        }
      }

      let items = []
      let totalItems = 0

      if (q) {
        // ---- COM busca textual: scan SEM order by -> ordena/pagina em memória ----
        const p2 = { like: '%' + q + '%' }
        const andC = []
        if (status === 'Pendente' || status === 'Pré-Credenciado') {
          andC.push('i.status = {:status}')
          p2.status = status
        }
        if (tipo === 'GOLD' || tipo === 'PLATINUM') {
          andC.push('i.tipo_ingresso = {:tipo}')
          p2.tipo = tipo
        }
        let matchSql =
          'SELECT i.id as id, i.created as created ' +
          FROMJOIN +
          ' WHERE (lower(c.email) LIKE {:like} OR lower(i.pedido_id) LIKE {:like} OR lower(p.nome_completo) LIKE {:like} OR lower(p.email) LIKE {:like})'
        if (andC.length) matchSql += ' AND ' + andC.join(' AND ')

        const matched = arrayOf(new DynamicModel({ id: '', created: '' }))
        $app.db().newQuery(matchSql).bind(p2).all(matched)

        const arr = []
        for (let i = 0; i < matched.length; i++) {
          arr.push({ id: matched[i].id, created: matched[i].created })
        }
        arr.sort((a, b) => (a.created < b.created ? 1 : a.created > b.created ? -1 : 0))
        totalItems = arr.length

        const pageSlice = arr.slice(offset, offset + perPage)
        const pageIds = []
        for (let i = 0; i < pageSlice.length; i++) {
          const safe = String(pageSlice[i].id).replace(/[^a-zA-Z0-9]/g, '')
          if (safe) pageIds.push(safe)
        }

        if (pageIds.length > 0) {
          const quoted = "'" + pageIds.join("','") + "'"
          const rows = arrayOf(newRowModel())
          $app
            .db()
            .newQuery('SELECT ' + SELCOLS + ' ' + FROMJOIN + ' WHERE i.id IN (' + quoted + ')')
            .all(rows)
          const byId = {}
          for (let i = 0; i < rows.length; i++) byId[rows[i].id] = rows[i]
          for (let i = 0; i < pageIds.length; i++) {
            const r = byId[pageIds[i]]
            if (r) items.push(mapRow(r))
          }
        }
      } else {
        // ---- SEM busca textual: count sem joins + lista pelo índice de created ----
        const wc = []
        const params = {}
        if (status === 'Pendente' || status === 'Pré-Credenciado') {
          wc.push('status = {:status}')
          params.status = status
        }
        if (tipo === 'GOLD' || tipo === 'PLATINUM') {
          wc.push('tipo_ingresso = {:tipo}')
          params.tipo = tipo
        }
        const whereCount = wc.length ? ' WHERE ' + wc.join(' AND ') : ''
        try {
          const cnt = new DynamicModel({ c: 0 })
          $app
            .db()
            .newQuery('SELECT COUNT(*) as c FROM ingressos' + whereCount)
            .bind(params)
            .one(cnt)
          totalItems = cnt.c
        } catch (_) {}

        const wi = []
        if (status === 'Pendente' || status === 'Pré-Credenciado') wi.push('i.status = {:status}')
        if (tipo === 'GOLD' || tipo === 'PLATINUM') wi.push('i.tipo_ingresso = {:tipo}')
        const whereMain = wi.length ? ' WHERE ' + wi.join(' AND ') : ''
        params.limit = perPage
        params.offset = offset
        const rows = arrayOf(newRowModel())
        $app
          .db()
          .newQuery(
            'SELECT ' +
              SELCOLS +
              ' ' +
              FROMJOIN +
              whereMain +
              ' ORDER BY i.created DESC LIMIT {:limit} OFFSET {:offset}',
          )
          .bind(params)
          .all(rows)
        for (let i = 0; i < rows.length; i++) items.push(mapRow(rows[i]))
      }

      const totalPages = Math.max(1, Math.ceil(totalItems / perPage))
      return e.json(200, {
        items: items,
        page: page,
        perPage: perPage,
        totalItems: totalItems,
        totalPages: totalPages,
      })
    } catch (err) {
      return e.badRequestError(err.message)
    }
  },
  $apis.requireAuth(),
)
