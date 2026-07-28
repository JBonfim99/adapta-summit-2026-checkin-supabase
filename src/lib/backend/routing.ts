export function functionNameForPath(path: string) {
  if (path.startsWith('/backend/v1/buyer/')) return 'buyer-api'
  if (path.startsWith('/backend/v1/helpdesk/')) return 'helpdesk-api'
  if (path.startsWith('/backend/v1/admin/')) return 'admin-api'
  return 'public-api'
}
