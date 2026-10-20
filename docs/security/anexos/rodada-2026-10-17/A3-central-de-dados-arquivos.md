> Anexo da segunda rodada da auditoria de segurança (17/10/2026). Relatório de trabalho de uma das quatro frentes, escrito sobre o código ANTES das correções (HEAD 27726180); as correções e o estado final estão em ../../relatorio-de-achados.md e ../../pendencias-e-riscos.md. Caminhos citados fora do repositório (scratchpad) eram arquivos temporários de prova e não fazem parte da entrega.

# A3 — Central de Dados, integrações externas, arquivos e SQL (auditoria 17/10/2026)

Auditor: A3. Base: branch `admin-list-standardization` (HEAD 27726180). Somente leitura no repositório; provas executadas
apenas com scripts no scratchpad (nenhum arquivo do repo alterado, nenhum acesso ao banco `inia`, nenhuma IA).

Escopo: `backend/src/modules/data-hub/**`, política de destinos de saída, `zip-guard.ts`, cifra de segredos, `ingestion/**`
(legada), `knowledge/**` (upload/arquivo/prévia), `profile-preferences` e `inia-scenes` (imagens), exportações CSV, SQL
dinâmico do backend, renderização de dados de integração no frontend.

Montagem (conferida no `backend/src/main/app.ts` do HEAD; o arquivo está sendo alterado por outra sessão — cite pela rota, não
pela linha): `/api/v1/admin/data-hub` e `/api/v1/ingestion` exigem `data_hub.manage` com escopo de ORGANIZAÇÃO
(`organizationWide: true`); `/api/v1/data-ingestion` (API Push) autentica por token de push, com limite por IP antes e por token
depois (loja PostgreSQL). Parser JSON global (1 MB) não roda no push, que tem o próprio de 10 MB.

## Resumo

| Gravidade | Qtde | IDs |
|---|---|---|
| Crítica | 0 | — |
| Alta | 0 | — |
| Média | 3 | DATA-1 (guarda de ZIP contornável + PDF sem guarda: queda da API por memória, persistente pela prévia DOCX), DATA-4 (VERIFY_FULL do MySQL não confere o nome), DATA-5 (TLS sem validação é o padrão, SQL Server incluso) |
| Baixa | 8 | DATA-2, DATA-3, DATA-6, DATA-7, DATA-8, DATA-9, DATA-10, DATA-11 |
| Informativa | 2 | DATA-12, DATA-13 (7 itens) |

Nenhuma injeção de SQL (interno ou externo), nenhum SSRF para metadados/loopback pelas formas de endereço testadas, nenhum
vazamento de credencial nas respostas/logs e nenhuma falha de autorização por objeto nas 41 rotas da Central foram encontrados.

---

## Achados

### DATA-1 — Guarda de ZIP contornável: tamanhos declarados no diretório central não são conferidos na descompactação (XLSX/DOCX)
- Gravidade: Média
- Classificação: CONFIRMADA (medido localmente com os parsers reais do projeto)
- Local: `backend/src/shared/infrastructure/zip-guard.ts:36-48` (confia em `uncompressed` do diretório central; a regra de taxa
  só vale para entradas que DECLARAM > 1 MB, linha 45); consumidores: `knowledge/infrastructure/text-extractor.ts:30,45`
  (upload), `knowledge/infrastructure/docx-preview.ts:9-11` (prévia a cada leitura), `data-hub/infrastructure/xlsx-parser.ts:33-37`
  (upload da Central, SFTP, importação). Os parsers (`exceljs` 4.4.0 → `JSZip.loadAsync` + `entry.async('string')` para TODA
  entrada, `node_modules/exceljs/lib/xlsx/xlsx.js:279-308`; `mammoth` 1.12.2 → JSZip) descompactam o fluxo deflate inteiro e só
  comparam o tamanho real com o declarado NO FIM (`jszip/lib/compressedObject.js:37`, "uncompressed data size mismatch").
- Evidência (prova local, scripts em scratchpad, nada no repo):
  - XLSX de 389 KB com `xl/sharedStrings.xml` declarando 1.000 bytes e contendo 400 MB: `inspectZip` → `ok:true,
    totalUncompressedBytes:1008`; `parseExcel` consome ~550 MB de RSS antes de recusar ("não é um .xlsx válido").
  - DOCX de 389 KB com `word/document.xml` mentindo o tamanho: `contentMatchesSourceType(DOCX)` → `true`;
    `extractTextFromFile` sobe o RSS para 669 MB antes do erro.
  - DOCX de 293 KB com texto normal e uma IMAGEM (`word/media/image1.png`) mentindo o tamanho (300 MB): o upload passa
    (`extractRawText` não lê imagens: 42 ms, texto extraído normalmente) e fica GRAVADO; depois, cada
    `renderDocxPreviewHtml` (prévia) descompacta a imagem inteira (pico 537 MB) e devolve HTML vazio sem erro.
  - Escala: deflate chega a ~1.000:1 — o limite de 15 MB da Base (`knowledge-router.ts:18`) permite ~15 GB por leitura; o de
    50 MB da Central (`data-hub-router.ts:29`), ~50 GB. Um processo de API por instância ⇒ queda por falta de memória.
- Cenário de exploração: (a) administrador com `knowledge.manage` em QUALQUER escopo (ex.: só um Subgrupo) envia o DOCX com a
  imagem-bomba, publica; qualquer pessoa que abra a prévia do material (`GET /api/v1/knowledge-materials/:id/preview`, aberto pelo
  link "Acessar material" do feedback, ou `GET /api/v1/admin/knowledge/:id/preview`) derruba a API — de forma persistente, a cada
  visualização. (b) Arquivo XLSX colocado no SFTP do cliente derruba o worker da Central a cada tentativa. (c) Administrador geral
  derruba a API pelo `/admin/data-hub/uploads` (a amostra roda no processo da API). SEC-29 foi dado como "Corrigido (preventivo)",
  mas a correção só confere a declaração do próprio arquivo.
- Mesmo padrão em PDF (sem guarda nenhuma): PDF de 195 KB com um content stream FlateDecode de 200 MB passa em
  `contentMatchesSourceType(PDF)` (só confere `%PDF-`) e `extractTextFromFile` (pdf-parse/pdf.js, no processo da API, no
  upload da Base) chega a ~1 GB de RSS em 1 s. Com o limite de 15 MB, a amplificação estimada passa de dezenas de GB. Este caminho
  é transitório (o upload falha e nada é gravado), mas qualquer `knowledge.manage` escopado repete à vontade.
- Correção sugerida: na `zip-guard.ts`, descompactar de verdade cada entrada em streaming com teto (ex.: `zlib.createInflateRaw`
  sobre a fatia `[local header + nome + extra, compressedSize]`, abortando ao passar `min(declarado, teto por entrada)` e somando
  um teto total) — ou seja, validar o tamanho REAL antes de entregar ao parser; recusar entrada cujo tamanho real difere do
  declarado. Alternativa equivalente: substituir o `Buffer` entregue ao exceljs/mammoth por um ZIP reempacotado a partir das
  entradas já descompactadas com teto. Ligar também `checkCRC32`/tamanho por entrada. Rodar a prévia DOCX com cache do HTML gerado
  (gerar uma vez no upload, com o teto) em vez de a cada leitura. Para PDF: extrair texto num `worker_thread` com
  `resourceLimits` (heap) e tempo-limite, ou num processo filho com teto de memória; recusar o arquivo se estourar. Os mesmos
  isolamentos valem para o exceljs da Central (upload/amostra no processo da API).
- Teste de regressão sugerido: `zip-guard.test.ts` com os três arquivos acima (gerados no teste: entrada deflate de zeros com
  tamanho declarado falso) → `ok:false`; XLSX real de 20 mil linhas e os DOCX dos manuais continuam `ok:true`; teste de upload da
  Base com DOCX "imagem-bomba" → 422 `KNOWLEDGE_FILE_TYPE_MISMATCH`.

### DATA-2 — Negação do "banco interno da INIA" e da "própria máquina" comparam só o texto do host
- Gravidade: Baixa
- Classificação: CONFIRMADA (decisão pura executada localmente)
- Local: `backend/src/shared/infrastructure/outbound-destination-policy.ts:150-152` (compara `denied.host` só com o nome
  pedido ou com a lista de IPs resolvidos, sem resolver `denied.host`); `backend/src/config/outbound-policy.ts:5-12` (grava o
  host do `DATABASE_URL` como veio, ex.: nome); loopback (`:148`) só cobre 127/8, `::1` e `*.localhost`.
- Evidência: `destinationProblem({deniedEndpoints:[{host:"inia-db.corp.local",port:5432}]}, "10.0.0.5", 5432, ["10.0.0.5"])` →
  `null` (permitido) quando `inia-db.corp.local` resolve para 10.0.0.5; o mesmo com qualquer outro nome/CNAME para o mesmo IP.
  Com `DATABASE_URL=...@localhost:5432` (padrão de `.env.example` e da instalação de um servidor), o IP de rede da própria
  máquina (`10.0.0.4:5432`) também passa em produção.
- Cenário de exploração: Administrador geral (`data_hub.manage` de organização) cria fonte PostgreSQL apontando para o IP (ou
  outro nome) do banco interno. Na instalação de dois servidores (`docs/instalacao/dois-servidores-windows.md:59-63`,
  `listen_addresses='*'` + `pg_hba` liberando o IP do servidor da aplicação) a conexão chega ao banco da INIA; sem a senha do
  `inia_app` ele só consegue sondar/tentar senhas (30/min pelo `costly`). Com a senha (ex.: vazada de outro lugar) leria tudo
  (hashes, segredos cifrados, dados de todas as pessoas) — exatamente o que a regra "a Central nunca lê o banco da própria INIA"
  quer impedir.
- Correção sugerida: em `config/outbound-policy.ts`, resolver o host do `DATABASE_URL` na subida (e periodicamente) e guardar os
  IPs; em `destinationProblem`, negar quando QUALQUER endereço resolvido do destino coincidir com um IP do banco interno na mesma
  porta. Opcional: negar também os IPs das interfaces locais (`os.networkInterfaces()`) quando `allowLoopback=false`.
- Teste de regressão sugerido: `outbound-destination-policy.test.ts` — destino por IP e por alias do banco interno → recusado;
  outro banco na mesma rede privada → permitido.

### DATA-3 — Endpoints de metadados/infra de nuvem fora da lista fixa (Azure WireServer, Alibaba)
- Gravidade: Baixa
- Classificação: PREVENTIVA
- Local: `backend/src/shared/infrastructure/outbound-destination-policy.ts:45-59`.
- Evidência: `168.63.129.16` (Azure WireServer/health/DNS — a homologação roda em VM Azure) e `100.100.100.200` (metadados da
  Alibaba) → `destinationProblem` = `null`. A fonte API Pull aceita cabeçalhos livres (`source-config.ts:19,32`), então o
  `x-ms-version` que o WireServer exige pode ser enviado. O conteúdo XML do WireServer não volta como amostra (a Central só aceita
  JSON — `api-pull-connector.ts:73-78`), o que limita a leitura; o teste de conexão devolve o status HTTP.
- Cenário de exploração: Administrador geral ou credencial roubada dele sonda serviços de infraestrutura da nuvem.
- Correção sugerida: acrescentar `168.63.129.16/32` e `100.100.100.200/32` (e, se não houver integração legítima, `100.64.0.0/10`)
  à `ALWAYS_DENIED`; documentar em `configuracao-segura.md`.
- Teste de regressão sugerido: casos novos em `outbound-destination-policy.test.ts`.

### DATA-4 — MySQL/MariaDB "Obrigatória e validando o certificado" não confere o NOME do servidor
- Gravidade: Média
- Classificação: CONFIRMADA (leitura do driver instalado; sem teste de rede)
- Local: `backend/src/modules/data-hub/infrastructure/external-databases/mysql-session.ts:14-18` (modo VERIFY passa só
  `{ rejectUnauthorized: true, ca }`); driver `mysql2` 3.24.5, `node_modules/mysql2/lib/base/connection.js:430-470`: a
  conferência de identidade só roda com `ssl.verifyIdentity: true` (senão `checkServerIdentity` devolve sempre `undefined`).
  A documentação do domínio promete o contrário (`database-engine.ts:30`: "valida a cadeia do certificado e o nome do servidor").
  A prova `external-database-proof.test.ts:269` só cobre certificado autoassinado (cadeia), nunca nome trocado.
- Evidência: com `VERIFY_FULL` e sem CA própria, qualquer certificado emitido por uma CA pública (ex.: Let's Encrypt para um
  domínio do atacante) é aceito para QUALQUER host; com CA da empresa, qualquer certificado dessa CA.
- Cenário de exploração: alguém com posição de interceptação entre o servidor da INIA e o MySQL (ARP/DNS na rede do cliente)
  apresenta um certificado válido de outro nome; no MySQL 8 (`caching_sha2_password`) o caminho de "autenticação completa" envia a
  senha EM CLARO dentro do TLS — o interceptador força esse caminho e recebe a senha do banco do cliente, mesmo com o modo mais
  forte que a tela oferece.
- Correção sugerida: no modo VERIFY, `ssl: { rejectUnauthorized: true, verifyIdentity: true, ca? }`; para host IP, exigir CA
  própria e conferir o IP no SAN (mysql2 não envia `servername` para IP — testar o comportamento e, se preciso, recusar
  `VERIFY_FULL` com IP sem CA própria).
- Teste de regressão sugerido: prova com contêiner MySQL usando certificado válido da CA de teste mas emitido para outro nome →
  `DATA_SOURCE_TLS_FAILED`; certificado com o nome certo → conecta.

### DATA-5 — TLS sem validação é o PADRÃO de toda fonte nova de banco (SQL Server incluso, fora do R-08)
- Gravidade: Média
- Classificação: CONFIRMADA (configuração); exploração exige posição de rede
- Local: `backend/src/modules/data-hub/domain/database/database-engine.ts:42` (`DEFAULT_TLS_MODE`: SQL Server `REQUIRED`,
  demais `PREFERRED`); `sqlserver-session.ts:25` (`trustServerCertificate: tlsMode !== "VERIFY_FULL"`); `postgres-session.ts:24`
  e `mysql-session.ts:16` (`rejectUnauthorized: false`); frontend `components/admin/data-hub/database/database-connection-fields.tsx:44`
  (formulário nasce no padrão).
- Evidência: R-08 registrou só PostgreSQL/MySQL e "avaliar mudar o padrão de fontes NOVAS"; nada mudou. No SQL Server, com
  `trustServerCertificate: true`, o pacote LOGIN7 (senha só "embaralhada" por XOR) vai dentro de um TLS que aceita qualquer
  certificado — um interceptador obtém a senha. No PostgreSQL `PREFERRED` aceita ainda a queda para texto puro e o driver `pg`
  responde a pedido de senha em claro (o mesmo motivo do SEC-05).
- Cenário de exploração: intercepção na rede entre a INIA e o banco do cliente (redes de cliente/VPN não controladas pela INIA)
  captura a senha do banco do cliente na primeira conexão.
- Correção sugerida: fontes NOVAS nascem em `VERIFY_FULL` (tela e backend), com aviso explícito ao escolher modo sem validação;
  manter as existentes; registrar o modo na auditoria do teste. Alternativa mínima: no SQL Server, padrão `VERIFY_FULL` quando o
  servidor tiver certificado de CA (o instalador do Windows já documenta CA da empresa).
- Teste de regressão sugerido: `database.test.ts` — `resolveDatabaseConnection` sem `tls` → `VERIFY_FULL`; criação de fonte sem
  `tls` grava `VERIFY_FULL`; trocar para modo sem validação continua exigindo a senha (já coberto pelo `secretTargetOf`).

### DATA-6 — `secretTargetOf` não inclui a CA do banco nem a fingerprint SSH: rebaixar a verificação não pede a senha de novo
- Gravidade: Baixa
- Classificação: CONFIRMADA (código); exploração exige também interceptação de rede
- Local: `backend/src/modules/data-hub/application/source-service.ts:60-64` (DATABASE: sem `tls.caCertificate`; SFTP: sem
  `hostKeyFingerprint`); `sftp-connector.ts:22-23` (sem fingerprint → TOFU grava a próxima chave vista).
- Evidência: `PATCH /admin/data-hub/sources/:id` com a mesma config SFTP sem `hostKeyFingerprint` → `targetChanged = false`,
  senha mantida, fingerprint apagada; a próxima conexão aceita QUALQUER chave e a fixa. No banco, trocar a CA em `VERIFY_FULL`
  por uma CA própria também passa sem redigitar a senha.
- Cenário de exploração: administrador mal-intencionado (o ator que o SEC-05 quer conter) com capacidade de interceptar a rede
  apaga a fingerprint/troca a CA e captura a senha SSH/do banco do cliente na conexão seguinte, sem nunca ter digitado a senha.
- Correção sugerida: incluir `hostKeyFingerprint` (SFTP) e o hash de `tls.caCertificate` (banco) em `secretTargetOf`; e/ou tornar
  a fingerprint TOFU gravada imutável pela API (só "redefinir chave" explícito, auditado, que exige a senha de novo).
- Teste de regressão sugerido: `secret-binding.test.ts` — remover/alterar fingerprint ou CA sem `secrets` → 422
  `DATA_SOURCE_SECRET_REENTRY_REQUIRED`.

### DATA-7 — DNS rebinding (R-03) continua aberto; dá para fixar o IP em todos os transportes
- Gravidade: Baixa
- Classificação: CONFIRMADA (a resolução é feita duas vezes)
- Local: `outbound-destination-policy.ts:159-176` (resolve e confere) × `fetch-http-client.ts:37` (`fetch(target)` resolve de
  novo), `postgres-session.ts:30`, `mysql-session.ts:22`, `sqlserver-session.ts:15`, `ssh2-sftp-client.ts:30` (drivers recebem o
  NOME). O mesmo no `guardedFetch` de IA (`ai-management/infrastructure/adapters/http.ts:37`).
- Evidência/cenário: um nome com TTL 0 que responde 10.x na conferência e 169.254.169.254/127.0.0.1 na conexão contorna a
  política (precisa de Administrador geral e de um DNS controlado por ele).
- Correção sugerida (como fixar): `assertOutboundDestination` devolver o endereço aprovado e cada transporte conectar NELE:
  HTTP — `fetch(url, { dispatcher: new undici.Agent({ connect: { lookup: (_h, _o, cb) => cb(null, [{ address, family }]) } }) })`
  (mantém Host/SNI do nome); PostgreSQL — `host: address` + `ssl.servername: nome`; MySQL — opção `stream` com
  `net.connect({ host: address, port })` (e `servername` no TLS); SQL Server — `server: address` + `options.serverName: nome`
  (SNI/validação); SFTP — `host: address` (a chave é conferida pela fingerprint, não pelo nome).
- Teste de regressão sugerido: resolver falso que devolve um IP permitido na 1ª chamada e loopback na 2ª → a conexão vai ao IP
  aprovado (servidor de teste local só no IP aprovado).

### DATA-8 — Carga de Colaboradores "assume" pela conta de e-mail a pessoa de contas criadas à mão (inclusive Administradores gerais) e pode inativá-la, trocar o e-mail de login e a hierarquia, sem custódia
- Gravidade: Baixa
- Classificação: CONFIRMADA (caminho de código lido de ponta a ponta; decisão de produto envolvida)
- Local: `backend/src/modules/data-hub/application/writers/person-identity.ts:19-51` (`linkByAccountEmail`: qualquer pessoa
  `matricula is null` cuja conta tenha o e-mail do registro — sem olhar papéis de acesso); `writers/master-data-writers.ts`
  `employeesWriter.apply` (upsert de `name/role/team/active` e `reports_to_id`; passo 3 troca `user_accounts.email`); novo desde
  `9ec95073`/`18f00db1` (o campo passa a ser "da base" e fica só leitura na INIA — `domain/person-field-control.ts`).
- Evidência: o registro `{externalEmployeeId:"X1", email:"<e-mail do Administrador geral>", active:false, role:"OPERATOR", ...}`
  num feed EMPLOYEES grava a matrícula X1 na pessoa do Administrador geral (criado à mão na instalação) e o upsert a inativa —
  pessoa inativa perde a sessão (SEC-19). Cargas seguintes podem trocar o e-mail de login dela (passo 3) e o gestor/Grupo; a tela
  passa a tratar esses campos como "da base". Nada passa por `assertCredentialChangeAllowed` (custódia de credencial).
- Cenário de exploração: quem tem um token de push de um feed EMPLOYEES (credencial de sistema, sem expiração, guardada fora da
  INIA), ou controla o SFTP/banco/API de RH lido pela Central, bloqueia os administradores da INIA ou se coloca como gestor de
  qualquer equipe (o escopo de liderança segue `reports_to`). É o modelo de confiança "a base do cliente manda", mas a ligação por
  e-mail estendeu esse poder às contas administrativas que antes não tinham matrícula.
- Correção sugerida: em `linkByAccountEmail`, não ligar automaticamente pessoa com papel de acesso (`access_role_assignments`)
  — gerar aviso na quarentena pedindo "Vincular à pessoa da base" manual (que já existe); no writer, nunca aplicar `active=false`
  nem troca de e-mail a pessoa com papel de organização sem confirmação humana (quarentena como aviso); opcional: expiração e
  lista de IPs por token de push.
- Teste de regressão sugerido: `person-identity-proof` — registro com o e-mail de um Administrador geral sem matrícula → não liga,
  aviso `DATA_PERSON_LINK_REQUIRES_REVIEW`; pessoa comum sem papel → liga como hoje.

### DATA-9 — Teto de "ações caras" não cobre as rotas da Central que conectam ao destino (amostra, listagem SFTP, criação de conjunto)
- Gravidade: Baixa
- Classificação: CONFIRMADA
- Local: `backend/src/main/app.ts` (montagem de `/api/v1/admin/data-hub`, regex
  `^\/(database\/test|sources\/[^/]+\/(test-connection|preview)|feeds\/[^/]+\/preview)$`) × `data-hub-router.ts:182-198,273-278`
  (`POST /sources/:id/sample`, `POST /feeds/:id/sample`, `POST /sources/:id/sftp-files`), `:237-239,248-250`
  (`POST /sources/:id/feeds`/`PATCH /feeds/:id` com DATABASE abrem conexão para validar), `:77-87` (GET de objetos/colunas).
  As rotas `/preview` incluídas NÃO conectam (só mapeiam uma amostra enviada).
- Evidência: a amostra API Pull/SFTP/banco abre conexão ao destino e, no SFTP, baixa até 200 MB para a memória da API e faz o
  parse inteiro (`csv-parser.ts:125-139` lê o arquivo todo mesmo para 20 linhas).
- Cenário de exploração: Administrador geral (ou sessão roubada) usa `sample` em laço para sondar a rede interna sem o teto de
  30/min e pressionar a memória da API.
- Correção sugerida: trocar a regex por `^\/(database\/test|sources\/[^/]+\/(test-connection|sample|sftp-files)|feeds\/[^/]+\/sample)$`
  (e incluir criação/edição de conjunto de banco); avaliar mover a amostra SFTP/XLSX para o worker.
- Teste de regressão sugerido: em `http-security.test.ts`, 31 `POST /sources/:id/sample` na mesma conta → 429.

### DATA-10 — API Pull sem teto TOTAL por carga (só 50 MB por página): até 10 mil páginas acumuladas na memória do worker
- Gravidade: Baixa
- Classificação: CONFIRMADA
- Local: `backend/src/modules/data-hub/application/connectors/api-pull-connector.ts:109-161` (todas as páginas em `records`,
  `bytes` só contado); `domain/source-config.ts:97` (`maxPages` até 10.000, padrão 500); `run-pipeline.ts:123-129` (depois ainda
  `JSON.stringify(batch.records)` para o objeto bruto).
- Evidência: 500 páginas × 50 MB (padrão) = 25 GB possíveis numa carga; nada interrompe antes.
- Cenário de exploração: API do cliente com defeito (paginação que nunca esvazia) ou destino configurado por administrador derruba
  o worker da Central (todas as cargas param).
- Correção sugerida: teto total por carga (ex.: 200 MB / N registros, alinhado ao SFTP) com `DATA_SOURCE_VOLUME_LIMIT`, e
  aplicar por página (como a carga de banco faz) em vez de acumular tudo.
- Teste de regressão sugerido: HttpClient falso com páginas cheias infinitas → carga falha com `DATA_SOURCE_VOLUME_LIMIT` antes do
  teto.

### DATA-11 — Padrão de arquivo SFTP vira regex com retrocesso exponencial (ReDoS) no processo da API
- Gravidade: Baixa
- Classificação: CONFIRMADA (medido)
- Local: `backend/src/modules/data-hub/domain/source-config.ts:162-165` (`*` → `.*` sem limite) usado em
  `connectors/sftp-connector.ts:67-70` (rota `POST /sources/:id/sftp-files`, amostra e carga).
- Evidência: `globToRegExp("*a*a*a*a*a*a*a*a*ab").test("a".repeat(60))` levou 64 s (8 estrelas: 10,8 s) — o event loop fica
  parado; o nome do arquivo vem do servidor SFTP.
- Cenário de exploração: Administrador geral aponta uma fonte SFTP para um servidor próprio com arquivos de nome longo e usa um
  padrão com várias `*`: a API inteira para de responder enquanto a listagem roda.
- Correção sugerida: casar o glob sem regex (algoritmo linear de wildcard com dois ponteiros) ou limitar `*` a 3 e o nome a 255.
- Teste de regressão sugerido: o caso acima termina em < 50 ms.

### DATA-12 — API Push: corpo JSON de até 10 MB é lido e interpretado ANTES de autenticar o token
- Gravidade: Informativa
- Classificação: CONFIRMADA
- Local: `backend/src/modules/data-hub/presentation/data-ingestion-router.ts:20` (`router.use(express.json({limit:"10mb"}))`
  antes do handler que autentica, `:29`).
- Evidência: requisição sem token com 10 MB de JSON aninhado é parseada e só então recebe 401. Mitigado pelos limites por IP
  (600/min e 30 recusas/15 min por IP, `app.ts` `DEFAULT_RATE_LIMITS`), que rodam antes do parser.
- Correção sugerida: autenticar o `Authorization` (formato + hash no banco) num middleware antes do `express.json`; só então ler o
  corpo.
- Teste de regressão sugerido: POST sem token com corpo de 10 MB → 401 sem consumir o corpo (medir que o parser não foi chamado).

### DATA-13 — Itens menores de integrações (informativos)
- Gravidade: Informativa
- Classificação: CONFIRMADA (cada item lido no código)
- Itens:
  1. **Idempotency-Key reaproveitada com outro corpo** devolve a carga antiga (`deduplicated: true`) sem comparar o conteúdo
     (`push-ingestion.ts:53-58`): um cliente que reusa chaves perde lotes em silêncio. Sugestão: guardar o SHA-256 do corpo no
     run e responder 422 `DATA_PUSH_IDEMPOTENCY_CONFLICT` quando a chave volta com outro conteúdo.
  2. **API Pull aceita `http://` com credencial** (Bearer/Basic/API Key/client secret em claro na rede —
     `source-config.ts:22`, `fetch-http-client.ts:24`). Sugestão: com `auth.kind !== "NONE"`, exigir `https:` (ou aviso explícito
     gravado na auditoria).
  3. **Credencial usada além do feed**: a amostra aceita `connectorConfig` do corpo com `method` GET/POST e qualquer `endpoint` da
     mesma origem (`data-hub-router.ts:182-186`, `api-pull-connector.ts:59-65,130`) — o Administrador geral faz a INIA chamar
     qualquer rota da API do cliente com o token guardado (POST sem corpo incluso) e vê o JSON devolvido. É o mesmo poder de quem
     configura o feed; recomendação operacional: credencial de API do cliente só com escopo de leitura.
  4. **Dados de integração dentro de Markdown**: nomes de pessoas (feed EMPLOYEES, até 160 caracteres, texto livre) entram nas
     tabelas Markdown dos cartões da liderança escapando só `|` (`leadership-analytics/application/query-common.ts:146-152`) e o
     `RichContent` renderiza links `https:` (`frontend/src/components/rich-content/rich-content.tsx:58-62`). Um nome
     `[Clique aqui](https://site-externo)` vira link na conversa do líder. Imagens já são neutralizadas e `javascript:` bloqueado.
     Sugestão: escapar `[ ] ( ) * _ \`` além de `|` ao montar Markdown com dado de integração.
  5. **Erros de conector nas rotas síncronas** (`POST /sources/:id/sample` API Pull/SFTP, `POST /sources/:id/sftp-files`):
     `DataRunError` não é traduzido (só o caminho de banco usa `readingExternal`), vira 500 "Erro interno" e vai ao log com a
     mensagem — sem vazamento, mas o administrador não vê o motivo; usar o mesmo `readingExternal` (422 com código estável).
  6. **Prefixo do token de push** guarda 4 caracteres do segredo (`source-service.ts:267`, `inia_push_` + 4): 24 de 192 bits —
     irrelevante para força bruta; só registro.
  7. **Content-Disposition da Base**: `contentDisposition` troca `"` e não ASCII, mas mantém `\` no `filename="..."`
     (`knowledge/presentation/content-disposition.ts:5`); nome terminado em `\` gera aspas escapadas. Navegadores atuais usam o
     `filename*`; trocar também `\` por `_`.

---

## Verificações sem achado (o que foi conferido e está correto)

- **Autorização da Central**: as 41 rotas de `/admin/data-hub` exigem `data_hub.manage` de ORGANIZAÇÃO no `app.ts`; toda leitura
  usa `org(request)` (sessão) e `requireSource/requireFeed/requireRun` filtram por organização; objeto bruto pedido por id
  (`/feeds/:id/import`, amostra) usa `rawObjects.get(id, org)`; `uploads` confere `sourceId` do corpo; token restrito a feed só com
  feed da própria fonte (`createPushToken`). Nenhum id de organização/escopo vem do corpo.
- **SQL dos bancos externos**: não existe SQL livre nem "consulta personalizada" (só tabela/visão escolhida na descoberta —
  `database-sync.ts:6`); o objeto e as colunas são conferidos AO VIVO no catálogo (`describeObjectInSession`) antes de qualquer
  SELECT; identificadores citados por dialeto com o delimitador dobrado (aspas duplas, colchete e crase duplicados), NUL e > 128
  recusados; valores (busca, posição do checkpoint) sempre parametrizados; `LIMIT/TOP` inteiros validados; MySQL com
  `multipleStatements:false` e `execute` preparado. `; DROP`, CTE com escrita, `SELECT INTO`, `xp_cmdshell`, `COPY ... TO
  PROGRAM`, `LOAD_FILE` não têm caminho de entrada. Somente leitura: PostgreSQL `default_transaction_read_only=on`, MySQL/MariaDB
  `SESSION TRANSACTION READ ONLY` (+ tempo-limite de comando e de bloqueio); SQL Server depende do login (R-18, inalterado).
- **SQL do banco interno**: varredura automatizada de 1.373 interpolações `${}` em templates com SQL no backend (script no
  scratchpad) + revisão manual dos casos com identificador, literal entre aspas e `ORDER BY/LIMIT/OFFSET/interval`: todos são
  constantes, listas fechadas (`sourceColumn`, `SORT_SQL[...]`, `table` de enum), números do servidor ou placeholders
  (`filter.param`, `p.add/p.typed`); `LIMIT/OFFSET` de listagem parametrizados (`list-query.ts:149-155`); `jsonb_path_exists`
  com variável (`indicator-dependencies.ts:30-33`). Nenhum valor de requisição ou de integração interpolado.
- **Política de saída — formas de endereço**: `::ffff:127.0.0.1`, `::ffff:7f00:1`, `0:0:0:0:0:ffff:7f00:1`, `0.0.0.0/8`, `::`,
  `fe80::/10` (inclusive com zona `%lo0`), `169.254.0.0/16` em qualquer forma IPv6 mapeada, `fd00:ec2::254`, `metadata*` → negados
  (testado com `BlockList` do Node 24, que já trata IPv4 mapeado). `2130706433`/`0177.0.0.1`/`0x7f.1`: o `URL` do WHATWG normaliza
  para `127.0.0.1` no HTTP e o `lookup` resolve para 127.0.0.1 nos drivers → negado em produção. Nome que resolve para loopback →
  negado (todos os endereços resolvidos são conferidos). Redirecionamento: `redirect:"manual"` no HTTP da Central e no
  `guardedFetch` da IA; endpoint do feed só na origem da fonte (`buildUrl`). `::127.0.0.1` (IPv4 compatível, obsoleto) e
  `64:ff9b::/96` (NAT64) passam, sem rota prática fora de redes NAT64 — registrado só aqui.
- **Credenciais**: AES-256-GCM com IV aleatório de 12 bytes e chave fora do banco (`DATA_HUB_SECRET_KEY`, obrigatória em
  produção — `env.ts:158`); nunca devolvidas (`describe` só purpose/datas); mensagens de driver passam por `sanitizeDriverMessage`
  (senha e `user:senha@` removidos, 400 caracteres); logs da Central só com ids/códigos. `secretTargetOf` cobre host/porta/usuário/
  TLS/instância (banco), origem/tipo/URL do token/cabeçalho/usuário (API), host/porta/usuário/tipo (SFTP) — ver DATA-6 para o que
  falta. Tokens de push: 24 bytes aleatórios, só o SHA-256 guardado (busca por hash: sem comparação de texto), exibição única,
  revogação/rotação, revogados juntos ao excluir a fonte (transação), limite por token na loja PostgreSQL (60/min).
- **Concorrência das cargas**: índice único parcial "uma execução ativa por feed" (`056_data_hub.sql:201`) com retorno à fila em
  `23505` (`run-pipeline.ts:250`); `Idempotency-Key` com índice único por feed e corrida resolvida devolvendo o vencedor
  (`push-ingestion.ts:60-68`); claim com `for update skip locked` + lease.
- **Arquivos**: tipo decidido pelo servidor (Base: assinatura `%PDF-`/ZIP/sem NUL; imagens de perfil e cenário: assinatura PNG/
  JPEG/WebP + dimensões; nada de SVG); downloads `attachment` + `nosniff` + `CSP default-src 'none'; sandbox`; imagens com
  `default-src 'none'`; armazenamento em `bytea` (sem caminho em disco, sem temporários — nenhum `writeFile/tmpdir` no backend);
  nomes de arquivo só como metadado. XXE/"billion laughs": `mammoth` recusa entidade de DTD (testado: `entity not found`), exceljs
  usa `saxes` sem DTD.
- **CSV exportado**: rejeições da Central, Diagnóstico e Monitoria de usabilidade neutralizam `= + - @ TAB CR` com apóstrofo e
  aspas dobradas; preâmbulo do Diagnóstico usa `JSON.stringify` (sem quebra de linha); nomes de arquivo de lista fechada/datas
  validadas/uuid.
- **Renderização de dados de integração**: React escapa texto; os dois `dangerouslySetInnerHTML` com conteúdo (prévia DOCX e
  comunicado local) passam por sanitizador de lista de permissões (atributos zerados, `<img>` só `data:image/*`, `<a>` só
  `http(s)/mailto`); `RichContent` com `skipHtml`, `img` neutralizada e `javascript:` bloqueado (ver DATA-13.4 para links).
- **Ingestão legada** (`/api/v1/ingestion`): `data_hub.manage` de organização, organização da sessão, colaborador da organização,
  tamanhos limitados (SEC-23) — inalterado desde a auditoria anterior além do `subReason` (≤ 500).
- Provas unitárias existentes rodadas: `zip-guard`, `outbound-destination-policy`, `secret-binding`, `csv-parser`, `database`
  (38 testes, todos passam — nenhum cobre os casos de DATA-1/2/4/6/11).

## Riscos já conhecidos — situação em 17/10/2026

| Risco | Situação |
|---|---|
| R-03 DNS rebinding | Aberto — ver DATA-7 (como fixar o IP em cada transporte) |
| R-08 TLS PREFERRED | Aberto e mais amplo — DATA-5 (SQL Server também) e DATA-4 (VERIFY_FULL do MySQL sem nome) |
| R-09 SFTP TOFU | Aberto — e a fingerprint fixada pode ser apagada sem senha (DATA-6) |
| R-10 cabeçalhos livres em claro | Aberto (inalterado; `GET /sources/:id` devolve `config.api.headers`) |
| R-12 AES-GCM sem AAD | Aberto (inalterado) |
| R-18 somente leitura no SQL Server | Aberto (inalterado) |
| SEC-29 zip bomb | Reaberto — DATA-1 (a guarda confia no tamanho declarado) |

## Cobertura

Autenticação "sessão" = `requirePermission` (que inclui `requireAuth`, sessão conferida no banco). "org" = permissão com escopo
de organização (`organizationWide: true`). Objeto: como o recurso concreto é conferido.

| Módulo / arquivo de rota | Rotas (método + caminho) | Autentica | Autoriza o OBJETO | Resultado |
|---|---|---|---|---|
| `data-hub/presentation/data-hub-router.ts` — banco externo | `POST /admin/data-hub/database/test`; `GET /sources/:id/database/objects`; `GET /sources/:id/database/columns` | sessão + `data_hub.manage` org | `requireSource(org)`; senha guardada só para o MESMO destino (`secretTargetOf`) | ok autorização; DATA-2, DATA-4, DATA-5, DATA-6, DATA-7; GET fora do teto (DATA-9) |
| idem — visão geral/contratos | `GET /overview`, `GET /quality`, `GET /contracts`, `GET /contracts/:key`, `GET /lineage` | idem | consultas filtradas por `org`; contratos são catálogo estático | ok |
| idem — fontes | `GET /sources`, `POST /sources`, `GET /sources/:id`, `PATCH /sources/:id`, `DELETE /sources/:id`, `POST /sources/:id/test-connection`, `POST /sources/:id/status`, `POST /sources/:id/secrets` | idem | `requireSource(org)`/`listSourceSummaries(org)`; troca de destino exige credencial; exclusão em transação revoga tokens e segredos | ok autorização; DATA-6 (CA/fingerprint), R-10 (cabeçalhos no `GET`) |
| idem — tokens de push | `GET /sources/:id/tokens`, `POST /sources/:id/tokens`, `POST /sources/:id/tokens/:tokenId/revoke`, `POST /sources/:id/tokens/:tokenId/rotate` | idem | `organization_id` + `source_id` + `id` em toda escrita; feed do token da mesma fonte | ok |
| idem — amostra/prévia/SFTP/upload | `POST /sources/:id/sample`, `POST /sources/:id/preview`, `POST /sources/:id/sftp-files`, `POST /uploads` | idem | `requireSource(org)`; objeto bruto por `(id, org)`; endpoint da API só na origem da fonte | DATA-1 (XLSX), DATA-9 (sem teto), DATA-11 (ReDoS), DATA-13.3/13.5 |
| idem — feeds | `GET /sources/:id/feeds`, `POST /sources/:id/feeds`, `GET /feeds/:id`, `PATCH /feeds/:id`, `DELETE /feeds/:id`, `POST /feeds/:id/status`, `POST /feeds/:id/sync`, `POST /feeds/:id/checkpoint/reset`, `POST /feeds/:id/sample`, `POST /feeds/:id/preview`, `POST /feeds/:id/import` | idem | `requireFeed(org)` + `requireSource(org, feed.sourceId)`; conector = tipo da fonte; objeto bruto por `(id, org)` | ok autorização; DATA-9 |
| idem — cargas | `GET /runs`, `GET /runs/:id`, `GET /runs/:id/rejections`, `GET /runs/:id/rejections.csv`, `POST /runs/:id/reprocess`, `POST /runs/:id/cancel` | idem | `requireRun(org)`; filtros parametrizados; CSV com fórmula neutralizada | ok |
| `data-hub/presentation/data-ingestion-router.ts` (API Push) | `POST /api/v1/data-ingestion/:sourcePublicId/:feedKey` | token de push (hash SHA-256) + limites por IP antes e por token depois | token → fonte (`public_id` da URL) → feed (`feed_key`) → restrição de feed; fonte/feed ativos; organização vem da fonte | ok autorização; DATA-8 (poder do feed EMPLOYEES), DATA-12, DATA-13.1 |
| `data-hub/application/connectors/*`, `infrastructure/*` (HTTP, SFTP, SQL Server, PostgreSQL, MySQL/MariaDB, cifra, objeto bruto, XLSX) | — (usados pelas rotas acima e pelo worker) | — | política de saída antes de cada conexão; segredos só no adaptador | DATA-1, 2, 3, 4, 5, 6, 7, 10, 11 |
| `data-hub/application/writers/*` (EMPLOYEES, estrutura, interações, medições, fechamento oficial, ausências) | — (worker) | — | organização do run; SQL com `unnest` parametrizado | DATA-8 (ligação por e-mail/inativação de contas administrativas) |
| `shared/infrastructure/outbound-destination-policy.ts`, `config/outbound-policy.ts` | — | — | — | DATA-2, DATA-3, DATA-7; formas de IPv4/IPv6 ok |
| `shared/infrastructure/zip-guard.ts` | — | — | — | DATA-1 |
| `ingestion/presentation/ingestion-router.ts` (legada) | `POST /api/v1/ingestion/indicator-measurements/batch`, `POST /api/v1/ingestion/interactions` | sessão + `data_hub.manage` org | organização da sessão; colaborador/indicador da organização | ok (erro de indicador inválido vira 500 em vez de 422 — robustez) |
| `knowledge/presentation/knowledge-router.ts` | `GET /admin/knowledge`, `GET /:id`, `GET /:id/file`, `GET /:id/preview`, `POST /`, `PATCH /:id`, `DELETE /:id` | sessão + `knowledge.manage` (qualquer escopo) | `loadDocumentScopes(org)` + `canReadDocument`/`canWriteDocument` (fora = 404/403) | ok autorização; DATA-1 (DOCX/PDF no upload e prévia), DATA-13.7 |
| `knowledge/presentation/knowledge-material-router.ts` | `GET /api/v1/knowledge-materials/:id`, `GET /:id/file`, `GET /:id/preview` | sessão (`requireAuth`) | `loadAccessibleKnowledgeMaterial`: organização, versão PUBLISHED, alcance × cadeia `reports_to` ou `knowledge.manage` | ok autorização; DATA-1 (prévia a cada leitura) |
| `profile-preferences/presentation/profile-preferences-router.ts` | `GET /api/v1/me/profile`, `PUT /api/v1/me/profile`, `GET /api/v1/profile-images/:id` | sessão | sempre a pessoa da sessão (schema `.strict()`); imagem só da organização e EM USO | ok (imagem validada por assinatura; original guardado sem reencode — metadados EXIF de upload direto pela API ficam, informativo) |
| `inia-scenes/presentation/inia-scene-router.ts` | admin: `GET /api/v1/admin/inia-scenes`, `POST /`, `PATCH /:id`, `DELETE /:id`, `PUT /default`; leitura: `GET /api/v1/inia-scenes/current`, `GET /images/:imageId`, `GET /:id/image` | admin: `inia_experience.manage` org; leitura: sessão | organização da sessão em toda leitura | ok (multer com campo de arquivo restrito; imagem por assinatura) |
| Exportações CSV | `GET /admin/data-hub/runs/:id/rejections.csv`; `GET /api/v1/diagnostics/memory/export.csv` (`diagnostics-router.ts:158-205`); `GET /api/v1/admin/usability/export.csv` (`usability-router.ts:69-90`, flag OFF) | conforme cada router | run por `org`; diagnóstico pelo escopo do viewer; usabilidade por `ctx.can.export` | ok (fórmula neutralizada; nome de arquivo de lista fechada) — autorização do Diagnóstico/Usabilidade é da área de outro auditor, revisada só a exportação |
| SQL dinâmico do backend (todos os módulos) | — | — | — | ok — ver "Verificações sem achado" (1.373 interpolações varridas; casos de identificador/literal revisados à mão) |
| Frontend — renderização de dado de integração | `components/admin/data-hub/**`, `knowledge-detail-page.tsx`, `knowledge-material-page.tsx`, `rich-content.tsx`, `structure-follow-up-feed.tsx` | — | — | ok; DATA-13.4 (links Markdown a partir de nomes) |

Não revisado (fora da área ou sem relação): `usage-analytics/presentation/usage-events-router.ts` (`express.text`, coleta desligada no
POC — área de usabilidade); autorização interna das rotas do Diagnóstico e da Monitoria de usabilidade (só a exportação foi lida).
