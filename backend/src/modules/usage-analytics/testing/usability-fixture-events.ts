import { randomUUID } from "node:crypto"
import type pg from "pg"
import { ingestClientBatch, type IngestResult } from "../application/ingest-client-events.js"
import { recordServerUsageEvent } from "../application/record-server-event.js"
import type { FixtureIds } from "./usability-fixture.js"

/**
 * Linha do tempo de uso da massa — enviada pela INGESTÃO REAL (lotes do navegador, validação, autorização de entidade) e pelo
 * gravador real de fatos de servidor. Horários em UTC; local = UTC−3.
 */
type Ev = { name: string; at: string; tab: string; session: string; screen: string | null; route: string | null; instance: string | null; element?: string | null; entity?: { type: string; id: string } | null; correlation?: string | null; props?: Record<string, unknown> }

export const IDS = {
  u0: randomUUID(), u1: randomUUID(), u2: randomUUID(), u3: randomUUID(), uFabio: randomUUID(), uX: randomUUID(),
  t0: randomUUID(), t1: randomUUID(), t2: randomUUID(), t3: randomUUID(), tF: randomUUID(), tX: randomUUID(),
  v1: randomUUID(), v2: randomUUID(), k1: randomUUID(), kRate: randomUUID(),
}

const toBody = (accountId: string, sentAt: string, events: Ev[], device: "DESKTOP" | "MOBILE") => ({
  accountId,
  sentAt,
  appVersion: "prova-1.0.0",
  device,
  events: events.map((event) => ({
    eventId: randomUUID(),
    name: event.name,
    schemaVersion: 1,
    occurredAt: event.at,
    usageSessionId: event.session,
    tabId: event.tab,
    screenInstanceId: event.instance,
    screenKey: event.screen,
    elementKey: event.element ?? null,
    routeTemplate: event.route,
    entity: event.entity ?? null,
    correlationId: event.correlation ?? null,
    properties: event.props ?? {},
  })),
})

export async function ingest(pool: pg.Pool, ids: FixtureIds, who: "ana" | "fabio" | "xavier", events: Ev[], options: { receivedAt: string; device?: "DESKTOP" | "MOBILE"; accountOverride?: string }): Promise<IngestResult> {
  const organizationId = who === "xavier" ? ids.otherOrg : ids.org
  const body = toBody(options.accountOverride ?? ids.accounts[who], options.receivedAt, events, options.device ?? "DESKTOP")
  return ingestClientBatch(pool, { organizationId, accountId: ids.accounts[who], personId: ids.people[who] }, body, { transport: "FETCH", now: new Date(options.receivedAt) })
}

const view = (at: string, tab: string, session: string, screen: string, route: string, instance: string, kind: string, navigation: string, extra: Partial<Ev> = {}): Ev => ({ name: "screen.viewed", at, tab, session, screen, route, instance, props: { kind, navigation, entry: navigation === "INITIAL" }, ...extra })
const beat = (start: string, end: string, tab: string, session: string, screen: string, route: string, instance: string, reason = "INTERACTION"): Ev => ({ name: "activity.heartbeat", at: end, tab, session, screen, route, instance, props: { spanStart: start, spanEnd: end, reason, lastInteractionAt: reason === "INTERACTION" ? end : null } })
const click = (at: string, tab: string, session: string, screen: string, route: string | null, instance: string, element: string, extra: Partial<Ev> = {}): Ev => ({ name: "element.activated", at, tab, session, screen, route, instance, element, props: { interaction: "CLICK" }, ...extra })

/** Timeline completa. Devolve os resultados de cada lote (para conferir aceitos/duplicados). */
export async function seedFixtureEvents(pool: pg.Pool, ids: FixtureIds) {
  const { u0, u1, u2, t0, t1, t2, t3 } = IDS
  const followup = "my_profile.operator.followup"
  const route = "/operator"
  const i = { home0: randomUUID(), f1: randomUUID(), t2: randomUUID(), chat: randomUUID(), detail: randomUUID(), notif: randomUUID(), dest: randomUUID(), reload: randomUUID(), home2: randomUUID(), detail4: randomUUID(), mob: randomUUID(), d2f: randomUUID(), chat2: randomUUID() }
  const results: IngestResult[] = []

  // D0 (04/10, antes do período): login + uma tela — a cobertura do navegador começa ANTES do período (cobertura completa).
  await recordServerUsageEvent(pool, { organizationId: ids.org, name: "auth.login_succeeded", accountId: ids.accounts.ana, actorPersonId: ids.people.ana, occurredAt: new Date("2026-10-04T19:59:00Z") })
  results.push(await ingest(pool, ids, "ana", [view("2026-10-04T20:00:00Z", t0, u0, "home", "/", i.home0, "ROUTE", "INITIAL"), { name: "element.exposed", at: "2026-10-04T20:00:01Z", tab: t0, session: u0, screen: "home", route: "/", instance: i.home0, element: "notifications.bell" }, { name: "content.scrolled", at: "2026-10-04T20:00:02Z", tab: t0, session: u0, screen: "home", route: "/", instance: i.home0, props: { contentKey: "followup.feed", depth: 25, fitsViewport: false } }, { name: "action.started", at: "2026-10-04T20:00:03Z", tab: t0, session: u0, screen: "home", route: "/", instance: i.home0, correlation: randomUUID(), props: { actionKey: "profile.save" } }, { name: "search.performed", at: "2026-10-04T20:00:04Z", tab: t0, session: u0, screen: "home", route: "/", instance: i.home0, props: { surface: "followup.feed", queryLength: "3-5", resultCount: "1-5", empty: false } }, { name: "voice.mode_changed", at: "2026-10-04T20:00:05Z", tab: t0, session: u0, screen: null, route: null, instance: null, props: { mode: "UNMUTED" } }, { name: "latency.measured", at: "2026-10-04T20:00:06Z", tab: t0, session: u0, screen: null, route: null, instance: null, props: { metric: "CHAT_FIRST_TEXT", ms: null, outcome: "TIMEOUT" } }], { receivedAt: "2026-10-04T20:01:00Z" }))

  // D1 (05/10) — sessão S1: desktop, aba 1 + aba 2 (mesmo navegador), 3 telas, 10 cliques, um reload.
  await recordServerUsageEvent(pool, { organizationId: ids.org, name: "auth.login_succeeded", accountId: ids.accounts.ana, actorPersonId: ids.people.ana, occurredAt: new Date("2026-10-05T11:59:00Z") })
  const s1: Ev[] = [
    view("2026-10-05T12:00:00Z", t1, u1, followup, route, i.f1, "TAB", "INITIAL"),
    beat("2026-10-05T12:00:00Z", "2026-10-05T12:00:15Z", t1, u1, followup, route, i.f1),
    { name: "element.exposed", at: "2026-10-05T12:00:10Z", tab: t1, session: u1, screen: followup, route, instance: i.f1, element: "feedback.card", entity: { type: "PUBLISHED_FEEDBACK", id: ids.feedbacks.f1 } },
    click("2026-10-05T12:00:12Z", t1, u1, followup, route, i.f1, "feedback.open_detail", { entity: { type: "PUBLISHED_FEEDBACK", id: ids.feedbacks.f1 } }),
    beat("2026-10-05T12:00:15Z", "2026-10-05T12:00:30Z", t1, u1, followup, route, i.f1),
    view("2026-10-05T12:00:20Z", t1, u1, "followup.chat_panel", route, i.chat, "PANEL", "OPEN"),
    view("2026-10-05T12:00:30Z", t2, u1, "my_profile.operator.indicators", route, i.t2, "TAB", "INITIAL"),
    beat("2026-10-05T12:00:30Z", "2026-10-05T12:00:45Z", t1, u1, followup, route, i.f1),
    beat("2026-10-05T12:00:30Z", "2026-10-05T12:00:45Z", t2, u1, "my_profile.operator.indicators", route, i.t2),
    view("2026-10-05T12:00:40Z", t1, u1, "feedback.detail", route, i.detail, "MODAL", "OPEN", { entity: { type: "PUBLISHED_FEEDBACK", id: ids.feedbacks.f1 } }),
    { name: "content.scrolled", at: "2026-10-05T12:00:41Z", tab: t1, session: u1, screen: "feedback.detail", route, instance: i.detail, entity: { type: "PUBLISHED_FEEDBACK", id: ids.feedbacks.f1 }, props: { contentKey: "feedback.content", depth: 25, fitsViewport: false } },
    { name: "content.scrolled", at: "2026-10-05T12:00:42Z", tab: t1, session: u1, screen: "feedback.detail", route, instance: i.detail, entity: { type: "PUBLISHED_FEEDBACK", id: ids.feedbacks.f1 }, props: { contentKey: "feedback.content", depth: 50, fitsViewport: false } },
    beat("2026-10-05T12:00:45Z", "2026-10-05T12:01:00Z", t1, u1, followup, route, i.f1),
    beat("2026-10-05T12:00:45Z", "2026-10-05T12:01:00Z", t2, u1, "my_profile.operator.indicators", route, i.t2),
    view("2026-10-05T12:00:48Z", t1, u1, "notifications.panel", route, i.notif, "PANEL", "OPEN"),
    { name: "element.exposed", at: "2026-10-05T12:00:50Z", tab: t1, session: u1, screen: "notifications.panel", route, instance: i.notif, element: "notifications.item", entity: { type: "ALERT", id: ids.alert } },
    click("2026-10-05T12:01:00Z", t1, u1, "notifications.panel", route, i.notif, "notifications.item", { entity: { type: "ALERT", id: ids.alert } }),
    view("2026-10-05T12:01:03Z", t1, u1, followup, route, i.dest, "TAB", "NAVIGATION"),
    // Três "foi útil" em 1 s no mesmo elemento = possível clique repetitivo (heurística).
    click("2026-10-05T12:01:30.000Z", t1, u1, followup, route, i.dest, "feedback.rating.up", { entity: { type: "PUBLISHED_FEEDBACK", id: ids.feedbacks.f1 } }),
    click("2026-10-05T12:01:30.400Z", t1, u1, followup, route, i.dest, "feedback.rating.up", { entity: { type: "PUBLISHED_FEEDBACK", id: ids.feedbacks.f1 } }),
    click("2026-10-05T12:01:30.800Z", t1, u1, followup, route, i.dest, "feedback.rating.up", { entity: { type: "PUBLISHED_FEEDBACK", id: ids.feedbacks.f1 } }),
    click("2026-10-05T12:02:00Z", t1, u1, followup, route, i.dest, "nav.tab", { props: { interaction: "CLICK", tabValue: "indicators" } }),
    click("2026-10-05T12:03:00Z", t1, u1, followup, route, i.dest, "feedback.rating.down", { entity: { type: "PUBLISHED_FEEDBACK", id: ids.feedbacks.f1 } }),
    click("2026-10-05T12:04:00Z", t1, u1, followup, route, i.dest, "feedback.confirm_reading.open", { entity: { type: "PUBLISHED_FEEDBACK", id: ids.feedbacks.f1 } }),
    view("2026-10-05T12:06:00Z", t1, u1, followup, route, i.reload, "TAB", "RELOAD"),
    click("2026-10-05T12:19:59Z", t1, u1, "followup.chat_panel", route, i.chat, "chat.send", { correlation: IDS.k1 }),
    { name: "action.started", at: "2026-10-05T12:20:00Z", tab: t1, session: u1, screen: "followup.chat_panel", route, instance: i.chat, correlation: IDS.k1, props: { actionKey: "chat.send_message" } },
    { name: "action.succeeded", at: "2026-10-05T12:20:01Z", tab: t1, session: u1, screen: "followup.chat_panel", route, instance: i.chat, correlation: IDS.k1, props: { actionKey: "chat.send_message", durationMs: 1000 } },
    { name: "latency.measured", at: "2026-10-05T12:20:02Z", tab: t1, session: u1, screen: null, route: null, instance: null, correlation: IDS.k1, props: { metric: "CHAT_FIRST_TEXT", ms: 1200, outcome: "OK" } },
    { name: "voice.connection", at: "2026-10-05T12:24:00Z", tab: t1, session: u1, screen: null, route: null, instance: null, props: { stage: "REQUESTED", voiceIntentId: IDS.v1 } },
    { name: "voice.mic_permission", at: "2026-10-05T12:24:02Z", tab: t1, session: u1, screen: null, route: null, instance: null, props: { result: "GRANTED", voiceIntentId: IDS.v1 } },
    { name: "voice.connection", at: "2026-10-05T12:24:05Z", tab: t1, session: u1, screen: null, route: null, instance: null, props: { stage: "ESTABLISHED", voiceIntentId: IDS.v1 } },
    { name: "voice.mic_span", at: "2026-10-05T12:24:35Z", tab: t1, session: u1, screen: null, route: null, instance: null, props: { spanStart: "2026-10-05T12:24:05Z", spanEnd: "2026-10-05T12:24:35Z", voiceIntentId: IDS.v1 } },
    { name: "voice.playback", at: "2026-10-05T12:25:05Z", tab: t1, session: u1, screen: null, route: null, instance: null, props: { stage: "STARTED", context: "CONVERSATION", voiceIntentId: IDS.v1 } },
    { name: "latency.measured", at: "2026-10-05T12:25:06Z", tab: t1, session: u1, screen: null, route: null, instance: null, props: { metric: "VOICE_FIRST_AUDIO", ms: 900, outcome: "OK" } },
    { name: "voice.playback", at: "2026-10-05T12:25:20Z", tab: t1, session: u1, screen: null, route: null, instance: null, props: { stage: "COMPLETED", context: "CONVERSATION", spanStart: "2026-10-05T12:25:05Z", spanEnd: "2026-10-05T12:25:20Z", voiceIntentId: IDS.v1 } },
    { name: "voice.connection", at: "2026-10-05T12:30:00Z", tab: t1, session: u1, screen: null, route: null, instance: null, props: { stage: "RECONNECTING", voiceIntentId: IDS.v1, reason: "NETWORK" } },
    { name: "voice.connection", at: "2026-10-05T12:30:05Z", tab: t1, session: u1, screen: null, route: null, instance: null, props: { stage: "RECONNECTED", voiceIntentId: IDS.v1 } },
    { name: "voice.connection", at: "2026-10-05T12:35:00Z", tab: t1, session: u1, screen: null, route: null, instance: null, props: { stage: "CLOSED", voiceIntentId: IDS.v1, reason: "USER" } },
  ]
  results.push(await ingest(pool, ids, "ana", s1, { receivedAt: "2026-10-05T12:36:00Z" }))
  // Retentativa do MESMO lote (mesmos eventIds) não duplica nada.
  // S2: 46 min sem atividade qualificada depois da última (12:24:02) → nova sessão; abre F4 (resultado do workflow).
  const s2: Ev[] = [
    view("2026-10-05T13:10:00Z", t1, u1, "home", "/", i.home2, "ROUTE", "NAVIGATION"),
    beat("2026-10-05T13:10:00Z", "2026-10-05T13:10:15Z", t1, u1, "home", "/", i.home2),
    beat("2026-10-05T13:10:15Z", "2026-10-05T13:10:30Z", t1, u1, "home", "/", i.home2),
    view("2026-10-05T13:10:10Z", t1, u1, "feedback.detail", "/", i.detail4, "MODAL", "OPEN", { entity: { type: "PUBLISHED_FEEDBACK", id: ids.feedbacks.f4 } }),
  ]
  results.push(await ingest(pool, ids, "ana", s2, { receivedAt: "2026-10-05T13:11:00Z" }))
  // S3 (celular): 23:59:50 local de D1 → 00:01 de D2 — o tempo ativo é dividido entre os dois dias.
  const s3: Ev[] = [
    view("2026-10-06T02:59:50Z", t3, u2, followup, route, i.mob, "TAB", "INITIAL"),
    beat("2026-10-06T02:59:50Z", "2026-10-06T03:00:05Z", t3, u2, followup, route, i.mob),
    click("2026-10-06T03:01:00Z", t3, u2, followup, route, i.mob, "chat.mic"),
  ]
  results.push(await ingest(pool, ids, "ana", s3, { receivedAt: "2026-10-06T03:01:30Z", device: "MOBILE" }))
  // D2 — S4 (celular): painel da INIA aberto sem mensagem; F2 exposto; convite → aplicação; voz sem fala.
  const s4: Ev[] = [
    view("2026-10-06T17:00:00Z", t3, u2, followup, route, i.d2f, "TAB", "NAVIGATION"),
    beat("2026-10-06T17:00:00Z", "2026-10-06T17:00:15Z", t3, u2, followup, route, i.d2f),
    { name: "element.exposed", at: "2026-10-06T17:00:05Z", tab: t3, session: u2, screen: followup, route, instance: i.d2f, element: "feedback.card", entity: { type: "PUBLISHED_FEEDBACK", id: ids.feedbacks.f2 } },
    view("2026-10-06T17:00:10Z", t3, u2, "followup.chat_panel", route, i.chat2, "PANEL", "OPEN"),
    { name: "voice.connection", at: "2026-10-06T17:02:00Z", tab: t3, session: u2, screen: null, route: null, instance: null, props: { stage: "REQUESTED", voiceIntentId: IDS.v2 } },
    { name: "voice.mic_permission", at: "2026-10-06T17:02:02Z", tab: t3, session: u2, screen: null, route: null, instance: null, props: { result: "GRANTED", voiceIntentId: IDS.v2 } },
    { name: "voice.connection", at: "2026-10-06T17:02:05Z", tab: t3, session: u2, screen: null, route: null, instance: null, props: { stage: "ESTABLISHED", voiceIntentId: IDS.v2 } },
    { name: "voice.connection", at: "2026-10-06T17:04:00Z", tab: t3, session: u2, screen: null, route: null, instance: null, props: { stage: "CLOSED", voiceIntentId: IDS.v2, reason: "IDLE" } },
  ]
  results.push(await ingest(pool, ids, "ana", s4, { receivedAt: "2026-10-06T17:05:00Z", device: "MOBILE" }))
  for (const [decision, at] of [["OFFER", "2026-10-06T17:00:30Z"], ["ACCEPT", "2026-10-06T17:00:50Z"]] as const) {
    await recordServerUsageEvent(pool, { organizationId: ids.org, name: "feedback_application.invite", accountId: ids.accounts.ana, actorPersonId: ids.people.ana, subjectPersonId: ids.people.ana, entity: { type: "PUBLISHED_FEEDBACK", id: ids.feedbacks.f2 }, properties: { decision }, occurredAt: new Date(at) })
  }
  await recordServerUsageEvent(pool, { organizationId: ids.org, name: "feedback_application.lifecycle", accountId: ids.accounts.ana, actorPersonId: ids.people.ana, subjectPersonId: ids.people.ana, entity: { type: "PUBLISHED_FEEDBACK", id: ids.feedbacks.f2 }, properties: { stage: "STARTED", applicationId: ids.application }, occurredAt: new Date("2026-10-06T17:01:00Z") })
  await recordServerUsageEvent(pool, { organizationId: ids.org, name: "notification.read", accountId: ids.accounts.ana, actorPersonId: ids.people.ana, subjectPersonId: ids.people.ana, entity: { type: "ALERT", id: ids.alert }, properties: { scope: "ONE" }, occurredAt: new Date("2026-10-05T12:01:02Z") })

  // Fábio (DEMONSTRAÇÃO): uma tela em D1 — fora dos números por padrão.
  results.push(await ingest(pool, ids, "fabio", [view("2026-10-05T15:00:00Z", IDS.tF, IDS.uFabio, "home", "/", randomUUID(), "ROUTE", "INITIAL")], { receivedAt: "2026-10-05T15:01:00Z" }))
  // Xavier (OUTRA organização): uma tela — nunca aparece para quem olha a organização da prova.
  results.push(await ingest(pool, ids, "xavier", [view("2026-10-05T15:00:00Z", IDS.tX, IDS.uX, "home", "/", randomUUID(), "ROUTE", "INITIAL")], { receivedAt: "2026-10-05T15:01:00Z" }))
  return { results, s1 }
}
