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
  cpf: z.string().min(14, 'CPF inválido'),
  telefone: z.string().min(14, 'Telefone inválido'),
  nome_empresa: z.string().min(2, 'Empresa é obrigatória'),
  cargo: z.string().min(1, 'Selecione um cargo'),
  nicho: z.string().min(1, 'Selecione um nicho'),
  num_funcionarios: z.string().min(1, 'Selecione o tamanho'),
  faturamento_anual: z.string().min(1, 'Selecione o faturamento'),
  areas_ajuda: z
    .array(z.string())
    .min(1, 'Selecione pelo menos uma área')
    .max(2, 'Selecione até 2 áreas'),
  expectativa_aprendizado: z.string().min(3, 'Preenchimento obrigatório'),
  expectativa_experiencia: z.string().min(3, 'Preenchimento obrigatório'),
})

type FormValues = z.infer<typeof formSchema>

const ROLES = [
  'Empreendedor, sócio ou CEO',
  'C-level, Diretor ou Head',
  'Gerente ou Coordenador',
  'Analista',
]

const NICHES = [
  'Agronegócio',
  'Construção',
  'Consultoria / Projetos',
  'Contábil',
  'Educação',
  'Energia',
  'Finanças',
  'Hospitalidade e Turismo',
  'Imobiliário',
  'Indústria',
  'Mídia e Entretenimento',
  'Saúde',
  'Jurídico',
  'Setor público',
  'Tecnologia',
  'Transporte e logística',
  'Varejo',
  'Fitness',
  'Telecom',
  'Marketing',
  'Serviço',
  'Outro',
]

const EMPLOYEES = [
  '1 a 5',
  '6 a 10',
  '11 a 20',
  '21 a 50',
  '51 a 100',
  '101 a 300',
  '301 a 500',
  '501 a 1.000',
  'Mais de 1.000',
]

const REVENUE = [
  'Até R$500.000 por ano',
  'De R$500.000 até R$4 milhões por ano',
  'De R$4 milhões até R$10 milhões por ano',
  'De R$10 milhões até R$20 milhões por ano',
  'Mais de R$20 milhões por ano',
]

const HELP_AREAS = [
  'Gestão de Indicadores',
  'Criação de Sistemas e Processos',
  'Marketing',
  'Edição de Vídeo e Geração de Criativos',
  'Vendas',
  'Automação e Integração de Sistemas',
  'Atendimento ao Cliente / Suporte',
  'Tecnologia',
  'Administrativo / Financeiro',
  'Gestão de Pessoas',
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
    mode: 'onTouched',
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
      <div className="mb-8 text-center space-y-2 flex flex-col items-center">
        <img
          src="https://drive.google.com/thumbnail?id=1r4vxmkHX_HWaDV6MaZshIJXLpr7vRCxs&sz=w1000"
          alt="Adapta Summit 2026"
          className="h-12 md:h-16 w-auto object-contain mb-4"
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
                      name="nicho"
                      label="Nicho"
                      type="select"
                      options={NICHES}
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
                      name="faturamento_anual"
                      label="Faixa de faturamento"
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
                        <div
                          className={`grid grid-cols-1 sm:grid-cols-2 gap-3 ${methods.formState.errors.areas_ajuda ? 'p-2 border border-red-500 rounded-md bg-red-50/50' : ''}`}
                        >
                          {HELP_AREAS.map((item) => (
                            <FormField
                              key={item}
                              control={methods.control}
                              name="areas_ajuda"
                              render={({ field }) => {
                                const isChecked = field.value?.includes(item)
                                const isAtLimit = field.value?.length >= 2 && !isChecked

                                return (
                                  <FormItem
                                    className={`flex flex-row items-start space-x-3 space-y-0 rounded-md border p-3 shadow-sm transition-colors ${isAtLimit ? 'opacity-50 cursor-not-allowed' : 'hover:bg-slate-50 cursor-pointer'}`}
                                  >
                                    <FormControl>
                                      <Checkbox
                                        checked={isChecked}
                                        disabled={isAtLimit}
                                        onCheckedChange={(checked) => {
                                          return checked
                                            ? field.onChange([...field.value, item])
                                            : field.onChange(
                                                field.value?.filter((value) => value !== item),
                                              )
                                        }}
                                      />
                                    </FormControl>
                                    <FormLabel
                                      className={`font-normal w-full ${isAtLimit ? 'cursor-not-allowed' : 'cursor-pointer'}`}
                                    >
                                      {item}
                                    </FormLabel>
                                  </FormItem>
                                )
                              }}
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
                    label="O que espera aprender no evento?"
                    placeholder="Sua expectativa..."
                  />
                  <FormInput
                    name="expectativa_experiencia"
                    type="textarea"
                    label="Que tipo de experiência espera participar no evento?"
                    placeholder="Sua expectativa..."
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
