import { CircleCheck, CircleStop, ClipboardList, Coffee, UserRound, Users, type LucideIcon } from "lucide-react"

import type { PauseReason, PresenceStatus } from "@/schemas/human-support/catalogs.schema"
import type { Tone } from "@/components/ui/surface"

/**
 * ÍCONES E TONS DO ESTADO DO ANJO (só apresentação). Cada motivo de pausa do catálogo real (`PAUSE_REASONS_V1`) tem um ícone próprio:
 * Lanche (xícara), Pessoal (pessoa), Atividade de processo (prancheta) e Reunião (grupo). Indisponível usa o ícone de parada, o mesmo
 * da ação "Ficar indisponível", em vermelho semântico.
 */
export const PAUSE_REASON_ICONS: Record<PauseReason, LucideIcon> = { LUNCH: Coffee, PERSONAL: UserRound, PROCESS_ACTIVITY: ClipboardList, MEETING: Users }

export const STATUS_TONE: Record<PresenceStatus, Tone> = { AVAILABLE: "success", PAUSED: "warning", OFFLINE: "danger" }

export function presenceIcon(status: PresenceStatus, pauseReason: PauseReason | null): LucideIcon {
  if (status === "PAUSED") return pauseReason ? PAUSE_REASON_ICONS[pauseReason] : Coffee
  return status === "AVAILABLE" ? CircleCheck : CircleStop
}
