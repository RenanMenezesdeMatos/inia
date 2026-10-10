import mammoth from "mammoth"
import { inspectZip } from "../../../shared/infrastructure/zip-guard.js"

// Converte o DOCX original em HTML simples para a prévia na tela. Imagens ficam embutidas como
// data URI (comportamento padrão do mammoth) — o frontend sanitiza o HTML antes de renderizar e só
// aceita imagens data:image/*, então nada aponta para fora. Arquivos gravados antes da guarda de upload também passam pela
// conferência do pacote ZIP (a prévia roda a cada leitura, inclusive por quem só lê o material).
export async function renderDocxPreviewHtml(buffer: Buffer): Promise<string> {
  const zip = inspectZip(buffer)
  if (!zip.ok) throw new Error(`DOCX recusado: ${zip.reason}`)
  const result = await mammoth.convertToHtml({ buffer })
  return result.value
}
