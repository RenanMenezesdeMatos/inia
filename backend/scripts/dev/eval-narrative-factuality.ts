/**
 * FEEDBACK EXPERIENCE V2.1 — AVALIAÇÃO AO VIVO da verificação semântica da narrativa (chama o modelo real; custo pequeno).
 * Roda os casos de `testing/narrative-factuality-cases.ts` (obrigatórios A–H + vocabulário novo) N vezes cada, pela MESMA função
 * do produto (`verifyNarrativeFactuality`), e grava veredito, uso e acerto por caso. Nada é gravado no banco.
 *   npx tsx scripts/dev/eval-narrative-factuality.ts <repetições> <arquivo-saída.json>
 */
import { writeFileSync } from "node:fs"
import { generateForRoute } from "../../src/shared/application/model-routing/llm-gateway.js"
import { verifyNarrativeFactuality } from "../../src/modules/reliable-feedback/infrastructure/gemini-reliable-feedback-writer.js"
import { narrativeBriefOf } from "../../src/modules/reliable-feedback/domain/supervisor-narrative.js"
import { isAcceptedFactuality } from "../../src/modules/reliable-feedback/domain/narrative-factuality.js"
import { FACTUALITY_CASES, oneSentenceDraft } from "../../src/modules/reliable-feedback/testing/narrative-factuality-cases.js"

const reps = Number(process.argv[2] ?? "1")
const out = process.argv[3]
if (!out) throw new Error("uso: eval-narrative-factuality.ts <repetições> <saída.json>")
const rows: unknown[] = []
for (const testCase of FACTUALITY_CASES) {
  for (let rep = 1; rep <= reps; rep += 1) {
    const draft = oneSentenceDraft(testCase.sentence)
    const result = await verifyNarrativeFactuality(generateForRoute, draft, narrativeBriefOf(testCase.items, "Atendimento de 29/09/2026 · Teste"), testCase.items)
    const verdict = result.verdicts[0] ?? null
    const got = result.status !== "VERIFIED" ? "ERROR" : verdict && isAcceptedFactuality(verdict.status) ? "ACCEPT" : "REJECT"
    const row = { id: testCase.id, group: testCase.group, rep, expected: testCase.expected, got, pass: got === testCase.expected, status: verdict?.status ?? null, unsupportedMeaning: verdict?.unsupportedMeaning ?? null, reason: verdict?.reason ?? result.error, supportedRewrite: verdict?.supportedRewrite ?? null, usage: (result.provenance as { usage?: unknown } | null)?.usage ?? null, durationMs: (result.provenance as { durationMs?: number } | null)?.durationMs ?? null }
    rows.push(row)
    console.log(`${testCase.id.padEnd(4)} #${rep} ${testCase.expected.padEnd(6)} → ${got.padEnd(6)} ${row.pass ? "OK" : "XX"} ${row.status ?? ""} ${row.unsupportedMeaning ?? ""}`)
    writeFileSync(out, JSON.stringify(rows, null, 1))
  }
}
process.exit(0)
