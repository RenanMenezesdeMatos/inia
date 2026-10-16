import type { ReportDefinition, VisualizationType } from "@/schemas/reports/reports.schema"

/** Rótulos dos reports (formulário, lista, entrega) — texto de tela, nunca regra. */
export const RUN_STATUS_LABELS: Record<string, string> = {
  QUEUED: "Na fila",
  RUNNING: "Executando",
  COMPLETED: "Entregue",
  NOT_FORWARDED: "Não encaminhado",
  PARTIAL: "Entregue em parte",
  BLOCKED: "Bloqueado (permissão)",
  SKIPPED: "Ignorado",
  FAILED: "Falha técnica",
}

export const NOT_FORWARDED_TEXT: Record<string, string> = {
  STALE_SOURCES: "Report não encaminhado: as bases necessárias ainda não foram atualizadas para o período configurado.",
  NO_CHANGE: "Report não encaminhado: as bases foram consultadas, mas os dados deste report não mudaram desde a última entrega.",
  INSUFFICIENT_COVERAGE: "Report não encaminhado: as bases ainda não cobrem o período configurado (menos de 70% das pessoas com dado).",
}

export const VISUALIZATION_LABELS: Record<VisualizationType, string> = { TABLE: "Tabela", KPI: "Indicadores resumidos", BAR: "Barras", LINE: "Linha (evolução)", AREA: "Área (evolução)", DISTRIBUTION: "Distribuição" }

export const TOOL_LABELS: Record<ReportDefinition["tool"], string> = { INDICATOR_QUERY: "Resultados de indicadores", WORKFORCE: "Força de trabalho (situação funcional)", INDICATOR_DIAGNOSIS: "Diagnóstico de um indicador" }

export const GROUP_BY_LABELS: Record<string, string> = { ESTRUTURA: "Estrutura inteira", UNIDADE: "Nível logo abaixo", SUPERVISOR: "Supervisor", COORDINATOR: "Coordenador", MANAGER: "Gerente", SENIOR_MANAGER: "Gerente Sênior", TEAM: "Grupo", SUBTEAM: "Subgrupo", PESSOA: "Pessoa", COMPETENCIA: "Competência (mês a mês)" }
export const VIEW_LABELS: Record<string, string> = { INDICADOR: "Resultado de cada indicador", CONSOLIDADO: "Consolidado (todos os indicadores + PRV)", QUARTIS: "Quartis e dispersão" }
export const SORT_LABELS: Record<string, string> = { PCT_FORA: "% fora da meta", FORA: "Quantidade fora", ATINGIMENTO: "Atingimento", VARIACAO: "Variação", Q4: "Q4", DISPERSAO: "Dispersão", NOME: "Nome" }
export const SITUATION_LABELS: Record<string, string> = { FORA: "Fora da meta", DENTRO: "Dentro da meta", SEM_DADO: "Sem dado" }
export const PERIOD_MODE_LABELS: Record<string, string> = { LAST_CLOSED: "Última competência fechada", LAST_N_CLOSED: "Últimas competências", FIXED_MONTH: "Competência fixa", CURRENT: "Período em curso (medição diária)", TODAY: "Data da execução" }
export const PERIOD_DISPLAY_LABELS: Record<string, string> = { ULTIMA: "A última, com a variação", MEDIA: "Média do período", POR_MES: "Mês a mês", RECORRENCIA: "Recorrência (meses fora / no Q4)" }
export const WINDOW_LABELS: Record<string, string> = { MES_CORRENTE: "Mês em curso", SEMANA_CORRENTE: "Semana em curso", ULTIMOS_7_DIAS: "Últimos 7 dias" }
export const WEEKDAY_LABELS: Record<string, string> = { MON: "Seg", TUE: "Ter", WED: "Qua", THU: "Qui", FRI: "Sex", SAT: "Sáb", SUN: "Dom" }
export const LEVEL_LABELS: Record<string, string> = { OPERATOR: "Operadores", SUPERVISOR: "Supervisores", COORDINATOR: "Coordenadores", MANAGER: "Gerentes", SENIOR_MANAGER: "Gerentes Seniores", DIRECTOR: "Diretores" }
export const WORKFORCE_STATUS_LABELS: Record<string, string> = { EM_PRODUCAO: "Em produção", FERIAS: "Férias", AFASTAMENTO: "Afastamento", ATIVIDADE_OFF: "Atividade off", TRANSFERIDO: "Transferido", APOSENTADO: "Aposentado", PILOTO: "Piloto" }
export const DENIED_REASON_LABELS: Record<string, string> = { NO_STRUCTURE: "não lidera uma estrutura", ACCESS_DENIED: "sem acesso à estrutura do report", INACTIVE: "conta ou cadastro inativo" }
export const BLOCKED_REASON_LABELS: Record<string, string> = { OWNER_INACTIVE: "A conta ou o cadastro do responsável não está mais ativo.", DISTRIBUTION_REVOKED: "O responsável não tem mais o papel Report.", STRUCTURE_OUT_OF_SCOPE: "A estrutura do report saiu do escopo do responsável.", REPORT_INACTIVE: "O report estava desativado.", REPORT_DELETED: "O report foi excluído.", NO_RECIPIENTS: "Nenhum destinatário elegível.", TECHNICAL_FAILURE: "Falha técnica depois das tentativas." }
