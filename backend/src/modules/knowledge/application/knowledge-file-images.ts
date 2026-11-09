import type { Database } from "../../../infrastructure/database/pool.js"

/** As imagens de um PDF de base ficam no arquivo, cada uma uma vez. A versão diz onde elas aparecem (`extraction.images`). Ver `knowledge_file_images`. */
type Queryable = Pick<Database, "query">

export type KnowledgeImageToSave = { id: string; mimeType: string; width: number; height: number; data: Buffer }
export type KnowledgeImageRow = { hash: string; mime_type: string; data: Buffer }

const IMAGE_ID = /^[0-9a-f]{32}$/
export const isKnowledgeImageId = (value: string) => IMAGE_ID.test(value)

/** Reprocessar o mesmo arquivo acha as mesmas imagens: o que já está gravado fica como está. */
export async function saveKnowledgeFileImages(client: Queryable, fileId: string, images: readonly KnowledgeImageToSave[]): Promise<void> {
  for (const image of images) {
    await client.query(
      `insert into knowledge_file_images (knowledge_file_id, hash, mime_type, width, height, data) values ($1, $2, $3, $4, $5, $6) on conflict (knowledge_file_id, hash) do nothing`,
      [fileId, image.id, image.mimeType, image.width, image.height, image.data],
    )
  }
}

export async function loadKnowledgeFileImage(db: Queryable, fileId: string, imageId: string): Promise<KnowledgeImageRow | null> {
  if (!isKnowledgeImageId(imageId)) return null
  return (await db.query<KnowledgeImageRow>(`select hash, mime_type, data from knowledge_file_images where knowledge_file_id = $1 and hash = $2`, [fileId, imageId])).rows[0] ?? null
}

/** A imagem do arquivo de uma versão. Quem chama já conferiu o acesso à versão: o id da imagem sozinho não abre nada. */
export async function loadKnowledgeVersionImage(db: Queryable, versionId: string, imageId: string): Promise<KnowledgeImageRow | null> {
  if (!isKnowledgeImageId(imageId)) return null
  return (await db.query<KnowledgeImageRow>(
    `select i.hash, i.mime_type, i.data from knowledge_versions v join knowledge_file_images i on i.knowledge_file_id = v.file_id where v.id = $1 and i.hash = $2`,
    [versionId, imageId],
  )).rows[0] ?? null
}
