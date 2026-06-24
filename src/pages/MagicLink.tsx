import { useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { useApp } from '@/contexts/app-context'

export default function MagicLink() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { login } = useApp()

  useEffect(() => {
    const email = searchParams.get('email')
    if (email) {
      setTimeout(() => {
        login(email)
        if (email.includes('admin')) {
          navigate('/admin')
        } else {
          navigate('/meus-ingressos')
        }
      }, 1500)
    } else {
      navigate('/')
    }
  }, [searchParams, login, navigate])

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-4 animate-fade-in">
      <Loader2 className="h-12 w-12 animate-spin text-accent" />
      <h2 className="text-xl font-semibold">Validando seu acesso...</h2>
      <p className="text-muted-foreground">Isso levará apenas um momento.</p>
    </div>
  )
}
