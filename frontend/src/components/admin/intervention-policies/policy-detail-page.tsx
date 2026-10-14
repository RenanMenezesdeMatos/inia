"use client"

import Link from "next/link"
import { ArrowLeft } from "lucide-react"

import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"
import { usePolicyQuery } from "@/queries/admin/use-intervention-policy-queries"

import { PolicyEditor } from "./policy-editor"
import { PolicyEvaluationsPanel } from "./policy-detail/policy-evaluations-panel"
import { PolicyHeaderCard } from "./policy-detail/policy-header-card"
import { PolicySimulationPanel } from "./policy-detail/policy-simulation-panel"
import { PolicyVersionsPanel } from "./policy-detail/policy-versions-panel"
import { errorCode, errorMessage, latestPublishedVersion } from "./shared/helpers"

/**
 * Uma política de acompanhamento: cabeçalho (nome, escopo, status), regras (rascunho editável / versão publicada só leitura),
 * simulação sem efeitos, histórico de versões e — com permissão de auditoria — as avaliações. As abas ficam montadas
 * (escondidas quando inativas): trocar de aba nunca perde o rascunho que ainda não foi salvo.
 */
export function PolicyDetailPage({ policyId }: { policyId: string }) {
  const policyQuery = usePolicyQuery(policyId)
  const back = (
    <Link href="/admin/intervention-policies" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
      <ArrowLeft className="size-4" /> Políticas de acompanhamento
    </Link>
  )
  if (policyQuery.isPending) {
    return (
      <div className="space-y-4">
        {back}
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }
  if (policyQuery.isError) {
    return (
      <div className="space-y-4">
        {back}
        <Card>
          <CardContent className="py-6 text-sm text-destructive" role="alert">
            {errorCode(policyQuery.error) === "INTERVENTION_POLICY_NOT_FOUND" ? "Política não encontrada ou fora do seu escopo." : errorMessage(policyQuery.error, "Não foi possível carregar a política.")}
          </CardContent>
        </Card>
      </div>
    )
  }
  const policy = policyQuery.data
  // O editor recomeça quando a última versão PUBLICADA muda (publicação) — nunca a cada refetch nem ao salvar o rascunho.
  const editorKey = `${policy.id}|${latestPublishedVersion(policy.versions)?.id ?? "-"}`
  const hidden = "data-[state=inactive]:hidden"

  return (
    <div className="space-y-4">
      {back}
      <PolicyHeaderCard key={`${policy.id}|${policy.name}|${policy.scopeType}|${policy.teamId}|${policy.subteamId}`} policy={policy} />
      <Card>
        <CardContent className="pt-6">
          <Tabs defaultValue="rules">
            <TabsList>
              <TabsTrigger value="rules">Regras</TabsTrigger>
              {policy.can.simulate ? <TabsTrigger value="simulate">Simular</TabsTrigger> : null}
              <TabsTrigger value="versions">Versões ({policy.versions.length})</TabsTrigger>
              {policy.can.audit ? <TabsTrigger value="evaluations">Avaliações</TabsTrigger> : null}
            </TabsList>
            <TabsContent value="rules" forceMount className={cn("mt-4", hidden)}>
              <PolicyEditor key={editorKey} policy={policy} />
            </TabsContent>
            {policy.can.simulate ? (
              <TabsContent value="simulate" className="mt-4">
                <PolicySimulationPanel policy={policy} />
              </TabsContent>
            ) : null}
            <TabsContent value="versions" className="mt-4">
              <PolicyVersionsPanel policy={policy} />
            </TabsContent>
            {policy.can.audit ? (
              <TabsContent value="evaluations" className="mt-4">
                <PolicyEvaluationsPanel policyId={policy.id} />
              </TabsContent>
            ) : null}
          </Tabs>
        </CardContent>
      </Card>
    </div>
  )
}
