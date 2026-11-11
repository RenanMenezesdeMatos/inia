/**
 * V1.5.7 — PERMISSÕES: ações granulares do INIA. Um PAPEL é um pacote delas; uma ATRIBUIÇÃO concede um papel a uma CONTA
 * de usuário num ESCOPO. Cargo/nível hierárquico do colaborador NUNCA concede permissão. Namespace `<área>.<recurso>.<ação>`
 * (ou `<área>.<ação>`), extensível: módulos futuros (ex.: `store.view`, `store.inventory.manage`) só acrescentam entradas.
 */
export const PERMISSIONS = {
  "access.users.view": "Ver usuários e seus acessos",
  "access.users.manage": "Criar contas de acesso e vincular colaboradores",
  "access.roles.view": "Ver papéis e permissões",
  "access.roles.assign": "Atribuir e revogar papéis (dentro do próprio escopo e da própria delegação)",
  "people.manage": "Administrar cadastro de pessoas (situação, jornada, capital operacional)",
  "agents.manage": "Administrar agentes e orquestradores",
  // Agentes inativos (decisões PEN-001, PEN-068 e PEN-072 de 03/11/2026): listar, abrir o cadastro, reativar, excluir e ver o
  // histórico de alterações com os valores completos — só administradores, além do alcance. Quais perfis da Vivo: PEN-032.
  "agents.inactive.manage": "Listar, consultar, reativar e excluir agentes inativos e ver o histórico completo de alterações deles",
  "knowledge.manage": "Administrar bases de conhecimento",
  "workflows.manage": "Administrar workflows",
  "configuration.manage": "Administrar configurações operacionais (indicadores, regras, flags, domínios, calendário, estrutura)",
  "data_hub.manage": "Administrar a Central de Dados e cargas",
  // Consulta visual dos dados aprovados (somente leitura) e exportação CSV: permissão SEPARADA de administrar. Só os papéis ADMINISTRADOR_GERAL e
  // ADMINISTRADOR_DE_DADOS a têm, sempre com escopo de organização: o que ela mostra vale para a organização inteira.
  "data_hub.explore": "Consultar e exportar, somente leitura, os dados aprovados da Central de Dados",
  // Separada de consultar: é a única que altera dado pela consulta. O registro fica no banco e sai da lógica; a ação pede motivo e fica na auditoria.
  "data_hub.cancel_records": "Cancelar e reativar registros importados na Central de Dados",
  "ai.view": "Ver configuração, uso e custo de IA",
  "ai.manage": "Administrar provedores, modelos, roteamento e orçamentos de IA",
  // Ranking "Quem mais usa" (IA / Modelos): nomes de líderes, Grupos e Subgrupos com o uso de IA da estrutura deles. Concessão
  // SEPARADA de `ai.view`/`ai.manage` (nunca derivada delas) e sempre recortada pelo escopo — fora dele, nem nome nem número.
  "ai.usage_ranking.view": "Ver quem mais usa a IA por estrutura (Diretoria, Gerência, Grupo, Subgrupo, Supervisor), só no escopo",
  "qa_lab.use": "Usar o QA Lab (testes isolados de Agents, Orquestradores e Workflows)",
  // V1.5.8 — visões AMPLIADAS (além da própria estrutura por reports_to, que continua sendo regra operacional de quem lidera):
  "indicators.view": "Ver Indicadores e Equipe de colaboradores do escopo (além da própria estrutura)",
  "structure.metrics.view": "Ver os dados de gestão (população, situação, span) de líderes do escopo em Minha estrutura",
  "calendar.manage": "Ver e ajustar o Calendário da equipe (exceções e classificações) de colaboradores do escopo",
  "feedback_quality_review.view": "Ver a fila e o detalhe do QA de feedback",
  "feedback_quality_review.decide": "Avaliar feedbacks no QA (aprovar, editar, rejeitar)",
  // Contestação = o colaborador marcou um feedback da INIA como "não foi útil" (impreciso, processo errado…) com a descrição.
  // Responder nunca altera o feedback: registra a conclusão e o texto que o colaborador lê (LGPD art. 20, revisão humana).
  // Pedido do titular (LGPD art. 18): exportar TUDO o que a INIA guarda ligado a uma pessoa — só na organização inteira.
  "privacy.subject_data.export": "Exportar todos os dados ligados a uma pessoa, para responder a um pedido do titular (LGPD)",
  "feedback_contestations.review": "Ver e responder as contestações dos colaboradores sobre feedbacks gerados pela INIA, no escopo",
  "assistant_conversations.view": "Ler as conversas dos colaboradores com a INIA (somente leitura) no escopo",
  // Experiência visual da INIA (cenário atrás do avatar, sazonal ou não) — só do Administrador geral, na organização inteira.
  "inia_experience.manage": "Administrar o cenário da INIA (fundo atrás do avatar, inclusive os sazonais)",
  // Monitoria de usabilidade — agregados, pessoas identificadas, exportação, comentários de avaliações e configuração da coleta.
  // Permissões SEPARADAS: ver agregados nunca traz nome/id de pessoa; ver uso não libera conteúdo de conversa (continua
  // exigindo `assistant_conversations.view`); exportar não amplia o que a conta já pode consultar.
  "usability.view": "Ver a Monitoria de usabilidade (agregados) no escopo",
  "usability.users.view": "Ver pessoas identificadas e o detalhe de uso individual na Monitoria de usabilidade, no escopo",
  "usability.export": "Exportar CSV da Monitoria de usabilidade (o mesmo recorte que a conta já pode consultar)",
  "usability.comments.view": "Ler os comentários das avaliações negativas de feedback na Monitoria de usabilidade, no escopo",
  "usability.manage": "Configurar a coleta da Monitoria de usabilidade (ligar/desligar, retenção, fuso, classificação de contas de teste)",
  // Políticas de acompanhamento e intervenções — CONFIGURAR (editar, simular, publicar, auditar) é separado de AGIR sobre
  // colaboradores (ver, executar, aprovar, decidir). Configurar nunca dá acesso a colaboradores: simular com uma pessoa real
  // exige também enxergá-la (própria estrutura ou `indicators.view`/`workflows.manage` no escopo).
  "intervention_policies.edit": "Editar tipos de intervenção, competências e rascunhos de políticas de acompanhamento (no escopo)",
  "intervention_policies.simulate": "Simular políticas de acompanhamento sem efeitos, com colaboradores que a conta já pode consultar",
  "intervention_policies.publish": "Publicar tipos de intervenção e versões de políticas de acompanhamento (no escopo)",
  "intervention_policies.audit": "Consultar versões, publicações e avaliações das políticas de acompanhamento",
  "interventions.view": "Ver intervenções e relatórios de colaboradores do escopo (além da própria estrutura)",
  "interventions.execute": "Executar intervenções de colaboradores do escopo (aceitar, tarefas, checkpoints, concluir, cancelar, encaminhar)",
  "interventions.approve": "Aprovar ou devolver intervenções que exigem aprovação, no escopo",
  // Decisão SENSÍVEL — sempre concessão explícita; nenhum papel administrativo a recebe por padrão. Nunca altera situação funcional.
  // Reports recorrentes: DISTRIBUIR para outras pessoas (níveis, cargos, Grupos, Subgrupos, pessoas) no escopo da atribuição.
  // Nunca dá acesso a dado: cada destinatário recebe só o que o escopo DELE alcança, e quem distribui não vê o conteúdo entregue.
  "reports.distribute": "Criar reports recorrentes para outras pessoas do escopo (cada uma recebe só os dados que já pode ver)",
  "interventions.sensitive_decide": "Decidir solicitações de avaliação de continuidade (decisão humana restrita; nunca altera situação funcional nem executa desligamento)",
  // Apoio com Anjo (migration 182): ATENDER (o Anjo, só os operadores que o escopo da atribuição cobre), ACOMPANHAR (painel do
  // apoio, conversas de apoio e presença dos Anjos, no escopo) e CONFIGURAR (liga/desliga e capacidade, só na organização inteira).
  // Ter o papel de Anjo nunca dá acesso amplo às conversas: ele lê só os pedidos que atendeu.
  "human_support.attend": "Atender pedidos de apoio",
  "human_support.coordinate": "Acompanhar o apoio com Anjo",
  "human_support.manage": "Configurar o apoio com Anjo",
  // Diagnóstico de erros: catálogo de códigos e ocorrências técnicas (sanitizadas) da organização — só com escopo de organização.
  "support.diagnostics.view": "Consultar o catálogo de erros e as ocorrências registradas (diagnóstico de suporte)",
} as const

export type Permission = keyof typeof PERMISSIONS
