import { describe, expect, it } from "vitest"
import { messageOriginOf } from "./assistant-conversations.js"

/** Origem da mensagem na monitoria: só a chave EXATA gravada pelo servidor (achado C11 da 4ª auditoria). */
describe("messageOriginOf", () => {
  it("recado de Workflow só com a chave exata 'workflow-output:<uuid>'; apresentação só com a chave dela", () => {
    expect(messageOriginOf("assistant", "workflow-output:11111111-2222-4333-8444-555555555555")).toBe("WORKFLOW")
    expect(messageOriginOf("assistant", "feedback-application:presentation")).toBe("FEEDBACK")
  })

  it("chave escolhida pelo navegador (sempre com sufixo) nunca vira recado nem apresentação", () => {
    for (const key of ["workflow-output:x:assistant", "workflow-output:11111111-2222-4333-8444-555555555555:assistant", "workflow-output:abc", "feedback-application:presentation:assistant", "voice-t1:specialist:c1", null]) {
      expect(messageOriginOf("assistant", key), String(key)).toBeNull()
    }
    expect(messageOriginOf("user", "workflow-output:11111111-2222-4333-8444-555555555555")).toBeNull()
  })
})
