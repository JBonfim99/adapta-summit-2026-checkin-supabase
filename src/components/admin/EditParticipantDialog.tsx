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
import { FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { FormInput } from '@/components/FormInput'
import { LinearScale } from '@/components/LinearScale'
import { CheckCircle2 } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'
import pb from '@/lib/pocketbase/client'
import { getErrorMessage } from '@/lib/pocketbase/errors'
import { ROLES, REVENUE, EMPLOYEES, NICHES } from '@/lib/form-options'
import { isValidCPF } from '@/lib/cpf'

const formSchema = z
  .object({
    nome_completo: z.string().min(3, 'Nome é obrigatório'),
    email: z.string().email('E-mail inválido'),
    cpf: z
      .string()
      .min(14, 'CPF inválido')
      .refine((v) => isValidCPF(v), 'CPF inválido — confira os dígitos'),
    telefone: z.string().min(14, 'Telefone inválido'),
    tem_empresa: z.boolean(),
    nome_empresa: z.string().optional().default(''),
    cargo: z.string().optional().default(''),
    profissao: z.string().optional().default(''),
    faturamento_anual: z.string().optional().default(''),
    num_funcionarios: z.string().optional().default(''),
    nicho: z.string().min(1, 'Selecione o segmento'),
    ia_uso_diario: z.number().min(1, 'Selecione uma opção').max(5),
    ia_profundidade: z.number().min(1, 'Selecione uma opção').max(5),
    ia_ferramentas: z.string().min(2, 'Preenchimento obrigatório'),
    ia_desafio: z.string().min(2, 'Preenchimento obrigatório'),
  })
  .superRefine((data, ctx) => {
    if (data.tem_empresa) {
      if (!data.nome_empresa || data.nome_empresa.trim().length < 2)
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['nome_empresa'],
          message: 'Empresa é obrigatória',
        })
      if (!data.faturamento_anual)
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['faturamento_anual'],
          message: 'Selecione o faturamento',
        })
      if (!data.num_funcionarios)
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['num_funcionarios'],
          message: 'Selecione o tamanho',
        })
      if (!data.cargo)
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['cargo'],
          message: 'Selecione um cargo',
        })
    } else {
      if (!data.profissao || data.profissao.trim().length < 2)
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['profissao'],
          message: 'Informe a profissão',
        })
    }
  })

type FormValues = z.infer<typeof formSchema>

export function EditParticipantDialog({
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
      tem_empresa: true,
      nome_empresa: '',
      cargo: '',
      profissao: '',
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

  const temEmpresa = methods.watch('tem_empresa')

  // Pré-preenche com os dados atuais do participante ao abrir.
  useEffect(() => {
    if (open && ticket?.expand?.participante_id) {
      const p = ticket.expand.participante_id
      methods.reset({
        nome_completo: p.nome_completo || '',
        email: p.email || '',
        cpf: p.cpf || '',
        telefone: p.telefone || '',
        tem_empresa: p.tem_empresa !== false,
        nome_empresa: p.nome_empresa || '',
        cargo: p.cargo || '',
        profissao: p.profissao || '',
        faturamento_anual: p.faturamento_anual || '',
        num_funcionarios: p.num_funcionarios || '',
        nicho: p.nicho || '',
        ia_uso_diario: p.ia_uso_diario || 0,
        ia_profundidade: p.ia_profundidade || 0,
        ia_ferramentas: p.ia_ferramentas || '',
        ia_desafio: p.ia_desafio || '',
      })
    }
  }, [open, ticket])

  const handleSemEmpresa = (checked: boolean) => {
    const semEmpresa = checked === true
    methods.setValue('tem_empresa', !semEmpresa)
    if (semEmpresa) {
      methods.setValue('nome_empresa', '')
      methods.setValue('cargo', '')
      methods.setValue('faturamento_anual', '')
      methods.setValue('num_funcionarios', '')
      methods.clearErrors(['nome_empresa', 'cargo', 'faturamento_anual', 'num_funcionarios'])
    } else {
      methods.setValue('profissao', '')
      methods.clearErrors(['profissao'])
    }
  }

  const onSubmit = async (data: FormValues) => {
    if (!ticket?.id) return
    setSubmitting(true)
    try {
      const isEmpresa = !!data.tem_empresa
      const res: any = await pb.send(`/backend/v1/admin/tickets/${ticket.id}/edit`, {
        method: 'POST',
        body: JSON.stringify({
          ...data,
          tem_empresa: isEmpresa,
          nome_empresa: isEmpresa ? data.nome_empresa || '' : '',
          cargo: isEmpresa ? data.cargo || '' : '',
          profissao: isEmpresa ? '' : data.profissao || '',
          nicho: data.nicho || '',
          num_funcionarios: isEmpresa ? data.num_funcionarios || '' : '',
          faturamento_anual: isEmpresa ? data.faturamento_anual || '' : '',
        }),
      })
      if (res && res.success === false) {
        // INAC falhou (ou erro local): nada foi alterado. Mantém o dialog aberto.
        toast({
          title: 'Não foi salvo',
          description: res.error || 'Falha ao editar.',
          variant: 'destructive',
        })
        return
      }
      toast({
        title: 'Credenciamento atualizado!',
        description: 'Dados atualizados aqui e na INAC.',
      })
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
      <DialogContent className="max-w-2xl p-0 overflow-hidden gap-0 flex flex-col max-h-[90vh]">
        <DialogHeader className="p-6 border-b pb-4 bg-slate-50/50 space-y-1 shrink-0">
          <DialogTitle>Editar credenciamento</DialogTitle>
          <DialogDescription>
            Ingresso{' '}
            <span className="font-mono font-semibold text-foreground">{ticket?.pedido_id}</span> (
            {ticket?.tipo_ingresso}). As alterações são refletidas na INAC.
          </DialogDescription>
        </DialogHeader>

        <FormProvider {...methods}>
          <form onSubmit={methods.handleSubmit(onSubmit)} className="flex flex-col min-h-0 flex-1">
            <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4">
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

                <div className="flex items-center gap-3 rounded-lg border p-3 bg-slate-50/50">
                  <Checkbox
                    id="sem-empresa-edit"
                    checked={!temEmpresa}
                    onCheckedChange={(c) => handleSemEmpresa(c === true)}
                  />
                  <label
                    htmlFor="sem-empresa-edit"
                    className="text-sm font-medium cursor-pointer select-none"
                  >
                    Não tem empresa
                  </label>
                </div>

                {temEmpresa ? (
                  <>
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
                  </>
                ) : (
                  <>
                    <FormInput
                      name="profissao"
                      label="Sua Profissão"
                      placeholder="Ex: Designer, Advogado, Médico..."
                    />
                    <FormInput
                      name="nicho"
                      label="Segmento da empresa que você trabalha"
                      type="select"
                      options={NICHES}
                      placeholder="Selecione..."
                    />
                  </>
                )}

                <FormField
                  control={methods.control}
                  name="ia_uso_diario"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-base">
                        {temEmpresa
                          ? 'De 1 a 5, quantas pessoas usam IA na sua empresa diariamente?'
                          : 'De 1 a 5, quanto você usa IA diariamente?'}
                      </FormLabel>
                      <LinearScale
                        value={field.value}
                        onChange={field.onChange}
                        leftLabel={temEmpresa ? 'Ninguém' : 'Nunca'}
                        rightLabel={temEmpresa ? 'Todos' : 'O tempo todo'}
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
                        {temEmpresa
                          ? 'Qual a profundidade do uso de IA dessas pessoas?'
                          : 'Qual a sua profundidade de uso de IA?'}
                      </FormLabel>
                      <LinearScale
                        value={field.value}
                        onChange={field.onChange}
                        leftLabel={temEmpresa ? 'Usamos como Google' : 'Uso como Google'}
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
                  label={
                    temEmpresa
                      ? 'Na sua visão, qual o maior desafio para tornar sua empresa Nativa de IA?'
                      : 'Na sua visão, qual o maior desafio que você enfrenta com a IA atualmente?'
                  }
                  placeholder="Sua resposta..."
                />
              </div>
            </div>

            <DialogFooter className="p-4 border-t bg-slate-50/50 shrink-0">
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
                {submitting ? 'Salvando...' : 'Salvar'}
                {!submitting && <CheckCircle2 className="w-4 h-4 ml-2" />}
              </Button>
            </DialogFooter>
          </form>
        </FormProvider>
      </DialogContent>
    </Dialog>
  )
}
