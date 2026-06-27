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
import { FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { FormInput } from '@/components/FormInput'
import { LinearScale } from '@/components/LinearScale'
import { CheckCircle2 } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'
import pb from '@/lib/pocketbase/client'
import { getErrorMessage } from '@/lib/pocketbase/errors'
import { ROLES, REVENUE, EMPLOYEES } from '@/lib/form-options'

const formSchema = z.object({
  nome_completo: z.string().min(3, 'Nome é obrigatório'),
  email: z.string().email('E-mail inválido'),
  cpf: z.string().min(14, 'CPF inválido'),
  telefone: z.string().min(14, 'Telefone inválido'),
  nome_empresa: z.string().min(2, 'Empresa é obrigatória'),
  cargo: z.string().min(1, 'Selecione um cargo'),
  faturamento_anual: z.string().min(1, 'Selecione o faturamento'),
  num_funcionarios: z.string().min(1, 'Selecione o tamanho'),
  nicho: z.string().min(2, 'Informe o segmento da empresa'),
  ia_uso_diario: z.number().min(1, 'Selecione uma opção').max(5),
  ia_profundidade: z.number().min(1, 'Selecione uma opção').max(5),
  ia_ferramentas: z.string().min(2, 'Preenchimento obrigatório'),
  ia_desafio: z.string().min(2, 'Preenchimento obrigatório'),
})

type FormValues = z.infer<typeof formSchema>

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
                    placeholder="Ex: Varejo de moda"
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
