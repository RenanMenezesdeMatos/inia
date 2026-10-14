/** Onde uma intervenção é aberta: SEMPRE dentro do caso de supervisão dela (sino, Pendências, Acompanhamento e ficha usam este link). */
export function interventionHref(caseId: string, interventionId: string): string {
  return `/supervisor/cases/${encodeURIComponent(caseId)}?intervention=${encodeURIComponent(interventionId)}`
}
