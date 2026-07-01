// TEMPORÁRIO — lista participantes com documento (CPF) repetido, normalizando
// (ignora pontuação). Público só pra leitura do resultado. REMOVER depois.
// Uso: /backend/v1/dup-docs
routerAdd('GET', '/backend/v1/dup-docs', (e) => {
  try {
    const recs = $app.findRecordsByFilter('participantes', "id != ''", '', 20000, 0)
    const map = {}
    for (let i = 0; i < recs.length; i++) {
      const r = recs[i]
      const raw = (r.getString('cpf') || '').replace(/\D/g, '')
      if (!raw) continue
      if (!map[raw]) map[raw] = []
      map[raw].push({
        id: r.id,
        nome: r.getString('nome_completo'),
        email: r.getString('email'),
        cpf: r.getString('cpf'),
        ingresso_id: r.getString('ingresso_id'),
      })
    }
    const dups = []
    const keys = Object.keys(map)
    for (let i = 0; i < keys.length; i++) {
      if (map[keys[i]].length > 1) {
        dups.push({ documento: keys[i], count: map[keys[i]].length, participantes: map[keys[i]] })
      }
    }
    dups.sort((a, b) => b.count - a.count)
    return e.json(200, {
      total_participantes: recs.length,
      grupos_duplicados: dups.length,
      dups: dups,
    })
  } catch (err) {
    return e.json(200, { error: err && err.message ? err.message : 'erro' })
  }
})
