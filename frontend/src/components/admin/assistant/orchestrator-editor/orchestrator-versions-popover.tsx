"use client"

import { useState } from "react"
import { History } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger } from "@/components/ui/popover"
import { Skeleton } from "@/components/ui/skeleton"

import { formatDateTime } from "@/lib/format/date"
import { useOrchestratorVersionsQuery } from "@/queries/admin/use-assistant-queries"
import { ORCHESTRATOR_VERSION_ORIGIN_LABELS, type OrchestratorVersion } from "@/schemas/admin/assistant.schema"

/** Versão de agente gravada nas versões anteriores à revisão de 03/11/2026 — só registro histórico, nunca a usada hoje. */
function historicalAgentVersion(number: number | null): string {
  return number ? ` · versão ${number} registrada na época` : ""
}

function VersionItem({ version }: { version: OrchestratorVersion }) {
  return (
    <li className="space-y-1 rounded-md border px-2.5 py-2" data-testid="orchestrator-version">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium">Versão {version.number}</span>
        {version.current ? <Badge variant="secondary">Em uso</Badge> : null}
      </div>
      <p className="text-xs text-muted-foreground">
        {formatDateTime(version.publishedAt)}
        {version.publishedByName ? ` · ${version.publishedByName}` : ""}
        {version.origin === "MIGRATION" ? ` · ${ORCHESTRATOR_VERSION_ORIGIN_LABELS.MIGRATION}` : ""}
      </p>
      <ul className="space-y-0.5 text-xs" data-testid="orchestrator-version-specialists">
        {version.orchestratorAgentVersionNumber ? (
          <li className="text-muted-foreground">Agente orquestrador{historicalAgentVersion(version.orchestratorAgentVersionNumber)}</li>
        ) : null}
        {version.specialists.length === 0 ? <li className="text-muted-foreground">Sem especialistas.</li> : null}
        {version.specialists.map((specialist) => (
          <li key={specialist.agentId} className="truncate">
            {specialist.agentName ?? "Agente"}
            <span className="text-muted-foreground">{historicalAgentVersion(specialist.agentVersionNumber)}</span>
          </li>
        ))}
      </ul>
    </li>
  )
}

/**
 * "Versões" do orquestrador (PEN-076, com a revisão de 03/11/2026): cada gravação publica uma versão nova e imutável da
 * configuração (especialistas, política, resultado estruturado). Os agentes não ficam fixados — rodam na versão vigente de cada
 * um; a versão de agente que aparece nas versões antigas é só o registro da época. Só leitura — a lista é buscada quando aberta.
 */
export function OrchestratorVersionsPopover({ orchestratorId }: { orchestratorId: string }) {
  const [open, setOpen] = useState(false)
  const versionsQuery = useOrchestratorVersionsQuery(orchestratorId, open)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="ghost" size="xs">
          <History /> Versões
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80">
        <PopoverHeader>
          <PopoverTitle>Versões do orquestrador</PopoverTitle>
          <PopoverDescription className="text-xs" data-testid="orchestrator-versions-explanation">
            Cada gravação publica uma versão nova da configuração (especialistas, política e resultado estruturado); Workflows que fixaram uma versão continuam com a
            configuração dela. O agente orquestrador e os especialistas rodam sempre na versão vigente de cada um.
          </PopoverDescription>
        </PopoverHeader>
        {versionsQuery.isPending ? (
          <Skeleton className="h-16 w-full" />
        ) : versionsQuery.isError ? (
          <div className="space-y-2">
            <p className="text-xs text-destructive" role="alert">
              Não foi possível carregar as versões.
            </p>
            <Button type="button" variant="outline" size="xs" onClick={() => void versionsQuery.refetch()}>
              Tentar novamente
            </Button>
          </div>
        ) : versionsQuery.data.length === 0 ? (
          <p className="text-xs text-muted-foreground">Nenhuma versão publicada ainda.</p>
        ) : (
          <ul className="max-h-80 space-y-2 overflow-y-auto">
            {versionsQuery.data.map((version) => (
              <VersionItem key={version.id} version={version} />
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  )
}
