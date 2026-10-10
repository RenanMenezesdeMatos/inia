/**
 * CATÁLOGO-BASE DE FERIADOS — reference data com PROVENIÊNCIA (não é massa demo; entra por
 * `npm run db:seed:reference`). Regras, não datas soltas: cada regra é expandida para os anos
 * cobertos (HOLIDAY_CATALOG_YEARS) e carrega fonte verificável + base legal quando existe.
 *
 * Critérios (pedido de negócio, 2026-09):
 *  - só FERIADO com base legal — ponto facultativo (Carnaval/Corpus Christi federais, vésperas,
 *    "dia do servidor") NÃO entra; Carnaval/Corpus Christi entram SÓ onde uma lei estadual/municipal
 *    os declara feriado (RJ, DF, Manaus, BH…);
 *  - nada "porque sabemos": o que não foi verificado fica em HOLIDAY_CATALOG_GAPS (relatório), não no
 *    banco; `verification` diz quão forte é a fonte (OFFICIAL = ato/portal oficial; LEGAL_DATABASE =
 *    base de legislação; SECONDARY = agregador/imprensa citando a lei);
 *  - feriado extraordinário de UM ano tem só aquela data (`dates`), nunca vira recorrente;
 *  - o motor nunca conhece estas datas: consulta a tabela `holiday_catalog`.
 * Móveis: Sexta-feira Santa = Páscoa−2; Carnaval (terça) = Páscoa−47; Corpus Christi = Páscoa+60;
 * N. Sra. da Penha (ES) = Páscoa+8 (segunda). SC: Data Magna transferida para o domingo seguinte
 * quando cai em dia útil (Lei 18.531/2022).
 */
export const HOLIDAY_CATALOG_YEARS = [2026, 2027, 2028] as const

export type HolidayVerification = "OFFICIAL" | "LEGAL_DATABASE" | "SECONDARY"

export type HolidayRule = {
  name: string
  scope: "NATIONAL" | "STATE" | "MUNICIPAL_CAPITAL"
  stateCode?: string
  capitalCode?: string
  /** Data fixa (mês/dia) — recorrente em todos os anos cobertos. */
  month?: number
  day?: number
  /** Data móvel: deslocamento em dias a partir do Domingo de Páscoa. */
  easterOffset?: number
  /** Datas explícitas (feriado extraordinário de um ano específico). */
  dates?: string[]
  /** Ajuste especial (SC: transferido para o domingo seguinte quando cai em dia útil). */
  adjust?: "SUNDAY_AFTER_IF_WEEKDAY"
  sourceName: string
  sourceReference: string
  legalReference?: string
  verification: HolidayVerification
}

const MGI_2026 = { sourceName: "Portaria MGI nº 11.460/2025 (feriados nacionais 2026)", sourceReference: "https://www.legisweb.com.br/legislacao/?id=488776", verification: "OFFICIAL" as const }

export const NATIONAL_HOLIDAY_RULES: HolidayRule[] = [
  { name: "Confraternização Universal", scope: "NATIONAL", month: 1, day: 1, ...MGI_2026, legalReference: "Lei federal nº 662/1949, art. 1º (redação da Lei nº 10.607/2002)" },
  { name: "Paixão de Cristo (Sexta-feira Santa)", scope: "NATIONAL", easterOffset: -2, ...MGI_2026, legalReference: "Lei federal nº 9.093/1995, art. 2º; listada como feriado nacional na Portaria MGI nº 11.460/2025" },
  { name: "Tiradentes", scope: "NATIONAL", month: 4, day: 21, ...MGI_2026, legalReference: "Lei federal nº 662/1949, art. 1º (redação da Lei nº 10.607/2002)" },
  { name: "Dia Mundial do Trabalho", scope: "NATIONAL", month: 5, day: 1, ...MGI_2026, legalReference: "Lei federal nº 662/1949, art. 1º (redação da Lei nº 10.607/2002)" },
  { name: "Independência do Brasil", scope: "NATIONAL", month: 9, day: 7, ...MGI_2026, legalReference: "Lei federal nº 662/1949, art. 1º (redação da Lei nº 10.607/2002)" },
  { name: "Nossa Senhora Aparecida", scope: "NATIONAL", month: 10, day: 12, ...MGI_2026, legalReference: "Lei federal nº 6.802/1980" },
  { name: "Finados", scope: "NATIONAL", month: 11, day: 2, ...MGI_2026, legalReference: "Lei federal nº 662/1949, art. 1º (redação da Lei nº 10.607/2002)" },
  { name: "Proclamação da República", scope: "NATIONAL", month: 11, day: 15, ...MGI_2026, legalReference: "Lei federal nº 662/1949, art. 1º (redação da Lei nº 10.607/2002)" },
  { name: "Dia Nacional de Zumbi e da Consciência Negra", scope: "NATIONAL", month: 11, day: 20, ...MGI_2026, legalReference: "Lei federal nº 14.759/2023" },
  { name: "Natal", scope: "NATIONAL", month: 12, day: 25, ...MGI_2026, legalReference: "Lei federal nº 662/1949, art. 1º (redação da Lei nº 10.607/2002)" },
]

const state = (stateCode: string, name: string, rest: Omit<HolidayRule, "scope" | "stateCode" | "name">): HolidayRule => ({ scope: "STATE", stateCode, name, ...rest })
const capital = (capitalCode: string, name: string, rest: Omit<HolidayRule, "scope" | "capitalCode" | "name">): HolidayRule => ({ scope: "MUNICIPAL_CAPITAL", capitalCode, name, ...rest })

const AC_DECREE = { sourceName: "Decreto estadual AC nº 11.809/2025 (feriados 2026)", sourceReference: "https://www.legisweb.com.br/legislacao/?id=489228", verification: "OFFICIAL" as const }
const AL_DECREE = { sourceName: "Decreto estadual AL nº 106.093/2025 (feriados 2026)", sourceReference: "https://www.legisweb.com.br/legislacao/?id=488778", verification: "OFFICIAL" as const }
const WIKI = { sourceName: "Feriados no Brasil — Wikipédia (tabela de feriados estaduais, com lei citada)", sourceReference: "https://pt.wikipedia.org/wiki/Feriados_no_Brasil", verification: "SECONDARY" as const }
const DF_DECREE = { sourceName: "Decreto distrital nº 48.117/2025 (feriados 2026)", sourceReference: "https://www.sinj.df.gov.br/sinj/Norma/dd13897d3d894936940fbd58e2161541/Decreto_48117_30_12_2025.html", verification: "OFFICIAL" as const }
const ES_DECREE = { sourceName: "Decreto estadual ES nº 124-S/2026 (feriados 2026)", sourceReference: "https://www.legisweb.com.br/legislacao/?id=489811", verification: "OFFICIAL" as const }
const MS_DECREE = { sourceName: "Decreto estadual MS nº 46-E/2025 (feriados 2026)", sourceReference: "https://www.legisweb.com.br/legislacao/?id=486789", verification: "OFFICIAL" as const }
const MA_DECREE = { sourceName: "Decreto estadual MA nº 41.231/2025 (feriados 2026)", sourceReference: "https://www.legisweb.com.br/legislacao/?id=488221", verification: "OFFICIAL" as const }
const PA_DECREE = { sourceName: "Decreto estadual PA nº 5.122/2025 (feriados 2026)", sourceReference: "https://www.legisweb.com.br/legislacao/?id=488293", verification: "OFFICIAL" as const }
const PB_JF = { sourceName: "Portaria da Direção do Foro SJPB nº 1/2026 (feriados 2026)", sourceReference: "https://sistemas.jfpb.jus.br/media/diario_feriados_2026.pdf", verification: "OFFICIAL" as const }
const PE_JF = { sourceName: "Justiça Federal em Pernambuco — feriados 2026", sourceReference: "https://www.jfpe.jus.br/index.php/feriados.html", verification: "OFFICIAL" as const }
const CE_TJ = { sourceName: "Portaria TJCE nº 24/2025 (feriados e pontos facultativos)", sourceReference: "https://portal.tjce.jus.br/uploads/2025/01/PORTARIA-No-24_2025-FERIADOS-2025.pdf", verification: "OFFICIAL" as const }
const RJ_SIND = { sourceName: "SindRio — feriados e pontos facultativos 2026 (com leis citadas)", sourceReference: "https://www.sindrio.com.br/2025/12/2026-confira-feriados-e-pontos-facultativos/", verification: "SECONDARY" as const }
const RO_DECREE = { sourceName: "Decreto estadual RO nº 31.210/2026 (feriados 2026)", sourceReference: "https://rondonia.ro.gov.br/decreto-do-governo-de-ro-define-feriados-estaduais-de-2026/", verification: "OFFICIAL" as const }
const RS_LAW = { sourceName: "Lei estadual RS nº 2.072/1953 (Leis Estaduais)", sourceReference: "https://leisestaduais.com.br/rs/lei-ordinaria-n-2072-1953-rio-grande-do-sul-declara-feriado-estadual-o-dia-20-de-setembro", verification: "LEGAL_DATABASE" as const }
const SC_SIND = { sourceName: "Sindilojas Florianópolis — calendário 2026 (com leis citadas)", sourceReference: "https://www.sindilojas-sc.org.br/calendario-2026-feriados-pontos-facultativos-e-datas-festivas/", verification: "SECONDARY" as const }
const SP_PREF = { sourceName: "Prefeitura de São Paulo — calendário 2026 (Decreto nº 64.862/2025)", sourceReference: "https://prefeitura.sp.gov.br/web/gestao/w/calendario_2026", verification: "OFFICIAL" as const }
const SE_TJ = { sourceName: "Calendário TJSE 2026 — comarcas de Aracaju e interior", sourceReference: "https://www.tjse.jus.br/portal/arquivos/documentos/publicacoes/calendarios/calendario-tjse-2026.pdf", verification: "OFFICIAL" as const }
const TO_TJ = { sourceName: "TJTO — calendário de feriados e pontos facultativos 2026", sourceReference: "https://www.tjto.jus.br/comunicacao/noticias/tjto-publica-calendario-de-feriados-e-pontos-facultativos-para-2026", verification: "OFFICIAL" as const }
const GO_MP = { sourceName: "MPGO / Casa Civil GO — feriado estadual da fundação da cidade de Goiás", sourceReference: "https://www.mpgo.mp.br/portal/noticia/feriado-estadual-pela-fundacao-da-cidade-de-goias-suspende-expediente-no-mpgo-na-segunda-feira-22-7", verification: "OFFICIAL" as const }
const RR_TJ = { sourceName: "Portaria TJRR/PR nº 1.558/2025 (feriados locais 2026)", sourceReference: "https://www.tjrr.jus.br/index.php/feriados-locais-2026", verification: "OFFICIAL" as const }
const AM_MANAUS = { sourceName: "Decreto municipal de Manaus de 11/02/2026 (feriados 2026)", sourceReference: "https://www.legisweb.com.br/legislacao/?id=490727", verification: "OFFICIAL" as const }
const AGG = (url: string) => ({ sourceName: "Agregador de feriados citando a lei (fonte oficial não localizada)", sourceReference: url, verification: "SECONDARY" as const })

export const STATE_HOLIDAY_RULES: HolidayRule[] = [
  // Acre — a Lei estadual nº 2.247/2009 transfere feriados de terça a quinta para a sexta (Executivo estadual); o catálogo guarda a data LEGAL.
  state("AC", "Dia do Católico", { month: 1, day: 20, ...AC_DECREE, legalReference: "Lei estadual nº 3.137/2016" }),
  state("AC", "Dia do Evangélico", { month: 1, day: 23, ...AC_DECREE, legalReference: "Lei estadual nº 1.538/2004" }),
  state("AC", "Dia Internacional da Mulher", { month: 3, day: 8, ...AC_DECREE, legalReference: "Lei estadual nº 1.411/2001" }),
  state("AC", "Aniversário do Estado do Acre", { month: 6, day: 15, ...AC_DECREE, legalReference: "Lei estadual nº 14/1964" }),
  state("AC", "Dia da Amazônia", { month: 9, day: 5, ...AC_DECREE, legalReference: "Lei estadual nº 243/1968" }),
  state("AC", "Assinatura do Tratado de Petrópolis", { month: 11, day: 17, ...AC_DECREE, legalReference: "Lei estadual nº 57/1965" }),
  state("AL", "São João", { month: 6, day: 24, ...AL_DECREE, legalReference: "Lei estadual nº 5.508/1993" }),
  state("AL", "São Pedro", { month: 6, day: 29, ...AL_DECREE, legalReference: "Lei estadual nº 5.509/1993" }),
  state("AL", "Emancipação Política de Alagoas", { month: 9, day: 16, ...AL_DECREE, legalReference: "Lei estadual nº 5.724/1995" }),
  state("AL", "Dia Estadual do Evangélico", { month: 11, day: 30, ...AL_DECREE, legalReference: "Lei estadual nº 7.530/2013" }),
  state("AM", "Elevação do Amazonas à categoria de Província", { month: 9, day: 5, ...AM_MANAUS, legalReference: "Lei estadual nº 25/1977" }),
  state("AP", "São José (padroeiro do Amapá)", { month: 3, day: 19, ...WIKI, legalReference: "Lei estadual nº 667/2002" }),
  state("AP", "Criação do Território Federal do Amapá", { month: 9, day: 13, ...WIKI, legalReference: "Constituição do Estado do Amapá, art. 355" }),
  state("BA", "Independência da Bahia", { month: 7, day: 2, sourceName: "SEMGE — Prefeitura de Salvador (feriado estadual) / Constituição do Estado da Bahia", sourceReference: "https://semge.salvador.ba.gov.br/feriados-e-pontos-facultativos/", verification: "OFFICIAL", legalReference: "Constituição do Estado da Bahia, art. 6º, § 3º" }),
  state("CE", "Data Magna do Ceará (Abolição da escravatura no Ceará)", { month: 3, day: 25, ...CE_TJ, legalReference: "Emenda à Constituição do Estado do Ceará nº 73/2011" }),
  state("DF", "Aniversário de Brasília", { month: 4, day: 21, ...DF_DECREE, legalReference: "Lei distrital nº 72/1989, art. 1º" }),
  state("DF", "Corpus Christi", { easterOffset: 60, ...DF_DECREE, legalReference: "Lei distrital nº 72/1989, art. 1º, parágrafo único" }),
  state("DF", "Dia do Evangélico", { month: 11, day: 30, ...DF_DECREE, legalReference: "Lei distrital nº 963/1995" }),
  state("ES", "Nossa Senhora da Penha (Data Magna do Espírito Santo)", { easterOffset: 8, ...ES_DECREE, legalReference: "Lei estadual nº 11.010/2019" }),
  state("GO", "Fundação da Cidade de Goiás", { month: 7, day: 26, ...GO_MP, legalReference: "Lei estadual nº 20.756/2020, art. 269, II, a" }),
  state("MA", "Adesão do Maranhão à Independência", { month: 7, day: 28, ...MA_DECREE, legalReference: "Lei estadual nº 2.457/1964" }),
  state("MS", "Criação do Estado de Mato Grosso do Sul", { month: 10, day: 11, ...MS_DECREE, legalReference: "Lei estadual nº 10/1979" }),
  state("PA", "Adesão do Grão-Pará à Independência do Brasil", { month: 8, day: 15, ...PA_DECREE, legalReference: "Lei estadual nº 5.999/1996" }),
  state("PB", "Data Magna do Estado da Paraíba (Nossa Senhora das Neves)", { month: 8, day: 5, ...PB_JF, legalReference: "Lei estadual nº 10.601/2015" }),
  state("PE", "Data Magna de Pernambuco (Revolução Pernambucana de 1817)", { month: 3, day: 6, ...PE_JF, legalReference: "Lei estadual nº 13.835/2009; Lei estadual nº 16.241/2017, art. 49" }),
  state("PI", "Dia do Piauí", { month: 10, day: 19, ...AGG("https://www.feriados.inf.br/2026/pi/teresina"), legalReference: "Lei estadual nº 176/1937" }),
  state("RJ", "Carnaval (terça-feira)", { easterOffset: -47, ...RJ_SIND, legalReference: "Lei estadual nº 5.243/2008" }),
  state("RJ", "Dia de São Jorge", { month: 4, day: 23, ...RJ_SIND, legalReference: "Lei estadual nº 5.198/2008" }),
  state("RJ", "Corpus Christi", { easterOffset: 60, ...RJ_SIND, legalReference: "Lei estadual nº 11.002/2025" }),
  state("RN", "Mártires de Cunhaú e Uruaçu", { month: 10, day: 3, ...AGG("https://www.queroferiado.com.br/feriados/rio-grande-do-norte/natal"), legalReference: "Lei estadual nº 8.913/2006" }),
  state("RS", "Dia do Gaúcho (Revolução Farroupilha)", { month: 9, day: 20, ...RS_LAW, legalReference: "Lei estadual nº 2.072/1953" }),
  state("RO", "Criação do Estado de Rondônia", { month: 1, day: 4, ...RO_DECREE, legalReference: "Lei estadual nº 2.291/2010" }),
  state("RO", "Dia do Evangélico", { month: 6, day: 18, ...RO_DECREE, legalReference: "Lei estadual nº 1.026/2001" }),
  state("RR", "Criação do Estado de Roraima", { month: 10, day: 5, ...RR_TJ, legalReference: "Constituição do Estado de Roraima, art. 9º" }),
  state("SC", "Data Magna de Santa Catarina (transferida para o domingo seguinte)", { month: 8, day: 11, adjust: "SUNDAY_AFTER_IF_WEEKDAY", ...SC_SIND, legalReference: "Lei estadual nº 18.531/2022" }),
  state("SP", "Data Magna do Estado de São Paulo (Revolução Constitucionalista)", { month: 7, day: 9, ...SP_PREF, legalReference: "Lei estadual nº 9.497/1997" }),
  state("SE", "Emancipação Política de Sergipe", { month: 7, day: 8, ...SE_TJ, legalReference: "Constituição do Estado de Sergipe, art. 269" }),
  state("TO", "Criação do Estado do Tocantins (Data Magna)", { month: 10, day: 5, ...TO_TJ, legalReference: "Lei estadual nº 98/1989" }),
]

const FORTALEZA_TJ = { ...CE_TJ }
const BH_LAW = { sourceName: "Lei municipal de Belo Horizonte nº 1.327/1967", sourceReference: "https://www.legisweb.com.br/legislacao/?id=172554", verification: "LEGAL_DATABASE" as const }
const SALVADOR_SEMGE = { sourceName: "SEMGE — Prefeitura de Salvador (feriados municipais)", sourceReference: "https://semge.salvador.ba.gov.br/feriados-e-pontos-facultativos/", verification: "OFFICIAL" as const }
const VITORIA_PREF = { sourceName: "Prefeitura de Vitória — calendário de feriados (Decreto nº 25.991/2025)", sourceReference: "https://www.vitoria.es.gov.br/prefeitura/calendario-de-feriados-do-municipio", verification: "OFFICIAL" as const }
const CUIABA_PREF = { sourceName: "Prefeitura de Cuiabá — Decreto nº 11.585/2025", sourceReference: "https://www.cuiaba.mt.gov.br/noticias/decreto-fixa-datas-de-feriados-pontos-facultativos-e-comemoracoes-em-cuiaba", verification: "OFFICIAL" as const }
const CURITIBA_DECREE = { sourceName: "Decreto municipal de Curitiba nº 2.385/2025", sourceReference: "https://www.legisweb.com.br/legislacao/?id=486274", verification: "OFFICIAL" as const }
const POA_PREF = { sourceName: "Prefeitura de Porto Alegre — feriados municipais (Lei nº 3.033)", sourceReference: "https://prefeitura.poa.br/gcs/noticias/aniversario-de-porto-alegre-nao-e-feriado-municipal", verification: "OFFICIAL" as const }
const NATAL_DECREE = { sourceName: "Decreto municipal de Natal nº 13.643/2025 (feriados e pontos facultativos 2026)", sourceReference: "https://www.legisweb.com.br/legislacao/?id=488904", verification: "OFFICIAL" as const }
const SAO_LUIS_DECREE = { sourceName: "Decreto municipal de São Luís nº 62.168/2025 (feriados e pontos facultativos 2026)", sourceReference: "https://www.legisweb.com.br/legislacao/?id=488635", verification: "OFFICIAL" as const }
const PVH_PREF = { sourceName: "Prefeitura de Porto Velho — Decreto nº 21.691/2025", sourceReference: "https://www.portovelho.ro.gov.br/noticias/porto-velho-prefeitura-define-calendario-de-feriados-e-pontos-facultativos-de-2026", verification: "OFFICIAL" as const }
const MACEIO_PREF = { sourceName: "Prefeitura de Maceió — feriados municipais (Decreto nº 10.234/2025)", sourceReference: "https://maceio.al.gov.br/feriados-municipais", verification: "OFFICIAL" as const }
const GOIANIA_TRE = { sourceName: "TRE-GO — feriados municipais de Goiânia", sourceReference: "https://www.tre-go.jus.br/comunicacao/noticias/2022/Outubro/24-de-outubro-feriado-em-goiania", verification: "OFFICIAL" as const }

export const CAPITAL_HOLIDAY_RULES: HolidayRule[] = [
  capital("RIO_BRANCO", "Aniversário de Rio Branco", { month: 12, day: 28, ...AGG("https://meutudo.com.br/blog/feriados-acre-rio-branco/"), legalReference: "Lei municipal nº 330/1981" }),
  capital("MACEIO", "Corpus Christi", { easterOffset: 60, ...MACEIO_PREF }),
  capital("MACEIO", "Marechal Floriano Peixoto", { month: 6, day: 29, ...MACEIO_PREF }),
  capital("MACEIO", "Nossa Senhora dos Prazeres (padroeira)", { month: 8, day: 27, ...MACEIO_PREF, legalReference: "Lei municipal nº 1.391/1964" }),
  capital("MACEIO", "Nossa Senhora da Conceição", { month: 12, day: 8, ...MACEIO_PREF }),
  capital("MACAPA", "Aniversário de Macapá", { month: 2, day: 4, ...AGG("https://meutudo.com.br/blog/feriados-amapa-macapa/"), legalReference: "Lei municipal nº 064/1977" }),
  capital("MANAUS", "Carnaval (terça-feira)", { easterOffset: -47, ...AM_MANAUS, legalReference: "Lei municipal nº 448/1998" }),
  capital("MANAUS", "Corpus Christi", { easterOffset: 60, ...AM_MANAUS, legalReference: "Lei municipal nº 970/2006" }),
  capital("MANAUS", "Elevação de Manaus à categoria de cidade", { month: 10, day: 24, ...AM_MANAUS, legalReference: "Lei Orgânica do Município de Manaus, art. 437" }),
  capital("MANAUS", "Nossa Senhora da Conceição", { month: 12, day: 8, ...AM_MANAUS, legalReference: "Lei municipal nº 496/1999" }),
  capital("SALVADOR", "Corpus Christi", { easterOffset: 60, ...SALVADOR_SEMGE }),
  capital("SALVADOR", "São João", { month: 6, day: 24, ...SALVADOR_SEMGE }),
  capital("SALVADOR", "Nossa Senhora da Conceição da Praia (padroeira)", { month: 12, day: 8, ...SALVADOR_SEMGE }),
  capital("FORTALEZA", "São José (padroeiro do Ceará)", { month: 3, day: 19, ...FORTALEZA_TJ, legalReference: "Lei municipal nº 8.796/2003" }),
  capital("FORTALEZA", "Corpus Christi", { easterOffset: 60, ...FORTALEZA_TJ, legalReference: "Lei municipal nº 8.796/2003" }),
  capital("FORTALEZA", "Nossa Senhora da Assunção (padroeira)", { month: 8, day: 15, ...FORTALEZA_TJ, legalReference: "Lei municipal nº 8.796/2003" }),
  // Extraordinário: tricentenário de Fortaleza — válido SÓ em 2026 (nunca recorrente).
  capital("FORTALEZA", "Tricentenário de Fortaleza (feriado extraordinário de 2026)", { dates: ["2026-04-13"], sourceName: "Prefeitura de Fortaleza — 300 anos: feriado municipal em 13 de abril (Lei nº 11.649/2026, válida só para 2026)", sourceReference: "https://www.fortaleza.ce.gov.br/noticias/300-anos-fortaleza-celebra-aniversario-com-feriado-municipal-no-dia-13-de-abril", verification: "OFFICIAL", legalReference: "Lei municipal nº 11.649, de 08/04/2026" }),
  capital("VITORIA", "Nossa Senhora da Penha", { easterOffset: 8, ...VITORIA_PREF, legalReference: "Lei municipal nº 1.732/1967" }),
  capital("VITORIA", "Corpus Christi", { easterOffset: 60, ...VITORIA_PREF, legalReference: "Lei municipal nº 1.732/1967" }),
  capital("VITORIA", "Nossa Senhora da Vitória (padroeira)", { month: 9, day: 8, ...VITORIA_PREF, legalReference: "Lei municipal nº 1.732/1967" }),
  capital("GOIANIA", "Nossa Senhora Auxiliadora (padroeira)", { month: 5, day: 24, sourceName: "TRE-GO / JUCEG — feriado municipal de 24 de maio em Goiânia", sourceReference: "https://www.tre-go.jus.br/comunicacao/noticias/2021/Maio/feriado-em-goiania-24-de-maio", verification: "OFFICIAL", legalReference: "Lei municipal nº 701/1956" }),
  capital("GOIANIA", "Aniversário de Goiânia", { month: 10, day: 24, ...GOIANIA_TRE, legalReference: "Lei municipal nº 6.968/1991" }),
  capital("SAO_LUIS", "São Pedro", { month: 6, day: 29, ...SAO_LUIS_DECREE, legalReference: "Decreto municipal nº 62.168/2025 (art. 93 da Lei Orgânica); Lei municipal nº 3.432/1996 citada por agregador" }),
  capital("SAO_LUIS", "Natividade de Nossa Senhora / Aniversário de São Luís", { month: 9, day: 8, ...SAO_LUIS_DECREE, legalReference: "Decreto municipal nº 62.168/2025 (art. 93 da Lei Orgânica); Lei municipal nº 3.432/1996 citada por agregador" }),
  capital("SAO_LUIS", "Nossa Senhora da Conceição", { month: 12, day: 8, ...SAO_LUIS_DECREE, legalReference: "Decreto municipal nº 62.168/2025 (art. 93 da Lei Orgânica); Lei municipal nº 3.432/1996 citada por agregador" }),
  capital("CUIABA", "Fundação da Cidade de Cuiabá", { month: 4, day: 8, ...CUIABA_PREF }),
  capital("CUIABA", "Corpus Christi", { easterOffset: 60, ...CUIABA_PREF }),
  capital("CUIABA", "Nossa Senhora da Conceição", { month: 12, day: 8, ...CUIABA_PREF }),
  capital("BELO_HORIZONTE", "Corpus Christi", { easterOffset: 60, ...BH_LAW, legalReference: "Lei municipal nº 1.327/1967, art. 1º" }),
  capital("BELO_HORIZONTE", "Assunção de Nossa Senhora", { month: 8, day: 15, ...BH_LAW, legalReference: "Lei municipal nº 1.327/1967, art. 1º" }),
  capital("BELO_HORIZONTE", "Imaculada Conceição", { month: 12, day: 8, ...BH_LAW, legalReference: "Lei municipal nº 1.327/1967, art. 1º" }),
  capital("JOAO_PESSOA", "São João", { month: 6, day: 24, ...PB_JF, legalReference: "Lei municipal nº 13.768/2019, art. 5º, II" }),
  capital("JOAO_PESSOA", "Nossa Senhora das Neves (padroeira / fundação da cidade)", { month: 8, day: 5, ...PB_JF, legalReference: "Lei municipal nº 13.768/2019, art. 5º, III" }),
  capital("CURITIBA", "Corpus Christi", { easterOffset: 60, ...CURITIBA_DECREE }),
  capital("CURITIBA", "Nossa Senhora da Luz dos Pinhais (padroeira)", { month: 9, day: 8, ...CURITIBA_DECREE }),
  capital("RECIFE", "São João", { month: 6, day: 24, ...PE_JF, legalReference: "Lei municipal nº 9.777/1967" }),
  capital("RECIFE", "Nossa Senhora do Carmo (padroeira)", { month: 7, day: 16, ...PE_JF, legalReference: "Lei municipal nº 9.777/1967" }),
  capital("RECIFE", "Nossa Senhora da Conceição", { month: 12, day: 8, ...PE_JF, legalReference: "Lei municipal nº 9.777/1967" }),
  capital("TERESINA", "Aniversário de Teresina", { month: 8, day: 16, ...AGG("https://www.feriados.inf.br/2026/pi/teresina"), legalReference: "Lei municipal nº 2.847/1999" }),
  capital("TERESINA", "Nossa Senhora da Conceição", { month: 12, day: 8, ...AGG("https://www.feriados.inf.br/2026/pi/teresina"), legalReference: "Lei municipal nº 2.847/1999" }),
  capital("RIO_DE_JANEIRO", "Dia de São Sebastião (padroeiro)", { month: 1, day: 20, ...RJ_SIND, legalReference: "Lei municipal nº 1.271/1988 (consolidada na Lei municipal nº 5.146/2010)" }),
  capital("NATAL", "Dia de Santos Reis", { month: 1, day: 6, ...NATAL_DECREE, legalReference: "Decreto municipal nº 13.643/2025 (calendário 2026); Lei municipal nº 245/1974 citada por agregador" }),
  capital("NATAL", "Nossa Senhora da Apresentação (padroeira)", { month: 11, day: 21, ...NATAL_DECREE, legalReference: "Decreto municipal nº 13.643/2025 (calendário 2026); Lei municipal nº 245/1974 citada por agregador" }),
  // Corpus Christi consta como feriado MUNICIPAL no decreto anual de 2026 — sem lei permanente localizada, só a data de 2026 entra.
  capital("NATAL", "Corpus Christi", { dates: ["2026-06-04"], ...NATAL_DECREE, legalReference: "Decreto municipal nº 13.643/2025 (feriado municipal em 2026)" }),
  capital("PORTO_ALEGRE", "Nossa Senhora dos Navegantes", { month: 2, day: 2, ...POA_PREF, legalReference: "Lei municipal nº 3.033" }),
  capital("PORTO_ALEGRE", "Corpus Christi", { easterOffset: 60, ...POA_PREF, legalReference: "Lei municipal nº 3.033" }),
  capital("PORTO_VELHO", "Instalação do Município de Porto Velho", { month: 1, day: 24, ...PVH_PREF }),
  capital("PORTO_VELHO", "Criação do Município de Porto Velho", { month: 10, day: 2, ...PVH_PREF }),
  capital("BOA_VISTA", "Dia de São Sebastião", { month: 1, day: 20, ...RR_TJ }),
  capital("BOA_VISTA", "Dia de São Pedro", { month: 6, day: 29, ...RR_TJ }),
  capital("BOA_VISTA", "Aniversário de Boa Vista", { month: 7, day: 9, ...RR_TJ }),
  capital("FLORIANOPOLIS", "Dia do Município (aniversário de Florianópolis)", { month: 3, day: 23, ...SC_SIND, legalReference: "Lei municipal nº 3.247/1989" }),
  capital("FLORIANOPOLIS", "Corpus Christi", { easterOffset: 60, ...SC_SIND, legalReference: "Lei municipal nº 3.247/1989" }),
  capital("SAO_PAULO", "Aniversário da Cidade de São Paulo", { month: 1, day: 25, ...SP_PREF, legalReference: "Lei municipal nº 14.485/2007 (consolidação)" }),
  capital("SAO_PAULO", "Corpus Christi", { easterOffset: 60, ...SP_PREF, legalReference: "Lei municipal nº 14.485/2007 (consolidação)" }),
  capital("ARACAJU", "Aniversário da Capital", { month: 3, day: 17, ...SE_TJ }),
  capital("ARACAJU", "São João", { month: 6, day: 24, ...SE_TJ }),
  capital("ARACAJU", "Nossa Senhora da Conceição (padroeira)", { month: 12, day: 8, ...SE_TJ }),
  capital("PALMAS", "Dia de São José", { month: 3, day: 19, ...TO_TJ, legalReference: "Feriado municipal de Palmas na Portaria TJTO nº 3.741/2025 (calendário 2026)" }),
  capital("PALMAS", "Aniversário de Palmas", { month: 5, day: 20, ...TO_TJ, legalReference: "Lei municipal nº 108/1991; Portaria TJTO nº 3.741/2025 (calendário 2026)" }),
]

export const HOLIDAY_RULES: HolidayRule[] = [...NATIONAL_HOLIDAY_RULES, ...STATE_HOLIDAY_RULES, ...CAPITAL_HOLIDAY_RULES]

/**
 * LACUNAS CONSCIENTES — o que NÃO foi seedado e por quê (vai para o relatório e para a UI da
 * Central como aviso, nunca para o banco como feriado).
 */
export type HolidayCatalogGap = { scope: "NATIONAL" | "STATE" | "MUNICIPAL_CAPITAL"; stateCode?: string; capitalCode?: string; years: number[]; reason: string }

export const HOLIDAY_CATALOG_GAPS: HolidayCatalogGap[] = [
  { scope: "NATIONAL", years: [2027, 2028], reason: "As Portarias MGI de 2027 e 2028 ainda não foram publicadas (set/2026): os feriados nacionais desses anos derivam das leis permanentes (662/1949, 6.802/1980, 14.759/2023) e da Sexta-feira Santa calculada — sem feriado nacional extraordinário." },
  { scope: "STATE", stateCode: "AC", years: [2026, 2027, 2028], reason: "A Lei estadual nº 2.247/2009 transfere feriados estaduais que caem de terça a quinta para a sexta-feira (Executivo estadual; em 2026 o Dia do Católico foi observado em 22/01). O catálogo guarda a data LEGAL — a data observada por transferência não foi seedada." },
  { scope: "STATE", stateCode: "AP", years: [2026, 2027, 2028], reason: "Fonte oficial estadual não localizada (TJAP publica só PDF); 19/03 e 13/09 entraram por base secundária com lei citada; 15/05 (Dia de Cabralzinho) aparece como 'feriado' em notícia da Prefeitura de Macapá (2023, 'data estabelecida em 2017') sem lei nem escopo (estadual × municipal) identificados — não seedado." },
  { scope: "STATE", stateCode: "MT", years: [2026, 2027, 2028], reason: "Nenhum feriado estadual além dos nacionais (Decreto nº 1.787/2025) — não é lacuna, é ausência confirmada." },
  { scope: "STATE", stateCode: "MG", years: [2026, 2027, 2028], reason: "Nenhum feriado estadual além dos nacionais (21/04 coincide com Tiradentes) — ausência confirmada." },
  { scope: "STATE", stateCode: "PR", years: [2026, 2027, 2028], reason: "19/12 deixou de ser feriado civil (Lei nº 18.384/2014); 15/11 (N. Sra. do Rocio) coincide com feriado nacional — ausência confirmada." },
  { scope: "STATE", stateCode: "SC", years: [2026, 2027, 2028], reason: "Data Magna (11/08) é transferida para o domingo seguinte quando cai em dia útil (Lei nº 18.531/2022) — seedada na data transferida; 25/11 (Santa Catarina de Alexandria) não confirmado em fonte oficial." },
  { scope: "STATE", stateCode: "TO", years: [2026, 2027, 2028], reason: "18/03 (Autonomia) é ponto facultativo. 08/09 (N. Sra. da Natividade, padroeira) aparece como FERIADO ESTADUAL na Portaria TJTO nº 3.741/2025 (calendário 2026) mas como ponto facultativo em outras fontes (JFTO) — fontes oficiais divergem e nenhuma lei estadual foi localizada: não seedado até verificação." },
  { scope: "MUNICIPAL_CAPITAL", capitalCode: "BELEM", years: [2026, 2027, 2028], reason: "Decreto municipal nº 114.126/2026 declara 12/01 (aniversário) PONTO FACULTATIVO, não feriado; os feriados municipais de 06–07/11/2025 (COP30, Lei municipal nº 10.212/2025) foram pontuais; Corpus Christi só por decreto pontual (nº 114.437/2026); nenhum feriado municipal recorrente foi verificado (Lei municipal nº 6.306/1967 inacessível). Nada seedado." },
  { scope: "MUNICIPAL_CAPITAL", capitalCode: "CAMPO_GRANDE", years: [2026, 2027, 2028], reason: "Ausência CONFIRMADA em fonte oficial: o calendário 2026 da Prefeitura (Decreto municipal nº 16.469/2025) traz só feriados nacionais, o estadual de 11/10 e pontos facultativos — nenhum feriado municipal (26/08 não consta)." },
  { scope: "MUNICIPAL_CAPITAL", capitalCode: "BRASILIA", years: [2026, 2027, 2028], reason: "Brasília não tem feriado municipal próprio: os feriados locais são distritais (escopo STATE, UF = DF)." },
  { scope: "MUNICIPAL_CAPITAL", capitalCode: "CURITIBA", years: [2026, 2027, 2028], reason: "29/03 (aniversário) não consta como feriado no Decreto nº 2.385/2025 — não seedado." },
  { scope: "MUNICIPAL_CAPITAL", capitalCode: "PORTO_ALEGRE", years: [2026, 2027, 2028], reason: "26/03 (aniversário) NÃO é feriado municipal (nota oficial da prefeitura) — não seedado." },
  { scope: "MUNICIPAL_CAPITAL", capitalCode: "BOA_VISTA", years: [2026, 2027, 2028], reason: "08/12 aparece em agregadores, mas não na Portaria TJRR nº 1.558/2025 — não seedado." },
  { scope: "MUNICIPAL_CAPITAL", capitalCode: "ARACAJU", years: [2026, 2027, 2028], reason: "Corpus Christi aparece no calendário TJSE sem escopo claro (estadual × municipal) — não seedado." },
  { scope: "MUNICIPAL_CAPITAL", capitalCode: "RIO_BRANCO", years: [2026, 2027, 2028], reason: "28/12 entrou por base secundária com a Lei nº 330/1981 citada (decreto municipal nº 3.452/2025 só em PDF não transcrito)." },
  { scope: "MUNICIPAL_CAPITAL", capitalCode: "MACAPA", years: [2026, 2027, 2028], reason: "04/02 entrou por base secundária (Lei nº 064/1977); demais datas municipais não verificadas." },
  { scope: "MUNICIPAL_CAPITAL", capitalCode: "SAO_LUIS", years: [2027, 2028], reason: "As três datas (29/06, 08/09, 08/12) foram confirmadas como feriado municipal no Decreto nº 62.168/2025 (calendário 2026); a lei permanente (nº 3.432/1996) segue citada só por agregador — 2027/2028 dependem do decreto anual." },
  { scope: "MUNICIPAL_CAPITAL", capitalCode: "TERESINA", years: [2026, 2027, 2028], reason: "Lei municipal nº 2.847/1999 citada por agregador — verificação SECONDARY." },
  { scope: "MUNICIPAL_CAPITAL", capitalCode: "NATAL", years: [2027, 2028], reason: "06/01 e 21/11 confirmados no Decreto nº 13.643/2025 (calendário 2026); Corpus Christi consta como feriado municipal só nesse decreto anual (seedado apenas em 2026); a lei permanente (nº 245/1974) segue citada só por agregador." },
  { scope: "MUNICIPAL_CAPITAL", capitalCode: "PALMAS", years: [2027, 2028], reason: "19/03 (São José) e 20/05 (aniversário) confirmados como feriado municipal na Portaria TJTO nº 3.741/2025 (calendário 2026); a lei municipal (nº 108/1991) segue citada por agregador — 2027/2028 dependem de novo calendário." },
  { scope: "MUNICIPAL_CAPITAL", capitalCode: "RIO_DE_JANEIRO", years: [2026, 2027, 2028], reason: "20/01 com lei citada por fonte sindical (SindRio); TJRJ inacessível (certificado) — verificação SECONDARY." },
]
