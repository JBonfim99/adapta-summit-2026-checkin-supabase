migrate(
  (app) => {
    app
      .db()
      .newQuery("UPDATE ingressos SET tipo_ingresso = 'GOLD' WHERE tipo_ingresso = 'Standard'")
      .execute()
    app
      .db()
      .newQuery("UPDATE ingressos SET tipo_ingresso = 'PLATINUM' WHERE tipo_ingresso = 'VIP'")
      .execute()
  },
  (app) => {
    app
      .db()
      .newQuery("UPDATE ingressos SET tipo_ingresso = 'Standard' WHERE tipo_ingresso = 'GOLD'")
      .execute()
    app
      .db()
      .newQuery("UPDATE ingressos SET tipo_ingresso = 'VIP' WHERE tipo_ingresso = 'PLATINUM'")
      .execute()
  },
)
