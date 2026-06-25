migrate(
  (app) => {
    app.db().newQuery('DELETE FROM links_participante').execute()
    app.db().newQuery('DELETE FROM tokens_acesso').execute()
    app.db().newQuery('DELETE FROM ingressos').execute()
    app.db().newQuery('DELETE FROM participantes').execute()
    app.db().newQuery('DELETE FROM compradores').execute()
  },
  (app) => {},
)
