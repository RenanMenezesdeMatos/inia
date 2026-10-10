import { readdirSync, readFileSync } from "node:fs"
import { join, relative } from "node:path"
import { describe, expect, it } from "vitest"
import { avatarAlertDedupeKey } from "./deliver-conversational-output.js"
import { AVATAR_ALERT_KEY_PREFIX, recadoAlertCoveredByFollowUpSql, recadoCoveredByFollowUpSql } from "./recado-follow-up-invite.js"

/**
 * "Um convite só" tem UMA definição (recado-follow-up-invite.ts). Prova ESTRUTURAL de que o inbox, a criação do aviso e as
 * leituras do sino usam o MESMO fragmento — e de que ninguém reescreve a regra à mão (duas consultas divergentes deixariam o
 * sino apontando para um convite que o inbox não mostra). A prova contra o banco é conversational-delivery-proof.
 */
const SRC = join(__dirname, "..", "..", "..")

const READERS: Record<string, string> = {
  "modules/conversational-delivery/application/avatar-delivery-service.ts": "recadoCoveredByFollowUpSql",
  "modules/conversational-delivery/application/deliver-conversational-output.ts": "recadoCoveredByFollowUpSql",
  "modules/notifications/application/notifications-repository.ts": "recadoAlertCoveredByFollowUpSql",
  "modules/performance-analytics/application/analytics-read-repository.ts": "recadoAlertCoveredByFollowUpSql",
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return entry.name === "node_modules" ? [] : sourceFiles(path)
    return entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts") ? [path] : []
  })
}

describe("um convite só — definição única do recado coberto pelo Acompanhamento", () => {
  it("a chave do aviso e o fragmento do sino usam o mesmo prefixo", () => {
    expect(avatarAlertDedupeKey("0b1c2d3e-0000-4000-8000-000000000001")).toBe(`${AVATAR_ALERT_KEY_PREFIX}0b1c2d3e-0000-4000-8000-000000000001`)
    expect(recadoAlertCoveredByFollowUpSql("a")).toContain(`'^${AVATAR_ALERT_KEY_PREFIX}[0-9a-f-]{36}$'`)
    expect(recadoAlertCoveredByFollowUpSql("a")).toContain(`substr(a.dedupe_key, ${AVATAR_ALERT_KEY_PREFIX.length + 1})`)
    expect(recadoCoveredByFollowUpSql("o")).toContain("o.enrollment_id")
  })

  it("inbox, criação do aviso, sino e feed da estrutura leem pelo fragmento; ninguém reescreve a regra", () => {
    for (const [file, fragment] of Object.entries(READERS)) expect(readFileSync(join(SRC, file), "utf8"), file).toContain(`${fragment}(`)
    const copies = sourceFiles(SRC)
      .filter((path) => readFileSync(path, "utf8").includes("'reliableFeedback'->>'artifactId'"))
      .map((path) => relative(SRC, path))
    expect(copies).toEqual(["modules/conversational-delivery/application/recado-follow-up-invite.ts"])
  })
})
