begin;

set search_path = public, extensions;
select no_plan();

select is(
  public.apply_sync_event(
    '{
      "event_id": "sync-buyer-create",
      "table": "compradores",
      "record_id": "buyer_sync",
      "operation": "create",
      "source_updated_at": "2026-07-28T12:00:00Z",
      "payload": {
        "nome": "Buyer Sync",
        "email": "buyer.sync@example.com",
        "created_at": "2026-07-28T11:00:00Z"
      }
    }'::jsonb
  )->>'state',
  'applied',
  'first sync event is applied'
);

select is(
  public.apply_sync_event(
    '{
      "event_id": "sync-buyer-create",
      "table": "compradores",
      "record_id": "buyer_sync",
      "operation": "create",
      "source_updated_at": "2026-07-28T12:00:00Z",
      "payload": {
        "nome": "Buyer Sync",
        "email": "buyer.sync@example.com"
      }
    }'::jsonb
  )->>'state',
  'duplicate',
  'duplicate event is idempotent'
);

select is(
  public.apply_sync_event(
    '{
      "event_id": "sync-buyer-old",
      "table": "compradores",
      "record_id": "buyer_sync",
      "operation": "update",
      "source_updated_at": "2026-07-28T10:00:00Z",
      "payload": {
        "nome": "Stale Name",
        "email": "buyer.sync@example.com"
      }
    }'::jsonb
  )->>'state',
  'ignored',
  'out-of-order older update is ignored'
);

select is(
  (select nome from public.compradores where id = 'buyer_sync'),
  'Buyer Sync',
  'ignored update does not change the record'
);

select is(
  public.apply_sync_event(
    '{
      "event_id": "sync-buyer-delete",
      "table": "compradores",
      "record_id": "buyer_sync",
      "operation": "delete",
      "source_updated_at": "2026-07-28T13:00:00Z",
      "payload": {}
    }'::jsonb
  )->>'state',
  'applied',
  'delete event is applied'
);

select ok(
  exists (
    select 1
      from public.sync_tombstones
     where source_table = 'compradores'
       and record_id = 'buyer_sync'
  ),
  'delete creates a tombstone'
);

select is(
  public.apply_sync_event(
    '{
      "event_id": "sync-buyer-after-delete-old",
      "table": "compradores",
      "record_id": "buyer_sync",
      "operation": "update",
      "source_updated_at": "2026-07-28T12:30:00Z",
      "payload": {
        "nome": "Should Not Return",
        "email": "buyer.sync@example.com"
      }
    }'::jsonb
  )->>'state',
  'ignored',
  'older update cannot resurrect a tombstoned record'
);

update public.system_state set mode = 'active' where singleton;

select throws_ok(
  $$
    select public.apply_sync_event(
      '{
        "event_id": "sync-disabled",
        "table": "compradores",
        "record_id": "buyer_disabled",
        "operation": "create",
        "source_updated_at": "2026-07-28T14:00:00Z",
        "payload": {
          "nome": "Disabled",
          "email": "disabled@example.com"
        }
      }'::jsonb
    )
  $$,
  'P0001',
  'SYNC_DISABLED',
  'sync is rejected after failover activation'
);

select * from finish();
rollback;
