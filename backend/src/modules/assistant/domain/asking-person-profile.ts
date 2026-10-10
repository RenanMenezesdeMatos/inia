import type { OperatorIdentity } from "../application/build-operator-context.js"

const LEVEL_LABELS: Record<string, string> = { OPERATOR: "Operador", SUPERVISOR: "Supervisor", COORDINATOR: "Coordenador", MANAGER: "Gerente", SENIOR_MANAGER: "Gerente Sênior", DIRECTOR: "Diretor" }

/**
 * Perfil de quem pergunta, para o especialista ADAPTAR a resposta (operador × liderança). Só contexto: o que cada um pode
 * ver continua decidido pelo acesso, e os dados que chegam aqui (indicadores, feedbacks) são sempre os da própria pessoa.
 */
export function renderAskingPersonProfile(identity: Pick<OperatorIdentity, "name" | "teamName" | "jobTitle" | "level" | "directReports">): string {
  const level = identity.level ? LEVEL_LABELS[identity.level] ?? null : null
  const role = [identity.jobTitle, level && !identity.jobTitle?.toLowerCase().includes(level.toLowerCase()) ? `nível ${level}` : null].filter(Boolean).join(" · ")
  const leads = (identity.directReports ?? 0) > 0
  const who = `Colaborador que está perguntando: ${identity.name}${role ? ` — ${role}` : ""}${identity.teamName ? ` (grupo: ${identity.teamName})` : ""}${leads ? `; lidera ${identity.directReports} ${identity.directReports === 1 ? "pessoa" : "pessoas"} diretamente` : ""}.`
  const guidance = leads
    ? "Perfil de LIDERANÇA: pode perguntar sobre processos e políticas para orientar a equipe e sobre gestão de pessoas. Os indicadores e feedbacks enviados aqui são os da PRÓPRIA pessoa (individuais): se a pergunta for sobre a equipe ou um liderado, diga que por esta conversa você não tem os dados da equipe e indique as abas Indicadores e Equipe do perfil — nunca invente números da equipe."
    : "Perfil de OPERADOR: responda sobre o trabalho, os processos e os dados da própria pessoa."
  return `${who}\n${guidance}`
}
