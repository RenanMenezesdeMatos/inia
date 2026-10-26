/**
 * Chamadas FICTÍCIAS acrescentadas ao cenário "PRODUTOS" em 21/10/2026, depois da V3 (o operador dizer o produto basta): dois produtos na
 * mesma ligação, o cliente confirmando a pergunta de sim ou não do operador e o "achei aqui" sem dizer o que achou. Ficam DEPOIS das 15
 * primeiras na fila (`callsOf`), para não mudar o horário delas. `intent` é só documentação (o motor nunca o lê).
 */
import type { ProductScenarioCall } from "./tipos.js"

export const CHAMADAS_EXTRAS: ProductScenarioCall[] = [
  {
    key: "SV09",
    process: "SEGUNDA_VIA",
    date: "2026-10-21",
    time: "15:00",
    durationSeconds: 390,
    reason: "Segunda via",
    intent: {
      product:
        "Dois pedidos na mesma ligação: a conta do celular (a cliente diz “celular” e confirma o número) e “a outra conta de casa”, que só fica clara quando a operadora pergunta “é a da sua banda larga?” e a cliente responde “É sim”.",
      expectedIdentification: "Q1 Linha Móvel · Q2 Banda Larga (confirmação da cliente)",
      good: false,
      failures: ["LM1"],
      note: "Na conta do celular a operadora usa o procedimento da Banda Larga (e-mail, até 2 horas) em vez do SMS para a própria linha em até 10 minutos (LM1) — certo para a Banda Larga, errado para a Linha Móvel. Na conta da banda larga faz certo (e-mail cadastrado, até 2 horas — BL1). Titular validado, canal confirmado, protocolo e dúvidas ok. Prova que a regra de um produto não passa para o pedido do outro.",
    },
    lines: [
      "O: Vivo, bom dia, meu nome é {OPERADOR}. Com quem eu falo?",
      "C: Bom dia, é a Renata Campos.",
      "O: Olá, Renata. Como posso ajudar?",
      "C: Eu preciso da segunda via de duas contas: a do meu celular e a outra conta de casa. As duas sumiram do meu e-mail.",
      "O: Claro. Para a sua segurança, me informa o CPF do titular?",
      "C: 412.875.390-16.",
      "O: Obrigada, Renata, titular validado. Vamos começar pelo celular: a linha é a 11 97654-3210?",
      "C: Isso, essa mesma.",
      "O: A conta do celular deste mês é de oitenta e nove reais e noventa centavos, com vencimento no dia vinte e oito.",
      "C: Tá certo.",
      "O: O seu e-mail cadastrado é renata.campos@email.com, confere?",
      "C: Confere.",
      "O: Então eu vou mandar a segunda via do celular para esse e-mail. Ela chega em até duas horas.",
      "C: Tá bom.",
      "O: Agora a outra conta de casa. Aqui no seu CPF aparecem duas contas fixas. Essa de casa é a da sua banda larga?",
      "C: É sim.",
      "O: Certo. A da banda larga é de cento e dezenove reais, com vencimento no dia trinta. Vou mandar também para o mesmo e-mail cadastrado, e ela chega em até duas horas.",
      "C: Perfeito, as duas no mesmo e-mail então.",
      "O: Isso. Já enviei as duas. Anota, por favor, o protocolo: 202610211502.",
      "C: Anotado.",
      "O: Ficou alguma dúvida, Renata?",
      "C: Não, obrigada.",
      "O: Eu que agradeço. Tenha um ótimo dia.",
    ],
  },
  {
    key: "SV10",
    process: "SEGUNDA_VIA",
    date: "2026-10-21",
    time: "15:10",
    durationSeconds: 300,
    reason: "Segunda via",
    intent: {
      product:
        "A cliente (empresa) pede a segunda via “da conta da empresa”; a operadora pergunta “É o SIP de vocês?”, a cliente responde “não sei” e a operadora diz só “Achei aqui”, sem dizer o que achou nem o produto em nenhum momento.",
      expectedIdentification: "Não identificado (pergunta sem confirmação e “achei aqui” sem dizer o produto)",
      good: false,
      failures: [],
      note: "Valida CNPJ e responsável, confirma o e-mail cadastrado, envia, informa o protocolo e pergunta se ficou dúvida. Com o produto indefinido, as regras gerais são avaliadas e as de cada produto possível aparecem em “Depende do produto”, sem virar erro nem acerto. Falhas gerais que o roteiro não previa (achadas na análise real de 21/10): não diz em quanto tempo a segunda via chega (argumentário geral “confirmar canal e prazo”) e não agradece a espera ao voltar.",
    },
    lines: [
      "O: Vivo, boa tarde, meu nome é {OPERADOR}. Com quem eu falo?",
      "C: Boa tarde, é a Patrícia Lemos, do financeiro da Gráfica Ponto Fino.",
      "O: Olá, Patrícia. Em que posso ajudar?",
      "C: Eu preciso da segunda via da conta da empresa. O boleto deste mês não chegou.",
      "O: Claro. Me informa o CNPJ da empresa e o nome do responsável pelo contrato?",
      "C: CNPJ 27.664.103/0001-52. O responsável é o Sérgio Lemos.",
      "O: Obrigada, Patrícia, cadastro confirmado. É o SIP de vocês?",
      "C: Não sei te dizer, quem cuida da parte de telefonia é o pessoal da TI.",
      "O: Sem problema. Só um momento, vou localizar.",
      "C: Tá.",
      "O: Achei aqui. O e-mail cadastrado na conta é financeiro@pontofino.com.br, confere?",
      "C: Confere, é o nosso.",
      "O: Então vou mandar a segunda via para esse e-mail agora.",
      "C: Obrigada.",
      "O: O protocolo do atendimento é 202610211512. Quer anotar?",
      "C: Anotei.",
      "O: Ficou alguma dúvida, Patrícia?",
      "C: Não, era só isso.",
      "O: Eu que agradeço. Boa tarde.",
    ],
  },
]
