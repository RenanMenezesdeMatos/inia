import { z } from "zod"

/**
 * Comunicado da liderança (backend: `modules/communications`, migration 199). O formulário valida o que dá para validar aqui; o
 * servidor refaz o HTML, deriva o texto, tira os metadados das imagens, calcula o público e confere a permissão de novo.
 */
export const COMMUNICATION_TAGS = ["Aviso", "Processos", "Campanha"] as const
export const COMMUNICATION_AUDIENCES = ["TEAM", "ORGANIZATION"] as const
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

export const broadcastSchema = z.object({
  title: z.string().trim().min(3, "Informe um título com pelo menos 3 caracteres.").max(120, "O título deve ter no máximo 120 caracteres."),
  contentHtml: z.string().min(1, "Digite o conteúdo do comunicado.").refine((html) => new TextEncoder().encode(html).length <= COMMUNICATION_MAX_BYTES, "O comunicado passou de 2 MB. Use imagens menores ou em menor número."),
  plainText: z.string().trim().max(5_000, "O texto deve ter no máximo 5.000 caracteres."),
  audience: z.enum(COMMUNICATION_AUDIENCES),
  tags: z.array(z.enum(COMMUNICATION_TAGS)).min(1, "Selecione ao menos uma categoria."),
}).superRefine((input, context) => {
  // A regra do servidor (`prepareCommunicationContent`): texto OU ao menos uma imagem — comunicado só de imagem vale (achado B11).
  const images = imageCountOf(input.contentHtml)
  if (input.plainText.length === 0 && images === 0) context.addIssue({ code: "custom", path: ["plainText"], message: "Digite o conteúdo do comunicado." })
  if (images > COMMUNICATION_MAX_IMAGES) context.addIssue({ code: "custom", path: ["contentHtml"], message: `O comunicado pode ter no máximo ${COMMUNICATION_MAX_IMAGES} imagens.` })
})
export type BroadcastInput = z.infer<typeof broadcastSchema>
/** O que vai ao servidor (o texto puro é derivado lá, nunca enviado). */
export type PublishCommunicationInput = Pick<BroadcastInput, "title" | "contentHtml" | "audience" | "tags">
/** Edição pelo autor: o público foi fixado na publicação e não muda. */
export type EditCommunicationInput = Pick<BroadcastInput, "title" | "contentHtml" | "tags">

export const communicationSchema = z.object({
  id: z.string(),
  title: z.string(),
  contentHtml: z.string(),
  plainText: z.string(),
  tags: z.array(z.string()),
  audience: z.enum(COMMUNICATION_AUDIENCES),
  author: z.object({ personId: z.string(), name: z.string() }),
  /** Só para quem publicou. */
  recipientCount: z.number().int().nullable(),
  authoredByViewer: z.boolean(),
  publishedAt: z.string(),
  /** Última edição pelo autor (null = nunca editado). */
  editedAt: z.string().nullish(),
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
export const publishedCommunicationSchema = z.object({ id: z.string(), recipientCount: z.number().int(), publishedAt: z.string() })
export type PublishedCommunication = z.infer<typeof publishedCommunicationSchema>
