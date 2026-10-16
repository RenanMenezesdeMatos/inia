import type { Metadata } from "next"

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { FieldRow, SeeAlso, StepList, WarningCallout, WikiArticle, WikiLink, WikiPageHeader, WikiSection, WikiTable } from "@/components/wiki/wiki-primitives"
import type { WikiTocEntry } from "@/components/wiki/wiki-toc"

export const metadata: Metadata = {
  title: "Reports recorrentes",
  description: "Consultas da INIA que viram entregas periódicas no Acompanhamento: criação pelo chat ou pela tela, período × frequência, visualizações, permissões (líder e papel Report), atualização das bases e análise da IA.",
}

const TOC: WikiTocEntry[] = [
  { id: "criar", label: "Criar um report" },
  { id: "configurar", label: "Configuração" },
  { id: "permissoes", label: "Quem pode e o que cada um recebe" },
  { id: "execucao", label: "Execução e atualização das bases" },
  { id: "analise", label: "Análise e comparação" },
  { id: "acompanhamento", label: "No Acompanhamento" },
]

export default function ReportsWikiPage() {
  return (
    <WikiArticle toc={TOC}>
      <WikiPageHeader
        eyebrow="02 · Pessoas e Estrutura"
        title="Reports recorrentes"
        lead="Uma consulta que você faz à INIA (“quem está no Q4 da minha equipe?”, “os TOP 3 em Reincidência”) pode virar um report: ela roda sozinha na periodicidade escolhida, com os dados atualizados, e chega ao seu Acompanhamento com gráfico, os valores exatos e um resumo da INIA. O report guarda a consulta de forma reproduzível — nunca o texto do chat."
      />

      <WikiSection id="criar" title="Criar um report" eyebrow="Chat ou tela">
        <StepList
          steps={[
            { title: "Pelo chat", detail: "Depois de uma consulta que dá para repetir, a INIA oferece “Criar report desta consulta”. Aceite pelo botão ou respondendo “sim” logo em seguida — o “sim” só vale para a oferta da última resposta. A oferta não se repete: no máximo uma a cada 3 respostas, nunca a mesma consulta duas vezes na conversa." },
            { title: "Revise o rascunho", detail: "A tela de configuração abre já preenchida com a consulta (indicadores, recorte, filtros, ordem, limite, estrutura e período). O report só passa a rodar depois que você salvar e ativar." },
            { title: "Pela tela", detail: "Reports → Novo report, no seletor de área do topo." },
          ]}
        />
      </WikiSection>

      <WikiSection id="configurar" title="Configuração" eyebrow="Formulário guiado">
        <FieldRow label="Consulta" value="Resultados de indicadores (PRV e quartil geral, por pessoa, equipe, Grupo, Subgrupo ou nível), força de trabalho (situação funcional) ou diagnóstico de um indicador." />
        <FieldRow label="Estrutura" value="“A estrutura de quem recebe” acompanha a equipe ATUAL de cada pessoa a cada execução; uma estrutura específica só chega a quem tem acesso a ela." />
        <FieldRow label="Período analisado" value="Última competência fechada (recalculada a cada execução), últimas N competências, uma competência fixa, o período em curso pela medição diária ou a situação na data da execução." />
        <FieldRow label="Frequência" value="Diária, semanal (dias escolhidos) ou mensal (dia do mês ou último dia), em horários no fuso da operação. Nos meses sem o dia escolhido (ex.: 31), você decide: pular o mês ou usar o último dia." />
        <FieldRow label="Visualização" value="Tabela, indicadores resumidos, barras, linha, área ou distribuição — só as compatíveis com a consulta (evolução exige várias competências mês a mês). Os valores exatos ficam sempre a um clique." />
        <p>Período e frequência são coisas diferentes: dá para rodar todo dia um report do acumulado do mês. A <strong>prévia</strong> mostra a consulta na sua visão, marcada como prévia — não cria entrega.</p>
      </WikiSection>

      <WikiSection id="permissoes" title="Quem pode e o que cada um recebe" eyebrow="Decidido pelo sistema">
        <WikiTable>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Quem</TableHead>
                <TableHead>Pode</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell className="font-medium">Quem lidera (ou tem acesso de consulta)</TableCell>
                <TableCell>Criar reports só para si, gerenciar os próprios, com estruturas do próprio escopo atual.</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium">Papel Report</TableCell>
                <TableCell>Distribuir para todos os usuários elegíveis, níveis, cargos, Grupos, Subgrupos ou pessoas — dentro do escopo da atribuição do papel. Seleções combinadas não duplicam entregas.</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </WikiTable>
        <WarningCallout title="Distribuir não dá acesso a dados" kind="tip">
          Cada destinatário recebe só o que o escopo DELE alcança (versões por escopo). Quem distribui vê o histórico das execuções, não o conteúdo entregue a outras pessoas. A cada execução o sistema revalida o responsável, o público e o escopo de cada um — mudanças de equipe, papel ou vínculo valem na hora. Ver <WikiLink href="/wiki/estrutura/lideranca">A INIA para quem lidera</WikiLink>.
        </WarningCallout>
      </WikiSection>

      <WikiSection id="execucao" title="Execução e atualização das bases" eyebrow="Nunca dado antigo como novo">
        <p>
          O processamento roda no serviço de processamento da INIA (não depende de navegador aberto). Cada execução consulta as mesmas ferramentas do chat e só entrega se houver dado novo: a versão do fechamento oficial, a última data da medição diária e das interações e o estado das cargas da Central de Dados dizem se as bases mudaram. Quando não mudaram — ou não cobrem o período (menos de 70% das pessoas com dado) — a execução fica registrada como <strong>não encaminhada</strong>, com as bases pendentes e a última atualização conhecida, e a última entrega válida continua com a data original.
        </p>
        <p>Resultado vazio (ninguém atende aos filtros) é uma entrega válida e diz “vazio”, nunca zero. Acesso negado e falha técnica são estados próprios no histórico.</p>
      </WikiSection>

      <WikiSection id="analise" title="Análise e comparação" eyebrow="Números do sistema">
        <p>
          A comparação é calculada pelo sistema com a mesma definição, escopo e filtros: competência única contra a anterior; últimas N competências contra as N anteriores; mês a mês, a primeira contra a última. Melhora e piora seguem o sentido de cada métrica (subir nem sempre é melhorar). A INIA escreve o resumo a partir desses números, sem inventar valores; se a análise falhar, a entrega continua válida e pode ser refeita.
        </p>
      </WikiSection>

      <WikiSection id="acompanhamento" title="No Acompanhamento" eyebrow="Entrega × aviso">
        <p>A entrega aparece como “Report”, com período, data da geração, atualização das bases, gráfico (ou tabela), resumo e comparação. O aviso de execução não encaminhada aparece como “Report não encaminhado” — nunca como um report novo — e repetições do mesmo aviso somam-se no mesmo item.</p>
      </WikiSection>

      <SeeAlso
        links={[
          { href: "/wiki/estrutura/lideranca", label: "A INIA para quem lidera" },
          { href: "/wiki/acompanhamento", label: "Acompanhamento e Ciência" },
          { href: "/wiki/central-de-dados", label: "Central de Dados" },
        ]}
      />
    </WikiArticle>
  )
}
