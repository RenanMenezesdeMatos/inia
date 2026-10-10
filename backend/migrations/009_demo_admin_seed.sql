-- Grupo adicional para exemplificar regras diferentes por grupo (Grupo A / Grupo B)
insert into teams (id, organization_id, operation_id, name) values
  ('00000000-0000-4000-8000-000000000021', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000010', 'Contas');

insert into subteams (id, organization_id, team_id, name) values
  ('00000000-0000-4000-8000-000000000022', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000020', 'Retenção B2B — Fixa'),
  ('00000000-0000-4000-8000-000000000023', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000021', 'Contas — Pessoa Jurídica');

insert into subjects (id, organization_id, name, description) values
  ('00000000-0000-4000-8000-000000000040', '00000000-0000-4000-8000-000000000001', 'Segunda via', 'Emissão de segunda via de fatura'),
  ('00000000-0000-4000-8000-000000000041', '00000000-0000-4000-8000-000000000001', 'Reparo', 'Falha técnica ou instabilidade do serviço'),
  ('00000000-0000-4000-8000-000000000042', '00000000-0000-4000-8000-000000000001', 'Contestação de cobrança', 'Cliente questiona valor cobrado'),
  ('00000000-0000-4000-8000-000000000043', '00000000-0000-4000-8000-000000000001', 'Cancelamento', 'Solicitação de encerramento do contrato');

-- Pessoas novas cobrindo os perfis que ainda não existiam
insert into people (id, organization_id, team_id, name, role, job_title) values
  ('00000000-0000-4000-8000-000000000032', '00000000-0000-4000-8000-000000000001', null, 'Carla Nunes', 'ADMIN', 'Administradora da plataforma INIA'),
  ('00000000-0000-4000-8000-000000000033', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000020', 'Roberto Alves', 'MANAGER', 'Gerente de Atendimento B2B'),
  ('00000000-0000-4000-8000-000000000034', '00000000-0000-4000-8000-000000000001', null, 'Fernanda Dias', 'SENIOR_MANAGER', 'Gerente Sênior de Operações'),
  ('00000000-0000-4000-8000-000000000035', '00000000-0000-4000-8000-000000000001', null, 'Paulo Ricardo', 'DIRECTOR', 'Diretor de Operações'),
  ('00000000-0000-4000-8000-000000000036', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000021', 'Juliana Prado', 'OPERATOR', 'Especialista de Atendimento — Contas'),
  ('00000000-0000-4000-8000-000000000037', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000021', 'Bruno Teixeira', 'SUPERVISOR', 'Supervisor — Contas');

-- Contas de login para todos os perfis. Senha aleatória (ninguém a conhece): o seed de demonstração
-- (npm run db:seed:demo) define a senha destas contas a partir de INIA_DEMO_PASSWORD; sem demo, o setup as remove.
insert into user_accounts (organization_id, person_id, email, password_hash) values
  ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000030', 'ana.lima@inia.com', crypt(gen_random_uuid()::text, gen_salt('bf'))),
  ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000031', 'mariana.costa@inia.com', crypt(gen_random_uuid()::text, gen_salt('bf'))),
  ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000032', 'carla.nunes@inia.com', crypt(gen_random_uuid()::text, gen_salt('bf'))),
  ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000033', 'roberto.alves@inia.com', crypt(gen_random_uuid()::text, gen_salt('bf'))),
  ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000034', 'fernanda.dias@inia.com', crypt(gen_random_uuid()::text, gen_salt('bf'))),
  ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000035', 'paulo.ricardo@inia.com', crypt(gen_random_uuid()::text, gen_salt('bf'))),
  ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000036', 'juliana.prado@inia.com', crypt(gen_random_uuid()::text, gen_salt('bf'))),
  ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000037', 'bruno.teixeira@inia.com', crypt(gen_random_uuid()::text, gen_salt('bf')));

-- Bases de conhecimento de exemplo (texto), com escopos variados
insert into knowledge_documents (id, organization_id, title, document_type, source_type, created_by) values
  ('00000000-0000-4000-8000-000000000050', '00000000-0000-4000-8000-000000000001', 'Procedimento de Segunda via de Fatura', 'PROCEDURE', 'TEXT', (select id from user_accounts where email = 'carla.nunes@inia.com')),
  ('00000000-0000-4000-8000-000000000051', '00000000-0000-4000-8000-000000000001', 'Checklist de Encerramento de Chamada', 'PROCEDURE', 'TEXT', (select id from user_accounts where email = 'carla.nunes@inia.com')),
  ('00000000-0000-4000-8000-000000000052', '00000000-0000-4000-8000-000000000001', 'Manual de Tratativa de Reparo', 'MANUAL', 'TEXT', (select id from user_accounts where email = 'carla.nunes@inia.com'));

insert into knowledge_versions (id, organization_id, document_id, version, content, status, effective_from, content_hash) values
  ('00000000-0000-4000-8000-000000000060', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000050', 1,
   'A segunda via da fatura deve ser oferecida prioritariamente pelo Portal de Informações, sem necessidade de reenvio por e-mail. Confirme o CNPJ, valide o cadastro e oriente o cliente sobre o caminho: Portal de Informações > Financeiro > Segunda via.',
   'PUBLISHED', now(), encode(digest('proc-segunda-via-v1', 'sha256'), 'hex')),
  ('00000000-0000-4000-8000-000000000061', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000051', 1,
   'Antes de encerrar qualquer chamada: (1) confirme a solução aplicada; (2) informe o número do protocolo; (3) explique o próximo passo e o prazo; (4) confirme se o cliente tem mais alguma dúvida.',
   'PUBLISHED', now(), encode(digest('proc-checklist-v1', 'sha256'), 'hex')),
  ('00000000-0000-4000-8000-000000000062', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000052', 1,
   'Em chamados de reparo, valide o sinal remotamente antes de qualquer encaminhamento, confirme o melhor telefone de contato e a disponibilidade do cliente para a janela técnica, e registre o protocolo antes de encerrar.',
   'PUBLISHED', now(), encode(digest('proc-reparo-v1', 'sha256'), 'hex'));

insert into knowledge_document_org_scopes (knowledge_document_id, scope_type, team_id) values
  ('00000000-0000-4000-8000-000000000050', 'TEAM', '00000000-0000-4000-8000-000000000021'),
  ('00000000-0000-4000-8000-000000000051', 'ALL_TEAMS', null),
  ('00000000-0000-4000-8000-000000000052', 'ALL_TEAMS', null);

insert into knowledge_document_subject_scopes (knowledge_document_id, scope_type, subject_id) values
  ('00000000-0000-4000-8000-000000000050', 'SUBJECT', '00000000-0000-4000-8000-000000000040'),
  ('00000000-0000-4000-8000-000000000051', 'ALL_SUBJECTS', null),
  ('00000000-0000-4000-8000-000000000052', 'SUBJECT', '00000000-0000-4000-8000-000000000041');

-- Agentes configuráveis (apenas configuração — sem execução de IA nesta etapa)
insert into agents (id, organization_id, name, agent_type, objective, description, context_prompt, created_by) values
  ('00000000-0000-4000-8000-000000000070', '00000000-0000-4000-8000-000000000001', 'Agente de Feedback de Chamadas', 'CALL_FEEDBACK',
   'Avaliar transcrições de chamadas e devolver feedback objetivo ao operador.',
   'Lê a transcrição da chamada, identifica o motivo do contato, consulta o que se espera para aquele motivo e grupo, verifica as bases de conhecimento do assunto e retorna o que foi feito corretamente (parabenizando) e o que deveria ter sido feito e não foi.',
   'Você é o Agente de Feedback de Chamadas da INIA. Para cada transcrição: identifique o assunto/motivo do contato; consulte as expectativas de chamada cadastradas para o grupo e assunto do operador; consulte as bases de conhecimento associadas; compare o que foi dito com o esperado; produza um feedback com o que foi bem feito e o que faltou, sempre citando a evidência (trecho da transcrição) e o procedimento relacionado. Nunca use texto gerado por você como evidência — evidência é sempre a transcrição ou o documento da base de conhecimento.',
   (select id from user_accounts where email = 'carla.nunes@inia.com')),
  ('00000000-0000-4000-8000-000000000071', '00000000-0000-4000-8000-000000000001', 'Agente de Indicadores', 'INDICATOR_FEEDBACK',
   'Explicar o resultado de indicadores do operador e recomendar melhoria com base nos melhores resultados.',
   'Lê os resultados do operador, o contexto do dia, consulta o glossário e a regra de cálculo do indicador para o grupo do operador, e busca na base de diagnósticos as melhores práticas de quem tem os melhores resultados para recomendar uma ação concreta.',
   'Você é o Agente de Indicadores da INIA. Para cada indicador do operador: use a regra de cálculo cadastrada para o grupo/subgrupo dele (período e método podem variar por grupo); use o glossário do indicador para explicar o que ele mede; consulte os diagnósticos de melhores práticas do mesmo motivo/indicador; recomende uma ação concreta e verificável, nunca uma meta vaga.',
   (select id from user_accounts where email = 'carla.nunes@inia.com')),
  ('00000000-0000-4000-8000-000000000072', '00000000-0000-4000-8000-000000000001', 'Agente de Diagnóstico', 'DIAGNOSTICS',
   'Identificar padrões nas transcrições dos operadores com melhores resultados e transformar em recomendações.',
   'Lê as transcrições dos colaboradores com melhores resultados em cada indicador, identifica padrões de comportamento e fraseologia, e gera insights de melhores práticas que alimentam o Agente de Indicadores.',
   'Você é o Agente de Diagnóstico da INIA. Compare transcrições de operadores com resultado acima da meta contra operadores com resultado abaixo, para o mesmo motivo de contato; identifique diferenças de comportamento, ritmo e fraseologia; produza um achado com tamanho de amostra, grupo de referência, diferença medida e um exemplo de frase — sempre rastreável às transcrições de origem.',
   (select id from user_accounts where email = 'carla.nunes@inia.com'));

insert into agent_knowledge_documents (agent_id, knowledge_document_id) values
  ('00000000-0000-4000-8000-000000000070', '00000000-0000-4000-8000-000000000050'),
  ('00000000-0000-4000-8000-000000000070', '00000000-0000-4000-8000-000000000051'),
  ('00000000-0000-4000-8000-000000000070', '00000000-0000-4000-8000-000000000052'),
  ('00000000-0000-4000-8000-000000000071', '00000000-0000-4000-8000-000000000051'),
  ('00000000-0000-4000-8000-000000000072', '00000000-0000-4000-8000-000000000051'),
  ('00000000-0000-4000-8000-000000000072', '00000000-0000-4000-8000-000000000052');

-- Regra de cálculo do TMA diferente por grupo (Grupo A mensal, Grupo B semanal)
insert into indicator_calculation_rules (organization_id, indicator_definition_id, scope_type, team_id, calculation_period, calculation_method, attainment_rule) values
  ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000300', 'TEAM', '00000000-0000-4000-8000-000000000020', 'MONTHLY',
   'Média do tempo de atendimento (URA + fala) somado no mês, dividida pela quantidade de chamadas atendidas no mês.',
   'Atingimento apurado ao fim do mês: TMA do mês ≤ meta vigente.'),
  ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000300', 'TEAM', '00000000-0000-4000-8000-000000000021', 'WEEKLY',
   'Média do tempo de atendimento por semana operacional (segunda a domingo), recalculada a cada semana fechada.',
   'Atingimento apurado por semana: TMA da semana ≤ meta vigente; o resultado do mês é a média das semanas fechadas.');

-- Expectativas de chamada por grupo e assunto
insert into call_expectations (organization_id, scope_type, subject_scope_type, expectation) values
  ('00000000-0000-4000-8000-000000000001', 'ALL_TEAMS', 'ALL_SUBJECTS', 'Informar o número do protocolo do atendimento antes de encerrar a chamada.');

insert into call_expectations (organization_id, scope_type, team_id, subject_scope_type, subject_id, expectation) values
  ('00000000-0000-4000-8000-000000000001', 'TEAM', '00000000-0000-4000-8000-000000000021', 'SUBJECT', '00000000-0000-4000-8000-000000000040',
   'Informar que a 2ª via da fatura pode ser obtida pelo Portal de Informações, sem necessidade de reenvio por e-mail.');
