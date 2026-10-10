import type pg from "pg"
import { upsertInteractionSubjectCatalog, type InteractionSubjectCatalogReport } from "../../../modules/interactions/application/interaction-subject-catalog.js"
import { DEMO_ORGANIZATION_ID } from "./demo-constants.js"
import { demoId } from "./demo-ids.js"

/**
 * CATÁLOGO DEMO DE ASSUNTOS CANÔNICOS (migration 075) — dado de configuração da organização demo,
 * gravado pelo seed pelo MESMO serviço que uma tela administrativa usaria.
 *
 * Regras de montagem (2026-09-18):
 *   - os 17 códigos são os assuntos-fonte do lote `inia_demo_90_v1` (README do lote) — cada código é
 *     alias de si mesmo, porque o bruto daquelas interações É o código;
 *   - aliases da massa legada/gerada só quando a frase bruta tem UMA cabeça semântica inequívoca
 *     ("Segunda via de fatura", "Contestação de cobrança duplicada", "Alteração de gestor empresarial");
 *     variantes "(rechamada)" são o mesmo assunto;
 *   - frases compostas ("X e Y"), frases com duas leituras ("Cobrança após pedido de cancelamento…":
 *     contestação × cancelamento; "Linha sem sinal": cobertura × internet móvel; "Dúvida sobre franquia
 *     de dados"; "Mudança do dia de vencimento"; "Cliente ameaça cancelar por preço"; "Negociação de
 *     débito") e assuntos SEM canônico no catálogo (banda larga/reparo/Wi-Fi, aplicativo/área do cliente,
 *     visita técnica, reclamação de atendimento) ficam SEM alias — canônico nulo, comparação pelo bruto;
 *   - montado só a partir dos assuntos-fonte conhecidos — nunca a partir do gabarito de QA.
 * Ids determinísticos (o reset apaga por id). Um bruto listado para dois códigos seria recusado pelo
 * serviço (ambiguidade explícita) — o teste do catálogo garante que não há.
 */
export const DEMO_SUBJECT_CATALOG_VERSION = "DEMO_SUBJECTS_V1"

export const DEMO_SUBJECT_DEFINITIONS: readonly { code: string; name: string }[] = [
  { code: "fatura", name: "Fatura" },
  { code: "contestacao", name: "Contestação de cobrança" },
  { code: "segunda_via", name: "Segunda via" },
  { code: "troca_titularidade", name: "Troca de titularidade" },
  { code: "portabilidade", name: "Portabilidade" },
  { code: "troca_chip", name: "Troca de chip" },
  { code: "alteracao_cadastral", name: "Alteração cadastral" },
  { code: "cancelamento", name: "Cancelamento" },
  { code: "cobertura", name: "Cobertura" },
  { code: "bloqueio", name: "Bloqueio" },
  { code: "desbloqueio", name: "Desbloqueio" },
  { code: "roaming", name: "Roaming" },
  { code: "plano", name: "Plano" },
  { code: "pagamento", name: "Pagamento" },
  { code: "esim", name: "eSIM" },
  { code: "internet_movel", name: "Internet móvel" },
  { code: "servico_adicional", name: "Serviço adicional" },
]

export const DEMO_SUBJECT_ALIASES: readonly { code: string; rawSubjects: readonly string[] }[] = [
  { code: "fatura", rawSubjects: ["Dúvida sobre fatura", "Dúvida sobre fatura (rechamada)", "Fatura veio com valor maior", "Esclarecimento de valores na fatura", "Esclarecimento de valores na fatura (rechamada)", "Dúvida sobre cobrança proporcional", "Dúvida sobre cobrança proporcional (rechamada)", "Fatura não recebida por e-mail", "Fatura não recebida por e-mail (rechamada)", "Cliente ligou de novo sobre a mesma fatura"] },
  { code: "contestacao", rawSubjects: ["Contestação de cobrança", "Contestação de cobrança duplicada", "Contestação de cobrança após cancelamento", "Contestação de cobrança de serviço digital", "Contestação de serviço digital não reconhecido", "Contestação de serviço digital e emissão de conta ajustada", "Contestação de pagamento não reconhecido", "Contestação de linha desconhecida e suspeita de fraude", "Contestação de linha desconhecida e negativação", "Contestação de pacote adicional", "Contestação de cobrança proporcional após mudança de plano", "Contestação de roaming internacional", "Contestação de roaming após viagem de aniversário", "Cobrança de serviço não reconhecido", "Cobrança de serviço digital não reconhecido"] },
  { code: "segunda_via", rawSubjects: ["Segunda via de fatura", "Segunda via de fatura (rechamada)", "Segunda via de conta", "Segunda via de conta com falha no aplicativo", "Segunda via de conta com falha no aplicativo (rechamada)", "Segunda via com falha nos canais digitais", "Segunda via com indisponibilidade dos canais digitais", "Segunda via de fatura com canais digitais indisponíveis", "Segunda via durante viagem por emergência familiar", "Cliente ligou sobre a segunda via da fatura"] },
  { code: "troca_titularidade", rawSubjects: ["Troca de titularidade", "Troca de titularidade entre empresas", "Troca de titularidade entre empresas após venda de estabelecimento", "Troca de titularidade entre empresas do mesmo grupo", "Troca de titularidade entre empresas por venda de unidade", "Troca de titularidade empresarial tratada como alteração de gestor"] },
  { code: "portabilidade", rawSubjects: ["Portabilidade não concluída"] },
  { code: "troca_chip", rawSubjects: ["Troca de chip após perda do aparelho", "Troca de chip por defeito", "Troca de chip por perda do aparelho"] },
  { code: "alteracao_cadastral", rawSubjects: ["Alteração de dados cadastrais", "Alteração de e-mail e telefone", "Alteração de e-mail e telefone (rechamada)", "Alteração de dados cadastrais de gestor", "Alteração de e-mail e telefone do gestor", "Alteração simultânea de telefone e e-mail do gestor", "Alteração de gestor empresarial", "Alteração do gestor principal após desligamento", "Substituição de gestor após desligamento", "Alteração de gestor solicitada por pessoa não cadastrada"] },
  { code: "cancelamento", rawSubjects: ["Cancelamento de linha", "Cancelamento de linha móvel", "Cancelamento de internet por mudança de endereço", "Cancelamento após mudança de endereço", "Cancelamento de internet por mudança", "Cancelamento de internet após visitas recorrentes", "Cancelamento de linha após falecimento do titular", "Cancelamento após falecimento do titular", "Cancelamento por falecimento do titular", "Cancelamento de linha com contas vencidas", "Cancelamento de linha com débito", "Cancelamento de linha durante separação conjugal", "Cancelamento de linha sem utilização", "Cancelamento por falta de utilização", "Cancelamento por falhas recorrentes", "Cancelamento por falhas recorrentes na banda larga", "Cancelamento por dificuldade financeira", "Retenção após pedido de cancelamento"] },
  { code: "cobertura", rawSubjects: ["Informação sobre cobertura"] },
  { code: "bloqueio", rawSubjects: ["Bloqueio de linha por perda do celular"] },
  { code: "roaming", rawSubjects: ["Dúvida sobre roaming", "Dúvida sobre roaming (rechamada)"] },
  { code: "plano", rawSubjects: ["Informação sobre plano", "Informação sobre plano (rechamada)", "Alteração de plano", "Alteração de plano (rechamada)", "Redução de plano", "Redução de plano (rechamada)", "Upgrade de velocidade", "Upgrade de velocidade (rechamada)", "Troca de plano por dificuldade financeira", "Troca de plano por dificuldade financeira (rechamada)"] },
  { code: "esim", rawSubjects: ["Dificuldade para ativar eSIM"] },
  { code: "internet_movel", rawSubjects: ["Internet móvel sem funcionamento", "Internet móvel sem funcionamento (rechamada)", "Internet móvel sem funcionar"] },
]

export function demoSubjectDefinitionId(code: string): string {
  return demoId(`subject:${code}`)
}

export function demoSubjectAliasId(rawSubject: string): string {
  return demoId(`subject-alias:${rawSubject.trim().toLowerCase()}`)
}

export function demoSubjectCatalogInput() {
  return {
    definitions: DEMO_SUBJECT_DEFINITIONS.map((definition) => ({ id: demoSubjectDefinitionId(definition.code), code: definition.code, name: definition.name, active: true })),
    aliases: [
      // O próprio código é o bruto das interações do lote de diagnóstico.
      ...DEMO_SUBJECT_DEFINITIONS.map((definition) => ({ id: demoSubjectAliasId(definition.code), code: definition.code, rawSubject: definition.code })),
      ...DEMO_SUBJECT_ALIASES.flatMap((group) => group.rawSubjects.map((rawSubject) => ({ id: demoSubjectAliasId(rawSubject), code: group.code, rawSubject }))),
    ],
  }
}

export async function persistDemoSubjectCatalog(client: pg.PoolClient): Promise<InteractionSubjectCatalogReport> {
  return upsertInteractionSubjectCatalog(client as unknown as Parameters<typeof upsertInteractionSubjectCatalog>[0], DEMO_ORGANIZATION_ID, demoSubjectCatalogInput())
}
