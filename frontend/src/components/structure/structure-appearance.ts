import type { StructureStatusBucket } from "@/schemas/org-structure/person-structure.schema"

/**
 * Cor por NÍVEL da hierarquia no organograma (nunca por nome de cargo, que é dado da organização): a classe define `--cargo`, usada no selo do
 * cargo (fundo claro, borda da mesma cor um pouco mais escura) e no contorno fino da foto. O resto do card é branco e neutro (decisão de 25/11:
 * a cor fica no selo, a tela não é colorida). A cor nunca é a única informação: o selo diz o cargo. O verde fica livre: é das férias.
 */
const ROLE_CLASS: Record<string, string> = {
  DIRECTOR: "[--cargo:#7c4dab] dark:[--cargo:#bd9be0]",
  SENIOR_MANAGER: "[--cargo:#5f63b8] dark:[--cargo:#a5a9e6]",
  MANAGER: "[--cargo:#3f74b5] dark:[--cargo:#8db6e6]",
  COORDINATOR: "[--cargo:#2f8a99] dark:[--cargo:#7fc9d4]",
  SUPERVISOR: "[--cargo:#c08a2e] dark:[--cargo:#e3bd74]",
  OPERATOR: "[--cargo:#b9618a] dark:[--cargo:#e0a3c0]",
}
const OTHER_ROLE = "[--cargo:#7c8593] dark:[--cargo:#a9b1bd]"

export const roleColorClass = (role: string): string => ROLE_CLASS[role] ?? OTHER_ROLE

/** Cor de cada situação na distribuição agregada: só identifica a linha (nunca avalia); férias é o mesmo verde do card. */
export const STATUS_BUCKET_CLASS: Record<StructureStatusBucket, string> = {
  EM_PRODUCAO: "bg-primary/45 dark:bg-chart-4/60",
  FERIAS: "bg-emerald-600/60 dark:bg-emerald-400/60",
  INSS: "bg-[#a67c3d]/60",
  MATERNIDADE: "bg-[#a0667f]/60",
  PATERNIDADE: "bg-[#4d7098]/60",
  SENSITIVE_LEAVE: "bg-[#a67c3d]/60",
  OTHER: "bg-slate-400/70",
  UNCONFIRMED: "bg-slate-300 dark:bg-slate-600",
}
