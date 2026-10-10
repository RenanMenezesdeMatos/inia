import { permanentRedirect } from "next/navigation"

/**
 * Rota antiga da Wiki ("Indicadores, Equipe / Estrutura e Pendências"). O conteúdo foi repartido em
 * /wiki/indicadores, /wiki/indicadores/analytics, /wiki/estrutura/equipe, /wiki/acompanhamento,
 * /wiki/pendencias e /wiki/notificacoes — links antigos caem em Indicadores.
 */
export default function LegacyIndicatorsTeamWikiPage() {
  permanentRedirect("/wiki/indicadores")
}
