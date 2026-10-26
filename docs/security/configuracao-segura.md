# Configuração segura, atualização e reversão (08/10/2026)

## 1. Variáveis do backend (`backend/.env`)

| Variável | Padrão | Recomendação |
|---|---|---|
| `NODE_ENV` | `development` | **`production` em qualquer servidor** (com ou sem HTTPS). Só o computador de quem desenvolve usa `development`. Em produção a API exige `JWT_SECRET` (≥ 32 caracteres, diferente do exemplo) e `DATA_HUB_SECRET_KEY`, e recusa dados de demonstração. |
| `SESSION_COOKIE_SECURE` | `auto` | `auto`/`true` com HTTPS. `false` **só** em servidor HTTP de rede interna (o navegador descarta cookie `Secure` em HTTP). |
| `JWT_SECRET` | valor de exemplo | Aleatório e longo (`npm run env:init` gera 96 caracteres). Trocar derruba todas as sessões e zera a trava de tentativas de login. |
| `DATA_HUB_SECRET_KEY` | — | 32 bytes aleatórios. Fica fora do banco; perder a chave obriga a redigitar as senhas das conexões. Nunca trocar sem migração (ver R-12). |
| `CORS_ORIGIN` | `http://localhost:3000` | O endereço público exato da interface (lista separada por vírgula). Também é a lista de origens aceitas nas escritas com sessão (proteção contra CSRF). Nunca `*`. |
| `TRUST_PROXY` | `loopback` | `loopback` com IIS/proxy na mesma máquina — inclusive com **várias APIs atrás do mesmo IIS (web farm do ARR)**: todas recebem do 127.0.0.1 e leem o `X-Forwarded-For` que o ARR acrescenta. IIS em outra máquina (ou dois IIS atrás de um balanceador): os IPs/sub-redes de **todos** os proxies do caminho (ex.: `10.0.0.5, 10.0.0.6`), senão a API enxerga o IP do proxy e todos os usuários dividem um contador por IP. Balanceador de rede antes do IIS que também acrescenta `X-Forwarded-For`: inclua o endereço dele. `false` sem proxy. Nunca `true` (recusado na subida). |
| `HOST` | todas as interfaces | `127.0.0.1` atrás do IIS (a API não fica exposta na rede). |
| `LOGIN_RATE_LIMIT_PER_IP_EMAIL` | `20` (por 5 min) | Tentativas por IP **+ e-mail digitado**: cada pessoa tem o seu contador mesmo quando centenas saem pelo mesmo IP (Citrix, VDI, NAT) na virada de turno. A trava por e-mail (5 falhas/15 min) continua. `0` desliga só este limite. |
| `LOGIN_RATE_LIMIT_PER_IP` | `200` (por 5 min) | Logins **recusados** por IP (até 13/10/2026 contava todas as tentativas, padrão 30): barra quem testa uma senha em muitas contas a partir de um endereço; login certo não conta. Instalação feita antes com `30` no `.env`: troque para `200` se os usuários saem por poucos IPs. `0` desliga só este limite. |
| `INIA_OUTBOUND_MODE` | `OPEN` | `ALLOWLIST` quando a área de dados puder listar os destinos (bancos, SFTP, APIs, provedores de IA). |
| `INIA_OUTBOUND_ALLOWED_DESTINATIONS` | — | Ex.: `10.20.0.0/16, sqlprod.empresa.local:1433, *.api.cliente.com.br, 127.0.0.1:11434`. Um destino listado é aceito mesmo numa faixa fechada (ex.: Ollama na própria máquina em produção). |

O que a política de destinos nega sempre (salvo liberação explícita): metadados de nuvem e link-local (`169.254.0.0/16`,
`fe80::/10`, `fd00:ec2::254`, nomes `metadata*`), endereços não roteáveis, o host:porta do banco interno (`DATABASE_URL`) e, em
produção, a própria máquina (loopback). Redes privadas (10/8, 172.16/12, 192.168/16, fc00::/7) são permitidas no modo `OPEN`.

## 2. Interface (`frontend/.env.local`)

`NEXT_PUBLIC_INIA_API_URL` entra no build e define a origem da API na CSP (`img-src`/`connect-src`) e se o HSTS é enviado
(só quando é `https://`). Mudou o endereço: `npm run build` de novo.

### Content-Security-Policy com nonce (R-07, 08/10/2026)

- **Como funciona**: `frontend/src/proxy.ts` monta a CSP a cada requisição (`src/lib/security/content-security-policy.ts`) com um
  nonce aleatório de 128 bits. `script-src 'self' 'nonce-…' 'strict-dynamic'`, **sem `'unsafe-inline'` e sem `'unsafe-eval'` em
  produção** (o `next dev` acrescenta `'unsafe-eval'` e `ws:`). O Next aplica o nonce aos próprios scripts (lê o cabeçalho da
  requisição); o script de tema do next-themes o recebe pelo `RootLayout`; o Zod roda `jitless` (sem a sonda de `eval` que virava
  violação em toda página). As demais diretivas não mudaram. `next.config.ts` mantém os outros cabeçalhos (X-Frame-Options,
  nosniff, Referrer-Policy, Permissions-Policy, COOP, HSTS).
- **Alcance**: o proxy passa por todas as páginas — login, recuperação de senha, wiki, raiz e 404 inclusive; sessão continua
  exigida só nas áreas logadas (`AUTHENTICATED_PREFIXES`). Ficam fora só `_next/static`, `_next/image` e o favicon.
- **Decisão: todas as páginas passam a ser renderizadas por requisição.** Página pré-renderizada no build não tem como levar o
  nonce, e os scripts dela seriam bloqueados. O `RootLayout` lê o nonce (`headers()`), o que torna todas as rotas dinâmicas. Antes,
  46 rotas eram estáticas: login, recuperação de senha, 404, laboratório do avatar (só desenvolvimento) e as 42 páginas da wiki. As
  áreas logadas já eram dinâmicas (cada uma consulta a API) e não mudam. Custo medido nas páginas que eram estáticas (`next start`,
  um processo, máquina de desenvolvimento; 60 requisições em sequência e 300 com 10 em paralelo):

  | Página | Estática p50 / p95 | Com nonce p50 / p95 | Vazão (10 em paralelo) |
  |---|---|---|---|
  | `/auth/login` | 1,9 / 6,3 ms | 7,0 / 13,2 ms | 275 → 82 req/s |
  | `/wiki` | 3,4 / 6,2 ms | 11,7 / 20,3 ms | 156 → 52 req/s |
  | `/wiki/glossario` | 3,1 / 5,9 ms | 10,6 / 20,6 ms | 165 → 54 req/s |
  | `/wiki/workflows/nodes` | 3,8 / 6,1 ms | 14,6 / 29,1 ms | 125 → 47 req/s |

  Aceito: são de 5 a 11 ms de servidor por carga completa de página de baixa frequência (login e wiki); a navegação dentro da
  aplicação continua no cliente; a instalação não usa CDN (o IIS só repassa), então nenhum cache de borda é perdido. Efeito
  visível: um clique entre páginas da wiki passa a buscar a página no servidor, em vez de usar a versão estática pré-carregada.
- **Alternativas descartadas**: (a) manter `'unsafe-inline'` só nas páginas estáticas — em produção login e wiki dividem a origem
  com a API, e um XSS ali agiria com a sessão da pessoa; (b) SRI (`experimental.sri`) — põe `integrity` só nos arquivos `.js`
  externos; o HTML estático continua com scripts inline (dados do RSC e o tema), que exigiriam `'unsafe-inline'`.
- **Verificado no navegador** (build de produção, com `report-uri` de teste coletando os relatórios do próprio navegador): zero
  violações em login, recuperação de senha, wiki, 404, Acompanhamento com avatar 3D (gestor e operador), Indicadores,
  Organograma, perfil, Diagnóstico, editor de Workflow (React Flow), prévias PDF (worker do pdf.js) e DOCX da base e outras nove
  telas da Administração; o worklet do microfone e workers `blob:` carregam. Controles negativos bloqueados: `<script>` inline do
  HTML, atributo `on*`, URL `javascript:` e `eval`. `next dev` também sem violação.
- **IIS**: não ligar cache de saída (output caching) para as páginas — o nonce precisa ser único por resposta (o Next já manda
  `Cache-Control: private, no-cache, no-store` nelas); não acrescentar outra `Content-Security-Policy` no `web.config` (seria uma
  segunda política somada a esta).
- **Residual** (ver R-07 em `pendencias-e-riscos.md`): `style-src` mantém `'unsafe-inline'`; com `'strict-dynamic'`, o Chromium
  deixa rodar um `<script>` inline criado via DOM por código já confiável.
- **Reversão**: voltar `frontend/src/proxy.ts`, `src/app/layout.tsx`, `src/app/providers.tsx` e `next.config.ts` (a CSP estática
  volta ao `headers()`) e `npm run build`.

## 3. IIS / proxy

- HTTPS com certificado da empresa sempre que possível (o microfone da voz só funciona com HTTPS). Com HTTPS, configurar HSTS
  também no IIS se houver outros sites no mesmo host.
- O ARR envia `X-Forwarded-For` por padrão; mantenha. Sem ele, todos os usuários parecem vir de `127.0.0.1` e dividem o mesmo
  limite de login por IP.
- Não abra as portas 3000 e 3333 no firewall; só a porta pública do IIS.
- `requestLimits maxAllowedContentLength` (100 MB) é maior que os limites da aplicação (upload da Central 50 MB, base 15 MB,
  JSON 1 MB, API Push 10 MB) — a aplicação é quem recusa.

## 4. Bancos externos (Central de Dados)

A INIA só gera `SELECT` (dialeto próprio, sem SQL digitado), abre sessões PostgreSQL/MySQL/MariaDB como somente leitura e
limita linhas, tempo e volume. Isso **não substitui** um usuário de banco somente leitura — a credencial cadastrada deve ter só
leitura nas tabelas/visões necessárias:

- **SQL Server**: login próprio, `db_datareader` (ou `GRANT SELECT` nas visões); nunca `db_owner`/`sysadmin`. O SQL Server não tem
  sessão somente leitura: aqui a permissão do usuário é a barreira principal.
- **PostgreSQL**: `CREATE ROLE inia_leitura LOGIN …; GRANT CONNECT …; GRANT USAGE ON SCHEMA …; GRANT SELECT ON …` (sem
  `CREATE`, sem `pg_read_server_files`).
- **MySQL/MariaDB**: `GRANT SELECT ON banco.* TO 'inia_leitura'@'<ip-do-servidor-da-inia>'`.
- Criptografia: `VERIFY_FULL` (com a CA da empresa) em produção; `PREFERRED` aceita certificado não verificado e cai para texto
  puro. Trocar servidor, porta, usuário ou modo de TLS de uma fonte exige digitar a senha de novo.
- A INIA não confere automaticamente se a credencial é somente leitura: registre essa verificação no checklist da instalação.

SFTP: informe a fingerprint SHA-256 da chave do servidor quando a área de infraestrutura a fornecer; sem ela, a INIA grava a
primeira chave vista e recusa qualquer chave diferente depois.

## 5. Banco interno da INIA

Usuário próprio da aplicação (dono do banco `inia`), sem superusuário; porta só para o servidor da aplicação; backup antes de
toda atualização. O usuário dos testes (`TEST_DATABASE_URL`) não deve existir em produção.

## 6. Papéis e escopos (o que mudou para quem administra)

- Central de Dados e ingestão legada: só `data_hub.manage` com escopo de **organização**.
- Domínios de negócio, flags de canal, calendário operacional, governança, definições/glossário de indicadores e catálogo de
  assuntos: leitura em qualquer escopo; **alteração só com escopo de organização**.
- Regras de cálculo e bases de conhecimento: o administrador de Grupo/Subgrupo mantém as do próprio Grupo; "todos os Grupos" exige
  organização.
- Definir/alterar nível de liderança no cadastro: `people.manage` de organização. Trocar e-mail ou inativar alguém com conta segue a
  mesma custódia da tela de acessos. Ninguém altera o próprio nível, Grupo, e-mail ou situação.
- Gerar senha/habilitar/desabilitar: o escopo de quem age precisa alcançar toda a estrutura que a pessoa lidera.

## 7. Atualização

1. Backup do banco interno (`pg_dump`).
2. Atualizar o código (`git pull` ou pacote) e dependências: `npm run install:all` (o `package-lock.json` traz next 16.3.8,
   multer 2.4.0, proxy-addr 2.0.8, sharp 0.35.5).
3. `npm run update` — aplica a migration `123_auth_session_revocations.sql` (cria a tabela `auth_revoked_sessions`; nada é
   alterado nem apagado). **A migration precisa rodar antes de subir o código novo**: o guard de sessão consulta essa tabela.
4. Revisar `backend/.env`: `NODE_ENV=production`; `SESSION_COOKIE_SECURE=false` se o endereço for HTTP; `TRUST_PROXY`;
   `JWT_SECRET` ≥ 32 caracteres (senão a API não sobe em produção). Quem instalar de novo com `env-init` já recebe esses valores.
5. `npm run build` (interface e API) e reiniciar os serviços.
6. Conferir: `/health`; login e logout; um administrador de Grupo não vê a Central de Dados; cabeçalho
   `Content-Security-Policy` com `script-src 'self' 'nonce-…' 'strict-dynamic'` nas páginas, inclusive login e wiki, com nonce
   diferente a cada recarga (`curl -sI https://<endereço>/auth/login`), e nenhuma mensagem "Content Security Policy" no console do
   navegador (F12) ao abrir login, Acompanhamento e Administração.

Efeitos visíveis: sessões emitidas antes continuam válidas até vencer (não têm `jti`); quem estava inativo no cadastro perde o
acesso; administradores escopados deixam de alterar catálogos da organização e de entrar na Central; fontes da Central cujo
destino mude passam a pedir a senha; conexões de IA que trocarem de host perdem a chave guardada; arquivos da base passam a
baixar como anexo (a prévia na tela continua).

## 8. Reversão

1. Parar os serviços e voltar o código e o `package-lock.json` para a versão anterior; `npm run install:all`; `npm run build`.
2. A tabela `auth_revoked_sessions` pode ficar (o código antigo não a usa). Para removê-la: `drop table auth_revoked_sessions;`
   e `delete from schema_migrations where name = '123_auth_session_revocations.sql';`.
3. Nenhum dado de negócio foi migrado: fingerprints SFTP gravadas por TOFU ficam na configuração da fonte (o código antigo as usa
   normalmente); segredos revogados por troca de destino continuam revogados (cadastrar de novo).
4. Se `NODE_ENV` foi mudado para `production` num servidor HTTP e for preciso voltar: `NODE_ENV=development` volta a funcionar
   com o código antigo (sem `SESSION_COOKIE_SECURE`).

## 9. Rotação de credenciais

Não foi encontrado segredo exposto no repositório nem no histórico; **nenhuma rotação é necessária por causa desta auditoria**.
Nenhuma senha fica no código: a das contas de demonstração vem de `INIA_DEMO_PASSWORD` (backend/.env) e as dos bancos de exemplo do
Docker de `INIA_EXAMPLES_ADMIN_PASSWORD`/`INIA_EXAMPLES_READER_PASSWORD` (.env da raiz), todas geradas por `npm run env:init`; as
contas que as migrations antigas criam nascem com senha aleatória. Mesmo assim, nunca usar uma instalação de demonstração com dados
reais, e nunca carregar a massa demo em servidor (recusado em produção).

## 10. Segunda rodada (17/10/2026) — o que muda para quem instala e administra

Nenhuma migration nova: as correções usam as tabelas que já existem (`auth_login_attempts`, `rate_limit_hits`, `user_accounts`,
`audit_logs`). Atualizar é só código + build + reinício.

### Variáveis e padrões

| Onde | O que | Efeito |
|---|---|---|
| `backend/.env` `JWT_SECRET` | Em produção a API **não sobe** com o valor do `.env.example`, valores começando por "troque/change/exemplo", com menos de 32 caracteres ou menos de 10 caracteres distintos | Instalações feitas com `npm run env:init` não são afetadas. Trocar o valor só encerra as sessões e zera o histórico da trava de login |
| `backend/.env` `DATA_HUB_SECRET_KEY` | Chave publicada, curta ou repetitiva gera o aviso `weak_production_secret` no log (a API sobe) | Ver "Rotação da chave de cifra" abaixo — **não troque a chave sem recifrar** |
| `backend/.env` `TRUST_PROXY` | Rede `/0` (`0.0.0.0/0`, `::/0`) é recusada como `true` | Use `loopback` (IIS na mesma máquina) ou o IP do proxy |
| `frontend/.env.local` `NEXT_PUBLIC_INIA_TRUSTED_LINK_HOSTS` | Nova, vazia por padrão: domínios externos (`intranet.empresa.com`, `*.empresa.com`) que ficam clicáveis nos textos da INIA | Sem ela, link externo escrito pela IA/Workflow aparece como texto com o domínio à vista. Entra no build |
| Limites (código, `app.ts`) | Primeiro acesso: 10 por sessão / 15 min e 300 recusas por IP / 15 min; voz: 60 sessões novas por conta / 30 min (além de 12/min); foto/capa: 20 por conta/min; prévia, "Executar agora" e nova análise de report, amostra/listagem SFTP e criação de conjunto da Central entram nas 30 ações caras por conta/min | Uso humano não é afetado |
| Login | Cookie `inia_device` (httpOnly, `Path=/api/v1/auth`, 180 dias) depois de um login certo | Com o e-mail travado por tentativas de terceiros, o dono entra do navegador onde já entrou |
| Senhas | Senha previsível ("Senha123", "Vivo2026", "Mudar@123", mês/estação + ano) é recusada no primeiro acesso | O checklist da tela mostra a regra |
| Cadastro de pessoa | A senha provisória é **gerada** pela INIA e mostrada uma vez (não há mais campo para digitá-la) | Manual IT-INIA-002 desatualizado nesse ponto (R-11) |
| Central de Dados — banco | Fonte NOVA nasce em "Obrigatória e validando o certificado"; MySQL/MariaDB nesse modo agora confere o **nome** do servidor | Banco interno com certificado autoassinado: informe a CA da empresa ou escolha "Obrigatória (sem validar certificado)" conscientemente. **Fonte MySQL antiga em `VERIFY_FULL` com certificado de outro nome passa a falhar** — confira antes de atualizar |
| Central de Dados — credencial | Trocar a CA do banco ou apagar/trocar a chave do servidor SFTP pede a senha de novo | — |
| Central de Dados — carga de Colaboradores | Pessoa desligada pela base perde a conta (Administrador geral: só as sessões); pessoa ligada pelo e-mail que a base põe em outro Grupo/nível de liderança tem a conta desabilitada (aviso `DATA_PERSON_LINK_ACCESS_DISABLED`) | A liberação volta a quem administra o lugar novo (Habilitar acesso) |
| Arquivos | XLSX/DOCX com tamanho descompactado diferente do declarado e PDF com fluxo comprimido grande demais são recusados | Manuais e planilhas reais passam (conferido com os do repositório) |

### Serviços do Windows (INFRA-2)

`instalar-servicos.ps1` ganhou `-ContaServico "NT AUTHORITY\LocalService"` (ou uma gMSA `DOMINIO\svc-inia$`): os serviços deixam
de rodar como LocalSystem, a conta recebe leitura da pasta da INIA e escrita em `logs` e `frontend\.next`. Sempre, com ou sem a
opção: `backend\.env` e `frontend\.env.local` ficam legíveis só por Administradores, SYSTEM, quem instalou e a conta do serviço, e
os serviços da API/processamento recebem `NODE_ENV=production` no próprio serviço. **Escrito sem Windows para testar (R-32)**:
rode primeiro na homologação, confira `services.msc`, `/ready` de cada instância e `logs\*.err.log`.

### Banco interno

`npm run doctor` e `npm run db:connect` avisam quando o usuário do banco interno é superusuário do PostgreSQL. Em produção: um
usuário só dono do banco da INIA (`create role inia_app login password '…'; create database inia owner inia_app;`), com as
extensões criadas antes por um administrador do banco.

### Atualização

1. Backup (`pg_dump`).
2. Atualizar o código; `npm run install:all` (nenhuma dependência nova).
3. Antes de subir: conferir `JWT_SECRET` (regra acima) e as fontes MySQL/MariaDB em "validando o certificado".
4. `npm run build` e reiniciar os serviços (no Windows, rodar de novo `instalar-servicos.ps1` — com `-ContaServico` se for adotar).
5. Conferir: login, logout, primeiro acesso de uma conta nova (a senha é mostrada ao criar), teste de conexão de uma fonte de
   banco, upload de um DOCX e de um PDF da base, uma conversa por voz.

### Reversão

Voltar o código e rodar `npm run build`. Nada no banco precisa ser desfeito: o cookie `inia_device` é ignorado pelo código antigo;
contas desabilitadas pela carga (desligamento ou mudança de lugar) continuam desabilitadas — reabilite em Usuários e acessos se
for o caso; a ACL dos `.env` no Windows pode ser devolvida com `icacls <arquivo> /reset`.

### Rotação da chave de cifra (`DATA_HUB_SECRET_KEY`, R-12/R-25)

Desde 20/10/2026 existe recifragem: ver §11 "Rotação da chave de cifra". Nenhuma rotação foi exigida por esta rodada: não houve
segredo exposto no repositório.

## 11. Terceira rodada (20/10/2026) — liberação de IA na Vivo

Itens do backlog `docs/dev/liberacao-ia-vivo.md` que não dependiam de decisão da Vivo. Há **4 migrations novas** (149–152):
rode `npm run db:migrate` antes de subir o código novo.

| Migration | O que cria |
|---|---|
| `149_auth_session_activity` | Última atividade de cada sessão (encerramento por inatividade) |
| `150_feedback_contestation_reviews` | Resposta da liderança à contestação ("não gostei") de um feedback |
| `151_personal_data_access_log` | Registro de quem abriu transcrição, conversa com a INIA ou ficha de outra pessoa |
| `152_push_token_hardening` | Validade e IPs autorizados do token da API Push; hash do corpo por Idempotency-Key |

### Variáveis novas (`backend/.env`)

| Variável | Padrão | Efeito |
|---|---|---|
| `CORS_ORIGIN` | — | Agora **obrigatória em produção**: a API não sobe sem ela, nem com `localhost` ou `http://` para um endereço público. Fora de produção, ausente = `http://localhost:3000` |
| `SESSION_IDLE_TIMEOUT_MINUTES` | `30` | Sessão sem uso (nenhuma interação com a tela nem fala na voz) encerra sozinha; a tela avisa 2 minutos antes. `0` desliga |
| `INIA_MODEL_PII_MASKING` | `ON` | E-mail, CPF pontuado e protocolo do cliente viram marcadores nas transcrições enviadas à IA; telefone e outros números longos saem mascarados com o formato preservado (DDD + 1º dígito; 3 primeiros dígitos e a quantidade). `OFF` só com decisão do DPO |
| `DATA_HUB_SECRET_KEY_PREVIOUS` | vazia | Só durante a troca da chave de cifra (abaixo) |

### O que muda para quem usa

- **Todo mundo precisa entrar de novo uma vez** depois da atualização, quando `SESSION_COOKIE_SECURE` está ligado (HTTPS): o
  cookie passa a se chamar `__Host-inia_session`. Avise antes.
- Menu do usuário → **Sair de todos os aparelhos** encerra as sessões da pessoa em todos os navegadores.
- Novo papel **Revisor de contestações** (o Administrador geral também tem): responde às contestações em *Administração →
  Contestações de feedback*; a pessoa que contestou recebe a resposta no sino e no feedback.
- O Administrador geral ganha *Usuários e acessos → pessoa → Exportar dados (LGPD)* (pedido do titular).
- API Push: tokens novos com validade (padrão 1 ano) e IPs autorizados; mesma Idempotency-Key com outro corpo recebe 422; botão
  **Baixar OpenAPI** na fonte. Tokens antigos continuam sem validade até serem rotacionados — rotacione os de produção.

### Rotação da chave de cifra

Credenciais da Central de Dados e das conexões de IA passam a ser cifradas na **versão 2** (presas à organização, ao dono e à
finalidade). As antigas (versão 1) continuam legíveis. Depois de atualizar, sem trocar a chave:

```
npm run secrets:rotate                 (simulação: mostra o que seria recifrado e se tudo é legível)
npm run secrets:rotate -- --aplicar    (grava)
```

Para **trocar a chave** (chave fraca, suspeita de vazamento ou rotina):

1. Backup: `npm run db:backup`.
2. `backend/.env`: copie o valor atual de `DATA_HUB_SECRET_KEY` para `DATA_HUB_SECRET_KEY_PREVIOUS` e ponha uma chave nova em
   `DATA_HUB_SECRET_KEY` (`openssl rand -hex 32`). Reinicie API e processamento: a INIA continua lendo as credenciais pela chave
   anterior.
3. `npm run secrets:rotate` (simulação) e, se tudo aparecer legível, `npm run secrets:rotate -- --aplicar`.
4. Apague `DATA_HUB_SECRET_KEY_PREVIOUS` e reinicie.

Credencial que nenhuma das duas chaves abre não é tocada e o comando termina com erro: redigite-a pela tela. Se a troca for por
vazamento, troque também as credenciais na origem — quem tinha a chave antiga e uma cópia do banco consegue lê-las.

### Backup e teste de restauração

- `npm run db:backup` — cópia do banco interno (`pg_dump` no formato custom), conferida pelo `pg_restore` antes de valer, com
  retenção (`--keep-days`, padrão 14; nunca apaga a mais nova). Pasta padrão `backups/` (fora do Git); use `--dir` para outra.
- `npm run db:restore-check` — restaura a cópia mais nova num banco **temporário** do mesmo servidor, confere as tabelas e mede o
  tempo (é o tempo real de volta do banco). Não toca no banco da INIA. Sem permissão de criar banco: `--target-db` com um banco
  vazio cedido pela equipe do banco.
- Windows: `deploy\windows\backup\agendar-backup.ps1 -Pasta D:\backup\inia -Horario 02:00 -DiasRetencao 14` agenda o
  backup diário (**escrito sem Windows, validar na homologação** — R-35). Guarde uma cópia fora do servidor.
- `npm run doctor` lembra quando não há backup recente.

### Verificação de segurança antes de publicar

`npm run security:check` procura segredos no código (inclusive em arquivos ainda não versionados) e roda `npm audit` das
dependências de produção. Rode antes de cada entrega.

### Atualização

1. `npm run db:backup`.
2. Atualizar o código; `npm run install:all`.
3. `npm run db:migrate` (149–152).
4. Conferir `CORS_ORIGIN` no `backend/.env` (obrigatória em produção).
5. `npm run build` e reiniciar os serviços.
6. `npm run secrets:rotate -- --aplicar` (passa as credenciais para a versão 2).
7. Conferir: login, logout, "Sair de todos os aparelhos", uma carga pela API Push, uma conversa com a INIA.

### Reversão

Voltar o código e rodar `npm run build`. As tabelas novas podem ficar (o código antigo as ignora). Credenciais já recifradas na
versão 2 **não são lidas pelo código antigo**: se for voltar depois do passo 6, restaure o backup do passo 1 ou redigite as
credenciais pela tela. O cookie `__Host-inia_session` é ignorado pelo código antigo (todos entram de novo).
