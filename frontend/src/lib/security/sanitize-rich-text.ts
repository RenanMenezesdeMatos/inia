const allowedTags = new Set(["P", "DIV", "BR", "STRONG", "B", "EM", "I", "UL", "OL", "LI", "H2", "H3", "SPAN", "IMG"])

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
    const color = element.tagName === "SPAN" ? (element as HTMLElement).style.color : ""
    for (const attribute of Array.from(element.attributes)) element.removeAttribute(attribute.name)
    if (element.tagName === "IMG") {
      if (!/^data:image\/(png|jpeg|webp|gif);base64,/i.test(source)) element.remove()
      else {
        element.setAttribute("src", source)
        element.setAttribute("alt", "Imagem do comunicado")
      }
    }
    if (element.tagName === "SPAN") {
      if (/^(#[0-9a-f]{6}|rgb\(\d{1,3}, \d{1,3}, \d{1,3}\))$/i.test(color)) element.setAttribute("style", `color: ${color}`)
    }
  }
  return root.innerHTML
}
