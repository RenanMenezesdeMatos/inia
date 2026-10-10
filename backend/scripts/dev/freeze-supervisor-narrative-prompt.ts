/**
 * FREEZE do prompt da NARRATIVA DE SUPERVISOR (Feedback por Flag V2). Sem rede, sem modelo: grava o fingerprint (versão + sha256
 * do prompt, schema e config) + o texto do prompt, que o teste de freeze confere. Nunca sobrescreve uma versão congelada com
 * conteúdo diferente — mudou um byte do prompt: crie uma nova versão.
 *
 *   npx tsx scripts/dev/freeze-supervisor-narrative-prompt.ts
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { SUPERVISOR_NARRATIVE_PROMPT_VERSIONS, SUPERVISOR_NARRATIVE_SYSTEM_PROMPTS, supervisorNarrativeFingerprint, supervisorNarrativeFreezeFile } from "../../src/modules/reliable-feedback/domain/supervisor-narrative-prompt.js"

for (const version of SUPERVISOR_NARRATIVE_PROMPT_VERSIONS) {
  const target = join(import.meta.dirname, "..", "..", "src", "modules", "reliable-feedback", "domain", supervisorNarrativeFreezeFile(version))
  const content = JSON.stringify({ ...supervisorNarrativeFingerprint(version), systemPrompt: SUPERVISOR_NARRATIVE_SYSTEM_PROMPTS[version] }, null, 2) + "\n"
  if (existsSync(target) && readFileSync(target, "utf8") !== content) throw new Error(`O freeze de ${version} já existe com outro conteúdo — crie uma nova versão do prompt em vez de sobrescrever.`)
  writeFileSync(target, content)
  const frozen = JSON.parse(content) as { promptVersion: string; promptSha256: string; writerSha256: string }
  console.log(JSON.stringify({ promptVersion: frozen.promptVersion, promptSha256: frozen.promptSha256, writerSha256: frozen.writerSha256 }))
}
