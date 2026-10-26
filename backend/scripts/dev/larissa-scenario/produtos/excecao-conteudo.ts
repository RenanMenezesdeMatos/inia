/**
 * Teste da EXCEÇÃO dentro de uma base geral (22/10/2026, pedido do usuário): um processo de segunda via que vale para todos os produtos
 * do "grupo A" (aqui: Fixa Básica + Soluciona TI) e, numa seção própria, abre uma exceção para o Vivo Soluciona TI — no VSTI, a consulta,
 * o envio e o BKO do fluxo geral NÃO valem; a segunda via vai para o canal Y. A pergunta: a INIA entende as duas metades (a exceção vale
 * para o VSTI; o fluxo geral não vale para ele)? Conteúdo FICTÍCIO, marcado "TESTE PRODUTOS ·", nunca procedimento real.
 *
 * Agente de teste próprio, ligado SÓ a esta base (as bases separadas por produto do cenário não interferem). Chamadas EX01–EX03 com
 * `external_id` SCENARIO-PRODUTOS-EXnn, posteriores à base (o motor lê a base vigente na hora da chamada).
 */
import { PREFIX } from "./conteudo.js"
import type { NodeCode, ProductScenarioCall } from "./tipos.js"

const AVISO = "> Conteúdo fictício para teste do cadastro de produtos da INIA (22/10/2026). Não é procedimento real."

export const EXCECAO_DOCUMENT = {
  title: `${PREFIX} Segunda via — processo do grupo A (com exceção do VSTI)`,
  products: ["FIXA_BASICA", "SOLUCIONA_TI"] as NodeCode[],
  content: `${AVISO}

# Segunda via — processo do grupo A

Vale para todos os produtos do grupo A (Fixa Básica e Vivo Soluciona TI).

## Fluxo geral
1. Valide o titular antes de qualquer informação: pessoa física, CPF; empresa, CNPJ e o nome do responsável pelo contrato.
2. Consulte a fatura no sistema Faturas Fixo e informe ao cliente o valor e o vencimento.
3. Envie a segunda via para o e-mail cadastrado na conta e informe que ela chega em até 24 horas.
4. Se o cliente contestar algum valor da fatura, abra o encaminhamento ao BKO de Faturamento pelo sistema Chamados Fixo antes de enviar a segunda via.
5. Informe o número do protocolo antes de encerrar.

## Exceção — Vivo Soluciona TI (VSTI)
A segunda via do Vivo Soluciona TI não segue os itens 2, 3 e 4 do fluxo geral. Encaminhe a solicitação para a Central de Contratos TI, que envia a segunda via ao gestor do contrato em até 5 dias úteis, e informe esse prazo ao cliente. Não envie por e-mail e não informe o prazo de 24 horas. Os itens 1 e 5 continuam valendo.`,
}

export const EXCECAO_AGENT = {
  name: `${PREFIX} Especialista de segunda via (exceção)`,
  domain: "FATURAMENTO",
  objective: "Avaliar atendimentos de segunda via pelo processo do grupo A e pela exceção de cada produto.",
  description: "Agente de TESTE da exceção por produto dentro de uma base geral: lê só a base do processo do grupo A.",
  contextPrompt: `COMO LER UM ATENDIMENTO DE SEGUNDA VIA (teste da exceção)

1. Comece pelo pedido do cliente: a segunda via de qual conta, de qual serviço.
2. O processo do grupo A tem um fluxo geral e exceções por produto. Siga a exceção quando o produto do pedido for o da exceção; o fluxo geral, nos demais.
3. Avalie a validação do titular, o canal e o prazo informados e o protocolo no encerramento.`,
}

export const CHAMADAS_EXCECAO: ProductScenarioCall[] = [
  {
    key: "EX01",
    process: "SEGUNDA_VIA",
    date: "2026-10-22",
    time: "10:00",
    durationSeconds: 300,
    reason: "Segunda via",
    intent: {
      product: "A cliente pede a segunda via da fatura do aluguel dos notebooks (Vivo Tech = Vivo Soluciona TI).",
      expectedIdentification: "Vivo Soluciona TI",
      good: true,
      failures: [],
      note: "Segue a EXCEÇÃO certo: valida CNPJ e responsável, encaminha à Central de Contratos TI com prazo de até 5 dias úteis ao gestor e informa o protocolo. Não consulta valor no sistema, não envia por e-mail, não fala em 24 horas — e isso NÃO pode ser cobrado (os itens 2–4 não valem para o VSTI).",
    },
    lines: [
      "O: Vivo, bom dia, meu nome é {OPERADOR}. Com quem eu falo?",
      "C: Bom dia, é a Márcia Duarte, da Clínica Bem Viver.",
      "O: Olá, Márcia. Como posso ajudar?",
      "C: Preciso da segunda via da fatura do aluguel dos notebooks, o Vivo Tech. A deste mês não chegou.",
      "O: Claro. Me informa o CNPJ da clínica e o nome do responsável pelo contrato?",
      "C: CNPJ 18.402.733/0001-90. O responsável é o doutor Paulo Duarte.",
      "O: Obrigada, Márcia, cadastro confirmado. Para o Vivo Soluciona TI eu encaminho o pedido para a Central de Contratos TI, que envia a segunda via para o gestor do contrato em até cinco dias úteis.",
      "C: Ah, então chega para o doutor Paulo?",
      "O: Isso, para o gestor do contrato. Já encaminhei agora.",
      "C: Tá ótimo.",
      "O: O protocolo do atendimento é 202610221001. Quer anotar?",
      "C: Anotei.",
      "O: Ficou alguma dúvida, Márcia?",
      "C: Não, obrigada.",
      "O: Eu que agradeço. Bom dia.",
    ],
  },
  {
    key: "EX02",
    process: "SEGUNDA_VIA",
    date: "2026-10-22",
    time: "10:10",
    durationSeconds: 300,
    reason: "Segunda via",
    intent: {
      product: "O cliente pede a segunda via da fatura do aluguel de equipamentos (Vivo Soluciona TI).",
      expectedIdentification: "Vivo Soluciona TI",
      good: false,
      failures: ["EXCECAO_VSTI"],
      note: "Segue o FLUXO GERAL num pedido de VSTI: consulta valor e vencimento no sistema e envia por e-mail em até 24 horas, em vez de encaminhar à Central de Contratos TI (até 5 dias úteis ao gestor). A exceção deve ser cobrada; o fluxo geral não pode ser reconhecido como acerto (não vale para o VSTI).",
    },
    lines: [
      "O: Vivo, bom dia, meu nome é {OPERADOR}. Com quem eu falo?",
      "C: Bom dia, aqui é o Rogério Antunes, da Contabilidade Antunes.",
      "O: Olá, Rogério. Em que posso ajudar?",
      "C: Eu preciso da segunda via da fatura do aluguel de equipamentos. A gente aluga os computadores do escritório com vocês.",
      "O: Claro. Me informa o CNPJ e o nome do responsável pelo contrato?",
      "C: CNPJ 09.551.284/0001-37. O responsável sou eu mesmo, Rogério Antunes.",
      "O: Obrigada, Rogério, cadastro confirmado. Consultei aqui: a fatura deste mês é de mil duzentos e oitenta reais, com vencimento no dia trinta.",
      "C: Isso mesmo.",
      "O: Vou enviar a segunda via para o e-mail cadastrado na conta. Ela chega em até vinte e quatro horas.",
      "C: Perfeito.",
      "O: O protocolo do atendimento é 202610221011. Quer anotar?",
      "C: Anotado.",
      "O: Ficou alguma dúvida, Rogério?",
      "C: Não, era isso.",
      "O: Eu que agradeço. Bom dia.",
    ],
  },
  {
    key: "EX03",
    process: "SEGUNDA_VIA",
    date: "2026-10-22",
    time: "10:20",
    durationSeconds: 300,
    reason: "Segunda via",
    intent: {
      product: "O cliente pede a segunda via da conta da internet de casa (Banda Larga, do grupo A).",
      expectedIdentification: "Banda Larga",
      good: true,
      failures: [],
      note: "Segue o FLUXO GERAL certo: valida CPF, informa valor e vencimento, envia por e-mail em até 24 horas e informa o protocolo. A exceção do VSTI não se aplica (outro produto).",
    },
    lines: [
      "O: Vivo, boa tarde, meu nome é {OPERADOR}. Com quem eu falo?",
      "C: Boa tarde, é o Fábio Moreira.",
      "O: Olá, Fábio. Como posso ajudar?",
      "C: Preciso da segunda via da conta da internet lá de casa, a banda larga. Não recebi esse mês.",
      "O: Claro. Para a sua segurança, me informa o CPF do titular?",
      "C: 318.664.072-50.",
      "O: Obrigada, Fábio, titular validado. Consultei aqui: a conta deste mês é de cento e nove reais e noventa centavos, com vencimento no dia vinte e oito.",
      "C: Isso.",
      "O: Vou enviar a segunda via para o e-mail cadastrado na conta. Ela chega em até vinte e quatro horas.",
      "C: Beleza.",
      "O: O protocolo do atendimento é 202610221021. Quer anotar?",
      "C: Anotei.",
      "O: Ficou alguma dúvida, Fábio?",
      "C: Não, obrigado.",
      "O: Eu que agradeço. Boa tarde.",
    ],
  },
]
