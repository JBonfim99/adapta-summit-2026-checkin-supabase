import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useForm, FormProvider } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import * as z from 'zod'
import { Button } from '@/components/ui/button'
import { FormInput } from '@/components/FormInput'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { FormField, FormItem, FormLabel, FormControl, FormMessage } from '@/components/ui/form'
import { ArrowRight, ArrowLeft, CheckCircle2, Loader2 } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'
import pb from '@/lib/pocketbase/client'

const formSchema = z.object({
  nome_completo: z.string().min(3, 'Nome é obrigatório'),
  email: z.string().email('E-mail inválido'),
  cpf: z.string().min(11, 'CPF inválido'),
  telefone: z.string().min(10, 'Telefone inválido'),
  nome_empresa: z.string().min(2, 'Empresa é obrigatória'),
  cargo: z.string().min(1, 'Selecione um cargo'),
  nicho: z.string().min(1, 'Selecione um nicho'),
  num_funcionarios: z.string().min(1, 'Selecione o tamanho'),
  faturamento_anual: z.string().min(1, 'Selecione o faturamento'),
  areas_ajuda: z.array(z.string()).min(1).max(2, 'Selecione até 2 áreas'),
  expectativa_aprendizado: z.string().optional(),
  expectativa_experiencia: z.string().optional(),
})

type FormValues = z.infer<typeof formSchema>

const ROLES = ['Empreendedor/Sócio/CEO', 'C-level/Diretor/Head', 'Gerente/Coordenador', 'Analista']
const NICHES = [
  'Agronegócio',
  'Construção',
  'Consultoria',
  'Tecnologia',
  'Varejo',
  'Saúde',
  'Educação',
]
const EMPLOYEES = ['1-5', '6-10', '11-50', '51-200', '201+']
const REVENUE = ['Até R$500k', 'R$500k-R$4M', 'R$4M-R$10M', 'R$10M-R$50M', 'Mais de R$50M']
const HELP_AREAS = [
  'Vendas',
  'Marketing',
  'Gestão de Pessoas',
  'Finanças',
  'Operações',
  'Tecnologia',
]

export default function ParticipantForm() {
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token')
  const navigate = useNavigate()
  const { toast } = useToast()

  const [step, setStep] = useState(1)
  const [ticketInfo, setTicketInfo] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!token) {
      navigate('/participante/expirado')
      return
    }
    pb.send(`/backend/v1/participant/link/${token}`)
      .then((data) => {
        setTicketInfo(data)
        setLoading(false)
      })
      .catch(() => {
        navigate('/participante/expirado')
      })
  }, [token, navigate])

  const methods = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { areas_ajuda: [] },
  })

  const onSubmit = async (data: FormValues) => {
    setSubmitting(true)
    try {
      await pb.send('/backend/v1/participant/submit', {
        method: 'POST',
        body: JSON.stringify({ token, ...data }),
      })
      toast({ title: 'Dados salvos com sucesso!' })
      navigate('/participante/obrigado')
    } catch (e: any) {
      toast({ title: 'Erro', description: e.message, variant: 'destructive' })
    } finally {
      setSubmitting(false)
    }
  }

  const nextStep = async () => {
    const fieldsToValidate =
      step === 1 ? (['nome_completo', 'email', 'cpf', 'telefone'] as const) : []
    const isValid = await methods.trigger(fieldsToValidate)
    if (isValid) setStep(2)
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
      <div className="mb-8 text-center space-y-2">
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
                    label="E-mail"
                    type="email"
                    placeholder="joao@exemplo.com"
                  />
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FormInput name="cpf" label="CPF" placeholder="000.000.000-00" />
                    <FormInput name="telefone" label="WhatsApp" placeholder="(00) 90000-0000" />
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
                      name="nicho"
                      label="Nicho"
                      type="select"
                      options={NICHES}
                      placeholder="Selecione..."
                    />
                    <FormInput
                      name="num_funcionarios"
                      label="Funcionários"
                      type="select"
                      options={EMPLOYEES}
                      placeholder="Selecione..."
                    />
                    <FormInput
                      name="faturamento_anual"
                      label="Faturamento"
                      type="select"
                      options={REVENUE}
                      placeholder="Selecione..."
                    />
                  </div>

                  <FormField
                    control={methods.control}
                    name="areas_ajuda"
                    render={() => (
                      <FormItem>
                        <div className="mb-4">
                          <FormLabel className="text-base">
                            Onde você mais precisa de ajuda? (Máx. 2)
                          </FormLabel>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          {HELP_AREAS.map((item) => (
                            <FormField
                              key={item}
                              control={methods.control}
                              name="areas_ajuda"
                              render={({ field }) => (
                                <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md border p-3 shadow-sm hover:bg-slate-50 transition-colors">
                                  <FormControl>
                                    <Checkbox
                                      checked={field.value?.includes(item)}
                                      onCheckedChange={(checked) => {
                                        return checked
                                          ? field.onChange([...field.value, item])
                                          : field.onChange(
                                              field.value?.filter((value) => value !== item),
                                            )
                                      }}
                                    />
                                  </FormControl>
                                  <FormLabel className="font-normal cursor-pointer w-full">
                                    {item}
                                  </FormLabel>
                                </FormItem>
                              )}
                            />
                          ))}
                        </div>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormInput
                    name="expectativa_aprendizado"
                    type="textarea"
                    label="Expectativa de Aprendizado (Opcional)"
                    placeholder="O que você espera levar do evento?"
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
                  <Button type="button" className="bg-primary px-8" onClick={nextStep}>
                    Próximo <ArrowRight className="w-4 h-4 ml-2" />
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
