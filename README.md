# Adapta Summit 2026 Check-in Fallback

Hot standby do check-in do Adapta Summit 2026. O frontend preserva as rotas e
a experiencia do sistema original, mas todo o runtime deste repositorio usa
Supabase.

## Escopo 1:1

- Login do comprador por magic link e token proprio.
- Listagem, convite e visualizacao de ingressos.
- Formulario do participante, QR code e integracao INAC.
- Helpdesk com chave compartilhada e operador auditado.
- Supabase Auth para administradores.
- Dashboard, compradores, participantes, logs e operacoes essenciais.
- Importacao CSV, reconciliacao e criacao controlada de faltantes.
- Cortesias publicas com cota e credenciamento imediato.
- Campanhas e filas com retry para SendGrid e BotConversa.
- API externa por `X-Api-Key` e webhook idempotente da Guru.
- Importacao inicial, outbox HMAC, reconciliacao e ativacao de failover.

## Arquitetura

```mermaid
flowchart LR
  Browser["React na Vercel"] --> Functions["Supabase Edge Functions"]
  Functions --> Database["Postgres + RLS"]
  Functions --> Inac["INAC"]
  Functions --> SendGrid["SendGrid"]
  Functions --> BotConversa["BotConversa"]
  Cron["pg_cron"] --> Worker["dispatch-worker"]
  Cron --> Pull["sync-pull"]
  Worker --> SendGrid
  Worker --> BotConversa
  PocketBase["PocketBase primario"] --> Outbox["sync_outbox"]
  Pull -->|"HMAC, até 100 por página"| Outbox
  Pull --> Database
```

O navegador nao recebe `service_role` e nao acessa tabelas diretamente. Todas
as operacoes passam por `public-api`, `buyer-api`, `helpdesk-api` ou
`admin-api`.

## Desenvolvimento local

Requisitos: Node.js 24, pnpm 10 e Docker Desktop.

```bash
pnpm install --frozen-lockfile
pnpm supabase:start
pnpm supabase:types
pnpm dev
```

Crie `.env.local` a partir de `.env.example` e use os valores de
`supabase status -o env`. Para Functions, crie `supabase/.env.local` a partir
de `supabase/.env.example`.

## Validacao

```bash
pnpm build
pnpm lint
pnpm test
pnpm supabase:test
node --env-file=.env.load-full.local scripts/load-test.mjs
```

Para preparar comprador, ingressos, helpdesk e administrador locais com INAC
e SendGrid em modo mock, consulte o
[roteiro E2E local](docs/local-e2e.md).

Os schemas declarativos em `supabase/schemas` sao a fonte de verdade. Depois de
alterar um schema, gere a migration com `supabase db diff -f <nome>` e valide
com `supabase db reset`.

## Deploy

Use o identificador do projeto fornecido por um administrador. Nao registre
IDs, URLs ou credenciais dos ambientes remotos neste repositorio.

```bash
supabase login
supabase link --project-ref <supabase-project-ref>
supabase db push
supabase functions deploy public-api
supabase functions deploy buyer-api
supabase functions deploy helpdesk-api
supabase functions deploy admin-api
supabase functions deploy sync-ingest
supabase functions deploy dispatch-worker
supabase functions deploy sync-pull
```

Configure os secrets listados em `supabase/.env.example` com
`supabase secrets set`. Na Vercel, configure apenas
`VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` e `VITE_APP_URL`.

O agendamento do worker le tres valores do Vault. Cadastre-os depois do deploy:

```sql
select vault.create_secret('<supabase-project-url>', 'project_url');
select vault.create_secret('<publishable-key>', 'publishable_key');
select vault.create_secret('<mesmo DISPATCH_WORKER_SECRET>', 'dispatch_worker_secret');
```

Crie o usuario administrativo no Supabase Auth e associe-o sem senha padrao:

```sql
insert into public.admin_profiles (user_id, display_name, role)
values ('<auth-user-id>', '<nome>', 'admin');
```

## Operacao

- [Arquitetura e seguranca](docs/architecture.md)
- [Runbook de failover](docs/failover-runbook.md)
- [Relatorio de testes](docs/test-report-2026-07-28.md)
- [Pacote do PocketBase primario](integrations/pocketbase-primary/README.md)
