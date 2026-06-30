// TEMPORÁRIO — diagnóstico de totais (só contagens, sem PII). REMOVER após uso.
routerAdd('GET', '/backend/v1/diag-totais', (e) => {
  const countOf = (table, where) => {
    try {
      const r = new DynamicModel({ c: 0 })
      $app
        .db()
        .newQuery('SELECT COUNT(*) as c FROM ' + table + (where ? ' WHERE ' + where : ''))
        .one(r)
      return r.c
    } catch (_) {
      return -1
    }
  }

  const compradores_total = countOf('compradores')
  const ingressos_total = countOf('ingressos')
  const credenciados = countOf('ingressos', "inac_id != ''")
  const com_participante = countOf('ingressos', "participante_id != ''")
  const pendentes = ingressos_total - credenciados

  const gold_total = countOf('ingressos', "tipo_ingresso = 'GOLD'")
  const gold_cred = countOf('ingressos', "tipo_ingresso = 'GOLD' AND inac_id != ''")
  const plat_total = countOf('ingressos', "tipo_ingresso = 'PLATINUM'")
  const plat_cred = countOf('ingressos', "tipo_ingresso = 'PLATINUM' AND inac_id != ''")

  const erros_webhook = countOf('ingressos', "status_webhook = 'erro' AND inac_id = ''")
  const pedidos_guru_total = countOf('pedidos_guru')

  // Distribuição de ingressos por comprador (revela import/compra duplicada).
  const dist = {}
  let maxPorComprador = 0
  let compradoresComIngresso = 0
  let compradoresMultiplos = 0
  try {
    const rows = arrayOf(new DynamicModel({ comprador_id: '', cnt: 0 }))
    $app
      .db()
      .newQuery('SELECT comprador_id, COUNT(*) as cnt FROM ingressos GROUP BY comprador_id')
      .all(rows)
    for (let i = 0; i < rows.length; i++) {
      const n = rows[i].cnt
      compradoresComIngresso++
      if (n > 1) compradoresMultiplos++
      if (n > maxPorComprador) maxPorComprador = n
      const b = n >= 5 ? '5+' : String(n)
      dist[b] = (dist[b] || 0) + 1
    }
  } catch (_) {}

  const taxa = (p, t) => (t > 0 ? Math.round((p / t) * 1000) / 10 : 0)

  return e.json(200, {
    compradores_total: compradores_total,
    ingressos_total: ingressos_total,
    credenciados: credenciados,
    pendentes: pendentes,
    com_participante: com_participante,
    taxa_credenciamento_geral_pct: taxa(credenciados, ingressos_total),
    gold: {
      total: gold_total,
      credenciados: gold_cred,
      taxa_pct: taxa(gold_cred, gold_total),
    },
    platinum: {
      total: plat_total,
      credenciados: plat_cred,
      taxa_pct: taxa(plat_cred, plat_total),
    },
    erros_webhook: erros_webhook,
    pedidos_guru_total: pedidos_guru_total,
    ingressos_por_comprador: {
      compradores_com_ingresso: compradoresComIngresso,
      compradores_com_mais_de_1: compradoresMultiplos,
      max_por_comprador: maxPorComprador,
      distribuicao: dist,
    },
  })
})
