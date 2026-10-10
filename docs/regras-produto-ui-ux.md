# INIA — regras vinculantes de produto, UI/UX e engenharia

Data: 03/09/2026

Este documento complementa `arquitetura-evolutiva-inia.md` e deve orientar toda alteração futura.

## Regras de produto

1. A INIA é um Supervisor Digital, não um chatbot.
2. A jornada canônica é: detecção → diagnóstico → evidência → recomendação → acompanhamento → escalonamento ou encerramento.
3. O caso de supervisão é a unidade central. Alertas, feedbacks, evidências, planos e escalonamentos pertencem a um caso.
4. Um feedback publicado deve conter, obrigatoriamente: indicador impactado, evidência encontrada, comportamento observado, procedimento relacionado e recomendação.
5. Texto gerado por IA nunca é evidência. Toda evidência deve apontar para uma fonte verificável.
6. Os requisitos de Ricardo Miras prevalecem em conflitos de produto.
7. Ações de alto impacto ou baixa confiança exigem revisão humana configurável.

## Preservação dos dados de UI

1. Todos os nomes, equipes, indicadores, alertas, históricos, recomendações, textos de feedback e demais conteúdos atuais devem permanecer disponíveis.
2. Os mocks atuais serão mantidos como fixtures e seed de demonstração enquanto a API é adotada.
3. A substituição de mock por API deve ocorrer por adaptador e feature flag/fallback, nunca por remoção antecipada.
4. Formatação visual não será persistida como dado numérico: a API guarda valor e unidade; a UI mantém a apresentação atual por formatter.
5. Nenhuma tela antiga será retirada antes de existir paridade funcional e aceite explícito.

## Sistema visual

1. Componentes interativos e estruturais devem usar ShadCN UI/Radix: botões, inputs, selects, tabs, cards, badges, dialogs, sheets, popovers, dropdowns, tabelas, accordions, labels, skeletons e elementos equivalentes.
2. Componentes compostos de domínio podem existir, mas devem ser construídos sobre os primitives ShadCN disponíveis em `src/components/ui`.
3. HTML semântico básico (`main`, `section`, `header`, `p`, `span`, títulos, listas) é permitido; não se deve recriar manualmente um primitive que já exista no ShadCN.
4. Novos primitives entram pelo fluxo oficial do ShadCN e ficam versionados no projeto.
5. Toda tela deve contemplar loading, vazio, erro, acesso negado, atualização e responsividade.
6. Acessibilidade existente deve ser preservada: teclado, foco, nomes acessíveis, contraste, redução de movimento e leitores de tela.

## Página única de feedback/caso

A experiência canônica será `/supervisor/cases/:caseId`, com:

- cabeçalho do caso, prioridade, estado, SLA, operador e equipe;
- diagnóstico e causa operacional;
- indicador impactado e evolução temporal;
- evidências verificáveis e links para origem;
- procedimento relacionado e versão vigente;
- recomendação e abordagem sugerida;
- editor/revisão/publicação do feedback;
- plano de desenvolvimento e checkpoints;
- timeline e escalonamento.

O operador verá a projeção autorizada da mesma informação em `/operator/feedbacks/:feedbackId`, sem dados restritos de gestão. Central de feedbacks e dashboards apontam para essas páginas; não mantêm cópias divergentes do conteúdo.

## Engenharia e arquitetura

1. Backend como monólito modular: `presentation → application → domain`; infraestrutura implementa portas.
2. Nenhum módulo acessa diretamente repositório ou tabela privada de outro módulo.
3. Contratos HTTP são versionados, validados com Zod e documentados em OpenAPI.
4. PostgreSQL usa migrations aditivas, transações, constraints, índices, chaves UUID e isolamento por `organization_id`.
5. Comandos mutáveis críticos aceitam idempotência e registram auditoria.
6. Eventos confiáveis usam transactional outbox.
7. Dependências externas (IA, storage, filas e fontes operacionais) ficam atrás de interfaces.
8. Segredos nunca entram no repositório; arquivos `.env.example` documentam somente nomes e valores seguros.

## Testes e qualidade

1. Toda regra de domínio possui teste unitário.
2. Repositórios e rotas críticas possuem testes de integração contra banco de teste.
3. Frontend possui testes de componentes/integração e E2E para jornadas críticas.
4. Contratos entre frontend e backend são validados automaticamente.
5. Lint, typecheck, testes e build devem fazer parte do gate de CI.
6. Bugs recebem teste de regressão antes ou junto da correção.
7. Cobertura é indicador, não objetivo isolado; regras críticas de feedback, autorização, evidência e escalonamento exigem cobertura integral de cenários.

## Definition of Done

Uma entrega só está concluída quando:

- atende requisito e critérios de aceite rastreáveis;
- não remove dados ou comportamento existente sem migração aprovada;
- usa primitives ShadCN quando aplicável;
- possui validação, autorização, auditoria e tratamento de erro proporcionais ao risco;
- inclui testes automatizados;
- passa em lint, typecheck, testes e build;
- inclui migration/rollback operacional quando altera persistência;
- atualiza documentação e observabilidade necessárias.
