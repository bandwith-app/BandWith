# Screen map

Generated from the running demo app by the crawler in [`e2e/crawl`](../../e2e/crawl/README.md) (`pnpm e2e:crawl`, nightly in CI).
Do not edit by hand: re-run the crawl with `CRAWL_DOCS=1`.

Diagrams: **phone-portrait**. Nodes are screens (⌂ = where the crawl starts; red = has findings), solid arrows are taps (labelled with the control),
dotted arrows are system Back / Escape, rounded nodes lead to another area. The full map for every profile (states, texts, screenshots,
findings) is `map.json` in the crawl artifact.

Run: admin 76 states, client 5 states, deputy 2 states, member 65 states, noband 2 states, signedout 6 states. Open findings: 20 confirmed by triage, 0 not triaged (`findings.md` in the crawl artifact).

| Area | Roles |
| --- | --- |
| [Home](home.md) | admin (7), member (18) |
| [Calendar](calendar.md) | admin (5), member (5) |
| [Event detail (gig / rehearsal / quote / personal)](event.md) | admin (39), member (17) |
| [Create](create.md) | admin (3), member (2) |
| [Polls & proposals](polls.md) | member (1) |
| [Settings & Account hub](settings.md) | admin (10), member (10) |
| [Chat](chat.md) | admin (7), member (6) |
| [Notifications](notifications.md) | admin (5), member (6) |
| [Auth & onboarding](auth.md) | noband (2), signedout (6) |
| [Deputy gigs](deputy.md) | deputy (2) |
| [Client quote page](client.md) | client (5) |
