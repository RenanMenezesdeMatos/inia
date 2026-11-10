import { describe, expect, it } from "vitest"
import { assistantRatingInputSchema, CHAT_DISLIKE_REASON_LABELS, CHAT_DISLIKE_REASONS, ratingView, shouldWriteRating, type AssistantRatingDetails } from "./assistant-interaction-rating.js"

/** Motivo da descurtida no chat livre (migration 181, design de Apoio com Anjo seção 2): validação do corpo e regras de gravação. */
const wrong: AssistantRatingDetails = { reason: "WRONG_INFORMATION", comment: null, stillNeedsHelp: true }

describe("corpo da avaliação", () => {
  it("aceita as três avaliações sem motivo e a descurtida com motivo; tira os espaços e trata comentário vazio como ausente", () => {
    for (const value of ["UP", "DOWN", "NONE"] as const) expect(assistantRatingInputSchema.parse({ value })).toEqual({ value })
    expect(assistantRatingInputSchema.parse({ value: "DOWN", details: { reason: "INCOMPLETE", comment: "   faltou o prazo  ", stillNeedsHelp: false } })).toEqual({ value: "DOWN", details: { reason: "INCOMPLETE", comment: "faltou o prazo", stillNeedsHelp: false } })
    expect(assistantRatingInputSchema.parse({ value: "DOWN", details: { reason: "NOT_FOUND", comment: "   ", stillNeedsHelp: true } }).details).toEqual({ reason: "NOT_FOUND", comment: null, stillNeedsHelp: true })
  })

  it("recusa: motivo fora da lista, \"Outro\" sem comentário, comentário com menos de 3 ou mais de 1000 caracteres, sem a resposta de ajuda, campo a mais e motivo fora da descurtida", () => {
    const invalid = [
      { value: "DOWN", details: { reason: "RUDE", stillNeedsHelp: false } },
      { value: "DOWN", details: { reason: "OTHER", stillNeedsHelp: false } },
      { value: "DOWN", details: { reason: "OTHER", comment: "  ", stillNeedsHelp: false } },
      { value: "DOWN", details: { reason: "INCOMPLETE", comment: "ok", stillNeedsHelp: false } },
      { value: "DOWN", details: { reason: "INCOMPLETE", comment: "x".repeat(1001), stillNeedsHelp: false } },
      { value: "DOWN", details: { reason: "INCOMPLETE" } },
      { value: "DOWN", details: { reason: "INCOMPLETE", stillNeedsHelp: false, extra: 1 } },
      { value: "UP", details: { reason: "INCOMPLETE", stillNeedsHelp: false } },
      { value: "NONE", details: { reason: "INCOMPLETE", stillNeedsHelp: false } },
      { value: "DOWN", reason: "INCOMPLETE" },
    ]
    for (const body of invalid) expect(assistantRatingInputSchema.safeParse(body).success, JSON.stringify(body)).toBe(false)
    expect(assistantRatingInputSchema.safeParse({ value: "DOWN", details: { reason: "INCOMPLETE", comment: "x".repeat(1000), stillNeedsHelp: false } }).success).toBe(true)
  })

  it("cada motivo do catálogo tem rótulo; a tela mostra a avaliação em minúsculas e retirada como sem marcação", () => {
    expect(Object.keys(CHAT_DISLIKE_REASON_LABELS).sort()).toEqual([...CHAT_DISLIKE_REASONS].sort())
    expect([ratingView("UP"), ratingView("DOWN"), ratingView("NONE"), ratingView(null)]).toEqual(["up", "down", null, null])
  })
})

describe("quando gravar uma versão nova", () => {
  it("regra 1: descurtida sem motivo sobre a vigente com motivo não grava (chamada atrasada nunca apaga o motivo)", () => {
    expect(shouldWriteRating({ value: "DOWN", details: wrong }, { value: "DOWN" })).toBe(false)
    expect(shouldWriteRating({ value: "DOWN", details: wrong }, { value: "DOWN", details: null })).toBe(false)
  })

  it("regra 2: descurtida sem motivo nos outros casos grava como antes (o mesmo valor vigente não grava de novo)", () => {
    expect(shouldWriteRating(null, { value: "DOWN" })).toBe(true)
    expect(shouldWriteRating({ value: "UP", details: null }, { value: "DOWN" })).toBe(true)
    expect(shouldWriteRating({ value: "NONE", details: null }, { value: "DOWN" })).toBe(true)
    expect(shouldWriteRating({ value: "DOWN", details: null }, { value: "DOWN" })).toBe(false)
  })

  it("regra 3: descurtida com motivo diferente do vigente grava; igual não grava; sobre curtida ou sem motivo grava", () => {
    expect(shouldWriteRating({ value: "DOWN", details: wrong }, { value: "DOWN", details: { ...wrong } })).toBe(false)
    expect(shouldWriteRating({ value: "DOWN", details: wrong }, { value: "DOWN", details: { ...wrong, reason: "INCOMPLETE" } })).toBe(true)
    expect(shouldWriteRating({ value: "DOWN", details: wrong }, { value: "DOWN", details: { ...wrong, comment: "outro texto" } })).toBe(true)
    expect(shouldWriteRating({ value: "DOWN", details: wrong }, { value: "DOWN", details: { ...wrong, stillNeedsHelp: false } })).toBe(true)
    expect(shouldWriteRating({ value: "DOWN", details: null }, { value: "DOWN", details: wrong })).toBe(true)
    expect(shouldWriteRating({ value: "UP", details: null }, { value: "DOWN", details: wrong })).toBe(true)
  })

  it("curtir e retirar: o mesmo valor vigente não grava; retirar o que não existe também não", () => {
    expect(shouldWriteRating(null, { value: "UP" })).toBe(true)
    expect(shouldWriteRating({ value: "UP", details: null }, { value: "UP" })).toBe(false)
    expect(shouldWriteRating({ value: "DOWN", details: wrong }, { value: "UP" })).toBe(true)
    expect(shouldWriteRating({ value: "DOWN", details: wrong }, { value: "NONE" })).toBe(true)
    expect(shouldWriteRating(null, { value: "NONE" })).toBe(false)
    expect(shouldWriteRating({ value: "NONE", details: null }, { value: "NONE" })).toBe(false)
  })
})
