// Índices para a agregação/paginação dos Logs (último evento por ingresso).
migrate(
  (app) => {
    const run = (sql) => {
      try {
        app.db().newQuery(sql).execute()
      } catch (_) {}
    }
    run(
      'CREATE INDEX IF NOT EXISTS idx_wlog_ingresso_created ON webhooks_log (ingresso_id, created)',
    )
    run('CREATE INDEX IF NOT EXISTS idx_wlog_created ON webhooks_log (created)')
    run('CREATE INDEX IF NOT EXISTS idx_wlog_evento ON webhooks_log (evento)')
  },
  (app) => {
    const run = (sql) => {
      try {
        app.db().newQuery(sql).execute()
      } catch (_) {}
    }
    run('DROP INDEX IF EXISTS idx_wlog_ingresso_created')
    run('DROP INDEX IF EXISTS idx_wlog_created')
    run('DROP INDEX IF EXISTS idx_wlog_evento')
  },
)
