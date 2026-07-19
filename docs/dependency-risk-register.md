# Dependency risk register

Last reviewed: 2026-07-19

## Open advisories

| Advisory | Reachability | Shipped surface and controls | Upstream status | Review expiry |
| --- | --- | --- | --- | --- |
| `GHSA-w5hq-g745-h8pq` (`uuid <11.1.1`) through Expo → config plugins → `xcode@3.0.1` | Build-time only. Neo Anki does not call UUID v3/v5/v6 with a caller-provided buffer; the affected package is used by Expo's Apple project-generation tooling. | Not imported by the desktop/web runtime or the installed native application logic. Mobile bundles, Expo Doctor, TypeScript, and the dependency audit remain release gates. No unsafe forced downgrade to Expo 46 is accepted. | Expo 57 currently pins the affected `xcode` dependency. npm's suggested fix is a false/regressive Expo downgrade. Upgrade on the first supported Expo release that removes the chain. | 2026-08-31 |

Current audit result: 11 moderate entries are one transitive advisory expanded through the Expo dependency graph; there are no high or critical advisories. Any new advisory, runtime reachability, severity increase, or missed expiry blocks release until this register is updated.
