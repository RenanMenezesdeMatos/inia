/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { keepPreviousData, QueryClient, QueryClientProvider, useInfiniteQuery } from "@tanstack/react-query"
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { useState } from "react"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import { RemoteCombobox, RemoteComboboxTrigger, RemoteSelectionFooter, remoteListOf, useRemoteCombobox } from "./remote-combobox"

type Item = { id: string; name: string; blocked?: boolean }
type Page = { items: Item[]; next: number | null }
const fetchPage = vi.fn<(search: string, cursor: number, signal: AbortSignal) => Promise<Page>>()

beforeAll(() => {
  Element.prototype.hasPointerCapture = () => false
  Element.prototype.scrollIntoView = () => {}
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  global.ResizeObserver = ResizeObserverStub
})
beforeEach(() => {
  fetchPage.mockReset()
})
afterEach(() => {
  vi.useRealTimers()
  cleanup()
})

const GROUPS: Item[] = Array.from({ length: 5 }, (_, index) => ({ id: `g${index}`, name: `Grupo ${index}` }))
const serve = (search: string, cursor: number): Page => {
  const found = [...GROUPS, { id: "longe", name: "Cobrança" }, { id: "fora", name: "Indisponível", blocked: true }].filter((item) => item.name.toLowerCase().includes(search.toLowerCase()))
  return { items: found.slice(cursor, cursor + 3), next: cursor + 3 < found.length ? cursor + 3 : null }
}

function Field({ multiple = false, onSubmit }: { multiple?: boolean; onSubmit?: () => void }) {
  const state = useRemoteCombobox()
  const [selected, setSelected] = useState<Item[]>([{ id: "salvo", name: "Salvo antigo" }])
  const query = useInfiniteQuery({
    queryKey: ["opcoes", state.term],
    queryFn: ({ pageParam, signal }) => fetchPage(state.term, pageParam, signal),
    initialPageParam: 0,
    getNextPageParam: (last) => last.next,
    placeholderData: keepPreviousData,
    enabled: state.open,
  })
  return (
    <form onSubmit={(event) => { event.preventDefault(); onSubmit?.() }}>
      <RemoteCombobox
        state={state}
        list={remoteListOf(query)}
        multiple={multiple}
        listLabel="Grupos"
        searchLabel="Buscar grupo"
        searchPlaceholder="Buscar"
        emptyText="Nenhum Grupo."
        fixedOptions={[{ id: "any", label: "Qualquer", selected: selected.length === 0, onSelect: () => setSelected([]) }]}
        optionOf={(item) => ({ id: item.id, label: item.name, selected: selected.some((entry) => entry.id === item.id), disabledReason: item.blocked ? "Fora do escopo" : null })}
        onSelect={(item) => setSelected((current) => (multiple ? [...current, item] : [item]))}
        trigger={<RemoteComboboxTrigger label={selected.map((item) => item.name).join(", ") || null} placeholder="Qualquer" aria-label="Grupo" />}
      />
    </form>
  )
}
const renderField = (props: Parameters<typeof Field>[0] = {}) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><Field {...props} /></QueryClientProvider>)
const trigger = () => screen.getByRole("button", { name: /^Grupo:/ })
const search = () => screen.getByRole("combobox", { name: "Buscar grupo" })
const names = () => screen.queryAllByRole("option").map((option) => option.getAttribute("aria-label"))

describe("RemoteCombobox", () => {
  it("só consulta ao abrir, traz um lote pequeno e mantém à vista a escolha que está fora dele", async () => {
    fetchPage.mockImplementation(async (term, cursor) => serve(term, cursor))
    renderField()
    expect(fetchPage).not.toHaveBeenCalled()
    expect(trigger()).toHaveAccessibleName("Grupo: Salvo antigo")
    fireEvent.click(trigger())
    expect(await screen.findByRole("option", { name: "Grupo 0" })).toBeInTheDocument()
    expect(fetchPage).toHaveBeenCalledTimes(1)
    expect(names()).toEqual(["Qualquer", "Grupo 0", "Grupo 1", "Grupo 2"])
    expect(trigger()).toHaveAccessibleName("Grupo: Salvo antigo")
  })

  it("carrega as próximas opções e, se o lote falhar, o que já apareceu fica e dá para tentar de novo", async () => {
    let failing = true
    fetchPage.mockImplementation(async (term, cursor) => {
      if (cursor > 0 && failing) throw new Error("rede")
      return serve(term, cursor)
    })
    renderField()
    fireEvent.click(trigger())
    fireEvent.click(await screen.findByRole("button", { name: "Carregar mais" }))
    expect(await screen.findByText("Não foi possível carregar mais opções.")).toBeInTheDocument()
    expect(screen.getByRole("option", { name: "Grupo 0" })).toBeInTheDocument()
    failing = false
    fireEvent.click(screen.getByRole("button", { name: "Tentar de novo" }))
    expect(await screen.findByRole("option", { name: "Grupo 3" })).toBeInTheDocument()
    expect(screen.queryByText("Não foi possível carregar mais opções.")).not.toBeInTheDocument()
  })

  it("a busca consulta o servidor (acha o que ainda não tinha aparecido) com debounce, e recomeça do primeiro lote", async () => {
    fetchPage.mockImplementation(async (term, cursor) => serve(term, cursor))
    renderField()
    fireEvent.click(trigger())
    await screen.findByRole("option", { name: "Grupo 0" })
    for (const value of ["c", "co", "cob"]) fireEvent.change(search(), { target: { value } })
    expect(await screen.findByRole("option", { name: "Cobrança" })).toBeInTheDocument()
    await waitFor(() => expect(names()).toEqual(["Cobrança"]))
    expect(fetchPage.mock.calls.map(([term, cursor]) => [term, cursor])).toEqual([["", 0], ["cob", 0]])
  })

  it("resposta lenta de um termo antigo não sobrescreve a mais recente", async () => {
    const slow = Promise.withResolvers<Page>()
    fetchPage.mockImplementation((term, cursor) => (term === "grupo" ? slow.promise : Promise.resolve(serve(term, cursor))))
    renderField()
    fireEvent.click(trigger())
    await screen.findByRole("option", { name: "Grupo 0" })
    fireEvent.change(search(), { target: { value: "grupo" } })
    await waitFor(() => expect(fetchPage).toHaveBeenCalledWith("grupo", 0, expect.anything()))
    fireEvent.change(search(), { target: { value: "cobr" } })
    await waitFor(() => expect(names()).toEqual(["Cobrança"]))
    await act(async () => slow.resolve(serve("grupo", 0)))
    expect(names()).toEqual(["Cobrança"])
  })

  it("Enter não escolhe do resultado antigo enquanto a busca nova não chega", async () => {
    const pending = Promise.withResolvers<Page>()
    fetchPage.mockImplementation((term, cursor) => (term ? pending.promise : Promise.resolve(serve(term, cursor))))
    renderField()
    fireEvent.click(trigger())
    await screen.findByRole("option", { name: "Grupo 0" })
    fireEvent.change(search(), { target: { value: "cobr" } })
    fireEvent.keyDown(search(), { key: "Enter" })
    expect(trigger()).toHaveAccessibleName("Grupo: Salvo antigo")
    await act(async () => pending.resolve(serve("cobr", 0)))
    await waitFor(() => expect(names()).toEqual(["Cobrança"]))
    fireEvent.keyDown(search(), { key: "Enter" })
    expect(trigger()).toHaveAccessibleName("Grupo: Cobrança")
  })

  it("teclado: ↑/↓ percorrem, Enter escolhe sem enviar o formulário, Esc fecha e devolve o foco ao gatilho", async () => {
    const onSubmit = vi.fn()
    fetchPage.mockImplementation(async (term, cursor) => serve(term, cursor))
    renderField({ onSubmit })
    trigger().focus()
    fireEvent.click(trigger())
    await screen.findByRole("option", { name: "Grupo 0" })
    expect(search()).toHaveFocus()
    fireEvent.keyDown(search(), { key: "ArrowDown" })
    fireEvent.keyDown(search(), { key: "ArrowDown" })
    fireEvent.keyDown(search(), { key: "ArrowUp" })
    expect(search()).toHaveAttribute("aria-activedescendant", screen.getByRole("option", { name: "Grupo 0" }).id)
    fireEvent.keyDown(search(), { key: "Enter" })
    expect(trigger()).toHaveAccessibleName("Grupo: Grupo 0")
    expect(onSubmit).not.toHaveBeenCalled()
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument()
    await waitFor(() => expect(trigger()).toHaveFocus())
    fireEvent.click(trigger())
    fireEvent.keyDown(await screen.findByRole("combobox", { name: "Buscar grupo" }), { key: "Escape" })
    await waitFor(() => expect(trigger()).toHaveFocus())
  })

  it("chegar perto do fim com a seta pede o próximo lote", async () => {
    fetchPage.mockImplementation(async (term, cursor) => serve(term, cursor))
    renderField()
    fireEvent.click(trigger())
    await screen.findByRole("option", { name: "Grupo 0" })
    fireEvent.keyDown(search(), { key: "ArrowDown" })
    expect(await screen.findByRole("option", { name: "Grupo 3" })).toBeInTheDocument()
  })

  it("busca sem resultados e falha da consulta dizem o que houve", async () => {
    fetchPage.mockImplementation(async (term, cursor) => {
      if (term === "erro") throw new Error("rede")
      return serve(term, cursor)
    })
    renderField()
    fireEvent.click(trigger())
    await screen.findByRole("option", { name: "Grupo 0" })
    fireEvent.change(search(), { target: { value: "zzz" } })
    expect(await screen.findByText("Nada encontrado para “zzz”.")).toBeInTheDocument()
    fireEvent.change(search(), { target: { value: "erro" } })
    expect(await screen.findByText("Não foi possível carregar as opções.")).toBeInTheDocument()
    expect(screen.queryByText(/Nada encontrado/)).not.toBeInTheDocument()
  })

  it("opção indisponível não é escolhida; na escolha múltipla o seletor continua aberto", async () => {
    fetchPage.mockImplementation(async (term, cursor) => serve(term, cursor))
    renderField({ multiple: true })
    fireEvent.click(trigger())
    await screen.findByRole("option", { name: "Grupo 0" })
    fireEvent.click(screen.getByRole("option", { name: "Grupo 1" }))
    expect(screen.getByRole("listbox")).toHaveAttribute("aria-multiselectable", "true")
    fireEvent.change(search(), { target: { value: "indis" } })
    const blocked = await screen.findByRole("option", { name: "Indisponível" })
    fireEvent.click(blocked)
    expect(blocked).toHaveAttribute("aria-disabled", "true")
    expect(trigger()).toHaveAccessibleName("Grupo: Salvo antigo, Grupo 1")
  })

  it("o popover tem nome e a busca respeita o teto do servidor", async () => {
    fetchPage.mockImplementation(async (term, cursor) => serve(term, cursor))
    renderField()
    fireEvent.click(trigger())
    expect(await screen.findByRole("dialog", { name: "Grupos" })).toBeInTheDocument()
    expect(search()).toHaveAttribute("maxlength", "100")
    // Clicar numa opção não tira o foco da busca (setas e digitação continuam).
    expect(fireEvent.mouseDown(await screen.findByRole("option", { name: "Grupo 0" }))).toBe(false)
  })

  it("dentro de um diálogo, com abas no topo, o foco começa na busca; trocar de aba recomeça da primeira opção", async () => {
    fetchPage.mockImplementation(async (term, cursor) => serve(term, cursor))
    renderTabs()
    fireEvent.click(screen.getByRole("button", { name: "Abrir" }))
    await screen.findByRole("option", { name: "Grupo 0" })
    await waitFor(() => expect(screen.getByRole("combobox")).toHaveFocus())
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "ArrowDown" })
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "ArrowDown" })
    fireEvent.click(screen.getByRole("button", { name: "Subgrupos" }))
    await waitFor(() => expect(screen.getByRole("combobox")).toHaveAttribute("aria-activedescendant", screen.getByRole("option", { name: "Grupo 0" }).id))
  })

  it("\"Limpar\" some ao ser usado e o foco volta para a busca", async () => {
    fetchPage.mockImplementation(async (term, cursor) => serve(term, cursor))
    renderTabs()
    fireEvent.click(screen.getByRole("button", { name: "Abrir" }))
    const clear = await screen.findByRole("button", { name: "Limpar" })
    clear.focus()
    fireEvent.click(clear)
    expect(screen.queryByRole("button", { name: "Limpar" })).not.toBeInTheDocument()
    expect(screen.getByRole("combobox")).toHaveFocus()
  })
})

/** Seletor de abas e rodapé, dentro de um diálogo (como o alcance na criação de um cadastro). */
function Tabbed() {
  const state = useRemoteCombobox()
  const [kind, setKind] = useState("Grupos")
  const [count, setCount] = useState(2)
  const query = useInfiniteQuery({ queryKey: ["opcoes", kind, state.term], queryFn: ({ pageParam, signal }) => fetchPage(state.term, pageParam, signal), initialPageParam: 0, getNextPageParam: (last) => last.next, enabled: state.open })
  return (
    <div role="dialog" aria-label="Novo cadastro">
      <RemoteCombobox
        state={state}
        list={remoteListOf(query)}
        multiple
        listLabel={kind}
        searchLabel="Buscar"
        searchPlaceholder="Buscar"
        emptyText="Nada."
        optionOf={(item) => ({ id: item.id, label: item.name, selected: false })}
        onSelect={() => {}}
        header={<><button type="button" onClick={() => setKind("Grupos")}>Grupos</button><button type="button" onClick={() => setKind("Subgrupos")}>Subgrupos</button></>}
        footer={<RemoteSelectionFooter count={count} summary="2 no filtro" emptyText="Qualquer" onClear={() => setCount(0)} onDone={() => state.setOpen(false)} />}
        trigger={<button type="button">Abrir</button>}
      />
    </div>
  )
}
const renderTabs = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><Tabbed /></QueryClientProvider>)
