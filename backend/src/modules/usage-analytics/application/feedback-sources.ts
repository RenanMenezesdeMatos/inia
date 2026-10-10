/**
 * Ponto ÚNICO em que a Monitoria de usabilidade lê as entregas de feedback de atendimento (somente leitura, pelo leitor
 * analítico do próprio módulo `interaction-feedback`) — a fronteira do pipeline continua fechada: nada aqui grava, entrega ou
 * chama o redator.
 */
export { deliveredInteractionFeedbackSourcesSql, recipientsOfDeliveries } from "../../interaction-feedback/application/usage-analytics-reader.js"
