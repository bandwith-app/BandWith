import type { AreaText } from '../../types';

const together: AreaText = {
  area: {
    id: "together",
    title: "Ensayos, encuestas y chat",
    intro: "Programa ensayos, encuentra una fecha a la que pueda ir toda la banda y habla con los demás en los chats de la banda, de los eventos y privados.",
    icon: "chat",
  },

  articles: [
    {
      id: "create-a-rehearsal",
      title: "Crea un ensayo",
      summary: "Programa un ensayo directamente: quién viene, cuándo, dónde, cuánto cuesta y qué se va a trabajar.",
      roles: ["admin"],
      kind: "task",
      keywords: ["nuevo ensayo", "programar ensayo", "ensayar", "ensayo de la banda", "sesión"],
      related: ["rehearsal-songs-and-prep-tasks", "create-a-rehearsal-poll", "propose-a-rehearsal", "recurring-rehearsals", "rehearsal-drafts"],
      body: [
        { type: "p", text: "Los admins programan un ensayo directamente cuando ya saben la fecha. Si primero quieres saber cuándo está libre la gente, haz una encuesta de disponibilidad: consulta [[create-a-rehearsal-poll]]." },
        {
          type: "steps",
          title: "En un móvil",
          items: [
            "Toca **Crear** (el botón + de la barra inferior) y elige **Nuevo ensayo**. También puedes abrir el **Calendario**, tocar un día vacío y elegir **Ensayo**.",
            "Deja el **Modo de programación** en **Programar ya**.",
            "Si quieres, escribe un **Título del ensayo (opcional)**. Sin título, el ensayo se nombra según su tipo de sesión, por ejemplo «Ensayo · Banda completa».",
            "Elige un **Tipo de sesión**: **Banda completa**, **Voces**, **Rítmica**, **Acústico** u **Otro**. Voces, Rítmica y Acústico preseleccionan a los miembros cuyo instrumento encaja; Otro abre la plantilla entera.",
            "Revisa la **Plantilla**. Toca un miembro para añadirlo o quitarlo, o toca **Seleccionar todo**. Toca **Siguiente**.",
            "En **Busca sala o estudio…** escribe el lugar, o toca una opción rápida como **Local de la banda**, **Estudio A**, **Home studio** o **A def.**.",
            "Fija la **Fecha del ensayo**, el **Inicio** y el **Fin**.",
            "Elige una **Repetición**: **Una vez**, **Semanal**, **Quincenal** o **Mensual**.",
            "En **Coste de la sala**, elige **Gratis** o **Pagado**. Para una sala de pago, escribe el **Coste total de sala**: la tarjeta muestra el importe **Por persona**. Toca **Siguiente**.",
            "En **REVISAR Y CONFIRMAR**, revisa el resumen. Toca **Sesión y plantilla** o **Fecha y sala** para volver y cambiar algo.",
            "Si quieres, añade canciones y tareas previas (consulta [[rehearsal-songs-and-prep-tasks]]).",
            "Toca **Crear ensayo**.",
          ],
        },
        { type: "note", tone: "tip", text: "**Siguiente** en el segundo paso sigue desactivado hasta que el ensayo tenga un lugar y una fecha. Elige **A def.** si aún no has reservado una sala." },
        { type: "note", tone: "tip", text: "Sin conexión, el ensayo se guarda en tu dispositivo («Guardado sin conexión • Se sincronizará al conectarte») y se envía cuando vuelves a tener conexión." },
        { type: "p", text: "Cada miembro de la plantilla recibe una notificación «Nuevo ensayo» y una push, y el ensayo aparece en su calendario con una tarjeta **¿Vienes?** (consulta [[answer-a-rehearsal-invite]]). Tú quedas marcado como que vas, salvo que te hayas quitado de la plantilla: sigues gestionando el ensayo." },
        {
          type: "devices",
          rows: [
            { devices: ["tablet"], text: "En un iPad, el asistente es una sola pantalla con cuatro tarjetas: **Sesión**, **Fecha y hora**, **Lugar y coste** y **Enfoque, nota y tareas**, además de una **Vista previa en vivo** «Como lo ve la banda». La franja de fechas muestra los **Próximos 7 días** con cuántos miembros están libres cada día **De los calendarios de la banda**. También puedes escribir un **Objetivo / notas (opcional)** para la banda. Toca **Programar ensayo** cuando el contador de tarjetas esté completo." },
            { devices: ["duoClosed", "duoBook", "duoLaptop", "duoLand"], text: "En el iPhone Duo se usa el asistente de móvil. Los controles de cerrar y volver pasan a la barra lateral cuando se muestra." },
          ],
        },
        { type: "shot", id: "shot-rehearsal-wizard", caption: "El asistente de ensayo, paso 1: tipo de sesión y plantilla." },
        {
          type: "roles",
          rows: [
            { role: "admin", text: "Crea, edita y elimina ensayos." },
            { role: "member", text: "No puede crear un ensayo. El mismo menú **Crear** muestra en su lugar **Proponer ensayo**: consulta [[propose-a-rehearsal]]." },
            { role: "deputy", text: "Los sustitutos no son miembros de la banda y nunca ven el asistente de ensayo." },
          ],
        },
      ],
    },
    {
      id: "rehearsal-songs-and-prep-tasks",
      title: "Añade canciones y tareas previas a un ensayo",
      summary: "Elige las canciones que se van a trabajar y lo que cada uno debe preparar antes del ensayo.",
      roles: ["admin"],
      kind: "task",
      keywords: ["canciones a ensayar", "setlist del ensayo", "tareas", "pendientes", "preparar", "traer"],
      related: ["create-a-rehearsal", "edit-a-rehearsal", "the-rehearsal-page", "todo-and-task-templates"],
      body: [
        { type: "p", text: "Las canciones y las tareas se añaden en el último paso del asistente (**REVISAR Y CONFIRMAR**) o más tarde desde [[edit-a-rehearsal]]. Las canciones pasan a ser la setlist del ensayo, que los miembros ven como **CANCIONES A ENSAYAR** en la página del ensayo." },
        {
          type: "steps",
          title: "Canciones",
          items: [
            "En la tarjeta **Setlist**, toca **Añadir canciones** y elige canciones de tu repertorio.",
            "O toca **Plantilla de setlist** para partir de una de las setlists guardadas de la banda. En el editor de setlists puedes buscar en la biblioteca, añadir una canción a mano (**Manual**: **Título de la canción \\*** y **Artista**) y luego tocar **Listo**.",
            "Para quitar una canción, toca la X junto a ella en **Canciones elegidas**.",
          ],
        },
        {
          type: "steps",
          title: "Tareas previas",
          items: [
            "En la tarjeta **Tareas previas**, toca una sugerencia de **Añadir rápido** como **Traer los acordes** o **Grabar audio**.",
            "O escribe tu propia tarea en **Nueva tarea** y toca **Añadir**.",
            "Quita una tarea con la X junto a ella en **Tareas de la banda**.",
          ],
        },
        { type: "p", text: "En un ensayo programado, **EDITAR** junto a **TAREAS** abre **Tareas**, con **Añadir** y, mientras no haya ninguna, **Cargar una lista de tareas**, que añade todas las tareas de una plantilla de lista de tareas guardada. Consulta [[todo-and-task-templates]]." },
        { type: "note", tone: "privacy", text: "Solo los admins eligen y cambian la setlist del ensayo. Los miembros pueden abrirla desde **CANCIONES A ENSAYAR**, pero no editarla." },
      ],
    },
    {
      id: "edit-a-rehearsal",
      title: "Edita un ensayo",
      summary: "Cambia la fecha, los horarios, la sala, la plantilla, el coste, las canciones a ensayar, las notas o las tareas de un ensayo programado, directamente en su página.",
      roles: ["admin"],
      kind: "task",
      keywords: ["cambiar ensayo", "mover ensayo", "reprogramar", "actualizar ensayo"],
      related: ["create-a-rehearsal", "delete-a-rehearsal", "rehearsal-and-chat-notifications"],
      body: [
        {
          type: "steps",
          items: [
            "Abre el ensayo desde el **Calendario** o desde Inicio.",
            "Toca lo que quieras cambiar: el lápiz de arriba o los recuadros **INICIO** y **FIN**, el recuadro **SALA**, o **EDITAR** junto a **ASISTENCIA**, **CANCIONES A ENSAYAR**, **NOTAS**, **TAREAS** o **COSTE DE SALA**.",
            "Se abre una hoja solo con esa parte. **Título, fecha y horarios** también tiene **Repetición**; **Plantilla** tiene **Seleccionar todo**.",
            "Toca **Guardar**. Sigue desactivado hasta que cambies algo.",
          ],
        },
        { type: "p", text: "Cerrar la hoja con **Cancelar**, ✕, Atrás o deslizando hacia abajo deja el ensayo como estaba. Si cambiaste algo, antes pregunta **¿Guardar los cambios?**: **Guardar cambios**, **Descartar** o **Seguir editando**. Abrir otra parte del ensayo pregunta lo mismo. Las canciones a ensayar se guardan con **Guardar** en la hoja de la setlist." },
        {
          type: "list",
          title: "A quién se avisa",
          items: [
            "Una fecha, unos horarios o un lugar nuevos envían una notificación y una push «Ensayo actualizado» a las personas del ensayo.",
            "Los miembros que añades a la plantilla reciben la invitación «Nuevo ensayo».",
          ],
        },
        { type: "note", tone: "tip", text: "Los ensayos pasados se editan igual, también en el iPad. Los miembros ven la página sin lápices ni **EDITAR**." },
      ],
    },
    {
      id: "delete-a-rehearsal",
      title: "Elimina (cancela) un ensayo",
      summary: "Quita un ensayo del calendario; se avisa a todos los que estaban en él.",
      roles: ["admin"],
      kind: "task",
      keywords: ["cancelar ensayo", "eliminar ensayo", "borrar ensayo"],
      related: ["edit-a-rehearsal", "recurring-rehearsals"],
      body: [
        {
          type: "steps",
          items: [
            "Abre el ensayo.",
            "Toca **ELIMINAR**, debajo de **CHAT DEL ENSAYO**.",
            "Toca **Sí, eliminar**, o **CANCELAR** para conservarlo. Un ensayo que se repite pregunta en cambio qué fechas: **Eliminar esta fecha** quita solo la fecha que abriste, **Eliminar toda la serie** quita todas las fechas con sus notas.",
          ],
        },
        { type: "note", tone: "warning", text: "Eliminar un ensayo o toda una serie no se puede deshacer. Una sola fecha eliminada puede volver: un admin abre la serie y toca **RESTAURAR** junto a ella, en **Fechas eliminadas**." },
        { type: "p", text: "Los miembros del ensayo reciben una notificación y una push «Ensayo cancelado». Si lo abren desde una notificación antigua, ven **Ensayo cancelado** y una nota de que un admin lo ha eliminado." },
      ],
    },
    {
      id: "rehearsal-drafts",
      title: "Guarda un ensayo como borrador",
      summary: "Deja el asistente a medias y termina el ensayo más tarde.",
      roles: ["admin"],
      kind: "task",
      keywords: ["borrador", "sin terminar", "guardar para luego"],
      related: ["create-a-rehearsal"],
      body: [
        {
          type: "steps",
          items: [
            "En el asistente, toca **Cancelar** o el botón de cerrar después de haber escrito algo.",
            "En **¿Guardar este ensayo como borrador?**, toca **Guardar borrador**. **Descartar** lo tira; **Seguir editando** vuelve al asistente.",
            "Para terminarlo, abre el borrador desde Borradores en la pantalla de Inicio, o desde su día en el calendario.",
            "Para tirar un borrador que has vuelto a abrir, cierra el asistente y toca **Eliminar borrador**.",
          ],
        },
        { type: "note", tone: "privacy", text: "Solo tú ves tus borradores. Los miembros no reciben nada hasta que creas el ensayo." },
        { type: "p", text: "Si falla el guardado, el asistente sigue abierto y el ensayo también se guarda como borrador, así que no pierdes nada de lo que escribiste." },
        {
          type: "devices",
          rows: [{ devices: ["tablet"], text: "En un iPad, el editor en una sola pantalla tiene su propio botón de guardar como borrador en la cabecera." }],
        },
      ],
    },
    {
      id: "recurring-rehearsals",
      title: "Ensayos periódicos",
      summary: "Cómo aparecen y funcionan los ensayos semanales, quincenales y mensuales.",
      roles: ["admin", "member"],
      kind: "reference",
      keywords: ["ensayo semanal", "repetir", "cada semana", "serie", "quincenal", "mensual"],
      related: ["create-a-rehearsal", "delete-a-rehearsal", "answer-a-rehearsal-invite"],
      body: [
        { type: "p", text: "Cuando pones una **Repetición** distinta de **Una vez**, BandWith guarda un solo ensayo con una regla de repetición. Las próximas fechas aparecen en el calendario con unos cuatro meses de antelación, hasta 24 fechas." },
        {
          type: "table",
          head: ["Repetición", "Qué muestra el ensayo"],
          rows: [
            ["Una vez", "UNA VEZ"],
            ["Semanal", "CADA {day}, por ejemplo CADA MARTES"],
            ["Quincenal", "{day} CADA 2 SEMANAS"],
            ["Mensual", "MENSUAL"],
          ],
        },
        { type: "note", tone: "warning", text: "Todas las fechas de una serie comparten el mismo ensayo: una plantilla, una respuesta por miembro, una setlist. Al editarlo cambian todas las fechas. Dos cosas se pueden hacer con una sola fecha: eliminarla (**Eliminar esta fecha**, consulta [[delete-a-rehearsal]]) y moverla: al cambiar la fecha, **¿Qué fechas mover?** ofrece **Solo esta fecha** o **Toda la serie**." },
      ],
    },
    {
      id: "the-rehearsal-page",
      title: "La página del ensayo",
      summary: "Qué muestra un ensayo a los admins y a los miembros.",
      roles: ["admin", "member"],
      kind: "reference",
      keywords: ["detalle del ensayo", "asistencia", "coste de sala", "canciones a ensayar", "modo en vivo"],
      related: ["answer-a-rehearsal-invite", "edit-a-rehearsal", "event-and-rehearsal-chats", "rehearsal-songs-and-prep-tasks", "stage-mode"],
      body: [
        { type: "p", text: "Abre un ensayo desde el **Calendario** o desde Inicio. Su página es azul, el color de los ensayos, y tiene estas partes:" },
        {
          type: "list",
          items: [
            "**¿Vienes?**: la tarjeta de respuesta para los miembros invitados (consulta [[answer-a-rehearsal-invite]]).",
            "**Abrir modo en vivo**, el botón de reproducir arriba a la derecha (en la barra lateral en un dispositivo de doble pantalla), en los próximos ensayos: las canciones a ensayar con letra, acordes y clic, con el admin guiando. Consulta [[stage-mode]].",
            "Las casillas de horarios: **INICIO**, **FIN** y **SALA**.",
            "**ASISTENCIA**: quién está invitado y qué ha respondido.",
            "**CANCIONES A ENSAYAR**: hasta ocho canciones, con **+ {count} MÁS** y **SETLIST** para ver la lista entera.",
            "**NOTAS**: la nota del ensayo, si la hay.",
            "**TAREAS**: las tareas previas y cuántas están hechas. Toca una tarea para marcarla.",
            "**COSTE DE SALA**: la sala, las horas, el total y **Dividido entre {count} asistentes**, con el importe **POR PERSONA**.",
            "Botones abajo: **CHAT DEL ENSAYO** y **ELIMINAR** para los admins, que cambian todo lo demás con **EDITAR** en cada parte; **CHAT DEL ENSAYO** para los miembros que han respondido que van.",
          ],
        },
        {
          type: "roles",
          rows: [
            { role: "admin", text: "Ve todo lo anterior, también el **COSTE DE SALA**, y puede editar o eliminar el ensayo." },
            { role: "member", text: "Solo ve el ensayo si el admin lo ha puesto en la plantilla. Ve los horarios, la sala, la asistencia, las canciones a ensayar, las notas y las tareas. La sección del coste de sala no se muestra a los miembros. Para salir del ensayo, está el menú **Más opciones**." },
            { role: "deputy", text: "A los sustitutos se les pide tocar en conciertos, no en ensayos, y no ven los ensayos de la banda." },
          ],
        },
        { type: "note", tone: "privacy", text: "El coste total de la sala es dinero de la banda y queda para los admins. Durante una encuesta, los miembros solo ven su parte («12 € cada uno»)." },
      ],
    },
    {
      id: "answer-a-rehearsal-invite",
      title: "Responde a la invitación a un ensayo o retírate",
      summary: "Dile al admin si vas, cambia tu respuesta o retírate más tarde.",
      roles: ["member"],
      kind: "task",
      keywords: ["responder", "voy", "no puedo", "rechazar ensayo", "retirarse"],
      related: ["the-rehearsal-page", "rehearsal-and-chat-notifications"],
      body: [
        {
          type: "steps",
          title: "Responde",
          items: [
            "Abre el ensayo desde la notificación «Nuevo ensayo» o desde el **Calendario**.",
            "En la tarjeta **¿Vienes?**, toca **VOY** o **NO PUEDO**. La tarjeta dice hasta cuándo puedes responder («Responde antes del … para que el admin pueda confirmar la sala.»).",
            "Para cambiarla más tarde, toca **Cambiar** en la tarjeta **Tu respuesta** y vuelve a elegir.",
            "Si antes respondiste quizás, la tarjeta dice «Tu respuesta era Quizás. Elige VOY o NO PUEDO.»: elige una.",
          ],
        },
        {
          type: "steps",
          title: "Retírate",
          items: [
            "Abre el ensayo y toca **Más opciones** (el botón … de arriba).",
            "En **Opciones del ensayo**, toca **Retirarme de este ensayo**.",
            "Confirma con **ME RETIRO**. El admin recibe un aviso.",
          ],
        },
        { type: "note", tone: "warning", text: "Cuando respondes **NO PUEDO** o te retiras, el ensayo desaparece de tu calendario. Pide a un admin que te vuelva a añadir si quieres ir." },
        {
          type: "devices",
          rows: [{ devices: ["duoClosed", "duoBook", "duoLand"], text: "En el iPhone Duo, **Más opciones** está en la barra lateral con las demás acciones de la cabecera." }],
        },
      ],
    },
    {
      id: "propose-a-rehearsal",
      title: "Propón un ensayo (miembros)",
      summary: "Pide al admin un ensayo sobre un tema, con los días que te vienen bien.",
      roles: ["member"],
      kind: "task",
      keywords: ["pedir ensayo", "sugerir ensayo", "propuesta de un miembro", "solicitar ensayo"],
      related: ["handle-a-rehearsal-proposal", "rehearsal-polls-explained"],
      body: [
        {
          type: "steps",
          items: [
            "Toca **Crear** (el + de la barra inferior) y elige **Proponer ensayo**. En un **Calendario** vacío también puedes tocar **Proponer ensayo**.",
            "Si estás en varias bandas, elige la banda en **Elige la banda**.",
            "Escribe un **Tema**, por ejemplo «Practicar las transiciones del nuevo setlist». Es obligatorio.",
            "Si quieres, toca los **Días preferidos (opcional)** que te vienen bien.",
            "Si quieres, añade **Notas o canciones (opcional)**.",
            "Toca **Enviar al admin**.",
          ],
        },
        { type: "p", text: "Los admins de la banda reciben una notificación y una push de nueva propuesta de ensayo. En tu pantalla de Inicio y en el **Calendario**, la propuesta aparece como **Tu propuesta de ensayo** con **Espera admin** y **Abierta hasta el** su último día: el último de tus días preferidos de la semana siguiente, o 7 días si no elegiste ninguno. Sigue ahí hasta que un admin la convierta en encuesta o la rechace, o hasta que pase ese día: entonces sale de todas las listas." },
        { type: "note", tone: "warning", text: "Puedes enviar una propuesta cada 7 días por banda. Cuando la has usado, la pantalla muestra **Límite semanal alcanzado** y la fecha de la **Próxima propuesta disponible**. El servidor también comprueba el límite." },
        {
          type: "list",
          title: "Casos especiales",
          items: [
            "Si aún no estás en una banda, ves **Necesitas una banda**, con **Crear una banda**.",
            "Si un admin rechaza tu propuesta, recibes «Propuesta de ensayo rechazada» (notificación y push), con el motivo si lo indicó, y desaparece de tu lista.",
            "¿Has cambiado de idea? Toca **Retirar** en tu propuesta y luego **Retirar** otra vez en «¿Retirar tu propuesta?». Los admins dejan de verla.",
          ],
        },
        { type: "roles", rows: [{ role: "admin", text: "Los admins no proponen: crean directamente el ensayo o una encuesta. Consulta [[create-a-rehearsal]]." }] },
      ],
    },
    {
      id: "handle-a-rehearsal-proposal",
      title: "Gestiona la propuesta de ensayo de un miembro",
      summary: "Convierte la propuesta de un miembro en una encuesta de disponibilidad, o recházala.",
      roles: ["admin"],
      kind: "task",
      keywords: ["propuesta", "crear encuesta", "rechazar propuesta", "descartar propuesta", "petición de un miembro"],
      related: ["propose-a-rehearsal", "create-a-rehearsal-poll"],
      body: [
        {
          type: "steps",
          items: [
            "Busca la propuesta en **Organización de ensayos**, en los Pendientes de Inicio o en el **Calendario**. Muestra **Propuesta de ensayo de un miembro**, **Propuesta de**, los **Días preferidos** y la nota. También puedes abrirla desde la notificación de nueva propuesta de ensayo.",
            "Toca **Crear encuesta** (en la hoja de la notificación: **Crear encuesta desde la propuesta**). El editor de encuestas se abre con el tema como título, la nota y los días preferidos ya marcados.",
            "Añade franjas de fecha y publícala como en [[create-a-rehearsal-poll]].",
            "O toca **Rechazar** para cerrar la propuesta sin encuesta. En **¿Rechazar esta propuesta?**, escribe si quieres un **Motivo** y toca **Rechazar**. El miembro que la propuso recibe «Propuesta de ensayo rechazada» (notificación y push) con tu motivo.",
            "Si no haces nada, la propuesta sale de la lista después del día que indica **Abierta hasta el**.",
          ],
        },
        { type: "note", tone: "tip", text: "La propuesta de un miembro no lleva canciones, lugar ni coste. Añádelos en el editor antes de publicar." },
      ],
    },
    {
      id: "create-a-rehearsal-poll",
      title: "Crea una encuesta de disponibilidad",
      summary: "Ofrece a la banda unas cuantas fechas y deja que los miembros voten las que les van bien.",
      roles: ["admin"],
      kind: "task",
      keywords: ["encuesta", "votar", "disponibilidad", "buscar fecha", "doodle", "encuesta de fechas"],
      related: ["poll-who-votes-and-deadline", "vote-in-a-rehearsal-poll", "lock-in-a-poll-date", "rehearsal-polls-explained"],
      body: [
        {
          type: "steps",
          title: "En un móvil",
          items: [
            "Toca **Crear**, elige **Nuevo ensayo** y cambia el **Modo de programación** a **Encuesta**. Se abre el editor de **Encuesta de disponibilidad**.",
            "Escribe un **Título de la encuesta** y, si quieres, un **Objetivo / notas (opcional)**.",
            "En **Quién vota**, toca un miembro para dejarlo fuera. Tú siempre votas.",
            "En **Lugar, coste y canciones**, rellena el **Lugar / sala** (escribe unas letras y elige una sugerencia, o deja lo que escribiste), el **Coste de la sala** (el **Reparto** muestra la parte de cada uno) y las **Canciones a trabajar** (toca **Añadir**).",
            "Añade fechas. Con **Semana completa**, elige **Esta semana** o **Próxima semana**, toca los días en **Incluir días**, fija el **Inicio** y el **Fin** y toca **Añadir los días elegidos a la encuesta**. Cada día muestra cuántos miembros están libres. Con **Fecha / hora a medida**, elige una **Fecha propuesta**, un **Inicio** y un **Fin** y toca **Añadir horario a la encuesta**.",
            "Revisa los **Horarios propuestos**. Quita uno con **Quitar horario**, o toca **Borrar todo**.",
            "Si quieres, fija **Votar antes del**: un día y una hora (consulta [[poll-who-votes-and-deadline]]).",
            "Toca **Publicar encuesta**.",
          ],
        },
        { type: "p", text: "Cada miembro al que se le pide votar recibe una notificación y una push para votar los horarios del ensayo. La encuesta aparece como **Encuesta · Activa** en Inicio y en el **Calendario**, en **Organización de ensayos**." },
        { type: "p", text: "¿Cambiaste de idea? **Atrás** (arriba o abajo, o el botón Atrás del teléfono) vuelve al formulario del ensayo; **Cerrar** sale de la encuesta. Si cambiaste algo, primero se te pregunta: **¿Descartar esta encuesta?** Toca **Seguir editando** o **Descartar**. Sin cambios, simplemente se cierra. Las encuestas no tienen borradores." },
        {
          type: "list",
          title: "Qué impide publicar",
          items: [
            "Sin título: «Ponle un título a la encuesta.»",
            "Sin horarios: «Añade al menos un horario para que los miembros voten.»",
            "Un día límite de votación posterior al primer horario: «Elige un día antes de la primera franja».",
            "Añadir dos veces el mismo día y la misma hora de inicio: «Este horario ya está añadido.»",
          ],
        },
        {
          type: "devices",
          rows: [
            { devices: ["tablet"], text: "En un iPad, la encuesta es un editor en una sola pantalla, **Nuevo ensayo** con «Encuesta · los miembros votan las fechas». Tarjetas: **Sesión y plantilla**, **Horarios propuestos** (una franja semanal coloreada según cuántos miembros están libres; toca un día para añadirlo con las horas elegidas), **Lugar, coste y canciones** y **Plazo de votación y nota**. Una **Vista previa en vivo** muestra los horarios «Como votan los miembros», con la **Favorita**." },
          ],
        },
        { type: "shot", id: "shot-poll-builder", caption: "El editor de encuestas de disponibilidad en un móvil." },
        { type: "note", tone: "privacy", text: "Los números de libres salen de los calendarios de todos, pero solo se muestra el número («4 de 5 libres»), nunca quién está ocupado ni por qué." },
      ],
    },
    {
      id: "poll-who-votes-and-deadline",
      title: "Quién vota y el plazo de votación",
      summary: "Limita una encuesta a algunos miembros y diles hasta cuándo pueden responder.",
      roles: ["admin", "member"],
      kind: "reference",
      keywords: ["lista de invitados", "invitados", "plazo", "votar antes del", "quién vota"],
      related: ["create-a-rehearsal-poll", "vote-in-a-rehearsal-poll"],
      body: [
        { type: "p", text: "Por defecto se pide votar a todos los miembros activos. Si dejas a alguien fuera en **Quién vota**, la encuesta tiene una lista de invitados." },
        {
          type: "list",
          items: [
            "Solo los miembros invitados reciben la notificación de la encuesta y pueden votar. Los demás de la banda pueden abrir la encuesta en modo solo lectura, marcada **Sin invitación**; el servidor rechaza sus votos.",
            "Los admins de la banda siempre ven la encuesta. El admin que la publica siempre está en la lista.",
            "Cuando fijas una fecha, solo los miembros invitados entran en el ensayo: tú también si estabas invitado o votaste. En cualquier caso, lo gestionas tú.",
            "La parte del coste de la sala se divide entre el número de personas a las que se pide votar.",
          ],
        },
        { type: "p", text: "**Votar antes del** es un día entre hoy y el primer horario propuesto, más una hora (las 18:00 si no la cambias). Los miembros ven «Vota antes del vie 11 dic, 18:00» en la encuesta." },
        { type: "note", tone: "warning", text: "A la hora límite se cierra la votación: la encuesta muestra **Votación cerrada** y «La votación ha terminado. Un admin fijará una fecha.» El servidor rechaza los votos posteriores. Los admins aún pueden fijar una fecha." },
      ],
    },
    {
      id: "vote-in-a-rehearsal-poll",
      title: "Vota en una encuesta de disponibilidad",
      summary: "Toca las fechas que te van bien, o di que no te va ninguna.",
      roles: ["member", "admin"],
      kind: "task",
      keywords: ["votar", "disponibilidad", "elegir fechas", "no me va ninguna", "encuesta"],
      related: ["poll-who-votes-and-deadline", "lock-in-a-poll-date", "rehearsal-polls-explained"],
      body: [
        {
          type: "steps",
          title: "Desde la tarjeta de la encuesta",
          items: [
            "En Inicio (Pendientes) o en el **Calendario**, busca la tarjeta **Encuesta · Activa**. Una etiqueta dice **Vota ya**, **Votado** o **Ninguna va**.",
            "Toca cada botón de fecha que te vaya bien. Tócalo otra vez para quitar el voto. Puedes elegir varias fechas.",
            "Toca **Detalles** para ver cada fecha con «{count}/{total} disponibles», la **Favorita** y quién ha votado. Después de votar, los detalles se cierran solos («Se cierra en …s»); toca **No cerrar** para evitarlo.",
            "Si has votado y al final no te va ninguna fecha, toca **Ninguna va** en los detalles.",
          ],
        },
        {
          type: "steps",
          title: "Desde la notificación",
          items: [
            "Toca la push para votar los horarios del ensayo, o la notificación de la campana, y toca **Vota ya**.",
            "En **Disponibilidad para el ensayo**, en **Elige las fechas que te van**, toca las fechas a las que puedes ir.",
            "Toca **Listo**. Si no te va ninguna fecha, toca **Ninguna va**.",
          ],
        },
        { type: "p", text: "**Ninguna va** borra tus votos y avisa al admin de que no te va ninguna fecha: los admins ven «Ninguna fecha le va bien a …». Si luego votas una fecha, esa respuesta se sustituye." },
        {
          type: "list",
          title: "Qué ves mientras votas",
          items: [
            "El lugar y tu parte de la sala («Blackbox Studios · 12 € cada uno») y las canciones a trabajar.",
            "«{answered} de {total} han respondido», y la fecha límite de votación si la hay.",
            "En **Respuestas**, quién ha votado qué fecha, en cuanto alguien vota.",
          ],
        },
        { type: "note", tone: "tip", text: "Los votos se actualizan en directo para todos. Sin conexión el voto no se guarda y ves «No se pudo registrar el voto. Inténtalo de nuevo.»" },
        { type: "shot", id: "shot-poll-card", caption: "Una encuesta activa en Inicio con sus botones de fecha y sus detalles." },
        {
          type: "devices",
          rows: [
            { devices: ["duoLaptop"], text: "En postura portátil, la hoja de votación pone los miembros y los días en la pantalla de arriba, y tus botones de día con **Fijar {day}** / **Fija una fecha** y **Listo** en la de abajo." },
          ],
        },
      ],
    },
    {
      id: "lock-in-a-poll-date",
      title: "Fija una fecha y crea el ensayo",
      summary: "Elige la fecha ganadora de una encuesta; BandWith crea el ensayo y avisa a la banda.",
      roles: ["admin"],
      kind: "task",
      keywords: ["cerrar encuesta", "confirmar fecha", "fijar fecha", "ganadora", "elegir fecha"],
      related: ["vote-in-a-rehearsal-poll", "the-rehearsal-page", "answer-a-rehearsal-invite"],
      body: [
        {
          type: "steps",
          items: [
            "En la tarjeta de la encuesta, toca **Detalles · Fijar**. En la hoja de la notificación, mira en **Respuestas · Fija una fecha**.",
            "Junto a la fecha que quieras (a menudo la **Favorita**), toca **Fijar**.",
            "Revisa el **Lugar del ensayo**. Empieza con el lugar puesto en la encuesta, o «Local de ensayo».",
            "Toca **Confirmar y crear evento**.",
          ],
        },
        {
          type: "list",
          title: "Qué pasa",
          items: [
            "Se crea un ensayo confirmado en esa fecha y hora, con el título, el lugar y la nota de la encuesta.",
            "El coste de la sala pasa a ser el coste de sala del ensayo, y las canciones a trabajar pasan a ser su setlist.",
            "Los miembros invitados entran en el ensayo y responden como siempre ([[answer-a-rehearsal-invite]]). Tú quedas marcado como que vas.",
            "La encuesta se cierra y sale de Pendientes. Los miembros reciben en la campana una notificación de ensayo confirmado (sin push).",
          ],
        },
        { type: "note", tone: "tip", text: "Si otro admin fijó la encuesta un momento antes que tú, ves «Esta encuesta ya se confirmó o se cerró.» y no se crea un segundo ensayo." },
      ],
    },
    {
      id: "delete-a-rehearsal-poll",
      title: "Borra una encuesta",
      summary: "Quita una encuesta con todas sus fechas y sus votos.",
      roles: ["admin"],
      kind: "task",
      keywords: ["borrar encuesta", "cancelar encuesta", "eliminar encuesta"],
      related: ["create-a-rehearsal-poll", "handle-a-rehearsal-proposal"],
      body: [
        {
          type: "steps",
          items: [
            "Abre **Detalles · Fijar** de la encuesta, o ábrela desde su notificación.",
            "Toca **Borrar encuesta**.",
            "En **¿Borrar la encuesta de ensayo?**, toca **Borrar encuesta** otra vez, o **Cancelar**.",
          ],
        },
        { type: "note", tone: "warning", text: "Todas las fechas propuestas y los votos de los miembros se borran para siempre. No se puede deshacer, y no se avisa a los miembros." },
        { type: "p", text: "Para cerrar la propuesta de un miembro que aún no tiene encuesta, usa **Rechazar** (consulta [[handle-a-rehearsal-proposal]])." },
      ],
    },
    {
      id: "rehearsal-polls-explained",
      title: "Cómo funcionan las propuestas y las encuestas",
      summary: "La vida de una petición de ensayo, desde la idea de un miembro hasta una fecha en el calendario.",
      roles: ["admin", "member"],
      kind: "reference",
      keywords: ["estado de la encuesta", "estado de la propuesta", "organización de ensayos", "pendientes"],
      related: ["propose-a-rehearsal", "create-a-rehearsal-poll", "vote-in-a-rehearsal-poll", "lock-in-a-poll-date"],
      body: [
        {
          type: "table",
          head: ["Fase", "Qué significa", "Quién la ve"],
          rows: [
            ["Propuesta (**Espera admin**)", "Un miembro ha pedido un ensayo.", "El miembro que la propuso y los admins."],
            ["Encuesta (**Encuesta · Activa**)", "Un admin ha publicado fechas para votar.", "Los miembros invitados y los admins."],
            ["Confirmado (**Ensayo · Confirmado**)", "Se ha fijado una fecha; el ensayo está en el calendario.", "Todos los del ensayo."],
            ["Rechazada, caducada o borrada", "Cerrada sin ensayo (una propuesta caduca después del día de **Abierta hasta el**).", "Nadie: sale de las listas."],
          ],
        },
        { type: "p", text: "Las propuestas y encuestas abiertas aparecen en Inicio, en **Pendientes**, y arriba del **Calendario**, en **Organización de ensayos ({count})**. En el **Calendario** siguen el filtro por banda." },
        {
          type: "roles",
          rows: [
            { role: "admin", text: "Publica encuestas, convierte propuestas en encuestas, fija fechas, rechaza y borra. Puede hacerlo cualquier admin de la banda, no solo el que publicó." },
            { role: "member", text: "Propone (una por semana), vota, responde **Ninguna va** y ve quién ha votado qué." },
            { role: "deputy", text: "No participa en las encuestas de la banda." },
          ],
        },
        {
          type: "devices",
          rows: [
            { devices: ["duoLaptop"], text: "En postura portátil, el escritorio de la banda en Inicio muestra las encuestas que no has votado y las propuestas que esperan una encuesta; toca una para abrirla." },
          ],
        },
      ],
    },
    {
      id: "the-chat-inbox",
      title: "La bandeja de chats",
      summary: "Todos tus chats de banda, de eventos y directos en una sola lista.",
      roles: ["admin", "member"],
      kind: "reference",
      keywords: ["mensajes", "bandeja", "lista de chats", "no leídos", "buscar mensajes"],
      related: ["start-a-chat", "send-and-reply-to-messages", "delete-a-chat", "who-can-message-whom"],
      body: [
        { type: "p", text: "Toca **Chat** en la barra inferior. El globo de la pestaña cuenta los mensajes sin leer." },
        {
          type: "list",
          items: [
            "Filtra con **TODO**, **DIRECTOS**, **BANDAS** o **EVENTOS**. Cada filtro muestra su propio número de mensajes sin leer.",
            "Los chats con mensajes sin leer van primero. Una fila muestra el nombre (« · Banda» para el chat de la banda), la hora, el último mensaje y el número de no leídos o los ticks de tu último mensaje.",
            "Si estás en dos o más bandas, la fila también muestra a qué banda pertenece.",
            "Un punto verde en un chat directo indica que esa persona está en línea.",
            "Escribe al menos dos letras en **Buscar chats…** para encontrar chats, personas y palabras de los mensajes: los resultados se agrupan en **CHATS**, **PERSONAS** y **MENSAJES**. Toca **Borrar búsqueda** para volver.",
            "Desliza un chat hacia la izquierda para eliminarlo ([[delete-a-chat]]).",
            "Empieza un chat nuevo con el + (**Nuevo chat**) de arriba ([[start-a-chat]]).",
          ],
        },
        { type: "shot", id: "shot-chat-inbox", caption: "La bandeja de chats con los filtros por tipo." },
        {
          type: "devices",
          rows: [
            { devices: ["tablet", "duoBook", "duoLand"], text: "La lista y la conversación abierta están una al lado de la otra; el chat abierto aparece resaltado en la lista." },
            { devices: ["duoClosed", "duoBook", "duoLand"], text: "En el iPhone Duo, el campo de búsqueda está en la barra lateral." },
          ],
        },
        { type: "note", tone: "tip", text: "En modo solista (sin banda) no hay chat: la pestaña **Chat** abre el calendario." },
      ],
    },
    {
      id: "start-a-chat",
      title: "Empieza un chat",
      summary: "Abre el chat de la banda, el chat de un evento o un mensaje directo.",
      roles: ["admin", "member"],
      kind: "task",
      keywords: ["nuevo chat", "escribir a alguien", "md", "mensaje directo", "chat de la banda"],
      related: ["who-can-message-whom", "event-and-rehearsal-chats", "the-chat-inbox"],
      body: [
        {
          type: "steps",
          items: [
            "En **Chat**, toca el + (**Nuevo chat**) de arriba.",
            "Elige el **Tipo de chat**: **DIRECTOS**, **BANDA** o **EVENTO**.",
            "Busca y elige una persona (**Buscar admins…** o **Buscar miembros…**), una banda (**Buscar bandas…**) o un evento (**Buscar eventos…**).",
            "Toca el botón de abajo: **Escribir a …** o **Abrir el chat de …**.",
          ],
        },
        { type: "p", text: "Si el chat ya existe, BandWith lo abre en vez de crear otro. Una banda tiene un solo chat de banda con todos los miembros activos; un evento tiene un solo chat con su formación." },
        { type: "p", text: "También puedes escribir a alguien desde la lista de miembros de la banda: abre el miembro y toca el botón de mensaje. Solo aparece cuando uno de los dos es admin." },
        {
          type: "roles",
          rows: [
            { role: "admin", text: "**DIRECTOS** muestra a todos los miembros de tus bandas. **EVENTO** muestra todos los eventos de las bandas que gestionas." },
            { role: "member", text: "**DIRECTOS** solo muestra a los **Admins** de la banda («Los mensajes directos se limitan a los admins de la banda.»). **EVENTO** solo muestra los eventos en los que estás y que no has rechazado." },
          ],
        },
      ],
    },
    {
      id: "send-and-reply-to-messages",
      title: "Envía, responde y menciona",
      summary: "Escribe mensajes, responde a un mensaje concreto, menciona a alguien y lee mensajes antiguos.",
      roles: ["admin", "member"],
      kind: "task",
      keywords: ["enviar mensaje", "responder", "citar", "mencionar", "@", "mensajes antiguos", "sin conexión"],
      related: ["message-receipts-and-online-status", "the-chat-inbox"],
      body: [
        {
          type: "steps",
          title: "Envía",
          items: [
            "Abre un chat y toca **Escribe un mensaje…** abajo.",
            "Escribe el mensaje y toca **Enviar mensaje** (o pulsa Intro en un teclado).",
          ],
        },
        {
          type: "steps",
          title: "Responde a un mensaje",
          items: [
            "En un móvil o una tablet, desliza el mensaje hacia la derecha. Con un ratón, pasa el puntero por encima y haz clic en **Responder al mensaje**.",
            "El cuadro de texto muestra **Respondiendo a …**. Escribe y envía. Toca **Cancelar respuesta** para dejarlo.",
          ],
        },
        {
          type: "steps",
          title: "Menciona a alguien",
          items: [
            "Escribe @ y el principio de un nombre.",
            "Toca la persona en las sugerencias (Intro elige la primera). Las menciones se muestran en negrita.",
          ],
        },
        {
          type: "list",
          title: "Conviene saber",
          items: [
            "En los chats de banda y de evento, cada mensaje muestra el nombre de quien lo envía, con « · Admin» para los admins.",
            "El chat carga los últimos 50 mensajes. Desplázate hacia arriba y toca **Cargar mensajes anteriores** para ver más.",
            "Los mensajes son texto sin formato: no hay adjuntos, reacciones, ni se pueden editar o borrar mensajes sueltos.",
            "Sin conexión, el mensaje se queda en el chat marcado como **Esperando conexión** y se envía solo cuando vuelves a estar en línea, también si cierras el chat. Un mensaje que no se pudo enviar dice **No enviado**: toca **Reintentar** o **Eliminar**.",
            "Una mención se resalta para todos, pero no envía una notificación extra: todos los del chat reciben un aviso de cada mensaje de todos modos.",
          ],
        },
        {
          type: "devices",
          rows: [{ devices: ["duoLaptop"], text: "En postura portátil, los mensajes llenan la pantalla de arriba y el cuadro de texto se abre en la de abajo." }],
        },
      ],
    },
    {
      id: "event-and-rehearsal-chats",
      title: "Chats de eventos y de ensayos",
      summary: "Un chat para las personas de un concierto o un ensayo, con sus horarios fijos arriba.",
      roles: ["admin", "member"],
      kind: "reference",
      keywords: ["chat del evento", "chat del concierto", "chat del ensayo", "chat de la formación", "franja del evento"],
      related: ["start-a-chat", "gig-workspace", "the-rehearsal-page"],
      body: [
        {
          type: "steps",
          title: "Ábrelo",
          items: [
            "Abre el concierto o el ensayo.",
            "Toca **CHAT DEL EVENTO** (en un concierto) o **CHAT DEL ENSAYO** (en un ensayo).",
          ],
        },
        { type: "p", text: "El chat incluye la formación del evento (todos los que no han rechazado) y los admins de la banda. Las personas que se añaden a la formación más tarde entran en el chat cuando se envía el siguiente mensaje." },
        { type: "p", text: "Una franja arriba muestra el evento: el título, **Hoy** / **Mañana** o la fecha, **Montaje …** (o **Inicio …**) y el lugar, además de **Cancelado** o **Evento pasado** cuando corresponde. Tócala para abrir el evento." },
        { type: "note", tone: "privacy", text: "La franja y el panel lateral solo muestran logística: horarios, lugar y estado. Nunca el caché ni el cliente." },
        {
          type: "roles",
          rows: [
            { role: "admin", text: "Puede abrir el chat de cualquier evento de la banda." },
            { role: "member", text: "Ve el botón del chat solo después de responder que va. Los miembros que rechazan pierden el acceso: «Solo puedes escribir en eventos en los que participas.»" },
          ],
        },
        {
          type: "devices",
          rows: [
            { devices: ["tablet", "duoBook", "duoLand"], text: "Con dos paneles (un iPad en horizontal, o el iPhone Duo abierto), un panel de contexto junto a la conversación muestra los horarios (**Montaje**, **Prueba de sonido**, **Show**, **Fin**), el lugar, el estado, **En este chat · Formación …/…** y quién está en línea, con **Abrir el concierto**." },
          ],
        },
        { type: "shot", id: "shot-event-chat", caption: "Un chat de evento en el iPad con la franja del evento y el panel de contexto." },
        { type: "note", tone: "tip", text: "Los conciertos personales no tienen chat: «Los chats de evento están disponibles para eventos de la banda.»" },
      ],
    },
    {
      id: "who-can-message-whom",
      title: "Quién puede escribir a quién",
      summary: "Las reglas del chat para admins, miembros y sustitutos.",
      roles: ["admin", "member", "deputy"],
      kind: "reference",
      keywords: ["reglas del chat", "permisos", "mensajes restringidos", "no puedo escribir"],
      related: ["start-a-chat", "event-and-rehearsal-chats"],
      body: [
        {
          type: "table",
          head: ["Chat", "Admin", "Miembro"],
          rows: [
            ["Chat de la banda", "Sí, en las bandas en las que estás activo", "Sí, en las bandas en las que estás activo"],
            ["Chat del evento", "Cualquier evento de tu banda", "Solo eventos en los que estás y que no has rechazado"],
            ["Mensaje directo", "Cualquiera de tus bandas", "Solo los admins de una banda que compartís"],
          ],
        },
        { type: "p", text: "Dos miembros no pueden escribirse directamente; hablan en el chat de la banda o del evento. Las reglas se comprueban al empezar un chat y cada vez que envías." },
        { type: "p", text: "Cuando una regla te lo impide, el cuadro de texto se sustituye por un candado con el motivo, por ejemplo «Los mensajes directos solo están disponibles con los admins de la banda.» o «Ya no tienes acceso a este chat.» (después de dejar la banda o de que te quiten del concierto)." },
        {
          type: "roles",
          rows: [
            { role: "deputy", text: "Los sustitutos no son miembros de la banda, así que no están en ningún chat de banda, de evento ni directo. La banda los contacta mediante peticiones de sustitución («Pedir en la app»), y ellos responden en Bolos como sustituto. Consulta [[deputy-in-the-app]]." },
          ],
        },
        { type: "note", tone: "privacy", text: "Un chat directo queda entre sus dos personas. BandWith nunca lo reutiliza para una conversación con otra persona, así que nadie más puede leer ese historial." },
      ],
    },
    {
      id: "message-receipts-and-online-status",
      title: "Ticks, confirmaciones de lectura y estado en línea",
      summary: "Qué significan el reloj, un tick y dos ticks.",
      roles: ["admin", "member"],
      kind: "reference",
      keywords: ["ticks", "confirmación de lectura", "entregado", "visto", "en línea"],
      related: ["send-and-reply-to-messages", "the-chat-inbox"],
      body: [
        {
          type: "table",
          head: ["Marca", "Significado"],
          rows: [
            ["Reloj (**Enviando**)", "Tu mensaje está en camino."],
            ["Un tick (**Enviado**)", "Guardado en el servidor."],
            ["Dos ticks grises (**Entregado**)", "Ha llegado a los teléfonos de los demás."],
            ["Dos ticks de color (**Leído**)", "Han abierto el chat después de tu mensaje."],
          ],
        },
        { type: "p", text: "En los chats de banda y de evento, los ticks solo cambian cuando todos han recibido o leído el mensaje. No cuentan las personas que entraron después de enviarlo." },
        { type: "p", text: "La cabecera de un chat directo muestra **En línea** o **Desconectado**. Los chats de grupo muestran «{count} miembros · {count} en línea»." },
      ],
    },
    {
      id: "delete-a-chat",
      title: "Elimina un chat",
      summary: "Quita un chat de tu lista y borra mensajes para siempre.",
      roles: ["admin", "member"],
      kind: "task",
      keywords: ["eliminar conversación", "vaciar chat", "quitar chat", "borrar mensajes"],
      related: ["the-chat-inbox"],
      body: [
        {
          type: "steps",
          items: [
            "En la lista de chats, desliza el chat hacia la izquierda y toca el botón de eliminar. O abre el chat y toca **Eliminar chat** (la papelera) arriba a la derecha.",
            "Confirma con **Eliminar**, o toca **Cancelar**.",
          ],
        },
        {
          type: "table",
          head: ["Chat", "Qué se borra"],
          rows: [
            ["Chat directo", "Todos los mensajes, para los dos."],
            ["Chat de banda o de evento", "Solo tus propios mensajes, para todos. Los demás conservan el resto de la conversación."],
          ],
        },
        { type: "note", tone: "warning", text: "No se puede deshacer. El chat sale de tu lista hasta que llega un mensaje nuevo; entonces vuelve solo con los mensajes nuevos." },
      ],
    },
    {
      id: "rehearsal-and-chat-notifications",
      title: "Notificaciones de ensayos, encuestas y chat",
      summary: "Qué acciones avisan a quién y cuáles envían también una push.",
      roles: ["admin", "member"],
      kind: "reference",
      keywords: ["push", "notificación", "avisos", "campana", "globo"],
      related: ["answer-a-rehearsal-invite", "vote-in-a-rehearsal-poll", "send-and-reply-to-messages"],
      body: [
        {
          type: "table",
          head: ["Cuándo", "A quién se avisa", "Push"],
          rows: [
            ["Un miembro propone un ensayo", "Los admins de la banda", "Sí"],
            ["Un admin publica una encuesta", "Los miembros a los que se pide votar", "Sí"],
            ["Se fija una fecha", "Las personas que entran en el ensayo", "No, solo la campana"],
            ["Se crea un ensayo o te añaden a uno", "Los miembros invitados", "Sí"],
            ["Cambia la fecha, la hora o el lugar", "Las personas del ensayo", "Sí"],
            ["Se elimina un ensayo", "Las personas del ensayo", "Sí"],
            ["Un miembro se retira o responde", "El admin que lo creó", "Sí al retirarse"],
            ["Un mensaje de chat nuevo", "Todos los demás del chat", "Sí"],
          ],
        },
        {
          type: "list",
          items: [
            "Al tocar la notificación de una encuesta se abre la hoja de votación; la de un ensayo abre el ensayo; la de un chat abre el chat.",
            "Cuando abres la app con una encuesta o una propuesta sin leer, BandWith te la muestra una vez en una pequeña ventana.",
            "No llega ninguna push de un chat que tienes abierto en pantalla. Abrir un chat marca sus notificaciones como leídas.",
            "Si la notificación es de otra de tus bandas, la app te pregunta antes si quieres cambiar de banda.",
            "Desactiva todas las push en **Ajustes** con **Notificaciones push** («Invitaciones a conciertos, encuestas, mensajes de chat»). La campana conserva todas las notificaciones.",
          ],
        },
      ],
    },
  ],

  faq: [
    {
      q: "¿Un miembro puede crear un ensayo?",
      a: "No. Los miembros tocan **Proponer ensayo** y los admins deciden. Los admins lo programan directamente o hacen una encuesta.",
      roles: ["member"],
    },
    {
      q: "¿Por qué solo puedo enviar una propuesta de ensayo por semana?",
      a: "Para que la organización de la banda no se disperse, cada miembro puede proponer una vez cada 7 días por banda. La pantalla muestra la próxima fecha en la que puedes proponer.",
      roles: ["member"],
    },
    {
      q: "¿Por qué una encuesta dice Sin invitación?",
      a: "El admin te dejó fuera en **Quién vota**. Puedes leer la encuesta, pero solo votan los miembros invitados.",
      roles: ["member"],
    },
    {
      q: "¿La encuesta se cierra a la hora límite?",
      a: "Sí, para votar: después de la hora límite la encuesta muestra **Votación cerrada** y nadie puede votar. Luego un admin fija una fecha o borra la encuesta.",
    },
    {
      q: "¿Los miembros ven cuánto cuesta la sala de ensayo?",
      a: "Durante una encuesta solo ven su parte («12 € cada uno»). El coste total de la sala en la página del ensayo solo lo ven los admins.",
    },
    {
      q: "¿Puedo escribir directamente a otro miembro?",
      a: "Solo si uno de los dos es admin de una banda que compartís. Si no, usa el chat de la banda o el del evento.",
      roles: ["member"],
    },
    {
      q: "¿Por qué no puedo abrir el chat del ensayo?",
      a: "Los miembros ven **CHAT DEL ENSAYO** después de responder **VOY**. Si has rechazado, ya no tienes acceso.",
      roles: ["member"],
    },
    {
      q: "¿Puedo editar o borrar un mensaje, o enviar una foto?",
      a: "No. Los mensajes del chat son solo texto. Puedes responder a un mensaje o eliminar el chat entero.",
    },
    {
      q: "Si elimino el chat de una banda, ¿la banda pierde la conversación?",
      a: "No. Solo se borran tus propios mensajes. En un chat directo se borran todos los mensajes para las dos personas.",
    },
    {
      q: "¿Qué pasa con los mensajes que envío sin conexión?",
      a: "No se envían. El texto vuelve al cuadro de texto para que puedas enviarlo otra vez cuando tengas conexión.",
    },
    {
      q: "¿Los sustitutos pueden usar el chat?",
      a: "No. Los sustitutos no son miembros de la banda. La banda los contacta mediante peticiones de sustitución en la app.",
      roles: ["deputy"],
    },
  ],

  glossary: [
    { term: "Propuesta de ensayo", definition: "La petición de ensayo de un miembro, con un tema y días preferidos. Espera a un admin hasta su último día preferido.", see: "propose-a-rehearsal" },
    { term: "Encuesta de disponibilidad", definition: "Una lista de fechas propuestas que la banda vota antes de que un admin elija una.", see: "create-a-rehearsal-poll" },
    { term: "Horario propuesto", definition: "Una fecha con hora de inicio y de fin que se ofrece en una encuesta.", see: "create-a-rehearsal-poll" },
    { term: "Modo de programación", definition: "El selector entre **Programar ya** y **Encuesta** cuando un admin empieza un ensayo nuevo.", see: "create-a-rehearsal" },
    { term: "Quién vota", definition: "Los miembros a los que se pide votar en una encuesta. Si dejas a alguien fuera, se crea una lista de invitados.", see: "poll-who-votes-and-deadline" },
    { term: "Votar antes del", definition: "El día y la hora en que una encuesta deja de aceptar votos. Después muestra Votación cerrada.", see: "poll-who-votes-and-deadline" },
    { term: "Favorita", definition: "La fecha de la encuesta con más votos hasta el momento.", see: "vote-in-a-rehearsal-poll" },
    { term: "Ninguna va", definition: "Una respuesta de encuesta que indica que no te va ninguna fecha. Borra tus votos y avisa al admin.", see: "vote-in-a-rehearsal-poll" },
    { term: "Fijar", definition: "Elegir la fecha ganadora de una encuesta, lo que crea el ensayo.", see: "lock-in-a-poll-date" },
    { term: "Número de libres", definition: "Cuántos miembros no tienen nada más en su calendario a una hora, por ejemplo «4 de 5 libres». Solo se muestra el número.", see: "create-a-rehearsal-poll" },
    { term: "Canciones a trabajar", definition: "Las canciones que se trabajan en un ensayo. Pasan a ser la setlist del ensayo.", see: "rehearsal-songs-and-prep-tasks" },
    { term: "Tipo de sesión", definition: "Banda completa, Voces, Rítmica, Acústico u Otro: da nombre al ensayo y preselecciona la plantilla.", see: "create-a-rehearsal" },
    { term: "Chat de la banda", definition: "El único chat en el que están todos los miembros activos de una banda.", see: "start-a-chat" },
    { term: "Chat del evento", definition: "El chat de un concierto o un ensayo, para su formación y los admins.", see: "event-and-rehearsal-chats" },
    { term: "Franja del evento", definition: "La barra de arriba de un chat de evento con la fecha, la hora de montaje o de inicio y el lugar.", see: "event-and-rehearsal-chats" },
    { term: "Ticks de confirmación", definition: "Las marcas junto a tus mensajes: enviando, enviado, entregado, leído.", see: "message-receipts-and-online-status" },
  ],
};

export default together;
