import type { Metadata } from "next"

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ExampleCard, SeeAlso, StepList, WarningCallout, WikiArticle, WikiPageHeader, WikiSection, WikiTable } from "@/components/wiki/wiki-primitives"
import type { WikiTocEntry } from "@/components/wiki/wiki-toc"

export const metadata: Metadata = {
  title: "Configuração de indicadores",
  description:
    "O catálogo de indicadores como fonte de verdade do comportamento: unidade, direção, medição operacional (granularidade, estratégia de consolidação, amostra e cobertura mínimas) e fechamento oficial. Novo indicador com semântica já suportada é configuração, não desenvolvimento.",
}

const TOC: WikiTocEntry[] = [
  { id: "principio", label: "Princípio" },
  { id: "definicao", label: "O que a definição diz" },
  { id: "diagnostico-ia", label: "Diagnóstico com IA" },
  { id: "estrategias", label: "Estratégias de consolidação" },
  { id: "exemplo", label: "Exemplo: Taxa de Resolução Digital" },
  { id: "onde-aparece", label: "Onde o indicador passa a existir" },
  { id: "edicao", label: "Edição e proteção do histórico" },
  { id: "quando-exige-codigo", label: "Quando exige desenvolvimento" },
  { id: "novo-grupo", label: "Novo Grupo" },
  { id: "central-de-dados", label: "Central de Dados — evolução futura" },
]

const STRATEGIES: { label: string; help: string; components: string; text: string }[] = [
  { label: "Taxa", help: "Σ ocorrências ÷ Σ elegíveis × 100 — nunca média das taxas diárias.", components: "valor + numerador + denominador", text: "Taxa consolidada do período" },
  { label: "Média ponderada", help: "Σ total ÷ Σ volume/amostra — nunca média de médias.", components: "valor + numerador + denominador (amostra opcional)", text: "Tempo consolidado dos atendimentos (segundos) · Média das avaliações realizadas (notas/percentual) · Média ponderada pelo volume (demais)" },
  { label: "Média simples", help: "Média dos valores observados nos períodos.", components: "valor", text: "Média dos períodos" },
  { label: "Soma", help: "Soma os valores dos períodos.", components: "valor", text: "Soma do período" },
  { label: "Último valor", help: "Usa a medição mais recente da janela (snapshot).", components: "valor", text: "Último valor registrado" },
]

export default function ConfiguracaoIndicadoresPage() {
  return (
    <WikiArticle toc={TOC}>
      <WikiPageHeader
        eyebrow="03 · Indicadores e Performance"
        title="Configuração de indicadores"
        lead="A INIA conhece COMPORTAMENTOS de indicador — unidade, direção, estratégia de consolidação, capacidade operacional e oficial — e não códigos de indicador. Um indicador novo que use uma semântica já suportada é criado em Administração → Indicadores e passa a existir em Workflows, QA Lab e Indicadores sem nenhuma alteração de código."
      >
        <p className="max-w-2xl text-sm text-foreground/80">
          Nada no motor pergunta &quot;é o TMA?&quot;. O motor pergunta &quot;qual é a unidade, a direção e a estratégia deste indicador?&quot; e lê a resposta do catálogo. Por isso a
          tela de Indicadores é a fonte de verdade, e não apenas uma lista de nomes.
        </p>
      </WikiPageHeader>

      <WikiSection id="principio" title="Princípio" eyebrow="Novo indicador + semântica já suportada = configuração">
        <div className="grid gap-4 md:grid-cols-2">
          <ExampleCard title="O código conhece">
            <ul className="list-inside list-disc space-y-1">
              <li>unidades: Percentual, Segundos, Pontos, Nota (estrelas), Quantidade, Casos, Casos por dia;</li>
              <li>direções: maior é melhor, menor é melhor, bater uma meta específica;</li>
              <li>estratégias: Taxa, Média ponderada, Média simples, Soma, Último valor;</li>
              <li>capacidades: medição operacional diária e fechamento oficial mensal.</li>
            </ul>
          </ExampleCard>
          <ExampleCard title="O código NÃO conhece">
            <ul className="list-inside list-disc space-y-1">
              <li>TMA, FCR, Monitoria de Qualidade, Backlog, Taxa de Resolução Digital…</li>
              <li>São linhas do catálogo. Não existe <code>switch (indicatorCode)</code> nem lista de códigos em Condition, Ranking, quartil operacional, QA Lab, Analytics ou no editor.</li>
            </ul>
          </ExampleCard>
        </div>
      </WikiSection>

      <WikiSection id="definicao" title="O que a definição diz" eyebrow="Seções do formulário Novo indicador / Editar">
        <StepList
          steps={[
            { title: "Informações básicas", detail: "Nome, código (único, em maiúsculas, imutável após uso) e unidade. A unidade decide a formatação em toda a plataforma: 480 s, 87,5%, 4,6 ★, 35." },
            { title: "Comportamento", detail: "Direção desejada. Decide Melhores/Piores, Evolução/Queda, quartis e a comparação com a meta — nunca inferida do nome." },
            { title: "Medição operacional", detail: "Ativada ou não; granularidade suportada (hoje: diária por colaborador); estratégia de consolidação no período; amostra mínima e cobertura mínima padrão, que pré-preenchem Condition/Ranking ao escolher o indicador." },
            { title: "Fechamento oficial", detail: "Se o indicador pode receber o fechamento mensal por competência (valor, meta, atingimento, quartil e peso, sempre recebidos prontos — a INIA nunca os calcula)." },
            { title: "Configurar (painel lateral)", detail: "Abas Definição, Regras de cálculo (\"+ Nova regra\" por Grupo/Subgrupo), Diagnóstico com IA e Glossário (interpretação, boas práticas e orientação para feedback — texto de referência para as IAs)." },
          ]}
        />
        <WarningCallout title="Status ≠ capacidade" kind="tip">
          Ativar/desativar continua um interruptor separado. Um indicador desativado não entra em Workflows novos (o Publicar rejeita), mas os Workflows que já o
          referenciam continuam abrindo para auditoria — a referência nunca some sozinha.
        </WarningCallout>
      </WikiSection>

      <WikiSection id="diagnostico-ia" title="Diagnóstico com IA" eyebrow="Como a INIA investiga este indicador antes de dar feedback">
        <p>
          A aba <strong>Diagnóstico com IA</strong> guarda a <strong>estratégia</strong> do indicador. É configuração estruturada, sem texto livre e sem
          prompt: segmentar o resultado, investigar atendimentos do motivo, avaliar processos (com a Base de Conhecimento), comparar com o grupo de
          referência, domínios que podem participar, amostragem e o que fazer quando não houver evidência suficiente. A tela só mostra o que a INIA já
          sabe executar para aquele indicador. Hoje a única dimensão é o <strong>motivo do atendimento</strong>, para indicadores em segundos (duração
          registrada) ou em contagem (volume). Outras unidades aparecem como &quot;sem dimensão operacional disponível&quot;.
        </p>
        <StepList
          steps={[
            { title: "Rascunho → publicada", detail: "Editar gera um rascunho. Publicar valida a combinação (ex.: avaliar processos exige investigar atendimentos; mínimos de privacidade nunca abaixo do produto) e cria uma versão imutável. Editar uma publicada cria a próxima versão." },
            { title: "Presa à execução", detail: "Cada execução de Workflow por Indicador guarda a versão vigente quando nasce e segue com ela, mesmo que outra seja publicada depois." },
            { title: "Testar diagnóstico", detail: "Simula a estratégia com dados reais, sem enviar feedback, sem Output e sem gravar nada. Por padrão para antes da IA (zero tokens)." },
          ]}
        />
        <WarningCallout title="O que não é configurável">
          Dados oficiais, verificação de evidência, privacidade, populações mínimas, validadores e a regra de que indicador + comportamento observado
          nunca é causa. Não existe opção de &quot;sempre orientar&quot; ou &quot;sempre elogiar&quot;: orientação só com regra oficial verificada, e ponto
          forte só quando a investigação o sustenta. Sem estratégia publicada, o feedback do indicador fica no resultado oficial.
        </WarningCallout>
      </WikiSection>

      <WikiSection id="estrategias" title="Estratégias de consolidação" eyebrow="Como consolidar este indicador em um período?">
        <p>
          A estratégia diz como várias medições diárias viram um único valor numa janela. Cada estratégia declara os componentes genéricos da medição que exige — sempre
          as mesmas colunas de <code>indicator_measurements</code> (valor, numerador, denominador, amostra), nunca uma coluna por indicador. O texto funcional mostrado
          nos Workflows (&quot;Cálculo no período: …&quot;) é derivado de estratégia + unidade, não digitado por indicador.
        </p>
        <WikiTable caption="Estratégias que a engine conhece e o texto funcional derivado">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Estratégia</TableHead>
                <TableHead>Ajuda contextual</TableHead>
                <TableHead>Componentes da medição</TableHead>
                <TableHead>Texto funcional (por unidade)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {STRATEGIES.map((strategy) => (
                <TableRow key={strategy.label}>
                  <TableCell className="font-medium">{strategy.label}</TableCell>
                  <TableCell>{strategy.help}</TableCell>
                  <TableCell>{strategy.components}</TableCell>
                  <TableCell>{strategy.text}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </WikiTable>
        <p className="text-sm text-muted-foreground">Validações que o backend aplica: Taxa só em Percentual; amostra/cobertura mínimas só com medição operacional; todo indicador precisa de ao menos uma capacidade.</p>
      </WikiSection>

      <WikiSection id="exemplo" title="Exemplo: Taxa de Resolução Digital" eyebrow="Zero código">
        <ExampleCard title="Configuração pela tela de Indicadores">
          <ul className="list-inside list-disc space-y-1">
            <li>Nome: Taxa de Resolução Digital · Código: DIGITAL_RESOLUTION_RATE</li>
            <li>Unidade: Percentual (%) · Direção: maior é melhor</li>
            <li>Medição operacional: ativada · Granularidade: diária · Estratégia: Taxa</li>
            <li>Fechamento oficial: sim (quando a fonte corporativa passar a enviar a competência)</li>
          </ul>
        </ExampleCard>
        <p>
          Ao salvar, o indicador aparece no seletor de Condition e Ranking com &quot;Cálculo no período: Taxa consolidada do período&quot;, aceita &quot;Últimos 7 dias&quot;,
          quartil operacional e Evolução/Queda, gera trace no QA Lab com Σ ocorrências ÷ Σ elegíveis e é descrito pela área Indicadores pela unidade e direção.
        </p>
      </WikiSection>

      <WikiSection id="onde-aparece" title="Onde o indicador passa a existir" eyebrow="Descoberta dinâmica pelo catálogo">
        <WikiTable caption="O que cada área lê da definição">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Área</TableHead>
                <TableHead>Lê do catálogo</TableHead>
                <TableHead>Efeito</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell className="font-medium">Condition / Ranking / Quartil operacional</TableCell>
                <TableCell>estratégia, direção, medição operacional, fechamento oficial, amostra/cobertura padrão</TableCell>
                <TableCell>lista só indicadores ativos e compatíveis com o uso; oferece janelas de dias/semana só com medição operacional; agregações válidas pela estratégia; pré-preenche mínimos</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium">Publicar (e dry-run)</TableCell>
                <TableCell>ativo, capacidades, estratégia</TableCell>
                <TableCell>rejeita indicador desativado, janela operacional sem medição operacional, fonte oficial sem fechamento oficial e agregação incompatível</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium">QA Lab</TableCell>
                <TableCell>estratégia e unidade</TableCell>
                <TableCell>trace conforme a estratégia: numerador/denominador, valores/soma, último snapshot</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium">Indicadores (perfil)</TableCell>
                <TableCell>nome, unidade, direção, capacidades</TableCell>
                <TableCell>formatação pela unidade; acompanhamento operacional só com medição operacional habilitada</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium">Agentes e alertas</TableCell>
                <TableCell>unidade, direção, meta</TableCell>
                <TableCell>texto de contexto formatado pela unidade (&quot;Faltam 2,5% para atingir a meta&quot;)</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </WikiTable>
      </WikiSection>

      <WikiSection id="edicao" title="Edição e proteção do histórico" eyebrow="Bloquear, com o motivo">
        <p>
          Nome, glossário, amostra/cobertura padrão, ligar a medição operacional, fechamento oficial e status podem mudar sempre. Código, unidade, direção, estratégia e
          desligar a medição operacional ficam <strong className="font-medium text-foreground">bloqueados quando o indicador já tem histórico</strong> — medições, metas,
          fechamentos oficiais ou Workflows que o referenciam. A tela mostra o que depende dele (Workflows de Grupos que você não administra aparecem só na contagem,
          &quot;+ 2 de outros Grupos&quot;) e o backend recusa a alteração com o mesmo motivo. Para uma semântica
          diferente, crie um novo indicador e desative este. Exclusão só existe sem histórico algum.
        </p>
      </WikiSection>

      <WikiSection id="quando-exige-codigo" title="Quando exige desenvolvimento" eyebrow="Só uma semântica nova">
        <p>
          Apenas quando o indicador precisa de uma <strong className="font-medium text-foreground">estratégia que a engine ainda não conhece</strong> — uma fórmula composta,
          por exemplo. Nesse caso adiciona-se uma nova estratégia genérica ao catálogo de comportamentos (com seus componentes e texto funcional), nunca uma regra
          exclusiva para aquele código. O mesmo vale para uma unidade nova: entra no catálogo de unidades com sua formatação.
        </p>
      </WikiSection>

      <WikiSection id="novo-grupo" title="Novo Grupo" eyebrow="Estrutura também é dado">
        <p>
          Criar um Grupo ou Subgrupo novo em Pessoas e Estrutura não exige mudança no Workflow Engine: Abrangência, Filtro populacional, Estrutura Consolidada, Ranking
          particionado por Grupo/Subgrupo e a resolução de destinatário pela hierarquia leem a estrutura real (<code>reports_to_id</code>, <code>team_id</code>,{" "}
          <code>subteam_id</code>) — nunca uma lista de nomes de grupo no código.
        </p>
      </WikiSection>

      <WikiSection id="central-de-dados" title="Central de Dados — evolução futura" eyebrow="Arquitetura conceitual, ainda não implementada">
        <WarningCallout title="Não existe tela de ingestão hoje">
          Importação CSV/Excel, API pública de recebimento, SFTP e conectores são evolução futura. Esta seção registra só o contrato arquitetural que a configuração de
          indicadores já prepara.
        </WarningCallout>
        <p>
          Princípio: <strong className="font-medium text-foreground">nunca uma tabela ou endpoint por indicador</strong>. A definição do indicador dirige a validação da
          ingestão — um indicador com estratégia Taxa exige numerador e denominador em cada medição; com Último valor, o valor basta — e as medições entram sempre no
          contrato genérico (colaborador, código, período, granularidade, valor, numerador, denominador, amostra, origem). Detalhes em{" "}
          <code>docs/dev/central-de-dados-ingestao.md</code>.
        </p>
      </WikiSection>

      <SeeAlso
        links={[
          { href: "/wiki/indicadores/medicao-operacional", label: "Medição operacional × Fechamento oficial", hint: "janelas, agregação por semântica, quartil operacional" },
          { href: "/wiki/indicadores", label: "Indicadores e Performance", hint: "valor × meta × atingimento, PRV, quartil oficial" },
          { href: "/wiki/workflows/conditions", label: "Conditions", hint: "fontes, períodos e comparações" },
          { href: "/wiki/administracao", label: "Administração e Segurança", hint: "quem configura o catálogo" },
        ]}
      />
    </WikiArticle>
  )
}
