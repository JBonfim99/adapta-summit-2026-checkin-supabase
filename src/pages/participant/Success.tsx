import { CheckCircle2 } from 'lucide-react'
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'

export default function ParticipantSuccess() {
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
                O seu QR Code de acesso será enviado para o seu e-mail em breve pelo sistema INAC.
              </li>
              <li className="flex items-start gap-2">
                <span className="text-accent font-bold">•</span>
                Guarde este QR Code, ele será sua credencial na entrada do evento.
              </li>
            </ul>
          </div>
        </CardHeader>
      </Card>
    </div>
  )
}
