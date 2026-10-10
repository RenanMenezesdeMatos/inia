import { describe, expect, it } from "vitest"
import { FEEDBACK_VIEW_VERSION, greetingOf, withRecipientGreeting, type FeedbackView } from "./feedback-view.js"

const view: FeedbackView = { version: FEEDBACK_VIEW_VERSION, card: "Card.", greeting: null, narrative: ["Na chamada, você confirmou o protocolo."], developments: [], maintain: null, attention: [], materials: [], context: null }

describe("FEEDBACK_GREETING_V1", () => {
  it("cumprimenta só pelo primeiro nome do tratamento", () => {
    expect(greetingOf("Larissa")).toBe("Olá, Larissa!")
    expect(greetingOf("Larissa Monteiro")).toBe("Olá, Larissa!")
    expect(greetingOf("Maria Clara")).toBe("Olá, Maria!")
  })

  it("sem nome, só o cumprimento", () => {
    expect(greetingOf(null)).toBe("Olá!")
    expect(greetingOf(undefined)).toBe("Olá!")
    expect(greetingOf("")).toBe("Olá!")
  })

  it("só a saudação muda — a mensagem verificada fica igual", () => {
    const delivered = withRecipientGreeting(view, "Larissa")
    expect(delivered.greeting).toBe("Olá, Larissa!")
    expect({ ...delivered, greeting: null }).toEqual(view)
    expect(view.greeting).toBeNull()
  })
})
