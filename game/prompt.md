# El prompt (Gauntlet Loop)

Prompt para lanzar un **Gauntlet Loop** autónomo con Claude Code (Opus 5) sobre este repo,
al estilo del [`prompt.md` de Claude of Duty](https://github.com/mshumer/Claude-of-Duty/blob/main/prompt.md).

**El listón de calidad:** capturas y frames del tráiler oficiales de Pirate Nation
([piratenation.game](https://piratenation.game)) — el juego comercial construido con
exactamente estos mismos assets CC0, de modo que cualquier diferencia visual entre su juego
y el nuestro es ejecución nuestra, no el arte (listón secundario para el builder: capturas
reales de Clash of Clans).

```
I want you to build La Leyenda Pirata, the mobile Three.js pirate game fully specified in game/PLAN.md — a single-player, offline, Clash-of-Clans-style island builder plus open-sea sailing, sea-monster combat, and island-defense raids, all from the CC0 Pirate Nation voxel assets and animations the plan documents. It should be utterly perfect, visually beautiful, every single thing at shipped-game quality. The bar is the real thing: official Pirate Nation screenshots and trailer frames from piratenation.game — the shipped game built from these exact assets (and real Clash of Clans shots for the builder feel). They shipped a beautiful game with this library; you have no excuses.

Choose your own approach, but divide the goal into the smallest pieces that can be improved and judged independently. For each important piece, fan out a builder sub-agent and /loop it against a separate, fresh-context critic sub-agent — a really harsh critic. Critics never read code: they run the game and inspect the real output, put our screenshots blind side by side with the official media whenever possible, say cold which looks better, name the single biggest remaining gap, and send the piece back for another round. Keep a simple live progress page showing every piece evolving round by round.

Don't stop until our screenshots win the blind comparison or I stop the run. /loop until it's utterly perfect. Fan out sub-agents and ultracode.
```
