# Quanto de cada prompt se repete — potencial do cache de prompt do Azure (09/11/2026)

**Conclusão.** No chat, cerca de um terço da entrada de uma pergunta já se repete entre perguntas diferentes, na ordem de hoje, e quase
tudo vem do esclarecimento pelas bases (99% do pedido dele é igual de uma pergunta para outra). No motor de feedback, hoje só cerca de
12% se repete; com a base antes dos dados da chamada, seriam cerca de 73%, mas isso muda o prompt (contrato versionado) e pede A/B.
O cache do Azure é automático e não cobra criação nem armazenamento, então a conta do diagnóstico de 04/11 (feita para o Gemini, que
só acertou pedido quase repetido) muda de lado: o risco que sobra é o de qualidade, não o de custo.

Nada foi alterado. Medida sem custo: banco de dev em modo leitura, rede bloqueada, IA trocada por um dublê que só anota o prompt.
Complementa [cache-prompt-motor-feedback.md](cache-prompt-motor-feedback.md) (04/11), de onde vêm os números do motor e do roteamento.

## 1. Como o cache do Azure funciona (o que importa aqui)

- Automático, sem configurar nada, para pedidos de **1.024 tokens ou mais**. Acerta quando o **começo** do pedido é idêntico a um pedido
  recente: os primeiros 1.024 tokens e depois de 128 em 128. Basta um caractere diferente no começo para não aproveitar nada do resto.
- O cache dura de 5 a 10 minutos sem uso (até 1 hora fora do pico); há retenção estendida só em implantações regionais.
- Tokens em cache têm desconto na entrada: nos planos comuns, conforme a tabela de preço; na capacidade reservada (PTU, o caso do
  `gpt-5.4-mini-ptu` do cliente), até 100%.
- **Não sabemos** se o limite de 250 mil tokens por minuto do LiteLLM conta os tokens que vieram do cache. Pergunta para o cliente.

Fontes: [prompt caching](https://learn.microsoft.com/en-us/azure/ai-foundry/openai/how-to/prompt-caching) e
[cotas e limites](https://learn.microsoft.com/en-us/azure/ai-foundry/openai/quotas-limits).

## 2. Por etapa

Entrada média: `ai_usage_events`, 45 dias, só sucesso. "Repete hoje" = começo idêntico entre perguntas/chamadas diferentes, na ordem
atual, já descontado o mínimo de 1.024. "Fixo" = o que não depende da pergunta/chamada, se viesse antes do que varia.

| Etapa | Entrada média | Repete hoje | Fixo (com reordenação) | De onde |
| --- | ---: | ---: | ---: | --- |
| Esclarecimento pelas bases (planejador) | 6.063 | **6.098 de 6.150 (99%)** | o mesmo | medido agora, 120 perguntas reais |
| Roteamento do Orquestrador | 6.064 | ~600 (abaixo do mínimo → 0) | ~2,9 mil (Orquestrador ~600 + ferramentas ~2,3 mil) | 04/11 |
| Especialista | 3.606 | 0 a 1,5 mil, conforme o agente | o prompt do agente (653 a 2,4 mil) | medido agora, 360 montagens |
| Síntese do Orquestrador | 3.562 | ~0 (mesma estrutura do roteamento) | não medido | estimado |
| Conferência da resposta | 968 | 0 (47% abaixo de 1.024) | — | uso |
| Análise da chamada (motor) | ~44,3 mil | 4,2 mil (9,5%) | **43,7 mil (98,5%)** | 04/11 |
| Revisão (motor) | ~51,0 mil | 3,6 mil (7%) | **43,3 mil (85%)** | 04/11 |
| Redação do feedback | 4.930 | instruções: 4,8 mil (composição) e 2,7 mil (conferência) | o mesmo | medido agora (instruções fixas) |

**Esclarecimento.** O sistema (instruções, limites dos agentes, glossário e lista das bases) é idêntico entre perguntas do mesmo
Orquestrador: 6.088 tokens num, 2.329 no outro. A pergunta em si tem ~65 tokens (p50). Entre pessoas com acessos diferentes às bases,
o começo comum cai para 1.857 tokens no pior caso (p10), porque a lista das bases depende de quem pergunta. Nada a mudar: vale assim
que a chamada for para o Azure.

**Roteamento e síntese.** O prompt do Orquestrador é igual entre perguntas, mas logo depois da persona entram os dados da pessoa
(tela, tratamento, perfil): o começo comum para em ~600 tokens, abaixo do mínimo. Levar os dados da pessoa para depois das instruções
deixaria ~2,9 mil fixos no começo. Não sei em que posição o Azure coloca as ferramentas no prefixo.

**Especialista.** O trecho da base escolhido pela pergunta entra no fim do sistema; o começo comum do agente com base fica em 1,5 mil
(p50). Os agentes sem trecho têm prompt fixo, mas pequeno (653 e 767 tokens): abaixo do mínimo, não aproveitam.

**Motor.** Os dados da chamada (data, assunto, motivo, sinais, transcrição) vêm antes dos procedimentos e argumentários, então só as
instruções se repetem. Com a base antes, repetiria quando o mesmo agente usa o mesmo conjunto de documentos dentro da janela do cache.
No dev, em janelas de 10 minutos, 67 de 188 análises (36%) teriam encontrado a base em cache (188 análises em 121 janelas de agente
× base); em 30 minutos, 44%.

## 3. Por pergunta do chat e por feedback

| Unidade | Entrada | Repete hoje | Com dados da pessoa no fim (roteamento) | Com a base antes (motor) |
| --- | ---: | ---: | ---: | ---: |
| Pergunta no chat (com Orquestrador) | ~20–26 mil | ~6–7,5 mil (**~30%**) | ~9–10 mil (~40–45%) | — |
| Feedback de monitoria (por chamada analisada) | ~130 mil | ~15 mil (**~12%**) | — | ~94 mil (**~73%**), quando a base está em cache |

Na pergunta do chat, quase tudo o que já se repete vem do esclarecimento. No feedback, o ganho grande só aparece com a reordenação.

## 4. Recomendação

1. **Nada a fazer no esclarecimento.** Ele já aproveita o cache na ordem de hoje. Ao ligar a conexão do cliente, conferir `cached_tokens`
   nos eventos de uso.
2. **Roteamento e síntese: mudança pequena, ganho pequeno** (~2,9 mil por chamada). Levar os dados da pessoa para o fim muda o texto
   do prompt e precisa de uma rodada curta de comparação. Só vale se o cliente descontar o cache do limite por minuto ou do custo.
3. **Motor: o maior ganho, com o mesmo risco de antes.** Reordenar muda contrato versionado, invalida o reaproveitamento das análises
   já pagas (a chave usa o hash do prompt) e muda o que o modelo lê por último. Continua exigindo A/B com casos de omissão,
   condicional, produto e fontes em conflito; qualquer perda mantém desligado. O que muda no Azure é só o lado do custo: sem criação
   nem armazenamento, um uso isolado não perde dinheiro, então o critério de "5 chamadas por base em 30 minutos" do diagnóstico de
   04/11 pode cair para **2 chamadas por base em 10 minutos** (a janela do cache). No dev, 36% das análises já passam disso.
4. **Não adianta:** conferência da resposta e especialistas sem trecho de base (abaixo de 1.024 tokens).

**Perguntas para o cliente:** os tokens em cache contam no limite de 250 mil por minuto do LiteLLM? Na PTU, contam na utilização? A
implantação tem retenção estendida? O LiteLLM repassa `prompt_cache_key`?

## 5. Limites desta medida

- Dev, não produção: bases de teste, poucas pessoas (2 a 3 por Orquestrador) e perguntas de teste.
- Tokens por proporção (3,99 caracteres por token, a média medida em 04/11), não pelo contador do modelo do cliente.
- Esclarecimento: só a primeira rodada do planejador de cada pergunta nova, sem conversa anterior. As rodadas de leitura e a redação da
  resposta não foram montadas.
- Especialista: montado com a pergunta como consulta, sem o contexto da conversa e sem o escopo de quem pergunta.
- Síntese do Orquestrador e posição das ferramentas no prefixo: estimadas, não medidas.
- Nenhum acerto real de cache do Azure foi observado: não há acesso ao modelo do cliente.

## 6. Reproduzir

A partir de `backend/` (só números na saída):

```bash
npx tsx ../docs/dev/cache-prompt-azure/chat-stages-prefix.mts
```

Análises por agente × base em janelas de 10 minutos (troque por `30 min` para a janela do diagnóstico de 04/11):

```sql
with r as (
  select agent_id, date_bin('10 min', started_at, timestamptz '2026-01-01') janela,
         md5((provenance->'documents')::text || (provenance->'argumentScripts')::text) base
  from feedback_analysis_runs
  where kind = 'CALL_ANALYSIS' and status = 'COMPLETED' and started_at >= now() - interval '45 days'
), j as (select janela, agent_id, base, count(*) n from r group by 1, 2, 3)
select count(*) janelas, sum(n) chamadas, sum(n) - count(*) acertariam from j;
```
