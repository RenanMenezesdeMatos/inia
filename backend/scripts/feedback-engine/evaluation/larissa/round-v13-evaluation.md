# Rodada V13 (02/10/2026) — avaliação

**Quem avaliou.** Claude (modelo de IA), contra `round-v13-criteria.md` (registrado antes; só a base como padrão). Não é validação
humana. Decisões tomadas durante a execução: `round-v13-decisions.md`.

**Custo.** Livro-razão `results/round-v13-budget-ledger.json`: **15 requisições, US$ 0,258** (A: 6 / US$ 0,117; C: 7 / US$ 0,121;
C-compose: 2 / US$ 0,020). Limite era 24 / US$ 1,20. Mesmo modelo do motor (`gemini-3.8-flash`). Banco somente leitura; nada
publicado, entregue ou gravado.

## A — C07, pipeline completo com análise NOVA (`round-v13-A-paid-2026-10-02T21-22-52-704Z.json`)

Análise (prompt V9) → revisão → redação → verificação → reescrita → verificação. Mensagem **publicável**.

> **Cartão:** Você levantou com precisão o valor e a fatura contestados, checou o pagamento e orientou sobre o crédito em conta futura e
> o prazo de cinco dias úteis.
>
> Na identificação da solicitação, você levantou pontualmente qual fatura e qual valor o cliente não reconhecia, além de conferir se a
> conta de agosto já havia sido paga. Essa verificação inicial delimitou com precisão o valor questionado e permitiu conduzir o
> atendimento sabendo exatamente a situação da fatura. Com a confirmação de que o pagamento já tinha ocorrido, você também esclareceu de
> pronto que, se o pedido for aprovado, o valor retorna como crédito na próxima fatura. Além disso, passou de forma objetiva o prazo de
> até cinco dias úteis para a conclusão da análise e avisou que a resposta chegará por SMS na própria linha.

| Critério | Resultado |
|---|---|
| §19 ligado ao caso | **Não atende (utilidade)** — a análise declarou o Jeito Vivo como fonte relacionada, mas não formou obrigação dele e deixou `notAssessed` vazio. O ajuste de texto do prompt não bastou (decisão 2). Não é erro: nenhum ponto falso. |
| Reconhecimento só do que a fala mostra | Atende (fatura/valor, se estava paga, crédito condicional, prazo e SMS — todos com fala) |
| Execução em sistema | Atende (a abertura de análise ficou como não observável; nenhuma frase a dá como feita) |
| Alternativas (§34) | Atende (crédito tratado como a opção comunicada; nada de "estorno em vez de crédito") |
| Perspectiva | Atende (só reconhecimento) |
| Ressalva | "delimitou com precisão… sabendo exatamente" é interpretação forte de uma conduta de rotina, sem ser falsa |

## C — TMA de agosto/2026 com ferramentas (`round-v13-C-paid-2026-10-02T21-24-08-912Z.json`)

**Investigação:** planejador em 3 rodadas, 8 consultas executadas — `segment_indicator` (assuntos), `detect_anomalies` (04/08 fora do
padrão), `inspect_indicator_composition`, contexto/flags/memória da chamada de 04/08, `analyze_calls` (a chamada de 04/08, analisada e
revisada agora) e `reference_practices` (passo do diagnóstico, sem modelo). Grupo de referência: os colegas com melhor resultado
oficial de TMA em agosto/2026 (o grupo por assunto tinha 3 colegas com 1 chamada avaliada cada).

**Mensagem desta execução (rejeitada pela avaliação):** só o número e "uma oscilação isolada no dia 04/08" com "média de referência
em 354 segundos". Nenhuma prática dos colegas, nenhum ponto forte. Três defeitos do meu código (decisões 1 e 3): pontos fortes que
sumiam quando um recorte era examinado, prompt que mandava "parar" no número, e a memória do período que só entrava com a evidência vazia.

## C-compose — a MESMA investigação reproduzida, com o brief e a redação corrigidos (`round-v13-C-compose-paid-2026-10-02T21-30-15-104Z.json`)

Planejador (3) e análise/revisão (2) reproduzidos com as respostas pagas — 5 de 5 pedidos idênticos byte a byte; só redação e
verificação foram ao modelo. Mensagem **publicável**, sem reescrita.

> **Cartão:** Em agosto, seu Tempo Médio de Atendimento foi de 357 segundos, dentro da meta de 400 segundos, com destaque para a
> confirmação de dúvidas e o repasse claro de prazos.
>
> Seu resultado de Tempo Médio de Atendimento em agosto foi de 357 segundos, ficando dentro da meta de 400 segundos e melhorando em
> relação aos 382 segundos de julho. Nas chamadas analisadas sobre contestação de cobrança, você perguntou se as informações estavam
> claras e conferiu se restavam dúvidas em 5 de 5 atendimentos. Além disso, você informou o prazo de até cinco dias úteis da análise e o
> envio do retorno por SMS nas 4 chamadas avaliadas em que a etapa cabia.
>
> Daqui para frente, vale reforçar a confirmação do entendimento logo após a escuta inicial, checando com o cliente o valor habitual e o
> lançamento não reconhecido. Nas chamadas analisadas de contestação dos colegas com melhor resultado no indicador, essa confirmação da
> solicitação apareceu em 6 de 6 atendimentos em que se aplicava.

| Critério | Resultado |
|---|---|
| Ferramentas | **Atende** — 8 consultas executadas, inclusive `reference_practices`; nenhuma recusada contada como respondida |
| Números | **Atende** — 357 × 400; julho 382 |
| Boas práticas dos colegas | **Atende** — "confirmação da solicitação… 6 de 6", agregado, sem nomes, sem causa; ela não tinha avaliação dessa etapa e o texto diz "vale reforçar", sem insinuar falta |
| Pontos fortes dela | Atende — confirmação de entendimento 5/5 e prazo 4/4, com denominador |
| Recapitulação (grupo 0/7) | Não mencionada (atende) |
| 04/08 | Não mencionado (atende) |
| Conclusão sem causa / sem jargão | Atende — nada liga a conduta ao número; sem "baseline" |
| **Ressalva** | "o prazo de até cinco dias úteis… e o envio do retorno por SMS nas 4 chamadas": a etapa foi cumprida nas 4, mas o conteúdo específico (cinco dias úteis, SMS) aparece nas falas de 2 delas — generalização pequena que o verificador aceitou. |

## Conclusão

- **Indicador:** o caminho completo funciona — a IA escolhe e executa ferramentas, examina o dia fora do padrão, e o feedback final traz o
  resultado oficial, a conduta concreta da pessoa com denominador e uma boa prática dos colegas com melhor resultado, sem causa
  inventada. O primeiro texto saiu pobre por defeitos meus no brief e no prompt (não do modelo), corrigidos e provados com a mesma
  investigação.
- **Monitoria (C07):** correta e publicável; a regra transversal acionada por situação (Jeito Vivo §19) continua fora — o próximo passo
  é estrutural (decisão 2), não mais texto de prompt.
- **Configuração de produção (decisão do usuário):** a estratégia publicada do TMA está com "Comparação com pares" DESLIGADA e o Agent
  sem a capacidade `OPERATIONAL_COMPARISON`. Nesta rodada as duas foram ligadas só na memória do processo. Sem ligá-las, o feedback de
  indicador em produção não traz as práticas dos colegas.
