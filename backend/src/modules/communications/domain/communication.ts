import { z } from "zod"

/**
 * COMUNICADO DA LIDERANÇA (migrations 199, 201 e 220). Só leitura (sem ciência — decisão de 16/11/2026), sempre de uma pessoa para
 * um público que o SERVIDOR calcula:
 *   - TEAM: toda a estrutura abaixo de quem publica (reports_to, qualquer profundidade), pessoas ativas, gravada na publicação (ou
 *     no agendamento). Exige `communications.publish_team` em qualquer escopo OU `communications.publish_organization` com escopo
 *     de organização.
 *   - ORGANIZATION: toda a organização. Exige `communications.publish_organization` com escopo de organização.
 *   - SEGMENT (220): universo de atuação e/ou Grupos e/ou Subgrupos, avaliado AO LER pelo cadastro atual. Mesma permissão de
 *     ORGANIZATION.
 *
 * Ciclo editorial (220): rascunho → publicado (agora ou agendado: `publishedAt` no futuro) → arquivado (volta pelo "Desarquivar").
 * Retirar continua sendo a exclusão lógica. Período de exibição: de `publishedAt` até `displayUntil` (sem fim = enquanto não for
 * arquivado). Um comunicado é só INFORMAÇÃO: nunca é orientação de conduta nem altera o procedimento (conduta = bases de conhecimento,
 * alinhamentos operacionais e argumentários).
 */
export const COMMUNICATION_AUDIENCES = ["TEAM", "ORGANIZATION", "SEGMENT"] as const
export type CommunicationAudience = (typeof COMMUNICATION_AUDIENCES)[number]

export const COMMUNICATION_TAGS = ["Aviso", "Processos", "Campanha"] as const
export type CommunicationTag = (typeof COMMUNICATION_TAGS)[number]

export const COMMUNICATION_UNIVERSES = ["B2B", "B2C", "B2X"] as const
export type CommunicationUniverse = (typeof COMMUNICATION_UNIVERSES)[number]

export const COMMUNICATION_STATUSES = ["DRAFT", "PUBLISHED", "ARCHIVED"] as const
export type CommunicationStatus = (typeof COMMUNICATION_STATUSES)[number]

/** Estado que as telas mostram: o status gravado combinado com as datas (agendado e encerrado são DERIVADOS, nunca gravados). */
export type CommunicationState = "DRAFT" | "SCHEDULED" | "PUBLISHED" | "EXPIRED" | "ARCHIVED"

/** Teto do HTML gravado (imagens embutidas incluídas): 2 MB — decisão de 16/11/2026 ("imagens, com teto menor"). */
export const COMMUNICATION_MAX_HTML_BYTES = 2_000_000
export const COMMUNICATION_MAX_IMAGES = 6
export const COMMUNICATION_MAX_PLAIN_TEXT = 5_000
export const COMMUNICATION_MAX_SUMMARY = 280
/** Agendamento e fim de exibição: no máximo um ano à frente. */
export const COMMUNICATION_MAX_SCHEDULE_DAYS = 366
/** Tolerância do relógio do navegador para "publicar em" no passado próximo (vira "agora"). */
export const COMMUNICATION_SCHEDULE_TOLERANCE_MS = 60_000
/** Corpo aceito pela rota de publicação (o HTML + folga do JSON); o parser global da API é de 1 MB. */
export const COMMUNICATION_BODY_LIMIT = "2200kb"
/** Quantos comunicados recebidos o Acompanhamento do colaborador carrega (os mais recentes; a lista LEVE — sem o conteúdo). */
export const RECEIVED_COMMUNICATIONS_LIMIT = 200
/** Quantas publicações do autor a área editorial carrega (lista leve; busca e filtros na tela). */
export const EDITORIAL_COMMUNICATIONS_LIMIT = 300
/** Tamanho do trecho de texto puro que a lista leve leva por comunicado (o conteúdo inteiro é lido pelo id, ao abrir). */
export const COMMUNICATION_EXCERPT_LENGTH = 280

const uuid = z.string().uuid()

export const communicationSegmentSchema = z.object({
  universe: z.enum(COMMUNICATION_UNIVERSES).nullable().default(null),
  teamIds: z.array(uuid).max(100).default([]),
  subteamIds: z.array(uuid).max(300).default([]),
}).strict()
export type CommunicationSegment = z.infer<typeof communicationSegmentSchema>

const isoInstant = z.string().datetime({ offset: true })

/**
 * Campos de uma publicação (criar ou alterar). O conteúdo só é exigido completo ao PUBLICAR (rascunho pode estar incompleto); a
 * conferência final é do serviço, depois de sanear o HTML.
 */
const editorialFields = {
  title: z.string().trim().min(3, "Informe um título com pelo menos 3 caracteres.").max(120, "O título deve ter no máximo 120 caracteres."),
  // O tamanho final é conferido depois de sanear; aqui só barra o absurdo antes de desmontar.
  contentHtml: z.string().max(COMMUNICATION_MAX_HTML_BYTES * 1.05),
  tags: z.array(z.enum(COMMUNICATION_TAGS)).max(COMMUNICATION_TAGS.length),
  summary: z.string().trim().max(COMMUNICATION_MAX_SUMMARY, `O resumo deve ter no máximo ${COMMUNICATION_MAX_SUMMARY} caracteres.`).nullish(),
  featured: z.boolean().optional(),
  displayUntil: isoInstant.nullish(),
  productNodeId: uuid.nullish(),
  audience: z.enum(COMMUNICATION_AUDIENCES).optional(),
  segment: communicationSegmentSchema.nullish(),
  /** Instante da publicação: ausente/null = agora; no futuro = agendado. */
  publishAt: isoInstant.nullish(),
  /** O que fazer: guardar como rascunho ou publicar (agora ou no `publishAt`). */
  mode: z.enum(["DRAFT", "PUBLISH"]).optional(),
}

/**
 * Criar. Compatível com o corpo de antes (título, conteúdo, público e categorias = publica agora). Campos de destinatário vindos
 * do navegador continuam proibidos (`.strict()`); o público é sempre calculado no servidor.
 */
export const publishCommunicationSchema = z.object(editorialFields).strict()
export type PublishCommunicationInput = z.infer<typeof publishCommunicationSchema>

/** Alterar (rascunho, agendado ou publicado). Público e "publicar em" só mudam enquanto o comunicado ainda não saiu. */
export const editCommunicationSchema = z.object(editorialFields).partial({ title: true, contentHtml: true, tags: true }).strict()
export type EditCommunicationInput = z.infer<typeof editCommunicationSchema>

/**
 * Moderação (`communications.moderate`, Administrador geral): retirar a publicação de outra pessoa exige um MOTIVO, gravado na
 * auditoria. A moderação nunca edita o texto de ninguém — só tira de circulação (exclusão lógica, que volta por Itens excluídos).
 */
export const moderationRetireSchema = z.object({
  reason: z.string().trim().min(10, "Explique o motivo com pelo menos 10 caracteres.").max(500, "O motivo deve ter no máximo 500 caracteres."),
}).strict()

export const audiencePreviewSchema = z.object({ audience: z.enum(COMMUNICATION_AUDIENCES), segment: communicationSegmentSchema.nullish() }).strict()

/** Comunicado como as telas o leem (Acompanhamento do líder e do colaborador). */
export type CommunicationView = {
  id: string
  title: string
  contentHtml: string
  plainText: string
  tags: CommunicationTag[]
  audience: CommunicationAudience
  author: { personId: string; name: string; jobTitle: string | null }
  /** Quantas pessoas receberam — só para quem publicou (os demais não precisam saber o tamanho do público). */
  recipientCount: number | null
  /** Quem lê é quem publicou. */
  authoredByViewer: boolean
  publishedAt: string
  /** Última edição pelo autor (null = nunca editado). */
  editedAt: string | null
  summary: string | null
  featured: boolean
  displayUntil: string | null
}

/**
 * Comunicado na lista de RECEBIDOS (achado U4-02): sem `contentHtml` (até 2 MB com as imagens embutidas) nem o texto inteiro — só
 * um trecho do texto puro e se há imagens. O conteúdo é lido pelo id (`GET /communications/:id`), que confere de novo se quem lê
 * enxerga o comunicado.
 */
export type ReceivedCommunicationSummary = Omit<CommunicationView, "contentHtml" | "plainText"> & {
  /** Começo do texto puro (até `COMMUNICATION_EXCERPT_LENGTH` caracteres, com "…" quando cortado); vazio quando só há imagem. */
  excerpt: string
  hasImages: boolean
}

/** A publicação como o AUTOR a edita (área editorial): tudo, inclusive rascunho, público e datas. */
export type EditorialCommunication = {
  id: string
  status: CommunicationStatus
  state: CommunicationState
  title: string
  contentHtml: string
  plainText: string
  tags: CommunicationTag[]
  summary: string | null
  featured: boolean
  audience: CommunicationAudience
  segment: CommunicationSegment
  productNodeId: string | null
  productName: string | null
  publishedAt: string | null
  displayUntil: string | null
  recipientCount: number
  createdAt: string
  updatedAt: string | null
  editedAt: string | null
  archivedAt: string | null
  author: { personId: string; name: string; jobTitle: string | null }
}

export type EditorialCommunicationSummary = Omit<EditorialCommunication, "contentHtml" | "plainText"> & { excerpt: string; hasImages: boolean }

export function communicationStateOf(input: { status: CommunicationStatus; publishedAt: Date | string | null; displayUntil: Date | string | null }, now: Date = new Date()): CommunicationState {
  if (input.status === "DRAFT") return "DRAFT"
  if (input.status === "ARCHIVED") return "ARCHIVED"
  const publishedAt = input.publishedAt ? new Date(input.publishedAt).getTime() : 0
  if (publishedAt > now.getTime()) return "SCHEDULED"
  if (input.displayUntil && new Date(input.displayUntil).getTime() <= now.getTime()) return "EXPIRED"
  return "PUBLISHED"
}

/** O comunicado já saiu (alguém pode tê-lo lido): público e "publicar em" ficam fixos. */
export function communicationWentOut(input: { status: CommunicationStatus; publishedAt: Date | string | null }, now: Date = new Date()): boolean {
  return input.status !== "DRAFT" && input.publishedAt !== null && new Date(input.publishedAt).getTime() <= now.getTime()
}

/**
 * Trecho do texto puro para a lista leve. `cut` = o texto recebido já é só o começo do original (o banco manda um prefixo).
 * Comunicado só de imagem grava o marcador "(imagem)": o trecho fica vazio.
 */
export function communicationExcerpt(plainText: string, hasImages: boolean, cut = false): string {
  if (hasImages && plainText === "(imagem)") return ""
  const flat = plainText.replace(/\s+/g, " ").trim()
  if (flat.length > COMMUNICATION_EXCERPT_LENGTH) return `${flat.slice(0, COMMUNICATION_EXCERPT_LENGTH).trimEnd()}…`
  return cut ? `${flat}…` : flat
}
