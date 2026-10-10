export const pendingActionKeys = {
  list: () => ["pending-actions", "list"] as const,
  review: (enrollmentId: string, nodeId: string) => ["pending-actions", "review", enrollmentId, nodeId] as const,
  workday: (reconciliationId: string) => ["pending-actions", "workday", reconciliationId] as const,
}
