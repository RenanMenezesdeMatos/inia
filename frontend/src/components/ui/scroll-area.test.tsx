/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { cleanup, render } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import { ScrollArea } from "./scroll-area"

afterEach(cleanup)

describe("ScrollArea", () => {
  it("o conteúdo é bloco, não a tabela do Radix: uma tabela larga numa mensagem rola dentro dela em vez de alargar a lista e cortar a borda direita", () => {
    const { container } = render(<ScrollArea className="h-40"><p>mensagem</p></ScrollArea>)
    const viewport = container.querySelector("[data-slot=scroll-area-viewport]")
    expect(viewport).toHaveClass("[&>div]:block!")
    // O Radix continua pondo `display: table` inline no filho; a classe acima o sobrepõe com !important.
    expect(viewport?.firstElementChild).toHaveStyle({ display: "table" })
  })
})
