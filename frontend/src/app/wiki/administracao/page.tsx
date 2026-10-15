import type { Metadata } from "next"

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { SeeAlso, WarningCallout, WikiArticle, WikiLink, WikiPageHeader, WikiSection, WikiTable } from "@/components/wiki/wiki-primitives"
import type { WikiTocEntry } from "@/components/wiki/wiki-toc"

export const metadata: Metadata = {
  title: "Administração",
  description: "As áreas administrativas reais da INIA e o que cada uma configura: Central de Dados, Base de conhecimento, Domínios de negócio, Agentes, Orquestrador da INIA, Indicadores, Argumentários, Flags de canal, Workflows, QA Lab, Usuários e perfis, Governança.",
}

const TOC: WikiTocEntry[] = [
  { id: "visao-geral", label: "Visão geral" },
  { id: "areas", label: "As áreas do Admin" },
  { id: "governanca", label: "Governança" },
  { id: "usuarios", label: "Usuários e acessos" },
  { id: "ordem", label: "Em que ordem configurar" },
]

const AREAS: { menu: string; area: string; configures: string; href: string }[] = [
  { menu: "Dados", area: "Central de Dados", configures: "Fontes (Importação manual, API Pull, API Push, SFTP), feeds e mapeamentos por contrato de dados, cargas, qualidade dos dados, contratos; Importar arquivo e o wizard Nova fonte.", href: "/wiki/central-de-dados" },
  { menu: "Dados › Central de Dados", area: "Calendário operacional", configures: "Calendário-base de feriados (nacional, estadual, municipal das 27 capitais — read-only, com fonte e base legal; filtros Ano/Capital/UF/Escopo), Datas da organização (overlay próprio), política de feriado no fallback seg–sex (Ignorar × Excluir feriados aplicáveis) e limite de aviso do horizonte da escala.", href: "/wiki/indicadores/medicao-operacional#feriados" },
  { menu: "Dados", area: "Indicadores", configures: "Código, Unidade, Nome, Direção desejada; Regras de cálculo por Grupo/Subgrupo; Glossário do indicador.", href: "/wiki/indicadores#configuracao" },
  { menu: "Dados", area: "Flags de canal", configures: "Catálogo de flags por canal: Canal, Nome da flag, Tipo de valor (Verdadeiro/falso ou Numérico), Descrição.", href: "/wiki/workflows/triggers#flag" },
  { menu: "Atendimento com IA", area: "Agentes", configures: "Agents: Nome, Tipo, Objetivo, Descrição, Grupo, Contexto (prompt), Bases consultadas, Restrições; abas Teste, Execuções, Histórico.", href: "/wiki/agents" },
  { menu: "Atendimento com IA › Agentes", area: "Base de conhecimento", configures: "Documentos autorizados (Título, Tipo, conteúdo colado ou arquivo, Alcance por grupo/assunto, Status); Publicar/Arquivar; versões.", href: "/wiki/bases-conhecimento" },
  { menu: "Atendimento com IA › Agentes", area: "Domínios de negócio", configures: "Catálogo administrável de áreas de conhecimento: Nome, Código, Descrição, Status; contadores de Agents/Orchestrators; dependências; bloqueio de exclusão em uso.", href: "/wiki/agents/dominios-negocio" },
  { menu: "Atendimento com IA", area: "Orquestrador da INIA", configures: "Orchestrators: Nome, Agente orquestrador, Grupo, Onde pode ser acionado, Resultado estruturado, Especialistas.", href: "/wiki/orchestrators" },
  { menu: "Atendimento com IA", area: "Argumentários", configures: "O que se espera do operador numa situação da chamada, por Área responsável e escopo (Grupo/Subgrupo): Condição ou gatilho, Quando não se aplica, Orientação ao operador (Deve/Pode), Pontos obrigatórios na fala (todos ou alternativas, com condição por item), Condutas ou promessas a evitar, Argumentário sugerido (exemplo, nunca texto obrigatório), Referência para a monitoria e Procedimento de origem. Rascunho → Publicar com início de vigência (nunca retroativo) → Encerrar/Reativar; versões publicadas não mudam. Substitui as antigas Regras de chamada.", href: "/wiki/agents#tipos" },
  { menu: "Atendimento com IA › Governança", area: "Assuntos proibidos · Glossário geral", configures: "Guardrails globais da IA (Assunto, Comportamento esperado) e termos gerais (Termo, Definição e aplicação no feedback).", href: "/wiki/seguranca#ia" },
  { menu: "Atendimento com IA", area: "IA / Modelos", configures: "Conexões com providers de IA (API key criptografada, modelo local), modelos e preços versionados, roteamento por função da INIA (fixo, fallback, automático), uso, custos, orçamentos e saúde.", href: "/wiki/administracao/ia-modelos" },
  { menu: "Automação", area: "Workflows", configures: "Criação, editor (canvas, Configurações do workflow, Salvar rascunho, Publicar), Execuções.", href: "/wiki/workflows/criacao" },
  { menu: "Automação", area: "Políticas de acompanhamento", configures: "Tipos de intervenção (capacidades, responsável, prazo, evidências, aprovação, formulário, conclusão, incompatíveis), competências (diagnóstico → conteúdo aprovado → atividades) e políticas versionadas (regras com prioridade, condições, ações, dados insuficientes, simulação, publicação com vigência, auditoria e reavaliação).", href: "/wiki/administracao/politicas-de-acompanhamento" },
  { menu: "Automação", area: "QA Lab", configures: "Simulação de Workflows, Agents e Orchestrators; Histórico de QA; Feedbacks (QA de feedback). Só com o papel Administrador geral (Feedbacks: papel QA de feedback).", href: "/wiki/qa-lab" },
  { menu: "Plataforma", area: "Usuários e acessos", configures: "Acessos (pessoas identificadas × situação do login — Desabilitado, Aguardando troca de senha, Ativo —; Habilitar acesso com senha temporária, Nova senha temporária, Desabilitar; papéis × escopo), Pessoas (cadastro organizacional: nome, cargo, nível hierárquico, grupo, jornada, situação, capital operacional — o que vem da base do cliente é só leitura; a ficha separa Pertence a de Administra / acessos; Novo usuário com matrícula opcional e Vincular à pessoa da base contra cadastro duplicado) e Papéis (pacotes de permissões).", href: "#usuarios" },
]

export default function AdministrationPage() {
  return (
    <WikiArticle toc={TOC}>
      <WikiPageHeader
        eyebrow="10 · Administração e Segurança"
        title="Administração"
        lead="As áreas do Admin que existem hoje, exatamente como aparecem na sidebar, e o que cada uma configura. Não há painel administrativo além destes."
      />

      <WikiSection id="areas" title="As áreas do Admin" eyebrow="Sidebar real">
        <WikiTable>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Menu</TableHead>
                <TableHead>Área</TableHead>
                <TableHead>O que configura</TableHead>
                <TableHead>Wiki</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {AREAS.map((area) => (
                <TableRow key={area.area}>
                  <TableCell className="whitespace-nowrap text-muted-foreground">{area.menu}</TableCell>
                  <TableCell className="font-medium whitespace-nowrap">{area.area}</TableCell>
                  <TableCell>{area.configures}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    <WikiLink href={area.href}>Abrir</WikiLink>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </WikiTable>
        <WarningCallout kind="tip" title="Metas e fechamentos não são editados no Admin">
          Metas vigentes por Grupo/Subgrupo, fechamentos oficiais (atingimento, peso, quartil, PRV), medições, interações e flags calculadas chegam
          do cadastro corporativo pela <WikiLink href="/wiki/central-de-dados">Central de Dados</WikiLink>. O Admin configura o que a INIA faz com eles.
        </WarningCallout>
      </WikiSection>

      <WikiSection id="governanca" title="Governança" eyebrow="Guardrails globais">
        <p>
          <strong className="font-medium text-foreground">Assuntos proibidos</strong> são regras da empresa e valem para todos os Agents e em toda
          conversa com a INIA (chat, voz, “Ouvir com a INIA” e chat sem Orquestrador). Para limitar um Agent específico, use os{" "}
          <WikiLink href="/wiki/agents#limites-atuacao">Limites de atuação</WikiLink> no próprio Agent — os dois se somam.{" "}
          <strong className="font-medium text-foreground">Glossário geral</strong> define termos e como aplicá-los no feedback, independentemente de
          grupo ou assunto. O motor de feedback (“Gerar feedback”) usa regras próprias e não lê assuntos proibidos nem limites de atuação.
        </p>
      </WikiSection>

      <WikiSection id="usuarios" title="Usuários e acessos" eyebrow="Cargo ≠ papel de acesso">
        <p>
          Três coisas separadas. <strong className="font-medium text-foreground">Pessoas</strong> é o cadastro organizacional (matrícula, cargo, nível
          hierárquico, grupo, subgrupo, gestor, situação) — vem da base do cliente e <strong className="font-medium text-foreground">nunca</strong> dá
          acesso ao INIA: importar ou promover alguém (Assistente → Supervisor) não concede nada. <strong className="font-medium text-foreground">Acessos</strong>{" "}
          lista as contas de login: cada conta pode estar vinculada a um colaborador e recebe <strong className="font-medium text-foreground">papéis</strong>{" "}
          (Administrador geral, Administrador, Administrador de acessos, QA de feedback), cada um com um{" "}
          <strong className="font-medium text-foreground">escopo</strong> (organização, Grupo, Subgrupo ou a estrutura da pessoa).{" "}
          <strong className="font-medium text-foreground">Papéis</strong> mostra as permissões de cada papel. Um administrador só concede papéis que o
          próprio papel dele permite delegar, dentro do escopo dele, e nunca a si mesmo; toda concessão e revogação fica auditada. Ver{" "}
          <WikiLink href="/wiki/introducao/papeis#admin">escopo administrativo</WikiLink>. A edição da pessoa mostra ainda a jornada prevista, a situação
          funcional, a escala e a <strong className="font-medium text-foreground">Capital operacional</strong> (jurisdição de feriados).
        </p>
        <p>
          <strong className="font-medium text-foreground">O que vem da base é só leitura.</strong> Quando um conjunto de dados ativo de{" "}
          <em>Colaboradores</em> ou de <em>Estrutura organizacional</em> na <WikiLink href="/wiki/central-de-dados#master-event">Central de Dados</WikiLink>{" "}
          traz um campo (está no mapeamento) e já carregou a pessoa, esse campo aparece desabilitado em Pessoas com o aviso{" "}
          <em>“Vem da base &lt;fonte&gt; · &lt;conjunto&gt; — altere na origem”</em>, e a INIA recusa a alteração mesmo por chamada direta à API
          (<code className="font-mono text-xs">PERSON_FIELD_MANAGED_BY_SOURCE</code>). O motivo: a próxima carga sobrescreveria a edição sem avisar ninguém.
          Vale para nome, nível hierárquico, cargo, Grupo, Subgrupo, gestor direto, admissão, ativo, e-mail da conta e capital operacional — só os que o
          conjunto de dados traz. O que a base não manda continua editável (ex.: o e-mail, se o mapeamento não tem e-mail), e quem não tem integração
          cadastra e edita as pessoas aqui normalmente. Se mais de um conjunto de dados traz o mesmo campo, vale o autoritativo. A situação funcional
          tem regra própria: o registro manual continua possível e os conflitos com a fonte seguem a precedência descrita na{" "}
          <WikiLink href="/wiki/central-de-dados#situacao-funcional">Central de Dados</WikiLink>.
        </p>
        <p>
          <strong className="font-medium text-foreground">Pertence a × Administra / acessos.</strong> A ficha da pessoa separa as duas coisas.{" "}
          <em>Pertence a</em> é onde ela está na estrutura da empresa — Grupo, Subgrupo, gestor direto, cargo — e vem da base.{" "}
          <em>Administra / acessos</em> é o que ela administra na INIA: os papéis com escopo, que só a INIA define e que a base nunca concede. Os dois
          são independentes: uma Supervisora que pertence ao Grupo Atendimento pode administrar também o Grupo Retenção. Para administrar vários Grupos,
          atribua o papel uma vez para cada Grupo — ali mesmo na ficha ou na aba Acessos.
        </p>
        <p>
          <strong className="font-medium text-foreground">Uma pessoa, um cadastro.</strong> A base identifica cada pessoa pela matrícula. Por isso,
          quando a organização recebe <em>Colaboradores</em> pela Central, o <strong className="font-medium text-foreground">Novo usuário</strong> sem
          matrícula só aceita <em>Fora da hierarquia</em> (TI, consultoria, QA): quem é da operação vem pela base, e o acesso é liberado em Acessos ›
          Habilitar acesso. O campo <em>Matrícula</em> é opcional e serve para cadastrar alguém antes da carga: escrita exatamente como a base vai
          mandar, a carga atualiza essa mesma pessoa em vez de criar outra. Se a matrícula já existe, nada é cadastrado e a tela leva para Habilitar
          acesso dessa pessoa. Sem integração, nada disso muda.
        </p>
        <p>
          Quando a carga traz uma matrícula nova com o e-mail da conta de login de uma pessoa cadastrada à mão (sem matrícula), a INIA grava a
          matrícula nessa pessoa: login e papéis continuam, a base passa a mandar no cadastro, e o vínculo fica na auditoria e como aviso na carga.
          Só o nome igual não basta — duas “Ana Souza” são duas pessoas: a pessoa nova entra e a carga avisa de um possível duplicado. Para corrigir
          um duplicado que já existe, abra a ficha da pessoa cadastrada à mão e use{" "}
          <strong className="font-medium text-foreground">Vincular à pessoa da base</strong>: escolha a pessoa que veio da base (com matrícula e ainda
          sem conta). A conta de login e os papéis passam para ela, as sessões abertas são encerradas (a pessoa entra de novo com a mesma senha), e o
          cadastro feito à mão fica inativo, marcado como vinculado. Conversas, avisos e histórico ficam com o cadastro antigo. Exige administrar as
          duas pessoas e poder alterar o acesso delas; ninguém vincula a própria conta. Se a pessoa da base já tem conta, a INIA recusa: decida antes
          qual conta fica.
        </p>
        <p>
          <strong className="font-medium text-foreground">Liberação de acesso.</strong> A aba Acessos lista as pessoas que a plataforma já identifica
          com a situação do login: <em>Desabilitado</em> (sem conta ou conta desabilitada), <em>Aguardando troca de senha</em> ou <em>Ativo</em>.{" "}
          <strong className="font-medium text-foreground">Habilitar acesso</strong> cria só a conta de login da pessoa (pede o e-mail quando ela
          ainda não tem conta — nunca um cadastro novo, nunca um papel) e gera uma senha temporária aleatória, mostrada uma única vez para ser copiada e
          entregue; ela vale por tempo limitado. No primeiro login com essa senha, a pessoa só consegue criar a própria senha (Nova senha e Confirmar
          nova senha) ou sair — nenhuma outra tela ou API responde. <strong className="font-medium text-foreground">Nova senha temporária</strong>{" "}
          invalida a senha atual e <strong className="font-medium text-foreground">Desabilitar</strong> impede o login; as duas encerram as sessões
          abertas da pessoa. Ninguém altera o próprio acesso, e só altera o acesso de alguém quem poderia conceder todos os papéis dessa pessoa. Depois
          de 5 tentativas de login erradas em 15 minutos, o e-mail fica bloqueado por alguns minutos. Toda ação fica auditada, sem a senha.
        </p>
      </WikiSection>

      <WikiSection id="ordem" title="Em que ordem configurar" eyebrow="Do conhecimento ao Workflow">
        <ol className="list-decimal space-y-1.5 pl-5">
          <li>Indicadores (com regras de cálculo e glossário) e Flags de canal — a matéria-prima dos gatilhos e das Conditions.</li>
          <li>Governança — assuntos proibidos e glossário geral.</li>
          <li>Bases de Conhecimento — criar e publicar.</li>
          <li>Domínios de negócio — as áreas de conhecimento que os Agents e Orchestrators vão referenciar.</li>
          <li>Agents — um por domínio, com as bases do domínio.</li>
          <li>Orchestrators — só onde há mais de uma competência ou síntese.</li>
          <li>Workflows — criar, testar no QA Lab, publicar.</li>
        </ol>
        <SeeAlso
          links={[
            { href: "/wiki/introducao/como-as-pecas-se-conectam", label: "Como as peças se conectam" },
            { href: "/wiki/seguranca", label: "Segurança e Escopo" },
          ]}
        />
      </WikiSection>
    </WikiArticle>
  )
}
