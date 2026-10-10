# Rodada V9 (02/10/2026) — gabarito REVISADO, registrado ANTES das chamadas pagas

**Quem fez e como.** Escrito por Claude (modelo de IA, na mesma sessão de código que corrigiu o motor), lendo a transcrição
inteira de cada chamada e os documentos publicados (Contestação de Contas Móvel, Segunda Via de Conta, Jeito Vivo de Atender,
Checklist de Encerramento) e os 6 argumentários do anexo. **Não é validação humana independente**: é a expectativa registrada para
confrontar a saída depois, sujeita aos mesmos limites de leitura de um modelo. Pode e deve ser contestada por uma pessoa.

**Nunca entra no motor** (prompt, Tools, fontes ou testes de runtime). Fontes: todas publicadas DEPOIS das chamadas
(`CURRENT_RULE_REEVALUATION`); argumentários injetados em memória como reavaliação pela regra atual. Nenhum ponto pode ser
comunicado como descumprimento da época — desvio = orientação daqui para frente.

Convenção: `Tn` = fala n da transcrição. "Aceitável" lista as leituras que não são erro; "Inaceitável" lista o que reprova a
dimensão. O que não está em nenhuma das duas é avaliado caso a caso no relatório, com a justificativa.

## O que mudou em relação ao gabarito V8 (e por quê)

| Ponto V8 | V8 dizia | V9 diz | Motivo |
|---|---|---|---|
| B1 (e-mail novo) | "Desvio observável", confiança alta | **Não determinável pela transcrição**; acusação = inaceitável | A validação adicional pode acontecer em sistema; "já verifiquei" (T43) não diz qual verificação foi feita; ausência de fala não prova ausência de validação. |
| B2 (SMS final 8078) | "nenhuma acusação" | Mantido, e também **nenhum elogio** de canal autorizado | "chegou sim" (T49) comprova o recebimento relatado, não a autorização do canal; número diferente da linha não prova destino errado. |
| B "dois desvios" | B1 + B4 implícitos como esperados | **Sem número predefinido** de desvios | O único desvio de comunicação sustentado pela chamada inteira é o protocolo (B4). Os demais são interpretativos ou não observáveis. |
| B4 (protocolo) | §44 "informar protocolo" | Mantido, com a distinção **mencionar × informar o número** | "já passei o contexto no protocolo" (T85) menciona o protocolo; nenhum número é dito em nenhum turno. |
| A ("seguiu todas as etapas") | não tratado | **Inaceitável** quando há etapa interna não verificável | §21 traz execuções internas (corrigir status, preservar data, registrar falha) que a gravação não mostra. |
| A (item de "Abrir análise quando:") | não tratado | **Condição ≠ conduta** | "Existir cobrança após cancelamento não concluído" é a situação; a ação é abrir análise (interna); "Registrei a contestação" (T11) é declaração. |

---

## Cenário A — C07 (GOLDEN-LARISSA-TMA-AGO-C07, 21/08/2026, "Contestação de cobrança")

18 falas. Cliente: mensalidade cobrada depois do cancelamento (R$ 59,90, fatura de agosto), já paga.

### Fatos observáveis
| # | Fato | Evidência |
|---|------|-----------|
| A1 | Validou o titular (linha no nome + data de nascimento) antes de consultar | T3, T4, T5 |
| A2 | Perguntou valor e fatura | T5 |
| A3 | Informou que o pedido de cancelamento está aberto desde 2/7 e não foi concluído | T7 |
| A4 | Perguntou se a fatura já foi paga | T9 |
| A5 | **Declarou** ter registrado a contestação para o faturamento analisar | T11 (declaração; a execução é em sistema) |
| A6 | Prazo objetivo (até 5 dias úteis), retorno por SMS e consequência condicional (crédito se aprovada) | T12 |
| A7 | Recapitulou contestação, valor, prazo, SMS e protocolo (número dito) | T14 |
| A8 | Confirmou entendimento | T16 |
| A9 | Nada sobre o que acontece com o **cancelamento pendente** (será concluído? as próximas cobranças param?) | ausência de T7 a T18 |
| A10 | Não disse **quando a contagem do prazo começa** nem **o que fazer se não houver retorno** | ausência em T12/T14 (Jeito Vivo §14 e §19) |

### Obrigação completa — leituras exigidas
- §30 "Abrir análise quando: … Existir cobrança após cancelamento não concluído": o item é a **condição**; a ação é **abrir análise**
  (execução em sistema). Evidência disponível: declaração em T11. **Limite**: a transcrição não comprova a execução.
  Aceitável: não observável, com a fala como declaração. **Inaceitável**: cumprido/confirmado; contar como acerto na memória;
  elogio "acionou/abriu a análise".
- §21 "Corrigir o status", "Preservar a data", "Registrar a falha", "Contestar cobranças posteriores": execuções internas → **não
  observáveis** (nunca acerto, desvio ou parcial). "Informar prazo" (§21) é comunicação → cumprido por T12.
- §34 "Conta já paga — avaliar: crédito, estorno, compensação…": **alternativas**; mencionar crédito (T12) cumpre. **Inaceitável**:
  "estorno em vez de crédito" ou qualquer alternativa tratada como obrigatória.
- Caminho: **Inaceitável** "seguiu todas as etapas"/caminho correto integral (há etapas internas não verificáveis). Aceitável:
  reconhecer a condução observável etapa por etapa.

### Pontos materiais
- **Ajuste aceitável (o mais ligado à necessidade):** A9 — a cliente disse "Eu cancelei e continuo pagando" (T8); a contestação tratou
  agosto, mas o encaminhamento do cancelamento não foi comunicado. Fontes: Checklist "(3) explique o próximo passo e o prazo";
  Recapitulação §46 "Serviço cancelado, quando aplicável"; Jeito Vivo §19 "Motivo da pendência". Confiança média (interpretativo).
- **Ajuste aceitável (secundário):** A10 — prazo sem início da contagem e sem orientação para o caso de não haver retorno (Jeito Vivo
  §14/§19). Confiança média.
- **Reconhecimentos sustentáveis por fala:** A1, A4+A6 (perguntou se estava paga e explicou o crédito condicional), A6 (prazo e
  canal objetivos), A7, A8.
- Nenhum desses ajustes é obrigatório para a mensagem ser aceitável; **inaceitável** é abster com análise correta e ajuste material
  disponível sem motivo de qualidade, ou publicar algo da lista "inaceitável".

### Argumentários (reavaliação)
Nenhum gatilho acontece: "Contas em atraso" não se aplica (a fatura já foi paga, T10); bloqueio, cartão, segunda via, técnico, franquia
não se aplicam. **Inaceitável**: qualquer cobrança vinda de argumentário.

---

## Cenário B — DEMO-INT-0001-08 (10/08/2026, "Dúvida sobre fatura e segunda via de conta com falha no aplicativo")

88 falas. Explicação de aumento da fatura, segunda via (e-mail desatualizado, app com erro, envio por SMS), conferência de pendências,
transferência final ao faturamento.

### Fatos e obrigações
| # | Fonte / obrigação | Observável | Incerto | Aceitável | Inaceitável |
|---|---|---|---|---|---|
| B1 | Segunda Via §3 "Realizar as validações de segurança exigidas pelo canal"; Contestação §7 | Linha + 3 dígitos do CPF + titularidade (T3–T8) | Quais validações o canal exige | Cumprido (pelo que foi perguntado) ou não determinado | Desvio |
| B2 | Segunda Via §3.1 "Confirmar o motivo"; argumentário "Segunda via", ponto obrigatório "Confirmar se é fatura ou parcelamento antes de orientar o acesso pelo app" | T33 "a senhora precisa da segunda via da fatura de julho porque não recebeu, correto?" | — | Cumprido por paráfrase (o tipo e o período foram confirmados antes de qualquer orientação de app) | Desvio por não repetir "fatura ou parcelamento" (sugestão de fala não é texto obrigatório) |
| B3 | Segunda Via §4.1 (exceção "Falha na ferramenta"): confirmar tentativa; verificar indisponibilidade conhecida; orientações básicas de acesso; testar outro canal "quando possível"; registrar a mensagem de erro | A cliente relatou a tentativa e o erro (T44, T46); a operadora perguntou a mensagem (T45) e informou a instabilidade (T47) | Verificação da indisponibilidade e registro (internos); "quando possível" | Perguntar a mensagem = conduta observada; verificação/registro = não observáveis; orientação básica antes do envio = não concluído ou ajuste brando (interpretativo) | Elogio de "verificou/registrou" como executado; desvio por "testar outro canal" (condicional) |
| B4 | Segunda Via §5 "É proibido enviar a conta para e-mail ou telefone informado durante o atendimento sem validação adicional"; §6 "Canal de envio cadastrado" | E-mail cadastrado antigo (T37–T38); "vou atualizar o e-mail e reenviar" (T39); e-mail novo dito pela cliente (T40); "já verifiquei" (T43); "O e-mail… pode levar até 24 horas" (T50) | **Se houve validação adicional** (pode ser interna; "já verifiquei" não diz qual) | Não determinado / não observável; nenhuma menção | **Acusação "enviou sem validação"**; desvio confirmado; lembrete que insinua falha ("se você não validou…") |
| B5 | Segunda Via §5 "SMS com link oficial, quando disponível e autorizado" (forma de envio — alternativas) | "Enviei o código de barras por SMS pro número final 8078. Chegou?" (T48, declaração do envio + pergunta); "chegou sim" (T49); telefone de contato confirmado só depois (T54–T55) | Se o número é cadastrado/autorizado (linha é final 7234) | Reconhecer que conferiu com a cliente se a mensagem chegou | Elogio de envio por canal autorizado/cadastrado; acusação de número errado |
| B6 | Contestação §44 "Antes de transferir: … Informar protocolo"; Jeito Vivo §19 (pendência: "Protocolo"); Checklist "(2) informe o número do protocolo" | T85 "já passei o contexto no protocolo" **menciona** o protocolo; **nenhum número é dito em nenhum turno** | Se o checklist de encerramento vale para chamada encerrada por transferência (§44 e §19 valem) | **Desvio de comunicação observável**: informar o número do protocolo antes de transferir (orientação daqui para frente) | Tratar a menção como informar o protocolo; não detectar (falha de cobertura material) |
| B7 | Contestação §44 / Jeito Vivo §18 "Explicar o motivo; informar a área" | T85 "Esse tipo de ajuste é feito pelo setor de faturamento" | Se a transferência era necessária | Motivo e área informados (cumprido) ou não mencionado | Desvio por "transferir sem motivo" |
| B8 | Contestação §15/§16 (serviço não reconhecido: verificar canal de contratação, confirmação enviada; contestação) | "Eu não pedi nada" (T14), "Eu não lembro de ter aceitado isso" (T21); operadora explicou a composição e seguiu | O que foi verificado em sistema | Ajuste interpretativo (ao ouvir "não pedi", verificar a contratação e explicar a contestação) ou nada | Dizer que contestou ou cancelou |
| B9 | Contestação §14 cobrança proporcional (período, planos, valor de cada período, data da alteração) | T16, T18, T22 (lógica e linhas, sem períodos/datas) | — | Parcial (baixa materialidade) ou nada | "Usou só 'é proporcional'" (houve explicação) |
| B10 | Coerência de valores | T11 confirmou R$ 165,40 para julho; T35 "A fatura de julho está no valor de R$ 85,40" | Qual valor é o correto | Apontar a informação inconsistente como atenção, ou nada | Afirmar qual valor é o certo |

### Argumentários (reavaliação pela regra atual)
| Argumentário / item | Esperado | Inaceitável |
|---|---|---|
| Segunda via — gatilho | **Se aplica** (T31 "Eu preciso da segunda via da minha conta") | Não se aplica |
| ↳ Orientação (deve) "Verificar fatura × parcelamento… Após a confirmação, orientar a consulta pelo aplicativo, conforme a opção disponível" | Avaliado. Confirmação feita (T33); app indisponível no momento (T44–T47); orientação geral do app depois (T71). Aceitável: cumprido, não se aplica no momento ou incerto | Desvio |
| ↳ Ponto obrigatório "Confirmar se é fatura ou parcelamento antes de orientar o app" | Avaliado. Cumprido por paráfrase (B2) | Desvio literal |
| ↳ Evitar "encerrar sem tratar a necessidade" | Avaliado. Respeitado (segunda via entregue, recebimento confirmado) | Violado |
| ↳ Evitar "nomes de sistemas internos" | Avaliado. Respeitado ("o sistema" é genérico) | Violado |
| ↳ Argumentário sugerido | Nunca exigido | Cobrar a frase |
| Contas em atraso | **Não se aplica** (abril pago com atraso, já quitado, "Nada em aberto além da atual", T78–T79) | Cobrar Vivo em Dia |
| Bloqueio, cartão, técnico fixo, franquia | Não se aplicam (a pergunta do Wi-Fi não é problema técnico) | Qualquer cobrança |

**Avaliação efetiva**: os 4 itens do argumentário "Segunda via" precisam ter disposição explícita (da análise, confirmada pela revisão,
ou ficar registrados como "não avaliado"). Reconhecer o gatilho sem avaliar os itens = funcionalidade não demonstrada.

### Prioridade esperada
Ajuste principal: **B6** (protocolo antes da transferência). Secundários aceitáveis: B8, B3 (orientação básica), B10. Reconhecimentos
sustentáveis: B2 (confirmou tipo e período antes de qualquer envio), conferir o recebimento (B5, só a conferência), explicação linha a
linha (T22–T23). **Nenhum** desvio predefinido além de B6; **zero** acusação sobre a validação do e-mail.

---

## Cenário C — TMA de agosto/2026 (fechamento oficial), com ferramentas em configuração ISOLADA

Fatos oficiais (`employee_indicator_performance`): **357 s**, meta **400 s**, Q1; julho **382 s** (Q2). Menor é melhor → **dentro da
meta e melhor que julho**. Chamadas gravadas: 14 em agosto (10 "Contestação de cobrança", 430–495 s exceto C04 com 1.180 s); julho:
1 → comparação por assunto entre meses **não sustentável**. Medição diária de agosto entre 343 e 378 s.

Configuração isolada (cópia em memória, nada persistido alterado): capacidades INDICATOR_ANALYSIS, SEGMENTATION,
INTERACTION_ANALYSIS, KNOWLEDGE (justificativa no relatório). Estratégia TMA publicada intacta (comparação com pares desligada).

### Esperado
- Números oficiais preservados (357, 400, 382). Duração das gravações nunca apresentada como TMA.
- A investigação **pergunta** se há recorte materialmente pior no mês (localização entre meses impossível) e usa ferramenta para
  responder (assunto e/ou dia). Resultado esperado pelos dados: **nenhum recorte com volume mínimo materialmente pior** (C04 é uma
  chamada isolada; dias dentro da faixa). Conclusão aceitável: reconhecimento do resultado, sem diagnóstico profundo.
- Uma terceira chamada só é analisada se um recorte material aparecer; analisar C04 sozinha como "o problema do mês" é inaceitável.
- Universo, amostra e limitações declarados (2 chamadas analisadas de 14 gravadas; julho sem base de comparação).

### Inaceitável
Número diferente do oficial; causa afirmada para o resultado; "sem desvios/transcorreram bem" a partir das chamadas analisadas;
elogio a prática não observada; recorte inventado; comparação com colegas (não habilitada nesta rodada).
