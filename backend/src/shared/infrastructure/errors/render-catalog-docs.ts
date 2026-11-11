import { ERROR_CATALOG, ERROR_CATALOG_VERSION, ERROR_FAMILIES } from "../../domain/errors/error-catalog.js"
import type { ErrorCatalogEntry, ErrorFamily, InventoriedDomainCode } from "../../domain/errors/error-catalog-types.js"
import { familyForStatus } from "../../domain/errors/error-lookup.js"

/**
 * Documentos LEGÍVEIS do catálogo (gerados — nunca editados à mão): `docs/operacao/catalogo-de-erros.md` (leitura humana, também
 * no Bloco de Notas da VM) e `docs/operacao/catalogo-de-erros.json` (consulta por PowerShell: `ConvertFrom-Json`).
 */

export function renderCatalogJson(domainCodes: readonly InventoriedDomainCode[]): string {
  const payload = {
    version: ERROR_CATALOG_VERSION,
    generatedFrom: "backend/src/shared/domain/errors/error-catalog.ts",
    entries: ERROR_CATALOG,
    families: ERROR_FAMILIES,
    domainCodes: domainCodes.map((domain) => ({ ...domain, family: familyForStatus(domain.statuses[0]).id })),
  }
  return `${JSON.stringify(payload, null, 2)}\n`
}

const cell = (value: string) => value.replaceAll("|", "\\|").replaceAll("\n", " ")

function renderEntry(entry: ErrorCatalogEntry): string {
  const lines = [
    `### ${entry.code}`,
    "",
    `- **Módulo:** ${entry.module} · **Origem:** ${entry.origin} · **Status HTTP:** ${entry.httpStatus ?? "—"} · **Severidade:** ${entry.severity}`,
    ...(entry.aliases?.length ? [`- **Aliases / códigos cobertos:** ${entry.aliases.map((alias) => `\`${alias}\``).join(", ")}`] : []),
    `- **Quando dispara:** ${entry.trigger}`,
    `- **Mensagem pública:** ${entry.publicMessage}`,
    `- **Ação segura (usuário):** ${entry.safeAction}`,
    `- **Descrição técnica:** ${entry.technicalDescription}`,
    "",
    "**Causas prováveis (hipóteses — confirme pelo sinal):**",
    "",
    "| Hipótese | Sinal que confirma |",
    "| --- | --- |",
    ...entry.probableCauses.map((cause) => `| ${cell(cause.hypothesis)} | ${cell(cause.signal)} |`),
    "",
    "**Verificações, em ordem:**",
    "",
    ...entry.checks.map((check, index) => `${index + 1}. ${check}`),
    "",
    "**Onde buscar evidência:**",
    "",
    ...entry.evidence.map((evidence) => (evidence.command ? `- ${evidence.where}:\n\n  \`\`\`powershell\n  ${evidence.command}\n  \`\`\`` : `- ${evidence.where}`)),
    "",
    `**Recuperação:** ${entry.recovery}`,
    "",
    `**Escalar para:** ${entry.escalation}`,
    "",
    `**Código:** ${entry.codeRefs.map((ref) => `\`${ref}\``).join(", ")}`,
    ...(entry.example ? ["", "Exemplo sanitizado:", "", "```json", entry.example, "```"] : []),
    "",
  ]
  return lines.join("\n")
}

function renderFamily(family: ErrorFamily): string {
  return [
    `### ${family.id} — ${family.title}`,
    "",
    `- **Status:** ${family.statuses.join(", ")} · **Severidade:** ${family.severity}`,
    `- ${family.meaning}`,
    "",
    "| Hipótese | Sinal que confirma |",
    "| --- | --- |",
    ...family.probableCauses.map((cause) => `| ${cell(cause.hypothesis)} | ${cell(cause.signal)} |`),
    "",
    ...family.checks.map((check, index) => `${index + 1}. ${check}`),
    "",
    `**Recuperação:** ${family.recovery} **Escalar para:** ${family.escalation}`,
    "",
  ].join("\n")
}

export function renderCatalogMarkdown(domainCodes: readonly InventoriedDomainCode[]): string {
  const byModule = new Map<string, InventoriedDomainCode[]>()
  for (const domain of domainCodes) byModule.set(domain.module, [...(byModule.get(domain.module) ?? []), domain])
  return [
    "<!-- GERADO por `npm --prefix backend run errors:catalog` a partir de backend/src/shared/domain/errors/error-catalog.ts — não edite à mão. -->",
    "",
    `# Catálogo de erros da INIA (versão ${ERROR_CATALOG_VERSION})`,
    "",
    "Como usar: a pessoa copia da tela o **código** (tipo de falha) e a **referência** (a ocorrência). Procure o código aqui (ou em",
    "Administração › Plataforma › Diagnóstico de erros, ou com `node \"$INIA\\backend\\dist\\main\\diagnostico-de-erros.js\" <código>`)",
    "e a referência nos registros com os comandos de cada entrada. O passo a passo da VM está em",
    "[runbook-diagnostico-de-erros.md](runbook-diagnostico-de-erros.md).",
    "",
    "Status HTTP descreve a resposta; código descreve o tipo de falha; referência identifica uma ocorrência. As causas são",
    "**hipóteses**: só o sinal indicado confirma uma delas.",
    "",
    "## Índice",
    "",
    "| Código | Módulo | Status | Severidade |",
    "| --- | --- | --- | --- |",
    ...ERROR_CATALOG.map((entry) => `| [${entry.code}](#${entry.code.toLowerCase()}) | ${cell(entry.module)} | ${entry.httpStatus ?? "—"} | ${entry.severity} |`),
    "",
    "## Entradas",
    "",
    ...ERROR_CATALOG.map(renderEntry),
    "## Famílias por status (códigos de regra de negócio dos módulos)",
    "",
    "Os códigos abaixo são devolvidos pelos módulos e inventariados automaticamente a partir do código-fonte. A mensagem de cada um",
    "já diz a regra; a família do status diz como investigar.",
    "",
    ...ERROR_FAMILIES.map(renderFamily),
    `## Códigos dos módulos (${domainCodes.length})`,
    "",
    ...[...byModule.entries()].flatMap(([module, codes]) => [
      `### Módulo \`${module}\``,
      "",
      "| Código | Status | Família | Mensagem | Onde |",
      "| --- | --- | --- | --- | --- |",
      ...codes.map((domain) => `| \`${domain.code}\` | ${domain.statuses.join(", ") || "—"} | ${familyForStatus(domain.statuses[0]).id} | ${cell(domain.messages[0] ?? "(mensagem montada no código)")} | ${domain.refs.map((ref) => `\`${ref}\``).join("<br>")} |`),
      "",
    ]),
  ].join("\n")
}
