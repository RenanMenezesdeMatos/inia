import { CircleDashed, Globe2 } from "lucide-react"

import { StatusChip } from "@/components/ui/surface"
import { OPERATING_UNIVERSE_DESCRIPTIONS, type OperatingUniverse } from "@/schemas/operating-universe/operating-universe.schema"

/** Selo do universo de atuação; sem universo = "Universo pendente" (configuração a regularizar). */
export function UniverseBadge({ universe, className }: { universe: OperatingUniverse | null | undefined; className?: string }) {
  if (!universe) {
    return (
      <StatusChip tone="warning" icon={CircleDashed} className={className} title="Sem universo de atuação: classifique em Administração › Universo de atuação">
        Universo pendente
      </StatusChip>
    )
  }
  return (
    <StatusChip tone="info" icon={Globe2} className={className} title={OPERATING_UNIVERSE_DESCRIPTIONS[universe]}>
      {universe}
    </StatusChip>
  )
}
