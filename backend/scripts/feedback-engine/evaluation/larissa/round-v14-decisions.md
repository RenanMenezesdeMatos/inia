# Rodada V14 (02/10/2026) — decisões registradas

Decisões tomadas ANTES da execução (e as que surgirem durante, com data e motivo).

1. **Cenário de dados.** Pedido do usuário: Larissa com chamadas com falha e TMA ruim. As cópias de teste de setembro foram movidas para
   uma pessoa de QA (`scripts/dev/larissa-scenario/move-test-copies.ts`, manifesto em `results/`), e o cenário de setembro foi gravado
   por `tma-setembro.ts` (ids determinísticos, removível pela lista). Fechamento oficial só de TMA de setembro (limitação conhecida).
2. **Configuração de produção, sem substituição.** Diferente da V13, o especialista (Faturamento) e a estratégia publicada do TMA (v4,
   comparação com pares LIGADA) são usados como estão no banco — nada é trocado na memória do processo, exceto os tetos abaixo.
3. **Tetos desta rodada.** Análises de chamadas da Larissa: 6 (a estratégia permite 10); análises de chamadas de colegas para a
   referência: 6 (orçamento próprio, `REFERENCE_GROUP_V3`). Livro-razão: 44 requisições, US$ 1,00.
4. **Colegas.** As chamadas analisadas dos colegas existem só na memória isolada desta execução; só números agregados chegam ao brief; o
   feedback é só da Larissa. `allowCollaborator` = Larissa + pessoas do Subgrupo dela.
5. **Ordem.** C (indicador) primeiro e A (monitoria da L09) depois, no MESMO processo e na MESMA memória isolada: a reincidência por
   prática (`PRACTICE_ANCHOR_V1`) usa as chamadas que o C analisou. A L09 pode ter sido analisada no C (aí a análise é reaproveitada).
6. **Uma execução paga.** Sem repetição para escolher resultado. Ensaio (sem custo) antes, com congelamento do código e destes arquivos.
7. **(Depois do ensaio, antes de qualquer custo.)** O ensaio mostrou que as análises de colegas eram feitas em PROFUNDIDADE (2 chamadas
   por colega): 6 análises = 3 colegas, abaixo dos 4 que a estratégia exige — nenhuma prática dos colegas sairia. Corrigido no código
   (`REFERENCE_GROUP_V3`: uma chamada de cada colega primeiro, depois a segunda), com teste; congelamento refeito (`--refreeze`).
   O ensaio também mostrou: contestação localizada (534 s → 629 s), grupo pelo resultado oficial (8 de 32 colegas) e duração no assunto
   629 s (11 chamadas) × 363 s (13 chamadas de 7 colegas).
