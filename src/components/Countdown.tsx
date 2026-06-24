import { useState, useEffect } from 'react'
import { Timer } from 'lucide-react'

const TARGET_DATE = new Date('2026-07-31T09:00:00-03:00').getTime()

export function Countdown() {
  const [timeLeft, setTimeLeft] = useState(TARGET_DATE - Date.now())

  useEffect(() => {
    const interval = setInterval(() => {
      setTimeLeft(TARGET_DATE - Date.now())
    }, 1000)
    return () => clearInterval(interval)
  }, [])

  if (timeLeft <= 0) return null

  const days = Math.floor(timeLeft / (1000 * 60 * 60 * 24))
  const hours = Math.floor((timeLeft % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60))
  const minutes = Math.floor((timeLeft % (1000 * 60 * 60)) / (1000 * 60))
  const seconds = Math.floor((timeLeft % (1000 * 60)) / 1000)

  return (
    <div className="flex items-center gap-4 bg-slate-50 px-4 py-3 rounded-xl border border-slate-200 w-full sm:w-fit shadow-sm">
      <div className="flex items-center gap-2 text-primary bg-primary/10 p-2 rounded-lg">
        <Timer className="w-5 h-5" />
        <span className="text-sm font-semibold uppercase tracking-wider hidden sm:inline-block">
          Início em
        </span>
      </div>
      <div className="flex items-center gap-3 font-mono font-bold text-xl md:text-2xl ml-auto sm:ml-0">
        {days > 0 && (
          <>
            <div className="flex flex-col items-center min-w-[3ch]">
              <span>{String(days).padStart(2, '0')}</span>
              <span className="text-[10px] uppercase font-sans text-muted-foreground -mt-1 tracking-widest">
                dias
              </span>
            </div>
            <span className="text-muted-foreground/30 -mt-3">:</span>
          </>
        )}
        <div className="flex flex-col items-center min-w-[2.5ch]">
          <span>{String(hours).padStart(2, '0')}</span>
          <span className="text-[10px] uppercase font-sans text-muted-foreground -mt-1 tracking-widest">
            hrs
          </span>
        </div>
        <span className="text-muted-foreground/30 -mt-3">:</span>
        <div className="flex flex-col items-center min-w-[2.5ch]">
          <span>{String(minutes).padStart(2, '0')}</span>
          <span className="text-[10px] uppercase font-sans text-muted-foreground -mt-1 tracking-widest">
            min
          </span>
        </div>
        <span className="text-muted-foreground/30 -mt-3">:</span>
        <div className="flex flex-col items-center min-w-[2.5ch]">
          <span className="text-primary">{String(seconds).padStart(2, '0')}</span>
          <span className="text-[10px] uppercase font-sans text-primary/70 -mt-1 tracking-widest">
            seg
          </span>
        </div>
      </div>
    </div>
  )
}
