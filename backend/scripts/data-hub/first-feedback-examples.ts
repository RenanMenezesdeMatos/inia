/**
 * DADOS DE EXEMPLO PARA O PRIMEIRO FEEDBACK (IT-INIA-005) nos BANCOS EXTERNOS DE EXEMPLO da Central de Dados
 * (`docker/external-examples/<banco>/init.sql`). Tudo fictício e determinístico — nunca dado de cliente.
 *
 * Uma instalação limpa (`npm run setup` sem `--demo`, inclusive com NODE_ENV=production) não tem Grupos, metas, chamadas
 * nem fechamento oficial; a massa de exemplo original só trazia `colaboradores` e `medicoes_diarias` (TMA diário de
 * 1 a 20/09/2026). Este script acrescenta, no fim de cada init.sql, o que falta para chegar ao primeiro feedback de
 * monitoria e ao primeiro feedback de indicador — tudo entrando pela Central, como o dado de um cliente entraria:
 *
 *   - `grupos` e `subgrupos`                (contratos Grupos e Subgrupos) e as colunas `grupo`/`subgrupo` em `colaboradores`;
 *   - `metas`                               (Metas: TMA ≤ 300 s para o Grupo);
 *   - `fechamento_mensal`                   (Fechamento oficial por indicador: TMA de agosto e setembro de 2026, 28 operadores);
 *   - `chamadas`                            (Interações: 12 operadores × 12 chamadas por mês; setembro com transcrição).
 *
 * A história que os dados contam (o que "Testar diagnóstico" e o feedback de indicador devem encontrar): Elisa Almeida
 * (EX-0005) tinha TMA oficial de 284 s em agosto e fechou setembro em 321 s, acima da meta de 300 s. Os outros motivos
 * ficaram estáveis; as chamadas de "Contestação de valor" passaram de ~307 s para ~418 s — nelas ela não informa o prazo
 * nem o canal de retorno, deixa o cliente esperando sem aviso e não recapitula. Os colegas de menor TMA atendem o mesmo
 * motivo seguindo o procedimento. As contestações de setembro dela caem em 14–18/09, para que "Testar diagnóstico" (que
 * parte da medição diária de 18/09 e olha 7 dias) também as encontre. Os procedimentos fictícios que as chamadas seguem
 * estão em `docs/instalacao/primeiro-feedback-exemplo/procedimentos/`.
 *
 * O TMA oficial de setembro de cada pessoa é a média, arredondada, das medições diárias do próprio init.sql (o teste ao
 * lado confere); agosto e as durações das chamadas derivam dele por regras fixas daqui.
 *
 *   npx tsx scripts/data-hub/first-feedback-examples.ts   → reescreve o trecho gerado dos quatro init.sql
 *
 * `first-feedback-examples.test.ts` falha se algum init.sql divergir do gerado, se alguma tabela não passar nos contratos
 * da Central com o mapeamento sugerido pela própria tela ou se a localização do diagnóstico deixar de apontar o motivo.
 */
import { readFileSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

export type Engine = "SQLSERVER" | "POSTGRESQL" | "MYSQL" | "MARIADB"
export const ENGINES: readonly Engine[] = ["SQLSERVER", "POSTGRESQL", "MYSQL", "MARIADB"]
export const INIT_SQL_FOLDER: Record<Engine, string> = { SQLSERVER: "sqlserver", POSTGRESQL: "postgres", MYSQL: "mysql", MARIADB: "mariadb" }

export const SECTION_START = "-- >>> DADOS PARA O PRIMEIRO FEEDBACK (IT-INIA-005)"
export const SECTION_END = "-- <<< FIM DOS DADOS PARA O PRIMEIRO FEEDBACK"

// ---------------------------------------------------------------------------------------------
// Estrutura, meta e pessoas
// ---------------------------------------------------------------------------------------------
export const GROUP = { code: "ATENDIMENTO", name: "Atendimento" }
export const SUBGROUPS = [
  { code: "ATENDIMENTO/EQUIPE_A", name: "Equipe A", supervisor: "EX-0001" },
  { code: "ATENDIMENTO/EQUIPE_B", name: "Equipe B", supervisor: "EX-0002" },
] as const
export const INDICATOR_CODE = "TMA"
export const TARGET_SECONDS = 300

/** Equipe de cada matrícula de `colaboradores`: EX-0001 e os ímpares respondem a Ana (Equipe A); EX-0002 e os pares, a Bruno. */
export function subgroupOf(matricula: string): string {
  const number = Number(matricula.slice(3))
  return number === 1 || (number >= 3 && number % 2 === 1) ? SUBGROUPS[0].code : SUBGROUPS[1].code
}
export const COLLABORATORS = Array.from({ length: 30 }, (_, index) => `EX-${String(index + 1).padStart(4, "0")}`)
export const OPERATORS = COLLABORATORS.slice(2)

/** TMA oficial de setembro (s) = média das medições diárias de 1 a 20/09 do init.sql, arredondada. */
export const SEPTEMBER_TMA: Record<string, number> = {
  "EX-0003": 285, "EX-0004": 279, "EX-0005": 321, "EX-0006": 306, "EX-0007": 293, "EX-0008": 313, "EX-0009": 291,
  "EX-0010": 310, "EX-0011": 280, "EX-0012": 280, "EX-0013": 311, "EX-0014": 316, "EX-0015": 305, "EX-0016": 294,
  "EX-0017": 323, "EX-0018": 318, "EX-0019": 310, "EX-0020": 284, "EX-0021": 282, "EX-0022": 275, "EX-0023": 299,
  "EX-0024": 285, "EX-0025": 320, "EX-0026": 277, "EX-0027": 285, "EX-0028": 293, "EX-0029": 255, "EX-0030": 310,
}
/** Variação de agosto para setembro de cada operador, na ordem de OPERATORS (±4%: resultado estável). */
const AUGUST_DRIFT = [-0.03, 0.02, 0, 0.04, -0.02, 0.01, 0.03, -0.04, 0.02, -0.01, -0.03, 0.01, 0.02, -0.02, 0.04, -0.01, 0.03, -0.03, 0.01, 0.02, -0.04, 0, 0.03, -0.02, 0.01, -0.01, 0.02, -0.03]
/** A protagonista: agosto dentro da meta, setembro acima dela — a piora que o feedback de indicador investiga. */
export const PROTAGONIST = "EX-0005"
const PROTAGONIST_AUGUST_TMA = 284

export function augustTma(matricula: string): number {
  if (matricula === PROTAGONIST) return PROTAGONIST_AUGUST_TMA
  return Math.round(SEPTEMBER_TMA[matricula]! * (1 + AUGUST_DRIFT[OPERATORS.indexOf(matricula)]!))
}

// ---------------------------------------------------------------------------------------------
// Fechamento oficial
// ---------------------------------------------------------------------------------------------
export type ClosingRow = { matricula: string; indicador: string; competencia: string; valor: number; meta: number; atingimento: number; quartil: string; atualizado_em: string }

/** Atingimento de um indicador em que menor é melhor = meta ÷ resultado; quartil pela posição entre os 28 (Q1 = melhor). */
function closingsOf(period: string, valueOf: (matricula: string) => number, updatedAt: string): ClosingRow[] {
  const ranked = [...OPERATORS].sort((a, b) => valueOf(a) - valueOf(b) || a.localeCompare(b))
  const quartileOf = (matricula: string) => `Q${Math.floor((ranked.indexOf(matricula) * 4) / ranked.length) + 1}`
  return OPERATORS.map((matricula) => ({
    matricula,
    indicador: INDICATOR_CODE,
    competencia: period,
    valor: valueOf(matricula),
    meta: TARGET_SECONDS,
    atingimento: Math.round((TARGET_SECONDS / valueOf(matricula)) * 1000) / 10,
    quartil: quartileOf(matricula),
    atualizado_em: updatedAt,
  }))
}

export function closingRows(): ClosingRow[] {
  return [...closingsOf("2026-08", augustTma, "2026-09-05 10:00:00"), ...closingsOf("2026-09", (matricula) => SEPTEMBER_TMA[matricula]!, "2026-10-05 10:00:00")]
}

// ---------------------------------------------------------------------------------------------
// Chamadas
// ---------------------------------------------------------------------------------------------
export type Reason = "SEGUNDA_VIA" | "CONTESTACAO" | "REPARO"
export const REASON_LABEL: Record<Reason, string> = { SEGUNDA_VIA: "Segunda via", CONTESTACAO: "Contestação de valor", REPARO: "Reparo de internet" }
const REASONS: readonly Reason[] = ["SEGUNDA_VIA", "CONTESTACAO", "REPARO"]
/** Duração média de cada motivo em relação ao TMA da pessoa (média dos três = 1: a média das chamadas fecha com o TMA). */
const REASON_FACTOR: Record<Reason, number> = { SEGUNDA_VIA: 0.78, CONTESTACAO: 1.08, REPARO: 1.14 }
/** Variação das 4 chamadas de um motivo em torno da média do motivo (média = 1). */
const CALL_JITTER = [0.88, 1.06, 0.97, 1.09]

type Gender = "F" | "M"
/** Operadores com chamadas: 6 de cada equipe (EX-0010, de férias, fica de fora). */
export const CALLERS: readonly { matricula: string; firstName: string; gender: Gender }[] = [
  { matricula: "EX-0003", firstName: "Carla", gender: "F" },
  { matricula: "EX-0004", firstName: "Diego", gender: "M" },
  { matricula: "EX-0005", firstName: "Elisa", gender: "F" },
  { matricula: "EX-0006", firstName: "Fábio", gender: "M" },
  { matricula: "EX-0007", firstName: "Gabriela", gender: "F" },
  { matricula: "EX-0008", firstName: "Heitor", gender: "M" },
  { matricula: "EX-0009", firstName: "Isabela", gender: "F" },
  { matricula: "EX-0011", firstName: "Karina", gender: "F" },
  { matricula: "EX-0012", firstName: "Lucas", gender: "M" },
  { matricula: "EX-0013", firstName: "Marina", gender: "F" },
  { matricula: "EX-0014", firstName: "Nicolas", gender: "M" },
  { matricula: "EX-0016", firstName: "Paulo", gender: "M" },
]
/** Colegas de menor TMA em setembro: atendem "Contestação de valor" seguindo o procedimento (o grupo de referência). */
export const REFERENCE_PEERS = ["EX-0004", "EX-0011", "EX-0012", "EX-0003", "EX-0009"]

/** Duração média (s) de um motivo para uma pessoa num mês. Na protagonista, em setembro, só a contestação piora. */
export function segmentAverage(matricula: string, month: "2026-08" | "2026-09", reason: Reason): number {
  if (matricula === PROTAGONIST && month === "2026-09") {
    if (reason !== "CONTESTACAO") return PROTAGONIST_AUGUST_TMA * REASON_FACTOR[reason]
    return 3 * SEPTEMBER_TMA[matricula]! - PROTAGONIST_AUGUST_TMA * (REASON_FACTOR.SEGUNDA_VIA + REASON_FACTOR.REPARO)
  }
  const tma = month === "2026-08" ? augustTma(matricula) : SEPTEMBER_TMA[matricula]!
  return tma * REASON_FACTOR[reason]
}

/**
 * Agenda da protagonista: "Testar diagnóstico" parte de uma medição DIÁRIA e compara os 7 dias até ela com os 28 anteriores.
 * A medição de 18/09 (a mais recente dela com chamada, a primeira da lista) cobre 12–18/09, onde estão as 4 contestações de
 * setembro; as 4 de agosto ficam em 15/08–11/09. No mês inteiro (o Workflow, pelo fechamento) a história é a mesma.
 */
const PROTAGONIST_DAYS: Record<"2026-08" | "2026-09", Record<Reason, readonly string[]>> = {
  "2026-08": { SEGUNDA_VIA: ["2026-08-03", "2026-08-06", "2026-08-12", "2026-08-31"], CONTESTACAO: ["2026-08-17", "2026-08-20", "2026-08-25", "2026-08-28"], REPARO: ["2026-08-04", "2026-08-10", "2026-08-14", "2026-08-26"] },
  "2026-09": { SEGUNDA_VIA: ["2026-09-01", "2026-09-08", "2026-09-22", "2026-09-28"], CONTESTACAO: ["2026-09-14", "2026-09-15", "2026-09-16", "2026-09-18"], REPARO: ["2026-09-03", "2026-09-10", "2026-09-24", "2026-09-30"] },
}

/** Dias úteis do mês (7/9 é feriado nacional). */
function businessDays(year: number, month: number): string[] {
  const days: string[] = []
  for (let day = 1; day <= 31; day += 1) {
    const date = new Date(Date.UTC(year, month - 1, day))
    if (date.getUTCMonth() !== month - 1) break
    const iso = date.toISOString().slice(0, 10)
    if (date.getUTCDay() === 0 || date.getUTCDay() === 6 || iso === "2026-09-07") continue
    days.push(iso)
  }
  return days
}

const pad = (value: number, size = 2) => String(value).padStart(size, "0")
/** Data/hora LOCAL da operação ("AAAA-MM-DD HH:MM:SS", sem fuso — a Central lê no fuso da organização). */
function addSeconds(local: string, seconds: number): string {
  const base = Date.UTC(Number(local.slice(0, 4)), Number(local.slice(5, 7)) - 1, Number(local.slice(8, 10)), Number(local.slice(11, 13)), Number(local.slice(14, 16)), Number(local.slice(17, 19)))
  return new Date(base + seconds * 1000).toISOString().slice(0, 19).replace("T", " ")
}

export type CallRow = { id_chamada: string; matricula: string; canal: string; motivo: string; inicio: string; fim: string; transcricao: string | null; atualizado_em: string }

export function callRows(): CallRow[] {
  const rows: CallRow[] = []
  for (const month of ["2026-08", "2026-09"] as const) {
    const days = businessDays(2026, Number(month.slice(5)))
    let sequence = 0
    CALLERS.forEach((caller, callerIndex) => {
      const perReason: Record<Reason, number> = { SEGUNDA_VIA: 0, CONTESTACAO: 0, REPARO: 0 }
      for (let index = 0; index < 12; index += 1) {
        const reason = REASONS[(index + callerIndex) % 3]!
        const k = perReason[reason]++
        const day = caller.matricula === PROTAGONIST ? PROTAGONIST_DAYS[month][reason][k]! : days[Math.floor((index * days.length) / 12) + (callerIndex % 2)]!
        const start = `${day} ${pad(8 + ((callerIndex * 2 + index * 5) % 9))}:${pad((callerIndex * 13 + index * 7) % 60)}:${pad((callerIndex * 17 + index * 23) % 60)}`
        const duration = Math.round(segmentAverage(caller.matricula, month, reason) * CALL_JITTER[k]!)
        const end = addSeconds(start, duration)
        sequence += 1
        rows.push({
          id_chamada: `CH-${month.replace("-", "")}-${pad(sequence, 4)}`,
          matricula: caller.matricula,
          canal: "VOICE",
          motivo: REASON_LABEL[reason],
          inicio: start,
          fim: end,
          // Agosto só com a duração (base de comparação do mês anterior); setembro com a conversa.
          transcricao: month === "2026-09" ? transcriptOf({ caller, callerIndex, index, reason, k, start }) : null,
          atualizado_em: addSeconds(end, 3600),
        })
      }
    })
  }
  return rows
}

// ---------------------------------------------------------------------------------------------
// Transcrições (uma fala por linha: "Operador: …" / "Cliente: …")
// ---------------------------------------------------------------------------------------------
type Conduct = "GOOD" | "MINOR" | "SLOW_A" | "SLOW_B"
/** Quem segue o procedimento e onde escorrega: a protagonista erra na contestação; os demais escorregam pouco. */
function conductOf(matricula: string, callerIndex: number, reason: Reason, k: number): Conduct {
  if (matricula === PROTAGONIST) {
    if (reason === "CONTESTACAO") return k % 2 === 0 ? "SLOW_A" : "SLOW_B"
    return (reason === "SEGUNDA_VIA" && k === 2) || (reason === "REPARO" && k === 1) ? "MINOR" : "GOOD"
  }
  if (reason === "CONTESTACAO") return REFERENCE_PEERS.includes(matricula) || (k + callerIndex) % 2 === 0 ? "GOOD" : "MINOR"
  const slip = reason === "SEGUNDA_VIA" ? callerIndex % 4 : (callerIndex + 2) % 4
  return k === slip ? "MINOR" : "GOOD"
}

const CUSTOMERS: readonly { first: string; full: string; gender: Gender; birth: string }[] = [
  { first: "Marcos", full: "Marcos Teixeira Dantas", gender: "M", birth: "12 de março de 1985" },
  { first: "Patrícia", full: "Patrícia Nunes Viana", gender: "F", birth: "3 de julho de 1990" },
  { first: "Renato", full: "Renato Prado Lacerda", gender: "M", birth: "21 de outubro de 1978" },
  { first: "Sílvia", full: "Sílvia Campos Ferraz", gender: "F", birth: "8 de janeiro de 1969" },
  { first: "Aline", full: "Aline Moura Bastos", gender: "F", birth: "30 de maio de 1995" },
  { first: "Gustavo", full: "Gustavo Reis Amaral", gender: "M", birth: "14 de fevereiro de 1988" },
  { first: "Helena", full: "Helena Duarte Pinheiro", gender: "F", birth: "27 de setembro de 1972" },
  { first: "Igor", full: "Igor Matos Siqueira", gender: "M", birth: "5 de dezembro de 1999" },
  { first: "Luana", full: "Luana Freitas Brandão", gender: "F", birth: "19 de agosto de 1993" },
  { first: "Otávio", full: "Otávio Sales Carvalho", gender: "M", birth: "2 de abril de 1981" },
  { first: "Priscila", full: "Priscila Lopes Guerra", gender: "F", birth: "11 de novembro de 1986" },
  { first: "Sérgio", full: "Sérgio Vidal Monteiro", gender: "M", birth: "23 de junho de 1965" },
  { first: "Tânia", full: "Tânia Rezende Cunha", gender: "F", birth: "16 de março de 1976" },
  { first: "Valter", full: "Valter Moreira Paiva", gender: "M", birth: "9 de setembro de 1959" },
  { first: "Yasmin", full: "Yasmin Castro Leal", gender: "F", birth: "28 de fevereiro de 2001" },
  { first: "Wagner", full: "Wagner Queiroz Tavares", gender: "M", birth: "7 de julho de 1983" },
  { first: "Fernanda", full: "Fernanda Lima Aragão", gender: "F", birth: "13 de outubro de 1991" },
]
const CHARGES = [
  { item: "pacote de streaming", value: "R$ 29,90" },
  { item: "chamadas para outra operadora", value: "R$ 47,30" },
  { item: "serviço de backup em nuvem", value: "R$ 14,90" },
  { item: "roaming nacional", value: "R$ 62,00" },
  { item: "seguro do aparelho", value: "R$ 19,90" },
]
const OUTAGE_SINCE = ["ontem à noite", "hoje cedo", "o fim de semana", "ontem à tarde"]

type CallContext = { caller: (typeof CALLERS)[number]; callerIndex: number; index: number; reason: Reason; k: number; start: string }

function transcriptOf(context: CallContext): string {
  const { caller, callerIndex, index, reason, k, start } = context
  const customer = CUSTOMERS[(callerIndex * 5 + index) % CUSTOMERS.length]!
  const charge = CHARGES[(callerIndex + index) % CHARGES.length]!
  const morning = Number(start.slice(11, 13)) < 12
  const vars = {
    op: caller.firstName,
    art: caller.gender === "F" ? "a" : "o",
    opThanks: caller.gender === "F" ? "Obrigada" : "Obrigado",
    cli: customer.first,
    o: customer.gender === "F" ? "a" : "o",
    full: customer.full,
    birth: customer.birth,
    cliThanks: customer.gender === "F" ? "obrigada" : "obrigado",
    CliThanks: customer.gender === "F" ? "Obrigada" : "Obrigado",
    calm: customer.gender === "F" ? "tranquila" : "tranquilo",
    greet: morning ? "bom dia" : "boa tarde",
    farewell: morning ? "um bom dia" : "uma boa tarde",
    item: charge.item,
    value: charge.value,
    protocol: `${start.slice(0, 10).replaceAll("-", "")}-${caller.matricula.slice(5)}${pad(index)}`,
    email: `${customer.first.normalize("NFD").replace(/[\u0300-\u036f]/g, "").charAt(0).toLowerCase()}***@exemplo.com.br`,
    phone: `(11) 90000-${pad((callerIndex * 12 + index) % 100, 4)}`,
    since: OUTAGE_SINCE[(callerIndex + k) % OUTAGE_SINCE.length]!,
  }
  const lines = TEMPLATES[reason][conductOf(caller.matricula, callerIndex, reason, k)]
  if (!lines) throw new Error(`Sem roteiro para ${reason}/${conductOf(caller.matricula, callerIndex, reason, k)}`)
  return lines.map((line) => line.replace(/\{(\w+)\}/g, (_, key: string) => {
    const value = (vars as Record<string, string>)[key]
    if (value === undefined) throw new Error(`Variável desconhecida no roteiro: ${key}`)
    return value
  })).join("\n")
}

const TEMPLATES: Record<Reason, Partial<Record<Conduct, readonly string[]>>> = {
  SEGUNDA_VIA: {
    GOOD: [
      "Operador: Exemplo Telecom, {greet}, meu nome é {op}. Com quem eu falo?",
      "Cliente: Oi, aqui é {o} {cli}. Preciso da segunda via da minha conta.",
      "Operador: Claro, {cli}. Para sua segurança, me confirma o nome completo e a data de nascimento do titular?",
      "Cliente: {full}, {birth}.",
      "Operador: {opThanks}, dados confirmados. Você prefere receber a segunda via por e-mail ou por SMS?",
      "Cliente: Por e-mail.",
      "Operador: O e-mail cadastrado é {email}. Está correto?",
      "Cliente: Está sim.",
      "Operador: Pronto, enviei a segunda via para o seu e-mail. Ela chega em até dez minutos.",
      "Cliente: Ótimo.",
      "Operador: O seu protocolo é {protocol}. Ficou alguma dúvida?",
      "Cliente: Não, era só isso. {CliThanks}.",
      "Operador: Eu que agradeço o contato, {cli}. Tenha {farewell}.",
    ],
    MINOR: [
      "Operador: Exemplo Telecom, {greet}, meu nome é {op}.",
      "Cliente: Oi, eu quero a segunda via da conta deste mês.",
      "Operador: Me confirma o nome completo e a data de nascimento do titular, por favor?",
      "Cliente: {full}, {birth}.",
      "Operador: Certo. Vou mandar para o e-mail que está no cadastro.",
      "Cliente: Pode ser.",
      "Operador: Enviado. O protocolo é {protocol}.",
      "Cliente: Tá bom, {cliThanks}.",
      "Operador: Mais alguma dúvida?",
      "Cliente: Não.",
      "Operador: Então {opThanks} pelo contato. Tenha {farewell}.",
    ],
  },
  CONTESTACAO: {
    GOOD: [
      "Operador: Exemplo Telecom, {greet}, meu nome é {op}. Com quem eu falo?",
      "Cliente: Aqui é {o} {cli}. Quero contestar um valor que veio na minha conta.",
      "Operador: Claro, {cli}. Para sua segurança, me confirma o nome completo e a data de nascimento do titular?",
      "Cliente: {full}, {birth}.",
      "Operador: {opThanks}. Qual item da conta você quer contestar?",
      "Cliente: Veio uma cobrança de {item} de {value} que eu não contratei.",
      "Operador: Entendi: a cobrança de {item}, no valor de {value}, que você não reconhece. É isso?",
      "Cliente: Isso mesmo.",
      "Operador: Vou abrir a contestação no sistema. Leva cerca de um minuto, peço que aguarde na linha.",
      "Operador: {opThanks} por aguardar, {cli}. A contestação está aberta. A análise leva até cinco dias úteis e o resultado chega por SMS.",
      "Cliente: Certo.",
      "Operador: Recapitulando: contestação da cobrança de {item}, análise em até cinco dias úteis e retorno por SMS. O seu protocolo é {protocol}. Ficou alguma dúvida?",
      "Cliente: Não, ficou claro. {CliThanks}.",
      "Operador: Eu que agradeço o contato, {cli}. Tenha {farewell}.",
    ],
    MINOR: [
      "Operador: Exemplo Telecom, {greet}, meu nome é {op}.",
      "Cliente: Oi, tem um valor errado na minha conta.",
      "Operador: Me confirma o nome completo e a data de nascimento do titular, por favor?",
      "Cliente: {full}, {birth}.",
      "Operador: Qual é o valor?",
      "Cliente: {value} de {item}. Eu nunca usei isso.",
      "Operador: Um momento que eu vou verificar, já retorno.",
      "Operador: Abri a contestação. A análise leva até cinco dias úteis e o resultado chega por SMS.",
      "Cliente: Tá certo, {cliThanks}.",
      "Operador: Por nada. Tenha {farewell}.",
    ],
    SLOW_A: [
      "Operador: Exemplo Telecom, {greet}, aqui é {art} {op}.",
      "Cliente: Oi, {greet}. Eu queria contestar um valor da minha conta.",
      "Operador: Me passa o nome completo e a data de nascimento do titular.",
      "Cliente: {full}, {birth}.",
      "Operador: E qual é a cobrança?",
      "Cliente: Uma cobrança de {item} de {value}. Eu não contratei isso.",
      "Operador: Deixa eu ver aqui.",
      "Cliente: Alô? Ainda está na linha?",
      "Operador: Estou sim, o sistema está lento hoje.",
      "Cliente: Tá. E então, vocês vão tirar esse valor?",
      "Operador: Essa cobrança aparece como serviço adicional na sua linha.",
      "Cliente: Mas eu não pedi serviço nenhum. Eu quero contestar.",
      "Operador: Tá bom, vou abrir a contestação. É só aguardar.",
      "Cliente: Aguardar quanto tempo? E como eu vou saber o resultado?",
      "Operador: Vai para análise e depois você recebe o retorno.",
      "Cliente: Recebo por onde? Vou ter que ligar de novo?",
      "Operador: Não precisa, o retorno chega. Pode ficar {calm}.",
      "Cliente: Tá bom então.",
      "Operador: Mais alguma coisa?",
      "Cliente: Não.",
      "Operador: Tchau, tenha {farewell}.",
    ],
    SLOW_B: [
      "Operador: Exemplo Telecom, {greet}, meu nome é {op}. Com quem eu falo?",
      "Cliente: É {o} {cli}. Tem uma cobrança na minha conta que eu não reconheço.",
      "Operador: {cli}, me confirma o nome completo e a data de nascimento do titular?",
      "Cliente: {full}, {birth}.",
      "Operador: Qual cobrança?",
      "Cliente: {item}, {value}.",
      "Cliente: Oi? Você ainda está aí?",
      "Operador: Estou, estava consultando. Qual era mesmo o serviço?",
      "Cliente: {item}. Eu já falei, eu não contratei.",
      "Operador: Certo. Vou registrar a contestação. O protocolo é {protocol}.",
      "Cliente: E em quanto tempo eu tenho uma resposta?",
      "Operador: Depende da análise, a área responsável vai verificar.",
      "Cliente: Mas vão me avisar como?",
      "Operador: Vão entrar em contato com você.",
      "Cliente: Tá bom.",
      "Operador: {opThanks}, tenha {farewell}.",
    ],
  },
  REPARO: {
    GOOD: [
      "Operador: Exemplo Telecom, {greet}, meu nome é {op}. Com quem eu falo?",
      "Cliente: Aqui é {o} {cli}. Minha internet parou de funcionar desde {since}.",
      "Operador: Sinto muito, {cli}. Para sua segurança, me confirma o nome completo e a data de nascimento do titular?",
      "Cliente: {full}, {birth}.",
      "Operador: {opThanks}. Verifiquei aqui e não há falha geral na sua região. Você pode desligar o modem da tomada, esperar trinta segundos e ligar de novo?",
      "Cliente: Pronto, reiniciei. As luzes acenderam, mas continua sem internet.",
      "Operador: Entendi. Vou abrir o reparo. O técnico entra em contato em até 24 horas para agendar a visita. Qual telefone é melhor para o contato?",
      "Cliente: Pode ser este mesmo, {phone}.",
      "Operador: Anotado: {phone}. O seu protocolo é {protocol}. Ficou alguma dúvida?",
      "Cliente: Não, {cliThanks}.",
      "Operador: Eu que agradeço o contato, {cli}. Tenha {farewell}.",
    ],
    MINOR: [
      "Operador: Exemplo Telecom, {greet}, meu nome é {op}.",
      "Cliente: Oi, estou sem internet desde {since}.",
      "Operador: Me confirma o nome completo e a data de nascimento do titular?",
      "Cliente: {full}, {birth}.",
      "Operador: Não tem falha geral na sua região. Vou abrir um reparo.",
      "Cliente: E quando vem alguém?",
      "Operador: O técnico entra em contato em até 24 horas para agendar a visita. O protocolo é {protocol}.",
      "Cliente: Tá bom, {cliThanks}.",
      "Operador: Mais alguma dúvida?",
      "Cliente: Não.",
      "Operador: Tenha {farewell}.",
    ],
  },
}

// ---------------------------------------------------------------------------------------------
// Tabelas (o que a Central lê) e SQL por banco
// ---------------------------------------------------------------------------------------------
type ColumnKind = { kind: "code"; size: number } | { kind: "label"; size: number } | { kind: "longtext" } | { kind: "datetime" } | { kind: "date" } | { kind: "decimal"; precision: number; scale: number } | { kind: "month" } | { kind: "integer" }
export type Cell = string | number | null
export type ExampleTable = {
  name: string
  /** Contrato da Central que a tabela alimenta (usado pelo teste com o mapeamento sugerido). */
  contractKey: string
  comment: string
  columns: { name: string; type: ColumnKind; nullable?: boolean }[]
  primaryKey: string[]
  rows: Record<string, Cell>[]
}

export function exampleTables(): ExampleTable[] {
  return [
    {
      name: "grupos",
      contractKey: "GROUPS",
      comment: "Grupo da operação (conjunto de dados Grupos).",
      columns: [{ name: "codigo", type: { kind: "code", size: 64 } }, { name: "nome", type: { kind: "label", size: 120 } }, { name: "atualizado_em", type: { kind: "datetime" } }],
      primaryKey: ["codigo"],
      rows: [{ codigo: GROUP.code, nome: GROUP.name, atualizado_em: "2026-10-01 08:00:00" }],
    },
    {
      name: "subgrupos",
      contractKey: "SUBGROUPS",
      comment: "Uma equipe por supervisor (conjunto de dados Subgrupos).",
      columns: [{ name: "codigo", type: { kind: "code", size: 128 } }, { name: "grupo", type: { kind: "code", size: 64 } }, { name: "nome", type: { kind: "label", size: 120 } }, { name: "atualizado_em", type: { kind: "datetime" } }],
      primaryKey: ["codigo"],
      rows: SUBGROUPS.map((subgroup) => ({ codigo: subgroup.code, grupo: GROUP.code, nome: subgroup.name, atualizado_em: "2026-10-01 08:00:00" })),
    },
    {
      name: "metas",
      contractKey: "GOALS",
      comment: "Meta vigente do TMA para o Grupo, em segundos (conjunto de dados Metas).",
      columns: [
        { name: "id", type: { kind: "integer" } },
        { name: "indicador", type: { kind: "code", size: 40 } },
        { name: "tipo_sujeito", type: { kind: "code", size: 20 } },
        { name: "sujeito", type: { kind: "code", size: 128 } },
        { name: "meta", type: { kind: "decimal", precision: 12, scale: 2 } },
        { name: "inicio_vigencia", type: { kind: "date" } },
        { name: "fim_vigencia", type: { kind: "date" }, nullable: true },
        { name: "atualizado_em", type: { kind: "datetime" } },
      ],
      primaryKey: ["id"],
      rows: [{ id: 1, indicador: INDICATOR_CODE, tipo_sujeito: "GROUP", sujeito: GROUP.code, meta: TARGET_SECONDS, inicio_vigencia: "2026-01-01", fim_vigencia: null, atualizado_em: "2026-10-01 08:00:00" }],
    },
    {
      name: "fechamento_mensal",
      contractKey: "OFFICIAL_INDICATOR_PERFORMANCE",
      comment: "Resultado OFICIAL do mês por operador, já calculado pela fonte: valor, meta, atingimento e quartil (conjunto de dados Fechamento oficial por indicador).",
      columns: [
        { name: "matricula", type: { kind: "code", size: 20 } },
        { name: "indicador", type: { kind: "code", size: 40 } },
        { name: "competencia", type: { kind: "month" } },
        { name: "valor", type: { kind: "decimal", precision: 12, scale: 2 } },
        { name: "meta", type: { kind: "decimal", precision: 12, scale: 2 } },
        { name: "atingimento", type: { kind: "decimal", precision: 6, scale: 1 } },
        { name: "quartil", type: { kind: "code", size: 2 } },
        { name: "atualizado_em", type: { kind: "datetime" } },
      ],
      primaryKey: ["matricula", "indicador", "competencia"],
      rows: closingRows(),
    },
    {
      name: "chamadas",
      contractKey: "INTERACTIONS",
      comment: "Chamadas de voz com motivo, início e fim (horário da operação); setembro com a transcrição, uma fala por linha (conjunto de dados Interações).",
      columns: [
        { name: "id_chamada", type: { kind: "code", size: 40 } },
        { name: "matricula", type: { kind: "code", size: 20 } },
        { name: "canal", type: { kind: "code", size: 20 } },
        { name: "motivo", type: { kind: "label", size: 120 } },
        { name: "inicio", type: { kind: "datetime" } },
        { name: "fim", type: { kind: "datetime" } },
        { name: "transcricao", type: { kind: "longtext" }, nullable: true },
        { name: "atualizado_em", type: { kind: "datetime" } },
      ],
      primaryKey: ["id_chamada"],
      rows: callRows(),
    },
  ]
}

/** Grupo e Subgrupo de cada colaborador (colunas novas em `colaboradores`) e o novo "atualizado em" (a leitura incremental relê as 30 linhas). */
export function collaboratorPlacement(): { matricula: string; grupo: string; subgrupo: string; atualizado_em: string }[] {
  return COLLABORATORS.map((matricula, index) => ({ matricula, grupo: GROUP.code, subgrupo: subgroupOf(matricula), atualizado_em: addSeconds("2026-10-01 08:00:00", index + 1) }))
}

function sqlType(engine: Engine, type: ColumnKind): string {
  switch (type.kind) {
    case "code":
      return `varchar(${type.size})`
    case "label":
      return engine === "SQLSERVER" ? `nvarchar(${type.size})` : `varchar(${type.size})`
    case "longtext":
      return engine === "SQLSERVER" ? "nvarchar(max)" : "text"
    case "datetime":
      return engine === "SQLSERVER" ? "datetime2(0)" : engine === "POSTGRESQL" ? "timestamp(0)" : "datetime(0)"
    case "date":
      return "date"
    case "decimal":
      return engine === "POSTGRESQL" ? `numeric(${type.precision},${type.scale})` : `decimal(${type.precision},${type.scale})`
    case "month":
      return "char(7)"
    case "integer":
      return "int"
  }
}

function literal(engine: Engine, value: Cell, type: ColumnKind): string {
  if (value === null) return "null"
  if (typeof value === "number") return String(value)
  // MySQL/MariaDB tratam "\" como escape dentro de aspas; os outros, não.
  const escaped = (engine === "MYSQL" || engine === "MARIADB" ? value.replaceAll("\\", "\\\\") : value).replaceAll("'", "''")
  return engine === "SQLSERVER" && (type.kind === "label" || type.kind === "longtext") ? `N'${escaped}'` : `'${escaped}'`
}

function qualified(engine: Engine, name: string): string {
  return engine === "SQLSERVER" ? `dbo.${name}` : name
}

function createTable(engine: Engine, table: ExampleTable): string {
  const columns = table.columns.map((column) => `  ${column.name} ${sqlType(engine, column.type)} ${column.nullable ? "null" : "not null"},`)
  const charset = engine === "MYSQL" || engine === "MARIADB" ? " character set utf8mb4" : ""
  return `create table ${qualified(engine, table.name)} (\n${columns.join("\n")}\n  primary key (${table.primaryKey.join(", ")})\n)${charset};`
}

function insertRows(engine: Engine, table: ExampleTable): string {
  const names = table.columns.map((column) => column.name)
  const values = table.rows.map((row) => `  (${table.columns.map((column) => literal(engine, row[column.name] ?? null, column.type)).join(", ")})`)
  return `insert into ${qualified(engine, table.name)} (${names.join(", ")}) values\n${values.join(",\n")};`
}

function header(engine: Engine): string[] {
  const calls = callRows()
  const transcribed = calls.filter((call) => call.transcricao !== null).length
  return [
    SECTION_START,
    "-- Gerado por backend/scripts/data-hub/first-feedback-examples.ts — não edite à mão: mude o script e rode-o de novo.",
    "-- Tudo fictício. Completa a massa acima com o que a IT-INIA-005 precisa numa instalação limpa:",
    `--   grupos e subgrupos (1 + ${SUBGROUPS.length}), grupo/subgrupo em colaboradores, metas (TMA ≤ ${TARGET_SECONDS} s), fechamento_mensal (TMA de`,
    `--   2026-08 e 2026-09, ${closingRows().length} linhas) e chamadas (${calls.length}: agosto só com a duração; setembro, ${transcribed}, com a transcrição).`,
    "-- Ordem de carga na Central, o que mapear e o que conferir: docs/instalacao/primeiro-feedback-exemplo/README.md",
    ...(engine === "SQLSERVER" ? ["-- Idempotente: rodar de novo não duplica nada (um banco criado antes recebe as colunas e as tabelas novas)."] : []),
  ]
}

/** Trecho gerado de um init.sql (do marcador de início ao de fim, sem quebra de linha final). */
export function renderSection(engine: Engine): string {
  const tables = exampleTables()
  const placement = collaboratorPlacement()
  const out: string[] = [...header(engine), ""]
  out.push("-- Grupo e Subgrupo de cada colaborador (colunas acrescentadas em 14/10/2026).")
  if (engine === "SQLSERVER") {
    out.push("if col_length('dbo.colaboradores', 'grupo') is null alter table dbo.colaboradores add grupo varchar(64) null, subgrupo varchar(128) null;", "go")
  } else {
    out.push("alter table colaboradores add column grupo varchar(64) null, add column subgrupo varchar(128) null;")
  }
  for (const row of placement) out.push(`update ${qualified(engine, "colaboradores")} set grupo = '${row.grupo}', subgrupo = '${row.subgrupo}', atualizado_em = '${row.atualizado_em}' where matricula = '${row.matricula}';`)
  if (engine === "SQLSERVER") out.push("go")
  for (const table of tables) {
    out.push("", `-- ${table.comment}`)
    if (engine === "SQLSERVER") {
      out.push(`if object_id('dbo.${table.name}') is null`, "begin", createTable(engine, table), insertRows(engine, table), "end", "go")
    } else {
      out.push(createTable(engine, table), insertRows(engine, table))
    }
  }
  if (engine === "POSTGRESQL") out.push("", `grant select on ${tables.map((table) => table.name).join(", ")} to inia_leitura;`)
  out.push(SECTION_END)
  return out.join("\n")
}

/** Substitui o trecho gerado (ou acrescenta no fim, na primeira vez) mantendo o resto do arquivo intacto. */
export function withSection(fileText: string, section: string): string {
  const start = fileText.indexOf(SECTION_START)
  const end = fileText.indexOf(SECTION_END)
  if (start === -1 && end === -1) return `${fileText.trimEnd()}\n\n${section}\n`
  if (start === -1 || end === -1 || end < start) throw new Error("Marcadores do trecho gerado incompletos ou fora de ordem no init.sql.")
  return `${fileText.slice(0, start)}${section}${fileText.slice(end + SECTION_END.length)}`
}

export const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..")
export const initSqlPath = (engine: Engine) => resolve(REPOSITORY_ROOT, "docker/external-examples", INIT_SQL_FOLDER[engine], "init.sql")

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  for (const engine of ENGINES) {
    const path = initSqlPath(engine)
    const before = readFileSync(path, "utf8")
    const after = withSection(before, renderSection(engine))
    if (after !== before) writeFileSync(path, after)
    console.log(`${after === before ? "=" : "✓"} ${path.slice(REPOSITORY_ROOT.length + 1)}`)
  }
}
