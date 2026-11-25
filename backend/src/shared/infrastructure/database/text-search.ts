/**
 * Busca de nome nas listas e seletores: sem maiúsculas nem acentos, o mesmo nos dois lados (coluna e termo), sem depender da extensão
 * `unaccent`. A busca roda no banco, sobre tudo o que a conta pode ver, antes da paginação.
 */
const FROM = "ÁÀÂÃÄÅáàâãäåÉÈÊËéèêëÍÌÎÏíìîïÓÒÔÕÖóòôõöÚÙÛÜúùûüÇçÑñÝýÿŠšŞşŽžČčĆćŁłĞğ"
const TO = "AAAAAAaaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCcNnYyySsSsZzCcCcLlGg"
const FOLD = new Map([...FROM].map((letter, index) => [letter, TO[index]!]))

export const foldSql = (expression: string) => `lower(translate(${expression}, '${FROM}', '${TO}'))`
/** A MESMA tabela da coluna: letra fora dela fica como está nos dois lados (run-13 CFQ-05: "Şahin" não se achava a si mesma). */
export const foldText = (text: string) => [...text.normalize("NFC")].map((letter) => FOLD.get(letter) ?? letter).join("").toLocaleLowerCase("pt-BR")

const escapeLike = (value: string) => value.replace(/[\\%_]/g, (match) => `\\${match}`)

/** Palavras da busca (até 8) como trechos: cada uma precisa aparecer ("cobranca tarde" acha "Cobrança › Tarde"). */
export const foldedLikeWords = (search: string | undefined) =>
  foldText(search?.trim() ?? "").split(/\s+/).filter(Boolean).slice(0, 8).map((word) => `%${escapeLike(word)}%`)
