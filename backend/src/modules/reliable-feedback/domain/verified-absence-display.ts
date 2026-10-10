import type { CanonicalBehavior } from "./canonical-behavior.js"
import { VERIFIED_ABSENCE_DISPLAY_VERSION, type VerifiedAbsenceDisplay } from "./reliable-feedback-item.js"

/**
 * V1.7.3 — EXIBIÇÃO DE AUSÊNCIA VERIFICADA (`VERIFIED_ABSENCE_DISPLAY_V1`, determinística, sem LLM).
 *
 * Uma omissão VERIFICADA (as cinco condições de `verified-omission.ts`: processo aplicável, etapa obrigatória, janela completa,
 * oportunidade, nenhuma ação correspondente) é uma CONCLUSÃO do sistema sobre a chamada inteira — não depende de uma fala para
 * existir. A fala "do momento em que caberia" é só ilustração: quando ela não pode ser exibida (a privacidade retém um nome, por
 * exemplo), o ponto não some: o sistema mostra a própria conclusão com uma frase que NÃO é citação nem evidência nova.
 *
 * A privacidade não muda: a fala retida continua retida (e na auditoria). Só a omissão VERIFICADA ganha a frase — omissão não
 * verificada, ação declarada, conclusão incerta nunca viram ausência afirmativa.
 */

/** Frase por comportamento canônico (vocabulário fechado do sistema). */
export const ABSENCE_STATEMENTS: Record<CanonicalBehavior, string> = {
  PROVIDE_PROTOCOL: "Não foi identificado o número do protocolo sendo informado ao cliente durante esta chamada.",
  CONFIRM_UNDERSTANDING: "Não foi identificada, durante esta chamada, uma pergunta ao cliente confirmando se as informações ficaram claras.",
  INFORM_DEADLINE: "Não foi identificado o prazo sendo informado ao cliente durante esta chamada.",
  RECAPITULATE_INTERACTION: "Não foi identificada uma recapitulação do atendimento para o cliente durante esta chamada.",
  CONFIRM_SOLUTION: "Não foi identificada a confirmação da solução aplicada com o cliente durante esta chamada.",
  CANCEL_RECURRING_SERVICE: "Não foi identificado o cancelamento da recorrência durante esta chamada.",
  VALIDATE_HOLDER: "Não foi identificada a validação do titular durante esta chamada.",
  IDENTIFY_CHARGE: "Não foi identificada a identificação da cobrança questionada durante esta chamada.",
  CHECK_PAYMENT: "Não foi identificada a verificação do pagamento da conta durante esta chamada.",
  OPEN_ANALYSIS: "Não foi identificada a abertura de análise durante esta chamada.",
  REGISTER_DISPUTE: "Não foi identificado o registro da contestação durante esta chamada.",
}

/** Ausência verificada sem fala exibível → a frase do sistema; qualquer outro caso → null (o item segue a regra de sempre). */
export function verifiedAbsenceDisplayOf(input: { evidenceType: string | null | undefined; applicability: string | null | undefined; applicabilityBasis: string | null | undefined; operatorFactShown: boolean; behavior: CanonicalBehavior | null | undefined; label: string | null | undefined; evidenceCount: number }): VerifiedAbsenceDisplay | null {
  if (input.operatorFactShown) return null
  if (input.evidenceType !== "VERIFIED_OMISSION" || input.applicability !== "VERIFIED" || input.applicabilityBasis !== "VERIFIED_OMISSION") return null
  const statement = input.behavior ? ABSENCE_STATEMENTS[input.behavior] : input.label ? `Não foi identificado, durante esta chamada, o que o procedimento orienta em “${input.label}”.` : null
  if (!statement) return null
  return { version: VERIFIED_ABSENCE_DISPLAY_VERSION, statement, basis: "VERIFIED_OMISSION", withheldEvidence: input.evidenceCount }
}
