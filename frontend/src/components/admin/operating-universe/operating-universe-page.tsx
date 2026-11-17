"use client"

import { useState } from "react"
import { Globe2, Link2Off, ShieldCheck, Users } from "lucide-react"

import { UniverseBadge } from "@/components/operating-universe/universe-badge"
import { UniverseSelect } from "@/components/operating-universe/universe-select"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { PageHeader, StatusChip } from "@/components/ui/surface"
import { TABLE_FRAME, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  useClassifyUnitMutation,
  useUniverseUnitsQuery,
  useClassifyResourceMutation,
  useUniverseEnforcementMutation,
  useUniverseReadinessQuery,
  useUniverseResourcesQuery,
} from "@/queries/operating-universe/use-operating-universe"
import type { OperatingUniverse, UniverseReadiness, UniverseResourceKind } from "@/schemas/operating-universe/operating-universe.schema"

const KIND_LABELS: Record<UniverseResourceKind, string> = {
  KNOWLEDGE_DOCUMENT: "Bases de conhecimento",
  WORKFLOW: "Workflows",
  PRODUCT: "Produtos",
  INDICATOR: "Indicadores",
  BUSINESS_DOMAIN: "Domínios de negócio",
  AGENT: "Agentes",
  ORCHESTRATOR: "Orquestradores",
  ARGUMENT_SCRIPT: "Argumentários",
}

const pendingTotal = (readiness: UniverseReadiness) => readiness.people.pending + readiness.resources.reduce((sum, item) => sum + item.pending, 0) + readiness.conflicts.length

/**
 * Universo de atuação (B2B, B2C, B2X) — prontidão, regularização do legado e ativação. Antes da ativação nada é filtrado; depois dela o
 * backend exige universo nos cadastros novos e as consultas operacionais (chat, Workflows, Indicadores, Equipe, ficha) filtram por universo.
 */
export function OperatingUniversePage() {
  const readiness = useUniverseReadinessQuery()
  return (
    <div className="space-y-6">
      <PageHeader
        icon={Globe2}
        title="Universo de atuação"
        description="B2B, B2C e B2X são universos separados: cada colaborador, base, Workflow, produto, indicador, domínio, agente e Orquestrador pertence a um só. Classifique o que está pendente e ative o filtro quando a operação estiver pronta."
      />
      {readiness.isLoading ? <Skeleton className="h-40 w-full" /> : null}
      {readiness.isError ? <p className="text-sm text-destructive">Não foi possível carregar a prontidão (é preciso administrar as configurações da organização inteira).</p> : null}
      {readiness.data ? (
        <>
          <EnforcementCard readiness={readiness.data} />
          <UnitsCard />
          <ResourcesCard readiness={readiness.data} />
          <ConflictsCard readiness={readiness.data} />
        </>
      ) : null}
    </div>
  )
}

function EnforcementCard({ readiness }: { readiness: UniverseReadiness }) {
  const mutation = useUniverseEnforcementMutation()
  const [confirming, setConfirming] = useState<"enable" | "disable" | null>(null)
  const pending = pendingTotal(readiness)
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <ShieldCheck className="size-5" aria-hidden /> Exigência e filtro por universo
          <StatusChip tone={readiness.enforced ? "success" : "neutral"}>{readiness.enforced ? "Ativos" : "Desligados"}</StatusChip>
        </CardTitle>
        <CardDescription>
          {readiness.enforced
            ? `Ativados${readiness.enforcedBy ? ` por ${readiness.enforcedBy}` : ""}. Cadastros novos exigem universo e as consultas operacionais respeitam o universo de cada pessoa.`
            : "Desligados: nada é filtrado e o universo é opcional nos cadastros. Classifique o legado antes de ativar."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm font-medium">{readiness.enforced ? "Situação" : "O que fica indisponível se ativar agora"}</p>
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground" data-testid="universe-impact">
          {readiness.impact.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-2 text-xs">
          {Object.entries(readiness.people.byUniverse).map(([universe, count]) => (
            <span key={universe} className="inline-flex items-center gap-1.5">
              <UniverseBadge universe={universe === "PENDING" ? null : (universe as OperatingUniverse)} /> {count} pessoa(s)
            </span>
          ))}
        </div>
        {mutation.isError ? <p className="text-sm text-destructive">{(mutation.error as Error).message}</p> : null}
        <Button variant={readiness.enforced ? "outline" : "default"} onClick={() => setConfirming(readiness.enforced ? "disable" : "enable")} disabled={mutation.isPending}>
          {readiness.enforced ? "Desligar exigência e filtro" : "Ativar exigência e filtro"}
        </Button>
        <AlertDialog open={confirming !== null} onOpenChange={(open) => (open ? null : setConfirming(null))}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{confirming === "enable" ? "Ativar o universo de atuação?" : "Desligar o universo de atuação?"}</AlertDialogTitle>
              <AlertDialogDescription>
                {confirming === "enable"
                  ? pending > 0
                    ? `Ainda há ${pending} pendência(s). Ao ativar, o que está sem universo sai das consultas e execuções operacionais até ser classificado.`
                    : "Nada pendente. Ao ativar, cadastros novos exigem universo e as consultas passam a respeitar o universo de cada pessoa."
                  : "Ao desligar, nada mais é filtrado por universo e o campo volta a ser opcional. A classificação feita continua salva."}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction onClick={() => mutation.mutate({ enforce: confirming === "enable", ...(confirming === "enable" ? { acknowledgedPending: pending } : {}) })}>
                {confirming === "enable" ? "Ativar" : "Desligar"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  )
}

function UnitsCard() {
  const units = useUniverseUnitsQuery()
  const mutation = useClassifyUnitMutation()
  const [showAll, setShowAll] = useState(false)
  const [effectiveFrom, setEffectiveFrom] = useState("")
  const rows = (units.data ?? []).filter((unit) => showAll || (unit.kind === "TEAM" && unit.operatingUniverse === null && unit.operators > 0) || unit.operatorsPending > 0)
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users className="size-5" aria-hidden /> Grupos e Subgrupos
        </CardTitle>
        <CardDescription>
          O universo do operador vem do Grupo (ou do Subgrupo, quando ele difere do Grupo-pai); a exceção de uma pessoa fica na ficha dela. O normal é a
          carga de Grupos da Central de Dados trazer a coluna “Universo de atuação” — aqui você classifica o que ainda não veio. Liderança não precisa de universo.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label htmlFor="universe-unit-effective">Vigente desde (opcional)</Label>
            <input
              id="universe-unit-effective"
              type="date"
              value={effectiveFrom}
              onChange={(event) => setEffectiveFrom(event.target.value)}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              aria-describedby="universe-unit-effective-help"
            />
          </div>
          <p id="universe-unit-effective-help" className="max-w-md text-xs text-muted-foreground">
            Só importa numa troca de universo: os indicadores do período anterior ficam no universo antigo. Vazio = a partir de agora.
          </p>
          <Button size="sm" variant="outline" onClick={() => setShowAll((value) => !value)}>
            {showAll ? "Só pendentes" : "Mostrar todos"}
          </Button>
        </div>
        {mutation.isError ? <p className="text-sm text-destructive">{(mutation.error as Error).message}</p> : null}
        {units.isLoading ? <Skeleton className="h-24 w-full" /> : null}
        {units.isError ? <p className="text-sm text-destructive">{(units.error as Error).message}</p> : null}
        {units.data && rows.length === 0 ? <p className="text-sm text-muted-foreground">Nenhum Grupo pendente.</p> : null}
        {rows.length > 0 ? (
          <div className={TABLE_FRAME}>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Grupo / Subgrupo</TableHead>
                  <TableHead>Operadores</TableHead>
                  <TableHead className="w-48">Universo</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((unit) => (
                  <TableRow key={`${unit.kind}-${unit.id}`}>
                    <TableCell>
                      <p className="font-medium">{unit.kind === "TEAM" ? unit.name : `${unit.parentName} › ${unit.name}`}</p>
                      {unit.managedBy ? <p className="text-xs text-muted-foreground">Vem da base {unit.managedBy.sourceName} · {unit.managedBy.feedName} — altere na origem</p> : null}
                    </TableCell>
                    <TableCell className="text-sm">
                      {unit.operators}
                      {unit.operatorsPending > 0 ? <span className="text-amber-700 dark:text-amber-300"> · {unit.operatorsPending} sem universo</span> : null}
                    </TableCell>
                    <TableCell>
                      <UniverseSelect
                        value={unit.operatingUniverse}
                        allowPending
                        pendingLabel={unit.kind === "TEAM" ? "Sem universo" : "Herda do Grupo"}
                        disabled={mutation.isPending || unit.managedBy !== null}
                        onChange={(value) => mutation.mutate({ kind: unit.kind, id: unit.id, operatingUniverse: value, effectiveFrom: effectiveFrom || null })}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}

function ResourcesCard({ readiness }: { readiness: UniverseReadiness }) {
  const [kind, setKind] = useState<UniverseResourceKind>(readiness.resources.find((item) => item.pending > 0)?.kind ?? "KNOWLEDGE_DOCUMENT")
  const [status, setStatus] = useState<"PENDING" | "ALL">("PENDING")
  const resources = useUniverseResourcesQuery(kind, status)
  const mutation = useClassifyResourceMutation()
  return (
    <Card>
      <CardHeader>
        <CardTitle>Recursos</CardTitle>
        <CardDescription>
          Classifique cada recurso. Mudar o universo é recusado quando deixaria um vínculo entre universos diferentes (a mensagem diz quais resolver). Workflow já
          classificado muda pelo editor (vale ao Publicar).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2 text-xs">
          {readiness.resources.map((item) => (
            <Button key={item.kind} size="sm" variant={item.kind === kind ? "default" : "outline"} onClick={() => setKind(item.kind)}>
              {KIND_LABELS[item.kind]} · {item.pending} pendente(s) de {item.total}
            </Button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Label htmlFor="universe-resource-status" className="text-sm">
            Mostrar
          </Label>
          <Select value={status} onValueChange={(value) => setStatus(value as "PENDING" | "ALL")}>
            <SelectTrigger id="universe-resource-status" className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="PENDING">Só pendentes</SelectItem>
              <SelectItem value="ALL">Todos</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {mutation.isError ? <p className="text-sm text-destructive">{(mutation.error as Error).message}</p> : null}
        {resources.isLoading ? <Skeleton className="h-24 w-full" /> : null}
        {resources.isError ? <p className="text-sm text-destructive">{(resources.error as Error).message}</p> : null}
        {resources.data && resources.data.items.length === 0 ? <p className="text-sm text-muted-foreground">Nada a classificar neste tipo.</p> : null}
        {resources.data?.truncated ? <p className="text-sm text-muted-foreground">Mostrando só os primeiros {resources.data.limit ?? resources.data.items.length} itens deste tipo: os que você classificar saem da lista de pendentes e abrem espaço para os próximos.</p> : null}
        {resources.data && resources.data.items.length > 0 ? (
          <div className={TABLE_FRAME}>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>Atual</TableHead>
                  <TableHead className="w-48">Classificar como</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {resources.data.items.map((resource) => (
                  <TableRow key={resource.id}>
                    <TableCell className="font-medium">{resource.name}</TableCell>
                    <TableCell>
                      <UniverseBadge universe={resource.operatingUniverse} />
                    </TableCell>
                    <TableCell>
                      <UniverseSelect
                        value={resource.operatingUniverse}
                        disabled={mutation.isPending}
                        onChange={(value) => value && mutation.mutate({ kind: resource.kind, id: resource.id, operatingUniverse: value })}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}

function ConflictsCard({ readiness }: { readiness: UniverseReadiness }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Link2Off className="size-5" aria-hidden /> Vínculos entre universos ({readiness.conflicts.length})
        </CardTitle>
        <CardDescription>Vínculos existentes que ligam recursos de universos diferentes. Desfaça o vínculo ou reclassifique um dos lados antes de ativar.</CardDescription>
      </CardHeader>
      <CardContent>
        {readiness.conflicts.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum conflito.</p>
        ) : (
          <ul className="space-y-1.5 text-sm" data-testid="universe-conflicts">
            {readiness.conflicts.map((conflict) => (
              <li key={`${conflict.from.id}-${conflict.to.id}`} className="flex flex-wrap items-center gap-1.5">
                <span className="font-medium">{conflict.from.name}</span>
                <UniverseBadge universe={conflict.from.operatingUniverse as OperatingUniverse} />
                <span className="text-muted-foreground">×</span>
                <span className="font-medium">{conflict.to.name}</span>
                <UniverseBadge universe={conflict.to.operatingUniverse as OperatingUniverse} />
                {conflict.viaCategory ? <span className="text-xs text-muted-foreground">(pela categoria)</span> : null}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
