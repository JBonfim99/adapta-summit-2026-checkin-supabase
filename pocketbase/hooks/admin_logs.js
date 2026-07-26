// Logs paginados para /admin/logs. Faz em SQL a mesma agregação que a tela fazia
// no cliente (1 linha por ingresso, evento MAIS RECENTE) + eventos manuais cujo
// ingresso já não existe (exclusões) como linhas próprias. Filtra e pagina no
// banco pra não puxar todos os logs de uma vez.
routerAdd(
  'GET',
  '/backend/v1/admin/logs',
  (e) => {
    try {
      const info = e.requestInfo()
      const query = info.query || {}
      const readQ = (k) => {
        const v = query[k]
        if (v == null) return ''
        return (Array.isArray(v) ? v[0] : v).toString()
      }

      let filter = readQ('filter')
      if (['erros', 'todos', 'ok', 'manuais', 'helpdesk'].indexOf(filter) === -1) filter = 'erros'
      let page = parseInt(readQ('page'), 10)
      if (isNaN(page) || page < 1) page = 1
      let perPage = parseInt(readQ('perPage'), 10)
      if (isNaN(perPage) || perPage < 1) perPage = 20
      if (perPage > 200) perPage = 200
      const offset = (page - 1) * perPage

      const MANUAL_LIST =
        "'excluido_manual','comprador_excluido','editado_manual','tipo_alterado'," +
        "'api_criacao_comprador','api_credenciamento','api_reenvio_comprador','api_reenvio_participante'," +
        "'helpdesk_credenciamento','helpdesk_edicao','helpdesk_tipo_alterado','helpdesk_qr'," +
        "'helpdesk_qr_gerado','helpdesk_erro'"

      // CTE com as linhas "representativas": último log por ingresso vivo +
      // eventos manuais órfãos (ingresso não existe mais).
      const REPS =
        'WITH reps AS (' +
        'SELECT wl.id as id, wl.ingresso_id as ingresso_id, wl.evento as evento, wl.detalhe as detalhe, wl.status as status, wl.method as method, wl.response as response, wl.payload as payload, wl.created as created, ' +
        "i.pedido_id as pedido_id, COALESCE(i.inac_id,'') as inac_id, COALESCE(i.status_webhook,'') as status_webhook, 1 as live " +
        'FROM webhooks_log wl ' +
        "JOIN (SELECT ingresso_id, MAX(created) as mc FROM webhooks_log WHERE ingresso_id != '' GROUP BY ingresso_id) latest " +
        'ON latest.ingresso_id = wl.ingresso_id AND wl.created = latest.mc ' +
        'JOIN ingressos i ON i.id = wl.ingresso_id ' +
        'UNION ALL ' +
        'SELECT wl.id as id, wl.ingresso_id as ingresso_id, wl.evento as evento, wl.detalhe as detalhe, wl.status as status, wl.method as method, wl.response as response, wl.payload as payload, wl.created as created, ' +
        "'' as pedido_id, '' as inac_id, '' as status_webhook, 0 as live " +
        'FROM webhooks_log wl LEFT JOIN ingressos i2 ON i2.id = wl.ingresso_id ' +
        'WHERE wl.evento IN (' +
        MANUAL_LIST +
        ') AND i2.id IS NULL' +
        ')'

      const ERR =
        "(live = 1 AND inac_id = '' AND (status_webhook = 'erro' OR (status_webhook = '' AND (status < 200 OR status >= 300))))"
      const MANUAL_COND = 'evento IN (' + MANUAL_LIST + ')'

      let cond = '1=1'
      if (filter === 'erros') cond = ERR
      else if (filter === 'ok') cond = 'NOT ' + ERR
      else if (filter === 'manuais') cond = MANUAL_COND

      let errorCount = 0
      try {
        const c = new DynamicModel({ c: 0 })
        $app
          .db()
          .newQuery(REPS + ' SELECT COUNT(*) as c FROM reps WHERE ' + ERR)
          .one(c)
        errorCount = c.c
      } catch (_) {}

      // Filtro "Help desk": trilha de auditoria COMPLETA da área /helpdesk —
      // todas as ações, não só o evento mais recente de cada ingresso.
      if (filter === 'helpdesk') {
        const HDFROM =
          'FROM webhooks_log wl LEFT JOIN ingressos i ON i.id = wl.ingresso_id ' +
          "WHERE wl.evento LIKE 'helpdesk_%'"
        let hdTotal = 0
        try {
          const c2 = new DynamicModel({ c: 0 })
          $app
            .db()
            .newQuery('SELECT COUNT(*) as c ' + HDFROM)
            .one(c2)
          hdTotal = c2.c
        } catch (_) {}

        const hdRows = arrayOf(
          new DynamicModel({
            id: '',
            ingresso_id: '',
            evento: '',
            detalhe: '',
            status: 0,
            method: '',
            response: '',
            payload: '',
            created: '',
            pedido_id: '',
            inac_id: '',
            status_webhook: '',
          }),
        )
        $app
          .db()
          .newQuery(
            'SELECT wl.id as id, wl.ingresso_id as ingresso_id, wl.evento as evento, ' +
              'wl.detalhe as detalhe, wl.status as status, wl.method as method, ' +
              'wl.response as response, wl.payload as payload, wl.created as created, ' +
              "COALESCE(i.pedido_id,'') as pedido_id, COALESCE(i.inac_id,'') as inac_id, " +
              "COALESCE(i.status_webhook,'') as status_webhook " +
              HDFROM +
              ' ORDER BY wl.created DESC LIMIT {:limit} OFFSET {:offset}',
          )
          .bind({ limit: perPage, offset: offset })
          .all(hdRows)

        const hdItems = []
        for (let i = 0; i < hdRows.length; i++) {
          const r = hdRows[i]
          hdItems.push({
            id: r.id,
            ingresso_id: r.ingresso_id,
            evento: r.evento,
            detalhe: r.detalhe,
            status: r.status,
            method: r.method,
            response: r.response,
            payload: r.payload,
            created: r.created,
            expand: {
              ingresso_id: r.pedido_id
                ? {
                    pedido_id: r.pedido_id,
                    inac_id: r.inac_id,
                    status_webhook: r.status_webhook,
                  }
                : undefined,
            },
          })
        }

        return e.json(200, {
          items: hdItems,
          page: page,
          perPage: perPage,
          totalItems: hdTotal,
          totalPages: Math.max(1, Math.ceil(hdTotal / perPage)),
          errorCount: errorCount,
        })
      }

      let totalItems = 0
      try {
        const c = new DynamicModel({ c: 0 })
        $app
          .db()
          .newQuery(REPS + ' SELECT COUNT(*) as c FROM reps WHERE ' + cond)
          .one(c)
        totalItems = c.c
      } catch (_) {}

      const rows = arrayOf(
        new DynamicModel({
          id: '',
          ingresso_id: '',
          evento: '',
          detalhe: '',
          status: 0,
          method: '',
          response: '',
          payload: '',
          created: '',
          pedido_id: '',
          inac_id: '',
          status_webhook: '',
          live: 0,
        }),
      )
      $app
        .db()
        .newQuery(
          REPS +
            ' SELECT * FROM reps WHERE ' +
            cond +
            ' ORDER BY created DESC LIMIT {:limit} OFFSET {:offset}',
        )
        .bind({ limit: perPage, offset: offset })
        .all(rows)

      const items = []
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i]
        items.push({
          id: r.id,
          ingresso_id: r.ingresso_id,
          evento: r.evento,
          detalhe: r.detalhe,
          status: r.status,
          method: r.method,
          response: r.response,
          payload: r.payload,
          created: r.created,
          expand: {
            ingresso_id:
              r.live === 1
                ? {
                    pedido_id: r.pedido_id,
                    inac_id: r.inac_id,
                    status_webhook: r.status_webhook,
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
        errorCount: errorCount,
      })
    } catch (err) {
      return e.badRequestError(err.message)
    }
  },
  $apis.requireAuth(),
)
