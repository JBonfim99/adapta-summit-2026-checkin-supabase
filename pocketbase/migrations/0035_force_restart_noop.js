// Migration no-op — usada só pra forçar um redeploy/reinício real do backend
// (um cron de teste antigo ficou preso em memória e sobreviveu a vários
// apply_changes/publish só-de-hooks; migração pendente costuma forçar bounce).
migrate(
  (app) => {},
  (app) => {},
)
