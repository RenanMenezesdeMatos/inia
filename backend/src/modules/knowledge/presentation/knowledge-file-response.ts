import type { Request, Response } from "express"
import type { KnowledgeSourceType } from "../infrastructure/text-extractor.js"
import { contentDisposition } from "./content-disposition.js"

/**
 * Tipo de conteúdo do ARQUIVO ORIGINAL decidido pelo SERVIDOR a partir do tipo detectado no upload — nunca o que o navegador
 * declarou (antes, um `text/html`/`text/javascript` enviado como "base" voltava assim mesmo, inline, na origem da API: XSS
 * armazenado com a sessão de quem abrisse o link). Valores já gravados em `mime_type` deixam de importar.
 */
const SAFE_CONTENT_TYPE: Record<KnowledgeSourceType, string> = {
  PDF: "application/pdf",
  DOCX: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  TXT: "text/plain; charset=utf-8",
  JSON: "application/json; charset=utf-8",
  TEXT: "text/plain; charset=utf-8",
}

export function knowledgeFileContentType(sourceType: string | null | undefined): string {
  return SAFE_CONTENT_TYPE[sourceType as KnowledgeSourceType] ?? "application/octet-stream"
}

/**
 * Entrega o arquivo SEMPRE como download (`attachment`): a interface lê o binário por fetch (prévia do PDF, download) e nunca
 * precisa que o navegador o renderize na origem da API. `sandbox` + `default-src 'none'` neutralizam qualquer conteúdo ativo
 * mesmo se alguém abrir a URL direto; `nosniff` impede o navegador de "adivinhar" HTML.
 */
export function sendKnowledgeFile(response: Response, file: { sourceType: string | null | undefined; filename: string; data: Buffer }) {
  response.setHeader("content-type", knowledgeFileContentType(file.sourceType))
  response.setHeader("content-length", file.data.length)
  response.setHeader("content-disposition", contentDisposition("attachment", file.filename))
  response.setHeader("cache-control", "private, no-store")
  response.setHeader("x-content-type-options", "nosniff")
  response.setHeader("content-security-policy", "default-src 'none'; sandbox")
  response.send(file.data)
}

/**
 * Imagem de um PDF, para aparecer dentro da página (`<img>` da API, autenticada por cookie). O tipo é o gravado pelo próprio servidor, sempre uma
 * imagem. Fica 5 minutos no navegador de quem já teve acesso; depois disso a API confere o acesso de novo, e o `etag` evita baixar outra vez.
 */
export function sendKnowledgeImage(request: Request, response: Response, image: { hash: string; mime_type: string; data: Buffer }) {
  const etag = `"${image.hash}"`
  response.setHeader("cache-control", "private, max-age=300")
  response.setHeader("etag", etag)
  response.setHeader("x-content-type-options", "nosniff")
  response.setHeader("content-security-policy", "default-src 'none'; sandbox")
  // Mesma regra das fotos de perfil: em desenvolvimento a interface e a API ficam em portas diferentes do mesmo site.
  response.setHeader("cross-origin-resource-policy", "same-site")
  if (request.headers["if-none-match"] === etag) return response.status(304).end()
  response.setHeader("content-type", image.mime_type)
  response.setHeader("content-length", image.data.length)
  return response.send(image.data)
}
