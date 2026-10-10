/**
 * V1.7.1g — o smoke REAL da V1.7.1f reproduzido offline (SMOKE-V171F-CONTESTACAO-001, matrícula 7b4f271f, artefato a69cec50):
 * a transcrição enviada pela Central de Dados, a avaliação de processo devolvida pelo Especialista de Faturamento
 * (gemini-3.8-flash, 1 chamada, sem edição), os trechos que entraram no prompt dele (rastro da recuperação), a versão PUBLICADA
 * do procedimento usada na verificação e a resposta REAL do redator (gemini-3.1-flash-lite). Sem modelo.
 *
 * Nomes de colegas: subconjunto da equipe da colaboradora na massa demo (fictícia), com os DOIS homônimos do cliente ("Roberto")
 * que esconderam a recapitulação no smoke.
 */
import type { PresentedKnowledgeExcerpt, PublishedKnowledgeDocument } from "../domain/process-assessment.js"

export const V171F_DOC_ID = "c8f2c818-72db-48dc-8d7d-d8a9fe861c65"
export const V171F_DOC_TITLE = "Procedimento Operacional — Contestação de Contas Móvel"
export const V171F_SUBJECT = "Contestação de cobrança"
export const V171F_COLLABORATOR_NAME = "Larissa Monteiro"
export const V171F_OTHER_OPERATOR_NAMES: string[] = [
  "Roberto Queiroz",
  "Roberto Serra",
  "Adriana Figueiredo Monteiro",
  "Adriana Jesus",
  "Adriano Viana",
  "Alexandre Carvalho Valente",
  "Aline Barros",
  "Aline Melo"
]
export const V171F_TRANSCRIPT = "Operador: Conecta, boa tarde, Larissa falando. Em que posso ajudar?\nCliente: Oi, boa tarde. Meu nome é Roberto, sou o titular. Tô olhando minha conta aqui e apareceu uma cobrança de um tal de Proteção Digital que eu não faço ideia do que é.\nOperador: Tudo bem, Roberto, vou verificar com você. Pra eu acessar a conta, me confirma os três últimos dígitos do CPF?\nCliente: 846.\nOperador: E a data de nascimento do titular?\nCliente: 14 de novembro de 1975.\nOperador: Obrigada, tá confirmado. Qual conta você está olhando, de qual mês?\nCliente: A de setembro, que vence semana que vem.\nOperador: Certo, abri aqui. Tem sim um serviço chamado Proteção Digital, de R$ 12,90 por mês. E ele aparece na conta de agosto também.\nCliente: Em agosto também? Nem tinha reparado. Eu nunca pedi isso.\nOperador: Aqui mostra que foi ativado no dia 2 de julho, pelo aplicativo. Você lembra de ter aceitado alguma oferta por lá?\nCliente: Não, de jeito nenhum.\nOperador: Tá bom. E a de agosto, você chegou a pagar?\nCliente: Paguei, tá no débito automático.\nOperador: Entendi. Então vou registrar a contestação das duas cobranças, agosto e setembro, pra equipe de faturamento analisar.\nCliente: E isso não vai vir de novo em outubro, né?\nOperador: Posso já tirar esse serviço da sua linha pra parar de cobrar. Quer que eu faça isso?\nCliente: Quero, por favor.\nOperador: Feito, desativei o Proteção Digital agora.\nCliente: E o que eu já paguei em agosto, volta?\nOperador: Se a análise confirmar que foi indevido, o valor volta pra você. Mas quem define isso é o faturamento.\nCliente: E vai demorar muito pra eu saber?\nOperador: Não sei te dizer certinho, agora fica com o pessoal da análise, aí é aguardar que eles resolvem.\nCliente: Hum, tá.\nOperador: Então, recapitulando, Roberto: abri a contestação das cobranças do Proteção Digital de agosto e setembro e já desativei o serviço. O número do protocolo é 2026 0925 9930.\nCliente: Deixa eu anotar... anotei.\nOperador: Ficou alguma dúvida?\nCliente: Não, tá tranquilo.\nOperador: Obrigada pelo contato, Roberto. Tenha uma boa tarde!"
export const V171F_PRESENTED: PresentedKnowledgeExcerpt[] = [
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
    "heading": "48. Encerramento",
    "excerpt": "**Quando houver ajuste imediato:**\n\n“O valor foi corrigido e a conta ajustada ficará disponível no canal informado. Seu protocolo é 202609130184. Ficou alguma dúvida?”\n\n**Quando houver análise:**\n\n“A contestação foi registrada e será analisada no prazo informado. O retorno será enviado por SMS. Seu protocolo é 202609130184.”\n\n**Quando a cobrança for esclarecida:**\n\n“Confirmamos que o valor corresponde ao período e ao serviço detalhados. O protocolo deste atendimento é 202609130184. Posso ajudar em mais alguma questão?”",
    "chunkIndex": 64
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
    "heading": "Modelo recomendado",
    "excerpt": "“Olá, bom dia! Você está falando com a Vivo. Meu nome é [nome do operador]. Com quem eu falo?”\n\nApós o cliente se identificar:\n\n“Olá, [nome do cliente]. Como posso ajudar você hoje?”",
    "chunkIndex": 9
  },
  {
    "documentId": "c8f2c818-72db-48dc-8d7d-d8a9fe861c65",
    "documentTitle": "Procedimento Operacional — Contestação de Contas Móvel",
    "heading": "55. Checklist do operador",
    "excerpt": "Antes de finalizar:\n\n- [ ] Ouvi a contestação completa?\n- [ ] Validei o titular?\n- [ ] Confirmei a conta questionada?\n- [ ] Identifiquei lançamento, valor e período?\n- [ ] Verifiquei se a conta foi paga?\n- [ ] Comparei contas anteriores?\n- [ ] Consultei alterações e contratações?\n- [ ] Expliquei a composição?\n- [ ] Identifiquei possível fraude?\n- [ ] Cancelei eventual recorrência indevida?\n- [ ] Solicitei autorização para bloqueios?\n- [ ] Apliquei ajuste dentro da alçada?\n- [ ] Abri análise quando necessário?\n- [ ] Informei o valor não contestado?\n- [ ] Emissão de conta ajustada foi avaliada?\n- [ ] Informei prazo e canal de retorno?\n- [ ] Registrei todos os fatos?\n- [ ] Forneci protocolo?\n- [ ] Recapitulei as ações?\n- [ ] Confirmei se restaram dúvidas?",
    "chunkIndex": 71
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
    "heading": "57. Resultado esperado",
    "excerpt": "Ao final, o cliente deverá saber:\n\n- Qual cobrança foi analisada;\n- Qual é a origem do valor;\n- Se a cobrança foi corrigida ou contestada;\n- Se o serviço foi cancelado;\n- Qual valor deverá pagar;\n- Onde obter a conta ajustada;\n- Qual é o prazo da análise;\n- Como receberá o retorno;\n- Qual é o protocolo;\n- O que deverá fazer se a cobrança reaparecer.\n\nO cliente não deverá encerrar o contato apenas com a orientação de aguardar, pagar integralmente ou ligar novamente.",
    "chunkIndex": 73
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
export const V171F_CONTENT = "# Procedimento Operacional — Contestação de Contas Móvel\r\n\r\n**Área responsável:** Atendimento ao Cliente e Faturamento  \r\n**Aplicação:** Atendimento por voz, chat e canais digitais assistidos  \r\n**Público:** Operadores, supervisores, backoffice, prevenção a fraudes, treinamento e qualidade  \r\n**Versão:** 1.0  \r\n**Classificação:** Uso interno\r\n\r\n## 1. Objetivo\r\n\r\nDefinir o processo para análise, registro e acompanhamento de contestações relacionadas a contas de telefonia móvel, garantindo:\r\n\r\n- Identificação correta da cobrança questionada;\r\n- Validação segura do titular;\r\n- Explicação clara da composição da conta;\r\n- Correção imediata quando houver evidência e alçada;\r\n- Abertura de análise quando a cobrança depender de investigação;\r\n- Prevenção de novas cobranças indevidas;\r\n- Informação sobre valores, prazos e canais de acompanhamento;\r\n- Emissão de conta ajustada quando aplicável;\r\n- Registro completo da manifestação;\r\n- Tratamento respeitoso, imparcial e resolutivo.\r\n\r\nO operador não deverá presumir que a cobrança é correta nem confirmar erro antes de consultar as informações disponíveis.\r\n\r\n## 2. Abrangência\r\n\r\nEste procedimento se aplica a contestações envolvendo:\r\n\r\n- Valor total da conta;\r\n- Mensalidade do plano;\r\n- Alteração de preço;\r\n- Perda de desconto;\r\n- Cobrança proporcional;\r\n- Serviços digitais;\r\n- Pacotes adicionais;\r\n- Internet adicional;\r\n- Ligações;\r\n- SMS;\r\n- Roaming nacional ou internacional;\r\n- Uso no exterior;\r\n- Compra ou assinatura pelo celular;\r\n- Parcelas de aparelho;\r\n- Multa de fidelização;\r\n- Taxa de ativação;\r\n- Taxa de troca de plano;\r\n- Serviços cancelados;\r\n- Cobrança após cancelamento;\r\n- Duplicidade;\r\n- Pagamento não reconhecido;\r\n- Conta de linha desconhecida;\r\n- Consumo não reconhecido;\r\n- Fraude ou contratação não reconhecida;\r\n- Cobrança de linhas dependentes;\r\n- Ajustes e créditos não aplicados;\r\n- Parcelamento ou acordo de débito;\r\n- Juros, multa e encargos;\r\n- Conta com vencimento ou ciclo incorreto.\r\n\r\n## 3. Conceitos\r\n\r\n### 3.1 Contestação\r\n\r\nManifestação em que o cliente declara não reconhecer, não concordar ou considerar incorreto determinado valor da conta.\r\n\r\n### 3.2 Esclarecimento de cobrança\r\n\r\nAtendimento em que a origem e o cálculo são explicados e o cliente reconhece a cobrança, sem necessidade de análise.\r\n\r\n### 3.3 Ajuste imediato\r\n\r\nCorreção realizada durante o atendimento, dentro da alçada do operador e com evidência suficiente.\r\n\r\n### 3.4 Análise de faturamento\r\n\r\nSolicitação encaminhada para investigação quando o operador não possui informação ou autonomia para concluir.\r\n\r\n### 3.5 Conta ajustada\r\n\r\nDocumento emitido com retirada temporária ou definitiva do valor contestado, conforme regra aplicável.\r\n\r\n### 3.6 Crédito\r\n\r\nValor reconhecido em favor do cliente, aplicado na conta atual ou em conta futura.\r\n\r\n### 3.7 Estorno\r\n\r\nDevolução de valor pago, realizada no meio e no prazo previstos para o caso.\r\n\r\n## 4. Princípios do atendimento\r\n\r\n### 4.1 Imparcialidade\r\n\r\nO operador deverá analisar fatos e registros sem culpar o cliente ou presumir erro da empresa.\r\n\r\n### 4.2 Transparência\r\n\r\nA composição da cobrança, o resultado da análise e os próximos passos deverão ser explicados de maneira compreensível.\r\n\r\n### 4.3 Segurança\r\n\r\nInformações da conta somente poderão ser acessadas após a validação prevista.\r\n\r\n### 4.4 Continuidade\r\n\r\nO cliente não deverá repetir toda a contestação em transferências ou contatos posteriores quando houver registro anterior.\r\n\r\n### 4.5 Prevenção\r\n\r\nQuando a origem for uma assinatura, fraude ou serviço adicional, o operador deverá verificar medidas para impedir novas cobranças.\r\n\r\n### 4.6 Tratamento do valor não contestado\r\n\r\nQuando permitido pelo processo, o cliente deverá ser orientado sobre o pagamento da parte da conta que não está sendo questionada.\r\n\r\n## 5. Apresentação do operador\r\n\r\n**Exemplo recomendado:**\r\n\r\n“Olá, boa tarde! Meu nome é Juliana Prado, sou do atendimento Vivo. Com quem eu tenho o prazer de falar?”\r\n\r\nApós identificar o cliente:\r\n\r\n“Obrigada, Ricardo. Entendi que você não reconhece um valor da sua conta. Vou consultar o detalhamento e explicar o que encontrei.”\r\n\r\nEvitar:\r\n\r\n- “A conta está certa.”\r\n- “Se está na fatura, você contratou.”\r\n- “Você deve ter clicado em alguma coisa.”\r\n- “Primeiro precisa pagar.”\r\n- “Isso não pode ser contestado.”\r\n\r\n## 6. Escuta e identificação da solicitação\r\n\r\nO operador deverá permitir que o cliente explique:\r\n\r\n- Qual conta está questionando;\r\n- Qual cobrança não reconhece;\r\n- Qual valor esperava;\r\n- Qual valor foi faturado;\r\n- Quando percebeu a diferença;\r\n- Se a conta já foi paga;\r\n- Se já houve contato anterior;\r\n- Se a cobrança continua ocorrendo;\r\n- Se existe ameaça de bloqueio ou negativação;\r\n- Se há suspeita de fraude.\r\n\r\n**Exemplo:**\r\n\r\n“Para eu analisar corretamente, poderia me informar qual cobrança você não reconhece e em qual conta ela aparece?”\r\n\r\nDepois, confirmar o entendimento:\r\n\r\n“Entendi. Sua mensalidade habitual era de R$ 89,99, mas a conta atual veio em R$ 149,89 por causa de um serviço digital de R$ 59,90 que você não reconhece. Está correto?”\r\n\r\n## 7. Validação de segurança\r\n\r\nAntes de consultar o detalhamento, o operador deverá validar o titular.\r\n\r\nA validação poderá incluir:\r\n\r\n- Nome completo;\r\n- CPF ou CNPJ;\r\n- Data de nascimento;\r\n- Número da linha;\r\n- Código enviado ao canal seguro;\r\n- Informações adicionais previstas no sistema.\r\n\r\nO operador não deverá:\r\n\r\n- Falar o CPF completo para simples confirmação;\r\n- Informar endereço completo antes da validação;\r\n- Revelar outras linhas do cadastro;\r\n- Compartilhar detalhes da conta com terceiro não autorizado;\r\n- Solicitar senha pessoal;\r\n- Pedir código de acesso sem explicar sua finalidade.\r\n\r\nSe a validação falhar:\r\n\r\n1. Não revelar informações protegidas;\r\n2. Explicar a necessidade de segurança;\r\n3. Orientar canal alternativo;\r\n4. Registrar a tentativa;\r\n5. Não concluir ajuste ou contestação.\r\n\r\n## 8. Atendimento realizado por terceiro\r\n\r\nSe o solicitante não for o titular, verificar:\r\n\r\n- Autorização formal;\r\n- Procuração;\r\n- Representação legal;\r\n- Perfil de gestor de conta empresarial;\r\n- Regra para titular falecido;\r\n- Cadastro de responsável autorizado.\r\n\r\nNa ausência de autorização válida, o operador deverá fornecer apenas orientações gerais.\r\n\r\n**Exemplo:**\r\n\r\n“Para proteger os dados da conta, não consigo consultar os lançamentos sem validar o titular ou representante autorizado. Vou explicar como regularizar a autorização.”\r\n\r\n## 9. Consulta inicial obrigatória\r\n\r\nApós a validação, consultar:\r\n\r\n- Conta questionada;\r\n- Contas anteriores;\r\n- Histórico de valores;\r\n- Plano contratado;\r\n- Data de renovação do ciclo;\r\n- Descontos;\r\n- Promoções;\r\n- Serviços adicionais;\r\n- Alterações recentes;\r\n- Consumo;\r\n- Compras;\r\n- Parcelas de aparelho;\r\n- Roaming;\r\n- Negociações;\r\n- Pagamentos;\r\n- Créditos;\r\n- Contestação anterior;\r\n- Cancelamentos;\r\n- Protocolos relacionados;\r\n- Situação da linha;\r\n- Risco de bloqueio ou cobrança.\r\n\r\nO operador deverá comparar a conta questionada com, preferencialmente, as últimas três contas.\r\n\r\n## 10. Classificação da cobrança\r\n\r\nA contestação deverá ser classificada de acordo com a origem principal:\r\n\r\n1. Mensalidade ou plano;\r\n2. Desconto não aplicado;\r\n3. Serviço digital;\r\n4. Pacote adicional;\r\n5. Consumo de voz, dados ou SMS;\r\n6. Roaming;\r\n7. Parcela de aparelho;\r\n8. Multa de fidelização;\r\n9. Cobrança após cancelamento;\r\n10. Duplicidade;\r\n11. Pagamento não reconhecido;\r\n12. Linha ou contrato desconhecido;\r\n13. Fraude;\r\n14. Parcelamento ou negociação;\r\n15. Juros e encargos;\r\n16. Outros lançamentos.\r\n\r\nSe existirem cobranças diferentes, cada item deverá ser analisado e registrado separadamente.\r\n\r\n## 11. Leitura da conta\r\n\r\nO operador deverá explicar:\r\n\r\n- Nome do lançamento;\r\n- Período de referência;\r\n- Data do evento;\r\n- Valor;\r\n- Forma de contratação ou origem;\r\n- Recorrência;\r\n- Impostos, quando aplicáveis;\r\n- Descontos;\r\n- Créditos;\r\n- Valores proporcionais;\r\n- Parcelamentos.\r\n\r\nA explicação deverá ser feita em linguagem simples.\r\n\r\n**Exemplo:**\r\n\r\n“A diferença de R$ 34,20 é composta por R$ 19,90 de um pacote adicional e R$ 14,30 de cobrança proporcional após a mudança de plano.”\r\n\r\nNão apenas ler a descrição da tela sem explicar o significado.\r\n\r\n## 12. Mensalidade maior que o esperado\r\n\r\nVerificar:\r\n\r\n- Reajuste;\r\n- Fim de promoção;\r\n- Perda de desconto;\r\n- Mudança de plano;\r\n- Inclusão de dependente;\r\n- Alteração de combo;\r\n- Cobrança proporcional;\r\n- Serviço adicional;\r\n- Erro de faturamento.\r\n\r\nSe o aumento estiver previsto:\r\n\r\n- Informar a origem;\r\n- Informar quando passou a valer;\r\n- Verificar a comunicação registrada;\r\n- Explicar o novo valor;\r\n- Apresentar alternativas somente se houver interesse.\r\n\r\nSe não houver registro suficiente, abrir análise.\r\n\r\n## 13. Desconto não aplicado\r\n\r\nVerificar:\r\n\r\n- Período de vigência;\r\n- Condições do desconto;\r\n- Forma de pagamento exigida;\r\n- Vínculo com combo;\r\n- Pontualidade;\r\n- Alteração de plano;\r\n- Cancelamento de outro produto;\r\n- Erro sistêmico;\r\n- Data de concessão.\r\n\r\nSe a condição foi cumprida e o desconto não foi aplicado:\r\n\r\n- Corrigir dentro da alçada;\r\n- Solicitar crédito;\r\n- Gerar conta ajustada, quando possível;\r\n- Prevenir recorrência;\r\n- Informar protocolo e prazo.\r\n\r\n## 14. Cobrança proporcional\r\n\r\nA cobrança proporcional pode ocorrer em situações como:\r\n\r\n- Ativação;\r\n- Mudança de plano;\r\n- Cancelamento;\r\n- Inclusão ou retirada de serviço;\r\n- Mudança de ciclo;\r\n- Suspensão e reativação.\r\n\r\nO operador deverá explicar:\r\n\r\n- Período cobrado;\r\n- Plano anterior;\r\n- Plano novo;\r\n- Valor de cada período;\r\n- Data da alteração;\r\n- Total resultante.\r\n\r\nNão utilizar apenas a frase “é proporcional” sem demonstrar a composição.\r\n\r\n## 15. Serviços digitais não reconhecidos\r\n\r\nVerificar:\r\n\r\n- Nome do serviço;\r\n- Valor;\r\n- Data de ativação;\r\n- Canal de contratação;\r\n- Recorrência;\r\n- Histórico de confirmação;\r\n- Linha em que foi ativado;\r\n- Cobranças anteriores.\r\n\r\nSe o cliente não reconhecer:\r\n\r\n1. Cancelar a recorrência, quando permitido;\r\n2. Registrar contestação;\r\n3. Analisar valores atuais e anteriores elegíveis;\r\n4. Ativar bloqueio preventivo, se disponível e autorizado;\r\n5. Explicar prazo;\r\n6. Orientar sobre conta ajustada;\r\n7. Registrar protocolo.\r\n\r\n**Exemplo:**\r\n\r\n“Como você não reconhece a assinatura, vou cancelar a renovação, registrar a contestação do valor e consultar a possibilidade de bloquear novas assinaturas desse tipo.”\r\n\r\nO bloqueio preventivo deverá ser autorizado pelo cliente.\r\n\r\n## 16. Pacote adicional\r\n\r\nConfirmar:\r\n\r\n- Data da contratação;\r\n- Franquia adquirida;\r\n- Utilização;\r\n- Valor;\r\n- Canal de contratação;\r\n- Se era compra única ou recorrente;\r\n- Confirmação enviada;\r\n- Linha beneficiada.\r\n\r\nO consumo do pacote não elimina automaticamente o direito de contestar sua contratação.\r\n\r\n## 17. Consumo de internet, ligações ou SMS\r\n\r\nVerificar:\r\n\r\n- Data e horário;\r\n- Tipo de evento;\r\n- Número ou destino, dentro das regras de privacidade;\r\n- Duração;\r\n- Volume de dados;\r\n- Cobertura do plano;\r\n- Excedente;\r\n- Histórico de uso;\r\n- Compatibilidade com o ciclo.\r\n\r\nNão informar conteúdo de mensagens, conversas, sites ou aplicativos acessados.\r\n\r\nSe houver suspeita de uso por terceiro:\r\n\r\n- Avaliar segurança da linha;\r\n- Orientar troca de senha;\r\n- Verificar chip ou aparelho perdido;\r\n- Aplicar bloqueios disponíveis;\r\n- Registrar possível fraude.\r\n\r\n## 18. Roaming internacional\r\n\r\nVerificar:\r\n\r\n- País;\r\n- Data e horário;\r\n- Rede utilizada;\r\n- Ligações originadas ou recebidas;\r\n- Dados móveis;\r\n- SMS;\r\n- Pacote internacional;\r\n- Franquia;\r\n- Tarifação;\r\n- Comunicação enviada.\r\n\r\nExplicar que aparelhos podem utilizar dados em segundo plano quando o roaming está habilitado, mas não presumir que isso encerra a contestação.\r\n\r\nSe o cliente não esteve no país indicado ou não reconhece o evento, tratar como possível fraude.\r\n\r\n## 19. Parcelas de aparelho\r\n\r\nVerificar:\r\n\r\n- Aparelho;\r\n- Data da compra;\r\n- Quantidade de parcelas;\r\n- Parcela atual;\r\n- Parcelas restantes;\r\n- Cancelamento da linha;\r\n- Antecipação;\r\n- Devolução ou troca;\r\n- Garantia.\r\n\r\nO cancelamento da linha não cancela automaticamente parcelas do aparelho.\r\n\r\nSe o cliente não reconhecer a compra:\r\n\r\n- Não tratar apenas como dúvida de faturamento;\r\n- Abrir contestação de contratação;\r\n- Acionar prevenção a fraudes;\r\n- Orientar medidas de segurança;\r\n- Informar prazo.\r\n\r\n## 20. Multa de fidelização\r\n\r\nConsultar:\r\n\r\n- Benefício concedido;\r\n- Data de início;\r\n- Data de término;\r\n- Motivo da fidelização;\r\n- Data do cancelamento;\r\n- Valor original;\r\n- Cálculo proporcional;\r\n- Reparos ou falhas relacionadas;\r\n- Pedido de isenção anterior.\r\n\r\nO operador deverá explicar o cálculo sem utilizar a multa como ameaça.\r\n\r\nSe o cliente alegar falha recorrente, mudança para área sem cobertura ou outra condição elegível, abrir análise de isenção conforme o fluxo.\r\n\r\n## 21. Cobrança após cancelamento\r\n\r\nVerificar:\r\n\r\n- Data da solicitação;\r\n- Data efetiva;\r\n- Produto cancelado;\r\n- Protocolos;\r\n- Valores proporcionais;\r\n- Serviços adicionais;\r\n- Parcelas de aparelho;\r\n- Equipamentos não devolvidos;\r\n- Falha na conclusão;\r\n- Cobranças posteriores.\r\n\r\nSe o cancelamento não tiver sido concluído por falha interna:\r\n\r\n- Corrigir o status;\r\n- Preservar a data da manifestação, conforme alçada;\r\n- Contestar cobranças posteriores;\r\n- Registrar a falha;\r\n- Informar prazo.\r\n\r\nNão responsabilizar o cliente por erro de registro interno.\r\n\r\n## 22. Duplicidade de cobrança\r\n\r\nConfirmar:\r\n\r\n- Se existem duas contas iguais;\r\n- Se houve dois pagamentos;\r\n- Se são períodos diferentes;\r\n- Se há duas linhas;\r\n- Se existe parcelamento;\r\n- Se o mesmo lançamento aparece repetido;\r\n- Se houve débito automático e pagamento manual.\r\n\r\nQuando houver pagamento duplicado:\r\n\r\n- Identificar os dois pagamentos;\r\n- Informar se haverá crédito automático;\r\n- Consultar opção de devolução;\r\n- Registrar conta bancária somente pelo processo seguro;\r\n- Informar prazo.\r\n\r\n## 23. Pagamento não reconhecido\r\n\r\nQuando o cliente afirmar que pagou e o sistema não reconheceu:\r\n\r\n1. Confirmar valor;\r\n2. Confirmar data;\r\n3. Confirmar canal de pagamento;\r\n4. Verificar código ou conta utilizada;\r\n5. Solicitar comprovante pelo canal seguro;\r\n6. Abrir análise;\r\n7. Avaliar bloqueio da linha;\r\n8. Informar prazo.\r\n\r\nNão solicitar envio de comprovante para e-mail pessoal ou canal não autorizado.\r\n\r\n## 24. Linha ou contrato desconhecido\r\n\r\nSe o cliente identificar uma linha que não reconhece em seu CPF:\r\n\r\n- Tratar como suspeita de fraude;\r\n- Não revelar detalhes desnecessários;\r\n- Verificar produtos vinculados;\r\n- Bloquear ou cancelar conforme alçada;\r\n- Abrir investigação;\r\n- Contestar cobranças;\r\n- Orientar proteção cadastral;\r\n- Fornecer protocolo;\r\n- Avaliar impacto em órgãos de proteção ao crédito.\r\n\r\n## 25. Suspeita de fraude\r\n\r\nSão indícios:\r\n\r\n- Linha desconhecida;\r\n- Compra de aparelho não reconhecida;\r\n- Troca de chip não solicitada;\r\n- Consumo incompatível;\r\n- Roaming em país não visitado;\r\n- Alteração cadastral desconhecida;\r\n- Várias contratações em curto período;\r\n- Perda ou roubo do aparelho;\r\n- Acesso indevido à conta.\r\n\r\nO operador deverá:\r\n\r\n1. Priorizar a segurança;\r\n2. Validar o cliente;\r\n3. Bloquear riscos ativos;\r\n4. Orientar atualização de senhas;\r\n5. Registrar a fraude;\r\n6. Contestar os valores;\r\n7. Acionar a área especializada;\r\n8. Informar prazo;\r\n9. Orientar acompanhamento;\r\n10. Não acusar o cliente ou terceiros.\r\n\r\n## 26. Contas vencidas e encargos\r\n\r\nSe a cobrança questionada estiver vencida, analisar:\r\n\r\n- Data de vencimento;\r\n- Data de pagamento;\r\n- Juros;\r\n- Multa;\r\n- Encargos;\r\n- Atraso causado por falha na emissão;\r\n- Contestação anterior;\r\n- Conta ajustada não disponibilizada.\r\n\r\nSe o atraso ocorreu por falha comprovada da empresa, avaliar retirada dos encargos.\r\n\r\n## 27. Negociação ou parcelamento\r\n\r\nQuando a contestação envolver acordo:\r\n\r\n- Confirmar condições aceitas;\r\n- Entrada;\r\n- Parcelas;\r\n- Encargos;\r\n- Data de vencimento;\r\n- Pagamentos;\r\n- Rompimento;\r\n- Conta em que as parcelas foram incluídas;\r\n- Gravação ou confirmação do aceite.\r\n\r\nNão alterar uma negociação sem consentimento.\r\n\r\nSe o cliente não reconhecer o acordo, abrir análise da contratação.\r\n\r\n## 28. Determinação do resultado\r\n\r\nApós a análise inicial, classificar como:\r\n\r\n### 28.1 Cobrança esclarecida\r\n\r\nA origem foi demonstrada e o cliente compreendeu.\r\n\r\n### 28.2 Contestação procedente\r\n\r\nFoi identificado erro ou cobrança não reconhecida com evidência suficiente.\r\n\r\n### 28.3 Contestação parcialmente procedente\r\n\r\nApenas parte do valor deverá ser corrigida.\r\n\r\n### 28.4 Contestação pendente de análise\r\n\r\nSão necessários documentos, gravações, registros ou validação especializada.\r\n\r\n### 28.5 Contestação improcedente após análise\r\n\r\nA cobrança foi considerada devida, com justificativa documentada.\r\n\r\nO operador não deverá informar que a contestação é improcedente apenas porque o lançamento aparece no sistema.\r\n\r\n## 29. Ajuste dentro da alçada\r\n\r\nSe houver evidência e autonomia, o operador deverá:\r\n\r\n1. Informar o erro identificado;\r\n2. Corrigir a cobrança;\r\n3. Cancelar recorrências indevidas;\r\n4. Aplicar bloqueio preventivo, se autorizado;\r\n5. Emitir conta ajustada;\r\n6. Informar onde será disponibilizada;\r\n7. Confirmar valor corrigido;\r\n8. Registrar a justificativa;\r\n9. Informar protocolo.\r\n\r\n**Exemplo:**\r\n\r\n“Identifiquei que o desconto de R$ 20,00 não foi aplicado. Vou corrigir a conta e ajustar o cadastro para evitar nova ocorrência.”\r\n\r\n## 30. Abertura de análise\r\n\r\nAbrir análise quando:\r\n\r\n- Não houver evidência suficiente;\r\n- For necessária gravação;\r\n- A contratação estiver em outro canal;\r\n- Houver suspeita de fraude;\r\n- A cobrança ultrapassar a alçada;\r\n- Existirem eventos de roaming;\r\n- For necessária validação de pagamento;\r\n- Houver multa contestada;\r\n- O cliente contestar compra de aparelho;\r\n- Existir cobrança após cancelamento não concluído;\r\n- A ferramenta recomendar investigação.\r\n\r\n## 31. Informações obrigatórias na contestação\r\n\r\nRegistrar:\r\n\r\n- Conta questionada;\r\n- Número da linha;\r\n- Lançamento;\r\n- Valor;\r\n- Data;\r\n- Motivo da contestação;\r\n- Declaração do cliente;\r\n- Se a conta foi paga;\r\n- Histórico consultado;\r\n- Evidências encontradas;\r\n- Protocolos anteriores;\r\n- Ajustes realizados;\r\n- Serviço cancelado;\r\n- Bloqueio preventivo;\r\n- Valor não contestado;\r\n- Risco de bloqueio;\r\n- Prazo;\r\n- Canal de retorno;\r\n- Documentos solicitados;\r\n- Número da solicitação.\r\n\r\nEvitar registros vagos como “cliente não concorda com a conta”.\r\n\r\n## 32. Conta ajustada\r\n\r\nQuando o processo permitir, a conta ajustada deverá retirar o valor contestado e manter os valores reconhecidos.\r\n\r\nO operador deverá informar:\r\n\r\n- Valor original;\r\n- Valor contestado;\r\n- Valor ajustado;\r\n- Novo vencimento, quando houver;\r\n- Canal de disponibilização;\r\n- Prazo de emissão;\r\n- Consequência do não pagamento da parte reconhecida.\r\n\r\n**Exemplo:**\r\n\r\n“A conta original é de R$ 149,90. O valor contestado é de R$ 39,90. Será emitida uma conta ajustada de R$ 110,00, disponível no App Vivo após o processamento.”\r\n\r\n## 33. Direcionamento aos canais digitais\r\n\r\nA segunda via ou conta ajustada deverá ser consultada prioritariamente pelos canais digitais disponíveis, como aplicativo ou portal oficial.\r\n\r\nO operador deverá:\r\n\r\n- Orientar o passo a passo;\r\n- Verificar se o cliente possui acesso;\r\n- Informar o prazo de disponibilização;\r\n- Explicar como identificar a conta correta.\r\n\r\nPoderá ser utilizado canal assistido quando houver:\r\n\r\n- Falha comprovada na ferramenta digital;\r\n- Indisponibilidade do aplicativo ou portal;\r\n- Erro de autenticação não resolvido;\r\n- Ausência da conta após o prazo;\r\n- Menção à Anatel;\r\n- Menção a órgão de proteção ao consumidor;\r\n- Menção a órgão de proteção ao crédito;\r\n- Ameaça de escalonamento para executivos da Vivo.\r\n\r\nA exceção deverá ser registrada.\r\n\r\n## 34. Conta já paga\r\n\r\nQuando o cliente já tiver pago a cobrança contestada, avaliar:\r\n\r\n- Crédito em conta futura;\r\n- Estorno;\r\n- Compensação;\r\n- Transferência bancária, quando prevista;\r\n- Prazo;\r\n- Dados necessários;\r\n- Titularidade da conta de destino.\r\n\r\nNão prometer devolução imediata sem confirmação.\r\n\r\n## 35. Prazo da análise\r\n\r\nO operador deverá informar o prazo exibido na ferramenta.\r\n\r\nComo referência operacional:\r\n\r\n- Ajuste dentro da alçada: durante o atendimento;\r\n- Emissão de conta ajustada: conforme processamento informado;\r\n- Análise de faturamento: preferencialmente em até cinco dias úteis;\r\n- Suspeita de fraude: conforme prazo da área especializada;\r\n- Pagamento não reconhecido: conforme prazo de conciliação;\r\n- Estorno: conforme forma de pagamento e processamento financeiro.\r\n\r\nSempre informar prazo de forma objetiva:\r\n\r\n“A contestação foi registrada hoje e será analisada em até cinco dias úteis. O retorno será enviado por SMS.”\r\n\r\nEvitar:\r\n\r\n- “É só aguardar.”\r\n- “Logo será resolvido.”\r\n- “O setor vai verificar.”\r\n- “Não sei o prazo.”\r\n\r\n## 36. Situação da linha durante a análise\r\n\r\nO operador deverá verificar:\r\n\r\n- Se existe bloqueio programado;\r\n- Se a linha já está suspensa;\r\n- Se o valor não contestado foi pago;\r\n- Se o processo suspende ações de cobrança;\r\n- Se é necessária conta ajustada;\r\n- Se existe risco de negativação.\r\n\r\nNão garantir ausência de bloqueio ou negativação sem confirmação do sistema.\r\n\r\n## 37. Contestação repetida\r\n\r\nQuando houver análise anterior:\r\n\r\n1. Consultar o protocolo;\r\n2. Verificar resultado;\r\n3. Ler a justificativa;\r\n4. Confirmar se existem fatos novos;\r\n5. Evitar abrir solicitações duplicadas;\r\n6. Reabrir ou escalar quando houver erro;\r\n7. Informar o status e prazo restante.\r\n\r\nO cliente não deverá repetir toda a situação se o histórico estiver completo.\r\n\r\n## 38. Cliente que não concorda com o resultado\r\n\r\nSe o cliente discordar:\r\n\r\n- Explicar a justificativa;\r\n- Informar evidências disponíveis;\r\n- Verificar possibilidade de reanálise;\r\n- Registrar novos documentos ou fatos;\r\n- Escalar conforme alçada;\r\n- Fornecer protocolo;\r\n- Não confrontar.\r\n\r\n**Exemplo:**\r\n\r\n“Entendo que você não concorda com o resultado. Vou verificar se existe possibilidade de reanálise e registrar os novos pontos apresentados.”\r\n\r\n## 39. Menção à Anatel, Procon ou órgãos de defesa do consumidor\r\n\r\nQuando o cliente mencionar Anatel, Procon, Consumidor.gov.br ou outro órgão:\r\n\r\n- Manter postura cordial;\r\n- Não questionar o direito de reclamar;\r\n- Não alterar informações;\r\n- Consultar protocolos anteriores;\r\n- Verificar falhas no tratamento;\r\n- Resolver dentro da alçada;\r\n- Acionar supervisão quando necessário;\r\n- Fornecer os protocolos;\r\n- Registrar a manifestação.\r\n\r\nNão utilizar:\r\n\r\n- “Pode reclamar.”\r\n- “A Anatel não vai resolver.”\r\n- “Isso não muda nada.”\r\n- “Não precisa ameaçar.”\r\n\r\nUtilizar:\r\n\r\n“Compreendo sua insatisfação e respeito sua decisão. Vou verificar o histórico e buscar a solução disponível neste atendimento.”\r\n\r\n## 40. Órgãos de proteção ao crédito\r\n\r\nSe o cliente mencionar negativação, Serasa, SPC ou outro órgão de proteção ao crédito:\r\n\r\n- Verificar se existe restrição;\r\n- Consultar qual contrato originou a cobrança;\r\n- Confirmar se o débito está em contestação;\r\n- Registrar urgência;\r\n- Acionar o fluxo específico;\r\n- Informar prazo;\r\n- Não prometer retirada imediata sem confirmação;\r\n- Fornecer protocolo.\r\n\r\nQuando houver evidência de negativação indevida, o caso deverá ser escalado conforme prioridade definida.\r\n\r\n## 41. Ameaça de escalonamento para executivos\r\n\r\nSe o cliente disser que acionará presidência, diretoria ou executivos:\r\n\r\n- Não demonstrar intimidação;\r\n- Não prometer contato direto;\r\n- Não oferecer benefício indevido;\r\n- Consultar o histórico;\r\n- Registrar a manifestação;\r\n- Acionar supervisão quando necessário;\r\n- Tratar a contestação normalmente;\r\n- Informar prazo e protocolo.\r\n\r\n## 42. Cliente exaltado\r\n\r\nO operador deverá:\r\n\r\n- Permitir que o cliente conclua;\r\n- Reconhecer o impacto;\r\n- Não elevar o tom;\r\n- Evitar interrupções;\r\n- Demonstrar domínio do processo;\r\n- Apresentar o próximo passo.\r\n\r\n**Exemplo:**\r\n\r\n“Entendi que essa é a terceira conta com a mesma cobrança e que você já solicitou o cancelamento do serviço. Vou consultar os protocolos anteriores antes de registrar uma nova ação.”\r\n\r\n## 43. Falha na ferramenta\r\n\r\nSe a ferramenta estiver indisponível:\r\n\r\n1. Informar a indisponibilidade;\r\n2. Não afirmar que a cobrança está correta;\r\n3. Registrar pelo fluxo de contingência;\r\n4. Preservar data e hora;\r\n5. Acionar suporte;\r\n6. Informar protocolo;\r\n7. Informar prazo de retorno;\r\n8. Evitar solicitar novo contato sem necessidade.\r\n\r\n**Exemplo:**\r\n\r\n“A ferramenta de detalhamento está indisponível. Vou registrar sua contestação pelo fluxo de contingência para preservar a data deste contato.”\r\n\r\n## 44. Transferência\r\n\r\nTransferir somente quando:\r\n\r\n- A contestação depender de área especializada;\r\n- Houver suspeita de fraude;\r\n- A cobrança pertencer a outro produto;\r\n- O operador não possuir alçada;\r\n- O fluxo determinar.\r\n\r\nAntes de transferir:\r\n\r\n- Informar o motivo;\r\n- Registrar o contexto;\r\n- Repassar valores e lançamentos;\r\n- Informar protocolo;\r\n- Evitar que o cliente repita a solicitação.\r\n\r\n## 45. Registro de opinião do cliente\r\n\r\nO histórico deverá reproduzir os fatos sem julgamento.\r\n\r\n**Inadequado:**\r\n\r\n“Cliente nervoso não aceita cobrança correta.”\r\n\r\n**Adequado:**\r\n\r\n“Cliente informa não reconhecer assinatura de R$ 29,90 e solicita contestação. Relata contatos anteriores nos protocolos informados.”\r\n\r\n## 46. Recapitulação obrigatória\r\n\r\nAntes de encerrar, informar:\r\n\r\n- Conta analisada;\r\n- Lançamento contestado;\r\n- Valor;\r\n- Ação realizada;\r\n- Serviço cancelado, quando aplicável;\r\n- Conta ajustada;\r\n- Valor a pagar;\r\n- Prazo;\r\n- Canal de retorno;\r\n- Protocolo.\r\n\r\n**Exemplo:**\r\n\r\n“Recapitulando: contestamos o serviço digital de R$ 29,90, cancelamos a renovação e ativamos o bloqueio preventivo autorizado. A conta ajustada de R$ 94,00 ficará disponível no App Vivo após o processamento. A análise será concluída em até cinco dias úteis. O protocolo é 202609130184.”\r\n\r\n## 47. Confirmação de entendimento\r\n\r\nPerguntar:\r\n\r\n- “As informações ficaram claras?”\r\n- “Ficou alguma dúvida sobre o valor que deve ser pago?”\r\n- “Posso esclarecer o prazo ou o acompanhamento?”\r\n- “Existe outra cobrança da mesma conta que você não reconhece?”\r\n\r\nEvitar encerrar apenas com “é só isso?”.\r\n\r\n## 48. Encerramento\r\n\r\n**Quando houver ajuste imediato:**\r\n\r\n“O valor foi corrigido e a conta ajustada ficará disponível no canal informado. Seu protocolo é 202609130184. Ficou alguma dúvida?”\r\n\r\n**Quando houver análise:**\r\n\r\n“A contestação foi registrada e será analisada no prazo informado. O retorno será enviado por SMS. Seu protocolo é 202609130184.”\r\n\r\n**Quando a cobrança for esclarecida:**\r\n\r\n“Confirmamos que o valor corresponde ao período e ao serviço detalhados. O protocolo deste atendimento é 202609130184. Posso ajudar em mais alguma questão?”\r\n\r\n## 49. Condutas proibidas\r\n\r\nÉ proibido:\r\n\r\n- Exigir pagamento integral para registrar contestação;\r\n- Presumir que toda cobrança do sistema é correta;\r\n- Culpar o cliente;\r\n- Dizer que o cliente “deve ter contratado”;\r\n- Cancelar serviço sem autorização;\r\n- Ativar bloqueio sem autorização;\r\n- Omitir cobranças anteriores;\r\n- Prometer estorno sem alçada;\r\n- Informar que não haverá bloqueio sem consultar;\r\n- Criar conta ajustada com valor incorreto;\r\n- Registrar aceite inexistente;\r\n- Abrir contestações duplicadas sem necessidade;\r\n- Negar protocolo;\r\n- Transferir sem contexto;\r\n- Solicitar comprovante por canal não oficial;\r\n- Expor dados de consumo;\r\n- Garantir prazo não informado;\r\n- Encerrar sem recapitulação.\r\n\r\n## 50. Frases recomendadas\r\n\r\n- “Vou consultar o detalhamento antes de concluir.”\r\n- “Qual cobrança você não reconhece?”\r\n- “Entendi que esse valor não era esperado.”\r\n- “Vou comparar com as contas anteriores.”\r\n- “Não farei alterações sem sua autorização.”\r\n- “Essa cobrança será encaminhada para análise.”\r\n- “Vou verificar se é possível emitir uma conta ajustada.”\r\n- “O valor não contestado é de...”\r\n- “A renovação do serviço foi cancelada.”\r\n- “O prazo de análise é de...”\r\n- “Seu protocolo é...”\r\n- “Vamos recapitular o que foi realizado.”\r\n\r\n## 51. Frases que devem ser evitadas\r\n\r\n- “Se está na conta, você usou.”\r\n- “A conta está certa.”\r\n- “Você deve ter clicado.”\r\n- “Primeiro paga e depois reclama.”\r\n- “Não tem como contestar.”\r\n- “Isso é automático.”\r\n- “Não posso fazer nada.”\r\n- “É só aguardar.”\r\n- “O sistema não erra.”\r\n- “Pode reclamar onde quiser.”\r\n- “Não sei quando resolve.”\r\n- “Ligue novamente.”\r\n- “O setor responsável vai ver.”\r\n\r\n## 52. Critérios de qualidade\r\n\r\nO atendimento será considerado adequado quando o operador:\r\n\r\n- Apresentar-se corretamente;\r\n- Ouvir a manifestação;\r\n- Confirmar o entendimento;\r\n- Validar o titular;\r\n- Identificar conta, lançamento e valor;\r\n- Comparar o histórico;\r\n- Explicar a composição;\r\n- Registrar cada item;\r\n- Corrigir dentro da alçada;\r\n- Cancelar recorrência indevida;\r\n- Oferecer bloqueio preventivo;\r\n- Informar valor não contestado;\r\n- Emitir conta ajustada quando aplicável;\r\n- Informar prazo;\r\n- Fornecer protocolo;\r\n- Recapitular;\r\n- Confirmar se restaram dúvidas;\r\n- Encerrar cordialmente.\r\n\r\n## 53. Falhas críticas de qualidade\r\n\r\nSão falhas críticas:\r\n\r\n- Exposição de dados;\r\n- Ajuste em conta errada;\r\n- Contestação em linha incorreta;\r\n- Cancelamento sem autorização;\r\n- Negativa de contestação sem análise;\r\n- Recusa de protocolo;\r\n- Informação falsa sobre estorno;\r\n- Omissão de suspeita de fraude;\r\n- Registro de aceite inexistente;\r\n- Conta ajustada com valor incorreto;\r\n- Orientação para não pagar valor reconhecido sem previsão;\r\n- Promessa de retirada de negativação sem confirmação;\r\n- Encerramento intencional para evitar tratamento;\r\n- Manipulação indevida de crédito.\r\n\r\n## 54. Indicadores operacionais\r\n\r\nMonitorar:\r\n\r\n- Contestações por tipo;\r\n- Ajustes imediatos;\r\n- Prazo médio de análise;\r\n- Procedência;\r\n- Reincidência;\r\n- Serviços digitais recorrentes;\r\n- Contas ajustadas;\r\n- Créditos;\r\n- Estornos;\r\n- Pagamentos não reconhecidos;\r\n- Fraudes;\r\n- Cobrança após cancelamento;\r\n- Contatos repetidos;\r\n- Transferências;\r\n- Reclamações regulatórias;\r\n- Impactos em órgãos de proteção ao crédito;\r\n- Qualidade dos registros;\r\n- Satisfação do cliente.\r\n\r\n## 55. Checklist do operador\r\n\r\nAntes de finalizar:\r\n\r\n- [ ] Ouvi a contestação completa?\r\n- [ ] Validei o titular?\r\n- [ ] Confirmei a conta questionada?\r\n- [ ] Identifiquei lançamento, valor e período?\r\n- [ ] Verifiquei se a conta foi paga?\r\n- [ ] Comparei contas anteriores?\r\n- [ ] Consultei alterações e contratações?\r\n- [ ] Expliquei a composição?\r\n- [ ] Identifiquei possível fraude?\r\n- [ ] Cancelei eventual recorrência indevida?\r\n- [ ] Solicitei autorização para bloqueios?\r\n- [ ] Apliquei ajuste dentro da alçada?\r\n- [ ] Abri análise quando necessário?\r\n- [ ] Informei o valor não contestado?\r\n- [ ] Emissão de conta ajustada foi avaliada?\r\n- [ ] Informei prazo e canal de retorno?\r\n- [ ] Registrei todos os fatos?\r\n- [ ] Forneci protocolo?\r\n- [ ] Recapitulei as ações?\r\n- [ ] Confirmei se restaram dúvidas?\r\n\r\n## 56. Fluxo resumido\r\n\r\n**Receber a manifestação → ouvir o cliente → validar o titular → identificar conta, lançamento e valor → consultar histórico → classificar a cobrança → explicar a composição → corrigir ou abrir análise → cancelar recorrências indevidas → avaliar conta ajustada → informar valor reconhecido → registrar prazo e protocolo → recapitular → encerrar.**\r\n\r\n## 57. Resultado esperado\r\n\r\nAo final, o cliente deverá saber:\r\n\r\n- Qual cobrança foi analisada;\r\n- Qual é a origem do valor;\r\n- Se a cobrança foi corrigida ou contestada;\r\n- Se o serviço foi cancelado;\r\n- Qual valor deverá pagar;\r\n- Onde obter a conta ajustada;\r\n- Qual é o prazo da análise;\r\n- Como receberá o retorno;\r\n- Qual é o protocolo;\r\n- O que deverá fazer se a cobrança reaparecer.\r\n\r\nO cliente não deverá encerrar o contato apenas com a orientação de aguardar, pagar integralmente ou ligar novamente."
export const V171F_PUBLISHED = new Map<string, PublishedKnowledgeDocument>([[V171F_DOC_ID, { documentId: V171F_DOC_ID, title: V171F_DOC_TITLE, content: V171F_CONTENT, version: 1 }]])
export const V171F_ASSESSMENT = {
  "processes": [
    {
      "product": null,
      "checkpoints": [
        {
          "status": "FOLLOWED",
          "guidance": {
            "text": "Verificar nome do serviço, valor, data de ativação, canal de contratação, recorrência, histórico de confirmação, linha e cobranças anteriores.",
            "source": "OFFICIAL_PROCEDURE"
          },
          "requirement": "Verificar nome do serviço, valor, data de ativação, canal de contratação, recorrência e cobranças anteriores",
          "uncertainty": null,
          "evidenceType": "OBSERVED",
          "knowledgeQuote": "Verificar:\n\n- Nome do serviço;\n- Valor;\n- Data de ativação;\n- Canal de contratação;\n- Recorrência;\n- Histórico de confirmação;\n- Linha em que foi ativado;\n- Cobranças anteriores.",
          "transcriptEvidence": [
            "Operador: Certo, abri aqui. Tem sim um serviço chamado Proteção Digital, de R$ 12,90 por mês. E ele aparece na conta de agosto também.",
            "Operador: Aqui mostra que foi ativado no dia 2 de julho, pelo aplicativo. Você lembra de ter aceitado alguma oferta por lá?"
          ],
          "knowledgeDetailQuote": null
        },
        {
          "status": "FOLLOWED",
          "guidance": {
            "text": "Cancelar a recorrência, quando permitido.",
            "source": "OFFICIAL_PROCEDURE"
          },
          "requirement": "Cancelar a recorrência do serviço digital não reconhecido",
          "uncertainty": null,
          "evidenceType": "OBSERVED",
          "knowledgeQuote": "1. Cancelar a recorrência, quando permitido;",
          "transcriptEvidence": [
            "Operador: Posso já tirar esse serviço da sua linha pra parar de cobrar. Quer que eu faça isso?",
            "Operador: Feito, desativei o Proteção Digital agora."
          ],
          "knowledgeDetailQuote": null
        },
        {
          "status": "FOLLOWED",
          "guidance": {
            "text": "Registrar contestação e analisar valores atuais e anteriores elegíveis.",
            "source": "OFFICIAL_PROCEDURE"
          },
          "requirement": "Registrar contestação dos valores elegíveis",
          "uncertainty": null,
          "evidenceType": "OBSERVED",
          "knowledgeQuote": "2. Registrar contestação;\n3. Analisar valores atuais e anteriores elegíveis;",
          "transcriptEvidence": [
            "Operador: Entendi. Então vou registrar a contestação das duas cobranças, agosto e setembro, pra equipe de faturamento analisar."
          ],
          "knowledgeDetailQuote": null
        },
        {
          "status": "NOT_OBSERVABLE",
          "guidance": {
            "text": "Ativar bloqueio preventivo, se disponível e autorizado pelo cliente.",
            "source": "OFFICIAL_PROCEDURE"
          },
          "requirement": "Ativar bloqueio preventivo, se disponível e autorizado",
          "uncertainty": "Não é possível confirmar na transcrição se o bloqueio preventivo estava disponível para ativação no sistema.",
          "evidenceType": null,
          "knowledgeQuote": "4. Ativar bloqueio preventivo, se disponível e autorizado;",
          "transcriptEvidence": [],
          "knowledgeDetailQuote": "O bloqueio preventivo deverá ser autorizado pelo cliente."
        },
        {
          "status": "NOT_FOLLOWED",
          "guidance": {
            "text": "Informar o prazo de conclusão da análise e evitar orientar o cliente apenas a aguardar.",
            "source": "OFFICIAL_PROCEDURE"
          },
          "requirement": "Explicar prazo",
          "uncertainty": null,
          "evidenceType": "OBSERVED",
          "knowledgeQuote": "5. Explicar prazo;",
          "transcriptEvidence": [
            "Operador: Não sei te dizer certinho, agora fica com o pessoal da análise, aí é aguardar que eles resolvem."
          ],
          "knowledgeDetailQuote": "O cliente não deverá encerrar o contato apenas com a orientação de aguardar, pagar integralmente ou ligar novamente."
        },
        {
          "status": "NOT_FOLLOWED",
          "guidance": {
            "text": "Orientar sobre a conta ajustada e o valor a ser pago.",
            "source": "OFFICIAL_PROCEDURE"
          },
          "requirement": "Orientar sobre conta ajustada",
          "uncertainty": null,
          "evidenceType": "OMISSION",
          "knowledgeQuote": "6. Orientar sobre conta ajustada;",
          "transcriptEvidence": [
            "Operador: Então, recapitulando, Roberto: abri a contestação das cobranças do Proteção Digital de agosto e setembro e já desativei o serviço. O número do protocolo é 2026 0925 9930."
          ],
          "knowledgeDetailQuote": "Ao final, o cliente deverá saber: Onde obter a conta ajustada; Qual valor deverá pagar;"
        },
        {
          "status": "FOLLOWED",
          "guidance": {
            "text": "Registrar e informar o protocolo do atendimento.",
            "source": "OFFICIAL_PROCEDURE"
          },
          "requirement": "Registrar e fornecer protocolo",
          "uncertainty": null,
          "evidenceType": "OBSERVED",
          "knowledgeQuote": "7. Registrar protocolo.",
          "transcriptEvidence": [
            "Operador: O número do protocolo é 2026 0925 9930."
          ],
          "knowledgeDetailQuote": null
        },
        {
          "status": "NOT_FOLLOWED",
          "guidance": {
            "text": "Recapitular informando conta analisada, lançamento contestado, valor, ação realizada, serviço cancelado, conta ajustada, valor a pagar, prazo, canal de retorno e protocolo.",
            "source": "OFFICIAL_PROCEDURE"
          },
          "requirement": "Recapitulação obrigatória antes de encerrar",
          "uncertainty": null,
          "evidenceType": "OBSERVED",
          "knowledgeQuote": "Antes de encerrar, informar:\n\n- Conta analisada;\n- Lançamento contestado;\n- Valor;\n- Ação realizada;\n- Serviço cancelado, quando aplicável;\n- Conta ajustada;\n- Valor a pagar;\n- Prazo;\n- Canal de retorno;\n- Protocolo.",
          "transcriptEvidence": [
            "Operador: Então, recapitulando, Roberto: abri a contestação das cobranças do Proteção Digital de agosto e setembro e já desativei o serviço. O número do protocolo é 2026 0925 9930."
          ],
          "knowledgeDetailQuote": null
        },
        {
          "status": "FOLLOWED",
          "guidance": {
            "text": "Perguntar se as informações ficaram claras ou se restaram dúvidas.",
            "source": "OFFICIAL_PROCEDURE"
          },
          "requirement": "Confirmação de entendimento",
          "uncertainty": null,
          "evidenceType": "OBSERVED",
          "knowledgeQuote": "Perguntar:\n\n- “As informações ficaram claras?”\n- “Ficou alguma dúvida sobre o valor que deve ser pago?”\n- “Posso esclarecer o prazo ou o acompanhamento?”\n- “Existe outra cobrança da mesma conta que você não reconhece?”",
          "transcriptEvidence": [
            "Operador: Ficou alguma dúvida?"
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
        "presentedSteps": 68
      }
    ]
  },
  "applicability": []
}
export const V171F_WRITER_RAW = {
  "items": [
    {
      "slot": "ITEM_1",
      "observed": "Você não informou o prazo de análise da contestação, orientando o cliente a apenas aguardar o retorno da equipe responsável.",
      "whatYouCanDo": "Informe o prazo de análise para o cliente no momento em que tratar a contestação da cobrança.",
      "whyItMatters": "O cliente não deve encerrar o atendimento apenas com a orientação de aguardar.",
      "suggestedResponse": "Vou encaminhar sua solicitação para a área responsável. O prazo para a conclusão da análise é de 5 dias úteis, e você receberá o retorno sobre o processo."
    },
    {
      "slot": "ITEM_2",
      "observed": "Você detalhou o serviço, valor, histórico de cobranças e a data de ativação do item questionado.",
      "whatYouCanDo": "",
      "whyItMatters": "",
      "suggestedResponse": ""
    },
    {
      "slot": "ITEM_3",
      "observed": "Você declarou que registrou a contestação das cobranças de agosto e setembro para análise.",
      "whatYouCanDo": "",
      "whyItMatters": "",
      "suggestedResponse": ""
    },
    {
      "slot": "ITEM_4",
      "observed": "Você verificou se o cliente tinha dúvidas ao final do atendimento.",
      "whatYouCanDo": "",
      "whyItMatters": "",
      "suggestedResponse": ""
    },
    {
      "slot": "ITEM_5",
      "observed": "Você ofereceu a desativação do serviço e declarou ter realizado o cancelamento da recorrência após a concordância do cliente.",
      "whatYouCanDo": "",
      "whyItMatters": "",
      "suggestedResponse": ""
    },
    {
      "slot": "ITEM_6",
      "observed": "Você informou o número do protocolo de atendimento ao cliente.",
      "whatYouCanDo": "",
      "whyItMatters": "",
      "suggestedResponse": ""
    }
  ],
  "presentation": {
    "closing": "Parabéns por conduzir as etapas de serviços, confirmação, cancelamento e registro. Na próxima, lembre-se de informar o prazo para que o cliente saiba exatamente o que esperar da análise.",
    "introduction": "Analisei seu atendimento sobre contestação de cobrança. Você demonstrou domínio ao tratar os serviços digitais, confirmar o entendimento, cancelar a recorrência e registrar o protocolo; apenas notei uma oportunidade na explicação de prazo, que veremos agora."
  }
}
