migrate(
  (app) => {
    const p = app.findCollectionByNameOrId('participantes')
    if (!p.fields.getByName('ia_uso_diario')) {
      p.fields.add(new NumberField({ name: 'ia_uso_diario' }))
    }
    if (!p.fields.getByName('ia_profundidade')) {
      p.fields.add(new NumberField({ name: 'ia_profundidade' }))
    }
    if (!p.fields.getByName('ia_ferramentas')) {
      p.fields.add(new TextField({ name: 'ia_ferramentas' }))
    }
    if (!p.fields.getByName('ia_desafio')) {
      p.fields.add(new TextField({ name: 'ia_desafio' }))
    }
    app.save(p)
  },
  (app) => {
    const p = app.findCollectionByNameOrId('participantes')
    ;['ia_uso_diario', 'ia_profundidade', 'ia_ferramentas', 'ia_desafio'].forEach((n) =>
      p.fields.removeByName(n),
    )
    app.save(p)
  },
)
