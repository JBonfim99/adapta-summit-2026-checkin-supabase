import { useEffect, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { useApp } from '@/contexts/app-context'
import pb from '@/lib/backend/client'

export default function MagicLink() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { setBuyer } = useApp()
  const hasRun = useRef(false)

  useEffect(() => {
    if (hasRun.current) return
    hasRun.current = true

    const token = searchParams.get('token')
    if (token) {
      pb.send('/backend/v1/auth/magic-link/consume', {
        method: 'POST',
        body: JSON.stringify({ token }),
      })
        .then((data) => {
          if (data.token) {
            setBuyer({ ...data.comprador, token: data.token })
            navigate('/meus-ingressos', { replace: true })
          }
        })
        .catch(() => {
          navigate('/', {
            replace: true,
            state: { error: 'Este link é inválido ou expirou. Por favor, solicite um novo.' },
          })
        })
    } else {
      navigate('/', { replace: true })
    }
  }, [searchParams, navigate, setBuyer])

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-4 animate-fade-in">
      <Loader2 className="h-12 w-12 animate-spin text-accent" />
      <h2 className="text-xl font-semibold">Validando seu acesso...</h2>
      <p className="text-muted-foreground">Isso levará apenas um momento.</p>
    </div>
  )
}
