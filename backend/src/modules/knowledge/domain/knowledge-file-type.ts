/**
 * Tipo de conteúdo do ARQUIVO ORIGINAL decidido pelo SERVIDOR a partir do tipo detectado no upload — nunca o que o navegador
 * declarou (antes, um `text/html`/`text/javascript` enviado como "base" voltava assim mesmo, inline, na origem da API: XSS
 * armazenado com a sessão de quem abrisse o link). Valores já gravados em `mime_type` deixam de importar.
 */
const SAFE_CONTENT_TYPE: Readonly<Record<string, string>> = {
  PDF: "application/pdf",
  DOCX: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  TXT: "text/plain; charset=utf-8",
  JSON: "application/json; charset=utf-8",
  TEXT: "text/plain; charset=utf-8",
}

export function knowledgeFileContentType(sourceType: string | null | undefined): string {
  return (sourceType && SAFE_CONTENT_TYPE[sourceType]) || "application/octet-stream"
}
