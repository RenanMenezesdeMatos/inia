import {
  ArrowRightLeft,
  Ban,
  CalendarCheck,
  ChartLine,
  CircleCheck,
  ClipboardCheck,
  Clock,
  Flag,
  Frown,
  Gauge,
  Hash,
  Headset,
  ListChecks,
  Percent,
  PhoneIncoming,
  PhoneOff,
  Receipt,
  Repeat,
  ShieldCheck,
  Smile,
  Star,
  Target,
  ThumbsDown,
  Timer,
  TrendingUp,
  Users,
  VolumeX,
  Zap,
  type LucideIcon,
} from "lucide-react"

/**
 * Catálogo FECHADO de ícones para flags e indicadores (espelho de backend/src/shared/domain/display-icon.ts — teste de
 * sincronia no backend). Só a chave é guardada; ícone novo = entrada aqui e lá.
 */
export const DISPLAY_ICONS = {
  "phone-incoming": { icon: PhoneIncoming, label: "Nova ligação" },
  "repeat": { icon: Repeat, label: "Repetição" },
  "star": { icon: Star, label: "Estrela" },
  "timer": { icon: Timer, label: "Cronômetro" },
  "clock": { icon: Clock, label: "Relógio" },
  "arrow-right-left": { icon: ArrowRightLeft, label: "Transferência" },
  "ban": { icon: Ban, label: "Cancelamento" },
  "receipt": { icon: Receipt, label: "Fatura" },
  "frown": { icon: Frown, label: "Insatisfação" },
  "smile": { icon: Smile, label: "Satisfação" },
  "thumbs-down": { icon: ThumbsDown, label: "Negativo" },
  "volume-x": { icon: VolumeX, label: "Silêncio" },
  "phone-off": { icon: PhoneOff, label: "Desconexão" },
  "percent": { icon: Percent, label: "Percentual" },
  "target": { icon: Target, label: "Meta" },
  "trending-up": { icon: TrendingUp, label: "Crescimento" },
  "gauge": { icon: Gauge, label: "Medidor" },
  "circle-check": { icon: CircleCheck, label: "Resolvido" },
  "list-checks": { icon: ListChecks, label: "Lista de casos" },
  "hash": { icon: Hash, label: "Quantidade" },
  "users": { icon: Users, label: "Pessoas" },
  "shield-check": { icon: ShieldCheck, label: "Qualidade" },
  "calendar-check": { icon: CalendarCheck, label: "Rotina" },
  "clipboard-check": { icon: ClipboardCheck, label: "Checklist" },
  "headset": { icon: Headset, label: "Atendimento" },
  "chart-line": { icon: ChartLine, label: "Gráfico" },
  "flag": { icon: Flag, label: "Sinal" },
  "zap": { icon: Zap, label: "Alerta" },
} as const satisfies Record<string, { icon: LucideIcon; label: string }>

export type DisplayIconKey = keyof typeof DISPLAY_ICONS
export const DISPLAY_ICON_KEYS = Object.keys(DISPLAY_ICONS) as DisplayIconKey[]

export const isDisplayIconKey = (value: unknown): value is DisplayIconKey => typeof value === "string" && value in DISPLAY_ICONS

/** Desenha o ícone da chave; chave desconhecida ou ausente (catálogo mudou) = `fallback`. */
export function DisplayIcon({ iconKey, fallback = Flag, className }: { iconKey: string | null | undefined; fallback?: LucideIcon; className?: string }) {
  const Icon = isDisplayIconKey(iconKey) ? DISPLAY_ICONS[iconKey].icon : fallback
  return <Icon className={className} aria-hidden />
}

/** Ícone padrão pelo COMPORTAMENTO quando nada foi configurado (mesma regra de backend/src/modules/feedbacks/domain/feedback-origin.ts). */
export const UNIT_DEFAULT_ICON: Record<string, DisplayIconKey> = { SECONDS: "timer", STARS: "star", POINTS: "gauge", PERCENT: "percent", COUNT: "hash", CASES: "list-checks", CASES_PER_DAY: "trending-up" }
export const flagDefaultIconKey = (valueType: "BOOLEAN" | "NUMERIC"): DisplayIconKey => (valueType === "NUMERIC" ? "gauge" : "flag")
