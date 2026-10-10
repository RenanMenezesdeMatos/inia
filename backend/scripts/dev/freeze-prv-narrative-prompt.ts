/**
 * FREEZE do prompt da INTERPRETAÇÃO/NARRATIVA DO FECHAMENTO DO PRV (Indicator Diagnosis V1). Sem rede, sem modelo: grava o
 * fingerprint (versão + sha256 do prompt, schema e config) + o texto do prompt, que o teste de freeze confere. Nunca sobrescreve
 * uma versão congelada com conteúdo diferente — mudou um byte do prompt: crie uma nova versão.
 *
 *   npx tsx scripts/dev/freeze-prv-narrative-prompt.ts
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { PRV_NARRATIVE_FREEZE_FILE, PRV_NARRATIVE_PROMPT_VERSION, PRV_NARRATIVE_SYSTEM_PROMPT, prvNarrativeFingerprint } from "../../src/modules/reliable-feedback/domain/prv-narrative-prompt.js"

const target = join(import.meta.dirname, "..", "..", "src", "modules", "reliable-feedback", "domain", PRV_NARRATIVE_FREEZE_FILE)
const content = JSON.stringify({ ...prvNarrativeFingerprint(), systemPrompt: PRV_NARRATIVE_SYSTEM_PROMPT }, null, 2) + "\n"
if (existsSync(target) && readFileSync(target, "utf8") !== content) throw new Error(`O freeze de ${PRV_NARRATIVE_PROMPT_VERSION} já existe com outro conteúdo — crie uma nova versão do prompt em vez de sobrescrever.`)
writeFileSync(target, content)
const frozen = JSON.parse(content) as { promptVersion: string; promptSha256: string; writerSha256: string }
console.log(JSON.stringify({ promptVersion: frozen.promptVersion, promptSha256: frozen.promptSha256, writerSha256: frozen.writerSha256 }))
