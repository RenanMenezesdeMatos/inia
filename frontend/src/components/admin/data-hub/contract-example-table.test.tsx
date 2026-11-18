/** @vitest-environment jsdom */
import { cleanup, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import type { DataContract } from "@/schemas/admin/data-hub.schema"
import { ContractExampleTable } from "./contract-example-table"

afterEach(cleanup)

const base = { version: 1, description: ".", category: "MASTER" as const, targetEntity: "x", dependencies: [] as string[], writeSemantics: "UPSERT" as const, writePolicy: "PARTIAL_ALLOWED" as const, businessTimeField: null }

const EMPLOYEES: DataContract = {
  ...base,
  key: "EMPLOYEES",
  label: "Colaboradores",
  fields: [{ key: "externalEmployeeId", label: "Matrícula", type: "STRING", required: true, identity: true, description: ".", example: "OP-1" }],
  naturalKey: ["externalEmployeeId"],
  foreignKeys: [],
  examples: [],
}

const ACTIVITIES: DataContract = {
  ...base,
  key: "WORK_SCHEDULE_ACTIVITIES",
  label: "Atividades escaladas",
  dependencies: ["EMPLOYEES"],
  fields: [
    { key: "externalEmployeeId", label: "Matrícula", type: "STRING", required: true, identity: true, description: ".", example: "OP-1" },
    { key: "scheduleDate", label: "Data", type: "DATE", required: true, description: ".", example: "2026-11-17" },
    { key: "activityName", label: "Atividade", type: "STRING", required: true, description: ".", example: "Pausa" },
    { key: "externalActivityId", label: "ID", type: "STRING", required: false, description: ".", example: "ATV-1" },
  ],
  naturalKey: ["externalEmployeeId", "scheduleDate", "activityName"],
  foreignKeys: [{ field: "externalEmployeeId", references: [{ contract: "EMPLOYEES", field: "externalEmployeeId" }] }],
  examples: [
    { externalEmployeeId: "OP-10234", scheduleDate: "2026-11-17", activityName: "Pausa NR17", externalActivityId: null },
    { externalEmployeeId: "OP-10234", scheduleDate: "2026-11-17", activityName: "Lanche", externalActivityId: "ATV-9" },
  ],
}

describe("exemplo da tabela na origem", () => {
  it("uma coluna por campo, uma linha por exemplo, vazio explícito e chaves marcadas", () => {
    render(<ContractExampleTable contract={ACTIVITIES} contracts={[EMPLOYEES, ACTIVITIES]} />)
    const table = screen.getByRole("table", { name: /Atividades escaladas/ })
    const headers = within(table).getAllByRole("columnheader")
    expect(headers.map((header) => header.textContent)).toEqual(["PKFKexternalEmployeeId", "PKscheduleDate", "PKactivityName", "externalActivityId"])
    expect(within(headers[0]!).getByLabelText("Chave primária")).toBeTruthy()
    expect(within(headers[0]!).getByLabelText("Chave estrangeira")).toBeTruthy()
    expect(within(headers[3]!).queryByLabelText(/Chave/)).toBeNull()
    expect(within(table).getAllByRole("row")).toHaveLength(3)
    expect(within(table).getByText("Pausa NR17")).toBeTruthy()
    expect(within(table).getByText("vazio")).toBeTruthy()
    expect(screen.getByText(/Chave primária composta/).textContent).toContain("externalEmployeeId + scheduleDate + activityName")
    expect(screen.getByText(/precisa existir em/).textContent).toContain("Colaboradores › externalEmployeeId")
  })

  it("referência a mais de um destino e a catálogo da INIA", () => {
    const goals: DataContract = {
      ...base,
      key: "GOALS",
      label: "Metas",
      fields: [
        { key: "indicatorCode", label: "Indicador", type: "STRING", required: true, description: ".", example: "TMA" },
        { key: "subjectExternalCode", label: "Sujeito", type: "STRING", required: true, identity: true, description: ".", example: "G1" },
      ],
      naturalKey: ["indicatorCode", "subjectExternalCode"],
      foreignKeys: [
        { field: "indicatorCode", references: [{ catalog: "Catálogo de indicadores da INIA" }] },
        { field: "subjectExternalCode", references: [{ contract: "GROUPS", field: "externalCode" }, { contract: "EMPLOYEES", field: "externalEmployeeId" }] },
      ],
      examples: [{ indicatorCode: "TMA", subjectExternalCode: "G1" }],
    }
    render(<ContractExampleTable contract={goals} contracts={[EMPLOYEES]} />)
    const notes = screen.getAllByText(/precisa existir em/).map((node) => node.textContent)
    expect(notes).toEqual(["indicatorCode precisa existir em Catálogo de indicadores da INIA.", "subjectExternalCode precisa existir em GROUPS › externalCode ou Colaboradores › externalEmployeeId."])
  })
})
