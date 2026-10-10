/**
 * SMOKE REAL V1.7.2 (SMOKE-V172-CONTESTACAO-001 · interação 5585eda7 · matrícula f57d96c4, 28/09/2026) — dados congelados para o
 * replay da V1.7.3 (sem modelo): transcrição importada pela Central de Dados, os 12 trechos da base apresentados ao especialista, a
 * avaliação REAL do especialista (contrato V3, 13 etapas, SEM identificação da cobrança e SEM verificação do pagamento) e a resposta
 * REAL do redator. Os documentos publicados são os mesmos da V1.7.1l (versão 1).
 */
import type { PresentedKnowledgeExcerpt } from "../domain/process-assessment.js"
import type { RawProcessAssessment } from "../../agents/domain/process-assessment-contract.js"
export { V171L_PUBLISHED as V172_PUBLISHED } from "./contestacao-v171l-smoke-fixture.js"

export const V172_SUBJECT = "Contestação de cobrança"
export const V172_COLLABORATOR_NAME = "Larissa Monteiro"
export const V172_TRANSCRIPT = "Operador: Conecta, boa tarde, Larissa falando. Em que posso te ajudar?\nCliente: Boa tarde. Olha, veio na minha fatura uma cobrança de um tal de Banca Digital que eu nunca contratei.\nOperador: Entendi. Antes de eu verificar, me confirma o nome do titular e os dois últimos dígitos do CPF, por favor?\nCliente: Marcos Vinícius Teles. O CPF termina em 15.\nOperador: Obrigada, Marcos, cadastro localizado. Essa Banca Digital é de quanto, e em qual fatura apareceu?\nCliente: Doze e noventa, na fatura desse mês.\nOperador: Deixa eu olhar aqui... Achei. É uma assinatura de revistas digitais, ativada no dia 3 de setembro pelo próprio celular da linha. Essa é a primeira cobrança dela.\nCliente: Eu não ativei nada. Pode ter sido meu filho, ele vive mexendo no celular, mas eu não autorizei.\nOperador: Tudo bem. E essa fatura você já pagou?\nCliente: Ainda não, vence dia 10.\nOperador: Certo. Então primeiro eu vou tirar essa assinatura pra ela não renovar mais... Pronto, desativei a Banca Digital na sua linha.\nCliente: Ótimo.\nOperador: Agora vou abrir a contestação dos R$ 12,90 pra área de faturamento analisar.\nCliente: E eu pago a fatura inteira ou espero?\nOperador: Pode pagar normalmente até o vencimento. Se a contestação for aprovada, o valor volta como crédito na fatura seguinte.\nCliente: Tá. E demora quanto tempo isso?\nOperador: Aqui na ferramenta aparece prazo de até 7 dias úteis pra análise, e o resultado chega por SMS nesse número.\nCliente: Beleza.\nOperador: Então, recapitulando: a assinatura Banca Digital foi desativada, a contestação de R$ 12,90 foi registrada e a análise leva até 7 dias úteis, com resposta por SMS.\nCliente: Tá certo.\nOperador: Mais alguma coisa em que eu possa te ajudar?\nCliente: Não, era só isso.\nOperador: Obrigada por ligar, Marcos. Tenha uma boa tarde!"
export const V172_PRESENTED: PresentedKnowledgeExcerpt[] = [
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
    "heading": "5. Apresentação do operador",
    "excerpt": "**Exemplo recomendado:**\n\n“Olá, boa tarde! Meu nome é Juliana Prado, sou do atendimento Vivo. Com quem eu tenho o prazer de falar?”\n\nApós identificar o cliente:\n\n“Obrigada, Ricardo. Entendi que você não reconhece um valor da sua conta. Vou consultar o detalhamento e explicar o que encontrei.”\n\nEvitar:\n\n- “A conta está certa.”\n- “Se está na fatura, você contratou.”\n- “Você deve ter clicado em alguma coisa.”\n- “Primeiro precisa pagar.”\n- “Isso não pode ser contestado.”",
    "chunkIndex": 16
  },
  {
    "documentId": "b8da52ca-e65c-419c-bace-83431f04ba2c",
    "documentTitle": "Procedimento Operacional Jeito Vivo de Atender",
    "heading": "Modelo completo",
    "excerpt": "“[Nome do cliente], sua solicitação foi concluída e o protocolo é [número]. Você poderá acompanhar pelo Meu Vivo. Posso ajudar em mais alguma coisa?”\n\nApós a resposta:\n\n“Obrigado por entrar em contato com a Vivo. Tenha uma ótima tarde.”",
    "chunkIndex": 65
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
    "documentId": "b8da52ca-e65c-419c-bace-83431f04ba2c",
    "documentTitle": "Procedimento Operacional Jeito Vivo de Atender",
    "heading": "24 Expressões recomendadas",
    "excerpt": "- “Vou ajudar você.”\n- “Entendi a sua necessidade.”\n- “Obrigado por explicar.”\n- “Vou verificar com atenção.”\n- “Localizei a informação.”\n- “Temos estas opções.”\n- “Antes de confirmar, vou recapitular.”\n- “O prazo informado é…”\n- “Vou registrar sua manifestação.”\n- “A solução foi concluída.”\n- “Este é o próximo passo.”\n- “Obrigado por aguardar.”\n- “Posso ajudar em mais alguma questão?”",
    "chunkIndex": 69
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
    "heading": "47. Confirmação de entendimento",
    "excerpt": "Perguntar:\n\n- “As informações ficaram claras?”\n- “Ficou alguma dúvida sobre o valor que deve ser pago?”\n- “Posso esclarecer o prazo ou o acompanhamento?”\n- “Existe outra cobrança da mesma conta que você não reconhece?”\n\nEvitar encerrar apenas com “é só isso?”.",
    "chunkIndex": 63
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
/** A avaliação como o especialista a devolveu (a validação persistida é a do contrato V3 da V1.7.2 — sem plano de cobertura). */
export const V172_ASSESSMENT = {
  "processes": [
    {
      "product": null,
      "checkpoints": [
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
            "Operador: Deixa eu olhar aqui... Achei. É uma assinatura de revistas digitais, ativada no dia 3 de setembro pelo próprio celular da linha. Essa é a primeira cobrança dela."
          ],
          "knowledgeDetailQuote": null
        },
        {
          "status": "FOLLOWED",
          "guidance": {
            "text": "Cancelar a recorrência, quando permitido;",
            "source": "OFFICIAL_PROCEDURE"
          },
          "requirement": "1. Cancelar a recorrência, quando permitido;",
          "uncertainty": null,
          "evidenceType": "OBSERVED",
          "checkpointRef": "CP-b9a41387af",
          "knowledgeQuote": "1. Cancelar a recorrência, quando permitido;",
          "transcriptEvidence": [
            "Operador: Certo. Então primeiro eu vou tirar essa assinatura pra ela não renovar mais... Pronto, desativei a Banca Digital na sua linha."
          ],
          "knowledgeDetailQuote": null
        },
        {
          "status": "FOLLOWED",
          "guidance": {
            "text": "Registrar contestação;",
            "source": "OFFICIAL_PROCEDURE"
          },
          "requirement": "2. Registrar contestação;",
          "uncertainty": null,
          "evidenceType": "OBSERVED",
          "checkpointRef": "CP-a91b89a0e2",
          "knowledgeQuote": "2. Registrar contestação;",
          "transcriptEvidence": [
            "Operador: Agora vou abrir a contestação dos R$ 12,90 pra área de faturamento analisar."
          ],
          "knowledgeDetailQuote": null
        },
        {
          "status": "NOT_OBSERVABLE",
          "guidance": {
            "text": "Ativar bloqueio preventivo, se disponível e autorizado;",
            "source": "OFFICIAL_PROCEDURE"
          },
          "requirement": "4. Ativar bloqueio preventivo, se disponível e autorizado;",
          "uncertainty": "Não é possível verificar pela transcrição se a ferramenta disponibilizava o bloqueio preventivo para esta linha/serviço.",
          "evidenceType": null,
          "checkpointRef": "CP-eedcebbab4",
          "knowledgeQuote": "4. Ativar bloqueio preventivo, se disponível e autorizado;",
          "transcriptEvidence": [],
          "knowledgeDetailQuote": "O bloqueio preventivo deverá ser autorizado pelo cliente."
        },
        {
          "status": "FOLLOWED",
          "guidance": {
            "text": "O operador deverá informar o prazo exibido na ferramenta.",
            "source": "OFFICIAL_PROCEDURE"
          },
          "requirement": "5. Explicar prazo;",
          "uncertainty": null,
          "evidenceType": "OBSERVED",
          "checkpointRef": "CP-a60913570d",
          "knowledgeQuote": "5. Explicar prazo;",
          "transcriptEvidence": [
            "Operador: Aqui na ferramenta aparece prazo de até 7 dias úteis pra análise, e o resultado chega por SMS nesse número."
          ],
          "knowledgeDetailQuote": "O operador deverá informar o prazo exibido na ferramenta."
        },
        {
          "status": "FOLLOWED",
          "guidance": {
            "text": "O operador deverá informar o prazo exibido na ferramenta.",
            "source": "OFFICIAL_PROCEDURE"
          },
          "requirement": "O operador deverá informar o prazo exibido na ferramenta.",
          "uncertainty": null,
          "evidenceType": "OBSERVED",
          "checkpointRef": "CP-2fcfdf61ae",
          "knowledgeQuote": "O operador deverá informar o prazo exibido na ferramenta.",
          "transcriptEvidence": [
            "Operador: Aqui na ferramenta aparece prazo de até 7 dias úteis pra análise, e o resultado chega por SMS nesse número."
          ],
          "knowledgeDetailQuote": "Sempre informar prazo de forma objetiva:"
        },
        {
          "status": "NOT_OBSERVABLE",
          "guidance": {
            "text": "Registrar protocolo.",
            "source": "OFFICIAL_PROCEDURE"
          },
          "requirement": "7. Registrar protocolo.",
          "uncertainty": "O registro em sistema não é diretamente observável apenas pela transcrição de áudio.",
          "evidenceType": null,
          "checkpointRef": "CP-0499923e17",
          "knowledgeQuote": "7. Registrar protocolo.",
          "transcriptEvidence": [],
          "knowledgeDetailQuote": null
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
            "Operador: Então, recapitulando: a assinatura Banca Digital foi desativada, a contestação de R$ 12,90 foi registrada e a análise leva até 7 dias úteis, com resposta por SMS."
          ],
          "knowledgeDetailQuote": null
        },
        {
          "status": "NOT_FOLLOWED",
          "guidance": {
            "text": "Fornecer protocolo ao cliente.",
            "source": "OFFICIAL_PROCEDURE"
          },
          "requirement": "[ ] Forneci protocolo?",
          "uncertainty": null,
          "evidenceType": "OMISSION",
          "checkpointRef": "CP-0ae8a37ae1",
          "knowledgeQuote": "[ ] Forneci protocolo?",
          "transcriptEvidence": [
            "Operador: Obrigada por ligar, Marcos. Tenha uma boa tarde!"
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
            "text": "confirme a solução aplicada;",
            "source": "OFFICIAL_SERVICE_GUIDELINE"
          },
          "requirement": "(1) confirme a solução aplicada;",
          "uncertainty": null,
          "evidenceType": "OBSERVED",
          "checkpointRef": "CP-b9db6af3ba",
          "knowledgeQuote": "confirme a solução aplicada;",
          "transcriptEvidence": [
            "Operador: Então, recapitulando: a assinatura Banca Digital foi desativada, a contestação de R$ 12,90 foi registrada e a análise leva até 7 dias úteis, com resposta por SMS."
          ],
          "knowledgeDetailQuote": null
        },
        {
          "status": "NOT_FOLLOWED",
          "guidance": {
            "text": "informe o número do protocolo;",
            "source": "OFFICIAL_SERVICE_GUIDELINE"
          },
          "requirement": "(2) informe o número do protocolo;",
          "uncertainty": null,
          "evidenceType": "OMISSION",
          "checkpointRef": "CP-8eaac52713",
          "knowledgeQuote": "informe o número do protocolo;",
          "transcriptEvidence": [
            "Operador: Obrigada por ligar, Marcos. Tenha uma boa tarde!"
          ],
          "knowledgeDetailQuote": null
        },
        {
          "status": "FOLLOWED",
          "guidance": {
            "text": "explique o próximo passo e o prazo;",
            "source": "OFFICIAL_SERVICE_GUIDELINE"
          },
          "requirement": "(3) explique o próximo passo e o prazo;",
          "uncertainty": null,
          "evidenceType": "OBSERVED",
          "checkpointRef": "CP-cab0fce54b",
          "knowledgeQuote": "explique o próximo passo e o prazo;",
          "transcriptEvidence": [
            "Operador: Aqui na ferramenta aparece prazo de até 7 dias úteis pra análise, e o resultado chega por SMS nesse número."
          ],
          "knowledgeDetailQuote": null
        },
        {
          "status": "FOLLOWED",
          "guidance": {
            "text": "confirme se o cliente tem mais alguma dúvida.",
            "source": "OFFICIAL_SERVICE_GUIDELINE"
          },
          "requirement": "(4) confirme se o cliente tem mais alguma dúvida.",
          "uncertainty": null,
          "evidenceType": "OBSERVED",
          "checkpointRef": "CP-78c6c76d55",
          "knowledgeQuote": "confirme se o cliente tem mais alguma dúvida.",
          "transcriptEvidence": [
            "Operador: Mais alguma coisa em que eu possa te ajudar?"
          ],
          "knowledgeDetailQuote": null
        }
      ],
      "documentTitle": "Checklist de Encerramento de Chamada"
    }
  ],
  "validation": {
    "catalog": {
      "optional": 70,
      "required": 1,
      "presented": 73,
      "supportOnly": 2
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
/** Resposta REAL do redator (5 pontos fortes que ele recebeu). */
export const V172_WRITER_RAW = {
  "items": [
    {
      "slot": "ITEM_1",
      "observed": "Você comunicou ao cliente que realizou a desativação do serviço de assinatura.",
      "whatYouCanDo": "",
      "whyItMatters": "",
      "suggestedResponse": ""
    },
    {
      "slot": "ITEM_2",
      "observed": "Você informou que deu início ao processo de contestação do valor para análise pelo setor responsável.",
      "whatYouCanDo": "",
      "whyItMatters": "",
      "suggestedResponse": ""
    },
    {
      "slot": "ITEM_3",
      "observed": "Você indicou ao cliente o prazo de análise disponível no sistema e informou o canal por onde ele receberá o resultado.",
      "whatYouCanDo": "Mantenha a prática de transmitir ao cliente o prazo exato que aparece no sistema e o canal de retorno.",
      "whyItMatters": "O operador deverá informar o prazo exibido na ferramenta.",
      "suggestedResponse": ""
    },
    {
      "slot": "ITEM_4",
      "observed": "Você realizou a síntese das ações tomadas, confirmando o cancelamento da assinatura e o registro da contestação, além de reiterar o prazo e o meio de retorno.",
      "whatYouCanDo": "",
      "whyItMatters": "",
      "suggestedResponse": ""
    },
    {
      "slot": "ITEM_5",
      "observed": "Você questionou se o cliente precisava de suporte adicional ao final do atendimento.",
      "whatYouCanDo": "",
      "whyItMatters": "",
      "suggestedResponse": ""
    }
  ],
  "presentation": {
    "closing": "Apesar do bom desempenho, é necessário incluir a recapitalização obrigatória ao final do processo nas próximas chamadas. Parabéns pelas etapas de solução e suporte que foram cumpridas.",
    "introduction": "Analisei o seu atendimento sobre contestação de cobrança. Observei que você cumpriu corretamente os pontos sobre serviços digitais não reconhecidos, cancelamento, registro, prazos e confirmações da solução e de entendimento."
  }
}
