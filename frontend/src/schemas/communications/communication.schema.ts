import { z } from "zod"

/**
 * Comunicado da liderança (backend: `modules/communications`, migration 199). O formulário valida o que dá para validar aqui; o
 * servidor refaz o HTML, deriva o texto, tira os metadados das imagens, calcula o público e confere a permissão de novo.
 */
export const COMMUNICATION_TAGS = ["Aviso", "Processos", "Campanha"] as const
export const COMMUNICATION_AUDIENCES = ["TEAM", "ORGANIZATION", "SEGMENT"] as const
export const COMMUNICATION_UNIVERSES = ["B2B", "B2C", "B2X"] as const
export const COMMUNICATION_STATES = ["DRAFT", "SCHEDULED", "PUBLISHED", "EXPIRED", "ARCHIVED"] as const
export type CommunicationState = (typeof COMMUNICATION_STATES)[number]
/** Rótulo de cada estado (agendado e encerrado são derivados das datas pelo servidor). */
export const COMMUNICATION_STATE_LABELS: Record<CommunicationState, string> = { DRAFT: "Rascunho", SCHEDULED: "Agendado", PUBLISHED: "Publicado", EXPIRED: "Encerrado", ARCHIVED: "Arquivado" }
/** Mesmo teto do servidor (`COMMUNICATION_MAX_SUMMARY`). */
export const COMMUNICATION_MAX_SUMMARY = 280
/** Teto do comunicado inteiro no servidor (HTML com as imagens embutidas). */
export const COMMUNICATION_MAX_BYTES = 2_000_000
/** Uma imagem desse tamanho, em base64, ainda cabe no teto do comunicado com o texto. */
export const COMMUNICATION_MAX_IMAGE_BYTES = 1_400_000
/** Mesmo teto do servidor (`COMMUNICATION_MAX_IMAGES`). */
export const COMMUNICATION_MAX_IMAGES = 6
/** Tipos aceitos — os mesmos do servidor e da foto do perfil (GIF é recusado: o servidor não sabe tirar os metadados dele). */
export const COMMUNICATION_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const

export const broadcastImageSchema = z.instanceof(File)
  .refine((file) => file.size <= COMMUNICATION_MAX_IMAGE_BYTES, "A imagem deve ter no máximo 1,4 MB.")
  .refine((file) => (COMMUNICATION_IMAGE_TYPES as readonly string[]).includes(file.type), "Use uma imagem JPG, PNG ou WebP.")

const imageCountOf = (html: string) => html.match(/<img\s/gi)?.length ?? 0

export const communicationSchema = z.object({
  id: z.string(),
  title: z.string(),
  contentHtml: z.string(),
  plainText: z.string(),
  tags: z.array(z.string()),
  audience: z.enum(COMMUNICATION_AUDIENCES),
  author: z.object({ personId: z.string(), name: z.string(), jobTitle: z.string().nullish() }),
  /** Só para quem publicou. */
  recipientCount: z.number().int().nullable(),
  authoredByViewer: z.boolean(),
  publishedAt: z.string(),
  /** Última edição pelo autor (null = nunca editado). */
  editedAt: z.string().nullish(),
  summary: z.string().nullish(),
  featured: z.boolean().optional(),
  /** Fim do período de exibição (null = sem fim). */
  displayUntil: z.string().nullish(),
})
export type Communication = z.infer<typeof communicationSchema>

/**
 * Comunicado na lista de RECEBIDOS do colaborador: lista leve, sem o conteúdo (até 2 MB cada, com as imagens) — só o começo do
 * texto e se há imagens. O conteúdo inteiro vem pelo id (`GET /communications/:id`) quando a pessoa abre o comunicado.
 */
export const receivedCommunicationSchema = communicationSchema.omit({ contentHtml: true, plainText: true }).extend({
  /** Começo do texto puro ("…" quando cortado); vazio quando o comunicado é só imagem. */
  excerpt: z.string(),
  hasImages: z.boolean(),
})
export type ReceivedCommunication = z.infer<typeof receivedCommunicationSchema>

export const receivedCommunicationsSchema = z.object({ items: z.array(receivedCommunicationSchema) })
export const publishedCommunicationSchema = z.object({ id: z.string(), status: z.enum(["DRAFT", "PUBLISHED", "ARCHIVED"]).optional(), recipientCount: z.number().int(), publishedAt: z.string().nullable() })
export type PublishedCommunication = z.infer<typeof publishedCommunicationSchema>

// ------------------------------------------------------------------------------------------------------------------------------
// Área editorial (Administração › Publicações, migration 220)

export const communicationSegmentSchema = z.object({
  universe: z.enum(COMMUNICATION_UNIVERSES).nullable(),
  teamIds: z.array(z.string()),
  subteamIds: z.array(z.string()),
})
export type CommunicationSegment = z.infer<typeof communicationSegmentSchema>

const editorialBase = z.object({
  id: z.string(),
  status: z.enum(["DRAFT", "PUBLISHED", "ARCHIVED"]),
  state: z.enum(COMMUNICATION_STATES),
  title: z.string(),
  tags: z.array(z.string()),
  summary: z.string().nullable(),
  featured: z.boolean(),
  audience: z.enum(COMMUNICATION_AUDIENCES),
  segment: communicationSegmentSchema,
  productNodeId: z.string().nullable(),
  productName: z.string().nullable(),
  publishedAt: z.string().nullable(),
  displayUntil: z.string().nullable(),
  recipientCount: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string().nullable(),
  editedAt: z.string().nullable(),
  archivedAt: z.string().nullable(),
  author: z.object({ personId: z.string(), name: z.string(), jobTitle: z.string().nullable() }),
})
export const editorialCommunicationSchema = editorialBase.extend({ contentHtml: z.string(), plainText: z.string() })
export type EditorialCommunication = z.infer<typeof editorialCommunicationSchema>
export const editorialCommunicationSummarySchema = editorialBase.extend({ excerpt: z.string(), hasImages: z.boolean() })
export type EditorialCommunicationSummary = z.infer<typeof editorialCommunicationSummarySchema>
export const editorialCommunicationsSchema = z.object({ items: z.array(editorialCommunicationSummarySchema) })

export const audienceOptionsSchema = z.object({
  audiences: z.array(z.enum(COMMUNICATION_AUDIENCES)),
  teams: z.array(z.object({ id: z.string(), name: z.string(), universe: z.string().nullable(), subteams: z.array(z.object({ id: z.string(), name: z.string() })) })),
  universes: z.array(z.string()),
  products: z.array(z.object({ id: z.string(), name: z.string(), familyName: z.string().nullable() })),
})
export type AudienceOptions = z.infer<typeof audienceOptionsSchema>
export const audiencePreviewResultSchema = z.object({ recipientCount: z.number().int() })

/**
 * Formulário do editor. Rascunho só precisa do título; publicar (agora ou agendado) exige conteúdo e categoria. Datas em ISO; o
 * servidor confere de novo (agendamento no futuro, fim depois do início, no máximo um ano) e calcula o público.
 */
export const editorialFormSchema = z.object({
  title: z.string().trim().min(3, "Informe um título com pelo menos 3 caracteres.").max(120, "O título deve ter no máximo 120 caracteres."),
  contentHtml: z.string().refine((html) => new TextEncoder().encode(html).length <= COMMUNICATION_MAX_BYTES, "O comunicado passou de 2 MB. Use imagens menores ou em menor número."),
  plainText: z.string().max(5_000, "O texto deve ter no máximo 5.000 caracteres."),
  tags: z.array(z.enum(COMMUNICATION_TAGS)),
  summary: z.string().trim().max(COMMUNICATION_MAX_SUMMARY, `O resumo deve ter no máximo ${COMMUNICATION_MAX_SUMMARY} caracteres.`),
  featured: z.boolean(),
  audience: z.enum(COMMUNICATION_AUDIENCES),
  segment: communicationSegmentSchema,
  productNodeId: z.string().nullable(),
  publishAt: z.string().nullable(),
  displayUntil: z.string().nullable(),
})
export type EditorialForm = z.infer<typeof editorialFormSchema>

/** O que impede PUBLICAR (rascunho passa sem isso). Mensagens na ordem em que aparecem na tela. */
export function publishBlockers(form: EditorialForm): string[] {
  const problems: string[] = []
  const images = imageCountOf(form.contentHtml)
  if (form.plainText.trim().length === 0 && images === 0) problems.push("Escreva o conteúdo da publicação.")
  if (images > COMMUNICATION_MAX_IMAGES) problems.push(`A publicação pode ter no máximo ${COMMUNICATION_MAX_IMAGES} imagens.`)
  if (form.tags.length === 0) problems.push("Escolha ao menos uma categoria.")
  if (form.audience === "SEGMENT" && !form.segment.universe && form.segment.teamIds.length === 0 && form.segment.subteamIds.length === 0) problems.push("Escolha o universo, um Grupo ou um Subgrupo para o público.")
  if (form.publishAt && form.displayUntil && new Date(form.displayUntil) <= new Date(form.publishAt)) problems.push("O fim da exibição precisa ser depois do início.")
  return problems
}

/** Corpo enviado ao servidor (o texto puro é derivado lá, nunca enviado). */
export type EditorialPayload = {
  title: string
  contentHtml: string
  tags: (typeof COMMUNICATION_TAGS)[number][]
  summary: string | null
  featured: boolean
  audience?: (typeof COMMUNICATION_AUDIENCES)[number]
  segment?: CommunicationSegment | null
  productNodeId: string | null
  publishAt?: string | null
  displayUntil: string | null
  mode: "DRAFT" | "PUBLISH"
}
