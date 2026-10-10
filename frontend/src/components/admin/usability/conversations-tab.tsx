"use client"

import { ListPagination } from "@/components/admin/shared/list/list-pagination"
import { Button } from "@/components/ui/button"
import { useUsabilityTabQuery } from "@/queries/admin/use-usability-queries"
import type { UsabilityConversations } from "@/schemas/admin/usability.schema"
import type { UsabilityQuery } from "@/services/admin/usability-service"

import { CONVERSATION_ORIGIN_LABELS, formatCount, formatDecimal, formatDuration, formatInstant, formatMs, formatPercent } from "./usability-format"
import { DataTable, EmptyNote, ExportButton, Section, StatTile, SubjectLink, usePanel } from "./usability-shared"
import { TabFrame } from "./usability-tab-frame"

type Origin = { origin: string; kind: string; conversations: number; humanMessages: number; iniaMessages: number; people: number }
type Latency = { measured: number; median: number | null; p95: number | null; byOutcome: Record<string, number> }
type Cost = { note: string; byUseCase: { useCase: string; events: number; tokens: number | null; cost: string | null; currency: string | null; unknownCostEvents: number }[] }
type Item = { conversationId: string; ownerPersonId: string; ownerName: string | null; origin: string; kind: string; userText: number; userVoice: number; inia: number; firstAt: string; lastAt: string; contentHref: string | null }

const OUTCOME_LABELS: Record<string, string> = { OK: "respondeu", INTERRUPTED: "interrompida", TIMEOUT: "sem resposta a tempo", FAILED: "falhou" }

export function ConversationsTab({ query }: { query: UsabilityQuery }) {
  const result = useUsabilityTabQuery("conversations", query)
  return <TabFrame result={result}>{(data) => <ConversationsContent data={data} fetching={result.isFetching} />}</TabFrame>
}

function ConversationsContent({ data, fetching }: { data: UsabilityConversations; fetching: boolean }) {
  const { setFilters, timezone } = usePanel()
  const conversations = data.conversations as { created: number; withHumanParticipation: number; textOnly: number; voiceOnly: number; mixed: number; classificationBasis: string }
  const perPersonDay = data.perPersonDay as { personDays: number; messagesPerPersonDay: number | null; conversationsPerPersonDay: number | null }
  const response = data.responseRate as { eligible: number; answered: number; pending: number; value: number | null; windowMinutes: number }
  const latency = data.latency as { chatFirstText: Latency; voiceFirstAudio: Latency }
  const cost = data.cost as Cost
  const origins = data.origins as unknown as Origin[]
  const items = data.items as unknown as Item[] | null
  const voice = data.voice
  const ui = data.chatUi

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <ExportButton table="summary" label="Exportar resumo" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Pessoas que conversaram" value={formatCount(data.people.used)} hint={`texto ${formatCount(data.people.text)} · voz ${formatCount(data.people.voice)} · as duas ${formatCount(data.people.both)}`} metricId="chat.people" />
        <StatTile label="Conversas com participação humana" value={formatCount(conversations.withHumanParticipation)} hint={`${formatCount(conversations.created)} criadas · só texto ${conversations.textOnly} · só voz ${conversations.voiceOnly} · mistas ${conversations.mixed}`} metricId="chat.conversations" />
        <StatTile label="Mensagens da pessoa" value={formatCount(data.messages.userText + data.messages.userVoiceTurns)} hint={`${formatCount(data.messages.userText)} digitadas · ${formatCount(data.messages.userVoiceTurns)} turnos de voz`} />
        <StatTile label="Respostas da INIA" value={formatCount(data.messages.iniaText + data.messages.iniaVoice)} hint={`${formatCount(data.messages.proactive)} recados/apresentações por iniciativa da INIA (não contam como participação)`} />
      </div>
      <p className="text-xs text-muted-foreground">{conversations.classificationBasis}.</p>

      <div className="grid gap-4 xl:grid-cols-3">
        <Section title="Intensidade" description="Por pessoa-dia com conversa e por conversa.">
          <div className="grid gap-2">
            <StatTile label="Mensagens por pessoa-dia" value={formatDecimal(perPersonDay.messagesPerPersonDay)} hint={`${formatCount(perPersonDay.personDays)} pessoa(s)-dia`} />
            <StatTile label="Conversas por pessoa-dia" value={formatDecimal(perPersonDay.conversationsPerPersonDay)} />
            <StatTile label="Mensagens da pessoa por conversa (mediana)" value={formatDecimal(data.perConversation.median)} hint={`p95 ${formatDecimal(data.perConversation.p95)}`} />
          </div>
        </Section>
        <Section title="A INIA respondeu?" description={`Mensagem da pessoa com resposta gravada em até ${response.windowMinutes} min.`} metricId="chat.response_rate">
          <div className="grid gap-2">
            <StatTile label="Respondidas" value={response.eligible ? formatPercent(response.value) : "Sem base"} hint={`${formatCount(response.answered)} de ${formatCount(response.eligible)}${response.pending ? ` · ${response.pending} ainda dentro da janela` : ""}`} />
            <StatTile label="Até o primeiro texto (mediana)" value={formatMs(latency.chatFirstText.median)} hint={`p95 ${formatMs(latency.chatFirstText.p95)} · ${formatCount(latency.chatFirstText.measured)} medidas · ${outcomes(latency.chatFirstText)}`} />
            <StatTile label="Até a primeira fala (mediana)" value={formatMs(latency.voiceFirstAudio.median)} hint={`p95 ${formatMs(latency.voiceFirstAudio.p95)} · ${formatCount(latency.voiceFirstAudio.measured)} medidas · ${outcomes(latency.voiceFirstAudio)}`} />
          </div>
        </Section>
        <Section title="Uso da tela da conversa" description="O que aconteceu no painel da INIA (navegador) × o que ficou gravado (oficial).">
          <div className="grid grid-cols-2 gap-2">
            <StatTile label="Painel aberto" value={formatCount(ui.panelViews)} hint={`${formatCount(ui.openedWithoutMessage)} sem mensagem`} />
            <StatTile label="Envios tentados" value={formatCount(ui.attempted)} hint={`${formatCount(ui.failed)} falharam · ${formatCount(ui.cancelled)} cancelados`} />
            <StatTile label="Confirmados na tela" value={formatCount(ui.persistedAck)} />
            <StatTile label="Gravados (oficial)" value={formatCount(ui.persistedOfficial)} />
          </div>
        </Section>
      </div>

      <Section title="Voz" description="Microfone ligado não é fala; conexão sem fala não conta como uso de voz. Reconexão mantém a mesma intenção.">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile label="Intenções de voz" value={formatCount(voice.intents)} hint={`${formatCount(voice.established)} conectadas · ${formatCount(voice.failed)} falharam · ${formatCount(voice.intentsWithReconnection)} com reconexão`} />
          <StatTile label="Com fala da pessoa" value={formatCount(voice.withSpeech)} hint={`${formatCount(voice.withoutSpeech)} sem fala`} />
          <StatTile label="Tempo conectado" value={formatDuration(voice.connectedSeconds)} hint={`microfone ${formatDuration(voice.micSeconds)} · fala da INIA ${formatDuration(voice.playbackSeconds)}`} />
          <StatTile label="Permissão do microfone" value={formatCount(voice.permissionGranted)} hint={`${formatCount(voice.permissionDenied)} negadas · ${formatCount(voice.micUnavailable)} indisponível`} />
          <StatTile label="Interrupções da fala" value={formatCount(voice.interruptions)} hint={`${formatCount(voice.interruptionsAllContexts)} em todos os contextos`} />
          <StatTile label="Mudanças de modo" value={formatCount(voice.modeChanges)} hint="silenciar, microfone, câmera" />
          <StatTile label="Apresentações repetidas" value={formatCount(voice.presentationRepeats)} hint={`${formatCount(voice.applicationPauses)} pausas · ${formatCount(voice.applicationResumes)} retomadas`} />
          <StatTile label="Sessões emitidas (servidor)" value={formatCount(voice.sessionsIssued)} />
        </div>
      </Section>

      <div className="grid gap-4 xl:grid-cols-2">
        <Section title="Por origem da conversa" actions={<ExportButton table="origins" />}>
          <DataTable
            rows={origins}
            rowKey={(row) => `${row.origin}|${row.kind}`}
            caption="Origens"
            columns={[
              { key: "origin", header: "Origem", cell: (row) => `${CONVERSATION_ORIGIN_LABELS[row.origin] ?? row.origin}${row.kind === "LEGACY_HISTORY" ? " (histórico anterior)" : ""}` },
              { key: "conversations", header: "Conversas", align: "right", cell: (row) => formatCount(row.conversations) },
              { key: "human", header: "Mensagens da pessoa", align: "right", cell: (row) => formatCount(row.humanMessages) },
              { key: "inia", header: "Da INIA", align: "right", cell: (row) => formatCount(row.iniaMessages) },
              { key: "people", header: "Pessoas", align: "right", cell: (row) => formatCount(row.people) },
            ]}
          />
        </Section>
        <Section title="Custo de IA das conversas" description={cost.note}>
          <DataTable
            rows={cost.byUseCase}
            rowKey={(row) => row.useCase}
            empty="Nenhum uso de IA de conversa registrado no período."
            caption="Custo por uso"
            columns={[
              { key: "useCase", header: "Uso", cell: (row) => row.useCase },
              { key: "events", header: "Chamadas", align: "right", cell: (row) => formatCount(row.events) },
              { key: "tokens", header: "Tokens", align: "right", cell: (row) => formatCount(row.tokens) },
              { key: "cost", header: "Custo estimado", align: "right", cell: (row) => (row.cost ? `${row.currency ?? ""} ${Number(row.cost).toFixed(4)}` : "Sem preço") },
            ]}
          />
        </Section>
      </div>

      <Section title="Conversas" description="Conversas com mensagem da pessoa no período. O conteúdo só abre com a permissão de ler conversas." actions={data.identified ? <ExportButton table="items" label="Exportar conversas" /> : null}>
        {data.identified && items ? (
          <div className="space-y-3" aria-busy={fetching}>
            <DataTable
              rows={items}
              rowKey={(row) => row.conversationId}
              caption="Conversas"
              columns={[
                { key: "who", header: "Pessoa", cell: (row) => <SubjectLink personId={row.ownerPersonId} name={row.ownerName} /> },
                { key: "origin", header: "Origem", cell: (row) => CONVERSATION_ORIGIN_LABELS[row.origin] ?? row.origin },
                { key: "text", header: "Digitadas", align: "right", cell: (row) => formatCount(row.userText) },
                { key: "voice", header: "Voz", align: "right", cell: (row) => formatCount(row.userVoice) },
                { key: "inia", header: "INIA", align: "right", cell: (row) => formatCount(row.inia) },
                { key: "when", header: "Período", cell: (row) => <span className="text-xs">{`${formatInstant(row.firstAt, timezone)} → ${formatInstant(row.lastAt, timezone)}`}</span> },
                {
                  key: "open",
                  header: <span className="sr-only">Conteúdo</span>,
                  cell: (row) =>
                    row.contentHref ? (
                      <a href={row.contentHref} className="text-xs font-medium text-primary underline-offset-2 hover:underline" data-usage-element="usability.drilldown">
                        Ler conversa
                      </a>
                    ) : null,
                },
              ]}
            />
            {data.total === null ? (
              <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                Esta página está vazia.
                <Button type="button" variant="ghost" size="sm" onClick={() => setFilters({ page: undefined })}>
                  Voltar à primeira página
                </Button>
              </div>
            ) : (
              <ListPagination
                page={data.page}
                pageSize={data.pageSize}
                total={data.total}
                itemLabel={["conversa", "conversas"]}
                isFetching={fetching}
                onPageChange={(page) => setFilters({ page: page === 1 ? undefined : String(page) })}
                onPageSizeChange={(pageSize) => setFilters({ pageSize: pageSize === 25 ? undefined : String(pageSize), page: undefined })}
              />
            )}
          </div>
        ) : (
          <EmptyNote>A lista de conversas por pessoa exige a permissão de ver pessoas identificadas.</EmptyNote>
        )}
      </Section>
    </div>
  )
}

function outcomes(latency: Latency) {
  const entries = Object.entries(latency.byOutcome)
  return entries.length ? entries.map(([outcome, count]) => `${count} ${OUTCOME_LABELS[outcome] ?? outcome}`).join(", ") : "sem medidas"
}
