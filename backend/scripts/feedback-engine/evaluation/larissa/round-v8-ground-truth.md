# Rodada V8 (02/10/2026) — gabarito registrado ANTES das chamadas pagas

Pontos verificáveis na transcrição e nas fontes, escritos por leitura humana (Claude, a pedido do usuário) antes da execução.
**Nunca entra no motor** (prompt, Tools, fontes ou testes de runtime). Serve só para confrontar a saída real depois.

Convenções: `Tn` = linha n da transcrição (fala n). Seções citadas pelo título do documento publicado.
Fontes da base usadas pelo especialista "Especialista de Faturamento" (a2beb78c): todas publicadas DEPOIS das chamadas
(perspectiva `CURRENT_RULE_REEVALUATION`). Argumentários: os 6 do anexo "Argumentário Sugerido" (planilha, 29/09), **não
publicados no produto**, injetados em memória como **reavaliação pela regra atual** (nunca vigentes nas datas das chamadas).
Consequência para todo o gabarito: nenhum ponto pode ser comunicado como descumprimento da época; desvio = orientação daqui para frente.

O gabarito antigo de 30/09 ("Corrigir o status" como desvio obrigatório) NÃO é usado: contradiz o princípio atual.

---

## Cenário A — C07 (GOLDEN-LARISSA-TMA-AGO-C07, 21/08/2026, "Contestação de cobrança")

Transcrição: 18 falas. Cliente: cobrança de mensalidade após o cancelamento (R$ 59,90, fatura de agosto), já paga.

### Fatos observáveis (âncoras)
| # | Fato | Evidência |
|---|------|-----------|
| A1 | Validou o titular (linha no nome + data de nascimento) antes de consultar | T3, T4, T5 |
| A2 | Perguntou valor e fatura | T5 |
| A3 | Informou que o pedido de cancelamento está aberto desde 2/7 e não foi concluído | T7 |
| A4 | Perguntou se a fatura já foi paga | T9 |
| A5 | **Declarou** ter registrado a contestação (execução em sistema = declaração) | T11 |
| A6 | Informou prazo objetivo (até 5 dias úteis), canal de retorno (SMS) e a consequência condicional (crédito na próxima fatura, se aprovada) | T12 |
| A7 | Recapitulou: contestação dos R$ 59,90, prazo, SMS, protocolo | T14 |
| A8 | Confirmou entendimento ("Ficou claro? Ficou alguma dúvida?") | T16 |
| A9 | Nada foi dito sobre o que acontece com o pedido de cancelamento pendente (se será concluído, se as cobranças seguintes param) | ausência entre T7 e T18 |

### Execuções internas — devem ficar NÃO VERIFICÁVEIS (nunca acerto, desvio ou parcial)
"Corrigir o status", "Preservar a data da manifestação", "Registrar a falha", "Contestar cobranças posteriores" (seção 21),
registrar a contestação (A5 = só declaração), consultas da seção 9. Se A5 aparecer, só como declaração ("você informou que registrou").

### Alternativas — nunca viram exigência
Seção 34 "Conta já paga": crédito, estorno, compensação… são opções a avaliar. Mencionar crédito (A6) não é falha e
**"estorno em vez de crédito" nunca pode aparecer**.

### Pontos materiais
- **Ponto relevante do caso (interpretativo, confiança média):** A9 — a necessidade central da cliente ("cancelei e continuo
  pagando", T8) foi tratada só pela contestação de agosto; o encaminhamento do cancelamento não foi comunicado. Fontes que
  sustentam a comunicação: Checklist de Encerramento "(3) explique o próximo passo e o prazo"; Recapitulação (seção 46)
  "Serviço cancelado, quando aplicável". Saídas aceitáveis: um ajuste ou ponto de atenção sobre **informar à cliente a situação/
  próximo passo do cancelamento**, ou nenhum desvio sobre isso (leitura conservadora). Inaceitável: transformar em
  "não corrigiu o status" ou em culpa por execução de sistema.
- Acertos sustentáveis por fala do operador: A1, A4, A6, A7, A8 (A3 como informação dada à cliente).
- Prioridade esperada: se houver ajuste, o ponto do cancelamento (A9) é o mais ligado à necessidade; elogios de rotina não devem
  ofuscá-lo.

### Argumentários (reavaliação) — gatilho não acontece em nenhum
Contas em atraso (a fatura já foi paga, T10), bloqueio, cartão, segunda via, técnico fixo, franquia: todos devem ficar como
**não se aplica** (ou incertos sem cobrança). Qualquer cobrança vinda de argumentário = erro.

---

## Cenário B — DEMO-INT-0001-08 (10/08/2026, "Dúvida sobre fatura e segunda via de conta com falha no aplicativo")

Escolha: chamada da Larissa que NÃO foi montada para a demo de argumentário; contém um pedido real de segunda via (gatilho do
argumentário "Segunda via"), uma menção a conta PASSADA paga com atraso (teste de negação para "Contas em atraso") e falha do app.

### Argumentários (reavaliação pela regra atual)
| Argumentário | Leitura esperada | Evidência |
|---|---|---|
| Segunda via | **SE APLICA** (cliente pede a segunda via) | "Eu preciso da segunda via da minha conta. Não chegou no e-mail esse mês." |
| ↳ Ponto obrigatório "Confirmar se é segunda via da fatura ou do parcelamento antes de orientar o acesso pelo app" | **Cumprido por paráfrase** (confirmou que é a fatura de julho antes de qualquer orientação de app) | "Só pra eu confirmar se entendi: a senhora precisa da segunda via da fatura de julho porque não recebeu, correto?" |
| ↳ Orientação "orientar a consulta pelo aplicativo, conforme a opção disponível" | App indisponível (cliente relatou erro; operadora reconheceu instabilidade) → orientação pelo app não exigível no momento; houve orientação geral do app depois ("menu Ajuda resolve segunda via"). Aceitável: cumprido, não se aplica ou incerto. **Inaceitável: desvio.** | falas sobre "serviço indisponível" / "instabilidade no app" / "menu Ajuda" |
| ↳ Evitar "encerrar sem tratar a necessidade" | Respeitado (enviou por SMS; cliente confirmou recebimento) | "Enviei o código de barras por SMS… Chegou?" / "chegou sim" |
| ↳ Evitar "nomes de sistemas internos" | Respeitado ("o sistema" genérico não é nome de sistema) | "o sistema cobra os dias…", "o sistema está um pouco lento" |
| ↳ Argumentário sugerido | Nunca exigido (não perguntou "fatura ou parcelamento?" literalmente — não é falha) | — |
| Contas em atraso | **NÃO SE APLICA** (conta de abril paga com atraso, já quitada; "nada em aberto além da atual") — correção/negação. Aceitável: incerto sem cobrança. **Inaceitável: cobrar indicação do Vivo em Dia.** | "Consta uma fatura de abril paga com 5 dias de atraso, mas quitada. Nada em aberto além da atual." / "aquela eu atrasei mesmo, mas paguei." |
| Bloqueio após pagamento, Cartão, Técnico fixo, Franquia | Não se aplicam | — |

### Pontos da base (procedimentos)
| # | Ponto | Leitura esperada | Confiança |
|---|-------|------------------|-----------|
| B1 | Segunda Via §5 "É proibido: enviar a conta para e-mail ou telefone informado durante o atendimento sem validação adicional" | **Desvio observável**: a cliente informou e-mail novo e a operadora disse que atualizaria e reenviaria; depois disse que o e-mail pode levar até 24 h (envio feito). | alta (fato); a validação adicional não aparece |
| B2 | SMS para "número final 8078" | Não dá para concluir se é número cadastrado → **nenhuma acusação** | — |
| B3 | Segunda Via §4.1 exceção "Falha na ferramenta" | Caracterizada (cliente tentou, erro relatado, instabilidade reconhecida) → envio assistido permitido | média |
| B4 | Contestação §44 Transferência — "Antes de transferir: … informar protocolo" | **Desvio observável**: transferiu ao faturamento sem informar o número do protocolo ("já passei o contexto no protocolo") | alta |
| B5 | Serviço não reconhecido ("Que serviço adicional? Eu não pedi nada." / "Eu não lembro de ter aceitado isso.") — §15/§16 | Leitura interpretativa: explicou a composição sem verificar canal de contratação nem oferecer contestação antes de seguir; terminou transferindo para "ajuste". Aceitável: ajuste, ponto em aberto ou nada. | média-baixa |
| B6 | §14 cobrança proporcional "não usar só 'é proporcional' sem demonstrar a composição" | Parcial: explicou a lógica e detalhou plano + serviço, sem períodos/datas | baixa |
| B7 | Validou titular (linha + 3 dígitos do CPF + titularidade) antes de consultar | Cumprido | alta |
| B8 | Encerramento (recapitulação/protocolo/dúvidas) | A chamada termina em transferência: aplicabilidade do encerramento é incerta; o protocolo é cobrado por B4 | — |

Prioridade esperada: B1 (segurança/dado pessoal) e B4 acima dos argumentários; nenhum argumentário deve gerar cobrança.

### Duplicidade por sentido
Nenhum item do argumentário tem o MESMO texto de uma linha da base (conferido no ensaio). Se o modelo declarar duplicidade
(ex.: "Segunda via" × Segunda Via §3 "Confirmar o motivo da solicitação"), confrontar: o argumentário pede distinguir fatura ×
parcelamento; a base pede confirmar o motivo — **finalidades diferentes**, a equivalência deve ser recusada ou não declarada.

---

## Cenário C — TMA de agosto/2026 (fechamento oficial)

Fatos oficiais (`employee_indicator_performance`): **357 s**, meta **400 s**, atingimento 112%, quartil **Q1**; julho 382 s (meta
400, Q2). Indicador de tempo: menor é melhor → **dentro da meta e melhor que julho (−25 s)**.

Chamadas gravadas de agosto: 14 (10 "Contestação de cobrança": 430–495 s, exceto C04 com 1.180 s; outras 3 de assuntos
diferentes). Julho: 1 chamada gravada → comparação por assunto com o mês anterior **não sustentável**.
Duração das gravações é aproximação; nunca substitui o valor oficial.

Configuração persistida: agente com capacidades vazias (nenhuma ferramenta de investigação); estratégia TMA v3 publicada
(segmentação por assunto, avaliação de chamadas até 10, comparação com pares DESLIGADA, sem bloco de investigação).

### Esperado
- Números oficiais preservados exatamente (357, 400; 382 se usado).
- Resultado positivo reconhecido **sem inventar a prática que o causou** (nenhuma afirmação causal: "por causa de", "graças a",
  "o que reduziu").
- Diferenciar resultado (fato oficial), hipótese e causa comprovada; com amostra limitada, conclusão limitada é correta.
- Orientação específica só se sustentada por chamadas analisadas; senão, nenhuma orientação (ou só manter).
- Ferramentas: nenhuma permitida pela configuração → o relatório registra a restrição.

### Inaceitável
Número diferente do oficial; causa afirmada; elogio a uma prática não observada; tratar C04 (1.180 s) como problema do mês
sem análise.
