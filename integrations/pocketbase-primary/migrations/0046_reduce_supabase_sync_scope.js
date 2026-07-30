migrate(
  (app) => {
    const excludedPendingFilter =
      "state = 'pending' && source_table != 'compradores' && source_table != 'ingressos' && source_table != 'participantes'"
    const deliveredAt = new Date().toISOString()

    for (;;) {
      const records = app.findRecordsByFilter(
        'sync_outbox',
        excludedPendingFilter,
        'created,id',
        100,
        0,
      )
      if (records.length === 0) break

      for (let index = 0; index < records.length; index++) {
        records[index].set('state', 'delivered')
        records[index].set('delivered_at', deliveredAt)
        app.save(records[index])
      }
    }
  },
  () => {
    // Technical events intentionally retired by this migration cannot be replayed safely.
  },
)
