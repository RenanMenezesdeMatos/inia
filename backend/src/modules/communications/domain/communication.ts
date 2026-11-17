import { z } from "zod"

/**
 * COMUNICADO DA LIDERANÇA (migration 199). Só leitura (sem ciência — decisão de 16/11/2026), sempre de uma pessoa para um público
 * que o SERVIDOR calcula:
 *   - TEAM: toda a estrutura abaixo de quem publica (reports_to, qualquer profundidade), pessoas ativas, no momento da publicação.
 *     Exige `communications.publish_team` em qualquer escopo OU `communications.publish_organization` com escopo de organização.
 *   - ORGANIZATION: toda a organização. Exige `communications.publish_organization` com escopo de organização.
 * Universo de atuação (B2B/B2C/B2X) entra como público novo quando o módulo dele chegar ao tronco.
 */
export const COMMUNICATION_AUDIENCES = ["TEAM", "ORGANIZATION"] as const
export type CommunicationAudience = (typeof COMMUNICATION_AUDIENCES)[number]

export const COMMUNICATION_TAGS = ["Aviso", "Processos", "Campanha"] as const
export type CommunicationTag = (typeof COMMUNICATION_TAGS)[number]

/** Teto do HTML gravado (imagens embutidas incluídas): 2 MB — decisão de 16/11/2026 ("imagens, com teto menor"). */
export const COMMUNICATION_MAX_HTML_BYTES = 2_000_000
export const COMMUNICATION_MAX_IMAGES = 6
export const COMMUNICATION_MAX_PLAIN_TEXT = 5_000
/** Corpo aceito pela rota de publicação (o HTML + folga do JSON); o parser global da API é de 1 MB. */
export const COMMUNICATION_BODY_LIMIT = "2200kb"
/** Quantos comunicados recebidos o Acompanhamento do colaborador carrega (os mais recentes; a lista LEVE — sem o conteúdo). */
export const RECEIVED_COMMUNICATIONS_LIMIT = 200
/** Tamanho do trecho de texto puro que a lista leve leva por comunicado (o conteúdo inteiro é lido pelo id, ao abrir). */
export const COMMUNICATION_EXCERPT_LENGTH = 280

export const publishCommunicationSchema = z.object({
  title: z.string().trim().min(3, "Informe um título com pelo menos 3 caracteres.").max(120, "O título deve ter no máximo 120 caracteres."),
  // O tamanho final é conferido depois de sanear; aqui só barra o absurdo antes de desmontar.
  contentHtml: z.string().min(1, "Digite o conteúdo do comunicado.").max(COMMUNICATION_MAX_HTML_BYTES * 1.05),
  audience: z.enum(COMMUNICATION_AUDIENCES),
  tags: z.array(z.enum(COMMUNICATION_TAGS)).min(1, "Selecione ao menos uma categoria.").max(COMMUNICATION_TAGS.length),
}).strict()

export type PublishCommunicationInput = z.infer<typeof publishCommunicationSchema>

/** Edição pelo autor: título, conteúdo e categorias. O público não muda (foi fixado na publicação). */
export const editCommunicationSchema = publishCommunicationSchema.omit({ audience: true })
export type EditCommunicationInput = z.infer<typeof editCommunicationSchema>

/** Comunicado como as telas o leem (Acompanhamento do líder e do colaborador). */
export type CommunicationView = {
  id: string
  title: string
  contentHtml: string
  plainText: string
  tags: CommunicationTag[]
  audience: CommunicationAudience
  author: { personId: string; name: string }
  /** Quantas pessoas receberam — só para quem publicou (os demais não precisam saber o tamanho do público). */
  recipientCount: number | null
  /** Quem lê é quem publicou. */
  authoredByViewer: boolean
  publishedAt: string
  /** Última edição pelo autor (null = nunca editado). */
  editedAt: string | null
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
