import type { AreaText } from '../../types';

const music: AreaText = {
  area: {
    id: "music",
    title: "Répertoire, setlists et scène",
    intro:
      "Garde tous les morceaux du groupe dans une seule bibliothèque, prépare des setlists pour tes concerts, et lis paroles et accords sur scène avec tout le monde sur le même morceau.",
    icon: "music",
  },

  articles: [
    // ───────────────────────────── Repertoire ─────────────────────────────
    {
      id: "repertoire-overview",
      title: "L’écran Répertoire",
      summary: "Où se trouvent les morceaux et les setlists du groupe, et à quoi sert chaque partie de l’écran.",
      roles: ["admin", "member"],
      kind: "reference",
      keywords: ["morceaux", "bibliothèque", "catalogue", "répertoire", "liste des morceaux", "préparation"],
      related: ["add-a-song", "song-menu-actions", "build-a-setlist", "music-what-members-can-do"],
      body: [
        {
          type: "p",
          text: "Le Répertoire, c’est la bibliothèque de morceaux du groupe. Chaque morceau appartient au groupe, et chaque membre actif peut tous les lire. Les setlists se construisent à partir de ces morceaux.",
        },
        {
          type: "steps",
          title: "Ouvrir le Répertoire",
          items: [
            "Sur l’accueil, touche la tuile **Répertoire** sous **Raccourcis**.",
            "Ou touche ton avatar en haut (**Ouvrir profil et compte**) puis **Répertoire** sous **Ressources et outils du groupe**.",
          ],
        },
        {
          type: "list",
          title: "Ce qu’il y a à l’écran",
          items: [
            "**Morceaux** et **Setlists** en haut font passer d’une liste à l’autre. Chacun indique combien il y en a.",
            "Le champ de recherche filtre la liste affichée : **Chercher morceaux, artistes…** cherche dans les titres et les artistes, **Chercher des setlists…** dans les noms de setlists.",
            "La carte **Répertoire du groupe** affiche le nombre de **Morceaux** et de **Setlists**, la **Durée totale** de tous les morceaux, et la **Préparation** : un point par morceau, coloré selon son statut, avec en dessous le nombre de **Prêt**, **À l’étude** et **Suggéré**.",
            "Chaque ligne affiche le titre, l’artiste et la tonalité, la durée et le BPM. Une étiquette **Suggéré** ou **À l’étude** apparaît quand le morceau n’est pas encore prêt.",
            "Le bouton rond **Lecture** à gauche d’une ligne lit l’enregistrement du morceau ou ouvre son lien. Il est grisé quand le morceau n’a ni l’un ni l’autre.",
            "Touche ailleurs sur la ligne pour ouvrir le menu du morceau (voir [[song-menu-actions]]).",
            "Au-dessus des morceaux, les admins voient **Suggestions des membres** quand quelque chose attend d’être examiné ; les membres voient toujours **Mes suggestions** (voir [[review-song-suggestions]] et [[suggest-a-change-to-a-song]]).",
          ],
        },
        {
          type: "table",
          head: ["Statut", "Signification"],
          rows: [
            ["**Prêt**", "Le groupe le joue. Les morceaux ajoutés ou importés par un admin commencent ici."],
            ["**À l’étude**", "Le groupe le travaille. Une suggestion approuvée commence ici."],
            ["**Suggéré**", "Un membre l’a proposé. Il attend qu’un admin l’approuve ou le refuse."],
          ],
        },
        {
          type: "roles",
          rows: [
            { role: "admin", text: "Voit **Importer une liste de morceaux** et **Ajouter le morceau** en haut à droite de la liste Morceaux, et **Nouvelle setlist** sur la liste Setlists. Peut modifier, changer le statut et supprimer tous les morceaux." },
            { role: "member", text: "Lit tous les morceaux et toutes les setlists. Le bouton + en haut à droite est **Suggérer un morceau** sur la liste Morceaux ; il n’y a pas de bouton sur la liste Setlists." },
            { role: "deputy", text: "Un remplaçant n’est pas membre du groupe et n’a pas de Répertoire. Il ne voit que les concerts qu’on lui a demandé de jouer (voir [[deputy-gigs]])." },
          ],
        },
        {
          type: "devices",
          rows: [
            { devices: ["tablet", "duoBook", "duoLand"], text: "Le Répertoire occupe la colonne de liste. Une setlist, un formulaire de morceau ou les suggestions s’ouvrent à côté, dans le second volet." },
            { devices: ["duoLaptop"], text: "La carte **Répertoire du groupe** passe sur la moitié haute (l’écran d’affichage), et les listes restent sur la moitié basse." },
          ],
        },
        { type: "shot", id: "music-repertoire", caption: "Le Répertoire avec la carte Répertoire du groupe et la liste des morceaux." },
      ],
    },
    {
      id: "add-a-song",
      title: "Ajouter un morceau au répertoire",
      summary: "Ajoute un morceau en trois petites étapes ; seul le titre est obligatoire.",
      roles: ["admin"],
      kind: "task",
      keywords: ["nouveau morceau", "créer un morceau", "ajouter un titre", "formulaire du morceau"],
      related: ["song-fields", "suggest-a-song", "import-a-song-list", "import-chords-and-lyrics"],
      body: [
        {
          type: "steps",
          items: [
            "Dans le Répertoire, sur **Morceaux**, touche **Ajouter le morceau** (le bouton + en haut à droite). Avec une bibliothèque vide, tu peux aussi toucher **Ajouter un morceau**.",
            "À l’étape 1, **Morceau**, saisis le **Titre du morceau \\***. Ajoute l’**Artiste original** si tu le connais. Pour importer tout de suite des accords ou des paroles, touche **Importer accords et paroles** (voir [[import-chords-and-lyrics]]).",
            "Touche **Suivant**. À l’étape 2, **Détails · optionnel**, remplis si tu veux **Durée**, **BPM**, **Tonalité** et **Genre**.",
            "Touche **Suivant**. À l’étape 3, **Fichiers et liens · optionnel**, ajoute un enregistrement, une grille, des liens, des notes ou des paroles.",
            "Touche **Ajouter le morceau**. Le bouton devient **Ajouté !** et le formulaire se ferme.",
          ],
        },
        {
          type: "p",
          text: "Tu peux enregistrer à n’importe quelle étape : touche **Ajouter maintenant** sous les champs pour enregistrer ce que tu as déjà saisi.",
        },
        {
          type: "note",
          tone: "tip",
          text: "Si un morceau avec le même titre et le même artiste existe déjà, le formulaire indique « … est déjà dans ta bibliothèque. Enregistre à nouveau pour en ajouter une deuxième copie. » Ne touche de nouveau le bouton d’enregistrement que si tu veux vraiment deux copies.",
        },
        {
          type: "list",
          title: "Ce qui se passe après l’enregistrement",
          items: [
            "Le morceau est ajouté avec le statut **Prêt**.",
            "Tous les autres membres du groupe reçoivent une note dans leurs notifications (sans push).",
            "Les fichiers choisis sont envoyés à l’enregistrement, dans l’espace privé du groupe. Si l’enregistrement échoue, ils sont de nouveau supprimés.",
          ],
        },
        {
          type: "roles",
          rows: [
            { role: "admin", text: "Ajoute les morceaux directement dans la bibliothèque, en **Prêt**." },
            { role: "member", text: "Utilise le même formulaire, intitulé **Suggérer un morceau**. Le morceau est ajouté en **Suggéré** et attend un admin. Voir [[suggest-a-song]]." },
          ],
        },
        {
          type: "devices",
          rows: [
            { devices: ["duoClosed"], text: "**Fermer** se trouve dans le rail, sous l’horloge, au lieu d’être en haut à droite du formulaire." },
            { devices: ["tablet", "duoBook", "duoLand"], text: "Le formulaire s’ouvre dans le second volet, à côté du Répertoire." },
          ],
        },
      ],
    },
    {
      id: "song-fields",
      title: "Tous les champs d’un morceau",
      summary: "À quoi sert chaque champ du formulaire de morceau, avec les limites qui s’appliquent.",
      roles: ["admin", "member"],
      kind: "reference",
      keywords: ["détails du morceau", "bpm", "tonalité", "durée", "genre", "enregistrement", "grille", "youtube", "notes", "paroles"],
      related: ["add-a-song", "transpose-and-tempo", "lyrics-and-chords-format", "play-a-song-recording"],
      body: [
        { type: "p", text: "Le formulaire de morceau a trois étapes. Seul le titre est obligatoire ; les autres étapes sont marquées « optionnel » et peuvent être sautées." },
        {
          type: "table",
          head: ["Champ", "À quoi il sert"],
          rows: [
            ["**Titre du morceau \\***", "Le nom du morceau. Obligatoire."],
            ["**Artiste original**", "Affiché partout sous le titre et utilisé pour repérer les doublons."],
            ["**Importer accords et paroles**", "Importe une grille d’accords et des paroles depuis le forum iReal Pro, un fichier ou le presse-papiers. Une fois une grille associée, une carte **Grille d’accords** affiche sa tonalité, son style, son tempo, ses mesures et ses sections, avec **Aperçu des accords**, **Remplacer** et un X pour la retirer."],
            ["**Durée**", "Minutes et secondes dans deux cases (min : s). Sert aux totaux des setlists."],
            ["**BPM**", "Le tempo, jusqu’à 3 chiffres. Le clic du mode scène l’utilise."],
            ["**Tonalité**", "Texte libre, p. ex. Do maj. Affichée dans la liste, sur scène et dans la transposition du lecteur."],
            ["**Mesure**", "4/4, 3/4, 2/4, 5/4, 6/8, 9/8, 12/8, 5/8 ou 7/8. Le clic et le décompte l’utilisent. Sans choix, celle de la grille d’accords, sinon 4/4. Voir [[song-live-settings]]."],
            ["**Décompte**", "**1 mesure** ou **2 mesures**, et le temps sur lequel le groupe entre : **Commence sur le temps 1**, sauf si tu le déplaces avec − et +."],
            ["**Joué avec une bande**", "Le morceau n’a pas de décompte sur scène : la bande lance le groupe."],
            ["**Tap**, **BPM depuis l’enregistrement**, ÷2 / ×2", "Des outils sous le BPM pour trouver le tempo. Voir [[transpose-and-tempo]]."],
            ["**Transposer pour le groupe**", "Change la tonalité, la grille d’accords et les accords des paroles pour tout le monde. N’apparaît que s’il y a quelque chose à transposer."],
            ["**Genre**", "Des étiquettes à choisir parmi les genres du groupe, ou une nouvelle avec la puce en pointillés **Genre**, puis **Ajouter un genre**. Les genres filtrent la bibliothèque quand tu prépares une setlist."],
            ["**Enregistrement**", "Un fichier audio : MP3, M4A, WAV, 50 Mo max."],
            ["**Grille / partition**", "Un PDF ou une photo, 20 Mo max."],
            ["**Choisir des fichiers**", "Choisit un ou plusieurs fichiers. L’app les range en Enregistrement ou Grille selon leur type. Pour des fichiers d’iCloud Drive, Google Drive ou Dropbox : touche **Choisir des fichiers**, puis **Parcourir**, et choisis l’app sous Emplacements."],
            ["**Vidéo YouTube**", "Un lien vers le morceau sur YouTube. Doit commencer par https://."],
            ["**Partition**", "Un lien vers un PDF ou une partition en ligne, utilisé à la place d’une grille envoyée. Doit commencer par https://."],
            ["**Accords**", "Un lien vers une page d’accords. Il est enregistré dans les notes du morceau sous la forme « Chords: <lien> ». Doit commencer par https://."],
            ["**Notes**", "Les notes du groupe sur le morceau : idées d’arrangement, changements de tonalité."],
            ["**Paroles · texte, Markdown ou JSON**", "Les paroles du morceau, avec les accords dans le texte si tu veux. Voir [[lyrics-and-chords-format]]. **Coller ou importer les paroles** sous la zone ouvre la feuille d’import sur son onglet Paroles. Des paroles de plus de 20 000 caractères ne peuvent pas être enregistrées : le formulaire le dit et garde ton texte jusqu’à ce que tu le raccourcisses. Si quelqu’un d’autre a modifié les paroles pendant que tu les modifiais, le formulaire demande : **Charger la dernière version** (tes modifications sont perdues) ou **Enregistrer la mienne**."],
          ],
        },
        {
          type: "note",
          tone: "privacy",
          text: "Les enregistrements et grilles envoyés sont stockés en privé pour ton groupe : seuls les membres du groupe peuvent les ouvrir.",
        },
        {
          type: "note",
          tone: "tip",
          text: "Si le titre est vide quand tu choisis un fichier, le nom du fichier devient le titre.",
        },
      ],
    },
    {
      id: "song-menu-actions",
      title: "Menu du morceau : toutes les actions",
      summary: "Ce que fait chaque option du menu d’un morceau, et qui la voit.",
      roles: ["admin", "member"],
      kind: "reference",
      keywords: ["actions du morceau", "options du morceau", "menu", "ultimate guitar", "marquer comme prêt"],
      related: ["read-a-song", "edit-or-delete-a-song", "play-a-song-recording", "chord-editor"],
      body: [
        { type: "p", text: "Touche la ligne d’un morceau dans le Répertoire pour ouvrir son menu. Les options n’apparaissent que si elles concernent ce morceau." },
        {
          type: "table",
          head: ["Option", "Ce qu’elle fait", "Qui"],
          rows: [
            ["**Lecture**", "Lit l’enregistrement dans le mini-lecteur, ou ouvre le lien Spotify ou YouTube.", "Tout le monde, quand le morceau a un enregistrement ou un lien"],
            ["**Paroles**", "Ouvre le lecteur de morceau sur les paroles.", "Tout le monde, quand le morceau a des paroles"],
            ["**Grille d’accords**", "Ouvre le lecteur de morceau sur la grille d’accords.", "Tout le monde, quand le morceau a une grille iReal"],
            ["**Ouvrir la grille**", "Ouvre la grille envoyée ou le lien de partition.", "Tout le monde, quand le morceau en a une"],
            ["**Ouvrir dans Ultimate Guitar**", "Lance une recherche du morceau sur Ultimate Guitar, hors de l’app.", "Tout le monde"],
            ["**Modifier les accords**", "Ouvre l’éditeur d’accords.", "Admins, quand le morceau a des paroles"],
            ["**Modifier**", "Ouvre le formulaire du morceau.", "Admins"],
            ["**Suggérer une modification**", "Envoie une correction ou une note à l’admin.", "Membres"],
            ["**Marquer comme prêt**", "Passe le statut à Prêt.", "Admins, quand le morceau n’est pas Prêt"],
            ["**Approuver · à l’étude**", "Approuve un morceau suggéré et le passe À l’étude.", "Admins, sur un morceau Suggéré"],
            ["**Remettre à l’étude**", "Repasse un morceau Prêt À l’étude.", "Admins, sur un morceau Prêt"],
            ["**Supprimer**", "Supprime le morceau après confirmation.", "Admins"],
          ],
        },
        {
          type: "note",
          tone: "tip",
          text: "Passer un morceau suggéré À l’étude ou Prêt depuis ce menu accepte la suggestion du membre, et le supprimer la refuse. Dans les deux cas, le membre qui l’a suggéré est prévenu.",
        },
      ],
    },
    {
      id: "edit-or-delete-a-song",
      title: "Modifier, approuver ou supprimer un morceau",
      summary: "Change les détails ou le statut d’un morceau, ou retire-le de la bibliothèque.",
      roles: ["admin"],
      kind: "task",
      keywords: ["changer le morceau", "mettre à jour le morceau", "retirer le morceau", "statut du morceau", "approuver le morceau"],
      related: ["song-fields", "song-menu-actions", "music-notifications"],
      body: [
        {
          type: "steps",
          title: "Modifier un morceau",
          items: [
            "Dans le Répertoire, touche la ligne du morceau, puis **Modifier**.",
            "Change ce qu’il faut à n’importe laquelle des trois étapes. Touche **Enregistrer maintenant** pour enregistrer depuis l’étape 1 ou 2, ou **Suivant** puis **Enregistrer** à l’étape 3.",
          ],
        },
        {
          type: "p",
          text: "Seuls les champs que tu as changés sont enregistrés : si quelqu’un du groupe modifie un autre champ au même moment, sa modification est conservée. Le reste du groupe reçoit un seul push, par exemple « Morceau mis à jour · Paper Boats » avec « Leo M. a modifié : tonalité, tempo. »",
        },
        {
          type: "steps",
          title: "Changer le statut d’un morceau",
          items: [
            "Touche la ligne du morceau.",
            "Touche **Marquer comme prêt**, **Approuver · à l’étude** ou **Remettre à l’étude**. L’étiquette de la ligne change tout de suite.",
          ],
        },
        {
          type: "steps",
          title: "Supprimer un morceau",
          items: [
            "Touche la ligne du morceau, puis **Supprimer**.",
            "Lis la confirmation : elle cite les setlists qui perdent le morceau et les prochains concerts qui le jouent.",
            "Touche **Supprimer** pour confirmer, ou **Annuler**.",
          ],
        },
        {
          type: "note",
          tone: "warning",
          text: "Supprimer un morceau le retire de toutes les setlists qui l’ont, et son enregistrement et sa grille envoyés sont supprimés définitivement. C’est irréversible.",
        },
        {
          type: "roles",
          rows: [
            { role: "admin", text: "Modifie, change le statut et supprime tous les morceaux du groupe." },
            { role: "member", text: "Ne peut ni modifier ni supprimer les morceaux du groupe. Utilise plutôt **Suggérer une modification** (voir [[suggest-a-change-to-a-song]])." },
          ],
        },
      ],
    },
    {
      id: "lyrics-and-chords-format",
      title: "Comment s’écrivent les paroles et les accords",
      summary: "Le format des morceaux du groupe : sections, accords dans le texte, et ce que l’app remet en ordre à l’enregistrement.",
      roles: ["admin", "member"],
      kind: "reference",
      keywords: ["chordpro", "markdown", "sections", "couplet", "refrain", "accords dans le texte", "format", "json"],
      related: ["read-a-song", "chord-editor", "import-chords-and-lyrics", "voice-parts"],
      body: [
        { type: "p", text: "Les paroles sont du texte simple avec quelques repères. Le même texte contient les mots et les accords : un seul morceau sert au chanteur comme aux musiciens." },
        {
          type: "list",
          title: "Les repères",
          items: [
            "Une section commence par une ligne de titre : `# Verse 1` ou `[Chorus]`.",
            "Une ligne vide sépare les strophes.",
            "Un accord se met entre crochets juste avant le mot sur lequel il tombe : `[Am]word`. Dans le lecteur, il s’affiche au-dessus de ce mot.",
            "`**bold**` et `*italic*` fonctionnent à l’intérieur d’une ligne.",
            "Les parties vocales sont des repères autour des mots : `{v2}…{/v2}` seconde voix, `{bv}…{/bv}` chœurs, `{all}…{/all}` tous, `{sp}…{/sp}` parlé. Voir [[voice-parts]].",
            "Le JSON marche aussi, par exemple une liste de lignes ou une liste de sections avec un nom et des lignes.",
          ],
        },
        {
          type: "list",
          title: "Ce que l’app remet en ordre à l’enregistrement",
          items: [
            "Les noms de sections sont uniformisés : « Rit. » devient Chorus, « [Strofa 2] » devient Verse 2. Les noms en italien, espagnol, français, allemand et portugais sont reconnus.",
            "Les couplets sans numéro sont numérotés quand il y en a plusieurs.",
            "Une ligne d’accords au-dessus d’une ligne de paroles (grilles accords au-dessus du texte) est fusionnée en accords dans le texte.",
            "Un accord placé devant une espace est rattaché au mot suivant.",
          ],
        },
        {
          type: "p",
          text: "Les noms de sections sont écrits en anglais dans le texte, mais chacun les voit dans la langue de son app.",
        },
        {
          type: "note",
          tone: "tip",
          text: "Si les paroles ne peuvent pas être affichées, le lecteur indique « Ces paroles ne peuvent pas être affichées. Vérifie leur format dans Modifier. »",
        },
      ],
    },
    {
      id: "read-a-song",
      title: "Lire les paroles et les accords",
      summary: "Ouvre un morceau dans le lecteur plein écran, change de vue, règle la taille du texte et transpose pour toi.",
      roles: ["admin", "member"],
      kind: "task",
      keywords: ["paroles", "accords", "structure", "lecteur", "taille du texte", "vue du morceau", "grille", "paroles et accords", "grille d’accords"],
      related: ["lyrics-and-chords-format", "transpose-and-tempo", "my-notes-and-files", "stage-mode"],
      body: [
        {
          type: "steps",
          items: [
            "Dans le Répertoire, touche la ligne du morceau puis **Paroles** ou **Grille d’accords**. Depuis le mini-lecteur, touche **Paroles**.",
            "Passe de **Paroles** à **Paroles et accords** ou **Grille d’accords** avec les onglets sous le titre. Seules les vues dont le morceau dispose s’affichent.",
            "Touche les boutons − et + (**Texte plus petit**, **Texte plus grand**) en haut pour changer la taille du texte.",
            "Pour lire dans une autre tonalité, utilise − et + autour de la tonalité sous les onglets. Touche la tonalité pour revenir à l’originale.",
            "Touche X (**Fermer les paroles**) pour fermer le lecteur.",
          ],
        },
        {
          type: "table",
          head: ["Vue", "Ce qu’elle affiche"],
          rows: [
            ["**Paroles**", "Les paroles seules, sans les accords."],
            ["**Paroles et accords**", "Les paroles avec leurs accords au-dessus, ou la grille iReal si les paroles n’ont pas d’accords."],
            ["**Grille d’accords**", "Les accords seuls : la grille iReal mesure par mesure, ou la suite d’accords de chaque section dans des cases."],
          ],
        },
        {
          type: "list",
          title: "Ta vue est mémorisée",
          items: [
            "La première fois, le lecteur s’ouvre sur la vue de ton instrument dans le groupe : Paroles pour les chanteurs ; Paroles et accords pour guitare, claviers et basse ; Grille d’accords pour batterie, percussions et cuivres.",
            "Ensuite, il s’ouvre sur la dernière vue choisie sur cet appareil. Le même choix s’applique en mode scène.",
            "La taille du texte est gardée sur cet appareil et partagée avec le mode scène.",
          ],
        },
        {
          type: "p",
          text: "Si le morceau joue dans le mini-lecteur, un bouton lecture/pause apparaît dans l’en-tête du lecteur. Les admins y voient aussi **Modifier les accords**.",
        },
        {
          type: "devices",
          rows: [
            { devices: ["duoLaptop"], text: "Le morceau occupe la moitié haute (l’écran d’affichage) et les commandes du lecteur passent sur la moitié basse (le pupitre)." },
            { devices: ["tablet", "duoBook", "duoLand"], text: "Le lecteur s’ouvre dans le second volet, à côté du Répertoire." },
          ],
        },
        { type: "shot", id: "music-reader", caption: "Le lecteur de morceau avec les onglets Paroles, Paroles et accords et Grille d’accords." },
      ],
    },
    {
      id: "chart-symbols",
      title: "Les symboles d’une grille d’accords",
      summary: "Ce que veut dire chaque signe d’une grille iReal Pro ou MusicXML : reprises, fins, segno, coda et le reste.",
      roles: ["admin", "member"],
      kind: "reference",
      keywords: ["symboles", "légende", "signes", "reprise", "segno", "coda", "d.c.", "d.s.", "fine", "fin", "volta", "point d’orgue", "n.c.", "barre oblique", "mesure"],
      related: ["read-a-song", "import-from-ireal-pro", "chord-editor", "stage-mode"],
      body: [
        {
          type: "p",
          text: "Les grilles importées d’iReal Pro ou d’un fichier MusicXML montrent la forme avec les mêmes signes partout : le lecteur du morceau, l’éditeur d’accords, le Mode scène et le Mode live. Sous chaque grille, **Ce que veulent dire les symboles** ouvre cette liste.",
        },
        {
          type: "symbols",
          title: "Les symboles",
          rows: [
            { symbol: "section", name: "A", text: "Section : la lettre d’une partie (A, B…). Intro et Couplet s’affichent en mots." },
            { symbol: "time-signature", name: "3/4", text: "Mesure : à partir de cette mesure (ici 3 temps à la noire)." },
            { symbol: "repeat-start", text: "Début de reprise : la partie à reprendre commence ici." },
            { symbol: "repeat-end", text: "Fin de reprise : retourne au début de la reprise et rejoue." },
            { symbol: "ending", n: 1, text: "Première fin : joue-la la première fois ; la deuxième, passe à la deuxième fin." },
            { symbol: "repeat-bar", text: "Rejoue la mesure précédente." },
            { symbol: "repeat-two-bars", text: "Rejoue les deux mesures précédentes." },
            { symbol: "repeat-times", n: 3, text: "Joue cette partie 3 fois." },
            { symbol: "segno", text: "Segno : là où le D.S. te renvoie." },
            { symbol: "coda", text: "Coda : au premier signe de coda saute au second, la partie finale." },
            { symbol: "to-coda", text: "Vers la Coda : saute à la coda maintenant." },
            { symbol: "dc-al-coda", text: "D.C. al Coda : retour au début, puis saut à la coda." },
            { symbol: "ds-al-coda", text: "D.S. al Coda : retour au segno, puis saut à la coda." },
            { symbol: "dc-al-fine", text: "D.C. al Fine : retour au début, arrêt à Fine." },
            { symbol: "fine", text: "Fine : le morceau finit ici, après un D.C. ou un D.S." },
            { symbol: "fermata", text: "Point d’orgue : tiens l’accord." },
            { symbol: "no-chord", text: "N.C. : pas d’accord, le groupe s’arrête." },
            { symbol: "slash", text: "Même accord sur le temps suivant." },
            { symbol: "double-bar", text: "Double barre : une partie se termine." },
            { symbol: "final-bar", text: "Double barre finale : le morceau se termine." },
            { symbol: "end", text: "End : là où le morceau s’arrête." },
          ],
        },
        {
          type: "list",
          title: "Bon à savoir",
          items: [
            "Les lecteurs d’écran disent le nom de chaque signe dans ta langue (par exemple « Répète la mesure précédente »).",
            "Les mots écrits sur une mesure qui ne sont pas un signe (« Solo on AABA ») restent tels quels.",
            "Les grilles importées avant cette mise à jour montrent aussi les signes. Un point d’orgue, une barre oblique ou une reprise de deux mesures qui manquait revient quand tu importes la grille à nouveau.",
          ],
        },
      ],
    },
    {
      id: "transpose-and-tempo",
      title: "Transposer un morceau et trouver son tempo",
      summary: "Change la tonalité pour tout le groupe ou seulement sur ton écran, et règle le BPM en tapant ou depuis l’enregistrement.",
      roles: ["admin", "member"],
      kind: "task",
      keywords: ["transposer", "changer de tonalité", "demi-ton", "bpm", "tap tempo", "détection du tempo"],
      related: ["song-fields", "read-a-song", "stage-click"],
      body: [
        {
          type: "table",
          head: ["Où", "Ce que ça change", "Qui"],
          rows: [
            ["Formulaire du morceau, **Transposer pour le groupe**", "La tonalité du morceau, sa grille d’accords et les accords des paroles, pour tout le monde, une fois enregistré.", "Admins"],
            ["Lecteur et mode scène, − tonalité +", "Seulement ce qu’affiche ton écran. Le morceau garde sa tonalité pour le groupe. Mémorisé par morceau sur cet appareil.", "Tout le monde"],
          ],
        },
        {
          type: "steps",
          title: "Transposer pour tout le groupe",
          items: [
            "Ouvre le menu du morceau et touche **Modifier**, puis **Suivant** pour arriver à **Détails · optionnel**.",
            "Sous **Tonalité**, touche **Descendre d’un demi-ton** (−) ou **Monter d’un demi-ton** (+). Le nombre entre les deux indique de combien tu as transposé.",
            "Touche **Enregistrer maintenant**. Le groupe est prévenu que la tonalité et les accords ont changé.",
          ],
        },
        {
          type: "steps",
          title: "Trouver le BPM",
          items: [
            "Dans le formulaire, sur **Détails · optionnel**, touche **Tap** en rythme avec le morceau. Après deux tapes, le BPM se remplit ; le nombre de tapes s’affiche à côté du bouton.",
            "Ou touche **BPM depuis l’enregistrement**, quand le morceau a un fichier audio. Le tempo est calculé sur ton appareil.",
            "Si le résultat est la moitié ou le double du vrai tempo, touche ÷2 ou ×2.",
          ],
        },
        {
          type: "note",
          tone: "tip",
          text: "Un tempo tiré de l’enregistrement est une estimation : le formulaire indique « Estimé depuis l’enregistrement : vérifie-le en tapant le tempo. »",
        },
      ],
    },
    {
      id: "chord-editor",
      title: "Modifier les accords d’un morceau",
      summary: "Pose des accords sur les mots d’un toucher, déplace-les en les faisant glisser et copie-les d’une section à l’autre.",
      roles: ["admin"],
      kind: "task",
      keywords: ["éditeur d’accords", "modifier les accords", "ajouter un accord", "déplacer un accord", "copier les accords", "ireal"],
      related: ["lyrics-and-chords-format", "suggest-a-change-to-a-song", "import-from-ireal-pro", "mark-voice-parts"],
      body: [
        {
          type: "steps",
          items: [
            "Dans le Répertoire, touche la ligne du morceau puis **Modifier les accords**. Tu peux aussi toucher **Modifier les accords** dans l’en-tête du lecteur.",
            "Touche un mot. La barre du bas affiche **Accord sur « … »** et les accords que le morceau utilise déjà.",
            "Touche un accord pour le poser sur le mot, ou saisis-en un nouveau dans **Nouvel accord, p. ex. F#m7** et touche **Ajouter**. Touche **Aucun accord** pour le retirer. Touche **OK** pour fermer la barre.",
            "Pour déplacer un accord, fais-le glisser sur un autre mot.",
            "Pour indiquer qui chante une ligne, utilise **Voix** dans la même barre : voir [[mark-voice-parts]].",
            "Pour réutiliser les accords d’un couplet, touche **Copier les accords de…** au-dessus d’une section et choisis la section à copier.",
            "Si le morceau a une grille iReal, touche **Depuis iReal (…)** au-dessus d’une section pour poser sur ses lignes les accords de la section correspondante de la grille.",
            "Touche **Annuler** en haut à droite pour revenir en arrière. Quand tu as fini, touche **Enregistrer les accords**.",
          ],
        },
        {
          type: "list",
          title: "Les vérifications de l’éditeur",
          items: [
            "**Mettre au format** apparaît quand des noms de sections ou des accords ne suivent pas le format du groupe ; un toucher suffit à les corriger.",
            "« Absents de la grille iReal : … » liste les accords des paroles que la grille ne joue jamais.",
            "« Les accords sonnent en …, le morceau est en …. » apparaît quand les accords ne collent pas à la tonalité du morceau, avec un bouton pour les transposer.",
          ],
        },
        {
          type: "p",
          text: "L’éditeur d’accords a besoin de paroles. S’il n’y en a pas, il te propose d’abord de les ajouter dans Modifier. Après l’enregistrement, le groupe reçoit un push indiquant que les accords ont changé.",
        },
        {
          type: "note",
          tone: "tip",
          text: "Si tu quittes sans enregistrer, l’app demande « Enregistrer les modifications ? » avec **Enregistrer**, **Abandonner** et **Continuer à modifier**. Si quelqu’un d’autre a enregistré les mêmes paroles pendant que tu les modifiais, l’éditeur le dit et garde tes modifications : touche **Charger la dernière version** pour voir les siennes (les tiennes sont perdues) ou **Enregistrer la mienne** pour enregistrer les tiennes par-dessus.",
        },
        {
          type: "roles",
          rows: [
            { role: "admin", text: "Modifie les accords du groupe pour tout le monde." },
            { role: "member", text: "N’a pas d’éditeur d’accords. Suggère une correction d’accords avec **Suggérer une modification** (voir [[suggest-a-change-to-a-song]])." },
          ],
        },
      ],
    },
    // ───────────────────────────── Parties vocales ─────────────────────────────
    {
      id: "voice-parts",
      title: "Les parties vocales dans les paroles",
      summary: "Voix principale, seconde voix, chœurs, tous ensemble et passages parlés ont chacun leur aspect : chaque chanteur trouve sa partie.",
      roles: ["admin", "member"],
      kind: "reference",
      keywords: ["voix", "harmonie", "chœurs", "choeurs", "seconde voix", "deuxième voix", "chorale", "parlé", "chant principal", "parties", "parties vocales", "bv", "v2"],
      related: ["mark-voice-parts", "who-sings-what", "highlight-my-part", "lyrics-and-chords-format", "stage-mode"],
      body: [
        {
          type: "p",
          text: "Quand un morceau a plusieurs voix, ses paroles peuvent montrer qui chante quels mots. Chaque partie a son propre aspect, fait d’une forme et d’une couleur : il reste lisible sur une scène sombre, en plein soleil et pour les musiciens daltoniens.",
        },
        {
          type: "table",
          head: ["Partie", "Aspect"],
          rows: [
            ["**Voix principale**", "Texte normal. Les lignes sans partie sont la voix principale."],
            ["**Seconde voix**", "Un trait de couleur sous les mots."],
            ["**Chœurs**", "En italique et plus doux, avec une barre de couleur à gauche."],
            ["**Tous**", "En gras : tout le monde chante."],
            ["**Parlé**", "En petites capitales, en gris."],
          ],
        },
        {
          type: "list",
          title: "Où tu les vois",
          items: [
            "Dans le lecteur de morceau, en mode scène et en mode live, en Morceau seul et sur le retour de scène d’un appareil à double écran.",
            "Une légende en haut du morceau nomme les parties qu’il utilise et qui chante chacune, par exemple « Chœurs · Sam, Alex ». Elle n’apparaît que si le morceau a des parties.",
            "Sans réseau aussi : les parties voyagent avec la setlist sur ton téléphone ([[live-mode-offline]]).",
            "Une note de répétition sur une ligne nomme la partie, par exemple « Chœurs · ligne 3 ».",
          ],
        },
        {
          type: "list",
          title: "Comment elles s’écrivent",
          items: [
            "Tu n’as rien à taper : les admins marquent les parties dans l’éditeur d’accords ([[mark-voice-parts]]).",
            "Dans le texte des paroles, une partie est un court repère autour des mots : `{v2}…{/v2}` seconde voix, `{bv}…{/bv}` chœurs, `{all}…{/all}` tous, `{sp}…{/sp}` parlé. La voix principale n’a pas de repère.",
            "Par exemple, `{bv}(ooh, [Am]yeah){/bv}` est une ligne de chœurs avec un accord sur « yeah ».",
            "Une partie couvre une ligne entière ou quelques mots de la ligne, jamais plus d’une ligne. L’app remet les repères en ordre quand le morceau est enregistré.",
            "Tes notes et les notes de répétition restent sur leur ligne quand des parties sont ajoutées.",
          ],
        },
        { type: "shot", id: "voice-parts-stage", caption: "Un morceau avec des parties vocales en mode scène : la légende en haut, les chœurs en italique avec une barre, la seconde voix soulignée." },
      ],
    },
    {
      id: "mark-voice-parts",
      title: "Indiquer qui chante quelle ligne",
      summary: "Dans l’éditeur d’accords, touche une ligne ou quelques mots et choisis Voix principale, Seconde voix, Chœurs, Tous ou Parlé.",
      roles: ["admin"],
      kind: "task",
      keywords: ["choix de la voix", "marquer les chœurs", "harmonie", "seconde voix", "modifier les parties", "voix", "parties vocales", "choristes"],
      related: ["voice-parts", "chord-editor", "who-sings-what"],
      body: [
        {
          type: "steps",
          items: [
            "Dans le Répertoire, touche la ligne du morceau puis **Modifier les accords**.",
            "Touche un mot de la ligne à marquer. La barre du bas affiche **Voix** au-dessus des accords.",
            "Laisse **Toute la ligne** pour marquer toute la ligne. Pour ne marquer que certains mots, touche **Seulement ces mots**, puis touche les autres mots de la même ligne.",
            "Touche une partie : **Voix principale**, **Seconde voix**, **Chœurs**, **Tous** ou **Parlé**. Les mots prennent son aspect tout de suite.",
            "Pour retirer une partie, touche un de ses mots et choisis **Voix principale**.",
            "Touche **Enregistrer les accords**.",
          ],
        },
        {
          type: "list",
          title: "Laisser l’app les proposer",
          items: [
            "Dans des paroles collées ou importées, une ligne entièrement entre parenthèses, comme « (ooh, yeah) », ressemble à des chœurs. Une ligne qui commence par « Tous : » ressemble à tout le monde ensemble.",
            "L’éditeur d’accords et le formulaire du morceau indiquent alors, par exemple, « 2 lignes ressemblent à des chœurs ou à des passages tous ensemble. »",
            "Touche **Marquer les parties vocales** pour les marquer. Rien ne change tant que tu n’as pas touché.",
          ],
        },
        {
          type: "roles",
          rows: [
            { role: "admin", text: "Marque les parties pour tout le groupe." },
            { role: "member", text: "Voit les parties. Pour demander un changement, utilise **Suggérer une modification** (voir [[suggest-a-change-to-a-song]])." },
          ],
        },
        { type: "shot", id: "voice-picker", caption: "L’éditeur d’accords avec Voix ouvert : Toute la ligne ou Seulement ces mots, puis les cinq parties." },
      ],
    },
    {
      id: "who-sings-what",
      title: "Dire qui chante quoi",
      summary: "Attribue chaque partie vocale aux membres qui la chantent, pour tous les concerts ou pour une seule setlist.",
      roles: ["admin"],
      kind: "task",
      keywords: ["attribuer les chanteurs", "parties vocales", "choristes", "chanteur remplaçant", "qui chante", "chanteurs", "chanteuses"],
      related: ["voice-parts", "highlight-my-part", "mark-voice-parts"],
      body: [
        {
          type: "steps",
          items: [
            "Ouvre un morceau qui a des parties vocales : dans le lecteur de morceau, ou en mode scène ou en mode live.",
            "Dans la légende en haut des paroles, touche **Qui chante quoi**.",
            "Sous chaque partie, touche les membres qui la chantent. Touche de nouveau un nom pour le retirer.",
            "Sur un concert, choisis **Chaque concert** pour l’enregistrer sur le morceau, ou **Ce concert seulement** pour cette setlist, par exemple quand un remplaçant chante.",
            "Touche **Enregistrer**.",
          ],
        },
        {
          type: "list",
          items: [
            "La première fois, les parties sont remplies d’après l’instrument de chaque membre : « Choriste » va à Chœurs, « Chant » à Voix principale. Change ce qu’il faut et enregistre.",
            "Pour revenir aux parties du morceau sur un concert, ouvre **Ce concert seulement** et touche **Utiliser les parties du morceau**.",
            "Les noms s’affichent dans la légende, et chaque chanteur voit sa propre partie mise en avant ([[highlight-my-part]]).",
          ],
        },
        {
          type: "roles",
          rows: [
            { role: "admin", text: "Dit qui chante quoi, pour le morceau ou pour un concert." },
            { role: "member", text: "Voit les noms dans la légende. Ne peut pas les changer." },
          ],
        },
        { type: "shot", id: "who-sings-what", caption: "Qui chante quoi sur un concert : Chaque concert ou Ce concert seulement, et les membres sous chaque partie." },
      ],
    },
    {
      id: "highlight-my-part",
      title: "Mettre ta partie en avant",
      summary: "Garde bien visibles les lignes que tu chantes et atténue un peu les autres, sur ton propre appareil.",
      roles: ["admin", "member"],
      kind: "task",
      keywords: ["ma partie", "atténuer", "mettre en avant", "surligner", "chanteur", "choriste", "lignes atténuées", "lignes grisées"],
      related: ["voice-parts", "who-sings-what"],
      body: [
        {
          type: "steps",
          items: [
            "Ouvre un morceau avec des parties vocales dans le lecteur, en mode scène ou en mode live.",
            "**Mettre ma partie en avant** est activé dans la légende : tes lignes restent bien visibles et les autres sont un peu atténuées.",
            "La première fois, un message indique « Les lignes que tu ne chantes pas sont atténuées. » Touche **Compris**.",
            "Pour voir toutes les lignes de la même façon, touche **Mettre ma partie en avant** pour le désactiver. Touche-le de nouveau pour le réactiver.",
          ],
        },
        {
          type: "list",
          items: [
            "Ta partie vient de **Qui chante quoi**. Si rien n’y est réglé, elle vient de ton instrument dans le groupe : avec « Choriste », tu vois Chœurs mis en avant.",
            "Les lignes que tout le monde chante (**Tous**) restent toujours bien visibles.",
            "L’interrupteur n’apparaît que si le morceau a une partie pour toi. Il est gardé sur cet appareil et vaut pour tous les morceaux.",
          ],
        },
      ],
    },
    {
      id: "import-chords-and-lyrics",
      title: "Importer des accords et des paroles dans un morceau",
      summary: "Importe une grille d’accords et des paroles depuis le forum iReal Pro, un fichier ou le presse-papiers.",
      roles: ["admin", "member"],
      kind: "task",
      keywords: ["importer des paroles", "coller des paroles", "chordpro", "musicxml", "grille d’accords", "import de fichier"],
      related: ["import-from-ireal-pro", "open-a-chart-from-another-app", "lyrics-and-chords-format"],
      body: [
        {
          type: "steps",
          items: [
            "Dans le formulaire du morceau, touche **Importer accords et paroles** à l’étape 1, ou **Coller ou importer les paroles** à l’étape 3.",
            "Choisis un onglet : **Depuis le forum**, **Depuis un fichier** ou **Paroles**.",
            "**Depuis un fichier** : touche **Choisir un fichier** et choisis un fichier MusicXML (.musicxml, .mxl), ChordPro (.cho, .chordpro, .pro) ou texte (.txt).",
            "**Paroles** : copie les paroles ailleurs, puis touche **Coller depuis le presse-papiers**, ou colle-les dans la zone et touche **Aperçu**.",
            "Vérifie l’aperçu et touche **Utiliser ces paroles**, ou **Retour**.",
            "Enregistre le morceau comme d’habitude.",
          ],
        },
        {
          type: "list",
          title: "Bon à savoir",
          items: [
            "Les paroles passent toujours d’abord par un aperçu. Si le morceau a déjà des paroles, l’aperçu indique qu’elles seront remplacées.",
            "Une grille d’accords seule est associée tout de suite, sans aperçu.",
            "L’import ne remplit que les champs vides : le titre, l’artiste, la tonalité et le tempo déjà saisis restent.",
            "Au collage, les lignes vides séparent les sections ; les accords au-dessus des mots ou entre [crochets] restent avec eux.",
            "Depuis iReal Pro sur ton appareil : Partager › Exporter › MusicXML, enregistre-le dans Fichiers, puis utilise **Depuis un fichier**.",
          ],
        },
        {
          type: "note",
          tone: "privacy",
          text: "Seul ton groupe voit les paroles et les grilles que tu importes. N’importe que ce que tu as le droit d’utiliser.",
        },
        {
          type: "roles",
          rows: [
            { role: "admin", text: "Importe dans n’importe quel morceau en l’ajoutant ou en le modifiant." },
            { role: "member", text: "Importe en suggérant un nouveau morceau. Pour un morceau existant, suggère plutôt la modification." },
          ],
        },
      ],
    },
    {
      id: "import-from-ireal-pro",
      title: "Importer une grille d’accords depuis iReal Pro",
      summary: "Touche le lien d’un morceau ou d’une playlist sur le forum iReal Pro pour importer ses accords, sa forme, sa tonalité et son tempo.",
      roles: ["admin", "member"],
      kind: "task",
      keywords: ["ireal", "ireal pro", "irealb", "grille d’accords", "playlist", "forum"],
      related: ["import-chords-and-lyrics", "read-a-song", "chord-editor"],
      body: [
        {
          type: "steps",
          title: "Dans les apps iPhone, iPad et Android",
          items: [
            "Dans le formulaire du morceau, touche **Importer accords et paroles** et reste sur **Depuis le forum**.",
            "Touche **Parcourir le forum iReal Pro**. Le forum s’ouvre dans l’app.",
            "Touche le lien d’un morceau ou d’une playlist. Ses accords reviennent directement dans le formulaire.",
            "Ou colle un lien irealb:// dans **Lien iReal Pro**.",
          ],
        },
        {
          type: "steps",
          title: "Sur le web",
          items: [
            "Dans le formulaire du morceau, touche **Importer accords et paroles** et reste sur **Depuis le forum**.",
            "Touche **Ouvrir le forum iReal Pro**. Le forum s’ouvre dans sa propre fenêtre.",
            "Fais un clic droit sur le lien d’un morceau ou d’une playlist et choisis Copier le lien.",
            "De retour dans BandWith, touche **Coller le lien**, colle-le dans **Lien iReal Pro**, ou fais glisser le lien sur la zone (elle affiche **Dépose le lien ici**). La fenêtre du forum se ferme une fois le lien reçu.",
          ],
        },
        {
          type: "p",
          text: "Un lien de playlist affiche ses morceaux (« … · 12 morceaux »). Les morceaux qui correspondent à ton titre sont listés en premier ; saisis du texte dans **Chercher un morceau** pour affiner, et touche un morceau pour l’utiliser. **Changer** revient au lien.",
        },
        {
          type: "list",
          title: "Ce qui est importé",
          items: [
            "Les accords et la forme (sections, mesures, reprises), plus la tonalité, le style, le tempo et la mesure. Pas de mélodie, pas de paroles.",
            "Le titre, le compositeur (comme artiste), la tonalité et le BPM remplissent les champs vides du formulaire.",
            "La grille s’affiche dans les vues **Paroles et accords** et **Grille d’accords** du lecteur, et l’éditeur d’accords peut s’en servir pour placer les accords.",
          ],
        },
        {
          type: "note",
          tone: "tip",
          text: "Si ton navigateur bloque la fenêtre du forum, autorise les fenêtres pop-up pour BandWith et réessaie.",
        },
        {
          type: "devices",
          rows: [
            { devices: ["web"], text: "Le forum ne peut pas s’ouvrir dans la page : il s’ouvre dans une fenêtre à part et tu rapportes le lien avec **Coller le lien**, un collage ou un glisser-déposer." },
          ],
        },
      ],
    },
    {
      id: "open-a-chart-from-another-app",
      title: "Ouvrir une grille MusicXML depuis une autre app",
      summary: "Envoie un fichier MusicXML à BandWith et associe sa grille d’accords à un morceau.",
      roles: ["admin", "member"],
      kind: "task",
      keywords: ["ouvrir dans", "feuille de partage", "musicxml", "fichier reçu", "associer la grille"],
      related: ["import-chords-and-lyrics", "suggest-a-change-to-a-song"],
      body: [
        {
          type: "steps",
          items: [
            "Dans une autre app (par exemple iReal Pro ou Fichiers), partage ou ouvre un fichier MusicXML avec BandWith.",
            "BandWith ouvre une feuille **Fichier reçu**. Les admins voient **Associer la grille d’accords** ; les membres voient **Suggérer la grille d’accords**.",
            "Choisis le morceau concerné. Utilise **Chercher un morceau** pour le trouver. Un morceau qui a déjà une grille indique qu’elle sera remplacée.",
            "Touche **Ouvrir les accords** pour vérifier, ou **OK**.",
          ],
        },
        {
          type: "list",
          items: [
            "Pour un nouveau morceau, ajoute d’abord le morceau : le fichier t’attend dans **Importer accords et paroles** › **Depuis un fichier** › **Fichier reçu**, où **L’utiliser** l’associe.",
            "Touche **Ignorer le fichier** si tu n’en veux pas.",
            "Une partition avec des paroles mais sans symboles d’accords ne donne pas de grille ; pour utiliser ses paroles, ouvre Modifier sur le morceau › **Coller ou importer les paroles** › **Depuis un fichier**.",
          ],
        },
        {
          type: "roles",
          rows: [
            { role: "admin", text: "La grille est associée tout de suite au morceau du groupe." },
            { role: "member", text: "La grille part chez l’admin comme suggestion. Le morceau du groupe ne change pas tant qu’il ne l’a pas acceptée." },
          ],
        },
        { type: "devices", rows: [{ devices: ["web"], text: "Non disponible : la réception de fichiers depuis d’autres apps fonctionne dans les apps iPhone, iPad et Android." }] },
      ],
    },
    {
      id: "import-a-song-list",
      title: "Importer une liste de morceaux",
      summary: "Ajoute plein de morceaux d’un coup depuis un fichier CSV ou texte, ou charge le répertoire tout prêt.",
      roles: ["admin"],
      kind: "task",
      keywords: ["csv", "excel", "tableur", "import en masse", "txt", "numbers", "google sheets", "700 morceaux"],
      related: ["add-a-song", "repertoire-overview"],
      body: [
        {
          type: "steps",
          items: [
            "Dans le Répertoire, sur **Morceaux**, touche **Importer une liste de morceaux** (le bouton d’envoi en haut à droite). Avec une bibliothèque vide, tu peux aussi toucher **Importer (CSV/TXT)**.",
            "Choisis un fichier .csv, .tsv ou .txt, de 2 Mo maximum.",
            "Lis la ligne au-dessus de la liste : elle indique combien de morceaux ont été importés et combien étaient déjà dans ta bibliothèque.",
          ],
        },
        {
          type: "list",
          title: "À quoi peut ressembler le fichier",
          items: [
            "Un tableur enregistré en CSV (Excel, Numbers, Google Sheets) avec une ligne d’en-tête. Colonnes lues : title (ou song, name, track), artist (ou band, performer), key, bpm (ou tempo), duration (ou length, time ; m:ss ou secondes) et genre.",
            "Une simple liste tapée dans Notes : un morceau par ligne, sous la forme « Titre - Artiste », « Titre, Artiste » ou juste « Titre ». Les lignes numérotées et les lignes vides ne posent pas de problème.",
            "Jusqu’à 2000 morceaux par fichier.",
          ],
        },
        {
          type: "p",
          text: "Les morceaux qui ont le même titre et le même artiste qu’un morceau déjà présent sont ignorés. Les morceaux importés sont ajoutés en **Prêt**.",
        },
        {
          type: "steps",
          title: "Charger le répertoire tout prêt",
          items: [
            "Avec une bibliothèque vide, touche **Charger 700+ morceaux**.",
            "L’app ajoute les morceaux sélectionnés qui ne sont pas encore dans ta bibliothèque et indique combien.",
          ],
        },
        {
          type: "note",
          tone: "privacy",
          text: "L’import d’une liste de morceaux est réservé aux admins : elle va directement dans la bibliothèque du groupe. Les membres suggèrent les morceaux un par un, et un admin examine chacun d’eux.",
        },
        {
          type: "roles",
          rows: [
            { role: "admin", text: "Voit **Importer une liste de morceaux** et **Charger 700+ morceaux**." },
            { role: "member", text: "Ne voit pas ces boutons." },
          ],
        },
      ],
    },
    {
      id: "play-a-song-recording",
      title: "Écouter un enregistrement, ouvrir une grille ou un lien",
      summary: "Écoute l’enregistrement du groupe dans le mini-lecteur et ouvre les grilles et les liens.",
      roles: ["admin", "member"],
      kind: "task",
      keywords: ["écouter", "audio", "mini-lecteur", "enregistrement", "spotify", "youtube", "grille pdf"],
      related: ["song-menu-actions", "song-fields", "read-a-song"],
      body: [
        {
          type: "steps",
          items: [
            "Dans le Répertoire, touche le bouton rond **Lecture** sur la ligne d’un morceau, ou touche la ligne puis **Lecture**.",
            "Un enregistrement (un fichier envoyé, un lien Google Drive ou n’importe quel lien audio) se lit dans le mini-lecteur. Utilise-y **Pause**, **Lecture** et **Arrêter**, et **Paroles** pour ouvrir le lecteur de morceau.",
            "Un lien Spotify ou YouTube s’ouvre hors de l’app.",
            "Pour voir la grille, touche la ligne puis **Ouvrir la grille**.",
          ],
        },
        {
          type: "note",
          tone: "tip",
          text: "Si rien ne s’ouvre, l’app indique « Impossible d’ouvrir ce morceau. Vérifie son enregistrement ou ses liens. » Si un lien échoue dans le lecteur, **Ouvrir le lien** l’ouvre ailleurs.",
        },
      ],
    },
    {
      id: "my-notes-and-files",
      title: "Mes notes et fichiers sur un morceau",
      summary: "Ajoute des notes privées sur un morceau, une ligne, un mot ou un accord, et garde tes propres fichiers, vus par personne d’autre.",
      roles: ["admin", "member"],
      kind: "task",
      keywords: ["notes perso", "notes privées", "mes notes", "annotations", "mes fichiers", "mon enregistrement"],
      related: ["read-a-song", "stage-mode", "suggest-a-change-to-a-song"],
      body: [
        {
          type: "note",
          tone: "privacy",
          text: "Tes notes et tes fichiers ne sont qu’à toi : personne d’autre dans le groupe ne les voit, admins compris. Le morceau du groupe ne change pas pour les autres.",
        },
        {
          type: "steps",
          title: "Ajouter une note",
          items: [
            "Ouvre le morceau dans le lecteur (**Paroles** ou **Grille d’accords**) ou en mode scène.",
            "Touche **Ajouter une note** (en mode scène, **Note**). **Mes notes** s’activent toutes seules ; la première fois, une feuille explique à quoi elles servent : touche **Compris**.",
            "Une barre en bas de l’écran indique **Touche la ligne où tu veux la note** : touche la ligne voulue, ou **Tout le morceau** pour une note sur tout le morceau. **Annuler** pour sortir.",
            "Plus rapide : garde le doigt sur une ligne une demi-seconde. **Note sur cette ligne** s’ouvre : touche **Note pour moi**.",
            "Pour une ligne, choisis sur quoi porte la note : **Toute la ligne**, un de ses mots ou un de ses accords.",
            "Écris dans **Ma note** et touche **Enregistrer la note**.",
            "**Note enregistrée sur « … »** te dit où elle est allée.",
          ],
        },
        {
          type: "list",
          items: [
            "Tes notes s’affichent sous leur ligne, surlignées. Les notes sur tout le morceau s’affichent au-dessus des paroles.",
            "Touche une note pour la changer ou touche **Supprimer la note**.",
            "Une note reste sur sa ligne même quand un admin modifie les accords ou déplace des sections. Si sa ligne n’existe plus dans le morceau, elle remonte en haut pour ne pas se perdre.",
            "Désactive **Mes notes** pour les masquer, par exemple sur scène. Ce réglage est gardé sur cet appareil.",
          ],
        },
        {
          type: "steps",
          title: "Ajouter ton propre fichier",
          items: [
            "Avec **Mes notes** activé, touche **Ajouter un fichier** et choisis un enregistrement ou une partition.",
            "Il apparaît comme une puce sous la barre. Touche-la pour l’ouvrir ; touche son X et confirme pour le retirer.",
          ],
        },
        {
          type: "p",
          text: "Pour partager une note avec le groupe, touche **Suggérer au groupe** dans la feuille de la note. Elle part chez l’admin comme suggestion, avec la ligne sur laquelle elle était.",
        },
        {
          type: "devices",
          rows: [{ devices: ["phone", "phoneLand", "duoClosed"], text: "En mode scène, la barre affiche **Note** et une icône pour **Ajouter un fichier**, pour tenir sur une ligne au-dessus des paroles." }],
        },
      ],
    },

    // ───────────────────────────── Suggestions ─────────────────────────────
    {
      id: "suggest-a-song",
      title: "Suggérer un nouveau morceau",
      summary: "Propose un morceau pour le répertoire ; un admin l’approuve ou le refuse.",
      roles: ["member"],
      kind: "task",
      keywords: ["proposer un morceau", "suggérer un morceau", "demande de morceau", "idée de morceau"],
      related: ["add-a-song", "my-song-suggestions", "review-song-suggestions"],
      body: [
        {
          type: "steps",
          items: [
            "Dans le Répertoire, sur **Morceaux**, touche **Suggérer un morceau** (le bouton + en haut à droite).",
            "Remplis le formulaire comme pour n’importe quel morceau : **Titre du morceau \\*** est le seul champ obligatoire. Tu peux importer des accords et des paroles et joindre un enregistrement ou une grille.",
            "Touche **Suggérer maintenant** pour l’envoyer tout de suite, ou passe les étapes et touche **Suggérer un morceau** à la dernière.",
          ],
        },
        {
          type: "list",
          title: "Ce qui se passe ensuite",
          items: [
            "Le morceau apparaît dans le Répertoire avec l’étiquette **Suggéré**, pour tout le groupe.",
            "Les admins du groupe reçoivent un push : « Morceau suggéré · … ». Plusieurs morceaux suggérés en moins d’une minute n’envoient qu’un seul push.",
            "Quand un admin l’approuve, il passe **À l’étude** et tu reçois un push. S’il est refusé, le morceau et ses fichiers sont supprimés, et tu reçois un push avec le motif de l’admin s’il en a donné un.",
          ],
        },
        {
          type: "p",
          text: "Les fichiers joints à un morceau suggéré restent dans ton propre dossier tant qu’un admin n’a pas accepté le morceau.",
        },
      ],
    },
    {
      id: "suggest-a-change-to-a-song",
      title: "Suggérer une modification d’un morceau",
      summary: "Envoie à l’admin une correction des paroles ou des accords, ou une note pour tout le groupe.",
      roles: ["member"],
      kind: "task",
      keywords: ["correction", "corriger les paroles", "corriger les accords", "note pour le groupe", "proposer une modification"],
      related: ["my-song-suggestions", "review-song-suggestions", "my-notes-and-files"],
      body: [
        {
          type: "steps",
          items: [
            "Dans le Répertoire, touche la ligne du morceau puis **Suggérer une modification**.",
            "Choisis **Paroles ou accords** ou **Note pour le groupe**.",
            "Pour les paroles ou les accords, modifie le texte dans **Paroles avec accords**. Les accords se mettent entre crochets avant le mot : [Am]mot. La ligne sous la zone résume ce que tu as changé, par exemple « Accords modifiés sur 2 lignes ».",
            "Ajoute un **Message pour l’admin (facultatif)** si ça peut aider.",
            "Pour une note, écris-la dans **Note pour tout le groupe**.",
            "Touche **Envoyer la suggestion**. La feuille affiche **Envoyée à l’admin** et se ferme.",
          ],
        },
        {
          type: "note",
          tone: "tip",
          text: "Le morceau du groupe reste le même pour tout le monde tant que l’admin n’a pas accepté ta suggestion.",
        },
        {
          type: "p",
          text: "Tu peux aussi partir d’une de tes notes : ouvre-la et touche **Suggérer au groupe**. La note est envoyée avec la ligne sur laquelle elle était.",
        },
        {
          type: "p",
          text: "Les admins reçoivent un push nommé selon le type : « Correction des paroles · … », « Correction des accords · … » ou « Note pour le groupe · … ».",
        },
      ],
    },
    {
      id: "my-song-suggestions",
      title: "Suivre ou retirer tes suggestions",
      summary: "Vois lesquelles de tes suggestions attendent, lesquelles ont été acceptées, et retires-en une.",
      roles: ["member"],
      kind: "task",
      keywords: ["mes suggestions", "retirer", "statut de la suggestion", "en attente"],
      related: ["suggest-a-song", "suggest-a-change-to-a-song"],
      body: [
        {
          type: "steps",
          items: [
            "Dans le Répertoire, sur **Morceaux**, touche **Mes suggestions**. Sa ligne indique combien attendent l’admin.",
            "**En attente** liste celles encore ouvertes ; **Examinées** liste les autres avec leur résultat.",
            "Touche-en une pour la voir. **Modifications**, **Avant** et **Après** montrent la différence ; une suggestion examinée affiche le motif de l’admin s’il en a donné un.",
            "Pour retirer une suggestion en attente, touche **Retirer la suggestion**, puis de nouveau **Retirer la suggestion** pour confirmer, ou **La garder**.",
          ],
        },
        {
          type: "table",
          head: ["Étiquette", "Signification"],
          rows: [
            ["**En attente**", "Pas encore examinée."],
            ["**Accepté**", "Appliquée telle que tu l’as envoyée."],
            ["**Acceptée avec des modifications**", "L’admin l’a appliquée avec ses propres retouches."],
            ["**Non retenue**", "Refusée."],
          ],
        },
        {
          type: "note",
          tone: "warning",
          text: "Retirer la suggestion d’un nouveau morceau supprime le morceau et les fichiers que tu as joints. Les admins ne le voient plus.",
        },
      ],
    },
    {
      id: "review-song-suggestions",
      title: "Examiner les suggestions des membres",
      summary: "Accepte, accepte avec des modifications ou refuse ce que proposent les membres, avec un motif si tu veux.",
      roles: ["admin"],
      kind: "task",
      keywords: ["examiner", "approuver", "refuser", "suggestions des membres", "modérer"],
      related: ["suggest-a-change-to-a-song", "suggest-a-song", "edit-or-delete-a-song"],
      body: [
        {
          type: "steps",
          items: [
            "Dans le Répertoire, sur **Morceaux**, touche **Suggestions des membres** (elle affiche « … à examiner »). Tu peux aussi toucher le push reçu.",
            "Sur **En attente**, touche une suggestion. Elle indique qui l’a faite et quand, avec son message.",
            "Regarde **Modifications** (lignes ajoutées et retirées), **Avant** et **Après**. Pour un nouveau morceau, un résumé liste ce qu’il contient.",
            "Écris si tu veux un **Motif (facultatif, … le verra)**.",
            "Touche **Accepter**, **Accepter avec des modifications** ou **Refuser**.",
          ],
        },
        {
          type: "table",
          head: ["Bouton", "Ce qui se passe"],
          rows: [
            ["**Accepter**", "La modification est appliquée au morceau du groupe. Un nouveau morceau passe À l’étude."],
            ["**Accepter avec des modifications**", "Tu retouches d’abord le texte, puis tu touches **Accepter avec ces modifications**. Pour un nouveau morceau, le formulaire du morceau s’ouvre."],
            ["**Refuser**", "Rien ne change. Un nouveau morceau suggéré est supprimé, avec ses fichiers."],
          ],
        },
        {
          type: "list",
          items: [
            "Le membre reçoit un push avec le résultat et ton motif.",
            "Si le morceau a changé depuis la suggestion, l’écran prévient que tu compares avec sa version actuelle.",
            "Une note pour le groupe est ajoutée aux notes du morceau.",
            "Une suggestion qui contient une grille d’accords remplace aussi la grille du morceau.",
            "Les suggestions examinées restent sous **Examinées**. Une longue liste affiche d’abord les plus récentes : touche **Charger les suggestions plus anciennes** en bas pour voir les autres.",
          ],
        },
        {
          type: "devices",
          rows: [{ devices: ["tablet", "duoBook", "duoLand"], text: "Les suggestions s’ouvrent dans le second volet, à côté du Répertoire." }],
        },
        { type: "shot", id: "music-suggestions", caption: "Une correction de paroles avec Modifications, Avant et Après, et les boutons d’examen." },
      ],
    },

    // ───────────────────────────── Setlists ─────────────────────────────
    {
      id: "build-a-setlist",
      title: "Préparer une setlist",
      summary: "Crée une setlist dans le Répertoire, ajoute des morceaux de la bibliothèque, mets-les dans l’ordre et enregistre.",
      roles: ["admin"],
      kind: "task",
      keywords: ["nouvelle setlist", "créer une setlist", "set list", "ordre de passage", "playlist"],
      related: ["setlists-and-sets", "attach-a-setlist-to-a-gig", "edit-a-gig-setlist", "music-notifications"],
      body: [
        {
          type: "steps",
          items: [
            "Dans le Répertoire, touche **Setlists**, puis **Nouvelle setlist** (le bouton + en haut à droite). Sans aucune setlist, tu peux aussi toucher **Créer une setlist**.",
            "Saisis un **Nom de la setlist \\***, par exemple Soirée jazz 1er set, et touche **Créer la setlist**.",
            "Touche la nouvelle setlist dans la liste pour l’ouvrir.",
            "Touche **Ajouter des morceaux…**. Cherche avec **Chercher dans la bibliothèque…** ou touche une puce de genre pour filtrer. Touche un morceau pour l’ajouter ; touche-le de nouveau pour le retirer. Les morceaux de la setlist sont surlignés.",
            "Touche **OK** pour fermer la bibliothèque.",
            "Fais glisser un morceau par sa poignée (**Glisse pour réordonner**) pour le déplacer. Touche le X d’une ligne pour la retirer.",
            "Change le **Nom de la setlist** en haut si tu veux.",
            "Touche **Enregistrer la setlist**.",
          ],
        },
        {
          type: "list",
          title: "Ce qu’affiche l’éditeur",
          items: [
            "**Ordre de la setlist (… morceaux)** avec la durée **Total**.",
            "Quand la setlist a plusieurs sets, une étiquette par set avec ses morceaux et sa durée, et une étiquette **Set 1**, **Set 2** sur le premier morceau de chaque set.",
            "Combien de morceaux n’ont pas de durée : ajoute-la avec Modifier pour avoir un total exact.",
          ],
        },
        {
          type: "p",
          text: "Après l’enregistrement, les membres actifs du groupe reçoivent un seul push avec ce qui a changé, par exemple « Setlist mise à jour · Rooftop set » et « Leo M. : 2 morceaux déplacés, 1 ajouté. » Un changement de nom est aussi signalé.",
        },
        {
          type: "note",
          tone: "tip",
          text: "Si tu quittes l’éditeur sans enregistrer, l’app demande « Enregistrer les modifications de la setlist ? » avec **Enregistrer**, **Abandonner** et **Continuer à modifier**.",
        },
        {
          type: "roles",
          rows: [
            { role: "admin", text: "Crée, modifie, renomme et supprime les setlists." },
            { role: "member", text: "Ouvre les setlists en lecture seule : l’ordre, les sets et la durée, et **Exporter la setlist en PDF**. Pas de champ de nom, pas de bibliothèque, pas de poignées, pas d’enregistrement." },
          ],
        },
        {
          type: "devices",
          rows: [{ devices: ["tablet", "duoBook", "duoLand"], text: "La setlist s’ouvre dans le second volet, à côté de la liste des setlists." }],
        },
        { type: "shot", id: "music-setlist-editor", caption: "L’éditeur de setlist avec la bibliothèque ouverte et l’ordre de la setlist en dessous." },
      ],
    },
    {
      id: "setlists-and-sets",
      title: "Setlists, sets et modèles",
      summary: "Le lien entre les setlists, les sets qu’elles contiennent, les setlists modèles et les concerts.",
      roles: ["admin", "member"],
      kind: "reference",
      keywords: ["sets", "set 1", "set 2", "modèle", "setlist enregistrée", "setlist du concert"],
      related: ["build-a-setlist", "attach-a-setlist-to-a-gig", "edit-a-gig-setlist"],
      body: [
        { type: "p", text: "Une setlist est une liste ordonnée de morceaux du groupe. Un morceau n’y figure qu’une fois. Une setlist peut être divisée en sets (Set 1, Set 2…), par exemple avant et après une pause." },
        {
          type: "list",
          items: [
            "Les sets se créent quand tu prépares la setlist d’un concert : **Ajouter un set** dans le formulaire du concert, ou **Nouveau set** en ajoutant des morceaux depuis l’aperçu du concert.",
            "Dans l’éditeur de setlist du Répertoire, tu vois les sets et tu peux déplacer des morceaux de l’un à l’autre en les faisant glisser au-delà de la limite ; un nouveau morceau rejoint le dernier set. Les sets vides disparaissent à l’enregistrement.",
            "Les setlists marquées comme modèles portent l’étiquette **Modèle** dans la liste. Le formulaire du concert propose tes setlists enregistrées sous **Charger un modèle**.",
            "Quand tu charges une setlist enregistrée dans un concert, le concert reçoit sa propre copie, nommée d’après le concert (par exemple « Setlist Rooftop Session »). Changer ensuite la setlist du concert ne change pas celle que tu as chargée.",
            "Chaque setlist de concert apparaît aussi dans le Répertoire sous **Setlists**.",
          ],
        },
        {
          type: "roles",
          rows: [
            { role: "admin", text: "Modifie les setlists partout : dans le Répertoire, le formulaire du concert, l’aperçu du concert et le mode scène." },
            { role: "member", text: "Lit toutes les setlists du groupe. Seuls les admins peuvent modifier les setlists." },
          ],
        },
      ],
    },
    {
      id: "attach-a-setlist-to-a-gig",
      title: "Associer une setlist à un concert",
      summary: "Ajoute des morceaux ou une setlist enregistrée en créant ou en modifiant un concert.",
      roles: ["admin"],
      kind: "task",
      keywords: ["attribuer une setlist", "morceaux du concert", "charger un modèle", "ajouter un set", "setlist de l’événement"],
      related: ["edit-a-gig-setlist", "setlists-and-sets", "create-a-gig"],
      body: [
        {
          type: "steps",
          items: [
            "Crée un concert (voir [[create-a-gig]]). Pour un concert existant, ouvre-le et utilise plutôt sa section **SETLIST**, qui propose les mêmes modèles et morceaux.",
            "Ouvre la section **Setlist et morceaux**.",
            "Pour partir d’une setlist enregistrée, touche-la sous **Charger un modèle**. Une fois qu’il y a des morceaux, **Modèles** réaffiche la liste sous la forme **Remplacer par un modèle**.",
            "Pour ajouter des morceaux, touche **Bibliothèque** sous un set, ou **Manuel** pour en saisir un. **Ajouter morceaux** ajoute dans le set choisi.",
            "Touche **Ajouter un set** pour un autre set, donne-lui un nom dans **Nom du set...**, ou touche **Retirer le set**.",
            "Enregistre le concert.",
          ],
        },
        {
          type: "p",
          text: "Le concert reçoit sa propre setlist, nommée d’après le concert. Quand tu modifies un concert, sa setlist est mise à jour et le line-up reçoit un seul push avec ce qui a changé.",
        },
        {
          type: "note",
          tone: "tip",
          text: "Si le concert n’a pas de setlist, son aperçu affiche **AUCUNE SETLIST** ; les admins peuvent y ajouter des morceaux directement (voir [[edit-a-gig-setlist]]).",
        },
      ],
    },
    {
      id: "edit-a-gig-setlist",
      title: "Modifier la setlist d’un concert depuis son aperçu",
      summary: "Réordonne, ajoute et retire des morceaux directement dans le concert, sans ouvrir le formulaire.",
      roles: ["admin"],
      kind: "task",
      keywords: ["réordonner les morceaux", "aperçu du concert", "choix du set", "dans quel set", "nouveau set", "glisser les morceaux"],
      related: ["attach-a-setlist-to-a-gig", "music-notifications", "gig-workspace"],
      body: [
        {
          type: "steps",
          items: [
            "Ouvre un concert à venir. La section **SETLIST** de l’aperçu affiche ses morceaux.",
            "Pour déplacer un morceau, appuie longuement dessus et fais-le glisser. Au clavier, place le focus sur sa poignée et utilise les flèches haut et bas.",
            "Pour retirer un morceau, touche son X (**Retirer le morceau**).",
            "Pour ajouter des morceaux, touche **Ajouter morceaux**. S’il y a plusieurs sets, **Dans quel set ?** te demande où ; touche un set ou **Nouveau set**.",
            "Dans **Ajouter morceaux**, coche les morceaux (**Bibliothèque**), puis touche **Ajouter … morceaux**. Les morceaux déjà dans le set affichent **Dans le set**. **Manuel** crée un nouveau morceau et l’ajoute.",
            "Touche **Enregistrer** dans la barre **Modifications non enregistrées**, ou **Annuler** pour abandonner les changements.",
          ],
        },
        {
          type: "list",
          items: [
            "Rien n’est enregistré tant que tu n’as pas touché **Enregistrer**. Ensuite, le line-up du concert (tous ceux qui n’ont pas refusé) reçoit un seul push, par exemple « Setlist mise à jour · Rooftop Session » et « Leo M. : 1 morceau déplacé, 1 ajouté. »",
            "Un concert sans setlist en reçoit une à l’enregistrement, nommée d’après le concert.",
            "Si tu quittes le concert sans enregistrer, l’app demande « Enregistrer les modifications de la setlist ? ».",
            "Toucher **SETLIST** ou le nombre de morceaux ouvre la liste complète dans une feuille, où tu peux modifier de la même façon.",
            "Les devis affichent ici la setlist en lecture seule. Sur un concert passé, tu la modifies dans la feuille (**SETLIST** ou le nombre de morceaux) ; les morceaux d’une répétition avec **MODIFIER** à côté de **MORCEAUX À BOSSER**.",
          ],
        },
        {
          type: "roles",
          rows: [
            { role: "admin", text: "Modifie la setlist dans l’aperçu des concerts du groupe à venir." },
            { role: "member", text: "Voit les morceaux, les artistes et les durées en lecture seule. Sans setlist, la feuille indique « L’admin du groupe n’a pas encore ajouté de setlist. »" },
          ],
        },
        {
          type: "devices",
          rows: [{ devices: ["tablet"], text: "L’espace du concert a son propre onglet **SETLIST** à côté de **APERÇU**, **FICHE TECHNIQUE & SCÈNE** et **ARGENT**." }],
        },
      ],
    },
    {
      id: "export-a-setlist-pdf",
      title: "Exporter une setlist en PDF",
      summary: "Crée un PDF d’une setlist pour l’imprimer ou l’envoyer.",
      roles: ["admin", "member"],
      kind: "task",
      keywords: ["pdf", "imprimer la setlist", "partager la setlist", "télécharger"],
      related: ["build-a-setlist"],
      body: [
        {
          type: "steps",
          items: [
            "Dans le Répertoire, touche **Setlists** et ouvre une setlist.",
            "Touche **Exporter la setlist en PDF** (le bouton document en haut à droite).",
            "Sur un téléphone, choisis où l’envoyer dans la feuille de partage. Sur le web, le PDF se télécharge.",
          ],
        },
        { type: "p", text: "Le PDF contient le nom du groupe, le nom de la setlist et chaque morceau avec son artiste, sa tonalité, son BPM, sa durée et son set." },
        { type: "p", text: "Le bouton est grisé tant que la setlist est vide." },
      ],
    },
    {
      id: "delete-a-setlist",
      title: "Supprimer une setlist",
      summary: "Retire une setlist ; les morceaux restent dans la bibliothèque.",
      roles: ["admin"],
      kind: "task",
      keywords: ["retirer la setlist", "supprimer la setlist"],
      related: ["build-a-setlist"],
      body: [
        {
          type: "steps",
          items: [
            "Dans le Répertoire, touche **Setlists** et ouvre la setlist.",
            "Touche **Supprimer la setlist** (la corbeille rouge en haut à droite).",
            "Lis la confirmation : elle cite les prochains concerts qui perdent leur setlist.",
            "Touche **Supprimer**, ou **Annuler**.",
          ],
        },
        {
          type: "note",
          tone: "warning",
          text: "Les concerts qui utilisent la setlist la perdent. Les morceaux restent dans ta bibliothèque. C’est irréversible.",
        },
      ],
    },
    {
      id: "music-notifications",
      title: "Notifications sur les morceaux et les setlists",
      summary: "Qui est prévenu de quoi quand les morceaux, les setlists et les suggestions changent.",
      roles: ["admin", "member"],
      kind: "reference",
      keywords: ["push", "notification", "setlist mise à jour", "morceau mis à jour", "alerte"],
      related: ["build-a-setlist", "edit-a-gig-setlist", "review-song-suggestions", "notifications-inbox"],
      body: [
        {
          type: "table",
          head: ["Changement", "Qui est prévenu", "Comment"],
          rows: [
            ["La setlist d’un concert est enregistrée (aperçu ou formulaire)", "Le line-up du concert, sauf qui a enregistré", "Un push : « Setlist mise à jour · <concert> » avec « 2 morceaux déplacés, 1 ajouté »"],
            ["Une setlist est enregistrée dans le Répertoire", "Les membres actifs du groupe, sauf qui a enregistré", "Un push : « Setlist mise à jour · <setlist> », ou son changement de nom"],
            ["Un morceau est modifié (formulaire ou éditeur d’accords)", "Les membres actifs du groupe, sauf qui a enregistré", "Un push : « Morceau mis à jour · <morceau> » avec les champs modifiés"],
            ["Un admin ajoute un morceau", "Le reste du groupe", "Note dans les notifications, sans push"],
            ["Un morceau ou une modification est suggéré", "Les admins actifs du groupe", "Push"],
            ["Une suggestion est examinée", "Le membre qui l’a faite", "Push, avec le motif"],
            ["La setlist est réordonnée en mode scène", "Le groupe", "Note dans les notifications, sans push"],
          ],
        },
        { type: "p", text: "Les textes sont écrits dans la langue de l’app de chacun." },
        {
          type: "p",
          text: "Un concert ouvert recharge sa setlist dès qu’un admin la change : les membres voient le nouvel ordre sans actualiser.",
        },
      ],
    },
    {
      id: "music-what-members-can-do",
      title: "Ce que les admins, les membres et les remplaçants peuvent faire avec les morceaux et les setlists",
      summary: "Un seul tableau pour savoir qui peut lire et qui peut modifier le répertoire, les setlists et le mode scène.",
      roles: ["admin", "member", "deputy"],
      kind: "reference",
      keywords: ["autorisations", "droits des membres", "réservé aux admins", "lecture seule", "confidentialité"],
      related: ["repertoire-overview", "suggest-a-change-to-a-song", "stage-mode", "who-sees-what"],
      body: [
        {
          type: "table",
          head: ["Action", "Admin", "Membre"],
          rows: [
            ["Lire tous les morceaux, paroles, accords et fichiers", "Oui", "Oui"],
            ["Ajouter un morceau à la bibliothèque", "Oui, en Prêt", "Le suggère, en Suggéré"],
            ["Modifier, transposer pour le groupe, modifier les accords, supprimer un morceau", "Oui", "Non : suggère une modification"],
            ["Importer une liste de morceaux ou charger 700+ morceaux", "Oui", "Non"],
            ["Examiner les suggestions", "Oui, toutes celles du groupe", "Ne voit que les siennes"],
            ["Mes notes et mes fichiers", "Les siens seulement", "Les siens seulement"],
            ["Lire les setlists et les exporter en PDF", "Oui", "Oui"],
            ["Créer, modifier, réordonner, supprimer des setlists", "Oui", "Non"],
            ["Ouvrir le mode scène sur un concert à venir, ou le mode live sur une répétition à venir", "Oui, comme leader", "Oui, comme suiveur"],
            ["Changer le morceau en cours du groupe, réordonner sur scène, lancer le clic du groupe", "Oui", "Non : avance et lance le clic sur son propre téléphone seulement"],
          ],
        },
        {
          type: "note",
          tone: "privacy",
          text: "Les admins ne voient ni les notes ni les fichiers des membres. Les membres ne voient que leurs propres suggestions ; les admins les voient toutes.",
        },
        {
          type: "roles",
          rows: [
            { role: "deputy", text: "Un remplaçant n’est pas membre du groupe : pas de Répertoire, pas de setlists et pas de mode scène. Ses dates de remplaçant affichent la date, les horaires, la salle, le rôle et le cachet proposé." },
          ],
        },
      ],
    },

    // ───────────────────────────── Stage ─────────────────────────────
    {
      id: "stage-mode",
      title: "Mode scène",
      summary: "Un écran live noir, lisible d’un coup d’œil, avec la setlist et les paroles ou accords de chaque morceau : le jour du concert avec le déroulé, à une répétition en mode live.",
      roles: ["admin", "member"],
      kind: "reference",
      keywords: ["scène", "jour du concert", "live", "déroulé", "go live", "mode concert", "répétition", "mode live", "répétition live", "morceau seul", "paroles seules", "vue épurée"],
      related: ["lead-stage-mode", "follow-in-stage-mode", "stage-manager", "stage-click", "stage-bluetooth-sync", "live-mode-offline", "voice-parts", "stage-mode-on-devices"],
      body: [
        {
          type: "steps",
          title: "Ouvrir le mode scène",
          items: [
            "Ouvre un concert du groupe à venir et touche le bouton **Lecture** en haut à droite (**Ouvrir le mode scène**). Le jour du concert, il est mis en avant.",
            "Ou, sur l’accueil, touche **En scène** sous ton prochain concert.",
            "Pour quitter, touche X (**Quitter le mode scène**).",
            "Sur une répétition du groupe à venir, le même bouton s’appelle **Ouvrir le mode live**. Il ouvre le mode live (ci-dessous) ; pour quitter, **Quitter le mode live**.",
          ],
        },
        {
          type: "list",
          title: "Ce qu’il y a à l’écran",
          items: [
            "**Mode scène · …**, le titre du concert, la salle et la ville.",
            "Le déroulé : Arrivée, Balance, Concert et Fin, en heures sur 24 h. Le prochain moment est mis en avant avec **Ensuite · …** ; les moments passés s’estompent.",
            "La **Setlist** avec les numéros, titres, tonalités et durées. Le morceau en cours est mis en avant. Les morceaux retirés pour ce soir sont barrés, et le compteur au-dessus de la liste indique combien (**· 2 retirés**).",
            "Un deuxième onglet, au nom de ta vue de morceau (**Paroles**, **Paroles et accords** ou **Grille d’accords**), affiche le morceau en cours. Il suit le morceau quand il change.",
            "**Précédent** et **Suivant** en bas, avec le bouton du clic entre les deux.",
          ],
        },
        {
          type: "list",
          title: "Dans l’onglet du morceau",
          items: [
            "Passe de **Paroles** à **Paroles et accords** ou **Grille d’accords**. Le choix est partagé avec le lecteur de morceau.",
            "Change la taille du texte avec − et +.",
            "**Plein écran** (le bouton aux quatre coins en haut) affiche le morceau seul (**Morceau seul**), d’ici ou depuis la setlist : une petite ligne avec son numéro et son titre, puis le morceau ; ni onglets, ni horaires, ni statut. En bas, il ne reste que **Tout afficher**, **Précédent**, le clic et **Suivant** ; les flèches et Page préc./suiv. changent aussi de morceau, pour les pédales tourne-pages.",
            "**Tout afficher** ou Retour ramène tout l’écran live, sur l’onglet où tu étais. Quitter le mode scène désactive Morceau seul.",
            "Transpose pour toi avec − tonalité +. Seul ton écran change.",
            "**Mes notes** affiche tes notes privées par-dessus la version du groupe.",
            "Le déroulé se masque pour laisser plus de place au morceau.",
            "Quand il y a de la place (un téléphone à l’horizontale, un iPad, un appareil à double écran ouvert sur les deux volets), la setlist reste dans une colonne à côté du morceau. Touches-y un morceau pour y aller.",
          ],
        },
        {
          type: "list",
          title: "À une répétition : le mode live",
          items: [
            "**Mode live · <date>** et le titre de la répétition en haut.",
            "La setlist, ce sont les morceaux à travailler de la répétition, dans leur ordre. Sans morceau choisi, il indique « Aucun morceau choisi pour cette répétition. »",
            "Paroles, accords, transposition, taille du texte, le clic et Mes notes fonctionnent comme pour un concert.",
            "L’admin guide et les membres suivent, par internet et par Bluetooth, comme pour un concert. Toute personne de la répétition peut l’ouvrir.",
            "Pas de déroulé (pas d’heures d’installation, de balance, de show ou de fin) et pas de morceaux à retirer pour ce soir.",
          ],
        },
        { type: "shot", id: "music-song-only", caption: "Morceau seul : le morceau avec ses accords, en plein écran, avec Tout afficher, Précédent, le clic et Suivant." },
        { type: "shot", id: "music-rehearsal-live", caption: "Le mode live à une répétition : les morceaux à travailler, les accords du morceau en cours et Précédent / Suivant, sans déroulé." },
        {
          type: "list",
          title: "Le minuteur de la répétition",
          items: [
            "L’admin touche **Commencer la répétition** dans le mode live. Le temps défile pour tout le groupe : les membres le voient mais ne le pilotent pas.",
            "**Pause** arrête le temps (une pause ne compte pas) et **Reprendre** repart. **Terminer** demande d’abord : **Continuer** ou **Terminer maintenant**.",
            "À la fin, tout le monde voit le **Résumé de la répétition** : le temps répété sans les pauses et les morceaux joués (chaque morceau à l’écran pendant que le temps défilait compte une fois). L’admin peut encore **Reprendre la répétition**.",
            "La séance est enregistrée : fermer le mode live ou relancer l’app la conserve, et la page de la répétition l’affiche sous **SÉANCE DE RÉPÉTITION**. Une répétition récurrente a une séance par date.",
            "Sans internet, le temps de l’admin continue et s’enregistre au retour en ligne. Sur le Duo plié comme un portable, l’écran au sol affiche le temps et, pour l’admin, **Pause** / **Reprendre**.",
          ],
        },
        {
          type: "list",
          title: "Notes de répétition",
          items: [
            "En mode live, touchez **Marquer** quand quelque chose est à retravailler : le morceau en cours et la minute sont gardés, et vous continuez à jouer.",
            "À la pause (ou dans le résumé), touchez **À écrire** puis **Écrire** sur chaque marque : choisissez sur quoi travailler (**Tempo**, **Tonalité**, **Fin**, **Solo**, **À revoir**, **Nickel**, ou **Répéter une section** si le morceau a une structure), ajoutez quelques mots et indiquez **Pour qui**.",
            "Toute note sur un morceau peut dire **Où dans le morceau** : une section et, si tu veux, une de ses lignes (**Ligne (facultatif)**).",
            "En mode live, tu peux aussi garder le doigt sur une ligne des paroles et toucher **Note pour le groupe** : la note s’ouvre déjà sur ce morceau, cette section et cette ligne.",
            "Les admins écrivent pour tout le groupe ou pour n’importe quel membre ; les membres, pour le groupe ou pour eux-mêmes. Tout le groupe lit toutes les notes.",
            "La personne visée touche **Travaillé** après avoir bossé la note ; un admin touche **OK** quand le groupe l’a en place (l’auteur aussi, pour une note aux membres).",
            "La page de la répétition liste les notes sous **NOTES DE RÉPÉTITION**, par morceau. Les notes arrivent tout de suite sur les autres téléphones en mode live ; sans internet elles attendent sur le téléphone et partent au retour du réseau. Sur le Duo plié comme un portable, l’écran au sol a un bloc-notes : **Marquer**, un preset en un geste, ou **Écrire…**.",
          ],
        },
        {
          type: "list",
          title: "À travailler, et la répétition suivante",
          items: [
            "L’accueil affiche **À travailler** : les morceaux avec des notes ouvertes pour toi ou pour le groupe, de la répétition la plus récente. Touche **Travaillé** sur une note pour toi ; touche le morceau pour ouvrir sa page. Sur le Duo plié comme un portable, les morceaux sont dans **À faire** sur le bureau.",
            "La page du morceau affiche **Des répétitions** au-dessus de tes notes. Une note **Tempo** ou **Tonalité** qui donne la valeur (par exemple « Tempo : 96 » ou « Tonalité : Bb ») a un bouton : les admins **Appliquer au morceau**, les membres **Suggérer au groupe**.",
            "La page de la répétition suivante affiche **DE LA DERNIÈRE FOIS** : les notes ouvertes des répétitions précédentes sur ses morceaux. Les admins touchent **OK** quand le groupe l’a. En mode Live, un badge sur chaque morceau ouvre ses notes de la dernière fois.",
            "Quand un admin crée une répétition, **Des notes de répétition ouvertes** propose les morceaux avec des notes ouvertes comme morceaux à travailler, un toucher chacun. Un nouveau sondage de répétition les choisit déjà ; retire ceux dont tu n’as pas besoin.",
            "À la fin d’une répétition, chacun qui a des morceaux à travailler reçoit une seule notification avec eux (« À travailler : … »), dans sa langue ; celui qui l’a terminée voit le récapitulatif. **Notifications push** dans les Réglages la coupe.",
          ],
        },
        {
          type: "list",
          title: "Bon à savoir",
          items: [
            "Le mode scène est proposé pour les concerts du groupe à venir et, en mode live, pour les répétitions du groupe à venir ; pas pour les devis, les événements passés ni les concerts perso.",
            "L’écran reste allumé tant que le mode scène est ouvert.",
            "**Plein écran** (le bouton aux quatre coins en haut, dans la barre latérale sur un appareil à double écran) masque les barres de l’app, la barre latérale et la barre d’état du téléphone, et garde l’écran allumé. Avec des paroles ou des grilles dans la setlist, il affiche le morceau seul (**Morceau seul**) ; sans, la setlist prend tout l’écran et **Quitter le plein écran** ou Retour le quitte.",
            "Sans setlist, il indique « Aucune setlist liée à ce concert. »",
            "Dans les apps téléphone et tablette, les setlists de tes 7 prochains jours restent sur l’appareil : le mode scène marche sans réseau. Voir [[live-mode-offline]].",
            "Sans internet et sans copie sur l’appareil, il indique « Hors ligne : la setlist n’a pas pu être chargée. » avec **Réessayer**.",
          ],
        },
        {
          type: "roles",
          rows: [
            { role: "admin", text: "Mène : change le morceau en cours du groupe, réordonne la setlist en maintenant et en faisant glisser un morceau, retire des morceaux pour ce soir et lance le clic du groupe. Voir [[lead-stage-mode]]." },
            { role: "member", text: "Suit le leader, ou avance seul dans les morceaux. Voir [[follow-in-stage-mode]]." },
            { role: "deputy", text: "Pas de mode scène : les remplaçants n’ont pas les setlists du groupe." },
          ],
        },
        { type: "shot", id: "music-stage", caption: "Le mode scène le jour du concert : déroulé, setlist et Précédent / Suivant." },
      ],
    },
    {
      id: "lead-stage-mode",
      title: "Mener le groupe en mode scène",
      summary: "En tant qu’admin, change le morceau en cours pour tout le monde, modifie l’ordre en direct et retire les morceaux que tu ne joueras pas.",
      roles: ["admin"],
      kind: "task",
      keywords: ["leader", "morceau suivant", "réordonner en direct", "glisser", "barrer", "sauter un morceau", "retirer un morceau ce soir", "le groupe suit", "synchro en direct"],
      related: ["stage-mode", "follow-in-stage-mode", "stage-click", "stage-bluetooth-sync"],
      body: [
        {
          type: "steps",
          items: [
            "Ouvre le mode scène sur le concert.",
            "Regarde le statut à côté de la setlist : **Live** veut dire que le groupe te suit (**Le groupe vous suit**).",
            "Touche **Suivant** ou **Précédent** pour faire passer le groupe au morceau suivant ou précédent, ou touche n’importe quel morceau de la liste (**Aller à …**).",
            "Pour changer l’ordre, maintiens un morceau jusqu’à ce qu’il se soulève, fais-le glisser à sa nouvelle place et relâche. Un balayage rapide fait toujours défiler la liste, et un toucher rend toujours le morceau actif.",
            "Pour sauter un morceau ce soir, touche le bouton rond − au bout de sa ligne (**Retirer … ce soir**). Le titre est barré et **Précédent** / **Suivant** le sautent. Touche + (**Remettre …**) pour le rétablir.",
          ],
        },
        {
          type: "table",
          head: ["Statut", "Signification"],
          rows: [
            ["**Live**", "Connecté par internet : les membres te suivent."],
            ["**Live · BT**", "Connecté par internet et envoi aussi en Bluetooth."],
            ["**Bluetooth**", "Pas d’internet : les membres à proximité te suivent en Bluetooth."],
            ["**Hors ligne**", "Rien n’arrive au groupe pour l’instant."],
            ["**Enregistrement…**, **Enregistré**, **Non enregistré**", "Après un glisser : le nouvel ordre est enregistré peu après ton dernier geste. **Enregistré** s’affiche un instant, puis le statut revient."],
          ],
        },
        {
          type: "list",
          items: [
            "Les membres qui ouvrent le mode scène plus tard rattrapent le morceau en cours.",
            "Un nouvel ordre s’applique à tout le monde, y compris aux membres qui ne suivent plus, et il est enregistré dans la setlist du concert. Le concert derrière le mode scène l’affiche tout de suite.",
            "Fermer le mode scène enregistre un déplacement encore en attente.",
            "Si plusieurs admins mènent en même temps, c’est le dernier geste qui l’emporte.",
            "Retirer un morceau ne vaut que pour ce soir : la setlist du concert le garde. Les membres qui te suivent le voient barré et le sautent aussi, par internet ou en Bluetooth. Ton téléphone se souvient des morceaux retirés pour ce concert si tu fermes et rouvres le mode scène.",
          ],
        },
        {
          type: "note",
          tone: "tip",
          text: "Garde ton téléphone déverrouillé : le mode scène maintient l’écran allumé, et un téléphone de leader verrouillé coupe la synchro du groupe.",
        },
      ],
    },
    {
      id: "follow-in-stage-mode",
      title: "Suivre le leader en mode scène",
      summary: "En tant que membre, laisse le téléphone de l’admin faire défiler tes morceaux, ou avance toi-même.",
      roles: ["member"],
      kind: "task",
      keywords: ["suivre", "suivre le leader", "synchro", "même morceau"],
      related: ["stage-mode", "lead-stage-mode", "stage-bluetooth-sync"],
      body: [
        {
          type: "steps",
          items: [
            "Ouvre le mode scène sur le concert. Le suivi est activé : le bouton à côté de la setlist indique **En attente du leader** jusqu’à ce que le téléphone de l’admin soit détecté, puis **Avec le leader**.",
            "Ton morceau en cours, ses paroles et ses accords changent quand l’admin avance.",
            "Pour regarder plus loin de ton côté, touche **Précédent**, **Suivant** ou un morceau. Le suivi s’arrête et le bouton indique **Suivre le leader**.",
            "Touche **Suivre le leader** pour revenir au morceau du leader et le suivre de nouveau.",
          ],
        },
        {
          type: "list",
          items: [
            "**· BT** après le libellé veut dire que tu es relié au leader en Bluetooth.",
            "**Hors ligne** veut dire que rien ne peut atteindre ton téléphone pour l’instant.",
            "Les membres ne peuvent ni changer le morceau des autres ni modifier l’ordre.",
            "Si la ligne **L’app du leader n’est pas à jour : demande-lui de la mettre à jour** s’affiche, tu suis quand même : il lui suffit d’installer la dernière version de BandWith.",
            "Si la ligne **Le groupe a changé qui peut mener : connecte-toi une fois à internet pour suivre le leader.** s’affiche, connecte-toi une fois (Wi-Fi ou données mobiles) avec Stage ouvert : ton téléphone récupère le changement et suit de nouveau le leader.",
            "Si la ligne **Leader pas encore vérifié : connecte-toi une fois à internet pour le vérifier.** apparaît, tu suis le leader, mais ton téléphone ne peut pas encore vérifier qu’il est admin du groupe : connecte-toi une fois (Wi-Fi ou données) avec Stage ouvert.",
            "Si la ligne **Leader pas encore vérifié : demande au leader de se connecter une fois à internet.** apparaît, tu suis le leader, mais son téléphone n’a pas été en ligne depuis la nouvelle protection de Stage : le leader se connecte une fois avec Stage ouvert.",
            "Si c’est toi qui mènes et que la ligne **Les téléphones avec l'app à jour ne peuvent pas encore te vérifier : connecte-toi une fois à internet avec le mode scène ouvert.** s’affiche, sans internet seuls les téléphones avec une ancienne version de BandWith peuvent te suivre : connecte-toi une fois (Wi-Fi ou données mobiles) avec Stage ouvert, et les téléphones du groupe pourront vérifier que c’est toi.",
            "Si c’est toi qui mènes et que la ligne **Tu n'es plus admin de ce groupe : un autre admin doit mener.** s’affiche, ton rôle dans le groupe a changé : les téléphones avec la dernière version de BandWith ne te suivent pas. Demande à un admin d’ouvrir le mode scène et de mener.",
            "**Anciennes versions de l’app :** quand le rôle d’un admin change (il devient membre ou quitte le groupe), un concert dont les leaders étaient déjà vérifiés attend qu’un admin avec la dernière version l’ouvre une fois en ligne. D’ici là, les téléphones avec la dernière version affichent **Le groupe a changé qui peut mener : connecte-toi une fois à internet pour suivre le leader.** pour ce concert et ne suivent personne sans internet. Les concerts que personne n’a encore menés avec la dernière version ne changent pas.",
          ],
        },
      ],
    },
    {
      id: "stage-click",
      title: "Utiliser le clic en mode scène",
      summary: "Un métronome visuel sur le bord de l’écran, synchronisé entre les téléphones du groupe.",
      roles: ["admin", "member"],
      kind: "task",
      keywords: ["métronome", "clic", "décompte", "tempo", "bpm", "temps"],
      related: ["stage-mode", "transpose-and-tempo"],
      body: [
        {
          type: "steps",
          items: [
            "En mode scène, repère le bouton du clic entre **Précédent** et **Suivant**. Il affiche le BPM du morceau en cours.",
            "Touche-le (**Lancer le clic**). Une lueur clignote sur le bord de l’écran à chaque temps, plus forte sur le premier temps de la mesure.",
            "Touche-le de nouveau (**Arrêter le clic**) pour l’arrêter.",
          ],
        },
        {
          type: "table",
          head: ["Qui le lance", "Ce qui se passe"],
          rows: [
            ["Admin", "Le clic tourne sur chaque téléphone en mode scène, calé sur le téléphone du leader."],
            ["Membre", "Le clic tourne sur ton téléphone seulement."],
            ["Membre, pendant que le clic du leader tourne", "Le bouton le masque ou l’affiche sur ton téléphone (**Masquer le clic sur ce téléphone**, **Afficher le clic**)."],
          ],
        },
        {
          type: "list",
          items: [
            "Le clic est uniquement visuel : il n’y a pas de son. Il ne bloque pas les touchers à l’écran.",
            "Le nombre de temps par mesure vient de la **Mesure** du morceau, sinon de sa grille d’accords, sinon 4/4. En 6/8 et 12/8, il clignote sur les temps pointés. Pour décompter le groupe, voir [[count-in]].",
            "Un morceau sans BPM ne peut pas lancer de clic (**Pas de BPM pour ce morceau**). Ajoute le BPM dans le formulaire du morceau.",
            "Passer à un autre morceau masque le clic du morceau précédent.",
            "Les téléphones restent synchronisés à environ 20–40 ms près : parfait pour un décompte et une référence de tempo, pas pour un clic dans les oreillettes.",
            "Sans internet, le clic du leader arrive quand même aux téléphones reliés au sien en Bluetooth, dans les apps iPhone, iPad et Android. En mode scène, une ligne indique alors **Connecté au téléphone du leader**. Si le leader reste hors de portée plus de 10 secondes, le clic s’arrête sur ton téléphone. Il reprend en mesure quand le leader est de nouveau à portée. Sur le web, le clic du groupe a besoin d’internet. Voir [[stage-bluetooth-sync]].",
          ],
        },
      ],
    },
    {
      id: "song-live-settings",
      title: "Préparer un morceau pour le décompte",
      summary: "Donne à un morceau sa mesure, la durée du décompte, le temps sur lequel le groupe entre, et indique si une bande le lance.",
      roles: ["admin"],
      kind: "task",
      keywords: ["mesure", "signature rythmique", "6/8", "7/8", "décompte", "anacrouse", "levée", "bande", "backing track", "séquence"],
      related: ["count-in", "follow-the-tempo", "song-fields", "transpose-and-tempo"],
      body: [
        {
          type: "steps",
          items: [
            "Ouvre le menu du morceau et touche **Modifier**, puis **Suivant** pour arriver à **Détails · optionnel**.",
            "Sous **BPM** et **Tonalité**, choisis la **Mesure** : 4/4, 3/4, 2/4, 5/4, 6/8, 9/8, 12/8, 5/8 ou 7/8.",
            "Sous **Décompte**, choisis **1 mesure** ou **2 mesures**. Deux mesures conviennent aux morceaux lents : la première mesure compte à mi-tempo.",
            "La ligne en dessous indique où le groupe entre. **Commence sur le temps 1** est le premier temps de la mesure. Si le morceau commence plus tôt, touche − (**Un temps plus tôt**) : en 4/4, **Commence sur le temps 4** est un temps avant la mesure. Touche + (**Un temps plus tard**) pour revenir.",
            "Si une bande lance le groupe, active **Joué avec une bande** : le morceau n’a pas de décompte sur scène.",
            "Touche **Enregistrer maintenant**.",
          ],
        },
        {
          type: "list",
          title: "Bon à savoir",
          items: [
            "Sans mesure choisie, le morceau utilise celle de sa grille d’accords (le formulaire indique **Depuis la grille d’accords.**), sinon 4/4.",
            "Le clic et le décompte suivent la mesure : 6/8, 9/8 et 12/8 se comptent en temps pointés, comme les musiciens les comptent.",
            "Le **BPM** est le temps que tu comptes : les noires en 4/4, 3/4, 5/8 ou 7/8, les temps pointés en 6/8, 9/8 et 12/8. Dans les mesures en /8, le formulaire le dit sous la mesure. Un morceau qui prend le 6/8 de sa grille d’accords, sans mesure choisie ici, garde son BPM sur chaque croche.",
          ],
        },
        {
          type: "roles",
          rows: [
            { role: "admin", text: "Règle la mesure, le décompte et la bande pour le groupe." },
            { role: "member", text: "Voit le résultat sur scène. Ne peut pas le changer." },
          ],
        },
        { type: "shot", id: "song-live-fields", caption: "Le formulaire du morceau sous BPM et Tonalité : Mesure, Décompte, le temps sur lequel le morceau commence et Joué avec une bande." },
      ],
    },
    {
      id: "count-in",
      title: "Décompter le groupe",
      summary: "Le leader touche Décompte et chaque téléphone affiche le même compte à rebours au tempo du morceau, puis TOP là où le groupe entre.",
      roles: ["admin", "member"],
      kind: "task",
      keywords: ["décompte", "compte à rebours", "compter", "1 2 3 4", "démarrer ensemble", "premier temps", "vibration", "métronome", "count-in"],
      related: ["song-live-settings", "follow-the-tempo", "stage-click", "lead-stage-mode"],
      body: [
        {
          type: "steps",
          title: "Lancer le décompte",
          items: [
            "En mode scène ou en mode live, va sur le morceau.",
            "Touche **Décompte**, à côté du bouton du clic.",
            "Après 1,5 seconde, chaque téléphone en mode scène affiche un compte à rebours plein écran au tempo du morceau : un grand chiffre à chaque temps et un anneau qui se remplit mesure par mesure.",
            "Le groupe entre sur **TOP**. Le compte à rebours disparaît tout seul.",
            "Pour l’arrêter avant la fin, touche **Arrêter le décompte**. Il s’arrête sur tous les téléphones.",
          ],
        },
        {
          type: "table",
          head: ["Mesure", "Ce qu’affiche le compte à rebours"],
          rows: [
            ["4/4", "4 3 2 1 TOP"],
            ["3/4", "3 2 1 TOP"],
            ["2/4", "2 1 TOP"],
            ["5/4", "5 4 3 2 1 TOP"],
            ["6/8, 12/8", "Les temps pointés en grands chiffres (2 ou 4), les croches en petits points."],
            ["5/8, 7/8", "Les temps groupés comme dans la grille, par exemple 2+2+3 : court, court, long."],
          ],
        },
        {
          type: "list",
          title: "Comment il compte",
          items: [
            "Avec **2 mesures** réglé sur le morceau, la première mesure compte à mi-tempo et la seconde à tempo.",
            "Un morceau qui commence avant le temps 1 (par exemple **Commence sur le temps 4**) a son **TOP** sur sa première note, pas sur 1.",
            "Le groupe compte à rebours (4 3 2 1, par défaut) ou à l’endroit (1 2 3 4). Le leader le choisit sous **Pour tout le groupe** dans les options du décompte, et chaque téléphone du groupe compte ainsi.",
            "Si **Suivre le tempo** est activé, le morceau commence à avancer à partir de la mesure 1, à la fin du décompte. Si le clic tourne, il continue en mesure.",
          ],
        },
        {
          type: "list",
          title: "Sur ton téléphone (facultatif)",
          items: [
            "En mode scène, touche **Décompte**, sur la même ligne que **Setlist**, pour ouvrir les options. Elles sont gardées sur cet appareil.",
            "**Vibrer à chaque temps** : plus fort sur le premier temps de la mesure, pour qui ne peut pas regarder l’écran.",
            "**Son au casque** : **Désactivée** ou **Clic**. Le clic ne passe que dans un casque ou des oreillettes. Pour l’entendre à voix haute, active **Aussi par le haut-parleur du téléphone** ; dans un navigateur, il faut cet interrupteur pour l’entendre.",
          ],
        },
        {
          type: "list",
          title: "Quand il n’y a pas de décompte",
          items: [
            "Un morceau réglé sur **Joué avec une bande** n’a pas de bouton **Décompte** : la bande lance le groupe. Le leader peut quand même décompter : il ouvre les options du décompte et touche **Lancer le décompte quand même**.",
            "Pendant que la régie lit l’audio du morceau, **Décompte** est masqué de la même façon, et **Lancer le décompte quand même** marche toujours.",
            "Un morceau sans BPM ne peut pas être décompté.",
          ],
        },
        {
          type: "list",
          title: "Bon à savoir",
          items: [
            "Un téléphone qui reçoit le message en retard rejoint le compte à rebours sur le bon temps.",
            "Le compte à rebours a besoin d’internet : il n’est pas envoyé en Bluetooth. Sans réseau, seul le téléphone du leader l’affiche. Les téléphones reliés en Bluetooth reçoivent quand même le clic, si le leader l’a lancé, et Suivre le tempo à partir de la mesure 1.",
            "Les téléphones restent synchronisés à environ 20–40 ms près.",
            "Un membre peut fermer le compte à rebours sur son propre écran avec **Masquer sur ce téléphone**.",
          ],
        },
        {
          type: "roles",
          rows: [
            { role: "admin", text: "Lance et arrête le décompte pour tout le groupe, et choisit si le groupe compte à rebours ou à l’endroit." },
            { role: "member", text: "Le voit sur son téléphone, peut le masquer là, et choisit la vibration ou un clic au casque pour son propre appareil." },
          ],
        },
        { type: "shot", id: "stage-count-in", caption: "Le décompte sur chaque téléphone : le numéro du temps, l’anneau et le bouton qui l’arrête." },
      ],
    },
    {
      id: "follow-the-tempo",
      title: "Suivre le tempo",
      summary: "Active-le et la grille d’accords ou les paroles avancent avec le morceau, calées sur le téléphone du leader.",
      roles: ["admin", "member"],
      kind: "reference",
      keywords: ["suivre le tempo", "défilement automatique", "tête de lecture", "mesure en cours", "section suivante", "faire défiler les paroles", "répéter", "vamp", "point d’orgue"],
      related: ["count-in", "song-live-settings", "stage-click", "stage-mode"],
      body: [
        {
          type: "steps",
          title: "L’activer",
          items: [
            "En mode scène ou en mode live, ouvre l’onglet du morceau (**Paroles**, **Paroles et accords** ou **Grille d’accords**).",
            "Touche **Suivre le tempo**, à côté des choix de vue. C’est désactivé par défaut et gardé sur cet appareil.",
            "La ligne au-dessus du morceau indique **Démarre quand le leader lance le morceau**. Quand le leader démarre, ton écran avance avec le groupe.",
          ],
        },
        {
          type: "table",
          head: ["Vue", "Ce qui avance"],
          rows: [
            ["**Grille d’accords**", "La mesure en cours s’allume, et la grille défile pour la garder visible. Dans un morceau sans grille mesure par mesure, c’est la section en cours qui s’allume."],
            ["**Paroles et accords**, **Paroles**", "La ligne en cours est mise en avant et le texte défile pour la garder visible. Les lignes sont réparties sur les mesures de leur section : une ligne peut donc s’allumer un peu tôt ou un peu tard."],
            ["**Morceau seul**", "La même chose, en plein écran."],
            ["Retour de scène", "Un grand compte à rebours jusqu’à la section suivante, par exemple « Refrain dans 4 »."],
          ],
        },
        {
          type: "steps",
          title: "Le mener",
          items: [
            "Active **Suivre le tempo** sur ton téléphone aussi. La ligne au-dessus du morceau indique **Le groupe vous suit quand vous démarrez**, avec les boutons du leader à côté.",
            "Touche **Démarrer** : la mesure 1 démarre sur chaque téléphone au même moment. **Décompte** le lance aussi, à la mesure 1 à la fin du décompte.",
            "Si le groupe joue une partie plus longue ou plus courte, touche la mesure, la ligne ou la section où vous êtes : tout le monde y saute.",
            "Touche **Répéter** pour répéter la section en cours (un vamp, un solo). Touche **Relâcher** pour continuer.",
            "Sur un point d’orgue, le morceau attend et la ligne indique **En attente du leader** : touche **Continuer**.",
            "Touche **Arrêter** pour finir. Passer à un autre morceau l’arrête aussi.",
          ],
        },
        {
          type: "list",
          title: "Bon à savoir",
          items: [
            "Seul le leader déplace la position du groupe. Les membres activent ou désactivent la vue sur leur propre téléphone.",
            "Pour être suivi, un morceau a besoin d’un BPM et d’une grille d’accords ou de paroles. Sans BPM, l’interrupteur est désactivé et indique « Ajoutez un BPM pour suivre ce morceau ».",
            "La ligne au-dessus du morceau indique ce qui vient ensuite, par exemple « Ensuite : Pont dans 4 mesures ».",
            "Les reprises, les fins, D.C., D.S., segno et coda de la grille sont jouées dans l’ordre.",
            "Après un défilement à la main, le morceau reste où tu l’as mis quelques secondes, puis recommence à suivre.",
            "Sans internet, la position du leader arrive quand même aux téléphones reliés en Bluetooth, dans les apps iPhone, iPad et Android.",
          ],
        },
        { type: "shot", id: "stage-follow-tempo", caption: "Suivre le tempo sur la grille d’accords : la mesure en cours allumée et la section suivante en haut." },
      ],
    },
    {
      id: "stage-manager",
      title: "Lire l’audio des morceaux depuis la régie",
      summary: "L’ordinateur portable ou la tablette d’un admin, branché à la console, lit l’enregistrement de chaque morceau, et les écrans du groupe passent au morceau en cours.",
      roles: ["admin", "member"],
      kind: "task",
      keywords: ["régie", "bandes", "backing track", "audio", "console", "lecture", "câble", "usb-c", "prise casque", "adaptateur", "sono", "hors ligne", "sans internet", "télécharger"],
      related: ["stage-mode", "lead-stage-mode", "follow-in-stage-mode", "play-a-song-recording"],
      body: [
        {
          type: "p",
          text: "L’ordinateur portable ou la tablette d’un admin, branché à la console, fait office de régie : c’est le seul appareil qui lit l’audio des morceaux. Quand il lit un morceau, tous les écrans en mode scène passent à ce morceau, même hors de l’ordre de la setlist. Les téléphones des membres ne jouent jamais de son.",
        },
        {
          type: "steps",
          title: "Avant le concert",
          items: [
            "Donnez à chaque morceau un **Enregistrement** (un fichier audio) dans la fiche du morceau. Les morceaux sans enregistrement font quand même avancer le groupe, mais rien ne joue.",
            "Branchez l’appareil à la console (voir les conseils sur le câble plus bas) et activez Ne pas déranger, pour que les notifications ne sortent pas dans la sono.",
            "Les jours d’avant, avec internet, ouvrez le concert : sous la setlist, **Audio sur cet appareil** compte les morceaux déjà là (par exemple 3/10). Touchez **Télécharger l’audio** pour récupérer les autres. Dans l’app sur le téléphone, ça démarre tout seul quand vous ouvrez l’app avec internet dans les 3 jours avant un concert confirmé. Les fichiers restent sur l’appareil et ne vont pas dans la sauvegarde du téléphone.",
            "Ouvrez le concert en ligne, ouvrez le mode scène et touchez **Régie : audio d’ici**. L’appareil télécharge l’audio de la soirée : une barre montre où il en est, et l’anneau autour du ▶ de chaque morceau se remplit pendant le téléchargement.",
            "Attendez que **Audio prêt** compte tous les morceaux (par exemple 10/10) : dès lors il joue sans internet. Si un morceau ne peut pas être téléchargé, la régie vous le dit (voir plus bas).",
          ],
        },
        {
          type: "steps",
          title: "Sur scène",
          items: [
            "Touchez ▶ sur un morceau pour le lire. L’écran de chacun passe à ce morceau et affiche **En cours** avec le temps.",
            "Le lecteur en haut a **Lecture** / **Pause** ; à la fin d’un morceau, le même bouton lit le suivant. **Arrêter** demande un appui long, pour qu’un toucher par erreur ne coupe pas la musique.",
            "Un morceau sans audio, ou qui ne peut pas être lu ici, l’indique sur le lecteur, et **Lecture** devient **Lire le suivant** avec le premier morceau qui peut être lu. Pendant ce temps, le groupe le joue en live.",
            "Pour un morceau qui n’est pas dans la setlist, touchez + (**Lire un morceau hors setlist**) et choisissez-le dans le répertoire. Il entre dans la setlist juste après le morceau en cours, pour tous.",
            "Pour passer la main, l’autre admin touche **Régie : audio d’ici** sur son appareil, puis **La prendre** : votre audio s’arrête. **Désactiver** met fin à la régie sur votre appareil.",
          ],
        },
        {
          type: "table",
          head: ["Qui", "Ce qui s’affiche"],
          rows: [
            ["La régie (un admin)", "Le lecteur, ▶ sur chaque morceau avec audio, où sort le son (**Sortie**) et combien de morceaux sont prêts."],
            ["Les autres admins et les membres", "Le morceau en cours, avec **En cours** ou **En pause** et le temps. Si vous êtes sur un autre morceau, **Aller** vous y amène."],
            ["Tout le monde, quand la régie part", "Le bandeau disparaît. Le mode scène fonctionne comme avant."],
          ],
        },
        {
          type: "p",
          text: "Quand un morceau ne peut pas être téléchargé, touchez **1 non téléchargé** sous **Audio prêt** : une page donne les morceaux et la raison. Corrigez, puis touchez **Réessayer**.",
        },
        {
          type: "table",
          head: ["Ce qui s’affiche", "Que faire"],
          rows: [
            ["Le lien ne donne pas de fichier audio", "L’enregistrement du morceau est un lien qui ouvre une page, pas le fichier. Sur Google Drive, partagez le fichier avec « Tous les utilisateurs disposant du lien », ou importez le fichier dans le morceau."],
            ["Pas d’internet", "Connectez-vous : le morceau se télécharge tout seul dès que vous êtes de nouveau en ligne."],
            ["Cet appareil ne peut pas lire ce fichier", "Utilisez un fichier MP3, M4A ou WAV."],
            ["Le téléchargement s’est interrompu", "Touchez **Réessayer**."],
          ],
        },
        {
          type: "list",
          title: "Le câble vers la console",
          items: [
            "Ordinateurs portables, iPad et téléphones avec une prise casque : un câble mini-jack (3,5 mm) vers l’entrée de la console, par exemple de 3,5 mm vers deux jacks 6,35 mm ou deux RCA.",
            "iPad et iPhone sans prise jack (USB-C ou Lightning) : l’adaptateur Apple USB-C (ou Lightning) vers 3,5 mm, puis le même câble. Pour charger en même temps, prenez un adaptateur avec un port de charge USB-C (PD).",
            "Consoles avec une entrée USB (beaucoup de consoles numériques) : un seul câble USB-C fait entrer le son directement. Pareil pour une interface audio USB class compliant.",
            "Jamais en Bluetooth : le son arrive en retard et peut couper. L’app vous prévient quand le son passe en Bluetooth ou sort du haut-parleur de l’appareil.",
            "Mettez le volume de l’appareil presque au maximum et réglez le niveau sur la console.",
          ],
        },
        {
          type: "note",
          tone: "warning",
          text: "Si le câble se débranche, le son peut s’arrêter ou passer au haut-parleur de l’appareil. L’app affiche aussitôt un avertissement : rebranchez le câble.",
        },
        {
          type: "devices",
          rows: [{ devices: ["web"], text: "Sur un ordinateur portable dans le navigateur, c’est le navigateur qui garde l’audio : utilisez toujours le même et n’effacez pas ses données avant le concert. Les liens Google Drive se téléchargent aussi, si le fichier est partagé avec « Tous les utilisateurs disposant du lien »." }],
        },
      ],
    },
    {
      id: "stage-bluetooth-sync",
      title: "Le mode scène sans internet (Bluetooth)",
      summary: "Comment le groupe reste sur le même morceau en Bluetooth quand la salle n’a pas de réseau.",
      roles: ["admin", "member"],
      kind: "reference",
      keywords: ["bluetooth", "hors ligne", "pas de réseau", "pas de wifi", "ble", "clé de scène"],
      related: ["stage-mode", "lead-stage-mode", "follow-in-stage-mode", "live-mode-offline"],
      body: [
        {
          type: "p",
          text: "Dans les apps iPhone, iPad et Android, le téléphone de l’admin envoie aussi en Bluetooth le morceau en cours, l’ordre, le clic et la position dans le morceau (Suivre le tempo). Les téléphones des membres à proximité les reçoivent sans appairage et sans internet. Le décompte fait exception : il a besoin d’internet.",
        },
        {
          type: "steps",
          title: "Se préparer avant le concert",
          items: [
            "Chacun récupère la setlist sur son téléphone : accepte le téléchargement (voir [[live-mode-offline]]) ou ouvre le concert une fois en étant en ligne. La clé Bluetooth du concert vient avec.",
            "Active le Bluetooth et autorise BandWith à l’utiliser.",
            "Sur scène, chacun ouvre le mode scène. Le leader affiche **Bluetooth** ou **Live · BT** ; les membres affichent **· BT** après leur libellé de suivi.",
          ],
        },
        {
          type: "list",
          title: "Quand ça ne se connecte pas",
          items: [
            "« Le Bluetooth est désactivé ou non autorisé. Active-le dans Réglages pour rester synchronisé sans internet. »",
            "« Ce téléphone a une ancienne setlist. Connecte-toi une fois à internet pour suivre en Bluetooth. » Ce message s’affiche quand des morceaux ont été ajoutés ou retirés depuis le dernier chargement de la setlist sur ce téléphone. Un simple changement d’ordre ne pose pas de problème.",
            "« L'heure de ce téléphone et celle du leader sont très différentes. Règle la date et l'heure automatiques sur les deux. » Les messages du leader portent son heure ; s'il est très en avance sur ce téléphone, ils ne sont pas suivis, car un téléphone pourrait la falsifier.",
            "Quand quelqu’un quitte le groupe, chaque concert à venir reçoit une nouvelle clé Bluetooth. Les téléphones avec une ancienne version de BandWith gardent l’ancienne clé et ne trouvent pas les autres sans internet : après avoir mis à jour BandWith, ouvre le concert une fois en étant en ligne.",
          ],
        },
        {
          type: "note",
          tone: "privacy",
          text: "Chaque concert a sa propre clé secrète, donnée seulement aux membres actifs du groupe. Seuls les téléphones qui ont la clé trouvent le leader et acceptent ses messages.",
        },
        {
          type: "devices",
          rows: [{ devices: ["web"], text: "Pas de synchro Bluetooth ni de copie de la setlist sur l’appareil : sur le web, le mode scène a besoin d’internet." }],
        },
      ],
    },
    // ─────────────────────────── Sans réseau ───────────────────────────
    {
      id: "live-mode-offline",
      title: "Utiliser le mode scène et le mode live sans réseau",
      summary: "Ton téléphone garde les setlists de tes 7 prochains jours, avec paroles, accords et tes notes : le mode scène et le mode live marchent sans réseau.",
      roles: ["admin", "member"],
      kind: "reference",
      keywords: ["hors ligne", "sans réseau", "pas de réseau", "sans internet", "télécharger", "setlist hors ligne", "mode avion", "cave", "sous-sol", "7 jours", "garder en automatique", "offline"],
      related: ["offline-and-live-settings", "offline-members-ready", "changes-without-signal", "stage-mode", "stage-bluetooth-sync"],
      body: [
        {
          type: "p",
          text: "Beaucoup de salles n’ont pas de réseau. Dans les apps téléphone et tablette, BandWith garde sur ton appareil les setlists de tes 7 prochains jours : le mode scène et le mode live s’ouvrent et marchent sans internet.",
        },
        {
          type: "list",
          title: "Ce qui est gardé sur ton appareil",
          items: [
            "Chaque concert et chaque répétition des 7 prochains jours auxquels tu participes et qui ont une setlist. Les concerts que tu as refusés sont laissés de côté.",
            "Pour chaque morceau : titre, artiste, tonalité, BPM, les paroles avec accords et parties vocales, la grille d’accords, et qui chante quoi.",
            "Tes propres notes et fichiers sur ces morceaux. Pas les notes des autres.",
            "Jamais les cachets, les contrats ni les devis.",
          ],
        },
        {
          type: "steps",
          title: "La première fois, dis oui une fois",
          items: [
            "Environ une semaine avant le concert, tu reçois un push, par exemple « La setlist de samedi, prête sans réseau · Télécharge paroles, accords et structures pour The Loft, Brooklyn (12 morceaux). Touche pour voir ce qui est inclus. »",
            "Touche-le. Le concert s’ouvre avec une feuille : **La setlist avec vous, même sans réseau.** Elle dit ce qui est gardé, où, et à peu près combien de place ça prend.",
            "Touche **Télécharger et garder en automatique**. Cette setlist et les suivantes arrivent toutes seules, sans plus de questions.",
            "Ou touche **Seulement ce concert** (à une répétition, **Seulement cette répétition**) pour ne garder que celle-ci.",
            "Ou touche **Pas maintenant**. On te le redemande une fois, la veille.",
          ],
        },
        {
          type: "list",
          title: "Sur la page du concert",
          items: [
            "Sous la setlist, **Prêt hors ligne · mis à jour …** veut dire que la setlist est sur cet appareil et à jour.",
            "**Pas encore sur cet appareil** veut dire qu’elle n’est pas encore gardée. Touche **Télécharger pour le hors ligne** tant que tu as du réseau. La première fois, la même feuille te demande comment tu la veux.",
            "Si le téléchargement échoue, il indique « Téléchargement impossible. Réessayez avec internet. »",
          ],
        },
        {
          type: "list",
          title: "Sur scène sans réseau",
          items: [
            "Ouvre le concert ou la répétition comme d’habitude et touche **Ouvrir le mode scène**, ou **En scène** sur l’accueil. Il s’ouvre depuis la copie sur ton appareil.",
            "Une étiquette en haut indique **Hors ligne · contenu de …**, avec l’heure à laquelle la copie a été enregistrée.",
            "Les changements de morceau du leader t’arrivent quand même en Bluetooth : voir [[stage-bluetooth-sync]].",
            "Les notes et les modifications que tu fais attendent sur ton téléphone et partent au retour du réseau : voir [[changes-without-signal]].",
          ],
        },
        {
          type: "list",
          title: "Elle se met à jour toute seule",
          items: [
            "Quand un admin change la setlist ou un de ses morceaux, ta copie se met à jour quand tu ouvres l’app, quand tu y reviens, et en arrière-plan quand le téléphone le permet.",
            "La copie est supprimée le lendemain du concert, quand tu quittes le groupe ou que ton rôle change, et quand tu te déconnectes.",
          ],
        },
        {
          type: "note",
          tone: "privacy",
          text: "La copie est seulement sur ton appareil et seulement pour toi. Les admins voient si ton téléphone est prêt, jamais ce qu’il contient.",
        },
        {
          type: "roles",
          rows: [
            { role: "admin", text: "Reçoit la même question la première fois, et voit aussi qui dans le groupe est prêt : voir [[offline-members-ready]]." },
            { role: "member", text: "Dit oui une fois ; ensuite, les setlists arrivent toutes seules." },
            { role: "deputy", text: "Les remplaçants n’ont pas les setlists du groupe : rien n’est gardé pour eux." },
          ],
        },
        {
          type: "devices",
          rows: [{ devices: ["web"], text: "Sur le web, l’app a besoin d’internet pour s’ouvrir : elle ne marche pas sans réseau. Utilise l’app téléphone ou tablette sur scène." }],
        },
        { type: "shot", id: "live-pack-consent", caption: "La question la première fois : Télécharger et garder en automatique, Seulement ce concert ou Pas maintenant." },
        { type: "shot", id: "live-offline-ready", caption: "Sous la setlist : Prêt hors ligne et, pour les admins, combien de membres sont prêts." },
      ],
    },
    {
      id: "offline-and-live-settings",
      title: "Changer ton choix hors ligne dans les Réglages",
      summary: "Active ou désactive les téléchargements automatiques, attends le Wi-Fi, vois l’espace utilisé et supprime ce qui est gardé.",
      roles: ["admin", "member"],
      kind: "task",
      keywords: ["réglages", "hors ligne", "wi-fi uniquement", "supprimer hors ligne", "stockage", "espace", "téléchargement automatique", "données mobiles", "forfait"],
      related: ["live-mode-offline", "settings-overview"],
      body: [
        {
          type: "steps",
          items: [
            "Ouvre le menu, touche **Réglages et compte**, puis **Hors ligne et live**.",
            "Active **Téléchargement automatique** pour recevoir automatiquement chaque setlist de tes 7 prochains jours. Désactive-le pour qu’on te demande à chaque concert.",
            "Active **Wi-Fi uniquement** si les téléchargements automatiques doivent attendre le Wi-Fi sur cet appareil.",
            "**Espace utilisé** indique combien de setlists sont gardées et la place qu’elles prennent, par exemple « 2 setlists · 1,4 Mo ».",
            "Pour libérer la place, touche **Tout supprimer**, puis de nouveau **Tout supprimer** pour confirmer. Les setlists reviennent quand tu ouvres le concert avec du réseau.",
          ],
        },
        {
          type: "list",
          items: [
            "**Téléchargement automatique** suit ton compte sur tous tes appareils. **Wi-Fi uniquement** et ce qui est gardé ne valent que pour cet appareil.",
            "Le texte d’une setlist est léger. Ce sont tes propres fichiers sur les morceaux qui prennent le plus de place.",
          ],
        },
        { type: "shot", id: "settings-offline-live", caption: "Réglages › Hors ligne et live : Téléchargement automatique, Wi-Fi uniquement et Espace utilisé." },
      ],
    },
    {
      id: "offline-members-ready",
      title: "Voir qui a la setlist pour les endroits sans réseau",
      summary: "Sur un concert ou une répétition, vois combien de membres ont la setlist sur leur téléphone, et relance les autres.",
      roles: ["admin"],
      kind: "task",
      keywords: ["prêt", "prêt hors ligne", "rappeler", "relancer", "membres prêts", "télécharger", "4 sur 5"],
      related: ["live-mode-offline", "lead-stage-mode"],
      body: [
        {
          type: "steps",
          items: [
            "Ouvre le concert ou la répétition. Sous la setlist, repère **Hors ligne : … membres prêts sur …**.",
            "Si tout le monde est prêt, il indique « Tout le monde a la setlist sur son téléphone. » Rien d’autre à faire.",
            "Sinon, touche la ligne. Elle liste qui n’est pas encore prêt.",
            "Touche **Rappeler** à côté d’un nom. La personne reçoit un push qui lui demande de la télécharger, et le bouton indique **Rappel envoyé**.",
          ],
        },
        {
          type: "list",
          items: [
            "Un membre est prêt quand son app téléphone ou tablette a la dernière version de cette setlist. Après un changement de la setlist, il compte de nouveau une fois son téléphone mis à jour.",
            "Chaque membre reçoit au plus un rappel toutes les 6 heures pour le même concert.",
            "Les membres qui n’utilisent que l’app web ne peuvent pas être prêts : la copie pour les endroits sans réseau est dans les apps téléphone et tablette.",
          ],
        },
        {
          type: "note",
          tone: "privacy",
          text: "Tu vois seulement si un téléphone est prêt, jamais ce qu’il contient ni les notes de qui que ce soit.",
        },
      ],
    },
    {
      id: "changes-without-signal",
      title: "Les modifications faites sans réseau",
      summary: "Tes notes, tes suggestions et le nouvel ordre du leader attendent sur le téléphone et partent tout seuls au retour du réseau.",
      roles: ["admin", "member"],
      kind: "reference",
      keywords: ["modifications hors ligne", "en attente de réseau", "envoyer maintenant", "synchro", "file d’attente", "en attente", "boîte d’envoi"],
      related: ["live-mode-offline", "my-notes-and-files", "lead-stage-mode", "stage-mode"],
      body: [
        {
          type: "p",
          text: "Sans réseau, tu peux continuer à travailler en mode scène et en mode live. Ce que tu écris est enregistré tout de suite sur ton téléphone et envoyé dès que le réseau revient.",
        },
        {
          type: "list",
          title: "Ce qui attend sur ton téléphone",
          items: [
            "Tes propres notes sur un morceau ([[my-notes-and-files]]).",
            "Une **Note pour le groupe** et les modifications suggérées sur un morceau.",
            "Les notes et les marques de répétition.",
            "Le nouvel ordre de la setlist du leader en mode scène.",
          ],
        },
        {
          type: "list",
          title: "Ce que tu vois",
          items: [
            "Une barre en haut, par exemple **Hors ligne · 2 modifications en attente de réseau**. Sans rien en attente, elle indique **Hors ligne · données en cache**.",
            "Après que le leader a fait glisser un morceau sans réseau, le statut indique **Enregistré sur ce téléphone**, puis **Enregistré** une fois arrivé dans la setlist du groupe.",
            "Au retour du réseau, la barre indique **De retour en ligne · envoi de 2 modifications**, puis **De retour en ligne · tout est à jour**.",
            "Pour envoyer tout de suite sans attendre, touche **Envoyer maintenant** dans la barre.",
          ],
        },
        {
          type: "list",
          title: "Quand c’est envoyé",
          items: [
            "Dès que le réseau revient, quand tu rouvres l’app, et toutes les 30 secondes tant que quelque chose attend.",
            "Fermer l’app garde ce qui attend. Ça part la prochaine fois que tu ouvres l’app avec du réseau.",
            "Une note de répétition que le serveur refuse n’est pas jetée. Le mode live indique **Une note n’a pas été enregistrée**, et le texte de la note est listé dans les notes de la répétition et dans Réglages › Hors ligne et live, avec **Copier** et **Retirer**.",
          ],
        },
        {
          type: "note",
          tone: "tip",
          text: "Les membres à proximité voient tout de suite le nouvel ordre du leader en Bluetooth, avant qu’il soit enregistré.",
        },
        { type: "shot", id: "stage-offline-banner", caption: "Le mode scène sans réseau : l’étiquette du contenu et la barre avec les modifications en attente de réseau." },
      ],
    },
    {
      id: "stage-mode-on-devices",
      title: "Le mode scène sur téléphones, tablettes et appareils à double écran",
      summary: "Comment le mode scène s’affiche sur chaque appareil et dans chaque position.",
      roles: ["admin", "member"],
      kind: "reference",
      keywords: ["paysage", "ipad", "surface duo", "retour de scène", "position ordinateur", "plein écran", "barre latérale", "tourne-page"],
      related: ["stage-mode", "device-differences"],
      body: [
        {
          type: "devices",
          rows: [
            { devices: ["phone"], text: "Une seule colonne : en-tête, déroulé, setlist ou morceau, Précédent / Suivant en bas." },
            { devices: ["phoneLand", "duoClosed"], text: "À l’horizontale (court et large), les horaires et les étapes sont à gauche et la setlist ou le morceau à droite. Avec un morceau ouvert, la colonne de gauche affiche plutôt la setlist, pour sauter à n’importe quel morceau." },
            { devices: ["tablet", "duoBook", "duoLand"], text: "Le mode scène s’ouvre à côté du volet de liste. **Plein écran** affiche le morceau seul sur tout l’écran (**Morceau seul**). Une setlist sans paroles ni grilles prend tout l’écran à la place : les horaires et les étapes sur le premier volet et la setlist sur le second, séparés au bord des volets pour que rien ne tombe sur la charnière ; **Quitter le plein écran** fait revenir la liste. Avec un morceau ouvert, la setlist est dans une colonne à côté (sur le premier volet quand l’appareil est ouvert sur les deux)." },
            { devices: ["duoClosed"], text: "**Ouvrir le mode scène** est dans le rail ; le jour du concert, c’est l’action principale du rail. **Plein écran** masque le rail en mode scène." },
            { devices: ["duoLaptop"], text: "Retour de scène : pose l’appareil au sol sur scène comme un retour. La moitié haute affiche le compteur de morceaux (**Morceau … sur …**), le titre, la tonalité, le BPM, le morceau suivant et le temps écoulé, ou les paroles. La moitié basse a de grandes touches **Précédent** et **Suivant** et la progression du set ; les morceaux retirés pour ce soir sont sautés et leurs segments de progression atténués. Les flèches, Page préc./suiv. et Espace font aussi avancer : les pédales tourne-page Bluetooth fonctionnent." },
            { devices: ["duoBook", "duoLaptop"], text: "**Morceau seul** : sur un appareil ouvert sur les deux écrans, le morceau et ses quatre boutons prennent l’écran le plus large, pour que rien ne tombe sur la pliure. Plié comme un ordinateur portable, le morceau remplit la moitié du haut et la moitié du bas n’a que **Tout afficher**, **Précédent**, le clic et **Suivant**." },
            { devices: ["web"], text: "La synchro en direct par internet et le clic fonctionnent. Pas de Bluetooth, et pas de copie hors ligne de la setlist. Le plein écran masque aussi les barres du navigateur, là où le navigateur le permet." },
          ],
        },
        { type: "p", text: "Le bouton Retour d’Android et Échap quittent d’abord le mode scène, pas le concert en dessous." },
      ],
    },
  ],

  faq: [
    {
      q: "Les membres peuvent-ils modifier les morceaux ou les setlists ?",
      a: "Non. Les membres lisent tous les morceaux et toutes les setlists. Ils suggèrent de nouveaux morceaux et des modifications de paroles, d’accords ou de notes, et un admin les examine. Seuls les admins peuvent modifier les setlists.",
      roles: ["member"],
    },
    {
      q: "Qui voit mes notes sur un morceau ?",
      a: "Toi seul. Ni le groupe, ni les admins. Pour en partager une, ouvre-la et touche Suggérer au groupe.",
    },
    {
      q: "J’ai transposé un morceau dans le lecteur. Ça a changé pour tout le monde ?",
      a: "Non. Transposer dans le lecteur ou en mode scène ne change que ton écran. Pour changer la tonalité pour le groupe, un admin utilise Transposer pour le groupe dans le formulaire du morceau.",
    },
    {
      q: "Pourquoi je ne peux pas importer une liste de morceaux ?",
      a: "Une liste importée va directement dans la bibliothèque du groupe : c’est réservé aux admins. Les membres suggèrent les morceaux un par un.",
      roles: ["member"],
    },
    {
      q: "Modifier la setlist d’un concert change-t-il la setlist enregistrée que j’ai chargée ?",
      a: "Non. Un concert reçoit sa propre copie, nommée d’après le concert. La setlist que tu as chargée reste telle quelle.",
      roles: ["admin"],
    },
    {
      q: "Le groupe reçoit-il une notification à chaque morceau que je déplace ?",
      a: "Non. Rien n’est envoyé tant que tu n’as pas enregistré. Ensuite, chacun reçoit un seul push qui résume les changements.",
      roles: ["admin"],
    },
    {
      q: "Le mode scène marche-t-il sans internet ?",
      a: "Dans les apps téléphone et tablette, oui. Dis oui une fois au téléchargement et les setlists de tes 7 prochains jours restent sur ton téléphone ; le téléphone du leader garde le groupe sur le même morceau en Bluetooth. Sur le web, le mode scène a besoin d’internet.",
    },
    {
      q: "Mon téléphone télécharge-t-il les setlists sans demander ?",
      a: "Non. La première fois, une feuille te le demande. Choisis Télécharger et garder en automatique et les setlists suivantes arrivent toutes seules. Tu peux changer ça à tout moment dans Réglages › Hors ligne et live.",
    },
    {
      q: "Les setlists sur mon téléphone contiennent-elles les cachets ou les contrats ?",
      a: "Non. Seulement les paroles, les accords, les structures, les parties vocales et tes propres notes et fichiers. Les cachets, les contrats, les devis et les notes des autres membres ne vont jamais sur ton téléphone.",
    },
    {
      q: "Pourquoi certaines lignes des paroles sont-elles atténuées ?",
      a: "Mettre ma partie en avant est activé : les lignes que tu ne chantes pas sont un peu atténuées. Touche Mettre ma partie en avant en haut du morceau pour toutes les voir.",
    },
    {
      q: "Est-ce que j’entends le clic ?",
      a: "Non. Le clic est visuel : une lueur sur le bord de l’écran à chaque temps.",
    },
    {
      q: "Pourquoi mon téléphone ne suit plus le leader ?",
      a: "Toucher toi-même Précédent, Suivant ou un morceau arrête le suivi. Touche Suivre le leader pour revenir au morceau du leader.",
      roles: ["member"],
    },
    {
      q: "Que devient un morceau suggéré que l’admin refuse ?",
      a: "Il est supprimé avec les fichiers que tu as joints, et tu reçois un push avec le motif de l’admin s’il en a donné un.",
      roles: ["member"],
    },
    {
      q: "Pourquoi je ne vois pas le forum iReal Pro dans l’app sur le web ?",
      a: "Le forum ne peut pas s’afficher dans une page web : il s’ouvre dans sa propre fenêtre. Copie un lien là-bas et touche Coller le lien, ou fais glisser le lien sur la zone.",
    },
    {
      q: "Pourquoi n’y a-t-il pas de bouton Décompte sur un morceau ?",
      a: "Le morceau est réglé sur Joué avec une bande, ou la régie est en train de le lire. Le leader peut quand même décompter le groupe : il ouvre les options du décompte et touche Lancer le décompte quand même. Un morceau sans BPM ne peut pas être décompté.",
    },
  ],

  glossary: [
    { term: "Répertoire", definition: "La bibliothèque de morceaux du groupe. Chaque membre actif lit tous les morceaux.", see: "repertoire-overview" },
    { term: "Prêt / À l’étude / Suggéré", definition: "Le statut d’un morceau : joué par le groupe, en cours d’apprentissage, ou proposé par un membre et en attente d’un admin.", see: "song-menu-actions" },
    { term: "Setlist", definition: "Une liste ordonnée de morceaux du groupe pour un concert ou une occasion, préparée par les admins.", see: "build-a-setlist" },
    { term: "Set", definition: "Une partie d’une setlist, par exemple avant et après une pause (Set 1, Set 2).", see: "setlists-and-sets" },
    { term: "Setlist modèle", definition: "Une setlist enregistrée que tu charges dans un concert ; le concert reçoit sa propre copie.", see: "setlists-and-sets" },
    { term: "Accords dans le texte", definition: "Des accords écrits entre crochets juste avant le mot sur lequel ils tombent, comme [Am]mot.", see: "lyrics-and-chords-format" },
    { term: "ChordPro", definition: "Un format texte pour les paroles avec les accords entre crochets. BandWith importe les fichiers .cho, .chordpro et .pro.", see: "import-chords-and-lyrics" },
    { term: "MusicXML", definition: "Un format de fichier pour les partitions. BandWith lit ses symboles d’accords et ses paroles.", see: "import-chords-and-lyrics" },
    { term: "Grille iReal Pro", definition: "Une grille d’accords mesure par mesure, avec forme, tonalité, style et tempo, importée depuis un lien iReal Pro.", see: "import-from-ireal-pro" },
    { term: "Vue du morceau", definition: "La façon d’afficher un morceau : Paroles, Paroles et accords ou Grille d’accords. Mémorisée par appareil.", see: "read-a-song" },
    { term: "Grille d’accords", definition: "Les accords seuls : les sections du morceau avec leurs accords dans des cases, ou la grille iReal mesure par mesure.", see: "read-a-song" },
    { term: "Morceau seul", definition: "Le plein écran du mode scène et du mode live : seulement le morceau, une petite ligne qui le nomme, et Tout afficher, Précédent, le clic et Suivant en bas.", see: "stage-mode" },
    { term: "Transposer pour le groupe", definition: "Changer la tonalité, la grille et les accords d’un morceau pour tout le monde, depuis le formulaire du morceau.", see: "transpose-and-tempo" },
    { term: "Mes notes", definition: "Des notes et fichiers privés sur un morceau du groupe, visibles par toi seul.", see: "my-notes-and-files" },
    { term: "Suggestion", definition: "La proposition d’un membre : un nouveau morceau, une correction de paroles ou d’accords, ou une note pour le groupe.", see: "review-song-suggestions" },
    { term: "Mode scène", definition: "L’écran noir du jour du concert, avec le déroulé, la setlist et le morceau en cours.", see: "stage-mode" },
    { term: "Leader", definition: "En mode scène, l’admin du groupe dont les changements de morceau et d’ordre arrivent chez chaque membre.", see: "lead-stage-mode" },
    { term: "Suivre le leader", definition: "Le réglage du mode scène d’un membre qui cale son morceau en cours sur celui du leader.", see: "follow-in-stage-mode" },
    { term: "Clic", definition: "Le métronome visuel du mode scène : une lueur à chaque temps, synchronisée entre les téléphones.", see: "stage-click" },
    { term: "Déroulé", definition: "Les horaires d’arrivée, de balance, de concert et de fin en haut du mode scène.", see: "stage-mode" },
    { term: "Retour de scène", definition: "Le mode scène sur un appareil à double écran en position ordinateur : infos du morceau en haut, grandes touches Précédent / Suivant en bas.", see: "stage-mode-on-devices" },
    { term: "Setlist hors ligne", definition: "La copie de la setlist d’un concert ou d’une répétition gardée sur ton téléphone pour quand il n’y a pas de réseau : paroles, accords, parties vocales et tes propres notes.", see: "live-mode-offline" },
    { term: "Partie vocale", definition: "Qui chante une ligne ou quelques mots : Voix principale, Seconde voix, Chœurs, Tous ou Parlé, chacune avec son propre aspect.", see: "voice-parts" },
    { term: "Mettre ma partie en avant", definition: "Un interrupteur sur chaque appareil qui garde bien visibles les lignes que tu chantes et atténue un peu les autres.", see: "highlight-my-part" },
    { term: "Décompte", definition: "Le compte à rebours sur chaque téléphone, au tempo et dans la mesure du morceau, qui finit par TOP là où le groupe entre.", see: "count-in" },
    { term: "Suivre le tempo", definition: "Un interrupteur sur chaque appareil qui fait avancer la grille d’accords ou les paroles avec le morceau, calées sur le leader.", see: "follow-the-tempo" },
  ],
};

export default music;
