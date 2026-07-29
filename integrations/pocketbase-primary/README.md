# PocketBase primary integration

This directory is an installation bundle for the primary PocketBase repository.
It is intentionally separate from the Supabase fallback runtime.

1. Copy `migrations/0040_supabase_sync_outbox.js` to `pb_migrations`.
2. Apply the migration and verify that `sync_outbox` and `sync_control` exist.
3. Copy `hooks/supabase_sync.js` to `pb_hooks`.
4. Configure `SUPABASE_SYNC_URL` with the full `sync-ingest` Function URL.
5. Configure the same 32+ byte secret in
   `SUPABASE_SYNC_HMAC_SECRET` and Supabase `SYNC_HMAC_SECRET`.
6. Keep `sync_control.block_writes=false` and
   `sync_control.delivery_paused=false` while PocketBase is primary.

The hook replicates buyers, tickets, participants, tokens, links, logs,
email/WhatsApp dispatches, deliveries, Guru orders and courtesies.
`cron_health` is intentionally local to each backend and is never replicated.

During failover, drain the outbox, verify lag below 60 seconds, set
`sync_control.block_writes=true`, activate Supabase, and only then change the
public domain.
