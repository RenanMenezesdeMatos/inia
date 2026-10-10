# Linha de base simples (02/10/2026) — critérios registrados ANTES das chamadas

**Pergunta.** Um modelo sozinho, com a transcrição e os procedimentos, escreve um feedback melhor do que o motor (análise → revisão →
confirmação → redação → verificação → coerência)? É o controle que faltou nas rodadas V8–V12.

**Quem escreveu.** Claude (modelo de IA). Não é validação humana. O sha256 deste arquivo vai no artefato; não é editado depois.

**Correção registrada antes.** "O que acontece com o cancelamento pendente" (C07) **não é exigido por nenhuma base**: §21 pede ações em
sistema e "informar prazo"; §46 "Serviço cancelado, quando aplicável" é serviço cancelado NA chamada; o Checklist (3) "explique o próximo
passo e o prazo" foi atendido para a contestação. Nos relatórios anteriores esse ponto foi tratado como falha do motor — erro de
avaliação meu. Aqui ele NÃO conta como acerto; se aparecer, é interpretação além da base (ressalva).

## Método (mesmo modelo do motor, `gemini-3.8-flash`)

Por cenário, no máximo 2 chamadas:
1. **Redação** — transcrição + documentos que o motor seleciona para a chamada (texto inteiro) + argumentários (texto) + um prompt curto
   de supervisor. Saída: mensagem (cartão + texto) e a lista de pontos com turnos e trecho literal da base.
2. **Verificação** — transcrição + só as seções citadas + a mensagem: cada frase sustentada ou não (inclusive execução em sistema dada
   como feita, requisito inventado, "você errou").
3. **Código, sem IA**: o trecho citado da base existe literalmente; as falas citadas existem.

Sem reescrita, sem segunda tentativa por resposta ruim (só 1 nova tentativa por JSON ilegível/erro técnico). Livro-razão próprio:
`results/baseline-simple-budget-ledger.json`, no máximo 8 requisições e US$ 0,20. Banco somente leitura; nada publicado nem gravado.

## O que conta (só a base como padrão)

### A — C07 (contestação após cancelamento)
| | Atende | Não atende |
|---|---|---|
| Ajuste ancorado na base | Jeito Vivo §19 ("quando não houver solução imediata"): faltou "orientação caso o prazo não seja cumprido" — daqui para frente | — (não achar = utilidade menor, não erro) |
| Reconhecimento | Só do que a fala mostra: titularidade (T3–T5), fatura/valor (T5) e se estava paga (T9), prazo/SMS/crédito condicional (T12), recapitulação com protocolo (T14), confirmação de entendimento (T16) | Elogio sem fala |
| Execução em sistema | Fora, ou só como "você informou que…" | "Você verificou/consultou/localizou/registrou/abriu/corrigiu" como fato |
| Alternativas (§34) | Crédito mencionado cumpre a lista | "Estorno em vez de crédito" |
| Perspectiva | Orientação para as próximas chamadas | "Você errou/descumpriu" (bases publicadas depois da chamada) |

### B — DEMO-INT-0001-08 (segunda via e transferência)
| | Atende | Não atende |
|---|---|---|
| Ajuste principal | Protocolo: número nunca dito; "já passei o contexto no protocolo" (T85) não é informar (Contestação §44 / Checklist (2) / Jeito Vivo §19) | Tratar a menção como informar; não achar (utilidade) |
| E-mail novo | Nenhuma acusação | "Enviou sem validação" ou lembrete que insinua falha |
| Fatura × parcelamento | Cumprido por paráfrase (T33) ou nada | Desvio |
| Envio por SMS | Só a conferência do recebimento (T48–T49) | Elogio de canal autorizado; acusação de número errado |
| Valores (T11 × T35) | Atenção ou nada | Dizer qual valor é o certo |
| Argumentários | Segunda via se aplica; os demais não | Cobrar argumentário que não se aplica |

### C — TMA de agosto/2026
| | Atende | Não atende |
|---|---|---|
| Números | 357 s × meta 400 s; julho 382 s | Qualquer outro número como TMA; duração de gravação apresentada como TMA |
| 04/08 | Mencionar como dia fora do padrão (378 × base 354) sem causa, ou não mencionar | Tratar como causa ou generalizar |
| Conclusão | Reconhecimento do resultado; sem diagnóstico inventado | Causa afirmada; "sem desvios"; comparação com colegas |

## Comparação
Mesmos cenários do motor: A — V12 (abstenção; rascunho não publicado) e V11 (publicada); B e C — V11 (publicadas). Dimensões:
correção (nada da coluna "não atende"), base (todo ajuste aponta uma linha real), utilidade, naturalidade. O verificador aprovar não
conta como critério.
