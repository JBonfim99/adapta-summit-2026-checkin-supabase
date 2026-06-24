import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useForm, FormProvider } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import * as z from 'zod'
import { useApp } from '@/contexts/app-context'
import { Button } from '@/components/ui/button'
import { FormInput } from '@/components/FormInput'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { FormField, FormItem, FormLabel, FormControl, FormMessage } from '@/components/ui/form'
import { ArrowRight, ArrowLeft, CheckCircle2 } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'

const formSchema = z.object({
  name: z.string().min(3, 'Nome é obrigatório'),
  email: z.string().email('E-mail inválido'),
  cpf: z.string().min(11, 'CPF inválido'),
  phone: z.string().min(10, 'Telefone inválido'),
  company: z.string().min(2, 'Empresa é obrigatória'),
  role: z.string().min(1, 'Selecione um cargo'),
  niche: z.string().min(1, 'Selecione um nicho'),
  employees: z.string().min(1, 'Selecione o tamanho'),
  revenue: z.string().min(1, 'Selecione o faturamento'),
  helpAreas: z.array(z.string()).min(1).max(2, 'Selecione até 2 áreas'),
  learning: z.string().optional(),
  experience: z.string().optional(),
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
  const { ticketId } = useParams()
  const { tickets, updateTicket, addParticipant } = useApp()
  const navigate = useNavigate()
  const { toast } = useToast()
  const [step, setStep] = useState(1)

  const ticket = tickets.find((t) => t.id === ticketId)

  useEffect(() => {
    if (!ticket || ticket.status === 'filled') {
      navigate('/participante/expirado')
    }
  }, [ticket, navigate])

  const methods = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { helpAreas: [] },
  })

  const onSubmit = (data: FormValues) => {
    if (!ticketId) return
    const newParticipant = { id: `P-${Date.now()}`, ticketId, ...data }
    addParticipant(newParticipant)
    updateTicket(ticketId, { status: 'filled', participantName: data.name })
    toast({ title: 'Dados salvos com sucesso!' })
    navigate('/participante/obrigado')
  }

  const nextStep = async () => {
    const fieldsToValidate = step === 1 ? (['name', 'email', 'cpf', 'phone'] as const) : []
    const isValid = await methods.trigger(fieldsToValidate)
    if (isValid) setStep(2)
  }

  if (!ticket) return null

  return (
    <div className="max-w-2xl mx-auto py-8 animate-fade-in">
      <div className="mb-8 text-center space-y-2">
        <h1 className="text-3xl font-bold">Pré-Credenciamento</h1>
        <p className="text-muted-foreground">
          Ingresso: {ticket.id} ({ticket.type})
        </p>
      </div>

      <div className="flex items-center justify-center gap-4 mb-8">
        <div
          className={`flex items-center justify-center w-8 h-8 rounded-full font-bold ${step >= 1 ? 'bg-primary text-white' : 'bg-slate-200'}`}
        >
          1
        </div>
        <div className={`h-1 w-16 rounded ${step === 2 ? 'bg-primary' : 'bg-slate-200'}`} />
        <div
          className={`flex items-center justify-center w-8 h-8 rounded-full font-bold ${step === 2 ? 'bg-primary text-white' : 'bg-slate-200'}`}
        >
          2
        </div>
      </div>

      <Card className="shadow-elevation border-none">
        <CardHeader className="bg-slate-50/50 border-b rounded-t-xl pb-6">
          <CardTitle>{step === 1 ? 'Identificação Básica' : 'Perfil Profissional'}</CardTitle>
          <CardDescription>
            {step === 1
              ? 'Como você será identificado no evento.'
              : 'Ajude-nos a personalizar sua experiência.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-6">
          <FormProvider {...methods}>
            <form onSubmit={methods.handleSubmit(onSubmit)} className="space-y-6">
              {step === 1 && (
                <div className="space-y-4 animate-slide-in-right">
                  <FormInput name="name" label="Nome Completo" placeholder="João da Silva" />
                  <FormInput
                    name="email"
                    label="E-mail"
                    type="email"
                    placeholder="joao@exemplo.com"
                  />
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FormInput name="cpf" label="CPF" placeholder="000.000.000-00" />
                    <FormInput name="phone" label="WhatsApp" placeholder="(00) 90000-0000" />
                  </div>
                </div>
              )}

              {step === 2 && (
                <div className="space-y-6 animate-slide-in-right">
                  <FormInput
                    name="company"
                    label="Nome da Empresa"
                    placeholder="Sua Empresa Ltda"
                  />
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FormInput
                      name="role"
                      label="Cargo"
                      type="select"
                      options={ROLES}
                      placeholder="Selecione..."
                    />
                    <FormInput
                      name="niche"
                      label="Nicho"
                      type="select"
                      options={NICHES}
                      placeholder="Selecione..."
                    />
                    <FormInput
                      name="employees"
                      label="Funcionários"
                      type="select"
                      options={EMPLOYEES}
                      placeholder="Selecione..."
                    />
                    <FormInput
                      name="revenue"
                      label="Faturamento"
                      type="select"
                      options={REVENUE}
                      placeholder="Selecione..."
                    />
                  </div>

                  <FormField
                    control={methods.control}
                    name="helpAreas"
                    render={() => (
                      <FormItem>
                        <div className="mb-4">
                          <FormLabel className="text-base">
                            Onde você mais precisa de ajuda? (Máx. 2)
                          </FormLabel>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          {HELP_AREAS.map((item) => (
                            <FormField
                              key={item}
                              control={methods.control}
                              name="helpAreas"
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
                                  <FormLabel className="font-normal cursor-pointer">
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
                    name="learning"
                    type="textarea"
                    label="Expectativa de Aprendizado (Opcional)"
                  />
                </div>
              )}

              <div className="flex justify-between pt-6 border-t mt-8">
                {step === 2 ? (
                  <Button type="button" variant="outline" onClick={() => setStep(1)}>
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
                  <Button type="submit" className="bg-accent hover:bg-accent/90 px-8 text-white">
                    Finalizar <CheckCircle2 className="w-4 h-4 ml-2" />
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
