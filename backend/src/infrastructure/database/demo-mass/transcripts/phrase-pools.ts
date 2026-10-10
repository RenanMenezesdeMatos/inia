import type { CallContext, Turn } from "./transcript-types.js"

/** Marca fictícia usada em todas as transcrições geradas. */
export const BRAND = "Conecta"

export const op = (text: string): Turn => ({ speaker: "Operador", text })
export const cl = (text: string): Turn => ({ speaker: "Cliente", text })

/** "senhor"/"senhora" + nome, conforme o gênero do cliente. */
export function honorific(ctx: CallContext): string {
  return ctx.customerGender === "F" ? "senhora" : "senhor"
}
export function Honorific(ctx: CallContext): string {
  return ctx.customerGender === "F" ? "Senhora" : "Senhor"
}
export function article(ctx: CallContext): string {
  return ctx.customerGender === "F" ? "a" : "o"
}

export const PLANS_B2C = ["Fibra 300 Mega", "Fibra 500 Mega", "Fibra 1 Giga", "Controle 20GB", "Pós 50GB", "Combo Fibra + TV", "Controle 12GB"]
export const PLANS_B2B = ["Empresa Fibra 600 Mega", "Empresa Fibra 1 Giga", "Combo Empresas 5 linhas", "Link Dedicado 200 Mega", "PME Conectada 400 Mega", "Corporate Voz + Dados"]
export const CITIES = ["Fortaleza", "Recife", "Salvador", "Belo Horizonte", "Curitiba", "Campinas", "Goiânia", "Natal", "São Luís", "Sorocaba", "Joinville", "Uberlândia", "Maceió", "Londrina", "Ribeirão Preto"]
export const COMPANIES = ["Padaria Pão Dourado", "Clínica Vida Plena", "Auto Peças Norte", "Escritório Ramos & Associados", "Mercado Bom Preço", "Transportadora Rota Sul", "Farmácia Saúde Já", "Academia Corpo Ativo", "Distribuidora Aliança", "Hotel Mirante", "Escola Novo Saber", "Construtora Horizonte"]
export const MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro"]

export const GREETINGS = [
  (ctx: CallContext) => `${BRAND}, ${ctx.operatorFirstName} falando, bom dia! Com quem eu falo?`,
  (ctx: CallContext) => `Boa tarde, ${BRAND} atendimento, meu nome é ${ctx.operatorFirstName}. Com quem tenho o prazer de falar?`,
  (ctx: CallContext) => `${BRAND}, boa tarde! Aqui é ${ctx.operatorFirstName}. Em que posso ajudar?`,
  (ctx: CallContext) => `Bom dia, aqui é ${ctx.operatorFirstName} da ${BRAND}. Com quem eu falo, por favor?`,
  (ctx: CallContext) => `Olá, boa tarde! ${ctx.operatorFirstName}, da ${BRAND}. Qual o seu nome?`,
]

export const CUSTOMER_INTRO = [
  (ctx: CallContext) => `Oi, bom dia. É ${ctx.customerFirstName}.`,
  (ctx: CallContext) => `Boa tarde. Meu nome é ${ctx.customerFirstName} ${ctx.customerSurname}.`,
  (ctx: CallContext) => `Alô? Oi, é ${ctx.customerFirstName}.`,
  (ctx: CallContext) => `Boa tarde, ${ctx.customerFirstName} ${ctx.customerSurname}, tudo bem?`,
  (ctx: CallContext) => `Aqui é ${ctx.customerFirstName}.`,
]

export const IDENTIFICATION = [
  (ctx: CallContext) => [
    op(`Tudo bem, ${ctx.customerFirstName}? Pra eu localizar o cadastro, pode me confirmar o CPF do titular?`),
    cl(`Claro. É o final ${ctx.random.int(10, 99)}, o número completo é... ${ctx.random.int(100, 999)}, ${ctx.random.int(100, 999)}, ${ctx.random.int(100, 999)}.`),
    op(`Obrigad${ctx.operatorGender === "F" ? "a" : "o"}. Só um instante que estou localizando.`),
    op(`Localizei aqui. ${Honorific(ctx)} ${ctx.customerFirstName}, pode me confirmar o endereço de instalação?`),
    cl(`É em ${ctx.city}, na rua das Palmeiras, ${ctx.random.int(10, 900)}.`),
    op(`Perfeito, confirmado.`),
  ],
  (ctx: CallContext) => [
    op(`Pois não, ${ctx.customerFirstName}. Pra gente seguir, me confirma o CPF ou o número da linha, por favor?`),
    cl(`O número é o (${ctx.random.int(11, 99)}) 9${ctx.random.int(1000, 9999)}-${ctx.random.int(1000, 9999)}.`),
    op(`Certo. E o CPF do titular, só os três primeiros dígitos?`),
    cl(`${ctx.random.int(100, 999)}.`),
    op(`Ótimo, cadastro localizado. ${Honorific(ctx)} ${ctx.customerFirstName} é ${article(ctx)} titular, correto?`),
    cl(`Sou sim.`),
  ],
  (ctx: CallContext) => [
    op(`Certo. Me confirma o CPF do titular da conta?`),
    cl(`Anota aí: ${ctx.random.int(100, 999)}.${ctx.random.int(100, 999)}.${ctx.random.int(100, 999)}-${ctx.random.int(10, 99)}.`),
    op(`Obrigad${ctx.operatorGender === "F" ? "a" : "o"}. E a data de nascimento?`),
    cl(`${ctx.random.int(1, 28)} de ${ctx.random.pick(MONTHS)} de ${ctx.random.int(1958, 1999)}.`),
    op(`Confirmado, ${ctx.customerFirstName}. Como posso ajudar?`),
  ],
]

export const IDENTIFICATION_B2B = [
  (ctx: CallContext) => [
    op(`Tudo bem, ${ctx.customerFirstName}? De qual empresa a ligação?`),
    cl(`${ctx.companyName}.`),
    op(`Certo. Pode me confirmar o CNPJ e se ${article(ctx)} senhor${ctx.customerGender === "F" ? "a" : ""} é gestor${ctx.customerGender === "F" ? "a" : ""} cadastrad${ctx.customerGender === "F" ? "a" : "o"} do contrato?`),
    cl(`Sou sim. O CNPJ termina em 0001-${ctx.random.int(10, 99)}, o início é ${ctx.random.int(10, 99)}.${ctx.random.int(100, 999)}.${ctx.random.int(100, 999)}.`),
    op(`Localizei o contrato da ${ctx.companyName}. Só confirmando: o e-mail cadastrado do gestor é o que termina em @${ctx.companyName!.split(" ")[0]!.toLowerCase().normalize("NFD").replace(/[^a-z]/g, "")}.com.br?`),
    cl(`Isso mesmo.`),
  ],
  (ctx: CallContext) => [
    op(`Pois não. Me passa o CNPJ da empresa, por favor?`),
    cl(`É o ${ctx.random.int(10, 99)}.${ctx.random.int(100, 999)}.${ctx.random.int(100, 999)}/0001-${ctx.random.int(10, 99)}, ${ctx.companyName}.`),
    op(`Certo, e o nome completo de quem está falando?`),
    cl(`${ctx.customerFirstName} ${ctx.customerSurname}, sou ${article(ctx)} responsável financeir${ctx.customerGender === "F" ? "a" : "o"}.`),
    op(`Confirmado como gestor${ctx.customerGender === "F" ? "a" : ""} do contrato. Em que posso ajudar?`),
  ],
]

export const HOLD_REQUEST = [
  "Um momento, por favor, vou verificar no sistema.",
  "Só um instante enquanto eu consulto aqui.",
  "Vou pedir pra aguardar na linha um minutinho, tá bem?",
  "Só um momento que estou abrindo a tela do contrato.",
  "Pode aguardar um instante enquanto eu confirmo isso?",
]
export const HOLD_ACK = ["Tá bom.", "Certo.", "Pode ser.", "Tá, eu aguardo.", "Ok.", "Uhum."]
/** "obrigado"/"obrigada" do OPERADOR e do CLIENTE, conforme o gênero de cada um. */
export const thanksOp = (ctx: CallContext): string => (ctx.operatorGender === "F" ? "obrigada" : "obrigado")
export const thanksCl = (ctx: CallContext): string => (ctx.customerGender === "F" ? "obrigada" : "obrigado")
const cap = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1)

export const HOLD_RETURN = [
  (ctx: CallContext) => `${cap(thanksOp(ctx))} por aguardar.`,
  (ctx: CallContext) => `Pronto, voltei. ${cap(thanksOp(ctx))} pela espera.`,
  () => "Desculpa a demora, já verifiquei.",
  (ctx: CallContext) => `Voltei aqui, ${thanksOp(ctx)} pela paciência.`,
  () => "Pronto, consegui a informação.",
]

export const CUSTOMER_ACK = ["Tá.", "Certo.", "Entendi.", "Uhum.", "Ok.", "Beleza.", "Sim.", "Tá certo."]
export const CUSTOMER_ACK_ANNOYED = ["Tá, mas isso já era pra ter sido resolvido.", "Certo. Mas olha, eu já perdi muito tempo com isso.", "Hum. Vamos ver.", "Tá. Só espero que dessa vez resolva."]

export const CLOSING_ASK = [
  "Posso ajudar em mais alguma coisa?",
  "Fico à disposição. Precisa de mais algum apoio hoje?",
  "Tem mais alguma dúvida que eu possa esclarecer?",
  "Consegui te ajudar com o que precisava? Fica alguma dúvida?",
]
export const CLOSING_NO = [
  (ctx: CallContext) => `Não, era só isso. ${cap(thanksCl(ctx))}.`,
  (ctx: CallContext) => `Não, só isso mesmo. ${cap(thanksCl(ctx))}.`,
  () => "Por enquanto é só.",
  () => "Não, tá ótimo. Valeu.",
  (ctx: CallContext) => `Só isso. ${cap(thanksCl(ctx))} pela atenção.`,
]
export const CLOSING_GOODBYE = [
  (ctx: CallContext) => `Eu que agradeço, ${ctx.customerFirstName}. Anota o protocolo desta ligação: ${ctx.protocol}. Ao final vai ter uma pesquisa rápida, se puder responder, ajuda bastante. A ${BRAND} agradece, tenha um ótimo dia!`,
  (ctx: CallContext) => `Perfeito. O protocolo do atendimento é ${ctx.protocol}. Se puder, responde a pesquisa depois da ligação. Obrigad${ctx.operatorGender === "F" ? "a" : "o"} por entrar em contato com a ${BRAND}, boa tarde!`,
  (ctx: CallContext) => `Combinado, ${ctx.customerFirstName}. Protocolo ${ctx.protocol}. A ${BRAND} agradece a ligação, tenha um bom dia.`,
  (ctx: CallContext) => `Ótimo. Anota aí o protocolo: ${ctx.protocol}. Qualquer coisa é só ligar de novo. Obrigad${ctx.operatorGender === "F" ? "a" : "o"}, até mais!`,
]
export const CUSTOMER_GOODBYE = [
  (ctx: CallContext) => `${cap(thanksCl(ctx))}, até mais.`,
  (ctx: CallContext) => `Tá, ${thanksCl(ctx)}. Tchau.`,
  () => "Valeu, tchau.",
  () => "Até logo.",
  (ctx: CallContext) => `${cap(thanksCl(ctx))}, viu. Tchau tchau.`,
]

export const CONFIRM_UNDERSTANDING = [
  (summary: string) => `Só pra eu confirmar se entendi: ${summary}, correto?`,
  (summary: string) => `Deixa eu ver se entendi direito: ${summary}. É isso?`,
  (summary: string) => `Certo. Então ${summary}, certo?`,
  (summary: string) => `Entendi. Resumindo, ${summary}, né?`,
]
export const CONFIRM_YES = ["Isso.", "Exatamente.", "É isso mesmo.", "Isso aí.", "Sim, exatamente isso.", "Correto."]

export const RECALL_OPENING = [
  (ctx: CallContext) => `Olha, eu já liguei ${ctx.random.pick(["ontem", "na semana passada", "anteontem", "na segunda"])} sobre isso, protocolo ${ctx.random.int(2026000000, 2026999999)}, e ninguém me deu retorno.`,
  (ctx: CallContext) => `Essa é a ${ctx.random.pick(["segunda", "terceira"])} vez que eu ligo pelo mesmo motivo. Da outra vez disseram que ia resolver em 48 horas.`,
  (ctx: CallContext) => `Eu liguei aí ${ctx.random.pick(["ontem", "semana passada"])} e a atendente falou que estava resolvido, mas não está.`,
  (ctx: CallContext) => `Já tenho um protocolo aberto, ${ctx.random.int(2026000000, 2026999999)}, e o problema continua igual.`,
]
export const RECALL_ACK = [
  (ctx: CallContext) => `Entendo, ${ctx.customerFirstName}, e peço desculpas pelo transtorno de ter que ligar de novo. Vou localizar o protocolo anterior pra não recomeçar do zero.`,
  (ctx: CallContext) => `Sinto muito por isso, ${ctx.customerFirstName}. Deixa eu ver o que foi registrado na última ligação.`,
  () => `Peço desculpas. Vou verificar o histórico aqui antes de qualquer coisa.`,
]

export const FILLER_EXCHANGES: ((ctx: CallContext) => Turn[])[] = [
  (ctx) => [op(`${ctx.customerFirstName}, o telefone de contato continua o mesmo do cadastro?`), cl(`Continua sim.`)],
  (ctx) => [op(`Só confirmando: o e-mail cadastrado termina em ${ctx.random.pick(["gmail.com", "hotmail.com", "outlook.com", "yahoo.com.br"])}?`), cl(`Isso, é esse mesmo.`)],
  () => [cl(`Alô? Ainda está aí?`), op(`Estou sim, só um momento.`)],
  () => [op(`Perdão, a linha deu uma falhada. Pode repetir?`), cl(`Eu perguntei se isso vai aparecer na próxima fatura.`), op(`Sim, vai aparecer na próxima.`)],
  () => [cl(`Só um minuto, deixa eu pegar a conta aqui.`), op(`Claro, sem problema.`), cl(`Pronto, achei. Pode continuar.`)],
  (ctx) => [op(`${ctx.customerFirstName}, ${article(ctx)} senhor${ctx.customerGender === "F" ? "a" : ""} prefere receber o comprovante por e-mail ou SMS?`), cl(`Pode ser por e-mail.`), op(`Certo, já registrei.`)],
  () => [cl(`Isso demora muito?`), op(`Não, mais uns dois minutinhos e a gente finaliza.`)],
  (ctx) => [op(`Enquanto carrega aqui: ${article(ctx)} senhor${ctx.customerGender === "F" ? "a" : ""} já usa o aplicativo da ${BRAND}?`), cl(`Uso pouco, na verdade.`), op(`Vale a pena, dá pra ver fatura e consumo por lá.`)],
  () => [cl(`Tá, e eu preciso fazer mais alguma coisa da minha parte?`), op(`Não, por enquanto não precisa.`)],
  () => [op(`Só mais um instante, o sistema está um pouco lento hoje.`), cl(`Tá bom.`)],
]

export const INAUDIBLE_NOTES = ["[trecho inaudível]", "[ruído na linha]", "[áudio cortado]", "[fala sobreposta, inaudível]"]

export const ANGRY_OPENERS = [
  "Olha, eu já estou muito irritado com isso.",
  "Eu vou ser sincera, estou perdendo a paciência.",
  "Isso é um absurdo, viu.",
  "Já estou cansado de ligar e nada.",
]
export const CALM_DOWN = [
  (ctx: CallContext) => `Entendo perfeitamente sua frustração, ${ctx.customerFirstName}, e vou fazer o possível pra resolver isso agora nesta ligação.`,
  (ctx: CallContext) => `Eu compreendo, ${ctx.customerFirstName}. Peço desculpas em nome da ${BRAND}. Vamos olhar isso juntos agora.`,
  () => `Sinto muito mesmo por isso. Vou registrar tudo e acompanhar o caso pessoalmente.`,
]
export const THREATS = [
  "Se não resolver hoje eu vou na Anatel e no Procon.",
  "Vou registrar reclamação no Reclame Aqui, pode ter certeza.",
  "Vou cancelar tudo e ainda vou abrir reclamação na Anatel.",
  "Eu vou levar isso pro Procon, isso é cobrança indevida.",
]
export const UNSATISFIED_CLOSING = [
  "Não resolveu nada. Vou ver o que eu faço.",
  "Tá, tá. Vou aguardar, mas já sei como isso termina.",
  "Não adianta, né. Tchau.",
  "Vocês sempre falam isso. Vou procurar meus direitos.",
]
export const SATISFIED_CLOSING = [
  (ctx: CallContext) => `Ah, agora sim. Muito ${thanksCl(ctx)}, viu, você foi ótim${ctx.operatorGender === "F" ? "a" : "o"}.`,
  (ctx: CallContext) => `Perfeito, resolveu mesmo. ${cap(thanksCl(ctx))} pela atenção.`,
  (ctx: CallContext) => `Nossa, que bom. ${cap(thanksCl(ctx))}, tá? Bem diferente da última vez.`,
  () => "Show, valeu mesmo. Excelente atendimento.",
]

/**
 * Aprofundamentos — trechos de 3 a 8 falas, cada um usado NO MÁXIMO uma vez por chamada, pra
 * chamadas médias/longas ganharem corpo sem repetir o mesmo "confirma o telefone" quatro vezes.
 */
export const DEEPENING_EXCHANGES: ((ctx: CallContext) => Turn[])[] = [
  (ctx) => [
    op(`Enquanto isso, deixa eu conferir se tem mais alguma pendência no contrato d${article(ctx)} senhor${ctx.customerGender === "F" ? "a" : ""}.`),
    cl(`Pode ver.`),
    op(`Consta uma fatura de ${ctx.random.pick(["março", "abril", "maio"])} paga com ${ctx.random.int(2, 9)} dias de atraso, mas quitada. Nada em aberto além da atual.`),
    cl(`Isso, aquela eu atrasei mesmo, mas paguei.`),
  ],
  (ctx) => [
    cl(`Ah, e eu tenho outra linha no meu nome, a do meu ${ctx.random.pick(["filho", "marido", "pai", "irmão"])}. Vale a mesma coisa pra ela?`),
    op(`Deixa eu ver... a linha final ${ctx.random.int(1000, 9999)}. Sim, ela está no mesmo contrato, então qualquer alteração que a gente faça aqui vale pras duas.`),
    cl(`Ótimo, então não preciso ligar de novo por ela.`),
    op(`Não precisa.`),
  ],
  (ctx) => [
    op(`Vou repetir o que ficou combinado até aqui pra ${article(ctx)} senhor${ctx.customerGender === "F" ? "a" : ""} confirmar.`),
    cl(`Pode repetir.`),
    op(`${ctx.random.pick(["A solicitação foi registrada", "O ajuste foi aplicado", "O pedido está em andamento"])}, o número do protocolo vai por SMS, e o prazo é o que eu te passei.`),
    cl(`Certo, confere.`),
  ],
  (ctx) => [
    cl(`Deixa eu perguntar uma coisa fora do assunto: ${ctx.random.pick(["vocês têm plano com TV?", "o aplicativo mostra o consumo em tempo real?", "dá pra pagar no débito automático?", "tem desconto pra pagar no Pix?"])}`),
    op(`${ctx.random.pick(["Tem sim, posso te mandar as opções por SMS depois.", "Mostra sim, na tela inicial do app.", "Dá, é só cadastrar em 'Pagamentos' no app.", "Tem 3% de desconto pagando até o vencimento pelo Pix."])}`),
    cl(`Ah, legal. Depois eu vejo isso.`),
  ],
  (ctx) => [
    op(`Só confirmando os dados de contato pra garantir que a comunicação chegue: celular final ${ctx.random.int(1000, 9999)} e e-mail ${ctx.customerFirstName.toLowerCase()}${ctx.random.int(1, 99)}@${ctx.random.pick(["gmail.com", "hotmail.com", "outlook.com"])}?`),
    cl(`Isso mesmo.`),
    op(`Perfeito.`),
  ],
  (ctx) => [
    cl(`E como eu acompanho isso depois? Eu não quero ter que ligar de novo.`),
    op(`Pelo aplicativo, em "Minhas solicitações", aparece o status do protocolo. E a cada mudança de status ${article(ctx)} senhor${ctx.customerGender === "F" ? "a" : ""} recebe um SMS.`),
    cl(`Tá, vou acompanhar por lá então.`),
  ],
  () => [
    cl(`Desculpa, minha ligação está falhando. Você consegue me ouvir?`),
    op(`Consigo sim, está um pouco picotado mas dá pra entender.`),
    cl(`Vou mudar de lugar aqui. Pronto, melhorou?`),
    op(`Melhorou bastante.`),
  ],
  (ctx) => [
    op(`Deixa eu registrar o motivo do contato certinho: vou colocar como "${ctx.random.pick(["dúvida de fatura", "solicitação de ajuste", "suporte técnico", "alteração contratual"])}". Está de acordo?`),
    cl(`Está.`),
  ],
  (ctx) => [
    cl(`Só uma dúvida: isso vai gerar alguma cobrança extra?`),
    op(`Não, ${ctx.customerFirstName}. Esse atendimento e essa alteração não têm custo.`),
    cl(`Ah, bom. Perguntei porque da última vez apareceu uma taxa.`),
    op(`Entendo. Se aparecer qualquer taxa que não combinamos, é só ligar informando este protocolo.`),
  ],
  (ctx) => [
    op(`${ctx.customerFirstName}, ${article(ctx)} senhor${ctx.customerGender === "F" ? "a" : ""} tem um minuto pra eu explicar como funciona o autoatendimento? Evita ligar da próxima vez.`),
    cl(`Rapidinho, pode ser.`),
    op(`No app, o menu "Ajuda" resolve segunda via, troca de senha do Wi-Fi, consulta de consumo e abertura de chamado técnico. Tudo com o mesmo login.`),
    cl(`Tá, vou olhar depois.`),
  ],
  (ctx) => [
    cl(`Eu preciso ir, estou no trabalho. Dá pra ser rápido?`),
    op(`Claro, ${ctx.customerFirstName}. Vou direto ao ponto.`),
  ],
  (ctx) => [
    op(`Só uma observação: o sistema mostra que o endereço de cobrança é diferente do de instalação. É proposital?`),
    cl(`É sim, a conta vai pro ${ctx.random.pick(["escritório", "endereço da minha mãe", "meu outro apartamento"])}.`),
    op(`Certo, então mantenho como está.`),
  ],
  (ctx) => [
    cl(`Vocês gravam essa ligação, né?`),
    op(`Gravamos sim, ${ctx.customerFirstName}, pra segurança d${article(ctx)} senhor${ctx.customerGender === "F" ? "a" : ""} e nossa. Tudo que combinamos fica registrado.`),
    cl(`Bom. Só pra garantir.`),
  ],
  (ctx) => [
    op(`Vejo que ${article(ctx)} senhor${ctx.customerGender === "F" ? "a" : ""} tem o débito automático cadastrado. Quer manter?`),
    cl(`${ctx.random.pick(["Quero manter.", "Na verdade eu queria tirar, prefiro pagar manual.", "Mantém."])}`),
    op(`Certo, anotado.`),
  ],
  (ctx) => [
    cl(`Aproveitando, o Wi-Fi da casa é o mesmo nome de sempre? Meu ${ctx.random.pick(["sobrinho", "filho", "vizinho"])} disse que não achava.`),
    op(`Deixa eu ver... a rede se chama "CONECTA-${ctx.random.int(1000, 9999)}". Se quiser, eu renomeio agora.`),
    cl(`Não precisa, era só pra confirmar.`),
  ],
]
