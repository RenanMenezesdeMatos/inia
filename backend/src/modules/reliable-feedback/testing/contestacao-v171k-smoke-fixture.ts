/**
 * V1.7.1l — o smoke REAL da V1.7.1k reproduzido offline (SMOKE-V171K-CONTESTACAO-001, matrícula 2338dd90, artefato 5836e71d):
 * transcrição enviada pela Central de Dados, avaliação de processo do Especialista de Faturamento (gemini-3.8-flash, 1 chamada,
 * sem edição), os trechos que entraram no prompt dele e a resposta REAL do redator (gemini-3.1-flash-lite). Versões publicadas:
 * o procedimento e o "Checklist de Encerramento de Chamada" são os mesmos das fixtures V1.7.1f/V1.7.1j (versão 1, conteúdo
 * conferido por hash contra o banco). Sem modelo.
 */
import type { PresentedKnowledgeExcerpt } from "../domain/process-assessment.js"
export { V171J_PUBLISHED as V171K_PUBLISHED, V171J_CONTENT as V171K_CONTENT, V171J_DOC_ID as V171K_DOC_ID, V171J_DOC_TITLE as V171K_DOC_TITLE, V171J_CHECKLIST_ID as V171K_CHECKLIST_ID } from "./contestacao-v171j-smoke-fixture.js"

export const V171K_SUBJECT = "Contestação de cobrança"
export const V171K_COLLABORATOR_NAME = "Larissa Monteiro"
export const V171K_TRANSCRIPT = "Operador: Conecta, boa noite, aqui é a Larissa. Com quem eu falo?\nCliente: Boa noite, Larissa. É a Débora Nunes, titular da conta. Apareceu uma cobrança na minha fatura que eu não conheço.\nOperador: Tudo bem, Débora, vamos resolver. Pra eu acessar seu cadastro, me passa os três últimos números do CPF e a data de nascimento?\nCliente: 725, e nasci em 3 de março de 1979.\nOperador: Obrigada. E o seu telefone de contato continua sendo o (11) 98765-4321?\nCliente: Continua, sim.\nOperador: Certo. Qual é a cobrança que você não reconhece?\nCliente: Um tal de Leitura Plus. Nunca assinei isso.\nOperador: Encontrei aqui: é uma assinatura de revistas, a Leitura Plus, de R$ 19,90 por mês. Foi contratada pelo aplicativo no dia 2 de agosto e cobrou na conta de agosto e na de setembro.\nCliente: Pelo aplicativo? Eu nem uso esse aplicativo direito.\nOperador: Entendi. Você chegou a pagar alguma dessas contas?\nCliente: A de agosto eu paguei. A de setembro ainda está em aberto.\nOperador: Tá bom. Então eu vou abrir aqui a contestação das duas cobranças da Leitura Plus, e a equipe de faturamento vai analisar.\nCliente: E essa assinatura vai continuar cobrando?\nOperador: Não, pode ficar tranquila, já desativei a renovação dela, não vai mais aparecer na sua fatura.\nCliente: Que bom. E o dinheiro de agosto, volta quando?\nOperador: Agora é só aguardar o retorno da análise, eles olham e depois te avisam.\nCliente: Mas é rápido?\nOperador: Olha, não tenho como te dizer exatamente, depende da equipe.\nCliente: Entendi.\nOperador: Então, Débora, recapitulando: a contestação das duas cobranças de R$ 19,90 da Leitura Plus está registrada, a renovação ficou desativada, e o seu protocolo é 2026 0925 7730.\nCliente: Só um minuto que vou anotar... anotei.\nOperador: Ficou claro pra você como vai funcionar daqui pra frente?\nCliente: Ficou sim, obrigada.\nOperador: Posso te ajudar em mais alguma coisa?\nCliente: Não, era só isso.\nOperador: Então obrigada pela ligação, Débora. Uma ótima noite!"
export const V171K_PRESENTED: PresentedKnowledgeExcerpt[] = [
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
    "heading": "Perguntas recomendadas",
    "excerpt": "- “A solução atendeu ao que você precisava?”\n- “Você conseguiu acessar?”\n- “O serviço está funcionando agora?”\n- “Ficou alguma dúvida sobre o prazo?”\n- “Posso ajudar em mais alguma questão?”\n\nEvitar:\n\n- “Era só isso?”\n- “Terminou?”\n- “Mais alguma coisa?”, em tom apressado.\n- Encerrar imediatamente após executar a ação.",
    "chunkIndex": 63
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
    "heading": "1. Objetivo",
    "excerpt": "Definir o processo para análise, registro e acompanhamento de contestações relacionadas a contas de telefonia móvel, garantindo:\n\n- Identificação correta da cobrança questionada;\n- Validação segura do titular;\n- Explicação clara da composição da conta;\n- Correção imediata quando houver evidência e alçada;\n- Abertura de análise quando a cobrança depender de investigação;\n- Prevenção de novas cobranças indevidas;\n- Informação sobre valores, prazos e canais de acompanhamento;\n- Emissão de conta ajustada quando aplicável;\n- Registro completo da manifestação;\n- Tratamento respeitoso, imparcial e resolutivo.\n\nO operador não deverá presumir que a cobrança é correta nem confirmar erro antes de consultar as informações disponíveis.",
    "chunkIndex": 1
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
    "heading": "48. Encerramento",
    "excerpt": "**Quando houver ajuste imediato:**\n\n“O valor foi corrigido e a conta ajustada ficará disponível no canal informado. Seu protocolo é 202609130184. Ficou alguma dúvida?”\n\n**Quando houver análise:**\n\n“A contestação foi registrada e será analisada no prazo informado. O retorno será enviado por SMS. Seu protocolo é 202609130184.”\n\n**Quando a cobrança for esclarecida:**\n\n“Confirmamos que o valor corresponde ao período e ao serviço detalhados. O protocolo deste atendimento é 202609130184. Posso ajudar em mais alguma questão?”",
    "chunkIndex": 64
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
    "heading": "6. Escuta e identificação da solicitação",
    "excerpt": "O operador deverá permitir que o cliente explique:\n\n- Qual conta está questionando;\n- Qual cobrança não reconhece;\n- Qual valor esperava;\n- Qual valor foi faturado;\n- Quando percebeu a diferença;\n- Se a conta já foi paga;\n- Se já houve contato anterior;\n- Se a cobrança continua ocorrendo;\n- Se existe ameaça de bloqueio ou negativação;\n- Se há suspeita de fraude.\n\n**Exemplo:**\n\n“Para eu analisar corretamente, poderia me informar qual cobrança você não reconhece e em qual conta ela aparece?”\n\nDepois, confirmar o entendimento:\n\n“Entendi. Sua mensalidade habitual era de R$ 89,99, mas a conta atual veio em R$ 149,89 por causa de um serviço digital de R$ 59,90 que você não reconhece. Está correto?”",
    "chunkIndex": 17
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

/** Avaliação de processo REAL do especialista (validada pelo contrato V2: COMPLETE, 0 itens fora). */
export const V171K_ASSESSMENT = {
  "processes": [
    {
      "product": null,
      "checkpoints": [
        {
          "status": "FOLLOWED",
          "guidance": {
            "text": "Identificar a conta questionada, o lançamento, valor e se a conta foi paga.",
            "source": "OFFICIAL_PROCEDURE"
          },
          "requirement": "Identificação correta da cobrança questionada e verificação de pagamento",
          "uncertainty": null,
          "evidenceType": "OBSERVED",
          "knowledgeQuote": "Identificação correta da cobrança questionada;",
          "transcriptEvidence": [
            "Operador: Certo. Qual é a cobrança que você não reconhece?",
            "Operador: Encontrei aqui: é uma assinatura de revistas, a Leitura Plus, de R$ 19,90 por mês. Foi contratada pelo aplicativo no dia 2 de agosto e cobrou na conta de agosto e na de setembro.",
            "Operador: Entendi. Você chegou a pagar alguma dessas contas?"
          ],
          "knowledgeDetailQuote": "O operador deverá permitir que o cliente explique: - Qual conta está questionando; - Qual cobrança não reconhece;"
        },
        {
          "status": "FOLLOWED",
          "guidance": {
            "text": "Cancelar eventual recorrência indevida para evitar novas cobranças.",
            "source": "OFFICIAL_PROCEDURE"
          },
          "requirement": "Prevenção de novas cobranças indevidas e cancelamento de recorrência",
          "uncertainty": null,
          "evidenceType": "OBSERVED",
          "knowledgeQuote": "Prevenção de novas cobranças indevidas;",
          "transcriptEvidence": [
            "Operador: Não, pode ficar tranquila, já desativei a renovação dela, não vai mais aparecer na sua fatura."
          ],
          "knowledgeDetailQuote": "- [ ] Cancelei eventual recorrência indevida?"
        },
        {
          "status": "FOLLOWED",
          "guidance": {
            "text": "Encaminhar a cobrança para análise quando depender de investigação.",
            "source": "OFFICIAL_PROCEDURE"
          },
          "requirement": "Abertura de análise quando a cobrança depender de investigação",
          "uncertainty": null,
          "evidenceType": "OBSERVED",
          "knowledgeQuote": "Abertura de análise quando a cobrança depender de investigação;",
          "transcriptEvidence": [
            "Operador: Tá bom. Então eu vou abrir aqui a contestação das duas cobranças da Leitura Plus, e a equipe de faturamento vai analisar."
          ],
          "knowledgeDetailQuote": "- [ ] Abri análise quando necessário?"
        },
        {
          "status": "NOT_FOLLOWED",
          "guidance": {
            "text": "Informar o prazo de análise e o canal de retorno ao registrar a contestação.",
            "source": "OFFICIAL_PROCEDURE"
          },
          "requirement": "Informação sobre prazos e canais de acompanhamento",
          "uncertainty": null,
          "evidenceType": "OBSERVED",
          "knowledgeQuote": "Informação sobre valores, prazos e canais de acompanhamento;",
          "transcriptEvidence": [
            "Operador: Olha, não tenho como te dizer exatamente, depende da equipe."
          ],
          "knowledgeDetailQuote": "A contestação foi registrada e será analisada no prazo informado. O retorno será enviado por SMS."
        },
        {
          "status": "FOLLOWED",
          "guidance": {
            "text": "Recapitular as ações realizadas e fornecer o número do protocolo antes de finalizar.",
            "source": "OFFICIAL_PROCEDURE"
          },
          "requirement": "Recapitulação obrigatória e fornecimento de protocolo",
          "uncertainty": null,
          "evidenceType": "OBSERVED",
          "knowledgeQuote": "Antes de encerrar, informar: - Conta analisada; - Lançamento contestado; - Valor; - Ação realizada; - Serviço cancelado, quando aplicável; - Conta ajustada; - Valor a pagar; - Prazo; - Canal de retorno; - Protocolo.",
          "transcriptEvidence": [
            "Operador: Então, Débora, recapitulando: a contestação das duas cobranças de R$ 19,90 da Leitura Plus está registrada, a renovação ficou desativada, e o seu protocolo é 2026 0925 7730."
          ],
          "knowledgeDetailQuote": "Vamos recapitular o que foi realizado."
        },
        {
          "status": "FOLLOWED",
          "guidance": {
            "text": "Confirmar se as informações ficaram claras para o cliente antes de concluir.",
            "source": "OFFICIAL_PROCEDURE"
          },
          "requirement": "Confirmação de entendimento",
          "uncertainty": null,
          "evidenceType": "OBSERVED",
          "knowledgeQuote": "Perguntar: - “As informações ficaram claras?”",
          "transcriptEvidence": [
            "Operador: Ficou claro pra você como vai funcionar daqui pra frente?"
          ],
          "knowledgeDetailQuote": "Evitar encerrar apenas com “é só isso?”."
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
        "presentedSteps": 71
      }
    ]
  },
  "applicability": []
}

/** Resposta REAL do redator, na ordem dos itens daquela execução (ITEM_1 prazo · 2 abertura · 3 identificação · 4 prevenção · 5 confirmação). */
export const V171K_WRITER_RAW = {
  "items": [
    {
      "slot": "ITEM_1",
      "observed": "Você não informou o prazo de análise e o canal de retorno ao cliente sobre a contestação realizada.",
      "whatYouCanDo": "Ao registrar a contestação, informe o prazo específico de análise da equipe e comunique que o retorno será enviado por SMS.",
      "whyItMatters": "A informação clara sobre prazos e canais de acompanhamento é necessária para o alinhamento com o cliente.",
      "suggestedResponse": "A sua contestação foi registrada e será analisada. O prazo para a conclusão é o que aparece aqui no sistema e o retorno sobre o resultado será enviado para o seu celular via SMS."
    },
    {
      "slot": "ITEM_2",
      "observed": "Você declarou que encaminhou as cobranças da Leitura Plus para a equipe de faturamento realizar a análise.",
      "whatYouCanDo": "",
      "whyItMatters": "",
      "suggestedResponse": ""
    },
    {
      "slot": "ITEM_3",
      "observed": "Você confirmou qual cobrança não era reconhecida, detalhou a assinatura Leitura Plus e verificou com o cliente se as faturas foram pagas.",
      "whatYouCanDo": "",
      "whyItMatters": "A identificação correta da cobrança e a verificação do pagamento permitem entender a situação para tratar a contestação de forma precisa.",
      "suggestedResponse": ""
    },
    {
      "slot": "ITEM_4",
      "observed": "Você declarou ter realizado o cancelamento da renovação do serviço, prevenindo novas cobranças recorrentes.",
      "whatYouCanDo": "",
      "whyItMatters": "O cancelamento de eventuais recorrências evita que cobranças indevidas continuem sendo geradas.",
      "suggestedResponse": ""
    },
    {
      "slot": "ITEM_5",
      "observed": "Você perguntou ao cliente se as informações passadas ficaram claras para ele.",
      "whatYouCanDo": "",
      "whyItMatters": "A confirmação de entendimento contribui para que o cliente saiba exatamente o que foi acordado ao final do contato.",
      "suggestedResponse": ""
    }
  ],
  "presentation": {
    "closing": "Você realizou com sucesso a identificação da cobrança e o cancelamento, além de garantir a confirmação de entendimento. Na próxima, lembre-se de informar o prazo de análise e o canal de acompanhamento para o cliente ao registrar o processo.",
    "introduction": "Analisei seu atendimento sobre a contestação de cobrança. Você conduziu bem a identificação da cobrança, a abertura de análise, o cancelamento da recorrência e a confirmação de entendimento. Identifiquei oportunidade apenas no momento de passar os prazos e canais de retorno; vejamos como ajustar esse ponto."
  }
}
