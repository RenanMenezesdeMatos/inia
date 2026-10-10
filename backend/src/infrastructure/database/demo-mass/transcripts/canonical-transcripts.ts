import type { TranscriptLength } from "./transcript-types.js"

/**
 * As 10 transcrições CANÔNICAS de QA — escritas à mão, uma por cenário obrigatório. São
 * localizáveis por `external_id` (DEMO-QA-INTERACTION-001…010) e cada uma documenta o que um
 * Agent de conformidade DEVERIA concluir (ver docs/dev/massa-demo.md). `{{OPERADOR}}` é
 * substituído pelo primeiro nome do operador dono da interação.
 *
 * Convenções: uma fala por linha, rótulos literais "Operador:"/"Cliente:"; notas de transcrição
 * entre colchetes ("[trecho inaudível]") ficam DENTRO da fala, nunca em linha própria.
 */
export type CanonicalTranscript = {
  reason: string
  length: TranscriptLength
  durationSeconds: number
  flags: Record<string, boolean | number>
  /** O que a transcrição sustenta — fixture de teste, não ground truth produtivo. */
  expectation: string
  content: string
}

const lines = (text: string): string => text.trim().split("\n").map((line) => line.trim()).filter(Boolean).join("\n")

export const CANONICAL_TRANSCRIPTS: Record<string, CanonicalTranscript> = {
  "DEMO-QA-INTERACTION-001": {
    reason: "Dúvida sobre fatura",
    length: "CURTA",
    durationSeconds: 214,
    flags: {},
    expectation: "Atendimento correto de faturamento: saudação, identificação, confirmação de entendimento, explicação completa, encerramento. Sem flag.",
    content: lines(`
Operador: Conecta, {{OPERADOR}} falando, bom dia! Com quem eu falo?
Cliente: Bom dia. É a Márcia Furtado.
Operador: Tudo bem, Márcia? Pra eu localizar o cadastro, me confirma o CPF da titular, por favor?
Cliente: Claro. 418.302.755-10.
Operador: Obrigada. Localizei aqui, Márcia Furtado, Fibra 300 Mega. Como posso ajudar?
Cliente: É sobre a minha fatura de agosto. Sempre veio R$ 99,90 e esse mês veio R$ 112,40. Eu queria entender por quê.
Operador: Entendi. Só pra confirmar: a fatura de agosto veio R$ 112,40 em vez dos R$ 99,90 de costume, e a senhora quer saber de onde vem essa diferença de R$ 12,50, certo?
Cliente: Isso, exatamente.
Operador: Vou abrir o detalhamento. Um instante.
Cliente: Tá.
Operador: Pronto. A diferença é uma cobrança proporcional: no dia 18 de julho a senhora fez o upgrade de 200 pra 300 mega, e o ciclo de cobrança fecha no dia 10. Então essa fatura trouxe 23 dias do plano novo somados ao valor cheio, só uma vez.
Cliente: Ah, é verdade, eu mudei o plano em julho. E na próxima já volta ao normal?
Operador: Volta. A fatura de setembro vem exatamente R$ 99,90, sem nenhum proporcional, porque o ciclo inteiro já será no plano novo.
Cliente: Perfeito. E não tem nenhum serviço a mais que eu não tenha pedido?
Operador: Não. Conferi linha por linha: é o valor do plano e o proporcional do upgrade. Nada além disso.
Cliente: Ótimo, era só isso mesmo. Fiquei com medo de ter caído algum pacote.
Operador: Fez bem em confirmar. Posso ajudar em mais alguma coisa?
Cliente: Não, era só isso. Obrigada.
Operador: Eu que agradeço, Márcia. O protocolo desta ligação é 202608411237. Ao final vai ter uma pesquisa rápida, se puder responder, ajuda bastante. A Conecta agradece, tenha um ótimo dia!
Cliente: Obrigada, até mais.
`),
  },

  "DEMO-QA-INTERACTION-002": {
    reason: "Contestação de cobrança de serviço não reconhecido",
    length: "LONGA",
    durationSeconds: 1462,
    flags: { contestacao: true, tempo_silencio: 128, nota_ura: 2 },
    expectation: "Falhas auditáveis: informação divergente do processo (estorno 'em 24h na conta bancária'), orientação de pagar o valor integral contestado, e explicação incompleta do prazo da análise. Cliente termina frustrado.",
    content: lines(`
Operador: Boa tarde, Conecta atendimento, meu nome é {{OPERADOR}}. Com quem tenho o prazer de falar?
Cliente: Boa tarde. Meu nome é Roberto Lacerda.
Operador: Pois não, Roberto. Pra gente seguir, me confirma o CPF do titular?
Cliente: 276.914.380-55.
Operador: Certo. E o endereço de instalação?
Cliente: Rua Coronel Bento, 412, em Recife.
Operador: Confirmado. Em que posso ajudar?
Cliente: Eu quero contestar uma cobrança. Veio um valor de R$ 49,90 na minha fatura chamado "Conecta Play Premium". Eu nunca contratei isso.
Operador: Entendi. Vou abrir a fatura aqui.
Cliente: Isso já é o segundo mês que vem, viu. Em julho eu paguei porque achei que era outra coisa, mas agora em agosto veio de novo.
Operador: Tá. Deixa eu ver.
Cliente: Tá.
Operador: Um momento, por favor, vou verificar no sistema.
Cliente: Tá bom.
Operador: Pronto, voltei. Obrigado pela espera. Consta aqui o serviço Conecta Play Premium, ativado no dia 14 de julho, pelo aplicativo.
Cliente: Pelo aplicativo? Eu não ativei nada pelo aplicativo.
Operador: É o que consta.
Cliente: Eu uso o aplicativo pra ver a fatura, só isso. Não tem como eu ter ativado um serviço de R$ 49,90 sem perceber.
Operador: Às vezes aparece um banner e a pessoa clica.
Cliente: Eu não cliquei em banner nenhum. E mesmo que tivesse clicado, não tinha que pedir confirmação?
Operador: Pede, normalmente pede.
Cliente: Então onde está a minha confirmação?
Operador: Deixa eu verificar se tem registro de aceite.
Cliente: Verifica, por favor.
Operador: Só um instante enquanto eu consulto aqui.
Cliente: Certo.
Operador: Alô?
Cliente: Oi.
Operador: Não localizei o registro de aceite. Só a ativação.
Cliente: Então é isso. Eu não contratei. Quero o cancelamento e o estorno dos dois meses.
Operador: Certo. Eu consigo cancelar o serviço agora.
Cliente: Cancela.
Operador: Cancelando... pronto, cancelado. A partir de hoje não cobra mais.
Cliente: E o estorno?
Operador: O estorno eu vou registrar como contestação.
Cliente: Tá. E como funciona?
Operador: A gente registra e o valor volta pra você.
Cliente: Volta como? Na fatura, na conta?
Operador: O estorno é sempre depositado na conta bancária em 24 horas.
Cliente: Na conta bancária? Vocês nem têm minha conta bancária.
Operador: Então a gente pede.
Cliente: Como assim vocês pedem?
Operador: Alguém entra em contato pra pegar os dados.
Cliente: Olha, eu já fui cliente de outra operadora e o estorno vinha como crédito na fatura seguinte. Não é assim aqui?
Operador: Pode ser também, depende.
Cliente: Depende do quê?
Operador: Da análise.
Cliente: E quanto tempo leva essa análise?
Operador: Não tem um prazo fixo.
Cliente: Como não tem prazo? Tudo tem prazo.
Operador: Geralmente é rápido.
Cliente: "Geralmente é rápido" não é prazo. Eu quero saber em quantos dias.
Operador: Vou registrar como urgente.
Cliente: Tá. E a fatura de agosto, que vence dia 20? Eu pago com o valor errado?
Operador: O ideal é pagar o valor integral pra não ter juros.
Cliente: Pagar R$ 49,90 de uma coisa que eu não contratei?
Operador: Depois devolve.
Cliente: E se não devolver?
Operador: Devolve.
Cliente: Eu li que quando tem contestação vocês podem emitir a fatura só com o valor certo. Não podem?
Operador: Não sei se dá nesse caso.
Cliente: Você pode verificar?
Operador: Só um momento.
Cliente: Tá.
Operador: Alô? Ainda está aí?
Cliente: Estou.
Operador: Aqui não está me deixando gerar fatura ajustada.
Cliente: Por quê?
Operador: Não sei, o sistema não deixa.
Cliente: Então eu tenho que pagar integral.
Operador: É a orientação.
Cliente: Olha, {{OPERADOR}}, eu estou tentando ser educado, mas isso é cobrança indevida. Eu vou pagar o que eu devo, que é R$ 129,90 do plano. O resto eu não vou pagar.
Operador: Se pagar parcial, o sistema pode entender como atraso.
Cliente: E o que acontece se entender como atraso?
Operador: Pode bloquear a linha.
Cliente: Vocês vão bloquear a minha linha por eu não pagar uma coisa que vocês mesmos confirmaram que não tem aceite?
Operador: Não estou dizendo que vai, estou dizendo que pode.
Cliente: Isso é um absurdo, viu.
Operador: Eu entendo, mas é o que o sistema faz.
Cliente: Eu quero o número do protocolo dessa contestação.
Operador: Um momento.
Cliente: Tá.
Operador: O protocolo é 202608672291.
Cliente: 202608672291. Anotei. E essa contestação inclui os dois meses, julho e agosto?
Operador: Eu registrei agosto.
Cliente: E julho?
Operador: Julho já foi pago.
Cliente: Justamente por isso eu quero de volta! Eu paguei por engano.
Operador: Ah, tá. Vou incluir então.
Cliente: Inclui, por favor.
Operador: Só um instante.
Cliente: ...
Operador: Pronto, incluí julho. Valor total contestado R$ 99,80.
Cliente: Certo. E o retorno dessa análise, eu recebo como?
Operador: Você vai ser avisado.
Cliente: Por onde? SMS, e-mail, ligação?
Operador: Provavelmente SMS.
Cliente: Provavelmente...
Operador: Ou e-mail.
Cliente: Tá bom. E se em uma semana ninguém me avisar?
Operador: Aí você liga.
Cliente: Eu vou ter que ligar de novo?
Operador: Só se não avisarem.
Cliente: Tá. Vou anotar aqui. Hoje é 27 de agosto. Se até dia 3 de setembro ninguém me falar nada, eu ligo e abro reclamação.
Operador: Tá certo.
Cliente: E enquanto isso o serviço já está cancelado, né? Não vai vir em setembro.
Operador: Cancelado sim.
Cliente: Você pode me confirmar isso por SMS?
Operador: O sistema manda automático.
Cliente: Quando?
Operador: Hoje ainda, acho.
Cliente: Tá. Mais alguma coisa que eu preciso fazer?
Operador: Não.
Cliente: Então eu vou pagar os R$ 129,90 do plano e aguardar o estorno dos R$ 99,80.
Operador: A orientação é pagar integral.
Cliente: Eu entendi a orientação. Eu vou pagar o que eu devo.
Operador: Tá.
Cliente: E, sinceramente, eu esperava uma explicação melhor de vocês sobre isso.
Operador: Posso ajudar em mais alguma coisa?
Cliente: Não. Só espero que dessa vez resolva.
Operador: Combinado. Protocolo 202608672291. A Conecta agradece a ligação, tenha um bom dia.
Cliente: Tá. Tchau.
`),
  },

  "DEMO-QA-INTERACTION-003": {
    reason: "Rechamada sobre visita técnica não realizada",
    length: "MEDIA",
    durationSeconds: 588,
    flags: { rechamada: true, tempo_silencio: 65 },
    expectation: "Rechamada legítima (cliente cita protocolo anterior). Processo incompleto: o operador reagenda a visita mas NÃO registra a reclamação da visita perdida nem oferece a compensação prevista; encerramento sem protocolo.",
    content: lines(`
Operador: Conecta, {{OPERADOR}} falando, boa tarde! Com quem eu falo?
Cliente: Boa tarde. Aqui é o Cláudio Bezerra.
Operador: Tudo bem, Cláudio? Me confirma o CPF do titular, por favor?
Cliente: 302.118.947-20.
Operador: Obrigado. E o endereço de instalação?
Cliente: Rua das Acácias, 88, Fortaleza.
Operador: Confirmado. Como posso ajudar?
Cliente: Olha, eu já liguei na quinta-feira sobre isso, protocolo 202608558140. Minha internet está caindo e marcaram uma visita técnica pra sábado de manhã. Ninguém apareceu.
Operador: Entendo, Cláudio, e peço desculpas pelo transtorno de ter que ligar de novo. Vou localizar o protocolo anterior pra não recomeçar do zero.
Cliente: Por favor. Eu fiquei a manhã inteira esperando.
Operador: Um momento, por favor, vou verificar no sistema.
Cliente: Tá.
Operador: Voltei aqui, obrigado pela paciência. Localizei o chamado. Consta a visita agendada pra sábado, das 8h às 12h, com status "cliente ausente".
Cliente: Ausente? Eu não saí de casa. Ninguém tocou o interfone, ninguém ligou.
Operador: Entendi. Vou verificar se houve alguma tentativa de contato registrada.
Cliente: Verifica.
Operador: Só um instante enquanto eu consulto aqui.
Cliente: Certo.
Operador: Não consta nenhuma ligação do técnico no seu número. Então o registro de "ausente" não bate com o histórico.
Cliente: Pois é. E enquanto isso a internet continua caindo. Ontem à noite caiu umas seis vezes.
Operador: Deixa eu ver o equipamento agora... O modem está online, mas com histórico de 22 quedas nas últimas 24 horas. Sinal óptico abaixo do mínimo.
Cliente: Então precisa de visita mesmo.
Operador: Precisa. Vou reagendar. Tenho amanhã, terça, das 13h às 18h, ou quarta, das 8h às 12h.
Cliente: Amanhã à tarde. Mas eu quero garantia de que vem.
Operador: Vou marcar como prioridade e anotar que a visita anterior falhou.
Cliente: E essa visita que não aconteceu, não gera nada pra vocês não? Eu perdi uma manhã.
Operador: Fica registrado aqui no reagendamento.
Cliente: Mas não abre uma reclamação?
Operador: O reagendamento já resolve.
Cliente: Tá... e o técnico liga antes?
Operador: Liga sim, uns 30 minutos antes.
Cliente: Tá bom.
Operador: Confirma o endereço: rua das Acácias, 88?
Cliente: Isso. Tem interfone, apartamento 302.
Operador: Anotado. Enquanto o técnico não vai, dá pra manter o modem ligado direto na tomada, sem filtro de linha?
Cliente: Já está direto.
Operador: Certo.
Cliente: E se amanhã não vier de novo?
Operador: Aí você liga e a gente vê.
Cliente: Liga de novo... tá.
Operador: Mais alguma coisa?
Cliente: Não, só isso. Espero que amanhã resolva.
Operador: Combinado então, Cláudio. Boa tarde.
Cliente: Boa tarde.
`),
  },

  "DEMO-QA-INTERACTION-004": {
    reason: "Cancelamento de internet por mudança de endereço",
    length: "LONGA",
    durationSeconds: 1338,
    flags: { cancelamento: true, nota_ura: 5, tempo_silencio: 74 },
    expectation: "Atendimento de retenção CORRETO: entende o motivo, consulta cobertura, apresenta oferta e a alternativa de suspensão, esclarece multa/fidelidade, registra o desfecho escolhido com protocolo e prazos. Flag cancelamento coerente (tema da chamada).",
    content: lines(`
Operador: Boa tarde, Conecta atendimento, meu nome é {{OPERADOR}}. Com quem tenho o prazer de falar?
Cliente: Boa tarde. É a Helena Guimarães.
Operador: Tudo bem, Helena? Pra eu localizar o cadastro, me confirma o CPF da titular?
Cliente: 519.204.881-37.
Operador: Obrigada. Localizei: Fibra 500 Mega, endereço na rua Padre Vieira, 1.020, em Campinas. Confere?
Cliente: Confere.
Operador: Como posso ajudar?
Cliente: Então, eu vou precisar cancelar a internet. Eu me mudo pra Sorocaba no fim do mês.
Operador: Entendi. Só pra eu confirmar: a senhora quer cancelar o Fibra 500 porque vai se mudar pra Sorocaba no fim de setembro, certo?
Cliente: Isso.
Operador: Certo. Antes de registrar qualquer coisa, deixa eu verificar duas coisas: se a gente tem cobertura no novo endereço e como está o contrato atual. Pode ser?
Cliente: Pode.
Operador: Qual o CEP do endereço novo?
Cliente: 18040-320.
Operador: Um momento, por favor, vou consultar a cobertura.
Cliente: Tá.
Operador: Obrigada por aguardar. Temos cobertura de fibra nesse CEP, com o mesmo plano de 500 mega.
Cliente: Ah, tem? Eu achei que não tinha.
Operador: Tem sim, instalação normalmente em até 5 dias úteis. Então a senhora tem uma opção além do cancelamento: a mudança de endereço, que leva o mesmo contrato pro endereço novo.
Cliente: E isso custa alguma coisa?
Operador: A mudança de endereço tem uma taxa de R$ 120,00, que pode ser parcelada em 3 vezes na fatura. Mas como a senhora tem mais de 2 anos de contrato, eu consigo isentar essa taxa.
Cliente: Isentar totalmente?
Operador: Totalmente. Fica registrado no protocolo.
Cliente: Hum, interessante. Mas deixa eu te explicar: lá em Sorocaba eu vou morar com a minha irmã por uns meses, e ela já tem internet. Então eu não vou precisar de uma segunda.
Operador: Entendi, faz sentido. Nesse caso, tem uma terceira opção, que talvez seja a melhor: a suspensão temporária do contrato.
Cliente: Como funciona?
Operador: A senhora suspende por até 120 dias sem pagar mensalidade. Quando conseguir o endereço definitivo, é só reativar, e a gente instala lá sem custo de nova instalação e sem nova fidelidade.
Cliente: E se em 120 dias eu ainda não tiver o endereço?
Operador: Aí a suspensão vira cancelamento automaticamente, sem multa.
Cliente: Sem multa mesmo? Porque eu lembro que assinei alguma fidelidade.
Operador: Deixa eu ver... A fidelidade do seu contrato terminou em março deste ano. Então, independente da opção, não existe multa hoje. Nem no cancelamento direto.
Cliente: Ah, que bom. Isso era a minha maior dúvida.
Operador: Então resumindo as três opções: cancelar agora, sem multa; mudar de endereço, com taxa isenta; ou suspender por até 120 dias e decidir depois.
Cliente: A suspensão parece a melhor.
Operador: Eu também acho, pelo que a senhora descreveu. Quer que eu registre a suspensão?
Cliente: Quero. Mas me explica direitinho o que acontece com a conta desse mês.
Operador: Claro. Sua fatura fecha no dia 10. A suspensão começa na data que a senhora escolher, entre hoje e o fim do mês. A fatura de setembro vem proporcional aos dias em que o serviço ficou ativo. Depois disso, nenhuma cobrança até a reativação.
Cliente: Eu vou me mudar dia 28. Então pode suspender dia 28.
Operador: Perfeito. Suspensão programada pra 28 de setembro. E o modem?
Cliente: Ah, é. O que eu faço com ele?
Operador: Na suspensão o equipamento fica com a senhora. Quando reativar, o técnico usa o mesmo aparelho. Só peço que guarde com a fonte.
Cliente: Tá bom. E se eu decidir cancelar de vez lá na frente?
Operador: Aí a gente agenda a retirada gratuita ou a senhora entrega em qualquer loja.
Cliente: Certo.
Operador: Antes de registrar, deixa eu esclarecer uma coisa que costuma gerar dúvida: durante a suspensão a senhora não tem acesso ao serviço, nem ao Wi-Fi da casa. É diferente de "manter ligado sem pagar".
Cliente: Sim, isso eu entendi. Eu não vou estar lá mesmo.
Operador: Perfeito. E a fatura proporcional de setembro, se for paga em atraso, gera juros normalmente, mesmo com o contrato suspenso.
Cliente: Tá, eu pago em dia.
Operador: E mais um detalhe: se a senhora reativar antes dos 120 dias, o contrato volta com as mesmas condições, sem taxa nenhuma. Se passar dos 120, o sistema cancela e uma reativação depois disso seria uma instalação nova.
Cliente: Nova instalação teria custo?
Operador: Teria a taxa de instalação, R$ 150,00, salvo promoção vigente. Por isso vale marcar a data-limite.
Cliente: Qual seria a data-limite?
Operador: Suspendendo em 28 de setembro, 120 dias dá 26 de janeiro.
Cliente: Vou anotar: 26 de janeiro.
Operador: Vou registrar essa data no protocolo também, e o sistema manda um lembrete por SMS 15 dias antes.
Cliente: Ótimo, isso ajuda muito.
Operador: Alguma pergunta sobre a suspensão antes de eu registrar?
Cliente: Só uma: meu e-mail de cobrança pode mudar? Eu vou usar o da minha irmã por um tempo.
Operador: Pode. Mas eu sugiro manter o seu, porque as comunicações do contrato são pessoais. Se quiser, eu adiciono o da sua irmã como e-mail secundário.
Cliente: Ah, secundário é melhor mesmo.
Operador: Qual seria?
Cliente: lucia.guimaraes@gmail.com.
Operador: Adicionado como secundário. As faturas vão pros dois.
Cliente: Perfeito.
Operador: Só um instante enquanto eu registro a suspensão.
Cliente: Tá.
Operador: Pronto, registrado. Protocolo 202609118804. A senhora recebe a confirmação por SMS agora e por e-mail até amanhã.
Cliente: Deixa eu ver... chegou o SMS.
Operador: Ótimo. Nele tem o resumo: suspensão a partir de 28/09, até 120 dias, sem cobrança, sem multa, reativação gratuita.
Cliente: Perfeito. E pra reativar, eu ligo?
Operador: Pode ligar, pode fazer pelo app ou pelo WhatsApp da Conecta. Em qualquer um, a gente agenda a instalação no endereço novo em até 5 dias úteis.
Cliente: E a velocidade lá é a mesma?
Operador: A mesma, 500 mega, mesmo valor de hoje.
Cliente: E se eu quiser mudar de plano na reativação?
Operador: Pode mudar, sem problema. Na hora da reativação a gente vê o que faz mais sentido.
Cliente: Tá ótimo.
Operador: Ah, e uma coisa que às vezes esquecem: se a senhora tiver débito automático, ele fica pausado junto. Quando reativar, volta sozinho.
Cliente: Tenho débito automático sim. Então não preciso mexer?
Operador: Não precisa. Só confere se a fatura proporcional de outubro foi debitada, porque ela ainda é cobrada.
Cliente: Vou conferir.
Operador: E o app continua acessível durante a suspensão, pra ver fatura e protocolo.
Cliente: Bom, assim eu acompanho.
Operador: Deixa eu só confirmar seus contatos pra garantir que as comunicações cheguem. O celular final 4471 continua?
Cliente: Continua.
Operador: E o e-mail helena.g@ termina em gmail?
Cliente: Isso.
Operador: Perfeito. Algum outro serviço no contrato que eu precise olhar? Vejo aqui o Conecta TV.
Cliente: Ah, a TV. Suspende também?
Operador: Suspende junto, no mesmo protocolo. Quando reativar, volta junto.
Cliente: Ótimo.
Operador: Vou anotar também que o motivo é mudança temporária, pra quando reativar já ter todo o contexto e a senhora não precisar explicar de novo.
Cliente: Obrigada, isso ajuda.
Operador: Mais uma coisa: entre hoje e o dia 28 o serviço continua normal. Se por algum motivo a senhora precisar antecipar a suspensão, é só avisar que eu mudo a data.
Cliente: Tá bom.
Operador: Ficou alguma dúvida sobre valores, prazos ou sobre o equipamento?
Cliente: Não, você explicou tudo muito bem. Só uma curiosidade: a fatura proporcional vem quando?
Operador: Fecha dia 10 de outubro, com os 18 dias de setembro, e vence dia 20 de outubro, como sempre.
Cliente: Perfeito.
Operador: Posso ajudar em mais alguma coisa?
Cliente: Não, era isso. Muito obrigada, viu, você foi ótima.
Operador: Eu que agradeço, Helena. Anota o protocolo: 202609118804. Ao final da ligação tem uma pesquisa rápida, se puder responder, ajuda bastante. A Conecta agradece, boa mudança e boa tarde!
Cliente: Obrigada, tchau tchau.
`),
  },

  "DEMO-QA-INTERACTION-005": {
    reason: "Pedido de cancelamento por preço",
    length: "MEDIA",
    durationSeconds: 512,
    flags: { cancelamento: true, nota_ura: 2 },
    expectation: "Falha aparente de retenção: o operador não explora o motivo, não apresenta a oferta de retenção nem a alternativa de redução de plano, informa fidelidade de forma vaga e transfere sem contexto. Flag cancelamento coerente.",
    content: lines(`
Operador: Conecta, {{OPERADOR}} falando, boa tarde. Com quem eu falo?
Cliente: Boa tarde, é o Anderson Pires.
Operador: Me confirma o CPF?
Cliente: 644.870.219-06.
Operador: Tá. Localizei. O que precisa?
Cliente: Eu quero cancelar o meu plano de celular. O Pós 50GB. Está muito caro.
Operador: Tá. Quer cancelar hoje?
Cliente: Quero. Está R$ 139,90 e a concorrente me ofereceu 50 giga por R$ 89,90.
Operador: Entendi.
Cliente: Vocês não têm nada parecido?
Operador: Deixa eu ver aqui.
Cliente: Tá.
Operador: Um momento.
Cliente: Ok.
Operador: Então, o seu plano tem fidelidade.
Cliente: Fidelidade até quando?
Operador: Deixa eu ver... acho que até o ano que vem.
Cliente: Acha? Eu preciso saber a data.
Operador: Aqui não aparece a data certinha, mas tem fidelidade.
Cliente: E tem multa?
Operador: Tem.
Cliente: De quanto?
Operador: Depende do tempo que falta.
Cliente: E quanto tempo falta?
Operador: Não sei te dizer exato.
Cliente: Então como eu decido se cancelo ou não?
Operador: Você quer cancelar ou não?
Cliente: Eu quero saber se vocês têm alguma oferta antes.
Operador: Oferta é com a retenção.
Cliente: Então me passa pra retenção.
Operador: Vou passar. Mas antes, confirma que quer cancelar?
Cliente: Eu não confirmei nada ainda. Eu quero ouvir a proposta.
Operador: Tá, mas eu preciso registrar alguma coisa.
Cliente: Registra que eu pedi uma proposta.
Operador: Tá.
Cliente: E não dá pra reduzir o plano? Tipo, pra um de 20 giga?
Operador: Isso a retenção vê.
Cliente: Você não pode ver?
Operador: Não, é com eles.
Cliente: Tá bom. Me passa então.
Operador: Vou transferir. Aguarda na linha.
Cliente: Espera, e o protocolo?
Operador: Eles passam.
Cliente: Tá...
Operador: Transferindo.
`),
  },

  "DEMO-QA-INTERACTION-006": {
    reason: "Reparo de banda larga com oscilação",
    length: "LONGA",
    durationSeconds: 1690,
    flags: { tempo_silencio: 142 },
    expectation: "Troubleshooting COMPLETO e conforme: coleta de sintomas, verificação remota, testes guiados (cabo x Wi-Fi, reinício, canal), diagnóstico, resolução remota, orientação preventiva, encerramento com protocolo. Só flag técnica (tempo de silêncio das esperas).",
    content: lines(`
Operador: Conecta, {{OPERADOR}} falando, bom dia! Com quem eu falo?
Cliente: Bom dia. É o Everton Salles.
Operador: Tudo bem, Everton? Me confirma o CPF do titular, por favor?
Cliente: 738.552.106-41.
Operador: Obrigado. Localizei: Fibra 300 Mega, rua Monte Alegre, 57, Belo Horizonte. Confere?
Cliente: Confere.
Operador: Como posso ajudar?
Cliente: Minha internet está oscilando muito. Não chega a cair de vez, mas trava, principalmente à noite. Reunião pelo Meet congela, vídeo fica carregando.
Operador: Entendi. Só pra confirmar: a conexão não cai completamente, mas oscila com travamentos, mais à noite, e afeta principalmente vídeo e chamadas, certo?
Cliente: Exatamente.
Operador: Desde quando isso acontece?
Cliente: Uns dez dias, mais ou menos. Antes era tranquilo.
Operador: Mudou alguma coisa na casa nesse período? Aparelho novo, mudança de lugar do modem, obra?
Cliente: Comprei uma TV nova pro quarto, faz umas duas semanas. Mais nada.
Operador: Certo, isso pode ter relação. Vou verificar o equipamento daqui primeiro. Um momento, por favor.
Cliente: Tá.
Operador: Obrigado por aguardar. O modem está online, sinal óptico em -19 dBm, que é bom. Sem quedas registradas nos últimos 7 dias. Então o link até a sua casa está saudável.
Cliente: Então o problema é dentro de casa?
Operador: Provavelmente. Vamos confirmar com testes. Você está perto do modem agora?
Cliente: Estou no escritório, o modem fica na sala. Uns 8 metros.
Operador: Consegue fazer um teste de velocidade agora, no celular, aí do escritório?
Cliente: Consigo. Só um minuto.
Operador: Claro.
Cliente: Deu 48 mega de download.
Operador: Certo, 48 de 300. Agora, se puder, vai até a sala, perto do modem, e repete o teste.
Cliente: Tá, indo... Pronto. Deu 210 mega.
Operador: Ótimo, isso já diz muito: perto do modem a velocidade é boa, longe cai muito. Então a fibra está entregando, o gargalo é o alcance do Wi-Fi.
Cliente: Mas antes eu não tinha esse problema no escritório.
Operador: Por isso perguntei da TV. Vou verificar quantos aparelhos estão conectados agora.
Cliente: Tá.
Operador: Só um instante enquanto eu consulto aqui.
Cliente: Certo.
Operador: Voltei. Estão conectados 11 aparelhos. Sendo que a TV nova está na rede de 2.4 GHz, junto com o seu notebook e os celulares.
Cliente: E isso é ruim?
Operador: A rede de 2.4 alcança mais longe, mas é mais lenta e sofre mais interferência. A TV puxando vídeo nela o tempo todo congestiona pra todo mundo que está na mesma faixa.
Cliente: Faz sentido. À noite é quando a TV fica ligada.
Operador: Exato. Então vamos fazer dois ajustes. O primeiro é remoto: vou mudar o canal da rede de 2.4, que está no canal 6, com mais quatro redes vizinhas em cima dele.
Cliente: Tá.
Operador: Vou aplicar agora. O Wi-Fi vai cair por uns 30 segundos e voltar sozinho.
Cliente: Tá bom, avisa quando puder testar.
Operador: Aplicando... aguarda um momento.
Cliente: Tá.
Operador: Pronto, voltou. Pode testar de novo aí do escritório?
Cliente: Testando... 95 mega.
Operador: Já dobrou. Agora o segundo ajuste, que você faz na TV: conectar a TV na rede de 5 GHz em vez da 2.4. O nome da rede aparece com "5G" no final.
Cliente: A TV fica no quarto, longe do modem. Vai pegar?
Operador: Quantos metros, mais ou menos?
Cliente: Uns 6 metros, com uma parede.
Operador: Deve pegar sim. 5 GHz aguenta uma parede a essa distância. E mesmo que a TV fique com sinal um pouco menor, ela sai da faixa de 2.4 e libera a rede pro seu escritório.
Cliente: Vou fazer isso hoje à noite.
Operador: Ótimo. Terceira coisa, se quiser fazer o teste completo: o notebook do escritório está no Wi-Fi ou no cabo?
Cliente: Wi-Fi.
Operador: Se tiver como passar um cabo até ele, seria o ideal pra reunião. Cabo não sofre com interferência nenhuma.
Cliente: Tenho um cabo, mas é longe. Se o Wi-Fi resolver, prefiro.
Operador: Entendo. Deixa eu só confirmar mais duas coisas que ajudam no diagnóstico. O modem é o preto, modelo com quatro antenas, ou o branco, menor?
Cliente: O branco, menor.
Operador: Certo, esse é o modelo de 2022. Ele atende bem 300 mega, mas o alcance dele é mais curto que o de quatro antenas.
Cliente: Dá pra trocar por um melhor?
Operador: Dá. A troca pelo modelo de quatro antenas é gratuita pra contratos com mais de 12 meses, que é o seu caso. Se os ajustes de hoje não bastarem, é uma opção antes do repetidor.
Cliente: Bom saber. Vamos ver primeiro se resolve.
Operador: Combinado. Segunda pergunta: o notebook é antigo? Alguns modelos só pegam a rede 2.4.
Cliente: É de 2021, pega 5G sim, eu vejo as duas redes.
Operador: Ótimo. Então no notebook do escritório vale conectar na rede 5G também, e deixar a 2.4 só pros aparelhos que não têm opção.
Cliente: Vou fazer isso.
Operador: Consegue fazer agora, enquanto eu rodo o diagnóstico? Aí a gente já testa.
Cliente: Consigo. Deixa eu trocar aqui... conectei na 5G.
Operador: Testa a velocidade de novo, por favor.
Cliente: Rodando... 168 mega.
Operador: De 48 pra 168 no mesmo lugar. Só de sair da 2.4.
Cliente: Nossa, é muita diferença.
Operador: É a diferença entre as faixas. Agora vou rodar o diagnóstico completo da linha pra descartar qualquer outra coisa. Leva uns 2 minutos.
Cliente: Tá bom.
Operador: Vou pedir pra aguardar na linha, tá bem?
Cliente: Tá.
Operador: Alô, Everton?
Cliente: Oi.
Operador: Diagnóstico concluído: sem perda de pacote, latência de 9 milissegundos, sinal estável. Nada na rede externa.
Cliente: Então é o Wi-Fi mesmo.
Operador: É. E tem mais um detalhe que eu vi: o firmware do seu modem está uma versão atrás. Vou agendar a atualização pra madrugada, ela reinicia o aparelho sozinha por uns 3 minutos.
Cliente: Pode agendar.
Operador: Agendado pra hoje, 3h da manhã.
Cliente: E se depois disso tudo ainda oscilar?
Operador: Aí a gente parte pra duas opções: um repetidor Wi-Fi, que a Conecta fornece por R$ 9,90 ao mês, ou uma visita técnica pra avaliar o posicionamento do modem, sem custo.
Cliente: O modem fica num canto da sala, atrás da TV.
Operador: Atrás da TV é um dos piores lugares, a TV bloqueia bastante. Se conseguir deixar ele em cima de um móvel, no meio da sala, já melhora.
Cliente: Vou tentar. O cabo da fibra alcança até o meio da sala?
Operador: Normalmente sobra uns 2 metros de cabo. Se não alcançar, a visita técnica faz o remanejamento sem custo.
Cliente: Tá, vou medir aqui depois.
Operador: E não coloca o modem dentro de móvel fechado nem perto do micro-ondas, que interfere na 2.4.
Cliente: Ele fica longe da cozinha, isso é tranquilo.
Operador: Ótimo.
Operador: Deixa eu resumir tudo: canal do Wi-Fi ajustado agora, velocidade no escritório foi de 48 pra 95 mega; TV vai pra rede 5G hoje à noite; atualização do modem às 3h; e reposicionar o modem quando puder. Se em 48 horas ainda oscilar, liga que a gente agenda o técnico ou o repetidor.
Cliente: Perfeito, anotei tudo.
Operador: Vou registrar essas orientações no protocolo, pra quem atender depois já saber o que foi feito.
Cliente: Ótimo.
Operador: Ah, e um lembrete: pelo app da Conecta você consegue ver os aparelhos conectados e até trocar de canal sozinho, em "Minha rede Wi-Fi".
Cliente: Não sabia. Vou olhar.
Operador: Posso ajudar em mais alguma coisa?
Cliente: Não, era isso. Obrigado pela paciência.
Operador: Eu que agradeço, Everton. Anota o protocolo: 202609071153. Ao final tem uma pesquisa rápida, se puder responder, ajuda bastante. A Conecta agradece, tenha um ótimo dia!
Cliente: Obrigado, até mais.
`),
  },

  "DEMO-QA-INTERACTION-007": {
    reason: "Internet caindo após queda de energia",
    length: "MEDIA",
    durationSeconds: 640,
    flags: { tempo_silencio: 88, nota_ura: 3 },
    expectation: "Etapa NÃO CONFIRMÁVEL: o trecho em que o cliente reporta o resultado do reinício do modem está inaudível, e o operador segue sem repetir a confirmação. Um Agent de conformidade deve concluir 'não foi possível confirmar', não 'não conforme'.",
    content: lines(`
Operador: Bom dia, aqui é {{OPERADOR}} da Conecta. Com quem eu falo, por favor?
Cliente: Bom dia, Tatiane Xavier.
Operador: Tudo bem, Tatiane? Me confirma o CPF da titular?
Cliente: 291.760.438-92.
Operador: Obrigada. Localizei, Fibra 300 Mega em Goiânia. Como posso ajudar?
Cliente: Ontem à noite faltou luz aqui na rua, e desde que voltou a internet fica caindo. Fica uns minutos, cai, volta.
Operador: Entendi. Só pra confirmar: depois da queda de energia de ontem a conexão ficou instável, caindo e voltando, certo?
Cliente: Isso.
Operador: Vou verificar o equipamento. Um momento, por favor.
Cliente: Tá.
Operador: Obrigada por aguardar. O modem está online, mas registrou 9 reinícios desde as 22h de ontem. Isso é típico de equipamento que ficou instável depois de oscilação de energia.
Cliente: E o que faz?
Operador: Primeiro, um reinício limpo: desliga o modem da tomada, espera 30 segundos e liga de novo. Consegue fazer agora?
Cliente: Consigo, ele está aqui do lado. Desligando... tá, esperando.
Operador: Certo.
Cliente: Liguei. As luzes estão piscando.
Operador: Normal, leva uns 2 minutos pra estabilizar. Enquanto isso, o modem está ligado direto na tomada ou num filtro de linha?
Cliente: Num filtro de linha, junto com a TV.
Operador: Se puder, depois coloca ele direto na tomada. Filtro de linha antigo às vezes deixa passar oscilação.
Cliente: Tá bom.
Operador: Como estão as luzes agora?
Cliente: [trecho inaudível]
Operador: Certo. Vou medir o sinal daqui então. Só um instante.
Cliente: Tá.
Operador: [ruído na linha] ...está em -21, dentro do esperado. Sem perda de pacote nos últimos 3 minutos.
Cliente: Então voltou ao normal?
Operador: Pelo que eu vejo aqui, sim. Vou deixar o equipamento em monitoramento por 24 horas. Se ele reiniciar de novo, a gente agenda troca.
Cliente: E se cair hoje à noite?
Operador: Liga que a gente já abre a visita, sem novo diagnóstico. Fica anotado no protocolo.
Cliente: Tá bom.
Operador: Dúvida: a luz da fibra, a LOS, está apagada?
Cliente: Deixa eu ver... está apagada.
Operador: Ótimo, apagada é o certo. Verde fixa na PON?
Cliente: Verde sim.
Operador: Então está tudo certo com o sinal.
Cliente: Tá. E é normal isso acontecer quando falta luz?
Operador: Acontece com alguma frequência. Se for recorrente na sua rua, vale um nobreak pequeno só pro modem.
Cliente: Vou pensar nisso.
Operador: Posso ajudar em mais alguma coisa?
Cliente: Não, só isso mesmo.
Operador: Perfeito. Protocolo 202608244419, monitoramento de 24 horas ativo. Se puder, responde a pesquisa depois da ligação. Obrigada por entrar em contato com a Conecta, bom dia!
Cliente: Obrigada, tchau.
`),
  },

  "DEMO-QA-INTERACTION-008": {
    reason: "Cobrança após cancelamento e ameaça de reclamação",
    length: "LONGA",
    durationSeconds: 1250,
    flags: { detrator: true, rechamada: true, nota_ura: 1, contestacao: true },
    expectation: "Cliente detrator: terceira ligação sobre cobrança após cancelamento, ameaça Anatel/Procon, encerra insatisfeito. Falhas: operador minimiza, não localiza o protocolo anterior, não oferece estorno nem registro de reclamação formal, retorno prometido sem prazo nem responsável.",
    content: lines(`
Operador: Conecta, {{OPERADOR}} falando, boa tarde. Com quem eu falo?
Cliente: Boa tarde. Sérgio Amaral. E olha, eu já vou avisando que estou muito irritado.
Operador: Tá. Me confirma o CPF?
Cliente: 185.443.907-63.
Operador: Localizei. O que aconteceu?
Cliente: O que aconteceu é que eu cancelei a minha linha em junho. Junho. Tenho o protocolo aqui, 202606331570. E estou recebendo fatura em julho, agosto, e agora chegou a de setembro.
Operador: Hum.
Cliente: Três faturas de um serviço cancelado. E essa é a terceira vez que eu ligo. Nas outras duas disseram que ia resolver.
Operador: Entendi.
Cliente: Você entendeu? Então me diz o que vai fazer.
Operador: Deixa eu ver o cadastro.
Cliente: Vê.
Operador: Aqui a linha aparece ativa.
Cliente: Ativa? Eu cancelei em junho!
Operador: Pelo sistema está ativa.
Cliente: Eu tenho o protocolo do cancelamento. Você quer que eu repita? 202606331570.
Operador: Um momento.
Cliente: Tá.
Operador: Não estou achando esse protocolo.
Cliente: Como não está achando? Foi vocês que me deram.
Operador: Pode ser que esteja em outro sistema.
Cliente: Outro sistema? Que outro sistema?
Operador: Do cancelamento.
Cliente: Então olha no sistema do cancelamento.
Operador: Eu não tenho acesso a esse.
Cliente: Então pra que serve essa ligação?
Operador: Eu posso registrar a sua solicitação.
Cliente: Espera. Nas outras duas vezes vocês falaram que "alguém ia entrar em contato". Ninguém entrou. Você tem como ver isso aí?
Operador: Deixa eu olhar o histórico.
Cliente: Olha.
Operador: Consta uma ligação em julho e outra em agosto.
Cliente: E o que está escrito nelas?
Operador: "Cliente solicita cancelamento. Encaminhado."
Cliente: Encaminhado pra onde?
Operador: Não diz.
Cliente: Pois é. É exatamente isso que você vai escrever de novo agora, né?
Cliente: Registrar de novo? Já registraram duas vezes!
Operador: Mas dessa vez vai ser diferente.
Cliente: Diferente como?
Operador: Vou colocar como urgente.
Cliente: A da segunda vez também foi urgente.
Operador: Tá.
Cliente: Eu vou ser bem claro. Eu não vou pagar essas três faturas. E se isso for pra negativação, eu vou na Anatel e no Procon no mesmo dia.
Operador: Não precisa disso.
Cliente: Não precisa? Vocês estão me cobrando R$ 419,70 de um serviço que eu não uso desde junho!
Operador: Eu entendo.
Cliente: Você não entende, porque se entendesse resolvia.
Operador: Eu não tenho como cancelar daqui.
Cliente: Então quem tem?
Operador: A área de cancelamento.
Cliente: Então me transfere.
Operador: Eles não atendem por transferência.
Cliente: E como atendem?
Operador: Eu abro uma solicitação e eles retornam.
Cliente: Retornam quando?
Operador: No prazo deles.
Cliente: Que prazo é esse?
Operador: Não sei te dizer.
Cliente: Isso é uma piada.
Operador: Eu sinto muito.
Cliente: Sentir muito não paga a minha conta. Eu quero o estorno das faturas de julho e agosto, que eu paguei pra não sujar meu nome, e o cancelamento da de setembro.
Operador: Estorno eu não consigo fazer.
Cliente: Quem consegue?
Operador: A área financeira.
Cliente: E você pode abrir uma solicitação pra eles também?
Operador: Posso.
Cliente: Então abre.
Operador: Tá.
Cliente: E eu quero registrar uma reclamação formal contra esse atendimento todo, das três ligações.
Operador: Isso é na ouvidoria.
Cliente: E como eu chego na ouvidoria?
Operador: Pelo site.
Cliente: Você não pode registrar daqui?
Operador: Não.
Cliente: Nada você pode.
Operador: Eu posso registrar a solicitação de cancelamento.
Cliente: Tá. Registra. E me dá o protocolo.
Operador: Um momento.
Cliente: ...
Operador: Alô?
Cliente: Estou aqui.
Operador: O protocolo é 202609203388.
Cliente: 202609203388. E a solicitação de estorno, é outro protocolo?
Operador: É o mesmo.
Cliente: Mas você disse que era outra área.
Operador: Vai tudo no mesmo.
Cliente: Tá. E quem vai me retornar?
Operador: Alguém entra em contato.
Cliente: Alguém. Quando?
Operador: Assim que analisarem.
Cliente: Eu vou te dizer uma coisa: se em uma semana ninguém me ligar, eu vou abrir na Anatel, no Procon e no Reclame Aqui. E vou colocar o número desse protocolo em todos.
Operador: Tá certo.
Cliente: E a fatura de setembro, que vence dia 20? Eu pago ou não?
Operador: Se não pagar pode negativar.
Cliente: Vocês vão me negativar por uma cobrança indevida?
Operador: O sistema faz automático.
Cliente: Isso é um absurdo.
Operador: Eu sei.
Cliente: Você sabe e não faz nada.
Operador: Não tenho como.
Cliente: Tá bom. Já perdi quarenta minutos. Vou desligar.
Operador: Posso ajudar em mais alguma coisa?
Cliente: Você não ajudou em nada. Vou procurar meus direitos.
Operador: Tá. Protocolo 202609203388. A Conecta agradece a ligação.
Cliente: Agradece. Tchau.
`),
  },

  "DEMO-QA-INTERACTION-009": {
    reason: "Segunda via de fatura",
    length: "CURTA",
    durationSeconds: 176,
    flags: {},
    expectation: "Atendimento EXCELENTE e curto: resolve a segunda via, corrige a causa raiz (e-mail desatualizado), oferece o canal de autoatendimento e encerra com protocolo. Sem flag.",
    content: lines(`
Operador: Conecta, {{OPERADOR}} falando, bom dia! Com quem eu falo?
Cliente: Bom dia, é o Paulo Ventura.
Operador: Tudo bem, Paulo? Me confirma o CPF do titular, por favor?
Cliente: 507.229.116-84.
Operador: Obrigada. Localizei, Controle 20GB. Como posso ajudar?
Cliente: Preciso da segunda via da fatura desse mês. Não chegou no meu e-mail e vence amanhã.
Operador: Sem problema. Só confirmando: a fatura de setembro, R$ 54,90, vencimento dia 15. É essa?
Cliente: Essa mesma.
Operador: Vou enviar o código de barras por SMS agora pro número final 2093. Um instante.
Cliente: Tá.
Operador: Enviado. Chegou?
Cliente: Chegou sim.
Operador: Ótimo. E deixa eu ver por que não chegou no e-mail... O e-mail cadastrado é paulo.v87@ hotmail. Ainda usa esse?
Cliente: Não! Esse eu abandonei faz tempo. Por isso nunca chega.
Operador: Então essa é a causa. Quer atualizar agora? Me passa o e-mail atual.
Cliente: paulo.ventura@gmail.com.
Operador: Atualizado. Vai chegar um link de confirmação nele, é só clicar. A partir da próxima fatura ela chega no e-mail certo.
Cliente: Perfeito, resolveu duas coisas de uma vez.
Operador: Fica a dica: pelo app ou pelo WhatsApp da Conecta você pega a segunda via em segundos, sem precisar ligar.
Cliente: Vou salvar o WhatsApp.
Operador: Posso ajudar em mais alguma coisa?
Cliente: Não, era só isso. Obrigado pela atenção.
Operador: Eu que agradeço, Paulo. Protocolo 202609142250. A Conecta agradece, tenha um ótimo dia!
Cliente: Valeu, tchau.
`),
  },

  "DEMO-QA-INTERACTION-010": {
    reason: "Contestação de cobrança, pedido de cancelamento e rechamada",
    length: "LONGA",
    durationSeconds: 1518,
    flags: { contestacao: true, cancelamento: true, rechamada: true, tempo_silencio: 96, nota_ura: 4 },
    expectation: "Multidomínio: começa como contestação de cobrança (faturamento), o cliente cita ligação anterior (rechamada) e evolui pra pedido de cancelamento, revertido com oferta de retenção. Atendimento majoritariamente correto, com UMA falha: o operador promete retorno da análise sem informar prazo nem canal.",
    content: lines(`
Operador: Boa tarde, Conecta atendimento, meu nome é {{OPERADOR}}. Com quem tenho o prazer de falar?
Cliente: Boa tarde. Carolina Esteves.
Operador: Tudo bem, Carolina? Me confirma o CPF da titular, por favor?
Cliente: 362.708.514-29.
Operador: Obrigado. Localizei: Combo Fibra + TV, rua Almirante Barroso, 340, em Natal. Confere?
Cliente: Confere.
Operador: Como posso ajudar?
Cliente: Então, eu liguei semana passada por causa de uma cobrança de R$ 39,90 de um pacote de canais que eu não pedi. Protocolo 202609054471. Me disseram que ia estornar e cancelar. Chegou a fatura nova hoje e o pacote está lá de novo.
Operador: Entendo, Carolina, e peço desculpas por ter que ligar de novo. Vou localizar o protocolo anterior pra não recomeçar do zero.
Cliente: Por favor.
Operador: Um momento, por favor, vou verificar no sistema.
Cliente: Tá.
Operador: Obrigado por aguardar. Localizei o protocolo 202609054471, do dia 5. Consta a contestação registrada, mas o cancelamento do pacote "Canais Cinema" não foi concluído. Ficou pendente.
Cliente: Então a atendente não fez o que disse que ia fazer.
Operador: O registro ficou incompleto, sim. Vou corrigir isso agora. Só pra confirmar o que a senhora precisa: cancelar o pacote Canais Cinema, que não foi contratado, e estornar os R$ 39,90 cobrados em agosto e agora em setembro. Certo?
Cliente: Certo. São R$ 79,80 no total.
Operador: Isso. Primeiro o cancelamento, pra garantir que não vem mais. Só um instante.
Cliente: Tá.
Operador: Pronto, pacote cancelado, com efeito imediato. Vou te mandar a confirmação por SMS.
Cliente: Chegou aqui.
Operador: Agora o estorno. Como a contestação de agosto já estava registrada, eu incluo setembro no mesmo processo e reforço como reincidente, que tem prioridade.
Cliente: E cai como?
Operador: Como crédito na próxima fatura, que fecha dia 10 de outubro. Se por algum motivo a análise não concluir até lá, entra na seguinte.
Cliente: Tá. E a fatura de setembro, eu pago com o valor errado?
Operador: Não precisa. Vou gerar uma fatura ajustada só com o valor do combo, R$ 169,90, com o mesmo vencimento, dia 20.
Cliente: Ah, ótimo. Pode gerar.
Operador: Gerando... pronto. Código de barras enviado por SMS também.
Cliente: Recebi. Deixa eu conferir... R$ 169,90, vence 20 de setembro. Certo.
Operador: Perfeito. E a fatura original, de R$ 209,80, a senhora pode desconsiderar. Se pagar as duas por engano, o valor a mais vira crédito, mas é melhor pagar só a ajustada.
Cliente: Tá, vou pagar só essa. Eu tenho débito automático, isso atrapalha?
Operador: Boa pergunta. O débito automático puxaria a original. Vou pausar o débito só desta competência pra não cobrar em duplicidade.
Cliente: Ah, faz isso, por favor.
Operador: Pausado. Em outubro ele volta normal.
Cliente: Ótimo.
Operador: Deixa eu registrar tudo isso no protocolo antes de seguir. Um momento.
Cliente: Tá.
Operador: Obrigado por aguardar. Registrado.
Cliente: Agora, {{OPERADOR}}, deixa eu te falar uma coisa. Isso me deixou bem chateada. É a segunda vez que um serviço aparece na minha fatura sem eu pedir. Eu estou pensando seriamente em cancelar o combo inteiro.
Operador: Eu entendo, Carolina, e a chateação é legítima. Posso te perguntar: fora essas cobranças, o serviço em si, a internet e a TV, atendem bem?
Cliente: Atendem. A internet é boa, nunca tive problema. A TV eu uso pouco.
Operador: Então o incômodo é a confiança na fatura, não o serviço.
Cliente: É isso.
Operador: Deixa eu fazer duas coisas então. A primeira é uma proteção: vou ativar o bloqueio de contratação de serviços adicionais no seu contrato. Com isso, nenhum pacote, canal ou assinatura entra sem uma senha que só a senhora tem.
Cliente: Isso existe? Por que ninguém me ofereceu antes?
Operador: Existe, e deveria ter sido oferecido na primeira ligação. Ativando agora... pronto. A senha de autorização vai chegar por SMS.
Cliente: Chegou.
Operador: A segunda coisa: como a senhora disse que usa pouco a TV, talvez o combo não faça mais sentido. Tenho duas alternativas: manter o combo com 20% de desconto por 12 meses, ficando em R$ 135,90, ou migrar só pra Fibra 500 Mega por R$ 99,90, sem TV.
Cliente: Hum. Sem a TV eu perco o quê?
Operador: Os canais abertos e os 40 canais do pacote básico. Os aplicativos de streaming continuam funcionando normalmente na sua TV pela internet.
Cliente: Eu praticamente só uso streaming mesmo.
Operador: Então a Fibra 500 sozinha provavelmente te atende melhor e ainda economiza R$ 70,00 por mês.
Cliente: Setenta reais por mês é bastante. Mas deixa eu entender: e os aparelhos da TV? Eu tenho dois decodificadores, um na sala e um no quarto.
Operador: Os dois são retirados. E sem eles, a TV da sala e a do quarto continuam funcionando como smart TV, com os aplicativos, pela internet.
Cliente: A do quarto é mais velha, acho que não é smart.
Operador: Nesse caso ela precisaria de um aparelho tipo Chromecast ou Fire Stick, que não é da Conecta. Ou a senhora mantém o combo por causa dela.
Cliente: Hum. A do quarto quase ninguém usa, é do meu filho e ele vê tudo no celular.
Operador: Então provavelmente não faz falta.
Cliente: É, não faz.
Operador: Outra coisa que vale saber: no combo, o valor do pacote de canais era R$ 79,90 dentro dos R$ 169,90. Sem ele, a senhora paga só a fibra. Não tem nenhuma "taxa de desmembramento", nada disso.
Cliente: Tá. E se eu quiser um streaming pela Conecta? Vocês têm parceria com algum?
Operador: Temos. Pode incluir um streaming parceiro por R$ 24,90 na mesma fatura, sem fidelidade, cancela quando quiser. Mas eu só ativo se a senhora pedir, e agora com o bloqueio ativo, só com a sua senha.
Cliente: Não, por enquanto não. Depois eu vejo.
Operador: Combinado, não ativo nada.
Cliente: E tem fidelidade?
Operador: A migração não gera fidelidade nova. O valor de R$ 99,90 é de tabela, não é promoção, então não tem prazo pra acabar.
Cliente: E a velocidade sobe de 300 pra 500?
Operador: Sobe. O modem atual suporta, não precisa de troca.
Cliente: Deixa eu pensar um segundo.
Operador: Claro, sem pressa.
Cliente: Vamos fazer o seguinte: migra pra Fibra 500. Se eu sentir falta da TV, eu volto?
Operador: Pode voltar a qualquer momento, sem taxa de religação.
Cliente: Então pode migrar.
Operador: Registrando a migração... Só um instante.
Cliente: Tá.
Operador: Carolina, o sistema pediu uma confirmação por SMS pra migração, por ser alteração de plano. Chegou um código aí?
Cliente: Deixa eu ver... chegou, 8813.
Operador: Confirmado. Continuando o registro.
Cliente: Tá.
Operador: Pronto. Migração pra Fibra 500 Mega por R$ 99,90, ativa em até 24 horas. A TV é desligada junto. O decodificador a gente retira sem custo, quer agendar?
Cliente: Pode ser semana que vem, terça de manhã.
Operador: Agendado, terça, das 8h às 12h. O técnico liga antes.
Cliente: E se eu não estiver, meu filho pode entregar?
Operador: Pode, desde que seja maior de idade e apresente um documento. Vou anotar o nome dele: qual é?
Cliente: Gustavo Esteves.
Operador: Anotado como autorizado a entregar o equipamento.
Cliente: Ótimo.
Operador: Sobre a fatura: setembro vem a ajustada de R$ 169,90 que eu já gerei. Outubro vem proporcional, com os dias de combo e os dias de Fibra 500, mais o crédito dos R$ 79,80 se a análise concluir a tempo.
Cliente: Vai ficar meio confusa essa de outubro, né?
Operador: Vai ter algumas linhas, sim. Mas vou registrar no protocolo o que esperar, e se ela vier diferente disso, é só ligar com o número que eu vou te dar.
Cliente: Tá bom.
Operador: Sobre a análise do estorno: eu vou acompanhar e a senhora vai receber o retorno.
Cliente: Retorno quando? Por onde?
Operador: Assim que a análise concluir, a senhora vai ser avisada.
Cliente: Tá... vou ficar de olho então.
Operador: Deixa eu só confirmar o contato pras comunicações: celular final 7712 e e-mail carol.esteves@ gmail?
Cliente: Isso.
Operador: Perfeito. E mais uma vez, peço desculpas pelas duas cobranças e pela ligação anterior não ter concluído. Não era pra senhora ter precisado ligar de novo.
Cliente: Obrigada. Pelo menos hoje resolveu.
Operador: Vou resumir tudo: pacote Canais Cinema cancelado; contestação de R$ 79,80 reforçada como reincidente; fatura de setembro ajustada pra R$ 169,90; bloqueio de serviços adicionais ativo; migração pra Fibra 500 por R$ 99,90; retirada do decodificador terça de manhã.
Cliente: Isso mesmo.
Operador: Posso ajudar em mais alguma coisa?
Cliente: Não, era isso. Obrigada, viu. Bem diferente da última vez.
Operador: Eu que agradeço, Carolina. Anota o protocolo: 202609127706. Ao final tem uma pesquisa rápida, se puder responder, ajuda bastante. A Conecta agradece, tenha uma ótima tarde!
Cliente: Obrigada, tchau tchau.
`),
  },
}

export const CANONICAL_INTERACTION_IDS = Object.keys(CANONICAL_TRANSCRIPTS)

export function applyOperatorName(content: string, operatorFirstName: string): string {
  return content.replaceAll("{{OPERADOR}}", operatorFirstName)
}
