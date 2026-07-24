import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Copy, Check, Download, KeyRound, Globe } from 'lucide-react'

const API_KEY = 'summit26_bi2cq40ggp9vyr62pxefccnn58elnfpe51v3vpp5'
const BASE_URL = 'https://adapta-summit-2026-d2d58.shrd00.internal.goskip.dev'

const METHOD_COLOR: Record<string, string> = {
  GET: 'bg-blue-100 text-blue-700 border-blue-200',
  POST: 'bg-emerald-100 text-emerald-700 border-emerald-200',
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-7 gap-1 shrink-0"
      onClick={() => {
        navigator.clipboard.writeText(text)
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      }}
    >
      {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
      {copied ? 'Copiado' : 'Copiar'}
    </Button>
  )
}

function CodeBlock({ children }: { children: string }) {
  return (
    <pre className="bg-slate-900 text-slate-100 text-xs rounded-lg p-3 overflow-x-auto whitespace-pre">
      {children}
    </pre>
  )
}

const ENDPOINTS = [
  {
    metodo: 'GET',
    caminho: '/backend/v1/external/compradores',
    descricao:
      'Busca comprador(es) e seus ingressos, com flag de disponibilidade (Pendente = disponível pra credenciar).',
    params: [
      ['email', 'opcional — busca exata'],
      ['cpf', 'opcional — busca exata (só dígitos)'],
      ['nome', 'opcional — busca parcial'],
      ['page', 'opcional, padrão 1'],
      ['perPage', 'opcional, padrão 20, máx 100'],
    ],
    exemplo: `curl "${BASE_URL}/backend/v1/external/compradores?email=fulano@empresa.com" \\
  -H "X-Api-Key: ${API_KEY}"`,
    resposta: `{
  "page": 1, "per_page": 20, "count": 1,
  "compradores": [{
    "id": "abc123def456xyz", "nome": "Fulano da Silva",
    "email": "fulano@empresa.com", "documento": "12345678900",
    "uf": "SP", "cidade": "São Paulo", "telefone": "11999998888",
    "ingressos": [{
      "id": "ing123", "pedido_id": "482910", "tipo_ingresso": "GOLD",
      "status": "Pendente", "disponivel": true,
      "participante_id": null, "inac_id": null
    }],
    "ingressos_disponiveis": 1
  }]
}`,
  },
  {
    metodo: 'GET',
    caminho: '/backend/v1/external/participantes',
    descricao: 'Busca participantes já credenciados (formulário preenchido).',
    params: [
      ['email', 'opcional'],
      ['cpf', 'opcional — busca parcial'],
      ['nome', 'opcional — busca parcial'],
      ['page', 'opcional, padrão 1'],
      ['perPage', 'opcional, padrão 20, máx 100'],
    ],
    exemplo: `curl "${BASE_URL}/backend/v1/external/participantes?email=fulano@empresa.com" \\
  -H "X-Api-Key: ${API_KEY}"`,
    resposta: `{
  "page": 1, "per_page": 20, "count": 1,
  "participantes": [{
    "id": "part123", "nome_completo": "Fulano da Silva",
    "email": "fulano@empresa.com", "cpf": "123.456.789-00",
    "telefone": "11999998888", "tem_empresa": true,
    "nome_empresa": "Empresa X", "cargo": "Diretor", "profissao": "",
    "preenchido_em": "2026-07-20 14:00:00.000Z",
    "ingresso": {
      "id": "ing123", "pedido_id": "482910", "tipo_ingresso": "GOLD",
      "status": "Pré-Credenciado", "comprador_id": "abc123def456xyz"
    }
  }]
}`,
  },
  {
    metodo: 'POST',
    caminho: '/backend/v1/external/compradores',
    descricao:
      'Cria (ou atualiza, se o e-mail já existir) um comprador com N ingressos GOLD/PLATINUM. Dispara automaticamente o e-mail de acesso (template SendGrid "Skip-Summit26-Send-Comprador").',
    params: [
      ['nome', 'string, opcional'],
      ['email', 'string, obrigatório'],
      ['documento', 'string (CPF/CNPJ), opcional'],
      ['uf / cidade / telefone', 'string, opcional'],
      ['qtd_gold', 'number, opcional (padrão 0)'],
      ['qtd_platinum', 'number, opcional (padrão 0) — soma tem que ser >= 1'],
    ],
    exemplo: `curl -X POST "${BASE_URL}/backend/v1/external/compradores" \\
  -H "X-Api-Key: ${API_KEY}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "nome": "Fulano da Silva",
    "email": "fulano@empresa.com",
    "documento": "12345678900",
    "qtd_gold": 1,
    "qtd_platinum": 0
  }'`,
    resposta: `{
  "success": true,
  "comprador_id": "abc123def456xyz",
  "ingressos": [{ "id": "ing123", "pedido_id": "482910", "tipo_ingresso": "GOLD" }],
  "email": { "enviado": true, "erro": "" }
}`,
  },
  {
    metodo: 'POST',
    caminho: '/backend/v1/external/credenciamento',
    descricao:
      'Credencia um ingresso Pendente: cria o participante no nosso sistema E registra na INAC (retorna o QR code). Precisa de pedido_id OU ingresso_id.',
    params: [
      ['pedido_id / ingresso_id', 'um dos dois, obrigatório'],
      ['nome_completo', 'string, obrigatório'],
      ['email', 'string, obrigatório — único entre participantes'],
      ['cpf', 'string, obrigatório — 11 dígitos, não pode já estar credenciado'],
      ['telefone', 'string'],
      ['tem_empresa', 'boolean'],
      ['nome_empresa / cargo', 'string — se tem_empresa=true'],
      ['profissao', 'string — se tem_empresa=false'],
      ['nicho / num_funcionarios / faturamento_anual', 'string'],
      ['ia_uso_diario / ia_profundidade', 'number (escala do formulário)'],
      ['ia_ferramentas / ia_desafio', 'string'],
    ],
    exemplo: `curl -X POST "${BASE_URL}/backend/v1/external/credenciamento" \\
  -H "X-Api-Key: ${API_KEY}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "pedido_id": "482910",
    "nome_completo": "Fulano da Silva",
    "email": "fulano@empresa.com",
    "cpf": "12345678900",
    "telefone": "11999998888",
    "tem_empresa": false,
    "profissao": "Engenheiro"
  }'`,
    resposta: `{
  "success": true,
  "ingresso_id": "ing123",
  "inac": { "credenciado": true, "qrcode": "6a3e7e67bcc45", "erro": "" }
}`,
  },
  {
    metodo: 'POST',
    caminho: '/backend/v1/external/reenviar-comprador',
    descricao:
      'Redispara o e-mail de acesso pra um comprador já existente — template "Skip-Summit26-Send-Comprador-Email02" (segundo lembrete). Gera um novo token de acesso (60 dias).',
    params: [['comprador_id / email', 'um dos dois, obrigatório']],
    exemplo: `curl -X POST "${BASE_URL}/backend/v1/external/reenviar-comprador" \\
  -H "X-Api-Key: ${API_KEY}" \\
  -H "Content-Type: application/json" \\
  -d '{ "email": "fulano@empresa.com" }'`,
    resposta: `{
  "success": true,
  "comprador_id": "abc123def456xyz",
  "email": "fulano@empresa.com",
  "template": "Skip-Summit26-Send-Comprador-Email02",
  "erro": ""
}`,
  },
  {
    metodo: 'POST',
    caminho: '/backend/v1/external/reenviar-participante',
    descricao:
      'Redispara o e-mail de credenciamento (com o QR code) pra um participante já credenciado — template "Skip-Summit26-Send-Participante". Reaproveita o token do ingresso se ainda for válido.',
    params: [['participante_id / email', 'um dos dois, obrigatório']],
    exemplo: `curl -X POST "${BASE_URL}/backend/v1/external/reenviar-participante" \\
  -H "X-Api-Key: ${API_KEY}" \\
  -H "Content-Type: application/json" \\
  -d '{ "email": "fulano@empresa.com" }'`,
    resposta: `{
  "success": true,
  "participante_id": "part123",
  "email": "fulano@empresa.com",
  "template": "Skip-Summit26-Send-Participante",
  "erro": ""
}`,
  },
]

export default function AdminApi() {
  const baixarJson = () => {
    fetch('/external-api.json')
      .then((r) => r.text())
      .then((txt) => {
        const blob = new Blob([txt], { type: 'application/json' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = 'adapta-summit-2026-external-api.json'
        a.click()
        URL.revokeObjectURL(url)
      })
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6 animate-fade-in-up pb-12">
      <div>
        <h2 className="text-2xl font-bold">API Externa</h2>
        <p className="text-muted-foreground">
          API HTTP pra uso interno — buscar compradores/ingressos, buscar participantes, criar
          comprador com ingressos (dispara e-mail automático) e credenciar (sistema + INAC).
        </p>
      </div>

      <Card className="border-none shadow-sm">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <KeyRound className="w-5 h-5 text-primary" /> Autenticação
          </CardTitle>
          <CardDescription>
            Toda chamada precisa do header <code className="text-xs">X-Api-Key</code>. Chave fixa,
            uso interno — não é rotacionada automaticamente.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-2 bg-slate-50 border rounded-lg px-3 py-2">
            <code className="text-sm flex-1 truncate">{API_KEY}</code>
            <CopyButton text={API_KEY} />
          </div>
          <div className="flex items-start gap-2 text-sm text-muted-foreground">
            <Globe className="w-4 h-4 mt-0.5 shrink-0" />
            <div>
              <span className="font-medium text-foreground">Base URL: </span>
              <code className="text-xs">{BASE_URL}</code>
            </div>
          </div>
          <Button variant="outline" size="sm" className="gap-2" onClick={baixarJson}>
            <Download className="w-4 h-4" /> Baixar especificação (.json)
          </Button>
        </CardContent>
      </Card>

      <div className="space-y-4">
        {ENDPOINTS.map((ep) => (
          <Card key={ep.metodo + ep.caminho} className="border shadow-sm">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge className={METHOD_COLOR[ep.metodo]}>{ep.metodo}</Badge>
                <code className="text-sm font-medium">{ep.caminho}</code>
              </div>
              <CardDescription>{ep.descricao}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <p className="text-xs font-semibold text-muted-foreground mb-2 uppercase">
                  {ep.metodo === 'GET' ? 'Query params' : 'Body (JSON)'}
                </p>
                <div className="rounded-lg border divide-y">
                  {ep.params.map(([nome, desc]) => (
                    <div key={nome} className="flex items-start gap-3 px-3 py-2 text-sm">
                      <code className="text-xs bg-slate-100 rounded px-1.5 py-0.5 shrink-0">
                        {nome}
                      </code>
                      <span className="text-muted-foreground">{desc}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-xs font-semibold text-muted-foreground mb-2 uppercase">
                  Exemplo
                </p>
                <CodeBlock>{ep.exemplo}</CodeBlock>
              </div>
              <div>
                <p className="text-xs font-semibold text-muted-foreground mb-2 uppercase">
                  Resposta
                </p>
                <CodeBlock>{ep.resposta}</CodeBlock>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="border-none shadow-sm bg-slate-50">
        <CardHeader>
          <CardTitle className="text-base">Erros comuns</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="rounded-lg border bg-white divide-y">
            <div className="flex items-start gap-3 px-3 py-2 text-sm">
              <code className="text-xs bg-rose-100 text-rose-700 rounded px-1.5 py-0.5 shrink-0">
                401
              </code>
              <span className="text-muted-foreground">Header X-Api-Key ausente ou incorreto</span>
            </div>
            <div className="flex items-start gap-3 px-3 py-2 text-sm">
              <code className="text-xs bg-amber-100 text-amber-700 rounded px-1.5 py-0.5 shrink-0">
                400
              </code>
              <span className="text-muted-foreground">
                Payload inválido ou regra de negócio (e-mail/CPF duplicado, ingresso já credenciado,
                etc.)
              </span>
            </div>
            <div className="flex items-start gap-3 px-3 py-2 text-sm">
              <code className="text-xs bg-slate-200 text-slate-700 rounded px-1.5 py-0.5 shrink-0">
                404
              </code>
              <span className="text-muted-foreground">
                Ingresso não encontrado (endpoint de credenciamento)
              </span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
