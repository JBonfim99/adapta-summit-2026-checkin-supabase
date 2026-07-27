// Tipos de ingresso do evento e a cor de cada um. Ponto único: para criar um
// tipo novo, some aqui e nos mapas de categoria da INAC nos hooks.
export const TIPOS_INGRESSO = ['GOLD', 'PLATINUM', 'PALESTRANTES', 'HACKATHON'] as const

export type TipoIngresso = (typeof TIPOS_INGRESSO)[number]

// Badge padrão do admin (fundo claro).
export const CLASSE_TIPO: Record<string, string> = {
  GOLD: 'bg-amber-100 text-amber-800 hover:bg-amber-100 border-amber-200',
  PLATINUM: 'bg-indigo-100 text-indigo-800 hover:bg-indigo-100 border-indigo-200',
  PALESTRANTES: 'bg-rose-100 text-rose-800 hover:bg-rose-100 border-rose-200',
  HACKATHON: 'bg-teal-100 text-teal-800 hover:bg-teal-100 border-teal-200',
}

// Badge do balcão (/helpdesk): contraste alto, para ler de longe e correndo.
export const CLASSE_TIPO_BALCAO: Record<string, string> = {
  GOLD: 'border-amber-300 bg-amber-100 text-amber-900',
  PLATINUM: 'border-slate-300 bg-slate-800 text-white',
  PALESTRANTES: 'border-rose-300 bg-rose-600 text-white',
  HACKATHON: 'border-teal-300 bg-teal-600 text-white',
}

export const classeTipo = (tipo: string) =>
  CLASSE_TIPO[(tipo || '').toUpperCase()] || 'bg-slate-100 text-slate-700 border-slate-200'

export const classeTipoBalcao = (tipo: string) =>
  CLASSE_TIPO_BALCAO[(tipo || '').toUpperCase()] || 'border-slate-300 bg-slate-100 text-slate-800'
