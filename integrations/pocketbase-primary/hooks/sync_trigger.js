routerAdd(
  'POST',
  '/backend/v1/admin/sync/trigger',
  (e) => {
    const endpoint = $secrets.get('SUPABASE_SYNC_CONTROL_URL') || ''
    const secret = $secrets.get('SUPABASE_SYNC_HMAC_SECRET') || ''
    if (!endpoint || !secret) {
      return e.json(503, { error: 'SUPABASE_SYNC_NOT_CONFIGURED' })
    }
    const body = e.requestInfo().body || {}
    const action = String(body.action || 'status')
    if (['status', 'preview_bootstrap', 'apply_bootstrap', 'pull_now'].indexOf(action) === -1) {
      return e.badRequestError('SYNC_ACTION_INVALID')
    }
    const raw = JSON.stringify({
      action: action,
      requested_by: e.auth ? e.auth.id : '',
    })
    const timestamp = String(Math.floor(Date.now() / 1000))
    let response
    try {
      response = $http.send({
        url: endpoint,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Sync-Timestamp': timestamp,
          'X-Sync-Signature': $security.hs256(timestamp + '.' + raw, secret),
        },
        body: raw,
        timeout: 25,
      })
    } catch (error) {
      $app
        .logger()
        .error(
          'SUPABASE_SYNC_TRIGGER_FAILED',
          'error',
          error && error.message ? error.message : String(error),
        )
      return e.json(502, { error: 'SUPABASE_SYNC_UNAVAILABLE' })
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      return e.json(response.statusCode, response.json || { error: 'SUPABASE_SYNC_FAILED' })
    }
    try {
      const control = $app.findFirstRecordByFilter('sync_control', "id != ''")
      control.set('last_triggered_at', new Date().toISOString())
      $app.save(control)
    } catch (_) {}
    return e.json(200, response.json || { success: true })
  },
  $apis.requireSuperuserAuth(),
  $apis.bodyLimit(8192),
)
