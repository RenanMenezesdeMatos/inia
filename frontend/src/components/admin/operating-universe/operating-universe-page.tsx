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
  useClassifyPendingTeamMutation,
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
          <PendingPeopleCard readiness={readiness.data} />
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

function PendingPeopleCard({ readiness }: { readiness: UniverseReadiness }) {
  const mutation = useClassifyPendingTeamMutation()
  const [choice, setChoice] = useState<Record<string, OperatingUniverse | null>>({})
  const [result, setResult] = useState<string | null>(null)
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users className="size-5" aria-hidden /> Colaboradores pendentes ({readiness.people.pending})
        </CardTitle>
        <CardDescription>
          Classifique por Grupo: a escolha vale para as pessoas ATIVAS ainda sem universo naquele Grupo, dentro do seu escopo. Quem vem da base com o campo
          mapeado é corrigido na origem (Central de Dados › Colaboradores, campo “Universo de atuação”); a pessoa também pode ser regularizada em Usuários e acessos.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {readiness.pendingPeopleByGroup.length === 0 ? <p className="text-sm text-muted-foreground">Nenhum colaborador pendente.</p> : null}
        {readiness.pendingPeopleByGroup.length > 0 ? (
          <div className={TABLE_FRAME}>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Grupo</TableHead>
                  <TableHead>Pendentes</TableHead>
                  <TableHead className="w-48">Universo</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {readiness.pendingPeopleByGroup.map((group) => {
                  const key = group.teamId ?? "none"
                  return (
                    <TableRow key={key}>
                      <TableCell>{group.teamName ?? "Sem Grupo"}</TableCell>
                      <TableCell>{group.pending}</TableCell>
                      <TableCell>
                        <UniverseSelect value={choice[key] ?? null} onChange={(value) => setChoice((current) => ({ ...current, [key]: value }))} />
                      </TableCell>
                      <TableCell>
                        <Button
                          size="sm"
                          disabled={!choice[key] || mutation.isPending}
                          onClick={async () => {
                            const outcome = await mutation.mutateAsync({ teamId: group.teamId, operatingUniverse: choice[key]! })
                            setResult(`${outcome.updated} pessoa(s) classificada(s)${outcome.managedBySource.length ? `; ${outcome.managedBySource.length} vêm da base e precisam ser corrigidas na origem` : ""}${outcome.outOfScope ? `; ${outcome.outOfScope} fora do seu escopo` : ""}.`)
                          }}
                        >
                          Classificar
                        </Button>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        ) : null}
        {result ? <p role="status" className="text-sm text-muted-foreground">{result}</p> : null}
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
        {resources.data && resources.data.length === 0 ? <p className="text-sm text-muted-foreground">Nada a classificar neste tipo.</p> : null}
        {resources.data && resources.data.length > 0 ? (
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
                {resources.data.map((resource) => (
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
