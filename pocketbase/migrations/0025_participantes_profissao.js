// Perfil "Profissional": adiciona o campo livre `profissao` e torna `cargo`
// opcional (no modo Profissional não há cargo — guardamos profissão no lugar).
// O segmento (nicho) passa a ser coletado nos dois modos.
migrate(
  (app) => {
    const p = app.findCollectionByNameOrId('participantes')

    if (!p.fields.getByName('profissao')) {
      p.fields.add(new TextField({ name: 'profissao' }))
    }

    const cargo = p.fields.getByName('cargo')
    if (cargo) cargo.required = false

    app.save(p)
  },
  (app) => {
    const p = app.findCollectionByNameOrId('participantes')

    const cargo = p.fields.getByName('cargo')
    if (cargo) cargo.required = true

    if (p.fields.getByName('profissao')) p.fields.removeByName('profissao')

    app.save(p)
  },
)
