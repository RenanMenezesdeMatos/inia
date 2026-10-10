import { FUNNEL_DEFINITION_VERSION, FUNNELS, DIFFICULTY_RULES, DIFFICULTY_SIGNAL_LABELS } from "./journeys.js"
import { ACTIVITY_DEFINITION_VERSION, METRIC_DEFINITIONS, SESSION_DEFINITION_VERSION, USABILITY_DEFINITIONS_VERSION } from "./metric-dictionary.js"
import { USAGE_CONTENTS, USAGE_ELEMENTS, USAGE_FEATURES, USAGE_SEARCH_SURFACES } from "./usage-elements.js"
import { USAGE_ACTION_LABELS, USAGE_ACTIONS, USAGE_EVENTS, USAGE_FAMILY_LABELS } from "./usage-events.js"
import { USAGE_AREA_LABELS, USAGE_SCREENS } from "./usage-screens.js"

/**
 * Documento do CATÁLOGO da Monitoria de usabilidade, derivado do código (nunca escrito à mão): dicionário de métricas, eventos,
 * telas, elementos, ações, funis e sinais. `scripts/usage-analytics/export-docs.ts` grava em docs/dev; um teste compara.
 */
const cell = (value: string | number | boolean | null | undefined) => String(value ?? "—").replace(/\|/g, "\\|").replace(/\n/g, " ")
const table = (headers: string[], rows: (string | number | boolean | null | undefined)[][]) =>
  [`| ${headers.join(" | ")} |`, `| ${headers.map(() => "---").join(" | ")} |`, ...rows.map((row) => `| ${row.map(cell).join(" | ")} |`)].join("\n")

export function renderUsageCatalogMarkdown(): string {
  const featureLabel = new Map(USAGE_FEATURES.map((feature) => [feature.key, feature.label]))
  return [
    "# Monitoria de usabilidade — catálogo (gerado do código)",
    "",
    "> Arquivo GERADO por `npx tsx scripts/usage-analytics/export-docs.ts` (backend). Não edite à mão: mude o código e regenere.",
    `> Versões: definições \`${USABILITY_DEFINITIONS_VERSION}\` · sessão \`${SESSION_DEFINITION_VERSION}\` · atividade \`${ACTIVITY_DEFINITION_VERSION}\` · funis \`${FUNNEL_DEFINITION_VERSION}\` · dificuldade \`${DIFFICULTY_RULES.version}\`.`,
    "",
    "## Dicionário de métricas",
    "",
    table(
      ["Id", "Aba", "Rótulo", "Definição", "Fórmula", "Unidade", "Fonte", "Base", "Deduplicação", "Cobertura", "Exclusões", "Limitações"],
      METRIC_DEFINITIONS.map((metric) => [metric.id, metric.tab, metric.label, metric.definition, `\`${metric.formula}\``, metric.unit, metric.source, metric.denominator, metric.dedupe, metric.coverage, metric.exclusions, metric.limitations]),
    ),
    "",
    "## Eventos",
    "",
    "Todo evento tem esquema FECHADO (propriedade desconhecida = evento recusado). Organização, ator, estrutura e classificação vêm do servidor; nenhum evento carrega conteúdo digitado, senha, áudio ou transcrição.",
    "",
    table(
      ["Evento", "Família", "Emissor", "Autoridade", "Propósito", "Momento", "Correlação", "Deduplicação", "Sensibilidade", "Atividade qualificada", "Entidades"],
      USAGE_EVENTS.map((event) => [`\`${event.name}\``, USAGE_FAMILY_LABELS[event.family], event.emitter === "CLIENT" ? "Navegador" : "Servidor", event.authority, event.purpose, event.moment, event.correlation, event.dedupe, event.sensitivity, event.qualifiesActivity ? "sim" : "não", (event.entityTypes ?? []).join(", ") || "—"]),
    ),
    "",
    "## Ações com resultado (contrato iniciada → concluída | falhou | cancelada)",
    "",
    table(["Ação", "Rótulo"], USAGE_ACTIONS.map((action) => [`\`${action}\``, USAGE_ACTION_LABELS[action]])),
    "",
    "## Telas",
    "",
    "`INSTRUMENTED` = visualização + elementos centrais medidos; `PARTIAL` = só visualização/abas/links; `NOT_INSTRUMENTED` = existe, mas não emite eventos.",
    "",
    table(
      ["Chave", "Rótulo", "Tipo", "Área", "Funcionalidade", "Rota", "Instrumentação"],
      USAGE_SCREENS.map((screen) => [`\`${screen.key}\``, screen.label, screen.kind, USAGE_AREA_LABELS[screen.area], featureLabel.get(screen.feature) ?? screen.feature, screen.routeTemplate ? `\`${screen.routeTemplate}\`` : "—", screen.instrumentation]),
    ),
    "",
    "## Elementos",
    "",
    table(
      ["Chave", "Rótulo", "Funcionalidade", "Tipo", "Central", "Repetição esperada", "Prazo do resultado (ms)"],
      USAGE_ELEMENTS.map((element) => [`\`${element.key}\``, element.label, featureLabel.get(element.feature) ?? element.feature, element.kind, element.central ? "sim" : "", element.repeatExpected ? "sim" : "", element.resultTimeoutMs ?? ""]),
    ),
    "",
    "## Conteúdos com rolagem medida e superfícies de busca",
    "",
    table(["Conteúdo", "Rótulo"], USAGE_CONTENTS.map((content) => [`\`${content.key}\``, content.label])),
    "",
    table(["Superfície de busca", "Rótulo"], USAGE_SEARCH_SURFACES.map((surface) => [`\`${surface.key}\``, surface.label])),
    "",
    "## Funis",
    "",
    ...FUNNELS.flatMap((funnel) => [`### ${funnel.label}`, "", `Correlação: ${funnel.correlation}. Janela: ${funnel.windowLabel}.`, "", table(["#", "Etapa", "Fonte"], funnel.steps.map((step, index) => [index + 1, step.label, step.source])), ""]),
    "## Sinais de dificuldade (heurísticas)",
    "",
    table(["Sinal", "Rótulo"], Object.entries(DIFFICULTY_SIGNAL_LABELS).map(([key, label]) => [`\`${key}\``, label])),
    "",
    `Parâmetros: ${Object.entries(DIFFICULTY_RULES).filter(([key]) => key !== "version").map(([key, value]) => `${key} = ${JSON.stringify(value)}`).join(" · ")}.`,
    "",
  ].join("\n")
}
