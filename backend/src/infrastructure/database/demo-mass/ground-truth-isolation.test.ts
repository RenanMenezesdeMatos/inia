import { readdir, readFile, stat } from "node:fs/promises"
import { dirname, join, relative } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { DIAGNOSTIC_CALLS_DATASET, DIAGNOSTIC_CALLS_DIRECTORY } from "./diagnostic-calls.js"

/**
 * GROUND TRUTH ≠ DADO DA IA. O gabarito do lote `inia_demo_90_v1` (padrões plantados, casos-controle,
 * métricas esperadas) existe SÓ para QA/benchmark e vive em `backend/scripts/poc-tools/ground-truth/`.
 * Este teste prova, pelo código-fonte e pelo arquivo importado, que nada dele chega ao runtime:
 *   1. nenhum arquivo de `backend/src` referencia o diretório/arquivos do gabarito (exceto este teste);
 *   2. o JSONL que o seed importa não contém nenhum rótulo plantado, nenhum marcador de controle e
 *      nenhuma palavra do vocabulário do gabarito — nem em metadado, nem em transcrição;
 *   3. o seed lê por lista explícita (um arquivo, hash conferido), nunca por varredura de pasta;
 *   4. o gabarito não está dentro de `seeds/` (o runner de seed nem enxerga a pasta).
 */
const BACKEND_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../..")
const SRC_ROOT = join(BACKEND_ROOT, "src")
const GROUND_TRUTH_ROOT = join(BACKEND_ROOT, "scripts/poc-tools/ground-truth", DIAGNOSTIC_CALLS_DATASET.lot)
const THIS_FILE = fileURLToPath(import.meta.url)

/** Tokens que só existem no gabarito — se algum aparecer no dado importável, o lote está contaminado. */
const FORBIDDEN_IN_DATASET = ["rotulos_plantados", "caso_controle", "periodo_qa", "nao_inferir", "citacao_verbatim", "gabarito", "ground truth", "ground_truth", "plantad", "qa_nao_importar", "casos-controle", "caso-controle", "metricas_esperadas"]

async function listFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) files.push(...(await listFiles(path)))
    else files.push(path)
  }
  return files
}

describe("isolamento do ground truth do lote de chamadas de diagnóstico", () => {
  it("o gabarito existe como material de QA (fora de seeds/ e fora de src/)", async () => {
    const files = (await readdir(GROUND_TRUTH_ROOT)).sort()
    // Gabarito original + artefatos de QA desta massa (mapa temporal V1 → V2 e fingerprint de referência do dev).
    expect(files).toEqual(["DIAGNOSTIC_DATASET_V1.fingerprint.dev.json", "DIAGNOSTIC_DATASET_V1_1.fingerprint.dev.json", "GROUND_TRUTH.md", "ground_truth_chamadas.jsonl", "manifest_sha256.json", "metricas_esperadas.json", "temporal_layout_v2.json", "validacao.json"])
    expect(relative(SRC_ROOT, GROUND_TRUTH_ROOT).startsWith("..")).toBe(true)
    expect(relative(DIAGNOSTIC_CALLS_DIRECTORY, GROUND_TRUTH_ROOT).startsWith("..")).toBe(true)
    // O dado importável é UM arquivo, nomeado explicitamente; o diretório de seeds não tem nada do gabarito.
    const seedFiles = await listFiles(DIAGNOSTIC_CALLS_DIRECTORY)
    expect(seedFiles.some((file) => /ground[_-]truth|metricas_esperadas|validacao\.json|manifest_sha256/i.test(file))).toBe(false)
    expect((await stat(join(DIAGNOSTIC_CALLS_DIRECTORY, DIAGNOSTIC_CALLS_DATASET.file))).isFile()).toBe(true)
  })

  it("nenhum arquivo de runtime/seed em src/ referencia o gabarito em CÓDIGO (comentários que apontam onde ele vive e testes que provam a ausência são permitidos)", async () => {
    // Testes (`*.test.ts`) podem citar o gabarito para PROVAR sua ausência; código de runtime/seed, não.
    const files = (await listFiles(SRC_ROOT)).filter((file) => file !== THIS_FILE && /\.(ts|sql|json|md)$/.test(file) && !/\.test\.ts$/.test(file))
    const offenders: string[] = []
    for (const file of files) {
      const text = (await readFile(file, "utf8")).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1").replace(/^\s*--.*$/gm, "")
      if (/ground[_-]truth|metricas_esperadas|ground_truth_chamadas|GROUND_TRUTH\.md|poc-tools\/ground/i.test(text)) offenders.push(relative(SRC_ROOT, file))
    }
    expect(offenders).toEqual([])
  })

  it("o JSONL importado não contém rótulo plantado, marcador de controle nem vocabulário do gabarito", async () => {
    const dataset = await readFile(join(DIAGNOSTIC_CALLS_DIRECTORY, DIAGNOSTIC_CALLS_DATASET.file), "utf8")
    const lower = dataset.toLowerCase()
    const groundTruth = (await readFile(join(GROUND_TRUTH_ROOT, "ground_truth_chamadas.jsonl"), "utf8")).split("\n").filter((line) => line.trim()).map((line) => JSON.parse(line) as { rotulos_plantados: string[]; caso_controle: boolean; evidencias: { rotulo: string }[] })
    const labels = new Set(groundTruth.flatMap((row) => [...row.rotulos_plantados, ...row.evidencias.map((evidence) => evidence.rotulo)]))
    expect(labels.size).toBeGreaterThanOrEqual(9)
    for (const label of labels) expect(lower, `rótulo "${label}" vazou para o dado importável`).not.toContain(label.toLowerCase())
    for (const token of FORBIDDEN_IN_DATASET) expect(lower, `token "${token}" vazou para o dado importável`).not.toContain(token)
    // Os 18 controles não têm nenhuma marca no dado: só o gabarito sabe quais são.
    expect(groundTruth.filter((row) => row.caso_controle)).toHaveLength(18)
    for (const record of dataset.split("\n").filter((line) => line.trim()).map((line) => JSON.parse(line) as Record<string, unknown>)) {
      expect(Object.keys(record).some((key) => /controle|rotulo|qa|gabarito|padrao|pattern/i.test(key))).toBe(false)
    }
  })
})
