import { apiGet } from "@/lib/api/api-client"
import { personOrganizationStructureSchema, type PersonOrganizationStructure } from "@/schemas/org-structure/person-structure.schema"

/** Aba Estrutura do perfil — o backend decide o escopo (403 STRUCTURE_ACCESS_DENIED fora dele). */
export async function fetchPersonOrganizationStructure(personId: string): Promise<PersonOrganizationStructure> {
  return personOrganizationStructureSchema.parse(await apiGet(`/api/v1/people/${encodeURIComponent(personId)}/organization-structure`))
}
