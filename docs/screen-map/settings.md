# Settings & Account hub

[← Screen map](README.md) · profile phone-portrait

## admin (10 screens)

_Leo M., admin of the demo band Velvet Static_ · source: [settings.admin.mmd](settings.admin.mmd)

```mermaid
flowchart LR
  s0["Who you are ⌂<br/><small>Who you are</small>"]
  s1["Edit profile<br/><small>Who you are › Edit profile</small>"]
  s2["Deputy gigs<br/><small>Who you are › Deputy gigs</small>"]
  s3["Band members<br/><small>Who you are › Band members</small>"]
  s4["Pricing & services<br/><small>Who you are › Pricing & services</small>"]
  s5["Create<br/><small>Who you are › Create</small>"]
  s6["Repertoire<br/><small>Who you are › Repertoire</small>"]
  s7["Gear & inventory<br/><small>Who you are › Gear & inventory</small>"]
  s8["Help & support<br/><small>Help & support</small>"]
  s9["Create<br/><small>Who you are › Create</small>"]
  x0(["→ Home"])
  x1(["→ Calendar"])
  s0 -->|"Close Account Hub / Home"| x0
  s0 -->|"Edit"| s1
  s0 -->|"Deputy gigs Requests …"| s2
  s0 -->|"Members 5"| s3
  s0 -->|"Band settings / Pricing, fees & servi…"| s4
  s0 -->|"New band"| s5
  s0 -->|"Repertoire: 17 songs,…"| s6
  s0 -->|"Gear & inventory: 16 …"| s7
  s0 -->|"Help & support Answer…"| s8
  s0 -->|"Calendar"| x1
  s0 -->|"Create"| s9
  classDef root stroke-width:3px
  classDef flagged stroke:#d33,stroke-width:2px
  classDef stub fill:none,stroke-dasharray: 3 3
  class s0 root
  class s0,s3,s6,s7 flagged
  class x0,x1 stub
```

## member (10 screens)

_Leo M. as a member of Velvet Static (not admin)_ · source: [settings.member.mmd](settings.member.mmd)

```mermaid
flowchart LR
  s0["Who you are ⌂<br/><small>Who you are</small>"]
  s1["Edit profile<br/><small>Who you are › Edit profile</small>"]
  s2["Deputy gigs<br/><small>Who you are › Deputy gigs</small>"]
  s3["Band members<br/><small>Who you are › Band members</small>"]
  s4["Create<br/><small>Who you are › Create</small>"]
  s5["Repertoire<br/><small>Who you are › Repertoire</small>"]
  s6["Gear & inventory<br/><small>Who you are › Gear & inventory</small>"]
  s7["To-do lists<br/><small>Who you are › To-do lists</small>"]
  s8["Help & support<br/><small>Help & support</small>"]
  s9["Create<br/><small>Who you are › Create</small>"]
  x0(["→ Home"])
  x1(["→ Calendar"])
  s0 -->|"Close Account Hub / Home"| x0
  s0 -->|"Edit"| s1
  s0 -->|"Deputy gigs Requests …"| s2
  s0 -->|"Members 5"| s3
  s0 -->|"New band"| s4
  s0 -->|"Repertoire: 17 songs,…"| s5
  s0 -->|"Gear & inventory: 16 …"| s6
  s0 -->|"To-do lists: 4 lists,…"| s7
  s0 -->|"Help & support Answer…"| s8
  s0 -->|"Calendar"| x1
  s0 -->|"Create"| s9
  classDef root stroke-width:3px
  classDef flagged stroke:#d33,stroke-width:2px
  classDef stub fill:none,stroke-dasharray: 3 3
  class s0 root
  class s0,s3,s5 flagged
  class x0,x1 stub
```
