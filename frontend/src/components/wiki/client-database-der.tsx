import { buildClientDerLayout, type DerBox, type DerEdge, type DerTone } from "./client-database-der-layout"
import type { ClientTableGroup } from "./client-database-tables"

/**
 * DER das tabelas do banco do cliente. As cores vêm de variáveis `--der-*`, definidas aqui para a Wiki e na página publicada para
 * o time de dados: o mesmo SVG serve aos dois lugares e é a origem da figura da IT-INIA-008.
 */
const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
const SANS = "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Arial, sans-serif"
const TONE_COLOR: Record<DerTone, string> = { structure: "var(--der-structure)", people: "var(--der-people)", call: "var(--der-call)" }
const GROUP_COLOR: Record<ClientTableGroup, string> = { Cadastro: "var(--der-structure)", Atendimentos: "var(--der-call)", Indicadores: "var(--der-indicators)", "Jornada e ausências": "var(--der-journey)" }

const TOKENS =
  "[--der-bg:var(--card)] [--der-fg:var(--foreground)] [--der-muted:var(--muted-foreground)] [--der-border:var(--border)] [--der-people:var(--primary)] [--der-structure:#0f766e] dark:[--der-structure:#2dd4bf] [--der-call:#b45309] dark:[--der-call:#fbbf24] [--der-indicators:#1d4ed8] dark:[--der-indicators:#60a5fa] [--der-journey:#475569] dark:[--der-journey:#94a3b8]"

function KeyTag({ x, y, label, color }: { x: number; y: number; label: string; color: string }) {
  return (
    <text x={x} y={y} fontFamily={MONO} fontSize={9.5} fontWeight={700} fill={color}>
      {label}
    </text>
  )
}

function TableBox({ box }: { box: DerBox }) {
  const headerColor = GROUP_COLOR[box.group]
  return (
    <g data-der-table={box.table}>
      <rect x={box.x} y={box.y} width={box.width} height={box.height} rx={5} fill="var(--der-bg)" stroke="var(--der-border)" />
      <path d={`M${box.x} ${box.y + 28} V${box.y + 5} a5 5 0 0 1 5 -5 H${box.x + box.width - 5} a5 5 0 0 1 5 5 V${box.y + 28} Z`} fill={headerColor} fillOpacity={0.14} stroke="none" />
      <text x={box.x + 10} y={box.y + 18.5} fontFamily={MONO} fontSize={12.5} fontWeight={700} fill="var(--der-fg)">
        {box.table}
      </text>
      {box.need === "Complementar" ? (
        <text x={box.x + box.width - 9} y={box.y + 18} textAnchor="end" fontFamily={SANS} fontSize={9.5} fill="var(--der-muted)">
          complementar
        </text>
      ) : null}
      {box.rows.map((row, index) => (
        <g key={row.column}>
          <line x1={box.x} x2={box.x + box.width} y1={row.y} y2={row.y} stroke="var(--der-border)" strokeWidth={index === 0 ? 1 : 0.5} />
          {row.pk ? <KeyTag x={box.x + 8} y={row.y + 13.5} label="PK" color="var(--der-people)" /> : null}
          {row.fk ? <KeyTag x={box.x + 25} y={row.y + 13.5} label="FK" color="var(--der-structure)" /> : null}
          {row.ref ? <KeyTag x={box.x + 25} y={row.y + 13.5} label="RF" color="var(--der-call)" /> : null}
          <text x={box.x + 46} y={row.y + 14} fontFamily={MONO} fontSize={11.5} fontWeight={row.pk ? 700 : 400} fill={row.pk || row.fk || row.ref ? "var(--der-fg)" : "var(--der-muted)"}>
            {row.column}
          </text>
        </g>
      ))}
    </g>
  )
}

/** Pé de galinha no lado de muitos e traço duplo no lado de um. */
function RelationLine({ edge }: { edge: DerEdge }) {
  const color = TONE_COLOR[edge.tone]
  const [[childX, childY], , , [parentX, parentY]] = edge.points as [[number, number], [number, number], [number, number], [number, number]]
  const foot = childX + edge.childDirection * 9
  const tick = parentX + edge.parentDirection * 5
  const secondTick = parentX + edge.parentDirection * 9
  return (
    <g data-der-relation={edge.id} stroke={color} fill="none" strokeWidth={1.2}>
      <polyline points={edge.points.map(([x, y]) => `${x},${y}`).join(" ")} strokeDasharray={edge.conditional ? "4 3" : undefined} />
      <path d={`M${foot} ${childY} L${childX} ${childY - 4} M${foot} ${childY} L${childX} ${childY + 4}`} />
      <path d={`M${tick} ${parentY - 3.5} V${parentY + 3.5} M${secondTick} ${parentY - 3.5} V${parentY + 3.5}`} />
    </g>
  )
}

const GROUP_LEGEND: { group: ClientTableGroup; x: number }[] = [
  { group: "Cadastro", x: 62 },
  { group: "Atendimentos", x: 160 },
  { group: "Indicadores", x: 290 },
  { group: "Jornada e ausências", x: 410 },
]

function Legend({ y, width }: { y: number; width: number }) {
  const rowOne = y + 22
  const rowTwo = y + 44
  const rowThree = y + 66
  const rowFour = y + 88
  const text = { fontFamily: SANS, fontSize: 11.5, fill: "var(--der-fg)" }
  return (
    <g data-der-legend>
      <line x1={10} x2={width - 10} y1={y} y2={y} stroke="var(--der-border)" />
      <KeyTag x={62} y={rowOne} label="PK" color="var(--der-people)" />
      <text x={80} y={rowOne} {...text}>chave primária</text>
      <KeyTag x={190} y={rowOne} label="FK" color="var(--der-structure)" />
      <text x={208} y={rowOne} {...text}>chave estrangeira</text>
      <KeyTag x={336} y={rowOne} label="RF" color="var(--der-call)" />
      <text x={354} y={rowOne} {...text}>código de um cadastro da INIA (Indicadores ou Flags de canal), sem tabela no banco do cliente</text>

      <g stroke="var(--der-people)" fill="none" strokeWidth={1.2}>
        <line x1={62} x2={102} y1={rowTwo - 4} y2={rowTwo - 4} />
        <path d={`M71 ${rowTwo - 4} L62 ${rowTwo - 8} M71 ${rowTwo - 4} L62 ${rowTwo} M97 ${rowTwo - 7.5} V${rowTwo - 0.5} M93 ${rowTwo - 7.5} V${rowTwo - 0.5}`} />
      </g>
      <text x={110} y={rowTwo} {...text}>muitas linhas (lado da FK) para uma linha (lado da PK)</text>
      <line x1={470} x2={510} y1={rowTwo - 4} y2={rowTwo - 4} stroke="var(--der-people)" strokeWidth={1.2} strokeDasharray="4 3" />
      <text x={518} y={rowTwo} {...text}>
        vale conforme <tspan fontFamily={MONO}>metas.tipo_sujeito</tspan>
      </text>

      {GROUP_LEGEND.map(({ group, x }) => (
        <g key={group}>
          <rect x={x} y={rowThree - 10} width={14} height={12} rx={2} fill={GROUP_COLOR[group]} fillOpacity={0.14} stroke={GROUP_COLOR[group]} strokeWidth={0.75} />
          <text x={x + 20} y={rowThree} {...text}>{group}</text>
        </g>
      ))}

      <text x={62} y={rowFour} {...text} fill="var(--der-muted)">
        Toda tabela também tem <tspan fontFamily={MONO}>atualizado_em</tspan>, que controla a leitura e não aparece aqui. As relações são conferidas pela INIA na carga.
      </text>
    </g>
  )
}

export function ClientDatabaseDer() {
  const layout = buildClientDerLayout()
  return (
    <figure className={`overflow-x-auto rounded-lg border border-border bg-card p-3 ${TOKENS}`}>
      <svg
        data-der="tabelas-do-cliente"
        xmlns="http://www.w3.org/2000/svg"
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        role="img"
        aria-label="Diagrama entidade-relacionamento das 14 tabelas do banco do cliente, com chaves primárias e estrangeiras. As mesmas relações estão na tabela logo abaixo."
        className="block h-auto w-full min-w-[820px]"
      >
        {layout.edges.map((edge) => (
          <RelationLine key={edge.id} edge={edge} />
        ))}
        {layout.boxes.map((box) => (
          <TableBox key={box.table} box={box} />
        ))}
        <Legend y={layout.diagramHeight} width={layout.width} />
      </svg>
    </figure>
  )
}
