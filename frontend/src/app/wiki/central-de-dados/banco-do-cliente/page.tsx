import type { Metadata } from "next"

import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ClientDatabaseDer } from "@/components/wiki/client-database-der"
import { CLIENT_INIA_REFERENCES, CLIENT_KEY_CARE, CLIENT_KEY_REASONS, CLIENT_KEY_RULES, CLIENT_READER_LOGIN, CLIENT_RELATIONS, CLIENT_SCHEMA, CLIENT_TABLES, clientReaderScript, clientTablesScript, columnsOf, createTableSql, EXAMPLE_FIRST_READ_SQL, EXAMPLE_NEXT_READ_FILTER_SQL, type ClientColumn, type ClientTable, type ClientTableGroup } from "@/components/wiki/client-database-tables"
import { SqlBlock } from "@/components/wiki/sql-block"
import { SeeAlso, WarningCallout, WikiArticle, WikiLink, WikiPageHeader, WikiSection, WikiTable } from "@/components/wiki/wiki-primitives"
import type { WikiTocEntry } from "@/components/wiki/wiki-toc"

export const metadata: Metadata = {
  title: "Tabelas no banco do cliente",
  description: "O que criar no banco do cliente para a INIA ler os dados: como a INIA consulta, o SQL das tabelas, o usuário de leitura e o que é cada campo.",
}

const GROUP_SECTIONS: { group: ClientTableGroup; id: string; eyebrow: string }[] = [
  { group: "Cadastro", id: "cadastro", eyebrow: "Quem é quem" },
  { group: "Atendimentos", id: "atendimentos", eyebrow: "Chamadas, gravações e flags" },
  { group: "Indicadores", id: "indicadores", eyebrow: "Resultados e metas" },
  { group: "Jornada e ausências", id: "jornada", eyebrow: "Quem deveria estar trabalhando" },
]

const TOC: WikiTocEntry[] = [
  { id: "resumo", label: "Em resumo" },
  { id: "consulta", label: "Como a INIA consulta" },
  { id: "criar", label: "O que criar" },
  { id: "relacionamentos", label: "Como as tabelas se relacionam" },
  { id: "concatenacao", label: "A chave deve ser concatenada?" },
  { id: "script", label: "Script completo" },
  ...GROUP_SECTIONS.map(({ group, id }) => ({ id, label: group })),
  { id: "regras", label: "Regras dos dados" },
  { id: "confirmar", label: "O que confirmar" },
]

const SHORT_EXAMPLE_LENGTH = 24

/** Texto com nomes de coluna e valores entre crases, como está em `client-database-tables.ts`. */
function WithCode({ text }: { text: string }) {
  return (
    <>
      {text.split("`").map((part, index) => (index % 2 === 1 ? <code key={index}>{part}</code> : part))}
    </>
  )
}

function ExampleValue({ column }: { column: ClientColumn }) {
  const text = column.example === null ? "—" : column.sqlType === "bit" ? (column.example ? "1" : "0") : String(column.example).replaceAll("\n", " ")
  return <span className={text.length <= SHORT_EXAMPLE_LENGTH ? "whitespace-nowrap" : undefined}>{text}</span>
}

function TableBlock({ table }: { table: ClientTable }) {
  return (
    <div id={`tabela-${table.name}`} className="scroll-mt-24 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-mono text-base font-semibold">{CLIENT_SCHEMA}.{table.name}</h3>
        <Badge variant={table.need === "Base" ? "default" : "secondary"}>{table.need}</Badge>
      </div>
      <p>
        {table.purpose} <strong>Uma linha por {table.grain}.</strong>
      </p>
      <WikiTable>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Campo</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead>Obrigatório</TableHead>
              <TableHead>O que é</TableHead>
              <TableHead>Exemplo</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {columnsOf(table).map((column) => (
              <TableRow key={column.name}>
                <TableCell className="font-mono text-xs">{column.name}</TableCell>
                <TableCell className="font-mono text-xs">{column.sqlType}</TableCell>
                <TableCell>{column.required ? "Sim" : "Não"}</TableCell>
                <TableCell className="min-w-64">{column.description}</TableCell>
                <TableCell className="font-mono text-xs">
                  <ExampleValue column={column} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </WikiTable>
      <SqlBlock label={`SQL de ${table.name}`} code={createTableSql(table)} />
    </div>
  )
}

export default function ClientDatabasePage() {
  return (
    <WikiArticle toc={TOC}>
      <WikiPageHeader
        eyebrow="11 · Central de Dados"
        title="Tabelas no banco do cliente"
        lead="O que o time de dados precisa criar para a INIA ler as informações da operação: as tabelas, o usuário de leitura e o que é cada campo. A INIA só lê. Ela nunca cria, altera ou apaga nada neste banco."
      />

      <WikiSection id="resumo" title="Em resumo" eyebrow="O essencial">
        <ul className="list-inside list-disc space-y-1">
          <li>O time de dados cria as tabelas abaixo em um schema próprio, <code>{CLIENT_SCHEMA}</code>, e as mantém preenchidas ao fim dos processos dele.</li>
          <li>A INIA lê essas tabelas na frequência combinada e guarda uma <strong>cópia no banco dela</strong>.</li>
          <li>Telas, chat e geração de feedback usam só essa cópia. Quem usa a INIA nunca dispara consulta no banco do cliente.</li>
          <li>Se o banco ficar travado ou fora do ar, a aplicação continua funcionando com os dados da última leitura.</li>
        </ul>
        <WarningCallout title="Por que tabelas próprias" kind="tip">
          Com tabelas separadas, a leitura da INIA não disputa bloqueio com os processos que alimentam o ambiente operacional. Views direto nas tabelas operacionais também funcionam, desde que tenham estes
          mesmos campos e sejam leves, porque cada página da leitura executa a view de novo.
        </WarningCallout>
      </WikiSection>

      <WikiSection id="consulta" title="Como a INIA consulta" eyebrow="O que chega ao banco">
        <WikiTable caption="Valores padrão. Os que têm faixa são ajustados na configuração da conexão.">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tema</TableHead>
                <TableHead>Como funciona</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow><TableCell>Origem da conexão</TableCell><TableCell>Sempre o servidor da INIA, nunca o navegador de quem usa.</TableCell></TableRow>
              <TableRow><TableCell>Comandos</TableCell><TableCell>Só <code>SELECT</code>, gerado pela própria INIA. Ninguém digita SQL na tela.</TableCell></TableRow>
              <TableRow><TableCell>Frequência</TableCell><TableCell>Manual, a cada intervalo (de 5 minutos a 24 horas) ou diária em um horário escolhido, por tabela.</TableCell></TableRow>
              <TableRow><TableCell>O que é lido</TableCell><TableCell>Só as linhas com <code>atualizado_em</code> depois da última leitura, e só as colunas configuradas.</TableCell></TableRow>
              <TableRow><TableCell>Volume</TableCell><TableCell>Páginas de 1.000 linhas (100 a 10.000) e até 50.000 linhas por carga (1.000 a 1.000.000). Passou disso, a carga seguinte continua de onde parou.</TableCell></TableRow>
              <TableRow><TableCell>Simultaneidade</TableCell><TableCell>No máximo 2 operações ao mesmo tempo por conexão.</TableCell></TableRow>
              <TableRow><TableCell>Tempos-limite</TableCell><TableCell>15 segundos para conectar, 120 segundos por consulta (até 600) e 10 segundos esperando um bloqueio.</TableCell></TableRow>
              <TableRow><TableCell>Se der tempo esgotado</TableCell><TableCell>A carga agendada tenta de novo depois de 1, 5, 15, 30, 60 e 60 minutos e retoma do ponto já gravado, sem perder nem duplicar linhas.</TableCell></TableRow>
              <TableRow><TableCell>Login</TableCell><TableCell>Usuário e senha do próprio banco. Login Windows ou Active Directory não é suportado.</TableCell></TableRow>
            </TableBody>
          </Table>
        </WikiTable>
        <p>Este é o comando exato que a INIA envia ao ler <code>indicadores_diarios</code>. As outras tabelas seguem o mesmo formato.</p>
        <SqlBlock label="Primeira leitura" code={EXAMPLE_FIRST_READ_SQL} />
        <p>Nas leituras seguintes, ela acrescenta este trecho ao <code>WHERE</code> para continuar depois da última linha lida:</p>
        <SqlBlock label="Trecho das leituras seguintes" code={EXAMPLE_NEXT_READ_FILTER_SQL} />
        <p>
          O <code>TOP (1001)</code> traz uma linha além da página, só para saber se ainda há mais. As colunas <code>__inia_p…</code> guardam a posição da leitura. O índice <code>ix_…_leitura</code> de cada tabela
          existe para o <code>ORDER BY</code> não pesar no banco.
        </p>
      </WikiSection>

      <WikiSection id="criar" title="O que criar" eyebrow="As tabelas">
        <p>
          <strong>Base</strong> é o conjunto para gerar feedback de atendimento e de indicador. <strong>Complementar</strong> melhora a análise e pode vir depois. Não há tabela de estrutura à parte: o gestor e o grupo
          de cada pessoa vêm em <code>colaboradores</code>.
        </p>
        <WikiTable>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tabela</TableHead>
                <TableHead>Grupo</TableHead>
                <TableHead>Uma linha por</TableHead>
                <TableHead>Necessidade</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {CLIENT_TABLES.map((table) => (
                <TableRow key={table.name}>
                  <TableCell className="font-mono text-xs">{table.name}</TableCell>
                  <TableCell>{table.group}</TableCell>
                  <TableCell>{table.grain}</TableCell>
                  <TableCell>{table.need}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </WikiTable>
      </WikiSection>

      <WikiSection id="relacionamentos" title="Como as tabelas se relacionam" eyebrow="DER: chaves primárias e estrangeiras">
        <p>
          <code>colaboradores</code> é o centro: quase tudo aponta para a <code>matricula</code>. Cada linha do desenho sai da coluna que guarda a referência (a chave estrangeira) e chega à chave primária da outra tabela.
        </p>
        <ClientDatabaseDer />
        <WikiTable caption="Chave primária de cada tabela: é ela que identifica a linha. Reenviar a mesma chave atualiza a linha, em vez de duplicar.">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tabela</TableHead>
                <TableHead>Chave primária (PK)</TableHead>
                <TableHead>Uma linha por</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {CLIENT_TABLES.map((table) => (
                <TableRow key={table.name}>
                  <TableCell className="font-mono text-xs">{table.name}</TableCell>
                  <TableCell className="font-mono text-xs">{table.primaryKey.join(" + ")}</TableCell>
                  <TableCell>{table.grain}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </WikiTable>
        <WikiTable caption="Chaves estrangeiras. O script não cria FOREIGN KEY: quem confere é a carga da INIA, e a linha que não encontra o registro vai para a quarentena com este código.">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Coluna (FK)</TableHead>
                <TableHead>Aponta para (PK)</TableHead>
                <TableHead>Quando vale</TableHead>
                <TableHead>Se o valor não existir</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {CLIENT_RELATIONS.map((relation) => (
                <TableRow key={`${relation.table}.${relation.column}>${relation.targetTable}`}>
                  <TableCell className="font-mono text-xs">{relation.table}.{relation.column}</TableCell>
                  <TableCell className="font-mono text-xs">{relation.targetTable}.{relation.targetColumn}</TableCell>
                  <TableCell className="min-w-40">{relation.condition ? <code>{relation.condition}</code> : relation.note ?? "Sempre que preenchida"}</TableCell>
                  <TableCell className="font-mono text-xs">{relation.rejection}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </WikiTable>
        <p>
          Estes códigos não têm tabela no banco do cliente, porque são cadastrados na própria INIA:{" "}
          {CLIENT_INIA_REFERENCES.map((reference, index) => (
            <span key={`${reference.table}.${reference.column}`}>
              {index > 0 ? ", " : ""}
              <code>{reference.table}.{reference.column}</code> ({reference.catalog})
            </span>
          ))}
          .
        </p>
      </WikiSection>

      <WikiSection id="concatenacao" title="A chave deve ser concatenada?" eyebrow="Em regra, não">
        <p>
          Cada parte da chave fica na sua própria coluna. A concatenação só entra quando o código sozinho se repete, como o subgrupo: a INIA pede um código único na organização inteira, em uma coluna só.
        </p>
        <WikiTable>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Situação</TableHead>
                <TableHead>O que fazer</TableHead>
                <TableHead>Exemplo</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {CLIENT_KEY_RULES.map((rule) => (
                <TableRow key={rule.situation}>
                  <TableCell>{rule.situation}</TableCell>
                  <TableCell>{rule.rule}</TableCell>
                  <TableCell><WithCode text={rule.example} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </WikiTable>
        <p><strong>Por que não juntar as partes de uma chave composta:</strong></p>
        <ul className="list-inside list-disc space-y-1">
          {CLIENT_KEY_REASONS.map((reason) => (
            <li key={reason}><WithCode text={reason} /></li>
          ))}
        </ul>
        <p><strong>Cuidados com o valor das chaves:</strong></p>
        <ul className="list-inside list-disc space-y-1">
          {CLIENT_KEY_CARE.map((care) => (
            <li key={care}><WithCode text={care} /></li>
          ))}
        </ul>
      </WikiSection>

      <WikiSection id="script" title="Script completo" eyebrow="Pronto para rodar">
        <p>
          Escrito para SQL Server 2016 ou mais novo. Rode tudo de uma vez no banco escolhido, pelo SQL Server Management Studio ou pelo sqlcmd. O campo <code>atualizado_em</code> é preenchido sozinho ao inserir, mas o processo de
          carga precisa atualizá-lo em todo <code>UPDATE</code>.
        </p>
        <SqlBlock label="Schema, tabelas e índices" code={clientTablesScript()} />
        <p>
          Depois, crie o usuário que a INIA vai usar. O <code>{CLIENT_READER_LOGIN}</code> só consegue ler o schema <code>{CLIENT_SCHEMA}</code>. Rode no mesmo banco e troque a senha.
        </p>
        <SqlBlock label="Usuário só de leitura" code={clientReaderScript()} />
      </WikiSection>

      {GROUP_SECTIONS.map(({ group, id, eyebrow }) => (
        <WikiSection key={id} id={id} title={group} eyebrow={eyebrow}>
          {CLIENT_TABLES.filter((table) => table.group === group).map((table) => (
            <TableBlock key={table.name} table={table} />
          ))}
        </WikiSection>
      ))}

      <WikiSection id="regras" title="Regras dos dados" eyebrow="O que evita retrabalho">
        <ul className="list-inside list-disc space-y-2">
          <li><strong><code>atualizado_em</code> precisa mudar junto com a linha.</strong> Uma correção que não altera esse campo não chega à INIA. Linha com ele vazio não é lida.</li>
          <li><strong>Indicador diário é o resultado do dia, nunca o acumulado do mês.</strong> A INIA soma os dias para chegar ao período: o TMA é a soma do tempo dividida pela soma dos atendimentos. Um acumulado seria somado de novo a cada dia.</li>
          <li><strong>Mês em andamento e fechamento são coisas diferentes.</strong> O mês em andamento vem de <code>indicadores_diarios</code>. O resultado oficial vem de <code>fechamentos_mensais</code> e nunca é recalculado.</li>
          <li><strong>Códigos precisam existir na INIA antes da carga:</strong> indicadores e flags são cadastrados lá com o mesmo código usado aqui.</li>
          <li><strong>Horários sem fuso são lidos no horário local da operação.</strong></li>
          <li><strong>A ordem da primeira carga importa:</strong> grupos, subgrupos, colaboradores e só então o resto. Chamada de matrícula desconhecida, por exemplo, vai para a quarentena em vez de criar uma pessoa falsa.</li>
          <li><strong>Reenviar não duplica.</strong> Cada linha é identificada pela chave da tabela: linha nova entra, linha alterada é atualizada e linha igual não muda nada.</li>
          <li><strong>Apagar aqui não apaga na INIA.</strong> Uma linha que some do banco continua na cópia. Para corrigir, atualize a linha. Em ausências e exceções, use <code>vigente = 0</code>.</li>
          <li><strong>Colunas binárias não são lidas.</strong> A gravação chega como texto, em <code>transcricoes</code>.</li>
        </ul>
      </WikiSection>

      <WikiSection id="confirmar" title="O que confirmar" eyebrow="Antes de começar">
        <ul className="list-inside list-disc space-y-1">
          <li>Qual é o banco e a versão. A INIA também lê PostgreSQL, MySQL e MariaDB: os campos são os mesmos, e só os tipos do script mudam.</li>
          <li>Em que horários os processos rodam e quanto tempo costumam travar as tabelas, para escolher a frequência.</li>
          <li>Se a rede libera o servidor da INIA até a porta do banco.</li>
          <li>Se o banco aceita login por usuário e senha.</li>
          <li>Quais indicadores e flags existem e com quais códigos, para cadastrar igual na INIA.</li>
          <li>Se o resultado diário existe por dia ou só acumulado no mês.</li>
        </ul>
      </WikiSection>

      <SeeAlso
        links={[
          { href: "/wiki/central-de-dados/conectores#banco-de-dados", label: "Conector de banco de dados", hint: "Como configurar a leitura na tela" },
          { href: "/wiki/central-de-dados/guias", label: "Guias e troubleshooting", hint: "Passo a passo e erros comuns" },
        ]}
      />
      <p className="text-sm text-muted-foreground">
        Depois de criar as tabelas, a conexão é feita na tela <WikiLink href="/wiki/central-de-dados/conectores#banco-de-dados">Conectar banco de dados</WikiLink>.
      </p>
    </WikiArticle>
  )
}
