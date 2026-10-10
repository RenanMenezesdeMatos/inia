/**
 * FREEZE dos prompts dos redatores do FEEDBACK CONFIÁVEL (V1.5.12) — monitoria do Workflow e indicador. Mesma regra do
 * freeze do Writer V2: sem rede, sem modelo; calcula o fingerprint (versão + sha256 do prompt, schema de saída e config) e
 * grava o artefato que o teste de freeze confere. Nunca sobrescreve uma versão já congelada com conteúdo diferente.
 *
 *   npx tsx scripts/dev/freeze-reliable-feedback-writer-prompts.ts
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { RELIABLE_WRITER_PROMPT_VERSIONS, RELIABLE_WRITER_SYSTEM_PROMPTS, reliableWriterFingerprint, reliableWriterFreezeFile } from "../../src/modules/reliable-feedback/domain/reliable-writer-prompts.js"

// Todas as versões (V1 preservadas byte a byte — o script falha se uma delas mudar; V2 da V1.6.0).
for (const version of RELIABLE_WRITER_PROMPT_VERSIONS) {
  const target = join(import.meta.dirname, "..", "..", "src", "modules", "reliable-feedback", "domain", reliableWriterFreezeFile(version))
  const content = JSON.stringify({ ...reliableWriterFingerprint(version), systemPrompt: RELIABLE_WRITER_SYSTEM_PROMPTS[version] }, null, 2) + "\n"
  if (existsSync(target) && readFileSync(target, "utf8") !== content) throw new Error(`O freeze de ${version} já existe com outro conteúdo — crie uma nova versão do prompt em vez de sobrescrever.`)
  writeFileSync(target, content)
  const frozen = JSON.parse(content) as { promptVersion: string; promptSha256: string; writerSha256: string }
  console.log(JSON.stringify({ promptVersion: frozen.promptVersion, promptSha256: frozen.promptSha256, writerSha256: frozen.writerSha256 }))
}
