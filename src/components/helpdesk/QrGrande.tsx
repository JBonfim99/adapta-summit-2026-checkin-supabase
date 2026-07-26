import { useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { Button } from '@/components/ui/button'
import { AlertCircle, Download, Loader2 } from 'lucide-react'

// QR Code em tamanho grande para mostrar no balcão (o participante fotografa
// a tela) e botão para salvar/compartilhar a imagem.
// Qualquer falha (desenho do QR ou salvamento) aparece na tela — nunca falha
// em silêncio, porque no balcão o atendente precisa saber o que fazer a seguir.
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
  const [erro, setErro] = useState('')

  useEffect(() => {
    if (!value) {
      setErro('O servidor não devolveu o código da credencial. Chame o suporte.')
      return
    }
    if (!canvasRef.current) return
    setPronto(false)
    setErro('')
    try {
      QRCode.toCanvas(canvasRef.current, value, { width: 300, margin: 1 }, (err) => {
        if (err) {
          setErro(
            `Não foi possível desenhar o QR Code nesta tela (${err.message || 'erro desconhecido'}). Tente fechar e abrir de novo, ou use outro aparelho.`,
          )
          return
        }
        setPronto(true)
      })
    } catch (err: any) {
      setErro(
        `Não foi possível desenhar o QR Code nesta tela (${err?.message || 'erro desconhecido'}). Tente fechar e abrir de novo, ou use outro aparelho.`,
      )
    }
  }, [value])

  const salvar = () => {
    setErro('')
    const canvas = canvasRef.current
    if (!canvas) {
      setErro('A imagem do QR Code ainda não está pronta. Espere um instante e tente de novo.')
      return
    }
    try {
      canvas.toBlob(async (blob) => {
        if (!blob) {
          setErro(
            'Este navegador não conseguiu gerar a imagem do QR Code. Peça para a pessoa fotografar a tela.',
          )
          return
        }
        const nomeArquivo = `${arquivo || 'credencial'}.png`
        const file = new File([blob], nomeArquivo, { type: 'image/png' })
        const nav = navigator as any
        try {
          if (nav.canShare && nav.canShare({ files: [file] })) {
            await nav.share({ files: [file], title: 'Credencial — Adapta Summit 2026' })
            return
          }
        } catch (err: any) {
          // Cancelar o compartilhamento não é erro: cai no download abaixo.
          if (err?.name !== 'AbortError') {
            setErro(
              `O compartilhamento falhou (${err?.message || 'erro desconhecido'}). Vamos baixar a imagem no lugar.`,
            )
          }
        }
        try {
          const url = URL.createObjectURL(blob)
          const a = document.createElement('a')
          a.href = url
          a.download = nomeArquivo
          document.body.appendChild(a)
          a.click()
          a.remove()
          URL.revokeObjectURL(url)
        } catch (err: any) {
          setErro(
            `Não foi possível salvar a imagem (${err?.message || 'erro desconhecido'}). Peça para a pessoa fotografar a tela.`,
          )
        }
      }, 'image/png')
    } catch (err: any) {
      setErro(
        `Não foi possível salvar a imagem (${err?.message || 'erro desconhecido'}). Peça para a pessoa fotografar a tela.`,
      )
    }
  }

  return (
    <div className="flex flex-col items-center gap-4">
      {value && (
        <div className="bg-white p-5 rounded-2xl border-2 border-slate-200 shadow-sm relative">
          <canvas ref={canvasRef} className="block" />
          {!pronto && !erro && (
            <div className="absolute inset-0 flex items-center justify-center bg-white/80 rounded-2xl">
              <Loader2 className="w-8 h-8 animate-spin text-slate-400" />
            </div>
          )}
        </div>
      )}

      {erro && (
        <div className="flex items-start gap-3 rounded-xl border-2 border-rose-200 bg-rose-50 p-4 text-base text-rose-800 w-full">
          <AlertCircle className="w-6 h-6 shrink-0 mt-0.5" />
          <span>{erro}</span>
        </div>
      )}

      {nome && <p className="text-lg font-semibold text-center text-slate-800">{nome}</p>}

      {value && (
        <>
          <p className="text-base text-center text-slate-600 max-w-xs">
            Peça para a pessoa fotografar a tela ou salve a imagem e envie para ela.
          </p>
          <Button
            onClick={salvar}
            disabled={!pronto}
            size="lg"
            className="w-full h-14 text-base gap-2"
          >
            <Download className="w-5 h-5" /> Salvar imagem do QR Code
          </Button>
        </>
      )}
    </div>
  )
}
