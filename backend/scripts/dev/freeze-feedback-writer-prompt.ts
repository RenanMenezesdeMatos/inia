/**
 * FREEZE do prompt de produção do Feedback Writer (V1.5.1; por versão desde a V1.5.3). Sem rede, sem modelo: só calcula o
 * fingerprint (versão + sha256 do prompt, do schema de saída e da config) da versão ATUAL e grava o artefato que o teste de
 * freeze confere. Nunca sobrescreve o freeze de uma versão com conteúdo diferente — mudou o prompt? crie uma versão nova.
 *
 *   npx tsx scripts/dev/freeze-feedback-writer-prompt.ts
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { FEEDBACK_WRITER_PROMPT_VERSION, FEEDBACK_WRITER_SYSTEM_PROMPTS, feedbackWriterFingerprint, feedbackWriterFreezeFile } from "../../src/modules/interaction-feedback/domain/feedback-writer-prompt.js"

const target = join(import.meta.dirname, "..", "..", "src", "modules", "interaction-feedback", "domain", feedbackWriterFreezeFile(FEEDBACK_WRITER_PROMPT_VERSION))
const content = JSON.stringify({ ...feedbackWriterFingerprint(FEEDBACK_WRITER_PROMPT_VERSION), systemPrompt: FEEDBACK_WRITER_SYSTEM_PROMPTS[FEEDBACK_WRITER_PROMPT_VERSION] }, null, 2) + "\n"
if (existsSync(target) && readFileSync(target, "utf8") !== content) throw new Error(`O freeze de ${FEEDBACK_WRITER_PROMPT_VERSION} já existe com outro conteúdo — crie uma nova versão do prompt em vez de sobrescrever.`)
writeFileSync(target, content)
const frozen = JSON.parse(content) as { promptVersion: string; promptSha256: string; writerSha256: string }
console.log(JSON.stringify({ promptVersion: frozen.promptVersion, promptSha256: frozen.promptSha256, writerSha256: frozen.writerSha256 }))
