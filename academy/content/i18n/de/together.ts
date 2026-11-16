import type { AreaText } from '../../types';

const together: AreaText = {
  area: {
    id: "together",
    title: "Proben, Umfragen & Chat",
    intro: "Plane Proben, finde einen Termin, an dem die ganze Band kann, und redet miteinander in Band-, Event- und Direktchats.",
    icon: "chat",
  },

  articles: [
    // ───────────────────────────── Rehearsals ─────────────────────────────
    {
      id: "create-a-rehearsal",
      title: "Eine Probe erstellen",
      summary: "Plane eine Probe direkt: wer kommt, wann, wo, was sie kostet und woran ihr arbeitet.",
      roles: ["admin"],
      kind: "task",
      keywords: ["neue Probe", "Probe planen", "proben", "Bandprobe", "Session", "Probentermin"],
      related: ["rehearsal-songs-and-prep-tasks", "create-a-rehearsal-poll", "propose-a-rehearsal", "recurring-rehearsals", "rehearsal-drafts"],
      body: [
        {
          type: "p",
          text: "Admins planen eine Probe direkt, wenn sie den Termin schon kennen. Willst du erst herausfinden, wann alle Zeit haben, starte stattdessen eine Verfügbarkeitsumfrage: siehe [[create-a-rehearsal-poll]].",
        },
        {
          type: "steps",
          title: "Auf dem Handy",
          items: [
            "Tippe auf **Erstellen** (den +-Button in der unteren Leiste) und wähle **Neue Probe**. Du kannst auch den **Kalender** öffnen, auf einen leeren Tag tippen und **Probe** wählen.",
            "Lass **Planungsmodus** auf **Direkt planen**.",
            "Gib, wenn du magst, einen **Probentitel (optional)** ein. Ohne Titel wird die Probe nach ihrem Session-Typ benannt, zum Beispiel „Probe · Ganze Band“.",
            "Wähle einen **Session-Typ**: **Ganze Band**, **Gesang**, **Rhythmus**, **Akustik** oder **Sonstiges**. Gesang, Rhythmus und Akustik wählen die Mitglieder mit passendem Instrument vor; Sonstiges öffnet die ganze Besetzung.",
            "Prüfe die **Besetzung**. Tippe auf ein Mitglied, um es hinzuzufügen oder zu entfernen, oder tippe auf **Alle wählen**. Tippe auf **Weiter**.",
            "Tippe unter **Location oder Studio suchen…** den Ort ein oder tippe auf eine Schnellauswahl wie **Bandraum**, **Studio A**, **Heimstudio** oder **Offen**.",
            "Lege **Probendatum**, **Beginn** und **Ende** fest.",
            "Wähle eine **Wiederholung**: **Einmalig**, **Je Woche**, **14-tägig** oder **Monatlich**.",
            "Wähle unter **Location-Kosten** **Kostenlos** oder **Bezahlt**. Gib bei einem bezahlten Raum die **Studiokosten gesamt** ein: Die Karte zeigt den Betrag **Pro Person**. Tippe auf **Weiter**.",
            "Prüfe bei **PRÜFEN & BESTÄTIGEN** die Übersicht. Tippe auf **Session & Besetzung** oder **Datum & Studio**, um zurückzugehen und etwas zu ändern.",
            "Füge, wenn du magst, Songs und Vorbereitungsaufgaben hinzu (siehe [[rehearsal-songs-and-prep-tasks]]).",
            "Tippe auf **Probe erstellen**.",
          ],
        },
        {
          type: "note",
          tone: "tip",
          text: "**Weiter** bleibt im zweiten Schritt deaktiviert, bis die Probe einen Ort und ein Datum hat. Wähle **Offen**, wenn du noch keinen Raum gebucht hast.",
        },
        {
          type: "note",
          tone: "tip",
          text: "Ohne Verbindung bleibt die Probe auf deinem Gerät („Offline gespeichert • Wird bei Verbindung synchronisiert“) und wird gesendet, sobald du wieder online bist.",
        },
        {
          type: "p",
          text: "Jedes Mitglied in der Besetzung bekommt die Mitteilung „Neue Probe“ und eine Push-Mitteilung, und die Probe erscheint in seinem Kalender mit einer Karte **Kommst du?** (siehe [[answer-a-rehearsal-invite]]). Du selbst bist als dabei markiert, außer du hast dich aus der Besetzung genommen: Die Probe verwaltest du trotzdem.",
        },
        {
          type: "devices",
          rows: [
            {
              devices: ["tablet"],
              text: "Auf dem iPad ist der Assistent ein Bildschirm mit vier Karten: **Session**, **Datum & Uhrzeit**, **Ort & Kosten** und **Fokus, Notiz & Aufgaben**, dazu eine **Live-Vorschau** „So sieht es die Band“. Die Datumsleiste zeigt **Nächste 7 Tage** und wie viele Mitglieder an jedem Tag frei sind, **Aus den Band-Kalendern**. Du kannst der Band außerdem ein **Ziel / Notizen (optional)** schreiben. Tippe auf **Probe planen**, wenn der Kartenzähler vollständig ist.",
            },
            {
              devices: ["duoClosed", "duoBook", "duoLaptop", "duoLand"],
              text: "Auf dem iPhone Duo wird der Handy-Assistent genutzt. Schließen und Zurück wandern in die seitliche Leiste, wenn sie angezeigt wird.",
            },
          ],
        },
        { type: "shot", id: "shot-rehearsal-wizard", caption: "Der Proben-Assistent, Schritt 1: Session-Typ und Besetzung." },
        {
          type: "roles",
          rows: [
            { role: "admin", text: "Erstellt, bearbeitet und löscht Proben." },
            { role: "member", text: "Kann keine Probe erstellen. Dasselbe Menü **Erstellen** zeigt stattdessen **Probe vorschlagen**: siehe [[propose-a-rehearsal]]." },
            { role: "deputy", text: "Vertretungen sind keine Bandmitglieder und sehen den Proben-Assistenten nie." },
          ],
        },
      ],
    },
    {
      id: "rehearsal-songs-and-prep-tasks",
      title: "Songs und Vorbereitungsaufgaben zu einer Probe hinzufügen",
      summary: "Wähle die Songs, an denen ihr arbeitet, und was alle vor der Probe vorbereiten sollen.",
      roles: ["admin"],
      kind: "task",
      keywords: ["Fokus-Songs", "Proben-Setlist", "Aufgaben", "To-do", "vorbereiten", "mitbringen"],
      related: ["create-a-rehearsal", "edit-a-rehearsal", "the-rehearsal-page", "todo-and-task-templates"],
      body: [
        {
          type: "p",
          text: "Songs und Aufgaben fügst du im letzten Schritt des Assistenten hinzu (**PRÜFEN & BESTÄTIGEN**) oder später über [[edit-a-rehearsal]]. Die Songs werden zur Setlist der Probe, die Mitglieder auf der Probenseite als **FOKUS-SONGS** sehen.",
        },
        {
          type: "steps",
          title: "Songs",
          items: [
            "Tippe in der Karte **Setlist** auf **Songs hinzufügen** und wähle Songs aus deinem Repertoire.",
            "Oder tippe auf **Setlist-Vorlage**, um mit einer der gespeicherten Setlists der Band zu beginnen. Im Setlist-Editor kannst du die Bibliothek durchsuchen, einen Song von Hand hinzufügen (**Manuell**: **Songtitel \\*** und **Künstler**) und dann auf **Fertig** tippen.",
            "Um einen Song zu entfernen, tippe unter **Ausgewählte Songs** auf das X daneben.",
          ],
        },
        {
          type: "steps",
          title: "Vorbereitungsaufgaben",
          items: [
            "Tippe in der Karte **Vorbereitung** auf einen Vorschlag unter **Schnell hinzufügen**, etwa **Akkorde mitbringen** oder **Audio aufnehmen**.",
            "Oder gib unter **Neue Aufgabe** eine eigene Aufgabe ein und tippe auf **Hinzufügen**.",
            "Entferne eine Aufgabe mit dem X daneben unter **Band-Aufgaben**.",
          ],
        },
        {
          type: "p",
          text: "Beim Bearbeiten einer Probe hat der Bereich **Equipment & Aufgaben** außerdem **Aufgabe hinzufügen** und **Vorlage laden**, das alle Aufgaben einer gespeicherten To-do-Vorlage hinzufügt. Siehe [[todo-and-task-templates]].",
        },
        {
          type: "note",
          tone: "privacy",
          text: "Nur Admins wählen und ändern die Setlist der Probe. Mitglieder können sie über **FOKUS-SONGS** öffnen, aber nicht bearbeiten.",
        },
      ],
    },
    {
      id: "edit-a-rehearsal",
      title: "Eine Probe bearbeiten",
      summary: "Ändere Datum, Raum, Besetzung, Kosten, Setlist oder Aufgaben einer schon geplanten Probe.",
      roles: ["admin"],
      kind: "task",
      keywords: ["Probe ändern", "Probe verschieben", "neu planen", "Probe aktualisieren"],
      related: ["create-a-rehearsal", "delete-a-rehearsal", "rehearsal-and-chat-notifications"],
      body: [
        {
          type: "steps",
          items: [
            "Öffne die Probe im **Kalender** oder auf Start.",
            "Tippe unten in der Probe auf **ÄNDERN**.",
            "Öffne den Bereich, den du ändern willst: **Session & Wiederholung**, **Datum, Zeit & Studio**, **Studiokosten**, **Besetzung**, **Setlist** oder **Equipment & Aufgaben**. Ein Banner oben sagt, welche Felder Aufmerksamkeit brauchen.",
            "Tippe auf **Probe speichern**. Der Button bleibt deaktiviert, solange die Probe keinen Ort hat.",
          ],
        },
        {
          type: "p",
          text: "Tippst du mit ungespeicherten Änderungen auf **Abbrechen**, fragt BandWith **Änderungen speichern?** und lässt dich speichern, verwerfen oder weiter bearbeiten.",
        },
        {
          type: "list",
          title: "Wer es erfährt",
          items: [
            "Ein neues Datum, neue Zeiten oder ein neuer Ort schickt den Personen in der Probe die Mitteilung „Probe aktualisiert“ und eine Push-Mitteilung.",
            "Mitglieder, die du zur Besetzung hinzufügst, bekommen die Einladung „Neue Probe“.",
          ],
        },
        {
          type: "note",
          tone: "tip",
          text: "Zum Bearbeiten gibt es immer den Schritt-für-Schritt-Editor, auch auf dem iPad.",
        },
      ],
    },
    {
      id: "delete-a-rehearsal",
      title: "Eine Probe löschen (absagen)",
      summary: "Entferne eine Probe aus dem Kalender; alle Beteiligten werden informiert.",
      roles: ["admin"],
      kind: "task",
      keywords: ["Probe absagen", "Probe entfernen", "Probe löschen"],
      related: ["edit-a-rehearsal", "recurring-rehearsals"],
      body: [
        {
          type: "steps",
          items: [
            "Öffne die Probe.",
            "Tippe unter **ÄNDERN** und **PROBEN-CHAT** auf **LÖSCHEN**.",
            "Tippe auf **Ja, löschen** oder auf **ABBRECHEN**, um sie zu behalten.",
          ],
        },
        {
          type: "note",
          tone: "warning",
          text: "Löschen lässt sich nicht rückgängig machen. Eine wiederkehrende Probe ist ein einziger Termin; wenn du sie löschst, verschwinden also alle Termine der Serie.",
        },
        {
          type: "p",
          text: "Die Mitglieder der Probe bekommen die Mitteilung „Probe abgesagt“ und eine Push-Mitteilung. Öffnen sie sie über eine alte Mitteilung, sehen sie **Probe abgesagt** und den Hinweis, dass ein Admin sie entfernt hat.",
        },
      ],
    },
    {
      id: "rehearsal-drafts",
      title: "Eine Probe als Entwurf speichern",
      summary: "Verlass den Assistenten mittendrin und stell die Probe später fertig.",
      roles: ["admin"],
      kind: "task",
      keywords: ["Entwurf", "unfertig", "für später speichern"],
      related: ["create-a-rehearsal"],
      body: [
        {
          type: "steps",
          items: [
            "Tippe im Assistenten auf **Abbrechen** oder den Schließen-Button, nachdem du etwas eingegeben hast.",
            "Tippe bei **Diese Probe als Entwurf speichern?** auf **Entwurf speichern**. **Verwerfen** wirft sie weg, **Weiter bearbeiten** führt zurück.",
            "Zum Fertigstellen öffne den Entwurf über Entwürfe auf dem Startbildschirm oder über seinen Tag im Kalender.",
            "Um einen wieder geöffneten Entwurf wegzuwerfen, schließ den Assistenten und tippe auf **Entwurf löschen**.",
          ],
        },
        {
          type: "note",
          tone: "privacy",
          text: "Deine Entwürfe siehst nur du. Mitglieder bekommen nichts, bis du die Probe erstellst.",
        },
        {
          type: "p",
          text: "Schlägt das Speichern fehl, bleibt der Assistent offen und die Probe wird zusätzlich als Entwurf gesichert, damit nichts von deinen Eingaben verloren geht.",
        },
        {
          type: "devices",
          rows: [{ devices: ["tablet"], text: "Auf dem iPad hat der Editor auf einem Bildschirm in der Kopfzeile einen eigenen Button zum Speichern als Entwurf." }],
        },
      ],
    },
    {
      id: "recurring-rehearsals",
      title: "Wiederkehrende Proben",
      summary: "Wie wöchentliche, 14-tägige und monatliche Proben angezeigt werden und sich verhalten.",
      roles: ["admin", "member"],
      kind: "reference",
      keywords: ["wöchentliche Probe", "wiederholen", "jede Woche", "Serie", "14-tägig", "monatlich"],
      related: ["create-a-rehearsal", "delete-a-rehearsal", "answer-a-rehearsal-invite"],
      body: [
        {
          type: "p",
          text: "Wählst du bei **Wiederholung** etwas anderes als **Einmalig**, speichert BandWith eine Probe mit einer Wiederholungsregel. Die nächsten Termine erscheinen im Kalender etwa vier Monate im Voraus, höchstens 24 Termine.",
        },
        {
          type: "table",
          head: ["Wiederholung", "Anzeige in der Probe"],
          rows: [
            ["Einmalig", "EINMALIG"],
            ["Je Woche", "JEDEN {day}, zum Beispiel JEDEN DIENSTAG"],
            ["14-tägig", "JEDEN ZWEITEN {day}"],
            ["Monatlich", "MONATLICH"],
          ],
        },
        {
          type: "note",
          tone: "warning",
          text: "Alle Termine einer Serie gehören zur selben Probe: eine Besetzung, eine Antwort pro Mitglied, eine Setlist. Bearbeiten oder Löschen ändert also jeden Termin.",
        },
      ],
    },
    {
      id: "the-rehearsal-page",
      title: "Die Probenseite",
      summary: "Was eine Probe Admins und Mitgliedern zeigt.",
      roles: ["admin", "member"],
      kind: "reference",
      keywords: ["Probendetails", "Anwesenheit", "Studiokosten", "Fokus-Songs"],
      related: ["answer-a-rehearsal-invite", "edit-a-rehearsal", "event-and-rehearsal-chats", "rehearsal-songs-and-prep-tasks"],
      body: [
        {
          type: "p",
          text: "Öffne eine Probe im **Kalender** oder auf Start. Ihre Seite ist blau, in der Farbe der Proben, und hat diese Teile:",
        },
        {
          type: "list",
          items: [
            "**Kommst du?**: die Antwortkarte für eingeladene Mitglieder (siehe [[answer-a-rehearsal-invite]]).",
            "Zeitkacheln: **START**, **ENDE** und **RAUM**.",
            "**ANWESENHEIT**: wer eingeladen ist und was geantwortet wurde.",
            "**FOKUS-SONGS**: bis zu acht Songs, mit **+ … WEITERE** und **SETLIST** für die ganze Liste.",
            "**NOTIZEN**: die Notiz zur Probe, falls es eine gibt.",
            "**AUFGABEN**: die Vorbereitungsaufgaben und wie viele erledigt sind. Tippe auf eine Aufgabe, um sie abzuhaken.",
            "**STUDIOKOSTEN**: der Raum, die Stunden, die Summe und **Geteilt durch … Zusagen**, mit dem Betrag **PRO PERSON**.",
            "Buttons unten: **ÄNDERN**, **PROBEN-CHAT** und **LÖSCHEN** für Admins; **PROBEN-CHAT** für Mitglieder, die mit dabei oder vielleicht geantwortet haben.",
          ],
        },
        {
          type: "roles",
          rows: [
            { role: "admin", text: "Sieht alles oben, auch **STUDIOKOSTEN**, und kann die Probe bearbeiten oder löschen." },
            { role: "member", text: "Sieht die Probe nur, wenn der Admin ihn in die Besetzung aufgenommen hat. Sieht Zeiten, Raum, Anwesenheit, Fokus-Songs, Notizen und Aufgaben. Den Bereich Studiokosten sehen Mitglieder nicht. Aussteigen geht über das Menü **Weitere Optionen**." },
            { role: "deputy", text: "Vertretungen werden für Gigs angefragt, nicht für Proben, und sehen die Proben der Band nicht." },
          ],
        },
        {
          type: "note",
          tone: "privacy",
          text: "Die Gesamtkosten des Raums sind Geld der Band und bleiben bei den Admins. Während einer Umfrage sehen Mitglieder nur ihren Anteil („je 12 €“).",
        },
      ],
    },
    {
      id: "answer-a-rehearsal-invite",
      title: "Auf eine Probeneinladung antworten oder aussteigen",
      summary: "Sag dem Admin, ob du kommst, ändere deine Antwort oder steig später aus.",
      roles: ["member"],
      kind: "task",
      keywords: ["Zusage", "dabei", "vielleicht", "kann nicht", "Probe absagen", "aussteigen"],
      related: ["the-rehearsal-page", "rehearsal-and-chat-notifications"],
      body: [
        {
          type: "steps",
          title: "Antworten",
          items: [
            "Öffne die Probe über die Mitteilung „Neue Probe“ oder im **Kalender**.",
            "Tippe auf der Karte **Kommst du?** auf **DABEI**, **VIELLEICHT** oder **KANN NICHT**. Die Karte sagt, bis wann du antworten sollst („Antworte bis …, damit der Admin den Raum bestätigen kann.“).",
            "Um die Antwort später zu ändern, tippe auf der Karte **Deine Antwort** auf **Ändern** und wähle neu.",
          ],
        },
        {
          type: "steps",
          title: "Aussteigen",
          items: [
            "Öffne die Probe und tippe auf **Weitere Optionen** (den …-Button oben).",
            "Tippe in **Probenoptionen** auf **Aus dieser Probe aussteigen**.",
            "Bestätige mit **AUSSTEIGEN**. Der Admin wird informiert.",
          ],
        },
        {
          type: "note",
          tone: "warning",
          text: "Wenn du **KANN NICHT** antwortest oder aussteigst, verschwindet die Probe aus deinem Kalender. Frag einen Admin, wenn du wieder dabei sein willst.",
        },
        {
          type: "devices",
          rows: [{ devices: ["duoClosed", "duoBook", "duoLand"], text: "Auf dem iPhone Duo sitzt **Weitere Optionen** zusammen mit den anderen Aktionen der Kopfzeile in der seitlichen Leiste." }],
        },
      ],
    },
    {
      id: "propose-a-rehearsal",
      title: "Eine Probe vorschlagen (Mitglieder)",
      summary: "Bitte den Admin um eine Probe zu einem Thema, mit den Tagen, die dir passen.",
      roles: ["member"],
      kind: "task",
      keywords: ["Probe anfragen", "Probe vorschlagen", "Vorschlag Mitglied", "um Probe bitten"],
      related: ["handle-a-rehearsal-proposal", "rehearsal-polls-explained"],
      body: [
        {
          type: "steps",
          items: [
            "Tippe auf **Erstellen** (das + in der unteren Leiste) und wähle **Probe vorschlagen**. In einem leeren **Kalender** kannst du auch auf **Probe vorschlagen** tippen.",
            "Bist du in mehreren Bands, wähle die Band unter **Band wählen**.",
            "Gib ein **Thema** ein, zum Beispiel „Übergänge der neuen Setlist üben“. Das Feld ist Pflicht.",
            "Tippe, wenn du magst, auf die **Bevorzugte Tage (optional)**, die dir passen.",
            "Füge, wenn du magst, **Notizen oder Songs (optional)** hinzu.",
            "Tippe auf **An Admin senden**.",
          ],
        },
        {
          type: "p",
          text: "Die Admins der Band bekommen die Mitteilung „Neuer Probenvorschlag“ und eine Push-Mitteilung. Auf deinem Startbildschirm und im **Kalender** erscheint der Vorschlag als **Dein Probenvorschlag** mit **Admin prüft**, bis ein Admin daraus eine Umfrage macht oder ihn ablehnt.",
        },
        {
          type: "note",
          tone: "warning",
          text: "Du kannst pro Band alle 7 Tage einen Vorschlag senden. Hast du ihn verbraucht, zeigt der Bildschirm **Wochenlimit erreicht** und das Datum **Nächster möglicher Vorschlag**. Das Limit prüft auch der Server.",
        },
        {
          type: "list",
          title: "Sonderfälle",
          items: [
            "Noch in keiner Band: Du siehst **Band erforderlich** mit **Band erstellen**.",
            "Lehnt ein Admin deinen Vorschlag ab, bekommst du „Probenvorschlag abgelehnt“ und er verschwindet aus deiner Liste.",
            "Doch anders entschieden? Tippe bei deinem Vorschlag auf **Zurückziehen** und dann bei „Deinen Vorschlag zurückziehen?“ noch einmal auf **Zurückziehen**. Die Admins sehen ihn nicht mehr.",
          ],
        },
        { type: "roles", rows: [{ role: "admin", text: "Admins schlagen nichts vor: Sie erstellen die Probe oder eine Umfrage direkt. Siehe [[create-a-rehearsal]]." }] },
      ],
    },
    {
      id: "handle-a-rehearsal-proposal",
      title: "Auf den Probenvorschlag eines Mitglieds reagieren",
      summary: "Mach aus dem Vorschlag eines Mitglieds eine Verfügbarkeitsumfrage oder lehne ihn ab.",
      roles: ["admin"],
      kind: "task",
      keywords: ["Vorschlag", "Umfrage erstellen", "Vorschlag ablehnen", "Anfrage Mitglied"],
      related: ["propose-a-rehearsal", "create-a-rehearsal-poll"],
      body: [
        {
          type: "steps",
          items: [
            "Du findest den Vorschlag unter **Probenplanung** in „Zu erledigen“ auf Start oder im **Kalender**. Er zeigt **Probenvorschlag eines Mitglieds**, **Vorgeschlagen von**, die **Bevorzugte Tage** und die Notiz. Du kannst ihn auch über die Mitteilung „Neuer Probenvorschlag“ öffnen.",
            "Tippe auf **Zur Umfrage** (im Mitteilungsfenster: **Umfrage aus Vorschlag erstellen**). Der Umfrage-Editor öffnet sich mit dem Thema als Titel, der Notiz und den bevorzugten Tagen schon ausgewählt.",
            "Füge Termine hinzu und starte die Umfrage wie in [[create-a-rehearsal-poll]].",
            "Oder tippe auf **Ablehnen**, um den Vorschlag ohne Umfrage zu schließen. Das Mitglied, das ihn gemacht hat, bekommt „Probenvorschlag abgelehnt“.",
          ],
        },
        {
          type: "note",
          tone: "tip",
          text: "Ein Vorschlag von Mitgliedern enthält keine Songs, keinen Ort und keine Kosten. Ergänze sie im Editor, bevor du die Umfrage startest.",
        },
      ],
    },

    // ───────────────────────────── Polls ─────────────────────────────
    {
      id: "create-a-rehearsal-poll",
      title: "Eine Verfügbarkeitsumfrage erstellen",
      summary: "Biete der Band ein paar Termine an und lass die Mitglieder über die passenden abstimmen.",
      roles: ["admin"],
      kind: "task",
      keywords: ["Umfrage", "abstimmen", "Verfügbarkeit", "Termin finden", "Doodle", "Terminumfrage"],
      related: ["poll-who-votes-and-deadline", "vote-in-a-rehearsal-poll", "lock-in-a-poll-date", "rehearsal-polls-explained"],
      body: [
        {
          type: "steps",
          title: "Auf dem Handy",
          items: [
            "Tippe auf **Erstellen**, wähle **Neue Probe** und stell dann **Planungsmodus** auf **Umfrage**. Der Editor **Verfügbarkeitsumfrage** öffnet sich.",
            "Gib einen **Titel der Umfrage** ein und, wenn du magst, **Ziel / Notizen (optional)**.",
            "Tippe unter **Wer abstimmt** auf ein Mitglied, um es auszuschließen. Du stimmst immer mit ab.",
            "Fülle unter **Ort, Kosten & Songs** **Ort / Studio**, die **Raumkosten** (die **Aufteilung** zeigt den Anteil jeder Person) und die **Fokus-Songs** aus (tippe auf **Hinzufügen**).",
            "Füge Termine hinzu. Mit **Ganze Woche** wählst du **Diese Woche** oder **Nächste Woche**, tippst auf die **Tage**, legst **Start** und **Ende** fest und tippst auf **Gewählte Tage zur Umfrage hinzufügen**. Jeder Tag zeigt, wie viele Mitglieder frei sind. Mit **Datum / Uhrzeit frei** wählst du **Terminvorschlag**, **Start** und **Ende** und tippst auf **Termin zur Umfrage hinzufügen**.",
            "Prüfe die **Terminvorschläge**. Entferne einen mit **Termin entfernen** oder tippe auf **Alle löschen**.",
            "Lege, wenn du magst, **Abstimmen bis** fest: einen Tag und eine Uhrzeit (siehe [[poll-who-votes-and-deadline]]).",
            "Tippe auf **Umfrage starten**.",
          ],
        },
        {
          type: "p",
          text: "Jedes Mitglied, das abstimmen soll, bekommt die Mitteilung „Stimm über die Probenzeiten ab“ und eine Push-Mitteilung. Die Umfrage erscheint als **Umfrage · Aktiv** auf Start und im **Kalender** unter **Probenplanung**.",
        },
        {
          type: "list",
          title: "Was das Starten verhindert",
          items: [
            "Kein Titel: „Gib deiner Umfrage einen Titel.“",
            "Kein Termin: „Füg mindestens einen Termin hinzu, über den die Mitglieder abstimmen.“",
            "Ein Abstimmungstag nach dem ersten Termin: „Wähle einen Tag vor dem ersten Termin“.",
            "Denselben Tag mit derselben Startzeit zweimal hinzufügen: „Dieser Termin ist bereits hinzugefügt.“",
          ],
        },
        {
          type: "devices",
          rows: [
            {
              devices: ["tablet"],
              text: "Auf dem iPad ist die Umfrage ein Editor auf einem Bildschirm, **Neue Probe** mit „Umfrage · Mitglieder stimmen über Termine ab“. Karten: **Session & Besetzung**, **Terminvorschläge** (eine Wochenleiste, gefärbt danach, wie viele Mitglieder frei sind; tippe auf einen Tag, um ihn mit den gewählten Zeiten hinzuzufügen), **Ort, Kosten & Songs** und **Abstimmungsfrist & Notiz**. Eine **Live-Vorschau** zeigt die Termine „So stimmen die Mitglieder ab“, mit dem **Favorit**.",
            },
          ],
        },
        { type: "shot", id: "shot-poll-builder", caption: "Der Editor für Verfügbarkeitsumfragen auf dem Handy." },
        {
          type: "note",
          tone: "privacy",
          text: "Die Zahl der Freien kommt aus den Kalendern aller, aber angezeigt wird nur die Zahl („4 von 5 frei“), nie wer verhindert ist oder warum.",
        },
      ],
    },
    {
      id: "poll-who-votes-and-deadline",
      title: "Wer abstimmt und bis wann",
      summary: "Beschränke eine Umfrage auf einige Mitglieder und sag ihnen, bis wann sie antworten sollen.",
      roles: ["admin", "member"],
      kind: "reference",
      keywords: ["Einladungsliste", "Eingeladene", "Frist", "abstimmen bis", "wer abstimmt"],
      related: ["create-a-rehearsal-poll", "vote-in-a-rehearsal-poll"],
      body: [
        {
          type: "p",
          text: "Standardmäßig soll jedes aktive Mitglied abstimmen. Wenn du unter **Wer abstimmt** jemanden ausschließt, hat die Umfrage eine Einladungsliste.",
        },
        {
          type: "list",
          items: [
            "Nur eingeladene Mitglieder bekommen die Mitteilung zur Umfrage und können abstimmen. Die anderen in der Band können die Umfrage nur ansehen, markiert mit **Nicht eingeladen**; der Server lehnt ihre Stimmen ab.",
            "Die Admins der Band sehen die Umfrage immer. Der Admin, der sie startet, steht immer auf der Liste.",
            "Wenn du einen Termin festlegst, kommen nur die eingeladenen Mitglieder in die Probe: du auch, wenn du eingeladen warst oder abgestimmt hast. Verwalten kannst du sie so oder so.",
            "Der Anteil an den Raumkosten wird durch die Zahl der Personen geteilt, die abstimmen sollen.",
          ],
        },
        {
          type: "p",
          text: "**Abstimmen bis** ist ein Tag zwischen heute und dem ersten Terminvorschlag, dazu eine Uhrzeit (18:00, wenn du nichts änderst). Mitglieder sehen in der Umfrage „Abstimmen bis Fr., 11. Dez., 18:00“.",
        },
        {
          type: "note",
          tone: "warning",
          text: "Zur Abstimmungsfrist endet die Abstimmung: Die Umfrage zeigt **Abstimmung beendet** und „Die Abstimmung ist beendet. Ein Admin legt einen Termin fest.“ Spätere Stimmen lehnt der Server ab. Admins können trotzdem noch einen Termin festlegen.",
        },
      ],
    },
    {
      id: "vote-in-a-rehearsal-poll",
      title: "In einer Verfügbarkeitsumfrage abstimmen",
      summary: "Tippe auf die Termine, die dir passen, oder sag, dass keiner passt.",
      roles: ["member", "admin"],
      kind: "task",
      keywords: ["abstimmen", "Verfügbarkeit", "Termine wählen", "keiner passt", "Umfrage"],
      related: ["poll-who-votes-and-deadline", "lock-in-a-poll-date", "rehearsal-polls-explained"],
      body: [
        {
          type: "steps",
          title: "Über die Umfragekarte",
          items: [
            "Such auf Start („Zu erledigen“) oder im **Kalender** die Karte **Umfrage · Aktiv**. Ein Abzeichen zeigt **Abstimmen**, **Erledigt** oder **Keine passt**.",
            "Tippe auf jeden Termin, der dir passt. Tippst du noch einmal, nimmst du die Stimme zurück. Du kannst mehrere Termine wählen.",
            "Tippe auf **Details**, um jeden Termin mit „{count}/{total} verfügbar“, den **Favorit** und wer abgestimmt hat zu sehen. Nach deiner Stimme schließen sich die Details von selbst („Schließt in …s“); tippe auf **Offen lassen**, um das zu verhindern.",
            "Hast du abgestimmt und passt doch kein Termin, tippe in den Details auf **Keine passt**.",
          ],
        },
        {
          type: "steps",
          title: "Über die Mitteilung",
          items: [
            "Tippe auf die Push-Mitteilung „Stimm über die Probenzeiten ab“ oder auf die Mitteilung unter der Glocke und dann auf **Abstimmen**.",
            "Tippe in **Verfügbarkeit für die Probe** unter **Wähl die Termine, die dir passen** auf die Termine, an denen du kannst.",
            "Tippe auf **Fertig**. Passt keiner der Termine, tippe stattdessen auf **Keine passt**.",
          ],
        },
        {
          type: "p",
          text: "**Keine passt** löscht deine Stimmen und sagt dem Admin, dass dir kein Termin passt: Admins sehen „Kein Termin passt für …“. Stimmst du später für einen Termin, ersetzt das diese Antwort.",
        },
        {
          type: "list",
          title: "Was du beim Abstimmen siehst",
          items: [
            "Den Ort und deinen Anteil am Raum („Blackbox Studios · je 12 €“) und die Fokus-Songs.",
            "„{answered} von {total} haben geantwortet“ und, falls es eine gibt, die Abstimmungsfrist.",
            "Unter **Antworten**, wer für welchen Termin gestimmt hat, sobald jemand abgestimmt hat.",
          ],
        },
        {
          type: "note",
          tone: "tip",
          text: "Die Stimmen aktualisieren sich für alle live. Ohne Verbindung wird die Stimme nicht gespeichert und du siehst „Deine Stimme konnte nicht gespeichert werden. Versuch es noch mal.“",
        },
        { type: "shot", id: "shot-poll-card", caption: "Eine aktive Umfrage auf Start mit ihren Terminfeldern und Details." },
        {
          type: "devices",
          rows: [
            {
              devices: ["duoLaptop"],
              text: "In der Laptop-Haltung zeigt das Abstimmungsfenster Mitglieder und Tage auf dem oberen Bildschirm und deine Terminfelder mit **Festlegen** und **Fertig** auf dem unteren.",
            },
          ],
        },
      ],
    },
    {
      id: "lock-in-a-poll-date",
      title: "Einen Termin festlegen und die Probe erstellen",
      summary: "Wähle den Gewinnertermin einer Umfrage; BandWith erstellt die Probe und informiert die Band.",
      roles: ["admin"],
      kind: "task",
      keywords: ["Umfrage abschließen", "Termin bestätigen", "Umfrage schließen", "festlegen", "Gewinner"],
      related: ["vote-in-a-rehearsal-poll", "the-rehearsal-page", "answer-a-rehearsal-invite"],
      body: [
        {
          type: "steps",
          items: [
            "Tippe auf der Umfragekarte auf **Details · Festlegen**. Im Mitteilungsfenster schau unter **Antworten · Termin festlegen**.",
            "Tippe neben dem gewünschten Termin (oft dem **Favorit**) auf **Festlegen**.",
            "Prüfe den **Probenort**. Vorausgefüllt ist der Ort aus der Umfrage oder „Proberaum“.",
            "Tippe auf **Bestätigen & anlegen**.",
          ],
        },
        {
          type: "list",
          title: "Was passiert",
          items: [
            "Eine bestätigte Probe wird an diesem Datum und zu dieser Uhrzeit erstellt, mit Titel, Ort und Notiz der Umfrage.",
            "Die Raumkosten werden zu den Studiokosten der Probe, die Fokus-Songs zu ihrer Setlist.",
            "Die eingeladenen Mitglieder kommen in die Probe und antworten wie gewohnt ([[answer-a-rehearsal-invite]]). Du bist als dabei markiert.",
            "Die Umfrage wird geschlossen und verschwindet aus „Zu erledigen“. Mitglieder bekommen unter der Glocke die Mitteilung „Probe bestätigt!“ (ohne Push).",
          ],
        },
        {
          type: "note",
          tone: "tip",
          text: "Hat ein anderer Admin die Umfrage einen Moment vor dir festgelegt, siehst du „Diese Umfrage wurde schon festgelegt oder geschlossen.“ und es entsteht keine zweite Probe.",
        },
      ],
    },
    {
      id: "delete-a-rehearsal-poll",
      title: "Eine Umfrage löschen",
      summary: "Entferne eine Umfrage mit allen Terminen und Stimmen.",
      roles: ["admin"],
      kind: "task",
      keywords: ["Umfrage entfernen", "Umfrage abbrechen"],
      related: ["create-a-rehearsal-poll", "handle-a-rehearsal-proposal"],
      body: [
        {
          type: "steps",
          items: [
            "Öffne **Details · Festlegen** der Umfrage oder öffne sie über ihre Mitteilung.",
            "Tippe auf **Umfrage löschen**.",
            "Tippe bei **Probenumfrage löschen?** noch einmal auf **Umfrage löschen** oder auf **Abbrechen**.",
          ],
        },
        {
          type: "note",
          tone: "warning",
          text: "Alle vorgeschlagenen Termine und Stimmen der Mitglieder werden endgültig gelöscht. Das lässt sich nicht rückgängig machen, und die Mitglieder werden nicht informiert.",
        },
        {
          type: "p",
          text: "Um den Vorschlag eines Mitglieds zu schließen, zu dem es noch keine Umfrage gibt, nutze stattdessen **Ablehnen** (siehe [[handle-a-rehearsal-proposal]]).",
        },
      ],
    },
    {
      id: "rehearsal-polls-explained",
      title: "So funktionieren Vorschläge und Umfragen",
      summary: "Der Weg einer Probenanfrage, von der Idee eines Mitglieds bis zum Termin im Kalender.",
      roles: ["admin", "member"],
      kind: "reference",
      keywords: ["Umfragestatus", "Vorschlagsstatus", "Probenplanung", "Zu erledigen"],
      related: ["propose-a-rehearsal", "create-a-rehearsal-poll", "vote-in-a-rehearsal-poll", "lock-in-a-poll-date"],
      body: [
        {
          type: "table",
          head: ["Phase", "Was das bedeutet", "Wer es sieht"],
          rows: [
            ["Vorschlag (**Admin prüft**)", "Ein Mitglied hat um eine Probe gebeten.", "Das Mitglied, das ihn gemacht hat, und die Admins."],
            ["Umfrage (**Umfrage · Aktiv**)", "Ein Admin hat Termine zur Abstimmung gestellt.", "Eingeladene Mitglieder und die Admins."],
            ["Bestätigt (**Probe · Bestätigt**)", "Ein Termin wurde festgelegt; die Probe steht im Kalender.", "Alle in der Probe."],
            ["Abgelehnt oder gelöscht", "Ohne Probe geschlossen.", "Niemand: Sie verschwindet aus den Listen."],
          ],
        },
        {
          type: "p",
          text: "Offene Vorschläge und Umfragen erscheinen auf Start unter **Zu erledigen** und oben im **Kalender** unter **Probenplanung (…)**. Im **Kalender** folgen sie dem Bandfilter.",
        },
        {
          type: "roles",
          rows: [
            { role: "admin", text: "Startet Umfragen, macht aus Vorschlägen Umfragen, legt Termine fest, lehnt ab und löscht. Das kann jeder Admin der Band, nicht nur der, der die Umfrage gestartet hat." },
            { role: "member", text: "Schlägt vor (einmal pro Woche), stimmt ab, antwortet **Keine passt** und sieht, wer wofür gestimmt hat." },
            { role: "deputy", text: "Nimmt nicht an Umfragen der Band teil." },
          ],
        },
        {
          type: "devices",
          rows: [
            {
              devices: ["duoLaptop"],
              text: "In der Laptop-Haltung listet der „Band-Schreibtisch“ auf Start die Umfragen, bei denen du noch nicht abgestimmt hast, und Vorschläge, die auf eine Umfrage warten; tippe auf einen Eintrag, um ihn zu öffnen.",
            },
          ],
        },
      ],
    },

    // ───────────────────────────── Chat ─────────────────────────────
    {
      id: "the-chat-inbox",
      title: "Der Chat-Posteingang",
      summary: "Alle deine Band-, Event- und Direktchats in einer Liste.",
      roles: ["admin", "member"],
      kind: "reference",
      keywords: ["Nachrichten", "Posteingang", "Chatliste", "ungelesen", "Nachrichten durchsuchen"],
      related: ["start-a-chat", "send-and-reply-to-messages", "delete-a-chat", "who-can-message-whom"],
      body: [
        {
          type: "p",
          text: "Tippe in der unteren Leiste auf **Chat**. Das Abzeichen am Tab zählt die ungelesenen Nachrichten.",
        },
        {
          type: "list",
          items: [
            "Filtere mit **ALLE**, **DIREKT**, **BANDS** oder **EVENTS**. Jeder Filter zeigt seine eigene Zahl ungelesener Nachrichten.",
            "Chats mit ungelesenen Nachrichten stehen oben. Eine Zeile zeigt den Namen („ · Band“ beim Bandchat), die Uhrzeit, die letzte Nachricht und entweder die Zahl der ungelesenen oder die Häkchen deiner eigenen letzten Nachricht.",
            "Bist du in zwei oder mehr Bands, zeigt eine Zeile auch, zu welcher Band sie gehört.",
            "Ein grüner Punkt bei einem Direktchat heißt, dass die Person online ist.",
            "Gib mindestens zwei Buchstaben in **Chats durchsuchen…** ein, um Chats, Personen und Wörter in Nachrichten zu finden: Die Ergebnisse sind nach **CHATS**, **PERSONEN** und **NACHRICHTEN** gruppiert. Tippe auf **Suche löschen**, um zurückzugehen.",
            "Wisch einen Chat nach links, um ihn zu löschen ([[delete-a-chat]]).",
            "Starte einen neuen Chat mit dem + (**Neuer Chat**) oben ([[start-a-chat]]).",
          ],
        },
        { type: "shot", id: "shot-chat-inbox", caption: "Der Chat-Posteingang mit den Filtern nach Chat-Typ." },
        {
          type: "devices",
          rows: [
            { devices: ["tablet", "duoBook", "duoLand"], text: "Die Liste und die geöffnete Unterhaltung stehen nebeneinander; der geöffnete Chat ist in der Liste hervorgehoben." },
            { devices: ["duoClosed", "duoBook", "duoLand"], text: "Auf dem iPhone Duo sitzt das Suchfeld in der seitlichen Leiste." },
          ],
        },
        {
          type: "note",
          tone: "tip",
          text: "Im Solo-Modus (ohne Band) gibt es keinen Chat: Der Tab **Chat** öffnet den Kalender.",
        },
      ],
    },
    {
      id: "start-a-chat",
      title: "Einen Chat starten",
      summary: "Öffne den Bandchat, einen Event-Chat oder eine Direktnachricht.",
      roles: ["admin", "member"],
      kind: "task",
      keywords: ["neuer Chat", "jemandem schreiben", "DM", "Direktnachricht", "Bandchat"],
      related: ["who-can-message-whom", "event-and-rehearsal-chats", "the-chat-inbox"],
      body: [
        {
          type: "steps",
          items: [
            "Tippe in **Chat** oben auf das + (**Neuer Chat**).",
            "Wähle den **Chat-Typ**: **DIREKT**, **BAND** oder **EVENT**.",
            "Such und wähle eine Person (**Admins suchen…** oder **Mitglieder suchen…**), eine Band (**Bands suchen…**) oder ein Event (**Events suchen…**).",
            "Tippe unten auf den Button: **… schreiben** oder **Chat … öffnen**.",
          ],
        },
        {
          type: "p",
          text: "Gibt es den Chat schon, öffnet BandWith ihn, statt einen zweiten anzulegen. Eine Band hat einen Bandchat mit allen aktiven Mitgliedern; ein Event hat einen Chat mit seiner Besetzung.",
        },
        {
          type: "p",
          text: "Du kannst jemandem auch aus der Mitgliederliste der Band schreiben: Öffne das Mitglied und tippe auf den Nachrichten-Button. Er erscheint nur, wenn einer von euch Admin ist.",
        },
        {
          type: "roles",
          rows: [
            { role: "admin", text: "**DIREKT** listet alle Mitglieder deiner Bands. **EVENT** listet alle Events der Bands, die du leitest." },
            { role: "member", text: "**DIREKT** listet nur die **Admins** der Band („Direktnachrichten sind nur an Band-Admins möglich.“). **EVENT** listet nur die Events, bei denen du dabei bist und nicht abgesagt hast." },
          ],
        },
      ],
    },
    {
      id: "send-and-reply-to-messages",
      title: "Schreiben, antworten und erwähnen",
      summary: "Schreib Nachrichten, antworte auf eine bestimmte Nachricht, erwähne jemanden und lies ältere Nachrichten.",
      roles: ["admin", "member"],
      kind: "task",
      keywords: ["Nachricht senden", "antworten", "zitieren", "erwähnen", "@", "ältere Nachrichten", "offline"],
      related: ["message-receipts-and-online-status", "the-chat-inbox"],
      body: [
        {
          type: "steps",
          title: "Senden",
          items: [
            "Öffne einen Chat und tippe unten auf **Nachricht schreiben…**.",
            "Schreib deine Nachricht und tippe auf **Nachricht senden** (oder drück auf einer Tastatur die Eingabetaste).",
          ],
        },
        {
          type: "steps",
          title: "Auf eine Nachricht antworten",
          items: [
            "Wisch auf Handy oder Tablet die Nachricht nach rechts. Mit der Maus fährst du darüber und klickst auf **Auf Nachricht antworten**.",
            "Das Eingabefeld zeigt **Antwort an …**. Schreib und sende. Tippe auf **Antwort abbrechen**, um aufzuhören.",
          ],
        },
        {
          type: "steps",
          title: "Jemanden erwähnen",
          items: [
            "Tippe @ und den Anfang eines Namens.",
            "Tippe in den Vorschlägen auf die Person (die Eingabetaste wählt die erste). Erwähnungen werden fett angezeigt.",
          ],
        },
        {
          type: "list",
          title: "Gut zu wissen",
          items: [
            "In Band- und Event-Chats zeigt jede Nachricht den Namen des Absenders, bei Admins mit „ · Admin“.",
            "Der Chat lädt die letzten 50 Nachrichten. Scroll nach oben und tippe auf **Frühere Nachrichten laden**, um mehr zu sehen.",
            "Nachrichten sind reiner Text: Es gibt keine Anhänge, keine Reaktionen und kein Bearbeiten oder Löschen einzelner Nachrichten.",
            "Ohne Verbindung wird die Nachricht nicht gesendet und landet wieder im Eingabefeld, mit „Nachricht nicht gesendet. Prüfe deine Verbindung und versuch es noch mal.“ Sende sie erneut, wenn du online bist.",
            "Eine Erwähnung ist für alle hervorgehoben, schickt aber keine zusätzliche Mitteilung: Alle im Chat werden ohnehin über jede Nachricht informiert.",
          ],
        },
        {
          type: "devices",
          rows: [{ devices: ["duoLaptop"], text: "In der Laptop-Haltung füllen die Nachrichten den oberen Bildschirm, und das Eingabefeld öffnet sich auf dem unteren." }],
        },
      ],
    },
    {
      id: "event-and-rehearsal-chats",
      title: "Event- und Proben-Chats",
      summary: "Ein Chat für die Leute eines Gigs oder einer Probe, mit den Zeiten oben angeheftet.",
      roles: ["admin", "member"],
      kind: "reference",
      keywords: ["Event-Chat", "Gig-Chat", "Proben-Chat", "Besetzungs-Chat", "Event-Leiste"],
      related: ["start-a-chat", "gig-workspace", "the-rehearsal-page"],
      body: [
        {
          type: "steps",
          title: "Öffnen",
          items: [
            "Öffne den Gig oder die Probe.",
            "Tippe auf **EVENT-CHAT** (bei einem Gig) oder **PROBEN-CHAT** (bei einer Probe).",
          ],
        },
        {
          type: "p",
          text: "Im Chat sind die Besetzung des Events (alle, die nicht abgesagt haben) und die Admins der Band. Wer später zur Besetzung kommt, ist ab der nächsten Nachricht dabei.",
        },
        {
          type: "p",
          text: "Eine Leiste oben zeigt das Event: Titel, **Heute** / **Morgen** oder das Datum, **Load-in …** (oder **Start …**) und den Ort, dazu **Abgesagt** oder **Vergangener Termin**, wenn das zutrifft. Tippe darauf, um das Event zu öffnen.",
        },
        {
          type: "note",
          tone: "privacy",
          text: "Die Leiste und der Seitenbereich zeigen nur die Logistik: Zeiten, Ort und Status. Nie die Gage oder den Kunden.",
        },
        {
          type: "roles",
          rows: [
            { role: "admin", text: "Kann den Chat jedes Events der Band öffnen." },
            { role: "member", text: "Sieht den Chat-Button erst nach einer Zusage (oder bei Proben auch nach Vielleicht). Wer absagt, verliert den Zugriff: „Du kannst nur in Events schreiben, an denen du teilnimmst.“" },
          ],
        },
        {
          type: "devices",
          rows: [
            {
              devices: ["tablet", "duoBook", "duoLand"],
              text: "Mit zwei Bereichen (iPad im Querformat oder aufgeklapptes iPhone Duo) zeigt ein Kontextbereich neben dem Verlauf die Zeiten (**Load-in**, **Soundcheck**, **Show**, **Ende**), den Ort, den Status, **In diesem Chat · Besetzung …/…** und wer online ist, mit **Gig öffnen**.",
            },
          ],
        },
        { type: "shot", id: "shot-event-chat", caption: "Ein Event-Chat auf dem iPad mit Event-Leiste und Kontextbereich." },
        {
          type: "note",
          tone: "tip",
          text: "Persönliche Gigs haben keinen Chat: „Event-Chats gibt es für Events der Band.“",
        },
      ],
    },
    {
      id: "who-can-message-whom",
      title: "Wer wem schreiben kann",
      summary: "Die Chat-Regeln für Admins, Mitglieder und Vertretungen.",
      roles: ["admin", "member", "deputy"],
      kind: "reference",
      keywords: ["Chat-Regeln", "Berechtigungen", "Nachrichten eingeschränkt", "kann nicht schreiben"],
      related: ["start-a-chat", "event-and-rehearsal-chats"],
      body: [
        {
          type: "table",
          head: ["Chat", "Admin", "Mitglied"],
          rows: [
            ["Band-Chat", "Ja, in Bands, in denen du aktiv bist", "Ja, in Bands, in denen du aktiv bist"],
            ["Event-Chat", "Jedes Event deiner Band", "Nur Events, bei denen du dabei bist und nicht abgesagt hast"],
            ["Direktnachricht", "Alle in deinen Bands", "Nur Admins einer gemeinsamen Band"],
          ],
        },
        {
          type: "p",
          text: "Zwei Mitglieder können sich nicht direkt schreiben; sie reden im Band- oder Event-Chat. Die Regeln werden geprüft, wenn du einen Chat startest, und bei jedem Senden.",
        },
        {
          type: "p",
          text: "Greift eine Regel, wird das Eingabefeld durch ein Schloss mit dem Grund ersetzt, zum Beispiel „Direktnachrichten sind nur mit Admins der Band möglich.“ oder „Du hast keinen Zugriff mehr auf diesen Chat.“ (nachdem du die Band verlassen hast oder aus dem Gig genommen wurdest).",
        },
        {
          type: "roles",
          rows: [
            { role: "deputy", text: "Vertretungen sind keine Bandmitglieder und daher in keinem Band-, Event- oder Direktchat. Die Band erreicht sie über Vertretungsanfragen („In der App anfragen“), und sie antworten in Vertretungs-Gigs. Siehe [[deputy-in-the-app]]." },
          ],
        },
        {
          type: "note",
          tone: "privacy",
          text: "Ein Direktchat bleibt zwischen seinen beiden Personen. BandWith nutzt ihn nie für eine Unterhaltung mit jemand anderem, also kann niemand sonst diesen Verlauf lesen.",
        },
      ],
    },
    {
      id: "message-receipts-and-online-status",
      title: "Häkchen, Lesebestätigungen und Online-Status",
      summary: "Was die Uhr, ein Häkchen und zwei Häkchen bedeuten.",
      roles: ["admin", "member"],
      kind: "reference",
      keywords: ["Häkchen", "Lesebestätigung", "zugestellt", "gelesen", "online"],
      related: ["send-and-reply-to-messages", "the-chat-inbox"],
      body: [
        {
          type: "table",
          head: ["Zeichen", "Bedeutung"],
          rows: [
            ["Uhr (**Wird gesendet**)", "Deine Nachricht ist unterwegs."],
            ["Ein Häkchen (**Gesendet**)", "Auf dem Server gespeichert."],
            ["Zwei graue Häkchen (**Zugestellt**)", "Sie ist auf den Handys der anderen angekommen."],
            ["Zwei farbige Häkchen (**Gelesen**)", "Sie haben den Chat nach deiner Nachricht geöffnet."],
          ],
        },
        {
          type: "p",
          text: "In Band- und Event-Chats ändern sich die Häkchen erst, wenn alle die Nachricht bekommen oder gelesen haben. Wer nach dem Senden dazukam, zählt nicht mit.",
        },
        {
          type: "p",
          text: "Die Kopfzeile eines Direktchats zeigt **Online** oder **Offline**. Gruppenchats zeigen „{count} Mitglieder · {count} online“.",
        },
      ],
    },
    {
      id: "delete-a-chat",
      title: "Einen Chat löschen",
      summary: "Entferne einen Chat aus deiner Liste und lösch Nachrichten endgültig.",
      roles: ["admin", "member"],
      kind: "task",
      keywords: ["Unterhaltung löschen", "Chat leeren", "Chat entfernen", "Nachrichten löschen"],
      related: ["the-chat-inbox"],
      body: [
        {
          type: "steps",
          items: [
            "Wisch den Chat in der Chatliste nach links und tippe auf den Löschen-Button. Oder öffne den Chat und tippe oben rechts auf **Chat löschen** (den Papierkorb).",
            "Bestätige mit **Löschen** oder tippe auf **Abbrechen**.",
          ],
        },
        {
          type: "table",
          head: ["Chat", "Was gelöscht wird"],
          rows: [
            ["Direktchat", "Alle Nachrichten, für euch beide."],
            ["Band- oder Event-Chat", "Nur deine eigenen Nachrichten, für alle. Die anderen behalten den Rest der Unterhaltung."],
          ],
        },
        {
          type: "note",
          tone: "warning",
          text: "Das lässt sich nicht rückgängig machen. Der Chat verschwindet aus deiner Liste, bis eine neue Nachricht kommt; dann ist er wieder da, nur mit den neuen Nachrichten.",
        },
      ],
    },
    {
      id: "rehearsal-and-chat-notifications",
      title: "Mitteilungen zu Proben, Umfragen und Chat",
      summary: "Welche Aktionen wen informieren und welche zusätzlich eine Push-Mitteilung senden.",
      roles: ["admin", "member"],
      kind: "reference",
      keywords: ["Push", "Mitteilung", "Benachrichtigung", "Glocke", "Abzeichen"],
      related: ["answer-a-rehearsal-invite", "vote-in-a-rehearsal-poll", "send-and-reply-to-messages"],
      body: [
        {
          type: "table",
          head: ["Wann", "Wer informiert wird", "Push"],
          rows: [
            ["Ein Mitglied schlägt eine Probe vor", "Die Admins der Band", "Ja"],
            ["Ein Admin startet eine Umfrage", "Die Mitglieder, die abstimmen sollen", "Ja"],
            ["Ein Termin wird festgelegt", "Die Personen, die in die Probe kommen", "Nein, nur Glocke"],
            ["Eine Probe wird erstellt oder du wirst hinzugefügt", "Die eingeladenen Mitglieder", "Ja"],
            ["Datum, Uhrzeit oder Ort ändern sich", "Die Personen in der Probe", "Ja"],
            ["Eine Probe wird gelöscht", "Die Personen in der Probe", "Ja"],
            ["Ein Mitglied steigt aus oder antwortet", "Der Admin, der sie erstellt hat", "Ja beim Aussteigen"],
            ["Eine neue Chatnachricht", "Alle anderen im Chat", "Ja"],
          ],
        },
        {
          type: "list",
          items: [
            "Eine Mitteilung zu einer Umfrage öffnet das Abstimmungsfenster, eine zu einer Probe öffnet die Probe, eine Chat-Mitteilung öffnet den Chat.",
            "Öffnest du die App mit einer ungelesenen Umfrage oder einem ungelesenen Vorschlag, zeigt BandWith ihn einmal in einem kleinen Pop-up.",
            "Für einen Chat, den du gerade offen hast, kommt keine Push-Mitteilung. Öffnest du einen Chat, werden seine Mitteilungen als gelesen markiert.",
            "Gehört die Mitteilung zu einer anderen deiner Bands, fragt die App zuerst, ob du die Band wechseln willst.",
            "Schalte alle Push-Mitteilungen in **Einstellungen** mit **Push-Mitteilungen** aus („Gig-Einladungen, Umfragen, Chatnachrichten“). Unter der Glocke bleibt jede Mitteilung erhalten.",
          ],
        },
      ],
    },
  ],

  faq: [
    {
      q: "Kann ein Mitglied eine Probe erstellen?",
      a: "Nein. Mitglieder tippen auf **Probe vorschlagen**, und die Admins entscheiden. Admins planen die Probe direkt oder starten eine Umfrage.",
      roles: ["member"],
    },
    {
      q: "Warum kann ich nur einen Probenvorschlag pro Woche senden?",
      a: "Damit die Planung übersichtlich bleibt, kann jedes Mitglied pro Band alle 7 Tage einen Vorschlag machen. Der Bildschirm zeigt, ab wann du wieder vorschlagen kannst.",
      roles: ["member"],
    },
    {
      q: "Warum steht bei einer Umfrage „Nicht eingeladen“?",
      a: "Der Admin hat dich unter **Wer abstimmt** ausgeschlossen. Du kannst die Umfrage lesen, aber abstimmen dürfen nur eingeladene Mitglieder.",
      roles: ["member"],
    },
    {
      q: "Wird die Umfrage zur Abstimmungsfrist geschlossen?",
      a: "Für die Abstimmung ja: Nach der Frist zeigt die Umfrage **Abstimmung beendet**, und niemand kann mehr abstimmen. Ein Admin legt dann einen Termin fest oder löscht die Umfrage.",
    },
    {
      q: "Sehen Mitglieder, was der Proberaum kostet?",
      a: "Während einer Umfrage sehen sie nur ihren Anteil („je 12 €“). Die gesamten Studiokosten auf der Probenseite sehen nur Admins.",
    },
    {
      q: "Kann ich einem anderen Mitglied direkt schreiben?",
      a: "Nur wenn einer von euch Admin einer gemeinsamen Band ist. Sonst nutzt ihr den Band- oder den Event-Chat.",
      roles: ["member"],
    },
    {
      q: "Warum kann ich den Proben-Chat nicht öffnen?",
      a: "Mitglieder sehen **PROBEN-CHAT**, nachdem sie **DABEI** oder **VIELLEICHT** geantwortet haben. Hast du abgesagt, hast du keinen Zugriff mehr.",
      roles: ["member"],
    },
    {
      q: "Kann ich eine einzelne Nachricht bearbeiten oder löschen oder ein Foto schicken?",
      a: "Nein. Chatnachrichten sind nur Text. Du kannst auf eine Nachricht antworten oder den ganzen Chat löschen.",
    },
    {
      q: "Wenn ich einen Bandchat lösche, verliert die Band dann die Unterhaltung?",
      a: "Nein. Gelöscht werden nur deine eigenen Nachrichten. In einem Direktchat werden alle Nachrichten für beide gelöscht.",
    },
    {
      q: "Was passiert mit Nachrichten, die ich ohne Verbindung sende?",
      a: "Sie werden nicht gesendet. Der Text landet wieder im Eingabefeld, damit du ihn erneut senden kannst, sobald du online bist.",
    },
    {
      q: "Können Vertretungen den Chat nutzen?",
      a: "Nein. Vertretungen sind keine Bandmitglieder. Die Band erreicht sie über Vertretungsanfragen in der App.",
      roles: ["deputy"],
    },
  ],

  glossary: [
    { term: "Probenvorschlag", definition: "Die Bitte eines Mitglieds um eine Probe, mit Thema und bevorzugten Tagen. Sie wartet auf einen Admin.", see: "propose-a-rehearsal" },
    { term: "Verfügbarkeitsumfrage", definition: "Eine Liste von Terminvorschlägen, über die die Band abstimmt, bevor ein Admin einen auswählt.", see: "create-a-rehearsal-poll" },
    { term: "Terminvorschlag", definition: "Ein Datum mit Start- und Endzeit, das in einer Umfrage angeboten wird.", see: "create-a-rehearsal-poll" },
    { term: "Planungsmodus", definition: "Der Schalter zwischen **Direkt planen** und **Umfrage**, wenn ein Admin eine neue Probe beginnt.", see: "create-a-rehearsal" },
    { term: "Wer abstimmt", definition: "Die Mitglieder, die über eine Umfrage abstimmen sollen. Schließt du jemanden aus, entsteht eine Einladungsliste.", see: "poll-who-votes-and-deadline" },
    { term: "Abstimmen bis", definition: "Der Tag und die Uhrzeit, ab denen eine Umfrage keine Stimmen mehr annimmt. Danach zeigt sie „Abstimmung beendet“.", see: "poll-who-votes-and-deadline" },
    { term: "Favorit", definition: "Der Termin der Umfrage mit den bisher meisten Stimmen.", see: "vote-in-a-rehearsal-poll" },
    { term: "Keine passt", definition: "Eine Antwort in der Umfrage, die heißt, dass dir kein angebotener Termin passt. Sie löscht deine Stimmen und informiert den Admin.", see: "vote-in-a-rehearsal-poll" },
    { term: "Festlegen", definition: "Den Gewinnertermin einer Umfrage wählen; dabei entsteht die Probe.", see: "lock-in-a-poll-date" },
    { term: "Freie Mitglieder", definition: "Wie viele Mitglieder zu einer Zeit nichts anderes im Kalender haben, zum Beispiel „4 von 5 frei“. Angezeigt wird nur die Zahl.", see: "create-a-rehearsal-poll" },
    { term: "Fokus-Songs", definition: "Die Songs, an denen ihr in einer Probe arbeitet. Sie werden zur Setlist der Probe.", see: "rehearsal-songs-and-prep-tasks" },
    { term: "Session-Typ", definition: "Ganze Band, Gesang, Rhythmus, Akustik oder Sonstiges: Er gibt der Probe ihren Namen und wählt die Besetzung vor.", see: "create-a-rehearsal" },
    { term: "Band-Chat", definition: "Der eine Chat, in dem alle aktiven Mitglieder einer Band sind.", see: "start-a-chat" },
    { term: "Event-Chat", definition: "Der Chat eines Gigs oder einer Probe, für seine Besetzung und die Admins.", see: "event-and-rehearsal-chats" },
    { term: "Event-Leiste", definition: "Die Leiste oben in einem Event-Chat mit Datum, Load-in- oder Startzeit und Ort.", see: "event-and-rehearsal-chats" },
    { term: "Häkchen", definition: "Die Zeichen neben deinen Nachrichten: wird gesendet, gesendet, zugestellt, gelesen.", see: "message-receipts-and-online-status" },
  ],
};

export default together;
