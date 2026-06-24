migrate(
  (app) => {
    const users = app.findCollectionByNameOrId('_pb_users_auth_')
    try {
      app.findAuthRecordByEmail('_pb_users_auth_', 'juan@adapta.org')
    } catch (_) {
      const record = new Record(users)
      record.setEmail('juan@adapta.org')
      record.setPassword('Skip@Pass')
      record.setVerified(true)
      record.set('name', 'Admin')
      app.save(record)
    }

    const compradores = app.findCollectionByNameOrId('compradores')
    let comp
    try {
      comp = app.findFirstRecordByData('compradores', 'email', 'buyer@test.com')
    } catch (_) {
      comp = new Record(compradores)
      comp.set('nome', 'Buyer Test')
      comp.set('email', 'buyer@test.com')
      app.save(comp)
    }

    const ingressos = app.findCollectionByNameOrId('ingressos')
    try {
      app.findFirstRecordByData('ingressos', 'pedido_id', 'PED-123')
    } catch (_) {
      const ing = new Record(ingressos)
      ing.set('comprador_id', comp.id)
      ing.set('pedido_id', 'PED-123')
      ing.set('tipo_ingresso', 'VIP')
      ing.set('status', 'pendente')
      app.save(ing)

      const ing2 = new Record(ingressos)
      ing2.set('comprador_id', comp.id)
      ing2.set('pedido_id', 'PED-124')
      ing2.set('tipo_ingresso', 'Standard')
      ing2.set('status', 'pendente')
      app.save(ing2)
    }
  },
  (app) => {},
)
