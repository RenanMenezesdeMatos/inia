/** @vitest-environment jsdom */
import { cleanup, render } from "@testing-library/react"
import { getNonce } from "get-nonce"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"

import { ChartStyle } from "@/components/ui/chart"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { CspNonceProvider } from "./csp-nonce"

beforeAll(() => {
  // O Select do Radix rola até o item escolhido ao abrir; o jsdom não implementa.
  Element.prototype.scrollIntoView = () => {}
})
afterEach(cleanup)

// R-07: com `style-src-elem` exigindo nonce, todo <style> criado no navegador precisa dele.
describe("nonce da CSP para os <style> criados no navegador", () => {
  it("o ChartStyle (cores dos gráficos) sai com o nonce da página", () => {
    const { container } = render(
      <CspNonceProvider nonce="bm9uY2UtZ3JhZmljbw==">
        <ChartStyle id="chart-teste" config={{ total: { label: "Total", color: "#123456" } }} />
      </CspNonceProvider>,
    )
    const style = container.querySelector("style")
    expect(style?.getAttribute("nonce")).toBe("bm9uY2UtZ3JhZmljbw==")
    expect(style?.textContent).toContain("--color-total: #123456;")
  })

  it("a trava de rolagem do Radix (react-style-singleton) recebe o mesmo nonce pelo get-nonce", () => {
    render(<CspNonceProvider nonce="bm9uY2UtcmFkaXg=">{null}</CspNonceProvider>)
    expect(getNonce()).toBe("bm9uY2UtcmFkaXg=")
  })

  it("os viewports do Radix (ScrollArea e Select) escrevem o <style> com o nonce", () => {
    render(
      <CspNonceProvider nonce="bm9uY2Utdmlld3BvcnQ=">
        <ScrollArea>conteúdo</ScrollArea>
        <Select open value="a">
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="a">A</SelectItem></SelectContent>
        </Select>
      </CspNonceProvider>,
    )
    const styles = [...document.querySelectorAll("style")].filter((style) => style.textContent?.includes("-viewport]"))
    expect(styles.map((style) => style.textContent?.match(/data-radix-[a-z-]+-viewport/)?.[0]).sort()).toEqual(["data-radix-scroll-area-viewport", "data-radix-select-viewport"])
    expect(styles.every((style) => style.getAttribute("nonce") === "bm9uY2Utdmlld3BvcnQ=")).toBe(true)
  })
})

describe("nonce do documento no navegador", () => {
  it("fica o primeiro visto: o nonce novo de um router.refresh() não vale para a CSP desta página", async () => {
    vi.resetModules()
    const { pinDocumentNonce } = await import("./csp-nonce")
    expect(pinDocumentNonce("bm9uY2UtZG9jdW1lbnRv")).toBe("bm9uY2UtZG9jdW1lbnRv")
    expect(pinDocumentNonce("bm9uY2UtcmVmcmVzaA==")).toBe("bm9uY2UtZG9jdW1lbnRv")
  })
})
