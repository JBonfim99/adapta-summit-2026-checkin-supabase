import { CheckCircle2, Ticket } from 'lucide-react'
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useNavigate, useLocation } from 'react-router-dom'
import { useApp } from '@/contexts/app-context'

export default function ParticipantSuccess() {
  const navigate = useNavigate()
  const location = useLocation()
  const { buyer } = useApp()

  const submittedEmail = (location.state as any)?.participantEmail || ''

  // Só mostra o botão se há um comprador logado E o email recém-preenchido é o
  // dele — ou seja, o próprio comprador preencheu o seu ingresso. Um participante
  // preenchendo num navegador onde um comprador já logou submete um email
  // diferente, então o botão não aparece.
  const isBuyerSelfFill =
    !!buyer &&
    !!submittedEmail &&
    buyer.email?.trim().toLowerCase() === submittedEmail.trim().toLowerCase()

  return (
    <div className="flex items-center justify-center min-h-[70vh]">
      <Card className="w-full max-w-lg animate-fade-in-up text-center border-none shadow-elevation p-6">
        <CardHeader className="space-y-6">
          <div className="mx-auto bg-green-100 text-emerald-600 p-6 rounded-full w-24 h-24 flex items-center justify-center">
            <CheckCircle2 className="w-12 h-12" />
          </div>
          <div className="space-y-2">
            <CardTitle className="text-3xl text-primary">Inscrição Concluída!</CardTitle>
            <CardDescription className="text-lg">
              Seus dados foram registrados com sucesso para o Adapta Summit 2026.
            </CardDescription>
          </div>
          <div className="bg-slate-50 p-6 rounded-xl text-left border border-slate-100 mt-6">
            <h3 className="font-semibold text-foreground mb-2">O que acontece agora?</h3>
            <ul className="space-y-3 text-muted-foreground text-sm">
              <li className="flex items-start gap-2">
                <span className="text-accent font-bold">•</span>
                O seu QR Code de acesso ao evento será enviado para o seu e-mail daqui a alguns
                minutos, por favor cheque também nas caixas de Spam, Promoções e Outros - o e-mail
                pode ter ido para lá.
              </li>
              <li className="flex items-start gap-2">
                <span className="text-accent font-bold">•</span>
                Sugerimos que tire um print e deixe esse QR Code de fácil acesso em seu celular.
                Guarde ele, pois será sua credencial na entrada do evento.
              </li>
            </ul>
          </div>

          {isBuyerSelfFill && (
            <Button className="bg-primary gap-2 mt-2" onClick={() => navigate('/meus-ingressos')}>
              <Ticket className="w-4 h-4" /> Ver Meus Ingressos
            </Button>
          )}
        </CardHeader>
      </Card>
    </div>
  )
}
