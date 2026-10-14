import { AlertTriangle, BookOpenCheck, CheckCircle2, ClipboardCheck, Target } from "lucide-react"
import { Suspense, type ReactNode } from "react"
import { CaseInterventions } from "@/components/interventions/case-interventions"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import type { SupervisionCase } from "@/schemas/supervision-cases/supervision-case.schema"

const statusLabels: Record<string, string> = {
  DETECTED: "Detectado", DIAGNOSING: "Em diagnóstico", DIAGNOSED: "Diagnosticado",
  ACTION_PENDING: "Ação pendente", FOLLOWING_UP: "Em acompanhamento", ESCALATED: "Escalado",
  RESOLVED: "Resolvido", CLOSED: "Encerrado",
}

type Props = { caseId: string; item: SupervisionCase | null }

/**
 * Caso de supervisão = o centro: análise, intervenções, evidências e histórico. As intervenções (com relatório, controles e
 * acompanhamento) vêm da própria API de intervenções, que confere a relação do viewer — por isso aparecem mesmo quando os
 * dados gerais do caso não estão no escopo de Indicadores de quem decide (ex.: avaliador de continuidade).
 */
export function SupervisionCasePage({ caseId, item }: Props) {
  if (!item) {
    return (
      <main className="mx-auto w-full max-w-7xl space-y-4 px-4 py-4 sm:px-6 lg:px-8">
        <Card>
          <CardHeader>
            <CardTitle className="text-xl">Caso de supervisão</CardTitle>
            <CardDescription>Os dados gerais deste caso não estão disponíveis para você. As intervenções que você acompanha aparecem abaixo.</CardDescription>
          </CardHeader>
        </Card>
        <Suspense>
          <CaseInterventions caseId={caseId} />
        </Suspense>
      </main>
    )
  }
  const feedback = item.feedbacks[0]
  const recommendation = item.recommendations[0]

  return (
    <main className="mx-auto w-full max-w-7xl space-y-4 px-4 py-4 sm:px-6 lg:px-8">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1">
              <div className="flex flex-wrap gap-2">
                <Badge>{item.priority}</Badge>
                <Badge variant="outline">{statusLabels[item.status] ?? item.status}</Badge>
                {item.confidence !== null ? <Badge variant="secondary">Confiança {Math.round(item.confidence * 100)}%</Badge> : null}
              </div>
              <CardTitle className="text-xl">{item.title}</CardTitle>
              <CardDescription>{item.operator.name} · {item.team.name}</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-3">
          <Card size="sm"><CardHeader><CardDescription>Indicador impactado</CardDescription><CardTitle>{item.indicatorCode} · {item.indicatorValue}</CardTitle></CardHeader>{item.indicatorTarget && item.indicatorTarget !== "—" ? <CardContent className="text-xs text-muted-foreground">Meta {item.indicatorTarget}</CardContent> : null}</Card>
          <Card size="sm"><CardHeader><CardDescription>Causa operacional</CardDescription><CardTitle className="text-sm">{item.rootCause ?? "Em análise"}</CardTitle></CardHeader></Card>
          <Card size="sm"><CardHeader><CardDescription>Próxima ação</CardDescription><CardTitle className="text-sm">{recommendation?.description ?? "Definir ação"}</CardTitle></CardHeader></Card>
        </CardContent>
      </Card>

      <Tabs defaultValue="interventions">
        <TabsList>
          <TabsTrigger value="interventions">Intervenções</TabsTrigger>
          <TabsTrigger value="journey">Diagnóstico</TabsTrigger>
          <TabsTrigger value="feedback">Feedback</TabsTrigger>
          <TabsTrigger value="evidence">Evidências</TabsTrigger>
        </TabsList>

        <TabsContent value="interventions" className="mt-4">
          <Suspense>
            <CaseInterventions caseId={caseId} />
          </Suspense>
        </TabsContent>

        <TabsContent value="journey" className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
          <Card>
            <CardHeader><CardTitle>Diagnóstico da INIA</CardTitle><CardDescription>{item.summary}</CardDescription></CardHeader>
            <CardContent className="space-y-4">
              {item.evidences.map((evidence) => (
                <Card key={evidence.id} size="sm">
                  <CardHeader><div className="flex items-center gap-2"><ClipboardCheck className="size-4 text-primary"/><Badge variant="outline">{evidence.type}</Badge><CardTitle className="text-sm">{evidence.title}</CardTitle></div></CardHeader>
                  <CardContent><p className="text-sm text-muted-foreground">{evidence.description}</p><p className="mt-2 text-xs text-muted-foreground">Fonte: {evidence.sourceType} · {evidence.sourceId}</p></CardContent>
                </Card>
              ))}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Plano de atuação</CardTitle><CardDescription>Da recomendação ao acompanhamento</CardDescription></CardHeader>
            <CardContent className="space-y-3">
              <div className="flex gap-3"><Target className="mt-0.5 size-4 text-primary"/><div><p className="text-sm font-medium">Ação recomendada</p><p className="text-xs text-muted-foreground">{recommendation?.description}</p></div></div>
              <Separator />
              <div className="flex gap-3"><CheckCircle2 className="mt-0.5 size-4 text-primary"/><div><p className="text-sm font-medium">Impacto esperado</p><p className="text-xs text-muted-foreground">{recommendation?.expectedImpact}</p></div></div>
              <Separator />
              <div className="flex gap-3"><AlertTriangle className="mt-0.5 size-4 text-amber-500"/><div><p className="text-sm font-medium">Acompanhamento</p><p className="text-xs text-muted-foreground">O acompanhamento deste caso — intervenções, prazos, checkpoints e decisões — fica na aba Intervenções, conforme a política de acompanhamento.</p></div></div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="feedback" className="mt-4">
          <Card><CardHeader><CardTitle>Feedback estruturado</CardTitle><CardDescription>Todos os campos obrigatórios possuem sustentação verificável.</CardDescription></CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2">
              {feedback ? <>
                <FeedbackField icon={<Target className="size-4"/>} title="Indicador impactado" value={feedback.impactedIndicator}/>
                <FeedbackField icon={<ClipboardCheck className="size-4"/>} title="Evidência encontrada" value={feedback.evidenceFound}/>
                <FeedbackField icon={<AlertTriangle className="size-4"/>} title="Comportamento observado" value={feedback.observedBehavior}/>
                <FeedbackField icon={<BookOpenCheck className="size-4"/>} title="Procedimento relacionado" value={feedback.relatedProcedure}/>
                <FeedbackField icon={<CheckCircle2 className="size-4"/>} title="Recomendação" value={feedback.recommendation}/>
                <FeedbackField icon={<CheckCircle2 className="size-4"/>} title="Abordagem sugerida" value={feedback.suggestedApproach ?? "Não informada"}/>
              </> : <CardDescription>Nenhum feedback criado.</CardDescription>}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="evidence" className="mt-4 grid gap-3 md:grid-cols-2">
          {item.evidences.map((evidence) => <Card key={evidence.id}><CardHeader><Badge className="w-fit" variant="outline">{evidence.type}</Badge><CardTitle>{evidence.title}</CardTitle><CardDescription>{evidence.description}</CardDescription></CardHeader><CardContent className="text-xs text-muted-foreground">Origem verificável: {evidence.sourceType}/{evidence.sourceId}</CardContent></Card>)}
        </TabsContent>
      </Tabs>
    </main>
  )
}

function FeedbackField({ icon, title, value }: { icon: ReactNode; title: string; value: string }) {
  return <Card size="sm"><CardHeader><div className="flex items-center gap-2 text-primary">{icon}<CardTitle className="text-sm">{title}</CardTitle></div></CardHeader><CardContent className="text-sm text-muted-foreground">{value}</CardContent></Card>
}
