import { useState, useEffect } from 'react'

export function Countdown({ targetDate = '2026-07-31T09:00:00-03:00' }: { targetDate?: string }) {
  const [timeLeft, setTimeLeft] = useState({
    days: 0,
    hours: 0,
    minutes: 0,
    seconds: 0,
  })

  useEffect(() => {
    const calculateTimeLeft = () => {
      const difference = +new Date(targetDate) - +new Date()
      let timeLeft = { days: 0, hours: 0, minutes: 0, seconds: 0 }

      if (difference > 0) {
        timeLeft = {
          days: Math.floor(difference / (1000 * 60 * 60 * 24)),
          hours: Math.floor((difference / (1000 * 60 * 60)) % 24),
          minutes: Math.floor((difference / 1000 / 60) % 60),
          seconds: Math.floor((difference / 1000) % 60),
        }
      }

      return timeLeft
    }

    setTimeLeft(calculateTimeLeft())
    const timer = setInterval(() => {
      setTimeLeft(calculateTimeLeft())
    }, 1000)

    return () => clearInterval(timer)
  }, [targetDate])

  return (
    <div className="flex gap-4 text-center">
      <div className="flex flex-col items-center p-3 bg-muted/30 rounded-lg min-w-[80px] border">
        <span className="text-2xl font-bold">{timeLeft.days}</span>
        <span className="text-xs text-muted-foreground uppercase tracking-wider mt-1">Dias</span>
      </div>
      <div className="flex flex-col items-center p-3 bg-muted/30 rounded-lg min-w-[80px] border">
        <span className="text-2xl font-bold">{timeLeft.hours}</span>
        <span className="text-xs text-muted-foreground uppercase tracking-wider mt-1">Horas</span>
      </div>
      <div className="flex flex-col items-center p-3 bg-muted/30 rounded-lg min-w-[80px] border">
        <span className="text-2xl font-bold">{timeLeft.minutes}</span>
        <span className="text-xs text-muted-foreground uppercase tracking-wider mt-1">Min</span>
      </div>
      <div className="flex flex-col items-center p-3 bg-muted/30 rounded-lg min-w-[80px] border">
        <span className="text-2xl font-bold">{timeLeft.seconds}</span>
        <span className="text-xs text-muted-foreground uppercase tracking-wider mt-1">Seg</span>
      </div>
    </div>
  )
}
