import { describe, expect, it } from "vitest"
import { sanitizeCommunicationHtml } from "./communication-content.js"

const clean = (html: string) => sanitizeCommunicationHtml(html).html

describe("conteúdo do comunicado — HTML refeito pelo servidor", () => {
  it("mantém só as marcas da lista, sem atributo nenhum", () => {
    expect(clean(`<p class="x" onclick="alert(1)">Olá <strong id="a">time</strong></p>`)).toBe("<p>Olá <strong>time</strong></p>")
    expect(clean(`<h2 style="color:red">Título</h2><ul><li>um</li><li>dois</li></ul>`)).toBe("<h2>Título</h2><ul><li>um</li><li>dois</li></ul>")
  })

  it("tira script, style e afins COM o conteúdo; marca desconhecida sai e o texto fica", () => {
    expect(clean(`<p>a<script>alert(1)</script>b</p>`)).toBe("<p>ab</p>")
    expect(clean(`<style>p{}</style><a href="javascript:alert(1)">link</a>`)).toBe("link")
    expect(clean(`<svg><script>x</script></svg>ok<iframe src="//evil"></iframe>`)).toBe("ok")
    expect(clean(`<!-- comentário --><p>fim</p>`)).toBe("<p>fim</p>")
  })

  it("reescapa o texto: nada que vira marca passa", () => {
    expect(clean(`<p>1 &lt; 2 &amp;&amp; <b>x</b> &gt; y</p>`)).toBe("<p>1 &lt; 2 &amp;&amp; <b>x</b> &gt; y</p>")
    expect(clean(`<p>&lt;img src=x onerror=alert(1)&gt;</p>`)).toBe("<p>&lt;img src=x onerror=alert(1)&gt;</p>")
    expect(clean(`texto < solto e "aspas"`)).toBe("texto &lt; solto e &quot;aspas&quot;")
    expect(clean(`<img src=x onerror=alert(1)>`)).toBe("")
  })

  it("cor só hexadecimal ou rgb(); imagem só data:image em base64", () => {
    expect(clean(`<span style="color: #a1b2c3; background: url(x)">c</span>`)).toBe(`<span style="color: #a1b2c3">c</span>`)
    expect(clean(`<span style="color: expression(alert(1))">c</span>`)).toBe("<span>c</span>")
    expect(clean(`<img src="data:image/png;base64,iVBORw0KGgo=" onload="x">`)).toBe(`<img src="data:image/png;base64,iVBORw0KGgo=" alt="Imagem do comunicado">`)
    expect(clean(`<img src="data:image/svg+xml;base64,PHN2Zz4=">`)).toBe("")
    expect(clean(`<img src="https://evil/x.png">`)).toBe("")
  })

  it("marcas sempre balanceadas", () => {
    expect(clean(`<p><strong>aberto`)).toBe("<p><strong>aberto</strong></p>")
    expect(clean(`</p>solto</strong>`)).toBe("solto")
    expect(clean(`<p><em>a</p>b`)).toBe("<p><em>a</em></p>b")
  })

  it("texto puro derivado do HTML saneado (nunca o que o navegador mandou)", () => {
    expect(sanitizeCommunicationHtml(`<p>Linha 1</p><p>Linha&nbsp;2<br>3</p><script>oculto</script>`).plainText).toBe("Linha 1\nLinha 2\n3")
  })

  // COMM-01: o tokenizador e o texto puro são lineares. No código antigo, `"<a".repeat(100_000)` levava dezenas de segundos.
  it.each([
    ["\"<a\" repetido", "<a".repeat(100_000)],
    ["\"<a \\\"\" repetido", '<a "'.repeat(100_000)],
    ["\"<a x=\" repetido", "<a x=".repeat(100_000)],
    ["espaços longos sem quebra", `<p>${" ".repeat(1_000_000)}x</p>`],
  ])("sanea %s em menos de 200 ms", (_name, html) => {
    const started = performance.now()
    sanitizeCommunicationHtml(html)
    expect(performance.now() - started).toBeLessThan(200)
  })

  it("um \"<\" fora de aspas encerra a tentativa de marca; dentro de aspas continua valendo", () => {
    expect(clean(`<p>a <a<b>negrito</b></p>`)).toBe("<p>a &lt;a<b>negrito</b></p>")
    expect(clean(`<span title="1 < 2" style="color: #112233">c</span>`)).toBe(`<span style="color: #112233">c</span>`)
    expect(sanitizeCommunicationHtml(`<p>linha com espaços   </p><p>\tfim\t</p>`).plainText).toBe("linha com espaços\n\tfim")
  })
})
