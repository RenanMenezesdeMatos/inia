import { createHash } from "node:crypto"

/**
 * DATASET FINGERPRINT (V1.3.1 — §41–43): assinatura determinística e NÃO sensível da massa sobre a
 * qual um QA Run/POC de benchmark rodou — contagens estruturais da organização e do sujeito testado
 * (nunca texto de transcrição, nunca PII). Serve para uma coisa: impedir "X% de tokens economizados"
 * entre execuções que rodaram sobre massas diferentes. Massa mudou → comparação lado a lado com aviso,
 * sem percentual enganoso. Run antigo sem fingerprint → compatibilidade UNKNOWN (continua legível).
 */
export type DatasetFingerprintComponents = {
  /** Contagens estruturais da organização. */
  people: number
  interactions: number
  transcripts: number
  measurements: number
  indicatorDefinitions: number
  knowledgeDocuments: number
  /** Escopo do sujeito testado (quando há): interações/transcrições/medições do colaborador no período. */
  subject?: { interactions: number; transcripts: number; measurements: number; periodStart: string | null; periodEnd: string | null } | undefined
  /**
   * DATASET DE DIAGNÓSTICO (hotfix 2026-09-18): quando o sujeito pertence ao Subgrupo de diagnóstico, a
   * versão conceitual (`DIAGNOSTIC_DATASET_V1_1`) e o fingerprint de CONTEÚDO da massa (hashes das
   * transcrições, interações, catálogo de assuntos — demo-mass/diagnostic-dataset.ts) entram no hash:
   * uma correção de texto no corpus muda o fingerprint mesmo com as contagens iguais. Ausente = não
   * aplicável (run fora da massa de diagnóstico) — a chave só existe quando aplicável, para que runs
   * antigos fora da massa continuem comparáveis.
   */
  dataset?: DatasetStamp | undefined
}

export type DatasetStamp = { version: string; fingerprint: string }

export type DatasetFingerprint = { version: 1; hash: string; computedAt: string; components: DatasetFingerprintComponents }

export type BenchmarkCompatibility = {
  status: "COMPATIBLE" | "DATASET_CHANGED" | "UNKNOWN"
  current: string | null
  reference: string | null
  message: string
  /** Versão do dataset de diagnóstico de cada lado (null = não aplicável/não informado). */
  currentDataset?: string | null
  referenceDataset?: string | null
}

/** Rótulo de exibição do dataset de um run: versão + fingerprint resumido; NOT_APPLICABLE fora da massa; NOT_INFORMED em run antigo. */
export type DatasetLabel = { status: "APPLIED" | "NOT_APPLICABLE" | "NOT_INFORMED"; version: string | null; fingerprint: string | null; shortFingerprint: string | null; hash: string | null }

export function datasetLabelOf(fingerprint: { hash: string; components?: { dataset?: DatasetStamp | undefined } } | null | undefined): DatasetLabel {
  if (!fingerprint) return { status: "NOT_INFORMED", version: null, fingerprint: null, shortFingerprint: null, hash: null }
  const stamp = fingerprint.components?.dataset
  if (!stamp) return { status: "NOT_APPLICABLE", version: null, fingerprint: null, shortFingerprint: null, hash: fingerprint.hash }
  return { status: "APPLIED", version: stamp.version, fingerprint: stamp.fingerprint, shortFingerprint: `${stamp.fingerprint.slice(0, 8)}…${stamp.fingerprint.slice(-4)}`, hash: fingerprint.hash }
}

export function fingerprintOf(components: DatasetFingerprintComponents, computedAt: Date): DatasetFingerprint {
  // Fórmula ORIGINAL preservada para as contagens (hash de runs históricos continua comparável); o stamp do
  // dataset de diagnóstico entra explicitamente (o replacer por chaves de topo não serializa objetos aninhados).
  const { dataset, ...counts } = components
  const stable = JSON.stringify(counts, Object.keys(counts).sort())
  const stamped = dataset ? `${stable}|dataset:${dataset.version}:${dataset.fingerprint}` : stable
  return { version: 1, hash: createHash("sha256").update(stamped).digest("hex").slice(0, 16), computedAt: computedAt.toISOString(), components }
}

/** Compatibilidade entre o run atual e a referência — só COMPATIBLE autoriza percentuais. */
export function compareFingerprints(current: DatasetFingerprint | null | undefined, reference: DatasetFingerprint | { hash: string; dataset?: DatasetStamp | null } | null | undefined): BenchmarkCompatibility {
  const currentHash = current?.hash ?? null
  const referenceHash = reference?.hash ?? null
  const currentDataset = current?.components?.dataset?.version ?? null
  const referenceDataset = (reference && "components" in reference ? reference.components?.dataset?.version : reference?.dataset?.version) ?? null
  const datasets = { currentDataset, referenceDataset }
  if (!currentHash || !referenceHash) return { status: "UNKNOWN", current: currentHash, reference: referenceHash, ...datasets, message: "Compatibilidade da massa não verificável (execução sem fingerprint) — diferenças mostradas sem garantia de comparabilidade." }
  if (currentHash === referenceHash) return { status: "COMPATIBLE", current: currentHash, reference: referenceHash, ...datasets, message: "Mesma massa de dados — comparação válida." }
  const detail = currentDataset || referenceDataset ? ` Dataset: ${referenceDataset ?? "não aplicável"} → ${currentDataset ?? "não aplicável"}.` : ""
  return { status: "DATASET_CHANGED", current: currentHash, reference: referenceHash, ...datasets, message: `Dataset diferente — comparação de eficiência não diretamente válida (percentuais omitidos; valores lado a lado).${detail}` }
}
