"use client"

import type { ReactNode } from "react"
import { Plus, Trash2 } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import {
  GUIDANCE_MODALITY_LABELS,
  POINT_GROUP_MODE_LABELS,
  type ArgumentScriptContent,
  type ArgumentScriptContentInput,
  type GuidanceModality,
  type PointGroupMode,
} from "@/schemas/admin/argument-script.schema"
import type { KnowledgeDocument } from "@/schemas/admin/knowledge.schema"

/**
 * Campos do argumentário. Cada seção guarda um SIGNIFICADO diferente (situação, exceção, o que deve/pode ser feito, o que
 * precisa ser dito, o que evitar, exemplo, referência) — a tela só ajuda o administrador a dizer a regra. Nada de palavra-chave,
 * prompt ou configuração técnica; as chaves dos itens são do servidor e nunca aparecem.
 */

let uidSequence = 0
const nextUid = () => `new-${++uidSequence}`

export type GuidanceRow = { uid: string; key: string | null; text: string; modality: GuidanceModality }
export type PointRow = { uid: string; key: string | null; text: string; condition: string }
export type PointGroupRow = { uid: string; key: string | null; mode: PointGroupMode; items: PointRow[] }
export type AvoidRow = { uid: string; key: string | null; text: string }

export type ContentFormState = {
  trigger: string
  notApplicableWhen: string
  operatorGuidance: GuidanceRow[]
  requiredPoints: PointGroupRow[]
  avoid: AvoidRow[]
  suggestedScript: string
  monitoringReference: string
  legacyExpectation: string | null
  sourceDocumentId: string | null
  sourceReference: string
}

export const EMPTY_CONTENT_FORM: ContentFormState = {
  trigger: "",
  notApplicableWhen: "",
  operatorGuidance: [],
  requiredPoints: [],
  avoid: [],
  suggestedScript: "",
  monitoringReference: "",
  legacyExpectation: null,
  sourceDocumentId: null,
  sourceReference: "",
}

export function contentToForm(content: ArgumentScriptContent | null, source: { sourceDocumentId: string | null; sourceReference: string | null } = { sourceDocumentId: null, sourceReference: null }): ContentFormState {
  if (!content) return { ...EMPTY_CONTENT_FORM, sourceDocumentId: source.sourceDocumentId, sourceReference: source.sourceReference ?? "" }
  return {
    trigger: content.trigger ?? "",
    notApplicableWhen: content.notApplicableWhen ?? "",
    operatorGuidance: content.operatorGuidance.map((item) => ({ uid: `k-${item.key}`, key: item.key, text: item.text, modality: item.modality })),
    requiredPoints: content.requiredPoints.map((group) => ({
      uid: `k-${group.key}`,
      key: group.key,
      mode: group.mode,
      items: group.items.map((item) => ({ uid: `k-${item.key}`, key: item.key, text: item.text, condition: item.condition ?? "" })),
    })),
    avoid: content.avoid.map((item) => ({ uid: `k-${item.key}`, key: item.key, text: item.text })),
    suggestedScript: content.suggestedScript ?? "",
    monitoringReference: content.monitoringReference ?? "",
    legacyExpectation: content.legacyExpectation ?? null,
    sourceDocumentId: source.sourceDocumentId,
    sourceReference: source.sourceReference ?? "",
  }
}

const textOrNull = (value: string) => (value.trim() ? value.trim() : null)
const withKey = (key: string | null) => (key ? { key } : {})

/** Linhas em branco são ignoradas (campo não preenchido); item existente devolve a sua chave, item novo vai sem ela. */
export function formToContent(state: ContentFormState): ArgumentScriptContentInput {
  return {
    schemaVersion: 1,
    trigger: textOrNull(state.trigger),
    notApplicableWhen: textOrNull(state.notApplicableWhen),
    operatorGuidance: state.operatorGuidance.filter((row) => row.text.trim()).map((row) => ({ ...withKey(row.key), text: row.text.trim(), modality: row.modality })),
    requiredPoints: state.requiredPoints
      .map((group) => ({
        ...withKey(group.key),
        mode: group.mode,
        items: group.items.filter((item) => item.text.trim()).map((item) => ({ ...withKey(item.key), text: item.text.trim(), condition: textOrNull(item.condition) })),
      }))
      .filter((group) => group.items.length > 0),
    avoid: state.avoid.filter((row) => row.text.trim()).map((row) => ({ ...withKey(row.key), text: row.text.trim() })),
    suggestedScript: textOrNull(state.suggestedScript),
    monitoringReference: textOrNull(state.monitoringReference),
    ...(state.legacyExpectation ? { legacyExpectation: state.legacyExpectation } : {}),
  }
}

/** Fonte de origem no formato da API (vazio = nenhum). */
export function formSource(state: ContentFormState) {
  return { sourceDocumentId: state.sourceDocumentId, sourceReference: textOrNull(state.sourceReference) }
}

export function FormSection({ title, description, children, testId }: { title: string; description?: ReactNode; children: ReactNode; testId?: string }) {
  return (
    <section className="space-y-3 rounded-lg border p-4" data-testid={testId}>
      <div className="space-y-0.5">
        <h3 className="text-sm font-semibold">{title}</h3>
        {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
      </div>
      {children}
    </section>
  )
}

export function LegacyExpectationBox({ text }: { text: string }) {
  return (
    <div className="space-y-1 rounded-lg border border-dashed bg-muted/40 p-3" data-testid="legacy-expectation">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Texto do cadastro antigo</p>
      <p className="whitespace-pre-line text-sm text-muted-foreground">{text}</p>
      <p className="text-xs text-muted-foreground">Distribua este texto nos campos abaixo. Ele continua guardado no histórico do argumentário.</p>
    </div>
  )
}

export const SECTION_HELP = {
  trigger: "A situação que precisa acontecer na chamada para o argumentário valer (ex.: cliente pede para cancelar por causa do preço). Descreva a situação — não liste palavras-chave.",
  notApplicableWhen: "Situações parecidas em que o argumentário não vale (opcional).",
  operatorGuidance: "O que o operador deve fazer (obrigatório) ou pode fazer (opcional). “Pode” nunca é cobrado como obrigação.",
  requiredPoints: "O que precisa ser comunicado ao cliente quando a condição se aplica. Dizer com outras palavras, com o mesmo sentido, também cumpre.",
  avoid: "Condutas ou promessas que o operador não deve ter nesta situação.",
  suggestedScript: "Exemplo de abordagem. Não é texto obrigatório e não é comparado literalmente com a fala.",
  monitoringReference: "Ajuda a reconhecer a evidência esperada na conversa. Não cria uma regra nova.",
  source: "Opcional. O argumentário complementa o procedimento: não altera prazos, alçadas ou condições definidos na base.",
} as const

const NO_DOCUMENT = "__none__"

export function ArgumentScriptContentFields({
  value,
  onChange,
  knowledgeDocuments,
  knowledgeUnavailable = false,
  currentSourceTitle,
}: {
  value: ContentFormState
  onChange: (next: ContentFormState) => void
  knowledgeDocuments: KnowledgeDocument[] | undefined
  knowledgeUnavailable?: boolean
  currentSourceTitle?: string | null
}) {
  const set = (patch: Partial<ContentFormState>) => onChange({ ...value, ...patch })

  const updateGuidance = (uid: string, patch: Partial<GuidanceRow>) => set({ operatorGuidance: value.operatorGuidance.map((row) => (row.uid === uid ? { ...row, ...patch } : row)) })
  const updateGroup = (uid: string, update: (group: PointGroupRow) => PointGroupRow) => set({ requiredPoints: value.requiredPoints.map((group) => (group.uid === uid ? update(group) : group)) })
  const updateAvoid = (uid: string, patch: Partial<AvoidRow>) => set({ avoid: value.avoid.map((row) => (row.uid === uid ? { ...row, ...patch } : row)) })

  const documentOptions = [...(knowledgeDocuments ?? [])].sort((a, b) => a.title.localeCompare(b.title, "pt-BR"))
  const selectedMissing = value.sourceDocumentId !== null && !documentOptions.some((document) => document.id === value.sourceDocumentId)

  return (
    <div className="space-y-4">
      {value.legacyExpectation ? <LegacyExpectationBox text={value.legacyExpectation} /> : null}

      <FormSection title="Condição ou gatilho" description={SECTION_HELP.trigger}>
        <Textarea aria-label="Condição ou gatilho" value={value.trigger} onChange={(event) => set({ trigger: event.target.value })} rows={2} maxLength={1200} placeholder="Ex.: O cliente informa que quer cancelar porque encontrou um preço menor." />
      </FormSection>

      <FormSection title="Quando não se aplica" description={SECTION_HELP.notApplicableWhen}>
        <Textarea aria-label="Quando não se aplica" value={value.notApplicableWhen} onChange={(event) => set({ notApplicableWhen: event.target.value })} rows={2} maxLength={1200} placeholder="Ex.: Quando o cancelamento é por mudança de endereço sem cobertura." />
      </FormSection>

      <FormSection title="Orientação ao operador" description={SECTION_HELP.operatorGuidance} testId="section-guidance">
        {value.operatorGuidance.length === 0 ? <p className="text-xs text-muted-foreground">Nenhuma orientação cadastrada.</p> : null}
        <ol className="space-y-2">
          {value.operatorGuidance.map((row, index) => (
            <li key={row.uid} className="flex flex-col gap-2 sm:flex-row sm:items-start">
              <Select value={row.modality} onValueChange={(modality) => updateGuidance(row.uid, { modality: modality as GuidanceModality })}>
                <SelectTrigger className="w-full sm:w-44" aria-label={`Tipo da orientação ${index + 1}`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="MUST">{GUIDANCE_MODALITY_LABELS.MUST}</SelectItem>
                  <SelectItem value="MAY">{GUIDANCE_MODALITY_LABELS.MAY}</SelectItem>
                  {row.modality === "UNSPECIFIED" ? <SelectItem value="UNSPECIFIED">{GUIDANCE_MODALITY_LABELS.UNSPECIFIED}</SelectItem> : null}
                </SelectContent>
              </Select>
              <Textarea aria-label={`Orientação ${index + 1}`} value={row.text} onChange={(event) => updateGuidance(row.uid, { text: event.target.value })} rows={2} maxLength={1200} className="flex-1" placeholder="Ex.: Oferecer o plano com desconto antes de registrar o cancelamento." />
              <Button type="button" size="icon" variant="ghost" aria-label={`Remover orientação ${index + 1}`} onClick={() => set({ operatorGuidance: value.operatorGuidance.filter((entry) => entry.uid !== row.uid) })}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </li>
          ))}
        </ol>
        {value.operatorGuidance.some((row) => row.modality === "UNSPECIFIED") ? (
          <p className="text-xs text-muted-foreground">Itens “Sem classificação” vieram do cadastro antigo e não são avaliados: escolha “Deve” ou “Pode”.</p>
        ) : null}
        <Button type="button" variant="outline" size="sm" onClick={() => set({ operatorGuidance: [...value.operatorGuidance, { uid: nextUid(), key: null, text: "", modality: "MUST" }] })}>
          <Plus data-icon="inline-start" /> Adicionar orientação
        </Button>
      </FormSection>

      <FormSection title="Pontos obrigatórios na fala" description={SECTION_HELP.requiredPoints} testId="section-required-points">
        {value.requiredPoints.length === 0 ? <p className="text-xs text-muted-foreground">Nenhum ponto obrigatório cadastrado.</p> : null}
        <div className="space-y-3">
          {value.requiredPoints.map((group, groupIndex) => (
            <div key={group.uid} className="space-y-2 rounded-md border bg-muted/20 p-3" data-testid={`point-group-${groupIndex + 1}`}>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-2">
                  <span className="text-sm font-medium">Grupo {groupIndex + 1}</span>
                  <Select
                    value={group.mode}
                    onValueChange={(mode) =>
                      updateGroup(group.uid, (current) => {
                        const next = { ...current, mode: mode as PointGroupMode }
                        // Alternativas precisam de ao menos duas opções: abre a segunda linha para o administrador preencher.
                        if (next.mode === "ANY" && next.items.length < 2) next.items = [...next.items, ...Array.from({ length: 2 - next.items.length }, () => ({ uid: nextUid(), key: null, text: "", condition: "" }))]
                        return next
                      })
                    }
                  >
                    <SelectTrigger className="w-full sm:w-56" aria-label={`Como cumprir o grupo ${groupIndex + 1}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ALL">{POINT_GROUP_MODE_LABELS.ALL}</SelectItem>
                      <SelectItem value="ANY">{POINT_GROUP_MODE_LABELS.ANY}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Button type="button" size="sm" variant="ghost" aria-label={`Remover grupo ${groupIndex + 1}`} onClick={() => set({ requiredPoints: value.requiredPoints.filter((entry) => entry.uid !== group.uid) })}>
                  <Trash2 data-icon="inline-start" /> Remover grupo
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {group.mode === "ANY" ? "Basta o operador comunicar uma das alternativas que se aplicam. Cadastre pelo menos duas." : "Cada item precisa ser comunicado quando se aplica."}
              </p>
              <ol className="space-y-2">
                {group.items.map((item, itemIndex) => (
                  <li key={item.uid} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-start">
                    <Input
                      aria-label={`Item ${itemIndex + 1} do grupo ${groupIndex + 1}`}
                      value={item.text}
                      maxLength={1200}
                      placeholder={group.mode === "ANY" ? `Alternativa ${itemIndex + 1}` : "Ex.: Informar o valor da multa de cancelamento"}
                      onChange={(event) => updateGroup(group.uid, (current) => ({ ...current, items: current.items.map((entry) => (entry.uid === item.uid ? { ...entry, text: event.target.value } : entry)) }))}
                    />
                    <Input
                      aria-label={`Condição do item ${itemIndex + 1} do grupo ${groupIndex + 1}`}
                      value={item.condition}
                      maxLength={1200}
                      placeholder="Somente quando… (opcional)"
                      onChange={(event) => updateGroup(group.uid, (current) => ({ ...current, items: current.items.map((entry) => (entry.uid === item.uid ? { ...entry, condition: event.target.value } : entry)) }))}
                    />
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      aria-label={`Remover item ${itemIndex + 1} do grupo ${groupIndex + 1}`}
                      onClick={() => updateGroup(group.uid, (current) => ({ ...current, items: current.items.filter((entry) => entry.uid !== item.uid) }))}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </li>
                ))}
              </ol>
              <Button type="button" variant="outline" size="sm" onClick={() => updateGroup(group.uid, (current) => ({ ...current, items: [...current.items, { uid: nextUid(), key: null, text: "", condition: "" }] }))}>
                <Plus data-icon="inline-start" /> Adicionar item
              </Button>
            </div>
          ))}
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => set({ requiredPoints: [...value.requiredPoints, { uid: nextUid(), key: null, mode: "ALL", items: [{ uid: nextUid(), key: null, text: "", condition: "" }] }] })}>
          <Plus data-icon="inline-start" /> Adicionar grupo
        </Button>
      </FormSection>

      <FormSection title="Condutas ou promessas a evitar" description={SECTION_HELP.avoid} testId="section-avoid">
        {value.avoid.length === 0 ? <p className="text-xs text-muted-foreground">Nenhuma conduta cadastrada.</p> : null}
        <ol className="space-y-2">
          {value.avoid.map((row, index) => (
            <li key={row.uid} className="flex items-start gap-2">
              <Textarea aria-label={`Conduta a evitar ${index + 1}`} value={row.text} onChange={(event) => updateAvoid(row.uid, { text: event.target.value })} rows={2} maxLength={1200} className="flex-1" placeholder="Ex.: Prometer isenção de multa sem aprovação." />
              <Button type="button" size="icon" variant="ghost" aria-label={`Remover conduta ${index + 1}`} onClick={() => set({ avoid: value.avoid.filter((entry) => entry.uid !== row.uid) })}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </li>
          ))}
        </ol>
        <Button type="button" variant="outline" size="sm" onClick={() => set({ avoid: [...value.avoid, { uid: nextUid(), key: null, text: "" }] })}>
          <Plus data-icon="inline-start" /> Adicionar conduta
        </Button>
      </FormSection>

      <FormSection title="Argumentário sugerido" description={SECTION_HELP.suggestedScript}>
        <Textarea aria-label="Argumentário sugerido" value={value.suggestedScript} onChange={(event) => set({ suggestedScript: event.target.value })} rows={4} maxLength={4000} />
      </FormSection>

      <FormSection title="Referência para a monitoria" description={SECTION_HELP.monitoringReference}>
        <Textarea aria-label="Referência para a monitoria" value={value.monitoringReference} onChange={(event) => set({ monitoringReference: event.target.value })} rows={3} maxLength={4000} />
      </FormSection>

      <FormSection title="Procedimento ou fonte de origem" description={SECTION_HELP.source}>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="argument-script-source-document">Documento da Base de conhecimento</Label>
            <Select
              value={value.sourceDocumentId ?? NO_DOCUMENT}
              onValueChange={(next) => set({ sourceDocumentId: next === NO_DOCUMENT ? null : next })}
              disabled={knowledgeDocuments === undefined && !knowledgeUnavailable}
            >
              <SelectTrigger id="argument-script-source-document" className="w-full">
                <SelectValue placeholder="Nenhum" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_DOCUMENT}>Nenhum</SelectItem>
                {selectedMissing ? <SelectItem value={value.sourceDocumentId!}>{currentSourceTitle ?? "Documento atual"}</SelectItem> : null}
                {documentOptions.map((document) => (
                  <SelectItem key={document.id} value={document.id}>
                    {document.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {knowledgeUnavailable ? <p className="text-xs text-muted-foreground">A lista de documentos não está disponível para o seu perfil — use a referência ao lado.</p> : null}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="argument-script-source-reference">Referência (seção, item, link interno…)</Label>
            <Input id="argument-script-source-reference" value={value.sourceReference} onChange={(event) => set({ sourceReference: event.target.value })} maxLength={400} placeholder="Ex.: Seção 4 — Retenção por preço" />
          </div>
        </div>
      </FormSection>
    </div>
  )
}

function EmptyValue() {
  return <p className="text-sm italic text-muted-foreground/80">Não informado.</p>
}

/** Leitura (versão vigente sem rascunho, ou argumentário administrado acima do seu escopo). */
export function ArgumentScriptContentView({
  content,
  sourceDocumentTitle,
  sourceReference,
}: {
  content: ArgumentScriptContent
  sourceDocumentTitle: string | null
  sourceReference: string | null
}) {
  return (
    <div className="space-y-4" data-testid="argument-script-content-view">
      {content.legacyExpectation ? <LegacyExpectationBox text={content.legacyExpectation} /> : null}

      <FormSection title="Condição ou gatilho" description={SECTION_HELP.trigger}>
        {content.trigger ? <p className="whitespace-pre-line text-sm">{content.trigger}</p> : <EmptyValue />}
      </FormSection>

      <FormSection title="Quando não se aplica" description={SECTION_HELP.notApplicableWhen}>
        {content.notApplicableWhen ? <p className="whitespace-pre-line text-sm">{content.notApplicableWhen}</p> : <EmptyValue />}
      </FormSection>

      <FormSection title="Orientação ao operador" description={SECTION_HELP.operatorGuidance}>
        {content.operatorGuidance.length === 0 ? (
          <EmptyValue />
        ) : (
          <ul className="space-y-1.5">
            {content.operatorGuidance.map((item) => (
              <li key={item.key} className="flex items-start gap-2 text-sm">
                <Badge variant={item.modality === "MUST" ? "secondary" : "outline"} className="shrink-0">
                  {GUIDANCE_MODALITY_LABELS[item.modality]}
                </Badge>
                <span className="whitespace-pre-line">{item.text}</span>
              </li>
            ))}
          </ul>
        )}
      </FormSection>

      <FormSection title="Pontos obrigatórios na fala" description={SECTION_HELP.requiredPoints}>
        {content.requiredPoints.length === 0 ? (
          <EmptyValue />
        ) : (
          <div className="space-y-2">
            {content.requiredPoints.map((group, index) => (
              <div key={group.key} className="space-y-1 rounded-md border bg-muted/20 p-3">
                <p className="text-sm font-medium">
                  Grupo {index + 1} · <span className="font-normal text-muted-foreground">{POINT_GROUP_MODE_LABELS[group.mode]}</span>
                </p>
                <ul className="list-disc space-y-0.5 pl-5 text-sm">
                  {group.items.map((item) => (
                    <li key={item.key}>
                      {item.text}
                      {item.condition ? <span className="text-muted-foreground"> — somente quando {item.condition}</span> : null}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </FormSection>

      <FormSection title="Condutas ou promessas a evitar" description={SECTION_HELP.avoid}>
        {content.avoid.length === 0 ? (
          <EmptyValue />
        ) : (
          <ul className="list-disc space-y-0.5 pl-5 text-sm">
            {content.avoid.map((item) => (
              <li key={item.key} className="whitespace-pre-line">
                {item.text}
              </li>
            ))}
          </ul>
        )}
      </FormSection>

      <FormSection title="Argumentário sugerido" description={SECTION_HELP.suggestedScript}>
        {content.suggestedScript ? <p className="whitespace-pre-line text-sm">{content.suggestedScript}</p> : <EmptyValue />}
      </FormSection>

      <FormSection title="Referência para a monitoria" description={SECTION_HELP.monitoringReference}>
        {content.monitoringReference ? <p className="whitespace-pre-line text-sm">{content.monitoringReference}</p> : <EmptyValue />}
      </FormSection>

      <FormSection title="Procedimento ou fonte de origem" description={SECTION_HELP.source}>
        {sourceDocumentTitle || sourceReference ? (
          <dl className="grid gap-1 text-sm sm:grid-cols-[12rem_1fr]">
            <dt className="text-muted-foreground">Documento</dt>
            <dd>{sourceDocumentTitle ?? "—"}</dd>
            <dt className="text-muted-foreground">Referência</dt>
            <dd>{sourceReference ?? "—"}</dd>
          </dl>
        ) : (
          <EmptyValue />
        )}
      </FormSection>
    </div>
  )
}
