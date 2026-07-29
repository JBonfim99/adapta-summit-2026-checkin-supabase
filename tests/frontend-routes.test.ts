import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const appSource = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')

const routes = [
  ['/', 'path="/"'],
  ['/acesso', 'path="/acesso"'],
  ['/meus-ingressos', 'path="/meus-ingressos"'],
  ['/participante/obrigado', 'path="/participante/obrigado"'],
  ['/participante/expirado', 'path="/participante/expirado"'],
  ['/ingresso', 'path="/ingresso"'],
  ['/politica-de-privacidade', 'path="/politica-de-privacidade"'],
  ['/cortesia', 'path="/cortesia"'],
  ['/participante', 'path="/participante"'],
  ['/pre-credenciamento/:token', 'path="/pre-credenciamento/:token"'],
  ['/credenciamento', 'path="/credenciamento"'],
  ['/helpdesk', 'path="/helpdesk"'],
  ['/admin/login', 'path="/admin/login"'],
  ['/admin', 'path="/admin"'],
  ['/admin/importar', 'path="importar"'],
  ['/admin/compradores', 'path="compradores"'],
  ['/admin/participantes', 'path="participantes"'],
  ['/admin/cortesias', 'path="cortesias"'],
  ['/admin/reconciliar', 'path="reconciliar"'],
  ['/admin/api', 'path="api"'],
  ['/admin/insights', 'path="insights"'],
  ['/admin/disparo', 'path="disparo"'],
  ['/admin/disparo-whatsapp', 'path="disparo-whatsapp"'],
  ['/admin/logs', 'path="logs"'],
  ['/admin/envios', 'path="envios"'],
  ['*', 'path="*"'],
] as const

describe('frontend route parity', () => {
  it('keeps the 26 routes in the application router', () => {
    expect(routes).toHaveLength(26)
    for (const [, literal] of routes) expect(appSource).toContain(literal)
  })

  it('keeps the event location and official quick resend queue', () => {
    const layout = readFileSync(new URL('../src/components/Layout.tsx', import.meta.url), 'utf8')
    const resend = readFileSync(
      new URL('../src/components/admin/ReenviarRapido.tsx', import.meta.url),
      'utf8',
    )
    expect(layout).toContain('<EventoDataLocal')
    expect(resend).toContain('/backend/v1/admin/dispatch/enqueue')
    expect(resend).not.toContain('/backend/v1/admin/resend')
  })
})
