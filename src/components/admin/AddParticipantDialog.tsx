import { useEffect, useState } from 'react'
import { useForm, FormProvider } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import * as z from 'zod'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { FormField, FormItem, FormLabel, FormControl, FormMessage } from '@/components/ui/form'
import { FormInput } from '@/components/FormInput'
import { CheckCircle2 } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'
import pb from '@/lib/pocketbase/client'
import { getErrorMessage } from '@/lib/pocketbase/errors'

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

export function AddParticipantDialog({
  ticket,
  open,
  onOpenChange,
  onSuccess,
}: {
  ticket: any
  open: boolean
  onOpenChange: (val: boolean) => void
  onSuccess?: () => void
}) {
  const { toast } = useToast()
  const [submitting, setSubmitting] = useState(false)

  const methods = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      nome_completo: '',
      email: '',
      cpf: '',
      telefone: '',
      nome_empresa: '',
      cargo: '',
      nicho: '',
      num_funcionarios: '',
      faturamento_anual: '',
      areas_ajuda: [],
      expectativa_aprendizado: '',
      expectativa_experiencia: '',
    },
    mode: 'onTouched',
  })

  useEffect(() => {
    if (open) methods.reset()
  }, [open])

  const onSubmit = async (data: FormValues) => {
    if (!ticket?.id) return
    setSubmitting(true)
    try {
      await pb.send('/backend/v1/admin/participant/create', {
        method: 'POST',
        body: JSON.stringify({ ingresso_id: ticket.id, ...data }),
      })
      toast({ title: 'Participante adicionado e pré-credenciado!' })
      onOpenChange(false)
      onSuccess?.()
    } catch (e: any) {
      toast({ title: 'Erro', description: getErrorMessage(e), variant: 'destructive' })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl p-0 overflow-hidden gap-0">
        <DialogHeader className="p-6 border-b pb-4 bg-slate-50/50 space-y-1">
          <DialogTitle>Adicionar Participante</DialogTitle>
          <DialogDescription>
            Pré-credenciamento manual do ingresso{' '}
            <span className="font-mono font-semibold text-foreground">{ticket?.pedido_id}</span> (
            {ticket?.tipo_ingresso}).
          </DialogDescription>
        </DialogHeader>

        <FormProvider {...methods}>
          <form onSubmit={methods.handleSubmit(onSubmit)}>
            <div className="max-h-[60vh] overflow-y-auto px-6 py-4">
              <div className="space-y-5">
                <FormInput name="nome_completo" label="Nome Completo" placeholder="João da Silva" />
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
                      <div className="mb-2">
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
                              const currentValues = field.value || []
                              const isChecked = currentValues.includes(item)
                              const isAtLimit = currentValues.length >= 2 && !isChecked

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
                                          ? field.onChange([...currentValues, item])
                                          : field.onChange(
                                              currentValues.filter(
                                                (value: string) => value !== item,
                                              ),
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

            <DialogFooter className="p-4 border-t bg-slate-50/50">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={submitting}
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                className="bg-accent hover:bg-accent/90 text-white"
                disabled={submitting}
              >
                {submitting ? 'Enviando...' : 'Finalizar'}
                {!submitting && <CheckCircle2 className="w-4 h-4 ml-2" />}
              </Button>
            </DialogFooter>
          </form>
        </FormProvider>
      </DialogContent>
    </Dialog>
  )
}
