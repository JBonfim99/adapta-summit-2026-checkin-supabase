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
import { FormInput } from '@/components/FormInput'
import { CheckCircle2 } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'
import pb from '@/lib/pocketbase/client'
import { getErrorMessage } from '@/lib/pocketbase/errors'
import { ROLES } from '@/lib/form-options'
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
  })
  .superRefine((data, ctx) => {
    if (data.tem_empresa) {
      if (!data.nome_empresa || data.nome_empresa.trim().length < 2)
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['nome_empresa'],
          message: 'Empresa é obrigatória',
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
      })
    }
  }, [open, ticket])

  const handleSemEmpresa = (checked: boolean) => {
    const semEmpresa = checked === true
    methods.setValue('tem_empresa', !semEmpresa)
    if (semEmpresa) {
      methods.setValue('nome_empresa', '')
      methods.setValue('cargo', '')
      methods.clearErrors(['nome_empresa', 'cargo'])
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
          nome_completo: data.nome_completo,
          email: data.email,
          cpf: data.cpf,
          telefone: data.telefone,
          tem_empresa: isEmpresa,
          nome_empresa: isEmpresa ? data.nome_empresa || '' : '',
          cargo: isEmpresa ? data.cargo || '' : '',
          profissao: isEmpresa ? '' : data.profissao || '',
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
      <DialogContent className="max-w-2xl p-0 overflow-hidden gap-0">
        <DialogHeader className="p-6 border-b pb-4 bg-slate-50/50 space-y-1">
          <DialogTitle>Editar credenciamento</DialogTitle>
          <DialogDescription>
            Ingresso{' '}
            <span className="font-mono font-semibold text-foreground">{ticket?.pedido_id}</span> (
            {ticket?.tipo_ingresso}). As alterações são refletidas na INAC.
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
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FormInput
                      name="nome_empresa"
                      label="Nome da Empresa"
                      placeholder="Sua Empresa Ltda"
                    />
                    <FormInput
                      name="cargo"
                      label="Cargo"
                      type="select"
                      options={ROLES}
                      placeholder="Selecione..."
                    />
                  </div>
                ) : (
                  <FormInput
                    name="profissao"
                    label="Profissão"
                    placeholder="Ex: Designer, Advogado, Médico..."
                  />
                )}
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
