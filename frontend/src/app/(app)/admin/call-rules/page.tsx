import { permanentRedirect } from "next/navigation"

/**
 * Rota antiga ("Regras de chamada"). As regras viraram Argumentários (`/admin/argument-scripts`), com campos que preservam o
 * significado de cada parte da regra — links e favoritos antigos caem na nova tela (o atalho `?new=1` continua abrindo a criação).
 */
export default async function LegacyCallRulesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { new: openNew } = await searchParams
  permanentRedirect(openNew ? "/admin/argument-scripts?new=1" : "/admin/argument-scripts")
}
