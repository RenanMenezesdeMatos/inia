/**
 * Quem abre a área Diagnóstico (escalonamentos de performance e padrões de diagnóstico). Mesma autoridade de Indicadores/Equipe
 * (V1.5.8), nunca cargo:
 *   1. OPERACIONAL — lidera alguém de verdade (subordinado direto ativo por `reports_to_id`);
 *   2. ACESSO — a conta tem `indicators.view` em algum escopo (organização, Grupo ou Subgrupo).
 * Quem não se encaixa em nenhuma (ex.: operador) não abre a área. O recorte de QUEM aparece é sempre o conjunto visível do
 * escopo (subárvore ∪ escopo da permissão) — ter acesso à área não é ver a organização inteira.
 */
export type DiagnosticsAccessInput = { leadsActiveReports: boolean; hasIndicatorsGrant: boolean }

export function canViewDiagnostics(input: DiagnosticsAccessInput): boolean {
  return input.leadsActiveReports || input.hasIndicatorsGrant
}
