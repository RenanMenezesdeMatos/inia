import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { normalizeRawSubject } from "../../../modules/interactions/domain/interaction-subject.js"
import { DIAGNOSTIC_CALLS_DATASET, DIAGNOSTIC_CALLS_DIRECTORY } from "./diagnostic-calls.js"
import { DEMO_SUBJECT_ALIASES, DEMO_SUBJECT_DEFINITIONS, demoSubjectCatalogInput } from "./subject-catalog.js"

/** Frases da massa que têm DUAS leituras ou nenhum canônico: nunca podem ganhar alias. */
const MUST_STAY_UNMAPPED = ["Linha sem sinal", "Cobrança após pedido de cancelamento e ameaça de reclamação", "Reclamação sobre cobrança após cancelamento", "Dúvida sobre franquia de dados", "Mudança do dia de vencimento da fatura", "Cliente ameaça cancelar por preço", "Negociação de débito", "Chip sem registro na rede", "Roaming internacional e cobrança", "Lentidão no Wi-Fi", "Aplicativo não abre", "Reclamação de visita técnica não realizada", "Fatura veio com valor maior e redução de plano"]

/** Frases com " e " cuja cabeça semântica é UMA só (o "e" liga qualificadores, não um segundo assunto). */
const SINGLE_HEADED_WITH_E = ["Alteração de e-mail e telefone", "Alteração de e-mail e telefone do gestor", "Alteração de e-mail e telefone (rechamada)", "Alteração simultânea de telefone e e-mail do gestor", "Contestação de linha desconhecida e suspeita de fraude", "Contestação de linha desconhecida e negativação", "Contestação de serviço digital e emissão de conta ajustada"]

describe("catálogo demo de assuntos canônicos", () => {
  const input = demoSubjectCatalogInput()

  it("17 códigos = os assuntos-fonte do lote; cada código é alias de si mesmo", async () => {
    const codes = DEMO_SUBJECT_DEFINITIONS.map((definition) => definition.code)
    expect(codes).toHaveLength(17)
    const raw = await readFile(join(DIAGNOSTIC_CALLS_DIRECTORY, DIAGNOSTIC_CALLS_DATASET.file), "utf8")
    const lotSubjects = new Set(raw.split("\n").filter((line) => line.trim()).map((line) => (JSON.parse(line) as { assunto: string }).assunto))
    expect([...lotSubjects].sort()).toEqual([...codes].sort())
    for (const code of codes) expect(input.aliases.some((alias) => alias.rawSubject === code && alias.code === code)).toBe(true)
  })

  it("nenhum bruto aponta para dois códigos; nenhuma frase composta ('X e Y') ou ambígua tem alias; ids determinísticos", () => {
    const seen = new Map<string, string>()
    for (const alias of input.aliases) {
      const key = normalizeRawSubject(alias.rawSubject)
      expect(seen.get(key) ?? alias.code, `bruto "${alias.rawSubject}" mapeado para dois códigos`).toBe(alias.code)
      seen.set(key, alias.code)
      // " e " só liga qualificadores da MESMA cabeça (lista explícita); "X e Y" com dois assuntos nunca ganha alias.
      if (/ e /.test(alias.rawSubject)) expect(SINGLE_HEADED_WITH_E, `frase composta com alias: ${alias.rawSubject}`).toContain(alias.rawSubject)
      expect(alias.id).toMatch(/^de00/)
      expect(DEMO_SUBJECT_DEFINITIONS.some((definition) => definition.code === alias.code)).toBe(true)
    }
    for (const phrase of MUST_STAY_UNMAPPED) expect(seen.has(normalizeRawSubject(phrase)), `"${phrase}" deveria ficar sem alias`).toBe(false)
    expect(new Set(input.aliases.map((alias) => alias.id)).size).toBe(input.aliases.length)
    expect(DEMO_SUBJECT_ALIASES.every((group) => group.rawSubjects.length > 0)).toBe(true)
  })

  it("variantes '(rechamada)' apontam para o mesmo código da frase-base; aliases legados só com cabeça inequívoca", () => {
    const byRaw = new Map(input.aliases.map((alias) => [normalizeRawSubject(alias.rawSubject), alias.code]))
    for (const [raw, code] of byRaw) if (raw.endsWith(" (rechamada)")) expect(byRaw.get(raw.replace(" (rechamada)", ""))).toBe(code)
    expect(byRaw.get("segunda via de fatura")).toBe("segunda_via")
    expect(byRaw.get("contestação de cobrança duplicada")).toBe("contestacao")
    expect(byRaw.get("alteração de gestor empresarial")).toBe("alteracao_cadastral")
    expect(byRaw.get("troca de chip por defeito")).toBe("troca_chip")
    expect(byRaw.get("upgrade de velocidade")).toBe("plano")
  })
})
