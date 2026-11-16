import type { AreaText } from '../../types';

const people: AreaText = {
  area: {
    id: 'people',
    title: 'Membros, substitutos e equipamento',
    intro: 'Quem está na banda, quem toca no lugar de alguém que não pode, o equipamento que vocês levam aos shows e quem pode ver o quê.',
    icon: 'people',
  },

  articles: [
    // ── Membros ──────────────────────────────────────────────────────────
    {
      id: 'band-members',
      title: 'A tela Membros da banda',
      summary: 'Todos da banda, com função e instrumento, mais o botão de convite e a lista de substitutos para os admins.',
      roles: ['admin', 'member'],
      kind: 'reference',
      keywords: ['membros', 'formação', 'elenco', 'lista da banda', 'pessoas'],
      related: ['invite-members', 'member-detail', 'member-roles', 'deputies', 'who-sees-what'],
      body: [
        { type: 'p', text: '**Membros da banda** lista todos da banda que você selecionou. O nome da banda fica acima do título.' },
        {
          type: 'steps',
          title: 'Abrir',
          items: [
            'Na tela Início, em **Atalhos**, toque em **Membros**.',
            'Ou toque no seu avatar no canto superior direito para abrir o perfil e conta e toque em **Membros** no cartão da banda atual.',
          ],
        },
        {
          type: 'list',
          title: 'O que você vê',
          items: [
            'Três contadores: **Total**, **Admins** e **Membros**.',
            'Uma linha por pessoa: foto ou iniciais, nome (o nome artístico, quando houver), instrumento e função (**Admin** ou **Membro**). Uma etiqueta **Pro** marca quem tem um plano pago.',
            'Toque numa linha para abrir a página da pessoa. Veja [[member-detail]].',
            'Toque em **⋯** (**Ações para …**) numa linha para um menu curto: **E-mail**; na sua própria linha, **Sair da banda**; para os admins, nas linhas dos outros, **Tornar admin** ou **Tornar membro** e **Remover da banda**.',
            'Os admins também veem o botão **Convidar membro** (no canto superior direito e embaixo) e, abaixo da lista, a seção **Substitutos**. Veja [[deputies]].',
          ],
        },
        {
          type: 'roles',
          rows: [
            { role: 'admin', text: 'Vê todos, convida pessoas, muda funções, remove membros e gerencia os substitutos.' },
            { role: 'member', text: 'Vê todos e os contatos deles, e pode mandar e-mail. Sem botão de convite, sem mudança de função, sem lista de substitutos.' },
          ],
        },
        { type: 'shot', id: 'people-band-members', caption: 'Membros da banda como admin: contadores, a formação e o botão Convidar membro.' },
        {
          type: 'devices',
          rows: [
            { devices: ['duoLaptop'], text: 'Os três contadores ficam na metade de cima; a lista de pessoas fica na metade de baixo.' },
            { devices: ['duoBook', 'duoLand', 'tablet'], text: 'A página de uma pessoa abre ao lado da lista em vez de cobri-la.' },
            { devices: ['android'], text: 'O gesto Voltar fecha primeiro a página da pessoa e depois Membros da banda.' },
          ],
        },
        { type: 'note', tone: 'tip', text: 'Uma banda vazia mostra **Nenhum membro ainda** e, para os admins, **Convidar o primeiro membro**.' },
      ],
    },
    {
      id: 'invite-members',
      title: 'Convidar alguém para a banda',
      summary: 'Encontre um usuário do BandWith pelo nome ou e-mail, ou convide uma pessoa nova por e-mail, link ou código.',
      roles: ['admin'],
      kind: 'task',
      keywords: ['convidar', 'adicionar membro', 'código de convite', 'link de convite', 'entrar'],
      related: ['accept-an-invite', 'member-roles', 'band-members'],
      body: [
        { type: 'p', text: 'Ninguém entra numa banda sem dizer sim. Você envia um convite; a pessoa aceita.' },
        {
          type: 'steps',
          items: [
            'Em **Membros da banda**, toque em **Convidar membro** (o + no canto superior direito ou o botão embaixo).',
            'Digite pelo menos 3 caracteres de um nome ou de um endereço de e-mail no campo de busca.',
            'Se a pessoa já está no BandWith, ela aparece em **Encontrados no BandWith**. Toque em **Convite** ao lado dela.',
            'Se ninguém for encontrado, digite o e-mail completo e toque em **Convidar {email}**.',
            'Antes de enviar, escolha a função em **Função**: **Membro** (“Pode ver o conteúdo da banda”) ou **Admin** (“Gerencia membros, eventos e configurações”). Membro vem selecionado.',
            'Para alguém novo no BandWith, a janela mostra então o **Código de convite**. Toque em **Compartilhar** para enviar o link e o código por qualquer app, ou em **Copiar código**.',
          ],
        },
        {
          type: 'list',
          title: 'O que acontece depois',
          items: [
            'Usuário existente: recebe uma notificação e um cartão **Convite de banda** na próxima vez que abrir o BandWith. Você vê “Convite enviado para {name}”.',
            'Pessoa nova: o BandWith envia o convite por e-mail quando pode. Você vê “Convite enviado por e-mail para {name}” ou, sem e-mail, “Convite criado para {name}. Compartilhe para que a pessoa possa entrar.”',
            'Um convite vale por 7 dias. Quando faltam 2 dias ou menos, o endereço convidado recebe um e-mail de lembrete. Se ele expirar, você recebe um e-mail.',
            'Convidar o mesmo endereço de novo renova o convite por mais 7 dias.',
            'Quando a pessoa entra, todos da banda recebem “{name} agora faz parte de {band}”.',
          ],
        },
        { type: 'note', tone: 'privacy', text: 'Os resultados da busca mostram os e-mails parcialmente ocultos (por exemplo gi•••@…), a não ser que você digite o endereço exato. Quem já está na banda não aparece.' },
        { type: 'shot', id: 'people-invite', caption: 'A janela Convidar membro com a busca, os resultados e a escolha da função.' },
        { type: 'note', tone: 'tip', text: 'O convite fica ligado ao endereço de e-mail. A pessoa precisa entrar com esse endereço para participar.' },
      ],
    },
    {
      id: 'accept-an-invite',
      title: 'Entrar numa banda por um convite',
      summary: 'Aceite um convite no app, pelo link do convite ou colando o código de convite.',
      roles: ['admin', 'member'],
      kind: 'task',
      keywords: ['entrar na banda', 'aceitar convite', 'código de convite', 'recusar convite'],
      related: ['invite-members', 'member-roles'],
      body: [
        {
          type: 'steps',
          title: 'Você já usa o BandWith',
          items: [
            'Abra o BandWith. Um cartão **Convite de banda** mostra quem convidou você, a banda, o tamanho dela e a sua função (**como membro** ou **como admin**).',
            'Toque em **Entrar na banda**. Você vê “Você entrou em {band}” e a banda aparece no seletor de bandas.',
            'Ou toque em **Recusar**. Para decidir depois, toque no X (**Decidir depois**); o cartão volta na próxima vez.',
          ],
        },
        {
          type: 'steps',
          title: 'Você é novo no BandWith',
          items: [
            'Abra o link do convite na mensagem ou no e-mail. Ou, na tela de boas-vindas, toque em **Tenho um código de convite**, cole o código ou o link em **Código ou link de convite** e toque em **Entrar**.',
            'Confira o cartão da banda e toque em **Aceitar e continuar** (ou **Recusar convite**).',
            'Crie a sua conta ou entre com o endereço de e-mail para o qual o convite foi enviado.',
          ],
        },
        {
          type: 'list',
          title: 'Se não funcionar',
          items: [
            '“Este convite foi enviado para outro e-mail” quer dizer que você entrou com outro endereço. Saia e use o endereço convidado.',
            '“Este convite expirou” ou “não é mais válido”: peça a um admin para convidar você de novo.',
            '“Isso não parece um código de convite”: cole o código completo ou o link inteiro.',
          ],
        },
      ],
    },
    {
      id: 'member-roles',
      title: 'As funções admin e membro',
      summary: 'O que um admin pode fazer e um membro não, e a regra de que toda banda tem pelo menos um admin.',
      roles: ['admin', 'member'],
      kind: 'reference',
      keywords: ['admin', 'membro', 'permissões', 'função', 'cogerenciar', 'dono'],
      related: ['make-admin', 'who-sees-what', 'remove-a-member'],
      body: [
        { type: 'p', text: 'Cada pessoa numa banda é **Admin** ou **Membro**. Uma banda pode ter vários admins. Quem cria a banda é o primeiro admin.' },
        {
          type: 'roles',
          rows: [
            { role: 'admin', text: 'Cria e edita shows, ensaios e orçamentos; define cachês e marca pagamentos; edita setlists, músicas, contratos, listas de tarefas e kits de equipamento; convida e remove pessoas; muda funções; gerencia os substitutos; edita os dados e os preços da banda; vê as finanças e as análises da banda.' },
            { role: 'member', text: 'Vê os shows e a logística da banda, responde aos convites para tocar, lê setlists e músicas, sugere músicas e alterações, guarda notas privadas nas músicas, conversa no chat, adiciona e edita o próprio equipamento pessoal e vê só o próprio cachê.' },
          ],
        },
        { type: 'note', tone: 'warning', text: 'Uma banda precisa de pelo menos um admin. O app não deixa você remover o último admin nem torná-lo membro: “Uma banda precisa de pelo menos um admin. Primeiro torne outra pessoa admin.” A mesma regra impede excluir a sua conta enquanto você for o único admin de uma banda.' },
        { type: 'p', text: 'Cogerenciar uma banda (ser um entre vários admins) é um recurso do plano pago. Durante o beta, qualquer pessoa pode virar admin. Fora do beta, **Tornar admin** mostra “Requer uma conta Pro para cogerenciar” para quem está no plano grátis.' },
        { type: 'p', text: 'Para a lista completa dos dados que cada função pode ler, veja [[who-sees-what]].' },
      ],
    },
    {
      id: 'make-admin',
      title: 'Tornar alguém admin, ou voltar um admin a membro',
      summary: 'Mude a função de uma pessoa na lista Membros da banda ou na página dela.',
      roles: ['admin'],
      kind: 'task',
      keywords: ['tornar admin', 'tirar admin', 'rebaixar', 'promover', 'mudar função'],
      related: ['member-roles', 'band-members'],
      body: [
        {
          type: 'steps',
          items: [
            'Em **Membros da banda**, toque em **⋯** na linha da pessoa. Ou toque na linha para abrir a página dela.',
            'Toque em **Tornar admin** para dar direitos de admin, ou em **Tornar membro** para tirá-los.',
          ],
        },
        { type: 'p', text: 'A mudança é salva na hora; não há confirmação. A pessoa vê a nova função na próxima vez que a lista da banda carregar. Depois o celular dela apaga os dados da banda guardados para uso offline e carrega tudo de novo para a nova função: um novo admin vê o cliente e os preços, e quem deixou de ser admin não os guarda mais no celular.' },
        { type: 'note', tone: 'warning', text: 'Você não pode tornar membro o último admin. Primeiro torne outra pessoa admin.' },
        { type: 'note', tone: 'tip', text: 'Você não pode mudar a sua própria função: a sua página e o menu **⋯** na sua linha não mostram botões de função. Peça a outro admin para tornar você membro.' },
      ],
    },
    {
      id: 'remove-a-member',
      title: 'Remover um membro da banda',
      summary: 'Tire alguém da banda; a pessoa perde o acesso aos eventos, aos chats e ao repertório.',
      roles: ['admin'],
      kind: 'task',
      keywords: ['remover membro', 'expulsar', 'excluir membro'],
      related: ['leave-a-band', 'invite-members', 'member-roles'],
      body: [
        {
          type: 'steps',
          items: [
            'Em **Membros da banda**, toque em **⋯** na linha da pessoa e em **Remover da banda**. Ou abra a página dela e toque em **Remover da banda** embaixo.',
            'Leia a janela **Remover da banda?** e toque em **Remover**. Toque em **Cancelar** para mantê-la.',
          ],
        },
        {
          type: 'list',
          title: 'O que acontece',
          items: [
            'A pessoa perde na hora o acesso aos eventos, aos chats e ao repertório da banda.',
            'Ela recebe uma notificação “Você não faz mais parte de {band}”. O resto da banda recebe “{name} saiu de {band}”.',
            'Os shows passados, as respostas e os pagamentos dela ficam nos registros da banda.',
            'Você pode convidá-la de novo depois.',
          ],
        },
        { type: 'note', tone: 'warning', text: 'Não dá para desfazer. Para trazer a pessoa de volta, envie um novo convite e espere ela aceitar.' },
      ],
    },
    {
      id: 'leave-a-band',
      title: 'Sair de uma banda',
      summary: 'Como funciona sair para admins e para membros.',
      roles: ['admin', 'member'],
      kind: 'task',
      keywords: ['sair da banda', 'deixar a banda', 'abandonar banda'],
      related: ['remove-a-member', 'member-roles'],
      body: [
        {
          type: 'roles',
          rows: [
            { role: 'member', text: 'Você pode sair de qualquer banda em que está, quando quiser.' },
            { role: 'admin', text: 'Você pode sair enquanto a banda tiver outro admin. Se você for o único, o app pede para você primeiro tornar outra pessoa admin ([[make-admin]]).' },
          ],
        },
        {
          type: 'steps',
          items: [
            'Abra **Membros da banda** dessa banda.',
            'Toque em **⋯** na sua própria linha e em **Sair da banda**. (Você também pode tocar na sua linha e usar **Sair da banda** embaixo.)',
            'A janela pergunta “Sair de {band}?”: você perde o acesso aos eventos, aos chats e ao repertório da banda. Toque em **Sair da banda** para confirmar, ou em **Cancelar**.',
          ],
        },
        { type: 'p', text: 'Quando você sai, os outros recebem “{name} saiu de {band}”. O app leva você para a sua outra banda, ou para a tela inicial se você não tiver nenhuma. Você só pode voltar com um novo convite.' },
        { type: 'note', tone: 'warning', text: 'Excluir a sua conta (Ajustes, **Excluir conta**) também tira você de todas as bandas. Se você for o único admin de uma banda, primeiro torne outra pessoa admin.' },
      ],
    },
    {
      id: 'member-detail',
      title: 'A página de um membro',
      summary: 'Quem a pessoa é, os shows e o pagamento deste ano, os próximos eventos, os contatos e os botões de função.',
      roles: ['admin', 'member'],
      kind: 'reference',
      keywords: ['perfil do membro', 'estatísticas do membro', 'pago este ano', 'contato', 'telefone', 'e-mail'],
      related: ['band-members', 'who-sees-what', 'make-admin'],
      body: [
        { type: 'p', text: 'Toque numa pessoa em **Membros da banda** para abrir a página dela.' },
        {
          type: 'list',
          items: [
            'No alto: foto, nome, instrumento e função.',
            '**Shows este ano**: os shows tocados mais os que estão por vir, com um medidor de pontos. **Pago · {year}**: quanto a pessoa recebeu e quanto ainda falta pagar.',
            '**Próximos para {name}**: os próximos eventos dela nesta banda, cada um com a resposta (confirmado, pendente, recusado).',
            '**Contatos**: e-mail e telefone, cada um com um botão de copiar. Toque num deles para escrever ou ligar.',
            '**Mensagem** abre uma conversa direta. **Tornar admin** / **Tornar membro** e **Remover da banda** são para os admins.',
          ],
        },
        {
          type: 'roles',
          rows: [
            { role: 'admin', text: 'Vê os contadores de shows e de pagamento de todos, e todas as ações, menos na própria página.' },
            { role: 'member', text: 'Vê os contadores de shows e de pagamento só na própria página. Na página de outra pessoa: nome, instrumento, próximos eventos e contatos. **Mensagem** só aparece na página de um admin, porque os membros só podem começar uma conversa direta com admins.' },
          ],
        },
        { type: 'note', tone: 'privacy', text: 'Um membro nunca vê quanto outro membro recebe. Os contadores vêm de uma função do servidor que devolve todos os membros para os admins e só a sua própria linha para você.' },
        {
          type: 'devices',
          rows: [
            { devices: ['phone', 'duoClosed'], text: 'Abre em tela cheia.' },
            { devices: ['duoBook', 'duoLand'], text: 'Abre na segunda tela, ao lado da lista.' },
            { devices: ['tablet'], text: 'Abre na coluna de detalhes ao lado da lista.' },
          ],
        },
      ],
    },
    {
      id: 'default-fees-and-instruments',
      title: 'Cachês padrão e instrumentos',
      summary: 'De onde vêm o instrumento e o cachê pré-preenchido de um membro, e onde mudá-los.',
      roles: ['admin', 'member'],
      kind: 'reference',
      keywords: ['cachê padrão', 'cachê habitual', 'valor', 'instrumento', 'função', 'pagamento'],
      related: ['who-sees-what', 'deputies', 'gig-workspace'],
      body: [
        { type: 'p', text: 'Cada pessoa numa banda pode ter um cachê padrão. Quando um admin a adiciona a um novo show ou orçamento, o cachê vem preenchido com ele (ensaios não têm cachê); sem cachê padrão, é usado o valor por músico da banda em **Preços, cachês e serviços**. O admin pode mudar o cachê em cada show.' },
        {
          type: 'steps',
          title: 'Admins: mudar o instrumento ou o cachê padrão de um membro',
          items: [
            'Em **Membros da banda**, toque na linha da pessoa.',
            'Em **Na banda**, digite o **Instrumento nesta banda** (vazio: aparece o instrumento do perfil) e o **Cachê padrão** (opcional, um número como 150).',
            'Toque em **Salvar**. O cachê padrão é usado nos novos shows.',
          ],
        },
        { type: 'p', text: 'Um membro que abre a própria linha vê “Seu cachê padrão nesta banda: {fee}” quando tem um.' },
        { type: 'p', text: 'O seu instrumento principal fica no seu perfil: toque no seu avatar, depois em **Editar** no cartão do perfil, e escolha-o em **Instrumento / função principal**. Ele aparece no cartão do seu perfil e conta.' },
        { type: 'p', text: 'O instrumento ao lado de cada nome em **Membros da banda** é o que está guardado para aquela pessoa nesta banda. O cartão **Quem cobre o quê** dos substitutos agrupa a banda por esses instrumentos.' },
        { type: 'note', tone: 'privacy', text: 'Os cachês padrão seguem a regra do dinheiro: os admins veem os de todos, um membro vê só o próprio.' },
      ],
    },
    {
      id: 'band-details',
      title: 'Mudar o nome, o logo, a cidade e a bio da banda',
      summary: 'Edite o cartão da banda em perfil e conta; o logo também vai para os PDFs dos orçamentos.',
      roles: ['admin'],
      kind: 'task',
      keywords: ['nome da banda', 'logo', 'foto da banda', 'cidade-base', 'cidade', 'slogan', 'bio', 'renomear banda'],
      related: ['member-roles', 'band-members'],
      body: [
        {
          type: 'steps',
          items: [
            'Toque no seu avatar no canto superior direito para abrir o perfil e conta.',
            'No cartão da banda atual, toque em **Editar**.',
            'Em **Logo da banda**, toque em **Enviar** (ou **Trocar**) e escolha uma imagem. Toque na lixeira (**Remover logo**) para tirá-lo.',
            'Mude **Nome da banda**, **Cidade-base** (escolha um dos **Lugares sugeridos** para que as taxas de deslocamento possam usar a localização) e **Bio / slogan da banda (opcional)**.',
            'Toque em **Salvar dados**. Toque em **Cancelar** ou **Fechar** para sair sem salvar.',
          ],
        },
        { type: 'p', text: 'O logo aparece no cartão da banda, no seletor de bandas e nos PDFs dos orçamentos. A cidade-base também vira o ponto de partida das taxas de deslocamento nos seus preços.' },
        { type: 'p', text: '**Ajustes da banda**, embaixo do cartão da banda, abre a identidade visual e os preços da banda (conta bancária, valores dos músicos, serviços do orçamento). Veja [[pricing-sheet]].' },
        { type: 'note', tone: 'privacy', text: 'Os membros veem o nome, o logo, a cidade e a bio da banda, nunca os dados bancários, fiscais ou de preços.' },
      ],
    },

    // ── Substitutos ──────────────────────────────────────────────────────
    {
      id: 'deputies',
      title: 'Substitutos: músicos que cobrem a vaga',
      summary: 'A lista de músicos de sessão da banda, como os pedidos chegam a eles e o que eles podem e não podem ver.',
      roles: ['admin', 'deputy'],
      kind: 'reference',
      keywords: ['substituto', 'sub', 'freela', 'reposição', 'músico de sessão', 'cobrir vaga'],
      related: ['add-a-deputy', 'ask-a-deputy', 'deputy-reply-page', 'deputy-gigs', 'unlink-a-deputy', 'deputy-notifications', 'who-sees-what'],
      body: [
        { type: 'p', text: 'Um substituto é um músico de fora da banda que toca quando um membro não pode. A banda mantém uma lista de substitutos com instrumento, contatos e cachê habitual. Os substitutos não precisam de conta no BandWith.' },
        {
          type: 'list',
          title: 'Como funciona',
          items: [
            'Um admin adiciona substitutos em **Membros da banda**, na seção **Substitutos** ([[add-a-deputy]]).',
            'Quando um membro recusa um show, o admin toca em **Achar substituto** na formação do show e envia um pedido por WhatsApp, SMS ou e-mail ([[ask-a-deputy]]).',
            'A mensagem leva um link privado para uma página de resposta. O substituto responde ali com um toque, sem conta ([[deputy-reply-page]]).',
            'Os admins recebem uma notificação com a resposta.',
            'Se o substituto abrir o BandWith por esse link e entrar, a conta dele fica vinculada ao cadastro da banda. A partir daí, a banda pode usar **Pedir no app** e o substituto responde em **Shows como substituto** ([[deputy-gigs]]).',
          ],
        },
        {
          type: 'roles',
          rows: [
            { role: 'admin', text: 'Adiciona, edita e exclui substitutos; vê telefone, e-mail, cachê habitual e notas deles; envia, acompanha e cancela pedidos; desvincula a conta de um substituto.' },
            { role: 'member', text: 'Não vê a lista de substitutos nem os pedidos. Um membro que abre um link de substituto da própria banda vê “Você já está em {band}”.' },
            { role: 'deputy', text: 'Vê só os próprios pedidos: nome da banda, título do show, data, horários de montagem, passagem de som e show, local e cidade, a função e o cachê oferecido. O endereço só aparece depois que ele diz sim.' },
          ],
        },
        { type: 'note', tone: 'privacy', text: 'Um substituto nunca vê o cliente, o preço do show, os cachês dos outros músicos, a setlist, o chat nem mais nada da banda.' },
        { type: 'note', tone: 'tip', text: 'Um substituto que diz sim não é adicionado à formação do show. Os admins o acompanham em **Substitutos contatados**, na janela da formação.' },
      ],
    },
    {
      id: 'add-a-deputy',
      title: 'Adicionar, editar ou excluir um substituto',
      summary: 'Mantenha a lista de substitutos da banda e veja quais instrumentos ainda não têm ninguém.',
      roles: ['admin'],
      kind: 'task',
      keywords: ['adicionar substituto', 'novo substituto', 'quem cobre o quê', 'músico de sessão'],
      related: ['deputies', 'ask-a-deputy', 'unlink-a-deputy'],
      body: [
        {
          type: 'steps',
          items: [
            'Em **Membros da banda**, role até **Substitutos**.',
            'Toque em **Adicionar substituto** (o + ao lado do título). Em **Quem cobre o quê**, o + ao lado de um instrumento com “Sem substituto” abre o formulário com esse instrumento preenchido.',
            'Preencha **Nome** (obrigatório), **Instrumento**, **Telefone (WhatsApp)**, **E-mail**, **Cachê habitual** e **Notas** (por exemplo “Lê partitura, tem equipamento próprio”).',
            'Toque em **Adicionar substituto**.',
          ],
        },
        {
          type: 'steps',
          title: 'Editar ou excluir',
          items: [
            'Toque no substituto na lista.',
            'Mude os campos e toque em **Salvar**.',
            'Para excluir, toque em **Excluir substituto** e depois em **Excluir** em “Excluir substituto?”.',
          ],
        },
        {
          type: 'list',
          title: 'Quem cobre o quê',
          items: [
            'Lista cada instrumento que a banda toca, os membros que o tocam e os substitutos dele.',
            'A linha acima diz “Cada instrumento da banda tem um substituto.” ou quantos não têm.',
          ],
        },
        { type: 'p', text: 'Um substituto com conta no BandWith mostra a etiqueta **No BandWith**, e a ficha dele diz que ele responde no app.' },
        { type: 'note', tone: 'warning', text: 'Excluir um substituto o tira da lista da banda. Os pedidos passados guardam o nome e a resposta dele. Você pode adicioná-lo de novo depois.' },
        { type: 'note', tone: 'privacy', text: 'Só os admins veem esta lista (“Só os admins veem esta lista.”).' },
        { type: 'devices', rows: [{ devices: ['tablet', 'duoLand'], text: 'Os substitutos aparecem em duas colunas quando a tela é larga.' }] },
      ],
    },
    {
      id: 'ask-a-deputy',
      title: 'Pedir a um substituto para cobrir um show',
      summary: 'Pela formação do show, envie um pedido por mensagem ou no app e acompanhe a resposta.',
      roles: ['admin'],
      kind: 'task',
      keywords: ['achar substituto', 'pedir substituto', 'substituir membro', 'cobrir show', 'sub', 'WhatsApp'],
      related: ['deputies', 'deputy-reply-page', 'deputy-notifications', 'gig-workspace'],
      body: [
        { type: 'p', text: 'Você pode chamar um substituto quando um membro recusou um próximo show da banda. Ensaios, shows pessoais e shows passados não oferecem essa opção.' },
        {
          type: 'steps',
          items: [
            'Abra o show e, na seção **FORMAÇÃO**, toque na lista de nomes (não em **EDITAR**) para abrir a janela **Formação**.',
            'Ao lado do membro que recusou, toque em **Achar substituto**. A janela mostra “No lugar de {name}” e os substitutos da banda, primeiro os que tocam o mesmo instrumento.',
            'Para um substituto que está no BandWith, toque em **Pedir no app**. Ele recebe uma notificação.',
            'Senão, toque em **WhatsApp**, **SMS** ou **E-mail**. O seu app de mensagens abre com os detalhes do show e o link de resposta preenchidos. Envie pelo seu celular.',
            'Volte ao BandWith. A resposta do substituto aparece embaixo do nome dele: **Pedido enviado · sem resposta ainda**, **Disponível**, **Confirma depois** ou **Não posso ir**, com a nota dele.',
          ],
        },
        {
          type: 'list',
          title: 'Depois da resposta',
          items: [
            'Depois de um sim, os botões enviam o resumo (**Enviar resumo**, **Resumo no app**) com o endereço completo e o link do calendário.',
            'Se você mudar a data, os horários ou o local depois da resposta, o substituto fica marcado com “O show mudou depois da resposta: envie a atualização.” Os botões enviam a atualização (**Enviar atualização**, **Atualização no app**).',
            '**Copiar link** copia o link de resposta. **Cancelar pedido** o retira; um substituto vinculado recebe uma notificação.',
            'A janela da formação lista todos os pedidos abertos em **Substitutos contatados**.',
          ],
        },
        {
          type: 'list',
          title: 'O que o pedido diz',
          items: [
            'Nome da banda, título do show, data e horário, local e cidade, a função e o cachê.',
            'O cachê é o do membro substituído neste show, ou o cachê habitual do substituto quando não há um definido.',
            'O endereço só vai no resumo e na atualização, depois de um sim.',
          ],
        },
        { type: 'shot', id: 'people-find-deputy', caption: 'Achar substituto, no lugar de um membro que recusou: cada substituto com Pedir no app, WhatsApp, SMS e E-mail.' },
        { type: 'note', tone: 'tip', text: '“Já enviado há pouco.” quer dizer que você tocou duas vezes: o mesmo pedido no app sai no máximo uma vez a cada 2 minutos.' },
        { type: 'note', tone: 'tip', text: 'Ainda sem substitutos? A janela oferece **Adicionar substitutos**, que leva você à lista.' },
      ],
    },
    {
      id: 'deputy-reply-page',
      title: 'A página de resposta do substituto',
      summary: 'O que um substituto vê quando abre o link de um pedido, e como ele responde sem conta.',
      roles: ['deputy', 'admin'],
      kind: 'reference',
      keywords: ['link do substituto', 'link de resposta', 'deputy.html', 'responder pedido', 'sem conta'],
      related: ['ask-a-deputy', 'deputy-gigs', 'deputies'],
      body: [
        { type: 'p', text: 'O link de um pedido abre uma pequena página web no navegador do substituto. Não é preciso app nem conta. Ela aparece no idioma do substituto, quando disponível.' },
        {
          type: 'list',
          title: 'O que o substituto vê',
          items: [
            '“{band} procura um substituto para este show.” com a data, os horários de montagem, passagem de som e show, o local, a cidade, a função e o cachê oferecido.',
            'Três respostas: **Sim, estou disponível**, **Ainda não sei, confirmo depois**, **Não, não posso**, e **Mensagem para a banda (opcional)**.',
            'Depois de um sim: o endereço, **Abrir no Mapas** e **Adicionar ao calendário** (**Calendário Apple · Outlook**, **Google Agenda** ou **Assinar · atualiza sozinho**).',
            '**Mudar resposta** fica disponível até o show.',
            'Se a banda mudar o show depois da resposta: **Algo mudou** com os valores antigos e novos, e **Continua OK** ou **Já não posso**.',
            '**Baixar o BandWith** abre o app e vincula a conta. Veja [[deputy-gigs]].',
          ],
        },
        {
          type: 'list',
          title: 'Quando o link para de funcionar',
          items: [
            '“Este pedido está fechado.” A banda retirou o pedido.',
            '“O show foi cancelado.”',
            '“Este show já passou.” a partir do dia seguinte ao show.',
            '“Este link não funciona.” A banda desvinculou o substituto ou o link está errado. Peça à banda para enviar o pedido de novo.',
          ],
        },
        { type: 'note', tone: 'privacy', text: 'O link é a chave: quem tiver o link pode responder. Se ele chegou à pessoa errada, um admin pode desvincular o substituto, o que troca todos os links ([[unlink-a-deputy]]).' },
      ],
    },
    {
      id: 'deputy-in-the-app',
      title: 'Responder a pedidos de substituto no app',
      summary: 'Vincule a sua conta do BandWith à lista de substitutos de uma banda pelo link de resposta e depois responda em Shows como substituto.',
      roles: ['deputy'],
      kind: 'task',
      keywords: ['conta de substituto', 'vincular', 'vincular conta', 'baixar o BandWith', 'app do substituto'],
      related: ['deputy-gigs', 'deputy-reply-page', 'unlink-a-deputy'],
      body: [
        {
          type: 'steps',
          items: [
            'Abra o link de resposta que uma banda enviou para você e toque em **Baixar o BandWith**.',
            'No app, crie uma conta ou entre. A tela de boas-vindas diz “{band} chama você como substituto.”',
            'Espere “Vinculando sua conta à banda…”. Depois você vê “Você está na lista de substitutos de {band}”.',
            'Toque em **OK**. Os seus pedidos dessa banda aparecem em **Shows como substituto**.',
          ],
        },
        {
          type: 'list',
          title: 'Outras mensagens',
          items: [
            '“Este link pertence a outra conta”: a banda o vinculou a outra pessoa. Peça um novo pedido.',
            '“Você já está em {band}”: você é membro dessa banda, então não pode ser substituto dela.',
            '“Não foi possível vincular sua conta à banda. Confira sua conexão.”: toque em **Tentar de novo**. O app também tenta de novo quando você volta a ficar online.',
          ],
        },
        { type: 'p', text: 'A partir daí, os admins da banda podem chamar você no app e você recebe notificações. Eles são avisados com “{deputy} está no BandWith”.' },
        { type: 'note', tone: 'tip', text: 'O link espera por você mesmo que você precise se cadastrar antes ou que o app reinicie.' },
      ],
    },
    {
      id: 'deputy-gigs',
      title: 'Shows como substituto',
      summary: 'Todos os pedidos que as bandas enviaram para você como substituto, com as suas respostas, o endereço depois de um sim e os links do calendário.',
      roles: ['deputy'],
      kind: 'reference',
      keywords: ['shows como substituto', 'meus pedidos', 'feed de calendário', 'assinar', 'webcal'],
      related: ['deputy-in-the-app', 'deputy-notifications', 'deputy-reply-page'],
      body: [
        {
          type: 'list',
          title: 'Onde encontrar',
          items: [
            'Sem banda própria: **Shows como substituto** é a sua tela inicial. **Também toca em uma banda?** oferece **Crie sua banda** e **Sair**.',
            'Com uma banda: toque no seu avatar e depois em **Shows como substituto** (“Pedidos de {count} bandas”) no alto do perfil e conta.',
            'Tocar numa notificação de substituto abre direto naquele pedido.',
          ],
        },
        {
          type: 'list',
          title: 'Cada pedido',
          items: [
            'O título do show e a banda, com um status: **Aguardando sua resposta**, **Você disse sim**, **Você vai confirmar depois**, **Você disse que não pode**, **Pedido retirado**, **Show cancelado** ou **Show encerrado**.',
            'Data, montagem, passagem de som, show, local, cidade, função e **Cachê oferecido**. O endereço aparece depois de um sim.',
            'Para responder: **Sim**, **Ainda não sei** ou **Não, não posso**, com uma mensagem opcional. Depois, **Mudar sua resposta**.',
            'Se o show mudou: **Algo mudou**, depois **Ainda posso** ou **Não posso mais**.',
            'Depois de um sim: **Abrir no Mapas**, **Adicionar ao calendário**, **Google Agenda** e **Assinar meus shows**.',
          ],
        },
        { type: 'p', text: 'Os pedidos abertos vêm primeiro; os encerrados ficam em **Passados e encerrados**. Aparecem os pedidos dos últimos 30 dias em diante. A linha no alto lista as “Bandas que chamam você como substituto”.' },
        { type: 'p', text: '**Assinar meus shows** adiciona um feed de calendário com os seus shows confirmados com aquela banda. Ele acompanha cada mudança e marca os shows cancelados, então o seu calendário fica certo sem abrir o BandWith.' },
        { type: 'shot', id: 'people-deputy-gigs', caption: 'Shows como substituto: um pedido de outra banda esperando resposta.' },
        {
          type: 'devices',
          rows: [
            { devices: ['duoBook', 'duoLand'], text: 'Como tela inicial, a página da marca BandWith fica na primeira tela e os seus shows na segunda, como no login.' },
            { devices: ['duoLaptop'], text: 'Como tela inicial na posição notebook, o cabeçalho fica na metade de cima e os seus pedidos na metade de baixo. Enquanto você escreve uma mensagem, a caixa fica à vista, acima do teclado ou logo acima da dobra.' },
          ],
        },
      ],
    },
    {
      id: 'unlink-a-deputy',
      title: 'Desvincular a conta do BandWith de um substituto',
      summary: 'Quando a pessoa errada abriu o link, ou o substituto trocou de conta.',
      roles: ['admin'],
      kind: 'task',
      keywords: ['desvincular', 'conta errada', 'link encaminhado', 'novo link', 'trocar link'],
      related: ['deputies', 'deputy-in-the-app', 'ask-a-deputy'],
      body: [
        {
          type: 'steps',
          items: [
            'Em **Membros da banda**, na seção **Substitutos**, toque no substituto com a etiqueta **No BandWith**.',
            'Na caixa **No BandWith**, toque em **Desvincular conta**.',
            'Leia “Desvincular a conta BandWith?” e toque em **Desvincular**.',
          ],
        },
        {
          type: 'list',
          title: 'O que acontece',
          items: [
            'Essa conta para de receber pedidos no app e não vê mais os shows desta banda em **Shows como substituto**.',
            'Todos os links já enviados a esse substituto são trocados. As páginas de resposta, os feeds de calendário e os links do app antigos param de funcionar.',
            'As respostas dele ficam como estavam.',
            'Envie o próximo pedido por mensagem. Abrir o novo link pelo app vincula de novo a conta certa.',
          ],
        },
        { type: 'note', tone: 'warning', text: 'Não dá para desfazer: os links antigos nunca mais funcionam.' },
      ],
    },
    {
      id: 'deputy-notifications',
      title: 'Notificações de substitutos',
      summary: 'Quais notificações os admins e os substitutos recebem durante um pedido.',
      roles: ['admin', 'deputy'],
      kind: 'reference',
      keywords: ['push de substituto', 'notificação de substituto', 'substituto respondeu'],
      related: ['ask-a-deputy', 'deputy-gigs', 'notifications-inbox'],
      body: [
        {
          type: 'table',
          head: ['Quando', 'Quem', 'Notificação'],
          rows: [
            ['O substituto responde ou muda a resposta', 'Todos os admins ativos', '“{deputy} está disponível”, “confirma depois” ou “não pode ir”, com o show e a nota dele'],
            ['O substituto confirma depois de uma mudança', 'Todos os admins ativos', '“{deputy} concorda com as alterações”'],
            ['Um substituto vincula a conta', 'Todos os admins ativos', '“{deputy} está no BandWith”'],
            ['Um novo pedido, ou **Pedir no app** de novo', 'Substituto vinculado', '“{band}: você pode tocar?”'],
            ['**Resumo no app** depois de um sim', 'Substituto vinculado', '“Você está confirmado: {gig}”'],
            ['A data, os horários ou o local mudam depois da resposta', 'Substituto vinculado', '“{gig} mudou”, com o que mudou e “Ainda dá para você?”'],
            ['O show é cancelado', 'Substituto vinculado', '“{gig} foi cancelado”'],
            ['O admin cancela o pedido', 'Substituto vinculado', '“{band} não precisa mais de você”'],
          ],
        },
        { type: 'p', text: 'As notificações dos admins abrem o show. As notificações dos substitutos abrem **Shows como substituto** naquele pedido. Um substituto sem o app não recebe nada automaticamente: envie a atualização por **Achar substituto**.' },
        { type: 'note', tone: 'tip', text: 'As rajadas são agrupadas: o mesmo pedido, resumo ou aviso de mudança chega a um substituto no máximo uma vez a cada 2 minutos.' },
      ],
    },

    // ── Equipamento ──────────────────────────────────────────────────────
    {
      id: 'gear-inventory',
      title: 'Equipamento',
      summary: 'A lista de equipamento da banda, com categorias, status, localização e de quem é cada item.',
      roles: ['admin', 'member'],
      kind: 'reference',
      keywords: ['equipamento', 'inventário', 'material', 'backline', 'PA', 'lista de equipamento'],
      related: ['add-gear', 'gear-status', 'gear-kits', 'kit-for-a-gig'],
      body: [
        {
          type: 'steps',
          title: 'Abrir',
          items: [
            'Admins: na tela Início, em **Atalhos**, toquem em **Material**.',
            'Todos: toque no seu avatar e depois no bloco **Equipamento** em **Recursos e fluxos da banda**.',
          ],
        },
        {
          type: 'list',
          title: 'O que você vê',
          items: [
            'Duas abas: **Itens** e **Kits** ([[gear-kits]]).',
            'Um campo de busca (**Buscar equipamento, microfones, cabos…**) e chips de categoria com contagens: **Tudo**, **Instrumentos**, **Cabos**, **Microfones**, **Caixas de som**, **Suportes**, **Iluminação**, **Cases**, as categorias próprias da banda e depois **Outro**.',
            'Cada item: nome, ponto de status e uma linha com “Pessoal · {name}” para o equipamento de alguém, a categoria, “qtd. {count}” e a localização.',
            'Os itens que você pode mudar têm um botão de editar e um de excluir. Os que você não pode mudar mostram um cadeado, e uma nota abaixo da lista diz quem pode alterá-los.',
          ],
        },
        {
          type: 'roles',
          rows: [
            { role: 'admin', text: 'Adiciona, edita e exclui qualquer item, o da banda e o equipamento pessoal dos membros, e gerencia os kits.' },
            { role: 'member', text: 'Vê todo o equipamento e os kits da banda. Adiciona o próprio equipamento com **Adicionar meu equipamento** e só muda ou exclui esse.' },
          ],
        },
        { type: 'p', text: 'O bloco no perfil e conta mostra o número de itens e uma linha de status: “{count} em reparo”, “{count} perdidos” ou “Tudo em ordem”.' },
        { type: 'shot', id: 'people-gear', caption: 'Equipamento e kits num tablet: a faixa de kits acima da lista de itens.' },
        {
          type: 'devices',
          rows: [
            { devices: ['tablet'], text: 'A tela se chama **Equipamento e kits**. Os kits são uma faixa de blocos acima dos itens, sem as abas Itens/Kits.' },
            { devices: ['duoBook', 'duoLand'], text: 'Um kit abre na segunda tela.' },
          ],
        },
      ],
    },
    {
      id: 'add-gear',
      title: 'Adicionar, editar ou excluir um item de equipamento',
      summary: 'Adicione equipamento como da banda ou como seu, e mantenha os dados dele em dia.',
      roles: ['admin', 'member'],
      kind: 'task',
      keywords: ['adicionar equipamento', 'adicionar meu equipamento', 'equipamento pessoal', 'editar item', 'excluir item', 'número de série'],
      related: ['gear-inventory', 'gear-status', 'who-sees-what'],
      body: [
        {
          type: 'steps',
          items: [
            'Em **Equipamento**, toque em **Adicionar equipamento** (admins) ou **Adicionar meu equipamento** (membros), ou no + no canto superior direito.',
            'Digite o **Nome do item**, por exemplo “Shure SM58”.',
            'Admins: em **De quem é**, escolham **A banda** ou **Meu (pessoal)**. Os itens dos membros são sempre deles.',
            'Escolha uma **Categoria** e um **Status**, defina a **Quantidade** e preencha **Onde está / com quem**.',
            'Nenhuma categoria serve? Toque em **Personalizada** e digite um **Nome da categoria** (até 40 caracteres). Ela aparece como chip para toda a banda.',
            'Se quiser, adicione **Número de série**, **Data da compra**, **Preço de compra** e **Notas**.',
            'Toque em **Salvar item**.',
          ],
        },
        {
          type: 'steps',
          title: 'Editar ou excluir',
          items: [
            'Toque no item (**Editar {name}**), mude-o e toque em **Salvar alterações**.',
            'Para excluir, toque em **Excluir item** na janela, ou na lixeira da linha do item.',
          ],
        },
        {
          type: 'roles',
          rows: [
            { role: 'admin', text: 'Pode editar todos os itens, mudar de quem eles são e excluir qualquer um.' },
            { role: 'member', text: 'Só pode editar e excluir os itens marcados como seus. A janela diz “Equipamento pessoal: a banda vê, só você e os admins podem alterar.” Os outros itens mostram um cadeado no lugar dos botões.' },
          ],
        },
        { type: 'note', tone: 'warning', text: 'A lixeira de uma linha, ou **Excluir item** na janela, pergunta antes “Excluir {name}?”. Excluir um item também o tira de todos os kits.' },
        { type: 'note', tone: 'privacy', text: 'Todos da banda veem todos os itens, o status e onde estão. **Número de série**, **Data da compra** e **Preço de compra** só aparecem para os admins e para o dono do equipamento pessoal.' },
      ],
    },
    {
      id: 'gear-status',
      title: 'Status e localização do equipamento',
      summary: 'O que significam Disponível, Em uso, Manutenção e Perdido, e como alimentam os contadores dos kits e do perfil.',
      roles: ['admin', 'member'],
      kind: 'reference',
      keywords: ['status', 'em reparo', 'manutenção', 'perdido', 'faltando', 'localização', 'com quem está'],
      related: ['gear-inventory', 'gear-kits'],
      body: [
        {
          type: 'table',
          head: ['Status', 'Significado', 'Pronto para um show?'],
          rows: [
            ['**Disponível**', 'No lugar, livre para levar', 'Sim'],
            ['**Em uso**', 'Com alguém', 'Sim'],
            ['**Manutenção**', 'Em conserto', 'Não: conta como “em reparo”'],
            ['**Perdido**', 'Sumido', 'Não: conta como “perdido”'],
          ],
        },
        { type: 'p', text: 'Você escolhe **Disponível**, **Em uso**, **Manutenção** ou **Perdido** quando edita um item.' },
        { type: 'p', text: '**Onde está / com quem** é texto livre: uma sala, um case, uma van ou o nome de uma pessoa. Use para achar o equipamento antes de um show.' },
        { type: 'p', text: 'Os kits contam os itens prontos (“{ready}/{total} prontos”) e avisam sobre os outros (“{count} itens para revisar · revise antes de {gig}.”).' },
      ],
    },
    {
      id: 'gear-kits',
      title: 'Criar e editar um kit de equipamento',
      summary: 'Junte o equipamento que vocês levam a um tipo de show, como um PA de clube ou um set de duo acústico.',
      roles: ['admin'],
      kind: 'task',
      keywords: ['kit', 'kit de equipamento', 'conjunto', 'lista para levar', 'kit de PA'],
      related: ['kit-for-a-gig', 'gear-inventory', 'gear-status'],
      body: [
        {
          type: 'steps',
          items: [
            'Em **Equipamento**, abra a aba **Kits** e toque em **Novo kit**.',
            'Digite o **Nome do kit** (até 80 caracteres) e, se quiser, **Notas**, como a forma de embalar.',
            'Em **Itens do seu equipamento**, marque os itens. Use a busca quando a lista for longa.',
            'Toque em **Criar kit**.',
          ],
        },
        {
          type: 'steps',
          title: 'Editar ou excluir',
          items: [
            'Toque no kit para abri-lo e depois em **Editar**.',
            'Mude o nome, as notas ou os itens e toque em **Salvar alterações**.',
            'Para excluir, toque em **Excluir kit** e toque de novo (**Toque de novo para excluir o kit**). Os itens continuam no equipamento.',
          ],
        },
        {
          type: 'list',
          title: 'A página do kit',
          items: [
            'Contadores: **Itens**, **Cases** e **Pronta**.',
            '**Próximo show com este kit**, e um aviso quando há itens em manutenção ou perdidos.',
            'A lista de itens com o status de cada um.',
            '**Usar num show** ([[kit-for-a-gig]]).',
          ],
        },
        {
          type: 'roles',
          rows: [
            { role: 'admin', text: 'Cria, edita, exclui e usa kits.' },
            { role: 'member', text: 'Vê os kits, os itens e se estão prontos, sem botões de edição.' },
          ],
        },
      ],
    },
    {
      id: 'kit-for-a-gig',
      title: 'Usar um kit num show',
      summary: 'Anexe um kit a um show para a banda saber o que vai na van.',
      roles: ['admin', 'member'],
      kind: 'task',
      keywords: ['atribuir equipamento', 'equipamento do show', 'kit do show', 'escolher kit'],
      related: ['gear-kits', 'gig-workspace', 'gear-status'],
      body: [
        {
          type: 'steps',
          title: 'Pelo show',
          items: [
            'Abra o show. Na seção **KIT DE EQUIPAMENTO**, toque em **ESCOLHER KIT** (ou **TROCAR** se já houver um).',
            'Em **Kit para este show**, toque em **Adicionar kit** ao lado de cada kit de que você precisa. Toque em **Kit adicionado** para tirar um.',
            'Toque em **Pronto**.',
          ],
        },
        {
          type: 'steps',
          title: 'Pelo kit',
          items: [
            'Abra o kit e toque em **Usar num show**.',
            'Toque em **Adicionar kit** ao lado de cada próximo show. Toque em **Pronto**.',
          ],
        },
        { type: 'p', text: 'O show passa a mostrar o kit com os itens e “Todas prontas” ou quantos precisam de revisão. O kit mostra o próximo show dele.' },
        {
          type: 'roles',
          rows: [
            { role: 'admin', text: 'Escolhe e muda os kits nos próximos shows da banda.' },
            { role: 'member', text: 'Vê o kit do show e se está pronto, sem o botão ESCOLHER KIT.' },
          ],
        },
        { type: 'note', tone: 'tip', text: 'Os kits são para shows da banda: ensaios, orçamentos e shows pessoais não têm a seção KIT DE EQUIPAMENTO. Usar um kit não muda o status dos itens.' },
        { type: 'devices', rows: [{ devices: ['tablet'], text: 'A seção KIT DE EQUIPAMENTO fica na aba do rider do show.' }] },
      ],
    },

    // ── Referência de privacidade ────────────────────────────────────────
    {
      id: 'who-sees-what',
      title: 'Quem vê o quê',
      summary: 'Cada tipo de dado da banda, e o que admins, membros e substitutos podem ler ou mudar.',
      roles: ['admin', 'member', 'deputy'],
      kind: 'reference',
      keywords: ['privacidade', 'permissões', 'visibilidade', 'cachês', 'quem pode ver', 'funções'],
      related: ['member-roles', 'deputies', 'member-detail', 'add-gear'],
      body: [
        { type: 'p', text: 'O dinheiro, os preços dos orçamentos, os contratos e os cachês dos outros são protegidos pelo servidor, não só escondidos no app: o celular de um membro nunca os recebe.' },
        {
          type: 'table',
          head: ['Dado', 'Admin', 'Membro'],
          rows: [
            ['Detalhes do show (data, horários, local, endereço, dress code, notas, rider e mapa de palco)', 'Tudo, mais cliente, preço do show, sinal, status do pagamento, notas internas e contrato', 'A logística dos shows que tocam e não recusaram. Nunca o cliente, o preço, o sinal, as notas internas ou o contrato'],
            ['Formação e respostas do show', 'Todos, com cachês e pagamentos', 'Quem toca e as respostas, sem cachês'],
            ['Próprio cachê', 'Sim', 'Sim: o cachê por show, pago ou não, o cachê padrão e o próprio **Pago · {year}**'],
            ['Cachês dos outros', 'Sim, de todos os membros e substitutos', 'Não'],
            ['Orçamentos e totais', 'Sim: criar, enviar e ver todos', 'Não. A verificação de disponibilidade de um orçamento mostra só a data'],
            ['Finanças, pagamentos e análises da banda', 'Sim', 'Não. Só os próprios ganhos'],
            ['Preços, dados bancários e fiscais', 'Sim', 'Não'],
            ['Setlists', 'Criar, editar, anexar aos shows', 'Só leitura'],
            ['Repertório (músicas, letras, acordes)', 'Adicionar, editar, excluir, importar', 'Ler; sugerir músicas e alterações; notas e arquivos privados que só a pessoa vê'],
            ['Contratos e riders', 'Sim', 'Sem contratos. O show mostra a versão do rider e o mapa de palco'],
            ['Chat', 'Conversa da banda, conversas dos shows, conversas diretas com qualquer um da banda', 'Conversa da banda, conversas dos shows que tocam, conversas diretas só com admins'],
            ['Equipamento e kits', 'Ver e mudar tudo', 'Ver todos os itens, o status e a localização; número de série, data e preço de compra só no próprio equipamento pessoal; mudar só o próprio equipamento pessoal'],
            ['Contatos dos membros', 'E-mail e telefone de todos da banda', 'E-mail e telefone de todos da banda'],
            ['Lista e pedidos de substitutos', 'Sim: contatos, cachês habituais, notas, respostas', 'Não'],
            ['Shows pessoais e notas privadas das músicas', 'Só os próprios', 'Só os próprios'],
          ],
        },
        {
          type: 'table',
          head: ['Dado', 'Substituto'],
          rows: [
            ['Detalhes do show', 'Só dos shows para os quais foi chamado: nome da banda, título, data, horários de montagem, passagem de som e show, local e cidade. O endereço só depois de um sim'],
            ['Próprio cachê', 'O cachê oferecido em cada pedido'],
            ['Outros cachês, orçamentos, finanças, preços', 'Não'],
            ['Formação, setlists, repertório, contratos, chat, equipamento', 'Não'],
            ['Contatos dos membros', 'Não'],
            ['Dados de substituto', 'Os próprios pedidos e o nome que a banda salvou para ele'],
          ],
        },
        { type: 'note', tone: 'privacy', text: 'Os membros e os substitutos veem só o próprio cachê e a logística. Nunca veem os cachês dos outros, os totais dos orçamentos ou as finanças da banda.' },
        { type: 'note', tone: 'tip', text: 'Os shows pessoais de um membro (os que ficam fora de qualquer banda) são privados: só ele os vê. As bandas nunca veem o título, o local ou o horário deles.' },
      ],
    },
  ],

  faq: [
    { q: 'Os membros podem ver quanto os outros recebem?', a: 'Não. Um membro vê só o próprio cachê em cada show e os próprios totais do ano. Os admins veem os de todos.' },
    { q: 'Como saio de uma banda?', a: 'Em **Membros da banda**, toque em **⋯** na sua própria linha e depois em **Sair da banda**. Um admin pode sair enquanto a banda tiver outro admin. Veja [[leave-a-band]].', roles: ['admin', 'member'] },
    { q: 'Por que não consigo remover o último admin?', a: 'Toda banda precisa de pelo menos um admin. Primeiro torne outra pessoa admin, depois mude ou remova o primeiro.', roles: ['admin'] },
    { q: 'Por quanto tempo um convite vale?', a: '7 dias. O endereço convidado recebe um lembrete quando faltam 2 dias. Convidar o mesmo endereço de novo renova o convite.', roles: ['admin'] },
    { q: 'A pessoa que convidei diz que o convite não funciona.', a: 'Ela precisa entrar com exatamente o endereço de e-mail que você convidou. Se o convite expirou, convide de novo.', roles: ['admin'] },
    { q: 'Um substituto precisa do app?', a: 'Não. O link do pedido abre uma página web em que ele responde com um toque. Com o app, ele recebe notificações e vê todos os pedidos em Shows como substituto.' },
    { q: 'Um substituto pode ver o preço do show ou o cliente?', a: 'Não. Um substituto vê só a logística, a função e o cachê oferecido a ele. O endereço aparece depois que ele diz sim.' },
    { q: 'A pessoa errada abriu um link de substituto. O que eu faço?', a: 'Abra o substituto em Membros da banda, toque em Desvincular conta e confirme. Todos os links antigos param de funcionar; envie o próximo pedido por mensagem.', roles: ['admin'] },
    { q: 'Os membros podem adicionar equipamento?', a: 'Sim, o próprio equipamento pessoal, com Adicionar meu equipamento. Eles só podem mudar ou excluir esse. O equipamento da banda é gerenciado pelos admins.', roles: ['member'] },
    { q: 'Os membros veem os substitutos?', a: 'Não. A lista de substitutos e os pedidos são só para admins.' },
    { q: 'Onde mudo o logo da banda?', a: 'Perfil e conta, cartão da banda atual, Editar, Logo da banda. Ele também vai para os PDFs dos seus orçamentos.', roles: ['admin'] },
    { q: 'Onde defino o cachê padrão de um membro?', a: 'Em **Membros da banda**, toque na pessoa e depois em **Na banda**: **Cachê padrão** e **Salvar**. Ele é usado nos novos shows.', roles: ['admin'] },
  ],

  glossary: [
    { term: 'Admin', definition: 'Uma pessoa que gerencia a banda: shows, dinheiro, setlists, membros e ajustes. Uma banda pode ter vários e precisa de pelo menos um.', see: 'member-roles' },
    { term: 'Membro', definition: 'Uma pessoa da banda que vê os shows, a logística e o próprio cachê, mas não a gerencia.', see: 'member-roles' },
    { term: 'Código de convite', definition: 'O código de um convite de banda. Cole-o, ou abra o link do convite, para entrar na banda.', see: 'accept-an-invite' },
    { term: 'Substituto', definition: 'Um músico de fora da banda que toca no lugar de um membro que não pode. Também chamado de sub ou freela.', see: 'deputies' },
    { term: 'Link de resposta', definition: 'O link privado de um pedido de substituto. Abre uma página web em que o substituto responde sem conta.', see: 'deputy-reply-page' },
    { term: 'No BandWith', definition: 'Um substituto cuja conta do BandWith está vinculada ao cadastro da banda. A banda pode chamá-lo no app.', see: 'deputy-in-the-app' },
    { term: 'Shows como substituto', definition: 'A tela em que um substituto vê e responde a todos os pedidos das bandas que o chamam.', see: 'deputy-gigs' },
    { term: 'Desvincular', definition: 'Desfazer o vínculo da conta de um substituto. Todos os links antigos dele param de funcionar.', see: 'unlink-a-deputy' },
    { term: 'Quem cobre o quê', definition: 'O cartão da lista de substitutos que mostra, para cada instrumento, os membros e os substitutos que o tocam.', see: 'add-a-deputy' },
    { term: 'Equipamento pessoal', definition: 'Equipamento que um membro adiciona como seu. A banda toda vê; só o dono e os admins o mudam.', see: 'add-gear' },
    { term: 'Kit', definition: 'Um conjunto com nome de itens do equipamento que vocês levam a um tipo de show, como um PA de clube.', see: 'gear-kits' },
    { term: 'Pronto', definition: 'Um item de kit que pode ir para um show: disponível ou em uso, não em manutenção nem perdido.', see: 'gear-status' },
  ],
};

export default people;
