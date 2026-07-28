import { Component, type ErrorInfo, type ReactNode } from 'react'

// Sem isto, qualquer exceção durante a renderização desmonta a árvore inteira
// e o visitante vê uma página em branco, sem mensagem e sem rastro no servidor.
//
// A tela de erro é deliberadamente burra: HTML e estilo inline, sem contexto,
// sem hook, sem componente de UI. Se o fallback dependesse do que quebrou, a
// gente voltaria para o branco.

const ehErroDeTraducao = (msg: string) =>
  /removeChild|insertBefore|NotFoundError|The node before which the new node/i.test(msg)

interface Props {
  children: ReactNode
}

interface State {
  erro: Error | null
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { erro: null }

  static getDerivedStateFromError(erro: Error): State {
    return { erro }
  }

  componentDidCatch(erro: Error, info: ErrorInfo) {
    try {
      const html = document.documentElement
      const traduzido =
        html.classList.contains('translated-ltr') ||
        html.classList.contains('translated-rtl') ||
        document.querySelector('font[_msttexthash], font[style*="vertical-align"]') !== null

      const base = (import.meta.env.VITE_SUPABASE_URL || '').replace(/\/$/, '')
      fetch(`${base}/functions/v1/public-api/backend/v1/client-error`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || '',
        },
        body: JSON.stringify({
          message: erro?.message || String(erro),
          stack: `${erro?.stack || ''}\n--- componentes ---${info?.componentStack || ''}`,
          url: window.location.href,
          traduzido,
          idioma: navigator.language,
          user_agent: navigator.userAgent,
        }),
        keepalive: true,
      }).catch(() => {
        /* registrar é best-effort: nunca pode gerar um segundo erro */
      })
    } catch {
      /* idem */
    }
  }

  render() {
    const { erro } = this.state
    if (!erro) return this.props.children

    const traducao = ehErroDeTraducao(erro.message || '')

    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          background: '#f1f5f9',
        }}
      >
        <div
          style={{
            maxWidth: '440px',
            width: '100%',
            background: '#ffffff',
            borderRadius: '16px',
            padding: '32px',
            textAlign: 'center',
            boxShadow: '0 10px 30px rgba(15, 23, 42, 0.08)',
          }}
        >
          <h1 style={{ fontSize: '22px', margin: '0 0 12px', color: '#0f172a' }}>
            Algo deu errado nesta página
          </h1>

          <p style={{ fontSize: '16px', lineHeight: 1.5, color: '#475569', margin: '0 0 20px' }}>
            Seus dados não foram perdidos. Recarregue a página e continue de onde parou.
          </p>

          {traducao && (
            <p
              style={{
                fontSize: '15px',
                lineHeight: 1.5,
                color: '#92400e',
                background: '#fef3c7',
                border: '1px solid #fcd34d',
                borderRadius: '10px',
                padding: '12px',
                margin: '0 0 20px',
                textAlign: 'left',
              }}
            >
              Parece que o tradutor automático do navegador está ligado nesta página. Ele costuma
              causar esse erro. Desative a tradução e recarregue.
            </p>
          )}

          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              width: '100%',
              height: '52px',
              fontSize: '16px',
              fontWeight: 600,
              color: '#ffffff',
              background: '#0f172a',
              border: 'none',
              borderRadius: '10px',
              cursor: 'pointer',
            }}
          >
            Recarregar a página
          </button>

          <p style={{ fontSize: '12px', color: '#94a3b8', margin: '16px 0 0' }}>
            Se acontecer de novo, avise a organização informando: {erro.message?.slice(0, 120)}
          </p>
        </div>
      </div>
    )
  }
}
