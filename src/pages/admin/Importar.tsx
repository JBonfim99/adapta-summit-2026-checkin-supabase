import { useState } from 'react'
import { UploadCloud, FileType, CheckCircle2 } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { useToast } from '@/hooks/use-toast'

export default function AdminImport() {
  const [isDragging, setIsDragging] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [progress, setProgress] = useState(0)
  const { toast } = useToast()

  const handleSimulateUpload = () => {
    setIsUploading(true)
    setProgress(0)
    const interval = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 100) {
          clearInterval(interval)
          setTimeout(() => {
            setIsUploading(false)
            setProgress(0)
            toast({
              title: 'Importação concluída',
              description: '50 ingressos foram importados com sucesso.',
            })
          }, 500)
          return 100
        }
        return prev + 10
      })
    }, 200)
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
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
              className={`space-y-4 p-8 w-full rounded-xl transition-colors ${isDragging ? 'bg-primary/5 border-primary' : ''}`}
              onDragOver={(e) => {
                e.preventDefault()
                setIsDragging(true)
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={(e) => {
                e.preventDefault()
                setIsDragging(false)
                handleSimulateUpload()
              }}
            >
              <div className="bg-white p-4 rounded-full shadow-sm inline-block mb-2">
                <UploadCloud className="h-10 w-10 text-accent" />
              </div>
              <h3 className="text-lg font-semibold">Arraste seu arquivo aqui</h3>
              <p className="text-sm text-muted-foreground mb-6">
                Suporta .csv, .xls, .xlsx até 10MB
              </p>
              <Button onClick={handleSimulateUpload} className="bg-primary hover:bg-primary/90">
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
            O arquivo deve conter obrigatoriamente as seguintes colunas:
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="grid grid-cols-2 gap-4 text-sm">
            <li className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-500" /> ID do Pedido
            </li>
            <li className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-500" /> E-mail do Comprador
            </li>
            <li className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-500" /> Tipo de Ingresso
            </li>
            <li className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-500" /> Status do Pagamento
            </li>
          </ul>
        </CardContent>
      </Card>
    </div>
  )
}
