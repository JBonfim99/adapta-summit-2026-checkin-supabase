import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useForm, FormProvider } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import * as z from 'zod'
import { Button } from '@/components/ui/button'
import { FormInput } from '@/components/FormInput'
import { LinearScale } from '@/components/LinearScale'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { ArrowRight, ArrowLeft, CheckCircle2, Loader2 } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'
import pb from '@/lib/pocketbase/client'
import { getErrorMessage } from '@/lib/pocketbase/errors'
import { ROLES, REVENUE, EMPLOYEES, NICHES } from '@/lib/form-options'

const formSchema = z.object({
  nome_completo: z.string().min(3, 'Nome é obrigatório'),
  email: z.string().email('E-mail inválido'),
  cpf: z.string().min(14, 'CPF inválido'),
  telefone: z.string().min(14, 'Telefone inválido'),
  nome_empresa: z.string().min(2, 'Empresa é obrigatória'),
  cargo: z.string().min(1, 'Selecione um cargo'),
  faturamento_anual: z.string().min(1, 'Selecione o faturamento'),
  num_funcionarios: z.string().min(1, 'Selecione o tamanho'),
  nicho: z.string().min(1, 'Selecione o segmento'),
  ia_uso_diario: z.number().min(1, 'Selecione uma opção').max(5),
  ia_profundidade: z.number().min(1, 'Selecione uma opção').max(5),
  ia_ferramentas: z.string().min(2, 'Preenchimento obrigatório'),
  ia_desafio: z.string().min(2, 'Preenchimento obrigatório'),
})

type FormValues = z.infer<typeof formSchema>

export default function ParticipantForm() {
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token')
  const navigate = useNavigate()
  const { toast } = useToast()

  const [step, setStep] = useState(1)
  const [ticketInfo, setTicketInfo] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [emailChecking, setEmailChecking] = useState(false)

  useEffect(() => {
    if (!token) {
      navigate('/participante/expirado')
      return
    }
    pb.send(`/backend/v1/participant/link/${token}`)
      .then((data) => {
        // Já preenchido: leva à página de detalhes em vez do formulário.
        if (data.usado) {
          navigate(`/ingresso?token=${token}`, { replace: true })
          return
        }
        setTicketInfo(data)
        setLoading(false)
      })
      .catch(() => {
        navigate('/participante/expirado')
      })
  }, [token, navigate])

  const methods = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      nome_completo: '',
      email: '',
      cpf: '',
      telefone: '',
      nome_empresa: '',
      cargo: '',
      faturamento_anual: '',
      num_funcionarios: '',
      nicho: '',
      ia_uso_diario: 0,
      ia_profundidade: 0,
      ia_ferramentas: '',
      ia_desafio: '',
    },
    mode: 'onTouched',
  })

  const onSubmit = async (data: FormValues) => {
    setSubmitting(true)
    try {
      const payload = {
        token,
        nome_completo: data.nome_completo || '',
        email: data.email || '',
        cpf: data.cpf || '',
        telefone: data.telefone || '',
        nome_empresa: data.nome_empresa || '',
        cargo: data.cargo || '',
        nicho: data.nicho || '',
        num_funcionarios: data.num_funcionarios || '',
        faturamento_anual: data.faturamento_anual || '',
        ia_uso_diario: data.ia_uso_diario || 0,
        ia_profundidade: data.ia_profundidade || 0,
        ia_ferramentas: data.ia_ferramentas || '',
        ia_desafio: data.ia_desafio || '',
      }
      const resp: any = await pb.send('/backend/v1/participant/submit', {
        method: 'POST',
        body: JSON.stringify(payload),
      })
      toast({ title: 'Dados salvos com sucesso!' })
      navigate('/participante/obrigado', {
        state: { participantEmail: data.email || '', qrcode: resp?.qrcode || '' },
      })
    } catch (e: any) {
      toast({ title: 'Erro', description: getErrorMessage(e), variant: 'destructive' })
    } finally {
      setSubmitting(false)
    }
  }

  const nextStep = async () => {
    const fieldsToValidate =
      step === 1 ? (['nome_completo', 'email', 'cpf', 'telefone'] as const) : []
    const isValid = await methods.trigger(fieldsToValidate)
    if (!isValid) return

    // Regra: e-mail único entre participantes (pode coincidir com o de um comprador).
    const email = methods.getValues('email')
    setEmailChecking(true)
    try {
      const res: any = await pb.send('/backend/v1/participant/email-check', {
        method: 'POST',
        body: JSON.stringify({ email }),
      })
      if (res && res.available === false) {
        methods.setError('email', {
          type: 'manual',
          message: 'Este e-mail já foi usado por outro participante. Use outro e-mail.',
        })
        return
      }
    } catch (_) {
      // Se a checagem falhar, segue — o backend ainda valida no envio final.
    } finally {
      setEmailChecking(false)
    }

    setStep(2)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto py-8 px-4 animate-fade-in">
      <div className="mb-8 text-center space-y-2 flex flex-col items-center">
        <img
          src="https://drive.google.com/thumbnail?id=1r4vxmkHX_HWaDV6MaZshIJXLpr7vRCxs&sz=w1000"
          alt="Adapta Summit 2026"
          width="250"
          height="64"
          className="h-12 md:h-16 w-auto min-w-[180px] object-contain mb-4"
        />
        <h1 className="text-3xl font-bold">Pré-Credenciamento</h1>
        <p className="text-muted-foreground">
          Ingresso:{' '}
          <span className="font-mono text-foreground font-semibold">
            {ticketInfo?.tipo_ingresso}
          </span>
        </p>
      </div>

      <div className="flex items-center justify-center gap-4 mb-8">
        <div
          className={`flex items-center justify-center w-8 h-8 rounded-full font-bold transition-colors ${step >= 1 ? 'bg-primary text-white' : 'bg-slate-200'}`}
        >
          1
        </div>
        <div
          className={`h-1 w-16 rounded transition-colors ${step === 2 ? 'bg-primary' : 'bg-slate-200'}`}
        />
        <div
          className={`flex items-center justify-center w-8 h-8 rounded-full font-bold transition-colors ${step === 2 ? 'bg-primary text-white' : 'bg-slate-200'}`}
        >
          2
        </div>
      </div>

      <Card className="shadow-elevation border-none">
        <CardHeader className="bg-slate-50/50 border-b rounded-t-xl pb-6">
          <CardTitle>{step === 1 ? 'Identificação Básica' : 'Perfil Profissional'}</CardTitle>
          <CardDescription>
            {step === 1
              ? 'Como você será identificado no evento e credencial.'
              : 'Ajude-nos a personalizar sua experiência e direcionamento.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-6">
          <FormProvider {...methods}>
            <form onSubmit={methods.handleSubmit(onSubmit)} className="space-y-6">
              <div className={step === 1 ? 'block animate-slide-in-right' : 'hidden'}>
                <div className="space-y-4">
                  <FormInput
                    name="nome_completo"
                    label="Nome Completo"
                    placeholder="João da Silva"
                  />
                  <FormInput
                    name="email"
                    label="E-mail de registro no evento"
                    type="email"
                    placeholder="joao@exemplo.com"
                  />
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FormInput name="cpf" label="CPF" placeholder="000.000.000-00" mask="cpf" />
                    <FormInput
                      name="telefone"
                      label="Telefone"
                      placeholder="(00) 90000-0000"
                      mask="phone"
                    />
                  </div>
                </div>
              </div>

              <div className={step === 2 ? 'block animate-slide-in-right' : 'hidden'}>
                <div className="space-y-6">
                  <FormInput
                    name="nome_empresa"
                    label="Nome da Empresa"
                    placeholder="Sua Empresa Ltda"
                  />
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FormInput
                      name="cargo"
                      label="Cargo"
                      type="select"
                      options={ROLES}
                      placeholder="Selecione..."
                    />
                    <FormInput
                      name="faturamento_anual"
                      label="Faturamento anual"
                      type="select"
                      options={REVENUE}
                      placeholder="Selecione..."
                    />
                    <FormInput
                      name="num_funcionarios"
                      label="Número de funcionários"
                      type="select"
                      options={EMPLOYEES}
                      placeholder="Selecione..."
                    />
                    <FormInput
                      name="nicho"
                      label="Qual o segmento da sua empresa?"
                      type="select"
                      options={NICHES}
                      placeholder="Selecione..."
                    />
                  </div>

                  <FormField
                    control={methods.control}
                    name="ia_uso_diario"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-base">
                          De 1 a 5, quantas pessoas usam IA na sua empresa diariamente?
                        </FormLabel>
                        <LinearScale
                          value={field.value}
                          onChange={field.onChange}
                          leftLabel="Ninguém"
                          rightLabel="Todos"
                          error={!!methods.formState.errors.ia_uso_diario}
                        />
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={methods.control}
                    name="ia_profundidade"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-base">
                          Qual a profundidade do uso de IA dessas pessoas?
                        </FormLabel>
                        <LinearScale
                          value={field.value}
                          onChange={field.onChange}
                          leftLabel="Usamos como Google"
                          rightLabel="Nativo de IA"
                          error={!!methods.formState.errors.ia_profundidade}
                        />
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormInput
                    name="ia_ferramentas"
                    type="textarea"
                    label="Quais ferramentas de IA você utiliza atualmente?"
                    placeholder="Ex: ChatGPT, Claude, Gemini, n8n..."
                  />
                  <FormInput
                    name="ia_desafio"
                    type="textarea"
                    label="Na sua visão, qual o maior desafio para tornar sua empresa Nativa de IA?"
                    placeholder="Sua resposta..."
                  />
                </div>
              </div>

              <div className="flex justify-between pt-6 border-t mt-8">
                {step === 2 ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setStep(1)}
                    disabled={submitting}
                  >
                    <ArrowLeft className="w-4 h-4 mr-2" /> Voltar
                  </Button>
                ) : (
                  <div />
                )}

                {step === 1 ? (
                  <Button
                    type="button"
                    className="bg-primary px-8"
                    onClick={nextStep}
                    disabled={emailChecking}
                  >
                    {emailChecking ? 'Verificando...' : 'Próximo'}{' '}
                    {!emailChecking && <ArrowRight className="w-4 h-4 ml-2" />}
                  </Button>
                ) : (
                  <Button
                    type="submit"
                    className="bg-accent hover:bg-accent/90 px-8 text-white"
                    disabled={submitting}
                  >
                    {submitting ? 'Enviando...' : 'Finalizar'}{' '}
                    {!submitting && <CheckCircle2 className="w-4 h-4 ml-2" />}
                  </Button>
                )}
              </div>
            </form>
          </FormProvider>
        </CardContent>
      </Card>
    </div>
  )
}
