# Chat

[← Screen map](README.md) · profile phone-portrait

## admin (7 screens)

_Leo M., admin of the demo band Velvet Static_ · source: [chat.admin.mmd](chat.admin.mmd)

```mermaid
flowchart LR
  s0["Chat, 2 unread ⌂<br/><small>Chat, 2 unread</small>"]
  s1["BandWith Academy<br/><small>BandWith Academy</small>"]
  s2["New chat<br/><small>New chat</small>"]
  s3["Chat, 2 unread<br/><small>Chat, 2 unread</small>"]
  s4["Velvet Static<br/><small>Velvet Static</small>"]
  s5["Marta C.<br/><small>Marta C.</small>"]
  s6["Create<br/><small>Create</small>"]
  x0(["→ Event detail gig / rehearsal / quote / personal"])
  x1(["→ Home"])
  x2(["→ Calendar"])
  s0 -->|"Help for this screen"| s1
  s0 -->|"New chat"| s2
  s0 -->|"DIRECT"| s3
  s0 -->|"Velvet Static, 2 unre…"| s4
  s0 -->|"Rooftop Session"| x0
  s0 -->|"Marta C."| s5
  s0 -->|"Home"| x1
  s0 -->|"Calendar"| x2
  s0 -->|"Create"| s6
  classDef root stroke-width:3px
  classDef flagged stroke:#d33,stroke-width:2px
  classDef stub fill:none,stroke-dasharray: 3 3
  class s0 root
  class s0,s3 flagged
  class x0,x1,x2 stub
```

## member (6 screens)

_Leo M. as a member of Velvet Static (not admin)_ · source: [chat.member.mmd](chat.member.mmd)

```mermaid
flowchart LR
  s0["Chat, 2 unread ⌂<br/><small>Chat, 2 unread</small>"]
  s1["BandWith Academy<br/><small>BandWith Academy</small>"]
  s2["New chat<br/><small>New chat</small>"]
  s3["Chat, 2 unread<br/><small>Chat, 2 unread</small>"]
  s4["Velvet Static<br/><small>Velvet Static</small>"]
  s5["Create<br/><small>Create</small>"]
  x0(["→ Event detail gig / rehearsal / quote / personal"])
  x1(["→ Home"])
  x2(["→ Calendar"])
  s0 -->|"Help for this screen"| s1
  s0 -->|"New chat"| s2
  s0 -->|"DIRECT"| s3
  s0 -->|"Velvet Static, 2 unre…"| s4
  s0 -->|"Rooftop Session"| x0
  s0 -->|"Home"| x1
  s0 -->|"Calendar"| x2
  s0 -->|"Create"| s5
  classDef root stroke-width:3px
  classDef flagged stroke:#d33,stroke-width:2px
  classDef stub fill:none,stroke-dasharray: 3 3
  class s0 root
  class s0 flagged
  class x0,x1,x2 stub
```
