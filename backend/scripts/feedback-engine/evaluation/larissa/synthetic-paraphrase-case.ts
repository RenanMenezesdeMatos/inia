/**
 * CASO SINTÉTICO DE PARÁFRASES (rodada V10, 02/10/2026) — escrito ANTES de qualquer chamada paga e DEPOIS de congelar o contrato
 * `OBLIGATIONS_V1`; nunca usado para ajustar o contrato. Outro serviço (reagendamento de visita técnica), outras palavras, as MESMAS
 * situações semânticas das falhas demonstradas nas chamadas reais da Larissa. É SINTÉTICO: não é chamada real, não substitui a
 * avaliação das chamadas reais. Gabarito em `round-v10-synthetic-ground-truth.md` (fora do motor).
 */
export const SYNTHETIC_DOCUMENT_ID = "00000000-0000-4000-8000-0000000051a1"
export const SYNTHETIC_PROCEDURE = `# Procedimento — Reagendamento de visita técnica

**Versão:** 1.0

## 1. Objetivo

Orientar o reagendamento de visitas técnicas de internet residencial.

## 2. Identificação da visita

Antes de alterar qualquer agendamento, confirmar com o cliente se ele quer reagendar a visita de instalação ou a de reparo.

## 3. Novo horário

- Quando a agenda da região permitir, oferecer horário no período da manhã.
- Registrar o novo horário no sistema de campo.

## 4. Confirmação do agendamento

Enviar a confirmação do novo horário somente para o celular cadastrado e verificado.

## 5. Ocorrência recorrente

Abrir chamado de engenharia quando:
- O cliente relatar a mesma falha pela terceira vez no mês.

## 6. Compensação por visita perdida

Para compensar uma visita que não aconteceu, oferecer uma das opções:
- Desconto de 10% na próxima fatura;
- Um mês de velocidade dobrada.

## 7. Consulta

Consultar o histórico de visitas do endereço antes de propor o novo horário.

## 8. Informações finais

Antes de encerrar, informar:
- O número da ordem de serviço;
- A janela de horário da visita.

## 9. Encerramento

Perguntar se o cliente tem mais alguma dúvida antes de encerrar.
`

export const SYNTHETIC_TRANSCRIPT = [
  "Operador: Central de atendimento, aqui é o Bruno. Em que posso ajudar?",
  "Cliente: Oi, Bruno. O técnico não veio ontem e eu preciso remarcar.",
  "Operador: Poxa, sinto muito. Só para eu ter certeza: é a visita do reparo da sexta-feira que o senhor quer mudar, né?",
  "Cliente: Isso, a do reparo. Já é a terceira vez esse mês que a internet cai.",
  "Operador: Entendi. Olhei aqui no histórico e vi que a última visita foi cancelada pela equipe de campo.",
  "Cliente: Pois é, ninguém me avisou.",
  "Operador: Como a visita anterior não aconteceu, posso aplicar um desconto de 10% na sua próxima fatura.",
  "Cliente: Pode aplicar, sim.",
  "Operador: Tenho disponível quinta-feira à tarde. Pode ser?",
  "Cliente: Pode ser.",
  "Operador: Pronto, já deixei o novo horário gravado aqui.",
  "Operador: Mandei a confirmação por mensagem agora.",
  "Cliente: Recebi aqui, obrigado.",
  "Operador: Sua ordem de serviço já está criada, e o técnico chega entre 14h e 18h.",
  "Cliente: Combinado.",
  "Operador: Então é isso, tenha uma boa tarde.",
].join("\n")

export const SYNTHETIC_SUBJECT = "Reagendamento de visita técnica"
