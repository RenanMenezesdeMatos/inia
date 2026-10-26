/**
 * Conteúdo FICTÍCIO do cenário "PRODUTOS — segunda via e reparo" (21/10/2026): bases de conhecimento e argumentários desenhados para testar
 * todas as formas de "Vale para" — geral, de uma categoria, de um produto só, de vários produtos da mesma categoria e de vários produtos de
 * categorias diferentes — com prazos e orientações que MUDAM por produto. Nada aqui é procedimento real.
 *
 * Mapa das regras (as chaves só aparecem aqui e em `intent.failures` das chamadas; o texto das bases é o que a operação leria):
 *   SEGUNDA VIA
 *     Geral (todos)            S1 validar o titular (CPF; empresa: CNPJ e nome do responsável) · S2 enviar só para canal CADASTRADO, confirmado
 *                              com o cliente · S3 informar o protocolo antes de encerrar · S4 perguntar se ficou alguma dúvida
 *     Fixa Básica (categoria)  FB1 informar valor e vencimento · FB2 vencimento hoje: oferecer o código de barras por SMS
 *     Linha analógica          LA1 sem e-mail cadastrado: segunda via impressa pelos Correios, até 5 dias úteis · LA2 a impressa não tem custo
 *     Banda Larga              BL1 por e-mail, chega em até 2 horas · BL2 (pode) oferecer a conta digital · BL3 internet + TV vêm na mesma fatura
 *     Linha Móvel              LM1 link por SMS para a PRÓPRIA linha, chega em até 10 minutos · LM2 (pode) oferecer o Pix · LM3 nunca para outro número
 *     Voz Avançada (SIP + DDR) VA1 vai ao e-mail do gestor do contrato, em até 1 dia útil · VA2 confirmar CNPJ e nome do gestor
 *     SIP                      SIP1 detalhamento de chamadas por tronco: Portal Empresas, em até 48 horas
 *     Dados + Soluciona TI     DS1 fatura no Portal Empresas; reenvio pelo gerente de contas em até 3 dias úteis · DS2 citar a LP (IP Dedicado,
 *     (IP Ded., Coloc., VSTI)  Colocation) ou o número do contrato (Vivo Soluciona TI) como referência
 *     Vivo Soluciona TI        VS1 nota fiscal do aluguel é separada da fatura; por e-mail em até 5 dias úteis após o fechamento · VS2 informar
 *                              a quantidade de equipamentos do contrato
 *   REPARO
 *     Geral (todos)            R1 confirmar titular e a linha/serviço afetado · R2 testes básicos do produto ANTES do chamado · R3 abrir o chamado
 *                              e informar protocolo e prazo do produto · R4 nunca prometer prazo diferente do procedimento do produto
 *     Linha analógica          RLA1 tom de discagem e outra tomada · RLA2 prazo 48 horas; visita com janela de 4 horas agendada com o cliente
 *     Banda Larga              RBL1 reiniciar o modem (30 s desligado) e ver as luzes · RBL2 prazo 24 horas; visita se o teste remoto falhar
 *     Linha Móvel              RLM1 cobertura no endereço e reiniciar o aparelho · RLM2 reconfigurar o APN · RLM3 NÃO há visita; análise de
 *                              rede em até 72 horas
 *     Voz Avançada (SIP + DDR) RVA1 teste remoto do tronco antes do chamado · RVA2 chamado com CNPJ e nome do contato técnico
 *     SIP                      RSIP1 prazo de 4 horas
 *     DDR                      RDDR1 confirmar a faixa de ramais afetada · RDDR2 prazo de 8 horas
 *     Dados Avançados (cat.)   RDA1 chamado no NOC com o número da LP · RDA2 pedir o resultado do ping/traceroute, quando houver
 *     IP Dedicado              RIPD1 prazo (SLA) de 4 horas
 *     Colocation               RCOLO1 prazo (SLA) de 2 horas · RCOLO2 acesso físico ao datacenter: agendar com 24 horas e informar os nomes
 *     Vivo Soluciona TI        RVS1 suporte remoto primeiro (com autorização) · RVS2 sem solução: troca do equipamento em até 5 dias úteis ·
 *                              RVS3 coleta do equipamento com defeito no mesmo dia da entrega do novo
 */
import type { TestArgumentScript, TestDocument } from "./tipos.js"

export const PREFIX = "TESTE PRODUTOS ·"
const AVISO = "> Conteúdo fictício para teste do cadastro de produtos da INIA (21/10/2026). Não é procedimento real."

/** O produto novo: uma categoria com um produto só, chamado de vários jeitos. */
export const SOLUCIONA_TI = {
  category: { code: "SOLUCIONA_TI", name: "Soluciona TI", description: "soluciona TI" },
  product: { code: "VIVO_SOLUCIONA_TI", name: "Vivo Soluciona TI", description: "VSTI, Vivo Soluciona TI, aluguel de equipamentos, Vivo Tech" },
} as const

export const DOCUMENTS: TestDocument[] = [
  // ---------------------------------------------------------------- SEGUNDA VIA
  {
    key: "SV-GERAL",
    process: "SEGUNDA_VIA",
    title: `${PREFIX} Segunda via — regras gerais`,
    products: [],
    content: `${AVISO}

# Segunda via — regras gerais (todos os produtos)

## Antes de informar qualquer dado da conta
1. Valide o titular: pessoa física, CPF do titular; empresa, CNPJ e o nome do responsável pelo contrato.
2. Só depois da validação informe valor, vencimento ou envie a segunda via.

## Envio
3. Envie a segunda via somente para um canal já cadastrado na conta (e-mail ou número). Confirme com o cliente qual é o canal antes de enviar.
4. Se o cliente pedir para enviar para um e-mail ou número que não está cadastrado, não envie: oriente a atualizar o cadastro primeiro.

## Encerramento
5. Informe o número do protocolo antes de encerrar.
6. Pergunte se ficou alguma dúvida.

O prazo e o canal da segunda via mudam conforme o produto — siga o procedimento do produto do cliente.`,
  },
  {
    key: "SV-FIXA",
    process: "SEGUNDA_VIA",
    title: `${PREFIX} Segunda via — Fixa Básica`,
    products: ["FIXA_BASICA"],
    content: `${AVISO}

# Segunda via — Fixa Básica (linha analógica e banda larga)

1. Informe ao cliente o valor e o vencimento da conta.
2. Se o vencimento for hoje, ofereça o código de barras por SMS para o pagamento sair no mesmo dia.
3. O canal e o prazo de envio dependem do produto: linha analógica e banda larga têm procedimentos próprios.`,
  },
  {
    key: "SV-LA",
    process: "SEGUNDA_VIA",
    title: `${PREFIX} Segunda via — Linha analógica`,
    products: ["LINHA_ANALOGICA"],
    content: `${AVISO}

# Segunda via — Linha analógica

1. A segunda via da linha analógica vai para o e-mail cadastrado. Se a conta não tiver e-mail cadastrado, a segunda via é impressa e enviada pelos Correios, no endereço da instalação, em até 5 dias úteis.
2. Informe ao cliente que a segunda via impressa não tem custo.`,
  },
  {
    key: "SV-BL",
    process: "SEGUNDA_VIA",
    title: `${PREFIX} Segunda via — Banda Larga`,
    products: ["BANDA_LARGA"],
    content: `${AVISO}

# Segunda via — Banda Larga

1. A segunda via da banda larga é enviada por e-mail e chega em até 2 horas.
2. Pode oferecer a conta digital (fatura sempre por e-mail), se o cliente ainda recebe em papel.
3. Quando o cliente tem internet e TV, explique que as duas vêm na mesma fatura.`,
  },
  {
    key: "SV-LM",
    process: "SEGUNDA_VIA",
    title: `${PREFIX} Segunda via — Linha Móvel`,
    products: ["LINHA_MOVEL"],
    content: `${AVISO}

# Segunda via — Linha Móvel

1. Envie o link da segunda via por SMS para a própria linha do cliente. O SMS chega em até 10 minutos.
2. Pode oferecer o código Pix para pagamento na hora.
3. Nunca envie o link para outro número, mesmo que o cliente peça.`,
  },
  {
    key: "SV-VOZ",
    process: "SEGUNDA_VIA",
    title: `${PREFIX} Segunda via — Voz Avançada (SIP e DDR)`,
    products: ["VOZ_AVANCADA"],
    content: `${AVISO}

# Segunda via corporativa — Voz Avançada (SIP e DDR)

1. Confirme o CNPJ e o nome do gestor do contrato.
2. A segunda via corporativa é enviada ao e-mail do gestor do contrato cadastrado, em até 1 dia útil.`,
  },
  {
    key: "SV-SIP",
    process: "SEGUNDA_VIA",
    title: `${PREFIX} Segunda via — SIP (detalhamento por tronco)`,
    products: ["SIP"],
    content: `${AVISO}

# Segunda via — SIP

1. Quando o cliente pedir o detalhamento das chamadas, informe que o detalhamento por tronco fica disponível no Portal Empresas em até 48 horas.`,
  },
  {
    key: "SV-DADOS-VSTI",
    process: "SEGUNDA_VIA",
    title: `${PREFIX} Segunda via — faturamento corporativo (IP Dedicado, Colocation e Vivo Soluciona TI)`,
    products: ["IP_DEDICADO", "COLOCATION", "VIVO_SOLUCIONA_TI"],
    content: `${AVISO}

# Segunda via — faturamento corporativo (IP Dedicado, Colocation e Vivo Soluciona TI)

1. A fatura fica disponível no Portal Empresas. Se o cliente pedir o reenvio, ele é feito pelo gerente de contas em até 3 dias úteis.
2. Use como referência o número da LP (IP Dedicado e Colocation) ou o número do contrato (Vivo Soluciona TI).`,
  },
  {
    key: "SV-VSTI",
    process: "SEGUNDA_VIA",
    title: `${PREFIX} Segunda via — Vivo Soluciona TI (aluguel de equipamentos)`,
    products: ["VIVO_SOLUCIONA_TI"],
    content: `${AVISO}

# Segunda via — Vivo Soluciona TI (aluguel de equipamentos)

1. A cobrança do aluguel de equipamentos tem nota fiscal de serviço separada da fatura. A nota é enviada por e-mail em até 5 dias úteis depois do fechamento.
2. Informe ao cliente a quantidade de equipamentos que consta no contrato.`,
  },
  // ---------------------------------------------------------------- REPARO
  {
    key: "RP-GERAL",
    process: "REPARO",
    title: `${PREFIX} Reparo — regras gerais`,
    products: [],
    content: `${AVISO}

# Reparo — regras gerais (todos os produtos)

1. Confirme o titular e qual linha ou serviço está com defeito.
2. Faça os testes básicos do produto antes de abrir o chamado.
3. Abra o chamado e informe ao cliente o protocolo e o prazo de solução do produto.
4. Nunca prometa um prazo diferente do que o procedimento do produto define.`,
  },
  {
    key: "RP-LA",
    process: "REPARO",
    title: `${PREFIX} Reparo — Linha analógica`,
    products: ["LINHA_ANALOGICA"],
    content: `${AVISO}

# Reparo — Linha analógica

1. Pergunte se há tom de discagem e peça para testar o aparelho em outra tomada.
2. O prazo de reparo é de 48 horas. Se precisar de visita técnica, agende com o cliente uma janela de 4 horas.`,
  },
  {
    key: "RP-BL",
    process: "REPARO",
    title: `${PREFIX} Reparo — Banda Larga`,
    products: ["BANDA_LARGA"],
    content: `${AVISO}

# Reparo — Banda Larga

1. Oriente o cliente a desligar o modem da tomada por 30 segundos, ligar de novo e dizer como ficaram as luzes.
2. O prazo de reparo é de 24 horas. Se o teste remoto falhar, ofereça a visita técnica.`,
  },
  {
    key: "RP-LM",
    process: "REPARO",
    title: `${PREFIX} Reparo — Linha Móvel`,
    products: ["LINHA_MOVEL"],
    content: `${AVISO}

# Reparo — Linha Móvel

1. Verifique a cobertura no endereço do cliente e peça para reiniciar o aparelho.
2. Reconfigure o APN do aparelho.
3. Linha móvel não tem visita técnica. Se o problema continuar, abra a análise de rede, com prazo de até 72 horas.`,
  },
  {
    key: "RP-VOZ",
    process: "REPARO",
    title: `${PREFIX} Reparo — Voz Avançada (SIP e DDR)`,
    products: ["VOZ_AVANCADA"],
    content: `${AVISO}

# Reparo — Voz Avançada (SIP e DDR)

1. Faça o teste remoto do tronco antes de abrir o chamado.
2. O chamado empresarial é aberto com o CNPJ e o nome do contato técnico do cliente.
3. O prazo de solução é o do produto (SIP ou DDR).`,
  },
  {
    key: "RP-SIP",
    process: "REPARO",
    title: `${PREFIX} Reparo — SIP`,
    products: ["SIP"],
    content: `${AVISO}

# Reparo — SIP

1. O prazo de solução do reparo de SIP é de 4 horas.`,
  },
  {
    key: "RP-DDR",
    process: "REPARO",
    title: `${PREFIX} Reparo — DDR`,
    products: ["DDR"],
    content: `${AVISO}

# Reparo — DDR

1. Confirme a faixa de ramais afetada.
2. O prazo de solução do reparo de DDR é de 8 horas.`,
  },
  {
    key: "RP-DADOS",
    process: "REPARO",
    title: `${PREFIX} Reparo — Dados Avançados (IP Dedicado e Colocation)`,
    products: ["DADOS_AVANCADOS"],
    content: `${AVISO}

# Reparo — Dados Avançados (IP Dedicado e Colocation)

1. Abra o chamado no NOC com o número da LP.
2. Peça ao cliente o resultado do teste de ping ou traceroute, quando ele tiver feito.
3. O prazo (SLA) é o do produto: IP Dedicado e Colocation têm prazos diferentes.`,
  },
  {
    key: "RP-IPD",
    process: "REPARO",
    title: `${PREFIX} Reparo — IP Dedicado`,
    products: ["IP_DEDICADO"],
    content: `${AVISO}

# Reparo — IP Dedicado

1. O prazo (SLA) de solução do IP Dedicado é de 4 horas.`,
  },
  {
    key: "RP-COLO",
    process: "REPARO",
    title: `${PREFIX} Reparo — Colocation`,
    products: ["COLOCATION"],
    content: `${AVISO}

# Reparo — Colocation

1. O prazo (SLA) de solução do Colocation é de 2 horas.
2. Se for preciso acesso físico ao datacenter, agende com 24 horas de antecedência e peça os nomes das pessoas autorizadas.`,
  },
  {
    key: "RP-VSTI",
    process: "REPARO",
    title: `${PREFIX} Reparo — Vivo Soluciona TI (aluguel de equipamentos)`,
    products: ["VIVO_SOLUCIONA_TI"],
    content: `${AVISO}

# Reparo — Vivo Soluciona TI (aluguel de equipamentos)

1. Faça primeiro o suporte remoto, com o acesso remoto autorizado pelo cliente.
2. Se o suporte remoto não resolver, abra a troca do equipamento: o prazo é de até 5 dias úteis.
3. A coleta do equipamento com defeito é feita no mesmo dia da entrega do novo.`,
  },
]

export const ARGUMENT_SCRIPTS: TestArgumentScript[] = [
  {
    key: "ARG-SV-GERAL",
    process: "SEGUNDA_VIA",
    name: `${PREFIX} Segunda via — confirmar canal e prazo`,
    products: [],
    trigger: "O cliente pede a segunda via da conta ou da fatura.",
    notApplicableWhen: "O cliente só quer saber o valor, sem pedir a segunda via.",
    guidance: [
      { text: "Confirmar com o cliente o canal cadastrado antes de enviar a segunda via.", modality: "MUST" },
      { text: "Oferecer o débito automático.", modality: "MAY" },
    ],
    requiredPoints: [{ mode: "ALL", items: ["O prazo em que a segunda via chega ao cliente.", "O número do protocolo."] }],
    avoid: ["Enviar a segunda via para um e-mail ou número que não está cadastrado."],
    suggestedScript: "Vou enviar a segunda via para o canal cadastrado. Ela chega em [prazo do produto]. Anote o protocolo: [número].",
  },
  {
    key: "ARG-SV-LM",
    process: "SEGUNDA_VIA",
    name: `${PREFIX} Segunda via de Linha Móvel por SMS`,
    products: ["LINHA_MOVEL"],
    trigger: "O cliente pede a segunda via da conta da linha móvel.",
    notApplicableWhen: null,
    guidance: [
      { text: "Enviar o link da segunda via por SMS para a própria linha do cliente.", modality: "MUST" },
      { text: "Oferecer o código Pix.", modality: "MAY" },
    ],
    requiredPoints: [{ mode: "ALL", items: ["O SMS chega em até 10 minutos."] }],
    avoid: ["Enviar o link para outro número."],
    suggestedScript: "Estou enviando agora o link da segunda via por SMS para a sua linha. Ele chega em até 10 minutos.",
  },
  {
    key: "ARG-SV-VOZ",
    process: "SEGUNDA_VIA",
    name: `${PREFIX} Segunda via corporativa — Voz Avançada`,
    products: ["VOZ_AVANCADA"],
    trigger: "Empresa cliente de SIP ou DDR pede a segunda via.",
    notApplicableWhen: null,
    guidance: [{ text: "Confirmar o CNPJ e o nome do gestor do contrato.", modality: "MUST" }],
    requiredPoints: [{ mode: "ALL", items: ["A segunda via chega ao e-mail do gestor do contrato em até 1 dia útil."] }],
    avoid: [],
    suggestedScript: null,
  },
  {
    key: "ARG-RP-BL",
    process: "REPARO",
    name: `${PREFIX} Reparo de Banda Larga — reinício orientado`,
    products: ["BANDA_LARGA"],
    trigger: "O cliente diz que a internet de casa parou ou está instável.",
    notApplicableWhen: null,
    guidance: [{ text: "Orientar o reinício do modem (30 segundos desligado) antes de abrir o chamado.", modality: "MUST" }],
    requiredPoints: [{ mode: "ALL", items: ["O prazo de reparo é de 24 horas."] }],
    avoid: ["Abrir o chamado sem fazer o teste."],
    suggestedScript: "Vamos fazer um teste rápido: desligue o modem da tomada, conte 30 segundos e ligue de novo.",
  },
  {
    key: "ARG-RP-DADOS",
    process: "REPARO",
    name: `${PREFIX} Reparo de Dados Avançados — NOC com a LP`,
    products: ["DADOS_AVANCADOS"],
    trigger: "Empresa cliente de IP Dedicado ou Colocation relata falha no serviço.",
    notApplicableWhen: null,
    guidance: [{ text: "Abrir o chamado no NOC com o número da LP.", modality: "MUST" }],
    requiredPoints: [{ mode: "ALL", items: ["O prazo (SLA) de solução do produto do cliente."] }],
    avoid: [],
    suggestedScript: null,
  },
  {
    key: "ARG-RP-VSTI",
    process: "REPARO",
    name: `${PREFIX} Reparo de equipamento alugado — Vivo Soluciona TI`,
    products: ["VIVO_SOLUCIONA_TI"],
    trigger: "O cliente do Vivo Soluciona TI relata defeito num equipamento alugado.",
    notApplicableWhen: null,
    guidance: [{ text: "Fazer o suporte remoto antes de abrir a troca.", modality: "MUST" }],
    requiredPoints: [{ mode: "ALL", items: ["A troca do equipamento acontece em até 5 dias úteis.", "A coleta do equipamento com defeito é no mesmo dia da entrega do novo."] }],
    avoid: ["Prometer troca imediata do equipamento."],
    suggestedScript: null,
  },
]

/** Os dois agentes especialistas do teste (um por processo), ligados só às bases do teste; escopo: o subgrupo da Larissa. */
export const AGENTS = {
  SEGUNDA_VIA: {
    name: `${PREFIX} Especialista de segunda via`,
    domain: "FATURAMENTO",
    objective: "Avaliar atendimentos de segunda via de conta pelos procedimentos do produto do cliente.",
    description: "Agente de TESTE do cadastro de produtos: lê só as bases de segunda via do cenário fictício.",
    contextPrompt: `COMO LER UM ATENDIMENTO DE SEGUNDA VIA (cenário de teste)

1. Comece pelo pedido do cliente: a segunda via de qual conta, de qual linha ou serviço.
2. O canal e o prazo da segunda via mudam conforme o produto. Siga o procedimento do produto do pedido e as regras gerais, que valem para todos.
3. Avalie a validação do titular antes de qualquer dado, o canal de envio confirmado e cadastrado, o prazo informado e o protocolo no encerramento.`,
  },
  REPARO: {
    name: `${PREFIX} Especialista de reparo`,
    domain: "SUPORTE",
    objective: "Avaliar atendimentos de reparo pelos procedimentos do produto do cliente.",
    description: "Agente de TESTE do cadastro de produtos: lê só as bases de reparo do cenário fictício.",
    contextPrompt: `COMO LER UM ATENDIMENTO DE REPARO (cenário de teste)

1. Comece pelo problema: o que parou de funcionar e em qual linha ou serviço.
2. Os testes, o prazo e a visita técnica mudam conforme o produto. Siga o procedimento do produto do pedido e as regras gerais, que valem para todos.
3. Avalie se os testes vieram antes do chamado, se o prazo informado é o do produto e se o protocolo foi informado.`,
  },
} as const

/** Os dois Workflows manuais do teste ("Executar agora" numa chamada): agente → Gerar feedback → Acompanhamento da pessoa. */
export const WORKFLOWS = {
  SEGUNDA_VIA: `${PREFIX} Feedback de segunda via (manual)`,
  REPARO: `${PREFIX} Feedback de reparo (manual)`,
} as const
