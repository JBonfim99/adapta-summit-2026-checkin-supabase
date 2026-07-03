// Busca de participantes/ingressos para a tela de Gestão de Participantes.
// Feita em SQL (JOIN) porque filtrar pela API do PocketBase usando campos de
// relação aninhados (comprador_id.email, participante_id.nome_completo) retorna
// 400. Aqui resolvemos por join direto — rápido e sem essa limitação.
// Retorna no MESMO formato do getList (com expand) pra tela não precisar mudar.
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

      const conds = []
      const params = {}
      if (q) {
        params.like = '%' + q + '%'
        conds.push(
          '(lower(c.email) LIKE {:like} OR lower(i.pedido_id) LIKE {:like} OR lower(p.nome_completo) LIKE {:like} OR lower(p.email) LIKE {:like})',
        )
      }
      if (status === 'Pendente' || status === 'Pré-Credenciado') {
        params.status = status
        conds.push('i.status = {:status}')
      }
      if (tipo === 'GOLD' || tipo === 'PLATINUM') {
        params.tipo = tipo
        conds.push('i.tipo_ingresso = {:tipo}')
      }
      const where = conds.length ? 'WHERE ' + conds.join(' AND ') : ''
      const base =
        'FROM ingressos i ' +
        'LEFT JOIN compradores c ON c.id = i.comprador_id ' +
        'LEFT JOIN participantes p ON p.id = i.participante_id ' +
        where

      let totalItems = 0
      try {
        const cnt = new DynamicModel({ c: 0 })
        $app
          .db()
          .newQuery('SELECT COUNT(*) as c ' + base)
          .bind(params)
          .one(cnt)
        totalItems = cnt.c
      } catch (_) {}

      const rows = arrayOf(
        new DynamicModel({
          id: '',
          pedido_id: '',
          tipo_ingresso: '',
          status: '',
          comprador_email: '',
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
        }),
      )

      const sql =
        'SELECT i.id as id, i.pedido_id as pedido_id, i.tipo_ingresso as tipo_ingresso, i.status as status, ' +
        'c.email as comprador_email, ' +
        'p.id as part_id, p.nome_completo as nome_completo, p.email as email, p.cpf as cpf, p.telefone as telefone, ' +
        'p.tem_empresa as tem_empresa, p.nome_empresa as nome_empresa, p.cargo as cargo, p.profissao as profissao, p.nicho as nicho, ' +
        'p.num_funcionarios as num_funcionarios, p.faturamento_anual as faturamento_anual, ' +
        'p.ia_uso_diario as ia_uso_diario, p.ia_profundidade as ia_profundidade, ' +
        'p.ia_ferramentas as ia_ferramentas, p.ia_desafio as ia_desafio ' +
        base +
        ' ORDER BY i.created DESC LIMIT {:limit} OFFSET {:offset}'
      params.limit = perPage
      params.offset = offset
      $app.db().newQuery(sql).bind(params).all(rows)

      const items = []
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i]
        const hasPart = !!r.part_id
        items.push({
          id: r.id,
          pedido_id: r.pedido_id,
          tipo_ingresso: r.tipo_ingresso,
          status: r.status,
          expand: {
            comprador_id: r.comprador_email ? { email: r.comprador_email } : undefined,
            participante_id: hasPart
              ? {
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
        })
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
