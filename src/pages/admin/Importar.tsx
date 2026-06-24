import { useState } from 'react'
import { UploadCloud, FileType, CheckCircle2 } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { useToast } from '@/hooks/use-toast'
import pb from '@/lib/pocketbase/client'

export default function AdminImport() {
  const [isDragging, setIsDragging] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [progress, setProgress] = useState(0)
  const { toast } = useToast()

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setIsUploading(true)
    setProgress(20)

    try {
      const text = await file.text()
      setProgress(50)

      const lines = text
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
      const headers = lines[0].toLowerCase().split(',')

      const emailIdx = headers.findIndex((h) => h.includes('email'))
      const pedidoIdx = headers.findIndex((h) => h.includes('pedido') || h.includes('id'))
      const nomeIdx = headers.findIndex((h) => h.includes('nome'))
      const tipoIdx = headers.findIndex((h) => h.includes('tipo'))

      if (emailIdx === -1 || pedidoIdx === -1) {
        throw new Error('Colunas obrigatórias não encontradas no CSV (email, pedido).')
      }

      const rows = lines
        .slice(1)
        .map((l) => {
          const cols = l.split(',')
          return {
            email_comprador: cols[emailIdx],
            pedido_id: cols[pedidoIdx],
            nome_comprador: nomeIdx !== -1 ? cols[nomeIdx] : '',
            tipo_ingresso: tipoIdx !== -1 ? cols[tipoIdx] : 'Standard',
          }
        })
        .filter((r) => r.email_comprador && r.pedido_id)

      setProgress(80)

      const res = await pb.send('/backend/v1/admin/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows }),
      })

      setProgress(100)
      setTimeout(() => {
        setIsUploading(false)
        setProgress(0)
        toast({
          title: 'Importação concluída',
          description: `${res.imported} novos ingressos importados com sucesso.`,
        })
      }, 500)
    } catch (err: any) {
      setIsUploading(false)
      toast({ title: 'Erro na Importação', description: err.message, variant: 'destructive' })
    }
    e.target.value = '' // reset input
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6 animate-fade-in-up">
      <div>
        <h2 className="text-2xl font-bold">Importar Ingressos</h2>
        <p className="text-muted-foreground">
          Faça o upload do arquivo CSV ou Excel da plataforma de vendas.
        </p>
      </div>

      <Card className="border-dashed border-2 bg-slate-50/50">
        <CardContent className="flex flex-col items-center justify-center p-12 text-center">
          {isUploading ? (
            <div className="w-full max-w-md space-y-4 animate-fade-in">
              <FileType className="h-12 w-12 text-primary mx-auto mb-4 animate-pulse" />
              <div className="space-y-2">
                <div className="flex justify-between text-sm text-muted-foreground">
                  <span>Processando arquivo...</span>
                  <span>{progress}%</span>
                </div>
                <Progress value={progress} className="h-2" />
              </div>
            </div>
          ) : (
            <div
              className={`space-y-4 p-8 w-full rounded-xl transition-colors relative ${isDragging ? 'bg-primary/5 border-primary' : ''}`}
              onDragOver={(e) => {
                e.preventDefault()
                setIsDragging(true)
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={(e) => {
                e.preventDefault()
                setIsDragging(false) /* handle drop logic here if needed */
              }}
            >
              <input
                type="file"
                accept=".csv"
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                onChange={handleFileUpload}
              />
              <div className="bg-white p-4 rounded-full shadow-sm inline-block mb-2 pointer-events-none">
                <UploadCloud className="h-10 w-10 text-accent" />
              </div>
              <h3 className="text-lg font-semibold pointer-events-none">
                Selecione ou Arraste seu CSV
              </h3>
              <p className="text-sm text-muted-foreground mb-6 pointer-events-none">
                Suporta .csv até 10MB
              </p>
              <Button type="button" className="bg-primary hover:bg-primary/90 pointer-events-none">
                Procurar Arquivo
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Instruções de Mapeamento</CardTitle>
          <CardDescription>
            A primeira linha do arquivo deve ser o cabeçalho. As colunas essenciais são
            identificadas por partes do nome:
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="grid grid-cols-2 gap-4 text-sm text-slate-700">
            <li className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-500" /> "pedido" ou "id" (Obrigatório)
            </li>
            <li className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-500" /> "email" (Obrigatório)
            </li>
            <li className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-slate-300" /> "nome" (Opcional)
            </li>
            <li className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-slate-300" /> "tipo" (Opcional, Padrão:
              Standard)
            </li>
          </ul>
        </CardContent>
      </Card>
    </div>
  )
}
