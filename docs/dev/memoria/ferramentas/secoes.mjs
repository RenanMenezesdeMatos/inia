// Leitura do CLAUDE.md em seções e associação de cada seção ao seu destino (ver estrutura.mjs).

import { AREAS, CORE } from "./estrutura.mjs";

export const CORE_FILE = "CLAUDE.md";

// Divide o texto em blocos que começam num cabeçalho `#`, `##` ou `###`. Os blocos, unidos por "\n",
// reconstroem o texto original byte a byte.
export function splitSections(text) {
  const blocks = [];
  let current = null;
  for (const line of text.split("\n")) {
    if (/^#{1,3} /.test(line) || current === null) {
      current = { heading: /^#{1,3} /.test(line) ? line : "", lines: [] };
      blocks.push(current);
    }
    current.lines.push(line);
  }
  const result = blocks.map((block) => ({ heading: block.heading, text: block.lines.join("\n") }));
  if (result.map((block) => block.text).join("\n") !== text) {
    throw new Error("A divisão em seções não reconstrói o texto original.");
  }
  return result;
}

// Todas as regras de destino: { prefix, category, file, why? }.
export function destinationRules() {
  return [
    ...CORE.map((rule) => ({ ...rule, file: CORE_FILE })),
    ...AREAS.flatMap((area) => area.sections.map((rule) => ({ ...rule, file: area.file }))),
  ];
}

// Associa cada seção a exatamente uma regra; falha se alguma seção não tiver destino, se tiver mais de um
// ou se uma regra não encontrar sua seção (título renomeado ou seção removida na entrada).
export function assignSections(sections) {
  const rules = destinationRules();
  const problems = [];
  const used = new Map(rules.map((rule) => [rule, 0]));
  const assigned = sections.map((section, index) => {
    if (section.heading === "" && section.text.trim() === "") return { ...section, index, rule: null };
    const matches = rules.filter((rule) => section.heading.startsWith(rule.prefix));
    if (matches.length !== 1) {
      problems.push(
        matches.length === 0
          ? `Seção sem destino no mapa (estrutura.mjs): ${section.heading || "(texto antes do primeiro título)"}`
          : `Seção com mais de um destino: ${section.heading}`,
      );
      return { ...section, index, rule: null };
    }
    used.set(matches[0], used.get(matches[0]) + 1);
    return { ...section, index, rule: matches[0] };
  });
  for (const [rule, count] of used) {
    if (count !== 1) problems.push(`Regra do mapa casou com ${count} seções: "${rule.prefix}"`);
  }
  return { assigned, problems };
}
