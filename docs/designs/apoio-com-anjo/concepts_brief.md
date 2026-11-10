# Apoio com Anjo e avaliação da resolutividade do chat

* **Autor:** Renan Menezes
* **Data:** 2026-11-09
* **Etapa EGM:** brainstorm concluído; insumo do `egm-draft`.
* **Revisão Goldfish do brainstorm:** 7 lentes, despacho direto (sem sintetizador), subagentes novos e só leitura, cada um lendo a persona oficial do repositório `google/elephant-goldfish-model`. O plugin não está instalado nesta máquina, então o isolamento do `CLAUDE.md` (`omitClaudeMd`) não foi garantido.

| Lente | Situação |
| --- | --- |
| Zoom Out (Contrarian/YAGNI) | concluída |
| Design Critic (custo, escala, arquitetura) | concluída |
| Inventive Catalyst | concluída |
| Comprehension (UX e ergonomia) | concluída |
| Implementation Readiness (migração e implantação) | concluída |
| Structural (manutenção de longo prazo) | concluída |
| Codebase Details (aderência ao código; tratou como observabilidade/SRE) | concluída |

> **Nota (09/11/2026, depois da revisão):** a oferta com 30 s para aceitar foi substituída pela **atribuição direta** (decisão D2), e o prazo da fila passou a ser calculado pelo histórico (D12). Vale a especificação [design_draft.md](design_draft.md) v4; este brief fica como registro do brainstorm.

## Overview

O operador conversa com a INIA para tirar dúvidas de processo. Hoje não se sabe quanto ela resolve, nem quando ele precisa de uma pessoa. A funcionalidade separa quatro medidas — percepção da resposta, necessidade de apoio humano, motivo identificado pelo apoio humano e resultado desse apoio — e cria o caminho para o operador falar com um **Anjo**: uma pessoa com papel de acesso próprio, que recebe pedidos distribuídos automaticamente, conversa com o operador fora do alcance da IA, classifica o motivo e o resultado e é avaliada com estrelas.

## Analysis

As objeções abaixo foram levantadas por lentes diferentes e convergem. Para cada uma, a resolução que vai para o rascunho.

### 1. Presença não pode renovar a sessão (Blocker em 3 lentes)

Qualquer requisição que não seja GET renova a sessão (`backend/src/modules/auth/presentation/require-auth.ts:21,52-58`). Uma "batida de presença" por POST faria a sessão do Anjo nunca expirar, contra a regra de 30 min.

**Resolução:** não há batida separada. A posse de conexão do Anjo é renovada como efeito da própria consulta de estado (GET), que não conta como atividade. O aviso de inatividade que já existe (`frontend/src/components/auth/session-idle-guard.tsx`, aviso 2 min antes) é o "Ainda está aí?": interagir com a página renova pela rota de sempre. Teste obrigatório: área do Anjo aberta, 30 min sem ação → sessão expirada e Anjo fora de serviço.

### 2. Uma só fonte para "quem atende quem" (Blocker/Major em 4 lentes)

O conceito tinha o papel por escopo **e** uma configuração separada de Anjos por escopo. Isso diverge.

**Resolução:** a atribuição do papel Anjo (`access_role_assignments`) é a configuração. A tela do Administrador geral mostra e edita essas atribuições por Grupo/Subgrupo, sem tabela paralela. O módulo guarda só a capacidade de cada Anjo e o liga/desliga. Anjo e Coordenador de Anjos: só o Administrador geral concede (como já é com o Administrador de dados), escopos permitidos organização/Grupo/Subgrupo (sem "Minha estrutura"), o próprio solicitante nunca é elegível. Uma única consulta de elegibilidade (a de `contestationReviewersOf`, parametrizada pelo papel e sem "Minha estrutura") serve à distribuição, à regra "há Anjo em serviço" e aos relatórios.

### 3. Liga/desliga com herança explícita

**Resolução:** chave geral da organização + por Grupo e por Subgrupo com três estados (herdar, ligado, desligado). Efetivo = chave geral ligada **e** (valor do Subgrupo, senão do Grupo, senão desligado). Uma função pura no domínio; o frontend recebe o resultado (`/auth/me.features`) e nunca recalcula. Tudo nasce desligado na migration. Histórico de liga/desliga para o funil separar "apoio desligado" de "nenhum Anjo em serviço".

### 4. Fila, prazos e disputa entre várias APIs (Blocker em 2 lentes)

Oferta de 30 s, expiração de 20 min e "saiu de Disponível" não podem depender de temporizador de processo, porque cada requisição pode cair em qualquer API.

**Resolução:**
* Prazos são colunas (`offer_expires_at`, `queue_expires_at`) comparadas com o relógio do banco.
* Uma função idempotente `dispatch(organização)` roda sob trava consultiva por organização, chamada depois de toda escrita que muda estado e por uma varredura periódica curta no worker (a garantia).
* Aceitar, recusar, cancelar e expirar são atualizações condicionais (só valem se o estado ainda é o esperado). Quem perde a disputa recebe 409 com o motivo ("Outro Anjo já aceitou", "O operador cancelou").
* Índices únicos parciais: um pedido aberto por operador; uma oferta pendente por pedido; um Anjo recebe no máximo uma oferta pendente por vez, e a oferta pendente ocupa uma vaga da capacidade.
* "Livre há mais tempo" com capacidade maior que 1: primeiro quem tem menos atendimentos em andamento; empate, quem recebeu a última oferta há mais tempo.
* Todo estado final grava a causa (operador, Anjo, sistema por prazo, desligamento).

### 5. Canal de atualização (Blocker/Major em 4 lentes; divergência)

Zoom Out pediu polling simples; Design Critic, Inventive Catalyst e Structural aceitaram espera longa (long-poll), desde que nenhuma espera segure conexão do pool, o desligamento libere as esperas na hora e o aviso não acorde todo mundo. O argumento decisivo: em aba oculta o navegador espaça temporizadores (o React Query também para o polling), e o Anjo perderia ofertas de 30 s; uma requisição pendente que volta não é temporizador.

**Resolução:**
* Um único contrato `GET` de estado com versão (`since`), que pode ou não segurar a resposta (`wait` até 25 s).
* Sem `LISTEN/NOTIFY` na primeira versão: cada processo de API faz **uma** releitura por segundo numa tabela de versões por pessoa, só enquanto houver esperas abertas nele, e libera as esperas cuja versão mudou. Nenhuma conexão do pool fica presa; nenhum `LISTEN`, então a conta de `max_connections` não muda. `NOTIFY` entra depois se uma medição pedir.
* `startDraining` responde todas as esperas na hora ("reconecte"); o cliente reconecta com recuo e variação aleatória.
* Um único long-poll por navegador (aba líder por Web Locks; as outras abas recebem por `BroadcastChannel`), por causa do limite de 6 conexões por origem sem HTTP/2.
* Se a espera falhar (proxy segurando a resposta), o cliente cai para consulta curta de 3 s. A validação no IIS real é pré-requisito para ligar a funcionalidade.
* Só abre espera quem tem pedido aberto ou está com a área do Anjo aberta.

### 6. Isolamento da IA também no navegador (Blocker em 3 lentes)

Com o avatar ligado, o texto digitado vai para a sessão de voz (`operator-inia-chat.tsx:1292,1302`), e o microfone do campo de mensagem também.

**Resolução:** a sala de apoio é uma feature própria (`components/human-support/`) com campo de mensagem próprio, sem microfone, que não importa `lib/realtime` nem o transporte de voz. Entrar na sala **encerra** a sessão de voz (não silencia). No servidor, as mensagens humanas ficam em tabelas do módulo `human-support`; teste de estrutura com lista de **permitidos** (o próprio módulo e `data-lifecycle`) e proibição de importar módulos de IA e `usage-analytics`. Também no frontend.

### 7. O que o Anjo vê é uma cópia fixa (Major em 4 lentes)

Ler `assistant_interactions` na hora tornaria o apoio mais um leitor da conversa da INIA, e uma chave estrangeira travaria a retenção (`data-lifecycle/application/run-data-retention.ts:30-33`).

**Resolução:** ao confirmar, grava-se uma cópia imutável exatamente igual à prévia (texto da pergunta, texto da resposta — sem cartões nem materiais —, motivo da descurtida, texto do operador). O id da resposta original fica guardado sem chave estrangeira. As tabelas novas entram no catálogo de retenção e na exportação do titular desde o primeiro dia. Durante os 30 s da oferta o Anjo vê só metadados; o conteúdo aparece depois do aceite. Leituras de conversa de apoio por Coordenador/Administrador vão para `personal_data_access_log` com tipos novos.

### 8. Sinais de "não encontrei" sem mexer no histórico do chat (Major em 3 lentes)

**Resolução:** tabela lateral de sinais por resposta, gravada pelo módulo `assistant` no momento da resposta (sem coluna nova em `assistant_interactions`, que travaria o chat durante a migration). Sinais: consulta às bases sem trecho, esclarecimento concluído como insuficiente, consulta que falhou, especialista bloqueado. "Resposta que não foi gerada" (erro no turno, não cancelamento pelo operador) é ancorada na mensagem do operador, que já está gravada antes da resposta começar. Corrigir junto o `FAILED` que nunca é gravado (`assistant-conversations.ts:204-208`). A **oferta** é gravada pelo módulo de apoio. Data de corte publicada no funil.

### 9. Motivo da descurtida sem quebrar o contrato (Blocker)

A rota de avaliação é `.strict()`; durante a publicação, um front novo falando com uma API antiga receberia 400.

**Resolução:** motivo, "ainda precisa de ajuda?" e comentário em tabela própria ligada à versão da avaliação. O front só envia os campos novos quando `/auth/me.features` (servido pela API nova) disser que pode. Trocar só o motivo grava nova versão. Descurtidas anteriores aparecem no funil como "motivo não coletado", nunca "sem motivo".

### 10. Métricas estáveis no tempo (Major em 3 lentes)

**Resolução:** Grupo/Subgrupo congelados no pedido; códigos com catálogo versionado, nunca rótulos; numerador e denominador de cada métrica num único arquivo de domínio com testes. A mediana de espera considera também os pedidos cancelados ou expirados (como "esperou pelo menos X"), para não ficar otimista quando a fila piora; se mais da metade não foi atendida, mostra "mais de X min". Nenhum evento da Monitoria de usabilidade: `recordServerUsageEvent` ignora a flag de ambiente (`usage-analytics/application/record-server-event.ts:32-33`), e um teste impede o módulo de importá-lo.

### 11. Implantação e reversão

**Resolução:** migrations só aditivas; ligar só com todas as instâncias na versão nova; fases (0: schema e API aceitando o motivo, apoio desligado; 1: motivo e pergunta no chat; 2: Subgrupo piloto; 3: expansão). Roteiro de reversão: desligar geral → aguardar ou encerrar atendimentos → reverter código. O papel Anjo fica sem efeito num código antigo (papel desconhecido não dá permissão, `access/domain/access-decision.ts:14`). Estado final "encerrado pelo sistema" contado à parte.

### 12. Observabilidade e investigação de queixas (Blocker/Major, Codebase Details)

Sem causa gravada, "meu pedido sumiu" não se investiga; esperas longas distorcem o p95 e o "em andamento" das métricas HTTP e entram na conta do `LeastRequests` do ARR (`deploy/windows/iis/configurar-iis.ps1:111`).

**Resolução:**
* Cada transição de pedido, oferta, atendimento e presença grava estado anterior, novo, causa e ator (pessoa ou SISTEMA).
* Seção `humanSupport` no snapshot de métricas (`backend/src/main/server.ts:63`): esperas abertas, esperas encerradas por mudança ou por prazo, atraso entre o prazo vencer e a transição acontecer, falhas do registro LGPD. A rota de espera fica fora do p95 geral.
* Cada pedido tem um protocolo curto visível ao operador e ao Anjo; linhas de log `human_support_*` com o id do pedido, nunca conteúdo; o rastreamento do turno do chat ganha o id da resposta e os códigos dos sinais.
* A descurtida com motivo é uma gravação confirmada pelo servidor (hoje a falha só vai para o console, `operator-inia-chat.tsx:1634-1641`), com aviso de erro na tela.
* Tela administrativa "quem está elegível agora e por quê" (papel, liga/desliga, disponibilidade, conexão, capacidade, pausa).
* O `data_kind` do registro LGPD ganha valores por migration (o check aceita só 3, `151_*.sql:16`); a janela de 10 min de deduplicação continua (o registro responde "quem viu", não conta cliques); a leitura que o Anjo faz da cópia da troca também é registrada.

### Riscos que continuam abertos

* Validação do IIS (ARR com espera longa) nunca foi feita num Windows real.
* Oferta de 30 s exige que o Anjo perceba o pedido: som e título da aba obrigatórios.
* O contrato da descurtida muda o comportamento do polegar hoje silencioso (passa a abrir formulário).
* O componente do chat (`operator-inia-chat.tsx`, 2047 linhas) tem trabalho não commitado de outra frente no checkout principal.

## Goals vs. Non-Goals

* **No escopo:** motivo na descurtida do chat e "ainda precisa de ajuda?"; sinais estruturados de "não encontrei" e ofertas registradas; botão "Chamar apoio"; papel Anjo e Coordenador de Anjos; liga/desliga geral e por Grupo/Subgrupo; disponibilidade, pausa, capacidade; distribuição automática com aceite; fila com estimativa; sala de apoio no painel do chat; encerramento, classificação, resultado, estrelas e "resolvido?"; funil de métricas; registro LGPD; implantação gradual.
* **Fora do escopo:** mudar a avaliação do feedback do Acompanhamento; a IA ler ou resumir conversas humanas; anexos, áudio ou voz no apoio; WebSocket; `LISTEN/NOTIFY` na primeira versão; o modelo declarar "não sei" por campo novo no prompt (exige avaliação de qualidade à parte); Anjo atendendo por "Minha estrutura"; ligar a Monitoria de usabilidade; tela "quem lê suas conversas" da frente de treino.

## Alternatives Weighed

* **Gravar o Anjo em `assistant_interactions` com um papel novo** — rejeitado pelo autor: o check de `role` e mais de dez leitores levam o histórico à IA ou o usam como métrica; um papel novo exige revisar todos e um rollback leria valores desconhecidos.
* **Sala de apoio como nova `origin` de `assistant_conversations`** — rejeitado: mesma contaminação de monitoramento e analytics; a sala é só apresentação.
* **Fila em que o Anjo escolhe da lista** — rejeitado pelo dono do produto em favor da distribuição automática.
* **Polling simples sem espera** — rejeitado como canal principal: aba oculta atrasa os temporizadores e o Anjo perderia ofertas de 30 s. Fica como modo de reserva.
* **Long-poll com `LISTEN/NOTIFY` desde o início** — adiado: uma releitura por segundo por processo resolve sem conexão extra nem aviso sem destino; `NOTIFY` entra se a medição pedir.
* **WebSocket** — rejeitado: não há servidor, o recurso não é instalado no IIS pelos scripts e a distribuição entre instâncias continuaria precisando do banco.
* **Detectar "não encontrei" por frase no texto da IA** — rejeitado pela regra do produto.
* **Campo "coverage" declarado pelo modelo** — adiado: muda contrato versionado de prompt e exige avaliação de qualidade.
* **Chave estrangeira do pedido para a resposta da INIA** — rejeitado: trava a retenção; cópia imutável no lugar.
* **Tabela separada "Anjos por escopo"** — rejeitado: segunda fonte de verdade ao lado do papel.
* **Mediana só dos atendidos** — rejeitado: fica otimista quando a fila piora.

## Key Decisions & Staging for Next Steps

Decididas pelo dono do produto: entradas (botão discreto, descurtir com "ainda precisa de ajuda?", sinal estruturado), contexto = só a troca de origem, distribuição automática com 30 s para aceitar, capacidade padrão 2 (1–5), sem Anjo em serviço não cria pedido, fila expira em 20 min, desligar cancela a fila e mantém atendimentos, título obrigatório quando a informação existia, estrelas + "resolvido?" alteráveis por 24 h, Coordenador de Anjos e Administrador geral veem relatórios/conversas/pausas, espera estimada pela mediana.

Decididas no lote 4: motivo e "ainda precisa de ajuda?" em toda descurtida do chat livre, mesmo onde o apoio está desligado (a tela diz que o apoio ainda não está disponível para a equipe); sessão de feedback e recado não oferecem Anjo; Anjo ausente por 3 min → atendimento "interrompido" e o pedido volta sozinho para a frente da fila; operador sem a INIA aberta por 2 min na fila → "abandonado"; no atendimento, operador ausente há 5 min → o Anjo pode encerrar como "operador ausente", e 15 min sem mensagem de ninguém → o sistema encerra; lista própria de motivos do chat (Informação errada · Não respondeu o que perguntei · Não encontrou a informação · Resposta incompleta · Difícil de entender · Outro), comentário opcional, obrigatório em "Outro".

Decididas pelo Elefante (técnicas ou dedutíveis das regras; confirmar na aprovação): um pedido aberto por operador; durante os 30 s da oferta o Anjo vê só nome, Grupo/Subgrupo, origem e espera; a classificação ganha "Outro (descreva)"; o pedido não é reoferecido a quem recusou ou deixou passar, salvo se for o único elegível e já tiverem passado 2 min; pausa durante atendimento só bloqueia ofertas novas; reduzir a capacidade não corta atendimento em andamento; oferta com som e título da aba.
