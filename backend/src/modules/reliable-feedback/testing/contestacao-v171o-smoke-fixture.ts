/**
 * V1.7.1p — o smoke REAL da V1.7.1o reproduzido offline (SMOKE-V171O-CONTESTACAO-001, interação 6e7a404b, matrícula 85a3a85a,
 * artefato em HOLD_FOR_QA): transcrição enviada pela Central de Dados, avaliação de processo REAL do Especialista de Faturamento
 * no contrato V3 (gemini-3.8-flash, 1 chamada, 12 checkpointRefs válidos), os 12 trechos que entraram no prompt dele e a resposta
 * REAL do redator (gemini-3.1-flash-lite, 8 itens). Documentos publicados = os da fixture V1.7.1l (sha256 conferido com o banco
 * em 2026-09-28). Sem modelo.
 */
import type { PresentedKnowledgeExcerpt } from "../domain/process-assessment.js"
import type { RawProcessAssessment } from "../../agents/domain/process-assessment-contract.js"
export { V171L_PUBLISHED as V171O_PUBLISHED, V171L_DOC_TITLE as V171O_DOC_TITLE } from "./contestacao-v171l-smoke-fixture.js"

export const V171O_SUBJECT = "Contestação de cobrança"
export const V171O_COLLABORATOR_NAME = "Larissa Monteiro"
export const V171O_TRANSCRIPT = "Operador: Conecta, bom dia, aqui é a Larissa. Com quem eu falo?\nCliente: Bom dia, Larissa. É a Carolina Prates, a linha está no meu nome. Tem uma cobrança na minha conta que eu não sei o que é.\nOperador: Vou te ajudar, Carolina. Pra eu acessar o cadastro, me confirma os três últimos dígitos do CPF e a sua data de nascimento?\nCliente: 742, e nasci em 9 de maio de 1990.\nOperador: Obrigada, cadastro confirmado. Qual cobrança você não está reconhecendo?\nCliente: Um tal de Cine Mais, de R$ 14,90. Nunca assinei isso.\nOperador: Encontrei aqui. É um serviço de filmes, ativado no dia 12 de agosto por um link de promoção. Ele apareceu nas faturas de agosto e de setembro.\nCliente: Que estranho, eu não lembro de ter clicado em nada.\nOperador: Entendi. E você chegou a pagar alguma dessas faturas?\nCliente: A de agosto eu paguei. A de setembro ainda não venceu.\nOperador: Certo. Já cancelei a renovação do Cine Mais, então ele não cobra mais nas próximas faturas.\nCliente: Ah, que bom.\nOperador: Agora vou registrar a contestação das duas cobranças pra área de faturamento analisar.\nCliente: E em quanto tempo eu tenho uma resposta?\nOperador: Então, não consigo te passar um prazo certinho, depende da análise deles.\nCliente: Entendi.\nOperador: Seu telefone de contato continua sendo esse mesmo com final 4418?\nCliente: Isso, é esse mesmo.\nOperador: Resumindo, Carolina: a renovação do Cine Mais foi cancelada, a contestação das duas cobranças de R$ 14,90 está registrada e o seu protocolo é 2026 0928 4471.\nCliente: Anotei aqui.\nOperador: Ficou alguma dúvida sobre o que a gente conversou?\nCliente: Não, ficou tudo claro.\nOperador: Então é isso. Obrigada por ligar, Carolina, tenha um bom dia!"
export const V171O_PRESENTED: PresentedKnowledgeExcerpt[] = [
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
    "heading": "57. Resultado esperado",
    "excerpt": "Ao final, o cliente deverá saber:\n\n- Qual cobrança foi analisada;\n- Qual é a origem do valor;\n- Se a cobrança foi corrigida ou contestada;\n- Se o serviço foi cancelado;\n- Qual valor deverá pagar;\n- Onde obter a conta ajustada;\n- Qual é o prazo da análise;\n- Como receberá o retorno;\n- Qual é o protocolo;\n- O que deverá fazer se a cobrança reaparecer.\n\nO cliente não deverá encerrar o contato apenas com a orientação de aguardar, pagar integralmente ou ligar novamente.",
    "chunkIndex": 73
  },
  {
    "documentId": "b8da52ca-e65c-419c-bace-83431f04ba2c",
    "documentTitle": "Procedimento Operacional Jeito Vivo de Atender",
    "heading": "Perguntas recomendadas",
    "excerpt": "- “A solução atendeu ao que você precisava?”\n- “Você conseguiu acessar?”\n- “O serviço está funcionando agora?”\n- “Ficou alguma dúvida sobre o prazo?”\n- “Posso ajudar em mais alguma questão?”\n\nEvitar:\n\n- “Era só isso?”\n- “Terminou?”\n- “Mais alguma coisa?”, em tom apressado.\n- Encerrar imediatamente após executar a ação.",
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
    "heading": "6. Escuta e identificação da solicitação",
    "excerpt": "O operador deverá permitir que o cliente explique:\n\n- Qual conta está questionando;\n- Qual cobrança não reconhece;\n- Qual valor esperava;\n- Qual valor foi faturado;\n- Quando percebeu a diferença;\n- Se a conta já foi paga;\n- Se já houve contato anterior;\n- Se a cobrança continua ocorrendo;\n- Se existe ameaça de bloqueio ou negativação;\n- Se há suspeita de fraude.\n\n**Exemplo:**\n\n“Para eu analisar corretamente, poderia me informar qual cobrança você não reconhece e em qual conta ela aparece?”\n\nDepois, confirmar o entendimento:\n\n“Entendi. Sua mensalidade habitual era de R$ 89,99, mas a conta atual veio em R$ 149,89 por causa de um serviço digital de R$ 59,90 que você não reconhece. Está correto?”",
    "chunkIndex": 17
  },
  {
    "documentId": "c8f2c818-72db-48dc-8d7d-d8a9fe861c65",
    "documentTitle": "Procedimento Operacional — Contestação de Contas Móvel",
    "heading": "42. Cliente exaltado",
    "excerpt": "O operador deverá:\n\n- Permitir que o cliente conclua;\n- Reconhecer o impacto;\n- Não elevar o tom;\n- Evitar interrupções;\n- Demonstrar domínio do processo;\n- Apresentar o próximo passo.\n\n**Exemplo:**\n\n“Entendi que essa é a terceira conta com a mesma cobrança e que você já solicitou o cancelamento do serviço. Vou consultar os protocolos anteriores antes de registrar uma nova ação.”",
    "chunkIndex": 58
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
/** A avaliação REAL do especialista (contrato do modelo V3, já validada pelo nó). */
export const V171O_ASSESSMENT = {
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
          "requirement": "Qual cobrança não reconhece",
          "uncertainty": null,
          "evidenceType": "OBSERVED",
          "checkpointRef": "CP-4a48ba4db9",
          "knowledgeQuote": "Qual cobrança não reconhece;",
          "transcriptEvidence": [
            "Operador: Obrigada, cadastro confirmado. Qual cobrança você não está reconhecendo?"
          ],
          "knowledgeDetailQuote": "“Para eu analisar corretamente, poderia me informar qual cobrança você não reconhece e em qual conta ela aparece?”"
        },
        {
          "status": "FOLLOWED",
          "guidance": {
            "text": "O operador deverá permitir que o cliente explique: Se a conta já foi paga;",
            "source": "OFFICIAL_PROCEDURE"
          },
          "requirement": "Se a conta já foi paga",
          "uncertainty": null,
          "evidenceType": "OBSERVED",
          "checkpointRef": "CP-8651ee6f0b",
          "knowledgeQuote": "Se a conta já foi paga;",
          "transcriptEvidence": [
            "Operador: Entendi. E você chegou a pagar alguma dessas faturas?"
          ],
          "knowledgeDetailQuote": null
        },
        {
          "status": "FOLLOWED",
          "guidance": {
            "text": "Verificar: Nome do serviço; Valor; Data de ativação; Canal de contratação; Recorrência; Histórico de confirmação; Linha em que foi ativado; Cobranças anteriores.",
            "source": "OFFICIAL_PROCEDURE"
          },
          "requirement": "Verificar dados do serviço digital não reconhecido",
          "uncertainty": null,
          "evidenceType": "OBSERVED",
          "checkpointRef": "CP-d391f1bac0",
          "knowledgeQuote": "Verificar:\n\n- Nome do serviço;\n- Valor;\n- Data de ativação;\n- Canal de contratação;\n- Recorrência;\n- Histórico de confirmação;\n- Linha em que foi ativado;\n- Cobranças anteriores.",
          "transcriptEvidence": [
            "Operador: Encontrei aqui. É um serviço de filmes, ativado no dia 12 de agosto por um link de promoção. Ele apareceu nas faturas de agosto e de setembro."
          ],
          "knowledgeDetailQuote": null
        },
        {
          "status": "FOLLOWED",
          "guidance": {
            "text": "Se o cliente não reconhecer: 1. Cancelar a recorrência, quando permitido;",
            "source": "OFFICIAL_PROCEDURE"
          },
          "requirement": "Cancelar a recorrência, quando permitido",
          "uncertainty": null,
          "evidenceType": "OBSERVED",
          "checkpointRef": "CP-b9a41387af",
          "knowledgeQuote": "1. Cancelar a recorrência, quando permitido;",
          "transcriptEvidence": [
            "Operador: Certo. Já cancelei a renovação do Cine Mais, então ele não cobra mais nas próximas faturas."
          ],
          "knowledgeDetailQuote": null
        },
        {
          "status": "FOLLOWED",
          "guidance": {
            "text": "Se o cliente não reconhecer: 2. Registrar contestação;",
            "source": "OFFICIAL_PROCEDURE"
          },
          "requirement": "Registrar contestação",
          "uncertainty": null,
          "evidenceType": "OBSERVED",
          "checkpointRef": "CP-a91b89a0e2",
          "knowledgeQuote": "2. Registrar contestação;",
          "transcriptEvidence": [
            "Operador: Agora vou registrar a contestação das duas cobranças pra área de faturamento analisar."
          ],
          "knowledgeDetailQuote": null
        },
        {
          "status": "NOT_FOLLOWED",
          "guidance": {
            "text": "Se o cliente não reconhecer: 5. Explicar prazo;",
            "source": "OFFICIAL_PROCEDURE"
          },
          "requirement": "Explicar prazo",
          "uncertainty": null,
          "evidenceType": "OBSERVED",
          "checkpointRef": "CP-a60913570d",
          "knowledgeQuote": "5. Explicar prazo;",
          "transcriptEvidence": [
            "Operador: Então, não consigo te passar um prazo certinho, depende da análise deles."
          ],
          "knowledgeDetailQuote": null
        },
        {
          "status": "NOT_FOLLOWED",
          "guidance": {
            "text": "Antes de encerrar, informar: Conta analisada; Lançamento contestado; Valor; Ação realizada; Serviço cancelado, quando aplicável; Conta ajustada; Valor a pagar; Prazo; Canal de retorno; Protocolo.",
            "source": "OFFICIAL_PROCEDURE"
          },
          "requirement": "Recapitulação obrigatória antes de encerrar",
          "uncertainty": null,
          "evidenceType": "OBSERVED",
          "checkpointRef": "CP-08ba2d72ba",
          "knowledgeQuote": "Antes de encerrar, informar:\n\n- Conta analisada;\n- Lançamento contestado;\n- Valor;\n- Ação realizada;\n- Serviço cancelado, quando aplicável;\n- Conta ajustada;\n- Valor a pagar;\n- Prazo;\n- Canal de retorno;\n- Protocolo.",
          "transcriptEvidence": [
            "Operador: Resumindo, Carolina: a renovação do Cine Mais foi cancelada, a contestação das duas cobranças de R$ 14,90 está registrada e o seu protocolo é 2026 0928 4471."
          ],
          "knowledgeDetailQuote": "“Recapitulando: contestamos o serviço digital de R$ 29,90, cancelamos a renovação e ativamos o bloqueio preventivo autorizado. A conta ajustada de R$ 94,00 ficará disponível no App Vivo após o processamento. A análise será concluída em até cinco dias úteis. O protocolo é 202609130184.”"
        },
        {
          "status": "FOLLOWED",
          "guidance": {
            "text": "Perguntar: “As informações ficaram claras?” / “Ficou alguma dúvida sobre o valor que deve ser pago?” / “Posso esclarecer o prazo ou o acompanhamento?” / “Existe outra cobrança da mesma conta que você não reconhece?”",
            "source": "OFFICIAL_PROCEDURE"
          },
          "requirement": "Confirmação de entendimento",
          "uncertainty": null,
          "evidenceType": "OBSERVED",
          "checkpointRef": "CP-c8acf59578",
          "knowledgeQuote": "- “As informações ficaram claras?”",
          "transcriptEvidence": [
            "Operador: Ficou alguma dúvida sobre o que a gente conversou?"
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
          "requirement": "confirme a solução aplicada",
          "uncertainty": null,
          "evidenceType": "OBSERVED",
          "checkpointRef": "CP-b9db6af3ba",
          "knowledgeQuote": "(1) confirme a solução aplicada;",
          "transcriptEvidence": [
            "Operador: Resumindo, Carolina: a renovação do Cine Mais foi cancelada, a contestação das duas cobranças de R$ 14,90 está registrada e o seu protocolo é 2026 0928 4471."
          ],
          "knowledgeDetailQuote": null
        },
        {
          "status": "FOLLOWED",
          "guidance": {
            "text": "Antes de encerrar qualquer chamada: (2) informe o número do protocolo;",
            "source": "OFFICIAL_SERVICE_GUIDELINE"
          },
          "requirement": "informe o número do protocolo",
          "uncertainty": null,
          "evidenceType": "OBSERVED",
          "checkpointRef": "CP-8eaac52713",
          "knowledgeQuote": "(2) informe o número do protocolo;",
          "transcriptEvidence": [
            "Operador: Resumindo, Carolina: a renovação do Cine Mais foi cancelada, a contestação das duas cobranças de R$ 14,90 está registrada e o seu protocolo é 2026 0928 4471."
          ],
          "knowledgeDetailQuote": null
        },
        {
          "status": "NOT_FOLLOWED",
          "guidance": {
            "text": "Antes de encerrar qualquer chamada: (3) explique o próximo passo e o prazo;",
            "source": "OFFICIAL_SERVICE_GUIDELINE"
          },
          "requirement": "explique o próximo passo e o prazo",
          "uncertainty": null,
          "evidenceType": "OBSERVED",
          "checkpointRef": "CP-cab0fce54b",
          "knowledgeQuote": "(3) explique o próximo passo e o prazo;",
          "transcriptEvidence": [
            "Operador: Então, não consigo te passar um prazo certinho, depende da análise deles."
          ],
          "knowledgeDetailQuote": null
        },
        {
          "status": "FOLLOWED",
          "guidance": {
            "text": "Antes de encerrar qualquer chamada: (4) confirme se o cliente tem mais alguma dúvida.",
            "source": "OFFICIAL_SERVICE_GUIDELINE"
          },
          "requirement": "confirme se o cliente tem mais alguma dúvida",
          "uncertainty": null,
          "evidenceType": "OBSERVED",
          "checkpointRef": "CP-78c6c76d55",
          "knowledgeQuote": "(4) confirme se o cliente tem mais alguma dúvida.",
          "transcriptEvidence": [
            "Operador: Ficou alguma dúvida sobre o que a gente conversou?"
          ],
          "knowledgeDetailQuote": null
        }
      ],
      "documentTitle": "Checklist de Encerramento de Chamada"
    }
  ],
  "applicability": []
} as unknown as RawProcessAssessment
/** A resposta REAL do redator, por slot. */
export const V171O_WRITER_RAW = {
  "items": [
    {
      "slot": "ITEM_1",
      "observed": "Você informou ao cliente que não era possível fornecer um prazo específico para a análise, dependendo da avaliação da área.",
      "whatYouCanDo": "Na próxima oportunidade, verifique e informe ao cliente o prazo exato que aparece na ferramenta no momento do atendimento.",
      "whyItMatters": "O procedimento exige que o prazo seja informado ao cliente para que ele tenha visibilidade sobre o andamento do processo.",
      "suggestedResponse": "O prazo para essa análise é de 5 dias úteis. Você receberá o retorno sobre a contestação dentro desse período."
    },
    {
      "slot": "ITEM_2",
      "observed": "Você confirmou o cadastro do cliente e solicitou que ele especificasse qual cobrança não reconhecia.",
      "whatYouCanDo": "Continue realizando essa identificação logo no início do atendimento para direcionar o tratamento.",
      "whyItMatters": "Permitir que o cliente explique a solicitação ajuda a realizar uma análise correta.",
      "suggestedResponse": ""
    },
    {
      "slot": "ITEM_3",
      "observed": "Você perguntou ao cliente se ele havia realizado o pagamento de alguma das faturas mencionadas.",
      "whatYouCanDo": "Mantenha essa prática, pois a confirmação sobre o pagamento é um passo necessário para o fluxo de contestação.",
      "whyItMatters": "Esta verificação é fundamental para entender o status financeiro da contestação.",
      "suggestedResponse": ""
    },
    {
      "slot": "ITEM_4",
      "observed": "Você comunicou ao cliente que realizou o cancelamento da renovação do serviço citado.",
      "whatYouCanDo": "Continue informando claramente essa ação, para que o cliente saiba que a cobrança foi interrompida para faturas futuras.",
      "whyItMatters": "A interrupção da cobrança recorrente é um passo necessário quando o serviço não é reconhecido pelo cliente.",
      "suggestedResponse": ""
    },
    {
      "slot": "ITEM_5",
      "observed": "Você informou que realizou o registro da contestação das cobranças para que a área de faturamento possa avaliar.",
      "whatYouCanDo": "Mantenha o registro de todas as cobranças contestadas, informando claramente a finalidade dessa ação ao cliente.",
      "whyItMatters": "O registro formal da contestação inicia o processo de análise necessário para o caso.",
      "suggestedResponse": ""
    },
    {
      "slot": "ITEM_6",
      "observed": "Você questionou se o cliente tinha alguma dúvida sobre o que foi conversado durante o atendimento.",
      "whatYouCanDo": "Continue utilizando perguntas que verifiquem se o cliente compreendeu todas as orientações prestadas.",
      "whyItMatters": "A confirmação do entendimento contribui para que as informações fiquem claras para o cliente.",
      "suggestedResponse": ""
    },
    {
      "slot": "ITEM_7",
      "observed": "Você realizou um resumo detalhado dos pontos tratados, confirmando o cancelamento da renovação e o registro da contestação.",
      "whatYouCanDo": "Continue recapitulando as ações realizadas, pois isso reforça a solução acordada com o cliente.",
      "whyItMatters": "Confirmar a solução aplicada antes do encerramento ajuda a garantir que o cliente compreendeu as medidas tomadas.",
      "suggestedResponse": ""
    },
    {
      "slot": "ITEM_8",
      "observed": "Você finalizou o resumo informando ao cliente o número do protocolo do atendimento.",
      "whatYouCanDo": "Continue informando o protocolo sempre ao final, logo após a recapitulação da solução.",
      "whyItMatters": "A informação do número de protocolo é uma etapa obrigatória no encerramento de qualquer chamada.",
      "suggestedResponse": ""
    }
  ],
  "presentation": {
    "closing": "Você realizou um bom trabalho ao registrar as contestações e validar as informações com o cliente. Ajustando apenas a explicação sobre o prazo da análise e a recapitulando os pontos obrigatórios antes de finalizar, seus atendimentos seguirão ainda mais completos.",
    "introduction": "Analisei seu atendimento sobre a contestação de cobrança. Você conduziu com eficiência a identificação do problema, a verificação de pagamentos, os cancelamentos necessários, o registro das contestações e o encerramento com protocolo. Para os próximos contatos, precisamos ajustar a informação sobre o prazo de análise e a estrutura da recapitulação obrigatória."
  }
}
/** Requisito de cada ponto → slot em que o redator real respondeu (ordem daquela execução). */
export const V171O_WRITER_SLOTS: Record<string, string> = {
  "Explicar prazo": "ITEM_1",
  "Qual cobrança não reconhece": "ITEM_2",
  "Se a conta já foi paga": "ITEM_3",
  "Cancelar a recorrência, quando permitido": "ITEM_4",
  "Registrar contestação": "ITEM_5",
  "Confirmação de entendimento": "ITEM_6",
  "confirme a solução aplicada": "ITEM_7",
  "informe o número do protocolo": "ITEM_8"
}
