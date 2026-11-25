// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { useUsabilitySearch } from "./use-usability-search"

let url = ""
const replace = vi.fn()
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }), usePathname: () => "/admin/usability", useSearchParams: () => new URLSearchParams(url) }))

const setup = () => {
  const view = renderHook(() => useUsabilitySearch())
  const arrive = (next: string) => { url = next; view.rerender() }
  const mark = (id: string) => act(() => {
    const next = new URLSearchParams(view.result.current.search)
    next.set("teamId", [...(next.get("teamId")?.split(",") ?? []), id].join(","))
    view.result.current.navigate(next)
  })
  const teams = () => view.result.current.search.get("teamId")
  return { view, arrive, mark, teams }
}

describe("recorte da Usabilidade na URL", () => {
  beforeEach(() => { url = ""; replace.mockReset() })

  it("marcas seguidas somam, mesmo com o endereço indo e voltando no caminho", () => {
    const { arrive, mark, teams } = setup()
    mark("a")
    mark("b")
    arrive("teamId=a")
    expect(teams()).toBe("a,b")
    arrive("")
    expect(teams()).toBe("a,b")
    mark("c")
    expect(teams()).toBe("a,b,c")
    arrive("teamId=a%2Cb")
    expect(teams()).toBe("a,b,c")
    arrive("teamId=a%2Cb%2Cc")
    expect(teams()).toBe("a,b,c")
    expect(replace).toHaveBeenCalledTimes(3)
  })

  it("depois de chegar, o endereço manda; endereço de fora também", () => {
    const { arrive, mark, teams } = setup()
    mark("a")
    arrive("teamId=a")
    arrive("")
    expect(teams()).toBeNull()
    mark("b")
    arrive("teamId=z")
    expect(teams()).toBe("z")
  })

  it("voltar do navegador solta o pedido", () => {
    const { mark, teams } = setup()
    mark("a")
    act(() => { window.dispatchEvent(new PopStateEvent("popstate")) })
    expect(teams()).toBeNull()
  })
})
