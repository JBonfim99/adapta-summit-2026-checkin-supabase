migrate(
  (app) => {
    // 1) Limpa TODOS os dados (reset completo para testes).
    app.db().newQuery('DELETE FROM envios').execute()
    app.db().newQuery('DELETE FROM disparos').execute()
    app.db().newQuery('DELETE FROM webhooks_log').execute()
    app.db().newQuery('DELETE FROM links_participante').execute()
    app.db().newQuery('DELETE FROM tokens_acesso').execute()
    app.db().newQuery('DELETE FROM ingressos').execute()
    app.db().newQuery('DELETE FROM participantes').execute()
    app.db().newQuery('DELETE FROM compradores').execute()

    // 2) Corrige o índice único de e-mail dos participantes.
    //    O índice de 0017 usava `email COLLATE NOCASE` via addIndex e NÃO estava
    //    enforçando (o PocketBase não aplicou como único). Troca por um índice
    //    único SIMPLES (padrão que funciona aqui). A unicidade case-insensitive
    //    passa a ser garantida normalizando o e-mail para minúsculo na gravação
    //    (ver participant_routes.js e admin_routes.js).
    const coll = app.findCollectionByNameOrId('participantes')
    try {
      coll.removeIndex('idx_participantes_email')
    } catch (_) {}
    coll.addIndex('idx_participantes_email', true, 'email', '')
    app.save(coll)
  },
  (app) => {},
)
