import { z } from "zod"

export const broadcastImageSchema = z.instanceof(File)
  .refine((file) => file.size <= 2 * 1024 * 1024, "A imagem deve ter no máximo 2 MB.")
  .refine((file) => ["image/jpeg", "image/png", "image/webp", "image/gif"].includes(file.type), "Use uma imagem JPG, PNG, WebP ou GIF.")

export const broadcastSchema = z.object({
  title: z.string().trim().min(3, "Informe um título com pelo menos 3 caracteres.").max(120, "O título deve ter no máximo 120 caracteres."),
  contentHtml: z.string().min(1, "Digite o conteúdo do comunicado.").max(8 * 1024 * 1024, "O comunicado excedeu o limite de 8 MB."),
  plainText: z.string().trim().min(1, "Digite o conteúdo do comunicado.").max(5_000, "O texto deve ter no máximo 5.000 caracteres."),
  audience: z.enum(["team", "company"]),
  tags: z.array(z.enum(["Aviso", "Processos", "Campanha"])).min(1, "Selecione ao menos uma categoria."),
})

export type BroadcastInput = z.infer<typeof broadcastSchema>
