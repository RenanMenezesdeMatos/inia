/**
 * NÚMEROS PARA LEITURA (indicadores de gestão): porcentagem e duração em segundos no formato brasileiro. Valor ausente nunca vira
 * zero: quem chama decide o que mostrar no lugar ("Sem dados", "Poucos dados").
 */
const PERCENT = new Intl.NumberFormat("pt-BR", { style: "percent", maximumFractionDigits: 1 })
const DECIMAL = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 })

/** 0,153… → "15,3%"; 1 → "100%". */
export function formatPercent(ratio: number): string {
  return PERCENT.format(ratio)
}

/** Segundos medidos: "menos de 1 s", "17,8 s", "1 min 5 s", "1 h 2 min". */
export function formatSeconds(seconds: number): string {
  if (seconds < 1) return "menos de 1 s"
  if (seconds < 60) return `${DECIMAL.format(Math.round(seconds * 10) / 10)} s`
  const total = Math.round(seconds)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const rest = total % 60
  if (hours > 0) return `${hours} h ${minutes} min`
  return rest > 0 ? `${minutes} min ${rest} s` : `${minutes} min`
}
