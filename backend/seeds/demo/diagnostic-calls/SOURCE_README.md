# INIA — massa sintética de 90 atendimentos

Versão 1.0 · idioma pt-BR · chamadas de voz · período de 01 a 30/06/2026 · fuso UTC−03:00.

São **30 chamadas de Mariana Alves, 30 de Rafael Cardoso e 30 de Camila Fonseca**. Pessoas, empresa, contratos, valores, procedimentos e ocorrências são fictícios. Não há áudio de origem: as transcrições foram escritas para a demo e os tempos foram simulados. As condições comerciais e os prazos citados não são regras de uma operadora real.

## Arquivos e separação de acesso

| Arquivo | Uso |
|---|---|
| `dados/chamadas.jsonl` | Fonte principal: uma interação completa por linha, incluindo metadados, transcrição e segmentos. |
| `dados/metadados.csv` | Os mesmos 90 registros, sem transcrição nem segmentos. Serve para conferência e adaptação do importador; não são mais 90 chamadas. |
| `README.md` | Dicionário e instruções de adaptação. Não é conteúdo de atendimento para o Agent. |
| `qa_nao_importar/` | Gabarito reservado ao avaliador. **Nunca enviar ao Agent**, ao prompt, à memória, ao banco vetorial ou às ferramentas de busca disponíveis para ele. |

O pacote `inia_demo_dados.zip` contém apenas esta documentação e os dois arquivos de dados. O pacote `inia_demo_QA_NAO_IMPORTAR.zip` é exclusivo para QA. Importar os dados por lista explícita de arquivos, nunca por varredura recursiva de toda a pasta de entrega. O README também não precisa entrar no contexto do Agent.

**O assunto já é um campo da interação.** `assunto_origem` vale `cadastro_da_interacao` em todos os registros. `assunto` e `assuntos_secundarios` foram preenchidos como dados de origem da demo. Não se deve pedir à IA para classificá-los ou substituí-los durante o seed. Isto define o contrato desta massa; o schema real da INIA não foi inspecionado.

## Codificação e tipos

- JSONL: UTF-8, sem BOM; um objeto JSON por linha. As quebras da transcrição estão escapadas dentro da string; não quebram o registro JSONL.
- CSV: UTF-8 com BOM para facilitar leitura de acentos em planilhas; separador vírgula; aspas conforme CSV padrão. Não usa ponto e vírgula. Tem cabeçalho e 90 linhas de dados.
- No JSONL, booleanos são `true`/`false`; ausências são `null`. No CSV, booleanos são textos `true`/`false`, ausências são células vazias e listas são arrays JSON, como `["fatura"]`. Não converter uma célula vazia de nota em zero.
- IDs são strings. Datas são ISO 8601 com deslocamento `-03:00`. Tempos são inteiros em segundos. A ordenação física é cronológica, intercalando os operadores.

## Dicionário dos metadados

| Campo | Tipo JSON / significado |
|---|---|
| `schema_version` | String, versão do contrato desta entrega (`1.0`). |
| `dataset_id` | String, namespace do lote (`inia_demo_90_v1`). |
| `sintetico` | Booleano, sempre `true`; preservar a proveniência sintética. |
| `interacao_id_externo` | String única e estável, chave de idempotência da chamada. Não é UUID do banco. |
| `operador_id_externo` | String: `OP-DEMO-M`, `OP-DEMO-R` ou `OP-DEMO-C`. |
| `operador_nome` | Nome completo de um dos três operadores solicitados. |
| `grupo_id_externo` | String `GRUPO-DEMO-TELECOM-01`; referência externa de grupo compartilhado. |
| `grupo_nome` | Rótulo fictício `Atendimento Telecom — Demo`. Deve ser mapeado para o grupo real adequado. |
| `cliente_id_externo` | Identificador fictício; preservado entre chamada original e rechamada. |
| `cliente_nome_ficticio` | Nome de tratamento, sem CPF, telefone, endereço ou e-mail real. Não usar nome como chave de identidade. |
| `canal` | `voz` em todas as interações. A variedade desta massa é de assunto, cenário, horário, duração e resultado, não de canal. |
| `idioma` | `pt-BR`. |
| `inicio_em`, `fim_em` | Início e fim do contato, excluindo pós-atendimento. |
| `assunto` | Código do assunto principal cadastrado na interação. Não é saída da IA. |
| `assunto_origem` | Sempre `cadastro_da_interacao`. |
| `assuntos_secundarios` | Array de códigos adicionais explicitamente cadastrados. `[]` significa nenhum secundário cadastrado, não prova de ausência de qualquer menção lateral. A lista não é anotação exaustiva da fala. |
| `duracao_s` | Duração do contato, do primeiro ao último segmento; inclui fala, silêncio e espera. |
| `tempo_fala_s` | Tempo reservado aos turnos falados, incluindo pausas naturais curtas dentro do turno. Não foi medido por detector de voz. |
| `tempo_silencio_s` | Intervalos explicitamente marcados sem fala e sem música. Não inclui espera com música. |
| `tempo_espera_s` | Espera com música explicitamente marcada. Não somar novamente à duração. |
| `tempo_pos_atendimento_s` | Trabalho posterior à ligação; não tem fala nem segmento na transcrição. |
| `tempo_atendimento_total_s` | `duracao_s + tempo_pos_atendimento_s`, base sugerida para calcular TMA do conjunto. |
| `rechamada` | Booleano: retorno ligado a um caso anterior presente neste lote, na janela operacional de 30 dias. Não usa obrigatoriamente regra de 24 ou 48 horas. |
| `interacao_anterior_id_externo` | ID de uma chamada anterior deste lote, ou `null`. |
| `caso_id_externo` | Identificador do caso; compartilhado entre original e retorno. |
| `transferencia` | Booleano: participação explícita de segundo nível em consulta assistida. |
| `tipo_transferencia` | `consulta_assistida_segundo_nivel` ou `null`. Não é abandono da chamada pelo primeiro operador nem transferência cega. |
| `contestacao` | Booleano: há contestação de cobrança ou revisão solicitada no caso, mesmo que o assunto principal seja outro. Não implica procedência da contestação. |
| `cancelamento` | Booleano: existe solicitação, acompanhamento ou ação de cancelamento de linha, assinatura ou renovação. Não implica que a linha inteira tenha sido cancelada ou que o pedido já esteja concluído. |
| `nota_ura` | Inteiro entre 0 e 10, ou `null` quando não houve resposta. É avaliação sintética pós-chamada, fora da transcrição. Não há necessidade de utilizar todos os valores da escala nesta amostra. |
| `escala_nota_ura` | String `0-10`. Conferir a escala do projeto antes de importar. |
| `detrator` | `true` quando nota ≤ 6; `false` quando nota ≥ 7; `null` quando não há nota. Regra operacional desta demo, não diagnóstico comportamental. |
| `status_desfecho` | `concluido`, `orientacao_concluida` ou `pendente`. Considera o escopo descrito no encerramento; em multitema, qualquer pendência mantém `pendente`. Não equivale automaticamente a resolução no primeiro contato. |
| `protocolo_registro` | Referência fictícia interna do contato. Sua presença nos metadados **não comprova** que o operador a informou verbalmente ao cliente. |

## Transcrição e segmentos (somente no JSONL)

`transcricao` contém a conversa do início ao encerramento, com papéis e intervalos relativos à chamada. Os turnos são falas completas, sem resumos substituindo o atendimento. Intervalos sem fala são eventos explícitos. Autenticação é simulada por confirmação de fluxo seguro; não são reproduzidos códigos nem documentos pessoais.

`segmentos` é a versão estruturada da mesma conversa:

| Campo | Significado |
|---|---|
| `segmento_id` | ID estável do trecho, utilizável em citações e auditoria. |
| `papel` | `operador`, `cliente`, `suporte` ou `evento`. `suporte` é o segundo nível, não um quarto operador avaliado. |
| `texto` | Conteúdo literal do turno ou descrição do evento. |
| `inicio_s`, `fim_s` | Intervalo relativo `[início, fim)` em segundos; contínuo, sem sobreposição. |
| `tipo` | Presente em eventos: `silencio` ou `espera`. |

O protocolo, nomes e datas dentro das falas são fictícios. Use `segmentos` **ou** `transcricao` como conteúdo conversacional conforme o adaptador, evitando duplicar os mesmos textos no contexto do Agent. Se o sistema aceitar apenas operador/cliente, tratar eventos e suporte explicitamente, sem atribuir falas de suporte ao operador avaliado.

## Assuntos disponíveis

Primários: `fatura`, `contestacao`, `segunda_via`, `troca_titularidade`, `portabilidade`, `troca_chip`, `alteracao_cadastral`, `cancelamento`, `cobertura`, `bloqueio`, `desbloqueio`, `roaming`, `plano`, `pagamento`, `esim`, `internet_movel` e `servico_adicional`.

Os secundários também podem conter `configuracao_aparelho` e `backup_contatos`. São códigos de origem. Caso o projeto use IDs de uma taxonomia, preparar um mapeamento explícito, preservando o código original como proveniência; não usar reclassificação por IA.

## Cálculos e cuidados de interpretação

```text
duracao_s = tempo_fala_s + tempo_silencio_s + tempo_espera_s
tempo_atendimento_total_s = duracao_s + tempo_pos_atendimento_s
TMA do período = soma(tempo_atendimento_total_s) / número de chamadas
```

Se a INIA define TMA sem pós-atendimento, usar a média de `duracao_s` e documentar a diferença. A entrega não inclui tempo de fila anterior à conexão. Transferência assistida está dentro do contato e não deve ser somada novamente.

Para nota média, excluir `null` e informar o denominador de respondentes. Para proporção de detratores, dividir pela quantidade de notas respondidas. Não chamar essa taxa de NPS: não foi aplicada uma pergunta de recomendação de marca.

Os dias estão distribuídos em 30 datas, incluindo fins de semana, em um cenário fictício de operação diária. Há uma chamada por operador por dia; isso **não representa** a carga diária integral, a produtividade, o volume real da operação ou uma amostra estatisticamente representativa. Consultas a histórico externo citadas na fala podem não ter o atendimento original neste lote; apenas os oito retornos vinculados são marcados como `rechamada=true` pela definição fechada da demo.

As falas são sintéticas, com linguagem de atendimento padronizada em parte dos procedimentos. Tempos de fala e eventos foram construídos, não medidos. Esta massa serve para demonstração funcional, citações, agregações e verificação de comportamento; não valida desempenho com áudio real, qualidade de ASR, estimativa estatística populacional ou diagnóstico causal de pessoas.

## Adaptação ao seed atual — etapa futura

Nenhum repositório foi alterado ou inspecionado para descobrir o schema e nenhum banco foi acessado. Esta entrega é um **contrato externo para adaptação**, não um seed já compatível e executável.

1. Ler o seed e o schema atuais: tabelas, enums, unidades, obrigatoriedade de campos, relacionamentos de grupo/operador e armazenamento das transcrições. Fazer um mapa de campos antes de escrever o importador.
2. Resolver Mariana, Rafael e Camila para os IDs já existentes no projeto, por identidade confirmada. Não criar operadores duplicados por variações de nome. Fazer o mesmo para o grupo-alvo, preservando as chamadas e os vínculos existentes.
3. Mapear `GRUPO-DEMO-TELECOM-01` para o grupo apropriado que reúna os participantes da comparação. Se houver outras pessoas existentes no grupo, incluí-las na comparação apenas após conferir o contexto e os dados. Este lote não contém chamadas adicionais dessas outras pessoas nem autoriza migração indiscriminada de todos os grupos.
4. Mapear os IDs externos para UUIDs/chaves internas, guardando o par `(dataset_id, interacao_id_externo)` como chave idempotente. Carregar as relações de rechamada depois de resolver os IDs, ou usar duas passagens na mesma transação.
5. Preservar o assunto como campo original da interação. Converter segundos/minutos, datas e escala de URA explicitamente. Se `detrator` não aceitar `null`, ajustar o schema ou representar ausência de resposta separadamente; não inventar uma avaliação.
6. Se o seed usa um array de flags, derivar `rechamada`, `transferencia`, `contestacao`, `cancelamento` e `detrator` dos campos estruturados. `tempo_silencio_s` é uma medida: uma flag de silêncio excessivo só deve ser calculada usando o limiar documentado do projeto.
7. Se o projeto tiver definição diferente de rechamada, conservar o vínculo de caso e recalcular a flag segundo a janela real. Se contar apenas transferência definitiva, não mapear consulta assistida automaticamente para esse indicador.
8. Fazer validação sem escrita, mostrar o mapeamento e conflitos, e só então executar um seed autorizado em ambiente de demo. Usar transação, registros de auditoria e estratégia de remoção restrita ao lote; não apagar chamadas preexistentes.
9. Após eventual importação, conferir 90 IDs únicos, 30 registros por operador, os oito vínculos, acentos, transcrições completas e somas dos tempos. Não importar o CSV novamente como outro conjunto de chamadas.
10. Executar a avaliação do Agent somente com os dados permitidos. Guardar sua resposta antes de liberar o gabarito ao avaliador externo.

Se a interface filtra “últimos 30 dias”, selecionar explicitamente junho de 2026. Para remapear as datas no futuro, alterar também datas e referências mencionadas nas falas, preservando ordem, intervalos dos retornos e prazos; não mudar só os metadados.
