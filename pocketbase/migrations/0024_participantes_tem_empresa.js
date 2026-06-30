// Perfil "Profissional" (sem empresa): adiciona a flag tem_empresa e torna os
// campos exclusivos de empresa opcionais, para que um participante sem empresa
// possa ser salvo sem nome_empresa/nicho/num_funcionarios/faturamento_anual.
migrate(
  (app) => {
    const p = app.findCollectionByNameOrId('participantes')

    if (!p.fields.getByName('tem_empresa')) {
      p.fields.add(new BoolField({ name: 'tem_empresa' }))
    }

    ;['nome_empresa', 'nicho', 'num_funcionarios', 'faturamento_anual'].forEach((name) => {
      const f = p.fields.getByName(name)
      if (f) f.required = false
    })

    app.save(p)
  },
  (app) => {
    const p = app.findCollectionByNameOrId('participantes')

    ;['nome_empresa', 'nicho', 'num_funcionarios', 'faturamento_anual'].forEach((name) => {
      const f = p.fields.getByName(name)
      if (f) f.required = true
    })

    const tem = p.fields.getByName('tem_empresa')
    if (tem) p.fields.removeByName('tem_empresa')

    app.save(p)
  },
)
