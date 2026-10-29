import type { Metadata } from "next"

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { FieldRow, SeeAlso, StepList, WarningCallout, WikiArticle, WikiLink, WikiPageHeader, WikiSection, WikiTable } from "@/components/wiki/wiki-primitives"
import type { WikiTocEntry } from "@/components/wiki/wiki-toc"

export const metadata: Metadata = {
  title: "A INIA para quem lidera",
  description: "Onde atuar hoje, perguntas à INIA sobre indicadores, PRV, quartis, força de trabalho e diagnóstico, regras dos números, escopo de acesso e o caminho do consolidado ao detalhe — Supervisor, Coordenador, Gerente, Gerente Sênior e Diretor.",
}

const TOC: WikiTocEntry[] = [
  { id: "visao-geral", label: "Visão geral" },
  { id: "onde-atuar", label: "Onde atuar hoje" },
  { id: "perguntar", label: "Perguntar à INIA" },
  { id: "numeros", label: "Como os números são calculados" },
  { id: "escopo", label: "Escopo e acesso" },
  { id: "detalhe", label: "Do consolidado ao detalhe" },
  { id: "limitacoes", label: "Limitações atuais" },
]

export default function LeadershipPage() {
  return (
    <WikiArticle toc={TOC}>
      <WikiPageHeader
        eyebrow="02 · Pessoas e Estrutura"
        title="A INIA para quem lidera"
        lead="Supervisor, Coordenador, Gerente e Gerente Sênior usam o mesmo Acompanhamento e a mesma INIA. O que muda é o escopo: a estrutura que cada um lidera, com os níveis abaixo como existem de verdade (inclusive quando falta um nível intermediário). Os números vêm sempre do sistema; a INIA explica e sugere, nunca inventa um dado."
      />

      <WikiSection id="onde-atuar" title="Onde atuar hoje" eyebrow="Topo do Acompanhamento">
        <p>Quem lidera vê, no topo do Acompanhamento, uma lista curta e ordenada do que pede atenção — calculada pelo sistema, sem IA:</p>
        <StepList
          steps={[
            { title: "Decisões que aguardam você", detail: "Revisões, intervenções e produção não identificada endereçadas a você; as atrasadas primeiro." },
            { title: "Indicadores com mais pessoas fora da referência", detail: "Quantas de quantas pessoas com referência, na competência analisada, e quanto era no mês anterior." },
            { title: "Onde o desvio se concentra", detail: "Quando o indicador mais crítico tem o desvio concentrado em poucas unidades abaixo de você, elas aparecem com a participação no total de pessoas fora." },
            { title: "Ciências pendentes e dados incompletos", detail: "Feedbacks publicados ainda sem a confirmação do colaborador e avisos de cobertura baixa." },
          ]}
        />
        <p>Cada item tem um link para a tela que resolve (Pendências, caso, Indicadores, Equipe) e, quando faz sentido, “Perguntar à INIA”, que leva a pergunta ao painel ao lado — só no clique.</p>
      </WikiSection>

      <WikiSection id="perguntar" title="Perguntar à INIA" eyebrow="Chat e voz">
        <p>
          Por texto ou por voz, pergunte do seu jeito — não há perguntas prontas. A INIA vai aos indicadores da sua estrutura, calcula com as mesmas regras das telas (por unidade,
          pessoa, mês ou indicador, no fechamento oficial ou na medição diária do mês em curso) e responde com uma explicação completa: a resposta direta, uma tabela com os
          números, o que os dados mostram, hipóteses (sempre marcadas como hipótese) e onde atuar. Abaixo da resposta, “Dados e links” abre os números com a base de cálculo
          e os atalhos para as telas. Por voz, a resposta completa aparece na tela e a INIA fala um resumo. Exemplos:
        </p>
        <FieldRow label="Supervisor" value="“Quais os meus piores resultados de PRV?”, “Quem está no meu pior quartil geral?”, “Quais os meus melhores em Rechamada?”, “Onde está o principal problema em TMA?”, “Nos últimos 3 meses, quem está no pior atingimento em Reincidência?”" />
        <FieldRow label="Coordenador" value="“Quais grupos estão com o pior resultado e onde atacar?”, “Quais supervisores têm mais operadores no Q4?”, “Quais as maiores dispersões em quartil?”, “Nos últimos 3 meses, quais supervisores estão no pior consolidado?”" />
        <FieldRow label="Gerente, Gerente Sênior e Diretor" value="As mesmas perguntas sobre os níveis abaixo (coordenadores, gerentes, gerentes seniores), Grupos e Subgrupos — níveis ausentes são tratados: quem responde direto a você aparece como unidade própria." />
        <FieldRow label="Força de trabalho" value="“Quantas pessoas estão de férias?”, “Qual % está em produção por supervisor?”, “Quem está de férias na equipe de cada supervisor?” — quantidade, percentual ou nomes, conforme a pergunta." />
        <FieldRow label="Qualquer nível" value="“Como estão minhas equipes neste mês?” (mês em curso pela medição diária + último fechamento oficial), “Quem está fora da meta em 3 ou mais indicadores?”, “Como evoluiu TMA nos últimos 4 meses?”, “Como melhorar este indicador?”" />
        <p>
          A INIA pode fazer várias consultas na mesma resposta — achar os piores e, em seguida, diagnosticar o que eles têm em comum — e aprofundar na conversa (“e dentro desse
          grupo, quem puxa para baixo?”). O <strong>diagnóstico do indicador</strong> compara quem está fora com quem está dentro da referência nas interações do período (motivo
          e submotivo, participação, duração média, tempo de casa e unidade): são associações, apresentadas como hipóteses a confirmar com escuta e monitoria.
        </p>
        <p>O operador também pergunta à INIA sobre os próprios números (“qual meu pior indicador?”, “estou na meta em TMA?”, “como estou indo este mês?”) — sempre só os dele.</p>
        <p>
          Processos e procedimentos são respondidos pelo Orquestrador do <strong>Grupo</strong> da dúvida, com os especialistas, as bases e os materiais de apoio daquele Grupo
          (ver <WikiLink href="/wiki/orchestrators">Orchestrators</WikiLink>). Quem lidera equipes de Grupos diferentes pode dizer o Grupo (“no Faturamento…”) ou a equipe
          (“na equipe da supervisora…”); se todos os seus Grupos usam a mesma base, não precisa dizer nada. Quando os Grupos têm bases diferentes e a pergunta não indica
          qual, a INIA pergunta — ou traz o procedimento de cada um, dizendo de qual Grupo veio. Grupo sem Orquestrador próprio usa o de “Todos os grupos”. A INIA só consulta
          e recomenda: decidir uma revisão, abrir ou executar uma intervenção é feito por você, nas telas.
        </p>
      </WikiSection>

      <WikiSection id="numeros" title="Como os números são calculados" eyebrow="Regras únicas">
        <WikiTable>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Termo</TableHead>
                <TableHead>Regra</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell className="font-medium">Fora da meta</TableCell>
                <TableCell>Atingimento oficial abaixo de 100%; sem atingimento, o valor comparado à meta pela direção do indicador. “Desempenho ruim” sem outra qualificação significa isso.</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium">% do time</TableCell>
                <TableCell>Pessoas fora ÷ operadores ativos com referência avaliável no indicador e na competência. Sem dado fica fora do denominador e é informado à parte — sem dado nunca é desempenho ruim.</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium">Melhores e piores</TableCell>
                <TableCell>Pelo atingimento oficial (já ajustado a “maior” ou “menor é melhor”). Empates dividem a posição (1, 2, 2, 4). Indicador “na meta” não tem ranking.</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium">Quartil e decil</TableCell>
                <TableCell>Quartil = o oficial da fonte. Decil = calculado pela INIA dentro da estrutura analisada (D1 = melhores 10%), com ao menos 10 pessoas ranqueadas.</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium">Atingimento médio</TableCell>
                <TableCell>Média simples dos atingimentos individuais — leitura de apoio, nunca chamada de resultado da estrutura.</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium">Ofensor</TableCell>
                <TableCell>Dois sentidos separados: pior resultado e volume de desvios (participação da unidade no total de pessoas fora).</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium">Concentrado × disseminado</TableCell>
                <TableCell>Concentrado: poucas unidades (até 1/3) reúnem ao menos metade das pessoas fora, com taxa bem maior que as demais. Disseminado: o desvio aparece em ao menos 2/3 das unidades.</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium">Comparável</TableCell>
                <TableCell>Unidades do mesmo Grupo, com ao menos 5 pessoas com referência e cobertura de 70%. Fora disso, o resultado aparece com o motivo.</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium">PRV e pior quartil geral</TableCell>
                <TableCell>PRV = o resultado geral oficial (atingimento e quartil da fonte). “Pior quartil geral” = quem está no Q4 de PRV.</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium">Dispersão</TableCell>
                <TableCell>Distribuição das pessoas em Q1–Q4 (quantidade e %) e desvio padrão dos atingimentos dentro do recorte, em pontos percentuais.</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium">Consolidado</TableCell>
                <TableCell>Todos os indicadores juntos: pessoas com algum indicador fora, atingimento médio, PRV médio e Q4 de PRV — nunca um “resultado da estrutura” inventado.</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium">Situação funcional</TableCell>
                <TableCell>A situação canônica de cada pessoa na data pedida (padrão: hoje). Afastamentos de natureza sensível nunca aparecem pelo motivo ao lado de um nome. O motivo só se separa para operadores, em grupos com ao menos 5 operadores e quando a contagem não aponta ninguém; o afastamento de um líder aparece sempre somado, como “Afastamento (motivo protegido)”.</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium">Competência</TableCell>
                <TableCell>A mais recente com dado para ao menos 70% da estrutura nos indicadores pedidos. Um fechamento parcial mais novo é avisado e pode ser pedido.</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </WikiTable>
        <p>
          Cada cartão tem “Como calculamos” com a regra aplicada. Ver também <WikiLink href="/wiki/indicadores">Indicadores e Performance</WikiLink>.
        </p>
      </WikiSection>

      <WikiSection id="escopo" title="Escopo e acesso" eyebrow="Decidido pelo sistema">
        <p>
          O que cada pessoa consulta é decidido pelo sistema a cada pergunta: a estrutura que ela lidera (pela cadeia real de gestores) mais o escopo de acesso dado ao
          usuário dela. Uma equipe fora do seu escopo recebe a mesma resposta de uma equipe inexistente. O cargo não amplia a visão. Ver <WikiLink href="/wiki/estrutura">Pessoas e Estrutura</WikiLink>.
        </p>
        <WarningCallout title="Estrutura de hoje" kind="tip">
          As análises usam a estrutura vigente — quem está na equipe agora — também para competências anteriores.
        </WarningCallout>
      </WikiSection>

      <WikiSection id="detalhe" title="Do consolidado ao detalhe" eyebrow="Navegação">
        <p>
          Os links dos cartões abrem a tela certa já no contexto (mesma estrutura, mesma competência, mesmo indicador): uma unidade abre Indicadores com o indicador aberto; uma
          pessoa abre a ficha; uma decisão abre Pendências ou o caso. Ver <WikiLink href="/wiki/estrutura/equipe">Equipe / Estrutura</WikiLink>.
        </p>
      </WikiSection>

      <WikiSection id="limitacoes" title="Limitações atuais" eyebrow="O que ainda não existe">
        <ul className="list-disc space-y-1 pl-5">
          <li>Contribuição de cada unidade para o resultado consolidado em valor do indicador (ainda não calculada).</li>
          <li>Pendências dos líderes abaixo de você (cada pessoa vê as que são endereçadas a ela).</li>
          <li>Análise com a estrutura como era no passado (a hierarquia não tem histórico).</li>
          <li>O diagnóstico do indicador mostra associações nas interações, não causa; depende de volume (motivos com menos de 5 interações dos piores ficam somados em “outros”).</li>
        </ul>
      </WikiSection>

      <SeeAlso
        links={[
          { href: "/wiki/acompanhamento", label: "Acompanhamento e Ciência" },
          { href: "/wiki/pendencias", label: "Pendências e Revisão humana" },
          { href: "/wiki/indicadores/analytics", label: "A área Indicadores" },
        ]}
      />
    </WikiArticle>
  )
}
