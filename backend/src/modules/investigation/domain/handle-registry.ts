/**
 * HANDLE REGISTRY (V1.2 — Zero-ID Model Context). O modelo nunca recebe UUIDs: entidades
 * encontradas durante a investigação viram handles curtos da EXECUÇÃO — `I1` (interação),
 * `K1` (documento de conhecimento), `M1` (candidato a material de apoio), `P1` (interação de um PAR,
 * cuja transcrição só chega ao modelo pela projeção de privacidade — peer-privacy-projection.ts) — e o backend resolve
 * de volta. O registry é escopado à execução: um handle só existe dentro dela (impossível
 * resolver em outra), é org-safe (só registra o que a própria Tool carregou já filtrado por
 * organização/colaborador) e NUNCA substitui a identidade real na auditoria — o trace e o
 * Feedback continuam com o UUID verdadeiro.
 */
export type HandleKind = "I" | "K" | "M" | "P"
/**
 * V1.4.2 — HANDLES CANÔNICOS DE CLAIM: `SP-n` (semantic pattern) e `SF-n` (semantic finding) são numerados uma vez por
 * execução, na ordem em que a camada semântica os produz, e são o ÚNICO nome pelo qual a síntese pode citar um pattern ou
 * um finding numa claim (`support: { type: "PATTERN", patternRef: "SP1" }`). Não identificam entidade real (não resolvem
 * para UUID) — por isso ficam fora de `register/resolve`; nunca colidem com F-n (fato do ledger) nem com I-n/P-n.
 */
export type ClaimHandleKind = "SP" | "SF"

const HANDLE_PATTERN = /^([IKMP])(\d{1,4})$/

export class HandleRegistry {
  private readonly byId = new Map<string, string>()
  private readonly byHandle = new Map<string, string>()
  private readonly counters: Record<HandleKind, number> = { I: 0, K: 0, M: 0, P: 0 }
  private readonly claimCounters: Record<ClaimHandleKind, number> = { SP: 0, SF: 0 }

  /** Registra (ou reaproveita) o handle de uma identidade real. */
  register(kind: HandleKind, realId: string): string {
    const key = `${kind}:${realId}`
    const existing = this.byId.get(key)
    if (existing) return existing
    this.counters[kind] += 1
    const handle = `${kind}${this.counters[kind]}`
    this.byId.set(key, handle)
    this.byHandle.set(handle, realId)
    return handle
  }

  /** Próximo handle canônico de claim desta execução (SP1, SP2… / SF1, SF2…) — sequência única por execução. */
  nextClaimHandle(kind: ClaimHandleKind): string {
    this.claimCounters[kind] += 1
    return `${kind}${this.claimCounters[kind]}`
  }

  /** Identidade real de um handle desta execução — undefined para handle desconhecido/de outra execução. */
  resolve(handle: string): string | undefined {
    return this.byHandle.get(handle.trim().toUpperCase())
  }

  handleOf(kind: HandleKind, realId: string): string | undefined {
    return this.byId.get(`${kind}:${realId}`)
  }

  /** Mapa handle → id real (só para o AUDIT context; nunca vai ao modelo). */
  entries(): { handle: string; kind: HandleKind; realId: string }[] {
    return [...this.byHandle.entries()].map(([handle, realId]) => ({ handle, kind: handle[0] as HandleKind, realId }))
  }

  get size(): number {
    return this.byHandle.size
  }
}

export function isHandle(value: unknown): value is string {
  return typeof value === "string" && HANDLE_PATTERN.test(value.trim().toUpperCase())
}

export class UnknownHandleError extends Error {
  constructor(public readonly handle: string) {
    super(`Referência "${handle}" não existe nesta investigação — use só os handles devolvidos pelas ferramentas (ex.: I1, I2).`)
  }
}

/** Chaves cujo valor é uma identidade que o modelo referencia por handle. */
const HANDLE_KEYS: Record<string, HandleKind> = { interactionId: "I", interactionIds: "I", peerInteractionId: "P", documentId: "K", materialId: "M" }

/** Chaves técnicas que nunca têm valor semântico para o raciocínio — removidas do MODEL context. */
export const TECHNICAL_KEYS = new Set([
  "organizationId", "operatorId", "employeeId", "personId", "teamId", "subteamId", "groupId", "subgroupId",
  "measurementId", "measurementIds", "evidenceSourceId", "runId", "workflowId", "nodeId", "enrollmentId", "agentRunId",
  "startedAt", "endedAt", "createdAt", "updatedAt", "ingestedAt", "capturedAt",
])

const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi

/** Quantos identificadores técnicos (UUID) um texto enviado ao modelo contém — prova do Zero-ID. */
export function countTechnicalIds(text: string): number {
  return text.match(UUID_PATTERN)?.length ?? 0
}

/**
 * PROJEÇÃO PARA O MODELO: substitui ids por handles (registrando-os) e remove chaves técnicas.
 * Recursiva, sem mutar o valor original (o resultado completo continua no trace/auditoria).
 */
export function projectForModel(value: unknown, registry: HandleRegistry): unknown {
  if (Array.isArray(value)) return value.map((item) => projectForModel(item, registry))
  if (!value || typeof value !== "object") return value
  const projected: Record<string, unknown> = {}
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (TECHNICAL_KEYS.has(key)) continue
    const kind = HANDLE_KEYS[key]
    if (kind && typeof raw === "string") {
      projected[key === "interactionId" ? "interaction" : key === "peerInteractionId" ? "peerInteraction" : key === "documentId" ? "document" : "material"] = registry.register(kind, raw)
      continue
    }
    if (kind && Array.isArray(raw)) {
      projected[key === "interactionIds" ? "interactions" : key] = raw.map((item) => (typeof item === "string" ? registry.register(kind, item) : item))
      continue
    }
    projected[key] = projectForModel(raw, registry)
  }
  return projected
}

/**
 * ARGUMENTOS VINDOS DO MODELO: handles → ids reais antes de qualquer acesso a banco. Handle
 * desconhecido é erro (o modelo não pode inventar); um UUID cru é aceito só se já estiver
 * registrado nesta execução (compatibilidade) — nunca um id que a execução não viu.
 */
export function resolveModelArgs(args: Record<string, unknown>, registry: HandleRegistry): Record<string, unknown> {
  const resolved: Record<string, unknown> = {}
  const resolveOne = (kind: HandleKind, raw: unknown): unknown => {
    if (typeof raw !== "string") return raw
    if (isHandle(raw)) {
      const real = registry.resolve(raw)
      if (!real || registry.handleOf(kind, real) === undefined) throw new UnknownHandleError(raw)
      return real
    }
    if (registry.handleOf(kind, raw) !== undefined) return raw
    throw new UnknownHandleError(raw)
  }
  for (const [key, raw] of Object.entries(args)) {
    const kind = HANDLE_KEYS[key]
    if (!kind) {
      resolved[key] = raw
      continue
    }
    resolved[key] = Array.isArray(raw) ? raw.map((item) => resolveOne(kind, item)) : resolveOne(kind, raw)
  }
  return resolved
}
