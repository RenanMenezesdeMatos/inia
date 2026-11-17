/**
 * CONTEÚDO DO COMUNICADO (domínio puro). O HTML vindo do editor do navegador NUNCA é gravado como chegou: o servidor o desmonta em
 * marcas e texto e MONTA UM HTML NOVO só com a lista fechada abaixo — a mesma do saneador da tela (`sanitize-rich-text.ts`), que
 * continua rodando na exibição. Nenhum atributo sobrevive, salvo:
 *   - `<span style="color: …">` com cor hexadecimal de 6 dígitos ou `rgb(r, g, b)`;
 *   - `<img src="data:image/(png|jpeg|webp|gif);base64,…">` (o `alt` é sempre o fixo do servidor). GIF passa pela FORMA só para
 *     a publicação o recusar com mensagem clara (`communication-images.ts`); nunca é gravado.
 * Marca fora da lista sai e o texto dela fica; `script`, `style` e afins saem com o conteúdo. Comentários e declarações somem.
 * Texto é reescapado (`<`, `>`, `"` e `&` que não abre uma entidade). Marcas ficam sempre balanceadas.
 * Imagens: o servidor decodifica, confere o tipo pelos BYTES, tira os metadados (`stripImageMetadata`) e reencoda — ver
 * `application/communication-images.ts`; aqui só a forma.
 */

const ALLOWED = new Set(["p", "div", "br", "strong", "b", "em", "i", "ul", "ol", "li", "h2", "h3", "span", "img", "a"])
const VOID = new Set(["br", "img"])
/** Marcas cujo CONTEÚDO também sai (não é texto para ler). */
const DROP_WITH_CONTENT = new Set(["script", "style", "template", "iframe", "object", "embed", "noscript", "textarea", "title", "svg", "math", "select", "head"])

const COLOR = /^(#[0-9a-f]{6}|rgb\(\d{1,3}, ?\d{1,3}, ?\d{1,3}\))$/i
/**
 * Link (área editorial, 17/11/2026): só endereço web (`http://`/`https://`) ou caminho interno do app (`/…`, nunca `//`), sem
 * espaço, aspas ou `<>`, até 2.000 caracteres. Qualquer outro esquema (`javascript:`, `data:`, `mailto:`…) faz o `<a>` sair e o
 * texto ficar. Na montagem o link sempre abre em outra aba, com `rel` fixo.
 */
export const COMMUNICATION_LINK_HREF = /^(?:https?:\/\/[^\s"'<>`\\]{1,1990}|\/(?![/\\])[^\s"'<>`\\]{0,1990})$/i

export const COMMUNICATION_IMAGE_SOURCE = /^data:image\/(png|jpeg|webp|gif);base64,([A-Za-z0-9+/]+={0,2})$/

export type SanitizedNode =
  | { kind: "text"; text: string }
  | { kind: "open"; tag: string; color?: string; src?: string; href?: string }
  | { kind: "close"; tag: string }

// Atributos fora de aspas não aceitam "<" (achado COMM-01): com `[^>"']`, cada "<" sem ">" adiante varria o resto do texto e a
// entrada `"<a".repeat(n)` custava O(n²) (80 KB = 13,7 s). Parando no próximo "<", cada tentativa termina onde a seguinte começa.
// O HTML do editor vem do `innerHTML` do navegador, que sempre põe valores entre aspas — a saída para entrada válida não muda.
const TOKEN = /<!--[\s\S]*?(?:-->|$)|<![^>]*>?|<\?[^>]*>?|<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:[^<>"']|"[^"]*"|'[^']*')*)>/g

function attribute(attributes: string, name: string): string | null {
  const match = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, "i").exec(attributes)
  if (!match) return null
  return decodeEntities(match[1] ?? match[2] ?? match[3] ?? "")
}

function colorOf(attributes: string): string | undefined {
  const style = attribute(attributes, "style")
  if (!style) return undefined
  const declaration = /(?:^|;)\s*color\s*:\s*([^;]+)/i.exec(style)
  const value = declaration?.[1]?.trim()
  return value && COLOR.test(value) ? value : undefined
}

const NAMED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00a0" }

/** Decodifica as entidades de um texto (numéricas e as nomeadas comuns); entidade desconhecida fica como está. */
export function decodeEntities(text: string): string {
  return text.replace(/&(#\d{1,7}|#x[0-9a-f]{1,6}|[a-z]{2,8});/gi, (whole, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? Number.parseInt(body.slice(2), 16) : Number.parseInt(body.slice(1), 10)
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff && (code < 0xd800 || code > 0xdfff) ? String.fromCodePoint(code) : ""
    }
    return NAMED[body.toLowerCase()] ?? whole
  })
}

const escapeText = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")

/** Desmonta o HTML em nós já filtrados e balanceados (texto decodificado). */
export function parseCommunicationHtml(html: string): SanitizedNode[] {
  const nodes: SanitizedNode[] = []
  const stack: string[] = []
  let dropping: string | null = null
  let last = 0
  const pushText = (raw: string) => {
    if (dropping || raw === "") return
    // Um "<" solto (sem formar marca) é texto: entra decodificado e é reescapado na montagem.
    nodes.push({ kind: "text", text: decodeEntities(raw) })
  }
  for (const match of html.matchAll(TOKEN)) {
    pushText(html.slice(last, match.index))
    last = match.index + match[0].length
    const tag = match[2]?.toLowerCase()
    if (!tag) continue // comentário, declaração, instrução de processamento
    const closing = match[1] === "/"
    if (dropping) {
      if (closing && tag === dropping) dropping = null
      continue
    }
    if (DROP_WITH_CONTENT.has(tag)) {
      if (!closing && !/\/\s*$/.test(match[3] ?? "")) dropping = tag
      continue
    }
    if (!ALLOWED.has(tag)) continue
    if (closing) {
      if (VOID.has(tag) || !stack.includes(tag)) continue
      while (stack.length > 0) {
        const open = stack.pop()!
        nodes.push({ kind: "close", tag: open })
        if (open === tag) break
      }
      continue
    }
    const attributes = match[3] ?? ""
    if (tag === "img") {
      const src = attribute(attributes, "src")?.trim() ?? ""
      if (COMMUNICATION_IMAGE_SOURCE.test(src)) nodes.push({ kind: "open", tag, src })
      continue
    }
    if (tag === "br") {
      nodes.push({ kind: "open", tag })
      continue
    }
    if (tag === "a") {
      const href = attribute(attributes, "href")?.trim() ?? ""
      // Link inválido: a marca sai e o texto dela fica (não entra na pilha; o fechamento é ignorado).
      if (!COMMUNICATION_LINK_HREF.test(href) || stack.includes("a")) continue
      nodes.push({ kind: "open", tag, href })
      stack.push(tag)
      continue
    }
    const color = tag === "span" ? colorOf(attributes) : undefined
    nodes.push(color ? { kind: "open", tag, color } : { kind: "open", tag })
    stack.push(tag)
  }
  pushText(html.slice(last))
  while (stack.length > 0) nodes.push({ kind: "close", tag: stack.pop()! })
  return nodes
}

/** Monta o HTML final a partir dos nós (única forma de um comunicado virar HTML no servidor). */
export function renderCommunicationHtml(nodes: readonly SanitizedNode[]): string {
  return nodes
    .map((node) => {
      if (node.kind === "text") return escapeText(node.text)
      if (node.kind === "close") return `</${node.tag}>`
      if (node.tag === "img") return `<img src="${node.src}" alt="Imagem do comunicado">`
      if (node.tag === "br") return "<br>"
      if (node.tag === "a") return `<a href="${escapeText(node.href ?? "")}" target="_blank" rel="noopener noreferrer nofollow">`
      return node.color ? `<span style="color: ${node.color}">` : `<${node.tag}>`
    })
    .join("")
}

const BLOCK = new Set(["p", "div", "li", "h2", "h3", "ul", "ol"])

/** Texto puro do comunicado (limite de tamanho, resumo): derivado do HTML saneado, nunca o que o navegador mandou. */
export function plainTextOf(nodes: readonly SanitizedNode[]): string {
  const parts: string[] = []
  for (const node of nodes) {
    if (node.kind === "text") parts.push(node.text)
    else if (node.tag === "br" || (node.kind === "close" && BLOCK.has(node.tag))) parts.push("\n")
  }
  // Espaço no fim de cada linha sai por linha (sem regex): `/[ \t]+\n/` recomeçava a varrer o mesmo bloco de espaços a cada
  // posição — O(n²) num texto com uma longa sequência de espaços sem quebra de linha (achado COMM-01).
  const lines = parts.join("").replace(/\u00a0/g, " ").split("\n").map(trimTrailingBlanks)
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim()
}

function trimTrailingBlanks(line: string): string {
  let end = line.length
  while (end > 0 && (line[end - 1] === " " || line[end - 1] === "\t")) end -= 1
  return line.slice(0, end)
}

export function sanitizeCommunicationHtml(html: string): { html: string; plainText: string; imageCount: number } {
  const nodes = parseCommunicationHtml(html)
  return { html: renderCommunicationHtml(nodes), plainText: plainTextOf(nodes), imageCount: nodes.filter((node) => node.kind === "open" && node.tag === "img").length }
}
