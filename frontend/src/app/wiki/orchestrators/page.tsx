import type { Metadata } from "next"

import { Badge } from "@/components/ui/badge"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import { CapabilityBadge, ExampleCard, FieldRow, SeeAlso, StepList, UseCases, WarningCallout, WikiArticle, WikiFlow, WikiLink, WikiPageHeader, WikiSection } from "@/components/wiki/wiki-primitives"
import type { WikiTocEntry } from "@/components/wiki/wiki-toc"
import { DOMAIN_ORCHESTRATORS, ORCHESTRATOR_KIND_LABELS } from "@/components/wiki/ai-catalog-data"
import { ORCHESTRATOR_INVOCATION_MODE_LABELS } from "@/schemas/admin/assistant.schema"

export const metadata: Metadata = {
  title: "Orchestrators",
  description: "Orchestrator coordena Agents — não é outro nome para Agent. Usos reais: domínio, transversal, multidomínio e gerencial pós-JOIN. Roteamento, como criar (campos reais), “Só workflows” e o catálogo oficial.",
}

const TOC: WikiTocEntry[] = [
  { id: "visao-geral", label: "O que é um Orchestrator" },
  { id: "nao-contem-kb", label: "Não contém KB diretamente" },
  { id: "usos", label: "Os usos reais" },
  { id: "dominio", label: "Orchestrator de domínio" },
  { id: "multidominio", label: "Orchestrator multidomínio" },
  { id: "gerencial", label: "Pós-JOIN: Agent de síntese, não Orchestrator" },
  { id: "reincidencia", label: "Exemplo: análise de reincidência" },
  { id: "chat", label: "O orquestrador do chat/voz" },
  { id: "roteamento", label: "Roteamento" },
  { id: "quando-usar", label: "Quando usar / não usar" },
  { id: "como-criar", label: "Como criar um Orchestrator" },
  { id: "campos", label: "Os campos, um a um" },
  { id: "resultado-estruturado", label: "Resultado estruturado" },
  { id: "so-workflows", label: "“Só workflows”" },
  { id: "catalogo", label: "Catálogo de Orquestradores" },
  { id: "limitacoes", label: "Limitações atuais" },
]

export default function OrchestratorsPage() {
  return (
    <WikiArticle toc={TOC}>
      <WikiPageHeader
        eyebrow="07 · Orchestrators"
        title="Orchestrators"
        lead="Um Orchestrator coordena Agents: identifica o que a interação (ou a pergunta) pede, escolhe só os especialistas pertinentes, aciona cada um e sintetiza uma conclusão única. Não é apenas outro nome para Agent."
      >
        <div className="flex flex-wrap gap-2 pt-2">
          <CapabilityBadge label="Domínios específicos (1..N) · Qualquer assunto autorizado" />
          <CapabilityBadge label="Resultado estruturado (construtor visual) para Conditions e Outputs" />
          <CapabilityBadge label="Só workflows / Só chat/voz / ambos" />
          <CapabilityBadge label="Especialistas multi-operador" tone="missing" />
        </div>
      </WikiPageHeader>

      <WikiSection id="nao-contem-kb" title="Orchestrator não contém Base de Conhecimento diretamente" eyebrow="Arquitetura">
        <WarningCallout title="KB → Agent. Orchestrator → coordena Agents.">
          A Base de Conhecimento é vinculada ao Agent. Quando um Orchestrator &quot;representa&quot; as bases de um domínio, são as bases dos
          especialistas dele — quem faz o retrieval e cita documento/seção é o especialista. O agente-coordenador do Orchestrator não consulta base
          nenhuma.
        </WarningCallout>
        <ExampleCard title="Exemplo correto">
          <pre className="overflow-x-auto font-mono text-xs leading-relaxed text-foreground/90">{`Orquestrador · Atendimento multidomínio
├ Especialista de Faturamento
│  └ KBs de Faturamento
├ Especialista de Retenção e Cancelamento
│  └ KB de Cancelamento
└ Especialista de Experiência do Cliente
   └ KBs de Qualidade/Experiência`}</pre>
        </ExampleCard>
      </WikiSection>

      <WikiSection id="usos" title="Os usos reais" eyebrow="Duas perguntas, fronteira cobrada por código">
        <WarningCallout title="A regra de produto" kind="tip">
          <strong>Se já sabe qual especialista precisa, use um Agent.</strong> <strong>Se precisa escolher ou combinar especialistas, use um
          Orchestrator.</strong> Um Orchestrator existe para decidir quais Agents usar, chamar 0..N deles, combinar resultados e sintetizar — nunca
          &quot;porque precisamos de uma IA aqui&quot;.
        </WarningCallout>
        <p>
          Um Orchestrator responde a <strong className="font-medium text-foreground">duas perguntas independentes</strong>. <em>Como pode escolher
          especialistas?</em> — <strong className="font-medium text-foreground">Domínios específicos</strong> (1 domínio, o antigo &quot;de domínio&quot;; os domínios vêm do{" "}
          <WikiLink href="/wiki/agents/dominios-negocio">catálogo administrável</WikiLink>;
          vários domínios, o antigo &quot;multidomínio&quot;: só especialistas desses domínios + transversais que você adicionar) ou{" "}
          <strong className="font-medium text-foreground">Qualquer assunto autorizado</strong> (sem fronteira de domínio — a lista explícita de
          especialistas continua sendo a autorização; é o caso do chat/voz). <em>Onde pode ser acionado?</em> — Workflows, chat/voz ou ambos. A lista
          de especialistas é sempre autorização explícita: um transversal só entra se adicionado; Agents de performance e de síntese nunca entram como
          especialistas (são chamados direto pelo Workflow).
        </p>
      </WikiSection>

      <WikiSection id="dominio" title="A. Orchestrator de domínio" eyebrow="Faturamento → especialistas permitidos daquele domínio">
        <WikiFlow
          compact
          steps={[
            { label: "Chamada de fatura com mais de um aspecto do MESMO domínio (contestação + negociação de débito)", tone: "input" },
            { label: "Orquestrador · Faturamento identifica os aspectos", tone: "ai" },
            { label: "Aciona Especialista de Faturamento (+ Experiência do Cliente, transversal)", tone: "ai" },
            { label: "Síntese única, com Resultado estruturado (Severidade, Aspectos, Requer acompanhamento)", tone: "output" },
          ]}
        />
        <p>Aspectos de outro domínio (ex.: cancelamento) são registrados como &quot;fora do domínio&quot; — quem cruza domínios é o multidomínio.</p>
      </WikiSection>

      <WikiSection id="multidominio" title="B. Orchestrator multidomínio" eyebrow="Faturamento + Retenção na mesma chamada">
        <WikiFlow
          compact
          steps={[
            { label: "“Minha fatura veio errada e, se não resolver, quero cancelar”", tone: "input" },
            { label: "Orquestrador · Atendimento multidomínio identifica Faturamento + Retenção", tone: "ai" },
            { label: "Seleciona só Especialista de Faturamento + Especialista de Retenção e Cancelamento", detail: "não necessariamente Suporte ou Cadastro", tone: "ai" },
            { label: "Síntese única", tone: "output" },
          ]}
        />
        <p>É o único orquestrador autorizado a cruzar domínios de processo, e só entre os especialistas explicitamente listados nele.</p>
      </WikiSection>

      <WikiSection id="gerencial" title="C. Pós-JOIN: Agent de síntese, não Orchestrator" eyebrow="25 análises → 1 síntese, em uma request">
        <WikiFlow
          compact
          steps={[
            { label: "25 análises individuais (Aplicar individualmente → Chamar agente → Revisão humana)", tone: "core" },
            { label: "Consolidar resultados", tone: "core" },
            { label: "Chamar agente → Especialista de Síntese Gerencial: padrões, riscos, pontos fortes, tendências, próximos passos", tone: "ai" },
            { label: "Output → Gerente / Diretor · Acompanhamento", tone: "output" },
          ]}
        />
        <p>
          Depois de &quot;Consolidar resultados&quot; não há especialista a escolher — há resultados prontos a sintetizar. Isso é trabalho de{" "}
          <strong className="font-medium text-foreground">Agent</strong> (tipo de especialidade &quot;Síntese&quot;): uma única request, contrato
          estruturado validado por código, só sobre os resultados fornecidos — nunca recalcula indicador ou PRV, nunca decide nada disciplinar. O
          antigo &quot;Orquestrador gerencial&quot; fazia exatamente isso sem coordenar ninguém; os Modelos 04, 05, 11, 14, 16, 17 e 20 já usam o Agent
          de síntese. Se bastar entregar a lista consolidada (sem síntese), use Output direto do Join — zero IA. Ver{" "}
          <WikiLink href="/wiki/workflows/fan-out-fan-in#orchestrator-pos-join">Fan-in › pós-JOIN</WikiLink>.
        </p>
      </WikiSection>

      <WikiSection id="reincidencia" title="Exemplo: análise de reincidência" eyebrow="Quando o Orchestrator é a peça certa">
        <WikiFlow
          compact
          steps={[
            { label: "Flag de reincidência numa chamada sobre troca de titularidade", tone: "input" },
            { label: "Orchestrator · Análise de Reincidência (Domínios específicos: Cadastro, Faturamento, Retenção, Suporte)", tone: "ai" },
            { label: "Escolhe e chama em paralelo: especialista de processo (Cadastro) + especialista de atendimento (transversal) + especialista de diagnóstico de reincidência", detail: "e NÃO chama os demais especialistas autorizados que o caso não pede", tone: "ai" },
            { label: "Síntese única — causa confirmada × hipótese × evidência insuficiente", tone: "output" },
            { label: "Revisão humana → Feedback ao operador", tone: "core" },
          ]}
        />
        <p>
          Aqui existe uma decisão real de roteamento (quais dos especialistas autorizados este caso pede), execução em paralelo e síntese — por isso é
          um Orchestrator. A taxonomia atual já permite configurá-lo: política &quot;Domínios específicos&quot; com vários domínios, transversais e o
          diagnóstico listados explicitamente. Exemplo conceitual: nenhum dado de pessoa real.
        </p>
      </WikiSection>

      <WikiSection id="chat" title="O orquestrador do chat/voz" eyebrow="Um nível diferente">
        <p>
          O orquestrador que atende o operador por chat e voz é preservado como um nível diferente: ele decide o domínio a partir da pergunta do
          operador; os orquestradores de domínio coordenam especialistas dentro de um domínio; os Agents executam. Só pode existir UM orquestrador
          ativo por escopo atendendo o chat/voz — por isso os orquestradores de Workflow são configurados com &quot;Só workflows&quot;.
        </p>
        <p>
          Na configuração ele é <strong className="font-medium text-foreground">Qualquer assunto autorizado</strong> + acionamento{" "}
          <strong className="font-medium text-foreground">Só chat/voz do operador</strong>: multiassunto por definição (indicadores, processos, RH…),
          a lista de especialistas é a autorização explícita. &quot;Como escolhe especialistas&quot; e &quot;onde é acionado&quot; são perguntas
          separadas — o chat é aberto porque a pergunta do colaborador pode ser sobre qualquer assunto, e é só chat/voz porque um Workflow já sabe o
          que quer analisar. Todo Orquestrador ativo tem uma política; um registro legado sem política fica inativo, marcado &quot;Sem política&quot; na
          lista, e só volta a ser ativado depois de classificado no editor.
        </p>
      </WikiSection>

      <WikiSection id="roteamento" title="Roteamento" eyebrow="Selecionar, não chamar todos">
        <p>
          Um Orchestrator não precisa chamar todos os Agents disponíveis: o agente-coordenador identifica o pedido e decide quais especialistas
          acionar (roteamento → especialistas → síntese), dentro de um orçamento de requests. Especialistas acionados num Workflow recebem o contexto
          compartilhado (transcrição/entrada) além da pergunta reescrita — sem isso não teriam como citar evidência literal. Um caso simples com
          contexto conhecido deve ser 1 request de Agent, não um roteamento.
        </p>
      </WikiSection>

      <WikiSection id="quando-usar" title="Quando usar / não usar" eyebrow="Critério">
        <UseCases
          use={[
            "A interação tem múltiplos aspectos ou mais de um domínio de processo",
            "É preciso escolher especialistas conforme o conteúdo",
            "Sintetizar várias análises (pós-JOIN) para a gestão",
            "O contexto é consolidado (equipe inteira)",
          ]}
          avoid={[
            "Quando um único Agent resolve — Workflow → Agent direto",
            "Só para “gastar outra request” antes do especialista",
            "Auditoria de conformidade de um procedimento (é Chamar agente com Conformidade de processo)",
            "Como substituto de uma Condition",
          ]}
        />
      </WikiSection>

      <WikiSection id="como-criar" title="Como criar um Orchestrator" eyebrow="Admin › Orquestrador da INIA › Novo orquestrador">
        <StepList
          steps={[
            { title: "Crie o agente-coordenador", detail: <>Em <strong>Admin › Agentes</strong>, crie um Agent do tipo <strong>Orquestrador</strong> (ex.: “Coordenação · Faturamento”) com objetivo e contexto de coordenação. Sem um Agent desse tipo, a tela avisa: “Nenhum agente do tipo Orquestrador ainda — crie um em Agentes”.</> },
            { title: "Novo orquestrador", detail: <>Em <strong>Admin › Orquestrador da INIA</strong>, clique em <strong>Novo orquestrador</strong>. Abre a página do cadastro, com as abas <strong>Configuração</strong>, <strong>Especialistas</strong> e <strong>Resultado estruturado</strong> — a mesma página usada depois para editar.</> },
            { title: "Configuração", detail: <>Na aba <strong>Configuração</strong>, preencha <strong>Nome</strong>, escolha o <strong>Agente orquestrador</strong>, o <strong>Grupo</strong> (alcance) e <strong>Onde pode ser acionado</strong>, e responda à <strong>Política de roteamento</strong> (obrigatória: o orquestrador nasce ativo). Materiais de apoio também ficam aqui.</> },
            { title: "Especialistas", detail: "Na aba “Especialistas”, clique em “Adicionar” e escolha os Agents que este orquestrador pode acionar — só os do domínio (ou, no multidomínio, os domínios autorizados). Sem especialistas, o orquestrador responde sozinho, sem tools. Ao lado, o mapa mostra quem ele aciona: duplo clique num agente abre Objetivo, Descrição, Prompt e Bases consultadas." },
            { title: "Resultado estruturado (opcional)", detail: <>Na aba <strong>Resultado estruturado</strong>, ligue <strong>Produzir resultado estruturado</strong> e adicione os campos/grupos que o Orquestrador deve produzir além do texto (nome exibido, tipo, o que a IA deve identificar, obrigatório, opções). A INIA gera sozinha a instrução para a IA, a validação e os campos do Workflow Builder — ver <WikiLink href="#resultado-estruturado">Resultado estruturado</WikiLink>.</> },
            { title: "Criar ou salvar", detail: <>Clique em <strong>Criar orquestrador</strong> (ou <strong>Salvar alterações</strong>, ao editar). Enquanto falta algo, o botão fica desabilitado e diz o motivo ao passar o mouse. Teste no <WikiLink href="/wiki/qa-lab#agent-orchestrator">QA Lab › Orchestrator</WikiLink>.</> },
          ]}
        />
      </WikiSection>

      <WikiSection id="campos" title="Os campos, um a um" eyebrow="1:1 com a tela">
        <FieldRow label="Nome" value="Nome do Orchestrator — o contrato exibido em Workflows e QA Lab." />
        <FieldRow label="Agente orquestrador" value="O Agent do tipo Orquestrador que identifica o pedido e decide quais especialistas acionar. Objetivo, descrição e prompt vivem nesse Agent." />
        <FieldRow label="Grupo" value="Alcance por grupo: Todos os grupos, Grupo ou Subgrupo." />
        <FieldRow label="Onde pode ser acionado" value={`${Object.values(ORCHESTRATOR_INVOCATION_MODE_LABELS).join(" · ")}.`} />
        <FieldRow label="Resultado estruturado" value="Dados organizados que o Orquestrador produz além do texto, montados visualmente (campos e grupos). Uma configuração só: instrução para a IA, validação, prévia e campos do Workflow são derivados dela." />
        <FieldRow label="Especialistas" value="Lista de Agents que este orquestrador pode acionar." />
        <FieldRow label="Materiais de apoio" value="“Recomendar materiais nas respostas” (padrão desligado): nas respostas finais — chat, voz e Workflow —, o Orquestrador pode selecionar até 3 materiais entre os encontrados pelos especialistas acionados; só aparece quando houver conteúdo realmente pertinente. Não altera roteamento nem síntese. Em Workflow, cada Output decide se apresenta (“Incluir materiais de apoio recomendados”)." />
        <p className="text-sm text-muted-foreground">
          Não existe campo de &quot;restrições&quot; no Orchestrator: as restrições são do agente-coordenador e de cada especialista (somadas às globais
          de Governança).
        </p>
      </WikiSection>

      <WikiSection id="resultado-estruturado" title="Resultado estruturado" eyebrow="Configuração › Resultado estruturado">
        <p>
          <strong className="font-medium text-foreground">Resultado estruturado</strong> = dados organizados que o Orquestrador produz para serem
          reutilizados pela INIA. Além da resposta em texto, o Orquestrador devolve esses dados num formato fixo, e cada um deles fica disponível
          para <strong>Condições</strong>, <strong>Outputs</strong>, <strong>Revisão humana</strong> e <strong>Definir variável</strong> no Workflow
          Builder. Exemplo: se você criar o campo &quot;Severidade&quot;, poderá usá-lo depois numa Condição do Workflow
          (&quot;Síntese › Severidade é igual a Alta&quot;).
        </p>
        <WarningCallout title="Você não precisa escrever JSON" kind="tip">
          A pergunta que a tela faz é &quot;quais informações eu quero que este Orquestrador produza?&quot;. Para cada informação você responde: como se
          chama, que tipo de dado é, o que a IA deve identificar, se é obrigatória e quais valores são permitidos (quando houver). A INIA cuida do
          resto — formato técnico, instrução enviada à IA, validação da resposta, caminhos internos, rótulos e operadores do Workflow Builder — a
          partir de UMA configuração, sem duplicação manual.
        </WarningCallout>
        <StepList
          steps={[
            { title: "Ligue “Produzir resultado estruturado”", detail: "Desligado, o Orquestrador retorna apenas texto livre (continua totalmente válido)." },
            { title: "Adicione um campo ou um grupo", detail: <>Campos podem ficar na raiz (ex.: Assunto, Urgente, Nota) ou dentro de grupos que organizam informações relacionadas (ex.: Análise, Cliente, Próxima ação). Grupos podem conter grupos, até {4} níveis.</> },
            { title: "Nome exibido e chave técnica", detail: "O nome é o que as pessoas veem no Workflow Builder (“Análise › Assunto”). A chave técnica (ex.: analise.assunto) é sugerida automaticamente a partir do nome e pode ser revisada — evite alterá-la depois que Workflows começarem a usar o campo." },
            { title: "Tipo de dado", detail: "Texto, Número (com mínimo/máximo opcionais), Sim/Não, Lista de opções (valores permitidos, com rótulo amigável opcional) ou Lista de textos." },
            { title: "O que a IA deve identificar?", detail: "Explique claramente o que o Orquestrador deve preencher no campo (ex.: “Identifique o principal motivo do contato em uma frase curta.”). Essa instrução é enviada literalmente à IA." },
            { title: "Campo obrigatório", detail: "Quando ativado, a resposta estruturada só é considerada válida se o campo estiver presente." },
            { title: "Prévia e “Disponível no Workflow”", detail: "Enquanto você edita, a prévia do formato e a lista de campos que aparecerão no Workflow Builder são atualizadas automaticamente, sem salvar." },
          ]}
        />
        <ExampleCard title="Exemplo guiado">
          <pre className="overflow-x-auto font-mono text-xs leading-relaxed text-foreground/90">{`Resultado estruturado
▾ Análise
   ├ Assunto · Texto · obrigatório
   │  "Identifique o principal motivo do contato em uma frase curta."
   ├ Severidade · Lista de opções · BAIXA, MEDIA, ALTA, CRITICA
   │  "Classifique a severidade considerando impacto e urgência."
   └ Requer acompanhamento · Sim/Não
      "Informe Sim quando a interação exigir acompanhamento posterior."

No Workflow Builder:  Análise › Assunto (Texto)
                      Análise › Severidade (select: Baixa · Média · Alta · Crítica)
                      Análise › Requer acompanhamento (Sim / Não)`}</pre>
        </ExampleCard>
        <p>
          <strong className="font-medium text-foreground">O que a INIA faz com isso.</strong> Em cada execução a IA recebe o contrato gerado a partir
          desses campos; o JSON devolvido é validado por código (tipo, obrigatoriedade, opções permitidas e estrutura). Um resultado que viola a
          definição — por exemplo uma severidade &quot;URGENTISSIMA&quot; fora da lista — é marcado como <strong>inválido</strong>: nenhum campo é
          entregue a uma Condição como se fosse válido, os motivos ficam registrados no contexto da execução e o{" "}
          <WikiLink href="/wiki/qa-lab#agent-orchestrator">QA Lab</WikiLink> mostra &quot;Resultado estruturado válido ✓&quot; com os campos
          rotulados ou &quot;Resultado estruturado inválido&quot; com o motivo.
        </p>
        <p>
          <strong className="font-medium text-foreground">Alterações e Workflows que dependem do campo.</strong> Mudar rótulo, descrição,
          obrigatoriedade ou acrescentar um campo/opção é sempre permitido. Renomear a chave, mover ou excluir um campo, trocar o tipo ou remover
          uma opção usada é uma mudança potencialmente incompatível: a tela mostra em quais Workflows o dado é usado antes de excluir; ao salvar,
          a INIA <strong>bloqueia</strong> se um Workflow <strong>publicado</strong> depender do campo e pede <strong>confirmação</strong> quando só
          rascunhos dependem (o rascunho passa a apontar um campo inexistente e não publica até ser ajustado).
        </p>
        <WarningCallout title="Configurações antigas (texto + campos separados)">
          Orquestradores configurados antes do construtor visual aparecem já convertidos em árvore, com os caminhos técnicos preservados
          (ex.: <code className="font-mono text-xs">sintese.severidade</code> continua <code className="font-mono text-xs">sintese.severidade</code>). Até
          o primeiro salvamento pela tela nova, a IA continua recebendo o texto antigo. Quando o texto antigo e os campos cadastrados divergem, a
          tela mostra &quot;Esta configuração antiga possui diferenças entre o formato solicitado à IA e os campos cadastrados. Revise o resultado
          estruturado.&quot; — a INIA nunca escolhe sozinha qual dos dois estava certo.
        </WarningCallout>
        <p className="text-sm text-muted-foreground">
          A seção recolhida <strong>Visualizar formato técnico</strong> mostra, somente para leitura, os caminhos técnicos, o JSON Schema gerado e a
          instrução enviada à IA na última gravação. Não há editor de JSON: o formato técnico é sempre derivado dos campos.
        </p>
      </WikiSection>

      <WikiSection id="so-workflows" title="“Só workflows”" eyebrow="Onde pode ser acionado">
        <p>
          <strong className="font-medium text-foreground">{ORCHESTRATOR_INVOCATION_MODE_LABELS.WORKFLOW}</strong>: o orquestrador só pode ser usado por um
          node Orquestrador de Workflow — nunca atende o chat/voz. É a escolha para orquestradores de domínio, multidomínio e gerencial, assim eles
          coexistem com o único orquestrador ativo por escopo que atende o operador.{" "}
          <strong className="font-medium text-foreground">{ORCHESTRATOR_INVOCATION_MODE_LABELS.INTERACTIVE}</strong>: só o chat/voz — um Workflow não
          consegue referenciá-lo (a publicação bloqueia). <strong className="font-medium text-foreground">{ORCHESTRATOR_INVOCATION_MODE_LABELS.BOTH}</strong>:
          os dois caminhos.
        </p>
        <p>
          <strong className="font-medium text-foreground">Excluir</strong> é recusado enquanto um Workflow citar o orquestrador (rascunho, versão publicada vigente
          ou versão de uma execução em andamento). A mensagem traz os Workflows que você pode consultar; os de fora do seu alcance aparecem só como aviso. Troque o
          orquestrador nessas etapas e publique; execuções em andamento precisam terminar. Excluir não apaga nada: o histórico fica guardado e ele volta, desativado, por
          Itens excluídos, na Consulta de dados da Central. Desativar também impede o uso, mas essas etapas passam a falhar ao executar.
        </p>
      </WikiSection>

      <WikiSection id="catalogo" title="Catálogo de Orquestradores" eyebrow={`${DOMAIN_ORCHESTRATORS.length} configurados — ${DOMAIN_ORCHESTRATORS.filter((o) => o.active).length} ativos`}>
        <p>
          Todos configurados pela tela &quot;Orquestrador da INIA&quot; com acionamento <strong>Só workflows</strong>. Cada um tem um agente
          coordenador próprio (tipo &quot;Orquestrador&quot;), especialistas autorizados e resultado estruturado (Síntese › Severidade, Aspectos,
          Requer acompanhamento) para Conditions. A fronteira de domínio é cobrada por teste contra o banco de referência. Os orquestradores de um
          único domínio e o transversal ficaram <strong>desativados</strong>: nenhum Workflow-modelo precisou deles (o Workflow chama o especialista
          direto) — continuam no catálogo como modelos prontos, reativáveis sem reclassificar.
        </p>
        <WarningCallout title="Criar ≠ usar em toda execução">
          Cada base operacional relevante tem um orquestrador correspondente, mas isso não significa que toda execução daquela base passe por ele —
          o Workflow chama o Agent diretamente quando o caminho é determinístico.
        </WarningCallout>
        <Accordion type="single" collapsible className="space-y-3">
          {DOMAIN_ORCHESTRATORS.map((orchestrator) => (
            <AccordionItem key={orchestrator.id} value={orchestrator.id} className="rounded-lg border border-border px-4">
              <AccordionTrigger>
                <span className="flex flex-wrap items-center gap-2">
                  {orchestrator.name}
                  <Badge variant="secondary" className="border-0 font-normal">{ORCHESTRATOR_KIND_LABELS[orchestrator.kind]}</Badge>
                  <Badge variant={orchestrator.active ? "outline" : "secondary"} className="border-0 font-normal">{orchestrator.active ? "Ativo" : "Desativado"}</Badge>
                </span>
              </AccordionTrigger>
              <AccordionContent className="space-y-3">
                <p className="text-foreground/90">{orchestrator.objective}</p>
                <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
                  <FieldRow label="Bases" value={orchestrator.knowledgeBases.length ? `${orchestrator.knowledgeBases.join(" · ")} (via especialistas)` : "Nenhuma"} />
                  <FieldRow label="Especialistas" value={orchestrator.specialists.length ? orchestrator.specialists.join(" · ") : "Nenhum por desenho (pós-JOIN não aciona especialistas)"} />
                  <FieldRow label="Quando usar" value={orchestrator.whenToUse.join("; ")} />
                  <FieldRow label="Agent direto" value={orchestrator.callAgentDirectlyWhen.join("; ")} />
                  <FieldRow label="Limite atual" value={orchestrator.currentLimit} />
                  <FieldRow label="Acionamento" value={orchestrator.invocationMode === "WORKFLOW" ? ORCHESTRATOR_INVOCATION_MODE_LABELS.WORKFLOW : ORCHESTRATOR_INVOCATION_MODE_LABELS.BOTH} />
                </dl>
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </WikiSection>

      <WikiSection id="limitacoes" title="Limitações atuais" eyebrow="Transparência">
        <ul className="list-inside list-disc space-y-1">
          <li>Especialistas são sempre single-operator: um Orquestrador pós-JOIN que coordene Agents sobre N colaboradores ainda não existe — por isso a síntese pós-JOIN é um Agent. O Orquestrador gerencial legado continua ativo só por compatibilidade com Workflows de QA que o referenciam.</li>
          <li>A síntese de um Orquestrador é uma rodada só: os especialistas escolhidos rodam em paralelo e não dependem uns dos outros (dependência entre Agents é evolução futura).</li>
          <li>Só um orquestrador ativo por escopo pode atender o chat/voz.</li>
          <li>O chat/voz ainda não persiste as interações do operador com o orquestrador.</li>
          <li>Resultado estruturado: sem listas de objetos, schema condicional ou expressões — só Texto, Número, Sim/Não, Lista de opções, Lista de textos e grupos (até 4 níveis). Um resultado inválido não é reenviado à IA automaticamente (fica registrado como inválido).</li>
        </ul>
        <SeeAlso
          links={[
            { href: "/wiki/agents", label: "Agents", hint: "os especialistas que o Orchestrator coordena" },
            { href: "/wiki/bases-conhecimento", label: "Bases de Conhecimento", hint: "vinculadas ao Agent, não ao Orchestrator" },
            { href: "/wiki/workflows/nodes#orchestrator-node", label: "O node Orquestrador no Workflow" },
            { href: "/wiki/casos-praticos#guia-2", label: "Guia: resumo gerencial após analisar uma equipe" },
          ]}
        />
      </WikiSection>
    </WikiArticle>
  )
}
