# Rodada V10 (02/10/2026) — gabarito do CASO SINTÉTICO de paráfrases

**Registrado ANTES da chamada paga**, depois de congelar o contrato `OBLIGATIONS_V1` (`CALL_ANALYSIS_PROMPT_V8`). **Quem escreveu:**
Claude (modelo de IA, na mesma sessão que escreveu o contrato) — não é validação humana independente. **Nunca entra no motor.**
O caso é SINTÉTICO (outro serviço, outras palavras): mede se a leitura generaliza para paráfrases que não foram usadas para escrever
o contrato; não substitui as chamadas reais.

Fonte: `synthetic-paraphrase-case.ts` (procedimento "Reagendamento de visita técnica", 16 falas).

| # | Obrigação (seções) | Situação semântica testada | Esperado | Inaceitável |
|---|---|---|---|---|
| S1 | §2 confirmar se é a visita de instalação ou a de reparo | confirmação por pergunta fechada que já define a escolha (T3 "é a visita do reparo… né?") | MET | NOT_MET/PARTIAL por não citar as duas opções |
| S2 | §3 "Quando a agenda da região permitir, oferecer horário no período da manhã" | condição que a conversa não permite conhecer | NOT_VERIFIABLE ou NOT_APPLICABLE com motivo | NOT_MET |
| S3 | §3 registrar o novo horário no sistema de campo | execução interna declarada (T11 "já deixei… gravado aqui") | NOT_VERIFIABLE, fala como declaração | MET |
| S4 | §4 enviar a confirmação SOMENTE para o celular cadastrado e verificado | confirmação de recebimento (T13 "Recebi aqui") ≠ destino cadastrado/verificado | NOT_VERIFIABLE (ou MET só do envio, com o requisito do destino não verificável) | MET pleno do requisito "cadastrado e verificado" |
| S5 | §5 "Abrir chamado de engenharia quando: o cliente relatar a mesma falha pela terceira vez no mês" | condição presente (T4) ≠ conduta; a ação é interna | obrigação = abrir chamado; condição YES; NOT_VERIFIABLE (nada dito) | MET pela fala do cliente; o item da condição tratado como conduta |
| S6 | §6 oferecer UMA das opções (desconto OU velocidade dobrada) | alternativas | MET (desconto oferecido em T7) | PARTIAL/NOT_MET por não oferecer as duas |
| S7 | §7 consultar o histórico de visitas do endereço | consulta interna declarada (T5 "Olhei aqui no histórico…") | NOT_VERIFIABLE | MET |
| S8 | §8 "Antes de encerrar, informar: número da ordem de serviço; janela de horário" | lista cumulativa; mencionar a OS (T14) ≠ informar o número | PARTIAL (janela informada; número não) | MET; ALL lido como ANY |
| S9 | §9 perguntar se há mais alguma dúvida antes de encerrar | ausência verdadeira ainda detectável (T16 encerra sem perguntar) | NOT_MET com oportunidade em T15/T16 | NOT_VERIFIABLE/MET |

Pontos fora da tabela são avaliados caso a caso (ex.: obrigação extra sem fonte = inaceitável; materialidade é leitura).
