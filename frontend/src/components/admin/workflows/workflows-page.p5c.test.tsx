/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { cleanup, screen } from "@testing-library/react"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"

import { installJsdomStubs } from "@/components/analytics/testing/jsdom-stubs"
import { renderWithQuery } from "@/components/analytics/testing/render-with-query"
import type { Workflow } from "@/schemas/admin/workflow.schema"

import { WorkflowCard, WorkflowsTable } from "./workflows-page"

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => "/admin/workflows", useSearchParams: () => new URLSearchParams() }))

/** P5c (`docs/qa/workflows/propostas.md`): a contagem de bloqueadas cobre a versão sem publicador ativo, que não avisa ninguém. */
const workflow = (blockedEnrollments: number): Workflow => ({
  id: "wf-1",
  name: "Revisão de monitoria",
  description: null,
  scopeType: "ALL_TEAMS",
  teamId: null,
  teamName: null,
  subteamId: null,
  subteamName: null,
  active: true,
  createdAt: "2026-11-01T10:00:00Z",
  published: true,
  trigger: { kind: "manual", context: "COLLABORATOR" },
  activeEnrollments: 3,
  blockedEnrollments,
  consolidatedStructure: null,
  populationFilter: null,
  configurationChanges: [],
})

beforeAll(installJsdomStubs)
afterEach(cleanup)

describe("P5c · contagem de bloqueadas na lista de workflows", () => {
  it("o cartão mostra as bloqueadas separadas das em execução", () => {
    renderWithQuery(<WorkflowCard workflow={workflow(2)} />)
    expect(screen.getByText("2 bloqueadas")).toBeInTheDocument()
    expect(screen.getByText("3 em execução")).toBeInTheDocument()
  })

  it("a tabela também mostra, no singular quando é uma", () => {
    renderWithQuery(<WorkflowsTable workflows={[workflow(1)]} />)
    expect(screen.getByText("1 bloqueada")).toBeInTheDocument()
  })

  it("sem bloqueadas, nada aparece", () => {
    renderWithQuery(<WorkflowCard workflow={workflow(0)} />)
    expect(screen.queryByText(/bloquead/)).not.toBeInTheDocument()
  })
})
