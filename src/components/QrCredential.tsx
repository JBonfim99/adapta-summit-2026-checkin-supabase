import { useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { Button } from '@/components/ui/button'
import { Share2, Mail } from 'lucide-react'

// Renderiza o QR Code do credenciamento (valor = hash retornado pela INAC) num
// canvas, com botão "Salvar QR Code" que abre o compartilhamento nativo do
// celular (navigator.share) e, onde não houver suporte, baixa o PNG.
export default function QrCredential({ value }: { value: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (!value || !canvasRef.current) return
    setReady(false)
    QRCode.toCanvas(
      canvasRef.current,
      value,
      { width: 240, margin: 1, errorCorrectionLevel: 'M' },
      (err) => {
        if (!err) setReady(true)
      },
    )
  }, [value])

  const handleSave = () => {
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.toBlob(async (blob) => {
      if (!blob) return
      const file = new File([blob], 'qrcode-adapta-summit-2026.png', { type: 'image/png' })
      const nav = navigator as any
      try {
        if (nav.canShare && nav.canShare({ files: [file] })) {
          await nav.share({
            files: [file],
            title: 'Meu QR Code — Adapta Summit 2026',
            text: 'Minha credencial do Adapta Summit 2026.',
          })
          return
        }
      } catch (_) {
        // Usuário cancelou ou o share falhou → cai para o download.
      }
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'qrcode-adapta-summit-2026.png'
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    }, 'image/png')
  }

  if (!value) return null

  return (
    <div className="flex flex-col items-center gap-4">
      <div className="bg-white p-4 rounded-2xl border shadow-sm">
        <canvas ref={canvasRef} className="block" />
      </div>
      <Button
        onClick={handleSave}
        disabled={!ready}
        className="bg-primary hover:bg-primary/90 gap-2 w-full sm:w-auto px-8"
      >
        <Share2 className="w-4 h-4" /> Salvar QR Code
      </Button>
      <div className="flex items-start gap-2 text-sm text-muted-foreground bg-slate-50 rounded-lg p-3 border border-slate-100 max-w-sm">
        <Mail className="w-4 h-4 mt-0.5 shrink-0 text-accent" />
        <span>
          Você também receberá este QR Code por e-mail. Apresente-o na entrada do evento — vale como
          sua credencial.
        </span>
      </div>
    </div>
  )
}
