/**
 * V1.7.1j — o smoke REAL da V1.7.1i reproduzido offline (SMOKE-V171I-CONTESTACAO-001, matrícula b4829f9d, artefato 658222c0):
 * transcrição enviada pela Central de Dados, avaliação de processo do Especialista de Faturamento (gemini-3.8-flash, 1 chamada,
 * sem edição), trechos que entraram no prompt dele e a resposta REAL do redator (gemini-3.1-flash-lite). A versão publicada do
 * procedimento é a mesma da fixture V1.7.1f (versão 1). Sem modelo.
 */
import type { PresentedKnowledgeExcerpt } from "../domain/process-assessment.js"
export { V171F_CONTENT as V171I_CONTENT, V171F_DOC_ID as V171I_DOC_ID, V171F_DOC_TITLE as V171I_DOC_TITLE, V171F_PUBLISHED as V171I_PUBLISHED } from "./contestacao-v171f-smoke-fixture.js"

export const V171I_SUBJECT = "Contestação de cobrança"
export const V171I_COLLABORATOR_NAME = "Larissa Monteiro"
export const V171I_OTHER_OPERATOR_NAMES: string[] = [
  "Marina Lopes",
  "Marina Siqueira",
  "Roberto Queiroz",
  "Roberto Serra",
  "Sérgio Castro Pinto",
  "Sérgio Lopes Medeiros",
  "Sérgio Medeiros Pires",
  "Sérgio Soares"
]
export const V171I_TRANSCRIPT = "Operador: Conecta, boa noite, meu nome é Larissa. Com quem eu falo?\nCliente: Oi, boa noite. Aqui é a Marina, eu sou a titular. Tô ligando porque veio uma cobrança estranha na minha conta de setembro.\nOperador: Claro, Marina, vamos ver isso juntas. Pra acessar a sua conta, me confirma os três últimos números do CPF?\nCliente: 604.\nOperador: E a data de nascimento, por favor?\nCliente: 19 de abril de 1990.\nOperador: Obrigada, tá confirmado. Me fala qual é a cobrança que você não está reconhecendo.\nCliente: Tem uma linha escrita Banca Digital, uns dez reais. Nunca vi isso.\nOperador: Achei aqui. É uma assinatura de revistas digitais, a Banca Digital, de R$ 9,90 por mês. Ela começou em agosto, então aparece na conta de agosto e na de setembro. A ativação foi pelo site, no dia 3 de agosto.\nCliente: Pelo site? Eu não entrei em site nenhum pra assinar revista.\nOperador: Entendi. E essas contas, você já pagou alguma?\nCliente: A de agosto eu paguei, a de setembro vence semana que vem.\nOperador: Tá. Então eu vou abrir a contestação dos dois meses dessa assinatura pro faturamento analisar.\nCliente: E essa assinatura vai continuar?\nOperador: Não, já desativei a renovação dela aqui, não vai mais entrar na sua conta.\nCliente: Ah, que bom. E quando eu vou saber se vão me devolver?\nOperador: Agora é aguardar a análise do pessoal, eles verificam e te dão um retorno.\nCliente: Tá, mas demora muito?\nOperador: Olha, depende deles, mas eles resolvem.\nCliente: Tudo bem.\nOperador: Então, só pra gente fechar, Marina: a contestação dos dois meses da Banca Digital tá aberta, a renovação eu já desativei, e o seu protocolo é 2026 0925 1188.\nCliente: Anotado.\nOperador: Ficou alguma dúvida sobre o que a gente fez?\nCliente: Não, ficou claro.\nOperador: Então obrigada pela ligação, Marina. Uma boa noite pra você!"
export const V171I_PRESENTED: PresentedKnowledgeExcerpt[] = [
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
    "documentId": "c8f2c818-72db-48dc-8d7d-d8a9fe861c65",
    "documentTitle": "Procedimento Operacional — Contestação de Contas Móvel",
    "heading": "23. Pagamento não reconhecido",
    "excerpt": "Quando o cliente afirmar que pagou e o sistema não reconheceu:\n\n1. Confirmar valor;\n2. Confirmar data;\n3. Confirmar canal de pagamento;\n4. Verificar código ou conta utilizada;\n5. Solicitar comprovante pelo canal seguro;\n6. Abrir análise;\n7. Avaliar bloqueio da linha;\n8. Informar prazo.\n\nNão solicitar envio de comprovante para e-mail pessoal ou canal não autorizado.",
    "chunkIndex": 34
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
    "heading": "35. Prazo da análise",
    "excerpt": "O operador deverá informar o prazo exibido na ferramenta.\n\nComo referência operacional:\n\n- Ajuste dentro da alçada: durante o atendimento;\n- Emissão de conta ajustada: conforme processamento informado;\n- Análise de faturamento: preferencialmente em até cinco dias úteis;\n- Suspeita de fraude: conforme prazo da área especializada;\n- Pagamento não reconhecido: conforme prazo de conciliação;\n- Estorno: conforme forma de pagamento e processamento financeiro.\n\nSempre informar prazo de forma objetiva:\n\n“A contestação foi registrada hoje e será analisada em até cinco dias úteis. O retorno será enviado por SMS.”\n\nEvitar:\n\n- “É só aguardar.”\n- “Logo será resolvido.”\n- “O setor vai verificar.”\n- “Não sei o prazo.”",
    "chunkIndex": 51
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
export const V171I_ASSESSMENT = {
  "processes": [
    {
      "product": null,
      "checkpoints": [
        {
          "status": "FOLLOWED",
          "guidance": {
            "text": "Realizar a saudação inicial, informar seu nome e perguntar com quem está falando.",
            "source": "OFFICIAL_PROCEDURE"
          },
          "requirement": "Apresentação do operador com identificação e acolhimento",
          "uncertainty": null,
          "evidenceType": "OBSERVED",
          "knowledgeQuote": "Olá, boa tarde! Meu nome é Juliana Prado, sou do atendimento Vivo. Com quem eu tenho o prazer de falar?",
          "transcriptEvidence": [
            "Operador: Conecta, boa noite, meu nome é Larissa. Com quem eu falo?"
          ],
          "knowledgeDetailQuote": null
        },
        {
          "status": "FOLLOWED",
          "guidance": {
            "text": "Consultar e detalhar o nome, valor, data de ativação e canal de contratação do serviço questionado.",
            "source": "OFFICIAL_PROCEDURE"
          },
          "requirement": "Verificar informações do serviço digital não reconhecido (nome, valor, ativação)",
          "uncertainty": null,
          "evidenceType": "OBSERVED",
          "knowledgeQuote": "Verificar: Nome do serviço; Valor; Data de ativação; Canal de contratação; Recorrência; Histórico de confirmação; Linha em que foi ativado; Cobranças anteriores.",
          "transcriptEvidence": [
            "Operador: Achei aqui. É uma assinatura de revistas digitais, a Banca Digital, de R$ 9,90 por mês. Ela começou em agosto, então aparece na conta de agosto e na de setembro. A ativação foi pelo site, no dia 3 de agosto."
          ],
          "knowledgeDetailQuote": null
        },
        {
          "status": "FOLLOWED",
          "guidance": {
            "text": "Efetuar o cancelamento da renovação ou recorrência do serviço digital contestado.",
            "source": "OFFICIAL_PROCEDURE"
          },
          "requirement": "Cancelar a recorrência do serviço digital não reconhecido",
          "uncertainty": null,
          "evidenceType": "OBSERVED",
          "knowledgeQuote": "Cancelar a recorrência, quando permitido;",
          "transcriptEvidence": [
            "Operador: Não, já desativei a renovação dela aqui, não vai mais entrar na sua conta."
          ],
          "knowledgeDetailQuote": null
        },
        {
          "status": "FOLLOWED",
          "guidance": {
            "text": "Registrar a contestação dos valores faturados indevidamente para análise de faturamento.",
            "source": "OFFICIAL_PROCEDURE"
          },
          "requirement": "Registrar a contestação dos valores",
          "uncertainty": null,
          "evidenceType": "OBSERVED",
          "knowledgeQuote": "Registrar contestação;",
          "transcriptEvidence": [
            "Operador: Tá. Então eu vou abrir a contestação dos dois meses dessa assinatura pro faturamento analisar."
          ],
          "knowledgeDetailQuote": null
        },
        {
          "status": "NOT_OBSERVABLE",
          "guidance": {
            "text": "Consultar e oferecer a ativação do bloqueio preventivo de novos serviços digitais mediante autorização do cliente.",
            "source": "OFFICIAL_PROCEDURE"
          },
          "requirement": "Ativar bloqueio preventivo, se disponível e autorizado",
          "uncertainty": "A ferramenta ou disponibilidade de bloqueio preventivo para esta linha específica não pode ser observada na transcrição.",
          "evidenceType": null,
          "knowledgeQuote": "Ativar bloqueio preventivo, se disponível e autorizado;",
          "transcriptEvidence": [],
          "knowledgeDetailQuote": "O bloqueio preventivo deverá ser autorizado pelo cliente."
        },
        {
          "status": "NOT_FOLLOWED",
          "guidance": {
            "text": "Informar prazo objetivo de análise (preferencialmente até cinco dias úteis) e canal de retorno, evitando termos como 'é só aguardar'.",
            "source": "OFFICIAL_PROCEDURE"
          },
          "requirement": "Informar o prazo de análise de forma objetiva e canal de retorno",
          "uncertainty": null,
          "evidenceType": "OBSERVED",
          "knowledgeQuote": "Sempre informar prazo de forma objetiva: “A contestação foi registrada hoje e será analisada em até cinco dias úteis. O retorno será enviado por SMS.”",
          "transcriptEvidence": [
            "Operador: Agora é aguardar a análise do pessoal, eles verificam e te dão um retorno.",
            "Operador: Olha, depende deles, mas eles resolvem."
          ],
          "knowledgeDetailQuote": "Evitar: - “É só aguardar.” - “Logo será resolvido.” - “O setor vai verificar.” - “Não sei o prazo.”"
        },
        {
          "status": "FOLLOWED",
          "guidance": {
            "text": "Recapitular as ações realizadas e fornecer o número de protocolo de atendimento ao cliente.",
            "source": "OFFICIAL_PROCEDURE"
          },
          "requirement": "Recapitulação antes de encerrar e fornecimento do protocolo",
          "uncertainty": null,
          "evidenceType": "OBSERVED",
          "knowledgeQuote": "Antes de encerrar, informar: Conta analisada; Lançamento contestado; Valor; Ação realizada; Serviço cancelado, quando aplicável; Conta ajustada; Valor a pagar; Prazo; Canal de retorno; Protocolo.",
          "transcriptEvidence": [
            "Operador: Então, só pra gente fechar, Marina: a contestação dos dois meses da Banca Digital tá aberta, a renovação eu já desativei, e o seu protocolo é 2026 0925 1188."
          ],
          "knowledgeDetailQuote": null
        },
        {
          "status": "FOLLOWED",
          "guidance": {
            "text": "Perguntar ativamente ao cliente se restaram dúvidas antes de finalizar a chamada.",
            "source": "OFFICIAL_PROCEDURE"
          },
          "requirement": "Confirmação de entendimento de dúvidas",
          "uncertainty": null,
          "evidenceType": "OBSERVED",
          "knowledgeQuote": "Perguntar: “As informações ficaram claras?” “Ficou alguma dúvida sobre o valor que deve ser pago?” “Posso esclarecer o prazo ou o acompanhamento?” “Existe outra cobrança da mesma conta que você não reconhece?”",
          "transcriptEvidence": [
            "Operador: Ficou alguma dúvida sobre o que a gente fez?"
          ],
          "knowledgeDetailQuote": null
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
        "presentedSteps": 98
      }
    ]
  },
  "applicability": []
}
export const V171I_WRITER_RAW = {
  "items": [
    {
      "slot": "ITEM_1",
      "observed": "Você não informou o prazo exato para a análise da contestação, utilizando termos imprecisos como 'aguardar' e 'depende deles'.",
      "whatYouCanDo": "Ao finalizar o registro, informe o prazo específico conforme o sistema e indique o canal de retorno, dizendo: 'A contestação foi registrada hoje e será analisada em até cinco dias úteis. O retorno será enviado por SMS.'",
      "whyItMatters": "Informar o prazo de forma objetiva contribui para que o cliente tenha clareza sobre o tempo necessário para o tratamento da solicitação.",
      "suggestedResponse": "A contestação foi registrada hoje e será analisada em até cinco dias úteis. O retorno com o resultado será enviado por SMS."
    },
    {
      "slot": "ITEM_2",
      "observed": "Você iniciou o atendimento saudando o cliente e identificando-se pelo nome.",
      "whatYouCanDo": "",
      "whyItMatters": "",
      "suggestedResponse": ""
    },
    {
      "slot": "ITEM_3",
      "observed": "Você declarou ao cliente que realizou a desativação da renovação do serviço para evitar novas cobranças.",
      "whatYouCanDo": "",
      "whyItMatters": "",
      "suggestedResponse": ""
    },
    {
      "slot": "ITEM_4",
      "observed": "Você perguntou ativamente ao cliente se havia restado alguma dúvida sobre os procedimentos realizados.",
      "whatYouCanDo": "",
      "whyItMatters": "",
      "suggestedResponse": ""
    },
    {
      "slot": "ITEM_5",
      "observed": "Você consultou e detalhou ao cliente o nome do serviço, o valor, a data de ativação e o canal de contratação.",
      "whatYouCanDo": "",
      "whyItMatters": "",
      "suggestedResponse": ""
    },
    {
      "slot": "ITEM_6",
      "observed": "Você declarou que abriria a contestação dos valores referentes aos meses mencionados para análise do faturamento.",
      "whatYouCanDo": "",
      "whyItMatters": "",
      "suggestedResponse": ""
    }
  ],
  "presentation": {
    "closing": "Você realizou um atendimento completo e assertivo nos pontos de registro e validação do serviço. Ajustando a clareza sobre o prazo da análise, você tornará a experiência do cliente ainda mais transparente.",
    "introduction": "Analisei seu atendimento sobre a contestação de cobrança. Você conduziu bem a apresentação inicial, a verificação dos dados do serviço, o cancelamento da recorrência, o registro da contestação e a confirmação de entendimento com o cliente. Identifiquei oportunidade de melhoria no prazo da análise e na recapitulação obrigatória, pontos que detalho a seguir para apoiar seus próximos atendimentos."
  }
}
