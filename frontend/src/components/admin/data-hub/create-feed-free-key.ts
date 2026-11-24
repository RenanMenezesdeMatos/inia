import { AdminApiError } from "@/lib/admin/admin-api"
import { createFeed, type FeedInput } from "@/services/admin/data-hub-service"

const MAX_ATTEMPTS = 20

/** Cria o conjunto com a chave técnica derivada do nome; se ela já existe nesta fonte, tenta "-2", "-3"… (a pessoa não escolheu a chave). */
export async function createFeedWithFreeKey(sourceId: string, baseKey: string, input: Omit<FeedInput, "feedKey">, guarded: <T>(work: () => Promise<T>) => Promise<T> = (work) => work()) {
  for (let attempt = 1; ; attempt += 1) {
    const suffix = attempt === 1 ? "" : `-${attempt}`
    try {
      return await guarded(() => createFeed(sourceId, { ...input, feedKey: `${baseKey.slice(0, 64 - suffix.length)}${suffix}` } as FeedInput))
    } catch (error) {
      if (!(error instanceof AdminApiError && error.code === "DATA_FEED_KEY_CONFLICT") || attempt >= MAX_ATTEMPTS) throw error
    }
  }
}
