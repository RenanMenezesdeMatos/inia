/**
 * UM CONVITE SÓ — definição ÚNICA de "recado de voz coberto pelo Acompanhamento". O recado de voz (`workflow_outputs`,
 * superfície AVATAR) cujo Output — ou cujo artefato confiável — também virou feedback PUBLICADO no Acompanhamento não convida
 * por conta própria: quem convida é a aplicação de feedback (feedback-application), e o recado continua registrado (pode ser
 * ouvido pelo id), sem aparecer como convite.
 *
 * A MESMA expressão decide as três leituras, nunca duas consultas divergentes:
 *  - o inbox do destinatário (`loadRecipientInbox`) não lista o recado coberto;
 *  - a entrega (`offerAvatarDelivery`) não cria o aviso "Tenho um recado" quando o recado já nasce coberto;
 *  - o sino (notificações) não lista nem conta o aviso de um recado que ficou coberto depois (superfícies em outra ordem no
 *    Output, outro nó publicando o mesmo artefato, avisos criados antes desta regra).
 */
export const AVATAR_ALERT_KEY_PREFIX = "workflow_avatar:"

/** Expressão booleana sobre a linha de entrega `output` (alias de `workflow_outputs`). */
export function recadoCoveredByFollowUpSql(output: string): string {
  return `(exists (select 1 from workflow_output_emissions rfu_e join feedbacks rfu_f on rfu_f.id = rfu_e.feedback_id
             where rfu_e.enrollment_id = ${output}.enrollment_id and rfu_e.node_id = ${output}.node_id and rfu_e.recipient_id = ${output}.recipient_id and rfu_f.status = 'PUBLISHED')
    or (${output}.artifact_id is not null and exists (select 1 from feedbacks rfu_a where rfu_a.organization_id = ${output}.organization_id and rfu_a.operator_id = ${output}.recipient_id
             and rfu_a.status = 'PUBLISHED' and rfu_a.context_snapshot->'reliableFeedback'->>'artifactId' = ${output}.artifact_id::text)))`
}

/** Expressão booleana sobre o aviso `alert` (alias de `alerts`): é o aviso de um recado de voz coberto pelo Acompanhamento. */
export function recadoAlertCoveredByFollowUpSql(alert: string): string {
  // O id da entrega vem da chave gravada na criação do aviso (`workflow_avatar:<outputId>`); chave fora do formato nunca casa
  // (o CASE impede o cast de um texto que não é uuid).
  const outputId = `(case when ${alert}.dedupe_key ~ '^${AVATAR_ALERT_KEY_PREFIX}[0-9a-f-]{36}$' then substr(${alert}.dedupe_key, ${AVATAR_ALERT_KEY_PREFIX.length + 1})::uuid end)`
  return `(${alert}.alert_type = 'WORKFLOW_AVATAR_MESSAGE' and exists (select 1 from workflow_outputs rfu_o where rfu_o.id = ${outputId} and rfu_o.surface = 'AVATAR' and ${recadoCoveredByFollowUpSql("rfu_o")}))`
}
