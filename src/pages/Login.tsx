import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Mail, CheckCircle2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import pb from '@/lib/pocketbase/client'
import { useToast } from '@/hooks/use-toast'

export default function Login() {
  const [email, setEmail] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()
  const { toast } = useToast()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email) return
    setLoading(true)

    try {
      const res = await pb.send('/backend/v1/auth/magic-link', {
        method: 'POST',
        body: JSON.stringify({ email }),
      })
      setSubmitted(true)
      // Simulate the email click for the demo flow
      setTimeout(() => navigate(`/acesso?token=${res.token}`), 2500)
    } catch (err: any) {
      toast({
        title: 'Não encontrado',
        description: err.message || 'Verifique o e-mail digitado.',
        variant: 'destructive',
      })
    } finally {
      setLoading(false)
    }
  }

  if (submitted) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Card className="w-full max-w-md animate-fade-in-up text-center border-none shadow-elevation">
          <CardHeader>
            <div className="mx-auto bg-emerald-100 text-emerald-600 p-4 rounded-full w-20 h-20 flex items-center justify-center mb-4">
              <CheckCircle2 className="w-10 h-10" />
            </div>
            <CardTitle className="text-2xl">Link Enviado!</CardTitle>
            <CardDescription className="text-base mt-2">
              Enviamos um link de acesso mágico para <strong>{email}</strong>. Verifique sua caixa
              de entrada. (Redirecionando na demo...)
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-[70vh] gap-8 animate-fade-in">
      <div className="text-center space-y-4 max-w-lg">
        <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight text-primary">
          Acesse seus Ingressos
        </h1>
        <p className="text-lg text-muted-foreground">
          Digite seu e-mail da compra para receber o link mágico e gerenciar seus participantes do
          Adapta Summit 2026.
        </p>
      </div>

      <Card className="w-full max-w-md border-none shadow-elevation">
        <CardHeader>
          <CardTitle>Entrar</CardTitle>
          <CardDescription>Use o e-mail cadastrado na compra.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <div className="relative">
                <Mail className="absolute left-3 top-3 h-5 w-5 text-muted-foreground" />
                <Input
                  type="email"
                  placeholder="seu@email.com"
                  className="pl-10 h-12 text-base bg-slate-50"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
            </div>
            <Button
              type="submit"
              className="w-full h-12 text-base bg-accent hover:bg-accent/90"
              disabled={loading}
            >
              {loading ? 'Enviando...' : 'Enviar Link de Acesso'}
            </Button>
          </form>
          <div className="mt-6 text-center text-sm text-muted-foreground">
            Dica: use <span className="font-semibold text-foreground">buyer@test.com</span>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
