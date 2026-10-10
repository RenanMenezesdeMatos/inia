import type { Metadata } from "next"

import { ExampleCard, SeeAlso, WarningCallout, WikiArticle, WikiFlow, WikiLink, WikiPageHeader, WikiSection } from "@/components/wiki/wiki-primitives"
import type { WikiTocEntry } from "@/components/wiki/wiki-toc"

export const metadata: Metadata = {
  title: "Segurança e Escopo",
  description: "Segurança não depende só da UI: o backend valida organização, hierarquia, escopo e capability. Elegibilidade de Workflow (Abrangência ∩ Filtro Populacional), inativos, hierarquia de instruções da IA, isolamento de bases e observabilidade.",
}

const TOC: WikiTocEntry[] = [
  { id: "visao-geral", label: "Visão geral" },
  { id: "backend", label: "Backend valida, a tela apresenta" },
  { id: "escopo", label: "Escopo organizacional" },
  { id: "escopo-admin", label: "Escopo administrativo" },
  { id: "sessao", label: "Sessão e tentativas de acesso" },
  { id: "eligibility", label: "Elegibilidade de Workflow" },
  { id: "inativos", label: "Inativos e não operadores" },
  { id: "ia", label: "IA e segurança" },
  { id: "isolamento-kb", label: "Isolamento de bases" },
  { id: "evidencia", label: "Evidência verificada por código" },
  { id: "observabilidade", label: "Observabilidade de IA" },
  { id: "wiki", label: "Esta Wiki" },
]

export default function SecurityPage() {
  return (
    <WikiArticle toc={TOC}>
      <WikiPageHeader
        eyebrow="10 · Administração e Segurança"
        title="Segurança e Escopo"
        lead="Na INIA, segurança não depende só da interface: cada leitura e escrita é validada no backend contra a organização, a hierarquia, o escopo e as capacidades do papel. O frontend apresenta — nunca decide."
      />

      <WikiSection id="backend" title="Backend valida, a tela apresenta" eyebrow="Enforcement">
        <ul className="list-inside list-disc space-y-1.5">
          <li><strong className="font-medium text-foreground">Organização</strong>: todo recurso pertence a uma organização; nada cruza a fronteira.</li>
          <li><strong className="font-medium text-foreground">Hierarquia</strong>: o sujeito de uma consulta de Indicadores/Equipe é resolvido contra a subárvore real de quem reporta a quem — o sujeito enviado pelo navegador nunca é confiado.</li>
          <li><strong className="font-medium text-foreground">Visão ampliada</strong>: além da própria estrutura, Indicadores/Equipe, os Dados da estrutura e o Calendário da equipe só abrem para outras pessoas com um papel que tenha a permissão daquela tela, e só no escopo do papel (organização, Grupo ou Subgrupo). O nível hierárquico — inclusive o antigo “Admin”, hoje “Fora da hierarquia” — nunca amplia a visão.</li>
          <li><strong className="font-medium text-foreground">Escopo</strong>: um admin restrito a um grupo não lê, edita nem publica recurso de outro grupo — nem adivinhando um id; a resposta é &quot;não encontrado&quot;, nunca revela que o recurso existe.</li>
          <li><strong className="font-medium text-foreground">Capability</strong>: o que cada papel pode ver (PRV, consolidado, membros, drill-down, abas) é calculado no backend e devolvido junto com o contexto.</li>
          <li><strong className="font-medium text-foreground">Ações</strong>: ciência só pelo próprio colaborador; decisão de revisão só pelo revisor endereçado, idempotente; Pendências só lista o que é seu.</li>
        </ul>
      </WikiSection>

      <WikiSection id="escopo" title="Escopo organizacional" eyebrow="Quem vê o quê">
        <p>
          Cada pessoa enxerga somente a si mesma e a estrutura abaixo dela na hierarquia. Um supervisor não abre a equipe de outro supervisor; um
          gerente não vê a estrutura de outro gerente nem a do diretor. Notificações, Pendências e Acompanhamento da estrutura seguem o mesmo
          escopo — nunca avisos ou itens de outra estrutura. Ver <WikiLink href="/wiki/estrutura#escopo">Pessoas e Estrutura › Escopo</WikiLink>.
        </p>
      </WikiSection>

      <WikiSection id="escopo-admin" title="Escopo administrativo" eyebrow="Admin global × restrito">
        <WarningCallout title="'Todos os grupos' nunca vira 'a empresa toda' por acidente">
          Um admin restrito escolhe um grupo/subgrupo específico dentre os seus — a opção &quot;Todos os grupos&quot; não aparece. Nenhum Workflow,
          Agent, Orchestrator ou Base dele pode assumir silenciosamente um alcance maior do que ele mesmo tem, e referências cross-group (um
          Workflow de FATURAS usando um Orchestrator exclusivo de outro grupo) são bloqueadas na lista e na validação do backend. O QA Lab exige o
          papel Administrador geral. Cargo e nível hierárquico nunca concedem acesso: um papel é um pacote de permissões, a atribuição do papel à
          conta aplica o escopo, e um administrador nunca concede mais do que pode delegar (nem a si mesmo). Não existe atalho “é administrador,
          então pode”: o Administrador funciona porque o papel dele CONTÉM as permissões, e o Administrador geral porque contém todas, na organização inteira.
        </WarningCallout>
        <p>
          O que vale para a organização inteira só muda com a permissão no escopo da organização: a Central de Dados (cadastro de pessoas,
          hierarquia, e-mail de login, medições e as credenciais dos sistemas do cliente), domínios de negócio, flags de canal, calendário
          operacional, governança (assuntos proibidos e glossário), definições e glossário de indicadores e o catálogo de assuntos. Um administrador
          de Grupo ou Subgrupo consulta esses catálogos, mantém as regras de cálculo e as bases do próprio Grupo e não altera o que afeta os
          outros. Um Agent de outro Grupo também não entra num Workflow, e uma base de outro Grupo não entra num Agent.
        </p>
      </WikiSection>

      <WikiSection id="sessao" title="Sessão e tentativas de acesso" eyebrow="Conta, sessão e senha">
        <ul className="list-disc space-y-1 pl-5">
          <li><strong className="font-medium text-foreground">Sair encerra a sessão no servidor</strong>: uma cópia do cookie deixa de valer na hora; as outras sessões da mesma conta continuam.</li>
          <li><strong className="font-medium text-foreground">Pessoa inativa no cadastro não entra</strong>, mesmo com a conta habilitada — e quem já estava dentro sai na próxima ação.</li>
          <li><strong className="font-medium text-foreground">Tentativas limitadas</strong>: além da trava por e-mail, há limite por endereço de rede no login, na criação de senha e na confirmação de ciência; uso da IA e testes administrativos têm teto por conta.</li>
          <li><strong className="font-medium text-foreground">Nível hierárquico atual</strong>: promoção ou mudança de nível vale na próxima ação, sem novo login; definir um nível de liderança exige administrar pessoas na organização inteira.</li>
        </ul>
      </WikiSection>

      <WikiSection id="eligibility" title="Elegibilidade de Workflow" eyebrow="Abrangência ∩ Filtro Populacional">
        <WikiFlow
          compact
          steps={[
            { label: "Abrangência do Workflow", detail: "Todos os grupos, um Grupo ou um Subgrupo", tone: "core" },
            { label: "∩ Filtro Populacional (opcional, modo Individual)", detail: "uma estrutura: Equipe de Supervisor, estrutura de gestor, Grupo, Subgrupo", tone: "core" },
            { label: "= População elegível", detail: "operadores ativos dentro dos dois", tone: "output" },
          ]}
        />
        <p>
          UMA semântica de elegibilidade para todos os caminhos: a ingestão por Flag/Indicador decide pontualmente para o operador do evento; o
          agendador resolve o conjunto elegível; o QA Lab usa as duas formas — testes de paridade garantem que produção e QA respondem igual a
          &quot;este operador pode disparar este Workflow?&quot;. Em modo Consolidado, a Estrutura Consolidada precisa estar dentro da Abrangência.
        </p>
      </WikiSection>

      <WikiSection id="inativos" title="Inativos e não operadores" eyebrow="Regra real">
        <ul className="list-inside list-disc space-y-1">
          <li>Só pessoas com papel Operador e ativas são elegíveis para um Workflow — inativos, inexistentes e cargos de gestão nunca são matriculados.</li>
          <li>Destinatários de gestão consideram pessoas ativas; um cargo sem ninguém ativo é NOT_FOUND.</li>
          <li>Colaborador sem jornada cadastrada nunca é matriculado por Agenda relativa.</li>
        </ul>
      </WikiSection>

      <WikiSection id="ia" title="IA e segurança" eyebrow="Hierarquia de instruções">
        <WikiFlow
          compact
          steps={[
            { label: "Sistema", detail: "regras da plataforma", tone: "core" },
            { label: "Agent", detail: "instruções do Agent (contexto/prompt) + restrições globais e específicas", tone: "ai" },
            { label: "Conhecimento recuperado", detail: "trechos das bases — declarados como DADOS, nunca instruções", tone: "input" },
            { label: "Entrada", detail: "transcrição, pergunta, números oficiais", tone: "input" },
          ]}
        />
        <ul className="list-inside list-disc space-y-1">
          <li>Conteúdo de documento é DADO. Uma frase &quot;ignore as instruções&quot; dentro de uma base continua sendo texto do documento.</li>
          <li>Restrições globais de Governança valem para todos; restrições específicas de um Agent são somadas, nunca substituem.</li>
          <li>Chaves e credenciais nunca fazem parte do prompt; o QA Lab redige segredos antes de persistir o prompt final.</li>
          <li>Texto gerado por IA é exibido formatado sem executar HTML embutido; links perigosos são neutralizados.</li>
          <li>A execução da IA fica atrás de uma interface única e trocável — trocar de provedor não muda nenhuma outra parte do sistema.</li>
        </ul>
      </WikiSection>

      <WikiSection id="isolamento-kb" title="Isolamento de bases" eyebrow="Por código">
        <p>
          O retrieval só enxerga documentos vinculados ao Agent, publicados, não excluídos e da organização — uma base que existe no sistema mas não
          foi autorizada é invisível. Ao salvar um Agent, o backend recusa ids de base inexistentes ou excluídos. Os testes garantem que o
          Especialista de Faturamento nunca vê a Política de Férias, mesmo com a pergunta sendo sobre férias.
        </p>
      </WikiSection>

      <WikiSection id="evidencia" title="Evidência verificada por código" eyebrow="Não só pedido no prompt">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <ExampleCard title="Feedback de monitoria">A evidência precisa ser citação literal da transcrição. Se a IA resume ou parafraseia, o resultado é descartado e a execução marcada como falha.</ExampleCard>
          <ExampleCard title="Conformidade de processo">Etapa CONFORME/NÃO CONFORME sem citação literal é rebaixada para NÃO FOI POSSÍVEL CONFIRMAR. Ausência de evidência nunca vira não conformidade.</ExampleCard>
        </div>
      </WikiSection>

      <WikiSection id="observabilidade" title="Observabilidade de IA" eyebrow="Em nível de produto">
        <p>
          Cada request de IA carrega: Agent/Orchestrator executado, modelo, bases autorizadas e trechos recuperados, prompt final (com segredos
          redigidos), entrada, resposta, tokens estimados e tokens oficiais informados pelo modelo. Toda execução de Agent (teste manual ou
          gatilho) e todo QA Run são persistidos com entrada, saída, status e erro. Ver <WikiLink href="/wiki/qa-lab#observabilidade">QA Lab › Observabilidade</WikiLink>.
        </p>
      </WikiSection>

      <WikiSection id="wiki" title="Esta Wiki" eyebrow="Pública, sem sessão">
        <p>
          A Wiki é documentação de produto: fica fora da área autenticada, não carrega sessão nem dados de pessoas, e não contém credenciais,
          identificadores reais, transcrições privadas ou nomes de colaboradores reais. O ambiente de demonstração é descrito conceitualmente;
          credenciais ficam na documentação interna de desenvolvimento.
        </p>
        <SeeAlso
          links={[
            { href: "/wiki/introducao/papeis", label: "Papéis e capabilities" },
            { href: "/wiki/estrutura", label: "Pessoas e Estrutura" },
            { href: "/wiki/bases-conhecimento#retrieval", label: "Retrieval e isolamento" },
            { href: "/wiki/workflows/outputs#destinatarios", label: "Resolução determinística de destinatários" },
          ]}
        />
      </WikiSection>
    </WikiArticle>
  )
}
