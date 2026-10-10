# Central de Dados — bancos de dados externos

> **Estado (2026-10-06): implementado.** Conector `DATABASE` da Central de Dados (migration 119). A INIA **lê** tabelas e
> visões de um banco do cliente — SQL Server, PostgreSQL, MariaDB ou MySQL — e as transforma num conjunto de dados da INIA
> (colaboradores, medições, fechamentos…) pelo MESMO caminho de sempre: contrato → mapeamento → validação → writer →
> quarentena → lineage. Nada aqui é um caminho paralelo de ingestão.
>
> Não confundir com o **banco interno da INIA** (PostgreSQL, `DATABASE_URL`, migrations): este documento trata só dos
> bancos EXTERNOS, configurados pela tela.

## Para quem configura (tela)

**Administração › Central de Dados › Conectar banco de dados** (também no estado vazio da visão geral):

1. **Banco** — SQL Server, PostgreSQL, MariaDB ou MySQL.
2. **Conexão** — nome, servidor, porta (padrão do tipo), banco, usuário e senha. "Opções avançadas" (fechadas): instância
   nomeada (só SQL Server), criptografia (TLS) e certificado da autoridade. **Testar conexão** é obrigatório para
   continuar; o resultado diz versão do servidor, se o tráfego está cifrado, se a sessão é somente leitura e quantas
   tabelas/visões o usuário enxerga — ou a causa do erro em linguagem de gente (senha recusada, servidor inalcançável,
   banco inexistente ou sem acesso, certificado inválido, tempo esgotado).
3. **Tabela ou visão** — busca entre os objetos que o usuário pode ler; ao escolher, as colunas aparecem com o tipo e a
   chave primária.
4. **Conjunto de dados** — qual contrato da INIA a tabela alimenta, o nome do conjunto e **como ler**: *Incremental*
   (campo de atualização + chave de desempate, já sugeridos) ou *Leitura completa*. Opções avançadas: linhas por página,
   limite por carga e releitura de segurança (minutos).
5. **Amostra e mapeamento** — 20 linhas reais (só leitura) e o mapeamento sugerido por nome e pelo tipo dos valores da
   amostra. A pessoa confere e marca "Conferi as associações dos campos obrigatórios" — a INIA nunca adivinha
   equivalência de negócio.
6. **Validar e ativar** — a amostra passa pelo mesmo validador da carga real (nada é gravado), frequência, fonte
   oficial (cadastros mestres) e **Ativar e importar**.

Uma conexão alimenta **vários conjuntos**: "Adicionar outro conjunto desta conexão" (ou `?sourceId=` na rota do
assistente) começa direto na escolha da tabela, sem redigitar servidor, usuário ou senha. Na página da fonte, a aba
**Configuração** edita a conexão (senha em branco = manter a guardada); no conjunto de dados, a leitura pode ser
alterada e a posição (checkpoint) pode ser zerada ("Ler tudo de novo na próxima carga").

## Garantias (aplicadas por código)

| Tema | Regra |
| --- | --- |
| Quem executa | Sempre o backend. A conexão sai do servidor da API, nunca do navegador. |
| Somente leitura | Só `SELECT` gerado pela INIA a partir de tabela/visão escolhida (nunca SQL livre). Além disso: PostgreSQL `default_transaction_read_only=on`; MySQL/MariaDB `SET SESSION TRANSACTION READ ONLY`; SQL Server `ApplicationIntent=ReadOnly` + só leitura. O teste informa se o PRÓPRIO banco garante a sessão somente leitura. |
| Identificadores | Validados (`assertIdentifier`, até 128 caracteres) e citados pelo dialeto; valores sempre como parâmetros. |
| Limites | Tempo de conexão (15 s) e de consulta (120 s) por conexão; `LOCK_TIMEOUT` 10 s no SQL Server; `max_execution_time`/`max_statement_time` no MySQL/MariaDB; `statement_timeout` no PostgreSQL; no máximo 2 operações simultâneas por conexão; amostra de 20 linhas; até 2.000 objetos na descoberta; página 100–10.000 linhas (padrão 1.000); limite por carga 1.000–1.000.000 (padrão 50.000). |
| Segredos | Senha cifrada com AES-256-GCM (`data_secrets`, propósito `DATABASE_PASSWORD`, chave `DATA_HUB_SECRET_KEY` fora do banco). Nunca devolvida pela API, nunca em log, nunca na auditoria; mensagens de erro do driver passam por `sanitizeDriverMessage`. |
| Permissão e organização | Rotas sob `data_hub.manage` na organização da sessão; fonte de outra organização = 404. |
| Teste/amostra/validação | Nunca gravam nada nos dados de negócio. A importação só acontece depois de ativar (frequência ou "Sincronizar agora"). |
| Nada no banco do cliente | A INIA nunca cria, altera ou apaga tabela, visão, índice ou linha no banco externo. |

## Como a carga lê

- **Ordenação estável por keyset**: `ORDER BY` cursor + chaves; a posição guardada é o TEXTO EXATO de cada coluna da
  última linha aplicada (PostgreSQL `::text`, MySQL/MariaDB `CAST AS CHAR`, SQL Server `CONVERT(nvarchar, …, 126)`),
  comparada de volta no tipo nativo — sem perder microssegundos nem arredondar decimais.
- **Página a página** (contratos de evento/medição): cada página é mapeada, validada e aplicada numa transação que
  também grava quarentena, lineage, contadores da carga e o checkpoint. Falhou no meio? A página não aplicada não move
  a posição; a próxima carga retoma dali. Linha rejeitada vai para a quarentena; página sem nenhuma linha válida
  interrompe a carga (`DATA_NO_VALID_RECORDS`) sem avançar.
- **De uma vez** (cadastros mestres como Colaboradores, contratos `ATOMIC`, feed que falha com qualquer rejeição, ou
  leitura completa sem chave): lê tudo o que está pendente (até o limite por carga) e aplica pelo pipeline normal; o
  checkpoint só avança depois de concluir.
- **Empates**: com o mesmo valor de cursor, a página termina antes do grupo empatado e a carga seguinte o lê inteiro
  (`planPage`); se um grupo sozinho for maior que a página, ele é lido em uma consulta própria por igualdade.
- **Limite por carga**: passou do limite, a carga termina com sucesso e enfileira uma continuação (`CONTINUATION`) do
  ponto aplicado.
- **Releitura de segurança** (`lookbackMinutes`, só cursor de data/hora): reler N minutos antes da posição — pega linhas
  gravadas com atraso; o upsert idempotente as conta como "sem mudança".
- **Carga interrompida** (processo caiu): a lease vence e `recoverInterruptedRuns` devolve a carga à fila, que retoma
  do checkpoint aplicado.
- **Sem campo confiável** de atualização: a tela só oferece incremental quando existe coluna de data/hora ou número;
  senão, leitura completa (com chave = em páginas, retomável; sem chave = uma consulta limitada). Linhas com o campo de
  atualização vazio não são lidas pelo incremental — a tela avisa.

## Mudança de esquema e erros

- Cada carga descreve de novo a tabela: coluna mapeada obrigatória que sumiu = `DATA_SCHEMA_CHANGED` (feed degradado);
  coluna nova não afeta nada. Permissão revogada = `DATA_SOURCE_PERMISSION_DENIED`; tabela removida =
  `DATA_SOURCE_NOT_FOUND`.
- Códigos estáveis (`domain/error-codes.ts`): `DATA_SOURCE_AUTH_FAILED`, `DATA_SOURCE_UNREACHABLE`,
  `DATA_SOURCE_TIMEOUT`, `DATA_SOURCE_TLS_FAILED`, `DATA_SOURCE_PERMISSION_DENIED`, `DATA_SOURCE_NOT_FOUND`,
  `DATA_SOURCE_VOLUME_LIMIT`, `DATA_SCHEMA_CHANGED`. Transitórios (rede/tempo) seguem o retry com backoff de sempre.

## Mapa do código

| Camada | Arquivos |
| --- | --- |
| Domínio | `domain/database/database-engine.ts` (tipos, portas, TLS, config da conexão), `column-types.ts` (categorias por tipo nativo, elegibilidade de cursor/chave), `sql-dialect.ts` (descoberta, amostra, páginas keyset por dialeto), `database-sync.ts` (modo de leitura, checkpoint, `planPage`), `value-normalization.ts` (datas, decimais, bigint), `database-errors.ts` (classificação e sanitização) |
| Adaptadores | `infrastructure/external-databases/postgres-session.ts` (`pg`), `mysql-session.ts` (`mysql2`, MySQL e MariaDB), `sqlserver-session.ts` (`mssql`/tedious), `external-database-connector.ts` (porta `ExternalDatabaseConnector`) |
| Aplicação | `application/connectors/database-connector.ts` (teste, descoberta, colunas, amostra, semáforo por fonte), `application/database-run.ts` (plano de leitura, páginas, carga de uma vez), integração em `run-pipeline.ts`, `run-service.ts` (continuação, recuperação, zerar checkpoint), `source-service.ts` (teste de rascunho sem gravar), `feed-service.ts` |
| API | `POST /api/v1/admin/data-hub/database/test` (rascunho), `GET /sources/:id/database/objects?search`, `GET /sources/:id/database/columns?schema&name`, `POST /feeds/:id/checkpoint/reset` — mais as rotas de sempre (fontes, feeds, amostra, preview, sincronizar) |
| Tela | `frontend/src/components/admin/data-hub/database/*` (assistente, campos de conexão, seletor de objetos, leitura, configuração da fonte e do feed) |
| Migration | `119_data_hub_external_databases.sql` (tipo `DATABASE`, gatilho `CONTINUATION`, índice de lease) |

## Compatibilidade testada

| Banco | Versão testada | Driver | Situação |
| --- | --- | --- | --- |
| PostgreSQL | 17.11 | `pg` | prova completa (10 cenários) + tela |
| MariaDB | 11.4.13 | `mysql2` | prova completa (10 cenários) + tela |
| MySQL | 8.4.11 | `mysql2` | prova completa (10 cenários) + teste de conexão pela tela |
| SQL Server | — | `mssql` 12 / tedious | **não validado contra servidor real** (o Mac de teste não tinha Rosetta para a imagem x86); dialeto e geração de SQL cobertos por testes de domínio — rode a prova com `npm run examples:sqlserver:up` antes de usar em produção |

Versões mínimas declaradas na tela: SQL Server 2016, PostgreSQL 12, MariaDB 10.5, MySQL 8.0 (abaixo disso, a sintaxe de
tempo limite/somente leitura não é garantida).

## Provas

- Domínio: `npx vitest run src/modules/data-hub/domain` (inclui `domain/database/database.test.ts`).
- Contra bancos reais (os exemplos do `compose.yaml` e o banco de teste da INIA):

```bash
npm run examples:up
```

```bash
npm run examples:sqlserver:up
```

```bash
cd backend && INIA_DB_PROOF=1 INIA_EXTERNAL_DB_PROOF=1 NODE_ENV=test npx vitest run external-database-proof
```

  Por padrão roda os quatro bancos e um banco listado que não responde FALHA (nunca vira "pulado"); sem o SQL Server
  de exemplo, use `INIA_EXTERNAL_DB_ENGINES=POSTGRESQL,MARIADB,MYSQL`. Cenários por banco: erros do teste (senha, rede,
  servidor que não responde, TLS), criação da fonte, descoberta/colunas/permissão, colaboradores incremental, 2.500
  medições em páginas de 100 com continuação, empates sem chave, falha de rede e retomada, falha ao aplicar sem avançar,
  carga interrompida e recuperada, mudança de esquema/permissão revogada/zerar posição, segredos e isolamento de
  organização. Os bancos de prova são criados e apagados pela própria prova (`testing/external-database-admin.ts`).

## Limitações

- Sem SQL livre: só tabela ou visão (uma visão no banco do cliente resolve filtros e junções).
- Autenticação só por usuário e senha do próprio banco (sem Windows/Kerberos, Azure AD ou IAM).
- Colunas binárias não são lidas (viram vazio); JSON chega como texto.
- A estimativa de linhas na descoberta é a do próprio banco (InnoDB pode errar bastante).
- Exclusões na origem não são detectadas pelo incremental (como nos outros conectores, ausência nunca desativa).
