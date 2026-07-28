# Arquitetura e seguranca

## Fronteiras de acesso

| Superficie | Autenticacao | Funcao |
| --- | --- | --- |
| Publica | Sem sessao | `public-api` |
| Comprador | Token preservado do PocketBase | `buyer-api` |
| Helpdesk | `X-Helpdesk-Key` + operador | `helpdesk-api` |
| Admin | JWT do Supabase Auth + `admin_profiles` | `admin-api` |
| Replicacao | HMAC SHA-256 + janela de 5 minutos | `sync-ingest` |

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
- A ingestao e desativada quando `system_state.mode` deixa de ser `standby`.

## Integracoes

`INAC_MODE=mock` e o padrao local. Em `canary`, apenas
`INAC_CANARY_EMAIL` usa a API real. Em producao, `live` envia todos os eventos.
Cada tentativa registra payload, status, resposta, duracao e chave de
idempotencia em `integration_attempts`.

SendGrid opera com templates configurados por secret. Magic links e reenvios
essenciais continuam disponiveis; campanhas em massa ficam fora deste
repositorio.

## Segredos

Nunca configurar no frontend:

- `SUPABASE_SERVICE_ROLE_KEY`
- `INAC_API_KEY`
- `SENDGRID_API_KEY`
- `HELPDESK_KEY`
- `SYNC_HMAC_SECRET`

A chave da API externa e a senha administrativa padrao encontradas no sistema
anterior devem ser rotacionadas. Nenhum desses valores foi copiado.
