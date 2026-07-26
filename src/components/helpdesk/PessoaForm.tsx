import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { mascaraCpf, mascaraTelefone, type HDPessoaForm } from '@/lib/helpdesk'

// Formulário de pessoa usado no credenciamento e na alteração de dados.
// Campos grandes, rótulos em linguagem simples, um por linha.
export default function PessoaForm({
  valor,
  onChange,
  disabled,
}: {
  valor: HDPessoaForm
  onChange: (v: HDPessoaForm) => void
  disabled?: boolean
}) {
  const set = (campo: keyof HDPessoaForm, v: string) => onChange({ ...valor, [campo]: v })

  const campo = 'h-14 text-lg'
  const rotulo = 'text-base font-semibold text-slate-800'

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="hd-nome" className={rotulo}>
          Nome completo
        </Label>
        <Input
          id="hd-nome"
          className={campo}
          value={valor.nome_completo}
          disabled={disabled}
          autoComplete="off"
          placeholder="Ex.: Maria Silva Santos"
          onChange={(e) => set('nome_completo', e.target.value)}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="hd-email" className={rotulo}>
          E-mail
        </Label>
        <Input
          id="hd-email"
          type="email"
          inputMode="email"
          className={campo}
          value={valor.email}
          disabled={disabled}
          autoComplete="off"
          placeholder="maria@email.com"
          onChange={(e) => set('email', e.target.value)}
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="hd-cpf" className={rotulo}>
            CPF
          </Label>
          <Input
            id="hd-cpf"
            inputMode="numeric"
            className={campo}
            value={valor.cpf}
            disabled={disabled}
            placeholder="000.000.000-00"
            onChange={(e) => set('cpf', mascaraCpf(e.target.value))}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="hd-tel" className={rotulo}>
            Telefone (com DDD)
          </Label>
          <Input
            id="hd-tel"
            inputMode="numeric"
            className={campo}
            value={valor.telefone}
            disabled={disabled}
            placeholder="(11) 90000-0000"
            onChange={(e) => set('telefone', mascaraTelefone(e.target.value))}
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="hd-empresa" className={rotulo}>
          Empresa ou profissão{' '}
          <span className="font-normal text-slate-500">(opcional — sai no crachá)</span>
        </Label>
        <Input
          id="hd-empresa"
          className={campo}
          value={valor.empresa}
          disabled={disabled}
          autoComplete="off"
          placeholder="Ex.: Adapta ou Advogada"
          onChange={(e) => set('empresa', e.target.value)}
        />
      </div>
    </div>
  )
}
