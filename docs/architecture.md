# Arquitetura e seguranca

## Fronteiras de acesso

| Superficie  | Autenticacao                            | Funcao            |
| ----------- | --------------------------------------- | ----------------- |
| Publica     | Sem sessao                              | `public-api`      |
| Comprador   | Token preservado do PocketBase          | `buyer-api`       |
| Helpdesk    | `X-Helpdesk-Key` + operador             | `helpdesk-api`    |
| Admin       | JWT do Supabase Auth + `admin_profiles` | `admin-api`       |
| Replicacao  | HMAC SHA-256 + janela de 5 minutos      | `sync-pull`       |
| Worker      | `X-Worker-Key`, chamado pelo `pg_cron`  | `dispatch-worker` |
| API externa | `X-Api-Key` rotacionada                 | `public-api`      |

Todas as tabelas possuem RLS. `anon` e `authenticated` nao recebem grants de
tabela nem de RPC transacional. Apenas as Edge Functions usam `service_role`.

## Consistencia

- IDs, tokens e relacionamentos do PocketBase sao mantidos como `text`.
- `submit_participant` bloqueia a linha do ingresso e atualiza participante,
  ingresso e link na mesma transacao.
- Edicao, troca de tipo e exclusao criam um claim curto. A INAC e chamada fora
  da transacao; a confirmacao local usa `updated_at` como controle otimista.
- Eventos da outbox sao idempotentes por `event_id`.
- Eventos antigos sao ignorados por `source_updated_at`.
- Exclusoes criam tombstones e nao podem ser revertidas por eventos antigos.
- O Supabase puxa até 100 eventos por página, confirma no Skip somente após o
  commit e interrompe a replicação quando `system_state.mode` deixa de ser
  `standby`.
- O bootstrap captura o cursor, grava staging, substitui somente as 11 tabelas
  replicadas e depois reproduz o outbox.

## Integracoes

`INAC_MODE=mock` e o padrao local. Em `canary`, apenas
`INAC_CANARY_EMAIL` usa a API real. Em producao, `live` envia todos os eventos.
Cada tentativa registra payload, status, resposta, duracao e chave de
idempotencia em `integration_attempts`.

SendGrid e BotConversa operam com filas persistentes, claim atomico, no maximo
cinco tentativas e auditoria por tentativa. O `pg_cron` chama
`dispatch-worker` a cada minuto por `pg_net`. Guru e API externa passam pelas
mesmas transacoes e pelo bloqueio de standby.

Efeitos externos exigem simultaneamente `mode=active` e
`external_effects_enabled=true`. Essa verificação existe antes do claim SQL,
antes de criar tokens e imediatamente antes de cada provedor.
`ALLOW_STANDBY_WRITES=true` nunca ignora a trava de efeitos externos.

## Segredos

Nunca configurar no frontend:

- `SUPABASE_SERVICE_ROLE_KEY`
- `INAC_API_KEY`
- `SENDGRID_API_KEY`
- `BOTCONVERSA_API_KEY`
- `BOTCONVERSA_CATCH_URL`
- `EXTERNAL_API_KEY`
- `DISPATCH_WORKER_SECRET`
- `HELPDESK_KEY`
- `SYNC_HMAC_SECRET`
- `SKIP_SYNC_HMAC_SECRET`
- `SKIP_SYNC_BASE_URL`

A chave da API externa e a senha administrativa padrao encontradas no sistema
anterior devem ser rotacionadas. Nenhum desses valores foi copiado.
