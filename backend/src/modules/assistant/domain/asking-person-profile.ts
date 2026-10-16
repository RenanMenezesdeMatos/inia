import type { OperatorIdentity } from "../application/build-operator-context.js"

const LEVEL_LABELS: Record<string, string> = { OPERATOR: "Operador", SUPERVISOR: "Supervisor", COORDINATOR: "Coordenador", MANAGER: "Gerente", SENIOR_MANAGER: "Gerente Sênior", DIRECTOR: "Diretor" }

/**
 * Perfil de quem pergunta, para o especialista ADAPTAR a resposta (operador × liderança). Só contexto: o que cada um pode
 * ver continua decidido pelo acesso, e os dados que chegam aqui (indicadores, feedbacks) são sempre os da própria pessoa.
 */
export function renderAskingPersonProfile(identity: Pick<OperatorIdentity, "name" | "teamName" | "jobTitle" | "level" | "directReports">, options: { leadershipTools?: boolean; processConsultation?: boolean } = {}): string {
  const level = identity.level ? LEVEL_LABELS[identity.level] ?? null : null
  const role = [identity.jobTitle, level && !identity.jobTitle?.toLowerCase().includes(level.toLowerCase()) ? `nível ${level}` : null].filter(Boolean).join(" · ")
  const leads = (identity.directReports ?? 0) > 0
  const who = `Colaborador que está perguntando: ${identity.name}${role ? ` — ${role}` : ""}${identity.teamName ? ` (grupo: ${identity.teamName})` : ""}${leads ? `; lidera ${identity.directReports} ${identity.directReports === 1 ? "pessoa" : "pessoas"} diretamente` : ""}.`
  // Com as ferramentas da liderança (chat de texto), os dados da estrutura vêm delas, no escopo da sessão; sem elas (voz), a INIA
  // continua sem os dados da equipe e diz onde encontrá-los.
  // Vale para o Orquestrador E para os especialistas (que recebem este mesmo perfil): quem lidera não atende clientes.
  const leaderFrame = "Quem pergunta LIDERA pessoas e NÃO realiza atendimentos: responda como orientação de gestão — o que observar na equipe, como orientar, treinar e dar feedback aos operadores, que procedimento revisar com eles. Nunca trate a pessoa como atendente (\"no seu atendimento\", \"antes de encerrar a sua chamada\") e nunca diga para ela procurar a liderança imediata."
  // Consulta de processo de quem lidera (Orquestrador do Grupo da dúvida): os números da equipe são de outra ferramenta.
  const guidance = leads && options.processConsultation
    ? "Perfil de LIDERANÇA — CONSULTA DE PROCESSO: a pergunta é sobre processo, procedimento ou conhecimento das bases para orientar a equipe. Os números da equipe são consultados por outra ferramenta: responda só o processo, sem dizer que não tem os dados da equipe e sem inventar números."
    : leads && options.leadershipTools
    ? "Perfil de LIDERANÇA: pode perguntar sobre a equipe/estrutura, indicadores, pessoas, pendências e prioridades (use as ferramentas leadership_*, que respeitam o escopo de acesso dele) e sobre processos e políticas para orientar a equipe. Os indicadores e feedbacks individuais enviados aos especialistas são os da PRÓPRIA pessoa."
    : leads
      ? "Perfil de LIDERANÇA: pode perguntar sobre processos e políticas para orientar a equipe e sobre gestão de pessoas. Os indicadores e feedbacks enviados aqui são os da PRÓPRIA pessoa (individuais): se a pergunta for sobre a equipe ou um liderado, diga que por voz você ainda não traz os dados da equipe e indique a conversa por texto com a INIA ou as abas Indicadores e Equipe do perfil — nunca invente números da equipe."
      : "Perfil de OPERADOR: responda sobre o trabalho, os processos e os dados da própria pessoa."
  return leads ? `${who}\n${leaderFrame}\n${guidance}` : `${who}\n${guidance}`
}
