# Ground truth — uso exclusivo do avaliador

**NÃO CARREGAR NO AGENT.** Este documento, o JSONL de rótulos e as métricas esperadas contêm o gabarito. Mantê-los fora de prompts, ferramentas, RAG, memória e diretórios indexados pela INIA. O CSV e JSONL de dados não contêm os rótulos abaixo.

## Protocolo de avaliação cega

1. Carregar somente `dados/chamadas.jsonl`, usando o CSV apenas para conferir os metadados. Impedir acesso do Agent à pasta de QA e a esta conversa de criação, que descreve os padrões.
2. Pedir uma análise neutra do período completo: evolução dos indicadores, comportamentos apoiados nas chamadas, exceções, limitações e oportunidades de melhoria. Não nomear os padrões esperados.
3. Guardar a resposta e suas citações antes de consultar o gabarito. Registrar filtros, versão do modelo, configuração e IDs analisados.
4. Usar um avaliador separado para comparar a saída ao gabarito. Um resultado correto sem evidências ou que receba o padrão no prompt não prova descoberta autônoma.
5. Repetir por período e por assunto, mantendo os denominadores. Os rótulos não devem ser usados para escolher quais chamadas o Agent receberá em uma avaliação cega da massa integral.

## Padrões plantados e limites esperados

**Mariana Alves:** TMA médio cai ao longo dos três blocos de dez dias; o tempo de silêncio também cai. No começo há mais consultas longas, repetição de conferência e cliente perguntando se a ligação continua. Existem exceções posteriores, especialmente M-017 e M-022. Espera-se identificar a melhora temporal, reconhecer o sinal residual de consulta/silêncio e citar as falas. Não inferir incapacidade, falta de treinamento ou causa única do TMA. Há mudança de mix e tempos simulados.

**Rafael Cardoso:** TMA cresce e surgem perguntas redundantes, mais silêncio e espera, além de omissão de prazo concreto de acompanhamento e de protocolo verbal solicitado. As falhas se concentram nos períodos 2 e 3. O primeiro bloco e os controles são contraexemplos. Não afirmar que nenhum protocolo foi gerado: todos os contatos têm um protocolo interno. O problema plantado é não informá-lo em voz quando pedido. Tampouco afirmar descumprimento de um SLA real: não existe política real da operadora nesta massa.

**Camila Fonseca:** TMA global relativamente alto, com estabilidade aproximada e 24 atendimentos de dois assuntos cadastrados. Há conferência de escopo, comparação de opções, preservação de serviços, delimitação de pendências e resumos específicos. Espera-se evitar recomendar redução indiscriminada da duração ou classificá-la como atendimento ruim apenas pelo tempo. A complexidade é uma explicação plausível apoiada nas falas, não causalidade estatística demonstrada. Há duas notas baixas e retornos pendentes, que impedem tratar o conjunto como perfeito.

“Alto” aqui é uma comparação descritiva dentro da demo. Não foi fornecida meta operacional de TMA, e o Agent não deve inventar uma. Camila não precisa ter a maior média em todo subperíodo para o padrão estar presente.

## Métricas exatas esperadas

TMA inclui pós-atendimento. Cada bloco contém dez chamadas por operador, incluindo controles. Períodos: P1 = 01–10/06; P2 = 11–20/06; P3 = 21–30/06/2026. Valores em segundos, arredondados somente na apresentação.

| Operador | TMA P1 | TMA P2 | TMA P3 | TMA global | Rechamadas | Transferências | Notas respondidas | Detratores |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Mariana Alves | 433.2 | 329.3 | 283.1 | 348.5 | 2 | 2 | 26 | 2 |
| Rafael Cardoso | 278.2 | 391.1 | 494.1 | 387.8 | 3 | 2 | 28 | 13 |
| Camila Fonseca | 412.2 | 423.3 | 406.2 | 413.9 | 3 | 3 | 26 | 2 |

`metricas_esperadas.json` também traz duração média sem pós-atendimento, silêncio médio e IDs dos controles. Aceitar diferenças apenas de arredondamento ou uma definição de TMA declarada e recalculada corretamente. Não comparar uma média que inclui pós-atendimento a outra que o exclui.

## Rótulos por chamada e evidências

O arquivo `ground_truth_chamadas.jsonl` tem 90 linhas. Cada uma contém ID da chamada, operador, período, indicação de controle, rótulos plantados e citações exatas ligadas ao `segmento_id` e `inicio_s`. Os rótulos descrevem os sinais escolhidos para este ensaio; não constituem uma auditoria exaustiva de qualquer comportamento possível.

| Rótulo | Quantidade de chamadas |
|---|---:|
| `consulta_com_silencio_sem_atualizacao_intermediaria` | 12 |
| `controle_sem_sinal_comportamental_alvo` | 18 |
| `conversa_humana_nao_sensivel` | 9 |
| `delimitacao_escopo_e_confirmacao` | 24 |
| `falha_informacao_prazo_acompanhamento` | 13 |
| `multitema` | 24 |
| `pergunta_redundante_retrabalho` | 16 |
| `protocolo_solicitado_nao_informado_em_voz` | 10 |
| `rechamada_mesmo_caso` | 8 |

Para silêncio, verificar o evento de duração correspondente e o trecho em que o cliente pergunta se o operador ainda está na linha. O rótulo numérico da demo utiliza silêncio de pelo menos 60 segundos para selecionar os exemplos de Mariana; não se trata de limite normativo da INIA. Para protocolo omitido, conferir a pergunta, a resposta evasiva e a ausência do protocolo **do contato atual** no restante da fala. A citação de um protocolo anterior não cumpre esse requisito.

## Controles e contraexemplos

Há seis controles por operador: sufixos 005, 010, 015, 020, 025 e 030. São consultas ou ações simples e adequadas, sem o sinal comportamental alvo. Os papéis de controle constam somente no QA. Os IDs são deliberadamente previsíveis para facilitar auditoria, e não devem ser usados como atributo comportamental.

- Não propagar uma falha observada no Rafael para os controles dele ou para seu primeiro período.
- Não atribuir consulta longa a toda chamada da Mariana; conferir os eventos reais por ID.
- Não descrever todas as chamadas da Camila como complexas; os controles oferecem atendimentos simples e mais curtos.
- M-017 e M-022 são exceções à melhora de silêncio. R-014 e R-016 ajudam a separar falha de prazo, falha de protocolo e mera pendência.
- C-019 e C-026 têm nota baixa apesar da condução cuidadosa. Nota, resultado operacional e comportamento do operador são dimensões distintas.
- Conversa casual sobre clima, viagem, nome, cozinha, cachorro ou cotidiano não demonstra distração nem causa do TMA. Nenhuma origem étnica deve ser inferida a partir de nome.

Os controles são simples por construção; diferenças de duração entre eles e casos complexos não provam efeito causal de qualidade. Não são um grupo experimental randomizado nem uma amostra sem qualquer regularidade numérica.

## Relações de rechamada

| Retorno | Chamada anterior | O que ainda motivou o contato |
|---|---|---|
| INIA-DEMO-M-006 | INIA-DEMO-M-001 | Revisão do pacote de vídeo ainda pendente. |
| INIA-DEMO-M-022 | INIA-DEMO-M-008 | Portabilidade atrasada com pendência cadastral. |
| INIA-DEMO-R-011 | INIA-DEMO-R-007 | Destinação de pagamento duplicado não concluída. |
| INIA-DEMO-R-021 | INIA-DEMO-R-016 | Renovação de adicional cobrada após pedido de interrupção. |
| INIA-DEMO-R-022 | INIA-DEMO-R-013 | Instabilidade técnica sem retorno conclusivo. |
| INIA-DEMO-C-014 | INIA-DEMO-C-003 | Falha do compartilhamento sem fio persiste; cabo funcionou. |
| INIA-DEMO-C-019 | INIA-DEMO-C-007 | Um item revisado, outro ainda pendente. |
| INIA-DEMO-C-022 | INIA-DEMO-C-006 | Retorno do mesmo caso de viagem, agora sobre cobrança de voz. |

A última relação é continuidade do caso de viagem, não prova de erro no atendimento anterior. O vínculo C-003/C-014 mostra que orientação/teste concluído não equivale a ausência de retorno futuro. Outros relatos de contatos externos não foram marcados como rechamada dentro do lote porque não existe vínculo verificável com um registro incluído.

## Critérios de avaliação

| Dimensão | Aceitar | Rejeitar |
|---|---|---|
| Evolução | Calcula os três blocos e relata as direções com denominadores. | Inverte a tendência, inventa meta ou compara janelas diferentes. |
| Evidência | Cita IDs e trechos literais consistentes, vinculados ao comportamento descrito. | Citação inexistente, troca de operador ou inferência baseada só na nota. |
| Rafael | Separa prazo, protocolo verbal, protocolo interno e pendência operacional. | “Nunca gera protocolo”, “todo retorno é culpa dele” ou violação regulatória sem regra. |
| Camila | Reconhece escopo, multitema e qualidade observável, com exceções. | Redução automática do TMA à custa de conferência, ou “todas as chamadas são perfeitas”. |
| Mariana | Reconhece melhora e consultas longas específicas. | Generaliza o primeiro bloco para o mês inteiro ou afirma causa não demonstrada. |
| Controles | Evita estender rótulos individuais para todos os casos. | Atribui o padrão a uma chamada-controle sem evidência própria. |
| Evidência limitada | Expressa limites da amostra sintética e do mix. | Afirma representatividade estatística, intenção ou traço pessoal. |

Para anotação por chamada, calcular precisão e recall apenas dos rótulos explicitamente pedidos na avaliação; não penalizar a ausência de um rótulo que não foi solicitado. Usar os controles para contar falsos positivos. Não converter automaticamente a comparação em nota de avaliação profissional de pessoas reais.

## Integridade, limitações e blindagem

`validacao.json` registra verificações estruturais e de coerência: contagens, CSV/JSONL, cronologia, tempos, vínculos e correspondência literal das evidências. “APROVADO” significa aprovação dessas verificações programáticas; não significa aprovação de integração com um seed real nem avaliação humana independente da naturalidade.

As chamadas foram escritas com roteiros operacionais compartilhados, trechos específicos por caso e tempos simulados. Repetição de linguagem, concentração de casos complexos e desenho temporal são escolhas do ensaio. Não usar este lote sozinho para aprovar qualidade em produção ou para medir generalização a chamadas reais. As notas URA são metadados sintéticos pós-chamada; não representam áudio omitido da transcrição.

Para um ensaio cego válido, começar em um contexto sem acesso ao pedido de criação, ao código gerador e a estes arquivos. Mesmo nomes de arquivos de QA ou prompts que descrevam os três padrões podem contaminar o teste. O avaliador pode consultar o gabarito somente depois de congelar o resultado da INIA.
