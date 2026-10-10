import type { DiagramNode } from "./workflow-diagram"

/**
 * Catálogo oficial da camada de IA da INIA — Bases de Conhecimento auditadas, Agents
 * especialistas por domínio, Orquestradores por domínio e os 20 modelos práticos de Workflow.
 *
 * Fonte única para a Wiki (`/wiki/agents`, `/wiki/orchestrators`, `/wiki/bases-conhecimento` e `/wiki/casos-praticos/workflows`)
 * e checklist do que foi configurado pela UI administrativa real. Tudo aqui descreve o que
 * existe de fato no produto (nomes, bases, contratos) — nunca um exemplo hipotético.
 */

// ---------------------------------------------------------------------------------------------
// Bases de Conhecimento (auditoria de 2026-09-15)
// ---------------------------------------------------------------------------------------------

export type KnowledgeDomain = "FATURAMENTO" | "RETENCAO" | "SUPORTE_TECNICO" | "CADASTRO" | "EXPERIENCIA" | "RH" | "TESTE"

export const KNOWLEDGE_DOMAIN_LABELS: Record<KnowledgeDomain, string> = {
  FATURAMENTO: "Faturamento",
  RETENCAO: "Retenção e Cancelamento",
  SUPORTE_TECNICO: "Suporte Técnico",
  CADASTRO: "Cadastro e Titularidade",
  EXPERIENCIA: "Qualidade e Experiência do Cliente",
  RH: "Recursos Humanos (política interna)",
  TESTE: "Artefato de teste",
}

export type AuditedKnowledgeBase = {
  title: string
  domain: KnowledgeDomain
  documentType: "PROCEDURE" | "MANUAL" | "FAQ"
  /** Tamanho aproximado do texto publicado (caracteres). */
  approxChars: number
  purpose: string
  /** Operacional = descreve um processo/conduta de atendimento que uma chamada pode ser comparada contra. */
  operational: boolean
  status: "PUBLISHED" | "DRAFT"
}

export const AUDITED_KNOWLEDGE_BASES: AuditedKnowledgeBase[] = [
  { title: "Procedimento Operacional — Contestação de Contas Móvel", domain: "FATURAMENTO", documentType: "PROCEDURE", approxChars: 32_000, purpose: "Análise, registro e acompanhamento de contestações de cobrança em contas móveis (titular, composição da conta, correção, prazos, protocolo).", operational: true, status: "PUBLISHED" },
  { title: "Procedimento Operacional Segunda Via de Conta", domain: "FATURAMENTO", documentType: "PROCEDURE", approxChars: 6_800, purpose: "Emissão e envio de segunda via de fatura pelos canais disponíveis.", operational: true, status: "PUBLISHED" },
  { title: "Procedimento Operacional Negociação de Débito", domain: "FATURAMENTO", documentType: "PROCEDURE", approxChars: 9_000, purpose: "Negociação e parcelamento de débitos em atraso: condições, entrada, parcelas, registro.", operational: true, status: "PUBLISHED" },
  { title: "Procedimento Operacional — Cancelamento de Produtos e Serviços", domain: "RETENCAO", documentType: "PROCEDURE", approxChars: 28_000, purpose: "Fluxo de cancelamento: identificação do motivo, oferta de retenção, formalização e prazos.", operational: true, status: "PUBLISHED" },
  { title: "Procedimento Operacional — Reparo de Banda Larga", domain: "SUPORTE_TECNICO", documentType: "PROCEDURE", approxChars: 37_600, purpose: "Diagnóstico remoto, testes guiados, abertura de reparo e prazos para banda larga.", operational: true, status: "PUBLISHED" },
  { title: "Troca de CHIP - AG", domain: "SUPORTE_TECNICO", documentType: "PROCEDURE", approxChars: 32_000, purpose: "Troca de chip (perda, defeito, upgrade): validações, ativação e orientações ao cliente.", operational: true, status: "PUBLISHED" },
  { title: "Procedimento Operacional — Alteração de Dados Cadastrais de Gestor", domain: "CADASTRO", documentType: "PROCEDURE", approxChars: 32_600, purpose: "Alteração de dados do gestor da conta corporativa: validações, documentos e registro.", operational: true, status: "PUBLISHED" },
  { title: "Procedimento Operacional — Troca de Titularidade entre Empresas", domain: "CADASTRO", documentType: "PROCEDURE", approxChars: 37_300, purpose: "Transferência de titularidade entre pessoas jurídicas: requisitos, documentação e etapas.", operational: true, status: "PUBLISHED" },
  { title: "Procedimento Operacional Jeito Vivo de Atender", domain: "EXPERIENCIA", documentType: "MANUAL", approxChars: 20_300, purpose: "Padrão de conduta e experiência no atendimento (abertura, escuta, empatia, encerramento).", operational: true, status: "PUBLISHED" },
  { title: "Checklist de Encerramento de Chamada", domain: "EXPERIENCIA", documentType: "PROCEDURE", approxChars: 200, purpose: "Itens obrigatórios ao encerrar uma chamada.", operational: true, status: "PUBLISHED" },
  { title: "POLÍTICA DE JORNADA HORAS EXTRAS FALTAS E BANCO DE HORAS", domain: "RH", documentType: "MANUAL", approxChars: 28_800, purpose: "Regras de jornada, horas extras, faltas e banco de horas — usada SOMENTE como regra operacional de disponibilidade, nunca para inferir motivo pessoal.", operational: false, status: "PUBLISHED" },
  { title: "POLÍTICA DE FÉRIAS", domain: "RH", documentType: "MANUAL", approxChars: 26_900, purpose: "Política de férias — tema de RH, fora da análise de chamadas/indicadores.", operational: false, status: "PUBLISHED" },
  { title: "Cargos Carreiras Remuneração e Promoções", domain: "RH", documentType: "MANUAL", approxChars: 39_600, purpose: "Plano de cargos e carreiras — tema de RH.", operational: false, status: "PUBLISHED" },
  { title: "FAQ AUXÍLIO CRECHE E AUXÍLIO BABÁ", domain: "RH", documentType: "FAQ", approxChars: 21_800, purpose: "Benefícios — tema de RH.", operational: false, status: "PUBLISHED" },
  { title: "FAQ MODELOS DE TRABALHO PRESENCIAL E TELETRABALHO", domain: "RH", documentType: "FAQ", approxChars: 28_500, purpose: "Modelos de trabalho — tema de RH.", operational: false, status: "PUBLISHED" },
  { title: "Teste de leitura em PDF", domain: "TESTE", documentType: "MANUAL", approxChars: 3_300, purpose: "Artefato de teste de extração de PDF — não é base operacional.", operational: false, status: "DRAFT" },
]

// ---------------------------------------------------------------------------------------------
// Agents especialistas
// ---------------------------------------------------------------------------------------------

export type SpecialistAgent = {
  id: string
  name: string
  agentType: "CUSTOM" | "CALL_FEEDBACK" | "INDICATOR_FEEDBACK" | "DIAGNOSTICS"
  domain: string
  objective: string
  whenToUse: string[]
  whenNotToUse: string[]
  /** Títulos exatos das bases autorizadas — vazio = agente sem KB (analisa só dados). */
  knowledgeBases: string[]
  expectedOutput: string
  limitations: string[]
}

export const SPECIALIST_AGENTS: SpecialistAgent[] = [
  {
    id: "faturamento",
    name: "Especialista de Faturamento",
    agentType: "CUSTOM",
    domain: "Faturamento — contestação, segunda via, negociação de débito",
    objective: "Comparar o que aconteceu numa chamada de faturamento com o procedimento oficial, com evidência literal, e orientar o operador.",
    whenToUse: ["Rechamada ou detrator em chamada do grupo FATURAS", "Auditoria de conformidade de contestação/segunda via/negociação", "Quando o Workflow já sabe que o tema é fatura"],
    whenNotToUse: ["Chamada de suporte técnico ou cancelamento (use o especialista do domínio)", "Análise só de indicadores sem chamada (use Performance/PRV)"],
    knowledgeBases: ["Procedimento Operacional — Contestação de Contas Móvel", "Procedimento Operacional Segunda Via de Conta", "Procedimento Operacional Negociação de Débito"],
    expectedOutput: "Feedback de monitoria (evidência literal + procedimento + recomendação) ou análise de conformidade etapa a etapa.",
    limitations: ["Só cita regra que esteja literalmente no trecho recuperado", "Etapa sem citação literal vira \"Não foi possível confirmar\""],
  },
  {
    id: "retencao",
    name: "Especialista de Retenção e Cancelamento",
    agentType: "CUSTOM",
    domain: "Retenção — pedidos de cancelamento e ofertas de retenção",
    objective: "Verificar se o fluxo oficial de cancelamento/retenção foi seguido e apontar oportunidades de retenção com evidência.",
    whenToUse: ["Chamada com pedido de cancelamento", "Auditoria do procedimento de cancelamento", "Rechamada no grupo RETENÇÃO/FIDELIZAÇÃO"],
    whenNotToUse: ["Contestação de fatura sem menção a cancelamento", "Análise consolidada de equipe (use Orquestrador Gerencial)"],
    knowledgeBases: ["Procedimento Operacional — Cancelamento de Produtos e Serviços"],
    expectedOutput: "Feedback de monitoria ou análise de conformidade das etapas de cancelamento/retenção.",
    limitations: ["Nunca afirma que o cliente cancelou/ficou sem evidência na transcrição"],
  },
  {
    id: "suporte",
    name: "Especialista de Suporte Técnico",
    agentType: "CUSTOM",
    domain: "Suporte técnico — reparo de banda larga e troca de chip",
    objective: "Validar diagnóstico remoto, testes guiados e abertura de reparo/troca conforme o procedimento oficial.",
    whenToUse: ["Rechamada ou detrator no grupo SUPORTE TÉCNICO", "Auditoria de conformidade de reparo/troca de chip"],
    whenNotToUse: ["Temas de fatura ou cadastro", "Chamadas sem transcrição"],
    knowledgeBases: ["Procedimento Operacional — Reparo de Banda Larga", "Troca de CHIP - AG"],
    expectedOutput: "Feedback de monitoria ou análise de conformidade etapa a etapa.",
    limitations: ["Não diagnostica a falha técnica em si — avalia se o operador seguiu o processo"],
  },
  {
    id: "cadastro",
    name: "Especialista de Cadastro e Titularidade",
    agentType: "CUSTOM",
    domain: "Cadastro corporativo — dados do gestor e troca de titularidade",
    objective: "Verificar validações, documentação e etapas exigidas em alterações cadastrais e trocas de titularidade.",
    whenToUse: ["Chamada corporativa sobre gestor da conta ou titularidade", "Auditoria de conformidade cadastral"],
    whenNotToUse: ["Temas de consumo/fatura (use Faturamento)"],
    knowledgeBases: ["Procedimento Operacional — Alteração de Dados Cadastrais de Gestor", "Procedimento Operacional — Troca de Titularidade entre Empresas"],
    expectedOutput: "Feedback de monitoria ou análise de conformidade etapa a etapa.",
    limitations: ["Não valida documentos em si — só se o operador solicitou/registrou conforme o procedimento"],
  },
  {
    id: "qualidade",
    name: "Especialista de Qualidade de Atendimento",
    agentType: "CALL_FEEDBACK",
    domain: "Qualidade/monitoria — critérios de conduta e condução da chamada",
    objective: "Avaliar a chamada contra o padrão de conduta e o checklist de encerramento, produzindo feedback de monitoria com evidência.",
    whenToUse: ["Piores em Qualidade por grupo", "TMA bom + qualidade ruim", "Monitoria periódica por amostra"],
    whenNotToUse: ["Conformidade de processo específico (use o especialista do domínio)", "Reconhecimento (use Reconhecimento)"],
    knowledgeBases: ["Procedimento Operacional Jeito Vivo de Atender", "Checklist de Encerramento de Chamada"],
    expectedOutput: "Feedback de monitoria: indicador impactado, evidência literal, comportamento observado, procedimento e recomendação.",
    limitations: ["Não atribui nota de monitoria — a nota oficial vem persistida do sistema de qualidade"],
  },
  {
    id: "experiencia",
    name: "Especialista de Experiência do Cliente",
    agentType: "CUSTOM",
    domain: "Experiência — fricções percebidas pelo cliente, rechamada, detrator",
    objective: "Identificar, com evidência, o que na condução da chamada pode ter gerado necessidade de novo contato ou avaliação baixa — sem afirmar causalidade sem evidência.",
    whenToUse: ["Rechamada recorrente", "Detrator de URA", "Quando o domínio do processo não é conhecido"],
    whenNotToUse: ["Quando o domínio já é conhecido e há KB de processo (use o especialista do domínio)"],
    knowledgeBases: ["Procedimento Operacional Jeito Vivo de Atender", "Checklist de Encerramento de Chamada"],
    expectedOutput: "Feedback de monitoria focado em experiência (hipóteses separadas de fatos).",
    limitations: ["Nunca atribui emoção ao cliente sem evidência literal"],
  },
  {
    id: "performance",
    name: "Especialista de Performance Individual",
    agentType: "DIAGNOSTICS",
    domain: "Performance — indicadores, atingimento, quartil, tendência",
    objective: "Explicar, com os números oficiais fornecidos, a situação de performance do colaborador (recorrência em Q4, quedas, prioridades) e recomendar acompanhamento.",
    whenToUse: ["Q4 recorrente", "Maiores quedas por subgrupo", "Maior queda entre críticos", "Resumo mensal/plano de ação (etapa individual)"],
    whenNotToUse: ["Análise de chamada/transcrição", "Quando o foco é exclusivamente PRV (use PRV)"],
    knowledgeBases: [],
    expectedOutput: "Feedback de indicador: resumo do período, indicadores fora/dentro da meta, ações prioritárias.",
    limitations: ["Usa SOMENTE os números do contexto — nunca calcula, arredonda ou inventa", "Sem dados ≠ baixa performance"],
  },
  {
    id: "eficiencia",
    name: "Especialista de Eficiência Operacional",
    agentType: "CUSTOM",
    domain: "Eficiência — TMA, TMT, tempo de silêncio, produtividade",
    objective: "Separar fato de hipótese sobre TMA fora do esperado e sugerir coaching de eficiência sem sacrificar qualidade.",
    whenToUse: ["TMA fora do esperado (Modelo 07)", "TMA do dia acima da meta (Modelo 13, sem IA — só o aviso)"],
    whenNotToUse: ["Quando a qualidade é o problema (use Qualidade)"],
    knowledgeBases: [],
    expectedOutput: "Feedback de indicador com fatos (números oficiais) e hipóteses claramente marcadas.",
    limitations: ["Nunca afirma \"atendeu rápido/devagar demais\" como causa sem evidência"],
  },
  {
    id: "prv",
    name: "Especialista de PRV",
    agentType: "INDICATOR_FEEDBACK",
    domain: "PRV — atingimento oficial e composição por peso",
    objective: "Explicar o PRV oficial persistido e sua composição (weight_percent) e orientar o que mais pesa para recuperar o atingimento.",
    whenToUse: ["PRV baixo recorrente", "Qualidade + PRV"],
    whenNotToUse: ["Recalcular PRV (nunca — o valor é sempre o persistido)"],
    knowledgeBases: [],
    expectedOutput: "Feedback de indicador sobre PRV com prioridades por peso.",
    limitations: ["Nunca recalcula PRV; só explica o valor oficial"],
  },
  {
    id: "reconhecimento",
    name: "Especialista de Reconhecimento",
    agentType: "CUSTOM",
    domain: "Reconhecimento — melhores resultados e maiores evoluções",
    objective: "Produzir reconhecimento específico e verificável (números oficiais) para os melhores e para quem mais evoluiu.",
    whenToUse: ["Reconhecimento dos melhores por subgrupo", "Maiores evoluções"],
    whenNotToUse: ["Diagnóstico de problema (use Performance)"],
    knowledgeBases: [],
    expectedOutput: "Texto de reconhecimento individual + resumo para o gestor (via Consolidar resultados).",
    limitations: ["Elogio sempre ancorado em número fornecido, nunca genérico"],
  },
  {
    id: "disponibilidade",
    name: "Especialista de Disponibilidade Operacional",
    agentType: "INDICATOR_FEEDBACK",
    domain: "Disponibilidade — aderência à escala e tempo disponível",
    objective: "Analisar aderência/tempo disponível contra a regra operacional de jornada, sem inferir motivo pessoal ou saúde.",
    whenToUse: ["Disponibilidade/ABS fora do esperado"],
    whenNotToUse: ["Qualquer inferência sobre saúde, doença ou motivo pessoal (proibido)"],
    knowledgeBases: ["POLÍTICA DE JORNADA HORAS EXTRAS FALTAS E BANCO DE HORAS"],
    expectedOutput: "Feedback de indicador restrito à regra operacional (o que a política prevê) e ao número oficial.",
    limitations: ["A KB de jornada entra só para regra operacional — nunca para justificar ausências"],
  },
  {
    id: "sintese-gerencial",
    name: "Especialista de Síntese Gerencial",
    agentType: "CUSTOM",
    domain: "Síntese — resultados consolidados de N colaboradores (pós “Consolidar resultados”)",
    objective: "Sintetizar N análises individuais já concluídas num resumo executivo para a gestão: padrões, riscos, pontos fortes, tendências e próximos passos de acompanhamento — nunca decisão disciplinar.",
    whenToUse: ["Depois de “Consolidar resultados”, quando a gestão precisa de uma visão única dos resultados individuais (resumo mensal, plano consolidado, destaques do mês)"],
    whenNotToUse: ["Antes de “Consolidar resultados” (não há o que sintetizar)", "Como especialista de um Orquestrador (não roteia nem analisa colaboradores um a um)"],
    knowledgeBases: [],
    expectedOutput: "Contrato estruturado (título, resumo, padrões, riscos, pontos fortes, tendências, ações, colaboradores sem análise) em UMA request — só sobre os resultados fornecidos; nunca recalcula indicador ou PRV.",
    limitations: ["Colaborador que falhou ou está sem dados é listado como “sem análise”, nunca como baixa performance"],
  },
]

// ---------------------------------------------------------------------------------------------
// Orquestradores por domínio
// ---------------------------------------------------------------------------------------------

export type OrchestratorKind = "DOMAIN" | "TRANSVERSAL" | "MULTIDOMAIN" | "MANAGERIAL"

/** Rótulo do catálogo (evolução 2026-09-16): a política é "Como escolhe especialistas?" — domínios
 * específicos (1..N) ou qualquer assunto autorizado. Os antigos "de domínio"/"multidomínio" são a mesma
 * resposta com 1 ou vários domínios; "transversal" e "gerencial" são legado (sem uso nos modelos). */
export const ORCHESTRATOR_KIND_LABELS: Record<OrchestratorKind, string> = {
  DOMAIN: "Domínios específicos (1 domínio)",
  TRANSVERSAL: "Legado — transversal (desativado)",
  MULTIDOMAIN: "Domínios específicos (vários domínios)",
  MANAGERIAL: "Legado — gerencial pós-Join (substituído pelo Agent de síntese)",
}

export type DomainOrchestrator = {
  id: string
  name: string
  domain: KnowledgeDomain | "GERENCIAL" | "MULTIDOMINIO"
  /** Fronteira do orquestrador (rodada de hardening 2026-09-16): de DOMÍNIO coordena só o
   * especialista do próprio domínio + transversais; MULTIDOMÍNIO é o único que cruza domínios de
   * processo; GERENCIAL não tem especialista. O teste de catálogo do backend cobra isso no banco. */
  kind: OrchestratorKind
  /** Bases que este orquestrador representa (as dos seus especialistas de domínio). */
  knowledgeBases: string[]
  objective: string
  /** Lista autorizada (persistida e aplicada pelo backend): especialistas do(s) domínio(s) + os
   * transversais EXPLICITAMENTE autorizados abaixo — nunca "qualquer agente que alguém adicionou". */
  specialists: string[]
  /** Transversais (condução: Experiência, Qualidade, Eficiência) explicitamente autorizados. */
  crossCuttingAllowed: string[]
  whenToUse: string[]
  callAgentDirectlyWhen: string[]
  currentLimit: string
  invocationMode: "WORKFLOW" | "BOTH"
  /** Desativado na fase 6 da evolução (sem Workflow referenciando) — continua no catálogo como modelo pronto, reativável sem reclassificar. */
  active: boolean
}

export const DOMAIN_ORCHESTRATORS: DomainOrchestrator[] = [
  {
    id: "orq-multidominio",
    name: "Orquestrador · Atendimento multidomínio",
    domain: "MULTIDOMINIO",
    kind: "MULTIDOMAIN",
    knowledgeBases: [],
    objective: "Coordenar especialistas de DIFERENTES domínios quando uma mesma interação mistura assuntos (ex.: contestação de cobrança + ameaça de cancelamento): identifica os domínios presentes, aciona só os especialistas desses domínios e sintetiza uma conclusão única.",
    specialists: ["Especialista de Faturamento", "Especialista de Retenção e Cancelamento", "Especialista de Suporte Técnico", "Especialista de Cadastro e Titularidade", "Especialista de Experiência do Cliente"],
    crossCuttingAllowed: ["Especialista de Experiência do Cliente"],
    whenToUse: ["Interação que pode envolver mais de um domínio de processo — Modelo 08 (flag contestação): no QA real acionou só Faturamento + Retenção"],
    callAgentDirectlyWhen: ["Quando o domínio já é conhecido (Abrangência de Grupo, flag específica) → Agent do domínio direto; quando a análise é de um domínio só com mais de um aspecto → Orquestrador daquele domínio"],
    currentLimit: "Não tem base própria (quem consulta KB são os especialistas). É o único orquestrador autorizado a cruzar domínios de processo.",
    invocationMode: "WORKFLOW",
    active: true,
  },
  {
    id: "orq-faturamento",
    name: "Orquestrador · Faturamento",
    domain: "FATURAMENTO",
    kind: "DOMAIN",
    knowledgeBases: ["Procedimento Operacional — Contestação de Contas Móvel", "Procedimento Operacional Segunda Via de Conta", "Procedimento Operacional Negociação de Débito"],
    objective: "Coordenar análises DENTRO do domínio Faturamento (contestação, segunda via, negociação de débito) com mais de um aspecto, combinando o especialista do domínio com a perspectiva de experiência do cliente e sintetizando uma conclusão única.",
    specialists: ["Especialista de Faturamento", "Especialista de Experiência do Cliente"],
    crossCuttingAllowed: ["Especialista de Experiência do Cliente"],
    whenToUse: ["Chamada de fatura com mais de um aspecto do MESMO domínio", "Síntese de padrões entre várias análises de faturamento pós-JOIN (estrutura de um Grupo de faturamento)"],
    callAgentDirectlyWhen: ["Auditoria de conformidade do procedimento de faturamento (Modelo 18a) → Especialista de Faturamento direto, contrato Conformidade de processo"],
    currentLimit: "Aspectos de outro domínio (ex.: cancelamento) são registrados como 'fora do domínio' — quem cruza domínios é o Orquestrador multidomínio. Pós-JOIN roda sem especialistas (só síntese).",
    invocationMode: "WORKFLOW",
    active: false,
  },
  {
    id: "orq-retencao",
    name: "Orquestrador · Retenção e Cancelamento",
    domain: "RETENCAO",
    kind: "DOMAIN",
    knowledgeBases: ["Procedimento Operacional — Cancelamento de Produtos e Serviços"],
    objective: "Coordenar análises DENTRO do domínio Retenção e Cancelamento (pedido de cancelamento, oferta, fidelidade) e sintetizar padrões de retenção de um Grupo.",
    specialists: ["Especialista de Retenção e Cancelamento", "Especialista de Experiência do Cliente"],
    crossCuttingAllowed: ["Especialista de Experiência do Cliente"],
    whenToUse: ["Cancelamento com mais de um aspecto do MESMO domínio", "Síntese de padrões de retenção pós-JOIN — Modelo 17 (Grupo de Retenção)"],
    callAgentDirectlyWhen: ["Auditoria pura do procedimento de cancelamento (Modelo 18b) → Especialista de Retenção direto"],
    currentLimit: "Motivo de fatura ou técnico no cancelamento é 'fora do domínio' aqui — use o Orquestrador multidomínio.",
    invocationMode: "WORKFLOW",
    active: false,
  },
  {
    id: "orq-suporte",
    name: "Orquestrador · Suporte Técnico",
    domain: "SUPORTE_TECNICO",
    kind: "DOMAIN",
    knowledgeBases: ["Procedimento Operacional — Reparo de Banda Larga", "Troca de CHIP - AG"],
    objective: "Coordenar análises DENTRO do domínio Suporte Técnico (reparo, troca de chip) com a perspectiva de experiência do cliente.",
    specialists: ["Especialista de Suporte Técnico", "Especialista de Experiência do Cliente"],
    crossCuttingAllowed: ["Especialista de Experiência do Cliente"],
    whenToUse: ["Reparo recorrente com mais de um aspecto técnico", "Síntese de padrões técnicos por equipe pós-JOIN"],
    callAgentDirectlyWhen: ["Auditoria de reparo/troca de chip (Modelo 18c) → Especialista de Suporte Técnico direto"],
    currentLimit: "Ameaça de cancelamento numa chamada técnica é 'fora do domínio' — use o Orquestrador multidomínio.",
    invocationMode: "WORKFLOW",
    active: false,
  },
  {
    id: "orq-cadastro",
    name: "Orquestrador · Cadastro e Titularidade",
    domain: "CADASTRO",
    kind: "DOMAIN",
    knowledgeBases: ["Procedimento Operacional — Alteração de Dados Cadastrais de Gestor", "Procedimento Operacional — Troca de Titularidade entre Empresas"],
    objective: "Coordenar análises DENTRO do domínio Cadastro e Titularidade com a perspectiva de experiência do cliente.",
    specialists: ["Especialista de Cadastro e Titularidade", "Especialista de Experiência do Cliente"],
    crossCuttingAllowed: ["Especialista de Experiência do Cliente"],
    whenToUse: ["Troca de titularidade com mais de um aspecto cadastral"],
    callAgentDirectlyWhen: ["Auditoria cadastral simples → Especialista de Cadastro direto"],
    currentLimit: "Disputa de cobrança junto da titularidade é 'fora do domínio' — use o Orquestrador multidomínio.",
    invocationMode: "WORKFLOW",
    active: false,
  },
  {
    id: "orq-qualidade",
    name: "Orquestrador · Qualidade e Experiência",
    domain: "EXPERIENCIA",
    kind: "TRANSVERSAL",
    knowledgeBases: ["Procedimento Operacional Jeito Vivo de Atender", "Checklist de Encerramento de Chamada"],
    objective: "Combinar qualidade de conduta, experiência do cliente e eficiência quando a chamada tem mais de uma dimensão de CONDUÇÃO (transversal a qualquer assunto).",
    specialists: ["Especialista de Qualidade de Atendimento", "Especialista de Experiência do Cliente", "Especialista de Eficiência Operacional"],
    crossCuttingAllowed: ["Especialista de Qualidade de Atendimento", "Especialista de Experiência do Cliente", "Especialista de Eficiência Operacional"],
    whenToUse: ["Casos multidimensionais de condução (qualidade × eficiência × experiência)"],
    callAgentDirectlyWhen: ["Monitoria simples → Especialista de Qualidade direto"],
    currentLimit: "Só especialistas transversais — não analisa procedimento de nenhum domínio de processo.",
    invocationMode: "WORKFLOW",
    active: false,
  },
  {
    id: "orq-gerencial",
    name: "Orquestrador · Gerencial (consolidado)",
    domain: "GERENCIAL",
    kind: "MANAGERIAL",
    knowledgeBases: [],
    objective: "Sintetizar N análises individuais (pós-Consolidar resultados) num resumo executivo para o gestor: prioridades, padrões e próximos passos — sem decidir nada disciplinar.",
    specialists: [],
    crossCuttingAllowed: [],
    whenToUse: ["Legado: os Modelos 04, 05, 11, 14, 16, 17 e 20 passaram a usar o Especialista de Síntese Gerencial (um Agent) depois de Consolidar resultados — mesma missão, mesmo contexto, uma request, contrato estruturado"],
    callAgentDirectlyWhen: ["Sempre: síntese pós-Join é Chamar agente com um Agent de síntese; se bastar entregar a lista consolidada (sem síntese), Output direto do Join — zero IA (Modelo 15)"],
    currentLimit: "Continua ativo só por compatibilidade com Workflows de QA que ainda o referenciam; não coordena especialistas.",
    invocationMode: "WORKFLOW",
    active: true,
  },
]

// ---------------------------------------------------------------------------------------------
// 20 modelos práticos de Workflow
// ---------------------------------------------------------------------------------------------

/** Beneficiário principal — DERIVADO do grafo real (mesma regra de `classifyBeneficiary` no
 * backend, official-model-workflows.ts): Output ao próprio operador só em contexto individual,
 * Revisão humana = Supervisor, Output de gestão pós-Join = liderança, os dois = multinível. */
export type WorkflowBeneficiary = "OPERADOR" | "SUPERVISOR" | "LIDERANCA" | "MULTINIVEL"

export const WORKFLOW_BENEFICIARY_LABELS: Record<WorkflowBeneficiary, string> = {
  OPERADOR: "Operador",
  SUPERVISOR: "Supervisor",
  LIDERANCA: "Liderança",
  MULTINIVEL: "Multinível (operador + gestão)",
}

/** "Quem recebe o quê" — uma linha por entrega real do grafo (Output, Revisão humana, Escalonar). */
export type WorkflowDelivery = { recipient: string; what: string; surface: string }

export type WorkflowTemplate = {
  number: number
  id: string
  name: string
  beneficiary: WorkflowBeneficiary
  /** O problema real de Call Center que o modelo resolve — a pergunta "por que este modelo existe?". */
  problem: string
  deliveries: WorkflowDelivery[]
  usesAi: boolean
  /** Genérico (Todos os grupos / estrutura da sua operação), B2B/B2C ou específico de um domínio — com o pré-requisito de configuração, nunca um id. */
  structure: string
  objective: string
  trigger: string
  subject: string
  population: string
  nodes: string[]
  condition: string
  ranking: string
  agent: string
  orchestrator: string
  knowledgeBase: string
  humanReview: string
  output: string
  surface: string
  requiredData: string
  expectedBehavior: string
  limitations: string
  usesKnowledgeBase: boolean
  isConformanceCase: boolean
  diagram: DiagramNode[]
}

const END: DiagramNode = { label: "Fim", kind: "end" }

export const WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
  {
    number: 1, id: "wf01", name: "Modelo · 01 · Rechamada recorrente",
    beneficiary: "OPERADOR",
    problem: "Cliente que precisa ligar de novo custa caro e sinaliza atendimento incompleto — o operador precisa saber, com o trecho exato, o que ficou faltando.",
    objective: "Identificar, com evidência literal, se algum passo da condução pode ter contribuído para o cliente precisar ligar de novo — sem afirmar causalidade sem evidência.",
    trigger: "Flag de canal: rechamada", subject: "Colaborador da chamada (Individual)", population: "Todos os grupos",
    structure: "Genérico — Todos os grupos, avaliação individual. Funciona em qualquer operação sem configuração adicional.",
    nodes: ["Gatilho", "Condição", "Chamar agente", "Fim", "Revisão Humana", "Output", "Escalonar"],
    condition: "Valor da flag = True", ranking: "—",
    agent: "Especialista de Experiência do Cliente", orchestrator: "—",
    knowledgeBase: "Jeito Vivo de Atender + Checklist de Encerramento (retrieval por transcrição)", humanReview: "Supervisor do operador — aprovado publica; reprovado não publica; escalar → Gerente",
    output: "Feedback ao operador → O próprio operador", surface: "Acompanhamento",
    deliveries: [{ recipient: "Supervisor", what: "Revisão humana: Revisão do supervisor (aprovar / reprovar / escalar)", surface: "Pendências" }, { recipient: "Operador", what: "Feedback ao operador", surface: "Acompanhamento" }, { recipient: "Gerente", what: "Escalonamento com o conteúdo analisado (quando o Supervisor escolhe “Escalar”)", surface: "Acompanhamento" }],
    requiredData: "Interação com transcrição e flag rechamada calculada na ingestão.",
    expectedBehavior: "Feedback com trecho literal da transcrição, procedimento citado pelo título exato e recomendação; supervisor aprova antes de publicar.",
    limitations: "Domínio do processo não é conhecido pela flag — quando é (por Abrangência de grupo), prefira o Modelo 18 com o especialista do domínio.",
    usesKnowledgeBase: true, isConformanceCase: false, usesAi: true,
    diagram: [{ label: "Gatilho", kind: "trigger" }, { label: "Rechamada confirmada?", kind: "condition", branches: [{ label: "sim → Especialista de Experiência do Cliente", tone: "positive" }, { label: "não → Fim", tone: "neutral" }] }, { label: "Especialista de Experiência do Cliente", kind: "action" }, { label: "Revisão Humana — Supervisor", kind: "human_review", branches: [{ label: "aprovado → Feedback ao operador", tone: "positive" }, { label: "reprovado → Fim", tone: "negative" }, { label: "escalar → Escalonar ao Gerente", tone: "neutral" }] }, { label: "Feedback ao operador → O próprio operador · Acompanhamento", kind: "output" }, { label: "Escalonar ao Gerente (encerra)", kind: "action" }, END],
  },
  {
    number: 2, id: "wf02", name: "Modelo · 02 · Detrator de URA",
    beneficiary: "OPERADOR",
    problem: "Nota baixa na URA é a voz direta do cliente; sem feedback rápido o padrão se repete. Nota 1 é grave demais para publicar sem o supervisor ler antes.",
    objective: "Comparar a experiência relatada na transcrição com o padrão de atendimento quando a nota da URA é baixa; nota crítica passa por revisão humana.",
    trigger: "Flag de canal: nota_ura", subject: "Colaborador da chamada (Individual)", population: "Todos os grupos",
    structure: "Genérico — Todos os grupos, avaliação individual. Funciona em qualquer operação sem configuração adicional.",
    nodes: ["Gatilho", "Condição", "Chamar agente", "Fim", "Condição", "Revisão Humana", "Output", "Escalonar"],
    condition: "Valor da flag ≤ 2 · Valor da flag ≤ 1", ranking: "—",
    agent: "Especialista de Experiência do Cliente", orchestrator: "—",
    knowledgeBase: "Jeito Vivo de Atender + Checklist (retrieval)", humanReview: "Supervisor do operador — aprovado publica; reprovado não publica; escalar → Gerente",
    output: "Feedback ao operador → O próprio operador", surface: "Acompanhamento",
    deliveries: [{ recipient: "Supervisor", what: "Revisão humana: Revisão do supervisor (crítico) (aprovar / reprovar / escalar)", surface: "Pendências" }, { recipient: "Operador", what: "Feedback ao operador", surface: "Acompanhamento" }, { recipient: "Gerente", what: "Escalonamento com o conteúdo analisado (quando o Supervisor escolhe “Escalar”)", surface: "Acompanhamento" }],
    requiredData: "Flag numérica nota_ura na interação + transcrição.",
    expectedBehavior: "Nota 2 → feedback direto; nota 1 → supervisor revisa antes.",
    limitations: "A nota é da URA (cliente); a análise não recalcula nem contesta a nota.",
    usesKnowledgeBase: true, isConformanceCase: false, usesAi: true,
    diagram: [{ label: "Gatilho", kind: "trigger" }, { label: "Nota da URA ≤ 2?", kind: "condition", branches: [{ label: "sim → Especialista de Experiência do Cliente", tone: "positive" }, { label: "não → Fim", tone: "neutral" }] }, { label: "Especialista de Experiência do Cliente", kind: "action" }, { label: "Nota crítica (≤ 1)?", kind: "condition", branches: [{ label: "sim → Revisão do supervisor (crítico)", tone: "positive" }, { label: "não → Feedback ao operador", tone: "neutral" }] }, { label: "Revisão Humana — Supervisor", kind: "human_review", branches: [{ label: "aprovado → Feedback ao operador", tone: "positive" }, { label: "reprovado → Fim", tone: "negative" }, { label: "escalar → Escalonar ao Gerente", tone: "neutral" }] }, { label: "Feedback ao operador → O próprio operador · Acompanhamento", kind: "output" }, { label: "Escalonar ao Gerente (encerra)", kind: "action" }, END],
  },
  {
    number: 3, id: "wf03", name: "Modelo · 03 · Q4 recorrente",
    beneficiary: "OPERADOR",
    problem: "Quem fica no Q4 de PRV por três fechamentos seguidos precisa de um plano, não de mais um alerta — e o supervisor precisa validar o diagnóstico antes de o operador receber.",
    objective: "Detectar colaborador em Q4 de PRV em 3 dos últimos 3 fechamentos e gerar diagnóstico individual com revisão do supervisor.",
    trigger: "Agenda mensal (dia 5, 09:00)", subject: "Cada colaborador da Abrangência (Individual)", population: "Todos os grupos",
    structure: "Genérico — Todos os grupos, avaliação individual. Funciona em qualquer operação sem configuração adicional.",
    nodes: ["Gatilho", "Condição", "Chamar agente", "Fim", "Revisão Humana", "Output", "Escalonar"],
    condition: "Q4 em 3 dos últimos 3 fechamentos? — Quartil de PRV = Q4 em ≥ 3 dos últimos 3 fechamentos", ranking: "—",
    agent: "Especialista de Performance Individual — fechamentos oficiais PRV + indicadores (3 fechamentos)", orchestrator: "—",
    knowledgeBase: "Nenhuma (só indicadores oficiais)", humanReview: "Supervisor do operador — aprovado publica; reprovado não publica; escalar → Gerente",
    output: "Feedback ao operador → O próprio operador", surface: "Acompanhamento",
    deliveries: [{ recipient: "Supervisor", what: "Revisão humana: Revisão do supervisor (aprovar / reprovar / escalar)", surface: "Pendências" }, { recipient: "Operador", what: "Feedback ao operador", surface: "Acompanhamento" }, { recipient: "Gerente", what: "Escalonamento com o conteúdo analisado (quando o Supervisor escolhe “Escalar”)", surface: "Acompanhamento" }],
    requiredData: "employee_prv_performance com quartil por competência (≥ 3 fechamentos).",
    expectedBehavior: "Só quem tem 3 fechamentos em Q4 entra; SEM DADOS encerra sem julgar.",
    limitations: "Quartil sempre vem persistido — nunca inferido do valor.",
    usesKnowledgeBase: false, isConformanceCase: false, usesAi: true,
    diagram: [{ label: "Agenda mensal", kind: "trigger" }, { label: "Q4 em 3 dos últimos 3 fechamentos?", kind: "condition", branches: [{ label: "sim → Especialista de Performance Individual", tone: "positive" }, { label: "não → Fim", tone: "neutral" }, { label: "sem dados → Fim", tone: "neutral" }] }, { label: "Especialista de Performance Individual", kind: "action" }, { label: "Revisão Humana — Supervisor", kind: "human_review", branches: [{ label: "aprovado → Feedback ao operador", tone: "positive" }, { label: "reprovado → Fim", tone: "negative" }, { label: "escalar → Escalonar ao Gerente", tone: "neutral" }] }, { label: "Feedback ao operador → O próprio operador · Acompanhamento", kind: "output" }, { label: "Escalonar ao Gerente (encerra)", kind: "action" }, END],
  },
  {
    number: 4, id: "wf04", name: "Modelo · 04 · Maiores quedas por Subgrupo",
    beneficiary: "MULTINIVEL",
    problem: "A liderança não consegue olhar Subgrupo a Subgrupo todo mês; o engine encontra as maiores quedas, cada supervisor revisa o diagnóstico da sua pessoa e o Diretor recebe uma síntese só.",
    objective: "Encontrar as 2 maiores quedas de atingimento de PRV em cada Subgrupo, diagnosticar individualmente (revisão do supervisor, feedback ao operador quando aprovado) e sintetizar para o Diretor.",
    trigger: "Agenda mensal (dia 3, 09:00)", subject: "Estrutura do Diretor (Consolidado)", population: "Todos os grupos",
    structure: "Consolidado na estrutura de um(a) Diretor(a). Ao instalar, escolha a pessoa com esse cargo na sua organização (Estrutura Consolidada); o Output de gestão é resolvido a partir dela.",
    nodes: ["Gatilho", "Selecionar colaboradores", "Aplicar individualmente", "Chamar agente", "Revisão Humana", "Output", "Consolidar resultados", "Escalonar", "Chamar agente", "Output", "Fim"],
    condition: "—", ranking: "Maiores quedas (CHANGE) · 2 por Subgrupo · Atingimento de PRV · média · mês anterior vs. mês anterior a ele",
    agent: "Especialista de Performance Individual — fechamentos oficiais PRV + indicadores (2 fechamentos)", orchestrator: "— (síntese pós-Join pelo Especialista de Síntese Gerencial, um Agent)",
    knowledgeBase: "Nenhuma", humanReview: "Supervisor do operador — aprovado publica; reprovado não publica; escalar → Gerente",
    output: "Feedback ao operador → O próprio operador · Resumo executivo ao Diretor → Diretor (resolvido pela estrutura)", surface: "Acompanhamento",
    deliveries: [{ recipient: "Supervisor", what: "Revisão humana: Revisão do supervisor (aprovar / reprovar / escalar)", surface: "Pendências" }, { recipient: "Operador", what: "Feedback ao operador", surface: "Acompanhamento" }, { recipient: "Gerente", what: "Escalonamento com o conteúdo analisado (quando o Supervisor escolhe “Escalar”)", surface: "Acompanhamento" }, { recipient: "Diretor (resolvido pela estrutura)", what: "Resumo executivo ao Diretor", surface: "Acompanhamento" }],
    requiredData: "Atingimento de PRV em duas competências consecutivas.",
    expectedBehavior: "Ranking determinístico; N execuções individuais; Revisão: aprovado → feedback ao operador, reprovado → só consta na consolidação, escalar → Gerente; TODAS as decisões convergem no mesmo Join; síntese única ao Diretor.",
    limitations: "Subgrupo sem 2 quedas entrega menos que 2 (nunca inventa). Escalonar exige um Gerente na cadeia do operador — sem ele, o passo falha com motivo registrado.",
    usesKnowledgeBase: false, isConformanceCase: false, usesAi: true,
    diagram: [{ label: "Agenda mensal (Consolidado)", kind: "trigger" }, { label: "2 maiores quedas de PRV por Subgrupo", kind: "select_employees" }, { label: "Aplicar individualmente", kind: "apply_individually" }, { label: "Especialista de Performance Individual", kind: "action" }, { label: "Revisão Humana — Supervisor", kind: "human_review", branches: [{ label: "aprovado → Feedback ao operador", tone: "positive" }, { label: "reprovado → Consolidar resultados", tone: "negative" }, { label: "escalar → Escalonar ao Gerente", tone: "neutral" }] }, { label: "Feedback ao operador → O próprio operador · Acompanhamento", kind: "output" }, { label: "Consolidar resultados (fan-in)", kind: "consolidate_results" }, { label: "Escalonar ao Gerente → Join", kind: "action" }, { label: "Agente · Síntese gerencial (Especialista de Síntese Gerencial)", kind: "action" }, { label: "Resumo executivo ao Diretor → Diretor (resolvido pela estrutura) · Acompanhamento", kind: "output" }, END],
  },
  {
    number: 5, id: "wf05", name: "Modelo · 05 · Piores em Qualidade por Grupo",
    beneficiary: "MULTINIVEL",
    problem: "Os piores em Qualidade de cada Grupo precisam de feedback específico sobre o padrão de conduta — ranqueado na estrutura, entregue um a um, revisado pelo supervisor — e o Diretor precisa do panorama por Grupo, não de N feedbacks.",
    objective: "Encontrar os 3 piores em Qualidade de cada Grupo, gerar feedback individual (revisão do supervisor, publicação ao operador quando aprovada) e entregar ao Diretor o panorama de Qualidade por Grupo sintetizado pelo Orquestrador Gerencial.",
    trigger: "Agenda mensal (dia 3, 09:00)", subject: "Estrutura do Diretor (Consolidado)", population: "Todos os grupos",
    structure: "Consolidado na estrutura de um(a) Diretor(a). Ao instalar, escolha a pessoa com esse cargo na sua organização (Estrutura Consolidada); o Output de gestão é resolvido a partir dela.",
    nodes: ["Gatilho", "Selecionar colaboradores", "Aplicar individualmente", "Chamar agente", "Revisão Humana", "Output", "Consolidar resultados", "Escalonar", "Chamar agente", "Output", "Fim"],
    condition: "—", ranking: "Piores (VALUE) · 3 por Grupo · indicador MONITORIA_QUALIDADE · média · mês anterior",
    agent: "Especialista de Qualidade de Atendimento — resumo do indicador", orchestrator: "— (síntese pós-Join pelo Especialista de Síntese Gerencial, um Agent)",
    knowledgeBase: "Jeito Vivo de Atender + Checklist (KB oficial de monitoria)", humanReview: "Supervisor do operador — aprovado publica; reprovado não publica; escalar → Gerente",
    output: "Feedback ao operador → O próprio operador · Panorama de Qualidade ao Diretor → Diretor (resolvido pela estrutura)", surface: "Acompanhamento",
    deliveries: [{ recipient: "Supervisor", what: "Revisão humana: Revisão do supervisor (aprovar / reprovar / escalar)", surface: "Pendências" }, { recipient: "Operador", what: "Feedback ao operador", surface: "Acompanhamento" }, { recipient: "Gerente", what: "Escalonamento com o conteúdo analisado (quando o Supervisor escolhe “Escalar”)", surface: "Acompanhamento" }, { recipient: "Diretor (resolvido pela estrutura)", what: "Panorama de Qualidade ao Diretor", surface: "Acompanhamento" }],
    requiredData: "Medições de QUALIDADE no mês anterior.",
    expectedBehavior: "Ranking por Grupo (3 piores em Qualidade); feedback individual revisado; todas as decisões convergem no Join; síntese única ao Diretor (1 request de IA na consolidação).",
    limitations: "Grupo com menos de 3 abaixo entrega menos (nunca inventa). Estrutura do Diretor cobre toda a operação — em operações grandes, prefira uma instância por Gerente Sênior.",
    usesKnowledgeBase: true, isConformanceCase: false, usesAi: true,
    diagram: [{ label: "Agenda mensal (Consolidado)", kind: "trigger" }, { label: "3 piores em Qualidade por Grupo", kind: "select_employees" }, { label: "Aplicar individualmente", kind: "apply_individually" }, { label: "Especialista de Qualidade de Atendimento", kind: "action" }, { label: "Revisão Humana — Supervisor", kind: "human_review", branches: [{ label: "aprovado → Feedback ao operador", tone: "positive" }, { label: "reprovado → Consolidar resultados", tone: "negative" }, { label: "escalar → Escalonar ao Gerente", tone: "neutral" }] }, { label: "Feedback ao operador → O próprio operador · Acompanhamento", kind: "output" }, { label: "Consolidar resultados (fan-in)", kind: "consolidate_results" }, { label: "Escalonar ao Gerente → Join", kind: "action" }, { label: "Agente · Síntese gerencial (Especialista de Síntese Gerencial)", kind: "action" }, { label: "Panorama de Qualidade ao Diretor → Diretor (resolvido pela estrutura) · Acompanhamento", kind: "output" }, END],
  },
  {
    number: 6, id: "wf06", name: "Modelo · 06 · PRV baixo recorrente",
    beneficiary: "OPERADOR",
    problem: "PRV abaixo de 80% em três fechamentos raramente é acaso: o operador precisa entender a composição do seu PRV e o supervisor validar a explicação.",
    objective: "Detectar atingimento de PRV abaixo de 80% na média dos últimos 3 fechamentos e explicar a composição oficial.",
    trigger: "Agenda mensal (dia 5, 09:00)", subject: "Cada colaborador da Abrangência (Individual)", population: "Todos os grupos",
    structure: "Genérico — Todos os grupos, avaliação individual. Funciona em qualquer operação sem configuração adicional.",
    nodes: ["Gatilho", "Condição", "Chamar agente", "Fim", "Revisão Humana", "Output", "Escalonar"],
    condition: "PRV · média · últimos 3 fechamentos < 80", ranking: "—",
    agent: "Especialista de PRV — fechamentos oficiais PRV + indicadores (3 fechamentos)", orchestrator: "—",
    knowledgeBase: "Nenhuma", humanReview: "Supervisor do operador — aprovado publica; reprovado não publica; escalar → Gerente",
    output: "Feedback ao operador → O próprio operador", surface: "Acompanhamento",
    deliveries: [{ recipient: "Supervisor", what: "Revisão humana: Revisão do supervisor (aprovar / reprovar / escalar)", surface: "Pendências" }, { recipient: "Operador", what: "Feedback ao operador", surface: "Acompanhamento" }, { recipient: "Gerente", what: "Escalonamento com o conteúdo analisado (quando o Supervisor escolhe “Escalar”)", surface: "Acompanhamento" }],
    requiredData: "employee_prv_performance em ≥ 3 competências.",
    expectedBehavior: "PRV nunca é recalculado; o agente explica o valor persistido e a composição por peso.",
    limitations: "Menos de 3 fechamentos = SEM DADOS (encerra).",
    usesKnowledgeBase: false, isConformanceCase: false, usesAi: true,
    diagram: [{ label: "Agenda mensal", kind: "trigger" }, { label: "PRV médio (3 fechamentos) < 80%?", kind: "condition", branches: [{ label: "sim → Especialista de PRV", tone: "positive" }, { label: "não → Fim", tone: "neutral" }, { label: "sem dados → Fim", tone: "neutral" }] }, { label: "Especialista de PRV", kind: "action" }, { label: "Revisão Humana — Supervisor", kind: "human_review", branches: [{ label: "aprovado → Feedback ao operador", tone: "positive" }, { label: "reprovado → Fim", tone: "negative" }, { label: "escalar → Escalonar ao Gerente", tone: "neutral" }] }, { label: "Feedback ao operador → O próprio operador · Acompanhamento", kind: "output" }, { label: "Escalonar ao Gerente (encerra)", kind: "action" }, END],
  },
  {
    number: 7, id: "wf07", name: "Modelo · 07 · TMA fora do esperado",
    beneficiary: "OPERADOR",
    problem: "TMA acima da meta na semana é o sinal mais comum de ineficiência — orientação imediata, sem esperar o fechamento do mês.",
    objective: "Reagir a uma medição de TMA acima da meta com análise de eficiência (fatos separados de hipóteses).",
    trigger: "Nova medição do indicador TMA", subject: "Colaborador da medição (Individual)", population: "Todos os grupos",
    structure: "Genérico — Todos os grupos, avaliação individual. Funciona em qualquer operação sem configuração adicional.",
    nodes: ["Gatilho", "Condição", "Chamar agente", "Fim", "Output"],
    condition: "TMA · média · últimos 7 dias > Meta vigente", ranking: "—",
    agent: "Especialista de Eficiência Operacional", orchestrator: "—",
    knowledgeBase: "Nenhuma (KB de condução só se pertinente — não configurada)", humanReview: "—",
    output: "Orientação ao operador → O próprio operador", surface: "Acompanhamento",
    deliveries: [{ recipient: "Operador", what: "Orientação ao operador", surface: "Acompanhamento" }],
    requiredData: "Medições de TMA e meta vigente.",
    expectedBehavior: "Só dispara quando a média recente supera a meta — nunca por uma medição isolada.",
    limitations: "Sem meta cadastrada = SEM DADOS.",
    usesKnowledgeBase: false, isConformanceCase: false, usesAi: true,
    diagram: [{ label: "Nova medição de TMA", kind: "trigger" }, { label: "TMA médio (7 dias) acima da meta?", kind: "condition", branches: [{ label: "sim → Especialista de Eficiência Operacional", tone: "positive" }, { label: "não → Fim", tone: "neutral" }, { label: "sem dados → Fim", tone: "neutral" }] }, { label: "Especialista de Eficiência Operacional", kind: "action" }, { label: "Orientação ao operador → O próprio operador · Acompanhamento", kind: "output" }, END],
  },
  {
    number: 8, id: "wf08", name: "Modelo · 08 · Contestação multidomínio",
    beneficiary: "OPERADOR",
    problem: "Uma contestação de fatura pode misturar faturamento, risco de cancelamento, suporte e experiência do cliente: um especialista só não enxerga tudo, e chamar todos por padrão desperdiça IA — só um orquestrador multidomínio pode cruzar domínios.",
    objective: "Chamada complexa (contestação) analisada pelo Orquestrador · Atendimento multidomínio, que identifica os domínios presentes na ligação e escolhe SÓ os especialistas necessários entre Faturamento, Retenção/Cancelamento, Suporte Técnico, Cadastro e Experiência do Cliente, sintetiza um feedback único e passa pela revisão do supervisor.",
    trigger: "Flag de canal: contestacao", subject: "Colaborador da chamada (Individual)", population: "Todos os grupos",
    structure: "Genérico — Todos os grupos, avaliação individual. Funciona em qualquer operação sem configuração adicional.",
    nodes: ["Gatilho", "Condição", "Orquestrador", "Fim", "Revisão Humana", "Output", "Escalonar"],
    condition: "Valor da flag = True", ranking: "—",
    agent: "Nenhum (sem IA)", orchestrator: "Orquestrador · Atendimento multidomínio (roteamento de especialistas)",
    knowledgeBase: "KBs dos especialistas acionados (Faturamento, Cancelamento, Suporte, Cadastro, Jeito Vivo/Checklist) — cada um consulta só as suas (retrieval por transcrição)", humanReview: "Supervisor do operador — aprovado publica; reprovado não publica; escalar → Gerente",
    output: "Feedback ao operador → O próprio operador", surface: "Acompanhamento",
    deliveries: [{ recipient: "Supervisor", what: "Revisão humana: Revisão do supervisor (aprovar / reprovar / escalar)", surface: "Pendências" }, { recipient: "Operador", what: "Feedback ao operador", surface: "Acompanhamento" }, { recipient: "Gerente", what: "Escalonamento com o conteúdo analisado (quando o Supervisor escolhe “Escalar”)", surface: "Acompanhamento" }],
    requiredData: "TMA e QUALIDADE com metas vigentes.",
    expectedBehavior: "O Orquestrador multidomínio aciona apenas os especialistas dos domínios presentes na chamada (no QA real com a interação canônica de contestação + cancelamento: Faturamento + Retenção; Suporte, Cadastro e Experiência não acionados); síntese com evidência literal; supervisor aprova antes de publicar.",
    limitations: "A síntese do Orquestrador não passa pela checagem verbatim de evidência do Agent (trade-off documentado). Orquestradores de domínio (Faturamento, Retenção…) ficam dentro do próprio domínio — não use um deles para este caso.",
    usesKnowledgeBase: true, isConformanceCase: false, usesAi: true,
    diagram: [{ label: "Flag de contestação", kind: "trigger" }, { label: "Contestação confirmada?", kind: "condition", branches: [{ label: "sim → Orquestrador · Atendimento multidomínio", tone: "positive" }, { label: "não → Fim", tone: "neutral" }] }, { label: "Orquestrador · Atendimento multidomínio", kind: "orchestrator" }, { label: "Revisão Humana — Supervisor", kind: "human_review", branches: [{ label: "aprovado → Feedback ao operador", tone: "positive" }, { label: "reprovado → Fim", tone: "negative" }, { label: "escalar → Escalonar ao Gerente", tone: "neutral" }] }, { label: "Feedback ao operador → O próprio operador · Acompanhamento", kind: "output" }, { label: "Escalonar ao Gerente (encerra)", kind: "action" }, END],
  },
  {
    number: 9, id: "wf09", name: "Modelo · 09 · TMA bom + Qualidade ruim",
    beneficiary: "OPERADOR",
    problem: "TMA bom com Qualidade ruim é o operador rápido que atropela o cliente — a monitoria de 2 chamadas reais mostra onde.",
    objective: "Identificar atendimento rápido com qualidade inferior e validar chamadas reais contra a KB pertinente — sem afirmar \\\"rápido demais\\\" como causa.",
    trigger: "Agenda semanal (MON, 09:00)", subject: "Cada colaborador da Abrangência (Individual)", population: "Todos os grupos",
    structure: "Genérico — Todos os grupos, avaliação individual. Funciona em qualquer operação sem configuração adicional.",
    nodes: ["Gatilho", "Condição", "Condição", "Fim", "Chamar agente", "Revisão Humana", "Output", "Escalonar"],
    condition: "TMA · média · últimos 30 dias ≤ Meta vigente · MONITORIA_QUALIDADE · média · últimos 30 dias < Meta vigente", ranking: "—",
    agent: "Especialista de Qualidade de Atendimento — chamadas do mês (2 chamadas)", orchestrator: "—",
    knowledgeBase: "Jeito Vivo de Atender + Checklist (retrieval por transcrição)", humanReview: "Supervisor do operador — aprovado publica; reprovado não publica; escalar → Gerente",
    output: "Feedback ao operador → O próprio operador", surface: "Acompanhamento",
    deliveries: [{ recipient: "Supervisor", what: "Revisão humana: Revisão do supervisor (aprovar / reprovar / escalar)", surface: "Pendências" }, { recipient: "Operador", what: "Feedback ao operador", surface: "Acompanhamento" }, { recipient: "Gerente", what: "Escalonamento com o conteúdo analisado (quando o Supervisor escolhe “Escalar”)", surface: "Acompanhamento" }],
    requiredData: "Transcrições no período + TMA/QUALIDADE com metas.",
    expectedBehavior: "Cada chamada amostrada gera feedback com evidência literal.",
    limitations: "Amostra aleatória (até 2); sem chamadas no período = nada a publicar.",
    usesKnowledgeBase: true, isConformanceCase: false, usesAi: true,
    diagram: [{ label: "Agenda semanal", kind: "trigger" }, { label: "TMA médio (30 dias) ≤ meta?", kind: "condition", branches: [{ label: "sim → Qualidade média (30 dias) < meta?", tone: "positive" }, { label: "não → Fim", tone: "neutral" }, { label: "sem dados → Fim", tone: "neutral" }] }, { label: "Qualidade média (30 dias) < meta?", kind: "condition", branches: [{ label: "sim → Especialista de Qualidade (2 chamadas do mês)", tone: "positive" }, { label: "não → Fim", tone: "neutral" }, { label: "sem dados → Fim", tone: "neutral" }] }, { label: "Especialista de Qualidade de Atendimento", kind: "action" }, { label: "Revisão Humana — Supervisor", kind: "human_review", branches: [{ label: "aprovado → Feedback ao operador", tone: "positive" }, { label: "reprovado → Fim", tone: "negative" }, { label: "escalar → Escalonar ao Gerente", tone: "neutral" }] }, { label: "Feedback ao operador → O próprio operador · Acompanhamento", kind: "output" }, { label: "Escalonar ao Gerente (encerra)", kind: "action" }, END],
  },
  {
    number: 10, id: "wf10", name: "Modelo · 10 · Disponibilidade / Aderência",
    beneficiary: "OPERADOR",
    problem: "Aderência à escala abaixo da meta derruba o nível de serviço de toda a fila — orientação objetiva sobre a regra de jornada, sem juízo de valor.",
    objective: "Reagir a aderência à escala abaixo da meta com orientação restrita à regra operacional — sem diagnosticar saúde nem inferir motivo pessoal.",
    trigger: "Nova medição do indicador ADERENCIA", subject: "Colaborador da medição (Individual)", population: "Todos os grupos",
    structure: "Genérico — Todos os grupos, avaliação individual. Funciona em qualquer operação sem configuração adicional.",
    nodes: ["Gatilho", "Condição", "Chamar agente", "Fim", "Output"],
    condition: "ADERENCIA · média · mês corrente < Meta vigente", ranking: "—",
    agent: "Especialista de Disponibilidade Operacional", orchestrator: "—",
    knowledgeBase: "Política de Jornada (somente regra operacional)", humanReview: "—",
    output: "Orientação ao operador → O próprio operador", surface: "Acompanhamento",
    deliveries: [{ recipient: "Operador", what: "Orientação ao operador", surface: "Acompanhamento" }],
    requiredData: "Medições de ADERENCIA e meta.",
    expectedBehavior: "Orientação sobre a regra (política) e o número; nada sobre motivo.",
    limitations: "Restrição de governança impede inferências pessoais/saúde.",
    usesKnowledgeBase: true, isConformanceCase: false, usesAi: true,
    diagram: [{ label: "Nova medição de Aderência", kind: "trigger" }, { label: "Aderência média (mês) abaixo da meta?", kind: "condition", branches: [{ label: "sim → Especialista de Disponibilidade Operacional", tone: "positive" }, { label: "não → Fim", tone: "neutral" }, { label: "sem dados → Fim", tone: "neutral" }] }, { label: "Especialista de Disponibilidade Operacional", kind: "action" }, { label: "Orientação ao operador → O próprio operador · Acompanhamento", kind: "output" }, END],
  },
  {
    number: 11, id: "wf11", name: "Modelo · 11 · Reconhecimento dos melhores",
    beneficiary: "MULTINIVEL",
    problem: "Reconhecimento é o feedback mais barato e mais esquecido: o melhor PRV de cada Subgrupo recebe reconhecimento pessoal, e o Diretor recebe os destaques do mês.",
    objective: "Reconhecer o melhor PRV de cada Subgrupo com texto individual ao operador e, depois de consolidar, entregar os destaques do mês ao Diretor (síntese pelo Orquestrador Gerencial).",
    trigger: "Agenda mensal (dia 2, 09:00)", subject: "Estrutura do Diretor (Consolidado)", population: "Todos os grupos",
    structure: "Consolidado na estrutura de um(a) Diretor(a). Ao instalar, escolha a pessoa com esse cargo na sua organização (Estrutura Consolidada); o Output de gestão é resolvido a partir dela.",
    nodes: ["Gatilho", "Selecionar colaboradores", "Aplicar individualmente", "Chamar agente", "Output", "Consolidar resultados", "Chamar agente", "Output", "Fim"],
    condition: "—", ranking: "Melhores (VALUE) · 1 por Subgrupo · Atingimento de PRV · média · mês anterior",
    agent: "Especialista de Reconhecimento — fechamentos oficiais PRV + indicadores (1 fechamento)", orchestrator: "— (síntese pós-Join pelo Especialista de Síntese Gerencial, um Agent)",
    knowledgeBase: "Nenhuma", humanReview: "—",
    output: "Reconhecimento ao operador → O próprio operador · Destaques do mês ao Diretor → Diretor (resolvido pela estrutura)", surface: "Acompanhamento",
    deliveries: [{ recipient: "Operador", what: "Reconhecimento ao operador", surface: "Acompanhamento" }, { recipient: "Diretor (resolvido pela estrutura)", what: "Destaques do mês ao Diretor", surface: "Acompanhamento" }],
    requiredData: "Atingimento de PRV no mês anterior.",
    expectedBehavior: "Cada destaque recebe reconhecimento individual antes do Join; o Diretor recebe UMA síntese dos destaques (1 request de IA na consolidação).",
    limitations: "Empate resolvido pela ordenação determinística do ranking. Consolidação vazia (nenhum destaque) não chama IA — o Diretor recebe o aviso de que não houve seleção.",
    usesKnowledgeBase: false, isConformanceCase: false, usesAi: true,
    diagram: [{ label: "Agenda mensal (Consolidado)", kind: "trigger" }, { label: "Melhor PRV por Subgrupo", kind: "select_employees" }, { label: "Aplicar individualmente", kind: "apply_individually" }, { label: "Especialista de Reconhecimento", kind: "action" }, { label: "Reconhecimento ao operador → O próprio operador · Acompanhamento", kind: "output" }, { label: "Consolidar resultados (fan-in)", kind: "consolidate_results" }, { label: "Agente · Síntese gerencial (Especialista de Síntese Gerencial)", kind: "action" }, { label: "Destaques do mês ao Diretor → Diretor (resolvido pela estrutura) · Acompanhamento", kind: "output" }, END],
  },
  {
    number: 12, id: "wf12", name: "Modelo · 12 · Maiores evoluções",
    beneficiary: "OPERADOR",
    problem: "Quem mais evoluiu merece saber — reconhecer evolução (não só resultado absoluto) sustenta o engajamento de quem estava abaixo.",
    objective: "Reconhecer as 2 maiores evoluções de PRV por Subgrupo.",
    trigger: "Agenda mensal (dia 2, 09:00)", subject: "Estrutura do Diretor (Consolidado)", population: "Todos os grupos",
    structure: "Consolidado na estrutura de um(a) Diretor(a). Ao instalar, escolha a pessoa com esse cargo na sua organização (Estrutura Consolidada); o Output de gestão é resolvido a partir dela.",
    nodes: ["Gatilho", "Selecionar colaboradores", "Aplicar individualmente", "Chamar agente", "Output", "Fim"],
    condition: "—", ranking: "Maiores evoluções (CHANGE) · 2 por Subgrupo · Atingimento de PRV · média · mês anterior vs. mês anterior a ele",
    agent: "Especialista de Reconhecimento — fechamentos oficiais PRV + indicadores (2 fechamentos)", orchestrator: "—",
    knowledgeBase: "Nenhuma", humanReview: "—",
    output: "Reconhecimento ao operador → O próprio operador", surface: "Acompanhamento",
    deliveries: [{ recipient: "Operador", what: "Reconhecimento ao operador", surface: "Acompanhamento" }],
    requiredData: "PRV em duas competências consecutivas.",
    expectedBehavior: "Só variação positiva entra (IMPROVED filtra > 0).",
    limitations: "—",
    usesKnowledgeBase: false, isConformanceCase: false, usesAi: true,
    diagram: [{ label: "Agenda mensal (Consolidado)", kind: "trigger" }, { label: "2 maiores evoluções de PRV por Subgrupo", kind: "select_employees" }, { label: "Aplicar individualmente", kind: "apply_individually" }, { label: "Especialista de Reconhecimento", kind: "action" }, { label: "Reconhecimento ao operador → O próprio operador · Acompanhamento", kind: "output" }, END],
  },
  {
    number: 13, id: "wf13", name: "Modelo · 13 · Monitoramento operacional do dia",
    beneficiary: "SUPERVISOR",
    problem: "Ainda durante o expediente dá tempo de corrigir o dia: o supervisor é avisado de quem está com o TMA do dia (medição diária, parcial até agora) acima da meta, sem IA.",
    objective: "Na hora agendada (50% do expediente previsto), avisar o supervisor se o TMA DO DIA está acima da meta — comparação determinística sobre a medição diária de hoje, sem IA. Não é monitoramento intraturno (não existe medição por hora).",
    trigger: "Agenda relativa ao expediente (50% da jornada)", subject: "Cada colaborador da Abrangência (Individual)", population: "Todos os grupos",
    structure: "Genérico — Todos os grupos, avaliação individual. Funciona em qualquer operação sem configuração adicional.",
    nodes: ["Gatilho", "Condição", "Output", "Fim"],
    condition: "TMA · média ponderada · hoje (dia local, parcial) > Meta vigente", ranking: "—",
    agent: "Nenhum (sem IA)", orchestrator: "—",
    knowledgeBase: "Nenhuma", humanReview: "—",
    output: "TMA acima da meta hoje — aviso ao supervisor → Supervisor do operador", surface: "Notificação",
    deliveries: [{ recipient: "Supervisor do operador", what: "TMA acima da meta hoje — aviso ao supervisor", surface: "Notificação" }],
    requiredData: "Jornada cadastrada (employee_work_shifts) + medição DIÁRIA de TMA de hoje (a linha do dia, atualizada ao longo dele).",
    expectedBehavior: "Sem IA: uma notificação ao supervisor por operador com TMA acima da meta no dia; Sem dados nunca vira alerta.",
    limitations: "Sem meta de TMA cadastrada = Sem dados. Aviso sem conteúdo analítico (não há IA neste modelo). Sem granularidade por hora: o valor é o do dia até o momento, nunca o \"meio do turno\".",
    usesKnowledgeBase: false, isConformanceCase: false, usesAi: false,
    diagram: [{ label: "50% do expediente (medição do dia)", kind: "trigger" }, { label: "TMA de hoje acima da meta?", kind: "condition", branches: [{ label: "sim → TMA acima da meta hoje — aviso ao supervisor", tone: "positive" }, { label: "não → Fim", tone: "neutral" }, { label: "sem dados → Fim", tone: "neutral" }] }, { label: "TMA acima da meta hoje — aviso ao supervisor → Supervisor do operador · Notificação", kind: "output" }, END],
  },
  {
    number: 14, id: "wf14", name: "Modelo · 14 · Qualidade + PRV",
    beneficiary: "MULTINIVEL",
    problem: "PRV baixo com Qualidade ruim ao mesmo tempo é o perfil de maior risco: uma chamada real do mês analisada pelo especialista de qualidade, revisada pelo supervisor, e os casos críticos consolidados para o Diretor.",
    objective: "Entre os colaboradores com PRV abaixo de 80%, encontrar os 3 piores em Qualidade, analisar uma chamada real de cada um (revisão do supervisor, feedback ao operador quando aprovado) e consolidar os casos críticos para o Diretor.",
    trigger: "Agenda mensal (dia 4, 09:00)", subject: "Estrutura do Diretor (Consolidado)", population: "Todos os grupos",
    structure: "Consolidado na estrutura de um(a) Diretor(a). Ao instalar, escolha a pessoa com esse cargo na sua organização (Estrutura Consolidada); o Output de gestão é resolvido a partir dela.",
    nodes: ["Gatilho", "Selecionar colaboradores", "Selecionar colaboradores", "Aplicar individualmente", "Chamar agente", "Revisão Humana", "Output", "Consolidar resultados", "Escalonar", "Chamar agente", "Output", "Fim"],
    condition: "Atingimento de PRV menor que 80% (fechamento oficial)", ranking: "Piores (VALUE) · 3 · indicador MONITORIA_QUALIDADE · média · mês anterior",
    agent: "Especialista de Qualidade de Atendimento — chamadas do mês (1 chamada)", orchestrator: "— (síntese pós-Join pelo Especialista de Síntese Gerencial, um Agent)",
    knowledgeBase: "Jeito Vivo de Atender + Checklist (retrieval por transcrição)", humanReview: "Supervisor do operador — aprovado publica; reprovado não publica; escalar → Gerente",
    output: "Feedback ao operador → O próprio operador · Casos críticos de Qualidade + PRV ao Diretor → Diretor (resolvido pela estrutura)", surface: "Acompanhamento",
    deliveries: [{ recipient: "Supervisor", what: "Revisão humana: Revisão do supervisor (aprovar / reprovar / escalar)", surface: "Pendências" }, { recipient: "Operador", what: "Feedback ao operador", surface: "Acompanhamento" }, { recipient: "Gerente", what: "Escalonamento com o conteúdo analisado (quando o Supervisor escolhe “Escalar”)", surface: "Acompanhamento" }, { recipient: "Diretor (resolvido pela estrutura)", what: "Casos críticos de Qualidade + PRV ao Diretor", surface: "Acompanhamento" }],
    requiredData: "PRV, QUALIDADE e transcrições no mês.",
    expectedBehavior: "Duas seleções encadeadas (PRV < 80% → 3 piores em Qualidade); monitoria de 1 chamada real; revisão do supervisor; Join → Orquestrador Gerencial → Output ao Diretor.",
    limitations: "Colaborador sem chamada no mês fica sem análise (não vira 'não conforme'). Mesmas observações do Modelo 05 sobre o tamanho da estrutura.",
    usesKnowledgeBase: true, isConformanceCase: false, usesAi: true,
    diagram: [{ label: "Agenda mensal (Consolidado)", kind: "trigger" }, { label: "PRV abaixo de 80%", kind: "select_employees" }, { label: "3 piores em Qualidade", kind: "select_employees" }, { label: "Aplicar individualmente", kind: "apply_individually" }, { label: "Especialista de Qualidade de Atendimento", kind: "action" }, { label: "Revisão Humana — Supervisor", kind: "human_review", branches: [{ label: "aprovado → Feedback ao operador", tone: "positive" }, { label: "reprovado → Consolidar resultados", tone: "negative" }, { label: "escalar → Escalonar ao Gerente", tone: "neutral" }] }, { label: "Feedback ao operador → O próprio operador · Acompanhamento", kind: "output" }, { label: "Consolidar resultados (fan-in)", kind: "consolidate_results" }, { label: "Escalonar ao Gerente → Join", kind: "action" }, { label: "Agente · Síntese gerencial (Especialista de Síntese Gerencial)", kind: "action" }, { label: "Casos críticos de Qualidade + PRV ao Diretor → Diretor (resolvido pela estrutura) · Acompanhamento", kind: "output" }, END],
  },
  {
    number: 15, id: "wf15", name: "Modelo · 15 · Maior queda entre críticos",
    beneficiary: "MULTINIVEL",
    problem: "Entre quem já está no Q4, quem ainda está caindo é a prioridade absoluta: cada supervisor revisa o diagnóstico e o Diretor recebe a lista consolidada.",
    objective: "Entre os colaboradores em Q4 de PRV, encontrar as 3 maiores quedas, diagnosticar individualmente (com revisão do supervisor e orientação ao operador) e entregar a lista consolidada ao Diretor — sem IA na consolidação.",
    trigger: "Agenda mensal (dia 4, 09:00)", subject: "Estrutura do Diretor (Consolidado)", population: "Todos os grupos",
    structure: "Consolidado na estrutura de um(a) Diretor(a). Ao instalar, escolha a pessoa com esse cargo na sua organização (Estrutura Consolidada); o Output de gestão é resolvido a partir dela.",
    nodes: ["Gatilho", "Selecionar colaboradores", "Selecionar colaboradores", "Aplicar individualmente", "Chamar agente", "Revisão Humana", "Output", "Consolidar resultados", "Escalonar", "Output", "Fim"],
    condition: "Quartil de PRV igual a Q4 (fechamento oficial)", ranking: "Maiores quedas (CHANGE) · 3 · Atingimento de PRV · média · mês anterior vs. mês anterior a ele",
    agent: "Especialista de Performance Individual — fechamentos oficiais PRV + indicadores (2 fechamentos)", orchestrator: "—",
    knowledgeBase: "Nenhuma", humanReview: "Supervisor do operador — aprovado publica; reprovado não publica; escalar → Gerente",
    output: "Feedback ao operador → O próprio operador · Lista consolidada ao Diretor → Diretor (resolvido pela estrutura)", surface: "Acompanhamento",
    deliveries: [{ recipient: "Supervisor", what: "Revisão humana: Revisão do supervisor (aprovar / reprovar / escalar)", surface: "Pendências" }, { recipient: "Operador", what: "Feedback ao operador", surface: "Acompanhamento" }, { recipient: "Gerente", what: "Escalonamento com o conteúdo analisado (quando o Supervisor escolhe “Escalar”)", surface: "Acompanhamento" }, { recipient: "Diretor (resolvido pela estrutura)", what: "Lista consolidada ao Diretor", surface: "Acompanhamento" }],
    requiredData: "Quartil e atingimento de PRV em duas competências.",
    expectedBehavior: "Duas seleções encadeadas (Q4 → maiores quedas); revisão por supervisor; Join → Output direto ao Diretor com a lista consolidada (zero IA pós-Join).",
    limitations: "A lista consolidada ao Diretor é o resultado bruto do Join (contagem + decisões) — sem síntese; use o Modelo 04/20 quando precisar de leitura executiva.",
    usesKnowledgeBase: false, isConformanceCase: false, usesAi: true,
    diagram: [{ label: "Agenda mensal (Consolidado)", kind: "trigger" }, { label: "Colaboradores em Q4 de PRV", kind: "select_employees" }, { label: "3 maiores quedas de PRV", kind: "select_employees" }, { label: "Aplicar individualmente", kind: "apply_individually" }, { label: "Especialista de Performance Individual", kind: "action" }, { label: "Revisão Humana — Supervisor", kind: "human_review", branches: [{ label: "aprovado → Feedback ao operador", tone: "positive" }, { label: "reprovado → Consolidar resultados", tone: "negative" }, { label: "escalar → Escalonar ao Gerente", tone: "neutral" }] }, { label: "Feedback ao operador → O próprio operador · Acompanhamento", kind: "output" }, { label: "Consolidar resultados (fan-in)", kind: "consolidate_results" }, { label: "Escalonar ao Gerente → Join", kind: "action" }, { label: "Lista consolidada ao Diretor → Diretor (resolvido pela estrutura) · Acompanhamento", kind: "output" }, END],
  },
  {
    number: 16, id: "wf16", name: "Modelo · 16 · Resumo mensal do Supervisor",
    beneficiary: "SUPERVISOR",
    problem: "O supervisor precisa começar o mês sabendo quem ficou abaixo de 100% de PRV e por quê — um resumo só, sem ler N diagnósticos.",
    objective: "Todo dia 1º, diagnosticar cada membro da equipe abaixo de 100% de PRV e entregar ao Supervisor um resumo mensal sintetizado pelo Orquestrador Gerencial.",
    trigger: "Agenda mensal (dia 1, 08:00)", subject: "Equipe do Supervisor (Consolidado)", population: "Todos os grupos",
    structure: "Consolidado na estrutura de um(a) Supervisor(a). Ao instalar, escolha a pessoa com esse cargo na sua organização (Estrutura Consolidada); o Output de gestão é resolvido a partir dela.",
    nodes: ["Gatilho", "Selecionar colaboradores", "Aplicar individualmente", "Chamar agente", "Consolidar resultados", "Chamar agente", "Output", "Fim"],
    condition: "Atingimento de PRV menor que 100% (fechamento oficial)", ranking: "—",
    agent: "Especialista de Performance Individual — fechamentos oficiais PRV + indicadores (1 fechamento)", orchestrator: "— (síntese pós-Join pelo Especialista de Síntese Gerencial, um Agent)",
    knowledgeBase: "Nenhuma", humanReview: "—",
    output: "Resumo mensal ao Supervisor → Supervisor (resolvido pela estrutura)", surface: "Acompanhamento",
    deliveries: [{ recipient: "Supervisor (resolvido pela estrutura)", what: "Resumo mensal ao Supervisor", surface: "Acompanhamento" }],
    requiredData: "PRV do mês anterior por colaborador.",
    expectedBehavior: "Diagnóstico individual sem revisão (é insumo do resumo, não feedback ao operador); Join → Orquestrador Gerencial → Output ao Supervisor (âncora da estrutura).",
    limitations: "Equipe inteira acima de 100% = consolidação vazia (sem IA, aviso ao Supervisor). Só Supervisor com equipe direta (SUPERVISOR_TEAM).",
    usesKnowledgeBase: false, isConformanceCase: false, usesAi: true,
    diagram: [{ label: "Agenda mensal (Equipe do Supervisor)", kind: "trigger" }, { label: "PRV abaixo de 100%", kind: "select_employees" }, { label: "Aplicar individualmente", kind: "apply_individually" }, { label: "Especialista de Performance Individual", kind: "action" }, { label: "Consolidar resultados (fan-in)", kind: "consolidate_results" }, { label: "Agente · Síntese gerencial (Especialista de Síntese Gerencial)", kind: "action" }, { label: "Resumo mensal ao Supervisor → Supervisor (resolvido pela estrutura) · Acompanhamento", kind: "output" }, END],
  },
  {
    number: 17, id: "wf17", name: "Modelo · 17 · Padrões recorrentes no grupo",
    beneficiary: "LIDERANCA",
    problem: "Desvios de procedimento que se repetem num Grupo são problema de processo/treinamento, não de uma pessoa — o Gerente do Grupo precisa dos padrões, não dos casos.",
    objective: "Num Grupo de Retenção (estrutura = o próprio Grupo): analisar uma chamada real de cada colaborador abaixo da meta de Qualidade com o Especialista de Retenção e usar o Orquestrador · Retenção e Cancelamento para encontrar padrões recorrentes de desvio para o Gerente do Grupo — resolvido pela hierarquia, nunca por um membro qualquer.",
    trigger: "Agenda mensal (dia 6, 09:00)", subject: "Grupo (Consolidado)", population: "Um Grupo do domínio Retenção e Cancelamento (Abrangência de Grupo)",
    structure: "Requer um Grupo do domínio Retenção e Cancelamento com um único Gerente responsável pela hierarquia. Ao instalar, escolha o Grupo correspondente da sua organização (Abrangência e Estrutura Consolidada = o mesmo Grupo).",
    nodes: ["Gatilho", "Selecionar colaboradores", "Aplicar individualmente", "Chamar agente", "Consolidar resultados", "Chamar agente", "Output", "Fim"],
    condition: "MONITORIA_QUALIDADE · média · mês anterior · menor que Meta vigente", ranking: "—",
    agent: "Especialista de Retenção e Cancelamento — chamadas do mês (1 chamada)", orchestrator: "— (síntese pós-Join pelo Especialista de Síntese Gerencial, um Agent, com missão focada em retenção)",
    knowledgeBase: "KBs de Retenção e Cancelamento (retrieval por transcrição em cada análise individual)", humanReview: "—",
    output: "Padrões recorrentes ao Gerente → Gerente (resolvido pela estrutura)", surface: "Acompanhamento",
    deliveries: [{ recipient: "Gerente (resolvido pela estrutura)", what: "Padrões recorrentes ao Gerente", surface: "Acompanhamento" }],
    requiredData: "Transcrições do mês + QUALIDADE com meta.",
    expectedBehavior: "Especialista de Retenção por chamada; o Agent de síntese consolida os padrões pós-Join (uma request, contrato estruturado); Output ao único Gerente do Grupo — se o Grupo tivesse 2 Gerentes o modelo não publicaria (destinatário ambíguo).",
    limitations: "Pós-Join só há síntese (o Agent não aciona especialistas). Exige um Grupo com um único Gerente responsável pela hierarquia — Grupo com 2 Gerentes não publica.",
    usesKnowledgeBase: true, isConformanceCase: false, usesAi: true,
    diagram: [{ label: "Agenda mensal (Grupo de Retenção)", kind: "trigger" }, { label: "Qualidade abaixo da meta", kind: "select_employees" }, { label: "Aplicar individualmente", kind: "apply_individually" }, { label: "Especialista de Retenção e Cancelamento", kind: "action" }, { label: "Consolidar resultados (fan-in)", kind: "consolidate_results" }, { label: "Agente · Síntese gerencial (Especialista de Síntese Gerencial)", kind: "action" }, { label: "Padrões recorrentes ao Gerente → Gerente (resolvido pela estrutura) · Acompanhamento", kind: "output" }, END],
  },
  {
    number: 18, id: "wf18", name: "Modelo · 18 · Auditoria de conformidade de processo (Faturamento · Retenção · Suporte Técnico)",
    beneficiary: "OPERADOR",
    problem: "Auditar conformidade de processo em toda rechamada, etapa a etapa contra o procedimento oficial, com evidência literal — e nunca marcar “não conforme” sem prova.",
    objective: "Comparar o PROCESSO OFICIAL (KB) com a TRANSCRIÇÃO REAL, etapa a etapa: Conforme, Não conforme com evidência, Não foi possível confirmar, Não aplicável. Três instâncias, uma por domínio com KB real.",
    trigger: "Flag de canal: rechamada", subject: "Colaborador da chamada (Individual)", population: "Um Grupo por domínio — Faturamento, Retenção e Cancelamento, Suporte Técnico (uma instância por Grupo)",
    structure: "Requer um Grupo por domínio (Faturamento, Retenção e Cancelamento, Suporte Técnico), cada instância com o especialista e a base de conhecimento daquele domínio. Ao instalar, aponte cada instância para o Grupo correspondente da sua organização.",
    nodes: ["Gatilho", "Condição", "Chamar agente", "Fim", "Revisão Humana", "Output", "Escalonar"],
    condition: "Valor da flag = True", ranking: "—",
    agent: "Especialista do domínio (Faturamento / Retenção / Suporte Técnico) — formato Conformidade de processo", orchestrator: "—",
    knowledgeBase: "KB oficial do processo do domínio (retrieval por transcrição)", humanReview: "Supervisor do operador — aprovado publica; reprovado não publica; escalar → Gerente",
    output: "Feedback ao operador → O próprio operador", surface: "Acompanhamento",
    deliveries: [{ recipient: "Supervisor", what: "Revisão humana: Revisão do supervisor (aprovar / reprovar / escalar)", surface: "Pendências" }, { recipient: "Operador", what: "Feedback ao operador", surface: "Acompanhamento" }, { recipient: "Gerente", what: "Escalonamento com o conteúdo analisado (quando o Supervisor escolhe “Escalar”)", surface: "Acompanhamento" }],
    requiredData: "Transcrição + KB publicada do processo.",
    expectedBehavior: "Etapa sem citação literal → \\\"Não foi possível confirmar\\\" (nunca \\\"Não conforme\\\"); evidência parafraseada é rebaixada por código.",
    limitations: "Reutilizável com qualquer KB de processo: copie a instância, troque Abrangência + especialista.",
    usesKnowledgeBase: true, isConformanceCase: true, usesAi: true,
    diagram: [{ label: "Gatilho", kind: "trigger" }, { label: "Rechamada confirmada?", kind: "condition", branches: [{ label: "sim → Especialista de Faturamento — Conformidade de processo", tone: "positive" }, { label: "não → Fim", tone: "neutral" }] }, { label: "Especialista de Faturamento — Conformidade de processo", kind: "action" }, { label: "Revisão Humana — Supervisor", kind: "human_review", branches: [{ label: "aprovado → Feedback ao operador", tone: "positive" }, { label: "reprovado → Fim", tone: "negative" }, { label: "escalar → Escalonar ao Gerente", tone: "neutral" }] }, { label: "Feedback ao operador → O próprio operador · Acompanhamento", kind: "output" }, { label: "Escalonar ao Gerente (encerra)", kind: "action" }, END],
  },
  {
    number: 19, id: "wf19", name: "Modelo · 19 · Ausência de dados",
    beneficiary: "SUPERVISOR",
    problem: "Colaborador sem PRV apurado é um problema de cadastro/integração, não de desempenho — o supervisor precisa saber antes do fechamento seguinte.",
    objective: "Detectar colaborador sem PRV nos últimos 2 fechamentos e abrir uma pendência administrativa — SEM DADOS nunca é baixa performance.",
    trigger: "Agenda mensal (dia 7, 09:00)", subject: "Cada colaborador da Abrangência (Individual)", population: "Todos os grupos",
    structure: "Genérico — Todos os grupos, avaliação individual. Funciona em qualquer operação sem configuração adicional.",
    nodes: ["Gatilho", "Condição", "Fim", "Output"],
    condition: "PRV · média · últimos 2 fechamentos ≥ 0", ranking: "—",
    agent: "Nenhum (sem IA)", orchestrator: "—",
    knowledgeBase: "Nenhuma", humanReview: "—",
    output: "Sem PRV nos últimos 2 fechamentos — verificar cadastro → Supervisor do operador", surface: "Acompanhamento",
    deliveries: [{ recipient: "Supervisor do operador", what: "Sem PRV nos últimos 2 fechamentos — verificar cadastro", surface: "Acompanhamento" }],
    requiredData: "employee_prv_performance.",
    expectedBehavior: "Sem IA: Sem dados (ausência de PRV) vira item no Acompanhamento do supervisor; ter PRV (qualquer valor) encerra sem efeito.",
    limitations: "Só cobre PRV — ausência de outros indicadores exige um modelo por fonte.",
    usesKnowledgeBase: false, isConformanceCase: false, usesAi: false,
    diagram: [{ label: "Agenda mensal", kind: "trigger" }, { label: "Há PRV nos últimos 2 fechamentos?", kind: "condition", branches: [{ label: "sim → Fim", tone: "positive" }, { label: "não → Fim", tone: "neutral" }, { label: "sem dados → Sem PRV nos últimos 2 fechamentos — verificar cadastro", tone: "neutral" }] }, { label: "Sem PRV nos últimos 2 fechamentos — verificar cadastro → Supervisor do operador · Acompanhamento", kind: "output" }, END],
  },
  {
    number: 20, id: "wf20", name: "Modelo · 20 · Plano consolidado de ação",
    beneficiary: "MULTINIVEL",
    problem: "O Gerente precisa de um plano de ação consolidado das maiores quedas de cada Grupo — com os diagnósticos já revisados pelos supervisores e o operador já orientado.",
    objective: "Maiores quedas de PRV por Grupo na estrutura do Gerente: diagnóstico individual revisado pelo supervisor, orientação ao operador quando aprovada, e plano consolidado de ação ao Gerente sintetizado pelo Orquestrador Gerencial.",
    trigger: "Agenda mensal (dia 8, 09:00)", subject: "Estrutura do Gerente (Consolidado)", population: "Todos os grupos",
    structure: "Consolidado na estrutura de um(a) Gerente. Ao instalar, escolha a pessoa com esse cargo na sua organização (Estrutura Consolidada); o Output de gestão é resolvido a partir dela.",
    nodes: ["Gatilho", "Selecionar colaboradores", "Aplicar individualmente", "Chamar agente", "Revisão Humana", "Output", "Consolidar resultados", "Escalonar", "Chamar agente", "Output", "Fim"],
    condition: "—", ranking: "Maiores quedas (CHANGE) · 3 por Grupo · Atingimento de PRV · média · mês anterior vs. mês anterior a ele",
    agent: "Especialista de Performance Individual — fechamentos oficiais PRV + indicadores (2 fechamentos)", orchestrator: "— (síntese pós-Join pelo Especialista de Síntese Gerencial, um Agent)",
    knowledgeBase: "Nenhuma (casos de domínio com KB devem usar o Modelo 18/17)", humanReview: "Supervisor do operador — aprovado publica; reprovado não publica; escalar → Gerente",
    output: "Feedback ao operador → O próprio operador · Plano de ação ao Gerente → Gerente (resolvido pela estrutura)", surface: "Acompanhamento",
    deliveries: [{ recipient: "Supervisor", what: "Revisão humana: Revisão do supervisor (aprovar / reprovar / escalar)", surface: "Pendências" }, { recipient: "Operador", what: "Feedback ao operador", surface: "Acompanhamento" }, { recipient: "Gerente", what: "Escalonamento com o conteúdo analisado (quando o Supervisor escolhe “Escalar”)", surface: "Acompanhamento" }, { recipient: "Gerente (resolvido pela estrutura)", what: "Plano de ação ao Gerente", surface: "Acompanhamento" }],
    requiredData: "PRV em duas competências para toda a estrutura.",
    expectedBehavior: "Mesma espinha do Modelo 04 com estrutura do Gerente e plano de ação; operador orientado no caminho individual, Gerente recebe o consolidado.",
    limitations: "Mesmas do Modelo 04; estrutura ancorada num Gerente específico (reutilize criando uma instância por Gerente).",
    usesKnowledgeBase: false, isConformanceCase: false, usesAi: true,
    diagram: [{ label: "Agenda mensal (Estrutura do Gerente)", kind: "trigger" }, { label: "3 maiores quedas de PRV por Grupo", kind: "select_employees" }, { label: "Aplicar individualmente", kind: "apply_individually" }, { label: "Especialista de Performance Individual", kind: "action" }, { label: "Revisão Humana — Supervisor", kind: "human_review", branches: [{ label: "aprovado → Feedback ao operador", tone: "positive" }, { label: "reprovado → Consolidar resultados", tone: "negative" }, { label: "escalar → Escalonar ao Gerente", tone: "neutral" }] }, { label: "Feedback ao operador → O próprio operador · Acompanhamento", kind: "output" }, { label: "Consolidar resultados (fan-in)", kind: "consolidate_results" }, { label: "Escalonar ao Gerente → Join", kind: "action" }, { label: "Agente · Síntese gerencial (Especialista de Síntese Gerencial)", kind: "action" }, { label: "Plano de ação ao Gerente → Gerente (resolvido pela estrutura) · Acompanhamento", kind: "output" }, END],
  },
]

// ---------------------------------------------------------------------------------------------
// Casos de uso por Base de Conhecimento operacional
// ---------------------------------------------------------------------------------------------

export type KnowledgeUseCase = { knowledgeBase: string; agent: string; orchestrator: string; examples: string[] }

export const KNOWLEDGE_USE_CASES: KnowledgeUseCase[] = [
  { knowledgeBase: "Procedimento Operacional — Contestação de Contas Móvel", agent: "Especialista de Faturamento", orchestrator: "Orquestrador · Faturamento", examples: ["Auditoria de contestação de cobrança (Modelo 18 · Faturamento)", "Rechamada relacionada a fatura contestada"] },
  { knowledgeBase: "Procedimento Operacional Segunda Via de Conta", agent: "Especialista de Faturamento", orchestrator: "Orquestrador · Faturamento", examples: ["Cliente liga de novo porque a segunda via não chegou (rechamada)", "Detrator após pedido de segunda via"] },
  { knowledgeBase: "Procedimento Operacional Negociação de Débito", agent: "Especialista de Faturamento", orchestrator: "Orquestrador · Faturamento", examples: ["Auditoria da oferta de parcelamento", "Negociação que terminou em ameaça de cancelamento (multidomínio)"] },
  { knowledgeBase: "Procedimento Operacional — Cancelamento de Produtos e Serviços", agent: "Especialista de Retenção e Cancelamento", orchestrator: "Orquestrador · Retenção e Cancelamento", examples: ["Auditoria do fluxo de cancelamento/retenção (Modelo 18 · Retenção)", "Rechamada após pedido de cancelamento"] },
  { knowledgeBase: "Procedimento Operacional — Reparo de Banda Larga", agent: "Especialista de Suporte Técnico", orchestrator: "Orquestrador · Suporte Técnico", examples: ["Auditoria do diagnóstico remoto antes de abrir reparo (Modelo 18 · Suporte)", "Rechamada por reparo não resolvido"] },
  { knowledgeBase: "Troca de CHIP - AG", agent: "Especialista de Suporte Técnico", orchestrator: "Orquestrador · Suporte Técnico", examples: ["Conformidade das validações de troca de chip", "Detrator após troca de chip"] },
  { knowledgeBase: "Procedimento Operacional — Alteração de Dados Cadastrais de Gestor", agent: "Especialista de Cadastro e Titularidade", orchestrator: "Orquestrador · Cadastro e Titularidade", examples: ["Auditoria de alteração cadastral corporativa"] },
  { knowledgeBase: "Procedimento Operacional — Troca de Titularidade entre Empresas", agent: "Especialista de Cadastro e Titularidade", orchestrator: "Orquestrador · Cadastro e Titularidade", examples: ["Troca de titularidade com disputa de cobrança (multidomínio com Faturamento)"] },
  { knowledgeBase: "Procedimento Operacional Jeito Vivo de Atender", agent: "Especialista de Qualidade de Atendimento / Especialista de Experiência do Cliente", orchestrator: "Orquestrador · Qualidade e Experiência", examples: ["Piores em Qualidade por Grupo (Modelo 05)", "Detrator de URA (Modelo 02)", "TMA bom + Qualidade ruim (Modelo 09)"] },
  { knowledgeBase: "Checklist de Encerramento de Chamada", agent: "Especialista de Qualidade de Atendimento / Especialista de Experiência do Cliente", orchestrator: "Orquestrador · Qualidade e Experiência", examples: ["Rechamada recorrente por encerramento sem confirmação (Modelo 01)"] },
  { knowledgeBase: "POLÍTICA DE JORNADA HORAS EXTRAS FALTAS E BANCO DE HORAS", agent: "Especialista de Disponibilidade Operacional", orchestrator: "— (política de RH: só regra operacional, sem orquestrador de domínio)", examples: ["Disponibilidade/Aderência abaixo da meta (Modelo 10)"] },
]
