import type { AudienceOptions, CommunicationRights, CommunicationStore, CommunicationUpdate, NewCommunication, SavedCommunication } from "../application/communication-service.js"
import {
  communicationExcerpt,
  communicationStateOf,
  type CommunicationAudience,
  type CommunicationSegment,
  type CommunicationStatus,
  type CommunicationView,
  type EditorialCommunication,
  type EditorialCommunicationSummary,
  type ReceivedCommunicationSummary,
} from "../domain/communication.js"

type Person = { id: string; name: string; organizationId: string; reportsTo: string | null; active?: boolean; teamId?: string | null; subteamId?: string | null; universe?: string | null; jobTitle?: string | null }

type Saved = Omit<NewCommunication, "publishedAt" | "displayUntil" | "status"> & {
  id: string
  status: CommunicationStatus
  recipients: string[]
  recipientCount: number
  publishedAt: string | null
  displayUntil: string | null
  createdAt: string
  updatedAt: string | null
  editedAt: string | null
  archivedAt: string | null
  deletedAt: string | null
  deletedByPersonId: string | null
}

/**
 * Armazenamento em memória para os testes de rota: estrutura por `reportsTo`, direitos por conta, Grupo/Subgrupo/universo por
 * pessoa. `now` é o relógio da visibilidade (agendado e fim de exibição), ajustável no teste.
 */
export class InMemoryCommunicationStore implements CommunicationStore {
  readonly saved: Saved[] = []
  readonly revisions: { communicationId: string; title: string; contentHtml: string; replacedBy: string }[] = []
  readonly audits: { action: string; id: string }[] = []
  now: () => Date = () => new Date()
  constructor(
    private readonly people: Person[],
    private readonly rights: Record<string, CommunicationRights> = {},
    private readonly catalog: { teams?: { id: string; subteams?: string[] }[]; products?: string[] } = {},
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

  private inSegment(person: Person | undefined, segment: CommunicationSegment): boolean {
    if (!person || person.active === false) return false
    if (segment.universe && person.universe !== segment.universe) return false
    if (segment.teamIds.length === 0 && segment.subteamIds.length === 0) return true
    return (person.teamId != null && segment.teamIds.includes(person.teamId)) || (person.subteamId != null && segment.subteamIds.includes(person.subteamId))
  }

  private audienceOf(input: { organizationId: string; authorPersonId: string; audience: CommunicationAudience; segment: CommunicationSegment }): { count: number; recipients: string[] } {
    if (input.audience === "TEAM") {
      const recipients = this.below(input.organizationId, input.authorPersonId)
      return { count: recipients.length, recipients }
    }
    const others = this.people.filter((person) => person.organizationId === input.organizationId && person.id !== input.authorPersonId && person.active !== false)
    return { count: input.audience === "ORGANIZATION" ? others.length : others.filter((person) => this.inSegment(person, input.segment)).length, recipients: [] }
  }

  async insert(input: NewCommunication): Promise<SavedCommunication | null> {
    const publishing = input.status === "PUBLISHED"
    const audience = publishing ? this.audienceOf(input) : { count: 0, recipients: [] }
    if (publishing && audience.count === 0) return null
    const id = `00000000-0000-4000-8000-${String(this.saved.length + 1).padStart(12, "0")}`
    const publishedAt = input.publishedAt ? input.publishedAt.toISOString() : null
    this.saved.push({ ...input, id, recipients: audience.recipients, recipientCount: audience.count, publishedAt, displayUntil: input.displayUntil?.toISOString() ?? null, createdAt: this.now().toISOString(), updatedAt: null, editedAt: null, archivedAt: null, deletedAt: null, deletedByPersonId: null })
    this.audits.push({ action: publishing ? "PUBLISHED" : "DRAFT", id })
    return { id, status: input.status, recipientCount: audience.count, publishedAt }
  }

  async update(input: CommunicationUpdate): Promise<SavedCommunication | "EMPTY_AUDIENCE" | null> {
    const item = this.own(input.organizationId, input.authorPersonId, input.id)
    if (!item || item.status === "ARCHIVED") return null
    const wentOut = item.status === "PUBLISHED" && item.publishedAt !== null && new Date(item.publishedAt).getTime() <= this.now().getTime()
    let recipients = item.recipients
    let recipientCount = item.recipientCount
    if (input.status === "PUBLISHED" && !wentOut) {
      const audience = this.audienceOf(input)
      if (audience.count === 0) return "EMPTY_AUDIENCE"
      recipients = audience.recipients
      recipientCount = audience.count
    } else if (input.status === "DRAFT") {
      recipients = []
      recipientCount = 0
    }
    if (item.status !== "DRAFT") this.revisions.push({ communicationId: item.id, title: item.title, contentHtml: item.contentHtml, replacedBy: input.authorPersonId })
    Object.assign(item, {
      ...input,
      publishedAt: input.publishedAt?.toISOString() ?? null,
      displayUntil: input.displayUntil?.toISOString() ?? null,
      recipients,
      recipientCount,
      updatedAt: this.now().toISOString(),
      editedAt: wentOut ? this.now().toISOString() : item.editedAt,
    })
    this.audits.push({ action: wentOut ? "EDITED" : input.status, id: item.id })
    return { id: item.id, status: input.status, recipientCount, publishedAt: item.publishedAt }
  }

  /** A mesma regra de `communicationVisibleToSql`: no ar (publicado, já chegou a hora, dentro da exibição) e no público. */
  private visibleTo(item: Saved, personId: string): boolean {
    const now = this.now().getTime()
    if (item.deletedAt !== null || item.status !== "PUBLISHED" || !item.publishedAt || new Date(item.publishedAt).getTime() > now) return false
    if (item.displayUntil && new Date(item.displayUntil).getTime() <= now) return false
    if (item.authorPersonId === personId || item.audience === "ORGANIZATION") return true
    if (item.audience === "TEAM") return item.recipients.includes(personId)
    return this.inSegment(this.people.find((person) => person.id === personId && person.organizationId === item.organizationId), item.segment)
  }

  async listReceived(organizationId: string, personId: string, limit: number): Promise<ReceivedCommunicationSummary[]> {
    return this.saved
      .filter((item) => item.organizationId === organizationId && item.authorPersonId !== personId && this.visibleTo(item, personId))
      .sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? "") || b.id.localeCompare(a.id))
      .slice(0, limit)
      .map((item) => {
        const { contentHtml, plainText, ...view } = this.view(item, personId)
        const hasImages = contentHtml.includes("<img ")
        return { ...view, excerpt: communicationExcerpt(plainText, hasImages), hasImages }
      })
  }

  async findVisible(organizationId: string, viewerPersonId: string, id: string): Promise<CommunicationView | null> {
    const item = this.saved.find((candidate) => candidate.id === id && candidate.organizationId === organizationId)
    return item && this.visibleTo(item, viewerPersonId) ? this.view(item, viewerPersonId) : null
  }

  private author(personId: string) {
    const person = this.people.find((candidate) => candidate.id === personId)
    return { personId, name: person?.name ?? "", jobTitle: person?.jobTitle ?? null }
  }

  private view(item: Saved, viewerPersonId: string): CommunicationView {
    const authoredByViewer = item.authorPersonId === viewerPersonId
    return {
      id: item.id,
      title: item.title,
      contentHtml: item.contentHtml,
      plainText: item.plainText,
      tags: item.tags,
      audience: item.audience,
      author: this.author(item.authorPersonId),
      recipientCount: authoredByViewer ? item.recipientCount : null,
      authoredByViewer,
      publishedAt: item.publishedAt ?? "",
      editedAt: item.editedAt,
      summary: item.summary,
      featured: item.featured,
      displayUntil: item.displayUntil,
    }
  }

  private own(organizationId: string, authorPersonId: string, id: string) {
    return this.saved.find((item) => item.id === id && item.organizationId === organizationId && item.authorPersonId === authorPersonId && item.deletedAt === null)
  }

  private editorial(item: Saved): EditorialCommunication {
    return {
      id: item.id,
      status: item.status,
      state: communicationStateOf({ status: item.status, publishedAt: item.publishedAt, displayUntil: item.displayUntil }, this.now()),
      title: item.title,
      contentHtml: item.contentHtml,
      plainText: item.plainText,
      tags: item.tags,
      summary: item.summary,
      featured: item.featured,
      audience: item.audience,
      segment: item.segment,
      productNodeId: item.productNodeId,
      productName: null,
      publishedAt: item.publishedAt,
      displayUntil: item.displayUntil,
      recipientCount: item.recipientCount,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      editedAt: item.editedAt,
      archivedAt: item.archivedAt,
      author: this.author(item.authorPersonId),
    }
  }

  async findOwn(organizationId: string, authorPersonId: string, id: string): Promise<EditorialCommunication | null> {
    const item = this.own(organizationId, authorPersonId, id)
    return item ? this.editorial(item) : null
  }

  async listOwn(organizationId: string, authorPersonId: string, limit: number): Promise<EditorialCommunicationSummary[]> {
    return this.saved
      .filter((item) => item.organizationId === organizationId && item.authorPersonId === authorPersonId && item.deletedAt === null)
      .slice(-limit)
      .reverse()
      .map((item) => {
        const { contentHtml, plainText, ...rest } = this.editorial(item)
        const hasImages = contentHtml.includes("<img ")
        return { ...rest, excerpt: communicationExcerpt(plainText, hasImages), hasImages }
      })
  }

  async setArchived(input: { organizationId: string; authorPersonId: string; id: string; archived: boolean }): Promise<boolean> {
    const item = this.own(input.organizationId, input.authorPersonId, input.id)
    if (!item || item.status !== (input.archived ? "PUBLISHED" : "ARCHIVED")) return false
    Object.assign(item, { status: input.archived ? "ARCHIVED" : "PUBLISHED", archivedAt: input.archived ? this.now().toISOString() : null })
    this.audits.push({ action: input.archived ? "ARCHIVED" : "UNARCHIVED", id: item.id })
    return true
  }

  async retire(input: { organizationId: string; authorPersonId: string; id: string }): Promise<boolean> {
    const item = this.own(input.organizationId, input.authorPersonId, input.id)
    if (!item) return false
    Object.assign(item, { deletedAt: "2026-11-16T14:00:00.000Z", deletedByPersonId: input.authorPersonId })
    return true
  }

  async listForModeration(organizationId: string, limit: number): Promise<EditorialCommunicationSummary[]> {
    return this.saved
      .filter((item) => item.organizationId === organizationId && item.deletedAt === null && item.status !== "DRAFT")
      .slice(-limit)
      .reverse()
      .map((item) => {
        const { contentHtml, plainText, ...rest } = this.editorial(item)
        const hasImages = contentHtml.includes("<img ")
        return { ...rest, excerpt: communicationExcerpt(plainText, hasImages), hasImages }
      })
  }

  async findForModeration(organizationId: string, id: string): Promise<EditorialCommunication | null> {
    const item = this.saved.find((candidate) => candidate.id === id && candidate.organizationId === organizationId && candidate.deletedAt === null && candidate.status !== "DRAFT")
    return item ? this.editorial(item) : null
  }

  async retireAsModerator(input: { organizationId: string; moderatorPersonId: string; moderatorAccountId: string; id: string; reason: string }): Promise<boolean> {
    const item = this.saved.find((candidate) => candidate.id === input.id && candidate.organizationId === input.organizationId && candidate.deletedAt === null && candidate.status !== "DRAFT")
    if (!item) return false
    Object.assign(item, { deletedAt: this.now().toISOString(), deletedByPersonId: input.moderatorPersonId })
    this.audits.push({ action: "MODERATED", id: item.id })
    return true
  }

  async countAudience(input: { organizationId: string; authorPersonId: string; audience: CommunicationAudience; segment: CommunicationSegment }): Promise<number> {
    return this.audienceOf(input).count
  }

  async audienceOptions(): Promise<AudienceOptions> {
    return { teams: (this.catalog.teams ?? []).map((team) => ({ id: team.id, name: team.id, universe: null, subteams: (team.subteams ?? []).map((id) => ({ id, name: id })) })), universes: ["B2B", "B2C"], products: (this.catalog.products ?? []).map((id) => ({ id, name: id, familyName: null })) }
  }

  async validReferences(_organizationId: string, input: { teamIds: string[]; subteamIds: string[]; productNodeId: string | null }): Promise<boolean> {
    const teams = new Set((this.catalog.teams ?? []).map((team) => team.id))
    const subteams = new Set((this.catalog.teams ?? []).flatMap((team) => team.subteams ?? []))
    return input.teamIds.every((id) => teams.has(id)) && input.subteamIds.every((id) => subteams.has(id)) && (!input.productNodeId || (this.catalog.products ?? []).includes(input.productNodeId))
  }
}
