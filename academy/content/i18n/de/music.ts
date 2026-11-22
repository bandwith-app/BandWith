import type { AreaText } from '../../types';

const music: AreaText = {
  area: {
    id: "music",
    title: "Repertoire, Setlists & Bühne",
    intro:
      "Halte die Songs der Band in einer Bibliothek, stell Setlists für Gigs zusammen und lies Songtexte und Akkorde auf der Bühne, alle beim selben Song.",
    icon: "music",
  },

  articles: [
    // ───────────────────────────── Repertoire ─────────────────────────────
    {
      id: "repertoire-overview",
      title: "Der Bildschirm Repertoire",
      summary: "Wo die Songs und Setlists der Band liegen und was jeder Teil des Bildschirms macht.",
      roles: ["admin", "member"],
      kind: "reference",
      keywords: ["Songs", "Bibliothek", "Katalog", "Repertoire", "Songliste", "Bereitschaft"],
      related: ["add-a-song", "song-menu-actions", "build-a-setlist", "music-what-members-can-do"],
      body: [
        {
          type: "p",
          text: "Das Repertoire ist die Song-Bibliothek der Band. Jeder Song darin gehört der Band, und jedes aktive Mitglied kann jeden Song lesen. Setlists werden aus diesen Songs zusammengestellt.",
        },
        {
          type: "steps",
          title: "Repertoire öffnen",
          items: [
            "Tippe auf Start unter **Schnellzugriff** auf die Kachel **Repertoire**.",
            "Oder tippe oben auf deinen Avatar (**Profil und Konto öffnen**) und dann unter **Band-Ressourcen & Abläufe** auf **Repertoire**.",
          ],
        },
        {
          type: "list",
          title: "Was du auf dem Bildschirm siehst",
          items: [
            "**Songs** und **Setlists** oben wechseln zwischen den beiden Listen. Jede zeigt, wie viele es gibt.",
            "Das Suchfeld filtert die Liste, auf der du gerade bist: **Songs, Künstler suchen…** findet Titel und Künstler, **Setlists suchen…** findet Namen von Setlists.",
            "Die Karte **Band-Repertoire** zeigt die Zahl der **Songs** und **Setlists**, die **Gesamtdauer** aller Songs und die **Bereitschaft**: ein Punkt pro Song, gefärbt nach Status, darunter die Zahlen für **Bereit**, **Wird geübt** und **Vorschlag**.",
            "Jede Songzeile zeigt Titel, Künstler und Tonart, die Dauer und das BPM. Ein Etikett **Vorschlag** oder **Wird geübt** erscheint, wenn der Song noch nicht bereit ist.",
            "Der runde Button **Abspielen** links in einer Zeile spielt die Aufnahme des Songs ab oder öffnet seinen Link. Er ist ausgegraut, wenn der Song beides nicht hat.",
            "Tippe an eine andere Stelle einer Songzeile, um ihr Menü zu öffnen (siehe [[song-menu-actions]]).",
            "Über den Songs sehen Admins **Vorschläge der Mitglieder**, wenn etwas auf Prüfung wartet; Mitglieder sehen immer **Meine Vorschläge** (siehe [[review-song-suggestions]] und [[suggest-a-change-to-a-song]]).",
          ],
        },
        {
          type: "table",
          head: ["Status", "Bedeutung"],
          rows: [
            ["**Bereit**", "Die Band spielt ihn. Songs, die ein Admin hinzufügt oder importiert, starten hier."],
            ["**Wird geübt**", "Die Band arbeitet daran. Ein angenommener Vorschlag startet hier."],
            ["**Vorschlag**", "Ein Mitglied hat ihn vorgeschlagen. Er wartet darauf, dass ein Admin ihn annimmt oder ablehnt."],
          ],
        },
        {
          type: "roles",
          rows: [
            { role: "admin", text: "Sieht in der Songliste oben rechts **Songliste importieren** und **Song hinzufügen** und in der Setlist-Liste **Neue Setlist**. Kann jeden Song bearbeiten, seinen Status ändern und ihn löschen." },
            { role: "member", text: "Liest jeden Song und jede Setlist. Der +-Button oben rechts ist in der Songliste **Song vorschlagen**; in der Setlist-Liste gibt es keinen Button." },
            { role: "deputy", text: "Eine Vertretung ist kein Bandmitglied und hat kein Repertoire. Vertretungen sehen nur die Gigs, für die sie angefragt wurden (siehe [[deputy-gigs]])." },
          ],
        },
        {
          type: "devices",
          rows: [
            { devices: ["tablet", "duoBook", "duoLand"], text: "Das Repertoire ist die Listenspalte. Eine Setlist, ein Songformular oder die Vorschläge öffnen sich daneben im zweiten Bereich." },
            { devices: ["duoLaptop"], text: "Die Karte **Band-Repertoire** wandert in die obere Hälfte (das Display), die Listen bleiben in der unteren Hälfte." },
          ],
        },
        { type: "shot", id: "music-repertoire", caption: "Das Repertoire mit der Karte Band-Repertoire und der Songliste." },
      ],
    },
    {
      id: "add-a-song",
      title: "Einen Song zum Repertoire hinzufügen",
      summary: "Füge einen Song in drei kurzen Schritten hinzu; nur der Titel ist Pflicht.",
      roles: ["admin"],
      kind: "task",
      keywords: ["neuer Song", "Song anlegen", "Titel hinzufügen", "Songformular"],
      related: ["song-fields", "suggest-a-song", "import-a-song-list", "import-chords-and-lyrics"],
      body: [
        {
          type: "steps",
          items: [
            "Tippe im Repertoire bei **Songs** auf **Song hinzufügen** (den +-Button oben rechts). Ist die Bibliothek leer, kannst du auch auf **Ersten Song hinzufügen** tippen.",
            "Gib in Schritt 1, **Song**, den **Songtitel \\*** ein. Füge den **Originalinterpret** hinzu, wenn du ihn kennst. Um gleich Akkorde oder Songtext mitzubringen, tippe auf **Akkorde und Songtexte importieren** (siehe [[import-chords-and-lyrics]]).",
            "Tippe auf **Weiter**. Fülle in Schritt 2, **Details · optional**, nach Belieben **Dauer**, **BPM**, **Tonart** und **Genre** aus.",
            "Tippe auf **Weiter**. Füge in Schritt 3, **Dateien & Links · optional**, eine Aufnahme, ein Chart, Links, Notizen oder einen Songtext hinzu.",
            "Tippe auf **Song hinzufügen**. Der Button wird zu **Hinzugefügt!** und das Formular schließt sich.",
          ],
        },
        {
          type: "p",
          text: "Du kannst in jedem Schritt speichern: Tippe unter den Feldern auf **Song jetzt hinzufügen**, um mit dem zu speichern, was du bisher eingegeben hast.",
        },
        {
          type: "note",
          tone: "tip",
          text: "Ist schon ein Song mit demselben Titel und Künstler in der Bibliothek, sagt das Formular „… ist schon in deiner Bibliothek. Speichere noch einmal, um eine zweite Kopie hinzuzufügen.“ Tippe nur dann noch einmal auf Speichern, wenn du wirklich zwei Kopien willst.",
        },
        {
          type: "list",
          title: "Was nach dem Speichern passiert",
          items: [
            "Der Song wird mit dem Status **Bereit** hinzugefügt.",
            "Alle anderen in der Band bekommen einen Hinweis in ihrem Mitteilungs-Posteingang (ohne Push).",
            "Ausgewählte Dateien werden beim Speichern hochgeladen, in den privaten Speicher der Band. Schlägt das Speichern fehl, werden sie wieder entfernt.",
          ],
        },
        {
          type: "roles",
          rows: [
            { role: "admin", text: "Fügt Songs direkt als **Bereit** in die Bibliothek ein." },
            { role: "member", text: "Nutzt dasselbe Formular mit dem Titel **Song vorschlagen**. Der Song wird als **Vorschlag** hinzugefügt und wartet auf einen Admin. Siehe [[suggest-a-song]]." },
          ],
        },
        {
          type: "devices",
          rows: [
            { devices: ["duoClosed"], text: "**Schließen** sitzt in der Leiste unter der Uhr statt oben rechts im Formular." },
            { devices: ["tablet", "duoBook", "duoLand"], text: "Das Formular öffnet sich im zweiten Bereich, neben dem Repertoire." },
          ],
        },
      ],
    },
    {
      id: "song-fields",
      title: "Alle Felder eines Songs",
      summary: "Was jedes Feld im Songformular macht, mit den geltenden Grenzen.",
      roles: ["admin", "member"],
      kind: "reference",
      keywords: ["Songdetails", "BPM", "Tonart", "Dauer", "Genre", "Aufnahme", "Chart", "YouTube", "Notizen", "Songtext"],
      related: ["add-a-song", "transpose-and-tempo", "lyrics-and-chords-format", "play-a-song-recording"],
      body: [
        { type: "p", text: "Das Songformular hat drei Schritte. Nur der Titel ist Pflicht; die anderen Schritte sind als „optional“ markiert und lassen sich überspringen." },
        {
          type: "table",
          head: ["Feld", "Was es macht"],
          rows: [
            ["**Songtitel \\***", "Der Name des Songs. Pflichtfeld."],
            ["**Originalinterpret**", "Steht überall unter dem Titel und hilft, Duplikate zu erkennen."],
            ["**Akkorde und Songtexte importieren**", "Holt ein Akkordchart und einen Songtext aus dem iReal Pro Forum, einer Datei oder der Zwischenablage. Ist ein Chart zugeordnet, zeigt eine Karte **Akkordchart** Tonart, Stil, Tempo, Takte und Teile, mit **Akkorde ansehen**, **Ersetzen** und einem X zum Entfernen."],
            ["**Dauer**", "Minuten und Sekunden in zwei Feldern (Min : Sek). Wird für die Summen der Setlists verwendet."],
            ["**BPM**", "Tempo, bis zu 3 Ziffern. Der Klick im Bühnenmodus nutzt es."],
            ["**Tonart**", "Freier Text, z. B. C-Dur. Erscheint in der Liste, auf der Bühne und in der Transponierung des Readers."],
            ["**Tap**, **BPM aus der Aufnahme**, ÷2 / ×2", "Werkzeuge unter BPM, um das Tempo zu finden. Siehe [[transpose-and-tempo]]."],
            ["**Für die Band transponieren**", "Verschiebt Tonart, Akkordchart und die Akkorde im Songtext für alle. Erscheint nur, wenn es etwas zu transponieren gibt."],
            ["**Genre**", "Tags aus den Genres der Band oder ein neues über den gestrichelten Chip **Genre** und dann **Genre hinzufügen**. Genres filtern die Bibliothek, wenn du eine Setlist zusammenstellst."],
            ["**Aufnahme**", "Eine Audiodatei: MP3, M4A, WAV, max. 50 MB."],
            ["**Leadsheet / Noten**", "Ein PDF oder Foto, max. 20 MB."],
            ["**Dateien wählen**", "Wählt eine oder mehrere Dateien. Die App sortiert sie nach Typ in Aufnahme oder Chart. Dateien aus iCloud Drive, Google Drive oder Dropbox: Tippe auf **Dateien wählen**, dann auf **Durchsuchen** und wähle die App unter Orte."],
            ["**YouTube-Video**", "Ein Link zum Song auf YouTube. Muss mit https:// beginnen."],
            ["**Noten**", "Ein Link zu einem PDF oder Noten online, statt eines hochgeladenen Charts. Muss mit https:// beginnen."],
            ["**Akkorde**", "Ein Link zu einer Akkordseite. Er wird in den Notizen des Songs als „Chords: <link>“ gespeichert. Muss mit https:// beginnen."],
            ["**Notizen**", "Notizen der Band zum Song: Arrangement-Ideen, Tonartwechsel."],
            ["**Songtext · Text, Markdown oder JSON**", "Der Songtext, auf Wunsch mit Akkorden in der Zeile. Siehe [[lyrics-and-chords-format]]. **Songtext einfügen oder importieren** unter dem Feld öffnet das Import-Fenster auf dem Tab Songtext."],
          ],
        },
        {
          type: "note",
          tone: "privacy",
          text: "Hochgeladene Aufnahmen und Charts werden privat für deine Band gespeichert: Nur Bandmitglieder können sie öffnen.",
        },
        {
          type: "note",
          tone: "tip",
          text: "Ist der Titel leer, wenn du eine Datei wählst, wird der Dateiname zum Titel.",
        },
      ],
    },
    {
      id: "song-menu-actions",
      title: "Song-Menü: alle Aktionen",
      summary: "Was jeder Eintrag im Menü eines Songs macht und wer ihn sieht.",
      roles: ["admin", "member"],
      kind: "reference",
      keywords: ["Song-Aktionen", "Song-Optionen", "Menü", "Ultimate Guitar", "als bereit markieren"],
      related: ["read-a-song", "edit-or-delete-a-song", "play-a-song-recording", "chord-editor"],
      body: [
        { type: "p", text: "Tippe im Repertoire auf eine Songzeile, um ihr Menü zu öffnen. Einträge erscheinen nur, wenn sie für diesen Song gelten." },
        {
          type: "table",
          head: ["Eintrag", "Was er macht", "Wer"],
          rows: [
            ["**Abspielen**", "Spielt die Aufnahme im Mini-Player ab oder öffnet den Spotify- oder YouTube-Link.", "Alle, wenn der Song eine Aufnahme oder einen Link hat"],
            ["**Songtext**", "Öffnet den Song-Reader beim Songtext.", "Alle, wenn der Song einen Songtext hat"],
            ["**Akkordchart**", "Öffnet den Song-Reader beim Akkordchart.", "Alle, wenn der Song ein iReal-Chart hat"],
            ["**Chart öffnen**", "Öffnet das hochgeladene Chart oder den Noten-Link.", "Alle, wenn der Song eins hat"],
            ["**In Ultimate Guitar öffnen**", "Öffnet eine Suche nach dem Song auf Ultimate Guitar, außerhalb der App.", "Alle"],
            ["**Akkorde bearbeiten**", "Öffnet den Akkord-Editor.", "Admins, wenn der Song einen Songtext hat"],
            ["**Ändern**", "Öffnet das Songformular.", "Admins"],
            ["**Änderung vorschlagen**", "Schickt dem Admin eine Korrektur oder eine Notiz.", "Mitglieder"],
            ["**Als bereit markieren**", "Setzt den Status auf Bereit.", "Admins, wenn der Song nicht Bereit ist"],
            ["**Annehmen · üben**", "Nimmt einen vorgeschlagenen Song an und setzt ihn auf Wird geübt.", "Admins, bei einem Song mit Vorschlag"],
            ["**Wieder üben**", "Setzt einen bereiten Song zurück auf Wird geübt.", "Admins, bei einem bereiten Song"],
            ["**Löschen**", "Löscht den Song nach einer Bestätigung.", "Admins"],
          ],
        },
        {
          type: "note",
          tone: "tip",
          text: "Setzt du einen vorgeschlagenen Song über dieses Menü auf Wird geübt oder Bereit, nimmst du den Vorschlag des Mitglieds an; löschst du ihn, lehnst du ihn ab. In beiden Fällen wird das Mitglied, das ihn vorgeschlagen hat, informiert.",
        },
      ],
    },
    {
      id: "edit-or-delete-a-song",
      title: "Einen Song bearbeiten, annehmen oder löschen",
      summary: "Ändere die Details oder den Status eines Songs oder entferne ihn aus der Bibliothek.",
      roles: ["admin"],
      kind: "task",
      keywords: ["Song ändern", "Song aktualisieren", "Song entfernen", "Songstatus", "Song annehmen"],
      related: ["song-fields", "song-menu-actions", "music-notifications"],
      body: [
        {
          type: "steps",
          title: "Einen Song bearbeiten",
          items: [
            "Tippe im Repertoire auf die Songzeile und dann auf **Ändern**.",
            "Ändere, was du brauchst, in einem der drei Schritte. Tippe auf **Jetzt speichern**, um aus Schritt 1 oder 2 zu speichern, oder auf **Weiter** und dann in Schritt 3 auf **Song speichern**.",
          ],
        },
        {
          type: "p",
          text: "Gespeichert werden nur die Felder, die du geändert hast; ändert jemand aus der Band gleichzeitig ein anderes Feld, bleibt das erhalten. Der Rest der Band bekommt eine Push-Mitteilung, zum Beispiel „Song aktualisiert · Paper Boats“ mit „Leo M. hat geändert: Tonart, Tempo.“",
        },
        {
          type: "steps",
          title: "Den Status eines Songs ändern",
          items: [
            "Tippe auf die Songzeile.",
            "Tippe auf **Als bereit markieren**, **Annehmen · üben** oder **Wieder üben**. Das Etikett in der Zeile ändert sich sofort.",
          ],
        },
        {
          type: "steps",
          title: "Einen Song löschen",
          items: [
            "Tippe auf die Songzeile und dann auf **Löschen**.",
            "Lies die Bestätigung: Sie nennt die Setlists, aus denen der Song verschwindet, und die kommenden Gigs, in denen er gespielt wird.",
            "Tippe zum Bestätigen auf **Löschen** oder auf **Abbrechen**.",
          ],
        },
        {
          type: "note",
          tone: "warning",
          text: "Wenn du einen Song löschst, verschwindet er aus jeder Setlist, in der er steht, und seine hochgeladene Aufnahme und sein Chart werden endgültig gelöscht. Das lässt sich nicht rückgängig machen.",
        },
        {
          type: "roles",
          rows: [
            { role: "admin", text: "Bearbeitet jeden Song der Band, ändert seinen Status und löscht ihn." },
            { role: "member", text: "Kann Songs der Band nicht bearbeiten oder löschen. Nutzt stattdessen **Änderung vorschlagen** (siehe [[suggest-a-change-to-a-song]])." },
          ],
        },
      ],
    },
    {
      id: "lyrics-and-chords-format",
      title: "So werden Songtexte und Akkorde geschrieben",
      summary: "Das Songformat der Band: Teile, Akkorde in der Zeile und was die App beim Speichern aufräumt.",
      roles: ["admin", "member"],
      kind: "reference",
      keywords: ["ChordPro", "Markdown", "Teile", "Strophe", "Refrain", "Akkorde im Text", "Format", "JSON"],
      related: ["read-a-song", "chord-editor", "import-chords-and-lyrics"],
      body: [
        { type: "p", text: "Songtexte sind einfacher Text mit ein paar simplen Zeichen. Derselbe Text enthält Wörter und Akkorde, so dient ein Song dem Gesang und den Instrumenten." },
        {
          type: "list",
          title: "Die Zeichen",
          items: [
            "Ein Teil beginnt mit einer Überschriftszeile: `# Verse 1` oder `[Chorus]`.",
            "Eine Leerzeile trennt Strophen.",
            "Ein Akkord steht in Klammern direkt vor dem Wort, auf das er fällt: `[Am]word`. Im Reader erscheint er über diesem Wort.",
            "`**bold**` und `*italic*` funktionieren innerhalb einer Zeile.",
            "Auch JSON geht, zum Beispiel eine Liste von Zeilen oder eine Liste von Teilen mit Namen und Zeilen.",
          ],
        },
        {
          type: "list",
          title: "Was die App beim Speichern des Songs aufräumt",
          items: [
            "Teilnamen werden vereinheitlicht: „Rit.“ wird zu Chorus, „[Strofa 2]“ zu Verse 2. Namen auf Italienisch, Spanisch, Französisch, Deutsch und Portugiesisch werden erkannt.",
            "Strophen ohne Nummer werden nummeriert, wenn es mehrere gibt.",
            "Eine Akkordzeile über einer Textzeile (Akkorde-über-Text-Blätter) wird zu Akkorden in der Zeile zusammengeführt.",
            "Ein Akkord vor einem Leerzeichen wird an das nächste Wort gehängt.",
          ],
        },
        {
          type: "p",
          text: "Die Teilnamen stehen im Text auf Englisch, aber jede Person sieht sie in ihrer eigenen App-Sprache.",
        },
        {
          type: "note",
          tone: "tip",
          text: "Lässt sich der Songtext nicht darstellen, sagt der Reader „Dieser Songtext kann nicht angezeigt werden. Prüf sein Format unter „Song ändern“.“",
        },
      ],
    },
    {
      id: "read-a-song",
      title: "Songtexte und Akkorde lesen",
      summary: "Öffne einen Song im Vollbild-Reader, wechsle die Ansicht, ändere die Schriftgröße und transponiere für dich.",
      roles: ["admin", "member"],
      kind: "task",
      keywords: ["Songtext", "Akkorde", "Struktur", "Reader", "Schriftgröße", "Songansicht", "Chart", "Text & Akkorde", "Akkordchart"],
      related: ["lyrics-and-chords-format", "transpose-and-tempo", "my-notes-and-files", "stage-mode"],
      body: [
        {
          type: "steps",
          items: [
            "Tippe im Repertoire auf die Songzeile und dann auf **Songtext** oder **Akkordchart**. Im Mini-Player tippst du auf **Songtext**.",
            "Wechsle mit den Tabs unter dem Titel zwischen **Songtext**, **Text & Akkorde** und **Akkordchart**. Es erscheinen nur die Ansichten, die der Song hat.",
            "Tippe oben auf die Buttons − und + (**Kleinere Schrift**, **Größere Schrift**), um die Schriftgröße zu ändern.",
            "Um in einer anderen Tonart zu lesen, nutze − und + neben der Tonart unter den Tabs. Tippe auf die Tonart, um zum Original zurückzukehren.",
            "Tippe auf X (**Songtext schließen**), um den Reader zu schließen.",
          ],
        },
        {
          type: "table",
          head: ["Ansicht", "Was sie zeigt"],
          rows: [
            ["**Songtext**", "Nur die Wörter, Akkorde ausgeblendet."],
            ["**Text & Akkorde**", "Die Wörter mit ihren Akkorden darüber oder das iReal-Chart, wenn der Songtext keine Akkorde hat."],
            ["**Akkordchart**", "Nur die Akkorde: das iReal-Chart Takt für Takt oder die Akkordfolge jedes Teils in Kästchen."],
          ],
        },
        {
          type: "list",
          title: "Deine Ansicht wird gemerkt",
          items: [
            "Beim ersten Mal öffnet der Reader die Ansicht für dein Instrument in der Band: Gesang bei Songtext; Gitarre, Keys und Bass bei Text & Akkorde; Schlagzeug, Percussion und Bläser bei Akkordchart.",
            "Danach öffnet er die Ansicht, die du zuletzt auf diesem Gerät gewählt hast. Dieselbe Wahl gilt im Bühnenmodus.",
            "Die Schriftgröße bleibt auf diesem Gerät gespeichert und gilt auch im Bühnenmodus.",
          ],
        },
        {
          type: "p",
          text: "Läuft der Song im Mini-Player, erscheint in der Kopfzeile des Readers ein Play/Pause-Button. Admins sehen dort außerdem **Akkorde bearbeiten**.",
        },
        {
          type: "devices",
          rows: [
            { devices: ["duoLaptop"], text: "Der Song füllt die obere Hälfte (das Display), die Bedienelemente des Readers wandern in die untere Hälfte (das Deck)." },
            { devices: ["tablet", "duoBook", "duoLand"], text: "Der Reader öffnet sich im zweiten Bereich, neben dem Repertoire." },
          ],
        },
        { type: "shot", id: "music-reader", caption: "Der Song-Reader mit den Tabs Songtext, Text & Akkorde und Akkordchart." },
      ],
    },
    {
      id: "chart-symbols",
      title: "Die Symbole in einem Akkordchart",
      summary: "Was jedes Zeichen in einem iReal-Pro- oder MusicXML-Chart bedeutet: Wiederholungen, Schlüsse, Segno, Coda und der Rest.",
      roles: ["admin", "member"],
      kind: "reference",
      keywords: ["symbole", "legende", "zeichen", "wiederholung", "segno", "coda", "d.c.", "d.s.", "fine", "schluss", "volta", "fermate", "n.c.", "schrägstrich", "taktart"],
      related: ["read-a-song", "import-from-ireal-pro", "chord-editor", "stage-mode"],
      body: [
        {
          type: "p",
          text: "Charts aus iReal Pro oder einer MusicXML-Datei zeigen die Form überall mit denselben Zeichen: im Song-Reader, im Akkord-Editor, im Bühnenmodus und im Live-Modus. Unter jedem Chart öffnet **Was die Symbole bedeuten** diese Liste.",
        },
        {
          type: "symbols",
          title: "Die Symbole",
          rows: [
            { symbol: "section", name: "A", text: "Teil: der Buchstabe eines Teils (A, B…). Intro und Strophe stehen als Wort da." },
            { symbol: "time-signature", name: "3/4", text: "Taktart: ab diesem Takt (hier 3 Viertel)." },
            { symbol: "repeat-start", text: "Wiederholung Anfang: hier beginnt der wiederholte Teil." },
            { symbol: "repeat-end", text: "Wiederholung Ende: zurück zum Anfang der Wiederholung und noch einmal spielen." },
            { symbol: "ending", n: 1, text: "1. Schluss: beim ersten Mal spielen; beim zweiten Mal zum 2. Schluss springen." },
            { symbol: "repeat-bar", text: "Den vorigen Takt noch einmal spielen." },
            { symbol: "repeat-two-bars", text: "Die zwei vorigen Takte noch einmal spielen." },
            { symbol: "repeat-times", n: 3, text: "Diesen Teil 3-mal spielen." },
            { symbol: "segno", text: "Segno: wohin dich D.S. zurückschickt." },
            { symbol: "coda", text: "Coda: beim ersten Coda-Zeichen zum zweiten springen, dem Schlussteil." },
            { symbol: "to-coda", text: "Zur Coda: jetzt zur Coda springen." },
            { symbol: "dc-al-coda", text: "D.C. al Coda: zurück zum Anfang, dann zur Coda springen." },
            { symbol: "ds-al-coda", text: "D.S. al Coda: zurück zum Segno, dann zur Coda springen." },
            { symbol: "dc-al-fine", text: "D.C. al Fine: zurück zum Anfang, bei Fine aufhören." },
            { symbol: "fine", text: "Fine: hier endet das Stück, nach einem D.C. oder D.S." },
            { symbol: "fermata", text: "Fermate: den Akkord aushalten." },
            { symbol: "no-chord", text: "N.C.: kein Akkord, die Band stoppt." },
            { symbol: "slash", text: "Gleicher Akkord auf dem nächsten Schlag." },
            { symbol: "double-bar", text: "Doppelstrich: ein Teil endet." },
            { symbol: "final-bar", text: "Schlussstrich: das Stück endet." },
            { symbol: "end", text: "End: wo das Stück aufhört." },
          ],
        },
        {
          type: "list",
          title: "Gut zu wissen",
          items: [
            "Screenreader sagen den Namen jedes Zeichens in deiner Sprache (zum Beispiel „Vorigen Takt wiederholen“).",
            "Wörter auf einem Takt, die kein Zeichen sind („Solo on AABA“), bleiben wie geschrieben.",
            "Auch Charts, die vor diesem Update importiert wurden, zeigen die Zeichen. Eine Fermate, ein Schrägstrich oder eine Zwei-Takt-Wiederholung, die fehlte, kommt zurück, wenn du das Chart neu importierst.",
          ],
        },
      ],
    },
    {
      id: "transpose-and-tempo",
      title: "Einen Song transponieren und sein Tempo finden",
      summary: "Ändere die Tonart für die ganze Band oder nur auf deinem Bildschirm und setz das BPM per Tippen oder aus der Aufnahme.",
      roles: ["admin", "member"],
      kind: "task",
      keywords: ["transponieren", "Tonartwechsel", "Halbton", "BPM", "Tap Tempo", "Tempoerkennung"],
      related: ["song-fields", "read-a-song", "stage-click"],
      body: [
        {
          type: "table",
          head: ["Wo", "Was es ändert", "Wer"],
          rows: [
            ["Songformular, **Für die Band transponieren**", "Tonart, Akkordchart und die Akkorde im Songtext, für alle, sobald du speicherst.", "Admins"],
            ["Reader und Bühnenmodus, − Tonart +", "Nur das, was dein Bildschirm zeigt. Für die Band bleibt der Song in seiner Tonart. Wird pro Song auf diesem Gerät gespeichert.", "Alle"],
          ],
        },
        {
          type: "steps",
          title: "Für die ganze Band transponieren",
          items: [
            "Öffne das Menü des Songs und tippe auf **Ändern**, dann auf **Weiter**, um zu **Details · optional** zu kommen.",
            "Tippe unter **Tonart** auf **Einen Halbton tiefer** (−) oder **Einen Halbton höher** (+). Die Zahl dazwischen zeigt, wie weit du verschoben hast.",
            "Tippe auf **Jetzt speichern**. Die Band wird informiert, dass sich Tonart und Akkorde geändert haben.",
          ],
        },
        {
          type: "steps",
          title: "Das BPM finden",
          items: [
            "Tippe im Songformular bei **Details · optional** im Takt des Songs auf **Tap**. Nach zwei Taps wird das BPM eingetragen; die Zahl der Taps steht neben dem Button.",
            "Oder tippe auf **BPM aus der Aufnahme**, wenn der Song eine Audiodatei hat. Das Tempo wird auf deinem Gerät berechnet.",
            "Ist das Ergebnis halb oder doppelt so schnell wie das echte Tempo, tippe auf ÷2 oder ×2.",
          ],
        },
        {
          type: "note",
          tone: "tip",
          text: "Ein Tempo aus der Aufnahme ist eine Schätzung: Das Formular sagt „Aus der Aufnahme geschätzt: prüfe es durch Mittippen.“",
        },
      ],
    },
    {
      id: "chord-editor",
      title: "Die Akkorde eines Songs bearbeiten",
      summary: "Setz Akkorde per Tippen auf Wörter, verschieb sie per Ziehen und kopier sie zwischen Teilen.",
      roles: ["admin"],
      kind: "task",
      keywords: ["Akkord-Editor", "Akkorde bearbeiten", "Akkord hinzufügen", "Akkord verschieben", "Akkorde kopieren", "iReal"],
      related: ["lyrics-and-chords-format", "suggest-a-change-to-a-song", "import-from-ireal-pro"],
      body: [
        {
          type: "steps",
          items: [
            "Tippe im Repertoire auf die Songzeile und dann auf **Akkorde bearbeiten**. Du kannst auch in der Kopfzeile des Song-Readers auf **Akkorde bearbeiten** tippen.",
            "Tippe auf ein Wort. Die Leiste unten zeigt **Akkord auf „…“** und die Akkorde, die der Song schon verwendet.",
            "Tippe auf einen Akkord, um ihn auf das Wort zu setzen, oder gib einen neuen in **Neuer Akkord, z. B. F#m7** ein und tippe auf **Hinzufügen**. Tippe auf **Kein Akkord**, um ihn zu entfernen. Tippe auf **Fertig**, um die Leiste zu schließen.",
            "Um einen Akkord zu verschieben, zieh ihn auf ein anderes Wort.",
            "Um die Akkorde einer Strophe wiederzuverwenden, tippe über einem Teil auf **Akkorde kopieren von…** und wähle den Teil, aus dem kopiert wird.",
            "Hat der Song ein iReal-Chart, tippe über einem Teil auf **Aus iReal (…)**, um die Akkorde des passenden Chart-Teils über seine Zeilen zu legen.",
            "Tippe oben rechts auf **Rückgängig**, um einen Schritt zurückzugehen. Wenn du fertig bist, tippe auf **Akkorde speichern**.",
          ],
        },
        {
          type: "list",
          title: "Was der Editor prüft",
          items: [
            "**Format aufräumen** erscheint, wenn Teilnamen oder Akkorde nicht im Format der Band sind; ein Tippen korrigiert sie.",
            "„Nicht im iReal-Chart: …“ listet Akkorde im Songtext, die das Chart nie spielt.",
            "„Die Akkorde klingen nach …, der Song steht in ….“ erscheint, wenn die Akkorde nicht zur Tonart des Songs passen, mit einem Button zum Transponieren.",
          ],
        },
        {
          type: "p",
          text: "Der Akkord-Editor braucht einen Songtext. Gibt es keinen, sagt er, dass du ihn zuerst unter „Song ändern“ hinzufügen sollst. Nach dem Speichern bekommt die Band eine Push-Mitteilung, dass sich die Akkorde geändert haben.",
        },
        {
          type: "note",
          tone: "tip",
          text: "Verlässt du den Editor mit ungespeicherten Änderungen, fragt er „Änderungen speichern?“ mit **Änderungen sichern**, **Verwerfen** und **Weiter bearbeiten**.",
        },
        {
          type: "roles",
          rows: [
            { role: "admin", text: "Bearbeitet die Akkorde der Band für alle." },
            { role: "member", text: "Hat keinen Akkord-Editor. Schlägt eine Akkordkorrektur mit **Änderung vorschlagen** vor (siehe [[suggest-a-change-to-a-song]])." },
          ],
        },
      ],
    },
    {
      id: "import-chords-and-lyrics",
      title: "Akkorde und Songtext in einen Song importieren",
      summary: "Hol ein Akkordchart und einen Songtext aus dem iReal Pro Forum, einer Datei oder der Zwischenablage.",
      roles: ["admin", "member"],
      kind: "task",
      keywords: ["Songtext importieren", "Songtext einfügen", "ChordPro", "MusicXML", "Akkordchart", "Datei importieren"],
      related: ["import-from-ireal-pro", "open-a-chart-from-another-app", "lyrics-and-chords-format"],
      body: [
        {
          type: "steps",
          items: [
            "Tippe im Songformular in Schritt 1 auf **Akkorde und Songtexte importieren** oder in Schritt 3 auf **Songtext einfügen oder importieren**.",
            "Wähle einen Tab: **Aus dem Forum**, **Aus einer Datei** oder **Songtext**.",
            "**Aus einer Datei**: Tippe auf **Datei auswählen** und wähle eine MusicXML- (.musicxml, .mxl), ChordPro- (.cho, .chordpro, .pro) oder Textdatei (.txt).",
            "**Songtext**: Kopier den Songtext woanders und tippe dann auf **Aus der Zwischenablage einfügen**, oder füg ihn ins Feld ein und tippe auf **Vorschau**.",
            "Prüfe die Vorschau und tippe auf **Diesen Songtext verwenden** oder auf **Zurück**.",
            "Speichere den Song wie gewohnt.",
          ],
        },
        {
          type: "list",
          title: "Gut zu wissen",
          items: [
            "Songtexte erscheinen immer zuerst in einer Vorschau. Hat der Song schon einen Songtext, sagt die Vorschau, dass dieser ersetzt wird.",
            "Ein Akkordchart allein wird sofort zugeordnet, ohne Vorschau.",
            "Was der Import mitbringt, füllt nur leere Felder: Titel, Künstler, Tonart und Tempo, die du schon eingegeben hast, bleiben.",
            "Beim Einfügen trennen Leerzeilen die Teile; Akkorde über den Wörtern oder in [Klammern] bleiben bei ihnen.",
            "Aus iReal Pro auf deinem Gerät: Teilen › Exportieren › MusicXML, in Dateien sichern und dann **Aus einer Datei** nutzen.",
          ],
        },
        {
          type: "note",
          tone: "privacy",
          text: "Die Songtexte und Charts, die du importierst, sieht nur deine Band. Importiere nur, was du verwenden darfst.",
        },
        {
          type: "roles",
          rows: [
            { role: "admin", text: "Importiert in jeden Song, beim Hinzufügen oder Bearbeiten." },
            { role: "member", text: "Importiert beim Vorschlagen eines neuen Songs. Bei einem bestehenden Song schlägst du stattdessen die Änderung vor." },
          ],
        },
      ],
    },
    {
      id: "import-from-ireal-pro",
      title: "Ein Akkordchart aus iReal Pro importieren",
      summary: "Tippe im iReal Pro Forum auf einen Song- oder Playlist-Link, um Akkorde, Form, Tonart und Tempo in einen Song zu holen.",
      roles: ["admin", "member"],
      kind: "task",
      keywords: ["iReal", "iReal Pro", "irealb", "Akkordchart", "Playlist", "Forum"],
      related: ["import-chords-and-lyrics", "read-a-song", "chord-editor"],
      body: [
        {
          type: "steps",
          title: "In den Apps für iPhone, iPad und Android",
          items: [
            "Tippe im Songformular auf **Akkorde und Songtexte importieren** und bleib bei **Aus dem Forum**.",
            "Tippe auf **iReal Pro Forum durchsuchen**. Das Forum öffnet sich in der App.",
            "Tippe auf einen Song- oder Playlist-Link. Seine Akkorde kommen direkt ins Formular.",
            "Oder füg einen irealb://-Link in **iReal-Pro-Link** ein.",
          ],
        },
        {
          type: "steps",
          title: "Im Web",
          items: [
            "Tippe im Songformular auf **Akkorde und Songtexte importieren** und bleib bei **Aus dem Forum**.",
            "Tippe auf **iReal Pro Forum öffnen**. Das Forum öffnet sich in einem eigenen Fenster.",
            "Klick mit der rechten Maustaste auf einen Song- oder Playlist-Link und wähle Link kopieren.",
            "Tippe zurück in BandWith auf **Link einfügen**, füg ihn in **iReal-Pro-Link** ein oder zieh den Link auf das Feld (es zeigt **Link hier ablegen**). Das Forumsfenster schließt sich, sobald der Link drin ist.",
          ],
        },
        {
          type: "p",
          text: "Ein Playlist-Link zeigt seine Songs („… · 12 Songs“). Songs, die zu deinem Titel passen, stehen oben; tippe in **Song suchen**, um die Liste einzugrenzen, und tippe auf einen Song, um ihn zu verwenden. **Ändern** führt zurück zum Link.",
        },
        {
          type: "list",
          title: "Was übernommen wird",
          items: [
            "Die Akkorde und die Form (Teile, Takte, Wiederholungen), dazu Tonart, Stil, Tempo und Taktart. Keine Melodie, kein Songtext.",
            "Titel, Komponist (als Künstler), Tonart und BPM füllen die leeren Felder des Formulars.",
            "Das Chart erscheint in den Ansichten **Text & Akkorde** und **Akkordchart** des Song-Readers, und der Akkord-Editor kann damit Text & Akkorde setzen.",
          ],
        },
        {
          type: "note",
          tone: "tip",
          text: "Blockiert dein Browser das Forumsfenster, erlaube Pop-ups für BandWith und versuch es noch einmal.",
        },
        {
          type: "devices",
          rows: [
            { devices: ["web"], text: "Das Forum kann sich nicht in der Seite öffnen, daher öffnet es sich in einem eigenen Fenster, und du holst den Link mit **Link einfügen**, Einfügen oder Ziehen zurück." },
          ],
        },
      ],
    },
    {
      id: "open-a-chart-from-another-app",
      title: "Ein MusicXML-Chart aus einer anderen App öffnen",
      summary: "Schick eine MusicXML-Datei an BandWith und ordne ihr Akkordchart einem Song zu.",
      roles: ["admin", "member"],
      kind: "task",
      keywords: ["öffnen in", "Teilen-Menü", "MusicXML", "empfangene Datei", "Chart zuordnen"],
      related: ["import-chords-and-lyrics", "suggest-a-change-to-a-song"],
      body: [
        {
          type: "steps",
          items: [
            "Teile oder öffne in einer anderen App (zum Beispiel iReal Pro oder Dateien) eine MusicXML-Datei mit BandWith.",
            "BandWith öffnet das Fenster **Empfangene Datei**. Admins sehen **Akkordchart zuordnen**, Mitglieder **Akkordschema vorschlagen**.",
            "Wähle den Song, zu dem sie gehört. Nutze **Song suchen** zum Suchen. Bei einem Song, der schon ein Chart hat, steht, dass es ersetzt wird.",
            "Tippe auf **Akkorde öffnen**, um es zu prüfen, oder auf **Fertig**.",
          ],
        },
        {
          type: "list",
          items: [
            "Für einen neuen Song legst du zuerst den Song an: Die Datei wartet in **Akkorde und Songtexte importieren** › **Aus einer Datei** › **Empfangene Datei**, wo **Verwenden** sie zuordnet.",
            "Tippe auf **Datei verwerfen**, wenn du sie nicht willst.",
            "Eine Partitur mit Text, aber ohne Akkordsymbole ergibt kein Chart; um ihren Text zu nutzen, öffne beim Song Ändern › **Songtext einfügen oder importieren** › **Aus einer Datei**.",
          ],
        },
        {
          type: "roles",
          rows: [
            { role: "admin", text: "Das Chart wird sofort dem Song der Band zugeordnet." },
            { role: "member", text: "Das Chart geht als Vorschlag an den Admin. Der Song der Band bleibt gleich, bis er ihn annimmt." },
          ],
        },
        { type: "devices", rows: [{ devices: ["web"], text: "Nicht verfügbar: Dateien aus anderen Apps empfangen geht in den Apps für iPhone, iPad und Android." }] },
      ],
    },
    {
      id: "import-a-song-list",
      title: "Eine Songliste importieren",
      summary: "Füge viele Songs auf einmal aus einer CSV- oder Textdatei hinzu oder lade das kuratierte Repertoire.",
      roles: ["admin"],
      kind: "task",
      keywords: ["CSV", "Excel", "Tabelle", "Massenimport", "TXT", "Numbers", "Google Sheets", "700 Songs"],
      related: ["add-a-song", "repertoire-overview"],
      body: [
        {
          type: "steps",
          items: [
            "Tippe im Repertoire bei **Songs** auf **Songliste importieren** (den Upload-Button oben rechts). Ist die Bibliothek leer, kannst du auch auf **Liste importieren (CSV/TXT)** tippen.",
            "Wähle eine .csv-, .tsv- oder .txt-Datei bis 2 MB.",
            "Lies die Zeile über der Liste: Sie sagt, wie viele Songs importiert wurden und wie viele schon in deiner Bibliothek waren.",
          ],
        },
        {
          type: "list",
          title: "Wie die Datei aussehen kann",
          items: [
            "Eine als CSV gespeicherte Tabelle (Excel, Numbers, Google Sheets) mit Kopfzeile. Gelesen werden die Spalten title (oder song, name, track), artist (oder band, performer), key, bpm (oder tempo), duration (oder length, time; m:ss oder Sekunden) und genre.",
            "Eine einfache Liste aus Notizen: ein Song pro Zeile, als „Titel - Künstler“, „Titel, Künstler“ oder nur „Titel“. Nummerierte Zeilen und Leerzeilen sind kein Problem.",
            "Bis zu 2000 Songs pro Datei.",
          ],
        },
        {
          type: "p",
          text: "Songs mit demselben Titel und Künstler wie ein Song in der Bibliothek werden übersprungen. Importierte Songs werden als **Bereit** hinzugefügt.",
        },
        {
          type: "steps",
          title: "Das kuratierte Repertoire laden",
          items: [
            "Tippe bei leerer Bibliothek auf **700+ Songs laden**.",
            "Die App fügt die kuratierten Songs hinzu, die noch nicht in deiner Bibliothek sind, und sagt, wie viele.",
          ],
        },
        {
          type: "note",
          tone: "privacy",
          text: "Eine Songliste importieren dürfen nur Admins: Sie landet direkt in der Bibliothek der Band. Mitglieder schlagen Songs einzeln vor, und ein Admin prüft jeden.",
        },
        {
          type: "roles",
          rows: [
            { role: "admin", text: "Sieht **Songliste importieren** und **700+ Songs laden**." },
            { role: "member", text: "Sieht diese Buttons nicht." },
          ],
        },
      ],
    },
    {
      id: "play-a-song-recording",
      title: "Eine Aufnahme abspielen, ein Chart oder einen Link öffnen",
      summary: "Hör die Aufnahme der Band im Mini-Player und öffne Charts und Links.",
      roles: ["admin", "member"],
      kind: "task",
      keywords: ["abspielen", "Audio", "Mini-Player", "Aufnahme", "Spotify", "YouTube", "PDF-Chart"],
      related: ["song-menu-actions", "song-fields", "read-a-song"],
      body: [
        {
          type: "steps",
          items: [
            "Tippe im Repertoire in einer Songzeile auf den runden Button **Abspielen** oder tippe auf die Zeile und dann auf **Abspielen**.",
            "Eine Aufnahme (eine hochgeladene Datei, ein Google-Drive-Link oder ein beliebiger Audio-Link) läuft im Mini-Player. Nutze dort **Pause**, **Abspielen** und **Stopp** und **Songtext**, um den Song-Reader zu öffnen.",
            "Ein Spotify- oder YouTube-Link öffnet sich außerhalb der App.",
            "Um das Chart zu sehen, tippe auf die Zeile und dann auf **Chart öffnen**.",
          ],
        },
        {
          type: "note",
          tone: "tip",
          text: "Öffnet sich nichts, sagt die App „Song konnte nicht geöffnet werden. Prüf die Aufnahme oder die Links.“ Scheitert ein Link im Player, öffnet **Link öffnen** ihn woanders.",
        },
      ],
    },
    {
      id: "my-notes-and-files",
      title: "Meine Notizen und Dateien zu einem Song",
      summary: "Füge private Notizen zu einem Song, einer Zeile, einem Wort oder einem Akkord hinzu und behalte eigene Dateien, die sonst niemand sieht.",
      roles: ["admin", "member"],
      kind: "task",
      keywords: ["persönliche Notizen", "private Notizen", "meine Notizen", "Anmerkungen", "meine Dateien", "eigene Aufnahme"],
      related: ["read-a-song", "stage-mode", "suggest-a-change-to-a-song"],
      body: [
        {
          type: "note",
          tone: "privacy",
          text: "Deine Notizen und Dateien gehören nur dir: Niemand sonst in der Band sieht sie, auch keine Admins. Der Song der Band ändert sich für die anderen nicht.",
        },
        {
          type: "steps",
          title: "Eine Notiz hinzufügen",
          items: [
            "Öffne den Song im Reader (**Songtext** oder **Akkordchart**) oder im Bühnenmodus.",
            "Tippe auf **Notiz hinzufügen** (im Bühnenmodus **Notiz**). **Meine Notizen** schalten sich von selbst ein; beim ersten Mal erklärt ein Fenster, was das ist: Tippe auf **Verstanden**.",
            "Eine Leiste unten am Bildschirm sagt **Tippe auf die Zeile für deine Notiz**: Tippe auf die gewünschte Zeile oder auf **Ganzer Song** für eine Notiz zum ganzen Song. **Abbrechen** beendet das.",
            "Schneller: Halte eine Zeile eine halbe Sekunde gedrückt. **Notiz zu dieser Zeile** öffnet sich: Tippe auf **Notiz für mich**.",
            "Wähle bei einer Zeile, worauf sich die Notiz bezieht: **Ganze Zeile**, eines ihrer Wörter oder einen ihrer Akkorde.",
            "Schreib in **Meine Notiz** und tippe auf **Notiz speichern**.",
            "**Notiz gespeichert bei „…“** zeigt dir, wo sie gelandet ist.",
          ],
        },
        {
          type: "list",
          items: [
            "Deine Notizen erscheinen hervorgehoben unter ihrer Zeile. Notizen zum ganzen Song stehen über dem Songtext.",
            "Tippe auf eine Notiz, um sie zu ändern, oder tippe auf **Notiz löschen**.",
            "Eine Notiz bleibt bei ihrer Zeile, auch wenn ein Admin die Akkorde bearbeitet oder Teile verschiebt. Gibt es die Zeile im Song nicht mehr, wandert die Notiz nach oben, damit sie nicht verloren geht.",
            "Schalte **Meine Notizen** aus, um sie auszublenden, zum Beispiel auf der Bühne. Die Einstellung bleibt auf diesem Gerät gespeichert.",
          ],
        },
        {
          type: "steps",
          title: "Eine eigene Datei hinzufügen",
          items: [
            "Tippe bei eingeschalteten **Meine Notizen** auf **Datei hinzufügen** und wähle eine Aufnahme oder Noten.",
            "Sie erscheint als Chip unter der Leiste. Tippe darauf, um sie zu öffnen; tippe auf ihr X und bestätige, um sie zu entfernen.",
          ],
        },
        {
          type: "p",
          text: "Um eine Notiz mit der Band zu teilen, tippe im Notizfenster auf **Der Band vorschlagen**. Sie geht als Vorschlag an den Admin, mit der Zeile, zu der sie gehört.",
        },
        {
          type: "devices",
          rows: [{ devices: ["phone", "phoneLand", "duoClosed"], text: "Im Bühnenmodus zeigt die Leiste **Notiz** und ein Symbol für **Datei hinzufügen**, damit sie in eine Zeile über dem Songtext passt." }],
        },
      ],
    },

    // ───────────────────────────── Suggestions ─────────────────────────────
    {
      id: "suggest-a-song",
      title: "Einen neuen Song vorschlagen",
      summary: "Schlag einen Song fürs Repertoire vor; ein Admin nimmt ihn an oder lehnt ihn ab.",
      roles: ["member"],
      kind: "task",
      keywords: ["Song vorschlagen", "Songwunsch", "Songidee", "neuer Song"],
      related: ["add-a-song", "my-song-suggestions", "review-song-suggestions"],
      body: [
        {
          type: "steps",
          items: [
            "Tippe im Repertoire bei **Songs** auf **Song vorschlagen** (den +-Button oben rechts).",
            "Füll das Formular wie bei jedem Song aus: **Songtitel \\*** ist das einzige Pflichtfeld. Du kannst Akkorde und Songtext importieren und eine Aufnahme oder ein Chart anhängen.",
            "Tippe auf **Jetzt vorschlagen**, um ihn gleich zu senden, oder geh die Schritte durch und tippe im letzten auf **Song vorschlagen**.",
          ],
        },
        {
          type: "list",
          title: "Wie es weitergeht",
          items: [
            "Der Song erscheint für alle in der Band im Repertoire mit dem Etikett **Vorschlag**.",
            "Die Admins der Band bekommen eine Push-Mitteilung: „Song vorgeschlagen · …“. Mehrere Songs, die innerhalb einer Minute vorgeschlagen werden, ergeben eine Push-Mitteilung.",
            "Nimmt ein Admin ihn an, wechselt er auf **Wird geübt** und du bekommst eine Push-Mitteilung. Wird er abgelehnt, werden der Song und seine Dateien gelöscht, und du bekommst eine Push-Mitteilung mit der Begründung des Admins, falls er eine angegeben hat.",
          ],
        },
        {
          type: "p",
          text: "Dateien, die du an einen vorgeschlagenen Song hängst, bleiben in deinem eigenen Ordner, bis ein Admin den Song annimmt.",
        },
      ],
    },
    {
      id: "suggest-a-change-to-a-song",
      title: "Eine Änderung an einem Song vorschlagen",
      summary: "Schick dem Admin eine Korrektur an Songtext oder Akkorden oder eine Notiz für die ganze Band.",
      roles: ["member"],
      kind: "task",
      keywords: ["Korrektur", "Songtext korrigieren", "Akkorde korrigieren", "Notiz für die Band", "Änderung vorschlagen"],
      related: ["my-song-suggestions", "review-song-suggestions", "my-notes-and-files"],
      body: [
        {
          type: "steps",
          items: [
            "Tippe im Repertoire auf die Songzeile und dann auf **Änderung vorschlagen**.",
            "Wähle **Text oder Akkorde** oder **Notiz für die Band**.",
            "Bei Text oder Akkorden änderst du den Text in **Text mit Akkorden**. Akkorde stehen in Klammern vor dem Wort: [Am]Wort. Die Zeile unter dem Feld sagt, was du geändert hast, zum Beispiel „Akkorde in 2 Zeilen geändert“.",
            "Füge eine **Nachricht an den Admin (optional)** hinzu, wenn das hilft.",
            "Eine Notiz schreibst du in **Notiz für die ganze Band**.",
            "Tippe auf **Vorschlag senden**. Das Fenster zeigt **An den Admin gesendet** und schließt sich.",
          ],
        },
        {
          type: "note",
          tone: "tip",
          text: "Der Song der Band bleibt für alle gleich, bis der Admin deinen Vorschlag annimmt.",
        },
        {
          type: "p",
          text: "Du kannst auch von einer deiner Notizen aus starten: Öffne sie und tippe auf **Der Band vorschlagen**. Die Notiz wird mit ihrer Zeile gesendet.",
        },
        {
          type: "p",
          text: "Die Admins bekommen eine Push-Mitteilung, die nach der Art benannt ist: „Korrektur am Songtext · …“, „Korrektur an den Akkorden · …“ oder „Notiz für die Band · …“.",
        },
      ],
    },
    {
      id: "my-song-suggestions",
      title: "Deine Vorschläge verfolgen oder zurückziehen",
      summary: "Sieh, welche deiner Vorschläge noch warten, welche angenommen wurden, und zieh einen zurück.",
      roles: ["member"],
      kind: "task",
      keywords: ["meine Vorschläge", "zurückziehen", "Vorschlagsstatus", "offen"],
      related: ["suggest-a-song", "suggest-a-change-to-a-song"],
      body: [
        {
          type: "steps",
          items: [
            "Tippe im Repertoire bei **Songs** auf **Meine Vorschläge**. Die Zeile sagt, wie viele auf den Admin warten.",
            "**Offen** listet die noch offenen; **Geprüft** listet die übrigen mit ihrem Ergebnis.",
            "Tippe auf einen, um ihn zu sehen. **Änderungen**, **Vorher** und **Nachher** zeigen den Unterschied; ein geprüfter zeigt die Begründung des Admins, falls er eine angegeben hat.",
            "Um einen offenen Vorschlag zurückzunehmen, tippe auf **Vorschlag zurückziehen** und zum Bestätigen noch einmal auf **Vorschlag zurückziehen** oder auf **Behalten**.",
          ],
        },
        {
          type: "table",
          head: ["Etikett", "Bedeutung"],
          rows: [
            ["**Offen**", "Noch nicht geprüft."],
            ["**Angenommen**", "So übernommen, wie du ihn gesendet hast."],
            ["**Mit Änderungen angenommen**", "Der Admin hat ihn mit eigenen Änderungen übernommen."],
            ["**Nicht angenommen**", "Abgelehnt."],
          ],
        },
        {
          type: "note",
          tone: "warning",
          text: "Ziehst du einen vorgeschlagenen neuen Song zurück, werden der Song und die angehängten Dateien gelöscht. Die Admins sehen ihn nicht mehr.",
        },
      ],
    },
    {
      id: "review-song-suggestions",
      title: "Vorschläge der Mitglieder prüfen",
      summary: "Nimm an, nimm mit Änderungen an oder lehn ab, was Mitglieder vorschlagen, auf Wunsch mit Begründung.",
      roles: ["admin"],
      kind: "task",
      keywords: ["prüfen", "annehmen", "ablehnen", "Vorschläge der Mitglieder", "moderieren"],
      related: ["suggest-a-change-to-a-song", "suggest-a-song", "edit-or-delete-a-song"],
      body: [
        {
          type: "steps",
          items: [
            "Tippe im Repertoire bei **Songs** auf **Vorschläge der Mitglieder** (dort steht „… zu prüfen“). Du kannst auch auf die Push-Mitteilung tippen, die du bekommen hast.",
            "Tippe bei **Offen** auf einen Vorschlag. Er zeigt, wer ihn wann gemacht hat, mit der Nachricht.",
            "Sieh dir **Änderungen** (hinzugefügte und entfernte Zeilen), **Vorher** und **Nachher** an. Bei einem neuen Song listet eine Übersicht, was er enthält.",
            "Schreib, wenn du magst, einen **Grund (optional, … sieht ihn)**.",
            "Tippe auf **Annehmen**, **Mit Änderungen annehmen** oder **Ablehnen**.",
          ],
        },
        {
          type: "table",
          head: ["Button", "Was passiert"],
          rows: [
            ["**Annehmen**", "Die Änderung wird auf den Song der Band angewendet. Ein neuer Song wechselt auf Wird geübt."],
            ["**Mit Änderungen annehmen**", "Du bearbeitest zuerst den Text und tippst dann auf **Mit diesen Änderungen annehmen**. Bei einem neuen Song öffnet sich das Songformular."],
            ["**Ablehnen**", "Es ändert sich nichts. Ein vorgeschlagener neuer Song wird mit seinen Dateien gelöscht."],
          ],
        },
        {
          type: "list",
          items: [
            "Das Mitglied bekommt eine Push-Mitteilung mit dem Ergebnis und deiner Begründung.",
            "Hat sich der Song nach dem Vorschlag geändert, warnt der Bildschirm, dass du mit der aktuellen Version vergleichst.",
            "Eine Notiz für die Band wird zu den Notizen des Songs hinzugefügt.",
            "Ein Vorschlag mit Akkordchart ersetzt auch das Chart des Songs.",
            "Geprüfte Vorschläge bleiben unter **Geprüft**.",
          ],
        },
        {
          type: "devices",
          rows: [{ devices: ["tablet", "duoBook", "duoLand"], text: "Vorschläge öffnen sich im zweiten Bereich, neben dem Repertoire." }],
        },
        { type: "shot", id: "music-suggestions", caption: "Eine Korrektur am Songtext mit Änderungen, Vorher und Nachher und den Prüf-Buttons." },
      ],
    },

    // ───────────────────────────── Setlists ─────────────────────────────
    {
      id: "build-a-setlist",
      title: "Eine Setlist zusammenstellen",
      summary: "Leg im Repertoire eine Setlist an, füge Songs aus der Bibliothek hinzu, bring sie in Reihenfolge und speichere.",
      roles: ["admin"],
      kind: "task",
      keywords: ["neue Setlist", "Setlist erstellen", "Setliste", "Reihenfolge", "Playlist"],
      related: ["setlists-and-sets", "attach-a-setlist-to-a-gig", "edit-a-gig-setlist", "music-notifications"],
      body: [
        {
          type: "steps",
          items: [
            "Tippe im Repertoire auf **Setlists** und dann auf **Neue Setlist** (den +-Button oben rechts). Gibt es noch keine Setlists, kannst du auch auf **Erste Setlist erstellen** tippen.",
            "Gib einen **Name der Setlist \\*** ein, zum Beispiel Jazzabend 1. Set, und tippe auf **Setlist erstellen**.",
            "Tippe in der Liste auf die neue Setlist, um sie zu öffnen.",
            "Tippe auf **Songs hinzufügen…**. Such mit **Bibliothek durchsuchen…** oder tippe auf einen Genre-Chip zum Filtern. Tippe auf einen Song, um ihn hinzuzufügen; tippe noch einmal, um ihn wieder herauszunehmen. Songs in der Setlist sind hervorgehoben.",
            "Tippe auf **Fertig**, um die Bibliothek zu schließen.",
            "Zieh einen Song an seinem Griff (**Zum Sortieren ziehen**), um ihn zu verschieben. Tippe in einer Zeile auf X, um sie zu entfernen.",
            "Ändere oben den **Name der Setlist**, wenn du willst.",
            "Tippe auf **Setlist speichern**.",
          ],
        },
        {
          type: "list",
          title: "Was der Editor zeigt",
          items: [
            "**Reihenfolge (… Songs)** mit der **Gesamt**-Spielzeit.",
            "Hat die Setlist mehr als ein Set, ein Etikett pro Set mit seinen Songs und seiner Zeit und ein Etikett **Set 1**, **Set 2** am ersten Song jedes Sets.",
            "Wie viele Songs keine Dauer haben: Ergänze sie über Ändern für eine genaue Summe.",
          ],
        },
        {
          type: "p",
          text: "Nach dem Speichern bekommen die aktiven Mitglieder der Band eine Push-Mitteilung mit den Änderungen, zum Beispiel „Setlist aktualisiert · Rooftop set“ und „Leo M.: 2 Songs verschoben, 1 hinzugefügt.“ Auch eine Umbenennung wird erwähnt.",
        },
        {
          type: "note",
          tone: "tip",
          text: "Verlässt du den Editor mit ungespeicherten Änderungen, fragt er „Änderungen an der Setlist speichern?“ mit **Änderungen sichern**, **Verwerfen** und **Weiter bearbeiten**.",
        },
        {
          type: "roles",
          rows: [
            { role: "admin", text: "Erstellt, bearbeitet, benennt um und löscht Setlists." },
            { role: "member", text: "Öffnet Setlists nur zum Lesen: Reihenfolge, Sets und Spielzeit sowie **Setlist als PDF exportieren**. Kein Namensfeld, keine Bibliothek, keine Griffe, kein Speichern." },
          ],
        },
        {
          type: "devices",
          rows: [{ devices: ["tablet", "duoBook", "duoLand"], text: "Die Setlist öffnet sich im zweiten Bereich, neben der Liste der Setlists." }],
        },
        { type: "shot", id: "music-setlist-editor", caption: "Der Setlist-Editor mit geöffneter Bibliothek und der Reihenfolge darunter." },
      ],
    },
    {
      id: "setlists-and-sets",
      title: "Setlists, Sets und Vorlagen",
      summary: "Wie Setlists, die Sets darin und Vorlagen-Setlists mit Gigs zusammenhängen.",
      roles: ["admin", "member"],
      kind: "reference",
      keywords: ["Sets", "Set 1", "Set 2", "Vorlage", "gespeicherte Setlist", "Gig-Setlist"],
      related: ["build-a-setlist", "attach-a-setlist-to-a-gig", "edit-a-gig-setlist"],
      body: [
        { type: "p", text: "Eine Setlist ist eine geordnete Liste von Songs der Band. Ein Song steht nur einmal in einer Setlist. Eine Setlist kann in Sets aufgeteilt werden (Set 1, Set 2…), zum Beispiel vor und nach einer Pause." },
        {
          type: "list",
          items: [
            "Sets entstehen, wenn du die Setlist eines Gigs einrichtest: **Set hinzufügen** im Gig-Formular oder **Neues Set** beim Hinzufügen von Songs in der Gig-Übersicht.",
            "Im Setlist-Editor des Repertoires siehst du die Sets und kannst Songs per Ziehen über die Grenze zwischen ihnen verschieben; ein neuer Song kommt ins letzte Set. Leere Sets verschwinden beim Speichern.",
            "Als Vorlage markierte Setlists tragen in der Liste das Etikett **Vorlage**. Das Gig-Formular bietet deine gespeicherten Setlists unter **Aus Vorlagen laden** an.",
            "Lädst du eine gespeicherte Setlist in einen Gig, bekommt der Gig eine eigene Kopie, benannt nach dem Gig (zum Beispiel „Setlist Rooftop Session“). Spätere Änderungen an der Setlist des Gigs ändern die geladene Vorlage nicht.",
            "Jede Gig-Setlist erscheint auch im Repertoire unter **Setlists**.",
          ],
        },
        {
          type: "roles",
          rows: [
            { role: "admin", text: "Bearbeitet Setlists überall: im Repertoire, im Gig-Formular, in der Gig-Übersicht und im Bühnenmodus." },
            { role: "member", text: "Liest jede Setlist der Band. Bearbeiten dürfen Setlists nur Admins." },
          ],
        },
      ],
    },
    {
      id: "attach-a-setlist-to-a-gig",
      title: "Einem Gig eine Setlist zuordnen",
      summary: "Füge beim Anlegen oder Bearbeiten eines Gigs Songs oder eine gespeicherte Setlist hinzu.",
      roles: ["admin"],
      kind: "task",
      keywords: ["Setlist zuordnen", "Gig-Songs", "Vorlage laden", "Set hinzufügen", "Event-Setlist"],
      related: ["edit-a-gig-setlist", "setlists-and-sets", "create-a-gig"],
      body: [
        {
          type: "steps",
          items: [
            "Leg einen Gig an (siehe [[create-a-gig]]). Bei einem bestehenden Gig öffnest du ihn und nutzt stattdessen seinen Bereich **SETLIST**, der dieselben Vorlagen und Songs bietet.",
            "Öffne den Bereich **Setlist & Songs**.",
            "Um mit einer gespeicherten Setlist zu starten, tippe sie unter **Aus Vorlagen laden** an. Sobald Songs drin sind, zeigt **Vorlagen** die Liste wieder als **Durch Vorlage ersetzen**.",
            "Um Songs hinzuzufügen, tippe unter einem Set auf **Bibliothek** oder auf **Manuell**, um einen einzutippen. **Songs hinzufügen** fügt sie einem Set deiner Wahl hinzu.",
            "Tippe auf **Set hinzufügen** für ein weiteres Set, gib ihm in **Set-Name...** einen Namen oder tippe auf **Set entfernen**.",
            "Speichere den Gig.",
          ],
        },
        {
          type: "p",
          text: "Der Gig bekommt seine eigene Setlist, benannt nach dem Gig. Bearbeitest du einen Gig, wird seine Setlist aktualisiert, und die Besetzung bekommt eine Push-Mitteilung mit den Änderungen.",
        },
        {
          type: "note",
          tone: "tip",
          text: "Hat der Gig keine Setlist, steht in seiner Übersicht **KEINE SETLIST**; Admins können dort direkt Songs hinzufügen (siehe [[edit-a-gig-setlist]]).",
        },
      ],
    },
    {
      id: "edit-a-gig-setlist",
      title: "Die Setlist eines Gigs in seiner Übersicht bearbeiten",
      summary: "Sortiere, ergänze und entferne Songs direkt im Gig, ohne das Bearbeitungsformular zu öffnen.",
      roles: ["admin"],
      kind: "task",
      keywords: ["Songs sortieren", "Gig-Übersicht", "Set-Auswahl", "welches Set", "neues Set", "Songs ziehen"],
      related: ["attach-a-setlist-to-a-gig", "music-notifications", "gig-workspace"],
      body: [
        {
          type: "steps",
          items: [
            "Öffne einen kommenden Gig. Der Bereich **SETLIST** der Übersicht zeigt seine Songs.",
            "Um einen Song zu verschieben, drück lange darauf und zieh ihn. Mit einer Tastatur setzt du den Fokus auf seinen Griff und nutzt die Pfeiltasten nach oben und unten.",
            "Um einen Song zu entfernen, tippe auf sein X (**Song entfernen**).",
            "Um Songs hinzuzufügen, tippe auf **Songs hinzufügen**. Bei mehr als einem Set fragt **In welches Set?**, wohin; tippe auf ein Set oder auf **Neues Set**.",
            "Hake in **Songs hinzufügen** die Songs an (**Bibliothek**) und tippe dann auf **… Songs hinzufügen**. Songs, die schon im Set sind, zeigen **Im Set**. **Manuell** legt einen neuen Song an und fügt ihn hinzu.",
            "Tippe in der Leiste **Ungespeicherte Änderungen** auf **Speichern** oder auf **Abbrechen**, um die Änderungen zu verwerfen.",
          ],
        },
        {
          type: "list",
          items: [
            "Gespeichert wird erst, wenn du auf **Speichern** tippst. Dann bekommt die Besetzung des Gigs (alle, die nicht abgesagt haben) eine Push-Mitteilung, zum Beispiel „Setlist aktualisiert · Rooftop Session“ und „Leo M.: 1 Song verschoben, 1 hinzugefügt.“",
            "Ein Gig ohne Setlist bekommt beim Speichern eine, benannt nach dem Gig.",
            "Verlässt du den Gig mit ungespeicherten Änderungen, fragt die App „Änderungen an der Setlist speichern?“.",
            "Ein Tippen auf **SETLIST** oder die Zahl der Songs öffnet die ganze Liste in einem Fenster, wo du genauso bearbeiten kannst.",
            "Angebote zeigen die Setlist hier nur zum Lesen. Bei einem vergangenen Gig bearbeitest du sie im Fenster (**SETLIST** oder die Songanzahl); die Songs einer Probe mit **ÄNDERN** neben **FOKUS-SONGS**.",
          ],
        },
        {
          type: "roles",
          rows: [
            { role: "admin", text: "Bearbeitet die Setlist in der Übersicht kommender Gigs der Band." },
            { role: "member", text: "Sieht Songs, Künstler und Dauer nur zum Lesen. Ohne Setlist sagt das Fenster „Der Band-Admin hat noch keine Setlist angehängt.“" },
          ],
        },
        {
          type: "devices",
          rows: [{ devices: ["tablet"], text: "Der Gig-Arbeitsbereich hat einen eigenen Tab **SETLIST** neben **ÜBERSICHT**, **RIDER & BÜHNE** und **GELD**." }],
        },
      ],
    },
    {
      id: "export-a-setlist-pdf",
      title: "Eine Setlist als PDF exportieren",
      summary: "Mach aus einer Setlist ein PDF zum Drucken oder Verschicken.",
      roles: ["admin", "member"],
      kind: "task",
      keywords: ["PDF", "Setlist drucken", "Setlist teilen", "herunterladen"],
      related: ["build-a-setlist"],
      body: [
        {
          type: "steps",
          items: [
            "Tippe im Repertoire auf **Setlists** und öffne eine Setlist.",
            "Tippe auf **Setlist als PDF exportieren** (den Dokument-Button oben rechts).",
            "Auf dem Handy wählst du im Teilen-Menü, wohin du es schickst. Im Web wird das PDF heruntergeladen.",
          ],
        },
        { type: "p", text: "Das PDF enthält den Bandnamen, den Namen der Setlist und jeden Song mit Künstler, Tonart, BPM, Dauer und Set." },
        { type: "p", text: "Der Button ist ausgegraut, solange die Setlist leer ist." },
      ],
    },
    {
      id: "delete-a-setlist",
      title: "Eine Setlist löschen",
      summary: "Entferne eine Setlist; die Songs bleiben in der Bibliothek.",
      roles: ["admin"],
      kind: "task",
      keywords: ["Setlist entfernen", "Setlist löschen"],
      related: ["build-a-setlist"],
      body: [
        {
          type: "steps",
          items: [
            "Tippe im Repertoire auf **Setlists** und öffne die Setlist.",
            "Tippe auf **Setlist löschen** (den roten Papierkorb oben rechts).",
            "Lies die Bestätigung: Sie nennt die kommenden Gigs, die ihre Setlist verlieren.",
            "Tippe auf **Löschen** oder auf **Abbrechen**.",
          ],
        },
        {
          type: "note",
          tone: "warning",
          text: "Gigs, die die Setlist nutzen, verlieren sie. Die Songs bleiben in deiner Bibliothek. Das lässt sich nicht rückgängig machen.",
        },
      ],
    },
    {
      id: "music-notifications",
      title: "Mitteilungen zu Songs und Setlists",
      summary: "Wer was erfährt, wenn sich Songs, Setlists und Vorschläge ändern.",
      roles: ["admin", "member"],
      kind: "reference",
      keywords: ["Push", "Mitteilung", "Setlist aktualisiert", "Song aktualisiert", "Benachrichtigung"],
      related: ["build-a-setlist", "edit-a-gig-setlist", "review-song-suggestions", "notifications-inbox"],
      body: [
        {
          type: "table",
          head: ["Änderung", "Wer es erfährt", "Wie"],
          rows: [
            ["Setlist eines Gigs gespeichert (Übersicht oder Gig-Formular)", "Die Besetzung des Gigs, außer wer gespeichert hat", "Eine Push-Mitteilung: „Setlist aktualisiert · <Gig>“ mit „2 Songs verschoben, 1 hinzugefügt“"],
            ["Eine Setlist im Repertoire gespeichert", "Die aktiven Mitglieder der Band, außer wer gespeichert hat", "Eine Push-Mitteilung: „Setlist aktualisiert · <Setlist>“ oder dass sie umbenannt wurde"],
            ["Ein Song bearbeitet (Formular oder Akkord-Editor)", "Die aktiven Mitglieder der Band, außer wer gespeichert hat", "Eine Push-Mitteilung: „Song aktualisiert · <Song>“ mit den geänderten Feldern"],
            ["Ein Song von einem Admin hinzugefügt", "Der Rest der Band", "Hinweis im Posteingang, ohne Push"],
            ["Ein Song oder eine Änderung vorgeschlagen", "Die aktiven Admins der Band", "Push"],
            ["Ein Vorschlag geprüft", "Das Mitglied, das ihn gemacht hat", "Push, mit der Begründung"],
            ["Setlist im Bühnenmodus umsortiert", "Die Band", "Hinweis im Posteingang, ohne Push"],
          ],
        },
        { type: "p", text: "Die Texte erscheinen in der App-Sprache der jeweiligen Person." },
        {
          type: "p",
          text: "Ein geöffneter Gig lädt seine Setlist neu, sobald ein Admin sie ändert, sodass Mitglieder die neue Reihenfolge ohne Aktualisieren sehen.",
        },
      ],
    },
    {
      id: "music-what-members-can-do",
      title: "Was Admins, Mitglieder und Vertretungen mit Songs und Setlists dürfen",
      summary: "Eine Tabelle dazu, wer Repertoire, Setlists und Bühnenmodus lesen und wer sie ändern darf.",
      roles: ["admin", "member", "deputy"],
      kind: "reference",
      keywords: ["Berechtigungen", "Rechte der Mitglieder", "nur Admins", "nur lesen", "Datenschutz"],
      related: ["repertoire-overview", "suggest-a-change-to-a-song", "stage-mode", "who-sees-what"],
      body: [
        {
          type: "table",
          head: ["Aktion", "Admin", "Mitglied"],
          rows: [
            ["Jeden Song, Songtext, Akkorde und Dateien lesen", "Ja", "Ja"],
            ["Einen Song zur Bibliothek hinzufügen", "Ja, als Bereit", "Schlägt ihn vor, als Vorschlag"],
            ["Einen Song bearbeiten, für die Band transponieren, Akkorde bearbeiten, löschen", "Ja", "Nein: schlägt eine Änderung vor"],
            ["Eine Songliste importieren oder 700+ Songs laden", "Ja", "Nein"],
            ["Vorschläge prüfen", "Ja, alle der Band", "Sieht nur die eigenen"],
            ["Meine Notizen und meine Dateien", "Nur eigene", "Nur eigene"],
            ["Setlists lesen und als PDF exportieren", "Ja", "Ja"],
            ["Setlists erstellen, bearbeiten, umsortieren, löschen", "Ja", "Nein"],
            ["Bühnenmodus bei einem kommenden Gig öffnen, oder den Live-Modus bei einer kommenden Probe", "Ja, als Leader", "Ja, als Follower"],
            ["Den aktuellen Song der Band wechseln, auf der Bühne umsortieren, den Klick der Band starten", "Ja", "Nein: blättert und klickt nur auf dem eigenen Handy"],
          ],
        },
        {
          type: "note",
          tone: "privacy",
          text: "Admins sehen die Notizen und Dateien der Mitglieder nicht. Mitglieder sehen nur ihre eigenen Vorschläge; Admins sehen alle.",
        },
        {
          type: "roles",
          rows: [
            { role: "deputy", text: "Eine Vertretung ist kein Bandmitglied: kein Repertoire, keine Setlists und kein Bühnenmodus. Ihre Vertretungs-Gigs zeigen Datum, Zeiten, Location, Rolle und die angebotene Gage." },
          ],
        },
      ],
    },

    // ───────────────────────────── Stage ─────────────────────────────
    {
      id: "stage-mode",
      title: "Bühnenmodus",
      summary: "Ein schwarzer Live-Bildschirm, auf einen Blick lesbar, mit Setlist und Songtext oder Akkorden jedes Songs: am Gig-Tag mit dem Ablauf, bei einer Probe als Live-Modus.",
      roles: ["admin", "member"],
      kind: "reference",
      keywords: ["Bühne", "Gig-Tag", "live", "Ablauf", "Go live", "Auftrittsmodus", "Probe", "Live-Modus", "Probe live", "nur der Song", "nur Songtext", "aufgeräumte Ansicht"],
      related: ["lead-stage-mode", "follow-in-stage-mode", "stage-manager", "stage-click", "stage-bluetooth-sync", "stage-mode-on-devices"],
      body: [
        {
          type: "steps",
          title: "Bühnenmodus öffnen",
          items: [
            "Öffne einen kommenden Gig der Band und tippe oben rechts auf den Button **Abspielen** (**Bühnenmodus öffnen**). Am Gig-Tag ist er hervorgehoben.",
            "Oder tippe auf Start unter deinem nächsten Gig auf **Go live**.",
            "Zum Verlassen tippe auf X (**Bühnenmodus beenden**).",
            "Bei einer kommenden Probe der Band heißt derselbe Button **Live-Modus öffnen**. Er öffnet den Live-Modus (unten); zum Verlassen **Live-Modus beenden**.",
          ],
        },
        {
          type: "list",
          title: "Was du auf dem Bildschirm siehst",
          items: [
            "**Bühnenmodus · <date>**, Titel, Location und Stadt des Gigs.",
            "Der Ablauf: Load-in, Soundcheck, Show und Ende im 24-Stunden-Format. Der nächste Punkt ist als **Als Nächstes · …** hervorgehoben; vergangene verblassen.",
            "Die **Setlist** mit Nummern, Titeln, Tonart und Dauer. Der aktuelle Song ist hervorgehoben. Für heute gestrichene Songs sind durchgestrichen, und die Zahl über der Liste sagt, wie viele (**· 2 gestrichen**).",
            "Ein zweiter Tab, benannt nach deiner Songansicht (**Songtext**, **Text & Akkorde** oder **Akkordchart**), zeigt den aktuellen Song. Er wechselt mit, wenn sich der Song ändert.",
            "**Zurück** und **Weiter** unten, mit dem Klick-Button dazwischen.",
          ],
        },
        {
          type: "list",
          title: "Im Song-Tab",
          items: [
            "Wechsle zwischen **Songtext**, **Text & Akkorde** und **Akkordchart**. Die Wahl gilt auch im Song-Reader.",
            "Ändere die Schriftgröße mit − und +.",
            "**Vollbild** (der Knopf mit den vier Ecken oben) zeigt nur den Song (**Nur der Song**), von hier oder aus der Setlist: eine kleine Zeile mit Nummer und Titel, dann der Song; keine Tabs, Zeiten oder Status. Unten bleiben nur **Alles anzeigen**, **Zurück**, der Klick und **Weiter**; auch die Pfeiltasten und Bild auf/ab wechseln den Song, für Blätterpedale.",
            "**Alles anzeigen** oder Zurück holt den ganzen Live-Bildschirm zurück, auf dem Tab, auf dem du warst. Wer den Bühnenmodus verlässt, schaltet Nur der Song aus.",
            "Transponiere für dich mit − Tonart +. Nur dein Bildschirm ändert sich.",
            "**Meine Notizen** zeigt deine privaten Notizen über der Version der Band.",
            "Der Ablauf wird ausgeblendet, damit der Song mehr Platz hat.",
            "Wo Platz ist (ein Handy quer, ein iPad, ein Dual-Screen-Gerät über beide Bereiche geöffnet), bleibt die Setlist in einer Spalte neben dem Song. Tippe dort auf einen Song, um zu ihm zu springen.",
          ],
        },
        {
          type: "list",
          title: "Bei einer Probe: der Live-Modus",
          items: [
            "**Live-Modus · <Datum>** und der Titel der Probe oben.",
            "Die Setlist sind die Fokus-Songs der Probe, in ihrer Reihenfolge. Ist keiner gewählt, steht dort „Für diese Probe sind noch keine Songs ausgewählt.“",
            "Songtext, Akkorde, Transponieren, Textgröße, der Klick und Meine Notizen funktionieren wie bei einem Gig.",
            "Der Admin leitet, die Mitglieder folgen, über das Internet und über Bluetooth, wie bei einem Gig. Alle, die bei der Probe dabei sind, können ihn öffnen.",
            "Kein Ablauf (keine Zeiten für Aufbau, Soundcheck, Show oder Ende) und kein Streichen von Songs für heute.",
          ],
        },
        { type: "shot", id: "music-song-only", caption: "Nur der Song: der Song mit seinen Akkorden im Vollbild, mit Alles anzeigen, Zurück, dem Klick und Weiter." },
        { type: "shot", id: "music-rehearsal-live", caption: "Der Live-Modus bei einer Probe: die Fokus-Songs, die Akkorde des aktuellen Songs und Zurück / Weiter, ohne Ablauf." },
        {
          type: "list",
          title: "Der Probentimer",
          items: [
            "Der Admin tippt im Live-Modus auf **Probe starten**. Die Zeit läuft für die ganze Band: Mitglieder sehen sie, steuern sie aber nicht.",
            "**Pause** hält die Zeit an (eine Pause zählt nicht) und **Fortsetzen** macht weiter. **Beenden** fragt zuerst: **Weitermachen** oder **Jetzt beenden**.",
            "Am Ende sehen alle die **Probenübersicht**: die geprobte Zeit ohne Pausen und die gespielten Songs (jeder Song, der lief, während die Zeit lief, zählt einmal). Der Admin kann noch **Probe fortsetzen**.",
            "Die Session wird gespeichert: Live-Modus schließen oder die App neu starten behält sie, und die Seite der Probe zeigt sie unter **PROBENSESSION**. Eine wiederkehrende Probe hat eine Session pro Datum.",
            "Ohne Internet läuft die Zeit des Admins weiter und wird gespeichert, sobald er wieder online ist. Auf dem Duo, wie ein Laptop gefaltet, zeigt der Bodenbildschirm die Zeit und für den Admin **Pause** / **Fortsetzen**.",
          ],
        },
        {
          type: "list",
          title: "Probennotizen",
          items: [
            "Tippe im Live-Modus auf **Markieren**, wenn etwas Arbeit braucht: Der laufende Song und die Minute werden gemerkt, und ihr spielt weiter.",
            "In der Pause (oder in der Übersicht) tippe auf **Zu schreiben** und bei jeder Markierung auf **Schreiben**: Wähle, woran ihr arbeitet (**Tempo**, **Tonart**, **Schluss**, **Solo**, **Durchgehen**, **Sitzt**, oder **Einen Teil wiederholen**, wenn der Song eine Akkordchart hat), schreib ein paar Worte dazu und wähle **Für wen**.",
            "Jede Notiz zu einem Song kann **Wo im Song** angeben: einen Teil und, wenn du willst, eine seiner Zeilen (**Zeile (optional)**).",
            "Im Live-Modus kannst du auch eine Zeile des Songtexts gedrückt halten und auf **Notiz für die Band** tippen: Die Notiz öffnet sich direkt mit diesem Song, Teil und dieser Zeile.",
            "Admins schreiben für die ganze Band oder für jedes Mitglied; Mitglieder für die Band oder für sich selbst. Die ganze Band liest alle Notizen.",
            "Wer eine Notiz bekommt, tippt nach dem Üben auf **Geübt**; ein Admin tippt auf **OK**, wenn die Band es kann (bei einer Notiz an Mitglieder auch die Person, die sie geschrieben hat).",
            "Die Seite der Probe zeigt die Notizen unter **PROBENNOTIZEN**, nach Song. Notizen erscheinen sofort auf den anderen Handys im Live-Modus; ohne Internet warten sie auf dem Handy und gehen raus, sobald es wieder online ist. Auf dem Duo, wie ein Laptop gefaltet, hat der Bildschirm am Boden einen Notizblock: **Markieren**, ein Preset mit einem Tipp, oder **Schreiben…**.",
          ],
        },
        {
          type: "list",
          title: "Zum Üben, und die nächste Probe",
          items: [
            "Die Startseite zeigt **Zum Üben**: die Songs mit offenen Notizen für dich oder die Band, neueste Probe zuerst. Tippe **Geübt** bei einer Notiz für dich; tippe den Song, um seine Seite zu öffnen. Auf dem Duo, wie ein Laptop gefaltet, stehen die Songs unter **Zu erledigen** auf dem Schreibtischs.",
            "Die Seite des Songs zeigt **Aus den Proben** über deinen Notizen. Eine **Tempo**- oder **Tonart**-Notiz mit dem Wert (zum Beispiel „Tempo: 96“ oder „Tonart: F#m“) bekommt einen Button: Admins **Im Song setzen**, Mitglieder **Der Band vorschlagen**.",
            "Die Seite der nächsten Probe zeigt **VOM LETZTEN MAL**: offene Notizen aus früheren Proben zu ihren Songs. Admins tippen **OK**, wenn die Band es kann. Im Live-Modus öffnet ein Abzeichen an jedem Song seine Notizen vom letzten Mal.",
            "Wenn ein Admin eine Probe anlegt, bietet **Aus offenen Probennotizen** die Songs mit offenen Notizen als Fokus-Songs an, ein Tipp pro Song. Eine neue Probenumfrage wählt sie schon vor; entferne die, die du nicht brauchst.",
            "Wenn eine Probe endet, bekommt jeder mit Songs zum Üben eine einzige Push-Mitteilung mit ihnen („Zum Üben: …“), in seiner Sprache; wer sie beendet hat, sieht stattdessen die Zusammenfassung. **Push-Mitteilungen** in den Einstellungen schaltet das aus.",
          ],
        },
        {
          type: "list",
          title: "Gut zu wissen",
          items: [
            "Der Bühnenmodus gibt es für kommende Gigs der Band und, als Live-Modus, für kommende Proben der Band; nicht für Angebote, vergangene Termine oder persönliche Gigs.",
            "Der Bildschirm bleibt an, solange der Bühnenmodus offen ist.",
            "**Vollbild** (der Knopf mit den vier Ecken oben, auf einem Dual-Screen-Gerät in der Seitenleiste) blendet die Leisten der App, die Seitenleiste und die Statusleiste des Telefons aus und hält den Bildschirm an. Mit Texten oder Charts in der Setlist zeigt es nur den Song (**Nur der Song**); ohne bekommt die Setlist den ganzen Bildschirm, und **Vollbild beenden** oder Zurück verlässt es.",
            "Ohne Setlist steht dort „Diesem Gig ist keine Setlist zugeordnet.“",
            "In den Apps für Handy und Tablet wird die Setlist mit Songtexten und Charts beim Öffnen des Gigs auf dem Gerät gespeichert, sodass der Bühnenmodus ohne Internet funktioniert. Beim Abmelden wird sie entfernt.",
            "Ohne Internet und ohne Kopie auf dem Gerät steht dort „Offline: Die Setlist konnte nicht geladen werden.“ mit **Erneut versuchen**.",
          ],
        },
        {
          type: "roles",
          rows: [
            { role: "admin", text: "Leitet: wechselt den aktuellen Song der Band, sortiert die Setlist um, indem er einen Song hält und zieht, streicht Songs für heute und startet den Klick der Band. Siehe [[lead-stage-mode]]." },
            { role: "member", text: "Folgt dem Leader oder blättert allein durch die Songs. Siehe [[follow-in-stage-mode]]." },
            { role: "deputy", text: "Kein Bühnenmodus: Vertretungen haben die Setlists der Band nicht." },
          ],
        },
        { type: "shot", id: "music-stage", caption: "Der Bühnenmodus am Gig-Tag: Ablauf, Setlist und Zurück / Weiter." },
      ],
    },
    {
      id: "lead-stage-mode",
      title: "Die Band im Bühnenmodus leiten",
      summary: "Wechsle als Admin den aktuellen Song für alle, ändere die Reihenfolge live und streich Songs, die ihr nicht spielt.",
      roles: ["admin"],
      kind: "task",
      keywords: ["Leader", "nächster Song", "live umsortieren", "ziehen", "streichen", "Song überspringen", "Song heute weglassen", "Band folgt", "Live-Sync"],
      related: ["stage-mode", "follow-in-stage-mode", "stage-click", "stage-bluetooth-sync"],
      body: [
        {
          type: "steps",
          items: [
            "Öffne den Bühnenmodus beim Gig.",
            "Prüfe den Status neben der Setlist: **Live** heißt, die Band folgt dir (**Die Band folgt dir**).",
            "Tippe auf **Weiter** oder **Zurück**, um die Band zum nächsten oder vorigen Song zu bringen, oder tippe auf einen beliebigen Song in der Liste (**Zu … wechseln**).",
            "Um die Reihenfolge zu ändern, halte einen Song, bis er sich anhebt, zieh ihn an seinen neuen Platz und lass los. Ein schnelles Wischen scrollt weiterhin die Liste, und ein Tippen macht den Song weiterhin zum aktuellen.",
            "Um einen Song heute auszulassen, tippe auf den runden −-Button am Ende seiner Zeile (**… heute streichen**). Der Titel wird durchgestrichen, und **Zurück** / **Weiter** springen darüber. Tippe auf + (**… zurückholen**), um ihn zurückzuholen.",
          ],
        },
        {
          type: "table",
          head: ["Status", "Bedeutung"],
          rows: [
            ["**Live**", "Über das Internet verbunden: Mitglieder folgen dir."],
            ["**Live · BT**", "Über das Internet verbunden und zusätzlich per Bluetooth am Senden."],
            ["**Bluetooth**", "Kein Internet: Mitglieder in der Nähe folgen dir per Bluetooth."],
            ["**Offline**", "Gerade erreicht nichts die Band."],
            ["**Speichern…**, **Gespeichert**, **Nicht gespeichert**", "Nach dem Ziehen: Die neue Reihenfolge wird kurz nach deiner letzten Bewegung gespeichert. **Gespeichert** erscheint kurz, dann kehrt der Status zurück."],
          ],
        },
        {
          type: "list",
          items: [
            "Mitglieder, die den Bühnenmodus später öffnen, springen auf den aktuellen Song.",
            "Eine neue Reihenfolge gilt für alle, auch für Mitglieder, die nicht mehr folgen, und wird in der Setlist des Gigs gespeichert. Der Gig hinter dem Bühnenmodus zeigt sie sofort.",
            "Beim Schließen des Bühnenmodus wird eine Verschiebung gespeichert, die noch auf das Speichern wartet.",
            "Leiten mehrere Admins gleichzeitig, gewinnt die neueste Bewegung.",
            "Einen Song streichen gilt nur für heute: Die Setlist des Gigs behält ihn. Mitglieder, die dir folgen, sehen ihn durchgestrichen und überspringen ihn auch, über das Internet oder Bluetooth. Dein Handy merkt sich die gestrichenen Songs für diesen Gig, wenn du den Bühnenmodus schließt und wieder öffnest.",
          ],
        },
        {
          type: "note",
          tone: "tip",
          text: "Lass dein Handy entsperrt: Der Bühnenmodus hält den Bildschirm an, und ein gesperrtes Handy des Leaders stoppt die Synchronisierung der Band.",
        },
      ],
    },
    {
      id: "follow-in-stage-mode",
      title: "Im Bühnenmodus dem Leader folgen",
      summary: "Lass als Mitglied das Handy des Admins deine Songs weiterschalten oder blättere selbst.",
      roles: ["member"],
      kind: "task",
      keywords: ["folgen", "dem Leader folgen", "Sync", "gleicher Song"],
      related: ["stage-mode", "lead-stage-mode", "stage-bluetooth-sync"],
      body: [
        {
          type: "steps",
          items: [
            "Öffne den Bühnenmodus beim Gig. Folgen ist eingeschaltet: Der Button neben der Setlist zeigt **Warte auf Leader**, bis das Handy des Admins gefunden ist, dann **Mit dem Leader**.",
            "Dein aktueller Song, Songtext und Akkorde wechseln, wenn der Admin weitergeht.",
            "Um selbst vorauszuschauen, tippe auf **Zurück**, **Weiter** oder einen Song. Das Folgen endet, und der Button zeigt **Leader folgen**.",
            "Tippe auf **Leader folgen**, um zum Song des Leaders zurückzuspringen und wieder zu folgen.",
          ],
        },
        {
          type: "list",
          items: [
            "**· BT** hinter der Bezeichnung heißt, dass du per Bluetooth mit dem Leader verbunden bist.",
            "**Offline** heißt, dass gerade nichts dein Handy erreichen kann.",
            "Mitglieder können den Song anderer nicht wechseln und die Reihenfolge nicht ändern.",
          ],
        },
      ],
    },
    {
      id: "stage-click",
      title: "Den Klick im Bühnenmodus nutzen",
      summary: "Ein visuelles Metronom am Bildschirmrand, im Takt auf allen Handys der Band.",
      roles: ["admin", "member"],
      kind: "task",
      keywords: ["Metronom", "Klick", "Einzählen", "Tempo", "BPM", "Beat"],
      related: ["stage-mode", "transpose-and-tempo"],
      body: [
        {
          type: "steps",
          items: [
            "Such im Bühnenmodus den Klick-Button zwischen **Zurück** und **Weiter**. Er zeigt das BPM des aktuellen Songs.",
            "Tippe darauf (**Klick starten**). Bei jedem Schlag leuchtet der Bildschirmrand auf, beim ersten Schlag des Takts heller.",
            "Tippe noch einmal darauf (**Klick stoppen**), um ihn anzuhalten.",
          ],
        },
        {
          type: "table",
          head: ["Wer ihn startet", "Was passiert"],
          rows: [
            ["Admin", "Der Klick läuft auf jedem Handy im Bühnenmodus, im Takt mit dem Handy des Leaders."],
            ["Mitglied", "Der Klick läuft nur auf deinem Handy."],
            ["Mitglied, während der Klick des Leaders läuft", "Der Button blendet ihn auf deinem Handy aus oder ein (**Klick auf diesem Handy ausblenden**, **Klick anzeigen**)."],
          ],
        },
        {
          type: "list",
          items: [
            "Der Klick ist nur visuell: Es gibt keinen Ton. Er blockiert keine Taps auf dem Bildschirm.",
            "Die Schläge pro Takt kommen aus der Taktart des iReal-Charts des Songs, sonst 4.",
            "Ein Song ohne BPM kann keinen Klick starten (**Kein BPM für diesen Song**). Trag das BPM im Songformular ein.",
            "Wechselst du zu einem anderen Song, wird der Klick des vorigen ausgeblendet.",
            "Die Handys bleiben auf etwa 20–40 ms genau im Takt: richtig zum Einzählen und als Tempo-Referenz, nicht als In-Ear-Klick.",
            "Der Klick der Band braucht Internet: Er wird nicht per Bluetooth gesendet.",
          ],
        },
      ],
    },
    {
      id: "stage-manager",
      title: "Das Audio der Songs von der Regie abspielen",
      summary: "Der Laptop oder das Tablet eines Admins, per Kabel am Mischpult, spielt die Aufnahme jedes Songs ab, und die Bildschirme der Band springen zum laufenden Song.",
      roles: ["admin", "member"],
      kind: "task",
      keywords: ["regie", "playback", "backing track", "audio", "mischpult", "wiedergabe", "kabel", "usb-c", "kopfhörerbuchse", "adapter", "pa", "offline", "ohne internet", "herunterladen"],
      related: ["stage-mode", "lead-stage-mode", "follow-in-stage-mode", "play-a-song-recording"],
      body: [
        {
          type: "p",
          text: "Der Laptop oder das Tablet eines Admins, am Mischpult angeschlossen, ist die Regie: das einzige Gerät, das das Audio der Songs abspielt. Spielt es einen Song, springen alle Bildschirme im Bühnenmodus zu diesem Song, auch außerhalb der Reihenfolge der Setlist. Die Handys der Mitglieder spielen nie Ton ab.",
        },
        {
          type: "steps",
          title: "Vor dem Gig",
          items: [
            "Gib jedem Song eine **Aufnahme** (eine Audiodatei) im Songformular. Songs ohne Aufnahme bewegen die Band trotzdem, aber es läuft nichts.",
            "Schließe das Gerät ans Mischpult an (siehe die Kabeltipps unten) und schalte Nicht stören ein, damit keine Mitteilungen über die PA kommen.",
            "In den Tagen davor, mit Internet, öffne den Gig: Unter der Setlist zählt **Audio auf diesem Gerät** die Songs, die schon da sind (zum Beispiel 3/10). Tippe auf **Audio laden**, um den Rest zu holen. In der App auf dem Handy startet es von selbst, wenn du die App in den 3 Tagen vor einem bestätigten Gig mit Internet öffnest. Die Dateien bleiben auf dem Gerät und landen nicht im Backup des Handys.",
            "Öffne den Gig online, öffne den Bühnenmodus und tippe auf **Regie: Audio von hier**. Das Gerät lädt das Audio des Abends herunter: Ein Balken zeigt den Stand, und der Ring um das ▶ jedes Songs füllt sich beim Laden.",
            "Warte, bis **Audio bereit** alle Songs zählt (zum Beispiel 10/10): ab dann spielt es ohne Internet. Lässt sich ein Song nicht laden, sagt dir die Regie das (siehe unten).",
          ],
        },
        {
          type: "steps",
          title: "Auf der Bühne",
          items: [
            "Tippe bei einem Song auf ▶, um ihn abzuspielen. Der Bildschirm aller springt zu diesem Song und zeigt **Läuft gerade** mit der Zeit.",
            "Der Player oben hat **Abspielen** / **Pause**; am Ende eines Songs spielt dieselbe Taste den nächsten. **Stopp** muss gedrückt gehalten werden, damit ein versehentlicher Tipp die Musik nicht abbricht.",
            "Ein Song ohne Audio, oder einer, der hier nicht abspielbar ist, zeigt das im Player, und aus **Abspielen** wird **Nächsten abspielen** mit dem ersten Song, der laufen kann. Die Band spielt ihn so lange live.",
            "Für einen Song, der nicht in der Setlist ist, tippe auf + (**Song außerhalb der Setlist spielen**) und wähle ihn im Repertoire. Er kommt direkt nach dem aktuellen Song in die Setlist, für alle.",
            "Zum Übergeben tippt der andere Admin auf seinem Gerät auf **Regie: Audio von hier** und dann auf **Übernehmen**: dein Audio stoppt. **Deaktivieren** beendet die Regie auf deinem Gerät.",
          ],
        },
        {
          type: "table",
          head: ["Wer", "Was angezeigt wird"],
          rows: [
            ["Die Regie (ein Admin)", "Den Player, ▶ bei jedem Song mit Audio, wohin der Ton geht (**Ausgang**) und wie viele Songs bereit sind."],
            ["Die anderen Admins und die Mitglieder", "Den laufenden Song, mit **Läuft gerade** oder **Pausiert** und der Zeit. Bist du bei einem anderen Song, bringt dich **Los** dorthin."],
            ["Alle, wenn die Regie geht", "Der Streifen verschwindet. Der Bühnenmodus funktioniert wie vorher."],
          ],
        },
        {
          type: "p",
          text: "Lässt sich ein Song nicht laden, tippe unter **Audio bereit** auf **1 nicht geladen**: Eine Seite zeigt die Songs und den Grund. Behebe es und tippe dann auf **Erneut versuchen**.",
        },
        {
          type: "table",
          head: ["Was dort steht", "Was tun"],
          rows: [
            ["Der Link führt zu keiner Audiodatei", "Die Aufnahme des Songs ist ein Link, der eine Seite öffnet, nicht die Datei. Teile die Datei in Google Drive mit „Jeder, der den Link hat“ oder lade sie beim Song hoch."],
            ["Kein Internet", "Verbinde dich: Der Song lädt von selbst, sobald du wieder online bist."],
            ["Dieses Gerät kann die Datei nicht abspielen", "Nimm eine MP3-, M4A- oder WAV-Datei."],
            ["Der Download wurde abgebrochen", "Tippe auf **Erneut versuchen**."],
          ],
        },
        {
          type: "list",
          title: "Das Kabel zum Mischpult",
          items: [
            "Laptops, iPads und Handys mit Kopfhörerbuchse: ein Miniklinkenkabel (3,5 mm) in den Eingang des Mischpults, zum Beispiel 3,5 mm auf zwei 6,3-mm-Klinken oder auf zwei Cinch.",
            "iPads und iPhones ohne Buchse (USB-C oder Lightning): Apples Adapter von USB-C (oder Lightning) auf 3,5 mm, dann dasselbe Kabel. Zum gleichzeitigen Laden nimm einen Adapter mit USB-C-Ladeanschluss (PD).",
            "Mischpulte mit USB-Eingang (viele digitale Pulte): ein USB-C-Kabel bringt den Ton direkt hinein. Dasselbe gilt für ein class-compliant USB-Audiointerface.",
            "Nie Bluetooth: der Ton kommt verspätet und kann abbrechen. Die App warnt dich, wenn der Ton über Bluetooth oder aus dem Lautsprecher des Geräts kommt.",
            "Stelle die Lautstärke des Geräts fast auf das Maximum und regle den Pegel am Mischpult.",
          ],
        },
        {
          type: "note",
          tone: "warning",
          text: "Löst sich das Kabel, kann der Ton stoppen oder auf den Lautsprecher des Geräts wechseln. Die App zeigt sofort eine Warnung: steck das Kabel wieder ein.",
        },
        {
          type: "devices",
          rows: [{ devices: ["web"], text: "Auf einem Laptop im Browser speichert der Browser das Audio: nutze immer denselben Browser und lösche seine Daten nicht vor dem Gig. Auch Google-Drive-Links werden geladen, wenn die Datei mit „Jeder, der den Link hat“ geteilt ist." }],
        },
      ],
    },
    {
      id: "stage-bluetooth-sync",
      title: "Bühnenmodus ohne Internet (Bluetooth)",
      summary: "Wie die Band per Bluetooth beim selben Song bleibt, wenn die Location keinen Empfang hat.",
      roles: ["admin", "member"],
      kind: "reference",
      keywords: ["Bluetooth", "offline", "kein Empfang", "kein WLAN", "BLE", "Bühnenschlüssel"],
      related: ["stage-mode", "lead-stage-mode", "follow-in-stage-mode"],
      body: [
        {
          type: "p",
          text: "In den Apps für iPhone, iPad und Android sendet das Handy des Admins den aktuellen Song und die Reihenfolge auch per Bluetooth. Handys von Mitgliedern in der Nähe empfangen das ohne Kopplung und ohne Internet.",
        },
        {
          type: "steps",
          title: "Vor dem Gig vorbereiten",
          items: [
            "Alle öffnen den Gig einmal, während sie online sind. Die App speichert die Setlist (mit Songtexten und Charts) und den Bluetooth-Schlüssel des Gigs auf dem Handy.",
            "Schalte Bluetooth ein und erlaube BandWith, es zu nutzen.",
            "Auf der Bühne öffnen alle den Bühnenmodus. Der Leader zeigt **Bluetooth** oder **Live · BT**; Mitglieder zeigen **· BT** hinter ihrer Folgen-Bezeichnung.",
          ],
        },
        {
          type: "list",
          title: "Wenn keine Verbindung zustande kommt",
          items: [
            "„Bluetooth ist aus oder nicht erlaubt. Schalte es in den Einstellungen ein, um ohne Internet synchron zu bleiben.“",
            "„Dieses Handy hat eine ältere Setlist. Geh einmal online, um per Bluetooth zu folgen.“ Das erscheint, wenn Songs hinzugefügt oder entfernt wurden, nachdem das Handy die Setlist zuletzt geladen hat. Eine neue Reihenfolge allein ist kein Problem.",
            "„Die Uhrzeit dieses Handys und die des Leaders liegen weit auseinander. Stell bei beiden Datum und Uhrzeit auf automatisch.“ Die Nachrichten des Leaders tragen seine Uhrzeit; liegt sie weit vor der dieses Handys, wird ihnen nicht gefolgt, weil ein Handy sie fälschen könnte.",
          ],
        },
        {
          type: "note",
          tone: "privacy",
          text: "Jeder Gig hat seinen eigenen geheimen Schlüssel, den nur die aktiven Mitglieder der Band bekommen. Nur Handys mit dem Schlüssel finden den Leader und akzeptieren seine Nachrichten.",
        },
        {
          type: "devices",
          rows: [{ devices: ["web"], text: "Keine Bluetooth-Synchronisierung und keine Kopie der Setlist auf dem Gerät: Der Bühnenmodus im Web braucht Internet." }],
        },
      ],
    },
    {
      id: "stage-mode-on-devices",
      title: "Bühnenmodus auf Handys, Tablets und Dual-Screen-Geräten",
      summary: "Wie sich der Bühnenmodus auf jedem Gerät und in jeder Haltung aufteilt.",
      roles: ["admin", "member"],
      kind: "reference",
      keywords: ["Querformat", "iPad", "Surface Duo", "Bodenmonitor", "Laptop-Haltung", "Vollbild", "Seitenleiste", "Pageturner"],
      related: ["stage-mode", "device-differences"],
      body: [
        {
          type: "devices",
          rows: [
            { devices: ["phone"], text: "Eine Spalte: Kopfzeile, Ablauf, Setlist oder Song, Zurück / Weiter unten." },
            { devices: ["phoneLand", "duoClosed"], text: "Quer (kurz und breit) stehen Zeiten und Schritte links und die Setlist oder der Song rechts. Bei geöffnetem Song zeigt die linke Spalte stattdessen die Setlist, damit du zu jedem Song springen kannst." },
            { devices: ["tablet", "duoBook", "duoLand"], text: "Der Bühnenmodus öffnet sich neben dem Listenbereich. **Vollbild** zeigt nur den Song auf dem ganzen Bildschirm (**Nur der Song**). Eine Setlist ohne Texte oder Charts bekommt stattdessen den ganzen Bildschirm: Zeiten und Schritte im ersten Bereich und die Setlist im zweiten, geteilt an der Kante der Bereiche, damit nichts auf dem Falz liegt; **Vollbild beenden** holt die Liste zurück. Bei geöffnetem Song steht die Setlist in einer Spalte daneben (im ersten Bereich, wenn das Gerät über beide geöffnet ist)." },
            { devices: ["duoClosed"], text: "**Bühnenmodus öffnen** sitzt in der Leiste; am Gig-Tag ist es die Hauptaktion der Leiste. **Vollbild** blendet die Leiste im Bühnenmodus aus." },
            { devices: ["duoLaptop"], text: "Bodenmonitor: Stell das Gerät wie einen Monitor auf den Bühnenboden. Die obere Hälfte zeigt den Songzähler (**Song … von …**), Titel, Tonart, BPM, nächsten Song und die vergangene Zeit oder den Songtext. Die untere Hälfte hat große Felder **Zurück** und **Weiter** und den Fortschritt des Sets; für heute gestrichene Songs werden übersprungen und ihre Fortschrittsabschnitte abgedunkelt. Pfeiltasten, Bild auf/ab und Leertaste blättern ebenfalls, sodass Bluetooth-Pageturner-Pedale funktionieren." },
            { devices: ["duoBook", "duoLaptop"], text: "**Nur der Song**: Auf einem Gerät, das über beide Bildschirme geöffnet ist, nehmen der Song und seine vier Buttons den breiteren Bildschirm ein, damit nichts auf dem Falz liegt. Wie ein Laptop gefaltet füllt der Song die obere Hälfte, und die untere Hälfte hat nur **Alles anzeigen**, **Zurück**, den Klick und **Weiter**." },
            { devices: ["web"], text: "Live-Sync über das Internet und der Klick funktionieren. Kein Bluetooth und keine Offline-Kopie der Setlist. Das Vollbild blendet auch die Leisten des Browsers aus, wo der Browser es erlaubt." },
          ],
        },
        { type: "p", text: "Zurück auf Android und Escape verlassen zuerst den Bühnenmodus, nicht den Gig darunter." },
      ],
    },
  ],

  faq: [
    {
      q: "Können Mitglieder Songs oder Setlists bearbeiten?",
      a: "Nein. Mitglieder lesen jeden Song und jede Setlist. Sie schlagen neue Songs und Änderungen an Songtext, Akkorden oder Notizen vor, und ein Admin prüft sie. Setlists dürfen nur Admins bearbeiten.",
      roles: ["member"],
    },
    {
      q: "Wer sieht meine Notizen zu einem Song?",
      a: "Nur du. Nicht die Band, nicht die Admins. Um eine zu teilen, öffne sie und tippe auf „Der Band vorschlagen“.",
    },
    {
      q: "Ich habe einen Song im Reader transponiert. Hat er sich für alle geändert?",
      a: "Nein. Transponieren im Reader oder im Bühnenmodus ändert nur deinen Bildschirm. Um die Tonart für die Band zu ändern, nutzt ein Admin im Songformular „Für die Band transponieren“.",
    },
    {
      q: "Warum kann ich keine Songliste importieren?",
      a: "Eine importierte Liste landet direkt in der Bibliothek der Band, deshalb dürfen das nur Admins. Mitglieder schlagen Songs einzeln vor.",
      roles: ["member"],
    },
    {
      q: "Ändert eine Änderung an der Setlist eines Gigs die gespeicherte Setlist, aus der ich sie geladen habe?",
      a: "Nein. Ein Gig bekommt seine eigene Kopie, benannt nach dem Gig. Die Setlist, aus der du geladen hast, bleibt, wie sie war.",
      roles: ["admin"],
    },
    {
      q: "Bekommt die Band für jeden Song, den ich verschiebe, eine Mitteilung?",
      a: "Nein. Gesendet wird erst, wenn du speicherst. Dann bekommt jede Person eine Push-Mitteilung, die die Änderungen zusammenfasst.",
      roles: ["admin"],
    },
    {
      q: "Funktioniert der Bühnenmodus ohne Internet?",
      a: "In den Apps für Handy und Tablet ja: Öffne den Gig einmal, während du online bist, und das Handy des Leaders hält die Band per Bluetooth synchron. Im Web braucht der Bühnenmodus Internet.",
    },
    {
      q: "Kann ich den Klick hören?",
      a: "Nein. Der Klick ist visuell: Bei jedem Schlag leuchtet der Bildschirmrand auf.",
    },
    {
      q: "Warum folgt mein Handy dem Leader nicht mehr?",
      a: "Wenn du selbst auf Zurück, Weiter oder einen Song tippst, endet das Folgen. Tippe auf „Leader folgen“, um zum Song des Leaders zurückzukehren.",
      roles: ["member"],
    },
    {
      q: "Was passiert mit einem vorgeschlagenen Song, den der Admin ablehnt?",
      a: "Er wird mit den angehängten Dateien gelöscht, und du bekommst eine Push-Mitteilung mit der Begründung des Admins, falls er eine angegeben hat.",
      roles: ["member"],
    },
    {
      q: "Warum sehe ich das iReal Pro Forum im Web nicht in der App?",
      a: "Das Forum lässt sich nicht in einer Webseite anzeigen, daher öffnet es sich in einem eigenen Fenster. Kopier dort einen Link und tippe auf „Link einfügen“ oder zieh den Link auf das Feld.",
    },
  ],

  glossary: [
    { term: "Repertoire", definition: "Die Song-Bibliothek der Band. Jedes aktive Mitglied liest jeden Song.", see: "repertoire-overview" },
    { term: "Bereit / Wird geübt / Vorschlag", definition: "Der Status eines Songs: von der Band gespielt, wird gerade geübt oder von einem Mitglied vorgeschlagen und wartet auf einen Admin.", see: "song-menu-actions" },
    { term: "Setlist", definition: "Eine geordnete Liste von Songs der Band für einen Gig oder einen Anlass, von Admins geschrieben.", see: "build-a-setlist" },
    { term: "Set", definition: "Ein Teil einer Setlist, zum Beispiel vor und nach einer Pause (Set 1, Set 2).", see: "setlists-and-sets" },
    { term: "Vorlagen-Setlist", definition: "Eine gespeicherte Setlist, die du in einen Gig lädst; der Gig bekommt eine eigene Kopie.", see: "setlists-and-sets" },
    { term: "Akkorde im Text", definition: "Akkorde in Klammern direkt vor dem Wort, auf das sie fallen, etwa [Am]Wort.", see: "lyrics-and-chords-format" },
    { term: "ChordPro", definition: "Ein Textformat für Songtexte mit Akkorden in Klammern. BandWith importiert .cho-, .chordpro- und .pro-Dateien.", see: "import-chords-and-lyrics" },
    { term: "MusicXML", definition: "Ein Dateiformat für Partituren. BandWith liest daraus Akkordsymbole und Songtext.", see: "import-chords-and-lyrics" },
    { term: "iReal-Pro-Chart", definition: "Ein Akkordchart Takt für Takt mit Form, Tonart, Stil und Tempo, importiert über einen iReal-Pro-Link.", see: "import-from-ireal-pro" },
    { term: "Songansicht", definition: "Wie ein Song angezeigt wird: Songtext, Text & Akkorde oder Akkordchart. Wird pro Gerät gemerkt.", see: "read-a-song" },
    { term: "Akkordchart", definition: "Nur die Akkorde: die Teile des Songs mit ihren Akkorden in Kästchen oder das iReal-Chart Takt für Takt.", see: "read-a-song" },
    { term: "Nur der Song", definition: "Das Vollbild von Bühnen- und Live-Modus: nur der Song, eine kleine Zeile mit seinem Namen, und Alles anzeigen, Zurück, der Klick und Weiter unten.", see: "stage-mode" },
    { term: "Für die Band transponieren", definition: "Tonart, Chart und Akkorde eines Songs für alle verschieben, über das Songformular.", see: "transpose-and-tempo" },
    { term: "Meine Notizen", definition: "Private Notizen und Dateien zu einem Song der Band, nur für dich sichtbar.", see: "my-notes-and-files" },
    { term: "Vorschlag", definition: "Der Vorschlag eines Mitglieds: ein neuer Song, eine Korrektur an Songtext oder Akkorden oder eine Notiz für die Band.", see: "review-song-suggestions" },
    { term: "Bühnenmodus", definition: "Der schwarze Bildschirm für den Gig-Tag mit Ablauf, Setlist und aktuellem Song.", see: "stage-mode" },
    { term: "Leader", definition: "Im Bühnenmodus der Band-Admin, dessen Songwechsel und Reihenfolge jedes Mitglied erreichen.", see: "lead-stage-mode" },
    { term: "Leader folgen", definition: "Eine Einstellung im Bühnenmodus, die den aktuellen Song eines Mitglieds beim Song des Leaders hält.", see: "follow-in-stage-mode" },
    { term: "Klick", definition: "Das visuelle Metronom des Bühnenmodus: ein Aufleuchten bei jedem Schlag, im Takt auf allen Handys.", see: "stage-click" },
    { term: "Ablauf", definition: "Die Zeiten für Load-in, Soundcheck, Show und Ende oben im Bühnenmodus.", see: "stage-mode" },
    { term: "Bodenmonitor", definition: "Der Bühnenmodus auf einem Dual-Screen-Gerät in Laptop-Haltung: Songinfos oben, große Felder Zurück / Weiter unten.", see: "stage-mode-on-devices" },
  ],
};

export default music;
