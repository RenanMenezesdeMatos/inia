import { describe, expect, it } from "vitest"
import golden from "../testing/contestacao-v173-golden-artifact.json" with { type: "json" }
import { assessCompleteness } from "../domain/composite-checkpoint.js"
import { communicateClauseOf, resolutionOutcomeStateOf } from "../domain/subitem-semantics.js"
import { compositeFactsOf } from "../../indicator-diagnosis/domain/observation-readiness.js"
import type { ReliableFeedbackArtifactV1 } from "../domain/reliable-feedback-artifact.js"
import { replayV173 } from "../testing/replay-v173.js"

/**
 * SUBITEM_APPLICABILITY_V1 — antes de dizer que um item da lista FALTOU, ele precisava existir naquele momento. Conta ajustada e
 * valor a pagar dependem de um RESULTADO (ajuste feito / valor final definido); com a análise ainda pendente não se aplicam, e
 * sem evidência nenhuma do resultado ficam desconhecidos (nunca lacuna). A condição vem do TIPO do item — nada por rótulo avulso.
 */
const RECAP = "Antes de encerrar, informar:\n\n- Conta analisada;\n- Lançamento contestado;\n- Valor;\n- Ação realizada;\n- Serviço cancelado, quando aplicável;\n- Conta ajustada;\n- Valor a pagar;\n- Prazo;\n- Canal de retorno;\n- Protocolo."
const statusOf = (completeness: ReturnType<typeof assessCompleteness>) => Object.fromEntries(completeness!.items.map((item) => [item.text, item.status]))
const assess = (recap: string, conversation: readonly string[]) => assessCompleteness({ quote: RECAP, evidence: [{ turnRef: "T9", text: recap }], operatorConversation: [...conversation, recap], windowComplete: true })

describe("SUBITEM_APPLICABILITY_V1 — §28 A–G", () => {
  it("A) contestação ainda pendente → conta ajustada e valor a pagar NÃO APLICÁVEIS (com a fala que mostra a pendência)", () => {
    const completeness = assess("Recapitulando: registrei a contestação dos R$ 16,90, a análise leva até 7 dias úteis e a resposta vem por SMS. O protocolo é 2026 0928 7711.", ["Agora vou registrar a contestação pra equipe de faturamento analisar."])
    expect(statusOf(completeness)).toMatchObject({ "conta ajustada": "NOT_APPLICABLE", "valor a pagar": "NOT_APPLICABLE" })
    expect(completeness!.items.find((item) => item.text === "conta ajustada")!.applicability).toEqual({ status: "NOT_APPLICABLE", reason: "RESOLUTION_OUTCOME_PENDING", evidence: "Agora vou registrar a contestação pra equipe de faturamento analisar." })
  })

  it("B) ajuste concluído → os itens se aplicam e são avaliados: o que foi dito conta, o que não foi é ausência verificada", () => {
    const completeness = assess("Recapitulando: já ajustei a conta, a conta ajustada fica disponível no app em até 2 dias úteis, a resposta vem por SMS e o protocolo é 2026 0928 7711.", ["Identifiquei o erro e já corrigi a cobrança."])
    expect(statusOf(completeness)).toMatchObject({ "conta ajustada": "OBSERVED", "valor a pagar": "VERIFIED_ABSENT" })
    expect(completeness!.items.find((item) => item.text === "valor a pagar")!.applicability).toMatchObject({ status: "APPLICABLE", reason: "RESOLUTION_OUTCOME_CONCLUDED" })
    expect(resolutionOutcomeStateOf(["A conta ajustada será emitida e fica disponível no app."]).state).toBe("CONCLUDED")
  })

  it("C) aplicabilidade desconhecida (a conversa não mostra o resultado) → DESCONHECIDO, nunca ausente", () => {
    const completeness = assess("Recapitulando: o prazo é de 5 dias úteis, o retorno vem por SMS e o protocolo é 2026 0928 7711.", ["Certo, vou verificar aqui."])
    expect(statusOf(completeness)).toMatchObject({ "conta ajustada": "UNKNOWN", "valor a pagar": "UNKNOWN" })
    expect(completeness!.items.find((item) => item.text === "conta ajustada")!.applicability).toEqual({ status: "UNKNOWN", reason: "RESOLUTION_OUTCOME_NOT_EVIDENCED", evidence: null })
    expect(compositeFactsOf(completeness!.items).notInformed).not.toEqual(expect.arrayContaining(["conta ajustada"]))
    expect(compositeFactsOf(completeness!.items).notInformed).not.toEqual(expect.arrayContaining(["valor a pagar"]))
  })

  it("D) item não aplicável não vira NOT_FOLLOWED: tudo o que se aplicava foi dito → COMPLETE", () => {
    const completeness = assess("Recapitulando: a conta analisada é a de setembro, o lançamento contestado é o Música Plus de R$ 16,90, a ação realizada foi a contestação, cancelei a renovação do Música Plus, a análise leva até 7 dias úteis, o retorno vem por SMS e o protocolo é 2026 0928 7711.", ["Vou registrar a contestação pra equipe de faturamento analisar."])
    expect(completeness!.status).toBe("COMPLETE")
    expect(completeness!.counts).toMatchObject({ NOT_APPLICABLE: 2, VERIFIED_ABSENT: 0 })
  })

  it("E) item DESCONHECIDO não vira lacuna: sem ausência verificada a completude fica desconhecida (nunca parcial)", () => {
    const completeness = assess("Recapitulando: a conta analisada é a de setembro, o lançamento contestado é o Música Plus de R$ 16,90, a ação realizada foi a contestação, cancelei a renovação do Música Plus, o prazo é de 5 dias úteis, o retorno vem por SMS e o protocolo é 2026 0928 7711.", ["Certo."])
    expect(completeness!.status).toBe("UNKNOWN")
    expect(compositeFactsOf(completeness!.items).notInformed).toEqual([])
  })

  it("F/G) Larissa (replay dos insumos REAIS): a recapitulação continua PARCIAL só pelo protocolo; conta ajustada e valor a pagar não se aplicavam; o protocolo continua lacuna própria", async () => {
    const { artifact, store } = await replayV173()
    const recap = artifact.items.find((item) => item.process?.behavior?.code === "RECAPITULATE_INTERACTION")!
    expect(recap.process!.completeness).toMatchObject({ status: "PARTIAL", absent: ["protocolo"], notApplicable: ["conta ajustada", "valor a pagar"], observed: ["conta analisada", "lançamento contestado", "valor", "ação realizada", "serviço cancelado, quando aplicável", "prazo", "canal de retorno"] })
    expect(recap.proposedWording!.whatYouCanDo).toBe("Na próxima chamada, antes de encerrar, informe também o número do protocolo.")
    expect(recap.proposedWording!.whatYouCanDo).not.toMatch(/“|conta ajustada|valor a pagar/)
    const protocol = artifact.items.find((item) => item.process?.behavior?.code === "PROVIDE_PROTOCOL")!
    expect(protocol).toMatchObject({ section: "OPPORTUNITY", process: { status: "NOT_FOLLOWED", evidenceType: "VERIFIED_OMISSION" }, decision: { disposition: "READY" } })
    const observation = store.observations.find((entry) => entry.canonicalBehavior === "RECAPITULATE_INTERACTION")!
    expect(compositeFactsOf(observation.subItems)).toMatchObject({ notInformed: ["protocolo"], notApplicable: ["conta ajustada", "valor a pagar"] })
    // A justificativa fica registrada: na observação (motivo) e no diagnóstico da etapa (a fala que mostra a análise pendente).
    expect(observation.subItems!.find((item) => item.text === "conta ajustada")).toMatchObject({ status: "NOT_APPLICABLE", applicability: { status: "NOT_APPLICABLE", reason: "RESOLUTION_OUTCOME_PENDING" } })
  })

  it("a orientação diz o que COMUNICAR (frase de comportamento), nunca o rótulo do checklist", () => {
    expect(["Conta ajustada", "Valor a pagar", "Protocolo", "Canal de retorno", "Prazo"].map(communicateClauseOf)).toEqual(["como ficou a conta após o ajuste", "o valor que o cliente deverá pagar", "o número do protocolo", "por onde o cliente receberá o retorno", "o prazo"])
  })
})

describe("SUBITEM_APPLICABILITY_V1 — não regressão (replay × artefato gravado do SMOKE-V173)", () => {
  const canon = (value: unknown): unknown => (Array.isArray(value) ? value.map(canon) : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canon((value as Record<string, unknown>)[key])])) : value)
  it("fora da recapitulação NADA muda: itens, evidência, status, checkpointRef, prontidão, disposição e o resto do artefato idênticos ao gravado", async () => {
    const { artifact } = await replayV173()
    const stored = golden as unknown as ReliableFeedbackArtifactV1
    expect(artifact.items).toHaveLength(stored.items.length)
    artifact.items.forEach((item, index) => {
      const before = stored.items[index]!
      if (item.process?.behavior?.code === "RECAPITULATE_INTERACTION") {
        // A recapitulação muda só na completude (subitens não aplicáveis) e no texto do sistema que a descreve.
        const strip = (entry: typeof item) => canon({ ...entry, process: { ...entry.process, completeness: null }, proposedWording: null })
        expect(strip(item)).toEqual(strip(before))
        expect(item.process!.status).toBe("NOT_FOLLOWED")
        expect(item.process!.completeness!.status).toBe(before.process!.completeness!.status)
        return
      }
      expect(canon(item)).toEqual(canon(before))
    })
    const rest = (entry: ReliableFeedbackArtifactV1) => canon({ ...entry, items: null, presentation: null, processAssessment: null })
    expect(rest(artifact)).toEqual(rest(stored))
  })
})
