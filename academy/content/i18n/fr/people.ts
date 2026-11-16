import type { AreaText } from '../../types';

const people: AreaText = {
  area: {
    id: "people",
    title: "Membres, remplaçants et matériel",
    intro: "Qui fait partie du groupe, qui te remplace quand quelqu’un ne peut pas jouer, le matériel que tu emportes en concert, et qui peut voir quoi.",
    icon: "people",
  },

  articles: [
    // ── Members ──────────────────────────────────────────────────────────
    {
      id: "band-members",
      title: "L’écran Membres du groupe",
      summary: "Toutes les personnes du groupe, leur rôle et leur instrument, avec le bouton d’invitation et la liste des remplaçants pour les admins.",
      roles: ["admin", "member"],
      kind: "reference",
      keywords: ["membres", "line-up", "effectif", "liste du groupe", "personnes"],
      related: ["invite-members", "member-detail", "member-roles", "deputies", "who-sees-what"],
      body: [
        { type: "p", text: "**Membres du groupe** liste toutes les personnes du groupe sélectionné. Le nom du groupe s’affiche au-dessus du titre." },
        {
          type: "steps",
          title: "L’ouvrir",
          items: [
            "Sur l’accueil, sous **Raccourcis**, touche **Membres**.",
            "Ou touche ton avatar en haut à droite pour ouvrir ton espace compte, puis **Membres** dans la carte du groupe actuel.",
          ],
        },
        {
          type: "list",
          title: "Ce que tu vois",
          items: [
            "Trois compteurs : **Total**, **Admins** et **Membres**.",
            "Une ligne par personne : photo ou initiales, nom (le nom de scène s’il y en a un), instrument et rôle (**Admin** ou **Membre**). Une étiquette **Pro** signale les personnes avec un abonnement payant.",
            "Touche une ligne pour ouvrir la page de la personne. Voir [[member-detail]].",
            "Touche **⋯** (**Actions pour …**) sur une ligne pour un petit menu : **E-mail** ; sur ta propre ligne **Quitter le groupe** ; pour les admins, sur la ligne des autres, **Nommer admin** ou **Rendre membre** et **Retirer du groupe**.",
            "Les admins voient aussi le bouton **Inviter un membre** (en haut à droite et en bas) et, sous la liste, la section **Remplaçants**. Voir [[deputies]].",
          ],
        },
        {
          type: "roles",
          rows: [
            { role: "admin", text: "Voit tout le monde, invite des personnes, change les rôles, retire des membres et gère les remplaçants." },
            { role: "member", text: "Voit tout le monde et leurs coordonnées, et peut leur écrire un e-mail. Pas de bouton d’invitation, pas de changement de rôle, pas de liste de remplaçants." },
          ],
        },
        { type: "shot", id: "people-band-members", caption: "Membres du groupe vu par un admin : compteurs, line-up et bouton Inviter un membre." },
        {
          type: "devices",
          rows: [
            { devices: ["duoLaptop"], text: "Les trois compteurs sont sur la moitié haute ; la liste des personnes est sur la moitié basse." },
            { devices: ["duoBook", "duoLand", "tablet"], text: "La page d’une personne s’ouvre à côté de la liste au lieu de la recouvrir." },
            { devices: ["android"], text: "Le geste Retour ferme d’abord la page d’une personne, puis Membres du groupe." },
          ],
        },
        { type: "note", tone: "tip", text: "Un groupe vide affiche **Pas encore de membres** et, pour les admins, **Inviter un premier membre**." },
      ],
    },
    {
      id: "invite-members",
      title: "Inviter quelqu’un dans le groupe",
      summary: "Trouve un utilisateur BandWith par son nom ou son e-mail, ou invite une nouvelle personne par e-mail, lien ou code.",
      roles: ["admin"],
      kind: "task",
      keywords: ["inviter", "ajouter un membre", "code d’invitation", "lien d’invitation", "rejoindre"],
      related: ["accept-an-invite", "member-roles", "band-members"],
      body: [
        { type: "p", text: "Personne n’est ajouté à un groupe sans dire oui. Tu envoies une invitation ; la personne l’accepte." },
        {
          type: "steps",
          items: [
            "Sur **Membres du groupe**, touche **Inviter un membre** (le + en haut à droite ou le bouton en bas).",
            "Saisis au moins 3 caractères d’un nom ou d’une adresse e-mail dans le champ de recherche.",
            "Si la personne utilise déjà BandWith, elle apparaît sous **Trouvés sur BandWith**. Touche **Invitation** à côté d’elle.",
            "Si personne n’est trouvé, saisis son adresse e-mail complète et touche **Inviter …**.",
            "Avant d’envoyer, choisis le rôle sous **Rôle** : **Membre** (« Peut voir le contenu du groupe ») ou **Admin** (« Gère membres, événements et réglages »). Membre est choisi par défaut.",
            "Pour une personne nouvelle sur BandWith, la feuille affiche ensuite le **Code d’invitation**. Touche **Partager** pour envoyer le lien et le code avec n’importe quelle app, ou **Copier le code**.",
          ],
        },
        {
          type: "list",
          title: "Ce qui se passe ensuite",
          items: [
            "Utilisateur existant : il reçoit une notification et une carte **Invitation de groupe** à sa prochaine ouverture de BandWith. Tu vois « Invitation envoyée à {name} ».",
            "Nouvelle personne : BandWith envoie l’invitation par e-mail quand c’est possible. Tu vois « Invitation envoyée par e-mail à {name} » ou, sans e-mail, « Invitation créée pour {name}. Partage-la pour lui permettre de rejoindre le groupe. »",
            "Une invitation est valable 7 jours. Quand il reste 2 jours ou moins, l’adresse invitée reçoit un e-mail de rappel. Si elle expire, tu reçois un e-mail.",
            "Inviter de nouveau la même adresse renouvelle l’invitation pour 7 jours.",
            "Quand la personne rejoint le groupe, tout le monde reçoit « {name} a rejoint {band} ».",
          ],
        },
        { type: "note", tone: "privacy", text: "Les résultats de recherche masquent en partie les e-mails (par exemple gi•••@…), sauf si tu saisis l’adresse exacte. Les personnes déjà dans le groupe n’apparaissent pas." },
        { type: "shot", id: "people-invite", caption: "La feuille Inviter un membre avec la recherche, les résultats et le choix du rôle." },
        { type: "note", tone: "tip", text: "L’invitation est liée à l’adresse e-mail. La personne doit se connecter avec cette adresse pour rejoindre le groupe." },
      ],
    },
    {
      id: "accept-an-invite",
      title: "Rejoindre un groupe grâce à une invitation",
      summary: "Accepte une invitation dans l’app, depuis le lien d’invitation, ou en collant le code d’invitation.",
      roles: ["admin", "member"],
      kind: "task",
      keywords: ["rejoindre un groupe", "accepter l’invitation", "code d’invitation", "refuser l’invitation"],
      related: ["invite-members", "member-roles"],
      body: [
        {
          type: "steps",
          title: "Tu utilises déjà BandWith",
          items: [
            "Ouvre BandWith. Une carte **Invitation de groupe** indique qui t’a invité, le groupe, sa taille et ton rôle (**en tant que membre** ou **en tant qu’admin**).",
            "Touche **Rejoindre**. Tu vois « Tu as rejoint {band} » et le groupe apparaît dans ton sélecteur de groupe.",
            "Ou touche **Refuser**. Pour décider plus tard, touche le X (**Décider plus tard**) ; la carte reviendra la prochaine fois.",
          ],
        },
        {
          type: "steps",
          title: "Tu es nouveau sur BandWith",
          items: [
            "Ouvre le lien d’invitation reçu par message ou par e-mail. Ou, sur l’écran d’accueil, touche **J’ai un code d’invitation**, colle le code ou le lien dans **Code ou lien d’invitation** et touche **Rejoindre**.",
            "Vérifie la carte du groupe et touche **Accepter et continuer** (ou **Refuser l’invitation**).",
            "Crée ton compte ou connecte-toi avec l’adresse e-mail à laquelle l’invitation a été envoyée.",
          ],
        },
        {
          type: "list",
          title: "Si ça ne marche pas",
          items: [
            "« Cette invitation a été envoyée à une autre adresse » veut dire que tu es connecté avec une autre adresse. Déconnecte-toi et utilise celle qui a été invitée.",
            "« Cette invitation a expiré » ou « n’est plus valable » : demande à un admin de t’inviter à nouveau.",
            "« Ça ne ressemble pas à un code d’invitation » : colle le code complet ou le lien entier.",
          ],
        },
      ],
    },
    {
      id: "member-roles",
      title: "Les rôles admin et membre",
      summary: "Ce qu’un admin peut faire et pas un membre, et la règle selon laquelle chaque groupe garde au moins un admin.",
      roles: ["admin", "member"],
      kind: "reference",
      keywords: ["admin", "membre", "autorisations", "rôle", "cogérer", "propriétaire"],
      related: ["make-admin", "who-sees-what", "remove-a-member"],
      body: [
        { type: "p", text: "Chaque personne d’un groupe est soit **Admin**, soit **Membre**. Un groupe peut avoir plusieurs admins. La personne qui crée un groupe en est le premier admin." },
        {
          type: "roles",
          rows: [
            { role: "admin", text: "Crée et modifie les concerts, répétitions et devis ; fixe les cachets et marque les paiements ; modifie les setlists, les morceaux, les contrats, les listes de tâches et les kits de matériel ; invite et retire des personnes ; change les rôles ; gère les remplaçants ; modifie les infos et les tarifs du groupe ; voit les finances et les statistiques du groupe." },
            { role: "member", text: "Voit les concerts et la logistique du groupe, répond aux invitations à jouer, lit les setlists et les morceaux, suggère des morceaux et des modifications, garde des notes privées sur les morceaux, discute, ajoute et modifie son propre matériel perso, et ne voit que son propre cachet." },
          ],
        },
        { type: "note", tone: "warning", text: "Un groupe a besoin d’au moins un admin. L’app ne te laisse pas retirer le dernier admin ni le rendre membre : « Un groupe a besoin d’au moins un admin. Nomme d’abord quelqu’un d’autre admin. » La même règle empêche de supprimer ton compte tant que tu es le seul admin d’un groupe." },
        { type: "p", text: "Cogérer un groupe (être l’un de plusieurs admins) est une fonction de l’abonnement payant. Pendant la bêta, tout le monde peut être nommé admin. Hors bêta, **Nommer admin** affiche « Nécessite un compte Pro pour cogérer » pour les personnes en formule gratuite." },
        { type: "p", text: "Pour la liste complète des données que chaque rôle peut lire, voir [[who-sees-what]]." },
      ],
    },
    {
      id: "make-admin",
      title: "Nommer quelqu’un admin, ou rendre un admin membre",
      summary: "Change le rôle d’une personne depuis la liste Membres du groupe ou depuis sa page.",
      roles: ["admin"],
      kind: "task",
      keywords: ["nommer admin", "retirer admin", "rétrograder", "promouvoir", "changer de rôle"],
      related: ["member-roles", "band-members"],
      body: [
        {
          type: "steps",
          items: [
            "Sur **Membres du groupe**, touche **⋯** sur la ligne de la personne. Ou touche la ligne pour ouvrir sa page.",
            "Touche **Nommer admin** pour lui donner les droits d’admin, ou **Rendre membre** pour les lui retirer.",
          ],
        },
        { type: "p", text: "Le changement est enregistré tout de suite, sans confirmation. La personne voit son nouveau rôle au prochain chargement de sa liste de groupes. Son téléphone efface alors les données du groupe gardées pour le mode hors ligne et les recharge pour le nouveau rôle : un nouvel admin voit le client et les prix, un ancien admin ne les garde plus sur son téléphone." },
        { type: "note", tone: "warning", text: "Tu ne peux pas rendre membre le dernier admin. Nomme d’abord quelqu’un d’autre admin." },
        { type: "note", tone: "tip", text: "Tu ne peux pas changer ton propre rôle : ta page et le menu **⋯** de ta propre ligne n’ont pas de boutons de rôle. Demande à un autre admin de te rendre membre." },
      ],
    },
    {
      id: "remove-a-member",
      title: "Retirer un membre du groupe",
      summary: "Retire quelqu’un du groupe ; il perd l’accès à ses événements, ses discussions et son répertoire.",
      roles: ["admin"],
      kind: "task",
      keywords: ["retirer un membre", "exclure", "supprimer un membre"],
      related: ["leave-a-band", "invite-members", "member-roles"],
      body: [
        {
          type: "steps",
          items: [
            "Sur **Membres du groupe**, touche **⋯** sur la ligne de la personne et touche **Retirer du groupe**. Ou ouvre sa page et touche **Retirer du groupe** en bas.",
            "Lis la feuille **Retirer du groupe ?** et touche **Retirer**. Touche **Annuler** pour la garder.",
          ],
        },
        {
          type: "list",
          title: "Ce qui se passe",
          items: [
            "Elle perd tout de suite l’accès aux événements, aux discussions et au répertoire du groupe.",
            "Elle reçoit une notification « Tu ne fais plus partie de {band} ». Le reste du groupe reçoit « {name} a quitté {band} ».",
            "Ses concerts passés, ses réponses et ses paiements restent dans l’historique du groupe.",
            "Tu peux l’inviter de nouveau plus tard.",
          ],
        },
        { type: "note", tone: "warning", text: "Impossible d’annuler. Pour faire revenir la personne, envoie une nouvelle invitation et attends qu’elle l’accepte." },
      ],
    },
    {
      id: "leave-a-band",
      title: "Quitter un groupe",
      summary: "Comment se passe un départ pour les admins et pour les membres.",
      roles: ["admin", "member"],
      kind: "task",
      keywords: ["quitter le groupe", "partir du groupe", "sortir du groupe"],
      related: ["remove-a-member", "member-roles"],
      body: [
        {
          type: "roles",
          rows: [
            { role: "member", text: "Tu peux quitter n’importe quel groupe dont tu fais partie, quand tu veux." },
            { role: "admin", text: "Tu peux partir tant que le groupe a un autre admin. Si tu es le seul, l’app te demande d’abord de nommer quelqu’un d’autre admin ([[make-admin]])." },
          ],
        },
        {
          type: "steps",
          items: [
            "Ouvre **Membres du groupe** pour ce groupe.",
            "Touche **⋯** sur ta propre ligne et touche **Quitter le groupe**. (Tu peux aussi toucher ta ligne et utiliser **Quitter le groupe** en bas.)",
            "La feuille demande « Quitter {band} ? » : tu perds l’accès aux événements, aux discussions et au répertoire du groupe. Touche **Quitter le groupe** pour confirmer, ou **Annuler**.",
          ],
        },
        { type: "p", text: "Quand tu pars, les autres reçoivent « {name} a quitté {band} ». L’app te fait passer sur ton autre groupe, ou sur l’écran de départ si tu n’en as pas. Tu ne peux revenir qu’avec une nouvelle invitation." },
        { type: "note", tone: "warning", text: "Supprimer ton compte (Réglages, **Supprimer le compte**) te retire aussi de tous tes groupes. Si tu es le seul admin d’un groupe, nomme d’abord quelqu’un d’autre admin." },
      ],
    },
    {
      id: "member-detail",
      title: "La page d’un membre",
      summary: "Qui il est, ses concerts et sa paie de l’année, ses prochains événements, ses coordonnées et les boutons de rôle.",
      roles: ["admin", "member"],
      kind: "reference",
      keywords: ["profil du membre", "stats du membre", "payé cette année", "contact", "téléphone", "e-mail"],
      related: ["band-members", "who-sees-what", "make-admin"],
      body: [
        { type: "p", text: "Touche une personne sur **Membres du groupe** pour ouvrir sa page." },
        {
          type: "list",
          items: [
            "En haut : photo, nom, instrument et rôle.",
            "**Concerts cette année** : les concerts joués plus ceux à venir, avec une jauge à points. **Payé · …** : ce qui lui a été payé, et combien reste dû.",
            "**À venir pour …** : ses prochains événements dans ce groupe, chacun avec sa réponse (confirmé, en attente, refusé).",
            "**Contacts** : e-mail et téléphone, chacun avec un bouton de copie. Touches-en un pour écrire ou appeler.",
            "**Message** ouvre une discussion privée. **Nommer admin** / **Rendre membre** et **Retirer du groupe** sont réservés aux admins.",
          ],
        },
        {
          type: "roles",
          rows: [
            { role: "admin", text: "Voit les compteurs de concerts et de paie de tout le monde, et toutes les actions sauf sur sa propre page." },
            { role: "member", text: "Ne voit les compteurs de concerts et de paie que sur sa propre page. Sur la page de quelqu’un d’autre : nom, instrument, prochains événements et coordonnées. **Message** n’apparaît que sur la page d’un admin, car les membres ne peuvent ouvrir une discussion privée qu’avec les admins." },
          ],
        },
        { type: "note", tone: "privacy", text: "Un membre ne voit jamais ce qu’un autre membre est payé. Les compteurs viennent d’une fonction serveur qui renvoie tous les membres aux admins, et seulement ta propre ligne à toi." },
        {
          type: "devices",
          rows: [
            { devices: ["phone", "duoClosed"], text: "S’ouvre en plein écran." },
            { devices: ["duoBook", "duoLand"], text: "S’ouvre sur le second écran, à côté de la liste." },
            { devices: ["tablet"], text: "S’ouvre dans la colonne de détail à côté de la liste." },
          ],
        },
      ],
    },
    {
      id: "default-fees-and-instruments",
      title: "Cachets habituels et instruments",
      summary: "D’où viennent l’instrument d’un membre et son cachet prérempli, et où les changer.",
      roles: ["admin", "member"],
      kind: "reference",
      keywords: ["cachet habituel", "cachet par défaut", "tarif", "instrument", "rôle", "paie"],
      related: ["who-sees-what", "deputies", "gig-workspace"],
      body: [
        { type: "p", text: "Chaque personne d’un groupe peut avoir un cachet habituel. Quand un admin l’ajoute à un nouveau concert ou devis, son cachet est prérempli avec ce montant (les répétitions n’ont pas de cachet) ; sans cachet habituel, c’est le tarif membre du groupe dans **Tarifs, cachets et prestations** qui s’applique. L’admin peut changer le cachet sur chaque concert." },
        {
          type: "steps",
          title: "Admins : changer l’instrument ou le cachet habituel d’un membre",
          items: [
            "Sur **Membres du groupe**, touche la ligne de la personne.",
            "Sous **Dans le groupe**, saisis l’**Instrument dans ce groupe** (vide : l’instrument de son profil s’affiche) et le **Cachet habituel** (facultatif, un nombre comme 150).",
            "Touche **Enregistrer**. Le cachet habituel s’applique aux nouveaux concerts.",
          ],
        },
        { type: "p", text: "Un membre qui ouvre sa propre ligne voit « Ton cachet habituel dans ce groupe : {fee} » s’il en a un." },
        { type: "p", text: "Ton instrument principal se trouve dans ton profil : touche ton avatar, puis **Modifier** sur ta carte de profil, et choisis-le sous **Instrument / rôle principal**. Il s’affiche sur la carte de ton espace compte." },
        { type: "p", text: "L’instrument à côté de chaque nom sur **Membres du groupe** est celui enregistré pour cette personne dans ce groupe. La carte **Qui remplace qui** des remplaçants regroupe le groupe selon ces instruments." },
        { type: "note", tone: "privacy", text: "Les cachets habituels suivent la règle de l’argent : les admins voient ceux de tout le monde, un membre ne voit que le sien." },
      ],
    },
    {
      id: "band-details",
      title: "Changer le nom, le logo, la ville et la bio du groupe",
      summary: "Modifie la carte du groupe dans ton espace compte ; le logo apparaît aussi sur les PDF de devis.",
      roles: ["admin"],
      kind: "task",
      keywords: ["nom du groupe", "logo", "photo du groupe", "ville d’attache", "ville", "slogan", "bio", "renommer le groupe"],
      related: ["member-roles", "band-members"],
      body: [
        {
          type: "steps",
          items: [
            "Touche ton avatar en haut à droite pour ouvrir ton espace compte.",
            "Dans la carte du groupe actuel, touche **Modifier**.",
            "Sous **Logo du groupe**, touche **Importer** (ou **Changer**) et choisis une image. Touche la corbeille (**Retirer le logo**) pour l’enlever.",
            "Change le **Nom du groupe**, la **Ville d’attache** (choisis l’un des **Lieux suggérés** pour que les frais de déplacement puissent utiliser sa position) et la **Bio / slogan du groupe (facultatif)**.",
            "Touche **Enregistrer**. Touche **Annuler** ou **Fermer** pour partir sans enregistrer.",
          ],
        },
        { type: "p", text: "Le logo s’affiche sur la carte du groupe, dans le sélecteur de groupe et sur les PDF de devis. La ville d’attache devient aussi le point de départ des frais de déplacement dans tes tarifs." },
        { type: "p", text: "**Réglages du groupe** sous la carte du groupe ouvre l’identité visuelle et les tarifs du groupe (compte bancaire, tarifs des musiciens, prestations des devis). Voir [[pricing-sheet]]." },
        { type: "note", tone: "privacy", text: "Les membres voient le nom, le logo, la ville et la bio du groupe, jamais ses infos bancaires, fiscales ou tarifaires." },
      ],
    },

    // ── Deputies ─────────────────────────────────────────────────────────
    {
      id: "deputies",
      title: "Les remplaçants",
      summary: "La liste des musiciens remplaçants du groupe, comment les demandes leur parviennent, et ce qu’ils peuvent voir ou non.",
      roles: ["admin", "deputy"],
      kind: "reference",
      keywords: ["remplaçant", "remplacement", "musicien de session", "doublure", "dep", "sub", "remplacer"],
      related: ["add-a-deputy", "ask-a-deputy", "deputy-reply-page", "deputy-gigs", "unlink-a-deputy", "deputy-notifications", "who-sees-what"],
      body: [
        { type: "p", text: "Un remplaçant est un musicien hors du groupe qui joue quand un membre ne peut pas. Le groupe tient une liste de remplaçants avec leur instrument, leurs coordonnées et leur cachet habituel. Les remplaçants n’ont pas besoin de compte BandWith." },
        {
          type: "list",
          title: "Comment ça marche",
          items: [
            "Un admin ajoute des remplaçants sur **Membres du groupe**, sous **Remplaçants** ([[add-a-deputy]]).",
            "Quand un membre refuse un concert, l’admin touche **Trouver un remplaçant** dans le line-up du concert et envoie une demande par WhatsApp, SMS ou e-mail ([[ask-a-deputy]]).",
            "Le message contient un lien privé vers une page de réponse. Le remplaçant y répond d’un toucher, sans compte ([[deputy-reply-page]]).",
            "Les admins reçoivent une notification avec la réponse.",
            "Si le remplaçant ouvre BandWith depuis ce lien et se connecte, son compte est relié à sa fiche dans le groupe. Dès lors, le groupe peut **Demander dans l'app** et le remplaçant répond dans **Dates de remplaçant** ([[deputy-gigs]]).",
          ],
        },
        {
          type: "roles",
          rows: [
            { role: "admin", text: "Ajoute, modifie et supprime les remplaçants ; voit leur téléphone, leur e-mail, leur cachet habituel et leurs notes ; envoie, suit et annule les demandes ; dissocie le compte d’un remplaçant." },
            { role: "member", text: "Ne voit ni la liste des remplaçants ni les demandes. Un membre qui ouvre un lien de remplaçant de son propre groupe voit « Tu fais déjà partie de {band} »." },
            { role: "deputy", text: "Ne voit que ses propres demandes : nom du groupe, titre du concert, date, horaires d’installation, de balance et de concert, salle et ville, rôle et cachet proposé. L’adresse n’apparaît qu’après un oui." },
          ],
        },
        { type: "note", tone: "privacy", text: "Un remplaçant ne voit jamais le client, le prix du concert, les cachets des autres musiciens, la setlist, le chat ni quoi que ce soit d’autre dans le groupe." },
        { type: "note", tone: "tip", text: "Un remplaçant qui dit oui n’est pas ajouté au line-up du concert. Les admins le suivent sous **Remplaçants contactés** dans la feuille du line-up." },
      ],
    },
    {
      id: "add-a-deputy",
      title: "Ajouter, modifier ou supprimer un remplaçant",
      summary: "Tiens à jour la liste des remplaçants du groupe, et vois quels instruments n’ont encore personne.",
      roles: ["admin"],
      kind: "task",
      keywords: ["ajouter un remplaçant", "nouveau remplaçant", "qui remplace qui", "musicien de session"],
      related: ["deputies", "ask-a-deputy", "unlink-a-deputy"],
      body: [
        {
          type: "steps",
          items: [
            "Sur **Membres du groupe**, fais défiler jusqu’à **Remplaçants**.",
            "Touche **Ajouter un remplaçant** (le + à côté du titre). Dans **Qui remplace qui**, le + à côté d’un instrument marqué « Aucun remplaçant » ouvre le formulaire avec cet instrument déjà rempli.",
            "Remplis **Nom** (obligatoire), **Instrument**, **Téléphone (WhatsApp)**, **E-mail**, **Cachet habituel** et **Notes** (par exemple « Lit les grilles, a son matériel »).",
            "Touche **Ajouter un remplaçant**.",
          ],
        },
        {
          type: "steps",
          title: "Modifier ou supprimer",
          items: [
            "Touche le remplaçant dans la liste.",
            "Change les champs et touche **Enregistrer**.",
            "Pour supprimer, touche **Supprimer le remplaçant**, puis **Supprimer** dans « Supprimer le remplaçant ? ».",
          ],
        },
        {
          type: "list",
          title: "Qui remplace qui",
          items: [
            "Liste chaque instrument joué dans le groupe, les membres qui le jouent et ses remplaçants.",
            "La ligne au-dessus indique « Chaque instrument du groupe a un remplaçant. » ou combien n’en ont pas.",
          ],
        },
        { type: "p", text: "Un remplaçant qui a un compte BandWith porte l’étiquette **Sur BandWith**, et sa fiche indique qu’il répond dans l’app." },
        { type: "note", tone: "warning", text: "Supprimer un remplaçant le retire de la liste du groupe. Les demandes passées gardent son nom et sa réponse. Tu peux l’ajouter de nouveau plus tard." },
        { type: "note", tone: "privacy", text: "Seuls les admins voient cette liste (« Seuls les admins voient cette liste. »)." },
        { type: "devices", rows: [{ devices: ["tablet", "duoLand"], text: "Les remplaçants s’affichent sur deux colonnes quand l’écran est large." }] },
      ],
    },
    {
      id: "ask-a-deputy",
      title: "Demander à un remplaçant d’assurer un concert",
      summary: "Depuis le line-up du concert, envoie une demande par message ou dans l’app et suis la réponse.",
      roles: ["admin"],
      kind: "task",
      keywords: ["trouver un remplaçant", "demander à un remplaçant", "remplacer un membre", "assurer un concert", "remplacement", "WhatsApp"],
      related: ["deputies", "deputy-reply-page", "deputy-notifications", "gig-workspace"],
      body: [
        { type: "p", text: "Tu peux demander un remplaçant quand un membre a refusé un concert du groupe à venir. Les répétitions, les concerts perso et les concerts passés ne le proposent pas." },
        {
          type: "steps",
          items: [
            "Ouvre le concert et, dans la section **LINE-UP**, touche la liste des noms (pas **MODIFIER**) pour ouvrir la feuille **Line-up**.",
            "À côté du membre qui a refusé, touche **Trouver un remplaçant**. La feuille affiche « À la place de {name} » et les remplaçants du groupe, ceux qui jouent le même instrument en premier.",
            "Pour un remplaçant sur BandWith, touche **Demander dans l'app**. Il reçoit une notification.",
            "Sinon, touche **WhatsApp**, **SMS** ou **E-mail**. Ton app de messagerie s’ouvre avec les détails du concert et le lien de réponse déjà remplis. Envoie-le depuis ton téléphone.",
            "Reviens sur BandWith. La réponse du remplaçant apparaît sous son nom : **Demandé · pas encore de réponse**, **Dispo**, **Confirmera plus tard** ou **Je ne peux pas**, avec son message.",
          ],
        },
        {
          type: "list",
          title: "Après la réponse",
          items: [
            "Après un oui, les boutons envoient plutôt le récapitulatif (**Envoyer le récapitulatif**, **Récap dans l'app**) avec l’adresse complète et le lien d’agenda.",
            "Si tu changes la date, les horaires ou la salle après sa réponse, le remplaçant est signalé « La date a changé après sa réponse : envoie-lui la mise à jour. » Les boutons envoient la mise à jour (**Envoyer la mise à jour**, **Mise à jour dans l'app**).",
            "**Copier le lien** copie le lien de réponse. **Annuler la demande** la retire ; un remplaçant relié reçoit une notification.",
            "La feuille du line-up liste toutes les demandes en cours sous **Remplaçants contactés**.",
          ],
        },
        {
          type: "list",
          title: "Ce que contient la demande",
          items: [
            "Le nom du groupe, le titre du concert, la date et l’heure, la salle et la ville, le rôle et le cachet.",
            "Le cachet est celui du membre remplacé sur ce concert, ou le cachet habituel du remplaçant s’il n’y en a pas.",
            "L’adresse ne figure que dans le récapitulatif et la mise à jour, après un oui.",
          ],
        },
        { type: "shot", id: "people-find-deputy", caption: "Trouver un remplaçant pour un membre qui a refusé : chaque remplaçant avec Demander dans l’app, WhatsApp, SMS et E-mail." },
        { type: "note", tone: "tip", text: "« Déjà envoyé il y a un instant. » veut dire que tu as touché deux fois : une même demande dans l’app part au plus une fois toutes les 2 minutes." },
        { type: "note", tone: "tip", text: "Pas encore de remplaçants ? La feuille propose **Ajouter des remplaçants**, qui t’emmène à la liste." },
      ],
    },
    {
      id: "deputy-reply-page",
      title: "La page de réponse du remplaçant",
      summary: "Ce que voit un remplaçant quand il ouvre le lien d’une demande, et comment il répond sans compte.",
      roles: ["deputy", "admin"],
      kind: "reference",
      keywords: ["lien remplaçant", "lien de réponse", "deputy.html", "répondre à la demande", "sans compte"],
      related: ["ask-a-deputy", "deputy-gigs", "deputies"],
      body: [
        { type: "p", text: "Le lien d’une demande ouvre une petite page web dans le navigateur du remplaçant. Aucune app ni aucun compte n’est nécessaire. Elle s’affiche dans la langue du remplaçant quand elle est disponible." },
        {
          type: "list",
          title: "Ce que voit le remplaçant",
          items: [
            "« {band} cherche un remplaçant pour cette date. » avec la date, les horaires d’installation, de balance et de concert, la salle, la ville, le rôle et le cachet proposé.",
            "Trois réponses : **Oui, je suis disponible**, **Pas encore sûr, je confirme plus tard**, **Non, je ne peux pas**, et **Message au groupe (facultatif)**.",
            "Après un oui : l’adresse, **Ouvrir dans Plans** et **Ajouter à ton agenda** (**Calendrier Apple · Outlook**, **Google Agenda**, ou **S'abonner · se met à jour tout seul**).",
            "**Changer de réponse** reste disponible jusqu’au concert.",
            "Si le groupe modifie le concert après la réponse : **Quelque chose a changé** avec les anciennes et les nouvelles valeurs, et **Toujours OK** ou **Je ne peux plus**.",
            "**Télécharger BandWith** ouvre l’app et relie le compte. Voir [[deputy-gigs]].",
          ],
        },
        {
          type: "list",
          title: "Quand le lien ne marche plus",
          items: [
            "« Cette demande est close. » Le groupe a retiré la demande.",
            "« La date est annulée. »",
            "« Cette date est passée. » à partir du lendemain du concert.",
            "« Ce lien ne fonctionne pas. » Le groupe a dissocié le remplaçant ou le lien est erroné. Demande au groupe de renvoyer la demande.",
          ],
        },
        { type: "note", tone: "privacy", text: "Le lien fait office de clé : quiconque l’a peut répondre. S’il est arrivé chez la mauvaise personne, un admin peut dissocier le remplaçant, ce qui remplace tous les liens ([[unlink-a-deputy]])." },
      ],
    },
    {
      id: "deputy-in-the-app",
      title: "Répondre aux demandes de remplacement dans l’app",
      summary: "Relie ton compte BandWith à la liste des remplaçants d’un groupe depuis le lien de réponse, puis réponds dans Dates de remplaçant.",
      roles: ["deputy"],
      kind: "task",
      keywords: ["compte remplaçant", "relier", "lier le compte", "télécharger BandWith", "app remplaçant"],
      related: ["deputy-gigs", "deputy-reply-page", "unlink-a-deputy"],
      body: [
        {
          type: "steps",
          items: [
            "Ouvre le lien de réponse qu’un groupe t’a envoyé et touche **Télécharger BandWith**.",
            "Dans l’app, crée un compte ou connecte-toi. L’écran d’accueil indique « {band} t'appelle comme remplaçant. »",
            "Attends « Liaison de ton compte au groupe… ». Tu vois ensuite « Tu es sur la liste des remplaçants de {band} ».",
            "Touche **OK**. Les demandes de ce groupe sont listées dans **Dates de remplaçant**.",
          ],
        },
        {
          type: "list",
          title: "Autres messages",
          items: [
            "« Ce lien appartient à un autre compte » : le groupe l’a relié à quelqu’un d’autre. Demande-lui une nouvelle demande.",
            "« Tu fais déjà partie de {band} » : tu es membre de ce groupe, tu ne peux donc pas en être remplaçant.",
            "« Impossible de relier ton compte au groupe. Vérifie ta connexion. » : touche **Réessayer**. L’app réessaie aussi quand tu es de nouveau en ligne.",
          ],
        },
        { type: "p", text: "Dès lors, les admins du groupe peuvent te solliciter dans l’app et tu reçois des notifications. Ils sont prévenus : « {deputy} est sur BandWith »." },
        { type: "note", tone: "tip", text: "Le lien t’attend même si tu dois d’abord t’inscrire ou si l’app redémarre." },
      ],
    },
    {
      id: "deputy-gigs",
      title: "Dates de remplaçant",
      summary: "Toutes les demandes que des groupes t’ont envoyées comme remplaçant, avec tes réponses, l’adresse après un oui et les liens d’agenda.",
      roles: ["deputy"],
      kind: "reference",
      keywords: ["dates de remplaçant", "mes demandes de remplacement", "flux d’agenda", "s’abonner", "webcal"],
      related: ["deputy-in-the-app", "deputy-notifications", "deputy-reply-page"],
      body: [
        {
          type: "list",
          title: "Où les trouver",
          items: [
            "Sans groupe à toi : **Dates de remplaçant** est ton écran d’accueil. **Tu joues aussi dans un groupe ?** propose **Crée ton groupe** et **Se déconnecter**.",
            "Avec un groupe : touche ton avatar, puis **Dates de remplaçant** (« Demandes de {count} groupes ») en haut de ton espace compte.",
            "Toucher une notification de remplacement l’ouvre sur cette demande.",
          ],
        },
        {
          type: "list",
          title: "Chaque demande",
          items: [
            "Le titre du concert et le groupe, avec un statut : **En attente de ta réponse**, **Tu as dit oui**, **Tu confirmeras plus tard**, **Tu as dit que tu ne pouvais pas**, **Demande retirée**, **Concert annulé** ou **Date passée**.",
            "Date, installation, balance, concert, salle, ville, rôle et **Cachet proposé**. L’adresse apparaît après un oui.",
            "Pour répondre : **Oui**, **Pas encore sûr** ou **Non, je ne peux pas**, avec un message facultatif. Plus tard, **Modifier ta réponse**.",
            "Si le concert a changé : **Quelque chose a changé**, puis **Toujours OK** ou **Je ne peux plus**.",
            "Après un oui : **Ouvrir dans Plans**, **Ajouter au calendrier**, **Google Agenda** et **M'abonner à mes dates**.",
          ],
        },
        { type: "p", text: "Les demandes en cours passent en premier ; les autres sont sous **Passées et clôturées**. Les demandes s’affichent à partir d’il y a 30 jours. La ligne du haut liste les « Groupes qui t'appellent comme remplaçant »." },
        { type: "p", text: "**M'abonner à mes dates** ajoute un flux d’agenda de tes concerts confirmés avec ce groupe. Il suit chaque changement et signale les concerts annulés : ton agenda reste juste sans ouvrir BandWith." },
        { type: "shot", id: "people-deputy-gigs", caption: "Dates de remplaçant : une demande d’un autre groupe en attente de réponse." },
        {
          type: "devices",
          rows: [
            { devices: ["duoBook", "duoLand"], text: "En écran d’accueil, la page de la marque BandWith est sur le premier écran et tes dates sur le second, comme à la connexion." },
            { devices: ["duoLaptop"], text: "En écran d’accueil en position ordinateur, l’en-tête reste sur la moitié haute et tes demandes sur la moitié basse. Pendant que tu écris un message, la zone de saisie reste visible, au-dessus du clavier ou juste au-dessus de la charnière." },
          ],
        },
      ],
    },
    {
      id: "unlink-a-deputy",
      title: "Dissocier le compte BandWith d’un remplaçant",
      summary: "Quand la mauvaise personne a ouvert le lien, ou que le remplaçant a changé de compte.",
      roles: ["admin"],
      kind: "task",
      keywords: ["dissocier", "mauvais compte", "lien transféré", "nouveau lien", "renouveler"],
      related: ["deputies", "deputy-in-the-app", "ask-a-deputy"],
      body: [
        {
          type: "steps",
          items: [
            "Sur **Membres du groupe**, sous **Remplaçants**, touche le remplaçant qui porte l’étiquette **Sur BandWith**.",
            "Dans le cadre **Sur BandWith**, touche **Dissocier le compte**.",
            "Lis « Dissocier le compte BandWith ? » et touche **Dissocier**.",
          ],
        },
        {
          type: "list",
          title: "Ce qui se passe",
          items: [
            "Ce compte ne reçoit plus de demandes dans l’app et ne voit plus les concerts de ce groupe dans **Dates de remplaçant**.",
            "Tous les liens déjà envoyés à ce remplaçant sont remplacés. Les anciennes pages de réponse, flux d’agenda et liens vers l’app cessent de fonctionner.",
            "Ses réponses restent telles quelles.",
            "Envoie la prochaine demande par message. Ouvrir son nouveau lien depuis l’app relie de nouveau le bon compte.",
          ],
        },
        { type: "note", tone: "warning", text: "C’est irréversible : les anciens liens ne fonctionneront plus jamais." },
      ],
    },
    {
      id: "deputy-notifications",
      title: "Notifications de remplacement",
      summary: "Quelles notifications reçoivent les admins et les remplaçants pendant une demande.",
      roles: ["admin", "deputy"],
      kind: "reference",
      keywords: ["push remplaçant", "notification remplaçant", "le remplaçant a répondu"],
      related: ["ask-a-deputy", "deputy-gigs", "notifications-inbox"],
      body: [
        {
          type: "table",
          head: ["Quand", "Qui", "Notification"],
          rows: [
            ["Le remplaçant répond ou change sa réponse", "Tous les admins actifs", "« {deputy} est disponible », « confirmera plus tard » ou « ne peut pas venir », avec le concert et son message"],
            ["Le remplaçant confirme après un changement", "Tous les admins actifs", "« {deputy} est d’accord avec les changements »"],
            ["Un remplaçant relie son compte", "Tous les admins actifs", "« {deputy} est sur BandWith »"],
            ["Une nouvelle demande, ou de nouveau **Demander dans l'app**", "Remplaçant relié", "« {band} : tu peux jouer ? »"],
            ["**Récap dans l'app** après un oui", "Remplaçant relié", "« Tu es confirmé : {gig} »"],
            ["La date, les horaires ou la salle changent après sa réponse", "Remplaçant relié", "« {gig} a changé », avec ce qui a changé et « Toujours OK ? »"],
            ["Le concert est annulé", "Remplaçant relié", "« {gig} est annulé »"],
            ["L’admin annule la demande", "Remplaçant relié", "« {band} n’a plus besoin de toi »"],
          ],
        },
        { type: "p", text: "Les notifications des admins ouvrent le concert. Celles des remplaçants ouvrent **Dates de remplaçant** sur la demande concernée. Un remplaçant sans l’app ne reçoit rien automatiquement : envoie la mise à jour depuis **Trouver un remplaçant**." },
        { type: "note", tone: "tip", text: "Les rafales sont regroupées : une même demande, un même récap ou un même avis de changement atteint un remplaçant au plus une fois toutes les 2 minutes." },
      ],
    },

    // ── Gear ─────────────────────────────────────────────────────────────
    {
      id: "gear-inventory",
      title: "Matériel et stock",
      summary: "La liste du matériel du groupe avec catégories, statut, emplacement et propriétaire de chaque élément.",
      roles: ["admin", "member"],
      kind: "reference",
      keywords: ["matériel", "stock", "inventaire", "équipement", "backline", "sono", "liste du matériel"],
      related: ["add-gear", "gear-status", "gear-kits", "kit-for-a-gig"],
      body: [
        {
          type: "steps",
          title: "L’ouvrir",
          items: [
            "Admins : sur l’accueil, sous **Raccourcis**, touche **Matériel**.",
            "Tout le monde : touche ton avatar, puis la tuile **Matériel & stock** sous **Ressources et outils du groupe**.",
          ],
        },
        {
          type: "list",
          title: "Ce que tu vois",
          items: [
            "Deux onglets : **Éléments** et **Kits** ([[gear-kits]]).",
            "Un champ de recherche (**Rechercher matériel, micros, câbles…**) et des puces de catégorie avec leur nombre : **Tout**, **Instruments**, **Câbles**, **Micros**, **Enceintes**, **Pieds**, **Lumières**, **Étuis**, les catégories créées par le groupe, puis **Autre**.",
            "Chaque élément : nom, point de statut, et une ligne avec « Perso · {name} » pour le matériel de quelqu’un, la catégorie, « qté {count} » et l’emplacement.",
            "Les éléments que tu peux changer ont un bouton de modification et un bouton de suppression. Ceux que tu ne peux pas changer affichent un cadenas, et une note sous la liste indique qui peut les modifier.",
          ],
        },
        {
          type: "roles",
          rows: [
            { role: "admin", text: "Ajoute, modifie et supprime n’importe quel élément, celui du groupe comme le matériel perso des membres, et gère les kits." },
            { role: "member", text: "Voit tout le matériel et tous les kits du groupe. Ajoute son propre matériel avec **Ajouter mon matériel** et ne modifie ou supprime que celui-là." },
          ],
        },
        { type: "p", text: "La tuile de l’espace compte affiche le nombre d’éléments et une ligne d’état : « {count} en réparation », « {count} perdus » ou « Tout est en ordre »." },
        { type: "shot", id: "people-gear", caption: "Matériel & kits sur une tablette : la bande des kits au-dessus de la liste des éléments." },
        {
          type: "devices",
          rows: [
            { devices: ["tablet"], text: "L’écran s’appelle **Matériel & kits**. Les kits forment une bande de tuiles au-dessus des éléments, sans onglets Éléments/Kits." },
            { devices: ["duoBook", "duoLand"], text: "Un kit s’ouvre sur le second écran." },
          ],
        },
      ],
    },
    {
      id: "add-gear",
      title: "Ajouter, modifier ou supprimer un élément de matériel",
      summary: "Ajoute du matériel au nom du groupe ou à ton nom, et garde ses infos à jour.",
      roles: ["admin", "member"],
      kind: "task",
      keywords: ["ajouter du matériel", "ajouter mon matériel", "matériel perso", "modifier un élément", "supprimer un élément", "numéro de série"],
      related: ["gear-inventory", "gear-status", "who-sees-what"],
      body: [
        {
          type: "steps",
          items: [
            "Sur **Matériel & stock**, touche **Ajouter du matériel** (admins) ou **Ajouter mon matériel** (membres), ou le + en haut à droite.",
            "Saisis le **Nom de la ligne**, par exemple « Shure SM58 ».",
            "Admins : sous **Appartient à**, choisis **Le groupe** ou **Moi (perso)**. Les éléments des membres sont toujours à eux.",
            "Choisis une **Catégorie** et un **Statut**, règle la **Quantité** et remplis **Emplacement / qui l’a**.",
            "Aucune catégorie ne convient ? Touche **Perso** et saisis un **Nom de la catégorie** (40 caractères max.). Elle apparaît ensuite comme puce pour tout le groupe.",
            "Ajoute si tu veux le **Numéro de série**, la **Date d’achat**, le **Prix d’achat** et des **Notes**.",
            "Touche **Enregistrer l’élément**.",
          ],
        },
        {
          type: "steps",
          title: "Modifier ou supprimer",
          items: [
            "Touche l’élément (**Modifier …**), change-le et touche **Enregistrer**.",
            "Pour supprimer, touche **Supprimer l’élément** dans la feuille, ou la corbeille sur la ligne de l’élément.",
          ],
        },
        {
          type: "roles",
          rows: [
            { role: "admin", text: "Peut modifier chaque élément, changer à qui il appartient et tout supprimer." },
            { role: "member", text: "Ne peut modifier et supprimer que les éléments marqués comme les siens. La feuille indique « Matériel perso : le groupe le voit, seuls toi et les admins pouvez le modifier. » Les autres éléments affichent un cadenas à la place des boutons." },
          ],
        },
        { type: "note", tone: "warning", text: "La corbeille d’une ligne, ou **Supprimer l’élément** dans la feuille, demande d’abord « Supprimer {name} ? ». Supprimer un élément le retire aussi de tous les kits." },
        { type: "note", tone: "privacy", text: "Tout le groupe voit chaque élément, son statut et son emplacement. Le **Numéro de série**, la **Date d’achat** et le **Prix d’achat** ne s’affichent qu’aux admins, et au propriétaire d’un matériel perso." },
      ],
    },
    {
      id: "gear-status",
      title: "Statut et emplacement du matériel",
      summary: "Ce que veulent dire Dispo, Utilisé, Entretien et Perdu, et comment ils alimentent les compteurs des kits et de l’espace compte.",
      roles: ["admin", "member"],
      kind: "reference",
      keywords: ["statut", "en réparation", "entretien", "perdu", "manquant", "emplacement", "qui l’a"],
      related: ["gear-inventory", "gear-kits"],
      body: [
        {
          type: "table",
          head: ["Statut", "Signification", "Prêt pour un concert ?"],
          rows: [
            ["**Dispo**", "À sa place, libre d’être pris", "Oui"],
            ["**Utilisé**", "Sorti avec quelqu’un", "Oui"],
            ["**Entretien**", "En réparation", "Non : compté « en réparation »"],
            ["**Perdu**", "Introuvable", "Non : compté « perdu »"],
          ],
        },
        { type: "p", text: "Tu choisis **Dispo**, **Utilisé**, **Entretien** ou **Perdu** en modifiant un élément." },
        { type: "p", text: "**Emplacement / qui l’a** est un texte libre : une salle, un flight case, un van ou le nom d’une personne. Sers-t’en pour retrouver le matériel avant un concert." },
        { type: "p", text: "Les kits comptent leurs éléments prêts (« {ready}/{total} prêts ») et signalent les autres (« {count} éléments à vérifier · à vérifier avant {gig}. »)." },
      ],
    },
    {
      id: "gear-kits",
      title: "Créer et modifier un kit de matériel",
      summary: "Regroupe le matériel que tu emportes pour un type de concert, comme une sono de club ou un set duo acoustique.",
      roles: ["admin"],
      kind: "task",
      keywords: ["kit", "kit de matériel", "lot", "liste de chargement", "kit sono"],
      related: ["kit-for-a-gig", "gear-inventory", "gear-status"],
      body: [
        {
          type: "steps",
          items: [
            "Sur **Matériel & stock**, ouvre l’onglet **Kits** et touche **Nouveau kit**.",
            "Saisis le **Nom du kit** (80 caractères max) et, si tu veux, des **Notes**, par exemple comment il se range.",
            "Sous **Éléments de votre stock**, coche les éléments. Utilise la recherche quand la liste est longue.",
            "Touche **Créer le kit**.",
          ],
        },
        {
          type: "steps",
          title: "Modifier ou supprimer",
          items: [
            "Touche le kit pour l’ouvrir, puis **Modifier**.",
            "Change le nom, les notes ou les éléments et touche **Enregistrer**.",
            "Pour supprimer, touche **Supprimer le kit**, puis touche encore (**Touchez encore pour supprimer le kit**). Les éléments restent dans le stock.",
          ],
        },
        {
          type: "list",
          title: "La page du kit",
          items: [
            "Compteurs : **Éléments**, **Étuis** et **Prêt**.",
            "**Prochain concert avec ce kit**, et un avertissement quand des éléments sont en entretien ou perdus.",
            "La liste des éléments avec leur statut.",
            "**Utiliser pour un concert** ([[kit-for-a-gig]]).",
          ],
        },
        {
          type: "roles",
          rows: [
            { role: "admin", text: "Crée, modifie, supprime et utilise les kits." },
            { role: "member", text: "Voit les kits, leurs éléments et leur état de préparation, sans boutons de modification." },
          ],
        },
      ],
    },
    {
      id: "kit-for-a-gig",
      title: "Utiliser un kit pour un concert",
      summary: "Associe un kit à un concert pour que le groupe sache ce qui part dans le van.",
      roles: ["admin", "member"],
      kind: "task",
      keywords: ["attribuer du matériel", "matériel du concert", "kit pour un concert", "choisir un kit"],
      related: ["gear-kits", "gig-workspace", "gear-status"],
      body: [
        {
          type: "steps",
          title: "Depuis le concert",
          items: [
            "Ouvre le concert. Dans la section **KIT MATÉRIEL**, touche **CHOISIR UN KIT** (ou **CHANGER** s’il y en a déjà un).",
            "Dans **Kit pour ce concert**, touche **Ajouter le kit** à côté de chaque kit nécessaire. Touche **Kit ajouté** pour en retirer un.",
            "Touche **OK**.",
          ],
        },
        {
          type: "steps",
          title: "Depuis le kit",
          items: [
            "Ouvre le kit et touche **Utiliser pour un concert**.",
            "Touche **Ajouter le kit** à côté de chaque concert à venir. Touche **OK**.",
          ],
        },
        { type: "p", text: "Le concert affiche alors le kit avec ses éléments et « Toutes prêtes » ou combien sont à vérifier. Le kit affiche son prochain concert." },
        {
          type: "roles",
          rows: [
            { role: "admin", text: "Choisit et change les kits des concerts du groupe à venir." },
            { role: "member", text: "Voit le kit du concert et son état de préparation, sans le bouton CHOISIR UN KIT." },
          ],
        },
        { type: "note", tone: "tip", text: "Les kits sont pour les concerts du groupe : les répétitions, les devis et les concerts perso n’ont pas de section KIT MATÉRIEL. Utiliser un kit ne change pas le statut des éléments." },
        { type: "devices", rows: [{ devices: ["tablet"], text: "La section KIT MATÉRIEL se trouve dans l’onglet fiche technique du concert." }] },
      ],
    },

    // ── Privacy reference ────────────────────────────────────────────────
    {
      id: "who-sees-what",
      title: "Qui voit quoi",
      summary: "Chaque type de données du groupe, et ce que les admins, les membres et les remplaçants peuvent lire ou modifier.",
      roles: ["admin", "member", "deputy"],
      kind: "reference",
      keywords: ["confidentialité", "autorisations", "visibilité", "cachets", "qui peut voir", "rôles"],
      related: ["member-roles", "deputies", "member-detail", "add-gear"],
      body: [
        { type: "p", text: "L’argent, les prix des devis, les contrats et les cachets des autres sont protégés par le serveur, pas seulement masqués dans l’app : le téléphone d’un membre ne les reçoit jamais." },
        {
          type: "table",
          head: ["Données", "Admin", "Membre"],
          rows: [
            ["Détails du concert (date, horaires, salle, adresse, tenue, notes, fiche technique et plan de scène)", "Tout, plus le client, le prix du concert, l’acompte, le statut de paiement, les notes internes et le contrat", "La logistique des concerts qu’il joue et n’a pas refusés. Jamais le client, le prix, l’acompte, les notes internes ni le contrat"],
            ["Line-up du concert et réponses", "Tout le monde, avec les cachets et les paiements", "Qui joue et leurs réponses, sans les cachets"],
            ["Son propre cachet", "Oui", "Oui : son cachet par concert, payé ou non, son cachet habituel, et son propre **Payé · …**"],
            ["Les cachets des autres", "Oui, pour chaque membre et remplaçant", "Non"],
            ["Devis et totaux des devis", "Oui : créer, envoyer et tout voir", "Non. La vérification de disponibilité d’un devis n’affiche que la date"],
            ["Finances, paiements et statistiques du groupe", "Oui", "Non. Seulement ses propres revenus"],
            ["Tarifs, infos bancaires et fiscales", "Oui", "Non"],
            ["Setlists", "Créer, modifier, associer aux concerts", "Lecture seule"],
            ["Répertoire (morceaux, paroles, accords)", "Ajouter, modifier, supprimer, importer", "Lecture ; suggérer des morceaux et des modifications ; notes et fichiers privés que lui seul voit"],
            ["Contrats et fiches techniques", "Oui", "Pas de contrats. Le concert affiche la version de la fiche technique et le plan de scène"],
            ["Chat", "Discussion du groupe, discussions des concerts, discussions privées avec tout le groupe", "Discussion du groupe, discussions des concerts qu’il joue, discussions privées seulement avec les admins"],
            ["Matériel et kits", "Voir et modifier tout", "Voir chaque élément, son statut et son emplacement ; numéro de série, date et prix d’achat seulement sur son propre matériel perso ; modifier seulement son propre matériel perso"],
            ["Coordonnées des membres", "E-mail et téléphone de tout le groupe", "E-mail et téléphone de tout le groupe"],
            ["Liste des remplaçants et demandes", "Oui : coordonnées, cachets habituels, notes, réponses", "Non"],
            ["Concerts perso et notes privées sur les morceaux", "Seulement les siens", "Seulement les siens"],
          ],
        },
        {
          type: "table",
          head: ["Données", "Remplaçant"],
          rows: [
            ["Détails du concert", "Seulement pour les concerts qu’on lui a demandé de jouer : nom du groupe, titre, date, horaires d’installation, de balance et de concert, salle et ville. L’adresse seulement après un oui"],
            ["Son propre cachet", "Le cachet proposé dans chaque demande"],
            ["Autres cachets, devis, finances, tarifs", "Non"],
            ["Line-up, setlists, répertoire, contrats, chat, matériel", "Non"],
            ["Coordonnées des membres", "Non"],
            ["Infos de remplaçant", "Ses propres demandes et le nom que le groupe a enregistré pour lui"],
          ],
        },
        { type: "note", tone: "privacy", text: "Les membres et les remplaçants ne voient que leur propre cachet et la logistique. Ils ne voient jamais les cachets des autres, les totaux des devis ni les finances du groupe." },
        { type: "note", tone: "tip", text: "Les concerts perso d’un membre (ceux hors de tout groupe) sont privés : lui seul les voit. Les groupes n’en voient jamais le titre, la salle ni l’heure." },
      ],
    },
  ],

  faq: [
    { q: "Les membres voient-ils combien les autres sont payés ?", a: "Non. Un membre ne voit que son propre cachet sur chaque concert et ses propres totaux annuels. Les admins voient ceux de tout le monde." },
    { q: "Comment quitter un groupe ?", a: "Sur **Membres du groupe**, touche **⋯** sur ta propre ligne, puis **Quitter le groupe**. Un admin peut partir tant que le groupe a un autre admin. Voir [[leave-a-band]].", roles: ["admin", "member"] },
    { q: "Pourquoi je ne peux pas retirer le dernier admin ?", a: "Chaque groupe a besoin d’au moins un admin. Nomme d’abord quelqu’un d’autre admin, puis change ou retire le premier.", roles: ["admin"] },
    { q: "Combien de temps une invitation est-elle valable ?", a: "7 jours. L’adresse invitée reçoit un rappel quand il reste 2 jours. Inviter de nouveau la même adresse la renouvelle.", roles: ["admin"] },
    { q: "La personne que j’ai invitée dit que l’invitation ne marche pas.", a: "Elle doit se connecter avec exactement l’adresse e-mail que tu as invitée. Si l’invitation a expiré, invite-la de nouveau.", roles: ["admin"] },
    { q: "Un remplaçant a-t-il besoin de l’app ?", a: "Non. Le lien de la demande ouvre une page web où il répond d’un toucher. Avec l’app, il reçoit des notifications et voit toutes ses demandes dans Dates de remplaçant." },
    { q: "Un remplaçant peut-il voir le prix du concert ou le client ?", a: "Non. Un remplaçant ne voit que la logistique, son rôle et le cachet qu’on lui propose. L’adresse apparaît après son oui." },
    { q: "La mauvaise personne a ouvert un lien de remplaçant. Que faire ?", a: "Ouvre le remplaçant sur Membres du groupe, touche Dissocier le compte et confirme. Tous les anciens liens cessent de fonctionner ; envoie la prochaine demande par message.", roles: ["admin"] },
    { q: "Les membres peuvent-ils ajouter du matériel ?", a: "Oui, leur propre matériel perso avec Ajouter mon matériel. Ils ne peuvent modifier ou supprimer que celui-là. Le matériel du groupe est géré par les admins.", roles: ["member"] },
    { q: "Les membres voient-ils les remplaçants ?", a: "Non. La liste des remplaçants et les demandes sont réservées aux admins." },
    { q: "Où changer le logo du groupe ?", a: "Espace compte, carte du groupe actuel, Modifier, Logo du groupe. Il apparaît aussi sur tes PDF de devis.", roles: ["admin"] },
    { q: "Où régler le cachet habituel d’un membre ?", a: "Sur **Membres du groupe**, touche la personne, puis **Dans le groupe** : **Cachet habituel** et **Enregistrer**. Il s’applique aux nouveaux concerts.", roles: ["admin"] },
  ],

  glossary: [
    { term: "Admin", definition: "Une personne qui gère le groupe : concerts, argent, setlists, membres et réglages. Un groupe peut en avoir plusieurs et en a besoin d’au moins un.", see: "member-roles" },
    { term: "Membre", definition: "Une personne du groupe qui voit ses concerts, sa logistique et son propre cachet, mais ne le gère pas.", see: "member-roles" },
    { term: "Code d’invitation", definition: "Le code d’une invitation de groupe. Colle-le, ou ouvre le lien d’invitation, pour rejoindre le groupe.", see: "accept-an-invite" },
    { term: "Remplaçant", definition: "Un musicien hors du groupe qui joue à la place d’un membre indisponible. On dit aussi « dep » ou « sub ».", see: "deputies" },
    { term: "Lien de réponse", definition: "Le lien privé d’une demande de remplacement. Il ouvre une page web où le remplaçant répond sans compte.", see: "deputy-reply-page" },
    { term: "Sur BandWith", definition: "Un remplaçant dont le compte BandWith est relié à sa fiche dans le groupe. Le groupe peut le solliciter dans l’app.", see: "deputy-in-the-app" },
    { term: "Dates de remplaçant", definition: "L’écran où un remplaçant voit toutes les demandes des groupes qui l’appellent, et y répond.", see: "deputy-gigs" },
    { term: "Dissocier", definition: "Retirer le compte relié d’un remplaçant. Tous ses anciens liens cessent de fonctionner.", see: "unlink-a-deputy" },
    { term: "Qui remplace qui", definition: "La carte de la liste des remplaçants qui affiche, pour chaque instrument, les membres et les remplaçants qui le jouent.", see: "add-a-deputy" },
    { term: "Matériel perso", definition: "Du matériel qu’un membre ajoute à son nom. Tout le groupe le voit ; seuls le propriétaire et les admins le modifient.", see: "add-gear" },
    { term: "Kit", definition: "Un ensemble nommé d’éléments du stock que tu emportes pour un type de concert, comme une sono de club.", see: "gear-kits" },
    { term: "Prêt", definition: "Un élément de kit qui peut partir en concert : dispo ou utilisé, ni en entretien ni perdu.", see: "gear-status" },
  ],
};

export default people;
