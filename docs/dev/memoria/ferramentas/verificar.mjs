#!/usr/bin/env node
// Confere que a divisão do CLAUDE.md não perdeu nem alterou nada.
//
//   node docs/dev/memoria/ferramentas/verificar.mjs --original <CLAUDE.md antigo> [--raiz <raiz do repositório>]
//
// Verificações (sai com código 1 se alguma falhar):
//   1. Seções: cada seção do arquivo antigo (título + corpo) aparece inteira, idêntica e UMA única vez em todos os
//      arquivos novos juntos — sem depender do mapa —, e no arquivo que o mapa (estrutura.mjs) indica.
//   2. Linhas: toda linha não vazia do arquivo antigo existe nos arquivos novos, pelo menos tantas vezes quanto
//      aparecia. As linhas novas (cabeçalhos, notas, índice) são listadas para conferência.
//   3. Links relativos de todos os arquivos novos apontam para arquivos que existem.
//   4. Índice: todo arquivo de área existe, está no mapa e tem link no CLAUDE.md.
//   5. Tamanho: CLAUDE.md abaixo do limite (--limite-kb, padrão 40).

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { AREAS } from "./estrutura.mjs";
import { CORE_FILE, assignSections, splitSections } from "./secoes.mjs";

const MEMORY_DIR = "docs/dev/memoria";

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    if (!key?.startsWith("--") || argv[i + 1] === undefined) throw new Error(`Argumento inválido: ${key}`);
    args[key.slice(2)] = argv[i + 1];
  }
  if (!args.original) throw new Error("Informe --original <caminho do CLAUDE.md antigo>.");
  const here = dirname(fileURLToPath(import.meta.url));
  return {
    original: resolve(args.original),
    root: resolve(args.raiz ?? join(here, "../../../..")),
    limitKb: Number(args["limite-kb"] ?? 40),
  };
}

function countOccurrences(haystack, needle) {
  let count = 0;
  for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, at + needle.length)) count += 1;
  return count;
}

function lineCounts(text) {
  const counts = new Map();
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    counts.set(line, (counts.get(line) ?? 0) + 1);
  }
  return counts;
}

function main() {
  const { original, root, limitKb } = parseArgs(process.argv.slice(2));
  const failures = [];
  const oldText = readFileSync(original, "utf8");

  // Arquivos novos: CLAUDE.md + todo .md de docs/dev/memoria (as ferramentas não contam).
  const memoryPath = join(root, MEMORY_DIR);
  const outputs = new Map([[CORE_FILE, readFileSync(join(root, CORE_FILE), "utf8")]]);
  for (const name of readdirSync(memoryPath).filter((entry) => entry.endsWith(".md")).sort()) {
    outputs.set(name, readFileSync(join(memoryPath, name), "utf8"));
  }
  const pathOf = (file) => (file === CORE_FILE ? join(root, CORE_FILE) : join(memoryPath, file));

  // 1. Seções.
  const { assigned, problems } = assignSections(splitSections(oldText));
  failures.push(...problems);
  let sectionsOk = 0;
  const sections = assigned.filter((section) => section.text.trim() !== "");
  for (const section of sections) {
    const block = section.text.trimEnd();
    const found = [...outputs].map(([file, text]) => [file, countOccurrences(text, block)]).filter(([, n]) => n > 0);
    const total = found.reduce((sum, [, n]) => sum + n, 0);
    const label = section.heading || "(texto antes do primeiro título)";
    if (total !== 1) {
      failures.push(`Seção encontrada ${total} vez(es) (esperado 1): ${label}${total ? ` em ${found.map(([f]) => f).join(", ")}` : ""}`);
      continue;
    }
    if (section.rule && found[0][0] !== section.rule.file) {
      failures.push(`Seção em ${found[0][0]}, mas o mapa indica ${section.rule.file}: ${label}`);
      continue;
    }
    sectionsOk += 1;
  }

  // 2. Linhas.
  const oldLines = lineCounts(oldText);
  const newLines = lineCounts([...outputs.values()].join("\n"));
  let missingLines = 0;
  for (const [line, count] of oldLines) {
    const have = newLines.get(line) ?? 0;
    if (have < count) {
      missingLines += 1;
      failures.push(`Linha ausente (${have}/${count}): ${line.slice(0, 140)}${line.length > 140 ? "…" : ""}`);
    }
  }
  const addedByFile = [...outputs].map(([file, text]) => [
    file,
    [...new Set(text.split("\n").filter((line) => line.trim() !== "" && !oldLines.has(line)))],
  ]);

  // 3. Links relativos.
  let links = 0;
  for (const [file, text] of outputs) {
    for (const match of text.matchAll(/\]\(([^)\s]+)\)/g)) {
      const target = match[1].split("#")[0];
      // Âncora, URL externa ou rota da aplicação citada no texto (ex.: `/materiais/id`) não são arquivos.
      if (target === "" || /^[a-z]+:/i.test(target) || target.startsWith("/")) continue;
      links += 1;
      if (!existsSync(resolve(dirname(pathOf(file)), target))) failures.push(`Link quebrado em ${file}: ${match[1]}`);
    }
  }

  // 4. Índice.
  const core = outputs.get(CORE_FILE);
  const mapped = new Set(AREAS.map((area) => area.file));
  for (const area of AREAS) {
    if (!outputs.has(area.file)) failures.push(`Arquivo de área ausente: ${MEMORY_DIR}/${area.file}`);
    if (!core.includes(`](${MEMORY_DIR}/${area.file})`)) failures.push(`Sem link no índice do CLAUDE.md: ${area.file}`);
  }
  for (const file of outputs.keys()) {
    if (file !== CORE_FILE && file !== "README.md" && !mapped.has(file)) {
      failures.push(`Arquivo em ${MEMORY_DIR} fora do mapa e do índice: ${file}`);
    }
  }

  // 5. Tamanho.
  const coreBytes = Buffer.byteLength(core, "utf8");
  if (coreBytes > limitKb * 1024) failures.push(`CLAUDE.md com ${coreBytes} bytes (limite ${limitKb} KB)`);

  const oldBytes = Buffer.byteLength(oldText, "utf8");
  console.log(`Original: ${oldBytes} bytes, ${sections.length} seções, ${oldLines.size} linhas distintas não vazias.`);
  console.log(`Seções inteiras, idênticas e únicas no destino do mapa: ${sectionsOk}/${sections.length}.`);
  console.log(`Linhas do original presentes nos arquivos novos: ${oldLines.size - missingLines}/${oldLines.size}.`);
  console.log(`Links relativos conferidos: ${links}.`);
  console.log(`CLAUDE.md: ${coreBytes} bytes (${(coreBytes / 1024).toFixed(1)} KB; antes ${(oldBytes / 1024).toFixed(1)} KB).`);
  console.log("Linhas novas por arquivo (texto de organização, não existiam no original):");
  for (const [file, lines] of addedByFile) {
    console.log(`  ${file}: ${lines.length}`);
    if (file !== "README.md") for (const line of lines) console.log(`    + ${line.slice(0, 150)}${line.length > 150 ? "…" : ""}`);
  }
  if (failures.length > 0) {
    console.error(`\nFALHOU (${failures.length}):\n- ${failures.join("\n- ")}`);
    process.exit(1);
  }
  console.log("\nOK: nenhuma seção ou linha do original foi perdida ou alterada.");
}

main();
