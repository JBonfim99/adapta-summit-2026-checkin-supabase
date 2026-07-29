const MAPS =
  'https://www.google.com/maps/search/?api=1&query=Transamerica+Expo+Center%2C+Av.+Dr.+M%C3%A1rio+Vilas+Boas+Rodrigues%2C+387+-+Santo+Amaro%2C+S%C3%A3o+Paulo+-+SP%2C+04757-020'

export default function EventoDataLocal({ className = '' }: { className?: string }) {
  return (
    <div className={`text-center space-y-1 ${className}`}>
      <p className="text-sm font-medium text-slate-700">
        31 de julho e 1º de agosto · Transamerica Expo Center
      </p>
      <a
        href={MAPS}
        target="_blank"
        rel="noreferrer"
        className="inline-block text-sm text-muted-foreground hover:text-primary underline-offset-4 hover:underline"
      >
        Av. Dr. Mário Vilas Boas Rodrigues, 387 — Santo Amaro, São Paulo/SP
      </a>
    </div>
  )
}
