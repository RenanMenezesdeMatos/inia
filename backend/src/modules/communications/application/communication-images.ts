import { DomainError } from "../../../shared/domain/domain-error.js"
import { stripImageMetadata } from "../../../shared/infrastructure/image-metadata.js"
import { parseCommunicationHtml, plainTextOf, renderCommunicationHtml, type SanitizedNode } from "../domain/communication-content.js"
import { COMMUNICATION_IMAGE_SOURCE } from "../domain/communication-content.js"
import { COMMUNICATION_MAX_HTML_BYTES, COMMUNICATION_MAX_IMAGES, COMMUNICATION_MAX_PLAIN_TEXT } from "../domain/communication.js"

type ImageType = "image/png" | "image/jpeg" | "image/webp"

/**
 * Tipo decidido pelos BYTES (nunca pelo que a URL declara). GIF é reconhecido só para ser RECUSADO com mensagem própria (achado
 * U4-03): `stripImageMetadata` não sabe tirar os blocos de comentário/aplicação nem o que vem depois do trailer do GIF, então ele
 * voltaria com os metadados — a mesma regra da foto do perfil (JPG, PNG ou WebP).
 */
function sniff(data: Buffer): ImageType | "image/gif" | null {
  if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png"
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "image/jpeg"
  if (data.length >= 12 && data.toString("latin1", 0, 4) === "RIFF" && data.toString("latin1", 8, 12) === "WEBP") return "image/webp"
  if (data.length >= 6 && /^GIF8[79]a$/.test(data.toString("latin1", 0, 6))) return "image/gif"
  return null
}

const invalidImage = () => new DomainError("Uma das imagens do comunicado não pôde ser lida. Use JPG, PNG ou WebP.", "COMMUNICATION_IMAGE_INVALID", 422)
const unsupportedImage = () => new DomainError("Formato de imagem não suportado no comunicado. Use JPG, PNG ou WebP.", "COMMUNICATION_IMAGE_TYPE_UNSUPPORTED", 422)

/**
 * Conteúdo pronto para gravar: HTML refeito pelo servidor, imagens com o tipo conferido pelos bytes e SEM metadados (o comunicado
 * pode ir à organização inteira — a mesma regra da foto do perfil), texto puro derivado e os limites de tamanho.
 */
export function prepareCommunicationContent(html: string): { html: string; plainText: string } {
  const nodes = parseCommunicationHtml(html)
  const images = nodes.filter((node) => node.kind === "open" && node.tag === "img")
  if (images.length > COMMUNICATION_MAX_IMAGES) throw new DomainError(`O comunicado pode ter no máximo ${COMMUNICATION_MAX_IMAGES} imagens.`, "COMMUNICATION_TOO_MANY_IMAGES", 422)
  const cleaned: SanitizedNode[] = nodes.map((node) => {
    if (node.kind !== "open" || node.tag !== "img") return node
    const match = COMMUNICATION_IMAGE_SOURCE.exec(node.src ?? "")
    if (!match) throw invalidImage()
    const data = Buffer.from(match[2]!, "base64")
    const type = sniff(data)
    if (!type) throw invalidImage()
    if (type === "image/gif") throw unsupportedImage()
    const stripped = stripImageMetadata(data, type)
    if (!stripped) throw invalidImage()
    return { kind: "open", tag: "img", src: `data:${type};base64,${stripped.toString("base64")}` }
  })
  const plainText = plainTextOf(cleaned)
  if (plainText.length === 0 && images.length === 0) throw new DomainError("Digite o conteúdo do comunicado.", "COMMUNICATION_CONTENT_EMPTY", 422)
  if (plainText.length > COMMUNICATION_MAX_PLAIN_TEXT) throw new DomainError(`O texto deve ter no máximo ${COMMUNICATION_MAX_PLAIN_TEXT.toLocaleString("pt-BR")} caracteres.`, "COMMUNICATION_TEXT_TOO_LONG", 422)
  const rendered = renderCommunicationHtml(cleaned)
  if (Buffer.byteLength(rendered, "utf8") > COMMUNICATION_MAX_HTML_BYTES) throw new DomainError("O comunicado passou de 2 MB. Use imagens menores ou em menor número.", "COMMUNICATION_TOO_LARGE", 422)
  // Só imagem, sem texto: o texto puro (resumo, busca) recebe um marcador neutro.
  return { html: rendered, plainText: plainText || "(imagem)" }
}
