/**
 * V1.7.1f — o smoke REAL da V1.7.1e reproduzido offline: a transcrição enviada pela Central de Dados (SMOKE-V171E-CONTESTACAO-001),
 * a avaliação de processo devolvida pelo Especialista de Faturamento (gemini-3.8-flash, 1 chamada, sem edição) e as seções do
 * procedimento publicado que entraram no prompt dele (trechos literais da recuperação). Sem modelo.
 */
import type { PresentedKnowledgeExcerpt, PublishedKnowledgeDocument } from "../domain/process-assessment.js"

export const V171E_DOC_ID = "c8f2c818-72db-48dc-8d7d-d8a9fe861c65"
export const V171E_DOC_TITLE = "Procedimento Operacional — Contestação de Contas Móvel"
export const V171E_TRANSCRIPT = "Operador: Conecta, boa tarde, aqui é a Larissa. Com quem eu falo, por gentileza?\nCliente: Oi, Larissa, boa tarde. É a Patrícia, a linha tá no meu nome. Olha, minha fatura veio com um valor estranho esse mês e eu queria entender.\nOperador: Claro, Patrícia, vamos ver juntas. Só preciso confirmar seus dados primeiro. Quais são os três últimos números do seu CPF?\nCliente: 512.\nOperador: E a sua data de nascimento?\nCliente: 3 de março de 1988.\nOperador: Perfeito, obrigada. Me conta: qual fatura você está contestando e o que foi que veio diferente?\nCliente: A que venceu agora, de setembro. Eu pago sempre uns 65 reais e veio quase 85.\nOperador: Tá, só um instante que eu vou abrir aqui... Achei. Na fatura de setembro tem uma assinatura de um serviço de música, de R$ 19,90, que começou a cobrar em agosto.\nCliente: Serviço de música? Eu nunca contratei isso, não uso nada disso.\nOperador: Entendi. Nas faturas de julho e junho ela não aparece, é só nessa de setembro. Você chegou a pagar essa fatura já?\nCliente: Não, ainda não paguei, tava esperando resolver.\nOperador: Então tá. Vou abrir uma contestação desse valor pra equipe de faturamento analisar, tá bom?\nCliente: Tá. Mas isso vai continuar vindo?\nOperador: Dá pra eu cancelar essa assinatura agora pra não cobrar de novo. Você quer que eu cancele?\nCliente: Quero, pode cancelar sim.\nOperador: Prontinho, cancelei a assinatura aqui.\nCliente: E a fatura, eu pago como? Pago tudo ou espero?\nOperador: Então, isso a análise é que vai dizer, depois o pessoal te retorna.\nCliente: E quanto tempo mais ou menos demora isso?\nOperador: Ah, é só esperar mesmo, o setor vai dar uma olhada e logo, logo resolvem.\nCliente: Hum, tá bom.\nOperador: Anota o protocolo, por favor: 2026 0925 8841.\nCliente: Peraí... pronto, anotei.\nOperador: Mais alguma coisa em que eu possa te ajudar?\nCliente: Não, só isso mesmo.\nOperador: Então tá, Patrícia. Obrigada pela ligação e uma ótima tarde!"
export const V171E_PRESENTED: PresentedKnowledgeExcerpt[] = [
  {
    "documentId": "c8f2c818-72db-48dc-8d7d-d8a9fe861c65",
    "documentTitle": "Procedimento Operacional — Contestação de Contas Móvel",
    "heading": "5. Apresentação do operador",
    "excerpt": "**Exemplo recomendado:**\n\n“Olá, boa tarde! Meu nome é Juliana Prado, sou do atendimento Vivo. Com quem eu tenho o prazer de falar?”\n\nApós identificar o cliente:\n\n“Obrigada, Ricardo. Entendi que você não reconhece um valor da sua conta. Vou consultar o detalhamento e explicar o que encontrei.”\n\nEvitar:\n\n- “A conta está certa.”\n- “Se está na fatura, você contratou.”\n- “Você deve ter clicado em alguma coisa.”\n- “Primeiro precisa pagar.”\n- “Isso não pode ser contestado.”",
    "chunkIndex": 16
  },
  {
    "documentId": "c8f2c818-72db-48dc-8d7d-d8a9fe861c65",
    "documentTitle": "Procedimento Operacional — Contestação de Contas Móvel",
    "heading": "6. Escuta e identificação da solicitação",
    "excerpt": "O operador deverá permitir que o cliente explique:\n\n- Qual conta está questionando;\n- Qual cobrança não reconhece;\n- Qual valor esperava;\n- Qual valor foi faturado;\n- Quando percebeu a diferença;\n- Se a conta já foi paga;\n- Se já houve contato anterior;\n- Se a cobrança continua ocorrendo;\n- Se existe ameaça de bloqueio ou negativação;\n- Se há suspeita de fraude.\n\n**Exemplo:**\n\n“Para eu analisar corretamente, poderia me informar qual cobrança você não reconhece e em qual conta ela aparece?”\n\nDepois, confirmar o entendimento:\n\n“Entendi. Sua mensalidade habitual era de R$ 89,99, mas a conta atual veio em R$ 149,89 por causa de um serviço digital de R$ 59,90 que você não reconhece. Está correto?”",
    "chunkIndex": 17
  },
  {
    "documentId": "c8f2c818-72db-48dc-8d7d-d8a9fe861c65",
    "documentTitle": "Procedimento Operacional — Contestação de Contas Móvel",
    "heading": "51. Frases que devem ser evitadas",
    "excerpt": "- “Se está na conta, você usou.”\n- “A conta está certa.”\n- “Você deve ter clicado.”\n- “Primeiro paga e depois reclama.”\n- “Não tem como contestar.”\n- “Isso é automático.”\n- “Não posso fazer nada.”\n- “É só aguardar.”\n- “O sistema não erra.”\n- “Pode reclamar onde quiser.”\n- “Não sei quando resolve.”\n- “Ligue novamente.”\n- “O setor responsável vai ver.”",
    "chunkIndex": 67
  },
  {
    "documentId": "c8f2c818-72db-48dc-8d7d-d8a9fe861c65",
    "documentTitle": "Procedimento Operacional — Contestação de Contas Móvel",
    "heading": "15. Serviços digitais não reconhecidos",
    "excerpt": "Verificar:\n\n- Nome do serviço;\n- Valor;\n- Data de ativação;\n- Canal de contratação;\n- Recorrência;\n- Histórico de confirmação;\n- Linha em que foi ativado;\n- Cobranças anteriores.\n\nSe o cliente não reconhecer:\n\n1. Cancelar a recorrência, quando permitido;\n2. Registrar contestação;\n3. Analisar valores atuais e anteriores elegíveis;\n4. Ativar bloqueio preventivo, se disponível e autorizado;\n5. Explicar prazo;\n6. Orientar sobre conta ajustada;\n7. Registrar protocolo.\n\n**Exemplo:**\n\n“Como você não reconhece a assinatura, vou cancelar a renovação, registrar a contestação do valor e consultar a possibilidade de bloquear novas assinaturas desse tipo.”\n\nO bloqueio preventivo deverá ser autorizado pelo cliente.",
    "chunkIndex": 26
  },
  {
    "documentId": "c8f2c818-72db-48dc-8d7d-d8a9fe861c65",
    "documentTitle": "Procedimento Operacional — Contestação de Contas Móvel",
    "heading": "35. Prazo da análise",
    "excerpt": "O operador deverá informar o prazo exibido na ferramenta.\n\nComo referência operacional:\n\n- Ajuste dentro da alçada: durante o atendimento;\n- Emissão de conta ajustada: conforme processamento informado;\n- Análise de faturamento: preferencialmente em até cinco dias úteis;\n- Suspeita de fraude: conforme prazo da área especializada;\n- Pagamento não reconhecido: conforme prazo de conciliação;\n- Estorno: conforme forma de pagamento e processamento financeiro.\n\nSempre informar prazo de forma objetiva:\n\n“A contestação foi registrada hoje e será analisada em até cinco dias úteis. O retorno será enviado por SMS.”\n\nEvitar:\n\n- “É só aguardar.”\n- “Logo será resolvido.”\n- “O setor vai verificar.”\n- “Não sei o prazo.”",
    "chunkIndex": 51
  },
  {
    "documentId": "c8f2c818-72db-48dc-8d7d-d8a9fe861c65",
    "documentTitle": "Procedimento Operacional — Contestação de Contas Móvel",
    "heading": "46. Recapitulação obrigatória",
    "excerpt": "Antes de encerrar, informar:\n\n- Conta analisada;\n- Lançamento contestado;\n- Valor;\n- Ação realizada;\n- Serviço cancelado, quando aplicável;\n- Conta ajustada;\n- Valor a pagar;\n- Prazo;\n- Canal de retorno;\n- Protocolo.\n\n**Exemplo:**\n\n“Recapitulando: contestamos o serviço digital de R$ 29,90, cancelamos a renovação e ativamos o bloqueio preventivo autorizado. A conta ajustada de R$ 94,00 ficará disponível no App Vivo após o processamento. A análise será concluída em até cinco dias úteis. O protocolo é 202609130184.”",
    "chunkIndex": 62
  },
  {
    "documentId": "c8f2c818-72db-48dc-8d7d-d8a9fe861c65",
    "documentTitle": "Procedimento Operacional — Contestação de Contas Móvel",
    "heading": "47. Confirmação de entendimento",
    "excerpt": "Perguntar:\n\n- “As informações ficaram claras?”\n- “Ficou alguma dúvida sobre o valor que deve ser pago?”\n- “Posso esclarecer o prazo ou o acompanhamento?”\n- “Existe outra cobrança da mesma conta que você não reconhece?”\n\nEvitar encerrar apenas com “é só isso?”.",
    "chunkIndex": 63
  },
  {
    "documentId": "c8f2c818-72db-48dc-8d7d-d8a9fe861c65",
    "documentTitle": "Procedimento Operacional — Contestação de Contas Móvel",
    "heading": "48. Encerramento",
    "excerpt": "**Quando houver ajuste imediato:**\n\n“O valor foi corrigido e a conta ajustada ficará disponível no canal informado. Seu protocolo é 202609130184. Ficou alguma dúvida?”\n\n**Quando houver análise:**\n\n“A contestação foi registrada e será analisada no prazo informado. O retorno será enviado por SMS. Seu protocolo é 202609130184.”\n\n**Quando a cobrança for esclarecida:**\n\n“Confirmamos que o valor corresponde ao período e ao serviço detalhados. O protocolo deste atendimento é 202609130184. Posso ajudar em mais alguma questão?”",
    "chunkIndex": 64
  },
  {
    "documentId": "c8f2c818-72db-48dc-8d7d-d8a9fe861c65",
    "documentTitle": "Procedimento Operacional — Contestação de Contas Móvel",
    "heading": "55. Checklist do operador",
    "excerpt": "Antes de finalizar:\n\n- [ ] Ouvi a contestação completa?\n- [ ] Validei o titular?\n- [ ] Confirmei a conta questionada?\n- [ ] Identifiquei lançamento, valor e período?\n- [ ] Verifiquei se a conta foi paga?\n- [ ] Comparei contas anteriores?\n- [ ] Consultei alterações e contratações?\n- [ ] Expliquei a composição?\n- [ ] Identifiquei possível fraude?\n- [ ] Cancelei eventual recorrência indevida?\n- [ ] Solicitei autorização para bloqueios?\n- [ ] Apliquei ajuste dentro da alçada?\n- [ ] Abri análise quando necessário?\n- [ ] Informei o valor não contestado?\n- [ ] Emissão de conta ajustada foi avaliada?\n- [ ] Informei prazo e canal de retorno?\n- [ ] Registrei todos os fatos?\n- [ ] Forneci protocolo?\n- [ ] Recapitulei as ações?\n- [ ] Confirmei se restaram dúvidas?",
    "chunkIndex": 71
  }
]
/** Conteúdo publicado reconstituído das seções apresentadas (título da seção + trecho literal, na ordem do documento). */
export const V171E_CONTENT = ["# Procedimento Operacional — Contestação de Contas Móvel", "## 5. Apresentação do operador\n\n**Exemplo recomendado:**\n\n“Olá, boa tarde! Meu nome é Juliana Prado, sou do atendimento Vivo. Com quem eu tenho o prazer de falar?”\n\nApós identificar o cliente:\n\n“Obrigada, Ricardo. Entendi que você não reconhece um valor da sua conta. Vou consultar o detalhamento e explicar o que encontrei.”\n\nEvitar:\n\n- “A conta está certa.”\n- “Se está na fatura, você contratou.”\n- “Você deve ter clicado em alguma coisa.”\n- “Primeiro precisa pagar.”\n- “Isso não pode ser contestado.”", "## 6. Escuta e identificação da solicitação\n\nO operador deverá permitir que o cliente explique:\n\n- Qual conta está questionando;\n- Qual cobrança não reconhece;\n- Qual valor esperava;\n- Qual valor foi faturado;\n- Quando percebeu a diferença;\n- Se a conta já foi paga;\n- Se já houve contato anterior;\n- Se a cobrança continua ocorrendo;\n- Se existe ameaça de bloqueio ou negativação;\n- Se há suspeita de fraude.\n\n**Exemplo:**\n\n“Para eu analisar corretamente, poderia me informar qual cobrança você não reconhece e em qual conta ela aparece?”\n\nDepois, confirmar o entendimento:\n\n“Entendi. Sua mensalidade habitual era de R$ 89,99, mas a conta atual veio em R$ 149,89 por causa de um serviço digital de R$ 59,90 que você não reconhece. Está correto?”", "## 15. Serviços digitais não reconhecidos\n\nVerificar:\n\n- Nome do serviço;\n- Valor;\n- Data de ativação;\n- Canal de contratação;\n- Recorrência;\n- Histórico de confirmação;\n- Linha em que foi ativado;\n- Cobranças anteriores.\n\nSe o cliente não reconhecer:\n\n1. Cancelar a recorrência, quando permitido;\n2. Registrar contestação;\n3. Analisar valores atuais e anteriores elegíveis;\n4. Ativar bloqueio preventivo, se disponível e autorizado;\n5. Explicar prazo;\n6. Orientar sobre conta ajustada;\n7. Registrar protocolo.\n\n**Exemplo:**\n\n“Como você não reconhece a assinatura, vou cancelar a renovação, registrar a contestação do valor e consultar a possibilidade de bloquear novas assinaturas desse tipo.”\n\nO bloqueio preventivo deverá ser autorizado pelo cliente.", "## 35. Prazo da análise\n\nO operador deverá informar o prazo exibido na ferramenta.\n\nComo referência operacional:\n\n- Ajuste dentro da alçada: durante o atendimento;\n- Emissão de conta ajustada: conforme processamento informado;\n- Análise de faturamento: preferencialmente em até cinco dias úteis;\n- Suspeita de fraude: conforme prazo da área especializada;\n- Pagamento não reconhecido: conforme prazo de conciliação;\n- Estorno: conforme forma de pagamento e processamento financeiro.\n\nSempre informar prazo de forma objetiva:\n\n“A contestação foi registrada hoje e será analisada em até cinco dias úteis. O retorno será enviado por SMS.”\n\nEvitar:\n\n- “É só aguardar.”\n- “Logo será resolvido.”\n- “O setor vai verificar.”\n- “Não sei o prazo.”", "## 46. Recapitulação obrigatória\n\nAntes de encerrar, informar:\n\n- Conta analisada;\n- Lançamento contestado;\n- Valor;\n- Ação realizada;\n- Serviço cancelado, quando aplicável;\n- Conta ajustada;\n- Valor a pagar;\n- Prazo;\n- Canal de retorno;\n- Protocolo.\n\n**Exemplo:**\n\n“Recapitulando: contestamos o serviço digital de R$ 29,90, cancelamos a renovação e ativamos o bloqueio preventivo autorizado. A conta ajustada de R$ 94,00 ficará disponível no App Vivo após o processamento. A análise será concluída em até cinco dias úteis. O protocolo é 202609130184.”", "## 47. Confirmação de entendimento\n\nPerguntar:\n\n- “As informações ficaram claras?”\n- “Ficou alguma dúvida sobre o valor que deve ser pago?”\n- “Posso esclarecer o prazo ou o acompanhamento?”\n- “Existe outra cobrança da mesma conta que você não reconhece?”\n\nEvitar encerrar apenas com “é só isso?”.", "## 48. Encerramento\n\n**Quando houver ajuste imediato:**\n\n“O valor foi corrigido e a conta ajustada ficará disponível no canal informado. Seu protocolo é 202609130184. Ficou alguma dúvida?”\n\n**Quando houver análise:**\n\n“A contestação foi registrada e será analisada no prazo informado. O retorno será enviado por SMS. Seu protocolo é 202609130184.”\n\n**Quando a cobrança for esclarecida:**\n\n“Confirmamos que o valor corresponde ao período e ao serviço detalhados. O protocolo deste atendimento é 202609130184. Posso ajudar em mais alguma questão?”", "## 51. Frases que devem ser evitadas\n\n- “Se está na conta, você usou.”\n- “A conta está certa.”\n- “Você deve ter clicado.”\n- “Primeiro paga e depois reclama.”\n- “Não tem como contestar.”\n- “Isso é automático.”\n- “Não posso fazer nada.”\n- “É só aguardar.”\n- “O sistema não erra.”\n- “Pode reclamar onde quiser.”\n- “Não sei quando resolve.”\n- “Ligue novamente.”\n- “O setor responsável vai ver.”", "## 55. Checklist do operador\n\nAntes de finalizar:\n\n- [ ] Ouvi a contestação completa?\n- [ ] Validei o titular?\n- [ ] Confirmei a conta questionada?\n- [ ] Identifiquei lançamento, valor e período?\n- [ ] Verifiquei se a conta foi paga?\n- [ ] Comparei contas anteriores?\n- [ ] Consultei alterações e contratações?\n- [ ] Expliquei a composição?\n- [ ] Identifiquei possível fraude?\n- [ ] Cancelei eventual recorrência indevida?\n- [ ] Solicitei autorização para bloqueios?\n- [ ] Apliquei ajuste dentro da alçada?\n- [ ] Abri análise quando necessário?\n- [ ] Informei o valor não contestado?\n- [ ] Emissão de conta ajustada foi avaliada?\n- [ ] Informei prazo e canal de retorno?\n- [ ] Registrei todos os fatos?\n- [ ] Forneci protocolo?\n- [ ] Recapitulei as ações?\n- [ ] Confirmei se restaram dúvidas?"].join("\n\n")
export const V171E_PUBLISHED = new Map<string, PublishedKnowledgeDocument>([[V171E_DOC_ID, { documentId: V171E_DOC_ID, title: V171E_DOC_TITLE, content: V171E_CONTENT, version: 1 }]])
/** A avaliação EXATAMENTE como o parser de produção a devolveu (processAssessment do especialista). */
export const V171E_ASSESSMENT = {
  "processes": [
    {
      "product": null,
      "checkpoints": [
        {
          "status": "FOLLOWED",
          "guidance": {
            "text": "O operador deverá permitir que o cliente explique: Qual conta está questionando; Qual cobrança não reconhece; Se a conta já foi paga;",
            "source": "OFFICIAL_PROCEDURE"
          },
          "requirement": "Permitir que o cliente explique e verificar se a conta questionada já foi paga",
          "uncertainty": null,
          "evidenceType": "OBSERVED",
          "knowledgeQuote": "Se a conta já foi paga;",
          "transcriptEvidence": [
            "Operador: Me conta: qual fatura você está contestando e o que foi que veio diferente?",
            "Operador: Você chegou a pagar essa fatura já?"
          ],
          "knowledgeDetailQuote": "O operador deverá permitir que o cliente explique: Qual conta está questionando;"
        },
        {
          "status": "FOLLOWED",
          "guidance": {
            "text": "Se o cliente não reconhecer: 1. Cancelar a recorrência, quando permitido; 2. Registrar contestação;",
            "source": "OFFICIAL_PROCEDURE"
          },
          "requirement": "Cancelar a recorrência do serviço digital não reconhecido",
          "uncertainty": null,
          "evidenceType": "OBSERVED",
          "knowledgeQuote": "Cancelar a recorrência, quando permitido;",
          "transcriptEvidence": [
            "Operador: Dá pra eu cancelar essa assinatura agora pra não cobrar de novo. Você quer que eu cancele?",
            "Operador: Prontinho, cancelei a assinatura aqui."
          ],
          "knowledgeDetailQuote": "Se o cliente não reconhecer: 1. Cancelar a recorrência, quando permitido;"
        },
        {
          "status": "NOT_FOLLOWED",
          "guidance": {
            "text": "Sempre informar prazo de forma objetiva: “A contestação foi registrada hoje e será analisada em até cinco dias úteis. O retorno será enviado por SMS.” Evitar: “É só aguardar.” “Logo será resolvido.” “O setor vai verificar.” “Não sei o prazo.”",
            "source": "OFFICIAL_PROCEDURE"
          },
          "requirement": "Informar prazo da análise de forma objetiva",
          "uncertainty": null,
          "evidenceType": "OBSERVED",
          "knowledgeQuote": "Sempre informar prazo de forma objetiva:",
          "transcriptEvidence": [
            "Operador: Ah, é só esperar mesmo, o setor vai dar uma olhada e logo, logo resolvem."
          ],
          "knowledgeDetailQuote": "Análise de faturamento: preferencialmente em até cinco dias úteis;"
        },
        {
          "status": "NOT_FOLLOWED",
          "guidance": {
            "text": "Antes de encerrar, informar: Conta analisada; Lançamento contestado; Valor; Ação realizada; Serviço cancelado, quando aplicável; Conta ajustada; Valor a pagar; Prazo; Canal de retorno; Protocolo.",
            "source": "OFFICIAL_PROCEDURE"
          },
          "requirement": "Realizar a recapitulação obrigatória antes de encerrar o atendimento",
          "uncertainty": null,
          "evidenceType": "OMISSION",
          "knowledgeQuote": "Antes de encerrar, informar: Conta analisada; Lançamento contestado; Valor; Ação realizada; Serviço cancelado, quando aplicável; Conta ajustada; Valor a pagar; Prazo; Canal de retorno; Protocolo.",
          "transcriptEvidence": [
            "Operador: Anota o protocolo, por favor: 2026 0925 8841."
          ],
          "knowledgeDetailQuote": "Antes de encerrar, informar: Conta analisada; Lançamento contestado; Valor; Ação realizada; Serviço cancelado, quando aplicável; Conta ajustada; Valor a pagar; Prazo; Canal de retorno; Protocolo."
        }
      ],
      "documentTitle": "Procedimento Operacional — Contestação de Contas Móvel"
    }
  ],
  "validation": {
    "completeness": "COMPLETE",
    "invalidItems": [],
    "normalizations": [],
    "contractVersion": "PROCESS_ASSESSMENT_MODEL_CONTRACT_V2",
    "checkpointCapacity": [
      {
        "capacity": 40,
        "documentTitle": "Procedimento Operacional — Contestação de Contas Móvel",
        "presentedSteps": 89
      }
    ]
  },
  "applicability": []
} as const
/** O que o redator real devolveu no smoke (JSON válido, término STOP). */
export const V171E_WRITER_RAW = {
  "items": [
    {
      "slot": "ITEM_1",
      "observed": "Você informou que o cliente deveria aguardar a análise sem especificar um tempo definido para o retorno.",
      "whatYouCanDo": "Ao falar sobre a contestação, informe exatamente o prazo de análise que aparece para você no sistema.",
      "whyItMatters": "Informar o prazo de forma objetiva contribui para que o cliente tenha previsibilidade sobre o atendimento.",
      "suggestedResponse": "Vou registrar sua contestação agora. O prazo para a análise é de cinco dias úteis e o retorno será enviado por SMS."
    },
    {
      "slot": "ITEM_2",
      "observed": "Você perguntou ao cliente qual fatura ele questionava, o que causou o valor diferente e se ele já havia realizado o pagamento.",
      "whatYouCanDo": "Continue realizando essas perguntas exploratórias logo no início, pois elas ajudam a entender precisamente o que o cliente precisa resolver.",
      "whyItMatters": "",
      "suggestedResponse": ""
    },
    {
      "slot": "ITEM_3",
      "observed": "Você ofereceu o cancelamento da assinatura para evitar novas cobranças e declarou que realizou a ação após a concordância do cliente.",
      "whatYouCanDo": "Mantenha a prática de verificar se o cliente deseja cancelar a recorrência sempre que ele não reconhecer o serviço.",
      "whyItMatters": "",
      "suggestedResponse": ""
    }
  ],
  "presentation": {
    "closing": "Você realizou um bom acolhimento da demanda e o cancelamento do serviço conforme necessário. Para as próximas interações, lembre-se apenas de informar o prazo da análise de forma direta e objetiva.",
    "introduction": "Analisei o seu atendimento sobre contestação de cobrança. Você demonstrou uma boa condução ao escutar a solicitação do cliente e realizar o cancelamento da recorrência, porém, notei uma oportunidade quanto à forma como o prazo da análise foi passado. Vou detalhar o que aconteceu e como você pode conduzir essa etapa nas próximas chamadas."
  }
} as const
