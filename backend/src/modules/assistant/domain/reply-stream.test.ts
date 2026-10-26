import { describe, expect, it } from "vitest"
import { createMarkerSafeText, reconcileShownText } from "./reply-stream.js"

const MARKERS = ["SUPPORT_MATERIALS_JSON:", "STRUCTURED_RESULT_JSON:", "EVIDENCE_JSON:"]

function run(chunks: string[]) {
  const out: string[] = []
  const sink = createMarkerSafeText(MARKERS, (text) => out.push(text))
  for (const chunk of chunks) sink.push(chunk)
  return { out, emitted: sink.emitted() }
}

describe("texto em fluxo sem marcador interno", () => {
  it("texto comum sai na hora, pedaço a pedaço", () => {
    expect(run(["Olá, ", "tudo bem?"]).out).toEqual(["Olá, ", "tudo bem?"])
  })

  it("linha que começa com marcador (mesmo partido em pedaços) nunca sai, nem o que vem depois", () => {
    const { emitted } = run(["Resposta.\n", "SUPP", "ORT_MATERIALS_JSON: [", '{"materialId":"M1"}]\n', "mais texto"])
    expect(emitted).toBe("Resposta.\n")
  })

  it("linha incompleta que PODE virar marcador espera; quando diverge, sai inteira", () => {
    const first = run(["Ok.\nS"])
    expect(first.emitted).toBe("Ok.\n")
    const second = run(["Ok.\nS", "eu resultado melhorou."])
    expect(second.emitted).toBe("Ok.\nSeu resultado melhorou.")
  })

  it("marcador com espaços antes também é retido", () => {
    expect(run(["Texto\n  EVIDENCE_JSON: {}"]).emitted).toBe("Texto\n")
  })

  it("o mesmo nome no meio de uma frase não é marcador (só no começo da linha)", () => {
    expect(run(["veja o EVIDENCE_JSON: no fim"]).emitted).toBe("veja o EVIDENCE_JSON: no fim")
  })
})

describe("conferência do mostrado com o texto final", () => {
  it("normal: só o que falta", () => {
    expect(reconcileShownText("Olá", "Olá, tudo bem?")).toEqual({ retract: false, append: ", tudo bem?" })
    expect(reconcileShownText("", "Tudo")).toEqual({ retract: false, append: "Tudo" })
  })

  it("quebra de linha antes de um marcador retido (o texto final é aparado): nada a acrescentar", () => {
    expect(reconcileShownText("Resposta.\n", "Resposta.")).toEqual({ retract: false, append: "" })
  })

  it("texto final diferente do mostrado: retira e manda inteiro (nunca duplica)", () => {
    expect(reconcileShownText("Resposta antiga", "Outra resposta")).toEqual({ retract: true, append: "Outra resposta" })
  })
})
