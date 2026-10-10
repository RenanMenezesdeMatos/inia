import { describe, expect, it, vi } from "vitest"
import type { Database } from "../../../infrastructure/database/pool.js"
import { projectForSurfaces } from "../../conversational-delivery/domain/surface-projection.js"
import { SimulationEffectSink } from "./simulation-effect-sink.js"

/** Workflow Outputs V1 no QA Lab: Chat/Avatar simulados — nada é gravado, o efeito mostra o que o destinatário receberia. */
describe("QA Lab — Output em Chat/Avatar simulado", () => {
  it("registra a primeira mensagem e a fala (sem tocar o banco), idempotente por nó × superfície × destinatário", async () => {
    const db = { query: vi.fn(), connect: vi.fn() } as unknown as Database
    const sink = new SimulationEffectSink()
    sink.beginNode("out")
    const projection = projectForSurfaces({ kind: "TEXT", title: null, text: "Você atendeu 42 chamadas." }, { addressName: "Ana", outputLabel: "Resumo da semana" })
    const input = { organizationId: "org", enrollmentId: "enr", nodeId: "out", recipientId: "person-1", interactionMode: "PROMPT" as const, artifactId: null, projection, sourceKind: "TEXT", now: new Date() }
    const chat = await sink.conversational.deliverChat(db, input)
    const avatar = await sink.conversational.offerAvatar(db, input)
    const again = await sink.conversational.deliverChat(db, input)
    expect(again).toEqual({ ...chat, reused: true })
    expect(avatar.reused).toBe(false)
    expect(db.query).not.toHaveBeenCalled()
    expect(db.connect).not.toHaveBeenCalled()
    expect(sink.effects).toEqual([
      expect.objectContaining({ kind: "WORKFLOW_OUTPUT", surface: "CHAT", recipientId: "person-1", content: expect.objectContaining({ title: "Resumo da semana", firstMessage: expect.stringContaining("Você atendeu 42 chamadas.") }) }),
      expect.objectContaining({ kind: "WORKFLOW_OUTPUT", surface: "AVATAR", recipientId: "person-1", content: expect.objectContaining({ speechText: expect.stringContaining("Oi, Ana."), note: expect.stringContaining("aceitar") }) }),
    ])
  })
})
