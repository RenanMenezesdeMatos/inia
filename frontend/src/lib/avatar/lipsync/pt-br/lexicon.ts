/**
 * Léxico do G2P PT-BR: só o que as REGRAS não resolvem.
 *
 * Tudo aqui é dado (nenhuma regra): transcrições prontas para estrangeirismos frequentes no produto,
 * palavras com vogal tônica ABERTA sem acento gráfico (o padrão das regras é fechada), radicais com
 * "x" de pronúncia lexical, "qu"/"gu" com u pronunciado antes de e/i, siglas lidas como palavra,
 * abreviações e nomes das letras. A escolha e/E, o/O muda só a altura da mandíbula (≈ 0,3 × 0,5),
 * então a lista cobre o vocabulário frequente da INIA — não é um dicionário.
 */

/**
 * Transcrições prontas (X-SAMPA do inventário de `phones.ts`): fones separados por espaço, sílabas
 * por ".", sílaba tônica prefixada por "'". Sem "'" = palavra átona (clítico). A chave é a forma
 * minúscula como aparece no texto (com hífen, quando houver).
 */
export const PHONE_LEXICON: ReadonlyMap<string, string> = new Map([
  // Estrangeirismos do dia a dia do produto — pronúncia brasileira corrente, com [i] epentético.
  ["feedback", "'f i . dZ (i) . b E . k i"],
  ["feedbacks", "'f i . dZ (i) . b E . k i s"],
  ["e-mail", "i . 'm e j w"],
  ["e-mails", "i . 'm e j w s"],
  ["email", "i . 'm e j w"],
  ["emails", "i . 'm e j w s"],
  ["online", "o~ . 'l a j . n i"],
  ["offline", "O . f (i) . 'l a j . n i"],
  ["ok", "o . 'k e j"],
  ["okay", "o . 'k e j"],
  ["oquei", "o . 'k e j"],
  ["app", "'E . p i"],
  ["apps", "'E . p i s"],
  ["whatsapp", "w a t . 's a . p i"],
  ["zap", "'z a . p i"],
  ["site", "'s a j . tS i"],
  ["sites", "'s a j . tS i s"],
  ["chat", "'S E . tS i"],
  ["link", "'l i~ . k i"],
  ["links", "'l i~ . k i s"],
  ["login", "'l O . g i~"],
  ["logout", "l O . 'g a w . tS i"],
  ["performance", "p e r . 'f O r . m 6~ . s i"],
  ["coaching", "'k o w . tS i~"],
  ["coach", "'k o w . tS i"],
  ["insight", "'i~ . s a j . tS i"],
  ["insights", "'i~ . s a j . tS i s"],
  ["marketing", "'m a r . k e . tS i~"],
  ["ranking", "'R 6~ . k i~"],
  ["dashboard", "'d E S . b O r . dZ i"],
  ["download", "d a w~ . 'l o w . dZ i"],
  ["upload", "a . p (i) . 'l o w . dZ i"],
  ["checklist", "S E . 'k l i s . tS i"],
  ["check-in", "S E . 'k i~"],
  ["wi-fi", "w a j . 'f a j"],
  ["wifi", "w a j . 'f a j"],
  ["google", "'g u . g u w"],
  ["youtube", "j u . 'tS u . b i"],
  ["instagram", "i~ s . t a . 'g r 6~"],
  ["linkedin", "l i~ . k e . 'd i~"],
  ["facebook", "f e j s . 'b u . k i"],
  ["teams", "'tS i~ s"],
  ["zoom", "'z u~"],
  ["call", "'k O w"],
  ["show", "'S o w"],
  ["home", "'R o w . m i"],
  ["office", "'O . f i s"],
  ["software", "'s O . f (i) . tS (i) . w E r"],
  ["mouse", "'m a w . z i"],
  ["meeting", "'m i . tS i~"],
  ["script", "i s . 'k r i . p (i) . tS i"],
  ["smartphone", "i s . m a r . tS (i) . 'f o w . n i"],
  ["gemini", "'Z e . m i . n i"],
  ["status", "i s . 't a . t u s"],
  ["álcool", "'a w . k O w"],
  // Irregulares frequentes que as regras erram.
  ["muito", "'m u~ j~ . t u"],
  ["muita", "'m u~ j~ . t 6"],
  ["muitos", "'m u~ j~ . t u s"],
  ["muitas", "'m u~ j~ . t 6 s"],
  ["ao", "a w"],
  ["aos", "a w s"],
  ["pra", "p r 6"],
  ["pro", "p r u"],
  ["tchau", "'tS a w"],
])

/**
 * Palavras cuja vogal tônica SEM acento gráfico é aberta (é/ó). Inclui metafonia de plural
 * ("novo" [o] × "novos" [ɔ]) e verbos com radical aberto. O resto vem de regras de sufixo em
 * `openStressedBySuffix` (-el, -ol, -ela, -ola, -osa, -eto…).
 */
export const OPEN_STRESSED_WORDS: ReadonlySet<string> = new Set([
  // e aberto
  "ela", "elas", "dela", "delas", "nela", "nelas", "aquela", "aquelas", "era", "eras", "eram", "esta", "estas",
  "meta", "metas", "certo", "certa", "certos", "certas", "perto", "sete", "dez", "festa", "festas", "pedra",
  "terra", "guerra", "guerras", "ferro", "serra", "belo", "bela", "velho", "velha", "velhos", "velhas",
  "mulher", "mulheres", "quer", "quero", "queres", "querem", "prefere", "preferem", "preferes", "sugere",
  "sugerem", "refere", "confere", "transfere", "interfere", "espere", "esperem", "espera", "esperam",
  "opera", "leve", "leves", "breve", "breves", "deve", "devem", "deves", "serve", "servem", "pede", "pedem",
  "mede", "perde", "perdem", "ideia", "ideias", "assembleia", "europeia", "plateia", "geleia", "estreia",
  "baleia", "tela", "telas", "janela", "janelas", "reserva", "conserva", "neve", "sede", "remete", "promete",
  "compete", "repete", "reflete", "atleta", "bicicleta", "coleta", "dieta", "zero",
  // o aberto
  "hora", "horas", "agora", "embora", "fora", "nossa", "nossas", "nosso", "nossos", "vossa", "pode",
  "podem", "posso", "porta", "portas", "nota", "notas", "modo", "modos", "moda", "nova", "novas", "novos",
  "forte", "fortes", "morte", "sorte", "norte", "porte", "forma", "formas", "obra", "obras", "roda",
  "logo", "nove", "melhor", "melhores", "melhora", "melhoram", "piora", "maior", "maiores", "menor",
  "menores", "pior", "piores", "voz", "volta", "voltas", "solta", "rota", "rotas", "foco", "focos",
  "jogos", "fogos", "povos", "olhos", "corpos", "postos", "portos", "ovos", "copo", "roxo", "globo",
  "cola", "dose", "doses", "costa", "costas", "jota", "gosta", "gostam", "mostra", "mostram", "sobra",
  "sobram", "conforto", "loja", "lojas", "bloco", "blocos", "toca", "troca", "trocas",
  "coloca", "colocam", "provoca", "coloque", "coloquem", "resolve", "resolvem", "apoia", "apoiam", "jovem",
  "jovens", "exceto", "começa", "começam", "leva", "levam", "gera", "geram", "pega", "pegam", "reforça",
  "reforçam", "processo", "processos", "sucesso", "sucessos", "acesso", "acessos", "progresso", "progressos",
  "excesso", "esforços", "aberto", "aberta", "abertos", "abertas", "esperto", "esperta",
])

/** Exceções às regras de sufixo que abrem a vogal (-ela, -osa, -eto…): ficam fechadas. */
export const CLOSED_SUFFIX_EXCEPTIONS: ReadonlySet<string> = new Set([
  "estrela", "estrelas", "esposa", "esposas", "preto", "preta", "pretos", "pretas", "caneta", "canetas",
  "planeta", "planetas", "esqueleto", "esqueletos", "cabelo", "cabelos", "modelo", "modelos", "careta", "caretas",
])

/** Radicais em que o "x" soa [ks] (táxi, fixo, tóxico…). Casados no início da palavra. */
export const X_AS_KS = /^(?:t[aá]xi|fix|t[oó]xic|intoxic|anex|reflex|complex|flux|l[eé]xic|oxig[eê]n|ox[ií]d|conex|nex[oa]|sexo|sexos|sexu|axil|box|ortodox|paradox|pr[oó]lix|f[eê]nix|[oô]nix|t[oó]rax|l[aá]tex|pix|fax|x[eé]rox|t[aá]x[ií]metro)/

/** Radicais em que o "x" soa [s] (próximo, máximo, auxílio…). */
export const X_AS_S = /^(?:pr[oó]xim|m[aá]xim|aux[ií]li|aproxim|trouxe|sintax|seiscent)/

/** "qu" com u pronunciado antes de e/i ([kw]): cinquenta, frequente, tranquilo… */
export const QU_WITH_W = /(?:cinquent|frequen|tranquil|consequ|eloquen|delinquen|equin|quinquen|sequestr|obliqu|ubiqu)/

/** "gu" com u pronunciado antes de e/i ([gw]): aguentar, linguiça, bilíngue… */
export const GU_WITH_W = /(?:aguent|lingui[cçs]|bil[ií]ngu|pinguim|pinguin|sagui|unguent|ambigu|argui|averigu)/

/**
 * Palavras átonas (clíticos): artigos, preposições, conjunções e pronomes oblíquos. Não recebem
 * tonicidade — por isso "de" é [dʒi], "que" [ki], "o" [u], "e" [i].
 */
export const CLITICS: ReadonlySet<string> = new Set([
  "o", "a", "os", "as", "um", "uns", "uma", "umas", "de", "do", "da", "dos", "das", "em", "no", "na", "nos",
  "nas", "num", "numa", "e", "ou", "mas", "que", "se", "me", "te", "lhe", "lhes", "vos", "lo", "la", "los",
  "las", "por", "pelo", "pela", "pelos", "pelas", "para", "com", "sem", "sob", "à", "às", "ao", "aos",
])

/** Siglas lidas como PALAVRA (o resto em maiúsculas com até 4 letras é soletrado). */
export const ACRONYMS_AS_WORDS: ReadonlyMap<string, string> = new Map([
  ["INIA", "inia"],
  ["VIVO", "vivo"],
  ["NASA", "nasa"],
  ["FIFA", "fifa"],
  ["ONU", "onu"],
  ["PIX", "pix"],
  ["SAC", "sac"],
  ["URA", "ura"],
  ["SUS", "sus"],
  ["ENEM", "enem"],
  ["SESC", "sesc"],
  ["OK", "ok"],
  ["TV", "tevê"],
  ["CEP", "cép"],
  ["ONG", "ong"],
  ["PIS", "pis"],
])

/** Palavras comuns que às vezes vêm em maiúsculas por ênfase — nunca soletrar. */
export const COMMON_UPPERCASE_WORDS: ReadonlySet<string> = new Set([
  "sim", "eu", "oi", "ai", "bom", "bem", "mau", "meu", "seu", "teu", "fim", "dia", "vez", "um", "uma", "com",
  "sem", "mas", "que", "para", "esse", "essa", "este", "esta", "isso", "isto", "aqui", "ali", "hoje", "tudo",
  "nada", "mais", "onde", "como", "qual", "quem", "boa", "amor", "vida", "todo", "toda", "novo", "nova",
  "meta", "foco", "dica", "tipo", "ano", "hora", "ele", "ela", "nos", "vai", "ver", "ter", "ser", "dar",
  "use", "leia", "veja", "pare", "fale", "e", "o", "a", "os", "as", "de", "do", "da", "em", "no", "na",
  "cada", "logo", "pelo", "pela", "foi", "era", "faz", "fez", "dois", "seis", "sete", "oito", "nove", "dez",
  "cem", "mil", "anos", "dias", "sua", "suas", "seus", "meus", "nem", "por", "ou", "vou", "tem", "vem", "pode",
  "deve", "quer", "fica", "olha", "jogo", "casa", "rua", "eles", "elas", "ai", "oba", "opa", "uau", "vale",
  "fato", "real", "caso", "bons", "boas", "meio", "alto", "zero", "base", "dado", "erro", "item", "lado",
  "modo", "nota", "dica", "fala", "voz", "note", "vamos", "juntos",
])

/** Nomes das letras (soletração de siglas). Acentos forçam a vogal certa: "éfe", "ésse"… */
export const LETTER_NAMES: Readonly<Record<string, string>> = {
  a: "á", b: "bê", c: "cê", d: "dê", e: "é", f: "éfe", g: "gê", h: "agá", i: "i", j: "jota", k: "cá",
  l: "éle", m: "eme", n: "ene", o: "ó", p: "pê", q: "quê", r: "érre", s: "ésse", t: "tê", u: "u", v: "vê",
  w: "dáblio", x: "xis", y: "ípsilon", z: "zê", ç: "cê cedilha",
}

/**
 * Abreviações (chave minúscula, com o ponto quando o tem). O ponto da abreviação NÃO é pausa.
 */
export const ABBREVIATIONS: ReadonlyMap<string, string> = new Map([
  ["sr.", "senhor"],
  ["sra.", "senhora"],
  ["srta.", "senhorita"],
  ["srs.", "senhores"],
  ["sras.", "senhoras"],
  ["dr.", "doutor"],
  ["dra.", "doutora"],
  ["drs.", "doutores"],
  ["prof.", "professor"],
  ["profa.", "professora"],
  ["exmo.", "excelentíssimo"],
  ["exma.", "excelentíssima"],
  ["etc.", "etcétera"],
  ["ex.", "exemplo"],
  ["p.ex.", "por exemplo"],
  ["obs.", "observação"],
  ["pág.", "página"],
  ["págs.", "páginas"],
  ["tel.", "telefone"],
  ["av.", "avenida"],
  ["aprox.", "aproximadamente"],
  ["máx.", "máximo"],
  ["mín.", "mínimo"],
  ["vs.", "versus"],
  ["ltda.", "limitada"],
  ["cia.", "companhia"],
  ["depto.", "departamento"],
  ["nº", "número"],
  ["n°", "número"],
  ["n.º", "número"],
  ["nºs", "números"],
  ["km", "quilômetros"],
  ["kg", "quilos"],
  ["vc", "você"],
  ["vcs", "vocês"],
])

/** Abreviações cujo ponto costuma fechar a enumeração: pausa curta depois. */
export const ABBREVIATIONS_WITH_PAUSE: ReadonlySet<string> = new Set(["etc."])

/** Unidades coladas a números ("10km", "30min"). */
export const UNIT_WORDS: ReadonlyMap<string, { singular: string; plural: string; feminine?: boolean }> = new Map([
  ["km", { singular: "quilômetro", plural: "quilômetros" }],
  ["kg", { singular: "quilo", plural: "quilos" }],
  ["g", { singular: "grama", plural: "gramas" }],
  ["cm", { singular: "centímetro", plural: "centímetros" }],
  ["mm", { singular: "milímetro", plural: "milímetros" }],
  ["m", { singular: "metro", plural: "metros" }],
  ["ms", { singular: "milissegundo", plural: "milissegundos" }],
  ["s", { singular: "segundo", plural: "segundos" }],
  ["seg", { singular: "segundo", plural: "segundos" }],
  ["min", { singular: "minuto", plural: "minutos" }],
  ["h", { singular: "hora", plural: "horas", feminine: true }],
  ["gb", { singular: "giga", plural: "gigas" }],
  ["mb", { singular: "mega", plural: "megas" }],
  ["x", { singular: "vez", plural: "vezes", feminine: true }],
])

/** Substantivos femininos frequentes depois de números (concordância: "duas horas", "uma vez"). */
export const FEMININE_NOUNS: ReadonlySet<string> = new Set([
  "hora", "horas", "pessoa", "pessoas", "vez", "vezes", "semana", "semanas", "chamada", "chamadas", "meta",
  "metas", "venda", "vendas", "nota", "notas", "pergunta", "perguntas", "etapa", "etapas", "dica", "dicas",
  "página", "páginas", "mensagem", "mensagens", "conversa", "conversas", "tentativa", "tentativas", "equipe",
  "equipes", "área", "áreas", "coisa", "coisas", "forma", "formas", "maneira", "maneiras", "unidade",
  "unidades", "competência", "competências", "estrela", "estrelas", "casa", "casas", "palavra", "palavras",
  "linha", "linhas", "noite", "noites", "tarde", "tardes", "manhã", "manhãs", "hipótese", "hipóteses",

])

/** Terminações -a/-as que NÃO são femininas (evita "duas problemas"). */
export const MASCULINE_A_NOUNS: ReadonlySet<string> = new Set([
  "dia", "dias", "mapa", "mapas", "problema", "problemas", "sistema", "sistemas", "programa", "programas",
  "tema", "temas", "clima", "idioma", "idiomas", "planeta", "planetas", "esquema", "esquemas", "diagrama",
  "diagramas", "dilema", "dilemas", "drama", "dramas", "telefonema", "telefonemas", "poema", "poemas",
  "cinema", "cinemas", "pijama", "sofá", "sofás", "guarda", "guardas",
])
