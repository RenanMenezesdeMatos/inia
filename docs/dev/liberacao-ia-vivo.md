# Liberação de IA na Vivo — o que falta fazer (19/10/2026, situação em 20/10/2026)

Pedido de liberação de API/SDK de IA vinculado ao **ID 73 INIA - Supervisor Virtual**. O e-mail de orientação lista quatro
etapas: aprovação do CDG (BP), DAS, Segurança Digital e análise de LGPD (Vivo Privacy). Este documento junta onde está cada
material, o que precisa ser implementado na INIA, os documentos a produzir e as decisões que dependem de outras áreas.

Tamanhos são estimativas: **P** até meio dia · **M** 1 a 2 dias · **G** 3 dias ou mais. Os códigos R-xx são os riscos de
[docs/security/pendencias-e-riscos.md](../security/pendencias-e-riscos.md).

## Situação em 20/10/2026

Tudo o que não dependia da Vivo foi implementado (sem commit até a data). Detalhes de configuração e atualização em
[configuracao-segura.md §11](../security/configuracao-segura.md); migrations 149–152.

| Item | Situação |
|---|---|
| B1 `CORS_ORIGIN` em produção | Feito: a API não sobe sem ela; `npm run doctor` confere |
| B2 Inatividade | Feito: 30 min (`SESSION_IDLE_TIMEOUT_MINUTES`), aviso 2 min antes, servidor encerra mesmo com a aba fechada |
| B3 Backup | Feito: `db:backup` e `db:restore-check` testados aqui; agendamento no Windows escrito, **falta validar no Windows** (R-35) |
| B4 Verificação | Feito: `npm run security:check` (segredos + `npm audit`) |
| B5 Máscara para a IA | Feito em toda leitura de transcrição para o modelo, com a conferência literal no mesmo texto mascarado; **qualidade do feedback não medida** numa rodada paga |
| B6 Contestações | Feito: papel Revisor de contestações (+ Administrador geral), tela, sino, resposta no feedback |
| B7 Registro de leitura | Feito: `personal_data_access_log` (transcrição, conversa com a INIA, ficha de pessoa) |
| B8 Titular | Exportação feita (Administrador geral); eliminação/anonimização aguarda o Privacy |
| B9 Retenção | Aguarda os prazos do Privacy |
| B10 Rotação da chave | Feito: cifra v2 com AAD + `npm run secrets:rotate`; **rodar `--aplicar` em cada instalação** |
| B11 API Push | Feito: validade, IPs autorizados, token antes do corpo, 422 na Idempotency-Key com outro corpo, aviso de `http://` |
| B12 R-33 | Feito: `__Host-inia_session`, HKDF, "Sair de todos os aparelhos" |
| B13 Voz | **Adiado**: só se a voz entrar no POC; precisa de uma sessão paga para confirmar como o Live informa o uso e de teto por sessão (R-36) |
| B14 `CHAMADAS - *.rtf` | Indícios fortes de material simulado: os 26 CPFs têm dígito verificador inválido e terminam em `-00`, os protocolos seguem a data (`2026091001…`). Telefones e e-mails (alguns `@gmail.com`) parecem plausíveis. Já ficam fora do snapshot do GitHub. **Falta só quem escreveu confirmar** |
| B15–B20 | Aguardam a Vivo (ver §5) |
| B21 OpenAPI | Feito: "Baixar OpenAPI" na fonte API Push, gerado dos feeds e contratos |
| Plano de incidentes | Rascunho em [plano-de-resposta-a-incidentes.md](../security/plano-de-resposta-a-incidentes.md); faltam os contatos da Vivo |
| Banco como ponto único de falha | Provado com Docker que a INIA aguenta o banco parado/congelado e volta sozinha; alta disponibilidade é infraestrutura (R-34) |

## 1. Onde está cada material

| Material | Onde | Situação |
|---|---|---|
| Glossário de segurança (81 termos, situação de cada um na INIA) | https://claude.ai/artifact/EoJwV43vjqnrLMegXAEjyc (privado; compartilhar pelo menu da página) | Pronto para consulta |
| Modelo do BP enviado pelo CDG | `~/Downloads/Modelo BP IA.xlsx` | Original, intacto |
| Rascunho do BP | `~/Downloads/BP INIA - rascunho.xlsx` | Textos e fórmulas prontos; faltam os números da operação (células amarelas da aba "Racional (descrição)", linha 58 em diante) |
| Script que gera o rascunho a partir do modelo | [tools/bp-vivo/preencher_bp.py](../../tools/bp-vivo/preencher_bp.py) | `python3 tools/bp-vivo/preencher_bp.py "<modelo>.xlsx" "<saida>.xlsx"` (só biblioteca padrão). Edita o XML direto: abrir e salvar com openpyxl apaga o fluxograma da aba "Fluxo de Aprovação" e as listas de opções |
| Base para o DAS | [docs/security/mapa-de-superficies.md](../security/mapa-de-superficies.md), [docs/architecture/](../architecture/), ITs em `docs/manuais/` | Existe; falta montar no formato da Vivo |
| Base para o checklist de Segurança | [docs/security/](../security/README.md) (duas auditorias, configuração segura, riscos residuais) | Existe; o "Checklist de Projetos" da Vivo ainda não foi recebido |

## 2. As quatro etapas do e-mail

1. **CDG (Controle de Gestão, Gerência de Eficiência e Inovação)**: preencher o BP e enviar para validação. Dúvidas de
   preenchimento: Lucas Costa De Paula ou Tais da Silva Oliveira. O fluxo da planilha mostra que, depois da implantação, o CDG
   **mede o ganho por 12 meses** — o número do BP vira compromisso.
2. **DAS (Documento de Arquitetura de Soluções)**: abrir Jira de alocação de arquiteto. Pré-requisitos: SPTI preenchida,
   aprovação financeira do LAB IA e projeto aberto no Jira. Aceita DAS aprovado ou dispensa de DAS.
3. **Segurança Digital**: chamado no service project de Arquitetura de Segurança, com o "Checklist de Projetos" + SPTI + DAS.
4. **LGPD (Vivo Privacy)**: obrigatório para a INIA (transcrições com CPF/telefone/protocolo de clientes; desempenho e
   afastamentos de colaboradores — tipo de afastamento pode revelar saúde, dado sensível). Sinalizar na SPTI.

## 3. Implementação na INIA

### Prioridade 1 — rápidos, não dependem de ninguém

**B1. Recusar subida em produção sem `CORS_ORIGIN`** (R-33) — P
- Hoje, sem a variável, a API assume `http://localhost:3000` (bloqueia em vez de abrir, mas esconde erro de instalação).
- Onde: `productionSecretProblems` em `backend/src/config/env.ts` (já recusa `JWT_SECRET` fraco).
- Pronto quando: `NODE_ENV=production` sem `CORS_ORIGIN` (ou com `*`) não sobe; teste no `env` cobre os dois casos.

**B2. Timeout de sessão por inatividade** — M
- Hoje a sessão vence 12 h depois do login (`JWT_EXPIRES_IN`), use a pessoa ou não. Checklists costumam pedir 15–30 min parado.
- Onde: `auth/infrastructure/jwt.ts`, `auth/presentation/require-auth.ts` (já confere sessão no banco a cada pedido),
  `session-cookie.ts`; aviso de "sua sessão vai expirar" na interface.
- Caminho provável: última atividade por `jti` no banco (gravada no máximo uma vez por minuto) + limite configurável por
  variável de ambiente.
- Pronto quando: a sessão parada além do limite recebe 401 e a interface volta ao login; teste de rota e prova no banco.

**B3. Backup agendado pela instalação + teste de restauração** — P
- Hoje o `pg_dump` diário está só descrito em `docs/instalacao/dois-servidores-windows.md`; ninguém agenda.
- Onde: `deploy/windows/servicos/instalar-servicos.ps1` (ou script próprio) + IT-INIA-003/009.
- Pronto quando: a instalação cria a tarefa agendada, as cópias vão para fora do servidor e há um teste de restauração
  registrado (quanto tempo levou = RTO real).

**B4. Verificação automática de dependências e de segredos** — P
- Hoje `npm audit` e a busca por segredos foram feitos à mão nas auditorias.
- Onde: repositório do GitHub (Dependabot + secret scanning) ou um script no `npm run` de verificação.
- Pronto quando: alerta automático de dependência vulnerável e de segredo commitado.

### Prioridade 2 — LGPD (o Vivo Privacy vai cobrar)

**B5. Máscara de dados pessoais na transcrição do próprio operador analisado** (R-31) — M
- Hoje só as transcrições dos colegas vão mascaradas para a IA (`investigation/domain/peer-privacy-projection.ts`,
  `PEER_PRIVACY_V1`: nome, CPF, telefone, e-mail, protocolo). A do operador analisado vai como está; nome de cliente não é
  mascarado em nenhuma.
- Cuidado: a citação literal da evidência é conferida contra o que o modelo recebeu — conferir contra a projeção, como já
  acontece com os pares. Prompts e versões são contratos: nova versão, nunca editar a antiga.
- Pronto quando: CPF/telefone/e-mail/protocolo do cliente não chegam ao provedor em nenhuma etapa; evidência continua
  verificável; transcrição original intacta para auditoria.

**B6. Tela de revisão das contestações de feedback** (LGPD art. 20) — M
- Hoje o colaborador marca "Este conteúdo foi útil?" → não, com motivo (ex.: `INACCURATE`) e descrição, e isso é gravado
  (`backend/src/modules/feedback-rating`, tabela `feedback_ratings`), mas **ninguém lê**.
- Precisa: lista para liderança/qualidade no escopo de quem lê, resposta ao colaborador e aviso no Sino/Pendências.
- Pronto quando: uma contestação chega a alguém responsável, tem resposta registrada e o colaborador vê a resposta.

**B7. Registro de leitura de dados pessoais sensíveis** — M
- Hoje `audit_logs` registra alterações e ações administrativas; leitura só é registrada na monitoria de usabilidade
  (`USABILITY_PERSON_VIEWED`, desligada no POC).
- Começar por: transcrições, afastamentos (situação funcional), conversas monitoradas
  (`assistant/application/conversation-monitoring.ts`) e ficha do colaborador.
- Pronto quando: dá para responder "quem viu os dados desta pessoa e quando"; volume controlado (gravação em lote).

**B8. Rotina de direitos do titular (exportar e eliminar/anonimizar os dados de uma pessoa)** — G
- Hoje um pedido só seria atendido por consulta manual ao banco.
- Reaproveitar o catálogo de retenção (`data-lifecycle/domain/retention-catalog.ts`), que já sabe filhos, proteções e
  bloqueios por FK.
- Decidir antes: eliminar × anonimizar quando o dado sustenta evidência ou auditoria de um caso.
- Pronto quando: exportação completa de uma pessoa e eliminação/anonimização com relatório do que saiu e do que ficou
  (e por quê).

**B9. Ligar a retenção com os prazos decididos** — P (depois da decisão)
- O mecanismo existe (migration 140, `data_retention_policies`), todas as regras desligadas e sem prazo; ligar exige prazo,
  `decided_at` e `decided_by`. Bloqueadas mesmo se ligadas: `indicator_measurements` e `workflow_enrollments`.

### Prioridade 3 — segurança, sem decisão externa

**B10. Rotação da chave mestra `DATA_HUB_SECRET_KEY` com recifragem e AAD** (R-12, R-25) — M
- Hoje trocar a chave obriga a redigitar todas as credenciais da Central de Dados e das conexões de IA.
- Pronto quando: comando que recifra tudo com a chave nova (nova `key_version`, AAD = organização + fonte + propósito) e
  passo a passo em `docs/security/configuracao-segura.md`.

**B11. Token da API Push com validade e lista de IPs** (R-28, R-29) — M
- Junto: autenticar o token antes de ler o corpo; guardar o hash do corpo por `Idempotency-Key` (422 em conflito).

**B12. Endurecimentos restantes do R-33** — M
- Cookie `__Host-inia_session` com HTTPS; botão "Sair de todos os aparelhos"; chave de HMAC derivada por rótulo (HKDF).

**B13. Medir o uso da voz** (R-30) — P/M, só se a voz entrar no POC
- Registrar o `usageMetadata` do Gemini Live como estimativa e contar no orçamento.

**B14. Arquivos `docs/CHAMADAS - *.rtf`** — P
- Têm nomes de operadores e trechos com CPF/protocolo. Confirmar se são simulados; se algum for real, tirar do repositório e
  do próximo snapshot do GitHub.

### Prioridade 4 — dependem de decisão ou informação da Vivo

**B15. SSO com o Entra ID (OIDC) e MFA pelo provedor de identidade** — G
- Depende de: a Segurança confirmar se é exigência já no POC; dados do Entra ID (tenant, aplicativo, endereço de retorno,
  qual atributo liga à pessoa — provavelmente o e-mail).
- Impactos a resolver: ciência do feedback hoje pede login e senha da INIA (`POST /feedback-read-confirmations`) → virar
  reautenticação no Entra ID; liberação de acesso com senha temporária e primeiro login deixam de valer para quem entra por
  SSO; decidir se login próprio continua (ex.: administrador de contingência).

**B16. Segredos vindos do cofre da Vivo** — M
- Depende de saber qual cofre (Azure Key Vault, CyberArk, HashiCorp Vault). Primeiro candidato: `DATA_HUB_SECRET_KEY`.

**B17. Provedor/SDK de IA liberado pelo LAB IA** — M a G
- Se for compatível com OpenAI, Anthropic ou Gemini, é configuração (Administração › IA / Modelos); senão, adapter novo em
  `ai-management/infrastructure/adapters/`. A Vertex AI não é suportada hoje.
- Medir a qualidade do feedback com o modelo novo (nunca medida fora do Gemini) e atualizar o custo por feedback no BP.
- Voz continua presa ao Gemini; decidir se entra no POC.

**B18. Container** — M, só se a Arquitetura exigir
- Hoje: serviços do Windows + IIS + PostgreSQL.

**B19. Implementar a opção escolhida para a "conta-fantoche"** (R-05) — M

**B20. Conta de serviço sem privilégio como padrão** (R-32) — P, precisa de Windows
- Validar `-ContaServico "NT AUTHORITY\LocalService"` na VM de homologação (`services.msc`, `/ready`, `logs\*.err.log`) e
  tornar padrão.

**B21. OpenAPI da API Push** — P/M, se integradores pedirem

## 4. Documentos a produzir (não é código)

| Documento | Para | Observação |
|---|---|---|
| Números do BP | CDG | Monitorias/mês, minutos por monitoria, % que a INIA assume, colaboradores no escopo, minutos do supervisor por colaborador, salários, horas/mês, mês de início, câmbio, infraestrutura, sustentação |
| SPTI | DAS, Segurança, LGPD | Pegar o modelo; declarar dados pessoais e sensíveis |
| Inventário de dados pessoais | SPTI, LGPD, RIPD | O que é coletado, de onde vem, para quê, onde fica, por quanto tempo, quem acessa, se vai para o provedor de IA |
| DAS | Arquitetura | Base em `docs/security/mapa-de-superficies.md` e nas ITs |
| Checklist de Projetos | Segurança Digital | Conferir linha a linha contra o glossário quando chegar |
| Plano de resposta a incidentes | SOC e Privacy | Rascunho da parte da INIA em `docs/security/plano-de-resposta-a-incidentes.md`; faltam contatos e prazos internos da Vivo |
| RPO, RTO e SLA | Negócio | Hoje, com backup diário, RPO prático de até 24 h; `npm run db:restore-check` mede o tempo de volta do banco (parte do RTO) |
| Classificação da informação | Política da Vivo | Sugestão: transcrições e afastamentos restritos; indicadores, feedbacks e conversas confidenciais |
| Manuais desatualizados | Instalação | R-11 (IT-INIA-002, 003, 004, 007, 008, 010) |

## 5. Decisões pendentes

| Decisão | Quem decide | Destrava |
|---|---|---|
| SSO obrigatório no POC ou só em produção | Segurança Digital | B15 |
| Provedor/SDK de IA e se a voz entra no POC | LAB IA | B13, B17, custo do BP |
| Período do BP: meses de 2026 do modelo ou 12 meses a partir da entrada em produção (em 19/10 ficou 2026, aguardando o CDG; jan–set estão ocultos na aba Racional) | CDG | Valor do ganho |
| Ganho orçamentário × gerencial | CDG | Classificação do BP |
| Prazos de retenção | Vivo Privacy | B9 |
| Eliminar × anonimizar nos pedidos do titular | Vivo Privacy | B8 |
| Opção (a), (b) ou (c) da conta-fantoche | Produto | B19 |
| Container exigido | Arquitetura | B18 |
| Qual cofre de senhas | Segurança / Infra | B16 |

## 6. Ordem sugerida

1. B1, B3 e B4 (rápidos) e o inventário de dados pessoais, que alimenta SPTI, LGPD e RIPD.
2. B2, B5, B6 e B7 — respondem às perguntas mais prováveis da Segurança e do Privacy.
3. B10, B11, B12 e B14.
4. B8, assim que o Privacy disser eliminar × anonimizar.
5. B15–B21 conforme as respostas da Vivo chegarem.
