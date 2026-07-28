import { BackendError } from '@/lib/backend/client'

export type FieldErrors = Record<string, string>

export function extractFieldErrors(error: unknown): FieldErrors {
  if (!(error instanceof BackendError)) return {}
  const data = error.response?.details ?? error.response?.data
  if (!data || typeof data !== 'object') return {}
  const errors: FieldErrors = {}
  for (const [field, detail] of Object.entries(data)) {
    if (
      detail &&
      typeof detail === 'object' &&
      'message' in detail &&
      typeof (detail as { message: unknown }).message === 'string'
    ) {
      errors[field] = (detail as { message: string }).message
    }
  }
  return errors
}

export function getErrorMessage(error: unknown): string {
  if (!(error instanceof BackendError)) {
    return error instanceof Error ? error.message : 'Ocorreu um erro inesperado.'
  }
  const messages = Object.values(extractFieldErrors(error))
  return messages.length > 0 ? messages.join(' ') : error.message || 'Ocorreu um erro inesperado.'
}
