# Runbook de failover

Objetivo: ativar o fallback em ate 5 minutos, com atraso de replicacao abaixo
de 60 segundos.

## Pre-condicoes

- Vercel e Supabase em producao, mas dominio ainda apontando para o primario.
- `system_state.mode = standby`.
- `sync_control.block_writes = false` no PocketBase.
- `sync_control.delivery_paused = false` no PocketBase.
- INAC em `canary` aprovada e secrets de producao configurados.
- Ultima reconciliacao sem IDs ausentes ou extras.

## Ativacao

1. Interrompa atividades operacionais no admin e helpdesk primarios.
2. Confirme que `sync_outbox` nao possui `pending`, `delivering` ou `error`.
3. Execute `pnpm reconcile:pocketbase` com as credenciais de producao.
4. Consulte `GET /backend/v1/admin/system/health`.
5. Exija `failed_events=0`, `pending_events=0` e `lag_seconds<60`.
6. No PocketBase, defina `sync_control.block_writes=true`.
7. Chame `POST /backend/v1/admin/system/activate` com:

```json
{ "pocketbase_writes_blocked": true }
```

8. Troque o dominio publico para o projeto Vercel.
9. Valide login do comprador, lista de ingressos, formulario, QR, helpdesk,
   dashboard e uma submissao canario.
10. Registre horario, operador, ultimo evento e resultado no incidente.

## Depois da ativacao

- Nao reabra escrita no PocketBase.
- Nao replique dados do Supabase de volta ao PocketBase.
- Dados novos pertencem ao Supabase.
- Mantenha `system_state.mode=active`.
- Monitore erros de INAC, SendGrid e Functions.

## Abortagem

Antes do passo 6, corrija a sincronizacao e repita a reconciliacao. Entre os
passos 6 e 7, reabra o PocketBase somente se o Supabase ainda nao foi ativado.
Depois do passo 7, trate qualquer problema no Supabase; nao volte o dominio ao
PocketBase sem um plano explicito de dados.

## Ensaio

Executar ate 30/07/2026:

- snapshot e importacao;
- outbox e reconciliacao;
- bloqueio de escrita;
- ativacao;
- troca de dominio;
- validacao das telas criticas;
- registro de RTO e RPO observados.
