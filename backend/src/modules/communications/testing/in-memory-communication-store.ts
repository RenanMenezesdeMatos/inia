import type { CommunicationRights, CommunicationStore, NewCommunication } from "../application/communication-service.js"
import { communicationExcerpt, type CommunicationAudience, type CommunicationTag, type CommunicationView, type ReceivedCommunicationSummary } from "../domain/communication.js"

/** Armazenamento em memória para os testes de rota: estrutura por `reportsTo`, direitos por conta. */
export class InMemoryCommunicationStore implements CommunicationStore {
  readonly saved: (NewCommunication & { id: string; recipients: string[] | "ORGANIZATION"; publishedAt: string; editedAt: string | null; deletedAt: string | null; deletedByPersonId: string | null })[] = []
  readonly revisions: { communicationId: string; title: string; contentHtml: string; replacedBy: string }[] = []
  constructor(
    private readonly people: { id: string; name: string; organizationId: string; reportsTo: string | null; active?: boolean }[],
    private readonly rights: Record<string, CommunicationRights> = {},
  ) {}

  async loadRights(_organizationId: string, accountId: string) {
    return this.rights[accountId] ?? { team: false, organization: false }
  }

  private below(organizationId: string, personId: string): string[] {
    const result: string[] = []
    const stack = [personId]
    while (stack.length > 0) {
      const current = stack.pop()!
      for (const person of this.people) {
        if (person.organizationId === organizationId && person.reportsTo === current && !result.includes(person.id)) {
          result.push(person.id)
          stack.push(person.id)
        }
      }
    }
    return result.filter((id) => this.people.find((person) => person.id === id)?.active !== false)
  }

  async insert(input: NewCommunication) {
    const recipients = input.audience === "TEAM" ? this.below(input.organizationId, input.authorPersonId) : "ORGANIZATION" as const
    const recipientCount = recipients === "ORGANIZATION" ? this.people.filter((person) => person.organizationId === input.organizationId && person.id !== input.authorPersonId && person.active !== false).length : recipients.length
    if (recipientCount === 0) return null
    const id = `00000000-0000-4000-8000-${String(this.saved.length + 1).padStart(12, "0")}`
    const publishedAt = new Date(Date.UTC(2026, 10, 16, 12, 0, this.saved.length)).toISOString()
    this.saved.push({ ...input, id, recipients, publishedAt, editedAt: null, deletedAt: null, deletedByPersonId: null })
    return { id, recipientCount, publishedAt }
  }

  async listReceived(organizationId: string, personId: string, limit: number): Promise<ReceivedCommunicationSummary[]> {
    return this.saved
      .filter((item) => item.organizationId === organizationId && item.deletedAt === null && item.authorPersonId !== personId && (item.recipients === "ORGANIZATION" || item.recipients.includes(personId)))
      .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
      .slice(0, limit)
      .map((item) => {
        const { contentHtml, plainText, ...view } = this.view(item, personId)
        const hasImages = contentHtml.includes("<img ")
        return { ...view, excerpt: communicationExcerpt(plainText, hasImages), hasImages }
      })
  }

  /** A mesma regra de `communicationVisibleToSql`: autor, destinatário gravado ou público da organização; retirado nunca. */
  async findVisible(organizationId: string, viewerPersonId: string, id: string): Promise<CommunicationView | null> {
    const item = this.saved.find((candidate) => candidate.id === id && candidate.organizationId === organizationId && candidate.deletedAt === null)
    if (!item) return null
    const visible = item.authorPersonId === viewerPersonId || item.recipients === "ORGANIZATION" || item.recipients.includes(viewerPersonId)
    return visible ? this.view(item, viewerPersonId) : null
  }

  private view(item: InMemoryCommunicationStore["saved"][number], viewerPersonId: string): CommunicationView {
    const authoredByViewer = item.authorPersonId === viewerPersonId
    const recipientCount = item.recipients === "ORGANIZATION" ? this.people.filter((person) => person.organizationId === item.organizationId && person.id !== item.authorPersonId && person.active !== false).length : item.recipients.length
    return {
      id: item.id,
      title: item.title,
      contentHtml: item.contentHtml,
      plainText: item.plainText,
      tags: item.tags,
      audience: item.audience,
      author: { personId: item.authorPersonId, name: this.people.find((person) => person.id === item.authorPersonId)?.name ?? "" },
      recipientCount: authoredByViewer ? recipientCount : null,
      authoredByViewer,
      publishedAt: item.publishedAt,
      editedAt: item.editedAt,
    }
  }

  private own(organizationId: string, authorPersonId: string, id: string) {
    return this.saved.find((item) => item.id === id && item.organizationId === organizationId && item.authorPersonId === authorPersonId && item.deletedAt === null)
  }

  async findOwnAudience(organizationId: string, authorPersonId: string, id: string): Promise<CommunicationAudience | null> {
    return this.own(organizationId, authorPersonId, id)?.audience ?? null
  }

  async edit(input: { organizationId: string; authorPersonId: string; id: string; title: string; contentHtml: string; plainText: string; tags: CommunicationTag[] }): Promise<CommunicationView | null> {
    const item = this.own(input.organizationId, input.authorPersonId, input.id)
    if (!item) return null
    this.revisions.push({ communicationId: item.id, title: item.title, contentHtml: item.contentHtml, replacedBy: input.authorPersonId })
    Object.assign(item, { title: input.title, contentHtml: input.contentHtml, plainText: input.plainText, tags: input.tags, editedAt: "2026-11-16T13:00:00.000Z" })
    return { id: item.id, title: item.title, contentHtml: item.contentHtml, plainText: item.plainText, tags: item.tags, audience: item.audience, author: { personId: item.authorPersonId, name: "" }, recipientCount: 0, authoredByViewer: true, publishedAt: item.publishedAt, editedAt: item.editedAt }
  }

  async retire(input: { organizationId: string; authorPersonId: string; id: string }): Promise<boolean> {
    const item = this.own(input.organizationId, input.authorPersonId, input.id)
    if (!item) return false
    Object.assign(item, { deletedAt: "2026-11-16T14:00:00.000Z", deletedByPersonId: input.authorPersonId })
    return true
  }
}
