const allowedTags = new Set(["P", "DIV", "BR", "STRONG", "B", "EM", "I", "UL", "OL", "LI", "H2", "H3", "SPAN", "IMG", "A"])

/**
 * Link aceito: a mesma forma de `COMMUNICATION_LINK_HREF` no servidor — endereço web (`http(s)://`) ou caminho interno (`/…`, nunca
 * `//` nem `/\`), sem espaço, aspas, `<>`, crase ou barra invertida. Outro esquema (`javascript:`, `data:`…) faz o link sair e o
 * texto ficar. O link sempre abre em outra aba, com `rel` fixo.
 */
export const RICH_TEXT_LINK_HREF = /^(?:https?:\/\/[^\s"'<>`\\]{1,1990}|\/(?![/\\])[^\s"'<>`\\]{0,1990})$/i

/**
 * Imagem aceita: a URL de dados INTEIRA, ancorada no alfabeto base64 — a mesma forma de `COMMUNICATION_IMAGE_SOURCE` no servidor
 * (`backend/src/modules/communications/domain/communication-content.ts`), sensível a maiúsculas como lá (achado H-FE-1: antes só o
 * começo era conferido e qualquer coisa depois da vírgula passava). Sem GIF: o servidor recusa GIF (não sabe tirar os metadados
 * dele) e nunca o grava.
 */
export const RICH_TEXT_IMAGE_SOURCE = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/

export function sanitizeRichText(html: string) {
  if (typeof DOMParser === "undefined") return ""
  const document = new DOMParser().parseFromString(`<div>${html}</div>`, "text/html")
  const root = document.body.firstElementChild
  if (!root) return ""

  for (const element of Array.from(root.querySelectorAll("*"))) {
    if (!allowedTags.has(element.tagName)) {
      element.replaceWith(...Array.from(element.childNodes))
      continue
    }
    const source = element.tagName === "IMG" ? element.getAttribute("src") ?? "" : ""
    const href = element.tagName === "A" ? (element.getAttribute("href") ?? "").trim() : ""
    const color = element.tagName === "SPAN" ? (element as HTMLElement).style.color : ""
    for (const attribute of Array.from(element.attributes)) element.removeAttribute(attribute.name)
    if (element.tagName === "IMG") {
      if (!RICH_TEXT_IMAGE_SOURCE.test(source)) element.remove()
      else {
        element.setAttribute("src", source)
        element.setAttribute("alt", "Imagem do comunicado")
      }
    }
    if (element.tagName === "A") {
      if (!RICH_TEXT_LINK_HREF.test(href) || element.parentElement?.closest("a")) {
        element.replaceWith(...Array.from(element.childNodes))
        continue
      }
      element.setAttribute("href", href)
      element.setAttribute("target", "_blank")
      element.setAttribute("rel", "noopener noreferrer nofollow")
    }
    if (element.tagName === "SPAN") {
      if (/^(#[0-9a-f]{6}|rgb\(\d{1,3}, \d{1,3}, \d{1,3}\))$/i.test(color)) element.setAttribute("style", `color: ${color}`)
    }
  }
  return root.innerHTML
}
