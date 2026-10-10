/**
 * V1.7.1m — o smoke REAL da V1.7.1l reproduzido offline (SMOKE-V171L-CONTESTACAO-001, matrícula 430f6d60, artefato fc4b0253):
 * transcrição enviada pela Central de Dados, avaliação de processo do Especialista de Faturamento (gemini-3.8-flash, 1 chamada,
 * sem edição), os trechos que entraram no prompt dele (com o score do ranking e o plano de cobertura que escolheu o "Jeito Vivo"
 * como processo), a resposta REAL do redator (gemini-3.1-flash-lite) e o documento transversal "Procedimento Operacional Jeito
 * Vivo de Atender" publicado (versão 1). O procedimento e o Checklist são os das fixtures V1.7.1f/V1.7.1j. Sem modelo.
 */
import type { PresentedKnowledgeExcerpt, PublishedKnowledgeDocument } from "../domain/process-assessment.js"
import { V171J_PUBLISHED } from "./contestacao-v171j-smoke-fixture.js"
export { V171J_CONTENT as V171L_CONTENT, V171J_DOC_ID as V171L_DOC_ID, V171J_DOC_TITLE as V171L_DOC_TITLE, V171J_CHECKLIST_ID as V171L_CHECKLIST_ID, V171J_CHECKLIST_CONTENT as V171L_CHECKLIST_CONTENT, V171J_CHECKLIST_TITLE as V171L_CHECKLIST_TITLE } from "./contestacao-v171j-smoke-fixture.js"

export const V171L_JEITO_VIVO_ID = "b8da52ca-e65c-419c-bace-83431f04ba2c"
export const V171L_JEITO_VIVO_TITLE = "Procedimento Operacional Jeito Vivo de Atender"
export const V171L_JEITO_VIVO_CONTENT = "# Procedimento Operacional Jeito Vivo de Atender\r\n\r\n## 1 Objetivo\r\n\r\nEstabelecer o padrão de comportamento, comunicação e condução dos atendimentos realizados em nome da Vivo.\r\n\r\nO Jeito Vivo de Atender busca oferecer uma experiência humana, simples, segura e resolutiva. Mais do que seguir um roteiro, o operador deve compreender a necessidade do cliente, assumir a condução do atendimento e comunicar cada etapa com clareza.\r\n\r\n## 2 Princípios do atendimento\r\n\r\nTodo atendimento deve seguir cinco princípios:\r\n\r\n### 2.1 Respeito\r\n\r\nTratar o cliente com educação, independentemente do motivo do contato, estado emocional, canal, região, idade ou condição financeira.\r\n\r\n### 2.2 Clareza\r\n\r\nUtilizar linguagem simples, frases diretas e explicações compatíveis com o conhecimento do cliente.\r\n\r\n### 2.3 Protagonismo\r\n\r\nAssumir a responsabilidade pela condução do contato, evitando transferências desnecessárias ou orientações genéricas.\r\n\r\n### 2.4 Segurança\r\n\r\nRealizar as validações obrigatórias e proteger dados pessoais, cadastrais e financeiros.\r\n\r\n### 2.5 Resolução\r\n\r\nBuscar a melhor solução disponível, confirmar se ela funcionou e informar próximos passos quando a conclusão não for imediata.\r\n\r\n## 3 Postura do operador\r\n\r\nO operador representa a Vivo durante todo o contato. Por isso, deve:\r\n\r\n- Demonstrar disponibilidade;\r\n- Ouvir sem interromper desnecessariamente;\r\n- Falar com segurança e naturalidade;\r\n- Manter tom de voz cordial e profissional;\r\n- Demonstrar interesse real pela necessidade apresentada;\r\n- Explicar o que está fazendo;\r\n- Cumprir os procedimentos de segurança;\r\n- Evitar julgamentos, ironias ou discussões;\r\n- Respeitar o ritmo de compreensão do cliente;\r\n- Permanecer responsável pela chamada até sua conclusão ou transferência correta.\r\n\r\nO operador não deve parecer apressado, indiferente ou mecânico.\r\n\r\n## 4 Apresentação inicial\r\n\r\nA abertura deve identificar a empresa, o operador e o cliente.\r\n\r\n### Modelo recomendado\r\n\r\n“Olá, bom dia! Você está falando com a Vivo. Meu nome é [nome do operador]. Com quem eu falo?”\r\n\r\nApós o cliente se identificar:\r\n\r\n“Olá, [nome do cliente]. Como posso ajudar você hoje?”\r\n\r\n### Regras de apresentação\r\n\r\n- Cumprimentar conforme o horário;\r\n- Informar o primeiro nome de forma clara;\r\n- Mencionar a Vivo;\r\n- Perguntar o nome do cliente;\r\n- Demonstrar disponibilidade;\r\n- Não iniciar solicitando CPF ou outros dados sem explicar o motivo;\r\n- Não utilizar frases excessivamente longas ou artificiais.\r\n\r\n### Evitar\r\n\r\n- “CPF?”\r\n- “Fala.”\r\n- “Qual o problema?”\r\n- “Central Vivo, diga.”\r\n- “Próximo.”\r\n- “Em que posso estar ajudando?”\r\n\r\n## 5 Como chamar o cliente\r\n\r\nO operador deve utilizar preferencialmente o primeiro nome informado pelo cliente.\r\n\r\nExemplos:\r\n\r\n- “Entendi, Juliana.”\r\n- “Vou verificar isso para você, Carlos.”\r\n- “Marcos, encontrei a informação.”\r\n- “Dona Maria, vou explicar o próximo passo.”\r\n\r\nTratamentos como “senhor” ou “senhora” podem ser utilizados quando:\r\n\r\n- O cliente demonstrar preferência;\r\n- Houver diferença de idade ou contexto que torne o tratamento adequado;\r\n- O atendimento exigir maior formalidade.\r\n\r\nO operador deve evitar:\r\n\r\n- Repetir o nome em todas as frases;\r\n- Utilizar apelidos sem autorização;\r\n- Chamar o cliente de “querido”, “amigo”, “meu bem” ou “chefe”;\r\n- Utilizar diminutivos;\r\n- Tratar o cliente apenas como “CPF”, “titular”, “usuário” ou “consumidor”;\r\n- Utilizar pronome ou tratamento diferente daquele indicado pelo cliente.\r\n\r\n## 6 Escuta e entendimento da necessidade\r\n\r\nAntes de consultar sistemas ou oferecer soluções, o operador deve compreender o motivo do contato.\r\n\r\n### Técnica de escuta\r\n\r\n1. Permitir que o cliente explique a situação;\r\n2. Não interromper, exceto quando necessário para organizar o atendimento;\r\n3. Identificar o pedido principal;\r\n4. Fazer perguntas objetivas;\r\n5. Confirmar o entendimento;\r\n6. Informar o que será feito.\r\n\r\n### Exemplo\r\n\r\n“Entendi, Paula. Você realizou o pagamento ontem, mas a linha continua bloqueada. Vou consultar a identificação desse pagamento e verificar o prazo de restabelecimento. Está correto?”\r\n\r\n### Perguntas recomendadas\r\n\r\n- “Quando você percebeu essa situação?”\r\n- “O que aparece na tela?”\r\n- “Essa cobrança corresponde a qual período?”\r\n- “Você já tentou acessar pelo aplicativo?”\r\n- “A dificuldade acontece apenas nesse aparelho?”\r\n- “Qual solução você espera para este atendimento?”\r\n\r\n### Evitar\r\n\r\n- Fazer o cliente repetir informações já fornecidas;\r\n- Presumir a causa antes de verificar;\r\n- Interromper para seguir o sistema;\r\n- Culpar o cliente;\r\n- Questionar em tom de desconfiança;\r\n- Fazer várias perguntas ao mesmo tempo.\r\n\r\n## 7 Demonstração de acolhimento\r\n\r\nAcolher não significa assumir culpa ou prometer algo antes da análise. Significa reconhecer a situação e demonstrar disposição para ajudar.\r\n\r\n### Exemplos adequados\r\n\r\n- “Entendi como isso está impactando você.”\r\n- “Vou verificar com atenção.”\r\n- “Compreendo sua preocupação.”\r\n- “Obrigado por explicar o que aconteceu.”\r\n- “Vamos analisar as possibilidades.”\r\n- “Vou acompanhar você durante esse processo.”\r\n\r\n### Evitar frases automáticas\r\n\r\n- “Sinto muito por qualquer inconveniente.”\r\n- “Infelizmente é o procedimento.”\r\n- “Não posso fazer nada.”\r\n- “Você deveria ter feito antes.”\r\n- “Isso não é problema da Vivo.”\r\n- “Calma.”\r\n- “Como eu já falei.”\r\n\r\nA empatia deve ser verdadeira e proporcional à situação. Repetir pedidos de desculpas sem apresentar uma ação pode aumentar a insatisfação.\r\n\r\n## 8 Validação de segurança\r\n\r\nAntes de acessar ou alterar informações protegidas, o operador deve explicar a necessidade da validação.\r\n\r\n### Modelo recomendado\r\n\r\n“Para proteger seus dados e acessar as informações da linha, preciso realizar uma validação de segurança.”\r\n\r\nDurante a validação:\r\n\r\n- Solicitar somente os dados previstos;\r\n- Não ler informações completas para o cliente;\r\n- Não pedir senhas, tokens ou códigos bancários;\r\n- Não registrar dados sensíveis em locais não autorizados;\r\n- Não reduzir controles por pressa ou pressão;\r\n- Informar quando a validação não for concluída.\r\n\r\n### Quando a validação falhar\r\n\r\n“Não consegui concluir uma validação obrigatória. Por segurança, não posso acessar ou alterar essas informações neste momento. Vou orientar o próximo passo permitido.”\r\n\r\nO operador não deve revelar regras internas, respostas esperadas ou critérios antifraude.\r\n\r\n## 9 Condução do atendimento\r\n\r\nO operador deve informar ao cliente o que está fazendo, evitando silêncio e insegurança.\r\n\r\n### Etapas da condução\r\n\r\n1. Confirmar a necessidade;\r\n2. Explicar a validação;\r\n3. Consultar os sistemas;\r\n4. Informar o diagnóstico;\r\n5. Apresentar as opções;\r\n6. Confirmar a escolha do cliente;\r\n7. Executar a ação;\r\n8. Validar o resultado;\r\n9. Recapitular;\r\n10. Encerrar.\r\n\r\n### Frases de condução\r\n\r\n- “Vou consultar a situação da linha.”\r\n- “Agora vou verificar as condições disponíveis.”\r\n- “Localizei a origem da cobrança.”\r\n- “Temos duas opções para resolver.”\r\n- “Antes de confirmar, vou explicar os impactos.”\r\n- “A solicitação foi concluída. Vamos testar?”\r\n- “Ainda não concluímos. O próximo passo será este.”\r\n\r\nO cliente não deve precisar perguntar repetidamente o que está acontecendo.\r\n\r\n## 10 Tempo de espera\r\n\r\nQuando precisar consultar sistemas ou pedir apoio, o operador deve avisar o cliente.\r\n\r\n### Antes da espera\r\n\r\n“Vou realizar uma consulta que pode levar cerca de dois minutos. Você pode aguardar na linha?”\r\n\r\n### Ao retornar\r\n\r\n“Obrigado por aguardar, [nome]. Localizei a informação.”\r\n\r\n### Se a espera demorar mais\r\n\r\n“A consulta está levando mais tempo do que o previsto. Preciso de mais alguns minutos. Você pode continuar aguardando?”\r\n\r\n### Regras\r\n\r\n- Informar o motivo da espera;\r\n- Dar uma previsão realista;\r\n- Solicitar autorização;\r\n- Retornar periodicamente;\r\n- Agradecer pela espera;\r\n- Não deixar o cliente em silêncio prolongado;\r\n- Não utilizar a espera para evitar uma conversa difícil.\r\n\r\n## 11 Linguagem do atendimento\r\n\r\nA comunicação deve ser simples, positiva e responsável.\r\n\r\n### Preferir\r\n\r\n- “Vou verificar.”\r\n- “O que posso fazer neste momento é…”\r\n- “A opção disponível é…”\r\n- “O prazo informado pelo sistema é…”\r\n- “Para concluir, precisamos…”\r\n- “Não foi possível desta forma, mas existe esta alternativa.”\r\n\r\n### Evitar\r\n\r\n- “Não dá.”\r\n- “Não tem jeito.”\r\n- “É regra.”\r\n- “O sistema não deixa.”\r\n- “Isso é com outro setor.”\r\n- “Você tem que…”\r\n- “Não é comigo.”\r\n- “Não sei.”\r\n- “Talvez resolva.”\r\n- “Com certeza”, quando não houver garantia.\r\n\r\n### Trocas recomendadas\r\n\r\nEm vez de “Você tem que pagar”, utilizar:\r\n\r\n“Para regularizar a linha, é necessário realizar o pagamento nas condições apresentadas.”\r\n\r\nEm vez de “O sistema está fora”, utilizar:\r\n\r\n“A ferramenta necessária está indisponível neste momento. Vou registrar a ocorrência e informar o próximo passo.”\r\n\r\nEm vez de “Não posso fazer nada”, utilizar:\r\n\r\n“Esta opção não está disponível para mim, mas posso orientar você sobre a alternativa permitida.”\r\n\r\n## 12 Personalização\r\n\r\nO operador deve adaptar a comunicação ao perfil e ao momento do cliente.\r\n\r\n### Cliente objetivo\r\n\r\nResponder com agilidade, evitando explicações desnecessárias.\r\n\r\n### Cliente com dificuldade digital\r\n\r\nOrientar passo a passo, aguardando a conclusão de cada etapa.\r\n\r\n### Cliente idoso\r\n\r\nFalar com clareza, sem infantilizar, diminuir ou presumir incapacidade.\r\n\r\n### Cliente com deficiência\r\n\r\nPerguntar como pode tornar o atendimento mais acessível. Não direcionar automaticamente a conversa ao acompanhante.\r\n\r\n### Cliente emocionalmente abalado\r\n\r\nReduzir o ritmo, reconhecer o impacto e organizar os próximos passos.\r\n\r\n### Cliente com conhecimento técnico\r\n\r\nManter objetividade e utilizar termos técnicos somente quando ajudarem na solução.\r\n\r\n## 13 Apresentação de ofertas\r\n\r\nUma oferta deve estar relacionada à necessidade do cliente e nunca deve prejudicar a resolução do motivo principal.\r\n\r\nO operador deve:\r\n\r\n- Resolver ou encaminhar primeiro a solicitação;\r\n- Pedir permissão antes de apresentar a oferta;\r\n- Explicar preço, benefícios, prazo e condições;\r\n- Informar fidelização, multa ou renovação, quando aplicável;\r\n- Confirmar se o cliente compreendeu;\r\n- Obter aceite expresso;\r\n- Respeitar imediatamente uma recusa.\r\n\r\n### Exemplo\r\n\r\n“Antes de encerrarmos, identifiquei uma opção que pode reduzir seu valor mensal. Você gostaria de conhecer?”\r\n\r\n### Evitar\r\n\r\n- Oferecer produto durante relato de fraude, luto ou emergência;\r\n- Ocultar valores ou condições;\r\n- Pressionar o cliente;\r\n- Apresentar a oferta como obrigatória;\r\n- Alterar produto sem aceite;\r\n- Repetir a oferta após recusa clara.\r\n\r\n## 14 Comunicação de prazos\r\n\r\nTodo prazo deve ser explicado de forma completa.\r\n\r\nO operador deve informar:\r\n\r\n- Qual é o prazo;\r\n- Quando a contagem começa;\r\n- Se são horas corridas ou úteis;\r\n- O que deverá acontecer;\r\n- Como acompanhar;\r\n- O que fazer se o prazo não for cumprido.\r\n\r\n### Exemplo\r\n\r\n“A análise será concluída em até três dias úteis, contados a partir de hoje. Você poderá acompanhar pelo Meu Vivo usando o protocolo. Se não houver atualização após esse prazo, entre em contato novamente.”\r\n\r\nEvitar:\r\n\r\n- “É só aguardar.”\r\n- “Logo resolve.”\r\n- “Pode cair a qualquer momento.”\r\n- “Hoje ainda estará resolvido”, sem garantia.\r\n- “Em até 24 horas”, sem explicar o evento esperado.\r\n\r\n## 15 Confirmação antes de alterações\r\n\r\nAntes de executar cancelamento, negociação, troca de plano, ativação, bloqueio ou outra alteração relevante, o operador deve recapitular:\r\n\r\n- O que será alterado;\r\n- Valores envolvidos;\r\n- Benefícios incluídos ou retirados;\r\n- Data de vigência;\r\n- Prazo;\r\n- Possíveis impactos;\r\n- Condições de cancelamento;\r\n- Eventual fidelização ou multa.\r\n\r\n### Modelo\r\n\r\n“Confirmando: você está autorizando [alteração], no valor de [valor], com vigência em [data] e as seguintes condições: [resumo]. Posso concluir?”\r\n\r\nO silêncio do cliente não deve ser considerado aceite.\r\n\r\n## 16 Tratamento de clientes insatisfeitos\r\n\r\nQuando o cliente estiver irritado, o operador deve manter voz estável e conduzir a conversa para fatos e ações.\r\n\r\n### Procedimento\r\n\r\n1. Permitir que o cliente explique;\r\n2. Não interromper para se defender;\r\n3. Reconhecer o impacto;\r\n4. Confirmar o problema;\r\n5. Informar o que será analisado;\r\n6. Apresentar possibilidades reais;\r\n7. Registrar a manifestação;\r\n8. Confirmar próximos passos.\r\n\r\n### Exemplo\r\n\r\n“Entendi que você já entrou em contato anteriormente e a situação continua. Vou consultar o protocolo anterior para evitar que você repita todo o histórico.”\r\n\r\n### Diante de ofensas\r\n\r\n“Quero continuar ajudando, mas preciso que mantenhamos uma conversa respeitosa.”\r\n\r\nSe as ofensas continuarem:\r\n\r\n“Já solicitei que o atendimento seja mantido de forma respeitosa. Se as ofensas continuarem, a chamada poderá ser encerrada conforme nossa política.”\r\n\r\nA ligação não deve ser encerrada sem os avisos previstos, salvo situação de ameaça imediata ou regra específica.\r\n\r\n## 17 Ameaça de reclamação ou escalonamento\r\n\r\nMenções à Anatel, órgãos de defesa do consumidor, imprensa, redes sociais ou executivos da Vivo devem ser tratadas com seriedade, sem confronto ou tratamento irônico.\r\n\r\n### Modelo\r\n\r\n“Compreendo que você deseja escalar a situação. Vou registrar sua manifestação e verificar o que pode ser feito neste atendimento.”\r\n\r\nA ameaça de reclamação:\r\n\r\n- Deve ser registrada;\r\n- Não elimina validações de segurança;\r\n- Não autoriza concessão fora da alçada;\r\n- Não deve gerar retaliação;\r\n- Pode justificar avaliação do supervisor conforme o processo específico.\r\n\r\n## 18 Transferência de atendimento\r\n\r\nA transferência deve ocorrer somente quando o assunto exigir atuação de outra equipe.\r\n\r\nAntes de transferir, o operador deve:\r\n\r\n- Explicar o motivo;\r\n- Informar para qual área o cliente será direcionado;\r\n- Registrar o resumo;\r\n- Repassar o contexto disponível;\r\n- Evitar que o cliente repita informações;\r\n- Confirmar que a transferência é o caminho correto.\r\n\r\n### Modelo\r\n\r\n“Para concluir essa solicitação, é necessária a atuação da equipe de segurança. Vou transferir você e registrar tudo o que já verificamos.”\r\n\r\nÉ proibido transferir para:\r\n\r\n- Evitar uma reclamação;\r\n- Reduzir o tempo médio;\r\n- Encerrar assunto difícil;\r\n- Corrigir falta de conhecimento do operador sem buscar apoio;\r\n- Retornar o cliente para uma área que já confirmou não possuir atuação.\r\n\r\n## 19 Quando não houver solução imediata\r\n\r\nSe a solicitação depender de análise ou correção posterior, o operador deve entregar um encaminhamento completo.\r\n\r\nO cliente deve receber:\r\n\r\n- Diagnóstico disponível;\r\n- Ação realizada;\r\n- Motivo da pendência;\r\n- Prazo;\r\n- Protocolo;\r\n- Forma de acompanhamento;\r\n- Orientação caso o prazo não seja cumprido.\r\n\r\n### Modelo\r\n\r\n“Não foi possível concluir durante a chamada porque a ferramenta de provisionamento está indisponível. Registrei um chamado de prioridade alta, com prazo de até quatro horas. Você receberá uma atualização no canal cadastrado.”\r\n\r\n## 20 Recapitulação\r\n\r\nAntes de encerrar, o operador deve resumir o atendimento.\r\n\r\n### Modelo\r\n\r\n“Recapitulando: atualizamos o cadastro, enviamos a segunda via para o canal validado e o pagamento poderá ser realizado por Pix. O protocolo é [número].”\r\n\r\nA recapitulação deve incluir:\r\n\r\n- Motivo do contato;\r\n- Solução ou encaminhamento;\r\n- Prazo;\r\n- Protocolo;\r\n- Responsabilidade do cliente, quando houver;\r\n- Canal de acompanhamento.\r\n\r\n## 21 Confirmação da resolução\r\n\r\nO operador deve confirmar se a necessidade foi atendida.\r\n\r\n### Perguntas recomendadas\r\n\r\n- “A solução atendeu ao que você precisava?”\r\n- “Você conseguiu acessar?”\r\n- “O serviço está funcionando agora?”\r\n- “Ficou alguma dúvida sobre o prazo?”\r\n- “Posso ajudar em mais alguma questão?”\r\n\r\nEvitar:\r\n\r\n- “Era só isso?”\r\n- “Terminou?”\r\n- “Mais alguma coisa?”, em tom apressado.\r\n- Encerrar imediatamente após executar a ação.\r\n\r\n## 22 Encerramento da chamada\r\n\r\nO encerramento deve ser cordial, objetivo e personalizado.\r\n\r\n### Modelo completo\r\n\r\n“[Nome do cliente], sua solicitação foi concluída e o protocolo é [número]. Você poderá acompanhar pelo Meu Vivo. Posso ajudar em mais alguma coisa?”\r\n\r\nApós a resposta:\r\n\r\n“Obrigado por entrar em contato com a Vivo. Tenha uma ótima tarde.”\r\n\r\n### Quando houver pendência\r\n\r\n“Seu chamado foi registrado com prazo de até [prazo]. O protocolo é [número] e o acompanhamento poderá ser feito pelo Meu Vivo. Obrigado pelo contato e tenha uma boa tarde.”\r\n\r\n### Quando não for possível atender\r\n\r\n“Não foi possível concluir porque uma validação obrigatória não foi aprovada. O protocolo é [número] e o próximo passo permitido é [orientação]. Obrigado pelo contato.”\r\n\r\n## 23 Situações que devem ser evitadas\r\n\r\nO operador não deve:\r\n\r\n- Interromper repetidamente;\r\n- Discutir com o cliente;\r\n- Demonstrar impaciência;\r\n- Usar ironia ou deboche;\r\n- Falar mal da Vivo, de colegas ou de outras áreas;\r\n- Culpar o sistema;\r\n- Inventar informação;\r\n- Prometer resultado sem confirmação;\r\n- Ocultar prazo, valor ou condição;\r\n- Pressionar por oferta;\r\n- Pedir avaliação positiva;\r\n- Encerrar sem protocolo;\r\n- Transferir sem contexto;\r\n- Expor regras antifraude;\r\n- Utilizar dados do cliente fora da finalidade do atendimento;\r\n- Conversar com colegas enquanto o cliente aguarda;\r\n- Demonstrar julgamento sobre dívidas, consumo ou comportamento.\r\n\r\n## 24 Expressões recomendadas\r\n\r\n- “Vou ajudar você.”\r\n- “Entendi a sua necessidade.”\r\n- “Obrigado por explicar.”\r\n- “Vou verificar com atenção.”\r\n- “Localizei a informação.”\r\n- “Temos estas opções.”\r\n- “Antes de confirmar, vou recapitular.”\r\n- “O prazo informado é…”\r\n- “Vou registrar sua manifestação.”\r\n- “A solução foi concluída.”\r\n- “Este é o próximo passo.”\r\n- “Obrigado por aguardar.”\r\n- “Posso ajudar em mais alguma questão?”\r\n\r\n## 25 Expressões não recomendadas\r\n\r\n- “Isso não é comigo.”\r\n- “Você entendeu errado.”\r\n- “Já falei.”\r\n- “Não posso fazer nada.”\r\n- “É impossível.”\r\n- “O sistema é ruim.”\r\n- “O outro atendente errou.”\r\n- “Você precisa se acalmar.”\r\n- “Se quiser, reclame.”\r\n- “É o procedimento e pronto.”\r\n- “Provavelmente vai resolver.”\r\n- “Pode confiar em mim.”\r\n- “É só esperar.”\r\n- “Não sei.”\r\n- “Você é obrigado.”\r\n\r\n## 26 Padrão de registro\r\n\r\nO protocolo deve permitir que outro operador compreenda o atendimento sem pedir que o cliente repita todo o histórico.\r\n\r\nRegistrar:\r\n\r\n- Motivo do contato;\r\n- Relato objetivo;\r\n- Validações realizadas;\r\n- Consultas efetuadas;\r\n- Informações apresentadas;\r\n- Opções oferecidas;\r\n- Decisão do cliente;\r\n- Ação executada;\r\n- Resultado;\r\n- Prazo;\r\n- Transferência ou escalonamento;\r\n- Protocolo relacionado;\r\n- Orientações finais.\r\n\r\nNão registrar opiniões pessoais, julgamentos ou expressões ofensivas utilizadas pelo próprio operador.\r\n\r\n## 27 Critérios de qualidade\r\n\r\nO atendimento poderá ser avaliado pelos seguintes critérios:\r\n\r\n- Apresentação correta;\r\n- Uso adequado do nome;\r\n- Escuta sem interrupções;\r\n- Confirmação da necessidade;\r\n- Clareza da comunicação;\r\n- Cumprimento das validações;\r\n- Domínio da condução;\r\n- Explicação de prazos e condições;\r\n- Ausência de promessas indevidas;\r\n- Personalização;\r\n- Resolução ou encaminhamento correto;\r\n- Registro completo;\r\n- Recapitulação;\r\n- Entrega do protocolo;\r\n- Encerramento cordial.\r\n\r\n## 28 Checklist rápido do operador\r\n\r\nAntes de encerrar, confirme:\r\n\r\n- Cumprimentei e me apresentei;\r\n- Perguntei e utilizei corretamente o nome do cliente;\r\n- Entendi o motivo principal;\r\n- Evitei que o cliente repetisse informações;\r\n- Realizei as validações;\r\n- Expliquei o que estava fazendo;\r\n- Apresentei somente informações confirmadas;\r\n- Informei valores, impactos e prazos;\r\n- Obtive aceite antes de alterações;\r\n- Testei ou confirmei o resultado;\r\n- Registrei o atendimento;\r\n- Recapitulei a solução;\r\n- Informei o protocolo;\r\n- Perguntei se havia outra necessidade;\r\n- Encerrei de forma cordial.\r\n\r\n## 29 Resumo do Jeito Vivo de Atender\r\n\r\nO operador deve fazer o cliente perceber que:\r\n\r\n- Foi ouvido;\r\n- Foi respeitado;\r\n- Teve seus dados protegidos;\r\n- Entendeu o que aconteceu;\r\n- Conhece a solução ou o próximo passo;\r\n- Sabe o prazo;\r\n- Possui um protocolo;\r\n- Não precisará começar do zero em um próximo contato.\r\n\r\nO atendimento é considerado concluído quando o cliente compreende o resultado, e não apenas quando o operador finaliza a chamada."
export const V171L_PUBLISHED = new Map<string, PublishedKnowledgeDocument>([...V171J_PUBLISHED, [V171L_JEITO_VIVO_ID, { documentId: V171L_JEITO_VIVO_ID, title: V171L_JEITO_VIVO_TITLE, content: V171L_JEITO_VIVO_CONTENT, version: 1 }]])

export const V171L_SUBJECT = "Contestação de cobrança"
export const V171L_COLLABORATOR_NAME = "Larissa Monteiro"
export const V171L_TRANSCRIPT = "Operador: Conecta, boa noite, você fala com a Larissa. Com quem eu falo?\nCliente: Oi, Larissa. Aqui é o Márcio Figueira, a linha é minha. Chegou uma cobrança na fatura que eu não faço ideia do que seja.\nOperador: Vamos ver isso juntos, Márcio. Pra eu entrar no seu cadastro, me confirma os três últimos dígitos do CPF?\nCliente: 402.\nOperador: E a sua data de nascimento?\nCliente: 19 de junho de 1988.\nOperador: Obrigada. O seu telefone para contato ainda é o mesmo, com final 4410?\nCliente: É esse mesmo.\nOperador: Certo. Qual é a cobrança que você não está reconhecendo?\nCliente: Tem um tal de Games Max aí, eu nunca pedi isso.\nOperador: Achei aqui: é um clube de jogos, o Games Max, de R$ 14,90 por mês. Ele foi ativado por um link no dia 5 de agosto e já veio nas faturas de agosto e de setembro.\nCliente: Por um link? Eu devo ter clicado sem querer, mas não autorizei nada.\nOperador: Entendi. Você já pagou alguma dessas faturas?\nCliente: A de agosto sim. A de setembro vence semana que vem.\nOperador: Tudo bem. Vou deixar registrada a contestação das duas cobranças do Games Max, e o time de faturamento vai analisar.\nCliente: E isso vai continuar vindo?\nOperador: Não vai, já desativei a renovação automática dele, então a partir de agora não cobra mais.\nCliente: Ótimo. E o dinheiro de agosto, eu recebo quando?\nOperador: Agora é aguardar a análise, eles verificam e depois te dão uma posição.\nCliente: Mas demora muito?\nOperador: Isso eu não consigo te passar agora, cada caso é um caso.\nCliente: Tá certo.\nOperador: Então, Márcio, só pra fechar: registrei a contestação das duas cobranças de R$ 14,90 do Games Max, a renovação já está desativada, e o seu protocolo é 2026 0925 9182.\nCliente: Espera que eu vou anotar... pronto.\nOperador: Ficou alguma dúvida sobre o que a gente fez hoje?\nCliente: Não, entendi tudo.\nOperador: Posso ajudar com mais alguma coisa?\nCliente: Não, só isso mesmo.\nOperador: Então obrigada por ligar, Márcio. Tenha uma boa noite!"
/** Trechos que entraram no prompt, na ordem do rastro (ranking + cobertura). */
export const V171L_PRESENTED: PresentedKnowledgeExcerpt[] = [
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
    "heading": "5. Apresentação do operador",
    "excerpt": "**Exemplo recomendado:**\n\n“Olá, boa tarde! Meu nome é Juliana Prado, sou do atendimento Vivo. Com quem eu tenho o prazer de falar?”\n\nApós identificar o cliente:\n\n“Obrigada, Ricardo. Entendi que você não reconhece um valor da sua conta. Vou consultar o detalhamento e explicar o que encontrei.”\n\nEvitar:\n\n- “A conta está certa.”\n- “Se está na fatura, você contratou.”\n- “Você deve ter clicado em alguma coisa.”\n- “Primeiro precisa pagar.”\n- “Isso não pode ser contestado.”",
    "chunkIndex": 16
  },
  {
    "documentId": "c8f2c818-72db-48dc-8d7d-d8a9fe861c65",
    "documentTitle": "Procedimento Operacional — Contestação de Contas Móvel",
    "heading": "51. Frases que devem ser evitadas",
    "excerpt": "- “Se está na conta, você usou.”\n- “A conta está certa.”\n- “Você deve ter clicado.”\n- “Primeiro paga e depois reclama.”\n- “Não tem como contestar.”\n- “Isso é automático.”\n- “Não posso fazer nada.”\n- “É só aguardar.”\n- “O sistema não erra.”\n- “Pode reclamar onde quiser.”\n- “Não sei quando resolve.”\n- “Ligue novamente.”\n- “O setor responsável vai ver.”",
    "chunkIndex": 67
  },
  {
    "documentId": "b8da52ca-e65c-419c-bace-83431f04ba2c",
    "documentTitle": "Procedimento Operacional Jeito Vivo de Atender",
    "heading": "Exemplo",
    "excerpt": "“A análise será concluída em até três dias úteis, contados a partir de hoje. Você poderá acompanhar pelo Meu Vivo usando o protocolo. Se não houver atualização após esse prazo, entre em contato novamente.”\n\nEvitar:\n\n- “É só aguardar.”\n- “Logo resolve.”\n- “Pode cair a qualquer momento.”\n- “Hoje ainda estará resolvido”, sem garantia.\n- “Em até 24 horas”, sem explicar o evento esperado.",
    "chunkIndex": 47
  },
  {
    "documentId": "c8f2c818-72db-48dc-8d7d-d8a9fe861c65",
    "documentTitle": "Procedimento Operacional — Contestação de Contas Móvel",
    "heading": "50. Frases recomendadas",
    "excerpt": "- “Vou consultar o detalhamento antes de concluir.”\n- “Qual cobrança você não reconhece?”\n- “Entendi que esse valor não era esperado.”\n- “Vou comparar com as contas anteriores.”\n- “Não farei alterações sem sua autorização.”\n- “Essa cobrança será encaminhada para análise.”\n- “Vou verificar se é possível emitir uma conta ajustada.”\n- “O valor não contestado é de...”\n- “A renovação do serviço foi cancelada.”\n- “O prazo de análise é de...”\n- “Seu protocolo é...”\n- “Vamos recapitular o que foi realizado.”",
    "chunkIndex": 66
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
    "heading": "6. Escuta e identificação da solicitação",
    "excerpt": "O operador deverá permitir que o cliente explique:\n\n- Qual conta está questionando;\n- Qual cobrança não reconhece;\n- Qual valor esperava;\n- Qual valor foi faturado;\n- Quando percebeu a diferença;\n- Se a conta já foi paga;\n- Se já houve contato anterior;\n- Se a cobrança continua ocorrendo;\n- Se existe ameaça de bloqueio ou negativação;\n- Se há suspeita de fraude.\n\n**Exemplo:**\n\n“Para eu analisar corretamente, poderia me informar qual cobrança você não reconhece e em qual conta ela aparece?”\n\nDepois, confirmar o entendimento:\n\n“Entendi. Sua mensalidade habitual era de R$ 89,99, mas a conta atual veio em R$ 149,89 por causa de um serviço digital de R$ 59,90 que você não reconhece. Está correto?”",
    "chunkIndex": 17
  },
  {
    "documentId": "b8da52ca-e65c-419c-bace-83431f04ba2c",
    "documentTitle": "Procedimento Operacional Jeito Vivo de Atender",
    "heading": "20 Recapitulação",
    "excerpt": "Antes de encerrar, o operador deve resumir o atendimento.",
    "chunkIndex": 60
  },
  {
    "documentId": "b8da52ca-e65c-419c-bace-83431f04ba2c",
    "documentTitle": "Procedimento Operacional Jeito Vivo de Atender",
    "heading": "21 Confirmação da resolução",
    "excerpt": "O operador deve confirmar se a necessidade foi atendida.",
    "chunkIndex": 62
  },
  {
    "documentId": "b8da52ca-e65c-419c-bace-83431f04ba2c",
    "documentTitle": "Procedimento Operacional Jeito Vivo de Atender",
    "heading": "22 Encerramento da chamada",
    "excerpt": "O encerramento deve ser cordial, objetivo e personalizado.",
    "chunkIndex": 64
  },
  {
    "documentId": "b8da52ca-e65c-419c-bace-83431f04ba2c",
    "documentTitle": "Procedimento Operacional Jeito Vivo de Atender",
    "heading": "28 Checklist rápido do operador",
    "excerpt": "Antes de encerrar, confirme:\n\n- Cumprimentei e me apresentei;\n- Perguntei e utilizei corretamente o nome do cliente;\n- Entendi o motivo principal;\n- Evitei que o cliente repetisse informações;\n- Realizei as validações;\n- Expliquei o que estava fazendo;\n- Apresentei somente informações confirmadas;\n- Informei valores, impactos e prazos;\n- Obtive aceite antes de alterações;\n- Testei ou confirmei o resultado;\n- Registrei o atendimento;\n- Recapitulei a solução;\n- Informei o protocolo;\n- Perguntei se havia outra necessidade;\n- Encerrei de forma cordial.",
    "chunkIndex": 73
  },
  {
    "documentId": "00000000-0000-4000-8000-000000000051",
    "documentTitle": "Checklist de Encerramento de Chamada",
    "heading": "",
    "excerpt": "Antes de encerrar qualquer chamada: (1) confirme a solução aplicada; (2) informe o número do protocolo; (3) explique o próximo passo e o prazo; (4) confirme se o cliente tem mais alguma dúvida.",
    "chunkIndex": 0
  },
  {
    "documentId": "c8f2c818-72db-48dc-8d7d-d8a9fe861c65",
    "documentTitle": "Procedimento Operacional — Contestação de Contas Móvel",
    "heading": "55. Checklist do operador",
    "excerpt": "Antes de finalizar:\n\n- [ ] Ouvi a contestação completa?\n- [ ] Validei o titular?\n- [ ] Confirmei a conta questionada?\n- [ ] Identifiquei lançamento, valor e período?\n- [ ] Verifiquei se a conta foi paga?\n- [ ] Comparei contas anteriores?\n- [ ] Consultei alterações e contratações?\n- [ ] Expliquei a composição?\n- [ ] Identifiquei possível fraude?\n- [ ] Cancelei eventual recorrência indevida?\n- [ ] Solicitei autorização para bloqueios?\n- [ ] Apliquei ajuste dentro da alçada?\n- [ ] Abri análise quando necessário?\n- [ ] Informei o valor não contestado?\n- [ ] Emissão de conta ajustada foi avaliada?\n- [ ] Informei prazo e canal de retorno?\n- [ ] Registrei todos os fatos?\n- [ ] Forneci protocolo?\n- [ ] Recapitulei as ações?\n- [ ] Confirmei se restaram dúvidas?",
    "chunkIndex": 71
  }
]
/** Score do ranking lexical real (0 = trecho acrescentado pela cobertura). */
export const V171L_RANKED_SCORES = [
  {
    "documentId": "b8da52ca-e65c-419c-bace-83431f04ba2c",
    "documentTitle": "Procedimento Operacional Jeito Vivo de Atender",
    "heading": "Modelo completo",
    "chunkIndex": 65,
    "score": 28.993
  },
  {
    "documentId": "c8f2c818-72db-48dc-8d7d-d8a9fe861c65",
    "documentTitle": "Procedimento Operacional — Contestação de Contas Móvel",
    "heading": "5. Apresentação do operador",
    "chunkIndex": 16,
    "score": 28.507
  },
  {
    "documentId": "c8f2c818-72db-48dc-8d7d-d8a9fe861c65",
    "documentTitle": "Procedimento Operacional — Contestação de Contas Móvel",
    "heading": "51. Frases que devem ser evitadas",
    "chunkIndex": 67,
    "score": 27.506
  },
  {
    "documentId": "b8da52ca-e65c-419c-bace-83431f04ba2c",
    "documentTitle": "Procedimento Operacional Jeito Vivo de Atender",
    "heading": "Exemplo",
    "chunkIndex": 47,
    "score": 27.153
  },
  {
    "documentId": "c8f2c818-72db-48dc-8d7d-d8a9fe861c65",
    "documentTitle": "Procedimento Operacional — Contestação de Contas Móvel",
    "heading": "50. Frases recomendadas",
    "chunkIndex": 66,
    "score": 26.855
  },
  {
    "documentId": "b8da52ca-e65c-419c-bace-83431f04ba2c",
    "documentTitle": "Procedimento Operacional Jeito Vivo de Atender",
    "heading": "Perguntas recomendadas",
    "chunkIndex": 63,
    "score": 26.679
  },
  {
    "documentId": "b8da52ca-e65c-419c-bace-83431f04ba2c",
    "documentTitle": "Procedimento Operacional Jeito Vivo de Atender",
    "heading": "Modelo recomendado",
    "chunkIndex": 9,
    "score": 26.666
  },
  {
    "documentId": "c8f2c818-72db-48dc-8d7d-d8a9fe861c65",
    "documentTitle": "Procedimento Operacional — Contestação de Contas Móvel",
    "heading": "6. Escuta e identificação da solicitação",
    "chunkIndex": 17,
    "score": 25.998
  },
  {
    "documentId": "b8da52ca-e65c-419c-bace-83431f04ba2c",
    "documentTitle": "Procedimento Operacional Jeito Vivo de Atender",
    "heading": "20 Recapitulação",
    "chunkIndex": 60,
    "score": 0
  },
  {
    "documentId": "b8da52ca-e65c-419c-bace-83431f04ba2c",
    "documentTitle": "Procedimento Operacional Jeito Vivo de Atender",
    "heading": "21 Confirmação da resolução",
    "chunkIndex": 62,
    "score": 0
  },
  {
    "documentId": "b8da52ca-e65c-419c-bace-83431f04ba2c",
    "documentTitle": "Procedimento Operacional Jeito Vivo de Atender",
    "heading": "22 Encerramento da chamada",
    "chunkIndex": 64,
    "score": 0
  },
  {
    "documentId": "b8da52ca-e65c-419c-bace-83431f04ba2c",
    "documentTitle": "Procedimento Operacional Jeito Vivo de Atender",
    "heading": "28 Checklist rápido do operador",
    "chunkIndex": 73,
    "score": 0
  },
  {
    "documentId": "00000000-0000-4000-8000-000000000051",
    "documentTitle": "Checklist de Encerramento de Chamada",
    "heading": "",
    "chunkIndex": 0,
    "score": 0
  },
  {
    "documentId": "c8f2c818-72db-48dc-8d7d-d8a9fe861c65",
    "documentTitle": "Procedimento Operacional — Contestação de Contas Móvel",
    "heading": "55. Checklist do operador",
    "chunkIndex": 71,
    "score": 0
  }
]

/** Avaliação de processo REAL do especialista (contrato V2: COMPLETE, 0 itens fora). */
export const V171L_ASSESSMENT = {
  "processes": [
    {
      "product": null,
      "checkpoints": [
        {
          "status": "FOLLOWED",
          "guidance": {
            "text": "Validar os dados do titular antes de acessar o cadastro e tratar a contestação.",
            "source": "OFFICIAL_PROCEDURE"
          },
          "requirement": "Validei o titular?",
          "uncertainty": null,
          "evidenceType": "OBSERVED",
          "knowledgeQuote": "Validei o titular?",
          "transcriptEvidence": [
            "Operador: Vamos ver isso juntos, Márcio. Pra eu entrar no seu cadastro, me confirma os três últimos dígitos do CPF?",
            "Operador: E a sua data de nascimento?",
            "Operador: Obrigada. O seu telefone para contato ainda é o mesmo, com final 4410?"
          ],
          "knowledgeDetailQuote": null
        },
        {
          "status": "FOLLOWED",
          "guidance": {
            "text": "Identificar na fatura o serviço questionado, o valor cobrado e os meses em que ocorreu o lançamento.",
            "source": "OFFICIAL_PROCEDURE"
          },
          "requirement": "Identifiquei lançamento, valor e período?",
          "uncertainty": null,
          "evidenceType": "OBSERVED",
          "knowledgeQuote": "Identifiquei lançamento, valor e período?",
          "transcriptEvidence": [
            "Operador: Achei aqui: é um clube de jogos, o Games Max, de R$ 14,90 por mês. Ele foi ativado por um link no dia 5 de agosto e já veio nas faturas de agosto e de setembro."
          ],
          "knowledgeDetailQuote": null
        },
        {
          "status": "FOLLOWED",
          "guidance": {
            "text": "Questionar o cliente para confirmar se as faturas contestadas já foram pagas.",
            "source": "OFFICIAL_PROCEDURE"
          },
          "requirement": "Verifiquei se a conta foi paga?",
          "uncertainty": null,
          "evidenceType": "OBSERVED",
          "knowledgeQuote": "Verifiquei se a conta foi paga?",
          "transcriptEvidence": [
            "Operador: Entendi. Você já pagou alguma dessas faturas?"
          ],
          "knowledgeDetailQuote": "Se a conta já foi paga;"
        },
        {
          "status": "FOLLOWED",
          "guidance": {
            "text": "Desativar a cobrança recorrente para impedir novos lançamentos futuros.",
            "source": "OFFICIAL_PROCEDURE"
          },
          "requirement": "Cancelei eventual recorrência indevida?",
          "uncertainty": null,
          "evidenceType": "OBSERVED",
          "knowledgeQuote": "Cancelei eventual recorrência indevida?",
          "transcriptEvidence": [
            "Operador: Não vai, já desativei a renovação automática dele, então a partir de agora não cobra mais."
          ],
          "knowledgeDetailQuote": "A renovação do serviço foi cancelada."
        },
        {
          "status": "FOLLOWED",
          "guidance": {
            "text": "Registrar a contestação e encaminhar as cobranças para análise da equipe responsável.",
            "source": "OFFICIAL_PROCEDURE"
          },
          "requirement": "Abri análise quando necessário?",
          "uncertainty": null,
          "evidenceType": "OBSERVED",
          "knowledgeQuote": "Abri análise quando necessário?",
          "transcriptEvidence": [
            "Operador: Tudo bem. Vou deixar registrada a contestação das duas cobranças do Games Max, e o time de faturamento vai analisar."
          ],
          "knowledgeDetailQuote": "Essa cobrança será encaminhada para análise."
        },
        {
          "status": "NOT_FOLLOWED",
          "guidance": {
            "text": "Informar o prazo determinado para a conclusão da análise e o canal pelo qual o cliente receberá o retorno.",
            "source": "OFFICIAL_PROCEDURE"
          },
          "requirement": "Informei prazo e canal de retorno?",
          "uncertainty": null,
          "evidenceType": "OBSERVED",
          "knowledgeQuote": "Informei prazo e canal de retorno?",
          "transcriptEvidence": [
            "Operador: Agora é aguardar a análise, eles verificam e depois te dão uma posição.",
            "Operador: Isso eu não consigo te passar agora, cada caso é um caso."
          ],
          "knowledgeDetailQuote": "O prazo de análise é de..."
        },
        {
          "status": "NOT_FOLLOWED",
          "guidance": {
            "text": "Evitar dizer ao cliente apenas para aguardar ou que não sabe o prazo de resolução.",
            "source": "OFFICIAL_PROCEDURE"
          },
          "requirement": "Frases que devem ser evitadas: É só aguardar. / Não sei quando resolve.",
          "uncertainty": null,
          "evidenceType": "OBSERVED",
          "knowledgeQuote": "É só aguardar.",
          "transcriptEvidence": [
            "Operador: Agora é aguardar a análise, eles verificam e depois te dão uma posição.",
            "Operador: Isso eu não consigo te passar agora, cada caso é um caso."
          ],
          "knowledgeDetailQuote": "Não sei quando resolve."
        },
        {
          "status": "FOLLOWED",
          "guidance": {
            "text": "Fornecer o número do protocolo de atendimento antes do encerramento.",
            "source": "OFFICIAL_PROCEDURE"
          },
          "requirement": "Forneci protocolo?",
          "uncertainty": null,
          "evidenceType": "OBSERVED",
          "knowledgeQuote": "Forneci protocolo?",
          "transcriptEvidence": [
            "Operador: Então, Márcio, só pra fechar: registrei a contestação das duas cobranças de R$ 14,90 do Games Max, a renovação já está desativada, e o seu protocolo é 2026 0925 9182."
          ],
          "knowledgeDetailQuote": "Seu protocolo é..."
        },
        {
          "status": "FOLLOWED",
          "guidance": {
            "text": "Resumir as etapas e ações efetuadas durante o atendimento.",
            "source": "OFFICIAL_PROCEDURE"
          },
          "requirement": "Recapitulei as ações?",
          "uncertainty": null,
          "evidenceType": "OBSERVED",
          "knowledgeQuote": "Recapitulei as ações?",
          "transcriptEvidence": [
            "Operador: Então, Márcio, só pra fechar: registrei a contestação das duas cobranças de R$ 14,90 do Games Max, a renovação já está desativada, e o seu protocolo é 2026 0925 9182."
          ],
          "knowledgeDetailQuote": "Vamos recapitular o que foi realizado."
        },
        {
          "status": "FOLLOWED",
          "guidance": {
            "text": "Perguntar se o cliente tem dúvidas pendentes sobre o procedimento adotado.",
            "source": "OFFICIAL_PROCEDURE"
          },
          "requirement": "Confirmei se restaram dúvidas?",
          "uncertainty": null,
          "evidenceType": "OBSERVED",
          "knowledgeQuote": "Confirmei se restaram dúvidas?",
          "transcriptEvidence": [
            "Operador: Ficou alguma dúvida sobre o que a gente fez hoje?"
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
            "text": "Confirmar a solução aplicada ao cliente antes de finalizar a chamada.",
            "source": "OFFICIAL_SERVICE_GUIDELINE"
          },
          "requirement": "confirme a solução aplicada",
          "uncertainty": null,
          "evidenceType": "OBSERVED",
          "knowledgeQuote": "(1) confirme a solução aplicada;",
          "transcriptEvidence": [
            "Operador: Então, Márcio, só pra fechar: registrei a contestação das duas cobranças de R$ 14,90 do Games Max, a renovação já está desativada, e o seu protocolo é 2026 0925 9182."
          ],
          "knowledgeDetailQuote": null
        },
        {
          "status": "FOLLOWED",
          "guidance": {
            "text": "Informar o número do protocolo de atendimento ao cliente.",
            "source": "OFFICIAL_SERVICE_GUIDELINE"
          },
          "requirement": "informe o número do protocolo",
          "uncertainty": null,
          "evidenceType": "OBSERVED",
          "knowledgeQuote": "(2) informe o número do protocolo;",
          "transcriptEvidence": [
            "Operador: Então, Márcio, só pra fechar: registrei a contestação das duas cobranças de R$ 14,90 do Games Max, a renovação já está desativada, e o seu protocolo é 2026 0925 9182."
          ],
          "knowledgeDetailQuote": null
        },
        {
          "status": "NOT_FOLLOWED",
          "guidance": {
            "text": "Explicar claramente o próximo passo da solicitação e informar o prazo previsto.",
            "source": "OFFICIAL_SERVICE_GUIDELINE"
          },
          "requirement": "explique o próximo passo e o prazo",
          "uncertainty": null,
          "evidenceType": "OBSERVED",
          "knowledgeQuote": "(3) explique o próximo passo e o prazo;",
          "transcriptEvidence": [
            "Operador: Agora é aguardar a análise, eles verificam e depois te dão uma posição.",
            "Operador: Isso eu não consigo te passar agora, cada caso é um caso."
          ],
          "knowledgeDetailQuote": null
        },
        {
          "status": "FOLLOWED",
          "guidance": {
            "text": "Perguntar se o cliente possui dúvidas adicionais antes de encerrar.",
            "source": "OFFICIAL_SERVICE_GUIDELINE"
          },
          "requirement": "confirme se o cliente tem mais alguma dúvida",
          "uncertainty": null,
          "evidenceType": "OBSERVED",
          "knowledgeQuote": "(4) confirme se o cliente tem mais alguma dúvida.",
          "transcriptEvidence": [
            "Operador: Ficou alguma dúvida sobre o que a gente fez hoje?"
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
        "presentedSteps": 47
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

/** Resposta REAL do redator, na ordem dos itens daquela execução (ITEM_1…ITEM_14). */
export const V171L_WRITER_RAW = {
  "items": [
    {
      "slot": "ITEM_1",
      "observed": "Você informou que o cliente deveria aguardar a análise e declarou que não conseguiria fornecer informações adicionais naquele momento.",
      "whatYouCanDo": "Ao finalizar a solicitação de contestação, informe o prazo específico de análise e por qual canal o cliente receberá o retorno.",
      "whyItMatters": "Informar o prazo e o canal de retorno contribui para o cliente saber o que esperar após o contato.",
      "suggestedResponse": "O prazo para a análise dessa contestação é de 5 dias úteis. Você receberá o resultado da verificação por SMS no número que temos cadastrado."
    },
    {
      "slot": "ITEM_2",
      "observed": "Ao tratar da contestação, você orientou o cliente a aguardar, mas não apresentou o próximo passo nem o prazo de resolução.",
      "whatYouCanDo": "Antes de encerrar o atendimento, explique claramente qual é o próximo passo da solicitação e informe o prazo previsto para conclusão.",
      "whyItMatters": "",
      "suggestedResponse": "A partir de agora, o próximo passo é o envio para o nosso time de faturamento analisar a cobrança. O prazo para essa análise é de 5 dias úteis."
    },
    {
      "slot": "ITEM_3",
      "observed": "Você respondeu ao cliente dizendo que ele deveria apenas aguardar e declarou que não tinha como passar informações sobre o processo.",
      "whatYouCanDo": "Evite utilizar frases que indiquem ao cliente apenas aguardar ou que não há conhecimento sobre quando o problema será resolvido.",
      "whyItMatters": "",
      "suggestedResponse": ""
    },
    {
      "slot": "ITEM_4",
      "observed": "Você declarou que desativou a renovação automática do serviço questionado para evitar cobranças futuras.",
      "whatYouCanDo": "Continue mantendo a prática de cancelar a recorrência dos serviços indevidos para evitar novos lançamentos.",
      "whyItMatters": "O cancelamento da recorrência indevida impede que novos lançamentos ocorram na conta do cliente.",
      "suggestedResponse": ""
    },
    {
      "slot": "ITEM_5",
      "observed": "Você forneceu o número do protocolo ao final do atendimento, integrando-o ao resumo do que foi realizado.",
      "whatYouCanDo": "Mantenha o hábito de fornecer o número do protocolo antes de encerrar o contato.",
      "whyItMatters": "Fornecer o número de protocolo permite que o cliente identifique e registre o atendimento realizado.",
      "suggestedResponse": ""
    },
    {
      "slot": "ITEM_6",
      "observed": "Ao final da chamada, você perguntou ao cliente se ele tinha alguma dúvida sobre as ações realizadas.",
      "whatYouCanDo": "Continue perguntando ao cliente se ele possui dúvidas adicionais antes de encerrar a chamada para garantir que tudo foi compreendido.",
      "whyItMatters": "",
      "suggestedResponse": ""
    },
    {
      "slot": "ITEM_7",
      "observed": "Você resumiu as ações realizadas e confirmou a contestação e o cancelamento da renovação para o cliente.",
      "whatYouCanDo": "Continue confirmando com o cliente a solução aplicada antes de encerrar o atendimento.",
      "whyItMatters": "",
      "suggestedResponse": ""
    },
    {
      "slot": "ITEM_8",
      "observed": "Você informou o número do protocolo como parte do fechamento do atendimento.",
      "whatYouCanDo": "Continue fornecendo o protocolo ao cliente antes de finalizar a ligação.",
      "whyItMatters": "",
      "suggestedResponse": ""
    },
    {
      "slot": "ITEM_9",
      "observed": "Você verificou com o cliente se havia alguma dúvida pendente antes de concluir o contato.",
      "whatYouCanDo": "Siga confirmando se o cliente tem mais alguma dúvida para assegurar que não restaram pendências.",
      "whyItMatters": "",
      "suggestedResponse": ""
    },
    {
      "slot": "ITEM_10",
      "observed": "Você validou a identidade do titular confirmando o CPF, a data de nascimento e o telefone de contato.",
      "whatYouCanDo": "Continue realizando a validação completa dos dados do titular antes de acessar informações cadastrais.",
      "whyItMatters": "",
      "suggestedResponse": ""
    },
    {
      "slot": "ITEM_11",
      "observed": "Você identificou e informou ao cliente o nome do serviço, o valor mensal e os meses em que as cobranças foram lançadas.",
      "whatYouCanDo": "Continue informando detalhadamente o lançamento, o valor e o período identificado na fatura.",
      "whyItMatters": "",
      "suggestedResponse": ""
    },
    {
      "slot": "ITEM_12",
      "observed": "Você perguntou ao cliente se as faturas contestadas já haviam sido pagas.",
      "whatYouCanDo": "Mantenha o questionamento sobre o pagamento das faturas para direcionar corretamente a análise da contestação.",
      "whyItMatters": "",
      "suggestedResponse": ""
    },
    {
      "slot": "ITEM_13",
      "observed": "Você declarou que registrou a contestação e que o time de faturamento faria a análise.",
      "whatYouCanDo": "Continue registrando a contestação e informando que o caso será encaminhado para a área de análise.",
      "whyItMatters": "",
      "suggestedResponse": ""
    },
    {
      "slot": "ITEM_14",
      "observed": "Você recapitulou as ações tomadas, citando a contestação, o cancelamento da renovação e o número do protocolo.",
      "whatYouCanDo": "Continue recapitulando as ações realizadas ao final para alinhar o atendimento com o cliente.",
      "whyItMatters": "",
      "suggestedResponse": ""
    }
  ],
  "presentation": {
    "closing": "Você conduziu bem a validação e o registro da contestação. Ajuste a explicação do próximo passo e prazo para trazer mais clareza ao cliente e evite frases vagas sobre a análise.",
    "introduction": "Analisei seu atendimento de 25/09/2026 sobre contestação de cobrança. Verifiquei que você realizou corretamente a validação do titular, a identificação dos lançamentos, a confirmação de pagamento e a recapitulação das ações. Identifiquei oportunidade de melhoria no checklist do operador e na explicação do próximo passo e prazo, além de frases a evitar. Vou detalhar esses pontos e como conduzi-los melhor na próxima vez."
  }
}
