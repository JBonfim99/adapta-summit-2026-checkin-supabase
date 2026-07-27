// Novos tipos de ingresso: PALESTRANTES (categoria 7863 na INAC) e HACKATHON
// (7864). GOLD e PLATINUM continuam valendo — isto só amplia o select.
migrate(
  (app) => {
    const coll = app.findCollectionByNameOrId('ingressos')
    const campo = coll.fields.getByName('tipo_ingresso')
    if (campo) {
      const valores = campo.values || []
      if (valores.indexOf('PALESTRANTES') === -1) valores.push('PALESTRANTES')
      if (valores.indexOf('HACKATHON') === -1) valores.push('HACKATHON')
      campo.values = valores
      app.save(coll)
    }
  },
  (app) => {
    const coll = app.findCollectionByNameOrId('ingressos')
    const campo = coll.fields.getByName('tipo_ingresso')
    if (campo) {
      campo.values = (campo.values || []).filter((v) => v !== 'PALESTRANTES' && v !== 'HACKATHON')
      app.save(coll)
    }
  },
)
