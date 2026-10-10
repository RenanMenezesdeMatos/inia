import { BEHAVIORAL_EVIDENCE_TOOLS, type LedgerEntry } from "./evidence-ledger.js"

/**
 * REPRESENTATIVIDADE da evidência de interação (V1.2 → V1.3 — determinística, por código):
 * - INSUFFICIENT: nenhuma interação/transcrição com dado;
 * - ANECDOTAL: poucas interações frente ao universo — sustenta "nas interações analisadas
 *   ocorreu X", nunca "o colaborador costuma fazer X";
 * - REPRESENTATIVE: amostra que permite falar de padrão do colaborador no período.
 *
 * DOIS UNIVERSOS (V1.3 — §5/6), nunca confundidos:
 * - universo REGISTRADO = interações do colaborador gravadas/registradas no período (o que a
 *   INIA pode abrir) → `recordedCoverage` = analisadas / registradas;
 * - universo OPERACIONAL = volume de contatos que compõe o indicador (ex.: 1.267 chamadas do TMA)
 *   → `operationalCoverage` só existe quando a relação entre os dois conjuntos é conhecida
 *   (`universeRelationship` EXACT); quando não é possível ligar as interações registradas ao
 *   volume operacional, a cobertura operacional é UNKNOWN — nunca inferimos 30/1.267.
 * 30 registradas, 30 analisadas = 100% do registrado ≠ 100% do operacional.
 */
export type EvidenceRepresentativeness = "INSUFFICIENT" | "ANECDOTAL" | "REPRESENTATIVE"
export type UniverseRelationship = "EXACT" | "PARTIAL" | "UNKNOWN"

/** Amostra mínima absoluta para um padrão do colaborador; e fração mínima do universo quando ele é conhecido. */
export const REPRESENTATIVE_MIN_SAMPLE = 5
export const REPRESENTATIVE_MIN_SHARE = 0.2
/** A partir daqui a amostra basta mesmo com universo grande (não exigimos 20% de 1.200 chamadas). */
export const REPRESENTATIVE_ABSOLUTE_SAMPLE = 30

/** Universo operacional informado pela aplicação (volume do indicador) e como se relaciona com o registrado. */
export type OperationalUniverse = { count: number; /** De onde veio o volume (ex.: denominador do indicador). */ source: string; label: string }

export type RepresentativenessAssessment = {
  ref: string
  tool: string
  analyzedCount: number
  recordedUniverseCount: number | null
  /** analisadas / registradas (0..1) — null quando o universo registrado é desconhecido. */
  recordedCoverage: number | null
  operationalUniverseCount: number | null
  /** analisadas / operacional — só quando a relação entre os universos é EXACT; senão null ("Não determinado"). */
  operationalCoverage: number | null
  universeRelationship: UniverseRelationship
  classification: EvidenceRepresentativeness
  reason: string
  // --- compatibilidade com a V1.2 (runs históricos, QA Lab, Revisão humana) ---
  /** @deprecated use analyzedCount */
  analyzed: number
  /** @deprecated use recordedUniverseCount */
  universe: number | null
  /** @deprecated use classification */
  level: EvidenceRepresentativeness
}

const ratio = (part: number, whole: number | null) => (whole !== null && whole > 0 ? Math.round((part / whole) * 1000) / 1000 : null)

/** Relação entre os universos: EXACT quando o volume operacional é o próprio conjunto registrado; PARTIAL quando o registrado é declaradamente um subconjunto ligado; senão UNKNOWN. */
export function relateUniverses(recorded: number | null, operational: OperationalUniverse | null, linked: boolean): UniverseRelationship {
  if (recorded === null || !operational) return "UNKNOWN"
  if (recorded === operational.count) return "EXACT"
  if (linked && recorded < operational.count) return "PARTIAL"
  return "UNKNOWN"
}

export function classifyRepresentativeness(analyzed: number, universe: number | null, minimumSample = REPRESENTATIVE_MIN_SAMPLE): EvidenceRepresentativeness {
  if (analyzed <= 0) return "INSUFFICIENT"
  if (analyzed >= REPRESENTATIVE_ABSOLUTE_SAMPLE) return "REPRESENTATIVE"
  if (analyzed < minimumSample) return "ANECDOTAL"
  if (universe !== null && universe > 0 && analyzed / universe < REPRESENTATIVE_MIN_SHARE) return "ANECDOTAL"
  return "REPRESENTATIVE"
}

export type RepresentativenessInput = {
  analyzed: number
  recordedUniverse: number | null
  operational: OperationalUniverse | null
  /** true = os registros são um subconjunto declarado do volume operacional (relação conhecida). */
  linked?: boolean
}

/**
 * Classificação completa de UM fato: parte do universo registrado (o que a INIA de fato pode
 * abrir); quando o universo operacional é conhecido e MAIOR sem relação determinada, uma amostra
 * abaixo do absoluto não pode ser promovida a REPRESENTATIVE só porque cobriu 100% do registrado.
 */
export function assessRepresentativeness(input: RepresentativenessInput): Omit<RepresentativenessAssessment, "ref" | "tool"> {
  const relationship = relateUniverses(input.recordedUniverse, input.operational, input.linked ?? false)
  const recordedCoverage = ratio(input.analyzed, input.recordedUniverse)
  const operationalCoverage = relationship === "EXACT" || relationship === "PARTIAL" ? ratio(input.analyzed, input.operational?.count ?? null) : null
  let classification = classifyRepresentativeness(input.analyzed, input.recordedUniverse)
  const reasons: string[] = []
  if (classification === "INSUFFICIENT") reasons.push("nenhuma interação/transcrição analisada")
  else if (input.analyzed >= REPRESENTATIVE_ABSOLUTE_SAMPLE) reasons.push(`${input.analyzed} interações analisadas (amostra absoluta suficiente)`)
  else if (input.analyzed < REPRESENTATIVE_MIN_SAMPLE) reasons.push(`${input.analyzed} interação(ões) analisada(s) — abaixo da amostra mínima de ${REPRESENTATIVE_MIN_SAMPLE}`)
  else if (recordedCoverage !== null && recordedCoverage < REPRESENTATIVE_MIN_SHARE) reasons.push(`${Math.round(recordedCoverage * 100)}% das ${input.recordedUniverse} interações registradas`)
  else reasons.push(input.recordedUniverse !== null ? `${input.analyzed} de ${input.recordedUniverse} interações registradas` : `${input.analyzed} interações analisadas (universo registrado desconhecido)`)
  if (input.operational) {
    if (relationship === "EXACT") reasons.push("universo operacional = registrado")
    else if (relationship === "PARTIAL") reasons.push(`cobertura operacional ${Math.round((operationalCoverage ?? 0) * 100)}% de ${input.operational.count} (${input.operational.label})`)
    else {
      reasons.push(`cobertura operacional não determinada (${input.operational.count} ${input.operational.label} no indicador; vínculo com as interações registradas não comprovado)`)
      // Cobrir 100% do registrado não prova cobrir o operacional: sem amostra absoluta, não generalizamos.
      if (classification === "REPRESENTATIVE" && input.analyzed < REPRESENTATIVE_ABSOLUTE_SAMPLE && input.operational.count > input.analyzed) {
        classification = "ANECDOTAL"
        reasons.push("rebaixada: amostra abaixo do absoluto frente a um universo operacional maior e não vinculado")
      }
    }
  }
  return {
    analyzedCount: input.analyzed,
    recordedUniverseCount: input.recordedUniverse,
    recordedCoverage,
    operationalUniverseCount: input.operational?.count ?? null,
    operationalCoverage,
    universeRelationship: relationship,
    classification,
    reason: reasons.join("; "),
    analyzed: input.analyzed,
    universe: input.recordedUniverse,
    level: classification,
  }
}

/** Avalia cada fato de interação/transcrição do ledger contra os universos (registrado = interações do colaborador no período). */
export function assessLedgerRepresentativeness(ledger: LedgerEntry[], universe: number | null, operational: OperationalUniverse | null = null): RepresentativenessAssessment[] {
  return ledger
    .filter((entry) => BEHAVIORAL_EVIDENCE_TOOLS.has(entry.tool))
    .map((entry) => {
      const analyzed = entry.qualityStatus === "NO_DATA" || entry.qualityStatus === "NOT_SUPPORTED" ? 0 : (entry.sampleCount ?? (entry.qualityStatus ? 1 : 0))
      // Pares (anônimos) falam da população, não do colaborador: universo desconhecido — só a amostra manda.
      const peers = entry.tool === "analyze_peer_patterns" || entry.tool === "find_comparable_interactions"
      return { ref: entry.ref, tool: entry.tool, ...assessRepresentativeness({ analyzed, recordedUniverse: peers ? null : universe, operational: peers ? null : operational }) }
    })
}

/** Melhor nível entre avaliações (para rótulos agregados). */
export function bestRepresentativeness(assessments: { classification: EvidenceRepresentativeness }[]): EvidenceRepresentativeness {
  return assessments.some((item) => item.classification === "REPRESENTATIVE") ? "REPRESENTATIVE" : assessments.some((item) => item.classification === "ANECDOTAL") ? "ANECDOTAL" : "INSUFFICIENT"
}
