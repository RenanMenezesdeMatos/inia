import type { Metadata } from "next"

import { SeeAlso, StepList, WarningCallout, WikiArticle, WikiLink, WikiPageHeader, WikiSection } from "@/components/wiki/wiki-primitives"
import type { WikiTocEntry } from "@/components/wiki/wiki-toc"

export const metadata: Metadata = {
  title: "Como criar um Workflow",
  description: "Passo a passo no editor real: Novo workflow, Nome, Grupo (Abrangência), Gatilho, Alvo da avaliação, População/Estrutura, nodes, conexões, configuração, Salvar rascunho, problemas, QA Lab e Publicar.",
}

const TOC: WikiTocEntry[] = [
  { id: "visao-geral", label: "Antes de começar" },
  { id: "passo-a-passo", label: "Passo a passo" },
  { id: "editor", label: "O editor" },
  { id: "configuracoes", label: "Configurações do workflow" },
  { id: "depois", label: "Depois de publicar" },
]

export default function CreateWorkflowPage() {
  return (
    <WikiArticle toc={TOC}>
      <WikiPageHeader
        eyebrow="05 · Workflow Engine"
        title="Como criar um Workflow"
        lead="Do “Novo workflow” ao “Publicar”, usando os rótulos reais do editor. Antes de começar, responda às perguntas do modelo mental: quando, onde, como analisar, quem, o que avaliar, o que fazer, quem recebe."
      >
        <WarningCallout kind="tip" title="Pré-requisitos">
          Se o Workflow vai usar IA, o Agent (ou Orchestrator) precisa existir, estar ativo e dentro do grupo — ver{" "}
          <WikiLink href="/wiki/agents#como-criar">Como criar um Agent</WikiLink>. Se vai usar Flag de canal, a flag precisa existir no catálogo
          de Flags de canal e chegar calculada nas interações.
        </WarningCallout>
      </WikiPageHeader>

      <WikiSection id="passo-a-passo" title="Passo a passo" eyebrow="No Admin › Workflows">
        <StepList
          steps={[
            { title: "Novo workflow", detail: <>Em <strong>Admin › Workflows</strong>, clique em <strong>Novo workflow</strong>.</> },
            { title: "Nome, gatilho e Abrangência", detail: <>Informe o <strong>Nome</strong>, escolha quando o fluxo começa (<strong>Tipo de gatilho</strong>) e a <strong>Abrangência</strong>: em quais grupos o Workflow pode atuar. Um admin restrito só vê os grupos que administra; &quot;Todos os grupos&quot; só aparece para o admin global. Clique em <strong>Criar e abrir editor</strong>. Nada roda até publicar.</> },
            { title: "Ajustar o gatilho", detail: <>Para mudar depois, abra <strong>Configurações do workflow</strong> (ícone de engrenagem) › seção <strong>2. Gatilho</strong>, ou clique no nó Gatilho do canvas — é a mesma configuração. Escolha Flag de canal, Indicador, Agenda (calendário ou relativa ao expediente) ou Manual e os detalhes. No Manual, diga quais dados cada execução traz (colaborador, interação ou medição) — ver <WikiLink href="/wiki/workflows/execucao-manual">Execução manual</WikiLink>.</> },
            { title: "Alvo da avaliação", detail: <>Seção <strong>3. Alvo da avaliação</strong>: só para Agenda de calendário — Individual (uma execução por colaborador) ou Consolidado (uma execução para a estrutura). Flag, Indicador e Agenda relativa são sempre individuais e a seção só informa isso.</> },
            { title: "População / Estrutura", detail: <>Seção <strong>4. População / Estrutura</strong>: em modo Individual, o Filtro Populacional (quais colaboradores, dentro da Abrangência, participam); em modo Consolidado, a Estrutura Consolidada (Equipe de Supervisor, Subgrupo, Grupo, ou a estrutura de um Coordenador/Gerente/Gerente Sênior/Diretor).</> },
            { title: "Etapas", detail: <>O fluxo já nasce com Início ligado a Fim. No painel <strong>Adicionar etapa</strong>, clique para adicionar abaixo da última etapa ou arraste para o lugar certo: Chamar agente, Orquestrador, Gerar feedback, Avaliar política de acompanhamento, Condição, Revisão humana, Aguardar, Output, Escalonar, Definir variável, Fim — e, em modo Consolidado, Selecionar colaboradores, Aplicar individualmente e Consolidar resultados. Ver <WikiLink href="/wiki/workflows/nodes">Nodes</WikiLink>.</> },
            { title: "Conectar", detail: <>Em cada etapa, use <strong>Próximo passo</strong> no painel, ou arraste a partir de um ponto de saída do card até a etapa seguinte (ligar de novo a mesma saída substitui a ligação anterior). Condição tem saídas Sim / Não (e Sem dados quando aplicável); Revisão humana tem Aprovado / Reprovado / Escalar; Ação e Orquestrador têm &quot;Sempre&quot;. Todo ramo precisa terminar em algum nó (Fim, se não houver mais nada a fazer).</> },
            { title: "Configurar cada nó", detail: <>Clique no nó para abrir o painel de configuração: a regra da Condição, o Agent e a instrução de Chamar agente, quem revisa na Revisão humana, destinatário e onde entregar no Output. O card do nó resume a configuração e mostra &quot;N problemas&quot; quando algo falta.</> },
            { title: "Salvar rascunho", detail: <>No rodapé (fora do canvas), <strong>Salvar rascunho</strong>. Um rascunho pode ser salvo incompleto, com etapas ainda sem agente, conteúdo ou destino, para você continuar depois. O que falta aparece na lista de problemas, e nada roda de verdade até publicar.</> },
            { title: "Validar", detail: <>O rodapé mostra &quot;Não é possível publicar — N problemas&quot; e <strong>Ver problemas</strong> abre a lista &quot;Problemas que impedem a publicação&quot;; clicar num problema abre o nó responsável. Depois de <strong>Salvar rascunho</strong>, o editor também consulta a validação do servidor (o mesmo dry-run do botão Publicar — destinatário ambíguo, Agent inativo…) e só diz <strong>Pronto para publicar</strong> quando as duas passam; com alterações não salvas o estado fica &quot;Salve o rascunho para validar a publicação&quot;. Ver <WikiLink href="/wiki/workflows#validacao">Validação de publicação</WikiLink>.</> },
            { title: "Testar no QA Lab", detail: <>Quem tem o QA Lab (Administrador geral) usa <strong>Testar</strong> no cabeçalho do editor, ou <strong>Admin › QA Lab › Workflow</strong>, com &quot;Testar rascunho atual&quot;, um colaborador/interação/medição reais e, de preferência, <strong>Parar antes da IA</strong> na primeira rodada. Ver <WikiLink href="/wiki/qa-lab">QA Lab</WikiLink>.</> },
            { title: "Publicar", detail: <><strong>Publicar</strong> só fica habilitado sem problemas e com algo novo a publicar; o backend valida de novo. A primeira publicação, e toda mudança de gatilho, Abrangência ou população, abre um diálogo com o resumo do fluxo e o impacto. Com o workflow ligado, ele passa a rodar de verdade, e o estado muda de &quot;Rascunho — ainda não roda&quot; para &quot;No ar&quot;.</> },
          ]}
        />
      </WikiSection>

      <WikiSection id="editor" title="O editor" eyebrow="Anatomia">
        <ul className="list-inside list-disc space-y-1.5">
          <li><strong className="font-medium text-foreground">Cabeçalho</strong>: nome editável, estado (<strong className="font-medium text-foreground">Rascunho — ainda não roda</strong>, <strong className="font-medium text-foreground">No ar</strong> ou <strong className="font-medium text-foreground">Desativado — não roda</strong>), aviso de fluxo ou configuração não publicados, resumo do gatilho e a Abrangência, <strong className="font-medium text-foreground">Executar agora</strong> (só com gatilho Manual), <strong className="font-medium text-foreground">Testar</strong> (QA Lab), Configurações do workflow, excluir.</li>
          <li><strong className="font-medium text-foreground">Abas</strong>: <strong>Editor</strong> (canvas; trocar de aba não perde o que ainda não foi salvo), <strong>Execuções</strong> (cada execução real, com a etapa e o estado) e <strong>Resultados</strong> (o que cada disparo produziu e o consumo de IA).</li>
          <li><strong className="font-medium text-foreground">Paleta</strong> &quot;Adicionar etapa&quot; à esquerda; ao clicar numa etapa, o painel de configuração abre à direita.</li>
          <li><strong className="font-medium text-foreground">Rodapé</strong> fixo fora do canvas: painel de problemas, estado do salvamento, <strong>Resumo</strong> (quando começa, para quem roda, o que acontece, quem recebe, quando termina), Salvar rascunho e Publicar.</li>
        </ul>
        <p>
          O contexto de cada nó (Estrutura, Coleção, Colaborador individual, Resultado consolidado) é inferido da posição no grafo — nunca
          configurado à mão. É ele que decide quais opções aparecem em cada painel (ex.: &quot;O próprio operador&quot; só em contexto
          individual).
        </p>
      </WikiSection>

      <WikiSection id="configuracoes" title="Configurações do workflow" eyebrow="O Sheet numerado">
        <p>
          As quatro seções são numeradas na ordem em que precisam ser respondidas: <strong className="font-medium text-foreground">1. Abrangência</strong>{" "}
          (trocar é validado contra Orchestrators, Estrutura Consolidada e Filtro Populacional já configurados — uma referência que ficaria fora
          do novo grupo bloqueia a troca), <strong className="font-medium text-foreground">2. Gatilho</strong>,{" "}
          <strong className="font-medium text-foreground">3. Alvo da avaliação</strong> e{" "}
          <strong className="font-medium text-foreground">4. População / Estrutura</strong>. Trocar o TIPO do gatilho (Agenda↔Flag↔Indicador↔Manual) é
          mudança estrutural: o editor mostra uma análise de impacto listando o que precisa ser revisado antes — nunca troca e apaga
          configuração silenciosamente.
        </p>
      </WikiSection>

      <WikiSection id="depois" title="Depois de publicar" eyebrow="Operação">
        <ul className="list-inside list-disc space-y-1.5">
          <li>A aba <strong className="font-medium text-foreground">Execuções</strong> mostra cada execução real, a etapa atual e o estado (em andamento, aguardando, concluído, falhou, encerrada com falha, bloqueada). Bloqueada espera ação humana: reative ou substitua o agente e peça uma nova tentativa.</li>
          <li>Editar e salvar depois de publicado mostra &quot;Fluxo não publicado&quot; ou &quot;Configuração não publicada&quot;; a versão publicada continua rodando até o próximo Publicar. Execuções em andamento continuam na versão em que nasceram.</li>
          <li>Desativar (interruptor na lista) não inicia novas execuções e deixa as em andamento paradas até reativar. Excluir tira o fluxo das telas, para de rodar e interrompe as execuções em andamento, com confirmação. Nada é apagado: o histórico continua guardado, e o Workflow volta, pausado, por <WikiLink href="/wiki/central-de-dados#itens-excluidos">Itens excluídos</WikiLink>. Os feedbacks e recados já entregues continuam com os colaboradores.</li>
        </ul>
        <SeeAlso
          links={[
            { href: "/wiki/workflows/exemplos", label: "Aprenda na prática", hint: "jornadas completas com dados fictícios" },
            { href: "/wiki/workflows", label: "Visão geral", hint: "Escopo, Abrangência, Modo de avaliação" },
            { href: "/wiki/workflows/triggers", label: "Triggers" },
            { href: "/wiki/workflows/nodes", label: "Nodes" },
            { href: "/wiki/casos-praticos", label: "Casos práticos", hint: "guias integrados" },
          ]}
        />
      </WikiSection>
    </WikiArticle>
  )
}
