migrate(
  (app) => {
    // Garante e-mail único ENTRE participantes (case-insensitive). Pode coincidir
    // com o e-mail de um comprador — a regra é só dentro de `participantes`.
    // Antes de impor o índice, detecta duplicados existentes e falha com uma
    // mensagem clara (não mexe nos dados reais de e-mail à força).
    const parts = app.findRecordsByFilter('participantes', "id != ''", '', 100000, 0)
    const seen = {}
    const dups = []
    for (const p of parts) {
      const em = (p.getString('email') || '').trim().toLowerCase()
      if (!em) continue
      if (seen[em]) {
        if (dups.indexOf(em) === -1) dups.push(em)
      } else {
        seen[em] = true
      }
    }
    if (dups.length > 0) {
      throw new Error(
        'Existem participantes com e-mail duplicado; resolva antes de impor unicidade: ' +
          dups.join(', '),
      )
    }

    const coll = app.findCollectionByNameOrId('participantes')
    coll.addIndex('idx_participantes_email', true, 'email COLLATE NOCASE', '')
    app.save(coll)
  },
  (app) => {
    const coll = app.findCollectionByNameOrId('participantes')
    coll.removeIndex('idx_participantes_email')
    app.save(coll)
  },
)
