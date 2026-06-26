migrate(
  (app) => {
    // Reset completo dos dados para testes (limpa tudo de novo).
    app.db().newQuery('DELETE FROM envios').execute()
    app.db().newQuery('DELETE FROM disparos').execute()
    app.db().newQuery('DELETE FROM webhooks_log').execute()
    app.db().newQuery('DELETE FROM links_participante').execute()
    app.db().newQuery('DELETE FROM tokens_acesso').execute()
    app.db().newQuery('DELETE FROM ingressos').execute()
    app.db().newQuery('DELETE FROM participantes').execute()
    app.db().newQuery('DELETE FROM compradores').execute()
  },
  (app) => {},
)
