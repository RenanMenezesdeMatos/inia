"use client"

import { Suspense, useState } from "react"
import { Building2 } from "lucide-react"

import { AnalyticsEmptyState, AnalyticsErrorState } from "@/components/analytics/analytics-states"
import { StructureFollowUpFeed } from "@/components/follow-up/structure-follow-up-feed"
import { FollowupFeedArea } from "@/components/operator/followup-feed-area"
import { IniaPanelShell } from "@/components/operator/inia-panel/inia-panel-shell"
import { OperatorDailyFeedbackFeed } from "@/components/operator/operator-daily-feedback-feed"
import { OperatorIniaChat } from "@/components/operator/operator-inia-chat"
import { PendingActionsView } from "@/components/pending/pending-actions-view"
import { ProfileHeader, type ProfileHeaderPerson } from "@/components/profile/profile-header"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent } from "@/components/ui/tabs"
import { useAnalyticsUrlState, type ProfileTab } from "@/hooks/use-analytics-url-state"
import type { OperatorIndicatorsData, OperatorProfile } from "@/schemas/operator"
import { useAnalyticsContextQuery } from "@/queries/analytics/use-analytics-queries"
import { useMyProfileQuery } from "@/queries/profile/use-my-profile"
import { profileImageSrc } from "@/lib/profile/profile-image-src"
import { cn } from "@/lib/utils"
import type { MyProfile } from "@/schemas/profile/my-profile.schema"
import type { AnalyticsContext } from "@/schemas/analytics/analytics.schema"
import { NO_ACCESS_CAPABILITIES, profileLinksFor, type AccessCapabilities } from "@/schemas/auth/auth.schema"


import { PublishButton } from "@/components/publications/publish-button"
// Abas fora da entrada (Indicadores, Equipe, Calendário, Estrutura) chegam sob demanda; o Acompanhamento — aba de entrada, com o
// avatar — continua importado direto.
import { IndicatorsView, MyJourneyView, PersonStructureView, TeamCalendarView, TeamView } from "./profile-tab-views"
import { ProfileTabsList, profileTabsFor } from "./profile-tabs"
import { AnjoWorkspace } from "@/components/human-support/anjo/anjo-workspace"
import { useAnjoWorkspace } from "@/queries/human-support/anjo-workspace-provider"

/** Dados da Surface Acompanhamento do PRÓPRIO operador (feed + contexto do chat) — só existem no
 * perfil de Operador; gestores usam o feed da estrutura. */
export type OperatorSurfaceData = { indicators: OperatorIndicatorsData }

const EMPTY_INDICATORS: OperatorIndicatorsData = { current: [], history: [] }

export function employeeProfileHref(personId: string, tab: ProfileTab = "indicators"): string {
  return `/supervisor/operators/${personId}?tab=${tab}`
}

/**
 * Shell ÚNICO do perfil para todos os papéis: header (preservado), abas por capabilities e as
 * três experiências — Acompanhamento (Surface), Indicadores (analítica) e Equipe/Estrutura
 * (gestão). Nada aqui ramifica por role: quem diz o que existe é o contexto vindo do backend.
 */
type WorkspaceProps = { profile: OperatorProfile; initialMyProfile?: MyProfile | null; initialContext: AnalyticsContext | null; operatorSurface: OperatorSurfaceData | null; capabilities?: AccessCapabilities }

/** Pessoa do cabeçalho do PRÓPRIO perfil: a apresentação vinda do backend (nome escolhido, foto, capa); sem ela, o cadastro. */
function ownHeaderPerson(profile: OperatorProfile, me: MyProfile | null | undefined): ProfileHeaderPerson {
  if (!me) return { displayName: profile.name, registeredName: profile.name, avatarUrl: profile.avatarUrl, jobTitle: profile.role }
  return { displayName: me.displayName, registeredName: me.registeredName, avatarUrl: me.avatarUrl, cover: me.cover, jobTitle: me.professional.jobTitle ?? profile.role, teamName: me.professional.teamName }
}

export function ProfileWorkspace({ profile, initialMyProfile = null, initialContext, operatorSurface, capabilities = NO_ACCESS_CAPABILITIES }: WorkspaceProps) {
  return (
    <Suspense fallback={<WorkspaceSkeleton person={ownHeaderPerson(profile, initialMyProfile)} />}>
      <ProfileWorkspaceContent profile={profile} initialMyProfile={initialMyProfile} initialContext={initialContext} operatorSurface={operatorSurface} capabilities={capabilities} />
    </Suspense>
  )
}

function ProfileWorkspaceContent({ profile: baseProfile, initialMyProfile, initialContext, operatorSurface, capabilities = NO_ACCESS_CAPABILITIES }: WorkspaceProps) {
  // O próprio perfil lê as preferências por query: salvar no editor atualiza cabeçalho e chat sem recarregar.
  const me = useMyProfileQuery(initialMyProfile).data ?? initialMyProfile
  const profile: OperatorProfile = me ? { ...baseProfile, avatarUrl: profileImageSrc(me.avatarUrl) ?? null, displayName: me.displayName, addressName: me.addressName } : baseProfile
  const links = profileLinksFor(capabilities)
  const { state, update } = useAnalyticsUrlState()
  const contextQuery = useAnalyticsContextQuery(null, initialContext)
  const context = contextQuery.data ?? null
  // Apoio com Anjo: a área do Anjo é uma aba do perfil para quem tem o papel (capability do backend); o número vem do provedor no shell.
  const anjoWorkspace = useAnjoWorkspace()
  const isAnjo = capabilities.canAttendHumanSupport && anjoWorkspace.available
  const tabs = context ? profileTabsFor(context.capabilities, context.pendingActionCount, isAnjo ? { unread: anjoWorkspace.attention.unread, awaitingResponse: anjoWorkspace.attention.awaitingResponse, attendances: anjoWorkspace.attention.attendances, presence: anjoWorkspace.presence } : null) : []
  const activeTab: ProfileTab = tabs.some((tab) => tab.value === state.tab) ? state.tab : "followup"
  // A área do Anjo só monta na primeira vez que a aba é aberta e depois fica montada (escondida): trocar de aba não perde o texto
  // digitado nem a posição das conversas. A conexão do Anjo não depende disso (vive no shell).
  const [anjoOpened, setAnjoOpened] = useState(false)
  if (activeTab === "apoio" && !anjoOpened) setAnjoOpened(true)

  // Comunicados: o botão só para quem tem a permissão (o servidor confere de novo e calcula o público).
  const canPublishCommunications = capabilities.canPublishTeamCommunications || capabilities.canPublishOrganizationCommunications

  // O painel da INIA fica acima das abas: trocar de aba não desmonta o chat (conversa, rascunho e chamada continuam, e o Canvas do avatar não
  // passa pelo ciclo de desmontagem do Radix). Quem não tem estrutura (Apoio) não tem o painel.
  const renderChat = !context ? undefined
    : operatorSurface ? (chat: { hidden: boolean }) => <OperatorIniaChat indicators={operatorSurface.indicators} operator={profile} {...chat} />
      : context.defaultSubject ? (chat: { hidden: boolean }) => <OperatorIniaChat indicators={EMPTY_INDICATORS} operator={profile} context="team" {...chat} /> : undefined

  return (
    <div className="min-h-screen overflow-x-clip bg-muted text-foreground">
      <IniaPanelShell renderChat={renderChat} feedbackInvites={operatorSurface !== null} startClosedOnNarrow={activeTab !== "followup" || state.item !== null} destination={`${state.tab}:${state.item ?? ""}`} feedVisible={activeTab === "followup"} onShowFeed={() => update({ tab: "followup" })}>
        <ProfileHeader person={ownHeaderPerson(baseProfile, me)} isOwn attached={!contextQuery.isError || Boolean(context)} actions={canPublishCommunications ? <PublishButton /> : undefined} />
        <main className="min-h-0">
          {contextQuery.isPending && !context ? <TabsSkeleton /> : null}
          {contextQuery.isError && !context ? <div className="mt-3"><AnalyticsErrorState error={contextQuery.error} onRetry={() => void contextQuery.refetch()} /></div> : null}
          {context ? (
            <Tabs value={activeTab} onValueChange={(value) => update({ tab: value as ProfileTab })} className="min-w-0">
              <ProfileTabsList tabs={tabs} active={activeTab} />
              <TabsContent value="followup" className={cn("mt-4", !operatorSurface && !context.defaultSubject && "pb-8")}>
                {activeTab !== "followup" ? null : operatorSurface ? (
                  <FollowupFeedArea><OperatorDailyFeedbackFeed indicators={operatorSurface.indicators} highlightItemKey={state.item} /></FollowupFeedArea>
                ) : !context.defaultSubject ? (
                  <NoStructureState support={context?.viewer.role === "STAFF"} />
                ) : (
                  <FollowupFeedArea>
                    <StructureFollowUpFeed subject={null} description="Feedbacks, resultados de workflow e escalonamentos da sua estrutura" employeeHref={(personId) => employeeProfileHref(personId, "followup")} unacknowledgedOnly={state.ackPending} onUnacknowledgedOnlyChange={(value) => update({ ackPending: value })} highlightItemId={state.item} audienceFilter />
                  </FollowupFeedArea>
                )}
              </TabsContent>
              {isAnjo ? (
                <TabsContent value="apoio" forceMount className="mt-4 pb-8 data-[state=inactive]:hidden">
                  {anjoOpened ? <AnjoWorkspace embedded visible={activeTab === "apoio"} /> : null}
                </TabsContent>
              ) : null}
              <TabsContent value="indicators" className="mt-4 pb-8">
                {context.defaultSubject ? (
                  <IndicatorsView context={context} state={{ subject: state.subject, period: state.period, comparison: state.comparison, indicator: state.indicator, groupBy: state.groupBy }} onStateChange={update} employeeHref={(personId) => employeeProfileHref(personId, "indicators")} canSeeLineage={links.canSeeLineage} />
                ) : (
                  <NoStructureState support={context?.viewer.role === "STAFF"} />
                )}
              </TabsContent>
              {context.capabilities.tabs.includes("PEOPLE") ? (
                <TabsContent value="people" className="mt-4 pb-8">
                  {context.defaultSubject ? <TeamView context={context} state={{ subject: state.subject, period: state.period, situation: state.situation, attention: state.attention }} onStateChange={update} employeeHref={(personId) => employeeProfileHref(personId, "indicators")} /> : <NoStructureState support={context?.viewer.role === "STAFF"} />}
                </TabsContent>
              ) : null}
              {context.capabilities.tabs.includes("JOURNEY") ? (
                <TabsContent value="journey" className="mt-4 pb-8">
                  {/* Só monta quando ativa: a consulta da escala não dispara ao abrir o perfil. */}
                  {activeTab === "journey" ? <MyJourneyView /> : null}
                </TabsContent>
              ) : null}
              {context.capabilities.tabs.includes("CALENDAR") ? (
                <TabsContent value="calendar" className="mt-4 pb-8">
                  {/* Só monta quando ativa: a consulta do calendário não dispara ao abrir o perfil. */}
                  {activeTab === "calendar" ? (
                    <TeamCalendarView
                      state={{ calendarDate: state.calendarDate, calendarPerson: state.calendarPerson, calendarAnchor: state.calendarAnchor }}
                      onStateChange={update}
                      employeeHref={(personId) => employeeProfileHref(personId, "indicators")}
                      pendingHref={(reconciliationId) => `/supervisor?tab=pending&review=${encodeURIComponent(`workday:${reconciliationId}`)}`}
                    />
                  ) : null}
                </TabsContent>
              ) : null}
              {context.capabilities.tabs.includes("PENDING") ? (
                <TabsContent value="pending" className="mt-4 pb-8">
                  <PendingActionsView state={{ review: state.review, operator: state.operator }} onStateChange={update} employeeHref={(personId) => employeeProfileHref(personId, "indicators")} />
                </TabsContent>
              ) : null}
              {context.capabilities.tabs.includes("STRUCTURE") ? (
                <TabsContent value="structure" className="mt-4 pb-8">
                  {/* Só monta quando ativa: a consulta de estrutura não dispara ao abrir o perfil. */}
                  {activeTab === "structure" ? (
                    <PersonStructureView
                      personId={state.structurePersonId ?? context.viewer.personId}
                      rootPersonId={context.viewer.personId}
                      onNavigate={(personId) => update({ structurePersonId: personId }, { history: "push" })}
                      profileHref={(personId) => employeeProfileHref(personId, "indicators")}
                      manageHref={links.manageHref}
                    />
                  ) : null}
                </TabsContent>
              ) : null}
            </Tabs>
          ) : null}
        </main>
      </IniaPanelShell>
    </div>
  )
}

/** Apoio (estagiário, analista…) não acompanha indicadores nem lidera equipe: não é cadastro incompleto. */
function NoStructureState({ support }: { support: boolean }) {
  return (
    <section className="rounded-xl bg-card p-6">
      <AnalyticsEmptyState
        icon={Building2}
        title={support ? "Seu cargo não acompanha indicadores" : "Seu perfil não possui estrutura vinculada"}
        description={support ? "Indicadores e Equipe são de quem atende clientes ou lidera uma equipe. Seu perfil, suas preferências e o Organograma continuam disponíveis." : "Indicadores e Equipe dependem de um vínculo na hierarquia (quem reporta a quem). Seu perfil e suas preferências continuam disponíveis; para aparecer na estrutura, o vínculo precisa ser ajustado no cadastro."}
      />
    </section>
  )
}

/** Mesma forma da faixa de abas (encaixada no card) enquanto o contexto carrega — sem salto de layout. */
function TabsSkeleton() {
  return (
    <div className="flex h-12 items-center gap-4 rounded-b-xl border-t border-border/60 bg-card px-4" aria-hidden>
      <Skeleton className="h-4 w-32" />
      <Skeleton className="h-4 w-24" />
      <Skeleton className="h-4 w-28" />
    </div>
  )
}

function WorkspaceSkeleton({ person }: { person: ProfileHeaderPerson }) {
  return (
    <div className="min-h-screen overflow-x-clip bg-muted text-foreground">
      <div className="mx-auto flex w-full max-w-[90rem] flex-col px-4 py-4 sm:px-6 sm:py-5">
        <ProfileHeader person={person} isOwn attached />
        <TabsSkeleton />
      </div>
    </div>
  )
}
