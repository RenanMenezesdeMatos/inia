"use client"

import { Suspense } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ArrowLeft, CheckCircle2, CircleAlert, ClipboardCheck, Target } from "lucide-react"

import { IndicatorsView } from "@/components/analytics/indicators-view"
import { StructureFollowUpFeed } from "@/components/follow-up/structure-follow-up-feed"
import { PersonStructureView } from "@/components/structure/person-structure-view"
import { ProfileHeader, type ProfileHeaderPerson } from "@/components/profile/profile-header"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent } from "@/components/ui/tabs"
import { useAnalyticsUrlState, type ProfileTab } from "@/hooks/use-analytics-url-state"
import type { SubjectRef } from "@/lib/analytics/subject-params"
import type { AnalyticsContext } from "@/schemas/analytics/analytics.schema"
import { NO_ACCESS_CAPABILITIES, profileLinksFor, type AccessCapabilities } from "@/schemas/auth/auth.schema"
import type { SupervisorOperatorDetail } from "@/services/supervisor"

import { backLinkFor } from "./employee-profile-exit"
import { ProfileTabsList } from "./profile-tabs"
import { ChartNoAxesCombined, MessagesSquare, Network, UserRound } from "lucide-react"
import { PersonInterventions } from "@/components/interventions/person-interventions"

const TABS = [
  { value: "followup" as const, label: "Acompanhamentos", icon: MessagesSquare },
  { value: "indicators" as const, label: "Indicadores", icon: ChartNoAxesCombined },
  { value: "people" as const, label: "Visão geral", icon: UserRound },
  { value: "structure" as const, label: "Organograma", icon: Network },
]

/**
 * A MESMA ficha de colaborador para qualquer gestor que abre alguém da estrutura — reutiliza o
 * dashboard de Indicadores (sujeito EMPLOYEE, escopo validado no backend) e a Surface de
 * Acompanhamento filtrada para a pessoa. Nenhuma segunda ficha, nenhum dado de demonstração.
 */
export function EmployeeProfilePage({ detail, context, capabilities = NO_ACCESS_CAPABILITIES }: { detail: SupervisorOperatorDetail; context: AnalyticsContext | null; capabilities?: AccessCapabilities }) {
  return (
    <Suspense fallback={<Skeleton className="mx-auto mt-6 h-64 w-full max-w-7xl rounded-2xl" />}>
      <EmployeeProfileContent detail={detail} context={context} capabilities={capabilities} />
    </Suspense>
  )
}

function EmployeeProfileContent({ detail, context, capabilities }: { detail: SupervisorOperatorDetail; context: AnalyticsContext | null; capabilities: AccessCapabilities }) {
  const links = profileLinksFor(capabilities)
  const router = useRouter()
  const { state, update } = useAnalyticsUrlState()
  const activeTab: ProfileTab = TABS.some((tab) => tab.value === state.tab) ? state.tab : "indicators"
  const subject: SubjectRef = { kind: "EMPLOYEE", id: detail.profile.id }

  // Subir pelo breadcrumb sai da ficha e volta ao perfil do gestor, já posicionado na estrutura.
  function navigateToStructure(target: SubjectRef | null) {
    const params = new URLSearchParams({ tab: "indicators" })
    if (target) {
      params.set("subjectKind", target.kind)
      params.set("subjectId", target.id)
    }
    if (state.period) params.set("period", state.period)
    router.push(`/supervisor?${params.toString()}`)
  }

  const back = backLinkFor(context, detail.profile.id)
  const backAction = (
    <Button variant="ghost" asChild>
      <Link href={back.href}>
        <ArrowLeft aria-hidden /> {back.label}
      </Link>
    </Button>
  )
  // Pessoa VISITADA: nome, foto e capa que ELA escolheu (do backend) — nunca as preferências de quem visita, e sem edição.
  // Contexto de gestão: nome cadastral e matrícula ficam visíveis junto do nome escolhido.
  const presentation = detail.profile.presentation ?? null
  const visited: ProfileHeaderPerson = {
    displayName: presentation?.displayName ?? detail.profile.name,
    registeredName: presentation?.registeredName ?? detail.profile.name,
    avatarUrl: presentation?.avatarUrl ?? detail.profile.avatarUrl,
    cover: presentation?.cover,
    jobTitle: detail.profile.jobTitle,
    teamName: detail.profile.teamName,
    matricula: detail.profile.matricula ?? null,
  }
  const visitedName = presentation?.addressName ?? detail.profile.name.split(" ")[0]

  return (
    <div className="min-h-screen overflow-x-clip bg-muted text-foreground">
      <div className="mx-auto flex w-full max-w-7xl flex-col px-4 py-4 sm:px-6 sm:py-5 lg:px-8">
        <ProfileHeader person={visited} isOwn={false} attached actions={backAction} />
        <main className="min-h-0">
          <Tabs value={activeTab} onValueChange={(value) => update({ tab: value as ProfileTab })} className="min-w-0">
            <ProfileTabsList tabs={TABS} active={activeTab} />
            <TabsContent value="followup" className="mt-4 pb-8">
              <div>
                <div className="h-[calc(100dvh-7.5rem)] overflow-hidden rounded-xl bg-card">
                  <StructureFollowUpFeed subject={subject} description={`Feedbacks e monitorias publicados para ${visitedName}`} unacknowledgedOnly={state.ackPending} onUnacknowledgedOnlyChange={(value) => update({ ackPending: value })} highlightItemId={state.item} />
                </div>
              </div>
            </TabsContent>
            <TabsContent value="indicators" className="mt-4 pb-8">
              {context ? (
                <IndicatorsView
                  context={context}
                  state={{ subject, period: state.period, comparison: state.comparison, indicator: state.indicator, groupBy: null }}
                  onStateChange={(patch) => (patch.subject !== undefined ? navigateToStructure(patch.subject) : update(patch))}
                  employeeHref={(personId) => `/supervisor/operators/${personId}?tab=indicators`}
                  title={`Indicadores de ${visitedName}`}
                  canSeeLineage={links.canSeeLineage}
                />
              ) : null}
            </TabsContent>
            <TabsContent value="people" className="mt-4 pb-8">
              <OverviewTab detail={detail} />
            </TabsContent>
            <TabsContent value="structure" className="mt-4 pb-8">
              {activeTab === "structure" ? (
                <PersonStructureView
                  personId={state.structurePersonId ?? detail.profile.id}
                  rootPersonId={detail.profile.id}
                  onNavigate={(personId) => update({ structurePersonId: personId }, { history: "push" })}
                  profileHref={(personId) => `/supervisor/operators/${personId}?tab=indicators`}
                  manageHref={links.manageHref}
                />
              ) : null}
            </TabsContent>
          </Tabs>
        </main>
      </div>
    </div>
  )
}

/** Nível do escalonamento LEGADO (`performance_escalations`, anterior às políticas de acompanhamento) — só leitura. */
const LEGACY_LEVEL_LABELS: Record<string, string> = { OBSERVE: "Observar", ORIENT: "Orientar", COACH: "Treinar", ACTION_PLAN: "Plano de ação", MANAGER: "Gestor" }
const LEGACY_PLAN_STATUS_LABELS: Record<string, string> = { DRAFT: "Rascunho", ACTIVE: "Ativo", COMPLETED: "Concluído", CANCELLED: "Cancelado", PENDING: "Pendente", IN_PROGRESS: "Em andamento" }

function OverviewTab({ detail }: { detail: SupervisorOperatorDetail }) {
  const activePlans = detail.plans.filter((plan) => plan.status === "ACTIVE")
  return (
    <section className="w-full space-y-4 [&_[data-slot=card]]:border-0 [&_[data-slot=card]]:shadow-none">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardDescription>Perfil do colaborador</CardDescription>
              <CardTitle className="text-xl">{detail.profile.name}</CardTitle>
              <p className="text-sm text-muted-foreground">
                {detail.profile.jobTitle}
                {detail.profile.teamName ? ` · ${detail.profile.teamName}` : ""}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {activePlans.length > 0 ? <Badge variant="outline">{activePlans.length} plano(s) anterior(es) ativo(s)</Badge> : null}
            </div>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4 border-t pt-5 md:grid-cols-3">
          <div>
            <p className="text-xs font-medium">Sobre</p>
            <p className="mt-1 text-sm text-muted-foreground">{detail.profile.bio ?? "Perfil operacional"}</p>
          </div>
          <div>
            <p className="text-xs font-medium">Pontos fortes</p>
            <p className="mt-1 text-sm text-muted-foreground">{detail.profile.strengths.join(" · ") || "Não informado"}</p>
          </div>
          <div>
            <p className="text-xs font-medium">Foco de desenvolvimento</p>
            <p className="mt-1 text-sm text-muted-foreground">{detail.profile.developmentFocus.join(" · ") || "Não informado"}</p>
          </div>
        </CardContent>
      </Card>

      <PersonInterventions personId={detail.profile.id} />

      {detail.escalation ? (
        <Card className="bg-amber-500/5">
          <CardHeader>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">Escalonamento anterior às políticas · {LEGACY_LEVEL_LABELS[detail.escalation.currentLevel] ?? detail.escalation.currentLevel}</Badge>
              <Badge variant="secondary">Confiança IA {Math.round(detail.escalation.confidence * 100)}%</Badge>
            </div>
            <CardTitle>{detail.escalation.reason}</CardTitle>
            <CardDescription>
              {detail.escalation.consecutiveCycles} ciclos consecutivos · Recomendação: {detail.escalation.aiRecommendation}
            </CardDescription>
          </CardHeader>
        </Card>
      ) : null}

      <section className="space-y-3">
        <h3 className="px-1 text-base font-semibold">Planos de desenvolvimento anteriores</h3>
        {detail.plans.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-sm text-muted-foreground">Nenhum plano anterior registrado. Planos novos nascem como intervenções, acima.</CardContent>
          </Card>
        ) : (
          detail.plans.map((plan) => (
            <Card key={plan.id}>
              <CardHeader>
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <CardTitle>{plan.title}</CardTitle>
                    <CardDescription>{plan.objective}</CardDescription>
                  </div>
                  <Badge variant="outline">{LEGACY_PLAN_STATUS_LABELS[plan.status] ?? plan.status}</Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-2">
                {plan.actions.map((action) => (
                  <div key={action.id} className="flex items-start justify-between gap-3 rounded-lg bg-muted/50 p-3 text-sm">
                    <div>
                      <p className="font-medium">{action.description}</p>
                      <p className="text-xs text-muted-foreground">
                        {action.type} · prazo {String(action.dueAt).slice(0, 10)}
                      </p>
                    </div>
                    <Badge variant="outline">{LEGACY_PLAN_STATUS_LABELS[action.status] ?? action.status}</Badge>
                  </div>
                ))}
              </CardContent>
            </Card>
          ))
        )}
      </section>

      <section className="space-y-3">
        <h3 className="px-1 text-base font-semibold">Monitorias processadas</h3>
        {detail.monitorings.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-sm text-muted-foreground">Nenhuma monitoria processada.</CardContent>
          </Card>
        ) : (
          detail.monitorings.map((monitoring) => (
            <Card key={monitoring.id}>
              <CardHeader>
                <div className="flex flex-wrap gap-2">
                  <Badge variant={monitoring.severity === "HIGH" || monitoring.severity === "CRITICAL" ? "destructive" : "secondary"}>{monitoring.triggerTitle ?? "Amostra diária"}</Badge>
                  <Badge variant="outline">{monitoring.interactionReason}</Badge>
                  <Badge variant="outline">Nota {monitoring.score}</Badge>
                </div>
                <CardTitle>{monitoring.triggerReason ?? "Monitoria processada pela IA"}</CardTitle>
                <CardDescription>
                  Chamada {monitoring.interactionExternalId} · {monitoring.detectedAt ? new Date(monitoring.detectedAt).toLocaleString("pt-BR") : "processamento diário"}
                </CardDescription>
              </CardHeader>
              {monitoring.aiSummary ? <CardContent className="grid gap-3 md:grid-cols-3"><Insight icon={<ClipboardCheck />} title="Resumo" value={monitoring.aiSummary} /><Insight icon={<CheckCircle2 />} title="Acertos" value={monitoring.strengths.join(" · ") || "Não informado"} /><Insight icon={<CircleAlert />} title="Erros" value={monitoring.errors.join(" · ") || "Não informado"} /></CardContent> : null}
            </Card>
          ))
        )}
      </section>
      <p className="px-1 text-xs text-muted-foreground">
        <Target className="mr-1 inline size-3" aria-hidden />
        Indicadores e PRV oficiais ficam na aba Indicadores; feedbacks e monitorias publicados, na aba Acompanhamentos.
      </p>
    </section>
  )
}

function Insight({ icon, title, value }: { icon: React.ReactNode; title: string; value: string }) {
  return (
    <div className="rounded-lg bg-muted/50 p-3">
      <div className="flex items-center gap-2 text-primary [&_svg]:size-4">
        {icon}
        <p className="text-sm font-medium">{title}</p>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">{value}</p>
    </div>
  )
}
