interface LinearScaleProps {
  value?: number
  onChange: (v: number) => void
  leftLabel: string
  rightLabel: string
  error?: boolean
}

// Escala linear horizontal de 1 a 5, com rótulos nas pontas.
export function LinearScale({ value, onChange, leftLabel, rightLabel, error }: LinearScaleProps) {
  return (
    <div className="space-y-2">
      <div
        className={`flex items-stretch gap-2 ${
          error ? 'p-2 border border-red-500 rounded-md bg-red-50/50' : ''
        }`}
      >
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => onChange(n)}
            className={`flex-1 h-12 rounded-lg border text-sm font-semibold transition-colors ${
              value === n
                ? 'bg-primary text-white border-primary'
                : 'bg-white hover:bg-slate-50 border-slate-200 text-foreground'
            }`}
          >
            {n}
          </button>
        ))}
      </div>
      <div className="flex justify-between text-xs text-muted-foreground px-1">
        <span>1 · {leftLabel}</span>
        <span>5 · {rightLabel}</span>
      </div>
    </div>
  )
}
