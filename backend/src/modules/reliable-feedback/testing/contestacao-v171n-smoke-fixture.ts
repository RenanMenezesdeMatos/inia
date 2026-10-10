/**
 * V1.7.1o — o smoke REAL da V1.7.1n reproduzido offline (SMOKE-V171N-CONTESTACAO-001, interação 70411f55, matrícula cc40e72c,
 * artefato 101452bf): transcrição enviada pela Central de Dados, avaliação de processo REAL do Especialista de Faturamento no
 * contrato V3 (gemini-3.8-flash, 1 chamada, 12 checkpointRefs válidos), os 12 trechos que entraram no prompt dele e a resposta REAL
 * do redator (gemini-3.1-flash-lite, 8 itens). Documentos publicados = os da fixture V1.7.1l (hash conferido com o banco:
 * Contestação b92888bb…, Checklist f3385323…, Jeito Vivo d4f89c1b…). Sem modelo.
 */
import type { PresentedKnowledgeExcerpt } from "../domain/process-assessment.js"
import type { RawProcessAssessment } from "../../agents/domain/process-assessment-contract.js"
export { V171L_PUBLISHED as V171N_PUBLISHED, V171L_DOC_TITLE as V171N_DOC_TITLE } from "./contestacao-v171l-smoke-fixture.js"

export const V171N_SUBJECT = "Contestação de cobrança"
export const V171N_COLLABORATOR_NAME = "Larissa Monteiro"
export const V171N_TRANSCRIPT = "Operador: Conecta, boa noite, você fala com a Larissa. Com quem eu falo?\nCliente: Boa noite, Larissa. É o Tiago Menezes, sou o titular da linha. Apareceu uma cobrança que eu não conheço na minha fatura.\nOperador: Vamos ver isso, Tiago. Pra eu localizar o cadastro, me confirma os quatro primeiros dígitos do CPF e a sua data de nascimento?\nCliente: 3174, e nasci em 3 de março de 1988.\nOperador: Obrigada, Tiago, cadastro confirmado. Me conta qual cobrança você não reconhece?\nCliente: Tem um tal de Clube Games Plus, de R$ 12,90, que eu nunca assinei.\nOperador: Achei aqui. É uma assinatura de jogos, contratada pelo aplicativo no dia 4 de agosto. Ela veio na fatura de agosto e na de setembro.\nCliente: Eu não baixei nada disso. Deve ter sido algum anúncio.\nOperador: Entendi. Você já pagou alguma dessas faturas?\nCliente: Paguei a de agosto. A de setembro vence semana que vem.\nOperador: Tá certo. Já desativei essa assinatura aqui, então ela não renova mais.\nCliente: Ótimo.\nOperador: E vou registrar a contestação dessas duas cobranças para o time de faturamento analisar.\nCliente: E quanto tempo isso leva?\nOperador: Olha, não consigo te passar um prazo certinho, isso varia bastante lá no setor.\nCliente: Hum, tá bom então.\nOperador: Resumindo, Tiago: a assinatura do Clube Games Plus foi desativada, a contestação das duas cobranças de R$ 12,90 está registrada e o seu protocolo é 2026 0926 5812.\nCliente: Tá, anotei.\nOperador: Ficou alguma dúvida sobre o que eu te expliquei?\nCliente: Não, tá tudo claro.\nOperador: Então tá. Obrigada por ligar, Tiago, tenha uma boa noite!"
export const V171N_PRESENTED: PresentedKnowledgeExcerpt[] = [
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
    "heading": "47. Confirmação de entendimento",
    "excerpt": "Perguntar:\n\n- “As informações ficaram claras?”\n- “Ficou alguma dúvida sobre o valor que deve ser pago?”\n- “Posso esclarecer o prazo ou o acompanhamento?”\n- “Existe outra cobrança da mesma conta que você não reconhece?”\n\nEvitar encerrar apenas com “é só isso?”.",
    "chunkIndex": 63
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
    "heading": "56. Fluxo resumido",
    "excerpt": "**Receber a manifestação → ouvir o cliente → validar o titular → identificar conta, lançamento e valor → consultar histórico → classificar a cobrança → explicar a composição → corrigir ou abrir análise → cancelar recorrências indevidas → avaliar conta ajustada → informar valor reconhecido → registrar prazo e protocolo → recapitular → encerrar.**",
    "chunkIndex": 72
  },
  {
    "documentId": "c8f2c818-72db-48dc-8d7d-d8a9fe861c65",
    "documentTitle": "Procedimento Operacional — Contestação de Contas Móvel",
    "heading": "50. Frases recomendadas",
    "excerpt": "- “Vou consultar o detalhamento antes de concluir.”\n- “Qual cobrança você não reconhece?”\n- “Entendi que esse valor não era esperado.”\n- “Vou comparar com as contas anteriores.”\n- “Não farei alterações sem sua autorização.”\n- “Essa cobrança será encaminhada para análise.”\n- “Vou verificar se é possível emitir uma conta ajustada.”\n- “O valor não contestado é de...”\n- “A renovação do serviço foi cancelada.”\n- “O prazo de análise é de...”\n- “Seu protocolo é...”\n- “Vamos recapitular o que foi realizado.”",
    "chunkIndex": 66
  },
  {
    "documentId": "c8f2c818-72db-48dc-8d7d-d8a9fe861c65",
    "documentTitle": "Procedimento Operacional — Contestação de Contas Móvel",
    "heading": "24. Linha ou contrato desconhecido",
    "excerpt": "Se o cliente identificar uma linha que não reconhece em seu CPF:\n\n- Tratar como suspeita de fraude;\n- Não revelar detalhes desnecessários;\n- Verificar produtos vinculados;\n- Bloquear ou cancelar conforme alçada;\n- Abrir investigação;\n- Contestar cobranças;\n- Orientar proteção cadastral;\n- Fornecer protocolo;\n- Avaliar impacto em órgãos de proteção ao crédito.",
    "chunkIndex": 35
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
    "heading": "46. Recapitulação obrigatória",
    "excerpt": "Antes de encerrar, informar:\n\n- Conta analisada;\n- Lançamento contestado;\n- Valor;\n- Ação realizada;\n- Serviço cancelado, quando aplicável;\n- Conta ajustada;\n- Valor a pagar;\n- Prazo;\n- Canal de retorno;\n- Protocolo.\n\n**Exemplo:**\n\n“Recapitulando: contestamos o serviço digital de R$ 29,90, cancelamos a renovação e ativamos o bloqueio preventivo autorizado. A conta ajustada de R$ 94,00 ficará disponível no App Vivo após o processamento. A análise será concluída em até cinco dias úteis. O protocolo é 202609130184.”",
    "chunkIndex": 62
  },
  {
    "documentId": "c8f2c818-72db-48dc-8d7d-d8a9fe861c65",
    "documentTitle": "Procedimento Operacional — Contestação de Contas Móvel",
    "heading": "55. Checklist do operador",
    "excerpt": "Antes de finalizar:\n\n- [ ] Ouvi a contestação completa?\n- [ ] Validei o titular?\n- [ ] Confirmei a conta questionada?\n- [ ] Identifiquei lançamento, valor e período?\n- [ ] Verifiquei se a conta foi paga?\n- [ ] Comparei contas anteriores?\n- [ ] Consultei alterações e contratações?\n- [ ] Expliquei a composição?\n- [ ] Identifiquei possível fraude?\n- [ ] Cancelei eventual recorrência indevida?\n- [ ] Solicitei autorização para bloqueios?\n- [ ] Apliquei ajuste dentro da alçada?\n- [ ] Abri análise quando necessário?\n- [ ] Informei o valor não contestado?\n- [ ] Emissão de conta ajustada foi avaliada?\n- [ ] Informei prazo e canal de retorno?\n- [ ] Registrei todos os fatos?\n- [ ] Forneci protocolo?\n- [ ] Recapitulei as ações?\n- [ ] Confirmei se restaram dúvidas?",
    "chunkIndex": 71
  },
  {
    "documentId": "00000000-0000-4000-8000-000000000051",
    "documentTitle": "Checklist de Encerramento de Chamada",
    "heading": "",
    "excerpt": "Antes de encerrar qualquer chamada: (1) confirme a solução aplicada; (2) informe o número do protocolo; (3) explique o próximo passo e o prazo; (4) confirme se o cliente tem mais alguma dúvida.",
    "chunkIndex": 0
  },
  {
    "documentId": "b8da52ca-e65c-419c-bace-83431f04ba2c",
    "documentTitle": "Procedimento Operacional Jeito Vivo de Atender",
    "heading": "28 Checklist rápido do operador",
    "excerpt": "Antes de encerrar, confirme:\n\n- Cumprimentei e me apresentei;\n- Perguntei e utilizei corretamente o nome do cliente;\n- Entendi o motivo principal;\n- Evitei que o cliente repetisse informações;\n- Realizei as validações;\n- Expliquei o que estava fazendo;\n- Apresentei somente informações confirmadas;\n- Informei valores, impactos e prazos;\n- Obtive aceite antes de alterações;\n- Testei ou confirmei o resultado;\n- Registrei o atendimento;\n- Recapitulei a solução;\n- Informei o protocolo;\n- Perguntei se havia outra necessidade;\n- Encerrei de forma cordial.",
    "chunkIndex": 73
  }
]
/** A avaliação REAL do especialista (contrato do modelo V3, já validada pelo nó). */
export const V171N_ASSESSMENT = {
  "processes": [
    {
      "product": null,
      "checkpoints": [
        {
          "status": "FOLLOWED",
          "guidance": {
            "text": "O operador deverá permitir que o cliente explique: Qual cobrança não reconhece;",
            "source": "OFFICIAL_PROCEDURE"
          },
          "requirement": "Qual cobrança não reconhece;",
          "uncertainty": null,
          "evidenceType": "OBSERVED",
          "checkpointRef": "CP-4a48ba4db9",
          "knowledgeQuote": "Qual cobrança não reconhece;",
          "transcriptEvidence": [
            "Operador: Obrigada, Tiago, cadastro confirmado. Me conta qual cobrança você não reconhece?"
          ],
          "knowledgeDetailQuote": "“Para eu analisar corretamente, poderia me informar qual cobrança você não reconhece e em qual conta ela aparece?”"
        },
        {
          "status": "FOLLOWED",
          "guidance": {
            "text": "O operador deverá permitir que o cliente explique: Se a conta já foi paga;",
            "source": "OFFICIAL_PROCEDURE"
          },
          "requirement": "Se a conta já foi paga;",
          "uncertainty": null,
          "evidenceType": "OBSERVED",
          "checkpointRef": "CP-8651ee6f0b",
          "knowledgeQuote": "Se a conta já foi paga;",
          "transcriptEvidence": [
            "Operador: Entendi. Você já pagou alguma dessas faturas?"
          ],
          "knowledgeDetailQuote": null
        },
        {
          "status": "FOLLOWED",
          "guidance": {
            "text": "Verificar: Nome do serviço; Valor; Data de ativação; Canal de contratação; Recorrência; Histórico de confirmação; Linha em que foi ativado; Cobranças anteriores.",
            "source": "OFFICIAL_PROCEDURE"
          },
          "requirement": "Verificar: Nome do serviço; Valor; Data de ativação; Canal de contratação; Recorrência; Histórico de confirmação; Linha em que foi ativado; Cobranças anteriores.",
          "uncertainty": null,
          "evidenceType": "OBSERVED",
          "checkpointRef": "CP-d391f1bac0",
          "knowledgeQuote": "Verificar:\n\n- Nome do serviço;\n- Valor;\n- Data de ativação;\n- Canal de contratação;\n- Recorrência;\n- Histórico de confirmação;\n- Linha em que foi ativado;\n- Cobranças anteriores.",
          "transcriptEvidence": [
            "Operador: Achei aqui. É uma assinatura de jogos, contratada pelo aplicativo no dia 4 de agosto. Ela veio na fatura de agosto e na de setembro."
          ],
          "knowledgeDetailQuote": null
        },
        {
          "status": "FOLLOWED",
          "guidance": {
            "text": "Se o cliente não reconhecer: 1. Cancelar a recorrência, quando permitido;",
            "source": "OFFICIAL_PROCEDURE"
          },
          "requirement": "1. Cancelar a recorrência, quando permitido;",
          "uncertainty": null,
          "evidenceType": "OBSERVED",
          "checkpointRef": "CP-b9a41387af",
          "knowledgeQuote": "1. Cancelar a recorrência, quando permitido;",
          "transcriptEvidence": [
            "Operador: Tá certo. Já desativei essa assinatura aqui, então ela não renova mais."
          ],
          "knowledgeDetailQuote": null
        },
        {
          "status": "FOLLOWED",
          "guidance": {
            "text": "Se o cliente não reconhecer: 2. Registrar contestação;",
            "source": "OFFICIAL_PROCEDURE"
          },
          "requirement": "2. Registrar contestação;",
          "uncertainty": null,
          "evidenceType": "OBSERVED",
          "checkpointRef": "CP-a91b89a0e2",
          "knowledgeQuote": "2. Registrar contestação;",
          "transcriptEvidence": [
            "Operador: E vou registrar a contestação dessas duas cobranças para o time de faturamento analisar."
          ],
          "knowledgeDetailQuote": null
        },
        {
          "status": "NOT_FOLLOWED",
          "guidance": {
            "text": "Se o cliente não reconhecer: 5. Explicar prazo;",
            "source": "OFFICIAL_PROCEDURE"
          },
          "requirement": "5. Explicar prazo;",
          "uncertainty": null,
          "evidenceType": "OBSERVED",
          "checkpointRef": "CP-a60913570d",
          "knowledgeQuote": "5. Explicar prazo;",
          "transcriptEvidence": [
            "Operador: Olha, não consigo te passar um prazo certinho, isso varia bastante lá no setor."
          ],
          "knowledgeDetailQuote": "“A contestação foi registrada e será analisada no prazo informado. O retorno será enviado por SMS. Seu protocolo é 202609130184.”"
        },
        {
          "status": "NOT_FOLLOWED",
          "guidance": {
            "text": "Antes de encerrar, informar: Conta analisada; Lançamento contestado; Valor; Ação realizada; Serviço cancelado, quando aplicável; Conta ajustada; Valor a pagar; Prazo; Canal de retorno; Protocolo.",
            "source": "OFFICIAL_PROCEDURE"
          },
          "requirement": "Antes de encerrar, informar: Conta analisada; Lançamento contestado; Valor; Ação realizada; Serviço cancelado, quando aplicável; Conta ajustada; Valor a pagar; Prazo; Canal de retorno; Protocolo.",
          "uncertainty": null,
          "evidenceType": "OBSERVED",
          "checkpointRef": "CP-08ba2d72ba",
          "knowledgeQuote": "Antes de encerrar, informar:\n\n- Conta analisada;\n- Lançamento contestado;\n- Valor;\n- Ação realizada;\n- Serviço cancelado, quando aplicável;\n- Conta ajustada;\n- Valor a pagar;\n- Prazo;\n- Canal de retorno;\n- Protocolo.",
          "transcriptEvidence": [
            "Operador: Resumindo, Tiago: a assinatura do Clube Games Plus foi desativada, a contestação das duas cobranças de R$ 12,90 está registrada e o seu protocolo é 2026 0926 5812."
          ],
          "knowledgeDetailQuote": "“Recapitulando: contestamos o serviço digital de R$ 29,90, cancelamos a renovação e ativamos o bloqueio preventivo autorizado. A conta ajustada de R$ 94,00 ficará disponível no App Vivo após o processamento. A análise será concluída em até cinco dias úteis. O protocolo é 202609130184.”"
        },
        {
          "status": "FOLLOWED",
          "guidance": {
            "text": "Perguntar: “As informações ficaram claras?”",
            "source": "OFFICIAL_PROCEDURE"
          },
          "requirement": "“As informações ficaram claras?”",
          "uncertainty": null,
          "evidenceType": "OBSERVED",
          "checkpointRef": "CP-c8acf59578",
          "knowledgeQuote": "“As informações ficaram claras?”",
          "transcriptEvidence": [
            "Operador: Ficou alguma dúvida sobre o que eu te expliquei?"
          ],
          "knowledgeDetailQuote": null
        }
      ],
      "documentTitle": "Procedimento Operacional — Contestação de Contas Móvel"
    },
    {
      "product": null,
      "checkpoints": [
        {
          "status": "FOLLOWED",
          "guidance": {
            "text": "Antes de encerrar qualquer chamada: (1) confirme a solução aplicada;",
            "source": "OFFICIAL_SERVICE_GUIDELINE"
          },
          "requirement": "(1) confirme a solução aplicada;",
          "uncertainty": null,
          "evidenceType": "OBSERVED",
          "checkpointRef": "CP-b9db6af3ba",
          "knowledgeQuote": "(1) confirme a solução aplicada;",
          "transcriptEvidence": [
            "Operador: Resumindo, Tiago: a assinatura do Clube Games Plus foi desativada, a contestação das duas cobranças de R$ 12,90 está registrada e o seu protocolo é 2026 0926 5812."
          ],
          "knowledgeDetailQuote": null
        },
        {
          "status": "FOLLOWED",
          "guidance": {
            "text": "Antes de encerrar qualquer chamada: (2) informe o número do protocolo;",
            "source": "OFFICIAL_SERVICE_GUIDELINE"
          },
          "requirement": "(2) informe o número do protocolo;",
          "uncertainty": null,
          "evidenceType": "OBSERVED",
          "checkpointRef": "CP-8eaac52713",
          "knowledgeQuote": "(2) informe o número do protocolo;",
          "transcriptEvidence": [
            "Operador: Resumindo, Tiago: a assinatura do Clube Games Plus foi desativada, a contestação das duas cobranças de R$ 12,90 está registrada e o seu protocolo é 2026 0926 5812."
          ],
          "knowledgeDetailQuote": null
        },
        {
          "status": "NOT_FOLLOWED",
          "guidance": {
            "text": "Antes de encerrar qualquer chamada: (3) explique o próximo passo e o prazo;",
            "source": "OFFICIAL_SERVICE_GUIDELINE"
          },
          "requirement": "(3) explique o próximo passo e o prazo;",
          "uncertainty": null,
          "evidenceType": "OBSERVED",
          "checkpointRef": "CP-cab0fce54b",
          "knowledgeQuote": "(3) explique o próximo passo e o prazo;",
          "transcriptEvidence": [
            "Operador: Olha, não consigo te passar um prazo certinho, isso varia bastante lá no setor."
          ],
          "knowledgeDetailQuote": null
        },
        {
          "status": "FOLLOWED",
          "guidance": {
            "text": "Antes de encerrar qualquer chamada: (4) confirme se o cliente tem mais alguma dúvida.",
            "source": "OFFICIAL_SERVICE_GUIDELINE"
          },
          "requirement": "(4) confirme se o cliente tem mais alguma dúvida.",
          "uncertainty": null,
          "evidenceType": "OBSERVED",
          "checkpointRef": "CP-78c6c76d55",
          "knowledgeQuote": "(4) confirme se o cliente tem mais alguma dúvida.",
          "transcriptEvidence": [
            "Operador: Ficou alguma dúvida sobre o que eu te expliquei?"
          ],
          "knowledgeDetailQuote": null
        }
      ],
      "documentTitle": "Checklist de Encerramento de Chamada"
    }
  ],
  "validation": {
    "catalog": {
      "optional": 75,
      "required": 1,
      "presented": 79,
      "supportOnly": 3
    },
    "completeness": "COMPLETE",
    "invalidItems": [],
    "normalizations": [],
    "contractVersion": "PROCESS_ASSESSMENT_MODEL_CONTRACT_V3",
    "missingRequired": [],
    "checkpointCapacity": [
      {
        "capacity": 40,
        "documentTitle": "Procedimento Operacional — Contestação de Contas Móvel",
        "presentedSteps": 72
      },
      {
        "capacity": 12,
        "documentTitle": "Checklist de Encerramento de Chamada",
        "presentedSteps": 4
      }
    ]
  },
  "applicability": []
} as unknown as RawProcessAssessment
/** A resposta REAL do redator, por slot. */
export const V171N_WRITER_RAW = {
  "items": [
    {
      "slot": "ITEM_1",
      "observed": "Você informou ao cliente que não era possível fornecer o prazo específico da análise devido a variações internas do setor.",
      "whatYouCanDo": "Nas próximas chamadas, consulte a ferramenta e informe o prazo exato disponível para a análise, conforme indicado no sistema.",
      "whyItMatters": "Informar o prazo de retorno ajuda o cliente a compreender o fluxo de acompanhamento da contestação.",
      "suggestedResponse": "A contestação foi registrada e será analisada no prazo de 5 dias úteis. O retorno com o resultado será enviado por SMS."
    },
    {
      "slot": "ITEM_2",
      "observed": "Você solicitou ativamente ao cliente que identificasse qual cobrança ele não reconhecia, após realizar a confirmação do cadastro.",
      "whatYouCanDo": "",
      "whyItMatters": "",
      "suggestedResponse": ""
    },
    {
      "slot": "ITEM_3",
      "observed": "Você declarou ao cliente que realizou a desativação da assinatura para impedir futuras renovações.",
      "whatYouCanDo": "",
      "whyItMatters": "",
      "suggestedResponse": ""
    },
    {
      "slot": "ITEM_4",
      "observed": "Você informou ao cliente que realizaria o registro da contestação das cobranças pendentes para análise do setor de faturamento.",
      "whatYouCanDo": "",
      "whyItMatters": "",
      "suggestedResponse": ""
    },
    {
      "slot": "ITEM_5",
      "observed": "Ao final das explicações, você perguntou ao cliente se ele ainda possuía alguma dúvida sobre o que foi tratado.",
      "whatYouCanDo": "",
      "whyItMatters": "",
      "suggestedResponse": ""
    },
    {
      "slot": "ITEM_6",
      "observed": "Você finalizou a chamada recapitulando as ações realizadas, incluindo o cancelamento da assinatura e o registro da contestação.",
      "whatYouCanDo": "",
      "whyItMatters": "",
      "suggestedResponse": ""
    },
    {
      "slot": "ITEM_7",
      "observed": "Você informou o número do protocolo de atendimento ao cliente durante a recapitulação final.",
      "whatYouCanDo": "",
      "whyItMatters": "",
      "suggestedResponse": ""
    },
    {
      "slot": "ITEM_8",
      "observed": "Você questionou o cliente sobre o pagamento das faturas para verificar a situação das cobranças contestadas.",
      "whatYouCanDo": "",
      "whyItMatters": "",
      "suggestedResponse": ""
    }
  ],
  "presentation": {
    "closing": "Você demonstrou segurança ao tratar os pontos de contestação e validar as informações com o cliente. Para a próxima vez, lembre-se de conferir na ferramenta o prazo exato para informar ao cliente, o que contribui para a transparência do processo.",
    "introduction": "Analisei seu atendimento sobre a contestação de cobrança. Você conduziu com agilidade a identificação dos serviços, o cancelamento, o registro da solicitação e as confirmações necessárias com o cliente. Apresento a seguir os pontos de atenção e como você pode ajustar o fluxo nas próximas interações."
  }
}
/** Requisito de cada ponto → slot em que o redator real respondeu (ordem daquela execução). */
export const V171N_WRITER_SLOTS: Record<string, string> = {
  "5. Explicar prazo;": "ITEM_1",
  "Qual cobrança não reconhece;": "ITEM_2",
  "1. Cancelar a recorrência, quando permitido;": "ITEM_3",
  "2. Registrar contestação;": "ITEM_4",
  "“As informações ficaram claras?”": "ITEM_5",
  "(1) confirme a solução aplicada;": "ITEM_6",
  "(2) informe o número do protocolo;": "ITEM_7",
  "Se a conta já foi paga;": "ITEM_8"
}
