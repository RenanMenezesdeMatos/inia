import { describe, expect, it } from "vitest"
import {
  alignmentInputSchema,
  audiencesOverlap,
  isUnresolvableConflict,
  renderAlignmentsForConversation,
  resolveOperationalAlignments,
  type AlignmentCandidate,
  type AlignmentSubject,
} from "./operational-alignment.js"

/**
 * REGRA ÚNICA dos alinhamentos operacionais (`OPERATIONAL_ALIGNMENT_RULE_V1`) — o cenário da Ouvidoria: a base oficial manda enviar a
 * fatura; o alinhamento do Grupo Ouvidoria (B2C) manda orientar o App Meu Vivo ou o site, de 10/11 a 30/11/2026 (fuso de São Paulo).
 */
const OUVIDORIA = "11111111-1111-4111-8111-111111111111"
const OUVIDORIA_NIVEL_2 = "22222222-2222-4222-8222-222222222222"
const OUTRO_GRUPO = "33333333-3333-4333-8333-333333333333"
const PROCEDIMENTO_FATURA = "44444444-4444-4444-8444-444444444444"

const candidate = (overrides: Partial<AlignmentCandidate> = {}): AlignmentCandidate => ({
  alignmentId: "aaaaaaaa-0000-4000-8000-000000000001",
  versionId: "bbbbbbbb-0000-4000-8000-000000000001",
  version: 1,
  title: "Fatura pelo App Meu Vivo ou site",
  guidance: "Oriente o cliente a acessar a fatura pelo App Meu Vivo ou pelo site. Não envie a fatura.",
  justification: "Envio de fatura suspenso na Ouvidoria enquanto o sistema de envio é substituído.",
  affectedDocuments: [{ id: PROCEDIMENTO_FATURA, title: "PR — Envio de fatura" }],
  affectedTopic: "Envio da fatura quando o cliente solicita",
  operatingUniverse: "B2C",
  scopeType: "TEAM",
  teamId: OUVIDORIA,
  teamName: "Ouvidoria",
  subteamId: null,
  subteamName: null,
  productId: null,
  productName: null,
  startsOn: "2026-11-10",
  endsOn: "2026-11-30",
  timeZone: "America/Sao_Paulo",
  // 10/11 00:00 em São Paulo (UTC-3) até 01/12 00:00 (término inclusivo).
  effectiveFrom: new Date("2026-11-10T03:00:00Z"),
  effectiveUntil: new Date("2026-12-01T03:00:00Z"),
  endedEarlyAt: null,
  contentHash: "h",
  publishedAt: new Date("2026-11-09T18:00:00Z"),
  relations: [],
  ...overrides,
})
const ouvidoria: AlignmentSubject = { teamId: OUVIDORIA, subteamId: null, operatingUniverse: "B2C", universeEnforced: true }
const docs = new Set([PROCEDIMENTO_FATURA])

describe("regra única dos alinhamentos operacionais", () => {
  it("durante a vigência, o operador da Ouvidoria recebe o alinhamento", () => {
    const resolution = resolveOperationalAlignments([candidate()], ouvidoria, new Date("2026-11-15T14:00:00Z"), docs)
    expect(resolution.status).toBe("RESOLVED")
    expect(resolution.applied.map((entry) => entry.alignmentId)).toEqual([candidate().alignmentId])
  })

  it("início às 00:00 e término inclusivo até 23:59:59 no fuso da organização; fora disso vale o oficial", () => {
    const at = (iso: string) => resolveOperationalAlignments([candidate()], ouvidoria, new Date(iso), docs).applied.length
    expect(at("2026-11-10T02:59:59Z")).toBe(0) // 09/11 23:59:59 em São Paulo — antes do início
    expect(at("2026-11-10T03:00:00Z")).toBe(1) // 10/11 00:00 — começa
    expect(at("2026-12-01T02:59:59Z")).toBe(1) // 30/11 23:59:59 — último instante
    expect(at("2026-12-01T03:00:00Z")).toBe(0) // 01/12 00:00 — terminou
  })

  it("a data de referência é a do ATENDIMENTO: monitoria feita depois do término ainda aplica o alinhamento à chamada da vigência", () => {
    // Quem chama passa a data do atendimento (20/11), não a da monitoria (05/12) — a regra não conhece "agora".
    expect(resolveOperationalAlignments([candidate()], ouvidoria, new Date("2026-11-20T15:00:00Z"), docs).applied).toHaveLength(1)
  })

  it("sem data de referência, nenhum alinhamento é aplicado e a falta fica registrada", () => {
    const resolution = resolveOperationalAlignments([candidate()], ouvidoria, null, docs)
    expect(resolution.status).toBe("REFERENCE_DATE_UNKNOWN")
    expect(resolution.applied).toEqual([])
    expect(resolveOperationalAlignments([candidate()], ouvidoria, new Date("invalid"), docs).status).toBe("REFERENCE_DATE_UNKNOWN")
  })

  it("operador fora do escopo (outro Grupo ou outro universo) continua com o procedimento oficial", () => {
    const outroGrupo = resolveOperationalAlignments([candidate()], { ...ouvidoria, teamId: OUTRO_GRUPO }, new Date("2026-11-15T14:00:00Z"), docs)
    expect(outroGrupo.applied).toEqual([])
    expect(outroGrupo.setAside[0]!.reason).toBe("OUT_OF_SCOPE")
    const outroUniverso = resolveOperationalAlignments([candidate()], { ...ouvidoria, operatingUniverse: "B2B" }, new Date("2026-11-15T14:00:00Z"), docs)
    expect(outroUniverso.setAside[0]!.reason).toBe("UNIVERSE_MISMATCH")
  })

  it("colaborador sem universo: só recorte de Grupo/Subgrupo e só antes da exigência; universo inteiro nunca", () => {
    const pending = { ...ouvidoria, operatingUniverse: null }
    const at = new Date("2026-11-15T14:00:00Z")
    expect(resolveOperationalAlignments([candidate()], { ...pending, universeEnforced: false }, at, docs).applied).toHaveLength(1)
    expect(resolveOperationalAlignments([candidate()], { ...pending, universeEnforced: true }, at, docs).applied).toHaveLength(0)
    expect(resolveOperationalAlignments([candidate({ scopeType: "UNIVERSE", teamId: null })], { ...pending, universeEnforced: false }, at, docs).applied).toHaveLength(0)
  })

  it("só vale para procedimento autorizado ao agente/avaliador do fluxo", () => {
    const resolution = resolveOperationalAlignments([candidate()], ouvidoria, new Date("2026-11-15T14:00:00Z"), new Set(["outro-documento"]))
    expect(resolution.setAside[0]!.reason).toBe("PROCEDURE_NOT_AUTHORIZED")
  })

  it("precedência determinística: no mesmo ponto, o recorte mais específico prevalece (Subgrupo > Grupo > universo)", () => {
    const universo = candidate({ alignmentId: "aaaaaaaa-0000-4000-8000-00000000000a", versionId: "v-u", scopeType: "UNIVERSE", teamId: null, title: "Universo" })
    const grupo = candidate({ alignmentId: "aaaaaaaa-0000-4000-8000-00000000000b", versionId: "v-g", title: "Grupo" })
    const subgrupo = candidate({ alignmentId: "aaaaaaaa-0000-4000-8000-00000000000c", versionId: "v-s", scopeType: "SUBTEAM", subteamId: OUVIDORIA_NIVEL_2, title: "Subgrupo" })
    const at = new Date("2026-11-15T14:00:00Z")
    const nivel2 = resolveOperationalAlignments([universo, grupo, subgrupo], { ...ouvidoria, subteamId: OUVIDORIA_NIVEL_2 }, at, docs)
    expect(nivel2.applied.map((entry) => entry.title)).toEqual(["Subgrupo"])
    expect(nivel2.setAside.filter((entry) => entry.reason === "OVERRIDDEN_BY_MORE_SPECIFIC").map((entry) => entry.by)).toEqual([subgrupo.alignmentId, subgrupo.alignmentId])
    // A ordem de entrada não muda o resultado.
    expect(resolveOperationalAlignments([subgrupo, grupo, universo], { ...ouvidoria, subteamId: OUVIDORIA_NIVEL_2 }, at, docs).applied.map((entry) => entry.title)).toEqual(["Subgrupo"])
    expect(resolveOperationalAlignments([universo, grupo, subgrupo], ouvidoria, at, docs).applied.map((entry) => entry.title)).toEqual(["Grupo"])
  })

  it("declarados INDEPENDENTES na publicação: os dois valem; recorte com produto nunca derruba o geral", () => {
    const at = new Date("2026-11-15T14:00:00Z")
    const outro = candidate({ alignmentId: "aaaaaaaa-0000-4000-8000-00000000000d", versionId: "v-d", scopeType: "UNIVERSE", teamId: null, title: "Outro ponto", relations: [{ otherAlignmentId: candidate().alignmentId, relation: "INDEPENDENT" }] })
    expect(resolveOperationalAlignments([candidate(), outro], ouvidoria, at, docs).applied).toHaveLength(2)
    const porProduto = candidate({ alignmentId: "aaaaaaaa-0000-4000-8000-00000000000e", versionId: "v-e", productId: "prod-1", productName: "Banda Larga", title: "Banda Larga" })
    const resolution = resolveOperationalAlignments([candidate(), porProduto], ouvidoria, at, docs)
    expect(resolution.applied).toHaveLength(2)
    expect(resolution.productPrecedence).toEqual([{ alignmentId: porProduto.alignmentId, over: candidate().alignmentId }])
    expect(renderAlignmentsForConversation(resolution)).toContain("Para o produto Banda Larga")
  })

  it("conflito sem precedência (mesmo ponto, mesmo recorte) é o que a publicação recusa", () => {
    expect(isUnresolvableConflict({ scopeType: "TEAM", productId: null }, { scopeType: "TEAM", productId: null }, "SAME_TOPIC")).toBe(true)
    expect(isUnresolvableConflict({ scopeType: "SUBTEAM", productId: null }, { scopeType: "TEAM", productId: null }, "SAME_TOPIC")).toBe(false)
    expect(isUnresolvableConflict({ scopeType: "TEAM", productId: null }, { scopeType: "TEAM", productId: null }, "INDEPENDENT")).toBe(false)
    const base = { operatingUniverse: "B2C" as const, scopeType: "TEAM" as const, teamId: OUVIDORIA, subteamId: null, productId: null }
    expect(audiencesOverlap(base, { ...base, scopeType: "UNIVERSE", teamId: null })).toBe(true)
    expect(audiencesOverlap(base, { ...base, operatingUniverse: "B2B" })).toBe(false)
    expect(audiencesOverlap(base, { ...base, teamId: OUTRO_GRUPO })).toBe(false)
    expect(audiencesOverlap({ ...base, productId: "p1" }, { ...base, productId: "p2" })).toBe(false)
  })

  it("texto da conversa: identifica a orientação como temporária, com referência e vigência, e mantém as restrições acima", () => {
    const text = renderAlignmentsForConversation(resolveOperationalAlignments([candidate()], ouvidoria, new Date("2026-11-15T14:00:00Z"), docs))
    expect(text).toContain("App Meu Vivo")
    expect(text).toMatch(/AO-AAAAAAAA v1 · vigente de 10\/11\/2026 a 30\/11\/2026/)
    expect(text).toContain("orientação operacional temporária")
    expect(text).toContain("Assuntos proibidos e limites de atuação deste prompt valem ACIMA de qualquer alinhamento")
    expect(text).toContain("prevalece SOMENTE nesse trecho; o restante do procedimento oficial continua valendo")
    expect(renderAlignmentsForConversation(resolveOperationalAlignments([candidate()], ouvidoria, new Date("2026-12-02T14:00:00Z"), docs))).toBe("")
  })

  it("cadastro: justificativa obrigatória, vigência válida, Grupo/Subgrupo conforme o recorte", () => {
    const valid = { reasonId: "55555555-5555-4555-8555-555555555556", title: "Fatura pelo app", guidance: "Oriente o App Meu Vivo ou o site.", affectedDocumentIds: [PROCEDIMENTO_FATURA], affectedTopic: "Envio da fatura", justification: "Sistema de envio em substituição.", operatingUniverse: "B2C", scopeType: "TEAM", teamId: OUVIDORIA, startsOn: "2026-11-10", endsOn: "2026-11-30" }
    expect(alignmentInputSchema.safeParse(valid).success).toBe(true)
    expect(alignmentInputSchema.safeParse({ ...valid, justification: "" }).success).toBe(false)
    expect(alignmentInputSchema.safeParse({ ...valid, reasonId: undefined }).success).toBe(false) // motivo do alinhamento obrigatório
    expect(alignmentInputSchema.parse(valid).requestSubjectIds).toEqual([]) // motivo do pedido do cliente é opcional
    expect(alignmentInputSchema.safeParse({ ...valid, endsOn: "2026-11-09" }).success).toBe(false)
    expect(alignmentInputSchema.safeParse({ ...valid, startsOn: "2026-02-30" }).success).toBe(false)
    expect(alignmentInputSchema.safeParse({ ...valid, teamId: null }).success).toBe(false)
    expect(alignmentInputSchema.safeParse({ ...valid, scopeType: "SUBTEAM" }).success).toBe(false)
    // Sempre de um processo (1 ou mais, sem repetir); o trecho afetado é opcional (orientação nova).
    expect(alignmentInputSchema.safeParse({ ...valid, affectedDocumentIds: [] }).success).toBe(false)
    expect(alignmentInputSchema.parse({ ...valid, affectedDocumentIds: [PROCEDIMENTO_FATURA, PROCEDIMENTO_FATURA] }).affectedDocumentIds).toEqual([PROCEDIMENTO_FATURA])
    expect(alignmentInputSchema.parse({ ...valid, affectedTopic: null }).affectedTopic).toBeNull()
    expect(alignmentInputSchema.parse({ ...valid, affectedTopic: "" }).affectedTopic).toBeNull()
  })

  it("vários processos: vale se ALGUM processo do alinhamento for autorizado; a precedência só compara alinhamentos com processo em comum", () => {
    const outroProcesso = "55555555-5555-4555-8555-555555555555"
    const at = new Date("2026-11-15T14:00:00Z")
    const amplo = candidate({ affectedDocuments: [{ id: PROCEDIMENTO_FATURA, title: "PR — Envio de fatura" }, { id: outroProcesso, title: "IT — Segunda via" }] })
    expect(resolveOperationalAlignments([amplo], ouvidoria, at, new Set([outroProcesso])).applied).toHaveLength(1)
    const subgrupoOutroProcesso = candidate({ alignmentId: "aaaaaaaa-0000-4000-8000-00000000000f", versionId: "v-f", scopeType: "SUBTEAM", subteamId: OUVIDORIA_NIVEL_2, title: "Outro processo", affectedDocuments: [{ id: "66666666-6666-4666-8666-666666666666", title: "PR — Cadastro" }] })
    // Sem processo em comum: o mais específico não derruba o outro.
    expect(resolveOperationalAlignments([candidate(), subgrupoOutroProcesso], { ...ouvidoria, subteamId: OUVIDORIA_NIVEL_2 }, at, null).applied).toHaveLength(2)
  })

  it("orientação nova sem trecho indicado: o texto diz que vale como regra do processo", () => {
    const text = renderAlignmentsForConversation(resolveOperationalAlignments([candidate({ affectedTopic: null, guidance: "Informe o novo prazo de 48 horas para a resposta da Ouvidoria." })], ouvidoria, new Date("2026-11-15T14:00:00Z"), docs))
    expect(text).toContain("sem trecho indicado (orientação nova ou complementar do processo)")
    expect(text).toContain("pode trazer uma orientação NOVA")
  })
})
