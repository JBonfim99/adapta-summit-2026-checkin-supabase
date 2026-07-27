import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select'
import { Plus, Trash2 } from 'lucide-react'
import pb from '@/lib/pocketbase/client'

// Valor do fluxo padrão (check-in via catch webhook).
export const PRE = 'PRE'

export interface BcFlow {
  id: number | string
  name: string
}
export interface BcField {
  id: number | string
  key: string
  type: number
}
export interface MapRow {
  field_id: string
  source: string
  value: string
}

// Origens disponíveis pra alimentar as variáveis (custom fields) do fluxo.
export const SOURCES: { v: string; l: string }[] = [
  { v: 'primeiro_nome', l: 'Primeiro nome' },
  { v: 'nome', l: 'Nome completo' },
  { v: 'email', l: 'E-mail' },
  { v: 'telefone', l: 'Telefone' },
  { v: 'documento', l: 'CPF / Documento' },
  { v: 'pedido_id', l: 'Número do pedido' },
  { v: 'link_acesso', l: 'Link de acesso (60d)' },
  { v: 'token', l: 'Token de acesso' },
  { v: 'static', l: 'Valor fixo' },
]

// Carrega fluxos + custom fields do BotConversa (via backend).
export function useFlowsAndFields() {
  const [flows, setFlows] = useState<BcFlow[]>([])
  const [flowsErr, setFlowsErr] = useState('')
  const [fields, setFields] = useState<BcField[]>([])

  const load = useCallback(() => {
    pb.send('/backend/v1/admin/whatsapp/flows', {})
      .then((res) => {
        if (res.ok) {
          setFlows(res.flows || [])
          setFlowsErr('')
        } else {
          setFlows([])
          setFlowsErr(res.error || 'Não foi possível carregar os fluxos')
        }
      })
      .catch((e) => setFlowsErr(e?.message || 'Falha ao carregar fluxos'))
    pb.send('/backend/v1/admin/whatsapp/custom-fields', {})
      .then((res) => setFields(res.ok ? res.fields || [] : []))
      .catch(() => setFields([]))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  return { flows, flowsErr, fields }
}

// Dropdown de fluxo (padrão = check-in).
export function FlowSelect({
  flow,
  onChange,
  flows,
  flowsErr,
}: {
  flow: string
  onChange: (v: string) => void
  flows: BcFlow[]
  flowsErr: string
}) {
  const isPre = flow === PRE
  return (
    <div className="space-y-2 max-w-md">
      <label className="text-sm font-medium">Fluxo</label>
      <Select value={flow} onValueChange={onChange}>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={PRE}>Check-in (padrão)</SelectItem>
          {flows.map((f) => (
            <SelectItem key={String(f.id)} value={String(f.id)}>
              {f.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {flowsErr && <p className="text-xs text-amber-600">Fluxos indisponíveis: {flowsErr}</p>}
      <p className="text-xs text-muted-foreground">
        {isPre
          ? 'Envia o link de acesso (token de 60 dias) pela automação padrão.'
          : 'Cria/atualiza o contato no BotConversa e dispara este fluxo.'}
      </p>
    </div>
  )
}

// Editor de mapeamento de variáveis (custom field ← origem).
export function MappingEditor({
  mapping,
  setMapping,
  fields,
}: {
  mapping: MapRow[]
  setMapping: (updater: (m: MapRow[]) => MapRow[]) => void
  fields: BcField[]
}) {
  const addRow = () => setMapping((m) => [...m, { field_id: '', source: '', value: '' }])
  const removeRow = (i: number) => setMapping((m) => m.filter((_, idx) => idx !== i))
  const updateRow = (i: number, patch: Partial<MapRow>) =>
    setMapping((m) => m.map((row, idx) => (idx === i ? { ...row, ...patch } : row)))

  // Variáveis já escolhidas em outras linhas (pra não permitir repetir).
  const usedIds = mapping.map((r) => r.field_id).filter(Boolean)
  const allUsed = fields.length > 0 && mapping.length >= fields.length

  return (
    <div className="space-y-3 rounded-lg border bg-slate-50/60 p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium">Mapeamento de variáveis</p>
          <p className="text-xs text-muted-foreground">
            Preencha as variáveis (custom fields) que esse fluxo usa. Se não usar nenhuma, pode
            disparar sem mapear.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-1 shrink-0"
          onClick={addRow}
          disabled={allUsed}
        >
          <Plus className="w-3 h-3" /> Variável
        </Button>
      </div>

      {mapping.length > 0 && (
        <div className="space-y-2">
          {mapping.map((row, i) => (
            <div key={i} className="flex items-center gap-2">
              <Select value={row.field_id} onValueChange={(v) => updateRow(i, { field_id: v })}>
                <SelectTrigger className="flex-1">
                  <SelectValue placeholder="Variável" />
                </SelectTrigger>
                <SelectContent>
                  {fields.length === 0 ? (
                    <SelectItem value="__none" disabled>
                      Nenhum custom field
                    </SelectItem>
                  ) : (
                    fields
                      .filter(
                        (f) => String(f.id) === row.field_id || !usedIds.includes(String(f.id)),
                      )
                      .map((f) => (
                        <SelectItem key={String(f.id)} value={String(f.id)}>
                          {f.key}
                        </SelectItem>
                      ))
                  )}
                </SelectContent>
              </Select>
              <span className="text-muted-foreground text-xs shrink-0">←</span>
              <Select value={row.source} onValueChange={(v) => updateRow(i, { source: v })}>
                <SelectTrigger className="flex-1">
                  <SelectValue placeholder="Origem" />
                </SelectTrigger>
                <SelectContent>
                  {SOURCES.map((s) => (
                    <SelectItem key={s.v} value={s.v}>
                      {s.l}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {row.source === 'static' && (
                <Input
                  className="flex-1"
                  placeholder="Valor fixo"
                  value={row.value}
                  onChange={(e) => updateRow(i, { value: e.target.value })}
                />
              )}
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="shrink-0 text-muted-foreground hover:text-rose-600"
                onClick={() => removeRow(i)}
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
