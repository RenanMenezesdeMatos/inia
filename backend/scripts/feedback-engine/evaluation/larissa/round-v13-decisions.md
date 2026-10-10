# Rodada V13 — decisões registradas durante a execução

## 1. Depois do cenário C pago (02/10/2026, 21:24 UTC)

**O que aconteceu.** A investigação funcionou: 3 rodadas do planejador, 8 consultas (segmentação por assunto, anomalias da medição
diária, composição do indicador, contexto/flags/memória/análise da chamada do dia 04/08 e o passo das práticas dos colegas). A mensagem
saiu publicável mas pobre: só o resultado oficial e "uma oscilação isolada no dia 04/08" com "média de referência em 354 segundos".
Nenhuma prática dos colegas, nenhum ponto forte dela.

**Causas (código meu, não do modelo):**
1. O brief só oferecia pontos fortes da pessoa quando a conclusão era "padrão de força"; examinar o dia 04/08 mudou a conclusão para
   "mudança localizada sem causa" e os pontos fortes (confirmação de entendimento 5/5, validação do titular 3/3) sumiram.
2. O prompt do redator mandava, com tom de reconhecimento, "reconheça o resultado e pare aí" — o redator ignorou as práticas P-n.
3. Fatos técnicos das ferramentas chegam crus ao contexto ("baseline 354.31").

**Correção.** `STRENGTH_WITH_GOOD_RESULT_V1` no brief, prática dos colegas que orienta como lacuna de utilidade (pede a reescrita;
não bloqueia) e prompt do redator V13. Composição `FEEDBACK_COMPOSITION_V9`.

**Decisão de execução.** NÃO repetir a investigação (ferramentas e análise já pagas). Novo cenário `C-compose`: a MESMA investigação
paga (lida do artefato) → brief do código novo → redação + verificação (+ uma reescrita se o código pedir). Teto 4 requisições, no
mesmo livro-razão da V13. Critérios inalterados (`round-v13-criteria.md`). Uma execução só.

**Congelamento.** O código mudou depois do congelamento dos cenários A e C: o ensaio do `C-compose` grava um congelamento novo
(`--refreeze`), registrado aqui.

## 2. Cenário A — §19 (registro, sem nova execução)

A análise nova (prompt V9) declarou o Jeito Vivo como fonte RELACIONADA, mas não formou nenhuma obrigação dele e deixou `notAssessed`
vazio. O ajuste de texto da pergunta 2 não bastou. Não é repetido aqui. Próximo passo proposto (não implementado nesta rodada):
contrato da análise com a lista das seções de SITUAÇÃO das fontes relacionadas (as marcadas "— condição" no contexto) e uma resposta
por seção (aconteceu? falas), para o código exigir a obrigação de cada situação que aconteceu ou o motivo de não avaliá-la.

## 3. C-compose por REPRODUÇÃO (antes da execução paga do C-compose)

Ao montar o `C-compose` com a investigação gravada, os pontos fortes continuaram fora: a investigação paga gravou a evidência pela regra
antiga — o que a memória sabe das chamadas do período só entrava com a evidência VAZIA, e o exame do dia 04/08 a esvaziou dessa parte.
Correção `UNLOCATED_MEMORY_V2` (investigação V10). Para não pagar de novo planejamento e análise, o `C-compose` REPRODUZ a investigação:
as respostas pagas do planejador (3) e da análise/revisão da chamada de 04/08 (2) voltam na mesma ordem, só se o pedido for idêntico
byte a byte ao pago (pedido diferente = recusa, nada enviado). Ensaio: 5 de 5 pedidos idênticos. O código atual monta a evidência, o
grupo de referência e o brief; só redação e verificação vão ao modelo (teto 4 requisições reais). Congelamento regravado no ensaio.
