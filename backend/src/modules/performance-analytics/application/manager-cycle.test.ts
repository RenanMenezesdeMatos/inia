import { describe, expect, it } from "vitest"
import { isLeaderAbove } from "../../leadership-analytics/application/workforce.js"
import { ORG, person } from "../testing/in-memory-analytics-repository.js"
import { buildAnalyticsSubject } from "../domain/analytics-subject.js"
import { isDirectMember } from "./build-team-overview.js"
import { buildBreadcrumb, type ViewerScope } from "./viewer-scope.js"

/**
 * A base do cliente pode trazer gestores em círculo (A responde a B e B responde a A). Subir a cadeia precisa TERMINAR: um laço síncrono
 * aqui tirava o processo da API do ar para todos (CFD-02, run-12).
 */
const A = "60000000-0000-4000-8000-00000000000a"
const B = "60000000-0000-4000-8000-00000000000b"
const O = "60000000-0000-4000-8000-00000000000c"
const VIEWER = "60000000-0000-4000-8000-00000000000d"

function cycleScope(levels: "MANAGER" | "STAFF"): ViewerScope {
  const people = [
    person({ id: A, name: "Gestor A", role: levels, reportsToId: B }),
    person({ id: B, name: "Gestor B", role: levels, reportsToId: A }),
    person({ id: O, name: "Operador", role: "OPERATOR", reportsToId: A }),
    person({ id: VIEWER, name: "Quem olha", role: "DIRECTOR" }),
  ]
  const nodes = new Map(people.map((item) => [item.id, item]))
  const viewer = nodes.get(VIEWER)!
  return { organizationId: ORG, viewer, role: "DIRECTOR", nodes, children: new Map(), access: { organizationWide: true, teamIds: [], subteamIds: [] } } as unknown as ViewerScope
}

describe("gestores em círculo", () => {
  it("a trilha termina e cita cada gestor uma vez", () => {
    const trail = buildBreadcrumb(cycleScope("MANAGER"), buildAnalyticsSubject("EMPLOYEE", O)).map((entry) => entry.label)
    expect(trail.filter((label) => label === "Gestor A")).toHaveLength(1)
    expect(trail.at(-1)).toBe("Operador")
  })

  it("membro direto e líder acima respondem sem laço", () => {
    const scope = cycleScope("STAFF")
    expect(isDirectMember(scope, null, scope.nodes.get(O)!)).toBe(true)
    expect(isLeaderAbove(scope, scope.viewer, [scope.nodes.get(O)!])).toBe(false)
    expect(isLeaderAbove(scope, scope.nodes.get(B)!, [scope.nodes.get(O)!])).toBe(true)
  })
})
