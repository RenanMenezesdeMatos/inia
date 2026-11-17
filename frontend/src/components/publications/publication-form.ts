import { linksFromScopeValue, scopeReachSummary, scopeValueFromLinks, type ScopeTeamOption } from "@/lib/scope-links/scope-links"
import { format } from "date-fns"

import type { Tone } from "@/components/ui/surface"
import { sanitizeRichText } from "@/lib/security/sanitize-rich-text"
import {
  COMMUNICATION_TAGS,
  type AudienceOptions,
  type CommunicationState,
  type EditorialCommunication,
  type EditorialForm,
  type EditorialPayload,
  type SegmentPayload,
} from "@/schemas/communications/communication.schema"

export { newPublicationPath, publicationPath, publicationReadingPath, PUBLICATIONS_PATH } from "./publications-route"

export const STATE_TONES: Record<CommunicationState, Tone> = { DRAFT: "neutral", SCHEDULED: "info", PUBLISHED: "success", EXPIRED: "warning", ARCHIVED: "neutral" }

type Tag = (typeof COMMUNICATION_TAGS)[number]
const isTag = (value: string): value is Tag => (COMMUNICATION_TAGS as readonly string[]).includes(value)

export function emptyForm(): EditorialForm {
  return { title: "", contentHtml: "", plainText: "", tags: ["Aviso"], summary: "", featured: false, audience: "TEAM", segment: { universe: null, scope: { global: false, groups: [] } }, productNodeId: null, publishAt: null, displayUntil: null }
}

/** Formulário a partir do que está salvo. O agendamento só volta ao formulário se ainda não chegou a hora. */
export function formOf(saved: EditorialCommunication, now: Date = new Date()): EditorialForm {
  return {
    title: saved.title,
    contentHtml: saved.contentHtml,
    plainText: saved.plainText === "(imagem)" ? "" : saved.plainText,
    tags: saved.tags.filter(isTag),
    summary: saved.summary ?? "",
    featured: saved.featured,
    audience: saved.audience,
    segment: { universe: saved.segment.universe, scope: scopeValueFromLinks(saved.segment.links) },
    productNodeId: saved.productNodeId,
    publishAt: saved.publishedAt && new Date(saved.publishedAt).getTime() > now.getTime() ? saved.publishedAt : null,
    displayUntil: saved.displayUntil,
  }
}

/** A publicação já saiu (alguém pode tê-la lido): público e "publicar em" ficam travados, como no servidor. */
export function wentOut(saved: Pick<EditorialCommunication, "status" | "publishedAt"> | null, now: Date = new Date()): boolean {
  return Boolean(saved && saved.status !== "DRAFT" && saved.publishedAt && new Date(saved.publishedAt).getTime() <= now.getTime())
}

/** Corpo para o servidor. Depois que saiu, público e "publicar em" não vão (o servidor recusaria a mudança). */
export function payloadOf(form: EditorialForm, mode: "DRAFT" | "PUBLISH", locked: boolean): EditorialPayload {
  return {
    title: form.title.trim(),
    contentHtml: sanitizeRichText(form.contentHtml),
    tags: form.tags,
    summary: form.summary.trim() || null,
    featured: form.featured,
    productNodeId: form.productNodeId,
    displayUntil: form.displayUntil,
    mode,
    ...(locked ? {} : { audience: form.audience, segment: form.audience === "SEGMENT" ? segmentPayloadOf(form.segment) : null, publishAt: mode === "PUBLISH" ? form.publishAt : null }),
  }
}

/** Mesmo conteúdo = nada a salvar (o HTML passa pelo saneador dos dois lados; espaços do título não contam). */
export function formFingerprint(form: EditorialForm): string {
  return JSON.stringify({ ...form, title: form.title.trim(), summary: form.summary.trim(), contentHtml: sanitizeRichText(form.contentHtml), plainText: undefined })
}

const dateTime = (iso: string) => format(new Date(iso), "dd/MM/yyyy 'às' HH:mm")

/** Quem vai receber, em palavras (o servidor é quem calcula; isto é só a descrição da escolha). */
export function audienceDescription(form: Pick<EditorialForm, "audience" | "segment">, options: AudienceOptions | undefined): string {
  if (form.audience === "TEAM") return "Sua equipe (todos abaixo de você na estrutura)"
  if (form.audience === "ORGANIZATION") return "Toda a empresa"
  const parts: string[] = []
  if (form.segment.universe) parts.push(`universo ${form.segment.universe}`)
  // Mesmo resumo do seletor: "Grupo A (Grupo inteiro) · Grupo B: só B1".
  if (form.segment.scope.groups.length) parts.push(scopeReachSummary(form.segment.scope, segmentTeamOptions(options), "Todos os Grupos"))
  return parts.length ? `Público específico: ${parts.join(" · ")}` : "Público específico (escolha o recorte)"
}

/** Recorte do formulário → corpo da API (vínculos). */
export function segmentPayloadOf(segment: EditorialForm["segment"]): SegmentPayload {
  return { universe: segment.universe, links: linksFromScopeValue(segment.scope) }
}

/** Grupos/Subgrupos das opções de público → opções do seletor multi-grupo (Subgrupo herda o universo do Grupo). */
export function segmentTeamOptions(options: AudienceOptions | undefined): ScopeTeamOption[] {
  return (options?.teams ?? []).map((team) => ({ id: team.id, name: team.name, operatingUniverse: team.universe, subteams: team.subteams.map((subteam) => ({ id: subteam.id, name: subteam.name, operatingUniverse: subteam.universe ?? team.universe })) }))
}

export function scheduleDescription(form: Pick<EditorialForm, "publishAt" | "displayUntil">, saved: Pick<EditorialCommunication, "status" | "publishedAt"> | null): string {
  const start = saved && wentOut(saved) ? `Publicado em ${dateTime(saved.publishedAt!)}` : form.publishAt ? `Publica em ${dateTime(form.publishAt)}` : "Publica assim que você confirmar"
  const end = form.displayUntil ? `fica visível até ${dateTime(form.displayUntil)}` : "fica visível até ser arquivado"
  return `${start}; ${end}`
}

/** Instante (ISO) a partir de data civil + hora local; vazio quando falta a data. */
export function instantOf(date: string, time: string): string | null {
  if (!date) return null
  const [hours, minutes] = (time || "00:00").split(":").map(Number)
  const [year, month, day] = date.split("-").map(Number)
  return new Date(year!, month! - 1, day!, hours ?? 0, minutes ?? 0, 0, 0).toISOString()
}

export function civilPartsOf(iso: string | null): { date: string; time: string } {
  if (!iso) return { date: "", time: "" }
  const value = new Date(iso)
  return { date: format(value, "yyyy-MM-dd"), time: format(value, "HH:mm") }
}
