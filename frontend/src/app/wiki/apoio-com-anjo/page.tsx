import type { Metadata } from "next"

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { FieldRow, SeeAlso, StepList, WarningCallout, WikiArticle, WikiPageHeader, WikiSection, WikiTable } from "@/components/wiki/wiki-primitives"
import type { WikiTocEntry } from "@/components/wiki/wiki-toc"

export const metadata: Metadata = {
  title: "Apoio com Anjo",
  description: "Quando a INIA não resolve, o operador pede ajuda a uma pessoa da equipe de apoio (o Anjo), numa conversa separada que a INIA não lê.",
}

const TOC: WikiTocEntry[] = [
  { id: "visao-geral", label: "Visão geral" },
  { id: "descurtida", label: "Descurtida com motivo" },
  { id: "pedido", label: "Pedir ajuda" },
  { id: "fila", label: "Fila, espera e prazo" },
  { id: "sala", label: "Sala de apoio" },
  { id: "anjo", label: "Área do Anjo" },
  { id: "configuracao", label: "Liga/desliga e papéis" },
  { id: "painel", label: "Painel do apoio" },
  { id: "privacidade", label: "Privacidade" },
]

export default function HumanSupportWikiPage() {
  return (
    <WikiArticle toc={TOC}>
      <WikiPageHeader
        eyebrow="04 · Experiência do Colaborador"
        title="Apoio com Anjo"
        lead="Quando a resposta da INIA não resolve, o operador pode falar com uma pessoa da equipe de apoio — o Anjo — numa conversa própria. A INIA não lê essa conversa. Nada é criado sozinho: o pedido só nasce quando o operador clica em “Pedir ajuda”."
      />

      <WikiSection id="visao-geral" title="Visão geral" eyebrow="O fluxo">
        <StepList
          steps={[
            { title: "A INIA responde", detail: "O sistema marca, por código, quando a consulta não encontrou a informação, não terminou ou ficou sem resposta — nunca procurando frases no texto." },
            { title: "O operador avalia ou vê a sugestão", detail: "A descurtida pergunta o motivo e “Você ainda precisa de ajuda com isso?”. Com o apoio ligado, aparece “Falar com um Anjo”." },
            { title: "O operador pede ajuda", detail: "A janela mostra exatamente o que o Anjo vai receber, a disponibilidade e o prazo da fila." },
            { title: "Um Anjo recebe na hora", detail: "Sem aceite: o pedido vai direto ao Anjo disponível com menos atendimentos. Sem vaga, entra na fila por ordem de chegada." },
            { title: "Conversa, encerramento e avaliação", detail: "Operador e Anjo conversam na sala de apoio. No fim, o Anjo classifica o atendimento e o operador pode avaliá-lo." },
          ]}
        />
      </WikiSection>

      <WikiSection id="descurtida" title="Descurtida com motivo" eyebrow="Chat livre">
        <p>No chat livre, o polegar para baixo abre um formulário: motivo, comentário (obrigatório em “Outro”) e “Você ainda precisa de ajuda com isso?”. A descurtida só é marcada depois de gravada; fechar sem enviar não grava nada. Na sessão de feedback e no recado de Workflow o polegar continua como antes.</p>
        <WarningCallout kind="tip" title="Três avaliações que nunca se misturam">
          A avaliação do feedback no Acompanhamento, a avaliação da resposta da INIA (curtir/descurtir) e a avaliação do atendimento do Anjo são separadas. Ausência de descurtida ou de pedido de apoio nunca é tratada como prova de que a resposta resolveu.
        </WarningCallout>
      </WikiSection>

      <WikiSection id="pedido" title="Pedir ajuda" eyebrow="Operador">
        <FieldRow label="Onde" value="Só depois de tentar com a INIA (com o apoio ligado): a sugestão “Falar com um Anjo” abaixo de uma resposta em que a INIA não encontrou, não concluiu ou ficou sem responder, e o formulário da descurtida com “Sim”. Não há botão fixo; com um pedido aberto, o selo “Apoio · …” acima da conversa leva à sala." />
        <FieldRow label="O que o Anjo recebe" value="A pergunta, a resposta da INIA, o motivo e o comentário da descurtida (quando houver) e a nota do operador — a mesma cópia mostrada na janela." />
        <FieldRow label="Sem Anjo em serviço" value="“Pedir ajuda” fica desabilitado e a tentativa é registrada para o painel do apoio. Se um Anjo entrar em serviço com a janela aberta, o botão é habilitado." />
        <FieldRow label="Um por vez" value="Cada operador tem no máximo um pedido aberto. Pedido encerrado nunca reabre: nova necessidade, novo pedido." />
      </WikiSection>

      <WikiSection id="fila" title="Fila, espera e prazo" eyebrow="Disponibilidade">
        <WikiTable caption="O texto da disponibilidade, pela primeira regra que valer.">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Situação</TableHead>
                <TableHead>O operador vê</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow><TableCell>Apoio desligado</TableCell><TableCell>O apoio com Anjo ainda não está disponível para sua equipe.</TableCell></TableRow>
              <TableRow><TableCell>Ninguém em serviço</TableCell><TableCell>Nenhum Anjo em serviço agora.</TableCell></TableRow>
              <TableRow><TableCell>Alguém pode receber</TableCell><TableCell>Há Anjos disponíveis: seu pedido vai direto para um deles.</TableCell></TableRow>
              <TableRow><TableCell>Todos ocupados</TableCell><TableCell>Todos os Anjos estão em atendimento. + espera estimada</TableCell></TableRow>
              <TableRow><TableCell>Todos em pausa</TableCell><TableCell>Nenhum Anjo disponível no momento. Aguarde: seu pedido está na fila.</TableCell></TableRow>
            </TableBody>
          </Table>
        </WikiTable>
        <p>A espera estimada usa os pedidos dos últimos 14 dias do Subgrupo (ou do Grupo, ou da organização). O prazo da fila é calculado pelo histórico, entre 10 e 25 minutos (20 sem histórico), e aparece como horário: “Seu pedido fica na fila até 14:35”. O operador nunca vê quantos Anjos estão em pausa, nem por quê.</p>
      </WikiSection>

      <WikiSection id="sala" title="Sala de apoio" eyebrow="Conversa humana">
        <p>A sala fica no lugar da conversa com a INIA. Abrir a sala encerra a sessão de voz; o campo não tem microfone. Aviso fixo: “A INIA não lê esta conversa. Coordenadores de Anjos e o Administrador geral podem ler.”</p>
        <FieldRow label="Mensagem nova fora da vista" value="Quando a outra pessoa escreve e você não está olhando a conversa, a INIA avisa. Com a aba escondida ou outro programa na frente, toca um som curto e o título da aba pisca com o nome de quem escreveu (“• Nova mensagem de Ana — INIA”) até você voltar. Com a INIA na tela, mas a sala de apoio fechada, o operador vê um aviso no canto com “Abrir conversa”, o selo do apoio diz quantas mensagens são novas e o painel recolhido da INIA ganha um ponto. Na área do Anjo, os atendimentos com mensagem nova ganham um número. O som só toca depois do primeiro clique na página (regra dos navegadores) e, com a INIA aberta em várias abas, toca uma vez só." />
        <FieldRow label="Digitando" value="Enquanto uma pessoa escreve, a outra vê “Fulano está digitando…” com três pontos animados. Só o fato de estar escrevendo é avisado, nunca o texto. O aviso some 5 segundos depois da última tecla, quando o campo é apagado ou quando a mensagem chega." />
        <FieldRow label="Entregue e lida" value="Cada mensagem própria mostra um tique cinza (enviada: gravada), dois cinza (entregue: a tela da outra pessoa recebeu) ou dois azuis (lida: a outra pessoa estava com a conversa na tela, com a janela em foco). Com a aba escondida ou outra janela em foco, fica como entregue." />
        <FieldRow label="Encerramento" value="Pelo operador, pelo Anjo, pelo Anjo quando o operador está sem a INIA aberta há mais de 5 minutos, ou por 15 minutos sem mensagem. A conversa com a INIA de onde o pedido saiu é encerrada (“Encerrada após o apoio do Anjo”) e o chat abre uma conversa nova." />
        <FieldRow label="Anjo sem conexão" value="O operador vê “O Anjo está sem conexão. Aguardando…”. Se o Anjo não voltar em 3 minutos, o atendimento é interrompido e o pedido volta para a frente da fila." />
        <FieldRow label="Avaliação" value="“Sua dúvida foi resolvida?” e as estrelas, opcionais, alteráveis até 24 horas depois do fim. Atendimento interrompido não é avaliado." />
      </WikiSection>

      <WikiSection id="anjo" title="Área do Anjo" eyebrow="Quem atende">
        <p>Quem tem o papel Anjo entra pelo seletor de área do cabeçalho (“Área do Anjo”). No topo fica o estado e, abaixo, as ações para mudá-lo.</p>
        <FieldRow label="Estado" value="Disponível, Em pausa (Lanche, Pessoal, Atividade de processo ou Reunião, cada uma com o seu ícone) ou Indisponível. Disponível e Em pausa mostram um cronômetro de há quanto tempo o Anjo está no estado, contado da última troca gravada no servidor (atualizar a página não o zera); Indisponível não tem cronômetro. A pausa só impede novas atribuições." />
        <FieldRow label="Mudar estado" value="“Ficar disponível”, “Pausa” (ou “Trocar pausa”), que abre a lista de motivos com a pausa atual marcada, e “Ficar indisponível”, em vermelho com o ícone de parada. Sem atendimento em andamento, a mudança vale na hora." />
        <FieldRow label="Mudança programada" value="Com atendimento em andamento, os botões viram “Programar pausa” e “Programar indisponível”: o estado atual continua (com o cronômetro), o Anjo para de receber novos atendimentos na hora e termina os que já tem. A faixa “Programado: …” mostra o que vai entrar; escolher outro motivo ou Indisponível altera, e “Cancelar programação” desfaz. A mudança entra quando termina o último atendimento — encerrado pelo Anjo, pelo operador ou pelo sistema por inatividade — e o cronômetro e as horas em pausa contam desse instante. A programação fica gravada no servidor (recarregar a página ou reconectar não a perde). Se o Anjo ficar sem conexão por mais de 3 minutos, o sistema o deixa Indisponível, os atendimentos voltam para a fila e a programação é descartada." />
        <FieldRow label="Aba Atendimento" value="Os atendimentos em andamento, um por aba. Em telas grandes, o que o operador compartilhou fica à esquerda (pode ser recolhido para a conversa ocupar a largura toda) e a conversa à direita, com o campo de mensagem e os botões de encerrar. O cabeçalho mostra o “Tempo de atendimento”, contado do início do atendimento — não é espera na fila nem tempo de pausa. Um atendimento novo toca um som curto e abre a aba dele, com “Sem resposta há N min” até a primeira mensagem. Depois de encerrar, a classificação pendente aparece na mesma aba." />
        <FieldRow label="Aba Seus atendimentos" value="O histórico dos atendimentos que o Anjo fez, com a duração, como terminou e a classificação; “Ver conversa” abre a conversa só para leitura. Trocar de aba não encerra nada nem apaga o texto digitado; mensagem nova do operador e atendimento sem resposta ficam sinalizados na aba Atendimento." />
        <FieldRow label="Classificação" value="Duas escolhas separadas: o motivo do encaminhamento (por que o operador precisou do Anjo) e o resultado (resolvido, orientado, encaminhado ou não resolvido). Além dos motivos de falta de informação, há os impedimentos operacionais “Sem acesso à ferramenta ou ao sistema” e “Ferramenta ou sistema indisponível”, com a ferramenta afetada e detalhes opcionais. O motivo nunca define o resultado." />
      </WikiSection>

      <WikiSection id="configuracao" title="Liga/desliga e papéis" eyebrow="Administrador geral">
        <FieldRow label="Liga/desliga" value="Chave geral e estado de cada Grupo e Subgrupo (Herdar, Ligado, Desligado). Tudo nasce desligado. Desligar cancela a fila daquele escopo; atendimentos em andamento continuam." />
        <FieldRow label="Papéis" value="Anjo (atende os operadores do escopo da atribuição) e Coordenador de Anjos (acompanha o painel do escopo). Só o Administrador geral concede. Ter o papel de Anjo nunca dá acesso amplo às conversas: o Anjo lê só os pedidos que atendeu." />
        <FieldRow label="Capacidade" value="Atendimentos ao mesmo tempo por Anjo, de 1 a 5 (padrão 2). Reduzir não corta atendimentos em andamento." />
      </WikiSection>

      <WikiSection id="painel" title="Painel do apoio" eyebrow="Coordenador de Anjos e Administrador geral">
        <p>Em Monitoramento, logo abaixo de Conversas com a INIA e no mesmo formato: abre em <strong>Pedidos</strong>, com a busca por operador ou protocolo, os filtros (estado, origem, Grupo/Subgrupo e período) e o total no título; a lista à esquerda, agrupada pelo dia, mostra a foto do operador, a origem, o Anjo, o estado e quantas mensagens houve — nunca o que foi conversado —, e o pedido escolhido abre à direita como uma conversa (operador à direita, Anjo à esquerda), com o que o operador compartilhou no início e os atendimentos, a classificação e a avaliação no fim.</p>
        <p>As outras abas: Indicadores (respostas da INIA, avaliações, motivos, sinais, sugestões, pedidos, tentativas sem Anjo, desfechos, espera, primeira resposta do Anjo, duração, classificação e avaliação), tentativas sem Anjo em serviço e os Anjos (situação agora e atividade no período). O período e o Grupo/Subgrupo valem para todas. Toda taxa aparece com numerador e denominador; com menos de 5 casos a taxa fica oculta e, sem nenhum, aparece “sem dados” — nunca 0%.</p>
      </WikiSection>

      <WikiSection id="privacidade" title="Privacidade" eyebrow="LGPD">
        <ul className="list-inside list-disc space-y-1">
          <li>A conversa com o Anjo fica em tabelas próprias: nenhuma resposta, resumo ou ferramenta da INIA a lê.</li>
          <li>Abrir um pedido no painel e a presença dos Anjos fica no registro de quem viu dados pessoais.</li>
          <li>Pedidos, mensagens, atendimentos, classificações e avaliações entram na exportação dos dados do operador; presença e classificações, na do Anjo (as notas não).</li>
          <li>O motivo da pausa do Anjo nunca chega ao operador.</li>
        </ul>
        <SeeAlso
          links={[
            { href: "/wiki/acompanhamento", label: "Acompanhamento e Ciência" },
            { href: "/wiki/introducao/papeis", label: "Papéis e o que cada um vê" },
          ]}
        />
      </WikiSection>
    </WikiArticle>
  )
}
