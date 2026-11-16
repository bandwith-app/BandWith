import type { AreaText } from '../../types';

const together: AreaText = {
  area: {
    id: "together",
    title: "Répétitions, sondages et chat",
    intro: "Planifie des répétitions, trouve une date qui convient à tout le groupe et discutez ensemble dans les chats de groupe, d’événement et privés.",
    icon: "chat",
  },

  articles: [
    // ───────────────────────────── Rehearsals ─────────────────────────────
    {
      id: "create-a-rehearsal",
      title: "Créer une répétition",
      summary: "Planifie directement une répétition : qui vient, quand, où, combien ça coûte et ce qu’on travaille.",
      roles: ["admin"],
      kind: "task",
      keywords: ["nouvelle répétition", "planifier une répétition", "répète", "répétition du groupe", "séance"],
      related: ["rehearsal-songs-and-prep-tasks", "create-a-rehearsal-poll", "propose-a-rehearsal", "recurring-rehearsals", "rehearsal-drafts"],
      body: [
        {
          type: "p",
          text: "Les admins planifient directement une répétition quand ils connaissent déjà la date. Si tu veux d’abord savoir quand chacun est libre, lance plutôt un sondage de disponibilités : voir [[create-a-rehearsal-poll]].",
        },
        {
          type: "steps",
          title: "Sur un téléphone",
          items: [
            "Touche **Créer** (le bouton + dans la barre du bas) et choisis **Répétition**. Tu peux aussi ouvrir le **Calendrier**, toucher un jour vide et choisir **Répétition**.",
            "Laisse **Mode de planification** sur **Planifier**.",
            "Saisis si tu veux un **Titre de la répétition (facultatif)**. Sans titre, la répétition prend le nom de son type de séance, par exemple « Répétition groupe complet ».",
            "Choisis un **Type de séance** : **Groupe complet**, **Voix**, **Rythmique**, **Acoustique** ou **Autre**. Voix, Rythmique et Acoustique présélectionnent les membres dont l’instrument correspond ; Autre ouvre tout l’effectif.",
            "Vérifie l’**Effectif**. Touche un membre pour l’ajouter ou le retirer, ou touche **Tout sélectionner**. Touche **Suivant**.",
            "Sous **Cherche une salle ou un studio…**, saisis le lieu, ou touche un choix rapide comme **QG du groupe**, **Studio A**, **Home studio** ou **À déf.**.",
            "Règle la **Date de répétition**, le **Début** et la **Fin**.",
            "Choisis une **Récurrence** : **Une fois**, **Hebdo**, **2 semaines** ou **Mensuel**.",
            "Sous **Coût de la salle**, choisis **Gratuit** ou **Payé**. Pour une salle payante, saisis le **Coût total du studio** : la carte affiche le montant **Par personne**. Touche **Suivant**.",
            "Sur **VÉRIFIER ET CONFIRMER**, vérifie le résumé. Touche **Séance et effectif** ou **Date et studio** pour revenir changer quelque chose.",
            "Ajoute si tu veux des morceaux et des tâches de préparation (voir [[rehearsal-songs-and-prep-tasks]]).",
            "Touche **Créer la répétition**.",
          ],
        },
        {
          type: "note",
          tone: "tip",
          text: "**Suivant** reste désactivé à la deuxième étape tant que la répétition n’a ni lieu ni date. Choisis **À déf.** si tu n’as pas encore réservé de salle.",
        },
        {
          type: "note",
          tone: "tip",
          text: "Sans connexion, la répétition est gardée sur ton appareil (« Enregistré hors ligne • Synchro dès la connexion ») et envoyée dès que tu es de nouveau en ligne.",
        },
        {
          type: "p",
          text: "Chaque membre de l’effectif reçoit une notification « Nouvelle répétition » et un push, et la répétition apparaît dans son calendrier avec une carte **Tu viens ?** (voir [[answer-a-rehearsal-invite]]). Tu es marqué présent.",
        },
        {
          type: "devices",
          rows: [
            {
              devices: ["tablet"],
              text: "Sur iPad, l’assistant tient sur un seul écran avec quatre cartes : **Session**, **Date et heure**, **Lieu et coût** et **Objectifs, note et tâches**, plus un **Aperçu en direct** « Tel que le groupe le voit ». La bande des dates affiche **7 prochains jours** avec le nombre de membres libres chaque jour **Des agendas du groupe**. Tu peux aussi écrire un **Objectif / notes (facultatif)** pour le groupe. Touche **Planifier la répétition** quand le compteur des cartes est complet.",
            },
            {
              devices: ["duoClosed", "duoBook", "duoLaptop", "duoLand"],
              text: "Sur iPhone Duo, c’est l’assistant du téléphone qui est utilisé. Les commandes de fermeture et de retour passent dans le rail latéral quand il est affiché.",
            },
          ],
        },
        { type: "shot", id: "shot-rehearsal-wizard", caption: "L’assistant de répétition, étape 1 : type de séance et effectif." },
        {
          type: "roles",
          rows: [
            { role: "admin", text: "Crée, modifie et supprime les répétitions." },
            { role: "member", text: "Ne peut pas créer de répétition. Le même menu **Créer** propose **Proposer une répétition** à la place : voir [[propose-a-rehearsal]]." },
            { role: "deputy", text: "Les remplaçants ne sont pas membres du groupe et ne voient jamais l’assistant de répétition." },
          ],
        },
      ],
    },
    {
      id: "rehearsal-songs-and-prep-tasks",
      title: "Ajouter des morceaux et des tâches de préparation à une répétition",
      summary: "Choisis les morceaux à travailler et ce que chacun doit préparer avant la répétition.",
      roles: ["admin"],
      kind: "task",
      keywords: ["morceaux à travailler", "setlist de répétition", "tâches", "à faire", "préparer", "apporter"],
      related: ["create-a-rehearsal", "edit-a-rehearsal", "the-rehearsal-page", "todo-and-task-templates"],
      body: [
        {
          type: "p",
          text: "Les morceaux et les tâches s’ajoutent à la dernière étape de l’assistant (**VÉRIFIER ET CONFIRMER**) ou plus tard depuis [[edit-a-rehearsal]]. Les morceaux deviennent la setlist de la répétition, que les membres voient sous **MORCEAUX À BOSSER** sur la page de la répétition.",
        },
        {
          type: "steps",
          title: "Morceaux",
          items: [
            "Dans la carte **Setlist**, touche **Ajouter morceaux** et choisis des morceaux de ton répertoire.",
            "Ou touche **Modèle de setlist** pour partir de l’une des setlists enregistrées du groupe. Dans l’éditeur de setlist, tu peux chercher dans la bibliothèque, ajouter un morceau à la main (**Manuel** : **Titre du morceau \\*** et **Artiste**), puis toucher **OK**.",
            "Pour retirer un morceau, touche le X à côté sous **Morceaux choisis**.",
          ],
        },
        {
          type: "steps",
          title: "Tâches de préparation",
          items: [
            "Dans la carte **Préparation**, touche une suggestion d’**Ajout rapide** comme **Apporter les grilles** ou **Enregistrer l’audio**.",
            "Ou saisis ta propre tâche sous **Nouvelle tâche** et touche **Ajouter**.",
            "Retire une tâche avec le X à côté sous **Tâches du groupe**.",
          ],
        },
        {
          type: "p",
          text: "Quand tu modifies une répétition, la section **Matériel et tâches** propose aussi **Ajouter une tâche** et **Charger un modèle**, qui ajoute toutes les tâches d’un modèle de liste de tâches enregistré. Voir [[todo-and-task-templates]].",
        },
        {
          type: "note",
          tone: "privacy",
          text: "Seuls les admins choisissent et modifient la setlist de la répétition. Les membres peuvent l’ouvrir depuis **MORCEAUX À BOSSER** mais pas la modifier.",
        },
      ],
    },
    {
      id: "edit-a-rehearsal",
      title: "Modifier une répétition",
      summary: "Change la date, la salle, l’effectif, le coût, la setlist ou les tâches d’une répétition déjà planifiée.",
      roles: ["admin"],
      kind: "task",
      keywords: ["changer la répétition", "déplacer la répétition", "reprogrammer", "mettre à jour la répétition"],
      related: ["create-a-rehearsal", "delete-a-rehearsal", "rehearsal-and-chat-notifications"],
      body: [
        {
          type: "steps",
          items: [
            "Ouvre la répétition depuis le **Calendrier** ou l’accueil.",
            "En bas de la répétition, touche **MODIFIER**.",
            "Ouvre la section à changer : **Séance et récurrence**, **Date, heure et studio**, **Coût du studio**, **Effectif**, **Setlist** ou **Matériel et tâches**. Un bandeau en haut indique les champs à compléter.",
            "Touche **Enregistrer**. Le bouton reste désactivé tant que la répétition n’a pas de lieu.",
          ],
        },
        {
          type: "p",
          text: "Si tu touches **Annuler** avec des modifications non enregistrées, BandWith demande **Enregistrer les modifications ?** et te laisse enregistrer, abandonner ou continuer à modifier.",
        },
        {
          type: "list",
          title: "Qui est prévenu",
          items: [
            "Une nouvelle date, de nouveaux horaires ou un nouveau lieu envoient une notification « Répétition modifiée » et un push aux personnes de la répétition.",
            "Les membres que tu ajoutes à l’effectif reçoivent l’invitation « Nouvelle répétition ».",
          ],
        },
        {
          type: "note",
          tone: "tip",
          text: "La modification passe toujours par l’éditeur pas à pas, y compris sur iPad.",
        },
      ],
    },
    {
      id: "delete-a-rehearsal",
      title: "Supprimer (annuler) une répétition",
      summary: "Retire une répétition du calendrier ; toutes les personnes concernées sont prévenues.",
      roles: ["admin"],
      kind: "task",
      keywords: ["annuler la répétition", "supprimer la répétition"],
      related: ["edit-a-rehearsal", "recurring-rehearsals"],
      body: [
        {
          type: "steps",
          items: [
            "Ouvre la répétition.",
            "Touche **SUPPRIMER** sous **MODIFIER** et **CHAT RÉPÉTITION**.",
            "Touche **Oui, supprimer**, ou **ANNULER** pour la garder.",
          ],
        },
        {
          type: "note",
          tone: "warning",
          text: "La suppression est irréversible. Une répétition récurrente est un seul événement : la supprimer retire toutes les dates de la série.",
        },
        {
          type: "p",
          text: "Les membres de la répétition reçoivent une notification « Répétition annulée » et un push. S’ils l’ouvrent depuis une ancienne notification, ils voient **Répétition annulée** et une note indiquant qu’un admin l’a supprimée.",
        },
      ],
    },
    {
      id: "rehearsal-drafts",
      title: "Enregistrer une répétition comme brouillon",
      summary: "Quitte l’assistant en cours de route et termine la répétition plus tard.",
      roles: ["admin"],
      kind: "task",
      keywords: ["brouillon", "inachevé", "enregistrer pour plus tard"],
      related: ["create-a-rehearsal"],
      body: [
        {
          type: "steps",
          items: [
            "Dans l’assistant, touche **Annuler** ou le bouton de fermeture après avoir saisi quelque chose.",
            "Dans **Enregistrer cette répétition comme brouillon ?**, touche **Enregistrer le brouillon**. **Abandonner** l’efface, **Continuer à modifier** te ramène à l’assistant.",
            "Pour la terminer, ouvre le brouillon depuis Brouillons sur l’accueil, ou depuis son jour dans le calendrier.",
            "Pour jeter un brouillon que tu as rouvert, ferme l’assistant et touche **Supprimer le brouillon**.",
          ],
        },
        {
          type: "note",
          tone: "privacy",
          text: "Toi seul vois tes brouillons. Les membres ne reçoivent rien tant que tu n’as pas créé la répétition.",
        },
        {
          type: "p",
          text: "Si l’enregistrement échoue, l’assistant reste ouvert et la répétition est aussi gardée en brouillon : rien de ce que tu as saisi n’est perdu.",
        },
        {
          type: "devices",
          rows: [{ devices: ["tablet"], text: "Sur iPad, l’éditeur sur un seul écran a son propre bouton d’enregistrement en brouillon dans l’en-tête." }],
        },
      ],
    },
    {
      id: "recurring-rehearsals",
      title: "Répétitions récurrentes",
      summary: "Comment les répétitions hebdomadaires, toutes les deux semaines et mensuelles s’affichent et se comportent.",
      roles: ["admin", "member"],
      kind: "reference",
      keywords: ["répétition hebdomadaire", "répéter", "chaque semaine", "série", "toutes les deux semaines", "mensuelle"],
      related: ["create-a-rehearsal", "delete-a-rehearsal", "answer-a-rehearsal-invite"],
      body: [
        {
          type: "p",
          text: "Quand tu choisis une **Récurrence** autre que **Une fois**, BandWith enregistre une seule répétition avec une règle de répétition. Les prochaines dates s’affichent dans le calendrier sur environ quatre mois, jusqu’à 24 dates.",
        },
        {
          type: "table",
          head: ["Récurrence", "Affiché sur la répétition"],
          rows: [
            ["Une fois", "UNIQUE"],
            ["Hebdo", "CHAQUE {day}, par exemple CHAQUE MARDI"],
            ["2 semaines", "UN {day} SUR DEUX"],
            ["Mensuel", "MENSUEL"],
          ],
        },
        {
          type: "note",
          tone: "warning",
          text: "Toutes les dates d’une série partagent la même répétition : un seul effectif, une seule réponse par membre, une seule setlist. La modifier ou la supprimer change toutes les dates.",
        },
      ],
    },
    {
      id: "the-rehearsal-page",
      title: "La page de la répétition",
      summary: "Ce qu’une répétition montre aux admins et aux membres.",
      roles: ["admin", "member"],
      kind: "reference",
      keywords: ["détail de la répétition", "présences", "coût du studio", "morceaux à travailler"],
      related: ["answer-a-rehearsal-invite", "edit-a-rehearsal", "event-and-rehearsal-chats", "rehearsal-songs-and-prep-tasks"],
      body: [
        {
          type: "p",
          text: "Ouvre une répétition depuis le **Calendrier** ou l’accueil. Sa page est bleue, la couleur des répétitions, et comprend ces parties :",
        },
        {
          type: "list",
          items: [
            "**Tu viens ?** : la carte de réponse pour les membres invités (voir [[answer-a-rehearsal-invite]]).",
            "Tuiles horaires : **DÉBUT**, **FIN** et **SALLE**.",
            "**PRÉSENCES** : qui est invité et ce qu’il a répondu.",
            "**MORCEAUX À BOSSER** : jusqu’à huit morceaux, avec **+ {count} AUTRES** et **SETLIST** pour voir toute la liste.",
            "**NOTES** : la note de la répétition, s’il y en a une.",
            "**TÂCHES** : les tâches de préparation et combien sont faites. Touche une tâche pour la cocher.",
            "**COÛT DU STUDIO** : la salle, les heures, le total et **Partagé entre {count} présents**, avec le montant **CHACUN**.",
            "Boutons en bas : **MODIFIER**, **CHAT RÉPÉTITION** et **SUPPRIMER** pour les admins ; **CHAT RÉPÉTITION** pour les membres qui ont répondu présent.",
          ],
        },
        {
          type: "roles",
          rows: [
            { role: "admin", text: "Voit tout ce qui précède, y compris **COÛT DU STUDIO**, et peut modifier ou supprimer la répétition." },
            { role: "member", text: "Ne voit la répétition que si l’admin l’a mis dans l’effectif. Voit les horaires, la salle, les présences, les morceaux à travailler, les notes et les tâches. La section du coût du studio n’est pas montrée aux membres. Pour se retirer, c’est dans le menu **Plus d’options**." },
            { role: "deputy", text: "Les remplaçants sont sollicités pour des concerts, pas pour des répétitions, et ne voient pas les répétitions du groupe." },
          ],
        },
        {
          type: "note",
          tone: "privacy",
          text: "Le coût total de la salle, c’est de l’argent du groupe : il reste réservé aux admins. Pendant un sondage, les membres ne voient que leur part (« 12 € chacun »).",
        },
      ],
    },
    {
      id: "answer-a-rehearsal-invite",
      title: "Répondre à une invitation de répétition ou se retirer",
      summary: "Dis à l’admin si tu viens, change ta réponse, ou retire-toi plus tard.",
      roles: ["member"],
      kind: "task",
      keywords: ["répondre", "présent", "absent", "refuser la répétition", "se retirer"],
      related: ["the-rehearsal-page", "rehearsal-and-chat-notifications"],
      body: [
        {
          type: "steps",
          title: "Répondre",
          items: [
            "Ouvre la répétition depuis la notification « Nouvelle répétition » ou depuis le **Calendrier**.",
            "Sur la carte **Tu viens ?**, touche **PRÉSENT** ou **ABSENT**. La carte indique avant quand répondre (« Réponds d’ici le … pour que l’admin puisse confirmer la salle. »).",
            "Pour changer plus tard, touche **Changer** sur la carte **Ta réponse** et choisis de nouveau.",
            "Si tu avais répondu peut-être, la carte affiche « Ta réponse était Peut-être. Choisis PRÉSENT ou ABSENT. » : choisis l’une des deux.",
          ],
        },
        {
          type: "steps",
          title: "Se retirer",
          items: [
            "Ouvre la répétition et touche **Plus d’options** (le bouton … en haut).",
            "Dans **Options de répétition**, touche **Me retirer de cette répétition**.",
            "Confirme avec **JE ME RETIRE**. L’admin est prévenu.",
          ],
        },
        {
          type: "note",
          tone: "warning",
          text: "Après avoir répondu **ABSENT** ou t’être retiré, la répétition quitte ton calendrier. Demande à un admin si tu veux être rajouté.",
        },
        {
          type: "devices",
          rows: [{ devices: ["duoClosed", "duoBook", "duoLand"], text: "Sur iPhone Duo, **Plus d’options** se trouve dans le rail latéral avec les autres actions de l’en-tête." }],
        },
      ],
    },
    {
      id: "propose-a-rehearsal",
      title: "Proposer une répétition (membres)",
      summary: "Demande à l’admin une répétition sur un thème, avec les jours qui t’arrangent.",
      roles: ["member"],
      kind: "task",
      keywords: ["demander une répétition", "suggérer une répétition", "proposition de membre", "demande de répétition"],
      related: ["handle-a-rehearsal-proposal", "rehearsal-polls-explained"],
      body: [
        {
          type: "steps",
          items: [
            "Touche **Créer** (le + dans la barre du bas) et choisis **Proposer une répétition**. Dans un **Calendrier** vide, tu peux aussi toucher **Proposer une répétition**.",
            "Si tu fais partie de plusieurs groupes, choisis le groupe dans **Choisir le groupe**.",
            "Saisis un **Thème**, par exemple « Travailler les enchaînements de la nouvelle setlist ». Il est obligatoire.",
            "Touche si tu veux les **Jours préférés (facultatif)** qui t’arrangent.",
            "Ajoute si tu veux des **Notes ou morceaux (facultatif)**.",
            "Touche **Envoyer à l’admin**.",
          ],
        },
        {
          type: "p",
          text: "Les admins du groupe reçoivent une notification « Nouvelle proposition de répétition » et un push. Sur ton accueil et dans le **Calendrier**, la proposition apparaît comme **Ta proposition de répétition** avec **Attente admin** et **Ouverte jusqu’au** son dernier jour : le dernier de tes jours préférés dans la semaine qui suit, ou 7 jours sans jour choisi. Elle reste jusqu’à ce qu’un admin en fasse un sondage ou la refuse, ou que ce jour passe : elle quitte alors toutes les listes.",
        },
        {
          type: "note",
          tone: "warning",
          text: "Tu peux envoyer une proposition tous les 7 jours par groupe. Une fois utilisée, l’écran affiche **Limite hebdomadaire atteinte** et la date de **Prochaine proposition possible**. La limite est aussi vérifiée par le serveur.",
        },
        {
          type: "list",
          title: "Cas particuliers",
          items: [
            "Pas encore dans un groupe : tu vois **Groupe requis**, avec **Créer un groupe**.",
            "Si un admin refuse ta proposition, tu reçois « Proposition de répétition refusée » (notification et push), avec le motif s’il en a donné un, et elle quitte ta liste.",
            "Tu as changé d’avis ? Touche **Retirer** sur ta proposition, puis de nouveau **Retirer** sur « Retirer ta proposition ? ». Les admins ne la voient plus.",
          ],
        },
        { type: "roles", rows: [{ role: "admin", text: "Les admins ne proposent pas : ils créent directement la répétition ou un sondage. Voir [[create-a-rehearsal]]." }] },
      ],
    },
    {
      id: "handle-a-rehearsal-proposal",
      title: "Traiter la proposition de répétition d’un membre",
      summary: "Transforme la proposition d’un membre en sondage de disponibilités, ou refuse-la.",
      roles: ["admin"],
      kind: "task",
      keywords: ["proposition", "créer un sondage", "refuser la proposition", "ignorer la proposition", "demande d’un membre"],
      related: ["propose-a-rehearsal", "create-a-rehearsal-poll"],
      body: [
        {
          type: "steps",
          items: [
            "Trouve la proposition sous **Planification des répétitions** dans la carte À traiter de l’accueil ou dans le **Calendrier**. Elle affiche **Proposition de répétition d’un membre**, **Proposée par**, les **Jours préférés** et la note. Tu peux aussi l’ouvrir depuis la notification « Nouvelle proposition de répétition ».",
            "Touche **Créer sondage** (dans la feuille de la notification : **Créer un sondage à partir de la proposition**). Le créateur de sondage s’ouvre avec le thème comme titre, la note, et les jours préférés présélectionnés.",
            "Ajoute des créneaux et publie comme dans [[create-a-rehearsal-poll]].",
            "Ou touche **Refuser** pour fermer la proposition sans sondage. Dans **Refuser cette proposition ?**, saisis si tu veux un **Motif**, puis touche **Refuser**. Le membre qui l’a proposée reçoit « Proposition de répétition refusée » (notification et push) avec ton motif.",
            "Si tu ne fais rien, la proposition quitte la liste après le jour indiqué dans **Ouverte jusqu’au**.",
          ],
        },
        {
          type: "note",
          tone: "tip",
          text: "La proposition d’un membre ne contient ni morceaux, ni lieu, ni coût. Ajoute-les dans le créateur avant de publier.",
        },
      ],
    },

    // ───────────────────────────── Polls ─────────────────────────────
    {
      id: "create-a-rehearsal-poll",
      title: "Créer un sondage de disponibilités",
      summary: "Propose quelques dates au groupe et laisse les membres voter pour celles qui leur conviennent.",
      roles: ["admin"],
      kind: "task",
      keywords: ["sondage", "vote", "disponibilités", "trouver une date", "doodle", "sondage de dates"],
      related: ["poll-who-votes-and-deadline", "vote-in-a-rehearsal-poll", "lock-in-a-poll-date", "rehearsal-polls-explained"],
      body: [
        {
          type: "steps",
          title: "Sur un téléphone",
          items: [
            "Touche **Créer** et choisis **Répétition**, puis passe **Mode de planification** sur **Sondage**. Le créateur de **Sondage de dispos** s’ouvre.",
            "Saisis un **Titre du sondage** et, si tu veux, un **Objectif / notes (facultatif)**.",
            "Sous **Qui vote**, touche un membre pour l’exclure. Tu votes toujours.",
            "Sous **Lieu, coût et morceaux**, remplis **Lieu / studio**, le **Coût de la salle** (le **Partage** montre la part de chacun) et les **Morceaux à travailler** (touche **Ajouter**).",
            "Ajoute des dates. Avec **Semaine entière**, choisis **Cette semaine** ou **Semaine pro**, touche les **Jours inclus**, règle **Début** et **Fin**, et touche **Ajouter les jours choisis au sondage**. Chaque jour indique combien de membres sont libres. Avec **Date / heure au choix**, choisis une **Date proposée**, un **Début** et une **Fin**, puis touche **Ajouter le créneau au sondage**.",
            "Vérifie les **Créneaux proposés**. Retires-en un avec **Retirer le créneau**, ou touche **Tout effacer**.",
            "Règle si tu veux **Voter avant le** : un jour et une heure (voir [[poll-who-votes-and-deadline]]).",
            "Touche **Publier le sondage**.",
          ],
        },
        {
          type: "p",
          text: "Chaque membre invité à voter reçoit une notification « Vote pour les horaires de répétition » et un push. Le sondage apparaît comme **Sondage · Actif** sur l’accueil et dans le **Calendrier** sous **Planification des répétitions**.",
        },
        {
          type: "list",
          title: "Ce qui empêche de publier",
          items: [
            "Pas de titre : « Donne un titre à ton sondage. »",
            "Pas de créneau : « Ajoute au moins un créneau pour que les membres votent. »",
            "Une date limite de vote après le premier créneau : « Choisissez un jour avant le premier créneau ».",
            "Le même jour et la même heure de début ajoutés deux fois : « Ce créneau est déjà ajouté. »",
          ],
        },
        {
          type: "devices",
          rows: [
            {
              devices: ["tablet"],
              text: "Sur iPad, le sondage est un éditeur sur un seul écran, **Répétition** avec « Sondage · les membres votent les dates ». Cartes : **Séance et effectif**, **Créneaux proposés** (une bande de la semaine colorée selon le nombre de membres libres ; touche un jour pour l’ajouter avec les horaires choisis), **Lieu, coût et morceaux** et **Date limite du vote et note**. Un **Aperçu en direct** montre les créneaux « Comme les membres votent », avec la **Favorite**.",
            },
          ],
        },
        { type: "shot", id: "shot-poll-builder", caption: "Le créateur de sondage de disponibilités sur un téléphone." },
        {
          type: "note",
          tone: "privacy",
          text: "Les décomptes de membres libres viennent des calendriers de chacun, mais seul le nombre s’affiche (« 4 sur 5 libres »), jamais qui est occupé ni pourquoi.",
        },
      ],
    },
    {
      id: "poll-who-votes-and-deadline",
      title: "Qui vote et la date limite du vote",
      summary: "Limite un sondage à certains membres et dis-leur quand répondre.",
      roles: ["admin", "member"],
      kind: "reference",
      keywords: ["liste des invités", "invités", "date limite", "voter avant", "qui vote"],
      related: ["create-a-rehearsal-poll", "vote-in-a-rehearsal-poll"],
      body: [
        {
          type: "p",
          text: "Par défaut, chaque membre actif est invité à voter. Quand tu exclus quelqu’un sous **Qui vote**, le sondage a une liste d’invités.",
        },
        {
          type: "list",
          items: [
            "Seuls les membres invités reçoivent la notification du sondage et peuvent voter. Les autres membres du groupe peuvent ouvrir le sondage en lecture seule, avec la mention **Non invité** ; le serveur refuse leurs votes.",
            "Les admins du groupe voient toujours le sondage. L’admin qui le publie fait toujours partie de la liste.",
            "Quand tu valides une date, seuls les membres invités (et toi) sont mis sur la répétition.",
            "La part du coût de la salle est divisée par le nombre de personnes invitées à voter.",
          ],
        },
        {
          type: "p",
          text: "**Voter avant le** est un jour entre aujourd’hui et le premier créneau proposé, plus une heure (18:00 sauf si tu la changes). Les membres voient « Vote avant le ven. 11 déc., 18:00 » dans le sondage.",
        },
        {
          type: "note",
          tone: "warning",
          text: "À l’heure limite, le vote se ferme : le sondage affiche **Vote clos** et « Le vote est clos. Un admin va valider une date. » Le serveur refuse les votes suivants. Les admins peuvent toujours valider une date.",
        },
      ],
    },
    {
      id: "vote-in-a-rehearsal-poll",
      title: "Voter dans un sondage de disponibilités",
      summary: "Touche les dates qui te vont, ou dis qu’aucune ne convient.",
      roles: ["member", "admin"],
      kind: "task",
      keywords: ["voter", "disponibilités", "choisir des dates", "aucune ne convient", "sondage"],
      related: ["poll-who-votes-and-deadline", "lock-in-a-poll-date", "rehearsal-polls-explained"],
      body: [
        {
          type: "steps",
          title: "Depuis la carte du sondage",
          items: [
            "Sur l’accueil (À traiter) ou dans le **Calendrier**, trouve la carte **Sondage · Actif**. Un badge indique **Vote**, **Voté** ou **Pas dispo**.",
            "Touche chaque case de date qui te va. Touche-la de nouveau pour retirer ton vote. Tu peux choisir plusieurs dates.",
            "Touche **Détails** pour voir chaque date avec « {count}/{total} dispos », la **Favorite** et qui a voté. Après ton vote, les détails se ferment tout seuls (« Fermeture dans …s ») ; touche **Garder ouvert** pour l’éviter.",
            "Si tu as voté et qu’au final aucune date ne te va, touche **Pas dispo** dans les détails.",
          ],
        },
        {
          type: "steps",
          title: "Depuis la notification",
          items: [
            "Touche le push « Vote pour les horaires de répétition », ou la notification dans la cloche, puis **Vote**.",
            "Dans **Dispos pour la répétition**, sous **Choisis les dates qui te vont**, touche les dates où tu peux venir.",
            "Touche **OK**. Si aucune date ne te va, touche plutôt **Pas dispo**.",
          ],
        },
        {
          type: "p",
          text: "**Pas dispo** efface tes votes et indique à l’admin qu’aucune date ne te convient : les admins voient « Aucune date ne convient à … ». Si tu votes ensuite pour une date, cette réponse est remplacée.",
        },
        {
          type: "list",
          title: "Ce que tu vois pendant le vote",
          items: [
            "Le lieu et ta part de la salle (« Blackbox Studios · 12 € chacun ») et les morceaux à travailler.",
            "« {answered} sur {total} ont répondu », et la date limite du vote s’il y en a une.",
            "Sous **Réponses**, qui a voté pour quelle date, dès que quelqu’un a voté.",
          ],
        },
        {
          type: "note",
          tone: "tip",
          text: "Les votes se mettent à jour en direct pour tout le monde. Sans connexion, le vote n’est pas enregistré et tu vois « Impossible d’enregistrer ton vote. Réessaie. »",
        },
        { type: "shot", id: "shot-poll-card", caption: "Un sondage actif sur l’accueil, avec ses cases de dates et ses détails." },
        {
          type: "devices",
          rows: [
            {
              devices: ["duoLaptop"],
              text: "En position ordinateur, la feuille de vote affiche les membres et les jours sur l’écran du haut, et tes cases de jours avec **Valider** et **OK** sur l’écran du bas.",
            },
          ],
        },
      ],
    },
    {
      id: "lock-in-a-poll-date",
      title: "Valider une date et créer la répétition",
      summary: "Choisis la date gagnante d’un sondage ; BandWith crée la répétition et prévient le groupe.",
      roles: ["admin"],
      kind: "task",
      keywords: ["finaliser le sondage", "confirmer la date", "clore le sondage", "valider", "date gagnante"],
      related: ["vote-in-a-rehearsal-poll", "the-rehearsal-page", "answer-a-rehearsal-invite"],
      body: [
        {
          type: "steps",
          items: [
            "Sur la carte du sondage, touche **Détails · Valider**. Dans la feuille de la notification, regarde sous **Réponses · Valide une date**.",
            "À côté de la date choisie (souvent la **Favorite**), touche **Valider**.",
            "Vérifie le **Lieu de la répétition**. Il reprend le lieu indiqué dans le sondage, ou « Local de répétition ».",
            "Touche **Confirmer et créer**.",
          ],
        },
        {
          type: "list",
          title: "Ce qui se passe",
          items: [
            "Une répétition confirmée est créée à cette date et à cette heure, avec le titre, le lieu et la note du sondage.",
            "Le coût de la salle devient le coût du studio de la répétition, et les morceaux à travailler deviennent sa setlist.",
            "Les membres invités sont mis sur la répétition et y répondent comme d’habitude ([[answer-a-rehearsal-invite]]). Tu es marqué présent.",
            "Le sondage est fermé et quitte À traiter. Les membres reçoivent une notification « Répétition confirmée » dans la cloche (sans push).",
          ],
        },
        {
          type: "note",
          tone: "tip",
          text: "Si un autre admin a validé le sondage juste avant toi, tu vois « Ce sondage a déjà été validé ou fermé. » et aucune deuxième répétition n’est créée.",
        },
      ],
    },
    {
      id: "delete-a-rehearsal-poll",
      title: "Supprimer un sondage",
      summary: "Retire un sondage avec toutes ses dates et tous ses votes.",
      roles: ["admin"],
      kind: "task",
      keywords: ["retirer le sondage", "annuler le sondage", "supprimer le sondage"],
      related: ["create-a-rehearsal-poll", "handle-a-rehearsal-proposal"],
      body: [
        {
          type: "steps",
          items: [
            "Ouvre **Détails · Valider** sur le sondage, ou ouvre-le depuis sa notification.",
            "Touche **Supprimer sondage**.",
            "Dans **Supprimer le sondage répétition ?**, touche de nouveau **Supprimer sondage**, ou **Annuler**.",
          ],
        },
        {
          type: "note",
          tone: "warning",
          text: "Toutes les dates proposées et tous les votes des membres sont supprimés définitivement. C’est irréversible, et les membres ne sont pas prévenus.",
        },
        {
          type: "p",
          text: "Pour fermer la proposition d’un membre qui n’a pas encore de sondage, utilise plutôt **Refuser** (voir [[handle-a-rehearsal-proposal]]).",
        },
      ],
    },
    {
      id: "rehearsal-polls-explained",
      title: "Comment fonctionnent les propositions et les sondages",
      summary: "Le parcours d’une demande de répétition, de l’idée d’un membre jusqu’à une date dans le calendrier.",
      roles: ["admin", "member"],
      kind: "reference",
      keywords: ["statut du sondage", "statut de la proposition", "planification des répétitions", "à traiter"],
      related: ["propose-a-rehearsal", "create-a-rehearsal-poll", "vote-in-a-rehearsal-poll", "lock-in-a-poll-date"],
      body: [
        {
          type: "table",
          head: ["Étape", "Ce que ça veut dire", "Qui la voit"],
          rows: [
            ["Proposition (**Attente admin**)", "Un membre a demandé une répétition.", "Le membre qui l’a proposée et les admins."],
            ["Sondage (**Sondage · Actif**)", "Un admin a publié des dates à voter.", "Les membres invités et les admins."],
            ["Confirmée (**Répétition · Confirmée**)", "Une date a été validée ; la répétition est dans le calendrier.", "Toutes les personnes de la répétition."],
            ["Refusée, expirée ou supprimée", "Fermée sans répétition (une proposition expire après le jour de **Ouverte jusqu’au**).", "Personne : elle quitte les listes."],
          ],
        },
        {
          type: "p",
          text: "Les propositions et sondages ouverts apparaissent sur l’accueil dans **À traiter** et en haut du **Calendrier** sous **Planification des répétitions (…)**. Dans le **Calendrier**, ils suivent le filtre de groupe.",
        },
        {
          type: "roles",
          rows: [
            { role: "admin", text: "Publie les sondages, transforme les propositions en sondages, valide les dates, refuse et supprime. N’importe quel admin du groupe peut le faire, pas seulement celui qui a publié." },
            { role: "member", text: "Propose (une fois par semaine), vote, répond **Pas dispo** et voit qui a voté pour quoi." },
            { role: "deputy", text: "Ne participe pas aux sondages du groupe." },
          ],
        },
        {
          type: "devices",
          rows: [
            {
              devices: ["duoLaptop"],
              text: "En position ordinateur, le « Bureau du groupe » de l’accueil liste les sondages où tu n’as pas voté et les propositions qui attendent un sondage ; touches-en un pour l’ouvrir.",
            },
          ],
        },
      ],
    },

    // ───────────────────────────── Chat ─────────────────────────────
    {
      id: "the-chat-inbox",
      title: "La liste des discussions",
      summary: "Toutes tes discussions de groupe, d’événement et privées dans une seule liste.",
      roles: ["admin", "member"],
      kind: "reference",
      keywords: ["messages", "boîte de réception", "liste des discussions", "non lus", "rechercher des messages", "chat"],
      related: ["start-a-chat", "send-and-reply-to-messages", "delete-a-chat", "who-can-message-whom"],
      body: [
        {
          type: "p",
          text: "Touche **Chat** dans la barre du bas. Le badge de l’onglet compte les messages non lus.",
        },
        {
          type: "list",
          items: [
            "Filtre avec **TOUT**, **PRIVÉS**, **GROUPES** ou **ÉVÉNEMENTS**. Chaque filtre affiche son propre nombre de non lus.",
            "Les discussions avec des messages non lus passent en premier. Une ligne affiche le nom (« · Groupe » pour la discussion du groupe), l’heure, le dernier message, et soit le nombre de non lus, soit les coches de ton dernier message.",
            "Si tu fais partie de deux groupes ou plus, une ligne indique aussi à quel groupe elle appartient.",
            "Un point vert sur une discussion privée veut dire que la personne est en ligne.",
            "Saisis au moins deux lettres dans **Rechercher…** pour trouver des discussions, des personnes et des mots dans les messages : les résultats sont regroupés en **DISCUSSIONS**, **PERSONNES** et **MESSAGES**. Touche **Effacer la recherche** pour revenir.",
            "Fais glisser une discussion vers la gauche pour la supprimer ([[delete-a-chat]]).",
            "Lance une nouvelle discussion avec le + (**Nouvelle discussion**) en haut ([[start-a-chat]]).",
          ],
        },
        { type: "shot", id: "shot-chat-inbox", caption: "La liste des discussions avec les filtres par type." },
        {
          type: "devices",
          rows: [
            { devices: ["tablet", "duoBook", "duoLand"], text: "La liste et la discussion ouverte sont côte à côte ; la discussion ouverte est surlignée dans la liste." },
            { devices: ["duoClosed", "duoBook", "duoLand"], text: "Sur iPhone Duo, le champ de recherche se trouve dans le rail latéral." },
          ],
        },
        {
          type: "note",
          tone: "tip",
          text: "En mode solo (sans groupe), il n’y a pas de chat : l’onglet **Chat** ouvre le calendrier.",
        },
      ],
    },
    {
      id: "start-a-chat",
      title: "Lancer une discussion",
      summary: "Ouvre la discussion du groupe, celle d’un événement ou un message privé.",
      roles: ["admin", "member"],
      kind: "task",
      keywords: ["nouvelle discussion", "écrire à quelqu’un", "message privé", "dm", "discussion du groupe"],
      related: ["who-can-message-whom", "event-and-rehearsal-chats", "the-chat-inbox"],
      body: [
        {
          type: "steps",
          items: [
            "Dans **Chat**, touche le + (**Nouvelle discussion**) en haut.",
            "Choisis le **Type de discussion** : **PRIVÉS**, **GROUPE** ou **ÉVÉNEMENT**.",
            "Cherche et choisis une personne (**Rechercher des admins…** ou **Rechercher des membres…**), un groupe (**Rechercher des groupes…**) ou un événement (**Rechercher des événements…**).",
            "Touche le bouton en bas : **Écrire à …** ou **Ouvrir la discussion …**.",
          ],
        },
        {
          type: "p",
          text: "Si la discussion existe déjà, BandWith l’ouvre au lieu d’en créer une deuxième. Un groupe a une seule discussion avec tous ses membres actifs ; un événement a une seule discussion avec sa formation.",
        },
        {
          type: "p",
          text: "Tu peux aussi écrire à quelqu’un depuis la liste des membres du groupe : ouvre le membre et touche le bouton message. Il n’apparaît que si l’un de vous deux est admin.",
        },
        {
          type: "roles",
          rows: [
            { role: "admin", text: "**PRIVÉS** liste tous les membres de tes groupes. **ÉVÉNEMENT** liste tous les événements des groupes que tu gères." },
            { role: "member", text: "**PRIVÉS** ne liste que les **Admins** du groupe (« Les messages privés sont limités aux admins du groupe. »). **ÉVÉNEMENT** ne liste que les événements où tu es prévu et que tu n’as pas refusés." },
          ],
        },
      ],
    },
    {
      id: "send-and-reply-to-messages",
      title: "Envoyer, répondre et mentionner",
      summary: "Écris des messages, réponds à un message précis, mentionne quelqu’un et lis les anciens messages.",
      roles: ["admin", "member"],
      kind: "task",
      keywords: ["envoyer un message", "répondre", "citer", "mention", "@", "anciens messages", "hors ligne"],
      related: ["message-receipts-and-online-status", "the-chat-inbox"],
      body: [
        {
          type: "steps",
          title: "Envoyer",
          items: [
            "Ouvre une discussion et touche **Écris un message…** en bas.",
            "Écris ton message et touche **Envoyer le message** (ou appuie sur Entrée sur un clavier).",
          ],
        },
        {
          type: "steps",
          title: "Répondre à un message",
          items: [
            "Sur un téléphone ou une tablette, fais glisser le message vers la droite. À la souris, survole-le et clique sur **Répondre au message**.",
            "La zone de saisie affiche **Réponse à …**. Écris et envoie. Touche **Annuler la réponse** pour arrêter.",
          ],
        },
        {
          type: "steps",
          title: "Mentionner quelqu’un",
          items: [
            "Tape @ et le début d’un nom.",
            "Touche la personne dans les suggestions (Entrée choisit la première). Les mentions s’affichent en gras.",
          ],
        },
        {
          type: "list",
          title: "Bon à savoir",
          items: [
            "Dans les discussions de groupe et d’événement, chaque message affiche le nom de l’expéditeur, avec « · Admin » pour les admins.",
            "La discussion charge les 50 derniers messages. Remonte et touche **Charger les messages précédents** pour en voir plus.",
            "Les messages sont du texte simple : pas de pièces jointes, de réactions, ni de modification ou suppression d’un seul message.",
            "Sans connexion, le message n’est pas envoyé et revient dans la zone de saisie avec « Message non envoyé. Vérifie ta connexion et réessaie. » Renvoie-le quand tu es en ligne.",
            "Une mention est mise en évidence pour tout le monde mais n’envoie pas de notification en plus : chaque personne de la discussion est déjà prévenue de chaque message.",
          ],
        },
        {
          type: "devices",
          rows: [{ devices: ["duoLaptop"], text: "En position ordinateur, les messages remplissent l’écran du haut et la zone de saisie s’ouvre sur l’écran du bas." }],
        },
      ],
    },
    {
      id: "event-and-rehearsal-chats",
      title: "Discussions d’événement et de répétition",
      summary: "Une discussion pour les personnes d’un concert ou d’une répétition, avec les horaires épinglés en haut.",
      roles: ["admin", "member"],
      kind: "reference",
      keywords: ["discussion d’événement", "chat du concert", "chat de répétition", "discussion de la formation", "bandeau de l’événement"],
      related: ["start-a-chat", "gig-workspace", "the-rehearsal-page"],
      body: [
        {
          type: "steps",
          title: "L’ouvrir",
          items: [
            "Ouvre le concert ou la répétition.",
            "Touche **CHAT ÉVÉNEMENT** (sur un concert) ou **CHAT RÉPÉTITION** (sur une répétition).",
          ],
        },
        {
          type: "p",
          text: "La discussion réunit la formation de l’événement (tous ceux qui n’ont pas refusé) et les admins du groupe. Les personnes ajoutées plus tard à la formation la rejoignent au prochain message envoyé.",
        },
        {
          type: "p",
          text: "Un bandeau en haut présente l’événement : titre, **Aujourd’hui** / **Demain** ou la date, **Arrivée …** (ou **Début …**) et le lieu, plus **Annulé** ou **Événement passé** le cas échéant. Touche-le pour ouvrir l’événement.",
        },
        {
          type: "note",
          tone: "privacy",
          text: "Le bandeau et le panneau latéral ne montrent que la logistique : horaires, lieu et statut. Jamais le cachet ni le client.",
        },
        {
          type: "roles",
          rows: [
            { role: "admin", text: "Peut ouvrir la discussion de n’importe quel événement du groupe." },
            { role: "member", text: "Ne voit le bouton de discussion qu’après avoir répondu présent. Les membres qui refusent perdent l’accès : « Tu ne peux écrire que dans les événements auxquels tu participes. »" },
          ],
        },
        {
          type: "devices",
          rows: [
            {
              devices: ["tablet", "duoBook", "duoLand"],
              text: "Avec deux volets (un iPad en paysage, ou un iPhone Duo ouvert), un panneau de contexte à côté du fil affiche les horaires (**Arrivée**, **Balance**, **Concert**, **Fin**), le lieu, le statut, **Dans ce chat · Formation …/…** et qui est en ligne, avec **Ouvrir le concert**.",
            },
          ],
        },
        { type: "shot", id: "shot-event-chat", caption: "Une discussion d’événement sur iPad, avec le bandeau de l’événement et le panneau de contexte." },
        {
          type: "note",
          tone: "tip",
          text: "Les concerts perso n’ont pas de discussion : « Les discussions d’événement sont disponibles pour les événements du groupe. »",
        },
      ],
    },
    {
      id: "who-can-message-whom",
      title: "Qui peut écrire à qui",
      summary: "Les règles du chat pour les admins, les membres et les remplaçants.",
      roles: ["admin", "member", "deputy"],
      kind: "reference",
      keywords: ["règles du chat", "autorisations", "messages limités", "impossible d’écrire"],
      related: ["start-a-chat", "event-and-rehearsal-chats"],
      body: [
        {
          type: "table",
          head: ["Discussion", "Admin", "Membre"],
          rows: [
            ["Discussion du groupe", "Oui, dans les groupes où tu es actif", "Oui, dans les groupes où tu es actif"],
            ["Discussion d’événement", "Tout événement de ton groupe", "Seulement les événements où tu es prévu et que tu n’as pas refusés"],
            ["Message privé", "Toute personne de tes groupes", "Seulement les admins d’un groupe en commun"],
          ],
        },
        {
          type: "p",
          text: "Deux membres ne peuvent pas s’écrire en privé ; ils se parlent dans la discussion du groupe ou de l’événement. Les règles sont vérifiées quand tu lances une discussion et à chaque envoi.",
        },
        {
          type: "p",
          text: "Quand une règle te bloque, la zone de saisie est remplacée par un cadenas avec la raison, par exemple « Les messages directs ne sont possibles qu’avec les admins du groupe. » ou « Tu n’as plus accès à cette discussion. » (après avoir quitté le groupe ou été retiré du concert).",
        },
        {
          type: "roles",
          rows: [
            { role: "deputy", text: "Les remplaçants ne sont pas membres du groupe : ils ne sont dans aucune discussion de groupe, d’événement ou privée. Le groupe les contacte par des demandes de remplacement (« Demander dans l’app »), et ils répondent dans Dates de remplaçant. Voir [[deputy-in-the-app]]." },
          ],
        },
        {
          type: "note",
          tone: "privacy",
          text: "Une discussion privée reste entre ses deux personnes. BandWith ne la réutilise jamais pour une conversation avec quelqu’un d’autre : personne d’autre ne peut lire cet historique.",
        },
      ],
    },
    {
      id: "message-receipts-and-online-status",
      title: "Coches, confirmations de lecture et statut en ligne",
      summary: "Ce que veulent dire l’horloge, la coche simple et les doubles coches.",
      roles: ["admin", "member"],
      kind: "reference",
      keywords: ["coches", "confirmation de lecture", "distribué", "vu", "en ligne"],
      related: ["send-and-reply-to-messages", "the-chat-inbox"],
      body: [
        {
          type: "table",
          head: ["Marque", "Signification"],
          rows: [
            ["Horloge (**Envoi**)", "Ton message est en route."],
            ["Une coche (**Envoyé**)", "Enregistré sur le serveur."],
            ["Deux coches grises (**Distribué**)", "Il est arrivé sur les téléphones des autres."],
            ["Deux coches colorées (**Lu**)", "Ils ont ouvert la discussion après ton message."],
          ],
        },
        {
          type: "p",
          text: "Dans les discussions de groupe et d’événement, les coches ne changent que quand tout le monde a reçu ou lu le message. Les personnes arrivées après l’envoi ne comptent pas.",
        },
        {
          type: "p",
          text: "L’en-tête d’une discussion privée affiche **En ligne** ou **Hors ligne**. Les discussions de groupe affichent « {count} membres · {count} en ligne ».",
        },
      ],
    },
    {
      id: "delete-a-chat",
      title: "Supprimer une discussion",
      summary: "Retire une discussion de ta liste et efface des messages définitivement.",
      roles: ["admin", "member"],
      kind: "task",
      keywords: ["supprimer la conversation", "vider la discussion", "retirer la discussion", "effacer les messages"],
      related: ["the-chat-inbox"],
      body: [
        {
          type: "steps",
          items: [
            "Dans la liste, fais glisser la discussion vers la gauche et touche le bouton de suppression. Ou ouvre la discussion et touche **Supprimer la discussion** (la corbeille) en haut à droite.",
            "Confirme avec **Supprimer**, ou touche **Annuler**.",
          ],
        },
        {
          type: "table",
          head: ["Discussion", "Ce qui est supprimé"],
          rows: [
            ["Discussion privée", "Tous les messages, pour vous deux."],
            ["Discussion de groupe ou d’événement", "Seulement tes propres messages, pour tout le monde. Les autres gardent le reste de la conversation."],
          ],
        },
        {
          type: "note",
          tone: "warning",
          text: "C’est irréversible. La discussion quitte ta liste jusqu’à l’arrivée d’un nouveau message ; elle revient alors avec les nouveaux messages seulement.",
        },
      ],
    },
    {
      id: "rehearsal-and-chat-notifications",
      title: "Notifications des répétitions, sondages et chat",
      summary: "Quelles actions préviennent qui, et lesquelles envoient aussi un push.",
      roles: ["admin", "member"],
      kind: "reference",
      keywords: ["push", "notification", "alertes", "cloche", "badge"],
      related: ["answer-a-rehearsal-invite", "vote-in-a-rehearsal-poll", "send-and-reply-to-messages"],
      body: [
        {
          type: "table",
          head: ["Quand", "Qui est prévenu", "Push"],
          rows: [
            ["Un membre propose une répétition", "Les admins du groupe", "Oui"],
            ["Un admin publie un sondage", "Les membres invités à voter", "Oui"],
            ["Une date est validée", "Les personnes mises sur la répétition", "Non, cloche seulement"],
            ["Une répétition est créée, ou tu y es ajouté", "Les membres invités", "Oui"],
            ["La date, l’heure ou le lieu change", "Les personnes de la répétition", "Oui"],
            ["Une répétition est supprimée", "Les personnes de la répétition", "Oui"],
            ["Un membre se retire ou répond", "L’admin qui l’a créée", "Oui pour un retrait"],
            ["Un nouveau message", "Tous les autres membres de la discussion", "Oui"],
          ],
        },
        {
          type: "list",
          items: [
            "Toucher une notification de sondage ouvre la feuille de vote ; une notification de répétition ouvre la répétition ; une notification de chat ouvre la discussion.",
            "Quand tu ouvres l’app avec un sondage ou une proposition non lus, BandWith l’affiche une fois dans une petite fenêtre.",
            "Aucun push n’arrive pour une discussion ouverte à l’écran. Ouvrir une discussion marque ses notifications comme lues.",
            "Si la notification concerne un autre de tes groupes, l’app te demande d’abord si tu veux changer de groupe.",
            "Coupe tous les push dans **Réglages** avec **Notifications push** (« Invitations aux concerts, sondages, messages »). La cloche garde toutes les notifications.",
          ],
        },
      ],
    },
  ],

  faq: [
    {
      q: "Un membre peut-il créer une répétition ?",
      a: "Non. Les membres touchent **Proposer une répétition** et les admins décident. Les admins la planifient directement ou lancent un sondage.",
      roles: ["member"],
    },
    {
      q: "Pourquoi je ne peux envoyer qu’une proposition de répétition par semaine ?",
      a: "Pour garder une planification claire, chaque membre peut proposer une fois tous les 7 jours par groupe. L’écran affiche la prochaine date où tu pourras proposer.",
      roles: ["member"],
    },
    {
      q: "Pourquoi un sondage indique-t-il Non invité ?",
      a: "L’admin t’a exclu sous **Qui vote**. Tu peux lire le sondage, mais seuls les membres invités votent.",
      roles: ["member"],
    },
    {
      q: "Le sondage se ferme-t-il à la date limite du vote ?",
      a: "Oui, pour le vote : passé l’heure limite, le sondage affiche **Vote clos** et plus personne ne peut voter. Un admin valide ensuite une date ou supprime le sondage.",
    },
    {
      q: "Les membres voient-ils combien coûte la salle de répétition ?",
      a: "Pendant un sondage, ils ne voient que leur part (« 12 € chacun »). Le coût total du studio sur la page de la répétition n’est montré qu’aux admins.",
    },
    {
      q: "Puis-je écrire en privé à un autre membre ?",
      a: "Seulement si l’un de vous deux est admin d’un groupe en commun. Sinon, utilise la discussion du groupe ou de l’événement.",
      roles: ["member"],
    },
    {
      q: "Pourquoi je ne peux pas ouvrir la discussion de la répétition ?",
      a: "Les membres voient **CHAT RÉPÉTITION** après avoir répondu **PRÉSENT**. Si tu as refusé, tu n’y as plus accès.",
      roles: ["member"],
    },
    {
      q: "Puis-je modifier ou supprimer un message, ou envoyer une photo ?",
      a: "Non. Les messages sont uniquement du texte. Tu peux répondre à un message ou supprimer toute la discussion.",
    },
    {
      q: "Si je supprime la discussion du groupe, le groupe perd-il la conversation ?",
      a: "Non. Seuls tes propres messages sont effacés. Dans une discussion privée, tous les messages sont effacés pour les deux personnes.",
    },
    {
      q: "Que deviennent les messages envoyés sans connexion ?",
      a: "Ils ne partent pas. Le texte revient dans la zone de saisie pour que tu puisses le renvoyer une fois en ligne.",
    },
    {
      q: "Les remplaçants peuvent-ils utiliser le chat ?",
      a: "Non. Les remplaçants ne sont pas membres du groupe. Le groupe les contacte par des demandes de remplacement dans l’app.",
      roles: ["deputy"],
    },
  ],

  glossary: [
    { term: "Proposition de répétition", definition: "La demande de répétition d’un membre, avec un thème et des jours préférés. Elle attend un admin jusqu’à son dernier jour préféré.", see: "propose-a-rehearsal" },
    { term: "Sondage de dispos", definition: "Une liste de dates proposées sur lesquelles le groupe vote avant qu’un admin en choisisse une.", see: "create-a-rehearsal-poll" },
    { term: "Créneau proposé", definition: "Une date avec une heure de début et de fin proposée dans un sondage.", see: "create-a-rehearsal-poll" },
    { term: "Mode de planification", definition: "Le choix entre **Planifier** et **Sondage** quand un admin commence une nouvelle répétition.", see: "create-a-rehearsal" },
    { term: "Qui vote", definition: "Les membres invités à voter dans un sondage. Exclure quelqu’un crée une liste d’invités.", see: "poll-who-votes-and-deadline" },
    { term: "Voter avant le", definition: "Le jour et l’heure où un sondage n’accepte plus de votes. Ensuite, il affiche Vote clos.", see: "poll-who-votes-and-deadline" },
    { term: "Favorite", definition: "La date du sondage qui a le plus de votes pour l’instant.", see: "vote-in-a-rehearsal-poll" },
    { term: "Pas dispo", definition: "Une réponse au sondage qui veut dire qu’aucune date proposée ne te va. Elle efface tes votes et prévient l’admin.", see: "vote-in-a-rehearsal-poll" },
    { term: "Valider", definition: "Choisir la date gagnante d’un sondage, ce qui crée la répétition.", see: "lock-in-a-poll-date" },
    { term: "Nombre de libres", definition: "Combien de membres n’ont rien d’autre dans leur agenda à un moment donné, par exemple « 4 sur 5 libres ». Seul le nombre s’affiche.", see: "create-a-rehearsal-poll" },
    { term: "Morceaux à travailler", definition: "Les morceaux à bosser pendant une répétition. Ils deviennent la setlist de la répétition.", see: "rehearsal-songs-and-prep-tasks" },
    { term: "Type de séance", definition: "Groupe complet, Voix, Rythmique, Acoustique ou Autre : il donne son nom à la répétition et présélectionne l’effectif.", see: "create-a-rehearsal" },
    { term: "Discussion du groupe", definition: "La discussion unique où se trouvent tous les membres actifs d’un groupe.", see: "start-a-chat" },
    { term: "Discussion d’événement", definition: "La discussion d’un concert ou d’une répétition, pour sa formation et les admins.", see: "event-and-rehearsal-chats" },
    { term: "Bandeau de l’événement", definition: "La barre en haut d’une discussion d’événement, avec la date, l’heure d’arrivée ou de début et le lieu.", see: "event-and-rehearsal-chats" },
    { term: "Coches de lecture", definition: "Les marques à côté de tes messages : envoi, envoyé, distribué, lu.", see: "message-receipts-and-online-status" },
  ],
};

export default together;
