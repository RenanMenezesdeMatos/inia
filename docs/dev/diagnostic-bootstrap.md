# Carga inicial e incremental de diagnósticos

O script `backend/scripts/feedback-engine/bootstrap-diagnostics.ts` usa a mesma análise e persistência do motor. Não chama redação, verificação de mensagem, publicação, notificação nem execução de Workflow. As avaliações ficam disponíveis no Diagnóstico e para `currentMemory`.

## Preparação da operação

Importar pessoas/grupos, transcrições vinculadas às chamadas, motivos, indicadores oficiais e bases publicadas vinculadas ao especialista. Publicar os argumentários com escopo e vigência corretos. Sem transcrição ou base publicada, não iniciar a carga.

Trabalhar por organização, grupo, motivo normalizado e competência. O plano seleciona candidatos do quartil de melhor resultado **geral** do indicador entre os operadores com chamadas disponíveis, uma amostra de comparação e até quatro chamadas da pessoa alvo. Distribui chamadas por pessoa; não assume que resultado bom comprova processo correto. `TARGET` não participa da referência. Indicadores cuja direção é uma faixa/alvo não são ranqueados automaticamente.

O grupo é o cadastro atual, pois não há histórico organizacional confiável. A duração da gravação não substitui o indicador oficial. Versões de base posteriores à chamada são marcadas pelo motor como reavaliação atual; não comprovam descumprimento histórico. Argumentários só entram se vigentes e aplicáveis ao escopo — o script não injeta argumentários sintéticos nem altera suas datas.

Duas formas de amostra:

- **Referência (padrão)**: o desenho acima — melhor quartil, comparação e até quatro chamadas da pessoa alvo. Alimenta as práticas dos colegas usadas pelo feedback de indicador.
- **Por pessoa (`--per-person N`)**: até N chamadas de CADA pessoa do grupo (ou do subgrupo, com `--subteam`), em rodadas — todo mundo recebe a 1ª antes de alguém receber a 2ª —, então o `--limit` ou uma parada pelo orçamento deixam o histórico equilibrado. Alimenta o histórico de cada pessoa que a monitoria consulta (reincidência nos últimos 90 dias) e a tela de Diagnóstico.

## Comandos (a partir de backend/)

```sh
# Só leitura e zero IA: lista organização, grupos/subgrupos, especialistas com base publicada, indicadores ordenáveis,
# preço cadastrado do modelo e — com --team e --period — os assuntos com chamadas transcritas no mês.
node --import tsx scripts/feedback-engine/bootstrap-diagnostics.ts opcoes
node --import tsx scripts/feedback-engine/bootstrap-diagnostics.ts opcoes --team TEAM_UUID [--subteam SUBTEAM_UUID] --period YYYY-MM

node --import tsx scripts/feedback-engine/bootstrap-diagnostics.ts plan \
  --org ORGANIZATION_UUID --team TEAM_UUID --agent AGENT_UUID \
  --subject MOTIVO_CANONICO --period YYYY-MM --indicator TMA \
  [--subteam SUBTEAM_UUID] [--per-person 3] \
  --target-person PERSON_UUID --limit 40 --max-usd 10 \
  --price-input TARIFA_USD_POR_MILHAO --price-output TARIFA_USD_POR_MILHAO \
  --dir DIRETORIO_DA_CARGA

node --import tsx scripts/feedback-engine/bootstrap-diagnostics.ts execute --dir DIRETORIO_DA_CARGA --take 2
node --import tsx scripts/feedback-engine/bootstrap-diagnostics.ts execute --dir DIRETORIO_DA_CARGA
node --import tsx scripts/feedback-engine/bootstrap-diagnostics.ts report --dir DIRETORIO_DA_CARGA
```

No servidor Windows, `backend\varredura.cmd` é o mesmo comando sem o caminho do script (`cd /d C:\inia\backend` e `varredura opcoes`, `varredura plan …`); passo a passo para quem opera na IT-INIA-005, etapa 8. `--org` é opcional quando o banco tem uma só organização (o caso de uma instalação). `plan` lê os dados, congela seleção/fontes/código e salva manifesto local: zero modelo, zero escrita no banco. `execute` grava diagnósticos reais no banco configurado em `DATABASE_URL`. Confirme o ambiente operacional ao preparar o plano. `report` apenas lê o banco e produz arquivos locais.

Preço é parâmetro explícito: deve corresponder ao modelo/provedor contratado. O teto é calculado pela tarifa configurada e tokens reportados, incluindo raciocínio. Entrada é estimada conservadoramente antes da requisição; custo faturado pelo provedor pode diferir de estimativas de tokens/tarifa. Para um limite financeiro externo absoluto, configurar também quota no provedor.

## Retomada, custo e execução

- `state.json` é gravado atomicamente antes de cada requisição HTTP, reservando custo, e após a resposta. Uso desconhecido continua debitado pela reserva.
- Retomadas leem o mesmo livro-razão; não reiniciam o orçamento. Chamadas concluídas são puladas. O motor reaproveita análises compatíveis e retoma revisão suspensa quando disponível.
- Um erro interrompe o lote. Corrigir a causa e usar o mesmo diretório para retomar; não tentar reiteradamente até obter resposta desejada.
- `execution.lock` impede dois processos no mesmo lote. Após queda abrupta, verificar que o PID não está mais ativo antes de remover somente esse lock. Nunca remover o livro-razão para contornar teto.
- `--take` limita o número de chamadas tentadas naquela execução, sem mudar a seleção ou o orçamento total. Útil para verificar a primeira amostra antes do restante.
- Código e fontes são conferidos antes de executar. Não mudar o motor durante a carga: usar uma cópia congelada do código/dependências. Se mudou intencionalmente, manter os artefatos anteriores e planejar uma nova execução com orçamento explicitamente autorizado; o motor ainda verifica reaproveitamento por compatibilidade.
- São permitidas apenas etapas de análise, revisão e confirmação. Nenhum recurso é reservado para redação porque este processo não gera mensagens.
- Não copiar respostas dos ensaios diretamente para tabelas nem marcar todas como positivas.

## O que significa o relatório

`report.json` contém contagens, resultados, custo e práticas candidatas da amostra de referência com evidências. A consolidação é por identidade de critério, preservando evidência e denominador; não usa regex para decidir conduta. Obrigações equivalentes com identidades diferentes não são unidas automaticamente.

O relatório usa o mínimo atual de cinco avaliações e três operadores, com 80% de cumprimento, apenas para sinalizar candidatas recorrentes. Isso não é prova estatística de causalidade nem garantia de representatividade. Uma conduta pode ser correta sem causar a melhora do indicador. Validar os exemplos e a cobertura do cenário antes de tratar o grupo como referência robusta.

Ausência de candidatas pode significar pouca amostra, cenários distintos, análises inconclusivas ou identidades de critérios fragmentadas. O relatório expõe isso; não produz conselho genérico para preencher lacunas.

## Entrada em produção

Executar uma carga inicial por grupo/motivo prioritário e ampliar conforme cobertura e custo. Para novas chamadas, rodar novos planos de janelas incrementais com teto próprio; reuso do motor evita pagar novamente por análise compatível. O script é uma ferramenta de operação, não um agendador: pode ser chamado pelo mecanismo de jobs da implantação, sem alterar os Workflows de feedback. O diagnóstico não depende da existência de mensagem entregue.

Separar disponibilidade de referência e elegibilidade de cada feedback. Uma referência ausente não deve virar erro do operador. Mudanças de procedimento requerem reconciliação/reanálise seletiva, preservando histórico e vigência.
