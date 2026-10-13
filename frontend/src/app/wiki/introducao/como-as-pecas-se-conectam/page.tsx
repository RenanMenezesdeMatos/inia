import type { Metadata } from "next"

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ExampleCard, SeeAlso, WarningCallout, WikiArticle, WikiFlow, WikiLink, WikiPageHeader, WikiSection, WikiTable } from "@/components/wiki/wiki-primitives"
import type { WikiTocEntry } from "@/components/wiki/wiki-toc"
import { AiArchitectureDiagram } from "@/components/wiki/ai-architecture-diagram"

export const metadata: Metadata = {
  title: "Como as peças se conectam",
  description: "Base de Conhecimento → Agent → Orchestrator (opcional) → Workflow → QA Lab → Revisão humana → Output → Acompanhamento/Pendências — o fio condutor da INIA.",
}

const TOC: WikiTocEntry[] = [
  { id: "visao-geral", label: "O fio condutor" },
  { id: "entrada", label: "Como os dados entram" },
  { id: "cadeia", label: "A cadeia completa" },
  { id: "kb-agent-orchestrator", label: "KB → Agent → Orchestrator" },
  { id: "quem-faz-o-que", label: "Quem faz o quê" },
  { id: "exemplo", label: "Exemplo de ponta a ponta" },
  { id: "quando-nao-usar", label: "Quando NÃO usar cada peça" },
  { id: "onde-configurar", label: "Onde configurar cada coisa" },
]

export default function HowItConnectsPage() {
  return (
    <WikiArticle toc={TOC}>
      <WikiPageHeader
        eyebrow="01 · Introdução"
        title="Como as peças se conectam"
        lead="A pergunta de nível 3: como uma chamada vira Flag, chama um Workflow, usa um Agent, consulta uma Base de Conhecimento, passa por Revisão humana e chega ao Acompanhamento do operador."
      />

      <WikiSection id="entrada" title="Como os dados entram" eyebrow="Antes de qualquer análise">
        <WikiFlow
          compact
          steps={[
            { label: "Cliente", detail: "API do RH, data lake de atendimento, SFTP, planilhas", tone: "input" },
            { label: "Central de Dados", detail: "fonte → feed → contrato → mapeamento → validação → carga rastreável", tone: "core" },
            { label: "Domínio INIA", detail: "colaboradores, estrutura, medições, fechamentos, interações, flags", tone: "core" },
            { label: "Workflow · Analytics · Agents", detail: "os mesmos gatilhos e leituras, sem saber por onde o dado entrou", tone: "output" },
          ]}
        />
        <p>
          Tudo o que o cliente fornece entra pela <WikiLink href="/wiki/central-de-dados">Central de Dados</WikiLink>, por contratos genéricos: um
          indicador novo não exige uma integração nova — o mesmo feed de medições recebe TMA, FCR ou uma taxa digital criada amanhã. Uma medição
          aplicada matricula Workflows por Indicador; uma flag aplicada matricula Workflows por Flag; uma transcrição aplicada fica disponível para
          Agents e QA Lab — exatamente como na ingestão em tempo real.
        </p>
      </WikiSection>

      <WikiSection id="cadeia" title="A cadeia completa" eyebrow="Do conhecimento à entrega">
        <WikiFlow
          steps={[
            { label: "Base de Conhecimento", detail: "documento autorizado e publicado; dividido em trechos por seção", tone: "input" },
            { label: "Agent", detail: "especialista de um domínio, com as bases DELE autorizadas e restrições", tone: "ai" },
            { label: "Orchestrator (opcional)", detail: "coordena especialistas quando há mais de uma competência ou uma síntese", tone: "ai" },
            { label: "Workflow", detail: "Trigger → Condição → Chamar agente / Orquestrador → decisões → Output", tone: "core" },
            { label: "QA Lab", detail: "simulação com dados reais, zero efeito operacional, com ou sem IA", tone: "core" },
            { label: "Revisão humana", detail: "Aprovar / Reprovar / Escalar em Pendências", tone: "people" },
            { label: "Output", detail: "QUEM + ONDE + O QUÊ", tone: "output" },
            { label: "Acompanhamento / Pendências / Notificações", detail: "ler · decidir · algo novo aconteceu", tone: "output" },
          ]}
        />
      </WikiSection>

      <WikiSection id="kb-agent-orchestrator" title="KB → Agent → Orchestrator" eyebrow="Quem consulta o quê">
        <WarningCallout title="Orchestrator não contém Base de Conhecimento diretamente">
          A Base de Conhecimento é vinculada ao <strong>Agent</strong>. O Orchestrator coordena Agents — quando um Orchestrator &quot;representa&quot; as
          bases de um domínio, são as bases dos especialistas dele. Cada especialista só enxerga as bases do seu domínio, e cada request recebe só os
          trechos pertinentes delas.
        </WarningCallout>
        <AiArchitectureDiagram />
        <ExampleCard title="Exemplo correto">
          <pre className="overflow-x-auto font-mono text-xs leading-relaxed text-foreground/90">{`Orquestrador · Atendimento multidomínio
├ Especialista de Faturamento
│  └ Contestação de Contas · Segunda Via · Negociação de Débito
├ Especialista de Retenção e Cancelamento
│  └ Cancelamento de Produtos e Serviços
└ Especialista de Experiência do Cliente
   └ Jeito Vivo de Atender · Checklist de Encerramento`}</pre>
        </ExampleCard>
      </WikiSection>

      <WikiSection id="quem-faz-o-que" title="Quem faz o quê" eyebrow="Responsabilidades">
        <WikiTable>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Peça</TableHead>
                <TableHead>Responsabilidade</TableHead>
                <TableHead>Quando usar</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell className="font-medium"><WikiLink href="/wiki/bases-conhecimento">Base de Conhecimento</WikiLink></TableCell>
                <TableCell>Fonte autorizada de um domínio (procedimento, manual, FAQ).</TableCell>
                <TableCell>Fornecer conhecimento autorizado que a IA pode citar por documento e seção.</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium"><WikiLink href="/wiki/agents">Agent</WikiLink></TableCell>
                <TableCell>Executar a análise de UM domínio, com evidência.</TableCell>
                <TableCell>Problema conhecido de um domínio — o Workflow já sabe qual competência precisa.</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium"><WikiLink href="/wiki/orchestrators">Orchestrator</WikiLink></TableCell>
                <TableCell>Escolher e coordenar especialistas; sintetizar.</TableCell>
                <TableCell>Mais de uma competência na mesma interação, ou síntese gerencial depois de consolidar.</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium"><WikiLink href="/wiki/workflows">Workflow</WikiLink></TableCell>
                <TableCell>Coordenar todo o processo ao redor: quando, quem, decidir, agir, entregar.</TableCell>
                <TableCell>Automatizar uma regra ou um processo recorrente.</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium"><WikiLink href="/wiki/qa-lab">QA Lab</WikiLink></TableCell>
                <TableCell>Simular sem efeito operacional; mostrar trace, requests e conhecimento usado.</TableCell>
                <TableCell>Antes de publicar — e sempre que uma regra ou prompt mudar.</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium"><WikiLink href="/wiki/pendencias">Revisão humana</WikiLink></TableCell>
                <TableCell>Colocar uma pessoa no circuito antes do efeito visível.</TableCell>
                <TableCell>Feedback gerado por IA, nota crítica, risco de impacto na pessoa.</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium"><WikiLink href="/wiki/workflows/outputs">Output</WikiLink></TableCell>
                <TableCell>Entregar a quem e onde.</TableCell>
                <TableCell>No fim de todo caminho que precisa chegar a alguém.</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium"><WikiLink href="/wiki/acompanhamento">Acompanhamento</WikiLink> / <WikiLink href="/wiki/pendencias">Pendências</WikiLink> / <WikiLink href="/wiki/notificacoes">Sino</WikiLink></TableCell>
                <TableCell>Ler · decidir · avisar — três coisas que nunca se misturam.</TableCell>
                <TableCell>Sempre: é onde o usuário recebe.</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </WikiTable>
      </WikiSection>

      <WikiSection id="exemplo" title="Exemplo de ponta a ponta" eyebrow="Rechamada recorrente">
        <WikiFlow
          compact
          steps={[
            { label: "Uma interação VOICE chega com transcrição e a flag rechamada = true", detail: "a flag já vem calculada — a INIA não a deriva do áudio", tone: "input" },
            { label: "O Trigger “Flag de canal: rechamada” matricula o operador daquela chamada no Workflow", detail: "elegibilidade = Abrangência do Workflow; sempre Individual", tone: "core" },
            { label: "Condition “Valor da flag = True” → TRUE", detail: "determinística; sem IA", tone: "core" },
            { label: "Chamar agente → Especialista de Experiência do Cliente", detail: "recebe a transcrição + só os trechos pertinentes de “Jeito Vivo de Atender” e “Checklist de Encerramento”", tone: "ai" },
            { label: "O Agent devolve feedback com evidência literal; o código confere a literalidade", detail: "se a citação não for literal, o resultado é descartado", tone: "ai" },
            { label: "Revisão humana → Supervisor do operador, em Pendências", detail: "Aprovar publica; Reprovar não publica; Escalar → Escalonar ao Gerente com o conteúdo", tone: "people" },
            { label: "Output → O próprio operador · Acompanhamento", detail: "cria o caso, registra a evidência e publica o Feedback", tone: "output" },
            { label: "O operador lê e clica “Confirmar ciência”; o Supervisor vê “Ciência confirmada em ‹data›”", tone: "people" },
          ]}
        />
        <p>
          Esse é o <WikiLink href="/wiki/casos-praticos/workflows">Modelo 01 · Rechamada recorrente</WikiLink>, testável no QA Lab com uma interação
          real e &quot;Parar antes da IA&quot; para conferir a lógica sem gastar token.
        </p>
      </WikiSection>

      <WikiSection id="quando-nao-usar" title="Quando NÃO usar cada peça" eyebrow="Erros comuns">
        <ul className="list-inside list-disc space-y-1.5">
          <li>Não usar Orchestrator quando um único Agent resolve — Workflow → Agent direto: uma request, não duas.</li>
          <li>Não usar IA para comparação numérica que uma Condition resolve.</li>
          <li>Não usar Output &quot;O próprio operador&quot; depois de &quot;Consolidar resultados&quot; — ali não existe um operador atual.</li>
          <li>Não vincular uma Base de Conhecimento a um Agent &quot;para preencher campo&quot; — Performance, PRV, Eficiência e Reconhecimento analisam números oficiais e não têm base.</li>
          <li>Não criar um &quot;super-agent&quot; com todas as bases da empresa.</li>
          <li>Não tratar o chat/avatar como Trigger — são superfícies de consumo.</li>
        </ul>
      </WikiSection>

      <WikiSection id="onde-configurar" title="Onde configurar cada coisa" eyebrow="Atalhos">
        <SeeAlso
          links={[
            { href: "/wiki/bases-conhecimento#como-criar", label: "Criar uma Base de Conhecimento", hint: "Admin › Base de conhecimento › Nova base" },
            { href: "/wiki/agents#como-criar", label: "Criar um Agent", hint: "Admin › Agentes › Novo agente" },
            { href: "/wiki/orchestrators#como-criar", label: "Criar um Orchestrator", hint: "Admin › Orquestrador da INIA › Novo orquestrador" },
            { href: "/wiki/workflows/criacao", label: "Criar um Workflow", hint: "Admin › Workflows › Novo workflow" },
            { href: "/wiki/qa-lab", label: "Testar no QA Lab", hint: "Admin › QA Lab (papel Administrador geral)" },
            { href: "/wiki/administracao", label: "Todas as áreas administrativas" },
          ]}
        />
      </WikiSection>
    </WikiArticle>
  )
}
