import { useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { Button } from '@/components/ui/button'
import { Download } from 'lucide-react'

// QR Code em tamanho grande para mostrar no balcão (o participante fotografa
// a tela) e botão para salvar/compartilhar a imagem.
export default function QrGrande({
  value,
  nome,
  arquivo,
}: {
  value: string
  nome?: string
  arquivo?: string
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [pronto, setPronto] = useState(false)

  useEffect(() => {
    if (!value || !canvasRef.current) return
    setPronto(false)
    QRCode.toCanvas(canvasRef.current, value, { width: 300, margin: 1 }, (err) => {
      if (!err) setPronto(true)
    })
  }, [value])

  const salvar = () => {
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.toBlob(async (blob) => {
      if (!blob) return
      const nomeArquivo = `${arquivo || 'credencial'}.png`
      const file = new File([blob], nomeArquivo, { type: 'image/png' })
      const nav = navigator as any
      try {
        if (nav.canShare && nav.canShare({ files: [file] })) {
          await nav.share({ files: [file], title: 'Credencial — Adapta Summit 2026' })
          return
        }
      } catch {
        // cancelou o compartilhamento -> cai no download
      }
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = nomeArquivo
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    }, 'image/png')
  }

  if (!value) return null

  return (
    <div className="flex flex-col items-center gap-4">
      <div className="bg-white p-5 rounded-2xl border-2 border-slate-200 shadow-sm">
        <canvas ref={canvasRef} className="block" />
      </div>
      {nome && <p className="text-lg font-semibold text-center text-slate-800">{nome}</p>}
      <p className="text-base text-center text-slate-600 max-w-xs">
        Peça para a pessoa fotografar a tela ou salve a imagem e envie para ela.
      </p>
      <Button onClick={salvar} disabled={!pronto} size="lg" className="w-full h-14 text-base gap-2">
        <Download className="w-5 h-5" /> Salvar imagem do QR Code
      </Button>
    </div>
  )
}
