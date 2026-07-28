# Teste ponta a ponta local

O preparo local e idempotente e se recusa a usar um hostname diferente de
`localhost`, `127.0.0.1` ou `::1`.

## Preparar

Com o Supabase local ativo:

```bash
pnpm supabase:reset
pnpm e2e:local:setup
```

O segundo comando:

- cria `.env.local` e `supabase/.env.local`;
- mantem INAC e SendGrid em modo mock;
- cria um administrador local;
- cria um comprador, dois ingressos e links de acesso;
- imprime as URLs e credenciais locais.

## Servir

Em terminais separados:

```bash
pnpm supabase:functions
pnpm dev -- --host 127.0.0.1 --port 4173
```

Com os dois processos ativos, valide os acessos:

```bash
pnpm e2e:local:verify
```

## Dados padrao

| Fluxo     | Credencial                                         |
| --------- | -------------------------------------------------- |
| Comprador | `comprador.local@adapta.test`                      |
| Helpdesk  | operador `Teste Local`, senha `HelpdeskLocal#2026` |
| Admin     | `admin.local@adapta.test`, senha `AdminLocal#2026` |

As credenciais acima existem somente no banco local. Nunca reutilize essas
senhas ou execute o script contra um projeto hospedado.
