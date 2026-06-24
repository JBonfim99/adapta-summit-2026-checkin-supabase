import { AlertCircle } from 'lucide-react'
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'

export default function ParticipantExpired() {
  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <Card className="w-full max-w-md animate-fade-in text-center border-none shadow-elevation">
        <CardHeader>
          <div className="mx-auto bg-rose-100 text-rose-600 p-4 rounded-full w-20 h-20 flex items-center justify-center mb-4">
            <AlertCircle className="w-10 h-10" />
          </div>
          <CardTitle className="text-2xl text-primary">Link Inválido ou Expirado</CardTitle>
          <CardDescription className="text-base mt-2">
            Este ingresso já foi preenchido ou o link não é mais válido. Se você acha que isso é um
            erro, contate o comprador original.
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  )
}
