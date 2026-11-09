import type { DataContract, DataContractField } from "../data-contract.js"

/**
 * Contratos de MEDIÇÃO e FECHAMENTO. O contrato de medições é UM para todos os indicadores: o
 * código do indicador é DADO (`indicatorCode`), resolvido contra `indicator_definitions`. Um
 * indicador novo configurado na INIA recebe medição imediatamente pelo mesmo feed — a regra de
 * componentes exigidos (RATE → numerator+denominator…) vem da estratégia do catálogo, nunca
 * daqui.
 */
export const MEASUREMENT_GRANULARITIES = ["DAILY", "MONTHLY", "CUSTOM"] as const

export const INDICATOR_MEASUREMENTS_CONTRACT: DataContract = {
  key: "INDICATOR_MEASUREMENTS",
  version: 1,
  label: "Medições operacionais",
  description: "Medição de um indicador para um colaborador num período. Diária (`date`) ou por período explícito (`periodStart`/`periodEnd`). Os componentes exigidos (valor, numerador, denominador) vêm da estratégia do indicador no catálogo. Destino: `indicator_measurements`.",
  category: "EVENT",
  targetEntity: "indicator_measurements",
  fields: [
    { key: "externalEmployeeId", label: "Matrícula / ID externo", type: "STRING", required: true, identity: true, maxLength: 64, description: "Matrícula do colaborador medido (precisa existir).", example: "OP-10234" },
    { key: "indicatorCode", label: "Código do indicador", type: "STRING", required: true, maxLength: 40, description: "Código do catálogo (precisa existir e estar ativo).", example: "TMA" },
    { key: "date", label: "Dia da medição", type: "DATE", required: false, description: "Dia (calendário da operação) para medição DIÁRIA. Alternativa a periodStart/periodEnd.", example: "2026-09-15" },
    { key: "periodStart", label: "Início do período", type: "DATETIME", required: false, description: "Início do período (ISO 8601) quando não for diária.", example: "2026-09-01T00:00:00-03:00" },
    { key: "periodEnd", label: "Fim do período", type: "DATETIME", required: false, description: "Fim do período (exclusivo, ISO 8601).", example: "2026-10-01T00:00:00-03:00" },
    { key: "granularity", label: "Granularidade", type: "ENUM", required: false, enumValues: MEASUREMENT_GRANULARITIES, description: "DAILY (padrão com `date`), MONTHLY ou CUSTOM (padrão com período explícito).", example: "DAILY" },
    { key: "value", label: "Valor", type: "DECIMAL", required: true, description: "Valor consolidado do período na unidade do indicador.", example: 475 },
    { key: "numerator", label: "Numerador / total", type: "DECIMAL", required: false, description: "Soma das ocorrências ou total. Exigido por Taxa e Média ponderada; em Soma, Média simples e Último valor, a linha com numerador e denominador vai para a quarentena.", example: 9500 },
    { key: "denominator", label: "Denominador / volume", type: "DECIMAL", required: false, description: "Elegíveis ou volume. Exigido por Taxa e Média ponderada; em Soma, Média simples e Último valor, a linha com numerador e denominador vai para a quarentena.", example: 20 },
    { key: "sampleCount", label: "Amostra", type: "INTEGER", required: false, description: "Quantidade de observações (opcional; enriquece a evidência).", example: 20 },
  ],
  naturalKey: ["externalEmployeeId", "indicatorCode", "periodStart", "periodEnd", "source"],
  atLeastOne: [["date", "periodStart"]],
  dependencies: ["EMPLOYEES"],
  writeSemantics: "IDEMPOTENT_EVENT",
  writePolicy: "PARTIAL_ALLOWED",
  businessTimeField: "periodEnd",
  validateRecord: (record) => {
    const errors = []
    const hasDate = typeof record.date === "string"
    const hasStart = typeof record.periodStart === "string"
    const hasEnd = typeof record.periodEnd === "string"
    if (!hasDate && hasStart !== hasEnd) errors.push({ code: "DATA_REQUIRED_FIELD_MISSING" as const, field: hasStart ? "periodEnd" : "periodStart", message: "Período explícito exige início e fim." })
    if (hasStart && hasEnd && String(record.periodEnd) <= String(record.periodStart)) errors.push({ code: "DATA_CONTRACT_VIOLATION" as const, field: "periodEnd", message: "Fim do período precisa ser posterior ao início." })
    if (typeof record.denominator === "number" && record.denominator < 0) errors.push({ code: "DATA_CONTRACT_VIOLATION" as const, field: "denominator", message: "Denominador não pode ser negativo." })
    if (typeof record.sampleCount === "number" && record.sampleCount < 0) errors.push({ code: "DATA_CONTRACT_VIOLATION" as const, field: "sampleCount", message: "Amostra não pode ser negativa." })
    return errors
  },
  examples: [
    { externalEmployeeId: "OP-10234", indicatorCode: "TMA", date: "2026-09-15", periodStart: null, periodEnd: null, granularity: "DAILY", value: 475, numerator: 9500, denominator: 20, sampleCount: 20 },
    { externalEmployeeId: "OP-10234", indicatorCode: "FCR", date: "2026-09-15", periodStart: null, periodEnd: null, granularity: "DAILY", value: 85, numerator: 17, denominator: 20, sampleCount: null },
  ],
}

export const QUARTILES = ["Q1", "Q2", "Q3", "Q4"] as const

const OFFICIAL_ENTITY = {
  key: "OFFICIAL_INDICATOR_PERFORMANCE",
  label: "Fechamento oficial por indicador",
  category: "PERFORMANCE",
  targetEntity: "employee_indicator_performance",
  naturalKey: ["externalEmployeeId", "indicatorCode", "referencePeriod"],
  dependencies: ["EMPLOYEES"],
  writeSemantics: "UPSERT",
  writePolicy: "PARTIAL_ALLOWED",
  businessTimeField: "referencePeriod",
} satisfies Omit<DataContract, "version" | "description" | "fields" | "examples">

const OFFICIAL_FIELDS_V1 = [
  { key: "externalEmployeeId", label: "Matrícula / ID externo", type: "STRING", required: true, identity: true, maxLength: 64, description: "Matrícula do colaborador (precisa existir).", example: "OP-10234" },
  { key: "indicatorCode", label: "Código do indicador", type: "STRING", required: true, maxLength: 40, description: "Código do catálogo (precisa existir, com fechamento oficial habilitado).", example: "TMA" },
  { key: "referencePeriod", label: "Competência", type: "MONTH", required: true, description: "Mês de referência AAAA-MM.", example: "2026-08" },
  { key: "value", label: "Valor", type: "DECIMAL", required: true, description: "Resultado oficial do mês.", example: 468 },
  { key: "targetValue", label: "Meta", type: "DECIMAL", required: false, description: "Meta oficial do mês.", example: 480 },
  { key: "achievementPercent", label: "Atingimento (%)", type: "DECIMAL", required: false, description: "Atingimento oficial, já calculado pela fonte.", example: 102.5 },
  { key: "weightPercent", label: "Peso (%)", type: "DECIMAL", required: false, description: "Peso do indicador na composição do PRV.", example: 25 },
  { key: "quartile", label: "Quartil", type: "ENUM", required: false, enumValues: QUARTILES, description: "Quartil oficial (Q1 = melhor).", example: "Q2" },
  { key: "subgroupExternalCode", label: "Código do Subgrupo", type: "STRING", required: false, maxLength: 128, description: "Subgrupo de referência do fechamento. Ausente = subgrupo atual do colaborador.", example: "B2C_RETENCAO/PREMIUM" },
] as const satisfies readonly DataContractField[]

/** Versão 1 (sem numerador/denominador), congelada: feeds criados antes da versão 2 continuam nela até o mapeamento ser salvo de novo. */
export const OFFICIAL_INDICATOR_PERFORMANCE_CONTRACT_V1: DataContract = {
  ...OFFICIAL_ENTITY,
  version: 1,
  description: "Resultado mensal OFICIAL de um indicador por colaborador: valor, meta, atingimento, peso e quartil já calculados pela fonte oficial — a INIA nunca recalcula. Destino: `employee_indicator_performance`.",
  fields: OFFICIAL_FIELDS_V1,
  examples: [{ externalEmployeeId: "OP-10234", indicatorCode: "TMA", referencePeriod: "2026-08", value: 468, targetValue: 480, achievementPercent: 102.5, weightPercent: 25, quartile: "Q2", subgroupExternalCode: null }],
}

/**
 * Versão 2: o fechamento traz também NUMERADOR e DENOMINADOR do valor oficial, opcionais. Servem para
 * agregar uma estrutura em valor (Σ numeradores ÷ Σ denominadores com o fator da estratégia) e para a
 * contribuição de cada unidade — nunca para recalcular atingimento, PRV, quartil ou peso. A coerência com
 * o valor é decidida pela ESTRATÉGIA do indicador no catálogo (writer), nunca por código; aqui ficam só as
 * regras puras: os dois juntos e denominador positivo.
 */
export const OFFICIAL_INDICATOR_PERFORMANCE_CONTRACT: DataContract = {
  ...OFFICIAL_ENTITY,
  version: 2,
  description: "Resultado mensal OFICIAL de um indicador por colaborador: valor, meta, atingimento, peso e quartil já calculados pela fonte oficial — a INIA nunca recalcula. Numerador e denominador (opcionais) acompanham o valor quando a estratégia do indicador o define por componentes (Taxa, Média ponderada): vêm juntos e precisam conferir com o valor; incoerência vai para a quarentena, nunca é corrigida. Destino: `employee_indicator_performance`.",
  fields: [
    ...OFFICIAL_FIELDS_V1.slice(0, 4),
    { key: "numerator", label: "Numerador / total", type: "DECIMAL", required: false, description: "Total do mês que gera o valor oficial: ocorrências (Taxa) ou soma do total (Média ponderada, ex.: segundos falados). Só para estratégias que definem o valor por componentes; vem junto com o denominador.", example: 380016 },
    { key: "denominator", label: "Denominador / volume", type: "DECIMAL", required: false, description: "Base do mês: elegíveis (Taxa) ou volume (Média ponderada, ex.: atendimentos). Maior que zero; vem junto com o numerador.", example: 812 },
    ...OFFICIAL_FIELDS_V1.slice(4),
  ],
  validateRecord: (record) => {
    const errors = []
    const hasNumerator = typeof record.numerator === "number"
    const hasDenominator = typeof record.denominator === "number"
    if (hasNumerator !== hasDenominator) errors.push({ code: "DATA_CONTRACT_VIOLATION" as const, field: hasNumerator ? "denominator" : "numerator", message: "Numerador e denominador vêm juntos: informe os dois ou nenhum." })
    if (hasDenominator && (record.denominator as number) <= 0) errors.push({ code: "DATA_CONTRACT_VIOLATION" as const, field: "denominator", message: "Denominador precisa ser maior que zero." })
    return errors
  },
  examples: [
    { externalEmployeeId: "OP-10234", indicatorCode: "TMA", referencePeriod: "2026-08", value: 468, numerator: 380016, denominator: 812, targetValue: 480, achievementPercent: 102.5, weightPercent: 25, quartile: "Q2", subgroupExternalCode: null },
    { externalEmployeeId: "OP-10234", indicatorCode: "FCR", referencePeriod: "2026-08", value: 85, numerator: 690, denominator: 812, targetValue: 80, achievementPercent: 106.3, weightPercent: 25, quartile: "Q1", subgroupExternalCode: null },
  ],
}

export const PRV_PERFORMANCE_CONTRACT: DataContract = {
  key: "PRV_PERFORMANCE",
  version: 1,
  label: "PRV consolidado",
  description: "Atingimento consolidado do Programa de Remuneração Variável por colaborador e competência, com quartil — recebido pronto, nunca calculado. Destino: `employee_prv_performance`.",
  category: "PERFORMANCE",
  targetEntity: "employee_prv_performance",
  fields: [
    { key: "externalEmployeeId", label: "Matrícula / ID externo", type: "STRING", required: true, identity: true, maxLength: 64, description: "Matrícula do colaborador (precisa existir).", example: "OP-10234" },
    { key: "referencePeriod", label: "Competência", type: "MONTH", required: true, description: "Mês de referência AAAA-MM.", example: "2026-08" },
    { key: "achievementPercent", label: "Atingimento PRV (%)", type: "DECIMAL", required: true, description: "Atingimento consolidado oficial.", example: 97.8 },
    { key: "quartile", label: "Quartil", type: "ENUM", required: true, enumValues: QUARTILES, description: "Quartil oficial do PRV (Q1 = melhor).", example: "Q2" },
    { key: "subgroupExternalCode", label: "Código do Subgrupo", type: "STRING", required: false, maxLength: 128, description: "Subgrupo de referência. Ausente = subgrupo atual do colaborador.", example: "B2C_RETENCAO/PREMIUM" },
  ],
  naturalKey: ["externalEmployeeId", "referencePeriod"],
  dependencies: ["EMPLOYEES"],
  writeSemantics: "UPSERT",
  writePolicy: "PARTIAL_ALLOWED",
  businessTimeField: "referencePeriod",
  examples: [{ externalEmployeeId: "OP-10234", referencePeriod: "2026-08", achievementPercent: 97.8, quartile: "Q2", subgroupExternalCode: null }],
}
