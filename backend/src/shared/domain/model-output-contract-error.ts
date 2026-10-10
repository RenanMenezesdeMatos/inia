import { DomainError } from "./domain-error.js"

/** Uma violação do contrato de saída: onde (caminho no JSON) e o quê (código estável). Nunca o conteúdo. */
export type ContractViolation = { path: string; code: string; message: string }

/**
 * V1.7.1c — o modelo RESPONDEU, mas a resposta não respeita o contrato pedido (JSON inválido, campo obrigatório ausente,
 * avaliação de processo fora do formato, evidência não literal…). Não é falha de provedor: repetir a MESMA chamada não
 * corrige nada e só gasta — por isso vira uma categoria própria (MODEL_OUTPUT_CONTRACT_INVALID) com política de retry
 * própria (workflows/domain/node-retry-policy.ts).
 *
 * `rawResponse` = SÓ o texto de aplicação que o modelo devolveu (nunca prompt, nunca raciocínio do provedor), para
 * diagnóstico no caminho administrativo (agent_runs). `agentId`/`model`/`agentRunId` são preenchidos por quem chamou.
 */
export class ModelOutputContractError extends DomainError {
  readonly diagnostics: {
    contract: string
    contractVersion: string | null
    violations: ContractViolation[]
    rawResponse: string | null
    agentId: string | null
    model: string | null
    agentRunId: string | null
  }

  constructor(message: string, code: string, diagnostics: { contract: string; contractVersion?: string | null; violations?: ContractViolation[]; rawResponse?: string | null }) {
    super(message, code, 502)
    this.name = "ModelOutputContractError"
    this.diagnostics = { contract: diagnostics.contract, contractVersion: diagnostics.contractVersion ?? null, violations: diagnostics.violations ?? [], rawResponse: diagnostics.rawResponse ?? null, agentId: null, model: null, agentRunId: null }
  }
}
