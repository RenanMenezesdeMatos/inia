import type { Database } from "../../../infrastructure/database/pool.js"
import type { FunctionDeclaration } from "../../assistant/infrastructure/gemini-function-calling-client.js"
import { resolveSubject, type ViewerScope } from "../../performance-analytics/application/viewer-scope.js"
import { calculate, CALCULATION_TRACE, parseCalculations, renderCalculations } from "./arithmetic.js"
import { runDomainQuery, type DataDomain, type DomainFactsLoader } from "./data-domains.js"
import { createDomainFactsLoader } from "./domain-facts-loader.js"
import { PERSON_GROUPINGS } from "./fact-query.js"
import { queryTableMarkdown } from "./indicator-query.js"
import { LEADERSHIP_TOOL_DECLARATIONS, type LeadershipToolResult } from "./leadership-toolset.js"
import type { ResolvedStructure } from "./references.js"

/**
 * FERRAMENTAS DE DADOS DO OPERADOR (`SELF_DATA_TOOLS_V1`): as mesmas ferramentas de cálculo da liderança, sempre sobre a PRÓPRIA
 * pessoa da sessão. A "estrutura" é montada aqui, no servidor, com um membro só (quem pergunta); nenhum parâmetro alcança outra pessoa —
 * `estrutura` e os agrupamentos por pessoa/líder/Grupo nem são oferecidos ao modelo, e um argumento desses que chegue é ignorado.
 * Ficam de fora do operador os domínios de gestão (casos, uso da INIA da equipe, Apoio com Anjo da equipe, span) e a JORNADA
 * (`leadership_workday`): produção observada, classificação da gestão e divergência em aberto são leitura da liderança — o operador
 * vê só o PLANO (`my_schedule`), como na aba "Minha jornada".
 */

export const SELF_DATA_TOOLS: Record<string, { domain: DataDomain; source: string; description: string }> = {
  my_interactions: { domain: "INTERACTIONS", source: "leadership_interactions", description: "Os SEUS atendimentos/ligações registrados: quantos, duração (média, mediana), por motivo, submotivo, canal, dia, semana ou mês, e as ocorrências dos seus atendimentos (rechamada, nota da URA, transferência…) em % ou média." },
  my_monitoring: { domain: "MONITORING", source: "leadership_monitoring", description: "A monitoria das SUAS chamadas analisadas: quantas chamadas foram analisadas e quanto dos critérios do procedimento você cumpriu ou não, por assunto, critério ou período." },
  my_feedbacks: { domain: "FEEDBACKS", source: "leadership_feedbacks", description: "Os feedbacks que VOCÊ recebeu: quantos, de que tipo, sobre qual indicador, quantos você já confirmou (ciência) e quantos estão aguardando." },
  my_schedule: { domain: "SCHEDULE", source: "leadership_schedule", description: "A SUA escala: dias escalados e de folga, turno, horário de entrada, horas e pausas planejadas, exceções (folga, banco de horas, atestado), inclusive datas futuras." },
  my_communications: { domain: "COMMUNICATIONS", source: "leadership_communications", description: "Os comunicados da liderança que chegaram a VOCÊ no período (quais e quando)." },
}
export const SELF_CALCULATE_TOOL = "my_calculate"

/** Domínios que o operador NUNCA consulta, mesmo que uma ferramenta nova aponte para eles por engano (nega por padrão). */
const SELF_FORBIDDEN_DOMAINS = new Set<DataDomain>(["WORKDAY", "CASES", "INIA_USAGE", "SUPPORT"])

const NOT_FOR_SELF = new Set<string>(["estrutura", "limite", "minimo_registros"])
const SELF_GROUPINGS = new Set<string>([...PERSON_GROUPINGS].filter((grouping) => grouping !== "ESTRUTURA"))

function selfDeclaration(name: string, spec: (typeof SELF_DATA_TOOLS)[string]): FunctionDeclaration {
  const source = LEADERSHIP_TOOL_DECLARATIONS.find((declaration) => declaration.name === spec.source)!
  const parameters = source.parameters as { type: string; properties: Record<string, Record<string, unknown>>; required?: string[] }
  const properties = Object.fromEntries(
    Object.entries(parameters.properties)
      .filter(([key]) => !NOT_FOR_SELF.has(key))
      .map(([key, value]) => (key === "agrupar_por" && Array.isArray(value.enum) ? [key, { ...value, enum: (value.enum as string[]).filter((item) => !SELF_GROUPINGS.has(item)), description: "Linhas da tabela: ESTRUTURA = só o seu total; pelo tempo (DIA, SEMANA, MES, DIA_DA_SEMANA) ou por um campo do registro." }] : [key, value])),
  )
  return { name, description: `${spec.description} Só os seus dados. O sistema calcula tudo (total, média, mediana, mínimo, máximo, percentis, %): nunca calcule você a partir de uma lista.`, parameters: { type: "object", properties: properties as typeof source.parameters.properties } }
}

export const SELF_DATA_DECLARATIONS: FunctionDeclaration[] = [
  ...Object.entries(SELF_DATA_TOOLS).map(([name, spec]) => selfDeclaration(name, spec)),
  { ...LEADERSHIP_TOOL_DECLARATIONS.find((declaration) => declaration.name === "leadership_calculate")!, name: SELF_CALCULATE_TOOL },
]
export const isSelfDataTool = (name: string) => name in SELF_DATA_TOOLS || name === SELF_CALCULATE_TOOL

export const SELF_DATA_RULE = [
  "- Seus próprios dados, calculados pelo sistema e só seus: atendimentos/ligações (quantidade, duração, motivos, rechamada, nota da URA…) → my_interactions; monitoria das suas chamadas (critérios cumpridos) → my_monitoring; feedbacks que você recebeu e ciência → my_feedbacks; sua escala e jornada planejada (dias, horário, folgas, pausas, inclusive futuros) → my_schedule; comunicados que você recebeu → my_communications; contas sobre números já trazidos → my_calculate. Resultados de indicador (meta, atingimento, quartil) continuam em my_results.",
  "- Essas ferramentas só trazem os dados de quem pergunta: se a pessoa pedir dados de colegas, da equipe ou de outra pessoa, diga que você só mostra os dados dela.",
  "- Assunto dito em texto livre (\"contestação\") vai em termo; se o sistema devolver opções, mostre-as e espere a escolha.",
].join("\n")

/** Executa uma ferramenta de dados do operador, sempre sobre a própria pessoa (`scope.viewer`). */
export async function executeSelfDataTool(
  scope: ViewerScope,
  input: { name: string; args: Record<string, unknown>; lastClosedPeriod: string; now: Date; load: DomainFactsLoader },
): Promise<LeadershipToolResult> {
  if (input.name === SELF_CALCULATE_TOOL) {
    const parsed = parseCalculations(input.args.calculos)
    if ("error" in parsed) return { text: `Cálculo não feito: ${parsed.error}`, card: null, issue: { kind: "INVALID", message: parsed.error, candidates: [] } }
    return { text: renderCalculations(parsed.calculations.map(calculate)), card: null, trace: CALCULATION_TRACE }
  }
  const spec = SELF_DATA_TOOLS[input.name]
  if (!spec || SELF_FORBIDDEN_DOMAINS.has(spec.domain)) return { text: "Ferramenta desconhecida.", card: null, issue: { kind: "INVALID", message: "Ferramenta desconhecida.", candidates: [] } }
  const self = { kind: "EMPLOYEE" as const, employeeId: scope.viewer.id }
  const structure = { subject: self, resolved: resolveSubject(scope, self), ref: { subject: self, label: scope.viewer.name, description: "Meus dados" } } as unknown as ResolvedStructure
  // Só a própria pessoa: argumentos de escopo/agrupamento por pessoa são descartados mesmo que o modelo os envie.
  const args = Object.fromEntries(Object.entries(input.args).filter(([key, value]) => !NOT_FOR_SELF.has(key) && !(key === "agrupar_por" && typeof value === "string" && SELF_GROUPINGS.has(value))))
  const outcome = await runDomainQuery(scope, { domain: spec.domain, structure, args, load: input.load, lastClosedPeriod: input.lastClosedPeriod, now: input.now, includeAnyRole: true })
  if ("error" in outcome) return { text: `Consulta não feita: ${outcome.error}`, card: null, issue: { kind: "INVALID", message: outcome.error, candidates: [] } }
  if ("choice" in outcome) return { text: outcome.summary, card: outcome.choice, issue: { kind: "AMBIGUOUS", message: outcome.choice.prompt, candidates: outcome.choice.options.map((option) => option.label) } }
  const card = outcome.card
  const text = ["[Seus dados, calculados pelo sistema — use exatamente estes números]", `${card.title} · ${card.scopeNote}`, ...(card.highlights.length > 0 ? [`Destaques: ${card.highlights.join(" ")}`] : []), "", queryTableMarkdown(card), ...(card.limitations.length > 0 ? ["", `Limitações: ${card.limitations.join(" ")}`] : []), `Base: ${card.methods.slice(0, 2).join(" ")}`].join("\n")
  return { text, card }
}

export const selfDomainLoader = (db: Database, organizationId: string, timeZone: string) => createDomainFactsLoader(db, organizationId, timeZone)
