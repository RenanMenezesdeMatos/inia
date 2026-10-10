import { describe, expect, it } from "vitest"
import { DomainError } from "../../../shared/domain/domain-error.js"
import { describeUnresolvedRecipient, requireStructureRecipient, resolveStructureRecipient } from "./organizational-recipient.js"
import { inMemoryHierarchyReader, type InMemoryPerson } from "../testing/in-memory-hierarchy-reader.js"

/**
 * Estrutura pequena mas com todos os casos que importam:
 *
 *   Diretor Dora
 *   └ Gerente Sênior Sérgio
 *     ├ Gerente Gustavo ── Coordenador Carla ── Supervisor Sonia ── op1, op2 (Grupo G1 / Subgrupo S1)
 *     │                                      └ Supervisor Selma ── op3        (Grupo G1 / Subgrupo S2)
 *     └ Gerente Gilda ─────────────────────── Supervisor Sara ─── op4, op5   (Grupo G2, sem subgrupo)
 *
 * Grupo G1 tem 2 Supervisores (Sonia, Selma), 1 Coordenador, 1 Gerente. Subgrupo S1 tem 1
 * Supervisor. Grupo G3 (só op6, cujo supervisor está INATIVO) não tem Supervisor ativo.
 */
const PEOPLE: InMemoryPerson[] = [
  { id: "dora", name: "Dora", role: "DIRECTOR", reportsToId: null },
  { id: "sergio", name: "Sérgio", role: "SENIOR_MANAGER", reportsToId: "dora" },
  { id: "gustavo", name: "Gustavo", role: "MANAGER", reportsToId: "sergio" },
  { id: "gilda", name: "Gilda", role: "MANAGER", reportsToId: "sergio" },
  { id: "carla", name: "Carla", role: "COORDINATOR", reportsToId: "gustavo" },
  { id: "sonia", name: "Sonia", role: "SUPERVISOR", reportsToId: "carla" },
  { id: "selma", name: "Selma", role: "SUPERVISOR", reportsToId: "carla" },
  { id: "sara", name: "Sara", role: "SUPERVISOR", reportsToId: "gilda" },
  { id: "sueli", name: "Sueli", role: "SUPERVISOR", reportsToId: "gilda", active: false },
  // Operadores — o id "aaaa-op1" sendo o "menor UUID" é proposital: nenhum teste pode depender disso.
  { id: "aaaa-op1", name: "Op 1", role: "OPERATOR", reportsToId: "sonia", teamId: "G1", subteamId: "S1" },
  { id: "op2", name: "Op 2", role: "OPERATOR", reportsToId: "sonia", teamId: "G1", subteamId: "S1" },
  { id: "op3", name: "Op 3", role: "OPERATOR", reportsToId: "selma", teamId: "G1", subteamId: "S2" },
  { id: "op4", name: "Op 4", role: "OPERATOR", reportsToId: "sara", teamId: "G2", subteamId: null },
  { id: "op5", name: "Op 5", role: "OPERATOR", reportsToId: "sara", teamId: "G2", subteamId: null },
  { id: "op6", name: "Op 6", role: "OPERATOR", reportsToId: "sueli", teamId: "G3", subteamId: null },
]
const reader = inMemoryHierarchyReader(PEOPLE)

describe("resolveStructureRecipient — destinatário de gestão determinístico por estrutura", () => {
  it("A. SUPERVISOR_TEAM → Supervisor único (a própria âncora)", async () => {
    const resolution = await resolveStructureRecipient(reader, { kind: "SUPERVISOR_TEAM", supervisorId: "sonia" }, "SUPERVISOR")
    expect(resolution).toMatchObject({ status: "RESOLVED", person: { id: "sonia" } })
  })

  it("B. SUPERVISOR_TEAM → Gerente pela cadeia acima (passando pelo Coordenador)", async () => {
    const resolution = await resolveStructureRecipient(reader, { kind: "SUPERVISOR_TEAM", supervisorId: "sonia" }, "MANAGER")
    expect(resolution).toMatchObject({ status: "RESOLVED", person: { id: "gustavo" } })
    const director = await resolveStructureRecipient(reader, { kind: "SUPERVISOR_TEAM", supervisorId: "sonia" }, "DIRECTOR")
    expect(director).toMatchObject({ status: "RESOLVED", person: { id: "dora" } })
  })

  it("C. GROUP → um Supervisor possível (G2: todos os membros reportam a Sara)", async () => {
    const resolution = await resolveStructureRecipient(reader, { kind: "TEAM", teamId: "G2" }, "SUPERVISOR")
    expect(resolution).toMatchObject({ status: "RESOLVED", person: { id: "sara" } })
  })

  it("D. GROUP → vários Supervisores → AMBIGUOUS, listando os candidatos, nunca 'o primeiro'", async () => {
    const resolution = await resolveStructureRecipient(reader, { kind: "TEAM", teamId: "G1" }, "SUPERVISOR")
    expect(resolution.status).toBe("AMBIGUOUS")
    if (resolution.status !== "AMBIGUOUS") throw new Error("unreachable")
    expect(resolution.candidates.map((person) => person.id).sort()).toEqual(["selma", "sonia"])
    expect(describeUnresolvedRecipient(resolution)).toBe(
      "Esta estrutura possui mais de um Supervisor possível (2: Selma, Sonia). Escolha um destinatário compatível ou uma estrutura com responsável inequívoco.",
    )
    // O mesmo Grupo tem UM Coordenador e UM Gerente — cargos acima da bifurcação resolvem.
    await expect(resolveStructureRecipient(reader, { kind: "TEAM", teamId: "G1" }, "COORDINATOR")).resolves.toMatchObject({ status: "RESOLVED", person: { id: "carla" } })
    await expect(resolveStructureRecipient(reader, { kind: "TEAM", teamId: "G1" }, "MANAGER")).resolves.toMatchObject({ status: "RESOLVED", person: { id: "gustavo" } })
  })

  it("E. SUBGROUP → um Gerente possível", async () => {
    const resolution = await resolveStructureRecipient(reader, { kind: "SUBTEAM", subteamId: "S1" }, "MANAGER")
    expect(resolution).toMatchObject({ status: "RESOLVED", person: { id: "gustavo" } })
    await expect(resolveStructureRecipient(reader, { kind: "SUBTEAM", subteamId: "S1" }, "SUPERVISOR")).resolves.toMatchObject({ status: "RESOLVED", person: { id: "sonia" } })
  })

  it("F. SUBGROUP → vários Gerentes → AMBIGUOUS", async () => {
    // Subgrupo "misto": op2 passa a reportar a Sara (Gerente Gilda) — dois Gerentes no mesmo Subgrupo.
    const mixed = inMemoryHierarchyReader(PEOPLE.map((person) => (person.id === "op2" ? { ...person, reportsToId: "sara" } : person)))
    const resolution = await resolveStructureRecipient(mixed, { kind: "SUBTEAM", subteamId: "S1" }, "MANAGER")
    expect(resolution.status).toBe("AMBIGUOUS")
    if (resolution.status !== "AMBIGUOUS") throw new Error("unreachable")
    expect(resolution.candidates.map((person) => person.name)).toEqual(["Gilda", "Gustavo"])
  })

  it("G. nenhuma pessoa do papel → NOT_FOUND (supervisor inativo não conta; estrutura sem Coordenador; Grupo vazio)", async () => {
    const noSupervisor = await resolveStructureRecipient(reader, { kind: "TEAM", teamId: "G3" }, "SUPERVISOR")
    expect(noSupervisor).toEqual({ status: "NOT_FOUND", role: "SUPERVISOR" })
    expect(describeUnresolvedRecipient(noSupervisor as Extract<typeof noSupervisor, { status: "NOT_FOUND" }>)).toBe("Não foi possível determinar um Supervisor responsável por esta estrutura.")
    // Estrutura da Gerente Gilda não tem Coordenador nem acima nem abaixo.
    await expect(resolveStructureRecipient(reader, { kind: "MANAGER_STRUCTURE", managerId: "gilda" }, "COORDINATOR")).resolves.toEqual({ status: "NOT_FOUND", role: "COORDINATOR" })
    await expect(resolveStructureRecipient(reader, { kind: "TEAM", teamId: "G-inexistente" }, "MANAGER")).resolves.toEqual({ status: "NOT_FOUND", role: "MANAGER" })
    await expect(resolveStructureRecipient(reader, { kind: "SUPERVISOR_TEAM", supervisorId: "ninguem" }, "SUPERVISOR")).resolves.toEqual({ status: "NOT_FOUND", role: "SUPERVISOR" })
  })

  it("H. nenhum 'membro qualquer' influencia o resultado — a ordem/identidade dos operadores não muda a resposta", async () => {
    const reversed = inMemoryHierarchyReader([...PEOPLE].reverse())
    const shuffledIds = inMemoryHierarchyReader(PEOPLE.map((person) => (person.id === "aaaa-op1" ? { ...person, id: "zzzz-op1" } : person)))
    for (const candidate of [reader, reversed, shuffledIds]) {
      await expect(resolveStructureRecipient(candidate, { kind: "TEAM", teamId: "G1" }, "SUPERVISOR")).resolves.toMatchObject({ status: "AMBIGUOUS" })
      await expect(resolveStructureRecipient(candidate, { kind: "TEAM", teamId: "G1" }, "MANAGER")).resolves.toMatchObject({ status: "RESOLVED", person: { id: "gustavo" } })
    }
    // Um Grupo onde só o operador de "menor UUID" reporta à Sonia e todos os outros à Selma continua
    // AMBÍGUO — antes desta rodada o resultado seria "Sonia" só porque op1 ordenava primeiro.
    const skewed = inMemoryHierarchyReader(PEOPLE.map((person) => (person.id === "op2" ? { ...person, reportsToId: "selma" } : person)))
    await expect(resolveStructureRecipient(skewed, { kind: "TEAM", teamId: "G1" }, "SUPERVISOR")).resolves.toMatchObject({ status: "AMBIGUOUS" })
  })

  it("estrutura ancorada em pessoa com cargo ABAIXO da âncora: único → resolve; vários → AMBIGUOUS (nunca 'nenhum' silencioso)", async () => {
    await expect(resolveStructureRecipient(reader, { kind: "MANAGER_STRUCTURE", managerId: "gilda" }, "SUPERVISOR")).resolves.toMatchObject({ status: "RESOLVED", person: { id: "sara" } })
    const many = await resolveStructureRecipient(reader, { kind: "DIRECTOR_STRUCTURE", directorId: "dora" }, "SUPERVISOR")
    expect(many.status).toBe("AMBIGUOUS")
    if (many.status === "AMBIGUOUS") expect(many.candidates.map((person) => person.id).sort()).toEqual(["sara", "selma", "sonia"])
  })

  it("requireStructureRecipient lança DomainError 422 com código de negócio e nodeId", async () => {
    await expect(requireStructureRecipient(reader, { kind: "TEAM", teamId: "G1" }, "SUPERVISOR", "out-1")).rejects.toMatchObject({
      code: "WORKFLOW_OUTPUT_RECIPIENT_AMBIGUOUS",
      statusCode: 422,
      details: { nodeId: "out-1" },
    })
    await expect(requireStructureRecipient(reader, { kind: "TEAM", teamId: "G3" }, "SUPERVISOR")).rejects.toBeInstanceOf(DomainError)
    await expect(requireStructureRecipient(reader, { kind: "TEAM", teamId: "G3" }, "SUPERVISOR")).rejects.toMatchObject({ code: "WORKFLOW_OUTPUT_RECIPIENT_NOT_FOUND" })
    await expect(requireStructureRecipient(reader, { kind: "TEAM", teamId: "G2" }, "SUPERVISOR")).resolves.toMatchObject({ id: "sara" })
  })
})
