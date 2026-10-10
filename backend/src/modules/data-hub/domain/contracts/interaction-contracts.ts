import type { DataContract } from "../data-contract.js"

/**
 * Contratos de INTERAÇÃO: a interação (evento), a transcrição (versão do texto) e as flags
 * (sinais já calculados pelo cliente). Mesmo modelo que a ingestão existente (`/ingestion`):
 * Interaction → Transcript → Flags, relacionados pelo `externalInteractionId`. A transcrição
 * pode vir inline na interação (campos `transcript*`) ou num feed próprio.
 */
export const INTERACTIONS_CONTRACT: DataContract = {
  key: "INTERACTIONS",
  version: 1,
  label: "Interações",
  description: "Atendimento realizado por um colaborador (canal, motivo, início e fim), com transcrição opcional inline. Destino: `interactions` (+ `transcripts` quando informado).",
  category: "EVENT",
  targetEntity: "interactions",
  fields: [
    { key: "externalInteractionId", label: "ID externo da interação", type: "STRING", required: true, identity: true, maxLength: 128, description: "Identificador único da interação na origem (protocolo, call id).", example: "CALL-2026-000123" },
    { key: "externalEmployeeId", label: "Matrícula / ID externo", type: "STRING", required: true, maxLength: 64, description: "Matrícula do colaborador que atendeu (precisa existir).", example: "OP-10234" },
    { key: "channel", label: "Canal", type: "STRING", required: false, maxLength: 32, description: "Canal da interação (padrão VOICE). Precisa existir no catálogo de flags se flags forem enviadas.", example: "VOICE" },
    { key: "reason", label: "Motivo", type: "STRING", required: true, maxLength: 200, description: "Motivo/assunto do contato.", example: "Cancelamento" },
    { key: "startedAt", label: "Início", type: "DATETIME", required: true, description: "Instante de início (ISO 8601).", example: "2026-09-15T14:02:10-03:00" },
    { key: "endedAt", label: "Fim", type: "DATETIME", required: true, description: "Instante de fim (ISO 8601), posterior ao início.", example: "2026-09-15T14:11:42-03:00" },
    { key: "transcriptContent", label: "Transcrição", type: "STRING", required: false, description: "Texto integral da transcrição (opcional; citação literal, nunca resumo).", example: "Operador: Bom dia, em que posso ajudar? Cliente: ..." },
    { key: "transcriptLanguage", label: "Idioma da transcrição", type: "STRING", required: false, maxLength: 16, description: "Padrão pt-BR.", example: "pt-BR" },
    { key: "transcriptConfidence", label: "Confiança da transcrição", type: "DECIMAL", required: false, description: "0 a 1.", example: 0.94 },
  ],
  naturalKey: ["externalInteractionId"],
  dependencies: ["EMPLOYEES"],
  writeSemantics: "IDEMPOTENT_EVENT",
  writePolicy: "PARTIAL_ALLOWED",
  businessTimeField: "endedAt",
  validateRecord: (record) => {
    const errors = []
    if (typeof record.startedAt === "string" && typeof record.endedAt === "string" && record.endedAt <= record.startedAt) {
      errors.push({ code: "DATA_CONTRACT_VIOLATION" as const, field: "endedAt", message: "O fim da interação deve ser posterior ao início." })
    }
    if (typeof record.transcriptConfidence === "number" && (record.transcriptConfidence < 0 || record.transcriptConfidence > 1)) {
      errors.push({ code: "DATA_CONTRACT_VIOLATION" as const, field: "transcriptConfidence", message: "Confiança precisa estar entre 0 e 1." })
    }
    if (typeof record.transcriptContent === "string" && record.transcriptContent.trim().length > 0 && record.transcriptContent.trim().length < 10) {
      errors.push({ code: "DATA_CONTRACT_VIOLATION" as const, field: "transcriptContent", message: "Transcrição muito curta (mínimo 10 caracteres)." })
    }
    return errors
  },
  examples: [
    { externalInteractionId: "CALL-2026-000123", externalEmployeeId: "OP-10234", channel: "VOICE", reason: "Cancelamento", startedAt: "2026-09-15T14:02:10-03:00", endedAt: "2026-09-15T14:11:42-03:00", transcriptContent: "Operador: Bom dia, em que posso ajudar? Cliente: Quero cancelar meu plano.", transcriptLanguage: "pt-BR", transcriptConfidence: 0.94 },
  ],
}

export const TRANSCRIPTS_CONTRACT: DataContract = {
  key: "TRANSCRIPTS",
  version: 1,
  label: "Transcrições",
  description: "Transcrição de uma interação já recebida (por versão). Destino: `transcripts`.",
  category: "EVENT",
  targetEntity: "transcripts",
  fields: [
    { key: "externalInteractionId", label: "ID externo da interação", type: "STRING", required: true, identity: true, maxLength: 128, description: "Interação de origem (precisa existir).", example: "CALL-2026-000123" },
    { key: "content", label: "Conteúdo", type: "STRING", required: true, description: "Texto integral da transcrição.", example: "Operador: Bom dia, em que posso ajudar? Cliente: ..." },
    { key: "version", label: "Versão", type: "INTEGER", required: false, description: "Versão da transcrição (padrão 1). Mesma versão substitui.", example: 1 },
    { key: "language", label: "Idioma", type: "STRING", required: false, maxLength: 16, description: "Padrão pt-BR.", example: "pt-BR" },
    { key: "confidence", label: "Confiança", type: "DECIMAL", required: false, description: "0 a 1.", example: 0.94 },
  ],
  naturalKey: ["externalInteractionId", "version"],
  dependencies: ["INTERACTIONS"],
  writeSemantics: "IDEMPOTENT_EVENT",
  writePolicy: "PARTIAL_ALLOWED",
  businessTimeField: null,
  validateRecord: (record) => {
    const errors = []
    if (typeof record.content === "string" && record.content.trim().length < 10) errors.push({ code: "DATA_CONTRACT_VIOLATION" as const, field: "content", message: "Transcrição muito curta (mínimo 10 caracteres)." })
    if (typeof record.confidence === "number" && (record.confidence < 0 || record.confidence > 1)) errors.push({ code: "DATA_CONTRACT_VIOLATION" as const, field: "confidence", message: "Confiança precisa estar entre 0 e 1." })
    if (typeof record.version === "number" && record.version < 1) errors.push({ code: "DATA_CONTRACT_VIOLATION" as const, field: "version", message: "Versão precisa ser ≥ 1." })
    return errors
  },
  examples: [{ externalInteractionId: "CALL-2026-000123", content: "Operador: Bom dia, em que posso ajudar? Cliente: Quero cancelar meu plano.", version: 1, language: "pt-BR", confidence: 0.94 }],
}

export const INTERACTION_FLAGS_CONTRACT: DataContract = {
  key: "INTERACTION_FLAGS",
  version: 1,
  label: "Flags de interação",
  description: "Sinal já calculado pelo cliente sobre uma interação (rechamada, nota de URA…). Um registro por interação × flag; a flag precisa existir no catálogo do canal. Ao aplicar, matricula Workflows exatamente como a ingestão em tempo real. Destino: `interaction_flags`.",
  category: "EVENT",
  targetEntity: "interaction_flags",
  fields: [
    { key: "externalInteractionId", label: "ID externo da interação", type: "STRING", required: true, identity: true, maxLength: 128, description: "Interação de origem (precisa existir).", example: "CALL-2026-000123" },
    { key: "flagName", label: "Nome da flag", type: "STRING", required: true, maxLength: 64, description: "Nome cadastrado no catálogo de flags do canal da interação.", example: "rechamada" },
    { key: "value", label: "Valor", type: "STRING", required: true, maxLength: 32, description: "true/false para flags booleanas; número para flags numéricas.", example: "true" },
  ],
  naturalKey: ["externalInteractionId", "flagName"],
  dependencies: ["INTERACTIONS"],
  writeSemantics: "IDEMPOTENT_EVENT",
  writePolicy: "PARTIAL_ALLOWED",
  businessTimeField: null,
  examples: [
    { externalInteractionId: "CALL-2026-000123", flagName: "rechamada", value: "true" },
    { externalInteractionId: "CALL-2026-000123", flagName: "nota_ura", value: "3" },
  ],
}
