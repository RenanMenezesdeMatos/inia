import { AlertTriangle, BookOpenCheck, CheckCircle2, ClipboardCheck, Target } from "lucide-react"
import type { ReactNode } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import type { SupervisionCase } from "@/schemas/supervision-cases/supervision-case.schema"

const statusLabels: Record<string, string> = {
  DETECTED: "Detectado", DIAGNOSING: "Em diagnóstico", DIAGNOSED: "Diagnosticado",
  ACTION_PENDING: "Ação pendente", FOLLOWING_UP: "Em acompanhamento", ESCALATED: "Escalado",
  RESOLVED: "Resolvido", CLOSED: "Encerrado",
}

type Props = { item: SupervisionCase }

export function SupervisionCasePage({ item }: Props) {
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
                <Badge variant="secondary">Confiança {Math.round((item.confidence ?? 0) * 100)}%</Badge>
              </div>
              <CardTitle className="text-xl">{item.title}</CardTitle>
              <CardDescription>{item.operator.name} · {item.team.name}</CardDescription>
            </div>
            <div className="flex gap-2">
              <Button variant="outline">Escalonar</Button>
              <Button>Publicar feedback</Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-3">
          <Card size="sm"><CardHeader><CardDescription>Indicador impactado</CardDescription><CardTitle>{item.indicatorCode} · {item.indicatorValue}</CardTitle></CardHeader><CardContent className="text-xs text-muted-foreground">Meta {item.indicatorTarget}</CardContent></Card>
          <Card size="sm"><CardHeader><CardDescription>Causa operacional</CardDescription><CardTitle className="text-sm">{item.rootCause ?? "Em análise"}</CardTitle></CardHeader></Card>
          <Card size="sm"><CardHeader><CardDescription>Próxima ação</CardDescription><CardTitle className="text-sm">{recommendation?.description ?? "Definir ação"}</CardTitle></CardHeader></Card>
        </CardContent>
      </Card>

      <Tabs defaultValue="journey">
        <TabsList>
          <TabsTrigger value="journey">Jornada completa</TabsTrigger>
          <TabsTrigger value="feedback">Feedback</TabsTrigger>
          <TabsTrigger value="evidence">Evidências</TabsTrigger>
        </TabsList>

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
              <div className="flex gap-3"><AlertTriangle className="mt-0.5 size-4 text-amber-500"/><div><p className="text-sm font-medium">Acompanhamento</p><p className="text-xs text-muted-foreground">Reavaliar após cinco interações e escalar se não houver evolução.</p></div></div>
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
