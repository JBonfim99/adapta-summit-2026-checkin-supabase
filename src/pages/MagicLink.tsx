import { useEffect, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { useApp } from '@/contexts/app-context'
import pb from '@/lib/pocketbase/client'
import { useToast } from '@/hooks/use-toast'

export default function MagicLink() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { setBuyer } = useApp()
  const { toast } = useToast()
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
          toast({ title: 'Token inválido ou expirado', variant: 'destructive' })
          navigate('/', { replace: true })
        })
    } else {
      navigate('/', { replace: true })
    }
  }, [searchParams, navigate, setBuyer, toast])

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-4 animate-fade-in">
      <Loader2 className="h-12 w-12 animate-spin text-accent" />
      <h2 className="text-xl font-semibold">Validando seu acesso...</h2>
      <p className="text-muted-foreground">Isso levará apenas um momento.</p>
    </div>
  )
}
