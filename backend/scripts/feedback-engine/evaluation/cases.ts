/**
 * BATERIA DE AVALIAÇÃO do motor de feedback — ENTRADAS (o que o runtime vê). Transcrições SINTÉTICAS escritas para exercitar
 * regras reais das bases publicadas (caminho padrão × exceção, pré-requisito, proibição, encerramento), com processos
 * DIFERENTES dos usados na calibração (Argumentário/Contestação). O gabarito fica em `ground-truth.json` e NUNCA é lido pelo
 * runtime nem entra em prompt — só pelo avaliador (`score-battery.ts`).
 */
export type EvaluationCase = {
  id: string
  /** Assunto registrado da chamada (o dado estruturado que ancora o processo). */
  reason: string
  /** Títulos das bases autorizadas para o especialista (lidas do dev, versão publicada atual, só leitura). */
  documents: string[]
  flags: { name: string; value: string }[]
  transcript: string[]
}

const SEGUNDA_VIA = ["Procedimento Operacional Segunda Via de Conta", "Checklist de Encerramento de Chamada", "Procedimento Operacional Jeito Vivo de Atender"]
const NEGOCIACAO = ["Procedimento Operacional Negociação de Débito", "Checklist de Encerramento de Chamada", "Procedimento Operacional Jeito Vivo de Atender"]

export const CASES: EvaluationCase[] = [
  {
    id: "SV1-caminho-correto-sinal-negativo",
    reason: "Segunda via de conta",
    documents: SEGUNDA_VIA,
    flags: [{ name: "nota_ura", value: "1" }],
    transcript: [
      "Operador: Vivo, boa tarde, meu nome é Paula. Com quem eu falo?",
      "Cliente: É a Marta. Preciso da segunda via da conta deste mês, perdi o boleto.",
      "Operador: Claro, Marta. Para sua segurança, me confirma o CPF do titular e a data de nascimento?",
      "Cliente: 123.456.789-00, nascida em 12 de março de 1980.",
      "Operador: Obrigada, validado. A segunda via da sua conta está disponível nos canais digitais da Vivo. Você tem o aplicativo Meu Vivo no celular?",
      "Cliente: Tenho, mas eu queria que vocês mandassem. Sempre é essa novela.",
      "Operador: Entendo. Vou te orientar agora e fico com você até aparecer. Abre o Meu Vivo, toca em Contas e depois em Segunda via.",
      "Cliente: Abri... cliquei em Contas. Apareceu a de setembro.",
      "Operador: Isso. Toca nela e depois em Baixar PDF. Você consegue ver o código de barras e o Pix?",
      "Cliente: Consegui, baixou aqui.",
      "Operador: Perfeito. Então a conta de setembro já está com você. O número do protocolo deste atendimento é 2026-0930-4411.",
      "Cliente: Anotado.",
      "Operador: Ficou alguma dúvida ou posso ajudar em mais alguma coisa?",
      "Cliente: Não, só isso. Mas continuo achando que vocês deviam mandar.",
      "Operador: Obrigada pelo retorno, Marta. Tenha uma boa tarde.",
    ],
  },
  {
    id: "SV2-caminho-errado-email-informado-na-chamada",
    reason: "Segunda via de conta",
    documents: SEGUNDA_VIA,
    flags: [{ name: "rechamada", value: "sim" }],
    transcript: [
      "Operador: Vivo, bom dia, aqui é o Diego. Em que posso ajudar?",
      "Cliente: Bom dia, preciso da segunda via da conta de agosto.",
      "Operador: Claro. Me confirma o CPF do titular?",
      "Cliente: 987.654.321-00.",
      "Operador: Certo, localizei. Qual e-mail eu mando a conta pra você?",
      "Cliente: Manda pro joao.pessoal@exemplo.com, é o do meu marido.",
      "Operador: Pronto, já mandei a conta de agosto para joao.pessoal@exemplo.com.",
      "Cliente: Chegou sim, obrigado.",
      "Operador: Posso ajudar em mais alguma coisa?",
      "Cliente: Não, obrigado.",
      "Operador: Tenha um bom dia.",
    ],
  },
  {
    id: "SV3-excecao-anatel-aplicada-corretamente",
    reason: "Segunda via de conta",
    documents: SEGUNDA_VIA,
    flags: [{ name: "detrator", value: "sim" }],
    transcript: [
      "Operador: Vivo, boa noite, meu nome é Renata. Com quem falo?",
      "Cliente: Aqui é o Paulo. Já tentei três vezes pegar a segunda via e não consigo. Se não resolverem hoje eu vou abrir reclamação na Anatel.",
      "Operador: Entendo, Paulo, e vou registrar essa manifestação no seu atendimento. Para seguir, me confirma o CPF do titular e a data de nascimento?",
      "Cliente: 111.222.333-44, 5 de junho de 1975.",
      "Operador: Obrigada. A conta é da linha final 4321, referência setembro, certo?",
      "Cliente: Isso, setembro.",
      "Operador: Como foi identificada uma situação excepcional neste atendimento, vou disponibilizar a segunda via pelo canal cadastrado. O e-mail cadastrado termina em ...ta@exemplo.com, está correto?",
      "Cliente: Está sim.",
      "Operador: Enviei agora a conta de setembro da linha final 4321 para esse e-mail cadastrado. Consegue verificar se chegou?",
      "Cliente: Chegou, estou vendo aqui.",
      "Operador: Registrei a menção à Anatel e o envio pelo e-mail cadastrado no protocolo 2026-0930-5520.",
      "Operador: Ficou alguma dúvida?",
      "Cliente: Não, resolvido.",
    ],
  },
  {
    id: "SV4-mesma-acao-sem-excecao",
    reason: "Segunda via de conta",
    documents: SEGUNDA_VIA,
    flags: [{ name: "rechamada", value: "sim" }],
    transcript: [
      "Operador: Vivo, boa tarde, meu nome é Renata. Com quem falo?",
      "Cliente: Aqui é o Paulo. Preciso da segunda via da conta de setembro.",
      "Operador: Claro, Paulo. Me confirma o CPF do titular e a data de nascimento?",
      "Cliente: 111.222.333-44, 5 de junho de 1975.",
      "Operador: Obrigada. A conta é da linha final 4321, referência setembro, certo?",
      "Cliente: Isso, setembro.",
      "Operador: Vou disponibilizar a segunda via pelo canal cadastrado. O e-mail cadastrado termina em ...ta@exemplo.com, está correto?",
      "Cliente: Está sim.",
      "Operador: Enviei agora a conta de setembro da linha final 4321 para esse e-mail cadastrado. Consegue verificar se chegou?",
      "Cliente: Chegou, estou vendo aqui.",
      "Operador: O protocolo é 2026-0930-5521. Ficou alguma dúvida?",
      "Cliente: Não, resolvido.",
    ],
  },
  {
    id: "SV5-falha-ferramenta-pre-requisito-omitido-e-promessa",
    reason: "Segunda via de conta",
    documents: SEGUNDA_VIA,
    flags: [{ name: "rechamada", value: "sim" }],
    transcript: [
      "Operador: Vivo, bom dia, meu nome é Carla.",
      "Cliente: Bom dia. O aplicativo dá erro quando eu tento baixar a conta.",
      "Operador: Tudo bem, não se preocupa. Me passa o CPF do titular?",
      "Cliente: 555.666.777-88.",
      "Operador: Certo. Vou te mandar a segunda via por SMS agora, já já chega no seu celular.",
      "Cliente: Tá bom, fico aguardando.",
      "Operador: Posso ajudar em algo mais?",
      "Cliente: Não.",
      "Operador: Obrigada, bom dia.",
    ],
  },
  {
    id: "SV6-transcricao-incompleta",
    reason: "Segunda via de conta",
    documents: SEGUNDA_VIA,
    flags: [{ name: "rechamada", value: "sim" }],
    transcript: [
      "Operador: Vivo, boa tarde, meu nome é Sílvia. Com quem eu falo?",
      "Cliente: É o Roberto. Quero a segunda via da conta.",
      "Operador: Claro, Roberto. Me confirma o CPF do titular e a data de nascimento?",
      "Cliente: 222.333.444-55, 1 de fevereiro de 1990.",
      "Operador: Obrigada, validado. A segunda via está disponível no aplicativo Meu Vivo. Você consegue abrir o aplicativo agora?",
      "Cliente: Deixa eu ver, estou abrindo...",
      "[TRANSCRIÇÃO INTERROMPIDA — falha na gravação]",
    ],
  },
  {
    id: "SV7-troca-de-falante-protocolo",
    reason: "Segunda via de conta",
    documents: SEGUNDA_VIA,
    flags: [{ name: "rechamada", value: "sim" }],
    transcript: [
      "Operador: Vivo, boa tarde, aqui é o Marcos.",
      "Cliente: Boa tarde, liguei ontem, o protocolo de ontem era 2026-0929-1188. Ainda não consegui a segunda via.",
      "Operador: Entendi. Me confirma o CPF do titular e a data de nascimento?",
      "Cliente: 333.444.555-66, 20 de outubro de 1985.",
      "Operador: Validado. A segunda via está no aplicativo Meu Vivo, em Contas e depois Segunda via. Você consegue abrir aí?",
      "Cliente: Abri. Achei a conta, baixei o PDF.",
      "Operador: Ótimo. Ficou alguma dúvida?",
      "Cliente: Não, obrigado.",
      "Operador: Por nada, boa tarde.",
    ],
  },
  {
    id: "ND1-promessa-de-desconto-fora-do-sistema",
    reason: "Negociação de débito",
    documents: NEGOCIACAO,
    flags: [{ name: "rechamada", value: "sim" }],
    transcript: [
      "Operador: Vivo, bom dia, meu nome é André. Com quem eu falo?",
      "Cliente: É a Luciana. Tenho duas contas atrasadas e quero negociar.",
      "Operador: Claro, Luciana. Me confirma o CPF do titular e a data de nascimento?",
      "Cliente: 444.555.666-77, 8 de agosto de 1988.",
      "Operador: Validado. Aqui aparecem as contas de julho e agosto, total de 312 reais.",
      "Cliente: Tem como fazer um desconto?",
      "Operador: Olha, vou ser sincero: consigo tirar todos os juros e fazer em cinco vezes sem entrada pra você, pode confiar que eu resolvo.",
      "Cliente: Nossa, ótimo! Então fecha.",
      "Operador: Fechado então. Vou registrar aqui.",
      "Cliente: Obrigada.",
      "Operador: Posso ajudar em mais alguma coisa?",
      "Cliente: Não.",
    ],
  },
  {
    id: "ND2-negociacao-assistida-completa-serasa",
    reason: "Negociação de débito",
    documents: NEGOCIACAO,
    flags: [{ name: "nota_ura", value: "5" }],
    transcript: [
      "Operador: Vivo, boa tarde, meu nome é Beatriz. Com quem eu falo?",
      "Cliente: É o Fernando. Recebi aviso do Serasa por causa de uma conta atrasada e quero resolver hoje.",
      "Operador: Entendo, Fernando. Para sua segurança, me confirma o CPF do titular e a data de nascimento?",
      "Cliente: 666.777.888-99, 30 de novembro de 1979.",
      "Operador: Obrigada. Você é o titular do contrato da linha final 7788, correto?",
      "Cliente: Sou eu mesmo.",
      "Operador: Verifiquei aqui: há um débito da conta de junho, de 189 reais, e o sistema mostra o apontamento. O sistema apresenta uma oferta: pagamento à vista de 150 reais por Pix, com vencimento amanhã, dia 1º de outubro.",
      "Cliente: Pode ser.",
      "Operador: Antes de confirmar, vou recapitular: o valor negociado é de 150 reais, referente à conta de junho, com desconto de 39 reais, pagamento único por Pix com vencimento em 1º de outubro. Se não for pago até essa data, o acordo é cancelado e o débito volta às condições originais. Após o pagamento, a baixa do débito ocorre no prazo que o sistema informa, de até 5 dias úteis. Você confirma que está de acordo?",
      "Cliente: Confirmo.",
      "Operador: Acordo registrado. Enviei o resumo para o seu e-mail cadastrado, final ...do@exemplo.com. O protocolo é 2026-0930-7712.",
      "Operador: Ficou alguma dúvida?",
      "Cliente: Não, tudo claro. Obrigado.",
    ],
  },
]
