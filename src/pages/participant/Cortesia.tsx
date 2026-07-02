import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useForm, FormProvider } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import * as z from 'zod'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Loader2, AlertCircle, CheckCircle2, Ticket as TicketIcon, Gift } from 'lucide-react'
import { FormInput } from '@/components/FormInput'
import pb from '@/lib/pocketbase/client'
import { isValidCPF } from '@/lib/cpf'
import QrCredential from '@/components/QrCredential'

const LOGO = 'https://drive.google.com/thumbnail?id=1r4vxmkHX_HWaDV6MaZshIJXLpr7vRCxs&sz=w1000'

const schema = z.object({
  nome_completo: z.string().min(3, 'Nome é obrigatório'),
  email: z.string().email('E-mail inválido'),
  telefone: z.string().min(14, 'Telefone inválido — inclua o DDD'),
  cpf: z
    .string()
    .min(14, 'CPF inválido')
    .refine((v) => isValidCPF(v), 'CPF inválido — confira os dígitos'),
})
type FormValues = z.infer<typeof schema>

interface Info {
  anfitriao: string
  tipo_ingresso: string
  ativo: boolean
  esgotado: boolean
  restantes: number | null
}
interface Result {
  qrcode: string
  pedido_id: string
  tipo_ingresso: string
  nome_completo: string
}

export default function Cortesia() {
  const [searchParams] = useSearchParams()
  const token = searchParams.get('c')

  const [info, setInfo] = useState<Info | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<Result | null>(null)

  const methods = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { nome_completo: '', email: '', telefone: '', cpf: '' },
    mode: 'onTouched',
  })

  useEffect(() => {
    if (!token) {
      setError(true)
      setLoading(false)
      return
    }
    pb.send(`/backend/v1/cortesia/info/${token}`)
      .then((res) => setInfo(res))
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }, [token])

  const onSubmit = async (data: FormValues) => {
    setSubmitting(true)
    try {
      // Checagens amigáveis antes de enviar (e-mail e CPF já usados).
      try {
        const em: any = await pb.send('/backend/v1/participant/email-check', {
          method: 'POST',
          body: JSON.stringify({ email: data.email }),
        })
        if (em && em.available === false) {
          methods.setError('email', {
            type: 'manual',
            message: 'Este e-mail já foi usado em outro credenciamento.',
          })
          return
        }
        const cp: any = await pb.send('/backend/v1/participant/cpf-check', {
          method: 'POST',
          body: JSON.stringify({ cpf: data.cpf }),
        })
        if (cp && cp.available === false) {
          methods.setError('cpf', {
            type: 'manual',
            message: 'Este CPF já foi usado em outro credenciamento.',
          })
          return
        }
      } catch (_) {
        // segue; o backend valida de novo no registro
      }

      const res: any = await pb.send('/backend/v1/cortesia/registrar', {
        method: 'POST',
        body: JSON.stringify({
          token,
          nome_completo: data.nome_completo,
          email: data.email,
          telefone: data.telefone,
          cpf: data.cpf,
        }),
      })
      setResult(res)
    } catch (err: any) {
      const msg = err?.message || 'Não foi possível concluir o credenciamento.'
      methods.setError('cpf', { type: 'manual', message: msg })
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    )
  }

  if (error || !info) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Card className="w-full max-w-md text-center border-none shadow-elevation">
          <CardHeader>
            <div className="mx-auto bg-rose-100 text-rose-600 p-4 rounded-full w-20 h-20 flex items-center justify-center mb-4">
              <AlertCircle className="w-10 h-10" />
            </div>
            <CardTitle className="text-2xl text-primary">Convite inválido</CardTitle>
            <CardDescription className="text-base mt-2">
              Este link de cortesia não é válido. Peça um novo link a quem te convidou.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    )
  }

  // Resultado: credencial gerada.
  if (result) {
    return (
      <div className="flex items-center justify-center min-h-[70vh] py-8">
        <Card className="w-full max-w-lg animate-fade-in-up border-none shadow-elevation">
          <CardHeader className="text-center space-y-4">
            <img
              src={LOGO}
              alt="Adapta Summit 2026"
              className="h-12 w-auto object-contain mx-auto"
            />
            <div className="mx-auto bg-emerald-100 text-emerald-600 p-4 rounded-full w-16 h-16 flex items-center justify-center">
              <CheckCircle2 className="w-8 h-8" />
            </div>
            <div>
              <CardTitle className="text-2xl text-primary">Credenciamento confirmado!</CardTitle>
              <CardDescription className="text-base mt-1">
                {result.nome_completo}, este é o seu acesso ao Adapta Summit 2026.
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="flex items-center justify-center gap-3">
              <Badge className="bg-primary text-white text-sm px-3 py-1 gap-1">
                <TicketIcon className="w-4 h-4" /> {result.tipo_ingresso}
              </Badge>
              <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 text-sm px-3 py-1">
                Pré-Credenciado
              </Badge>
            </div>

            {result.qrcode ? (
              <QrCredential value={result.qrcode} />
            ) : (
              <div className="text-sm text-muted-foreground bg-slate-50 rounded-lg p-4 border text-center">
                Seu credenciamento foi registrado. O QR Code está sendo gerado — atualize esta
                página em instantes ou verifique seu e-mail.
              </div>
            )}

            <p className="text-center text-xs text-muted-foreground">
              Apresente este QR Code na entrada do evento. Recomendamos tirar um print.
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }

  const indisponivel = !info.ativo || info.esgotado

  return (
    <div className="flex items-center justify-center min-h-[70vh] py-8">
      <Card className="w-full max-w-md animate-fade-in-up border-none shadow-elevation">
        <CardHeader className="text-center space-y-3">
          <img src={LOGO} alt="Adapta Summit 2026" className="h-12 w-auto object-contain mx-auto" />
          <div className="mx-auto bg-primary/10 text-primary p-3 rounded-full w-14 h-14 flex items-center justify-center">
            <Gift className="w-7 h-7" />
          </div>
          <div>
            <CardTitle className="text-2xl text-primary">Cortesia Adapta Summit 2026</CardTitle>
            <CardDescription className="text-base mt-1">
              Convite de <span className="font-semibold text-foreground">{info.anfitriao}</span>.
              Preencha seus dados para gerar sua credencial na hora.
            </CardDescription>
          </div>
          <div className="flex items-center justify-center">
            <Badge className="bg-primary text-white text-sm px-3 py-1 gap-1">
              <TicketIcon className="w-4 h-4" /> {info.tipo_ingresso}
            </Badge>
          </div>
        </CardHeader>

        <CardContent>
          {indisponivel ? (
            <div className="text-center text-sm text-muted-foreground bg-slate-50 rounded-lg p-6 border">
              {info.esgotado
                ? 'As cortesias deste convite se esgotaram.'
                : 'Este convite não está mais ativo.'}
            </div>
          ) : (
            <FormProvider {...methods}>
              <form onSubmit={methods.handleSubmit(onSubmit)} className="space-y-4">
                {info.restantes != null && (
                  <p className="text-xs text-muted-foreground text-center">
                    {info.restantes} cortesia(s) restante(s).
                  </p>
                )}
                <FormInput name="nome_completo" label="Nome completo" placeholder="Seu nome" />
                <FormInput
                  name="email"
                  label="E-mail"
                  type="email"
                  placeholder="voce@exemplo.com"
                />
                <FormInput
                  name="telefone"
                  label="Telefone (com DDD)"
                  placeholder="(00) 90000-0000"
                  mask="phone"
                />
                <FormInput name="cpf" label="CPF" placeholder="000.000.000-00" mask="cpf" />
                <Button
                  type="submit"
                  className="w-full bg-accent hover:bg-accent/90 text-white"
                  disabled={submitting}
                >
                  {submitting ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Gerando credencial...
                    </>
                  ) : (
                    'Gerar minha credencial'
                  )}
                </Button>
              </form>
            </FormProvider>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
