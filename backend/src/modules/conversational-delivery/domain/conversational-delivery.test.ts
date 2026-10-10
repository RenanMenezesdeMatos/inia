import { describe, expect, it } from "vitest"
import { transitionAvatarDelivery, type AvatarDeliveryStatus } from "./avatar-delivery-lifecycle.js"
import { MAX_SPEECH_WORDS, projectForSurfaces, toSpeakable, wordCount, type FeedbackViewLike } from "./surface-projection.js"

const digitsOf = (text: string) => new Set(text.match(/\d+/g) ?? [])

describe("ciclo de vida da entrega de voz — aceitar não é entregar", () => {
  it("caminho feliz: PENDING → OFFERED → ACCEPTED → PLAYING → DELIVERED", () => {
    let status: AvatarDeliveryStatus = "PENDING"
    for (const [event, expected] of [["OFFER", "OFFERED"], ["ACCEPT", "ACCEPTED"], ["PLAYBACK_STARTED", "PLAYING"], ["PLAYBACK_COMPLETED", "DELIVERED"]] as const) {
      const transition = transitionAvatarDelivery(status, event)
      expect(transition).toMatchObject({ ok: true, next: expected })
      if (transition.ok) status = transition.next
    }
  })
  it("DELIVERED nunca nasce de um aceite nem de um convite: exige a fala ter começado", () => {
    for (const status of ["PENDING", "OFFERED", "ACCEPTED", "SNOOZED", "FAILED", "INTERRUPTED"] as const) {
      expect(transitionAvatarDelivery(status, "PLAYBACK_COMPLETED")).toEqual({ ok: false, reason: "NOT_PLAYING" })
    }
    expect(transitionAvatarDelivery("OFFERED", "PLAYBACK_STARTED")).toEqual({ ok: false, reason: "NOT_ACCEPTED" })
  })
  it("falha e interrupção nunca viram entrega e permitem ouvir de novo; 'Depois' mantém o recado disponível", () => {
    expect(transitionAvatarDelivery("PLAYING", "PLAYBACK_FAILED")).toMatchObject({ ok: true, next: "FAILED" })
    expect(transitionAvatarDelivery("PLAYING", "PLAYBACK_INTERRUPTED")).toMatchObject({ ok: true, next: "INTERRUPTED" })
    expect(transitionAvatarDelivery("FAILED", "ACCEPT")).toMatchObject({ ok: true, next: "ACCEPTED" })
    expect(transitionAvatarDelivery("INTERRUPTED", "ACCEPT")).toMatchObject({ ok: true, next: "ACCEPTED" })
    expect(transitionAvatarDelivery("OFFERED", "SNOOZE")).toMatchObject({ ok: true, next: "SNOOZED" })
    expect(transitionAvatarDelivery("SNOOZED", "ACCEPT")).toMatchObject({ ok: true, next: "ACCEPTED" })
    // Mostrar o convite de novo não rebaixa um estado mais avançado.
    expect(transitionAvatarDelivery("SNOOZED", "OFFER")).toEqual({ ok: true, next: "SNOOZED", changed: false })
  })
  it("entregue é final: aceitar/adiar de novo é recusado; repetir a conclusão é idempotente", () => {
    expect(transitionAvatarDelivery("DELIVERED", "ACCEPT")).toEqual({ ok: false, reason: "ALREADY_DELIVERED" })
    expect(transitionAvatarDelivery("DELIVERED", "SNOOZE")).toEqual({ ok: false, reason: "ALREADY_DELIVERED" })
    expect(transitionAvatarDelivery("DELIVERED", "PLAYBACK_COMPLETED")).toEqual({ ok: true, next: "DELIVERED", changed: false })
  })
})

describe("fala pronunciável", () => {
  it("nunca lê marcação, links, ids, caixas de seleção nem constantes técnicas", () => {
    const speech = toSpeakable("## O que ajustar\n\n- [ ] **Prazo da análise** — veja [Abrir processo ↗](/materiais/1d000000-0000-4000-8000-000000000001)\n- Status HOLD_FOR_QA em https://inia.local/x\n\n| Indicador | Valor |\n|---|---|\n| TMA | 514 s |")
    expect(speech).not.toMatch(/[#*|[\]]|https?:|materiais|HOLD_FOR_QA|1d000000|☐|↗/)
    expect(speech).toContain("Prazo da análise")
    expect(speech).toContain("514 segundos")
    expect(speech).toContain("TMA")
  })
  it("datas viram fala", () => {
    expect(toSpeakable("Atendimento de 25/09/2026")).toBe("Atendimento de 25 de setembro de 2026.")
  })
})

const PRV_VIEW: FeedbackViewLike = {
  heading: { title: "Tempo Médio de Atendimento", subtitle: "Fechamento de agosto de 2026" },
  card: "O Tempo Médio de Atendimento foi de 514 s no ciclo. O foco principal é a comunicação do prazo de análise nas contestações de cobrança.",
  greeting: "Olá, Thalita!",
  narrative: ["No fechamento de agosto de 2026, seu Tempo Médio de Atendimento oficial foi de 514 s, fora da meta de 400 s (quartil oficial Q4).", "Nas próximas chamadas de contestação de cobrança, informe prazo e canal de retorno."],
  kind: "INDICATOR",
  cycle: { title: "Resultado do ciclo · agosto de 2026" },
}

describe("projeção por superfície — mesma verdade, forma adaptada", () => {
  it("fechamento: título do artefato (nunca 'TMA' fixo), chat com a narrativa validada, fala curta a partir do card", () => {
    const projection = projectForSurfaces({ kind: "FEEDBACK_VIEW", domain: "INDICATOR", label: "Tempo Médio de Atendimento · Fechamento de agosto de 2026", view: PRV_VIEW, fullText: "texto completo" }, { addressName: "Thalita" })
    expect(projection.title).toBe("Feedback do seu fechamento de agosto de 2026")
    expect(projection.chatText.startsWith("Olá, Thalita! Tenho um retorno novo para você sobre o seu fechamento de agosto de 2026 em Tempo Médio de Atendimento.")).toBe(true)
    for (const paragraph of PRV_VIEW.narrative) expect(projection.chatText).toContain(paragraph)
    expect(projection.speechText).toMatch(/^Oi, Thalita\. Tenho um retorno sobre o seu fechamento de agosto de 2026 em Tempo Médio de Atendimento\. O Tempo Médio de Atendimento foi de 514 segundos no ciclo\./)
    expect(wordCount(projection.speechText)).toBeLessThanOrEqual(MAX_SPEECH_WORDS)
    expect(projection.contextText).toBe("texto completo")
  })
  it("guardrail: nenhum número novo — todo número do chat/fala já está no artefato", () => {
    const projection = projectForSurfaces({ kind: "FEEDBACK_VIEW", domain: "INDICATOR", label: "x", view: PRV_VIEW, fullText: "" }, { addressName: "Thalita" })
    const source = digitsOf([PRV_VIEW.card, ...PRV_VIEW.narrative, PRV_VIEW.heading!.subtitle].join(" "))
    for (const digit of [...digitsOf(projection.chatText), ...digitsOf(projection.speechText)]) expect(source.has(digit)).toBe(true)
  })
  it("monitoria: 'Retorno da monitoria · assunto' e a data do atendimento falada", () => {
    const projection = projectForSurfaces(
      { kind: "FEEDBACK_VIEW", domain: "MONITORING", label: "Contestação de conta", view: { heading: { title: "Contestação de conta", subtitle: "Atendimento de 25/09/2026" }, card: "Você validou o titular. O principal ajuste é informar o prazo.", greeting: null, narrative: ["Larissa, você validou o titular."] }, fullText: "x" },
      { addressName: "Larissa" },
    )
    expect(projection.title).toBe("Retorno da monitoria · Contestação de conta")
    expect(projection.speechText).toContain("o seu atendimento de 25 de setembro de 2026 (Contestação de conta)")
    expect(projection.chatText.startsWith("Tenho um retorno novo para você")).toBe(true)
  })
  it("monitoria SEM assunto confiável (título neutro, `FEEDBACK_HEADING_V1`): o recado fala só da data — nunca 'Retorno da monitoria · Feedback de atendimento' nem a data como assunto", () => {
    const neutral = projectForSurfaces({ kind: "FEEDBACK_VIEW", domain: "MONITORING", label: "Atendimento de 29/09/2026", view: { heading: { title: "Feedback de atendimento", subtitle: "Atendimento de 29/09/2026", subjectSource: "NONE" }, card: "Você validou o titular.", greeting: null, narrative: ["Você validou o titular."] }, fullText: "x" }, { addressName: "Larissa" })
    expect(neutral.title).toBe("Retorno da monitoria")
    const legacy = projectForSurfaces({ kind: "FEEDBACK_VIEW", domain: "MONITORING", label: "Atendimento de 29/09/2026", view: { heading: { title: "Atendimento de 29/09/2026", subtitle: null }, card: "Você validou o titular.", greeting: null, narrative: ["Você validou o titular."] }, fullText: "x" }, { addressName: "Larissa" })
    expect(legacy.title).toBe("Retorno da monitoria")
  })
  it("texto longo: a fala cobre só frases inteiras do começo e avisa que o resto está escrito; o texto completo fica na tela", () => {
    const text = Array.from({ length: 40 }, (_, index) => `Frase número ${index + 1} com alguns detalhes adicionais.`).join(" ")
    const projection = projectForSurfaces({ kind: "TEXT", title: null, text }, { addressName: null, outputLabel: "Resumo mensal" })
    expect(projection.title).toBe("Resumo mensal")
    expect(projection.speechTruncated).toBe(true)
    expect(projection.speechText).toMatch(/O recado completo está escrito aqui no painel da INIA\.$/)
    expect(wordCount(projection.speechText)).toBeLessThanOrEqual(MAX_SPEECH_WORDS)
    expect(projection.displayText).toBe(text)
  })
  it("feedback sem card (legado): título com o assunto, fala só com o núcleo validado dos pontos — nunca rótulos nem trecho de transcrição", () => {
    const fullText = "**Atendimento de 14/09/2026 · Fatura**\n\n**Ponto de desenvolvimento**\n\nVocê disse \"Vou passar o número do protocolo, anota aí:\" e houve fala sobreposta do cliente.\n\n**Por que importa:** Verificar se o cliente está pronto evita perda da informação.\n\nTrecho da conversa: Operador: “Anota aí” · Cliente: “[fala sobreposta, inaudível]”"
    const projection = projectForSurfaces({ kind: "FEEDBACK_TEXT", domain: "MONITORING", label: "Atendimento de 14/09/2026 · Fatura", card: null, points: ["Você disse \"Vou passar o número do protocolo, anota aí:\" e houve fala sobreposta do cliente."], fullText }, { addressName: "Marcela" })
    expect(projection.title).toBe("Retorno da monitoria · Fatura")
    expect(projection.speechText).toBe("Oi, Marcela. Tenho um retorno sobre o seu atendimento de 14 de setembro de 2026 (Fatura). Você disse \"Vou passar o número do protocolo, anota aí:\" e houve fala sobreposta do cliente. Se quiser, posso te explicar os detalhes aqui no chat.")
    expect(projection.speechText).not.toMatch(/Ponto de desenvolvimento|Por que importa|Trecho da conversa|\[/)
    expect(projection.chatText).toContain(fullText)
    expect(projection.displayText).toBe(fullText)
  })
})
