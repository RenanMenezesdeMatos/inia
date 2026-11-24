"use client"

import { Suspense, useState } from "react"
import { Building2 } from "lucide-react"

import { AnalyticsEmptyState, AnalyticsErrorState } from "@/components/analytics/analytics-states"
import { StructureFollowUpFeed } from "@/components/follow-up/structure-follow-up-feed"
import { FollowupWorkspaceShell } from "@/components/operator/followup-workspace-shell"
import { OperatorFollowupWorkspace } from "@/components/operator/operator-followup-workspace"
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

  return (
    <div className="min-h-screen overflow-x-clip bg-muted text-foreground">
      <div className="mx-auto flex w-full max-w-7xl flex-col px-4 py-4 sm:px-6 sm:py-5 lg:px-8">
        <ProfileHeader person={ownHeaderPerson(baseProfile, me)} isOwn attached={!contextQuery.isError || Boolean(context)} actions={canPublishCommunications ? <PublishButton /> : undefined} />
        <main className="min-h-0">
          {contextQuery.isPending && !context ? <TabsSkeleton /> : null}
          {contextQuery.isError && !context ? <div className="mt-3"><AnalyticsErrorState error={contextQuery.error} onRetry={() => void contextQuery.refetch()} /></div> : null}
          {context ? (
            <Tabs value={activeTab} onValueChange={(value) => update({ tab: value as ProfileTab })} className="min-w-0">
              <ProfileTabsList tabs={tabs} active={activeTab} />
              {/* Acompanhamento do próprio operador: o feed à esquerda e o painel da INIA à direita. Fora dele o painel sai da árvore
                  no mesmo commit da troca de aba (ver o comentário do Acompanhamento abaixo). */}
              {/* A página rola: o cabeçalho sai de cena e a área para logo abaixo das abas fixas, ocupando o resto da janela
                  (janela − barra global 56 − abas 48 − margem 16 − respiro do fim 20). O piso vale para janelas muito baixas. */}
              {operatorSurface && activeTab === "followup" ? (
                <div role="tabpanel" aria-label={tabs.find((tab) => tab.value === activeTab)?.label} className="mt-4 h-[calc(100dvh-8.75rem)] min-h-[28rem]">
                  <OperatorFollowupWorkspace indicators={operatorSurface.indicators} operator={profile} highlightItemKey={state.item} />
                </div>
              ) : null}
              {/* A Surface só é renderizada enquanto a aba está ativa, e não via o ciclo de
                  desmontagem do Radix Presence: ela carrega o Canvas WebGL do avatar, que precisa
                  sair da árvore no MESMO commit da troca de aba — no ciclo adiado do Presence o
                  R3F ainda recebe uma remedição de tamanho e reconfigura um canvas prestes a
                  morrer (ver inia-humanoid-avatar-3d.tsx). No perfil do operador este painel fica vazio (a área dele é a de cima) e não
                  pode ocupar espaço: margem + respiro vazios somavam 48 px à faixa em branco no fim da página. */}
              <TabsContent value="followup" className={cn("mt-4", context.defaultSubject ? "pb-5" : "pb-8", operatorSurface && "hidden")}>
                {activeTab !== "followup" || operatorSurface ? null : !context.defaultSubject ? (
                  <NoStructureState support={context?.viewer.role === "STAFF"} />
                ) : (
                  // Mesmo formato do Acompanhamento do operador (18/11/2026): área que para logo abaixo das abas, chat recolhível ao lado.
                  <div className="h-[calc(100dvh-8.75rem)] min-h-[28rem]">
                  <FollowupWorkspaceShell
                    docked
                    feed={<StructureFollowUpFeed subject={null} description="Feedbacks, resultados de workflow e escalonamentos da sua estrutura" employeeHref={(personId) => employeeProfileHref(personId, "followup")} unacknowledgedOnly={state.ackPending} onUnacknowledgedOnlyChange={(value) => update({ ackPending: value })} highlightItemId={state.item} audienceFilter />}
                    renderChat={({ onCollapse, hidden }) => <OperatorIniaChat indicators={EMPTY_INDICATORS} operator={profile} context="team" onCollapse={onCollapse} hidden={hidden} />}
                  />
                  </div>
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
      </div>
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
      <div className="mx-auto flex w-full max-w-7xl flex-col px-4 py-4 sm:px-6 sm:py-5 lg:px-8">
        <ProfileHeader person={person} isOwn attached />
        <TabsSkeleton />
      </div>
    </div>
  )
}
