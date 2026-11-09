/**
 * GABARITO da medição, fixado antes de comparar as versões. A página e os dados vêm do conteúdo escrito em `corpus.ts`, em
 * `chrome-corpus.html` e do texto de cada página dos manuais reais, nunca da saída do conversor.
 *
 * `sameChunk`: tudo isso precisa estar no MESMO trecho entre os primeiros resultados. `answerFacts`: o que a resposta precisa dizer.
 * `unanswerable`: a informação só existe em página sem texto: o certo é não afirmar o dado.
 */
export type GoldQuestion = {
  id: string
  doc: string
  kind: "simples" | "tabela" | "colunas" | "misto" | "escaneado" | "manual-real"
  question: string
  sameChunk: string[]
  answerFacts: string[]
  page: number
  /** Outras páginas onde o mesmo dado também está. */
  alsoOnPages?: number[]
  unanswerable?: boolean
}

export const GOLD: GoldQuestion[] = [
  { id: "S1", doc: "simples", kind: "simples", question: "Por quantos meses para trás posso emitir a segunda via da fatura?", sameChunk: ["últimos 12 meses"], answerFacts: ["12 meses"], page: 1 },
  { id: "S2", doc: "simples", kind: "simples", question: "Em quanto tempo o e-mail com a fatura chega ao cliente?", sameChunk: ["15 minutos"], answerFacts: ["15 minutos"], page: 2 },
  { id: "S3", doc: "simples", kind: "simples", question: "Qual é a taxa cobrada quando o cliente pede segunda via mais de uma vez no mês?", sameChunk: ["R$ 4,90"], answerFacts: ["4,90"], page: 3 },
  { id: "S4", doc: "simples", kind: "simples", question: "Para onde encaminho o cliente com fatura vencida há mais de 90 dias?", sameChunk: ["Recuperação de Crédito"], answerFacts: ["Recuperação de Crédito"], page: 3 },

  { id: "T1", doc: "manual-tabelas", kind: "tabela", question: "Qual é o prazo de reparo da Banda Larga Cabo?", sameChunk: ["Banda Larga Cabo", "48 horas"], answerFacts: ["48 horas"], page: 2 },
  { id: "T2", doc: "manual-tabelas", kind: "tabela", question: "Quanto custa a taxa de visita da TV por Assinatura?", sameChunk: ["TV por Assinatura", "R$ 25,00"], answerFacts: ["25,00"], page: 2 },
  { id: "T3", doc: "manual-tabelas", kind: "tabela", question: "Quem é o responsável pela análise de contestação de taxa de visita e qual o prazo?", sameChunk: ["Contestação de taxa de visita", "10 dias úteis", "Financeiro"], answerFacts: ["10 dias úteis", "Financeiro"], page: 3 },
  { id: "T4", doc: "manual-tabelas", kind: "tabela", question: "Qual é o crédito na fatura quando a demora do reparo fica entre 24 e 72 horas?", sameChunk: ["De 24 a 72 horas", "R$ 25,00"], answerFacts: ["25,00"], page: 4 },
  { id: "T5", doc: "manual-tabelas", kind: "tabela", question: "Qual é o limite mensal de crédito para demora de mais de 72 horas?", sameChunk: ["Mais de 72 horas", "R$ 120,00"], answerFacts: ["120,00"], page: 4 },
  { id: "T6", doc: "manual-tabelas", kind: "tabela", question: "Qual equipe atende em campo a tecnologia Satélite na região Sudeste e em quanto tempo?", sameChunk: ["Sudeste", "Satélite", "15 horas", "Equipe Sudeste 4"], answerFacts: ["15 horas", "Equipe Sudeste 4"], page: 6 },
  { id: "T7", doc: "manual-tabelas", kind: "tabela", question: "Em que prazo o atendimento em campo chega na região Norte com tecnologia Fibra?", sameChunk: ["Norte", "Fibra", "6 horas"], answerFacts: ["6 horas"], page: 5 },

  { id: "C1", doc: "duas-colunas-linha", kind: "colunas", question: "Qual o valor máximo da multa de cancelamento antecipado por linha?", sameChunk: ["nunca passa de R$ 300,00"], answerFacts: ["300,00"], page: 1 },
  { id: "C2", doc: "duas-colunas-linha", kind: "colunas", question: "Quantos meses de casa o cliente precisa ter para receber o desconto de fidelidade de 20%?", sameChunk: ["desconto de fidelidade de 20%", "mais de 24 meses"], answerFacts: ["24 meses"], page: 1 },
  { id: "C3", doc: "duas-colunas-linha", kind: "colunas", question: "Quais documentos são exigidos para cancelar por falecimento do titular?", sameChunk: ["falecimento do titular", "certidão de óbito"], answerFacts: ["certidão de óbito"], page: 2 },
  { id: "C4", doc: "duas-colunas-coluna", kind: "colunas", question: "Em quantos dias depois da contratação vale o direito de arrependimento nesse boletim?", sameChunk: ["7 dias", "direito de arrependimento"], answerFacts: ["7 dias"], page: 2 },

  { id: "M1", doc: "misto", kind: "misto", question: "O número do contrato é obrigatório na abertura do chamado corporativo?", sameChunk: ["número do contrato é obrigatório"], answerFacts: ["obrigatório"], page: 1 },
  { id: "M2", doc: "misto", kind: "misto", question: "Qual o prazo para trocar equipamento em comodato com defeito?", sameChunk: ["comodato", "5 dias úteis"], answerFacts: ["5 dias úteis"], page: 3 },
  { id: "M3", doc: "misto", kind: "misto", question: "Em quanto tempo precisa sair o aceite do responsável técnico para encerrar o chamado corporativo?", sameChunk: ["48 horas", "responsável técnico"], answerFacts: ["48 horas"], page: 5 },

  { id: "E1", doc: "escaneado", kind: "escaneado", question: "Qual é a multa por devolução atrasada de equipamento no regulamento digitalizado?", sameChunk: ["devolução atrasada"], answerFacts: [], page: 1, unanswerable: true },

  { id: "H1", doc: "manual-chrome-tags", kind: "tabela", question: "Qual oferta é permitida no cancelamento por mudança de endereço e em que prazo ele é concluído?", sameChunk: ["Mudança de endereço", "Transferência sem custo", "5 dias úteis"], answerFacts: ["Transferência sem custo", "5 dias úteis"], page: 1 },
  { id: "H2", doc: "manual-chrome-tags", kind: "colunas", question: "Qual o limite da multa proporcional na Regional Nordeste?", sameChunk: ["Regional Nordeste", "R$ 240,00"], answerFacts: ["240,00"], page: 2 },
  { id: "H3", doc: "manual-chrome-tags", kind: "tabela", question: "Em que prazo o valor é devolvido para quem pagou com boleto?", sameChunk: ["Boleto", "15 dias úteis"], answerFacts: ["15 dias úteis"], page: 3 },
  { id: "H4", doc: "manual-chrome-sem-tags", kind: "tabela", question: "Como é devolvido o valor pago no cartão de crédito no cancelamento?", sameChunk: ["Cartão de crédito", "2 faturas"], answerFacts: ["2 faturas"], page: 3 },
  { id: "H5", doc: "manual-chrome-sem-tags", kind: "colunas", question: "Na Regional Norte, qual a validade do código de postagem para devolver o modem?", sameChunk: ["Regional Norte", "30 dias corridos"], answerFacts: ["30 dias corridos"], page: 2 },
  { id: "H6", doc: "manual-chrome-sem-tags", kind: "tabela", question: "Qual o prazo para concluir o cancelamento por óbito do titular?", sameChunk: ["Óbito do titular", "1 dia útil"], answerFacts: ["1 dia útil"], page: 1 },

  // Ampliado depois da 1ª rodada sem IA: nos casos acima toda célula cabe em uma linha, e nada ali distingue as duas leituras. Célula que quebra é o normal nos manuais reais.
  { id: "W1", doc: "manual-tabelas", kind: "tabela", question: "Qual é o encaminhamento para lentidão em horário de pico?", sameChunk: ["Lentidão em horário de pico", "Engenharia de Capacidade em até 2 dias úteis"], answerFacts: ["Engenharia de Capacidade", "2 dias úteis"], page: 3 },
  { id: "W2", doc: "manual-tabelas", kind: "tabela", question: "Como identifico a falha de sinal intermitente?", sameChunk: ["Sinal intermitente", "Quedas repetidas no mesmo dia"], answerFacts: ["Quedas repetidas", "teste remoto"], page: 3 },
  { id: "W3", doc: "manual-chrome-tags", kind: "tabela", question: "Quem decide o cancelamento retroativo e em que prazo?", sameChunk: ["Cancelamento retroativo", "A área de Qualidade decide em até 5 dias úteis"], answerFacts: ["Qualidade", "5 dias úteis"], page: 1 },
  { id: "W4", doc: "manual-chrome-sem-tags", kind: "tabela", question: "Quando se aplica a devolução em dobro?", sameChunk: ["Devolução em dobro", "Cobrança feita depois da data de cancelamento"], answerFacts: ["data de cancelamento"], page: 1 },

  // Ampliado depois da 1ª rodada com IA: dado dentro de uma seção cujo título não o menciona. Foi onde o lado "depois" perdeu uma resposta (W4).
  { id: "X1", doc: "manual-chrome-sem-tags", kind: "tabela", question: "Em que situação o cliente tem direito à dispensa de multa no cancelamento?", sameChunk: ["Dispensa de multa", "três protocolos"], answerFacts: ["três protocolos", "60 dias"], page: 1 },
  { id: "X2", doc: "manual-chrome-sem-tags", kind: "tabela", question: "Quem decide o cancelamento retroativo?", sameChunk: ["Cancelamento retroativo", "área de Qualidade"], answerFacts: ["Qualidade"], page: 1 },
  { id: "X3", doc: "manual-tabelas", kind: "tabela", question: "O que faço quando o equipamento do cliente está sem energia?", sameChunk: ["Equipamento sem energia", "envio expresso"], answerFacts: ["envio expresso"], page: 3 },
  { id: "X4", doc: "manual-chrome-sem-tags", kind: "colunas", question: "Quanto é cobrado pelo modem não devolvido na Regional Norte?", sameChunk: ["Regional Norte", "R$ 180,00"], answerFacts: ["180,00"], page: 2 },

  { id: "R1", doc: "it-013", kind: "manual-real", question: "O backup agendado com agendar-backup.ps1 foi executado no ensaio?", sameChunk: ["agendar-backup.ps1", "Não executado"], answerFacts: ["Não executado"], page: 4, alsoOnPages: [35] },
  { id: "R2", doc: "it-013", kind: "manual-real", question: "O PostgreSQL 15 na mesma VM foi executado em que data e onde?", sameChunk: ["PostgreSQL 15", "14/10/2026"], answerFacts: ["14/10/2026"], page: 4 },
  { id: "R3", doc: "it-008", kind: "manual-real", question: "O que é a quarentena da Central de Dados?", sameChunk: ["Quarentena", "linhas recusadas"], answerFacts: ["recusadas"], page: 3, alsoOnPages: [66] },
  { id: "R4", doc: "it-008", kind: "manual-real", question: "Quando devo usar a forma de entrada API Push?", sameChunk: ["API Push", "envia os dados para a INIA"], answerFacts: ["envia os dados"], page: 3, alsoOnPages: [64] },
]

/** Relações de tabela: a linha e o valor na mesma linha da tabela, com o valor na coluna do cabeçalho. */
export type GoldRelation = { doc: string; row: string; header: string; value: string }
export const RELATIONS: GoldRelation[] = [
  { doc: "manual-tabelas", row: "Banda Larga Fibra", header: "Prazo de reparo", value: "24 horas" },
  { doc: "manual-tabelas", row: "Banda Larga Cabo", header: "Taxa de visita", value: "R$ 35,00" },
  { doc: "manual-tabelas", row: "IP Dedicado", header: "Canal de abertura", value: "Gerente de contas" },
  { doc: "manual-tabelas", row: "Reincidência em 30 dias", header: "Responsável", value: "Qualidade de Rede" },
  { doc: "manual-tabelas", row: "Troca de equipamento", header: "Prazo de análise", value: "5 dias úteis" },
  { doc: "manual-tabelas", row: "De 24 a 72 horas", header: "Limite mensal", value: "R$ 75,00" },
  { doc: "manual-tabelas", row: "Até 24 horas", header: "Crédito", value: "R$ 10,00" },
  { doc: "manual-chrome-tags", row: "Preço", header: "Oferta permitida", value: "Desconto de 15% por 6 meses" },
  { doc: "manual-chrome-tags", row: "Débito em conta", header: "Prazo de devolução", value: "10 dias úteis" },
  { doc: "manual-chrome-sem-tags", row: "Falha técnica recorrente", header: "Prazo para concluir", value: "3 dias úteis" },
  { doc: "manual-chrome-sem-tags", row: "Boleto", header: "Observação", value: "Conta informada pelo titular" },
  // Células que quebram em mais de uma linha (ampliado depois da 1ª rodada sem IA).
  { doc: "manual-tabelas", row: "Sinal intermitente", header: "Encaminhamento", value: "Abrir visita técnica em até 24 horas e avisar o cliente pelo aplicativo" },
  { doc: "manual-tabelas", row: "Equipamento sem energia", header: "Como identificar", value: "Luzes apagadas mesmo com a tomada testada pelo cliente durante a ligação" },
  { doc: "manual-chrome-tags", row: "Dispensa de multa", header: "Quem decide e como registrar", value: "O supervisor decide no mesmo dia e registra o número dos três protocolos na observação do pedido" },
  { doc: "manual-chrome-sem-tags", row: "Devolução em dobro", header: "Quando se aplica", value: "Cobrança feita depois da data de cancelamento já registrada no sistema, sem contestação anterior" },
  { doc: "it-008", row: "Quarentena", header: "O que é", value: "Onde ficam as linhas recusadas, com o motivo (linha, campo, código). Nunca entram \"pela metade\"." },
  { doc: "it-013", row: "Proxy de internet", header: "Situação", value: "Não executado de ponta a ponta. Só partes isoladas, fora do Windows, em 04/11/2026: o Node 24 e o build passam pelo proxy" },
]

/** Frases inteiras que precisam continuar na ordem, sem texto de outra coluna no meio (duas colunas e células que quebram). */
export const SENTENCES: { doc: string; text: string }[] = [
  { doc: "duas-colunas-linha", text: "O desconto de fidelidade de 20% é oferecido a clientes com mais de 24 meses de casa que pedem o cancelamento por preço" },
  { doc: "duas-colunas-linha", text: "A multa de cancelamento antecipado é proporcional aos meses que faltam para o fim da fidelização e nunca passa de R$ 300,00 por linha" },
  { doc: "duas-colunas-linha", text: "Clientes em área sem cobertura de fibra são isentos da multa quando apresentam o protocolo de inviabilidade técnica" },
  { doc: "duas-colunas-linha", text: "A portabilidade para outra operadora é concluída em até 3 dias úteis depois do pedido do cliente" },
  { doc: "duas-colunas-linha", text: "O cancelamento por falecimento do titular é isento de multa em qualquer caso e exige a certidão de óbito" },
  { doc: "duas-colunas-coluna", text: "A multa de cancelamento antecipado é proporcional aos meses que faltam para o fim da fidelização e nunca passa de R$ 300,00 por linha" },
  { doc: "duas-colunas-coluna", text: "Pedidos de cancelamento feitos em até 7 dias depois da contratação pela internet ou por telefone seguem o direito de arrependimento" },
  { doc: "manual-chrome-tags", text: "Na Regional Norte, a retirada do modem é feita pelos Correios: o cliente recebe um código de postagem válido por 30 dias corridos" },
  { doc: "manual-chrome-sem-tags", text: "Na Regional Sudeste, clientes com mais de 60 meses de casa podem pedir a dispensa da multa diretamente ao supervisor" },
  { doc: "manual-tabelas", text: "Quedas repetidas no mesmo dia, confirmadas pelo teste remoto da linha e pelo relato do cliente" },
  { doc: "manual-tabelas", text: "Registrar as medições e enviar para Engenharia de Capacidade em até 2 dias úteis" },
  { doc: "manual-chrome-tags", text: "Cliente com falha técnica comprovada em pelo menos três protocolos abertos nos últimos 60 dias corridos" },
  { doc: "manual-chrome-tags", text: "A Ouvidoria decide em até 10 dias úteis e comunica o cliente por carta registrada" },
  { doc: "manual-chrome-sem-tags", text: "Pedido anterior comprovado por protocolo, sem atendimento dentro do prazo informado ao cliente" },
  { doc: "it-008", text: "Onde ficam as linhas recusadas, com o motivo (linha, campo, código). Nunca entram \"pela metade\"." },
  { doc: "it-008", text: "A porta única por onde os dados do cliente entram na INIA. Nada entra \"por fora\"." },
  { doc: "it-013", text: "Não executado de ponta a ponta. Só partes isoladas, fora do Windows, em 04/11/2026: o Node 24 e o build passam pelo proxy" },
  { doc: "simples", text: "Durante o atendimento, confirme o endereço cadastrado" },
]

/** Títulos que o documento tem, para conferir se viraram seção. */
export const HEADINGS: Record<string, string[]> = {
  simples: ["Segunda via de fatura", "1. Quando emitir", "2. Canais disponíveis", "3. Envio por e-mail", "4. Passo a passo", "5. Fatura vencida", "6. Cobrança da emissão"],
  "manual-tabelas": ["Manual de prazos de reparo", "1. Como abrir a solicitação", "2. Prazos por produto", "3. Prazos de análise", "3.1 Encaminhamento por tipo de falha", "4. Créditos por demora", "5. Atendimento em campo por região"],
  "duas-colunas-linha": ["Boletim de regras de retenção"],
  "duas-colunas-coluna": ["Boletim de regras de retenção"],
  misto: ["Guia de atendimento a clientes corporativos", "1. Abertura do chamado", "3. Equipamentos em comodato", "5. Encerramento do chamado"],
  "manual-chrome-tags": ["Manual de cancelamento (exemplo)", "1. Motivos e tratamento", "2. Documentos exigidos", "2.1 Quem decide cada exceção", "3. Regras regionais", "4. Prazos de devolução de valores"],
  "manual-chrome-sem-tags": ["Manual de cancelamento (exemplo)", "1. Motivos e tratamento", "2. Documentos exigidos", "2.1 Quem decide cada exceção", "3. Regras regionais", "4. Prazos de devolução de valores"],
}
