# Create

[← Screen map](README.md) · profile phone-portrait

## admin (3 screens)

_Leo M., admin of the demo band Velvet Static_ · source: [create.admin.mmd](create.admin.mmd)

```mermaid
flowchart LR
  s0["Create ⌂<br/><small>Create</small>"]
  s1["New gig ⌂<br/><small>New gig</small>"]
  s2["New rehearsal<br/><small>New rehearsal</small>"]
  x0(["→ Calendar"])
  x1(["→ Home"])
  s0 -->|"Calendar"| x0
  s0 -->|"Close create menu / Close"| x1
  s0 -->|"New gig Lineup, fees,…"| s1
  s0 -->|"New rehearsal Schedul…"| s2
  s1 -->|"Cancel new gig / Close gig wizard"| x1
  classDef root stroke-width:3px
  classDef flagged stroke:#d33,stroke-width:2px
  classDef stub fill:none,stroke-dasharray: 3 3
  class s0,s1 root
  class s1 flagged
  class x0,x1 stub
```

## member (2 screens)

_Leo M. as a member of Velvet Static (not admin)_ · source: [create.member.mmd](create.member.mmd)

```mermaid
flowchart LR
  s0["Create ⌂<br/><small>Create</small>"]
  s1["Log personal gig<br/><small>Log personal gig</small>"]
  x0(["→ Calendar"])
  x1(["→ Home"])
  x2(["→ Polls & proposals"])
  s0 -->|"Calendar"| x0
  s0 -->|"Close create menu / Close"| x1
  s0 -->|"Add personal gig Log …"| s1
  s0 -->|"Propose rehearsal Sug…"| x2
  classDef root stroke-width:3px
  classDef flagged stroke:#d33,stroke-width:2px
  classDef stub fill:none,stroke-dasharray: 3 3
  class s0 root
  class s1 flagged
  class x0,x1,x2 stub
```
