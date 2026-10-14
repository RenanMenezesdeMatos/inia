import compression from "compression"
import type { Request, RequestHandler, Response } from "express"

/**
 * COMPRESSÃO das respostas da API (brotli/gzip, conforme o navegador aceita). O IIS fica com a compressão dinâmica desligada
 * porque ela acumularia o streaming do chat (deploy/windows/iis/web.config), então é a própria API que comprime JSON e texto
 * acima de 1 KB — o feed, o Acompanhamento, o analytics e as listas da administração. Nunca comprime:
 *   - o SSE do chat (`text/event-stream`): cada pedaço tem de sair na hora, e a compressão seguraria os pedaços;
 *   - o que já vem comprimido ou não é texto (imagens, áudio, planilhas, PDF): o filtro padrão só aceita tipos compressíveis.
 */
export function createResponseCompression(): RequestHandler {
  return compression({ filter: (request: Request, response: Response) => !isEventStream(response) && compression.filter(request, response) })
}

function isEventStream(response: Response): boolean {
  const type = response.getHeader("Content-Type")
  return typeof type === "string" && type.toLowerCase().startsWith("text/event-stream")
}
