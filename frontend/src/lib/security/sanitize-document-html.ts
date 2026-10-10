// Sanitização por allowlist do HTML que o backend gera a partir de um DOCX (mammoth). É o mesmo
// desenho do sanitizeRichText dos comunicados, mas com o vocabulário de um documento de verdade
// (títulos h1–h6, tabelas, links, código) — por isso vive separado em vez de afrouxar aquele.
// Tudo que não está na lista é "desembrulhado" (texto preservado, tag removida); atributos são
// zerados e só volta o que é explicitamente seguro.
const allowedTags = new Set([
  "P",
  "BR",
  "HR",
  "STRONG",
  "B",
  "EM",
  "I",
  "U",
  "S",
  "SUP",
  "SUB",
  "UL",
  "OL",
  "LI",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "BLOCKQUOTE",
  "PRE",
  "CODE",
  "TABLE",
  "THEAD",
  "TBODY",
  "TFOOT",
  "TR",
  "TH",
  "TD",
  "A",
  "IMG",
])

// Tags cujo conteúdo interno também some (desembrulhar um <script> deixaria o código como texto).
const droppedTags = new Set(["SCRIPT", "STYLE", "IFRAME", "OBJECT", "EMBED", "SVG", "MATH", "TEMPLATE"])

const safeImageSource = /^data:image\/(png|jpeg|gif|webp);base64,[a-z0-9+/=]+$/i
const safeLinkHref = /^(https?:\/\/|mailto:)/i

export function sanitizeDocumentHtml(html: string) {
  if (typeof DOMParser === "undefined") return ""
  const document = new DOMParser().parseFromString(`<div>${html}</div>`, "text/html")
  const root = document.body.firstElementChild
  if (!root) return ""

  for (const element of Array.from(root.querySelectorAll("*"))) {
    if (droppedTags.has(element.tagName)) {
      element.remove()
      continue
    }
    if (!allowedTags.has(element.tagName)) {
      element.replaceWith(...Array.from(element.childNodes))
      continue
    }

    const href = element.tagName === "A" ? (element.getAttribute("href") ?? "") : ""
    const source = element.tagName === "IMG" ? (element.getAttribute("src") ?? "") : ""
    const alt = element.tagName === "IMG" ? (element.getAttribute("alt") ?? "") : ""
    const colspan = element.tagName === "TD" || element.tagName === "TH" ? element.getAttribute("colspan") : null
    const rowspan = element.tagName === "TD" || element.tagName === "TH" ? element.getAttribute("rowspan") : null
    for (const attribute of Array.from(element.attributes)) element.removeAttribute(attribute.name)

    if (element.tagName === "A") {
      if (safeLinkHref.test(href.trim())) {
        element.setAttribute("href", href.trim())
        element.setAttribute("target", "_blank")
        element.setAttribute("rel", "noopener noreferrer")
      }
      continue
    }
    if (element.tagName === "IMG") {
      if (!safeImageSource.test(source.trim())) element.remove()
      else {
        element.setAttribute("src", source.trim())
        element.setAttribute("alt", alt || "Imagem do documento")
      }
      continue
    }
    if (colspan && /^\d{1,3}$/.test(colspan)) element.setAttribute("colspan", colspan)
    if (rowspan && /^\d{1,3}$/.test(rowspan)) element.setAttribute("rowspan", rowspan)
  }
  return root.innerHTML
}
