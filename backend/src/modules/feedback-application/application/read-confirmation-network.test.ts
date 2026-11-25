import { describe, expect, it } from "vitest"
import type { Database } from "../../../infrastructure/database/pool.js"
import { confirmFeedbackReading, type NetworkPasswordVerifier, type ReadConfirmationScope } from "./read-confirmation-service.js"

/**
 * CIÊNCIA PELA REDE (achados SLR-05/DADOS-02/QA-09/QA-03/SLR-09 da run-9), com banco e AD falsos:
 *  - o AD é chamado FORA de transação e sem conexão do pool presa (transação curta → AD → transação curta);
 *  - a conta que mudou no meio (rede desligada, outra matrícula) não confirma;
 *  - senha errada e trava da matrícula gravam FAILED; a resposta pela rede não traz "restam N".
 */
const NOW = new Date("2026-11-22T12:00:00Z")
const scope: ReadConfirmationScope = { organizationId: "00000000-0000-4000-8000-000000000001", personId: "00000000-0000-4000-8000-000000000032", accountId: "11111111-1111-4111-8111-111111111111" }
const attempt = {
  source: { kind: "PUBLISHED_FEEDBACK" as const, id: "22222222-2222-4222-8222-222222222222" },
  entryPoint: "FOLLOW_UP_FEED" as const,
  attemptId: "33333333-3333-4333-8333-333333333333",
  device: null,
  elapsedMs: null,
}
const AGREE = { value: "AGREE" as const }
class ReachedAcknowledgement extends Error {}

function fakeDatabase(initial: { matricula: string | null; network: boolean; active?: boolean }) {
  const state = { account: { email: "larissa@inia.local", password_hash: "hash", active: initial.active ?? true, matricula: initial.matricula, network: initial.network } }
  const events: { event: string; failureReason: string | null }[] = []
  let openTransactions = 0
  let checkedOut = 0
  const answer = async (sql: string, params: unknown[] = []) => {
    if (sql.includes("feedback_application:")) throw new ReachedAcknowledgement()
    if (sql === "begin") openTransactions += 1
    if (sql === "commit" || sql === "rollback") openTransactions -= 1
    if (sql.includes("from feedbacks f")) return { rows: [{ acknowledged_at: null }], rowCount: 1 }
    if (sql.includes("from feedback_read_confirmation_events")) return { rows: [], rowCount: 0 }
    if (sql.includes("insert into feedback_read_confirmation_events")) {
      events.push({ event: String(params[8]), failureReason: (params[9] as string | null) ?? null })
      return { rows: [], rowCount: 1 }
    }
    if (sql.includes("from user_accounts ua join people p")) return { rows: [{ ...state.account }], rowCount: 1 }
    return { rows: [], rowCount: 0 }
  }
  const database = {
    query: answer,
    connect: async () => {
      checkedOut += 1
      return { query: answer, release: () => { checkedOut -= 1 } }
    },
  } as unknown as Database
  return { database, state, events, get openTransactions() { return openTransactions }, get checkedOut() { return checkedOut } }
}

const verifyPassword = async () => false

describe("ciência pela rede", () => {
  it("o AD é chamado fora de transação, sem conexão do pool presa; senha certa segue para gravar a ciência", async () => {
    const fake = fakeDatabase({ matricula: "g0055350", network: true })
    const seen: { openTransactions: number; checkedOut: number; normalized: string }[] = []
    const verifyNetworkPassword: NetworkPasswordVerifier = async ({ normalized }) => {
      seen.push({ openTransactions: fake.openTransactions, checkedOut: fake.checkedOut, normalized })
      return "OK"
    }
    await expect(confirmFeedbackReading(fake.database, scope, { ...attempt, login: "G0055350", password: "Rede#2026", agreement: AGREE }, NOW, { verifyPassword, verifyNetworkPassword })).rejects.toBeInstanceOf(ReachedAcknowledgement)
    expect(seen).toEqual([{ openTransactions: 0, checkedOut: 0, normalized: "G0055350" }])
  })

  it("matrícula de outra pessoa: nunca chega ao AD e grava FAILED (WRONG_LOGIN)", async () => {
    const fake = fakeDatabase({ matricula: "G0055350", network: true })
    let calls = 0
    const verifyNetworkPassword: NetworkPasswordVerifier = async () => { calls += 1; return "OK" }
    const error = await confirmFeedbackReading(fake.database, scope, { ...attempt, login: "G0099999", password: "x", agreement: AGREE }, NOW, { verifyPassword, verifyNetworkPassword }).catch((caught: unknown) => caught)
    expect(error).toMatchObject({ code: "READ_CONFIRMATION_INVALID_CREDENTIALS", statusCode: 422 })
    expect((error as { details?: unknown }).details).toBeUndefined()
    expect(calls).toBe(0)
    expect(fake.events).toEqual([{ event: "FAILED", failureReason: "WRONG_LOGIN" }])
  })

  it("cadastro fora do formato do login (DOMINIO\\X ou X@dominio): nunca confere a senha da conta X (CFA-07 da run-12)", async () => {
    for (const matricula of ["EMPRESA\\G0055350", "G0055350@empresa.local"]) {
      const fake = fakeDatabase({ matricula, network: true })
      let calls = 0
      const verifyNetworkPassword: NetworkPasswordVerifier = async () => { calls += 1; return "OK" }
      await expect(confirmFeedbackReading(fake.database, scope, { ...attempt, login: "G0055350", password: "x", agreement: AGREE }, NOW, { verifyPassword, verifyNetworkPassword })).rejects.toMatchObject({ code: "READ_CONFIRMATION_INVALID_CREDENTIALS" })
      expect(calls, matricula).toBe(0)
    }
  })

  it("senha de rede errada: FAILED (WRONG_PASSWORD), mensagem da rede e sem 'restam N tentativas'", async () => {
    const fake = fakeDatabase({ matricula: "G0055350", network: true })
    const error = await confirmFeedbackReading(fake.database, scope, { ...attempt, login: "G0055350", password: "errada", agreement: AGREE }, NOW, { verifyPassword, verifyNetworkPassword: async () => "INVALID" }).catch((caught: unknown) => caught)
    expect(error).toMatchObject({ code: "READ_CONFIRMATION_INVALID_CREDENTIALS", statusCode: 422 })
    expect((error as Error).message).toContain("senha de rede")
    expect((error as { details?: unknown }).details).toBeUndefined()
    expect(fake.events).toEqual([{ event: "FAILED", failureReason: "WRONG_PASSWORD" }])
  })

  it("trava da matrícula: 429 com a mensagem da rede e o evento FAILED (TOO_MANY_ATTEMPTS) gravado (SLR-09)", async () => {
    const fake = fakeDatabase({ matricula: "G0055350", network: true })
    const error = await confirmFeedbackReading(fake.database, scope, { ...attempt, login: "G0055350", password: "errada", agreement: AGREE }, NOW, { verifyPassword, verifyNetworkPassword: async () => "LOCKED" }).catch((caught: unknown) => caught)
    expect(error).toMatchObject({ code: "READ_CONFIRMATION_TOO_MANY_ATTEMPTS", statusCode: 429 })
    expect((error as Error).message).toContain("conta de rede")
    expect(fake.events).toEqual([{ event: "FAILED", failureReason: "TOO_MANY_ATTEMPTS" }])
  })

  it("situação da conta de rede e AD fora do ar: código próprio, sem evento de senha errada", async () => {
    for (const [check, code] of [["ACCOUNT_LOCKED", "NETWORK_ACCOUNT_LOCKED"], ["PASSWORD_EXPIRED", "NETWORK_PASSWORD_EXPIRED"], ["ACCOUNT_DISABLED", "NETWORK_ACCOUNT_DISABLED"], ["UNAVAILABLE", "NETWORK_LOGIN_UNAVAILABLE"]] as const) {
      const fake = fakeDatabase({ matricula: "G0055350", network: true })
      await expect(confirmFeedbackReading(fake.database, scope, { ...attempt, login: "G0055350", password: "x", agreement: AGREE }, NOW, { verifyPassword, verifyNetworkPassword: async () => check })).rejects.toMatchObject({ code })
      expect(fake.events).toEqual([])
    }
  })

  it("a conta mudou enquanto o AD respondia (rede desligada ou outra matrícula): não confirma (409)", async () => {
    for (const change of [{ network: false }, { matricula: "G0000001" }, { active: false }]) {
      const fake = fakeDatabase({ matricula: "G0055350", network: true })
      const verifyNetworkPassword: NetworkPasswordVerifier = async () => {
        Object.assign(fake.state.account, change)
        return "OK"
      }
      await expect(confirmFeedbackReading(fake.database, scope, { ...attempt, login: "G0055350", password: "Rede#2026", agreement: AGREE }, NOW, { verifyPassword, verifyNetworkPassword })).rejects.toMatchObject({ code: "READ_CONFIRMATION_ACCOUNT_CHANGED", statusCode: 409 })
    }
  })

  it("instalação sem AD: indisponível, nunca a senha local", async () => {
    const fake = fakeDatabase({ matricula: "G0055350", network: true })
    let localChecked = false
    await expect(confirmFeedbackReading(fake.database, scope, { ...attempt, login: "G0055350", password: "x", agreement: AGREE }, NOW, { verifyPassword: async () => { localChecked = true; return true } })).rejects.toMatchObject({ code: "NETWORK_LOGIN_UNAVAILABLE" })
    expect(localChecked).toBe(false)
  })
})
