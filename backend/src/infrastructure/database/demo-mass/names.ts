import type { Random } from "./random.js"

/**
 * Nomes fictícios brasileiros plausíveis. Combinações são geradas por PRNG e nunca repetem
 * dentro da massa — a UI mostra "Mariana Alves", nunca "Operador 0417" (o id sequencial fica
 * só na matrícula/e-mail).
 */
const FEMALE_FIRST = [
  "Ana", "Beatriz", "Camila", "Carolina", "Daniela", "Débora", "Eduarda", "Elaine", "Fabiana", "Fernanda",
  "Gabriela", "Giovanna", "Helena", "Isabela", "Jéssica", "Juliana", "Karina", "Larissa", "Letícia", "Lívia",
  "Luana", "Luciana", "Manuela", "Marcela", "Mariana", "Marina", "Michele", "Natália", "Patrícia", "Paula",
  "Priscila", "Rafaela", "Raquel", "Renata", "Roberta", "Sabrina", "Simone", "Sofia", "Tainá", "Tatiane",
  "Thaís", "Vanessa", "Verônica", "Viviane", "Yasmin", "Aline", "Amanda", "Bruna", "Cristina", "Érica",
  "Flávia", "Ingrid", "Joana", "Kelly", "Laura", "Milena", "Nathália", "Olívia", "Sandra", "Vitória",
  "Adriana", "Bianca", "Clarice", "Denise", "Emanuelle", "Franciele", "Gisele", "Heloísa", "Iara", "Josiane",
  "Lorena", "Maiara", "Mônica", "Nicole", "Poliana", "Regina", "Rosana", "Sueli", "Talita", "Valéria",
] as const

const MALE_FIRST = [
  "André", "Antônio", "Arthur", "Bruno", "Caio", "Carlos", "Cauã", "Daniel", "Danilo", "Diego",
  "Douglas", "Eduardo", "Emerson", "Fábio", "Felipe", "Fernando", "Gabriel", "Guilherme", "Gustavo", "Henrique",
  "Igor", "Jefferson", "João", "Jonas", "José", "Kaique", "Leandro", "Leonardo", "Lucas", "Luiz",
  "Marcelo", "Marcos", "Mateus", "Matheus", "Maurício", "Murilo", "Nícolas", "Otávio", "Paulo", "Pedro",
  "Rafael", "Renan", "Ricardo", "Roberto", "Rodrigo", "Samuel", "Sérgio", "Thiago", "Vinícius", "Vitor",
  "Wagner", "Wesley", "William", "Adriano", "Alexandre", "Anderson", "Cláudio", "Everton", "Fabrício", "Hugo",
  "Jorge", "Júlio", "Kevin", "Luan", "Márcio", "Nelson", "Raul", "Robson", "Tiago", "Yuri",
] as const

const SURNAMES = [
  "Silva", "Santos", "Oliveira", "Souza", "Rodrigues", "Ferreira", "Alves", "Pereira", "Lima", "Gomes",
  "Costa", "Ribeiro", "Martins", "Carvalho", "Almeida", "Lopes", "Soares", "Fernandes", "Vieira", "Barbosa",
  "Rocha", "Dias", "Nascimento", "Andrade", "Moreira", "Nunes", "Marques", "Machado", "Mendes", "Freitas",
  "Cardoso", "Ramos", "Gonçalves", "Santana", "Teixeira", "Araújo", "Correia", "Cavalcanti", "Monteiro", "Moura",
  "Nogueira", "Batista", "Campos", "Cunha", "Farias", "Fonseca", "Guimarães", "Leite", "Medeiros", "Melo",
  "Miranda", "Pinto", "Pires", "Rezende", "Sales", "Siqueira", "Tavares", "Vasconcelos", "Xavier", "Azevedo",
  "Barros", "Bezerra", "Borges", "Brito", "Castro", "Coelho", "Duarte", "Esteves", "Figueiredo", "Garcia",
  "Henriques", "Jesus", "Lacerda", "Macedo", "Maia", "Neves", "Pacheco", "Paiva", "Peixoto", "Queiroz",
  "Reis", "Sampaio", "Serra", "Toledo", "Valente", "Ventura", "Viana", "Amaral", "Bastos", "Caldeira",
] as const

export type Gender = "F" | "M"
export type PersonName = { fullName: string; firstName: string; gender: Gender }

export class NameGenerator {
  private readonly used = new Set<string>()

  constructor(private readonly random: Random) {}

  /** Reserva um nome fixo (personas canônicas) — falha se já foi usado. */
  reserve(fullName: string, gender: Gender): PersonName {
    if (this.used.has(fullName)) throw new Error(`Nome canônico já usado: ${fullName}`)
    this.used.add(fullName)
    return { fullName, firstName: fullName.split(" ")[0]!, gender }
  }

  next(): PersonName {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const gender: Gender = this.random.chance(0.58) ? "F" : "M"
      const firstName = this.random.pick(gender === "F" ? FEMALE_FIRST : MALE_FIRST)
      const surnames = this.random.chance(0.45) ? [this.random.pick(SURNAMES), this.random.pick(SURNAMES)] : [this.random.pick(SURNAMES)]
      if (surnames.length === 2 && surnames[0] === surnames[1]) continue
      const fullName = [firstName, ...surnames].join(" ")
      if (this.used.has(fullName)) continue
      this.used.add(fullName)
      return { fullName, firstName, gender }
    }
    throw new Error("Não foi possível gerar um nome único após 200 tentativas")
  }
}

/** Nomes de clientes nas transcrições (podem repetir entre chamadas — são pessoas diferentes). */
export function customerName(random: Random): { firstName: string; gender: Gender; surname: string } {
  const gender: Gender = random.chance(0.5) ? "F" : "M"
  return { firstName: random.pick(gender === "F" ? FEMALE_FIRST : MALE_FIRST), gender, surname: random.pick(SURNAMES) }
}
