# Dados de exemplo para o primeiro feedback (IT-INIA-005)

Uma instalação limpa da INIA (`npm run setup` sem `--demo`) nasce sem Grupos, sem indicadores, sem chamadas e sem
fechamento oficial. Com endereço público ela roda com `NODE_ENV=production`, e a massa de demonstração é recusada de
propósito. Para seguir a **IT-INIA-005** até o primeiro feedback de monitoria e o primeiro feedback de indicador, o
"banco do cliente" de exemplo traz tudo o que falta, e tudo entra pela **Central de Dados**, como entraria o dado de
um cliente de verdade.

Tudo aqui é **fictício**: pessoas, clientes, conversas, protocolos e valores. Nunca misture com dado real.

| Arquivo | Para quê |
| --- | --- |
| `docker/external-examples/<banco>/init.sql` | O banco de exemplo (SQL Server, PostgreSQL, MySQL e MariaDB). Os dados deste roteiro ficam no fim de cada arquivo, entre `>>> DADOS PARA O PRIMEIRO FEEDBACK` e `<<< FIM DOS DADOS PARA O PRIMEIRO FEEDBACK`. |
| [procedimentos/](procedimentos/) | Os quatro procedimentos fictícios que as chamadas seguem, prontos para colar em Base de conhecimento (etapa 3 da IT). |
| `backend/scripts/data-hub/first-feedback-examples.ts` | Gera esse trecho igual nos quatro bancos (ver "Mudar os dados", no fim). |

## 1. O que vem no banco de exemplo

| Tabela | Conjunto de dados na Central | Linhas | O que é |
| --- | --- | --- | --- |
| `grupos` | Grupos | 1 | Grupo **Atendimento** (código `ATENDIMENTO`) |
| `subgrupos` | Subgrupos | 2 | **Equipe A** (de Ana Souza, EX-0001) e **Equipe B** (de Bruno Lima, EX-0002) |
| `colaboradores` | Colaboradores | 30 | Já existia. Ganhou as colunas `grupo` e `subgrupo` |
| `metas` | Metas | 1 | TMA de no máximo **300 s** para o Grupo, desde 01/01/2026 |
| `medicoes_diarias` | Medições operacionais | 560 | Já existia: TMA diário de 1 a 20/09/2026 |
| `fechamento_mensal` | Fechamento oficial por indicador | 56 | TMA **oficial** de agosto e setembro de 2026 dos 28 operadores: valor, meta, atingimento e quartil |
| `chamadas` | Interações | 288 | 12 operadores × 12 chamadas por mês. Agosto só com a duração; **setembro com a transcrição** (144) |

As chamadas têm três motivos, sempre escritos do mesmo jeito: **Segunda via**, **Contestação de valor** e **Reparo de
internet**. A transcrição tem uma fala por linha, começando por `Operador:` ou `Cliente:`. O horário está no fuso da
operação (a Central lê no fuso da organização).

**A história que os dados contam.** Elisa Almeida (EX-0005, Equipe A) fechou agosto com TMA oficial de 284 s (Q1) e
setembro com 321 s (Q4), acima da meta de 300 s. Segunda via e Reparo de internet ficaram iguais. As chamadas de
**Contestação de valor** passaram de ~307 s para ~418 s: nelas ela não informa o prazo da análise nem o canal de
retorno, deixa o cliente esperando sem aviso, usa "É só aguardar." e não recapitula. Os colegas de menor TMA (Diego,
Karina, Lucas, Carla, Isabela) atendem o mesmo motivo seguindo o procedimento. É isso que o feedback de indicador deve
encontrar. O TMA oficial de setembro de cada pessoa é a média das medições diárias dela, e a média das chamadas fecha
com o TMA oficial de cada mês.

## 2. Pôr os dados no banco de exemplo

**SQL Server da homologação (Windows).** O mesmo `init.sql` de sempre. Rodar de novo num banco já criado só acrescenta
o que falta (colunas, tabelas e linhas); nada é duplicado. Use `-f 65001` para o `sqlcmd` ler o arquivo como UTF-8;
sem isso, os acentos dos nomes e das conversas chegam trocados:

```powershell
sqlcmd -S localhost -U sa -f 65001 -i C:\instaladores\init.sql -v READER_PASSWORD='SENHA-FORTE-DO-INIA_LEITURA'
```

**Docker, para avaliar no próprio computador.** `npm run examples:up` cria os bancos com tudo. Um banco de exemplo
PostgreSQL, MariaDB ou MySQL criado antes desta versão não roda o script de novo; recrie os contêineres (são só
dados fictícios): `docker compose --profile external-examples rm -sfv example-postgres example-mariadb example-mysql` e
`npm run examples:up`. O SQL Server de exemplo roda o script a cada `npm run examples:sqlserver:up`.

## 3. Antes da Central: criar o indicador TMA

O catálogo de indicadores de uma instalação limpa está vazio, e as medições, a meta e o fechamento apontam para o código
`TMA`. Em **Administração › Indicadores › Novo indicador**:

| Campo | Valor |
| --- | --- |
| Código | `TMA` |
| Nome | Tempo Médio de Atendimento |
| Unidade | Segundos (tempo) |
| Direção desejada | Menor é melhor |
| Medição operacional | Ligada, com estratégia de consolidação **Média** |
| Fechamento oficial | Ligado |
| Comprova atividade operacional | Opcional (ligado no ensaio) |

## 4. Carregar pela Central de Dados

**Administração › Central de Dados › Conectar banco de dados**: o banco, o usuário somente leitura `inia_leitura` e
**Testar conexão**. Depois, para cada linha da tabela abaixo, **nesta ordem**, escolha a tabela, o conjunto de dados e
a leitura, confira a amostra, valide e ative. Da segunda em diante, use **Adicionar outro conjunto desta conexão** (a
senha é reaproveitada).

| # | Tabela | Conjunto de dados | Leitura | Mapear à mão |
| --- | --- | --- | --- | --- |
| 1 | `grupos` | Grupos | Leitura completa | — |
| 2 | `subgrupos` | Subgrupos | Leitura completa | — |
| 3 | `colaboradores` | Colaboradores | Incremental por `atualizado_em`, chave `matricula` | `situacao` → **Situação funcional (bruta)** |
| 4 | `metas` | Metas | Leitura completa | — |
| 5 | `medicoes_diarias` | Medições operacionais | Incremental por `atualizado_em`, chave `id` | — |
| 6 | `fechamento_mensal` | Fechamento oficial por indicador | Leitura completa | — |
| 7 | `chamadas` | Interações | Incremental por `atualizado_em`, chave `id_chamada` | — |

A ordem importa: o Grupo e os Subgrupos precisam existir antes dos colaboradores, e as pessoas antes das metas, das
medições, do fechamento e das chamadas. Todos os outros campos vêm sugeridos pelo nome da coluna. Só a situação
funcional precisa ser escolhida, porque `situacao` não é sim/não.

- **Colaboradores já carregados sem Grupo** (o H09 da homologação, antes desta versão do script): carregue Grupos e
  Subgrupos, acrescente ao mapeamento do conjunto de Colaboradores `grupo` → Código do Grupo e `subgrupo` → Código do
  Subgrupo e clique em **Sincronizar agora**. O script mudou o `atualizado_em` das 30 linhas, então a leitura
  incremental relê todas.
- **Banco de exemplo na mesma máquina da INIA, em produção:** a política de saída recusa o próprio servidor
  ("loopback só com liberação explícita", `DATA_SOURCE_DESTINATION_DENIED`). Libere só esse destino no `backend/.env`
  — `INIA_OUTBOUND_ALLOWED_DESTINATIONS=127.0.0.1:1433` para o SQL Server na mesma máquina (foi o caso da homologação
  na Azure, numa VM só, em 15/10/2026) ou `127.0.0.1:55432` para o PostgreSQL de exemplo do Docker — e reinicie a API e
  o Processamento (a API testa a conexão; o Processamento faz as cargas). Com o banco em outra máquina, na rede
  privada, isso não acontece.

## 5. O que conferir

| Onde | O que deve aparecer |
| --- | --- |
| Central de Dados › Cargas | 7 cargas **Concluídas**, 0 rejeitados: 1, 2, 30, 1, 560, 56 e 288 recebidos |
| Usuários e acessos › Pessoas | 30 pessoas no Grupo Atendimento, Equipe A ou B, com gestor direto |
| Ficha de um operador › Indicadores (como gestor dele) | Tempo Médio de Atendimento do fechamento de setembro, com meta de 5m00s, atingimento e quartil oficial. O Administrador geral criado pelo `setup` (fora da hierarquia) ainda vê essa aba carregando sem fim: defeito encontrado neste ensaio; confira como gestor (libere o acesso de Bruno Lima, EX-0002, pela IT-INIA-002) |
| Workflow manual de monitoria › Executar agora (etapa 9) | 28 colaboradores; para Elisa Almeida, 12 chamadas de setembro (só as com transcrição) |
| `varredura opcoes --team <código do grupo> --period 2026-09` (etapa 8) | 48 chamadas transcritas de 12 pessoas em cada um dos três motivos |

## 6. Na IT-INIA-005, com estes dados

| Etapa | O que usar |
| --- | --- |
| 2. Domínios | **Faturamento** (Segunda via, Contestação de valor) e **Suporte Técnico** (Reparo de internet) |
| 3. Bases | Os quatro arquivos de [procedimentos/](procedimentos/), cada um como uma base: Tipo Procedimento, Todos os grupos. Publique as quatro |
| 5. Especialistas | Faturamento: bases 01, 02 e 04. Suporte Técnico: bases 03 e 04. Especialista de indicadores: as quatro. Textos do Anexo A da IT |
| 6. Orquestrador | Os dois domínios e os dois especialistas |
| 7. Estratégia do TMA | Como na IT. Em **Testar diagnóstico**, escolha Elisa Almeida e a medição mais recente da lista (18/09/2026), com a IA desligada. Resultado esperado, sem custo: TMA 379 s fora da meta de 300 s; **Contestação de valor** piorou de ~307 s para ~418 s e é o assunto investigado (4 chamadas de 12 a 18/09) |
| 8. Varredura | `--subject "Contestação de valor" --period 2026-09 --indicator TMA --per-person 3`: 36 chamadas de 12 pessoas, cerca de US$ 3,60 pelo custo medido na IT |
| 9. Monitoria | Elisa Almeida, uma chamada de **Contestação de valor** de 14 a 18/09: espera-se o ajuste de prazo (5 dias úteis), canal (SMS) e recapitulação. Uma chamada de Diego Costa do mesmo motivo serve para ver reconhecimento |
| 10. Indicador | Elisa Almeida. A INIA usa o fechamento de 2026-09 (321 s, Q4) contra agosto (284 s, Q1), localiza Contestação de valor, analisa as chamadas dela e compara com 4 dos 11 colegas de melhor tempo nesse motivo |

Os custos de IA das etapas 8 a 10 são os da seção 17 da IT. O ensaio local destes dados nunca chamou a IA.

## 7. O que fica de fora

- **Flags** (nota da URA, rechamada): o exemplo não traz o conjunto Flags de interação, então a etapa 12 (monitoria
  automática por flag) não tem o que disparar.
- **PRV**: não há conjunto "PRV consolidado". O cartão de PRV da ficha fica vazio, e isso é esperado. O feedback de
  indicador da IT usa o formato "Diagnóstico de um indicador, sem PRV".
- **Escalas**: ninguém tem escala carregada; todos ficam no padrão de segunda a sexta.
- **Situação funcional**: EX-0001, EX-0010, EX-0019 e EX-0028 vêm de **férias** (situação conhecida a partir da carga).
  Nenhum deles tem chamadas.
- **Datas fixas** (agosto e setembro de 2026): servem enquanto setembro de 2026 for um mês fechado, o que vale de
  outubro de 2026 em diante. A comparação operacional de "últimos 7 dias" da ficha diz "sem dados operacionais
  suficientes", porque as medições diárias terminam em 20/09.

## 8. Ensaio de 14/10/2026 (instalação limpa, sem IA)

Instalação limpa com `NODE_ENV=production` num banco interno novo, banco de exemplo PostgreSQL com este `init.sql`,
tudo pela API que as telas usam e conferido na interface:

- as 7 cargas concluídas sem nenhuma rejeição; todos os campos sugeridos pelo nome, menos a situação funcional;
- 30 pessoas com Grupo, Subgrupo e gestor; 288 chamadas no horário local; 144 transcrições íntegras;
- ficha de operador › Indicadores (como gestor) com o fechamento oficial, a meta, o atingimento e o quartil;
- "Testar diagnóstico" (sem IA) e o mesmo motor pelo fechamento de setembro (o caminho do Workflow): Contestação de
  valor localizada, grupo de referência de 4 entre 11 colegas, **0 chamadas de modelo**;
- `varredura opcoes` com os três motivos.

O `init.sql` do SQL Server, do MySQL e do MariaDB sai do mesmo gerador, mas não foi executado neste ensaio (sem
Docker/Rosetta na máquina). O SQL Server é testado de verdade na seção 5.3 da homologação.

## Mudar os dados

Nunca edite o trecho gerado à mão. Mude `backend/scripts/data-hub/first-feedback-examples.ts` e rode, em `backend`:

```bash
npx tsx scripts/data-hub/first-feedback-examples.ts
```

```bash
npx vitest run scripts/data-hub/first-feedback-examples.test.ts
```

O teste falha se algum dos quatro `init.sql` divergir do gerado, se o TMA oficial de setembro deixar de ser a média
das medições diárias, se alguma tabela não passar no contrato da Central com o mapeamento sugerido pela tela, se uma
transcrição deixar de ser completa e se a localização do diagnóstico deixar de apontar Contestação de valor.
