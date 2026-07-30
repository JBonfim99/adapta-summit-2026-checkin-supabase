# Integração do Skip primário

Este diretório contém a cópia versionada dos arquivos instalados no projeto
Skip “Adapta Summit 2026”.

1. Aplique `migrations/0040_supabase_sync_outbox.js`.
2. Instale cada arquivo de `hooks/` separadamente. Os hooks seguem a regra do
   Skip Cloud de uma rota ou lifecycle hook por arquivo.
3. Configure no Skip Cloud:
   - `SUPABASE_SYNC_CONTROL_URL`: URL completa da Edge Function `sync-pull`.
   - `SUPABASE_SYNC_HMAC_SECRET`: segredo HMAC de no mínimo 32 bytes, igual ao
     `SKIP_SYNC_HMAC_SECRET` do Supabase.
4. No Supabase, configure:
   - `SKIP_SYNC_BASE_URL`: backend público do Skip, sem barra final.
   - `SKIP_SYNC_HMAC_SECRET`: mesmo segredo HMAC.
   - `SYNC_PULL_WORKER_SECRET`: segredo usado pelo Supabase Cron.

O Skip só grava eventos pequenos de `compradores`, `ingressos` e `participantes`
no `sync_outbox` e serve essas três coleções em páginas de até 100 registros.
O bootstrap e a aplicação dos eventos são executados pelo Supabase.
O endpoint `/backend/v1/sync/control` é a única forma remota de bloquear ou
liberar as escritas operacionais do Skip durante o failover.
