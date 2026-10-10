#!/usr/bin/env node
// Divide o CLAUDE.md monolítico em CLAUDE.md (regras permanentes + índice) e docs/dev/memoria/<área>.md.
//
//   node docs/dev/memoria/ferramentas/dividir.mjs --entrada <cópia do CLAUDE.md antigo> [--raiz <raiz do repositório>]
//
// O conteúdo das seções é copiado sem edição; só os cabeçalhos dos arquivos de área, o índice e o README são
// textos novos (definidos aqui e em estrutura.mjs). Recusa entrada que já esteja dividida e, para não apagar
// edição feita por outra sessão depois da cópia, recusa sobrescrever um CLAUDE.md da raiz diferente da entrada
// (a não ser com --ignorar-claude-atual, usado só quando a entrada vem de outro checkout). Depois de rodar,
// confira com verificar.mjs.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { AREAS, CATEGORIES, CORE } from "./estrutura.mjs";
import { CORE_FILE, assignSections, splitSections } from "./secoes.mjs";

const MEMORY_DIR = "docs/dev/memoria";
const INDEX_HEADING = "## Memória por área";

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key.startsWith("--")) throw new Error(`Argumento inválido: ${key}`);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) {
      args[key.slice(2)] = true;
    } else {
      args[key.slice(2)] = value;
      i += 1;
    }
  }
  if (typeof args.entrada !== "string") throw new Error("Informe --entrada <caminho do CLAUDE.md antigo>.");
  const here = dirname(fileURLToPath(import.meta.url));
  return {
    input: resolve(args.entrada),
    root: resolve(typeof args.raiz === "string" ? args.raiz : join(here, "../../../..")),
    ignoreCurrent: args["ignorar-claude-atual"] === true,
  };
}

const kbOfBytes = (bytes) => `${(bytes / 1024).toFixed(1).replace(".", ",")} KB`;
const kb = (text) => kbOfBytes(Buffer.byteLength(text, "utf8"));
const join2 = (parts) => parts.filter((part) => part !== "").join("\n\n");

function areaHeader(area) {
  const lines = [
    `> Seções movidas sem edição do \`CLAUDE.md\` em 07/10/2026. Critérios e mapa completo em [README.md](README.md).`,
  ];
  for (const note of area.notes) lines.push(`>`, `> ${note}`);
  if (area.related.length > 0) {
    const links = area.related.map((path) => `[${path.replace(/^(\.\.\/)+/, "")}](${path})`).join(", ");
    lines.push(`>`, `> Ver também: ${links}.`);
  }
  return `# Memória — ${area.title}\n\n${lines.join("\n")}`;
}

function indexSection() {
  const line = (area) => `- [${area.title}](${MEMORY_DIR}/${area.file}) — ${area.summary}`;
  return join2([
    INDEX_HEADING,
    `A memória detalhada de cada área (decisões, versões, provas, limitações e dados de dev) fica em \`${MEMORY_DIR}/\`. Leia o arquivo da área antes de mexer nela. Os critérios, o mapa de cada seção antiga para o arquivo onde ela está e as regras de manutenção estão em [${MEMORY_DIR}/README.md](${MEMORY_DIR}/README.md). Quando um texto citar uma seção pelo nome (ex.: “ver "Conversas com a INIA"”), procure o arquivo nesse mapa.`,
    `Memória nova de uma área vai para o arquivo dela, nunca para este arquivo. Aqui só entram regras permanentes, que valem para qualquer sessão, e a linha de cada área nova neste índice.`,
    `Áreas em uso:\n\n${AREAS.filter((area) => !area.history).map(line).join("\n")}`,
    `Histórico (linhas encerradas ou caminhos substituídos — para ler artefatos antigos):\n\n${AREAS.filter((area) => area.history).map(line).join("\n")}`,
  ]);
}

function readme({ inputSha, inputBytes, assigned, outputs }) {
  const sizeOf = (file) => kb(outputs.get(file));
  const coreRows = CORE.filter((rule) => rule.why).map((rule) => `- ${rule.prefix.replace(/^#+ /, "")} — ${rule.why}.`);
  const areaRows = AREAS.map(
    (area) =>
      `| [${area.file}](${area.file}) | ${area.summary.replace(/\|/g, "\\|")} | ${[...new Set(area.sections.map((rule) => rule.category))].sort().join(", ")} | ${sizeOf(area.file)} |`,
  );
  const mapRows = assigned
    .filter((section) => section.rule)
    .map((section) => {
      const target = section.rule.file === CORE_FILE ? "`CLAUDE.md`" : `[${section.rule.file}](${section.rule.file})`;
      return `| ${section.heading.replace(/^#+ /, "").replace(/\|/g, "\\|")} | ${section.rule.category} | ${target} |`;
    });
  return join2([
    "# Memória do projeto — organização",
    `O \`CLAUDE.md\` da raiz é carregado inteiro em toda sessão. Em 07/10/2026 ele tinha ${kbOfBytes(inputBytes)} e misturava as regras permanentes (papel, produto, organização do código, regras de domínio) com o histórico de cada versão: investigação, rodadas pagas, smokes, motor de feedback, Central de Dados etc. Esta pasta guarda a memória de cada área. O \`CLAUDE.md\` fica só com o que toda sessão precisa e com um índice.`,
    "A divisão **moveu** o texto: cada seção do arquivo antigo está, sem edição, em exatamente um destino. Os únicos textos novos são o índice do `CLAUDE.md`, o cabeçalho de cada arquivo desta pasta (origem, notas de navegação, documentos relacionados) e este README.",
    "## Critérios",
    Object.entries(CATEGORIES)
      .map(([key, label]) => `- **(${key})** ${label}.`)
      .join("\n"),
    "Uma seção vai para o `CLAUDE.md` só quando a regra vale para qualquer código ou sessão. Exemplos: nunca conhecer código de domínio ou de indicador; nunca misturar Acompanhamento, Pendências e Sino. O resto é memória de área (b) ou histórico (c). O histórico continua nesta pasta porque explica os artefatos antigos que ainda estão no banco.",
    "## O que fica no `CLAUDE.md`",
    [
      "- Papel do assistente, O produto e Organização do código, inteiros.",
      "- De “Memória arquitetural”, só as seções transversais:",
      ...coreRows.map((row) => `  ${row}`),
      `- O índice “${INDEX_HEADING.replace(/^## /, "")}”: uma linha por arquivo desta pasta.`,
    ].join("\n"),
    "## Arquivos de área",
    ["| Arquivo | Conteúdo | Categoria | Tamanho |", "|---|---|---|---|", ...areaRows].join("\n"),
    "Documentos que já existiam em `docs/dev/`, `docs/architecture/` e `docs/instalacao/` sobre o mesmo assunto foram **linkados** no cabeçalho de cada arquivo, não copiados.",
    "## Mapa: seção do `CLAUDE.md` antigo → destino",
    "Na ordem do arquivo antigo. Use este mapa quando um texto citar uma seção pelo nome.",
    ["| Seção | Categoria | Destino |", "|---|---|---|", ...mapRows].join("\n"),
    "## Como manter",
    [
      "- Memória nova de uma área vai para o fim do arquivo da área. Use o mesmo formato: `### título (data, migrations)`. Nunca escreva memória de área no `CLAUDE.md`.",
      "- Área nova: crie `docs/dev/memoria/<área>.md` com o mesmo cabeçalho e acrescente uma linha ao índice do `CLAUDE.md`.",
      "- O `CLAUDE.md` só recebe regra ou convenção permanente, que vale para qualquer sessão.",
      "- Quando uma versão é substituída, mova a seção sem edição para um arquivo `historico-*` e liste esse arquivo no bloco “Histórico” do índice.",
      "- Quando o assunto já tem documento próprio em `docs/`, ponha o link. Não copie o conteúdo.",
    ].join("\n"),
    "## Como a divisão foi feita e conferida",
    [
      "Ferramentas em [ferramentas/](ferramentas/), Node puro, sem dependências:",
      "",
      "- `estrutura.mjs` — o mapa. Cada seção é reconhecida pelo início do título. Aqui também ficam os resumos do índice e as notas de cada arquivo.",
      "- `dividir.mjs --entrada <cópia do CLAUDE.md antigo>` — gera o `CLAUDE.md`, os arquivos de área e este README. Falha se alguma seção da entrada não estiver no mapa, ou se uma regra do mapa não encontrar a sua seção. Recusa entrada que já esteja dividida. Também recusa gravar quando o `CLAUDE.md` da raiz ficou diferente da cópia, o que indica edição de outra sessão no meio do caminho.",
      "- `verificar.mjs --original <CLAUDE.md antigo>` — confere que cada seção antiga está inteira, idêntica e uma única vez no destino do mapa. Confere também que toda linha antiga existe nos arquivos novos (com o mesmo número de ocorrências), lista as linhas novas, testa os links e mede o `CLAUDE.md`.",
      "",
      `Entrada desta geração: \`CLAUDE.md\` com ${inputBytes} bytes, sha256 \`${inputSha}\`. Resultado: \`CLAUDE.md\` com ${sizeOf(CORE_FILE)}.`,
    ].join("\n"),
  ]);
}

function main() {
  const { input, root, ignoreCurrent } = parseArgs(process.argv.slice(2));
  const text = readFileSync(input, "utf8");
  if (text.includes(`\n${INDEX_HEADING}\n`)) {
    throw new Error(`A entrada já tem "${INDEX_HEADING}": ela já foi dividida.`);
  }
  const { assigned, problems } = assignSections(splitSections(text));
  if (problems.length > 0) {
    throw new Error(`O mapa não cobre a entrada:\n- ${problems.join("\n- ")}`);
  }

  const blocksOf = (file) => assigned.filter((section) => section.rule?.file === file).map((section) => section.text.trimEnd());
  const outputs = new Map();
  outputs.set(CORE_FILE, `${join2([...blocksOf(CORE_FILE), indexSection()])}\n`);
  for (const area of AREAS) {
    // Ordem dentro do arquivo = ordem das regras em estrutura.mjs.
    const ordered = area.sections.map((rule) => {
      const section = assigned.find((candidate) => candidate.rule?.prefix === rule.prefix);
      return section.text.trimEnd();
    });
    outputs.set(area.file, `${join2([areaHeader(area), ...ordered])}\n`);
  }
  const inputSha = createHash("sha256").update(text).digest("hex");
  outputs.set("README.md", `${readme({ inputSha, inputBytes: Buffer.byteLength(text, "utf8"), assigned, outputs })}\n`);

  const currentPath = join(root, CORE_FILE);
  if (!ignoreCurrent && existsSync(currentPath) && readFileSync(currentPath, "utf8") !== text) {
    throw new Error(
      `${currentPath} é diferente da entrada (alguém o editou depois da cópia?). Nada foi gravado. Copie o CLAUDE.md de novo e repita, ou use --ignorar-claude-atual se a entrada veio de outro checkout.`,
    );
  }
  mkdirSync(join(root, MEMORY_DIR), { recursive: true });
  for (const [file, content] of outputs) {
    const path = file === CORE_FILE ? join(root, CORE_FILE) : join(root, MEMORY_DIR, file);
    writeFileSync(path, content);
    console.log(`${kb(content).padStart(9)}  ${file === CORE_FILE ? CORE_FILE : `${MEMORY_DIR}/${file}`}`);
  }
}

main();
