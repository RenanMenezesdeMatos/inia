> Anexo da segunda rodada da auditoria de segurança (17/10/2026). Relatório de trabalho de uma das quatro frentes, escrito sobre o código ANTES das correções (HEAD 27726180); as correções e o estado final estão em ../../relatorio-de-achados.md e ../../pendencias-e-riscos.md. Caminhos citados fora do repositório (scratchpad) eram arquivos temporários de prova e não fazem parte da entrega.

# A1 — Autenticação, sessões, permissões administrativas e plataforma HTTP (prefixo AUTH)

Auditor: A1 · Data: 17/10/2026 · Branch: admin-list-standardization (HEAD 27726180) · Somente leitura.
Base de comparação: auditoria de 08/10/2026 (eae6a43b, SEC-01…34, R-01…18). Itens já corrigidos lá não são repetidos,
só citados quando o código novo (7222b539 worker threads, 141a9b10 limites no PostgreSQL, 9ec95073/18f00db1 pessoas,
9c2de0f5 pacote de configuração, 38b4c07d métricas) mudou o comportamento.

Status: CONCLUÍDO (cobertura no fim do arquivo).

## Resumo

| Gravidade | Qtde | Achados |
|---|---|---|
| Crítica | 0 | — |
| Alta | 0 | — |
| Média | 5 | AUTH-1 trava de login contornável por concorrência · AUTH-2 teto por IP não segura rajada + fila de bcrypt sem limite (DoS do login/ciência) · AUTH-3 bloqueio de qualquer conta por terceiros · AUTH-5 delegação de permissões que o concedente não tem + custódia (R-05 ampliado) · AUTH-13 conta pré-cadastrada por administrador de Grupo assumida quando a carga a liga (vínculo automático sem custódia) |
| Baixa | 11 | AUTH-4, AUTH-6, AUTH-7, AUTH-8, AUTH-9, AUTH-10, AUTH-11, AUTH-12, AUTH-14, AUTH-15, AUTH-16 |
| Informativa | 1 | AUTH-17 (lista de endurecimentos) |

Prioridade sugerida: AUTH-1 + AUTH-2 + AUTH-3 juntos (mesma porta: login), AUTH-13 (fecha um caminho equivalente ao SEC-08),
AUTH-5 (decisão de produto sobre R-05), depois AUTH-7/AUTH-6/AUTH-8. AUTH-1 e AUTH-2 têm prova de conceito executada (banco
falso, ver nota depois do AUTH-3). Nada foi alterado no repositório.

## Achados

### AUTH-1 — Trava de login por conta contornável por concorrência (verificar → bcrypt → gravar sem trava)
- Gravidade: Média
- Classificação: CONFIRMADA (caminho lido de ponta a ponta; a corrida é a mesma que o SEC-20 corrigiu na ciência)
- Local: `backend/src/modules/auth/application/authenticate.ts:35-47` (lê `recentFailures`, confere a senha, só depois
  `recordAttempt`); `backend/src/modules/auth/infrastructure/postgres-credential-store.ts:76-89` (consultas soltas, sem
  transação nem `pg_advisory_xact_lock`).
- Evidência: a decisão "bloqueado" é tomada sobre as falhas JÁ gravadas. N requisições simultâneas para o mesmo e-mail leem
  todas `failures < 5` antes que qualquer uma grave a falha (o bcrypt de ~60 ms + fila do pool fica no meio). O único teto
  atômico que sobra é o `login-ip-email` do `app.ts:191` (consume atômico, 20 por IP+e-mail a cada 5 min). Resultado: a
  regra de produto "5 falhas em 15 min por identificador" vira "≈20 por IP a cada 15 min" (rajada de 20 → trava 15 min →
  nova rajada), e com K endereços de origem, ≈20·K tentativas por janela contra a MESMA conta — exatamente o que a trava por
  identificador deveria impedir independentemente do IP.
- Cenário de exploração: atacante sem conta, com alguns IPs (proxies, IPv6 de uma /64, VDI), escolhe o e-mail de um
  Administrador geral (formato nome.sobrenome previsível) e dispara rajadas paralelas de 20 senhas comuns por IP
  ("Vivo2026", "Mudar123"…, compatíveis com a política mínima de 8 caracteres + letra + número). Senha fraca é achada muito
  mais rápido do que o desenho prevê.
- Correção sugerida: serializar por identificador como no SEC-20 — numa transação: `pg_advisory_xact_lock(hashtext(identifier_hash))`
  → `recentFailures` → (fora da trava, ou com a trava, aceitando o custo) conferir a senha → `recordAttempt`. Alternativa mais
  barata: gravar a tentativa como `PENDING` ANTES do bcrypt (conta para a trava) e atualizar para o resultado depois; a
  contagem passa a incluir as pendentes.
- Teste de regressão sugerido: prova com Postgres (`INIA_DB_PROOF`), 20 logins errados em paralelo para o mesmo e-mail →
  no máximo 5 conferências de senha (contar chamadas do `verifyPassword`) e as demais 429 `LOGIN_TOO_MANY_ATTEMPTS`; login
  certo sequencial depois da janela continua entrando.

### AUTH-2 — Teto de recusas por IP (`countOnlyFailures`) não limita rajadas paralelas; fila de bcrypt sem limite (DoS do login e da ciência)
- Gravidade: Média
- Classificação: CONFIRMADA (leitura do middleware e do pool)
- Local: `backend/src/shared/presentation/rate-limit.ts:58-67` (regras `countOnlyFailures` usam `store.check` e só gravam no
  `finish`); `backend/src/main/app.ts:192` (`login-ip-failures`), `:198` (`push-failures-ip`), `:205`
  (`read-confirmation-account`); `backend/src/modules/auth/infrastructure/password-hasher.ts:30-32,104-109` (fila `queue`
  sem teto nem prazo; `POOL_SIZE` = 1 a 4 threads).
- Evidência: `check` não reserva vaga; a falha só entra no contador quando a resposta termina. Um cliente que manda 5.000
  logins em paralelo, cada um com um e-mail diferente (o `login-ip-email` tem um balde por e-mail, então não segura), passa
  inteiro pelo `login-ip-failures` (o contador ainda está em 0 quando todos são conferidos). Cada login (inclusive de e-mail
  inexistente — hash fictício) enfileira um bcrypt de custo 10 (~60 ms de CPU). Com 1–4 threads, 5.000 tarefas = 75 a 300 s
  de fila; os logins legítimos (e a confirmação de ciência com senha, que usa o mesmo `verifyPassword`) entram no FIM da fila.
  Não há timeout: a requisição fica pendurada até o prazo do IIS/Node. Um único IP basta; o teto de 200 recusas/5 min só
  passa a valer depois que a rajada já entrou.
- Cenário de exploração: qualquer pessoa na rede que alcance a interface, sem conta, derruba a entrada na virada de turno
  (centenas de operadores sem conseguir logar por minutos) com um script de requisições paralelas.
- Correção sugerida: (1) nas regras de falha, reservar a vaga no início (`consume`) e devolver no `finish` quando a resposta
  for sucesso (`refund`), ou contar TODAS as tentativas por IP num teto mais alto; (2) teto de concorrência/fila no
  `password-hasher.ts` (ex.: `queue.length > POOL_SIZE * 50` → rejeitar com erro tratado como 503 `LOGIN_BUSY` e
  `Retry-After`), e prazo máximo de espera na fila; (3) opcional: limite de requisições de login simultâneas por IP.
- Teste de regressão sugerido: `createApp` com loja em memória e `loginPerIp: 3`; 50 logins em paralelo de e-mails
  distintos → no máximo 3 chegam ao `verifyPassword` (espiar a dependência); unitário do pool: com a fila cheia, a tarefa
  nova é recusada na hora e as em andamento terminam.

### AUTH-3 — Bloqueio de conta por terceiros (lockout por e-mail sem prova de posse): qualquer pessoa trava o login de qualquer conta, inclusive do Administrador geral
- Gravidade: Média
- Classificação: CONFIRMADA
- Local: `backend/src/modules/auth/application/authenticate.ts:35-40` (trava avaliada antes de conferir a senha — a senha
  CERTA também recebe 429); `backend/src/modules/auth/domain/login-throttle.ts:6-15`.
- Evidência: 5 falhas em 15 min para o identificador bloqueiam o login dele por até 15 min, para qualquer origem; a trava não
  distingue o dono (mesmo IP/dispositivo de sempre) do atacante. O limite por IP (200 recusas/5 min) permite a um único IP
  manter ~40 contas travadas a cada 5 min (5 tentativas cada), renovando a cada 15 min — ou seja, ~120 contas travadas
  continuamente por IP; com poucos IPs, a operação inteira. E-mails são previsíveis (nome.sobrenome@empresa).
- Cenário de exploração: um colaborador insatisfeito (ou alguém de fora com a lista de e-mails) roda um laço de 5 senhas
  erradas por conta a cada 15 min contra os supervisores e o Administrador geral: ninguém entra, inclusive quem precisaria
  reagir. Não exige conta nem privilégio.
- Correção sugerida: manter a trava contra força bruta, mas sem negar o dono: (a) trava por (identificador × IP) com
  limite alto e trava global por identificador só com atraso progressivo (backoff) em vez de negar a senha certa; ou (b)
  conferir a senha mesmo travado e, se ela estiver certa vinda de um IP/dispositivo já visto com sucesso para a conta,
  deixar entrar; (c) alerta ao Administrador geral quando muitas contas entram em trava ao mesmo tempo. Registrar a decisão
  de produto (bloqueio × disponibilidade) em `docs/security/pendencias-e-riscos.md` se ficar como está.
- Teste de regressão sugerido: 5 falhas de um IP A; login certo do IP B (ou do dispositivo conhecido) entra; o IP A
  continua recebendo 429.

> Prova de conceito executada para AUTH-1 e AUTH-2 (script fora do repositório,
> `scratchpad/audit/a1-scripts/login-race.mts`, banco FALSO em memória reproduzindo as consultas do
> `postgres-credential-store.ts`, `createApp` real, loja de limites em memória com a mesma semântica check/record da do
> PostgreSQL): (1) 20 logins errados em paralelo para o MESMO e-mail → 20 senhas conferidas e 20 respostas 401 (a trava de 5
> não atuou); (2) `loginPerIp: 3` e 40 logins paralelos com e-mails distintos → 40 chegaram ao login/bcrypt, 0 respostas 429;
> só a tentativa seguinte, depois da rajada, recebeu 429.

### AUTH-4 — Mudar o Grupo pelo cadastro não mexe no Subgrupo: a pessoa fica "Grupo B + Subgrupo do Grupo A" e continua no escopo do administrador do Grupo A (que pode trazê-la de volta)
- Gravidade: Baixa
- Classificação: CONFIRMADA (código), cenário depende de a pessoa ter Subgrupo e de o Grupo não ser controlado por feed vigente
- Local: `backend/src/modules/users/presentation/user-account-router.ts` PATCH `/:id` (o `update people` grava `team_id` e
  nunca `subteam_id`); `backend/src/modules/auth/application/manageable-scopes.ts:25-28` (escopo de Grupo inclui TODOS os
  Subgrupos filhos); `user-account-router.ts` `personInScope` (alcança por `team_id` OU `subteam_id`). Não há constraint
  ligando `people.subteam_id` ao `team_id` (`migrations/038_person_subteam.sql`).
- Evidência: um Administrador geral (ou quem administra A e B) move P de A/SA1 para B → P fica `team_id = B`,
  `subteam_id = SA1` (filho de A). Para o administrador só do Grupo A, `getManageableScopes` devolve `subteamIds ⊇ {SA1}` →
  `personInScope(P)` = verdadeiro: ele lista, abre, edita nome/nível de operador/situação funcional/jornada e — como o
  destino A está no escopo dele — faz `PATCH teamId = A` e traz P de volta. Também o administrador do Subgrupo SA1 (escopo
  SUBGROUP) continua com custódia de credencial sobre P via `authorizedTarget` (alcance por `subteamId`).
- Cenário de exploração: administrador escopado do Grupo A mantém poder (cadastro e, pelo Subgrupo, credencial) sobre uma
  pessoa que a organização transferiu para o Grupo B; pode desfazer a transferência.
- Correção sugerida: no PATCH, quando `teamId` muda, gravar `subteam_id = null` (ou exigir/aceitar `subteamId` validado como
  filho do novo Grupo); opcional: trigger/constraint que recuse `subteam_id` cujo `team_id` difere do da pessoa; e em
  `personInScope`/`requireOn` alcançar por Subgrupo só se o Subgrupo pertencer ao `team_id` atual.
- Teste de regressão sugerido: P em A/SA1, Administrador geral move P para B → `subteam_id` nulo; administrador de A recebe 404
  em GET/PATCH de P; administrador de B edita P normalmente.

### AUTH-5 — Delegação permite conceder papéis com permissões que o concedente não tem; junto com a custódia de credencial, vira escalada (R-05 ampliado)
- Gravidade: Média
- Classificação: CONFIRMADA (desenho; R-05 conhecido, mas a ampliação de PERMISSÃO não está registrada)
- Local: `backend/src/modules/access/domain/roles.ts:33,42` (`delegates` de ADMINISTRADOR e ADMINISTRADOR_DE_ACESSOS);
  `backend/src/modules/access/domain/access-decision.ts:48-61` (`checkDelegation` confere papel delegável, escopo e alcance,
  nunca "permissões do papel ⊆ permissões do concedente"); `access/application/account-access-service.ts:109-141` (habilitar
  e gerar senha temporária devolvem a senha a quem age).
- Evidência: ADMINISTRADOR_DE_ACESSOS só tem `access.*`, mas delega LEITOR_DE_CONVERSAS_INIA (`assistant_conversations.view`),
  ANALISTA_DE_USABILIDADE (pessoas identificadas + exportação), QA_DE_FEEDBACK, ANALISTA_DE_ACOMPANHAMENTO
  (`interventions.execute/approve`), GESTOR_DE_POLITICAS…, REPORT. ADMINISTRADOR delega ANALISTA_DE_ACOMPANHAMENTO
  (executar/aprovar intervenções), que a própria descrição do produto trata como separação de funções ("Executar e aprovar
  intervenções … não vêm com o papel"). O mesmo ator pode: Habilitar acesso de qualquer pessoa sem papel do escopo (ou gerar
  nova senha temporária) → recebe a senha → concede o papel delegável a essa conta → entra como ela.
- Cenário de exploração: ADMINISTRADOR_DE_ACESSOS do Grupo A habilita a conta de um operador do Grupo A, dá a ela
  LEITOR_DE_CONVERSAS_INIA (Grupo A), entra com a senha temporária, cria a senha "do operador" e lê todas as conversas do
  Grupo A com a INIA — permissão que o papel dele não tem. Mesmo caminho para executar/aprovar intervenções com um
  ADMINISTRADOR. A auditoria registra, mas nada impede.
- Correção sugerida: (a) regra em `checkDelegation`: permissões do papel pedido ⊆ permissões efetivas do concedente no
  escopo pedido, com exceção EXPLÍCITA e documentada só para o ADMINISTRADOR_GERAL (ou um papel "Administrador de acessos"
  marcado como custodiante sem delegação de dados); e/ou (b) separação de funções: negar `assignRole` quando o concedente é o
  autor do último `ACCESS_ENABLED`/`ACCESS_TEMPORARY_PASSWORD_ISSUED` da conta destinatária (consulta em `audit_logs`), e
  negar `issueTemporaryPassword`/`enableAccess` quando o ator concedeu papel à conta nos últimos N dias. Decisão de produto:
  registrar no `pendencias-e-riscos.md` (R-05) qual das duas.
- Nota: o mesmo caminho dá ao Administrador geral a decisão sensível de continuidade (`interventions.sensitive_decide`, papel
  AVALIADOR_DE_CONTINUIDADE, que o papel dele delega mas não contém) por uma conta-fantoche — a "decisão humana restrita"
  do CLAUDE.md passa a depender só da auditoria.
- Teste de regressão sugerido: ADMINISTRADOR_DE_ACESSOS (Grupo A) tenta conceder LEITOR_DE_CONVERSAS_INIA → 403 (opção a)
  ou: habilita a conta X e depois tenta conceder papel a X → 403 `ACCESS_SEPARATION_OF_DUTIES` (opção b); Administrador geral
  continua concedendo.

### AUTH-6 — `POST /admin/users` ainda aceita senha provisória escolhida por quem cadastra (previsível/reutilizável), ao contrário de "Habilitar acesso"
- Gravidade: Baixa
- Classificação: CONFIRMADA
- Local: `backend/src/modules/users/presentation/user-account-router.ts` `createUserSchema.password` e o `insert into
  user_accounts` do `POST /` (senha do corpo, só a política mínima); comparar com `auth/domain/temporary-password.ts:1-7`
  ("gerada pelo servidor (nunca escolhida por quem administra)") e `account-access-service.ts › newTemporaryCredential`.
- Evidência: o administrador digita a senha provisória; a política aceita "Mudar1234"/"Vivo2026" e nada impede usar a mesma
  para todas as pessoas cadastradas. Vale por `TEMPORARY_PASSWORD_TTL_HOURS` (padrão 72 h, até 720 h). Com AUTH-1, contas
  recém-criadas com provisória padrão viram alvo fácil de quem conhece o costume interno ("a senha inicial é Mudar…").
- Cenário de exploração: um colega que sabe a provisória padrão entra na conta de quem acabou de ser cadastrado antes do dono,
  cria a senha definitiva e fica com a conta.
- Correção sugerida: o `POST /admin/users` passa a gerar a senha com `generateTemporaryPassword()` e devolvê-la uma vez (com
  `Cache-Control: no-store`), como o `enableAccess`; o campo `password` sai do schema (ou é ignorado). Frontend mostra o
  `temporary-password-dialog`.
- Teste de regressão sugerido: POST sem `password` → 201 com `temporaryPassword` gerado (formato Xxxx-xxxx-xxxx) e hash
  diferente a cada chamada; POST com `password` → ignorado ou 400.

### AUTH-7 — Pessoa desativada pela Central de Dados não tem a conta desabilitada: reativada (pela carga ou pelo cadastro, sem custódia), volta com a senha antiga e até com tokens antigos
- Gravidade: Baixa
- Classificação: CONFIRMADA (código)
- Local: `backend/src/modules/data-hub/application/writers/master-data-writers.ts:204-221` (atualiza `people.active`, nunca
  `user_accounts`); `auth/infrastructure/postgres-credential-store.ts:19-21,25` (sessão = `ua.active AND people.active`);
  `user-account-router.ts` PATCH (`active: true` não passa por `assertCredentialChangeAllowed`; só `active === false` passa).
- Evidência: desligamento vindo da base só "esconde" a conta (pessoa inativa); `user_accounts.active` e `session_version`
  ficam iguais. Quando `people.active` volta a `true` (nova carga com a mesma matrícula — recontratação, carga corrigida,
  inversão por erro do cliente — ou PATCH de quem tem `people.manage` quando o campo não é controlado por feed vigente), a
  senha antiga, os papéis (inclusive Administrador geral) e qualquer JWT ainda não vencido (até 12 h, mesmo `sv`) voltam a
  valer. Contradiz a regra registrada em `docs/dev/memoria/acesso.md` ("reativar NÃO reabilita o login antigo").
- Cenário de exploração: um gestor desligado na base com um token copiado (ou a senha) recupera o acesso se a carga do dia
  seguinte vier com ele ativo por engano; um administrador de Grupo reativa pelo cadastro a pessoa de um ex-Administrador
  geral que a base desativou (sem custódia sobre ela).
- Correção sugerida: no writer de Colaboradores, quando `active` passa de true → false, aplicar a mesma instrução de
  desabilitar do PATCH (`user_accounts.active = false`, `session_version + 1`, auditoria `ACCESS_DISABLED` com
  `reason: PERSON_DEACTIVATED_BY_SOURCE`); no PATCH, `active: true` só reativa a pessoa (a conta continua desabilitada até
  "Habilitar acesso", que já tem custódia).
- Teste de regressão sugerido: carga EMPLOYEES desativa P → `user_accounts.active = false` e `sv` incrementado; nova carga
  reativa P → login com a senha antiga recusado (`ACCESS_DISABLED`) e token antigo 401.

### AUTH-8 — A API em produção aceita o `JWT_SECRET` de exemplo do `.env.example` e qualquer `DATA_HUB_SECRET_KEY` (até 1 caractere)
- Gravidade: Baixa
- Classificação: PREVENTIVA (o `env:init` gera valores aleatórios e o `doctor` acusa; a falha é só da API, que não se defende)
- Local: `backend/src/config/env.ts:149-160` (recusa só o literal `inia-dev-secret-change-me` e tamanho < 32);
  `backend/.env.example:68` (`JWT_SECRET=troque-por-um-valor-aleatorio-longo`, 35 caracteres — passa nas duas regras);
  `backend/src/modules/data-hub/infrastructure/aes-secret-store.ts:17-28` (qualquer texto vira chave por SHA-256; em produção
  só se exige "não vazio"); `env.ts:5` (`NODE_ENV` ausente = `development`, que aceita o segredo padrão).
- Evidência: instalação feita copiando o `.env.example` à mão (sem `env:init`) e trocando só `NODE_ENV=production` sobe sem erro
  com um segredo publicado no repositório; quem o conhece assina um JWT HS256 com `sub`/`organizationId`/`personId` de uma
  conta (ids aparecem em telas e respostas da API para quem tem acesso administrativo) e `sv` atual (normalmente 0) — o guard
  aceita, porque confere só a conta no banco. Igualmente, `DATA_HUB_SECRET_KEY=inia` cifra todas as credenciais da Central e
  da IA com uma chave adivinhável. Serviço iniciado sem `NODE_ENV` cai em desenvolvimento e aceita o segredo padrão.
- Cenário de exploração: administrador de infraestrutura que não rodou o `env:init` (ou restaurou um `.env` antigo) deixa a
  instalação com segredo conhecido; qualquer pessoa com acesso ao repositório/manual forja a sessão de um Administrador geral.
- Correção sugerida: em `env.ts`, em produção recusar `JWT_SECRET` que comece com `troque`/`change`, que seja igual a qualquer
  valor de `.env.example`, ou com entropia baixa (ex.: < 20 caracteres distintos); recusar `DATA_HUB_SECRET_KEY` que não seja
  64 hex ou base64 de 32 bytes (ou passphrase ≥ 32 caracteres); fazer o serviço Windows (WinSW) definir `NODE_ENV=production`
  no próprio `<env>` além do `.env`.
- Teste de regressão sugerido: `envSchema` + validação com `NODE_ENV=production` e o valor do `.env.example` → erro na
  subida; com valor de `env:init` → sobe.

### AUTH-9 — Pacote de configuração: caminho de arquivo vindo do `pacote.json` sem contenção na pasta (lê e envia qualquer arquivo da máquina de quem importa)
- Gravidade: Baixa
- Classificação: CONFIRMADA (código); exige um pacote adulterado
- Local: `backend/scripts/config-transfer/importar.ts:184-189` (`readFileSync(join(pasta, caminho))`), usado em `:433`
  (imagens do cenário) e `:486` (arquivo original da base de conhecimento); `formato.ts:89,156` (`caminho`/`sha256` vêm do
  pacote e o `sha256` não é conferido na importação).
- Evidência: `join(pasta, "../../backend/.env.txt")` ou `"../../../Users/<x>/Documents/planilha.pdf"` sai da pasta; o
  conteúdo vai como `file` multipart para `POST /api/v1/admin/knowledge` do DESTINO com a sessão do Administrador geral. O
  pacote é feito para circular entre instalações (homologação ↔ produção, fornecedor ↔ cliente).
- Cenário de exploração: quem entrega o pacote (fornecedor/consultor com acesso de leitura à base de conhecimento do destino)
  aponta `arquivo.caminho` para um arquivo sensível da máquina onde o importador roda (normalmente o servidor da INIA ou a
  estação do administrador); ao rodar `--executar`, o arquivo vira documento da base no destino.
- Correção sugerida: resolver o caminho e exigir que fique dentro de `join(pasta, "arquivos")`/`join(pasta, "imagens")`
  (`resolve(...)` + `relative(...)` sem `..` nem absoluto); conferir o `sha256` gravado no pacote antes de enviar; mostrar na
  simulação a lista de arquivos que serão enviados.
- Teste de regressão sugerido: em `config-transfer.test.ts`, pacote com `caminho: "../fora.txt"` → a simulação falha com
  mensagem clara e nada é enviado; caminho legítimo continua funcionando.

### AUTH-10 — Pacote de configuração guarda o cookie de sessão de Administrador geral DENTRO da pasta que é levada entre instalações
- Gravidade: Baixa
- Classificação: CONFIRMADA
- Local: `backend/scripts/config-transfer/cliente.ts:54-66,109-111` (`<pacote>/.sessao-destino.json`, `chmod 0600` — sem
  efeito em NTFS); `.gitignore` (ignora a pasta inteira, então não protege a cópia manual).
- Evidência: a sessão vale 12 h (`JWT_EXPIRES_IN`) e é de Administrador geral; o arquivo fica na mesma pasta que o fluxo
  manda copiar/zipar para outra máquina; o `--sair` é opcional. Na cópia para um compartilhamento/pendrive o cookie vai junto.
- Cenário de exploração: quem recebe a pasta (ou acessa o compartilhamento) usa o cookie dentro da validade e opera a INIA de
  destino como Administrador geral (sem senha). A trava de CSRF não atrapalha (cliente sem `Origin`).
- Correção sugerida: guardar a sessão fora do pacote (ex.: `os.homedir()/.inia/sessao-<hash do destino>.json` ou só em
  memória durante o comando), apagar ao terminar `--executar`, e na exportação/zip recusar/ignorar `.sessao-destino.json`.
- Teste de regressão sugerido: após `entrar`, nenhum arquivo de sessão dentro de `pasta`; `--executar` termina com logout.

### AUTH-11 — Capa do perfil gravada e servida com os metadados originais (EXIF/GPS) para toda a organização
- Gravidade: Baixa
- Classificação: CONFIRMADA
- Local: `backend/src/modules/profile-preferences/application/profile-preferences-service.ts:78-87` (grava o buffer recebido);
  `presentation/profile-preferences-router.ts:84-96` (serve o mesmo buffer a qualquer pessoa da organização);
  `frontend/src/components/profile/edit-profile/edit-profile-page.tsx` (a capa vai como o arquivo original; só a foto passa
  pelo `canvas` do `avatar-cropper.tsx`, que descarta EXIF).
- Evidência: validação só lê assinatura e dimensões; nada reescreve a imagem. Foto de celular usada como capa leva latitude/
  longitude, modelo do aparelho e data; qualquer colega da organização baixa por `GET /api/v1/profile-images/:id`.
- Cenário de exploração: colega (ou gestor) baixa a capa de uma operadora e extrai a localização da casa dela.
- Correção sugerida: reencodar no servidor (o `sharp` já está no lock do frontend; no backend, usar `sharp` ou remover os
  segmentos APP1/EXIF/XMP do JPEG e os chunks `eXIf`/`tEXt` do PNG antes de gravar); alternativamente o frontend reencoda a
  capa por `canvas` como já faz com a foto (defesa só no cliente não basta: a API aceita o upload direto).
- Teste de regressão sugerido: JPEG com EXIF GPS enviado como capa → a imagem servida não contém o marcador `Exif\0\0`.

### AUTH-12 — Política de senha sem lista de senhas comuns/previsíveis
- Gravidade: Baixa
- Classificação: CONFIRMADA
- Local: `backend/src/modules/auth/domain/password-policy.ts:20-31` (≥ 8, letra, número, sem o e-mail).
- Evidência: "Senha123", "Vivo2026", "Mudar123", "Inia2026" e o nome da empresa + ano passam. Somado ao AUTH-1 (rajadas por
  IP) e ao AUTH-6 (provisória escolhida), é o caminho mais provável de invasão de conta.
- Correção sugerida: lista de bloqueio local (top-10k + termos da organização: "vivo", "inia", "senha", "mudar", mês/ano)
  aplicada em `passwordPolicyViolations` (código novo `COMMON_PASSWORD`), espelhada no checklist do frontend; considerar
  mínimo de 10–12 caracteres para contas com papel administrativo.
- Teste de regressão sugerido: "Vivo2026" e "Senha@123" recusadas com `COMMON_PASSWORD`; senha forte aceita.

### AUTH-13 — "Uma pessoa, um cadastro": administrador de Grupo pré-cadastra uma conta com o e-mail de quem ainda vai chegar pela base e assume a conta quando a carga a liga (sem custódia sobre o lugar novo)
- Gravidade: Média
- Classificação: CONFIRMADA (caminho lido: POST de pessoa → vínculo automático por e-mail na carga → upsert pela matrícula);
  depende de o feed de Colaboradores trazer e-mail e de o alvo ser uma matrícula NOVA (contratação/transferência entrando na base)
- Local: `backend/src/modules/users/presentation/user-account-router.ts` `POST /` (escopado pode criar pessoa "Fora da
  hierarquia" sem matrícula no Grupo dele, com conta e senha provisória escolhida por ele); `backend/src/modules/data-hub/
  application/writers/person-identity.ts:19-45` (`linkByAccountEmail`: matrícula nova + e-mail igual ao da conta de uma pessoa
  sem matrícula → grava a matrícula NESSA pessoa); `master-data-writers.ts:197-224` (o upsert seguinte grava nível, Grupo,
  Subgrupo, cargo da base nessa mesma linha; nada mexe em `user_accounts`/`session_version`).
- Evidência: o vínculo automático é a "chave forte" do 9ec95073, mas ninguém confere QUEM controla a credencial da conta
  ligada. A conta continua com a senha que o administrador do Grupo A definiu (ou que ele mesmo trocou entrando antes do
  dono) e a sessão dele continua valendo — o guard relê `people.role` a cada request, então ele vira, na hora, o novo
  Supervisor/Gerente do Grupo B (com a estrutura que a carga de Estrutura apontar para ele). O vínculo MANUAL equivalente
  (`POST /:id/link`) exige `assertAccountRelinkAllowed` (custódia sobre o destino e sobre a estrutura que ele lidera); o
  automático não. A regra "nível de liderança só com escopo de organização" (SEC-06) também fica de fora.
- Cenário de exploração: ADMINISTRADOR do Grupo A sabe que "joana.silva@empresa.com" entra semana que vem como Supervisora do
  Grupo B (e-mail previsível). Cadastra "Joana Silva" Fora da hierarquia no Grupo A com esse e-mail e a provisória que quiser,
  entra e cria a senha definitiva. Na carga, a INIA liga a matrícula da Joana a essa conta: o administrador passa a ver os
  indicadores, feedbacks e a INIA de liderança da equipe dela no Grupo B, e pode confirmar ciência "como a Joana" (login e senha
  são dele). Funciona também com operadores de outros Grupos (ciência em nome deles). A Joana real descobre só quando tenta
  entrar. Segundo caminho, sem depender do e-mail na base: o `POST /` aceita MATRÍCULA nova ("cadastrar antes da carga,
  informe a matrícula exatamente como a base vai mandar") com nível de Operador no Grupo A; a carga faz o upsert por
  `(organization_id, matricula)` e grava ali o nível/Grupo/estrutura reais — mesma conta, mesma senha conhecida.
- Correção sugerida: no `linkByAccountEmail`, depois de ligar, tratar a credencial como a do vínculo manual: `session_version
  + 1` e conta desabilitada (ou troca obrigatória com senha temporária NOVA, gerada só quando alguém com custódia sobre o lugar
  novo clicar "Habilitar/Gerar senha"), com auditoria `ACCESS_DISABLED reason: LINKED_BY_SOURCE` e aviso na quarentena; ou só
  ligar automaticamente contas cuja credencial foi definida pelo próprio titular E criadas por quem tem escopo de organização.
  Complementar: AUTH-6 (provisória gerada pelo servidor) reduz, mas não resolve (o administrador recebe a gerada).
- Teste de regressão sugerido: prova `person-identity-proof`: administrador de Grupo A cria conta X com e-mail E; carga traz
  matrícula nova com e-mail E no Grupo B como SUPERVISOR → a conta X fica desabilitada/sem sessão (token antigo 401, senha
  antiga recusada) e a liberação exige custódia sobre o Grupo B.

### AUTH-14 — Limite da criação de senha do primeiro acesso é por IP, conta requisições anônimas e não acompanha a regra "cada pessoa com o seu contador" do login
- Gravidade: Baixa
- Classificação: CONFIRMADA
- Local: `backend/src/main/app.ts:193` (`first-password-ip`: 20 a cada 15 min por IP, `consume`, montado ANTES do guard de
  sessão do `/auth/password`).
- Evidência: o login passou a contar por IP+e-mail justamente porque a operação sai por um mesmo IP (Citrix/VDI/NAT); o
  primeiro acesso ficou por IP. No dia em que 300 operadores recebem a senha temporária e entram pelo mesmo IP, só 20 por 15 min
  conseguem criar a senha (os demais recebem 429). Como o limitador roda antes do `requireAuth`, 20 POSTs sem cookie de
  qualquer máquina atrás desse IP esgotam o balde de todos.
- Cenário de exploração: no dia da liberação, um script (ou um usuário insistente) atrás do NAT impede o primeiro acesso de
  toda a operação por 15 min, repetidamente.
- Correção sugerida: mover o limite para DEPOIS do guard de sessão e contar por conta (`accountKey`), mantendo um teto alto
  por IP só para requisições sem sessão válida.
- Teste de regressão sugerido: 30 contas distintas criando senha pelo mesmo IP → todas passam; 30 tentativas da MESMA conta →
  429 a partir do limite; POSTs sem cookie não consomem o balde das contas.

### AUTH-15 — `auth_login_attempts` cresce sem limite para identificadores que nunca entram (inexistentes ou alvos de ataque)
- Gravidade: Baixa
- Classificação: CONFIRMADA
- Local: `backend/src/modules/auth/infrastructure/postgres-credential-store.ts:87-95` (a limpeza de > 30 dias só roda no
  `markLoggedIn` do MESMO identificador); `backend/src/main/server.ts:124` (há tarefa periódica só para `rate_limit_hits`).
- Evidência: cada tentativa grava uma linha (inclusive `LOCKED`); e-mails inexistentes e contas atacadas que não logam nunca
  são limpos. Com o teto de 200 recusas/5 min por IP são ~57 mil linhas/dia por IP (muito mais com AUTH-2). O histórico (com
  `account_id`) também fica indefinidamente — dado pessoal sem retenção.
- Correção sugerida: tarefa periódica no processamento (como `rate-limit-purge`) apagando `attempted_at < now() - 30 days`
  (a trava só usa 15 min) e, se quiser forense, agregar antes.
- Teste de regressão sugerido: unitário da tarefa: linhas de 31 dias de identificador sem sucesso são apagadas; linhas de 10 min
  ficam e a trava continua contando.

### AUTH-16 — CSRF depende só da presença de `Origin`/`Sec-Fetch-Site`; escritas administrativas sem corpo aceitam qualquer `Content-Type`
- Gravidade: Baixa
- Classificação: PREVENTIVA (navegadores atuais mandam `Origin` em todo POST entre origens e respeitam `SameSite=Lax`)
- Local: `backend/src/shared/presentation/origin-guard.ts:21-31` (sem os dois cabeçalhos = passa); rotas sem corpo:
  `access-router.ts:48-54` (`/accounts/:id/temporary-password`, `/accounts/:id/disable`), `:65-68`
  (`/roles/:roleCode/grant-to-leaders`), `:44-47` (`/users/:personId/enable` com `request.body ?? {}`).
- Evidência: um formulário `<form method=POST enctype=text/plain>` vindo de outro site, num navegador que não manda `Origin`
  em envio de formulário e ignora `SameSite` (IE11 / modo IE do Edge, ainda comum em intranet corporativa), chega com o cookie
  e sem nenhum dos dois cabeçalhos → passa na guarda; essas rotas não leem corpo, então executam (desabilitar a conta de alguém,
  conceder um papel a todos os gestores). Rotas com corpo JSON ficam protegidas porque o `express.json` só lê
  `application/json` (o formulário não consegue enviar esse tipo).
- Correção sugerida: para escritas com o cookie de sessão, exigir também `Content-Type: application/json` (ou multipart nas
  rotas de upload) OU um cabeçalho próprio (ex.: `X-INIA-Request: 1`) que só o `fetch` da interface manda — ambos forçam
  preflight CORS; manter a conferência de `Origin` como está. Scripts (`config:importar`) já mandam JSON.
- Teste de regressão sugerido: `POST /admin/access/accounts/:id/disable` com cookie, sem `Origin`/`Sec-Fetch-Site` e
  `Content-Type: text/plain` → 403; com `Content-Type: application/json` (ou o cabeçalho próprio) → passa.

### AUTH-17 — Itens informativos / endurecimento
- Gravidade: Informativa · Classificação: PREVENTIVA
- `TRUST_PROXY` recusa só `true`, mas aceita número de saltos (`1`) e `0.0.0.0/0` (`env.ts:126`, `app.ts:parseTrustProxy`):
  com a API alcançável direto (HOST vazio — padrão do `env.ts` fora do `env:init`), o cliente forja `X-Forwarded-For` e cada
  requisição vira um IP novo nos limites. Sugestão: recusar números e redes `/0`, e avisar no `doctor` quando `HOST` não é
  loopback com `TRUST_PROXY ≠ false`.
- `JWT_SECRET` também é a chave do HMAC dos identificadores de login (`postgres-credential-store.ts:11-13`): separar por
  derivação (HKDF com rótulo) — não há exploração hoje (mensagens com prefixos distintos).
- Cookie de sessão sem prefixo `__Host-` (`session-cookie.ts`): com HTTPS, `__Host-inia_session` impede que um subdomínio
  irmão injete um cookie de mesmo nome (troca de sessão / "cookie tossing").
- Sem "sair de todos os aparelhos" para a própria pessoa (só o administrador, ao gerar senha nova, derruba todas); a senha
  temporária pode ser usada em vários logins até a troca (não é de uso único, só de validade).
- `PUT /api/v1/me/profile`: multer em memória até 2 × 8 MB por requisição, sem limite por conta (`profile-preferences-router.ts:10`);
  vários envios paralelos de uma conta pressionam a memória da API. Sugestão: `costly`/limite por conta e `fileSize` por campo.
- `CORS_ORIGIN` ausente em produção cai em `http://localhost:3000` (`env.ts:65`): recusar a subida em produção sem valor explícito.
- Proteção do "último Administrador geral" continua sem trava (R-06) e não cobre a desativação da pessoa pela Central de Dados
  (a carga pode tirar o último Administrador geral; a recuperação é só pela CLI `create-admin`).
- `POST /admin/users/:id/employment-status` não recusa a própria pessoa (as demais edições de "situação" recusam); efeito só em
  disponibilidade/analytics, não em acesso.

## Verificações sem achado (conferidas no código, com o caminho completo)

- **JWT**: assinatura e verificação só `HS256` (`jwt.ts:33-48`); payload sem `sub`/`organizationId`/`personId` string é
  recusado; `exp` conferido pelo `jsonwebtoken`; `jti` aleatório por sessão; `/me` não devolve `iat/exp/jti/sv/pc`.
  Testes `http-security.test.ts` (bloco sessão, `alg: none`) passam.
- **Sessão conferida no banco a cada request** (`require-auth.ts` + `postgres-credential-store.ts:51-64`): conta da
  organização do token, `ua.active AND people.active`, `session_version` igual ao `sv`, `jti` não revogado, troca pendente só em
  `/me` e `/password`, temporária vencida = 401. Sobem a versão (derrubam as outras sessões): desabilitar, habilitar de novo,
  nova senha temporária, criar a senha do primeiro acesso, inativar pelo cadastro, vínculo manual de pessoa. Papéis e
  permissões são lidos ao vivo (`requirePermission`/`describeAccess`), então mudança de papel vale na próxima request; o nível
  hierárquico é relido (`liveRole`). Logout grava o `jti` em `auth_revoked_sessions` (só aquela sessão — ver AUTH-17).
- **Cookie**: `httpOnly`, `secure` = `SESSION_COOKIE_SECURE` (auto = produção), `SameSite=Lax`, `path=/`, sem `Domain`
  (host-only), `maxAge` = validade do JWT.
- **Enumeração no login**: mesma resposta 401 `INVALID_CREDENTIALS` para e-mail inexistente e senha errada; bcrypt sempre (hash
  fictício de mesmo custo 10 para conta inexistente); a trava vale igual para e-mail inexistente; `ACCESS_DISABLED`/
  `TEMPORARY_PASSWORD_EXPIRED` só depois da senha certa. Primeiro acesso exige sessão (não há enumeração ali). Diferença de
  tempo só nas contas de demonstração das migrations 009/019 (`gen_salt('bf')` = custo 6), que o setup remove sem demo.
- **Senha**: bcrypt custo 10 (bcryptjs, comparação do próprio bcrypt); política única (≥ 8, ≤ 72 bytes, letra, número, sem o
  e-mail); senha temporária de `randomInt` (≈ 69 bits), só o hash no banco, devolvida uma vez com `no-store`, validade
  `TEMPORARY_PASSWORD_TTL_HOURS`, nova senha diferente da temporária, troca otimista pela versão. Pool de worker threads:
  falha de thread devolve a tarefa à fila e cai no bcrypt assíncrono depois de 3 falhas seguidas (sem perda de resposta) —
  o problema é só a fila sem teto (AUTH-2).
- **CSRF**: `origin-guard.ts` antes de todas as rotas, cobre POST/PUT/PATCH/DELETE (inclusive multipart) com o cookie;
  `Origin: null` e subdomínio irmão recusados; login/API Push sem cookie não passam pela guarda e o login exige JSON (não há
  login CSRF por formulário). Não há rota `route.ts`/server action no Next que repasse escrita com o cookie.
- **Delegação de papéis** (`access-decision.ts › checkDelegation`, `access-service.ts`): papel delegável + escopo coberto +
  pessoa alcançada; auto-atribuição negada (inclusive Administrador geral); escopo SUBGROUP tem o Grupo resolvido NO BANCO
  (`resolveScope`: o `teamId` do corpo é recusado junto com `subteamId`) — não dá para forjar Subgrupo de outro Grupo;
  MY_STRUCTURE só com escopo de organização; ORGANIZATION nunca coberto por escopo menor; revogação pela mesma regra; último
  Administrador geral protegido (corrida: R-06). "Conceder aos gestores" passa cada pessoa pela mesma regra.
- **Custódia de credencial** (`account-access-service.ts › authorizedTarget`): `access.users.manage` no escopo da pessoa
  (fora = 404), todos os papéis NÃO revogados da conta (inclusive de conta desabilitada — reabilitar um ex-Administrador geral
  exige poder conceder o papel dele), nunca a própria pessoa/conta, estrutura liderada inteira no escopo. Aplicada em
  habilitar, nova senha temporária, desabilitar, `PATCH` de e-mail/inativação e no vínculo manual (origem e destino).
- **`/admin/users`**: guarda `/:id` de escopo antes de todas as rotas com id (404 fora); `creation-policy` antes da guarda;
  nível de liderança só com escopo de organização (criar e mudar); destino de mudança de Grupo no escopo; ninguém muda o
  próprio nível/Grupo/e-mail/situação; campos da base recusados antes de qualquer gravação; 409 de matrícula só devolve o id
  se a pessoa estiver no escopo; INSERT/UPDATE com colunas explícitas (sem atribuição em massa; zod descarta campos
  desconhecidos; `link` e o perfil usam `.strict()`).
- **Perfil**: sempre a pessoa da sessão (não há parâmetro de pessoa); schema estrito; imagem validada pelo conteúdo (só JPEG/
  PNG/WebP, dimensões lidas do cabeçalho, SVG fora); servida só se estiver em uso, da mesma organização, com `nosniff`,
  `CSP default-src 'none'` e `content-type` do servidor; leitura do cabeçalho JPEG sem laço infinito/estouro.
- **Plataforma**: `x-powered-by` desligado, helmet, JSON ≤ 1 MB (10 MB só no API Push), query parser simples do Express 5,
  `no-store` em `/api`, 404 genérico, erro 500 sem detalhe e log sem corpo/cookie/query, `INVALID_JSON`/`PAYLOAD_TOO_LARGE`/
  `INVALID_IDENTIFIER` como 4xx; CORS por lista exata com credenciais; compressão nunca no SSE. `/internal/metrics`: socket
  loopback (nunca o `X-Forwarded-For`), nenhum cabeçalho de proxy (`x-forwarded-for`, `x-arr-log-id`, `x-original-url`…),
  token opcional comparado com `timingSafeEqual` (tamanho conferido antes), e o `web.config` responde 404 a `/internal`.
  `/ready` não expõe nada além do motivo. Limites no PostgreSQL: `consume` atômico (condição avaliada com a linha travada),
  balde = regra + SHA-256 da chave (sem IP/e-mail em claro), purga periódica; falha da loja deixa passar (documentado).
  `trust proxy` = `loopback` no `env:init`, `HOST=127.0.0.1`, `NODE_ENV=production`; ARR sem porta no `X-Forwarded-For`.
- **Pacote de configuração**: a importação usa só as rotas da API com a sessão do Administrador geral (permissões e validação
  do servidor valem; nada grava direto no banco do destino); senha lida sem eco e nunca gravada; a exportação lê o banco só
  para leitura e NÃO leva segredos (chaves de IA, credenciais da Central, hashes de senha, tokens de push) — leva prompts,
  bases (inclusive o arquivo original), imagens do cenário e nomes/matrículas de pessoas citadas em Workflows (conteúdo
  confidencial; `.gitignore` cobre `pacote-configuracao-*/`). Problemas: AUTH-9, AUTH-10.
- **Montagem no `app.ts`**: toda montagem fora de `/auth`, `/health`, `/ready`, `/internal/metrics` e `/data-ingestion` (token
  próprio) passa por `requireAuth` direto ou por `can(...)` (= `[requireAuth, guard]`); `/admin/access`, `/admin/ai`,
  `/admin/intervention-policies` e `/interventions` só com `requireAuth` e checagem dentro do serviço (conferido para
  `/admin/access`; os outros são de outras áreas). Governança no prefixo `/api/v1/admin` montada por último; catálogos da
  organização com `writesRequireOrganization`.
- Testes rodados (sem alterar nada): `npx vitest run http-security user-account-router auth-flows auth-domain access-service
  password-hasher auth-router` → 10 arquivos, 106 testes, todos passando.

## Cobertura

| Módulo / arquivo de rota | Rotas (método + caminho) | Como autentica | Como autoriza o OBJETO | Resultado |
|---|---|---|---|---|
| `auth/presentation/auth-router.ts` | POST `/api/v1/auth/login` | pública; limites `login-ip-email` (consume) e `login-ip-failures` (check) no `app.ts` | trava por HMAC do e-mail (`authenticate.ts`) | AUTH-1, AUTH-2, AUTH-3, AUTH-12 |
| idem | POST `/api/v1/auth/logout` | sem guarda; token verificado (HS256) se houver | revoga só o `jti` do próprio token, conta da organização do token | ok |
| idem | POST `/api/v1/auth/password` | `createRequireAuth({allowPendingPasswordChange})`; limite por IP antes | conta da sessão; exige troca pendente e temporária válida; otimista por `sv` | AUTH-14 |
| idem | GET `/api/v1/auth/me` | `createRequireAuth({allowPendingPasswordChange})` | conta/pessoa da sessão; acesso ao vivo; vazio com troca pendente | ok |
| `auth/presentation/require-auth.ts`, `auth/infrastructure/{jwt,postgres-credential-store,password-hasher}.ts`, `auth/domain/*` | (guard de todas as rotas) | JWT HS256 + estado da conta no banco | — | ok; AUTH-2 (fila), AUTH-8, AUTH-15, AUTH-17 |
| `auth/application/manageable-scopes.ts` | (escopos de `people.manage`, `configuration.manage`…) | — | Grupo → Grupo + Subgrupos filhos | AUTH-4 |
| `access/presentation/access-router.ts` (`requireAuth` no `app.ts`) | GET `/admin/access/roles` | requireAuth | `access.roles.view` em algum escopo (catálogo) | ok |
| idem | GET `/admin/access/scope-options` | requireAuth | `access.roles.assign`; só Grupos/Subgrupos do escopo | ok |
| idem | GET `/admin/access/users` | requireAuth | `access.users.view`; filtro de visibilidade no SQL | ok |
| idem | POST `/admin/access/users/:personId/enable` | requireAuth | `access.users.manage` no escopo da pessoa (404) + custódia + estrutura liderada; pessoa ativa | AUTH-5 (desenho), AUTH-16 |
| idem | POST `/admin/access/accounts/:accountId/temporary-password` | requireAuth | idem (alvo pela conta) | AUTH-5, AUTH-16 |
| idem | POST `/admin/access/accounts/:accountId/disable` | requireAuth | idem + último Administrador geral | ok (R-06 residual), AUTH-16 |
| idem | GET `/admin/access/accounts`, GET `/admin/access/accounts/:accountId` | requireAuth | `access.users.view`; visibilidade / `requireOn` (404) | ok |
| idem | POST `/admin/access/accounts/:accountId/roles` | requireAuth | `checkDelegation` (papel delegável, escopo resolvido no banco e coberto, pessoa alcançada, nunca a si) | AUTH-5 |
| idem | POST `/admin/access/roles/:roleCode/grant-to-leaders` | requireAuth | `checkDelegation` por líder; MY_STRUCTURE só com organização | ok, AUTH-16 |
| idem | DELETE `/admin/access/accounts/:accountId/roles/:assignmentId` | requireAuth | `checkDelegation(allowSelf)` + atribuição da conta indicada + último Administrador geral | ok (R-06 residual) |
| `access/presentation/require-permission.ts` | (`can(...)`, `writesRequireOrganization`, `organizationWide`) | requireAuth embutido | permissão em algum escopo / na organização; escrita só com organização | ok |
| `access/application/*`, `access/domain/*`, `access/infrastructure/*` | (casos de uso acima) | — | — | ok; AUTH-5 |
| `users/presentation/user-account-router.ts` (`can("people.manage")`) | GET `/admin/users/creation-policy` | requireAuth + `people.manage` | dado da organização (fontes vigentes), sem pessoa | ok |
| idem | GET `/admin/users` | idem | filtro por Grupos/Subgrupos de `people.manage` | ok (AUTH-4 afeta quem aparece) |
| idem | GET `/admin/users/:id` | idem + guarda `/:id` | `personInScope` (404) | ok (AUTH-4) |
| idem | POST `/admin/users` | idem | Grupo do corpo no escopo de `people.manage` E de `access.users.manage`; liderança só organização; matrícula/porta única | AUTH-6, AUTH-13 |
| idem | PATCH `/admin/users/:id` | idem + guarda `/:id` | campos da base; nunca a própria pessoa; liderança só organização; destino no escopo; custódia em e-mail/inativar; último Administrador geral | AUTH-4, AUTH-7 |
| idem | POST `/admin/users/:id/link` | idem + guarda `/:id` | destino no escopo; nunca a própria; `assertAccountRelinkAllowed` (custódia nas duas) | ok |
| idem | GET/POST `/admin/users/:id/employment-status`, GET/PUT `/admin/users/:id/shift` | idem + guarda `/:id` | pessoa no escopo e da organização | ok (AUTH-17: própria situação) |
| `people/application/person-source-link.ts` | (vínculo manual) | — | pré-condições travadas na transação; `sv + 1` | ok |
| `data-hub/application/writers/person-identity.ts` + `master-data-writers.ts` (só o efeito sobre contas) | (carga EMPLOYEES) | token/sessão da Central (outra área) | vínculo automático por e-mail e upsert por matrícula sem custódia; desativação sem desabilitar a conta | AUTH-13, AUTH-7 (resto da Central: outra área) |
| `profile-preferences/presentation/profile-preferences-router.ts` | GET `/api/v1/me/profile` | requireAuth | pessoa da sessão | ok |
| idem | PUT `/api/v1/me/profile` (multipart) | requireAuth | pessoa da sessão; schema estrito; imagem pelo conteúdo | AUTH-11, AUTH-17 (memória) |
| idem | GET `/api/v1/profile-images/:id` | requireAuth | mesma organização + imagem em uso | ok (AUTH-11: metadados) |
| `profile-preferences/application/*`, `domain/*` | (nome de tratamento, apresentação) | — | sempre a pessoa da sessão/destinatário | ok (nome vai a prompts só da própria pessoa; alfabeto restrito) |
| `main/app.ts` | GET `/health`, GET `/ready` | públicas | — | ok |
| idem | GET `/internal/metrics` | loopback do socket + sem cabeçalho de proxy + token opcional (tempo constante) | — | ok |
| idem | middlewares (helmet, compressão, CORS, JSON 1 MB, cookies, origin-guard, `no-store`, limites), 404, tratador de erros, `trust proxy` | — | — | AUTH-2, AUTH-14, AUTH-16, AUTH-17 |
| idem | montagem das demais áreas | `requireAuth`/`can(...)` em todas (exceto `/data-ingestion`, token próprio) | objeto: outras áreas | cadeia ok; objeto não revisado aqui (fora da área A1) |
| `shared/presentation/{origin-guard,rate-limit,compression}.ts`, `shared/application/rate-limit/*`, `shared/infrastructure/rate-limit/*` | — | — | — | AUTH-2, AUTH-16; resto ok |
| `main/runtime-metrics.ts`, `main/readiness.ts` | — | — | — | ok |
| `config/env.ts` | — | — | — | AUTH-8, AUTH-17 |
| `org-structure/presentation/org-structure-router.ts` (olhado só pela cadeia/escopo) | GET `/teams`, GET `/teams/manageable`, POST `/teams/:teamId/subteams`, GET/POST `/subjects` | `can("configuration.manage")` | Subgrupo só em Grupo do escopo; assuntos só organização | ok |
| `backend/scripts/config-transfer/{exportar,importar,cliente,formato,plano}.ts` | `npm run config:exportar` / `config:importar` | importar: login de Administrador geral pela API; exportar: banco interno só leitura | servidor do destino autoriza cada rota | AUTH-9, AUTH-10 (export sem segredos: ok) |
| `deploy/windows/iis/web.config`, `configurar-iis.ps1`, `scripts/install/env-init.mjs`, `doctor.mjs` (só o que toca HTTP/segredos) | — | — | — | ok (`/internal` 404, sem porta no XFF, `HOST=127.0.0.1`, segredos aleatórios); ver AUTH-8 |

## Notas de coordenação

- **Limites por caminho cru no `app.ts`** (`costly(...)`, `request.path === "/sessions"`, `endsWith("/audio")` comparam o
  caminho sem normalizar; o Express casa a rota sem diferenciar maiúsculas e com barra final, então `/x/TEST` e `/x/test/`
  passam sem o limite) — confirmado no HEAD 27726180 (`app.ts:204,301,311`). Já está registrado por outro auditor como
  **INFRA-1** (o working tree já tem um `routePath(...)` citando esse id); não duplicado aqui.
- **O working tree mudou DURANTE esta auditoria** (≈13:51–14:03): outra sessão alterou `authenticate.ts`,
  `postgres-credential-store.ts`, `password-hasher.ts`, `rate-limit.ts`, `rate-limit-store.ts`, `postgres-rate-limit-store.ts`,
  `env.ts`, `app.ts`, `scripts/config-transfer/*` e criou `auth/testing/login-throttle-proof.test.ts` — aparentemente
  corrigindo AUTH-1/2/8/9/10 a partir deste arquivo. Este auditor não editou nada no repositório. Todos os achados e a prova de
  conceito (rodada ≈13:54, antes das mudanças em `rate-limit.ts`/`authenticate.ts`) referem-se ao HEAD 27726180; as correções
  em andamento NÃO foram revisadas. A rodada de testes citada em "Verificações sem achado" (13:53) já pegou parte dessas
  mudanças (ex.: o teste "limites por caminho não se contornam com maiúsculas…" do `http-security.test.ts`).
