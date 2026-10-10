/**
 * V1.7.1n — o smoke REAL da V1.7.1m reproduzido offline (SMOKE-V171M-CONTESTACAO-001, interação 33029e40, matrícula 6a91e961,
 * artefato 17515d86): transcrição enviada pela Central de Dados, avaliação de processo do Especialista de Faturamento
 * (gemini-3.8-flash, 1 chamada, contrato do modelo V2 — sem checkpointRef), os 13 trechos que entraram no prompt dele (score do
 * ranking; score 0 = cobertura do fechamento) e a resposta REAL do redator (gemini-3.1-flash-lite). Documentos publicados = os
 * da fixture V1.7.1l (hash conferido com o banco: Contestação b92888bb…, Checklist f3385323…, Jeito Vivo d4f89c1b…). Sem modelo.
 */
import type { PresentedKnowledgeExcerpt } from "../domain/process-assessment.js"
export { V171L_PUBLISHED as V171M_PUBLISHED, V171L_DOC_ID as V171M_DOC_ID, V171L_DOC_TITLE as V171M_DOC_TITLE, V171L_CHECKLIST_ID as V171M_CHECKLIST_ID, V171L_CHECKLIST_TITLE as V171M_CHECKLIST_TITLE, V171L_JEITO_VIVO_ID as V171M_JEITO_VIVO_ID, V171L_JEITO_VIVO_TITLE as V171M_JEITO_VIVO_TITLE } from "./contestacao-v171l-smoke-fixture.js"

export const V171M_SUBJECT = "Contestação de cobrança"
export const V171M_COLLABORATOR_NAME = "Larissa Monteiro"
export const V171M_TRANSCRIPT = "Operador: Conecta, bom dia, aqui é a Larissa. Com quem eu falo?\nCliente: Bom dia, Larissa. Aqui é a Renata Borges, a linha é minha. Veio uma cobrança estranha na minha conta.\nOperador: Vamos verificar, Renata. Pra eu acessar o cadastro, me confirma os três últimos dígitos do CPF e a sua data de nascimento?\nCliente: 588, e nasci em 12 de outubro de 1991.\nOperador: Obrigada, cadastro confirmado. Qual é a cobrança que você não está reconhecendo?\nCliente: Um tal de Mundo Kids, que eu nunca contratei.\nOperador: Encontrei aqui: é um pacote infantil de vídeos, o Mundo Kids, de R$ 16,90 por mês, ativado no dia 28 de julho por uma mensagem de oferta. Ele aparece nas faturas de agosto e de setembro.\nCliente: Nossa, pode ter sido meu sobrinho mexendo no celular.\nOperador: Entendi. E alguma dessas faturas já foi paga?\nCliente: A de agosto sim, a de setembro ainda não.\nOperador: Certo. Já tirei a renovação desse pacote, então ele não volta a cobrar.\nCliente: Ainda bem.\nOperador: E vou abrir a contestação das duas cobranças do Mundo Kids pra área de faturamento analisar.\nCliente: E o que eu paguei em agosto, volta?\nOperador: Agora é aguardar a análise, eles vão verificar e te dão um retorno.\nCliente: E demora?\nOperador: Não sei te dizer um prazo certinho, depende da fila deles.\nCliente: Tá bom.\nOperador: Resumindo, Renata: abri a contestação das duas cobranças de R$ 16,90 do Mundo Kids, a renovação do pacote já foi tirada, e o seu protocolo é 2026 0926 3357.\nCliente: Anotado.\nOperador: Ficou alguma dúvida sobre o que a gente combinou?\nCliente: Não, tudo certo.\nOperador: Então é isso, qualquer coisa é só ligar. Obrigada pela ligação, Renata, bom dia!"
export const V171M_PRESENTED: PresentedKnowledgeExcerpt[] = [
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
    "heading": "24. Linha ou contrato desconhecido",
    "excerpt": "Se o cliente identificar uma linha que não reconhece em seu CPF:\n\n- Tratar como suspeita de fraude;\n- Não revelar detalhes desnecessários;\n- Verificar produtos vinculados;\n- Bloquear ou cancelar conforme alçada;\n- Abrir investigação;\n- Contestar cobranças;\n- Orientar proteção cadastral;\n- Fornecer protocolo;\n- Avaliar impacto em órgãos de proteção ao crédito.",
    "chunkIndex": 35
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
    "heading": "6. Escuta e identificação da solicitação",
    "excerpt": "O operador deverá permitir que o cliente explique:\n\n- Qual conta está questionando;\n- Qual cobrança não reconhece;\n- Qual valor esperava;\n- Qual valor foi faturado;\n- Quando percebeu a diferença;\n- Se a conta já foi paga;\n- Se já houve contato anterior;\n- Se a cobrança continua ocorrendo;\n- Se existe ameaça de bloqueio ou negativação;\n- Se há suspeita de fraude.\n\n**Exemplo:**\n\n“Para eu analisar corretamente, poderia me informar qual cobrança você não reconhece e em qual conta ela aparece?”\n\nDepois, confirmar o entendimento:\n\n“Entendi. Sua mensalidade habitual era de R$ 89,99, mas a conta atual veio em R$ 149,89 por causa de um serviço digital de R$ 59,90 que você não reconhece. Está correto?”",
    "chunkIndex": 17
  },
  {
    "documentId": "b8da52ca-e65c-419c-bace-83431f04ba2c",
    "documentTitle": "Procedimento Operacional Jeito Vivo de Atender",
    "heading": "Perguntas recomendadas",
    "excerpt": "- “A solução atendeu ao que você precisava?”\n- “Você conseguiu acessar?”\n- “O serviço está funcionando agora?”\n- “Ficou alguma dúvida sobre o prazo?”\n- “Posso ajudar em mais alguma questão?”\n\nEvitar:\n\n- “Era só isso?”\n- “Terminou?”\n- “Mais alguma coisa?”, em tom apressado.\n- Encerrar imediatamente após executar a ação.",
    "chunkIndex": 63
  },
  {
    "documentId": "b8da52ca-e65c-419c-bace-83431f04ba2c",
    "documentTitle": "Procedimento Operacional Jeito Vivo de Atender",
    "heading": "Frases de condução",
    "excerpt": "- “Vou consultar a situação da linha.”\n- “Agora vou verificar as condições disponíveis.”\n- “Localizei a origem da cobrança.”\n- “Temos duas opções para resolver.”\n- “Antes de confirmar, vou explicar os impactos.”\n- “A solicitação foi concluída. Vamos testar?”\n- “Ainda não concluímos. O próximo passo será este.”\n\nO cliente não deve precisar perguntar repetidamente o que está acontecendo.",
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
    "heading": "55. Checklist do operador",
    "excerpt": "Antes de finalizar:\n\n- [ ] Ouvi a contestação completa?\n- [ ] Validei o titular?\n- [ ] Confirmei a conta questionada?\n- [ ] Identifiquei lançamento, valor e período?\n- [ ] Verifiquei se a conta foi paga?\n- [ ] Comparei contas anteriores?\n- [ ] Consultei alterações e contratações?\n- [ ] Expliquei a composição?\n- [ ] Identifiquei possível fraude?\n- [ ] Cancelei eventual recorrência indevida?\n- [ ] Solicitei autorização para bloqueios?\n- [ ] Apliquei ajuste dentro da alçada?\n- [ ] Abri análise quando necessário?\n- [ ] Informei o valor não contestado?\n- [ ] Emissão de conta ajustada foi avaliada?\n- [ ] Informei prazo e canal de retorno?\n- [ ] Registrei todos os fatos?\n- [ ] Forneci protocolo?\n- [ ] Recapitulei as ações?\n- [ ] Confirmei se restaram dúvidas?",
    "chunkIndex": 71
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
export const V171M_RANKED_SCORES = [
  {
    "documentId": "c8f2c818-72db-48dc-8d7d-d8a9fe861c65",
    "chunkIndex": 16,
    "score": 32.49
  },
  {
    "documentId": "c8f2c818-72db-48dc-8d7d-d8a9fe861c65",
    "chunkIndex": 35,
    "score": 26.259
  },
  {
    "documentId": "c8f2c818-72db-48dc-8d7d-d8a9fe861c65",
    "chunkIndex": 26,
    "score": 25.83
  },
  {
    "documentId": "c8f2c818-72db-48dc-8d7d-d8a9fe861c65",
    "chunkIndex": 17,
    "score": 25.41
  },
  {
    "documentId": "b8da52ca-e65c-419c-bace-83431f04ba2c",
    "chunkIndex": 63,
    "score": 24.956
  },
  {
    "documentId": "b8da52ca-e65c-419c-bace-83431f04ba2c",
    "chunkIndex": 26,
    "score": 24.573
  },
  {
    "documentId": "c8f2c818-72db-48dc-8d7d-d8a9fe861c65",
    "chunkIndex": 51,
    "score": 24.408
  },
  {
    "documentId": "c8f2c818-72db-48dc-8d7d-d8a9fe861c65",
    "chunkIndex": 71,
    "score": 24.329
  },
  {
    "documentId": "c8f2c818-72db-48dc-8d7d-d8a9fe861c65",
    "chunkIndex": 62,
    "score": 0
  },
  {
    "documentId": "c8f2c818-72db-48dc-8d7d-d8a9fe861c65",
    "chunkIndex": 63,
    "score": 0
  },
  {
    "documentId": "c8f2c818-72db-48dc-8d7d-d8a9fe861c65",
    "chunkIndex": 64,
    "score": 0
  },
  {
    "documentId": "00000000-0000-4000-8000-000000000051",
    "chunkIndex": 0,
    "score": 0
  },
  {
    "documentId": "b8da52ca-e65c-419c-bace-83431f04ba2c",
    "chunkIndex": 73,
    "score": 0
  }
]
/** A avaliação REAL do especialista (contrato do modelo V2: identidade da etapa pela citação). */
export const V171M_ASSESSMENT = {
  "processes": [
    {
      "product": null,
      "checkpoints": [
        {
          "status": "FOLLOWED",
          "guidance": {
            "text": "Cancelar a renovação do serviço para interromper futuras cobranças.",
            "source": "OFFICIAL_PROCEDURE"
          },
          "requirement": "Cancelar a recorrência do serviço digital não reconhecido, quando permitido",
          "uncertainty": null,
          "evidenceType": "OBSERVED",
          "knowledgeQuote": "1. Cancelar a recorrência, quando permitido;",
          "transcriptEvidence": [
            "Operador: Certo. Já tirei a renovação desse pacote, então ele não volta a cobrar."
          ],
          "knowledgeDetailQuote": null
        },
        {
          "status": "FOLLOWED",
          "guidance": {
            "text": "Registrar a contestação dos valores elegíveis para análise da área competente.",
            "source": "OFFICIAL_PROCEDURE"
          },
          "requirement": "Registrar contestação das cobranças não reconhecidas",
          "uncertainty": null,
          "evidenceType": "OBSERVED",
          "knowledgeQuote": "2. Registrar contestação;",
          "transcriptEvidence": [
            "Operador: E vou abrir a contestação das duas cobranças do Mundo Kids pra área de faturamento analisar."
          ],
          "knowledgeDetailQuote": null
        },
        {
          "status": "NOT_FOLLOWED",
          "guidance": {
            "text": "Informar o prazo de análise exibido na ferramenta ou o prazo de referência de até cinco dias úteis, evitando responder que não sabe o prazo.",
            "source": "OFFICIAL_PROCEDURE"
          },
          "requirement": "Informar prazo objetivo para a análise da contestação",
          "uncertainty": null,
          "evidenceType": "OBSERVED",
          "knowledgeQuote": "Sempre informar prazo de forma objetiva:",
          "transcriptEvidence": [
            "Operador: Não sei te dizer um prazo certinho, depende da fila deles."
          ],
          "knowledgeDetailQuote": "“A contestação foi registrada hoje e será analisada em até cinco dias úteis. O retorno será enviado por SMS.”"
        },
        {
          "status": "NOT_OBSERVABLE",
          "guidance": {
            "text": "Consultar a possibilidade de bloquear novas assinaturas desse tipo e obter autorização do cliente.",
            "source": "OFFICIAL_PROCEDURE"
          },
          "requirement": "Ativar bloqueio preventivo, se disponível e autorizado",
          "uncertainty": "Não é possível confirmar pela transcrição se a ferramenta disponibilizava o recurso de bloqueio preventivo para esta linha.",
          "evidenceType": null,
          "knowledgeQuote": "4. Ativar bloqueio preventivo, se disponível e autorizado;",
          "transcriptEvidence": [],
          "knowledgeDetailQuote": "O bloqueio preventivo deverá ser autorizado pelo cliente."
        },
        {
          "status": "FOLLOWED",
          "guidance": {
            "text": "Verificar ativamente se restou alguma dúvida antes de finalizar o atendimento.",
            "source": "OFFICIAL_PROCEDURE"
          },
          "requirement": "Confirmar se restaram dúvidas com o cliente",
          "uncertainty": null,
          "evidenceType": "OBSERVED",
          "knowledgeQuote": "- [ ] Confirmei se restaram dúvidas?",
          "transcriptEvidence": [
            "Operador: Ficou alguma dúvida sobre o que a gente combinou?"
          ],
          "knowledgeDetailQuote": "“Ficou alguma dúvida sobre o valor que deve ser pago?”"
        },
        {
          "status": "FOLLOWED",
          "guidance": {
            "text": "Informar o protocolo de atendimento ao cliente.",
            "source": "OFFICIAL_PROCEDURE"
          },
          "requirement": "Fornecer número de protocolo ao cliente",
          "uncertainty": null,
          "evidenceType": "OBSERVED",
          "knowledgeQuote": "- Forneci protocolo?",
          "transcriptEvidence": [
            "Operador: Resumindo, Renata: abri a contestação das duas cobranças de R$ 16,90 do Mundo Kids, a renovação do pacote já foi tirada, e o seu protocolo é 2026 0926 3357."
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
          "status": "NOT_FOLLOWED",
          "guidance": {
            "text": "Informar expressamente o próximo passo e o prazo antes de finalizar a chamada.",
            "source": "OFFICIAL_SERVICE_GUIDELINE"
          },
          "requirement": "Explicar o próximo passo e o prazo",
          "uncertainty": null,
          "evidenceType": "OBSERVED",
          "knowledgeQuote": "Antes de encerrar qualquer chamada: (1) confirme a solução aplicada; (2) informe o número do protocolo; (3) explique o próximo passo e o prazo; (4) confirme se o cliente tem mais alguma dúvida.",
          "transcriptEvidence": [
            "Operador: Não sei te dizer um prazo certinho, depende da fila deles."
          ],
          "knowledgeDetailQuote": null
        },
        {
          "status": "FOLLOWED",
          "guidance": {
            "text": "Perguntar se o cliente possui mais dúvidas antes de concluir o atendimento.",
            "source": "OFFICIAL_SERVICE_GUIDELINE"
          },
          "requirement": "Confirmar se o cliente tem mais alguma dúvida",
          "uncertainty": null,
          "evidenceType": "OBSERVED",
          "knowledgeQuote": "Antes de encerrar qualquer chamada: (1) confirme a solução aplicada; (2) informe o número do protocolo; (3) explique o próximo passo e o prazo; (4) confirme se o cliente tem mais alguma dúvida.",
          "transcriptEvidence": [
            "Operador: Ficou alguma dúvida sobre o que a gente combinou?"
          ],
          "knowledgeDetailQuote": null
        }
      ],
      "documentTitle": "Checklist de Encerramento de Chamada"
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
        "presentedSteps": 82
      },
      {
        "capacity": 12,
        "documentTitle": "Checklist de Encerramento de Chamada",
        "presentedSteps": 4
      }
    ]
  },
  "applicability": []
}
/** A resposta REAL do redator (slots ITEM_1..ITEM_6 = prazo, próximo passo, cancelamento, contestação, dúvidas, protocolo). */
export const V171M_WRITER_RAW = {
  "items": [
    {
      "slot": "ITEM_1",
      "observed": "Você informou que não sabia o prazo para a análise da contestação e mencionou que o tempo dependia da fila de trabalho.",
      "whatYouCanDo": "Nas próximas chamadas, consulte a ferramenta e informe o prazo oficial de análise para o cliente.",
      "whyItMatters": "Informar o prazo de forma objetiva contribui para que o cliente tenha clareza sobre o tempo necessário para o retorno da solicitação.",
      "suggestedResponse": "A sua contestação foi registrada e será analisada em até cinco dias úteis. O retorno com o resultado será enviado para você."
    },
    {
      "slot": "ITEM_2",
      "observed": "Você afirmou ao cliente que não sabia informar um prazo definido antes de finalizar a chamada.",
      "whatYouCanDo": "Ao finalizar o atendimento, explique claramente qual será o próximo passo e informe o prazo de análise consultado no sistema.",
      "whyItMatters": "Explicar o próximo passo e o prazo é um requisito indispensável antes de encerrar qualquer atendimento.",
      "suggestedResponse": ""
    },
    {
      "slot": "ITEM_3",
      "observed": "Você confirmou ao cliente que realizou o cancelamento da renovação automática do pacote, evitando novas cobranças.",
      "whatYouCanDo": "Continue realizando o cancelamento da recorrência do serviço digital, conforme o procedimento estabelecido.",
      "whyItMatters": "",
      "suggestedResponse": ""
    },
    {
      "slot": "ITEM_4",
      "observed": "Você declarou ter registrado a contestação das cobranças do serviço mencionado para análise pela área de faturamento.",
      "whatYouCanDo": "Mantenha o registro da contestação para todas as cobranças que o cliente não reconhecer.",
      "whyItMatters": "",
      "suggestedResponse": ""
    },
    {
      "slot": "ITEM_5",
      "observed": "Você perguntou ativamente ao cliente se ele ainda tinha alguma dúvida sobre o que foi tratado antes de finalizar a interação.",
      "whatYouCanDo": "Siga confirmando se restaram dúvidas com o cliente, conforme o checklist de encerramento.",
      "whyItMatters": "",
      "suggestedResponse": ""
    },
    {
      "slot": "ITEM_6",
      "observed": "Você informou o número do protocolo de atendimento ao cliente durante a finalização da chamada.",
      "whatYouCanDo": "Continue informando o número de protocolo ao final de cada atendimento, conforme o checklist do operador.",
      "whyItMatters": "",
      "suggestedResponse": ""
    }
  ],
  "presentation": {
    "closing": "O atendimento foi bem conduzido no registro da contestação e no suporte dado ao cliente quanto ao cancelamento de serviços. Para as próximas interações, lembre-se de informar o prazo de análise de forma objetiva, conforme o procedimento.",
    "introduction": "Analisei o atendimento de 26/09/2026 sobre Contestação de cobrança. Identifiquei pontos positivos no cancelamento da recorrência, registro da contestação, na confirmação de entendimento e na entrega do protocolo, mas notei oportunidades no prazo da análise e na confirmação de entendimento. A seguir, explico o que ocorreu e como conduzir essas etapas nas próximas vezes."
  }
}
