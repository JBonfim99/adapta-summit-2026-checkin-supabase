import { useState, useEffect } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Loader2, AlertCircle, Ticket as TicketIcon, CheckCircle2, Mail } from 'lucide-react'
import pb from '@/lib/pocketbase/client'

interface TicketData {
  tipo_ingresso: string
  status: string
  pedido_id: string
  preenchido: boolean
  participante: {
    nome_completo: string
    email: string
    cpf: string
    telefone: string
    nome_empresa: string
    cargo: string
  } | null
}

const LOGO = 'https://drive.google.com/thumbnail?id=1r4vxmkHX_HWaDV6MaZshIJXLpr7vRCxs&sz=w1000'

export default function ParticipantTicket() {
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token')
  const navigate = useNavigate()

  const [data, setData] = useState<TicketData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    if (!token) {
      setError(true)
      setLoading(false)
      return
    }
    pb.send(`/backend/v1/participant/ticket/${token}`)
      .then((res) => setData(res))
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }, [token])

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Card className="w-full max-w-md animate-fade-in text-center border-none shadow-elevation">
          <CardHeader>
            <div className="mx-auto bg-rose-100 text-rose-600 p-4 rounded-full w-20 h-20 flex items-center justify-center mb-4">
              <AlertCircle className="w-10 h-10" />
            </div>
            <CardTitle className="text-2xl text-primary">Link Inválido ou Expirado</CardTitle>
            <CardDescription className="text-base mt-2">
              Não foi possível carregar os detalhes deste ingresso. Se você acha que isso é um erro,
              contate o comprador original.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    )
  }

  // Ingresso ainda não preenchido → direciona ao formulário.
  if (!data.preenchido) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Card className="w-full max-w-md animate-fade-in-up text-center border-none shadow-elevation p-2">
          <CardHeader>
            <img
              src={LOGO}
              alt="Adapta Summit 2026"
              className="h-12 w-auto object-contain mx-auto mb-4"
            />
            <CardTitle className="text-2xl text-primary">Pré-credenciamento pendente</CardTitle>
            <CardDescription className="text-base mt-2">
              Este ingresso ({data.tipo_ingresso}) ainda não foi preenchido. Complete seus dados
              para gerar sua credencial.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              className="bg-accent hover:bg-accent/90 text-white"
              onClick={() => navigate(`/credenciamento?token=${token}`)}
            >
              Preencher agora
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  const p = data.participante!

  return (
    <div className="flex items-center justify-center min-h-[70vh] py-8">
      <Card className="w-full max-w-lg animate-fade-in-up border-none shadow-elevation">
        <CardHeader className="text-center space-y-4">
          <img src={LOGO} alt="Adapta Summit 2026" className="h-12 w-auto object-contain mx-auto" />
          <div className="mx-auto bg-emerald-100 text-emerald-600 p-4 rounded-full w-16 h-16 flex items-center justify-center">
            <CheckCircle2 className="w-8 h-8" />
          </div>
          <div>
            <CardTitle className="text-2xl text-primary">Seu ingresso está confirmado</CardTitle>
            <CardDescription className="text-base mt-1">
              Estes são os dados do seu pré-credenciamento para o Adapta Summit 2026.
            </CardDescription>
          </div>
        </CardHeader>

        <CardContent className="space-y-5">
          <div className="flex items-center justify-center gap-3">
            <Badge className="bg-primary text-white text-sm px-3 py-1 gap-1">
              <TicketIcon className="w-4 h-4" /> {data.tipo_ingresso}
            </Badge>
            <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 text-sm px-3 py-1">
              {data.status}
            </Badge>
          </div>

          <div className="rounded-xl border bg-slate-50/60 divide-y">
            <Row label="Participante" value={p.nome_completo} />
            <Row label="E-mail" value={p.email} />
            <Row label="CPF" value={p.cpf} />
            <Row label="Telefone" value={p.telefone} />
            <Row label="Empresa" value={p.nome_empresa} />
            <Row label="Cargo" value={p.cargo} />
            <Row label="Nº do pedido" value={data.pedido_id} />
          </div>

          <div className="flex items-start gap-2 text-sm text-muted-foreground bg-slate-50 rounded-lg p-4 border border-slate-100">
            <Mail className="w-4 h-4 mt-0.5 shrink-0 text-accent" />
            <span>
              Seu QR Code de acesso é enviado por e-mail. Apresente-o na entrada do evento.
              Verifique também as abas Spam, Promoções e Outros caso não o encontre.
            </span>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-medium text-foreground text-right break-all">
        {value || '—'}
      </span>
    </div>
  )
}
