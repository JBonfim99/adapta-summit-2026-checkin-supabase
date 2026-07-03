// Índices para acelerar a busca/listagem de ingressos (tela de Participantes).
// Sem índice em `created`, o ORDER BY created DESC LIMIT varre a tabela inteira.
migrate(
  (app) => {
    const run = (sql) => {
      try {
        app.db().newQuery(sql).execute()
      } catch (_) {}
    }
    run('CREATE INDEX IF NOT EXISTS idx_ingressos_created ON ingressos (created)')
    run('CREATE INDEX IF NOT EXISTS idx_ingressos_comprador ON ingressos (comprador_id)')
    run('CREATE INDEX IF NOT EXISTS idx_ingressos_participante ON ingressos (participante_id)')
    run('CREATE INDEX IF NOT EXISTS idx_ingressos_status ON ingressos (status)')
    run('CREATE INDEX IF NOT EXISTS idx_ingressos_tipo ON ingressos (tipo_ingresso)')
  },
  (app) => {
    const run = (sql) => {
      try {
        app.db().newQuery(sql).execute()
      } catch (_) {}
    }
    run('DROP INDEX IF EXISTS idx_ingressos_created')
    run('DROP INDEX IF EXISTS idx_ingressos_comprador')
    run('DROP INDEX IF EXISTS idx_ingressos_participante')
    run('DROP INDEX IF EXISTS idx_ingressos_status')
    run('DROP INDEX IF EXISTS idx_ingressos_tipo')
  },
)
