/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { TooltipProvider } from "@/components/ui/tooltip"
import type { AnjoWorkspaceContextValue } from "@/queries/human-support/anjo-workspace-provider"

import { AnjoShortcut, anjoShortcutLabel } from "./anjo-shortcut"

const hook = vi.hoisted(() => ({ value: null as unknown as Partial<AnjoWorkspaceContextValue> }))
vi.mock("@/queries/human-support/anjo-workspace-provider", () => ({ useAnjoWorkspace: () => hook.value }))
afterEach(cleanup)

const show = (value: Partial<AnjoWorkspaceContextValue>) => {
  hook.value = { available: true, areaVisible: false, attention: { attendances: 0, unread: 0, awaitingResponse: false }, ...value }
  return render(<TooltipProvider><AnjoShortcut profileHref="/operator" /></TooltipProvider>)
}

describe("atalho da área do Anjo no cabeçalho", () => {
  it("leva à aba \"Apoio\" do perfil; mostra o número de mensagens novas", () => {
    show({ attention: { attendances: 2, unread: 3, awaitingResponse: false } })
    const link = screen.getByTestId("anjo-shortcut")
    expect(link).toHaveAttribute("href", "/operator?tab=apoio")
    expect(link).toHaveAccessibleName("Área do Anjo — 2 atendimentos em andamento, 3 mensagens novas")
    expect(screen.getByTestId("anjo-shortcut-count")).toHaveTextContent("3")
  })

  it("sem mensagem nova, um ponto quando há atendimento sem resposta; nada a sinalizar, só o ícone", () => {
    show({ attention: { attendances: 1, unread: 0, awaitingResponse: true } })
    expect(screen.getByTestId("anjo-shortcut-dot")).toBeInTheDocument()
    cleanup()
    show({})
    expect(screen.queryByTestId("anjo-shortcut-dot")).not.toBeInTheDocument()
    expect(screen.queryByTestId("anjo-shortcut-count")).not.toBeInTheDocument()
  })

  it("some com a área na tela e para quem não é Anjo", () => {
    show({ areaVisible: true, attention: { attendances: 1, unread: 1, awaitingResponse: false } })
    expect(screen.queryByTestId("anjo-shortcut")).not.toBeInTheDocument()
    cleanup()
    show({ available: false })
    expect(screen.queryByTestId("anjo-shortcut")).not.toBeInTheDocument()
    expect(anjoShortcutLabel({ attendances: 0, unread: 0, awaitingResponse: false })).toBe("Área do Anjo")
  })
})
