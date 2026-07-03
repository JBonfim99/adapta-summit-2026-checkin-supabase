// Segurança: as coleções de dados (compradores, participantes, ingressos, etc.)
// têm listRule/viewRule = "@request.auth.id != ''" — ou seja, qualquer usuário
// autenticado lê. Se o signup público estivesse aberto no `users`, qualquer um
// poderia se cadastrar e ler todo o PII. Esta migration desativa o cadastro
// público: só um superuser (painel) cria contas de equipe. Idempotente.
migrate(
  (app) => {
    try {
      const users = app.findCollectionByNameOrId('users')
      users.createRule = null
      app.save(users)
    } catch (_) {}
  },
  (_app) => {
    // rollback no-op: não reabrimos o signup automaticamente.
  },
)
