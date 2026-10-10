# Linha de base simples (02/10/2026) — avaliação

**Quem avaliou.** Claude (modelo de IA), contra `baseline-simple-criteria.md` (registrado antes; só a base como padrão). Não é
validação humana.

**Artefatos.** `results/baseline-simple-paid-2026-10-02T20-49-23-685Z.json` (+ `.prompts.json`) e
`results/baseline-simple-reverify-B-paid-2026-10-02T20-51-24-436Z.json`. Livro-razão `results/baseline-simple-budget-ledger.json`:
**7 requisições, US$ 0,0875** (6 da rodada + 1 reverificação da B). Mesmo modelo do motor (`gemini-3.8-flash`), mesmos 5 documentos
que o motor seleciona.

**Defeitos do harness (meus).** A checagem literal não reconhecia citação de lista em várias linhas; corrigida, a janela do trecho
ainda caía no início do documento. Resultado: as duas verificações da B receberam as seções erradas e os vereditos
"INVENTED_REQUIREMENT" da B NÃO valem. A última requisição não foi usada para refazer.

## A — C07

> **Cartão:** Você realizou um atendimento seguro, claro e resolutivo ao tratar a contestação da cliente. Para as próximas ligações,
> lembre-se apenas de mencionar a marca Vivo logo na abertura.
>
> Larissa, você conduziu muito bem o atendimento: validou a titularidade com segurança, identificou pontualmente a fatura e o valor
> contestado e confirmou se a conta já estava paga. Além disso, registrou a contestação, explicou com clareza o prazo de até cinco dias
> úteis com retorno por SMS, recapitulou todos os pontos com o número de protocolo e checou se restavam dúvidas antes de encerrar.
> Como orientação para os próximos contatos, lembre-se de incluir a identificação da Vivo na sua apresentação inicial.

| | |
|---|---|
| Ajuste | "Mencionar a Vivo" (T1 "Conecta, bom dia…") — literal na base; o motor tinha o mesmo ponto (parcial, baixa materialidade). Na massa demo a empresa da conversa é "Conecta" e a base é da Vivo: o ponto é verdadeiro pela base, mas é artefato dos dados. |
| Ajuste real da base (Jeito Vivo §19: orientação caso o prazo não seja cumprido) | **Não encontrado** — o motor também nunca encontrou |
| Erros | "registrou a contestação" (execução em sistema como fato; o verificador pegou); "recapitulou todos os pontos" e "atendimento … resolutivo" (exagero; o verificador não pegou) |

## B — DEMO-INT-0001-08

> **Cartão:** Você explicou a fatura com bastante clareza para a cliente. Nas próximas ligações, lembre-se de passar o número do
> protocolo antes de transferir e de fazer validação adicional se o e-mail for alterado no contato.
>
> Você conduziu muito bem a explicação dos lançamentos, detalhando a cobrança proporcional e os pacotes ativos de forma clara e
> paciente. Para as próximas chamadas, com a publicação dos novos procedimentos, atente-se a duas orientações: antes de efetivar uma
> transferência de setor, informe o número do protocolo diretamente para o cliente. Além disso, caso o cliente informe um novo e-mail
> durante o atendimento, realize uma validação de segurança adicional antes de direcionar a segunda via para o endereço indicado.

| | |
|---|---|
| Protocolo | **Atende** (mesmo ponto do motor na V11) |
| E-mail novo | **Não atende**: virou ajuste que insinua falha ("realize uma validação adicional"), embora a operadora diga "já verifiquei" (T43) e a validação possa ser interna — exatamente a leitura que o motor foi construído para evitar (na V11 ficou de fora; na V12, divergência → inconclusivo) |
| Reconhecimento | Explicação da fatura — atende |

## C — TMA agosto/2026

> **Cartão:** Você fechou agosto/2026 com Tempo Médio de Atendimento de 357 s, cumprindo a meta de 400 s e evoluindo em relação aos
> 382 s de julho/2026.
>
> Parabéns pelo seu desempenho em agosto/2026. Seu Tempo Médio de Atendimento oficial foi de 357 s, ficando abaixo da meta de 400 s e
> melhorando frente aos 382 s de julho/2026, somando 254086 segundos em 712 contatos. No dia 2026-08-04, houve um ponto fora com
> 377.81 s para uma baseline de 354.31 s, com 1 chamada gravada de 31 contatos medidos e nenhuma examinada. Lembre-se também de que
> os registros por assunto cobrem apenas 13 chamadas gravadas de 712 contatos, servindo só como aproximação. Mantenha o foco nesse bom
> padrão de atendimento.

| | |
|---|---|
| Números / causa | **Atende** (357 × 400, julho 382; nenhuma causa) |
| Naturalidade | **Ruim**: despeja fatos técnicos para o operador ("baseline", "ponto fora", "254086 segundos", cobertura de gravações). A mensagem do motor (V11) dizia o mesmo resultado sem isso. |

## Conclusão

A aposta de que a versão simples seria melhor **estava errada**. Ela acha os mesmos pontos principais (protocolo na B; nada material
além da marca na A) e reintroduz os erros que o motor foi feito para evitar: insinuar falha na validação do e-mail, execução em sistema
como fato, elogio exagerado, linguagem técnica no indicador. O verificador simples pegou 1 desses erros.

O que a comparação mostra de verdadeiro:
- O motor não é complexo à toa na correção; parte do "não sai bom" vinha da AVALIAÇÃO (gabarito com exigência que a base não tem — o
  cancelamento pendente) e de orçamento por rodada apertado demais para a redação (abstenção da A na V12).
- A lacuna de utilidade real e comum aos dois: a regra transversal do Jeito Vivo §19 (o que o cliente deve receber quando não há
  solução imediata) não é ligada ao caso — nem pelo motor, nem pela versão simples.
