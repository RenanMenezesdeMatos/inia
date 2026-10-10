import type { Domain } from "../indicator-catalog.js"
import { article, BRAND, cl, Honorific, op } from "./phrase-pools.js"
import type { CallContext, Outcome, ScenarioKey, Turn } from "./transcript-types.js"

type Block = (ctx: CallContext) => Turn[]

export type ScenarioSpec = {
  key: ScenarioKey
  domains: readonly Domain[]
  reasons: readonly string[]
  /** Resumo em 1ª pessoa do operador pra "confirmação de entendimento". */
  summary: (ctx: CallContext) => string
  /** Fala(s) iniciais do cliente expondo o motivo + reação do operador. */
  opening: Block
  /** Blocos de investigação/tratativa reutilizáveis (ordem preservada, quantidade variável). */
  investigation: readonly Block[]
  resolution: Record<Outcome, Block>
  /** Alternativa prevista no processo que o operador DEVERIA oferecer. */
  alternative: Block
  /** Informação DIVERGENTE do processo demo (falha auditável). */
  divergent: Block
  /** Flags booleanas que o tema sustenta, independentemente do desfecho. */
  impliedFlags: readonly string[]
}

const ack = (ctx: CallContext) => ctx.random.pick(["Tá.", "Certo.", "Entendi.", "Uhum.", "Ok."])
/** "o senhor"/"a senhora". */
const who = (ctx: CallContext): string => `${article(ctx)} senhor${ctx.customerGender === "F" ? "a" : ""}`
/** Escolha FIXA por chamada (mesmo índice em opening/summary/blocos) — evita o cliente "pedir X" e o operador "confirmar Y". */
const choice = <T>(ctx: CallContext, options: readonly T[]): T => options[ctx.variant % options.length]!

// ─────────────────────────────────────────────────────────────────── FATURAMENTO

const duvidaFatura: ScenarioSpec = {
  key: "DUVIDA_FATURA",
  domains: ["FATURAMENTO", "ATENDIMENTO"],
  reasons: ["Dúvida sobre fatura", "Fatura veio com valor maior", "Dúvida sobre cobrança proporcional", "Esclarecimento de valores na fatura"],
  summary: (ctx) => `a fatura de ${ctx.monthName} veio com valor ${ctx.extraAmount} em vez dos ${ctx.amount} de costume e ${who(ctx)} quer entender essa diferença`,
  opening: (ctx) => [
    cl(`Minha conta veio mais cara esse mês. Eu pago ${ctx.amount} e agora veio ${ctx.extraAmount}. Não entendi o que é isso.`),
    op(`Entendi, ${ctx.customerFirstName}. Vamos ver juntos o detalhamento dessa fatura.`),
  ],
  investigation: [
    (ctx) => [
      op(`Estou vendo a fatura de ${ctx.monthName} aqui. Ela tem o valor do plano ${ctx.plan} e mais um lançamento de serviço adicional.`),
      cl(`Que serviço adicional? Eu não pedi nada.`),
      op(`Consta um pacote de ${ctx.random.pick(["dados extras", "canais adicionais", "proteção do aparelho", "assinatura de streaming"])} ativado no dia ${ctx.random.int(1, 28)}.`),
    ],
    () => [
      op(`Também tem uma cobrança proporcional: como o plano mudou no meio do ciclo, o sistema cobra os dias do plano antigo e os dias do novo.`),
      cl(`Ah, então é por causa da mudança de plano?`),
      op(`Em parte sim. Essa proporcional aparece só nessa fatura, na próxima o valor volta ao normal.`),
    ],
    (ctx) => [
      cl(`E esse valor de ${ctx.random.pick(["R$ 9,90", "R$ 14,90", "R$ 19,90"])} aqui embaixo?`),
      op(`Esse é o ${ctx.random.pick(["seguro do aparelho", "pacote de SMS ilimitado", "serviço de backup na nuvem"])}. Está ativo desde ${ctx.random.pick(["março", "fevereiro", "janeiro"])}.`),
      cl(`Eu não lembro de ter aceitado isso.`),
    ],
    (ctx) => [
      op(`Vou detalhar linha a linha pra ${who(ctx)}: plano, ${ctx.random.pick(["R$ 89,90", "R$ 119,90", "R$ 149,90"])}; serviço adicional, ${ctx.random.pick(["R$ 24,90", "R$ 29,90"])}; e a diferença proporcional.`),
      cl(`${ack(ctx)} Agora fez mais sentido.`),
    ],
    (ctx) => [
      cl(`E quando vence essa conta?`),
      op(`Vence no dia ${ctx.dueDay}. Se ${who(ctx)} quiser, posso enviar o código de barras por SMS.`),
      cl(`Pode mandar.`),
    ],
  ],
  resolution: {
    RESOLVIDO: (ctx) => [
      op(`Então ficou assim: o serviço adicional eu já cancelei agora e o valor proporcional foi só nesta fatura. A partir de ${ctx.random.pick(["outubro", "do próximo ciclo"])} a conta volta pra ${ctx.amount}.`),
      cl(`Perfeito. E o que já foi cobrado desse serviço?`),
      op(`Vou lançar o estorno de ${ctx.random.pick(["R$ 24,90", "R$ 29,90", "R$ 49,80"])} como crédito na próxima fatura. Fica registrado no protocolo.`),
      cl(`Ótimo, obrigada.`),
    ],
    PARCIAL: () => [
      op(`O serviço adicional eu consigo cancelar agora. O estorno do que já foi cobrado depende de análise, que leva até 5 dias úteis.`),
      cl(`Tá, mas eu vou ter que pagar a conta inteira enquanto isso?`),
      op(`A recomendação é pagar o valor integral pra não gerar juros; o crédito vem na fatura seguinte se a análise for favorável.`),
      cl(`Hum. Tá bom então.`),
    ],
    TRANSFERIDO: (ctx) => [
      op(`Esse tipo de ajuste é feito pelo setor de faturamento. Vou transferir ${who(ctx)} agora, já passei o contexto no protocolo.`),
      cl(`Tá, mas não vai me deixar esperando muito, né?`),
      op(`Vou tentar ser o mais rápido possível. Um momento.`),
    ],
    RETORNO_PROMETIDO: (ctx) => [
      op(`Vou abrir uma solicitação de análise da fatura. O retorno vem por ${ctx.random.pick(["SMS", "e-mail", "ligação"])} em até 5 dias úteis.`),
      cl(`E se não vier?`),
      op(`Se não vier, é só ligar informando o protocolo ${ctx.protocol} que a gente reabre.`),
    ],
    NAO_RESOLVIDO: (ctx) => [
      op(`Pelo que consta aqui, a cobrança está correta conforme o contrato, ${ctx.customerFirstName}. Não tenho como estornar.`),
      cl(`Mas eu não pedi esse serviço!`),
      op(`Eu entendo, mas o sistema registra a ativação. O que posso fazer é cancelar pra não cobrar mais.`),
    ],
  },
  alternative: (ctx) => [
    op(`Uma alternativa: ${who(ctx)} pode acompanhar o detalhamento no aplicativo da ${BRAND}, em "Minhas faturas", e ativar o alerta de novos serviços pra nunca mais ser surpreendid${ctx.customerGender === "F" ? "a" : "o"}.`),
    cl(`Boa, vou ativar.`),
  ],
  divergent: () => [
    cl(`E esse estorno cai quando?`),
    op(`O estorno é sempre depositado na conta bancária em 24 horas.`),
    cl(`Ah, tá bom então.`),
  ],
  impliedFlags: [],
}

const contestacaoCobranca: ScenarioSpec = {
  key: "CONTESTACAO_COBRANCA",
  domains: ["FATURAMENTO", "ATENDIMENTO"],
  reasons: ["Contestação de cobrança", "Contestação de cobrança duplicada", "Cobrança de serviço não reconhecido", "Contestação de cobrança após cancelamento"],
  summary: (ctx) => `${who(ctx)} não reconhece a cobrança de ${ctx.extraAmount} na fatura de ${ctx.monthName} e quer contestar`,
  opening: (ctx) => [
    cl(`Eu quero contestar uma cobrança. Veio ${ctx.extraAmount} na minha fatura e eu não reconheço esse valor.`),
    op(`Certo, ${ctx.customerFirstName}. Vou abrir a fatura pra a gente ver do que se trata.`),
  ],
  investigation: [
    (ctx) => [
      op(`Estou vendo um lançamento de ${ctx.extraAmount} descrito como "${ctx.random.pick(["serviço digital", "assinatura parceira", "multa por quebra de fidelidade", "aparelho em parcelas"])}".`),
      cl(`Eu nunca contratei isso. Nunca.`),
      op(`Entendo. Vou verificar a origem dessa ativação: se foi pelo aplicativo, pela URA ou por um atendimento.`),
    ],
    (ctx) => [
      op(`Aqui consta que a ativação foi feita no dia ${ctx.random.int(1, 28)} de ${ctx.monthName}, pelo ${ctx.random.pick(["aplicativo", "site", "SMS de confirmação"])}.`),
      cl(`Não fui eu. Tem alguém usando meus dados?`),
      op(`Não necessariamente. Às vezes um clique num anúncio dentro do app já ativa. Mas vou registrar como não reconhecido.`),
    ],
    (ctx) => [
      cl(`Isso já veio duas vezes, esse mês e o passado.`),
      op(`Deixa eu conferir a fatura anterior... Sim, tem o mesmo lançamento. Vou incluir os dois meses na contestação.`),
      cl(`${ack(ctx)}`),
    ],
    (ctx) => [
      op(`Pra formalizar a contestação eu preciso registrar: valor contestado, motivo e as faturas envolvidas. O valor total é ${ctx.random.pick(["R$ 59,80", "R$ 79,80", "R$ 99,80"])}.`),
      cl(`Isso.`),
      op(`Contestação registrada sob o protocolo ${ctx.protocol}.`),
    ],
    (ctx) => [
      cl(`E enquanto isso eu pago a conta ou não?`),
      op(`A orientação é pagar o valor não contestado. Posso gerar uma fatura só com o valor do plano, ${ctx.amount}, pra ${who(ctx)} pagar sem juros.`),
      cl(`Ah, isso é bom. Pode gerar.`),
    ],
  ],
  resolution: {
    RESOLVIDO: (ctx) => [
      op(`Pronto: a cobrança foi reconhecida como indevida, o serviço está cancelado e o estorno de ${ctx.extraAmount} entra como crédito na próxima fatura.`),
      cl(`Que alívio. Obrigada.`),
      op(`Também gerei a fatura ajustada com vencimento no dia ${ctx.dueDay}, sem juros.`),
    ],
    PARCIAL: () => [
      op(`O serviço está cancelado a partir de hoje. A contestação dos valores já cobrados foi encaminhada pra análise, prazo de até 7 dias úteis.`),
      cl(`E eu vou saber o resultado como?`),
      op(`Por SMS no número cadastrado.`),
    ],
    TRANSFERIDO: (ctx) => [
      op(`Contestação acima de ${ctx.random.pick(["R$ 50,00", "R$ 100,00"])} é tratada pela equipe especializada. Vou transferir com o protocolo já aberto.`),
      cl(`Tá bom.`),
    ],
    RETORNO_PROMETIDO: () => [
      op(`Registrei a contestação. A área de faturamento entra em contato em até 5 dias úteis com a resposta.`),
      cl(`Tá, vou aguardar então.`),
    ],
    NAO_RESOLVIDO: (ctx) => [
      op(`A análise anterior já indeferiu essa contestação, ${ctx.customerFirstName}. Não consigo reabrir pelo mesmo motivo.`),
      cl(`Então eu vou ficar pagando uma coisa que não usei?`),
      op(`O que posso fazer é registrar uma reclamação formal e cancelar o serviço pra não haver novas cobranças.`),
    ],
  },
  alternative: (ctx) => [
    op(`Enquanto a análise roda, ${who(ctx)} pode bloquear a contratação de serviços adicionais no app, em "Segurança da conta". Assim nada novo é ativado sem senha.`),
    cl(`Não sabia disso. Vou fazer.`),
  ],
  divergent: () => [
    cl(`Eu preciso pagar a conta inteira mesmo assim?`),
    op(`Precisa sim, senão o nome vai pra negativação em 3 dias. Depois a gente devolve.`),
    cl(`Ai, tá bom.`),
  ],
  impliedFlags: ["contestacao"],
}

const segundaVia: ScenarioSpec = {
  key: "SEGUNDA_VIA",
  domains: ["FATURAMENTO", "ATENDIMENTO"],
  reasons: ["Segunda via de fatura", "Segunda via de conta com falha no aplicativo", "Fatura não recebida por e-mail"],
  summary: (ctx) => `${who(ctx)} precisa da segunda via da fatura de ${ctx.monthName} porque não recebeu`,
  opening: (ctx) => [
    cl(`Eu preciso da segunda via da minha conta. Não chegou ${ctx.random.pick(["no e-mail", "aqui em casa", "no aplicativo"])} esse mês.`),
    op(`Sem problema, ${ctx.customerFirstName}. Vou gerar agora mesmo.`),
  ],
  investigation: [
    (ctx) => [
      op(`A fatura de ${ctx.monthName} está no valor de ${ctx.amount}, vencimento dia ${ctx.dueDay}. Ainda está em aberto.`),
      cl(`Isso. Pode mandar por SMS?`),
    ],
    (ctx) => [
      op(`Estou vendo que o e-mail cadastrado é o ${ctx.customerFirstName.toLowerCase()}${ctx.random.int(10, 99)}@${ctx.random.pick(["gmail.com", "hotmail.com"])}. É esse ainda?`),
      cl(`Não, esse eu não uso mais. Por isso não chega.`),
      op(`Entendi, então vou atualizar o e-mail e reenviar.`),
      cl(`O novo é ${ctx.customerFirstName.toLowerCase()}.${ctx.customerSurname.toLowerCase()}@${ctx.random.pick(["gmail.com", "outlook.com"])}.`),
    ],
    (ctx) => [
      cl(`Eu tentei pelo app mas dava erro na hora de abrir a fatura.`),
      op(`Qual era a mensagem?`),
      cl(`Alguma coisa de "serviço indisponível".`),
      op(`Tivemos uma instabilidade no app ${ctx.random.pick(["ontem", "hoje de manhã"])}. Já está normalizando, mas eu envio por aqui mesmo.`),
    ],
    (ctx) => [
      op(`Enviei o código de barras por SMS pro número final ${ctx.random.int(1000, 9999)}. Chegou?`),
      cl(`Deixa eu ver... chegou sim.`),
    ],
  ],
  resolution: {
    RESOLVIDO: (ctx) => [
      op(`Perfeito. Então a fatura de ${ctx.monthName}, ${ctx.amount}, está com ${who(ctx)} por SMS e também reenviei pro e-mail atualizado.`),
      cl(`Ótimo, obrigada.`),
    ],
    PARCIAL: (ctx) => [
      op(`O SMS foi enviado. O e-mail, por conta da instabilidade, pode levar até 24 horas pra chegar.`),
      cl(`${ack(ctx)}`),
    ],
    TRANSFERIDO: () => [
      op(`Pra atualizar o e-mail cadastral eu preciso passar pra área de cadastro. Vou transferir.`),
      cl(`Só pra trocar e-mail? Tá bom...`),
    ],
    RETORNO_PROMETIDO: () => [
      op(`O sistema de envio está fora agora. Vou deixar programado e a fatura chega em até 2 horas.`),
      cl(`Tá, vou ficar de olho.`),
    ],
    NAO_RESOLVIDO: () => [
      op(`O sistema de faturas está fora do ar no momento. Não consigo gerar agora.`),
      cl(`E como eu pago, então? Vence hoje.`),
      op(`Tenta de novo pelo app mais tarde.`),
    ],
  },
  alternative: (ctx) => [
    op(`Fica a dica: ${who(ctx)} também consegue a segunda via pelo WhatsApp da ${BRAND} ou pelo site, sem precisar ligar.`),
    cl(`Boa, não sabia do WhatsApp.`),
  ],
  divergent: () => [
    cl(`Dá pra pegar a segunda via em algum outro lugar?`),
    op(`Só pela central mesmo, ou indo numa loja física.`),
    cl(`Ah, tá.`),
  ],
  impliedFlags: [],
}

const alteracaoVencimento: ScenarioSpec = {
  key: "ALTERACAO_VENCIMENTO",
  domains: ["FATURAMENTO", "ATENDIMENTO"],
  reasons: ["Alteração de data de vencimento", "Mudança do dia de vencimento da fatura"],
  summary: (ctx) => `${who(ctx)} quer mudar o vencimento do dia ${ctx.dueDay} pro dia ${ctx.random.pick([5, 10, 15, 20])}`,
  opening: (ctx) => [
    cl(`Eu queria mudar o dia de vencimento da minha conta. Hoje vence dia ${ctx.dueDay} e eu recebo depois disso.`),
    op(`Claro, ${ctx.customerFirstName}. Temos algumas datas disponíveis: 5, 10, 15, 20 e 25.`),
  ],
  investigation: [
    () => [cl(`Pode ser dia 10.`), op(`Certo. Só um aviso importante: na virada, a primeira fatura vem proporcional, cobrando os dias entre o vencimento antigo e o novo.`), cl(`Quer dizer que vai vir maior?`), op(`Uma única vez, sim. Depois normaliza.`)],
    (ctx) => [op(`Confirmando: não há fatura em atraso no contrato, então a alteração pode ser feita agora.`), cl(`${ack(ctx)}`)],
    () => [cl(`E essa mudança já vale pra conta desse mês?`), op(`Não, vale a partir do próximo ciclo. A fatura atual mantém a data original.`)],
  ],
  resolution: {
    RESOLVIDO: () => [op(`Alteração feita. O novo vencimento é dia 10, válido a partir do próximo ciclo. Anotei tudo no protocolo.`), cl(`Perfeito, obrigado.`)],
    PARCIAL: () => [op(`Fiz a solicitação, mas a efetivação depende da fatura atual ser paga. Assim que constar o pagamento, muda automaticamente.`), cl(`Tá bom.`)],
    TRANSFERIDO: () => [op(`Vou passar pra área de faturamento fazer a alteração.`), cl(`Ok.`)],
    RETORNO_PROMETIDO: () => [op(`A alteração fica agendada e a confirmação chega por SMS em até 48 horas.`), cl(`Tá.`)],
    NAO_RESOLVIDO: () => [op(`Com fatura em atraso o sistema não permite mudar o vencimento.`), cl(`Mas eu vou pagar amanhã.`), op(`Então liga depois de pagar que a gente faz.`)],
  },
  alternative: () => [op(`Só lembrando que também dá pra fazer essa alteração direto no aplicativo, em "Minha conta", sem precisar ligar.`), cl(`Ah, bom saber.`)],
  divergent: () => [cl(`E vem proporcional?`), op(`Não, não muda nada no valor, fica tudo igual.`), cl(`Ótimo.`)],
  impliedFlags: [],
}

const negociacaoDebito: ScenarioSpec = {
  key: "NEGOCIACAO_DEBITO",
  domains: ["FATURAMENTO", "RETENCAO"],
  reasons: ["Negociação de débito", "Negociação de contas em atraso", "Parcelamento de faturas vencidas"],
  summary: (ctx) => `${who(ctx)} tem ${ctx.random.pick(["duas", "três"])} faturas em atraso e quer negociar pra regularizar`,
  opening: (ctx) => [
    cl(`Eu estou com umas contas atrasadas e queria ver como fazer pra negociar. ${ctx.random.pick(["Perdi o emprego", "Tive um problema de saúde na família", "Apertou aqui em casa"])} e não consegui pagar.`),
    op(`Entendo, ${ctx.customerFirstName}. Vamos ver as opções. Só um instante que estou puxando o extrato.`),
  ],
  investigation: [
    (ctx) => [op(`Constam ${ctx.random.pick(["duas", "três"])} faturas em aberto, total de ${ctx.random.pick(["R$ 287,40", "R$ 412,70", "R$ 356,10"])} com juros e multa.`), cl(`Nossa, com juros ficou pesado.`)],
    (ctx) => [op(`Temos duas opções: pagamento à vista com ${ctx.random.pick(["20%", "30%"])} de desconto nos encargos, ou parcelamento em até ${ctx.random.pick(["6", "10"])} vezes na fatura.`), cl(`Parcelado fica quanto?`), op(`Em 6 vezes ficaria em torno de ${ctx.random.pick(["R$ 52,00", "R$ 71,00", "R$ 63,00"])} por mês, somado ao valor do plano.`)],
    () => [cl(`E se eu parcelar, a linha volta a funcionar na hora?`), op(`O desbloqueio acontece em até 4 horas após o pagamento da primeira parcela.`), cl(`Entendi.`)],
    (ctx) => [op(`Confirma pra mim: ${who(ctx)} prefere o acordo em 6 parcelas?`), cl(`Prefiro, sim.`)],
  ],
  resolution: {
    RESOLVIDO: (ctx) => [op(`Acordo registrado: 6 parcelas, primeira vence dia ${ctx.dueDay}. Enviei o código por SMS. Pagando a primeira, a linha é liberada.`), cl(`Muito obrigada, viu. Aliviou.`)],
    PARCIAL: () => [op(`O acordo ficou pré-registrado. Ele só é confirmado quando a primeira parcela for paga, até o vencimento.`), cl(`Tá bom.`)],
    TRANSFERIDO: () => [op(`Acima de duas faturas em atraso a negociação é feita pela equipe de cobrança. Vou transferir.`), cl(`Tá.`)],
    RETORNO_PROMETIDO: () => [op(`Vou registrar o pedido de negociação e a equipe de cobrança retorna em até 2 dias úteis com a proposta.`), cl(`Tá, mas a linha continua bloqueada?`), op(`Até a negociação, sim.`)],
    NAO_RESOLVIDO: () => [op(`O sistema não está permitindo parcelamento pra esse contrato, só pagamento à vista.`), cl(`À vista eu não consigo.`), op(`Então não tenho outra opção pra oferecer no momento.`)],
  },
  alternative: () => [op(`Se preferir, dá pra fazer essa negociação pelo aplicativo também, na aba "Negociar", com as mesmas condições e sem precisar ligar.`), cl(`Bom saber.`)],
  divergent: () => [cl(`E a linha volta quando?`), op(`Volta na hora que eu registrar o acordo, nem precisa pagar a parcela.`), cl(`Ótimo.`)],
  impliedFlags: [],
}

// ─────────────────────────────────────────────────────────────────── SUPORTE

const suporteLentidao: ScenarioSpec = {
  key: "SUPORTE_LENTIDAO",
  domains: ["SUPORTE", "ATENDIMENTO"],
  reasons: ["Internet fixa com lentidão", "Lentidão no Wi-Fi", "Banda larga lenta em horário de pico"],
  summary: (ctx) => `a internet está lenta, principalmente ${choice(ctx, ["à noite", "no fim de semana", "no horário comercial"])}, e ${who(ctx)} quer que a gente verifique`,
  opening: (ctx) => [
    cl(`Minha internet está muito lenta, principalmente ${choice(ctx, ["à noite", "no fim de semana", "no horário comercial"])}. Eu pago ${ctx.plan} e não chega nem perto disso. Vídeo trava, reunião cai.`),
    op(`Entendi, ${ctx.customerFirstName}. Vou verificar o sinal daqui e a gente faz alguns testes.`),
  ],
  investigation: [
    (ctx) => [op(`Estou vendo o modem online, sinal óptico ${ctx.random.pick(["dentro do esperado", "um pouco abaixo do ideal"])}. Quantos aparelhos estão conectados agora?`), cl(`Uns ${ctx.random.int(4, 12)}, entre celular, TV e notebook.`)],
    (ctx) => [op(`O teste de velocidade que ${who(ctx)} fez foi no cabo ou no Wi-Fi?`), cl(`No Wi-Fi, no celular.`), op(`Consegue fazer um teste conectando um computador direto no cabo? Assim a gente separa se é o link ou o Wi-Fi.`), cl(`Consigo, só um minuto.`)],
    (ctx) => [cl(`No cabo deu ${ctx.random.int(180, 480)} mega.`), op(`Então o link está entregando. A lentidão está no Wi-Fi mesmo.`), cl(`E como eu resolvo isso?`)],
    (ctx) => [op(`Vou mudar o canal do Wi-Fi remotamente, o canal ${ctx.random.pick(["6", "11", "1"])} está congestionado com as redes dos vizinhos. Aguarda 30 segundos que o modem reinicia.`), cl(`Tá.`), op(`Pronto. Testa de novo, por favor.`), cl(`Melhorou bastante. Deu ${ctx.random.int(120, 300)} mega agora no celular.`)],
    () => [op(`Onde fica o modem na casa?`), cl(`Dentro de um armário, no quarto do fundo.`), op(`Isso prejudica muito. O ideal é deixar em lugar aberto e central.`)],
    () => [op(`Vou também rodar um diagnóstico completo na linha. Leva uns 2 minutos.`), cl(`Tá bom.`), op(`Diagnóstico ok, sem perda de pacote na rede.`)],
  ],
  resolution: {
    RESOLVIDO: () => [op(`Então ficou: canal do Wi-Fi ajustado, velocidade normalizada. Se voltar a ficar lento, o recomendado é reposicionar o modem.`), cl(`Show. Resolveu aqui.`)],
    PARCIAL: () => [op(`Melhorou no teste, mas o sinal óptico está no limite. Vou deixar o link em monitoramento por 48 horas.`), cl(`E se piorar?`), op(`Se piorar, liga que já agendamos visita técnica.`)],
    TRANSFERIDO: () => [op(`Como o problema é no link, vou transferir pro suporte de nível 2.`), cl(`Tá.`)],
    RETORNO_PROMETIDO: (ctx) => [op(`Vou agendar uma visita técnica pra ${ctx.random.pick(["amanhã", "quinta-feira", "sexta-feira"])}, período da ${ctx.random.pick(["manhã", "tarde"])}. O técnico liga antes de ir.`), cl(`Tá bom, vou estar em casa.`)],
    NAO_RESOLVIDO: () => [op(`Pelo sistema o sinal está normal. Não vejo nada pra corrigir daqui.`), cl(`Mas a lentidão é real.`), op(`Pode ser o aparelho, então. Sugiro testar em outro.`)],
  },
  alternative: () => [op(`Se o Wi-Fi precisar chegar mais longe, existe o repetidor da ${BRAND} por um valor mensal pequeno, ou posso agendar um técnico pra avaliar o posicionamento.`), cl(`Vou pensar no repetidor.`)],
  divergent: () => [cl(`Vocês trocam o modem?`), op(`Não, a troca é sempre cobrada e tem que comprar na loja.`), cl(`Hum.`)],
  impliedFlags: [],
}

const suporteQuedaConexao: ScenarioSpec = {
  key: "SUPORTE_QUEDA_CONEXAO",
  domains: ["SUPORTE"],
  reasons: ["Queda de conexão recorrente", "Banda larga sem conexão", "Internet caindo várias vezes ao dia", "Reparo de banda larga"],
  summary: (ctx) => `a internet cai e volta ${choice(ctx, ["desde ontem", "desde a chuva de sábado", "faz uma semana"])} e ${who(ctx)} precisa de reparo`,
  opening: (ctx) => [
    cl(`A minha internet está caindo direto. ${choice(ctx, ["Desde ontem", "Desde a chuva de sábado", "Faz uma semana"])} que cai e volta a toda hora.`),
    op(`Sinto muito, ${ctx.customerFirstName}. Vou verificar o status do equipamento aqui.`),
  ],
  investigation: [
    (ctx) => [op(`O modem está ${ctx.random.pick(["online, mas com histórico de 14 quedas nas últimas 24 horas", "com sinal óptico fraco, abaixo do mínimo", "reiniciando sozinho de tempos em tempos"])}.`), cl(`Então é aí no sistema de vocês mesmo?`)],
    (ctx) => [op(`Como está a luz do modem agora? Verde fixa, vermelha ou piscando?`), cl(`${ctx.random.pick(["Está vermelha", "Fica piscando verde", "A LOS está acesa"])}.`), op(`Isso indica ${ctx.random.pick(["falha no sinal óptico", "instabilidade na fibra", "perda de sinal na entrada da casa"])}.`)],
    () => [op(`Pode desligar o modem da tomada, esperar 30 segundos e ligar de novo?`), cl(`Tá, já fiz isso três vezes hoje.`), op(`Entendo, mas preciso fazer o teste com o equipamento reiniciado agora pra medir o sinal.`), cl(`Tá bom... pronto, liguei.`)],
    () => [op(`Medindo... o sinal continua abaixo do mínimo. Isso não se resolve daqui, precisa de visita técnica.`), cl(`Então marca logo, por favor.`)],
    (ctx) => [op(`Confirma o endereço pra visita: rua das Palmeiras, em ${ctx.city}?`), cl(`Isso. Tem interfone.`), op(`Anotado.`)],
    () => [cl(`Eu trabalho de casa, isso está me prejudicando muito.`), op(`Eu entendo. Vou marcar como prioridade no chamado.`)],
  ],
  resolution: {
    RESOLVIDO: () => [op(`Consegui restabelecer o sinal remotamente e o modem está estável há 5 minutos. Vou deixar em observação, mas está normalizado.`), cl(`Beleza, obrigado.`)],
    PARCIAL: () => [op(`A conexão voltou, mas o sinal continua no limite. Já deixei a visita técnica agendada por precaução.`), cl(`Melhor assim mesmo.`)],
    TRANSFERIDO: () => [op(`Vou transferir pro suporte técnico avançado pra eles fazerem a medição da fibra.`), cl(`Tá bom.`)],
    RETORNO_PROMETIDO: (ctx) => [op(`Visita agendada pra ${ctx.random.pick(["amanhã", "quinta-feira", "sexta-feira"])}, das ${ctx.random.pick(["8h às 12h", "13h às 18h"])}. O técnico entra em contato antes.`), cl(`Tá, obrigada.`)],
    NAO_RESOLVIDO: () => [op(`Não tem agenda de técnico pra essa semana na sua região.`), cl(`Como assim? Eu fico sem internet uma semana?`), op(`É o que o sistema mostra.`)],
  },
  alternative: (ctx) => [op(`Enquanto o técnico não vai, posso liberar um pacote de dados extra no celular do titular sem custo, pra ${who(ctx)} não ficar sem conexão.`), cl(`Ah, isso ajuda. Pode liberar.`)],
  divergent: () => [cl(`E se o técnico não aparecer?`), op(`Ele sempre aparece, não tem como não aparecer. Não precisa se preocupar.`), cl(`Tá.`)],
  impliedFlags: [],
}

const suporteSemSinal: ScenarioSpec = {
  key: "SUPORTE_SEM_SINAL",
  domains: ["SUPORTE", "ATENDIMENTO"],
  reasons: ["Internet móvel sem funcionamento", "Linha sem sinal", "Chip sem registro na rede"],
  summary: (ctx) => `o celular está sem sinal desde ${choice(ctx, ["hoje de manhã", "ontem", "a troca de chip"])} e ${who(ctx)} quer restabelecer`,
  opening: (ctx) => [
    cl(`Meu celular está sem sinal desde ${choice(ctx, ["hoje de manhã", "ontem", "que troquei o chip"])}. Aparece "sem serviço" e não faço nem recebo ligação.`),
    op(`Vamos verificar, ${ctx.customerFirstName}. A linha está ativa no sistema, sem bloqueio. Vou fazer alguns testes.`),
  ],
  investigation: [
    () => [op(`Pode colocar o celular em modo avião por 10 segundos e tirar?`), cl(`Tá... pronto. Continua sem serviço.`)],
    () => [op(`Tenta ir em configurações, redes móveis, e selecionar a rede manualmente.`), cl(`Deixa eu ver... apareceu aqui, selecionei. Ainda nada.`)],
    (ctx) => [op(`Vou reenviar a configuração da rede pro chip. Aguarda 2 minutinhos.`), cl(`${ack(ctx)}`), op(`Pronto. Reinicia o aparelho, por favor.`), cl(`Tá reiniciando... voltou! Apareceu o sinal.`)],
    () => [cl(`Isso já aconteceu semana passada também.`), op(`Se repetir, pode ser o chip. Aí a troca é gratuita na loja ou pelo correio.`)],
  ],
  resolution: {
    RESOLVIDO: () => [op(`Ótimo, linha registrada na rede e funcionando. Faz uma ligação de teste depois pra confirmar.`), cl(`Vou fazer. Obrigado!`)],
    PARCIAL: () => [op(`Voltou a ligação, mas os dados ainda estão sem registro. Isso normaliza em até 4 horas após a reconfiguração.`), cl(`Tá bom.`)],
    TRANSFERIDO: () => [op(`Como o chip não registra nem manualmente, vou passar pro suporte técnico de rede.`), cl(`Ok.`)],
    RETORNO_PROMETIDO: () => [op(`Vou abrir um chamado técnico na antena da sua região. Prazo de 24 horas pra normalização.`), cl(`Tá.`)],
    NAO_RESOLVIDO: () => [op(`Não estou conseguindo identificar a causa daqui.`), cl(`E aí?`), op(`Sugiro levar o aparelho numa assistência.`)],
  },
  alternative: (ctx) => [op(`Se precisar, posso enviar um chip novo pelo correio sem custo, chega em até 5 dias úteis, ou ${who(ctx)} retira na loja mais próxima na hora.`), cl(`Na loja é melhor.`)],
  divergent: () => [cl(`A troca de chip é de graça?`), op(`Não, a troca sempre custa R$ 30,00, em qualquer situação.`), cl(`Poxa.`)],
  impliedFlags: [],
}

const suporteApp: ScenarioSpec = {
  key: "SUPORTE_APP",
  domains: ["SUPORTE", "ATENDIMENTO"],
  reasons: ["Aplicativo não abre", "Dificuldade de acesso ao aplicativo", "Erro ao acessar a área do cliente"],
  summary: (ctx) => `${who(ctx)} não consegue acessar o aplicativo da ${BRAND} pra ver a fatura`,
  opening: () => [cl(`O aplicativo de vocês não abre. Fica na tela de carregando e fecha.`), op(`Vamos resolver isso. Qual o modelo do celular?`)],
  investigation: [
    (ctx) => [cl(`É um ${ctx.random.pick(["Samsung", "Motorola", "iPhone", "Xiaomi"])}.`), op(`E a versão do aplicativo está atualizada? Dá pra ver na loja de aplicativos.`), cl(`Tinha atualização pendente. Estou atualizando.`)],
    () => [op(`Depois de atualizar, tenta abrir de novo.`), cl(`Abriu, mas pede senha e eu não lembro.`), op(`Sem problema. Toca em "Esqueci minha senha" que chega um código por SMS.`), cl(`Chegou. Pronto, entrei.`)],
    () => [cl(`E por que dava aquele erro?`), op(`Versões antigas perderam suporte na última atualização do servidor.`)],
  ],
  resolution: {
    RESOLVIDO: () => [op(`Perfeito, acesso restabelecido. A fatura fica em "Minhas faturas", na tela inicial.`), cl(`Achei aqui. Valeu.`)],
    PARCIAL: () => [op(`O acesso voltou, mas o erro na tela de faturas é uma instabilidade nossa de hoje. Deve normalizar em algumas horas.`), cl(`Tá.`)],
    TRANSFERIDO: () => [op(`Como o erro persiste, vou passar pro suporte do aplicativo.`), cl(`Ok.`)],
    RETORNO_PROMETIDO: () => [op(`Vou registrar o erro pro time do aplicativo. Retorno por e-mail em até 3 dias úteis.`), cl(`Tá bom.`)],
    NAO_RESOLVIDO: () => [op(`Não consigo resolver problema de aplicativo por aqui.`), cl(`E quem resolve?`), op(`Tenta reinstalar.`)],
  },
  alternative: () => [op(`Enquanto isso, o site da ${BRAND} tem tudo que o app tem, com o mesmo login. E a fatura eu posso enviar por SMS agora se quiser.`), cl(`Manda por SMS, por favor.`)],
  divergent: () => [cl(`Dá pra ver a fatura pelo site?`), op(`Não, só pelo aplicativo mesmo.`), cl(`Hum.`)],
  impliedFlags: [],
}

// ─────────────────────────────────────────────────────────────────── RETENÇÃO

const cancelamento: ScenarioSpec = {
  key: "CANCELAMENTO",
  domains: ["RETENCAO"],
  reasons: ["Cancelamento de internet por mudança de endereço", "Pedido de cancelamento de linha", "Cancelamento por falhas recorrentes", "Cancelamento por dificuldade financeira"],
  summary: (ctx) => `${who(ctx)} quer cancelar o ${ctx.plan} por ${choice(ctx, ["mudança de endereço", "falhas recorrentes", "questão financeira", "preço da concorrência"])}`,
  opening: (ctx) => [
    cl(`Eu quero cancelar o meu plano. ${choice(ctx, ["Vou mudar de cidade e lá não tem cobertura", "Não aguento mais a internet caindo", "Não estou conseguindo pagar", "Achei um plano mais barato na concorrência"])}.`),
    op(`Entendo, ${ctx.customerFirstName}. Antes de registrar, posso entender um pouco melhor o motivo?`),
  ],
  investigation: [
    (ctx) => [cl(`${choice(ctx, ["Eu já expliquei, vou me mudar.", "A internet cai toda semana, já vieram três técnicos.", "Está caro demais pra mim agora.", "A concorrente está oferecendo por metade do preço."])}`), op(`Certo. Estou vendo aqui que o contrato tem fidelidade até ${ctx.random.pick(["novembro", "dezembro", "março do ano que vem"])}.`), cl(`E isso quer dizer que tem multa?`)],
    (ctx) => [op(`Teria uma multa proporcional de ${ctx.random.pick(["R$ 187,00", "R$ 240,00", "R$ 96,00"])}. Mas no caso de ${ctx.random.pick(["mudança pra endereço sem cobertura", "falha técnica comprovada"])}, a multa é isenta.`), cl(`Ah, então nesse caso não pago?`), op(`Não paga, desde que a gente comprove no sistema.`)],
    (ctx) => [op(`Deixa eu consultar a cobertura no novo endereço. Qual o CEP?`), cl(`${ctx.random.int(10000, 99999)}-${ctx.random.int(100, 999)}.`), op(`Consultando... ${ctx.random.pick(["não temos cobertura de fibra nesse endereço mesmo", "temos cobertura nesse endereço, com o mesmo plano"])}.`)],
    (ctx) => [op(`Antes de cancelar, tenho uma condição: ${ctx.random.pick(["o mesmo plano por R$ 79,90 durante 12 meses", "upgrade pra 500 mega mantendo o valor atual", "isenção das próximas duas mensalidades"])}. Faria diferença?`), cl(`${ctx.random.pick(["Hum, faz sim. Deixa eu pensar.", "Não, eu já decidi.", "Isso sem fidelidade nova?"])}`)],
    () => [op(`O cancelamento leva 24 horas pra ser processado e a fatura final vem proporcional aos dias usados.`), cl(`Tá certo.`)],
    () => [cl(`E o modem? Eu devolvo como?`), op(`A gente agenda a retirada em até 7 dias, sem custo. Ou o senhor entrega numa loja.`)],
  ],
  resolution: {
    RESOLVIDO: (ctx) => [op(`Então ficou: cancelamento registrado sob o protocolo ${ctx.protocol}, sem multa, retirada do equipamento agendada e fatura final proporcional em até 10 dias.`), cl(`Perfeito, obrigada pela clareza.`)],
    PARCIAL: () => [op(`Registrei o pedido. A isenção da multa depende de análise técnica, prazo de 5 dias úteis. Até lá o cancelamento fica pendente.`), cl(`Tá, vou esperar.`)],
    TRANSFERIDO: () => [op(`Cancelamento com fidelidade é tratado pela equipe de retenção. Vou transferir agora.`), cl(`Mais uma transferência...`)],
    RETORNO_PROMETIDO: () => [op(`A equipe de retenção vai retornar em até 24 horas com uma proposta final antes de efetivar.`), cl(`Tá, mas se não retornar eu cancelo.`), op(`Combinado.`)],
    NAO_RESOLVIDO: () => [op(`Não consigo isentar a multa nesse caso. Cancelando hoje, a multa vem na fatura final.`), cl(`Isso é um absurdo, a culpa é de vocês.`), op(`Eu entendo, mas é o que o contrato prevê.`)],
  },
  alternative: () => [op(`Uma alternativa prevista: em vez de cancelar, dá pra suspender o contrato por até 120 dias sem cobrança, e reativar quando quiser.`), cl(`Não sabia disso. Interessante.`)],
  divergent: () => [cl(`E a multa?`), op(`Cancelamento nunca tem multa aqui na ${BRAND}, pode ficar tranquilo.`), cl(`Ah, ótimo.`)],
  impliedFlags: ["cancelamento"],
}

const retencaoOferta: ScenarioSpec = {
  key: "RETENCAO_OFERTA",
  domains: ["RETENCAO"],
  reasons: ["Retenção após pedido de cancelamento", "Cliente ameaça cancelar por preço", "Proposta de retenção"],
  summary: (ctx) => `${who(ctx)} está pensando em cancelar porque ${choice(ctx, ["a concorrência ofereceu mais barato", "o valor subiu", "não usa tudo que paga"])} e quer saber se tem condição melhor`,
  opening: (ctx) => [
    cl(`Olha, eu estou quase cancelando. ${choice(ctx, ["A concorrente me ofereceu 500 mega por R$ 89,90", "Meu plano subiu pra " + ctx.extraAmount, "Eu pago " + ctx.amount + " e uso muito pouco"])}. Vocês têm alguma coisa pra me oferecer?`),
    op(`Vamos ver o que consigo, ${ctx.customerFirstName}. Primeiro deixa eu olhar o histórico do contrato.`),
  ],
  investigation: [
    (ctx) => [op(`${Honorific(ctx)} ${ctx.customerFirstName} é cliente há ${ctx.random.int(2, 9)} anos, sempre em dia. Isso conta bastante aqui.`), cl(`Pois é, por isso acho que mereço uma condição melhor.`)],
    (ctx) => [op(`Tenho duas opções: manter o plano com ${ctx.random.pick(["25%", "30%"])} de desconto por 12 meses, ou migrar pro ${ctx.random.pick(["Fibra 500 Mega", "Fibra 1 Giga"])} por ${ctx.random.pick(["R$ 99,90", "R$ 109,90"])}.`), cl(`E depois dos 12 meses?`), op(`Volta ao valor de tabela, mas ${who(ctx)} pode renegociar de novo antes disso.`)],
    () => [cl(`Tem fidelidade nova?`), op(`O desconto tem fidelidade de 12 meses, sim. Se cancelar antes, cobra o proporcional do desconto recebido.`), cl(`Hum, entendi.`)],
    () => [cl(`Deixa eu ver com meu marido aqui... ele disse que pode ser a segunda opção.`), op(`Ótima escolha. Vou registrar a migração.`)],
    () => [op(`Só um detalhe: a nova velocidade entra em até 24 horas e a fatura deste mês vem proporcional.`), cl(`Tá certo.`)],
  ],
  resolution: {
    RESOLVIDO: (ctx) => [op(`Registrado: plano ${ctx.random.pick(["Fibra 500 Mega", "Fibra 1 Giga"])} por ${ctx.random.pick(["R$ 99,90", "R$ 109,90"])}, 12 meses. O cancelamento fica sem efeito. Protocolo ${ctx.protocol}.`), cl(`Fechado. Obrigada!`)],
    PARCIAL: () => [op(`A oferta ficou reservada por 48 horas no seu cadastro. Se decidir, é só ligar ou aceitar pelo app.`), cl(`Tá, vou pensar.`)],
    TRANSFERIDO: () => [op(`Ofertas acima desse desconto só a equipe de retenção libera. Vou transferir.`), cl(`Tá bom.`)],
    RETORNO_PROMETIDO: () => [op(`Vou pedir pra equipe de retenção ligar até amanhã com a condição final.`), cl(`Tá, vou aguardar até amanhã então.`)],
    NAO_RESOLVIDO: () => [op(`Não tenho nenhuma oferta disponível pro seu perfil hoje.`), cl(`Então vou cancelar mesmo.`), op(`Se for o caso, posso registrar o cancelamento.`)],
  },
  alternative: (ctx) => [op(`Outra alternativa: reduzir pra um plano menor sem multa, já que ${who(ctx)} comentou que usa pouco. O Fibra 300 fica em R$ 79,90.`), cl(`Boa, também é uma opção.`)],
  divergent: () => [cl(`Esse desconto tem fidelidade?`), op(`Não tem nenhuma fidelidade, pode cancelar quando quiser sem custo.`), cl(`Ótimo.`)],
  impliedFlags: ["cancelamento"],
}

const mudancaPlano: ScenarioSpec = {
  key: "MUDANCA_PLANO",
  domains: ["ATENDIMENTO", "RETENCAO"],
  reasons: ["Alteração de plano", "Upgrade de velocidade", "Troca de plano por dificuldade financeira", "Redução de plano"],
  summary: (ctx) => `${who(ctx)} quer ${choice(ctx, ["aumentar a velocidade", "reduzir o plano", "trocar o plano"])} e saber quanto fica`,
  opening: (ctx) => [cl(`Eu queria ${choice(ctx, ["aumentar minha internet, está fraca pra home office", "diminuir meu plano, tá pesando", "trocar de plano"])}. Quais as opções?`), op(`Claro, ${ctx.customerFirstName}. Hoje ${who(ctx)} tem o ${ctx.plan}, por ${ctx.amount}.`)],
  investigation: [
    (ctx) => [op(`Posso oferecer o ${ctx.random.pick(["Fibra 500 Mega por R$ 109,90", "Fibra 1 Giga por R$ 139,90", "Fibra 300 Mega por R$ 79,90", "Controle 12GB por R$ 44,90"])}.`), cl(`E a diferença vem proporcional?`), op(`Vem, só na primeira fatura.`)],
    () => [cl(`Precisa trocar o modem?`), op(`Pra 1 Giga precisa, e a troca é sem custo com agendamento. Pra 500 mega o atual atende.`)],
    (ctx) => [cl(`E tem fidelidade?`), op(`Upgrade não gera fidelidade nova. Só a promoção de desconto, se ${who(ctx)} optar por ela.`)],
    () => [cl(`Pode fazer o de 500 então.`), op(`Registrando... A ativação leva até 24 horas.`)],
  ],
  resolution: {
    RESOLVIDO: (ctx) => [op(`Pronto, plano alterado. Em até 24 horas a nova velocidade está ativa e ${who(ctx)} recebe um SMS de confirmação.`), cl(`Ótimo, obrigado.`)],
    PARCIAL: () => [op(`A alteração foi solicitada, mas depende de viabilidade técnica na sua rua. Prazo de 2 dias úteis.`), cl(`Tá.`)],
    TRANSFERIDO: () => [op(`Redução de plano com desconto ativo passa pela equipe de retenção. Vou transferir.`), cl(`Tá.`)],
    RETORNO_PROMETIDO: () => [op(`Vou deixar a solicitação registrada e a confirmação chega por SMS em 48 horas.`), cl(`Ok.`)],
    NAO_RESOLVIDO: () => [op(`Não tem viabilidade de 1 Giga na sua região ainda.`), cl(`E 500?`), op(`Também não consta.`)],
  },
  alternative: () => [op(`Se a ideia é economizar, também existe o combo com TV que sai mais barato que os dois separados. Posso simular?`), cl(`Pode simular.`)],
  divergent: () => [cl(`Vem proporcional?`), op(`Não, não muda nada na fatura desse mês.`), cl(`Ok.`)],
  impliedFlags: [],
}

// ─────────────────────────────────────────────────────────────────── ATENDIMENTO GERAL

const informacaoGeral: ScenarioSpec = {
  key: "INFORMACAO_GERAL",
  domains: ["ATENDIMENTO"],
  reasons: ["Informação sobre plano", "Dúvida sobre franquia de dados", "Informação sobre cobertura", "Dúvida sobre roaming"],
  summary: (ctx) => `${who(ctx)} quer saber ${choice(ctx, ["quanto de internet ainda tem no mês", "se o plano funciona em viagem", "como funciona o roaming internacional"])}`,
  opening: (ctx) => [cl(`${choice(ctx, ["Eu queria saber quanto de internet ainda tenho esse mês.", "Vou viajar pra fora, meu plano funciona lá?", "Como funciona o roaming no meu plano?"])}`), op(`Claro, ${ctx.customerFirstName}, vou verificar.`)],
  investigation: [
    (ctx) => (ctx.variant % 3 === 0 ? [op(`Do pacote de ${ctx.random.pick(["20GB", "50GB", "12GB"])}, foram usados ${ctx.random.int(4, 18)}GB até hoje. Renova dia ${ctx.dueDay}.`), cl(`Ah, então ainda tem bastante.`), op(`E tem os 5GB de bônus do app que não aparecem no consumo principal.`), cl(`Não sabia do bônus.`)] : []),
    (ctx) => (ctx.variant % 3 !== 0 ? [op(`O roaming internacional está incluso em ${ctx.random.pick(["Argentina, Chile e Uruguai", "Portugal e Espanha", "EUA e Canadá"])}, usando a franquia do Brasil. Em outros países precisa do pacote de viagem.`), cl(`E o pacote custa quanto?`), op(`${ctx.random.pick(["R$ 29,90", "R$ 49,90"])} por semana de viagem.`)] : []),
    (ctx) => (ctx.variant % 3 !== 0 ? [cl(`Eu ativo isso como?`), op(`Pelo app ou aqui comigo agora. Precisa ativar antes de embarcar.`), cl(`E se eu não ativar e usar lá?`), op(`Aí cobra por MB, sai bem mais caro. Por isso o pacote.`)] : []),
  ],
  resolution: {
    RESOLVIDO: () => [op(`Pronto, deixei tudo explicado e a ativação registrada. Bom uso!`), cl(`Obrigada!`)],
    PARCIAL: () => [op(`A informação é essa, mas a ativação do pacote só é possível 24 horas antes da viagem. Liga de novo na véspera.`), cl(`Tá.`)],
    TRANSFERIDO: () => [op(`Pra ativar o pacote de viagem vou transferir pra área de roaming.`), cl(`Ok.`)],
    RETORNO_PROMETIDO: () => [op(`Vou enviar por SMS a tabela de países cobertos.`), cl(`Tá bom.`)],
    NAO_RESOLVIDO: () => [op(`Não tenho essa informação aqui.`), cl(`E quem tem?`), op(`Tenta o site.`)],
  },
  alternative: () => [op(`Só lembrando: essa consulta de consumo fica em tempo real no app, na tela inicial, e dá pra ativar alerta de 80% da franquia.`), cl(`Vou ativar o alerta.`)],
  divergent: () => [cl(`Roaming está incluso?`), op(`Está incluso em qualquer país do mundo, sem custo nenhum.`), cl(`Que ótimo.`)],
  impliedFlags: [],
}

const reclamacao: ScenarioSpec = {
  key: "RECLAMACAO",
  domains: ["ATENDIMENTO", "RETENCAO", "FATURAMENTO"],
  reasons: ["Reclamação de atendimento anterior", "Reclamação sobre cobrança após cancelamento", "Reclamação de visita técnica não realizada", "Cobrança após pedido de cancelamento e ameaça de reclamação"],
  summary: (ctx) => `${who(ctx)} quer registrar reclamação porque ${choice(ctx, ["o técnico não apareceu", "foi cobrado depois de cancelar", "foi mal atendido na última ligação"])}`,
  opening: (ctx) => [
    cl(`Eu quero fazer uma reclamação formal. ${choice(ctx, ["O técnico não apareceu no dia marcado e ninguém avisou.", "Cancelei o serviço em " + ctx.monthName + " e continuo sendo cobrado.", "Na última ligação a atendente desligou na minha cara."])}`),
    op(`Sinto muito, ${ctx.customerFirstName}. Vou registrar a reclamação e ver o que consigo resolver agora.`),
  ],
  investigation: [
    (ctx) => [op(`Estou vendo o histórico. Consta ${choice(ctx, ["a visita agendada como 'cliente ausente'", "o pedido de cancelamento em aberto, não concluído", "o atendimento anterior com duração de 2 minutos"])}.`), cl(`${choice(ctx, ["Ausente? Eu fiquei o dia todo em casa!", "Não concluído? Eu liguei e confirmaram!", "Dois minutos porque ela desligou!"])}`)],
    (ctx) => [op(`Vou registrar sua versão no protocolo, palavra por palavra, pra auditoria.`), cl(`Faça isso. E eu quero o número.`), op(`Protocolo ${ctx.protocol}.`)],
    () => [cl(`E o que acontece com essa reclamação?`), op(`Ela vai pra ouvidoria interna, que responde em até 10 dias úteis.`), cl(`Dez dias...`)],
    (ctx) => [op(`Além da reclamação, posso ${choice(ctx, ["reagendar a visita com prioridade pra amanhã", "concluir o cancelamento agora e estornar a cobrança indevida", "encaminhar o atendimento anterior pra revisão da supervisão"])}.`), cl(`Isso, pelo menos isso.`)],
  ],
  resolution: {
    RESOLVIDO: (ctx) => [op(`Então: reclamação registrada, ${choice(ctx, ["visita reagendada pra amanhã de manhã com prioridade", "cancelamento concluído e estorno lançado", "atendimento anterior encaminhado pra revisão"])}. Protocolo ${ctx.protocol}.`), cl(`Tá certo. Obrigado por resolver.`)],
    PARCIAL: () => [op(`Reclamação registrada. A parte da cobrança vai pra análise de 5 dias úteis.`), cl(`Tá, vou aguardar, mas já estou de olho.`)],
    TRANSFERIDO: () => [op(`Reclamação formal é registrada pela ouvidoria. Vou transferir.`), cl(`Mais transferência.`)],
    RETORNO_PROMETIDO: () => [op(`A ouvidoria vai retornar em até 10 dias úteis por e-mail.`), cl(`Tá bom.`)],
    NAO_RESOLVIDO: () => [op(`Eu consigo registrar a reclamação, mas não tenho como corrigir a cobrança daqui.`), cl(`Então não resolve nada.`), op(`Fica registrado.`)],
  },
  alternative: () => [op(`Também existe o canal da ouvidoria pelo site, com protocolo próprio e prazo de 5 dias — mais rápido que por aqui.`), cl(`Vou usar esse também.`)],
  divergent: () => [cl(`Em quanto tempo responde?`), op(`Respondem em até 24 horas, garantido.`), cl(`Tá.`)],
  impliedFlags: [],
}

const alteracaoCadastral: ScenarioSpec = {
  key: "ALTERACAO_CADASTRAL",
  domains: ["ATENDIMENTO"],
  reasons: ["Alteração de dados cadastrais", "Alteração de e-mail e telefone", "Alteração de gestor empresarial", "Troca de titularidade"],
  summary: (ctx) => `${who(ctx)} quer atualizar ${choice(ctx, ["o e-mail e o telefone de contato", "o gestor do contrato", "o endereço de cobrança"])}`,
  opening: (ctx) => [cl(`Preciso atualizar ${choice(ctx, ["meu e-mail e telefone", "o responsável pelo contrato aqui na empresa", "o endereço de cobrança"])} no cadastro.`), op(`Claro, ${ctx.customerFirstName}. Por segurança preciso validar alguns dados antes.`)],
  investigation: [
    (ctx) => [op(`Me confirma o valor da última fatura paga?`), cl(`Foi ${ctx.amount}.`), op(`Correto. E o dia de vencimento?`), cl(`Dia ${ctx.dueDay}.`), op(`Validado.`)],
    (ctx) => (ctx.variant % 3 === 0 ? [op(`Qual o novo e-mail?`), cl(`${ctx.customerFirstName.toLowerCase()}.${ctx.customerSurname.toLowerCase()}@${ctx.random.pick(["gmail.com", "outlook.com"])}.`), op(`E o telefone?`), cl(`(${ctx.random.int(11, 99)}) 9${ctx.random.int(1000, 9999)}-${ctx.random.int(1000, 9999)}.`), op(`Atualizando... o sistema vai enviar um código de confirmação pro novo número.`), cl(`Chegou. É ${ctx.random.int(1000, 9999)}.`), op(`Confirmado.`)] : []),
    (ctx) => (ctx.variant % 3 === 1 ? [op(`Pra troca de gestor eu preciso do CPF do novo responsável e de um documento da empresa autorizando.`), cl(`Posso mandar por e-mail?`), op(`Pode, pro endereço que vou te passar por SMS.`), cl(`Mando ainda hoje.`)] : []),
    (ctx) => (ctx.variant % 3 === 2 ? [op(`Qual o novo endereço de cobrança?`), cl(`Rua ${ctx.random.pick(["das Flores", "Sete de Setembro", "Padre Cícero", "Barão do Rio Branco"])}, ${ctx.random.int(10, 1500)}, ${ctx.city}.`), op(`E o CEP?`), cl(`${ctx.random.int(10000, 99999)}-${ctx.random.int(100, 999)}.`), op(`Atualizado. A próxima fatura já vai pro endereço novo.`)] : []),
  ],
  resolution: {
    RESOLVIDO: () => [op(`Cadastro atualizado. A partir de agora as comunicações vão pros novos contatos.`), cl(`Ótimo, obrigada.`)],
    PARCIAL: () => [op(`O telefone já está atualizado. O e-mail só é alterado após a confirmação do link que enviei.`), cl(`Tá, vou confirmar.`)],
    TRANSFERIDO: () => [op(`Troca de titularidade é feita por uma área específica. Vou transferir.`), cl(`Tá.`)],
    RETORNO_PROMETIDO: () => [op(`Assim que a documentação chegar, a alteração é feita em até 2 dias úteis e confirmamos por e-mail.`), cl(`Certo.`)],
    NAO_RESOLVIDO: () => [op(`Sem o documento da empresa eu não consigo alterar o gestor.`), cl(`Mas eu sou o dono.`), op(`Mesmo assim precisa do documento.`)],
  },
  alternative: (ctx) => [op(`Alteração de e-mail e telefone ${who(ctx)} também consegue fazer direto no app, em "Meus dados", com confirmação por SMS.`), cl(`Bom saber.`)],
  divergent: () => [cl(`Precisa de documento pra trocar o gestor?`), op(`Não precisa de nada, é só me falar o nome que eu troco.`), cl(`Ah, tá.`)],
  impliedFlags: [],
}

export const SCENARIOS: readonly ScenarioSpec[] = [
  duvidaFatura, contestacaoCobranca, segundaVia, alteracaoVencimento, negociacaoDebito,
  suporteLentidao, suporteQuedaConexao, suporteSemSinal, suporteApp,
  cancelamento, retencaoOferta, mudancaPlano,
  informacaoGeral, reclamacao, alteracaoCadastral,
]

export const SCENARIO_BY_KEY: ReadonlyMap<ScenarioKey, ScenarioSpec> = new Map(SCENARIOS.map((scenario) => [scenario.key, scenario]))

/** Pesos de escolha de cenário por domínio do Grupo — o tema da chamada respeita a operação. */
export const SCENARIO_WEIGHTS_BY_DOMAIN: Record<Domain, Partial<Record<ScenarioKey, number>>> = {
  FATURAMENTO: { DUVIDA_FATURA: 25, CONTESTACAO_COBRANCA: 20, SEGUNDA_VIA: 18, ALTERACAO_VENCIMENTO: 12, NEGOCIACAO_DEBITO: 15, RECLAMACAO: 6, INFORMACAO_GERAL: 4 },
  SUPORTE: { SUPORTE_LENTIDAO: 28, SUPORTE_QUEDA_CONEXAO: 30, SUPORTE_SEM_SINAL: 18, SUPORTE_APP: 12, RECLAMACAO: 6, INFORMACAO_GERAL: 6 },
  RETENCAO: { CANCELAMENTO: 35, RETENCAO_OFERTA: 30, MUDANCA_PLANO: 15, NEGOCIACAO_DEBITO: 8, RECLAMACAO: 12 },
  ATENDIMENTO: { INFORMACAO_GERAL: 18, MUDANCA_PLANO: 14, ALTERACAO_CADASTRAL: 12, DUVIDA_FATURA: 14, SEGUNDA_VIA: 12, SUPORTE_SEM_SINAL: 8, SUPORTE_APP: 6, RECLAMACAO: 8, CONTESTACAO_COBRANCA: 8 },
}
