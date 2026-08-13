# Plan del juego — "La Leyenda Pirata" (nombre provisional)

Juego de móvil en **Three.js** con los assets voxel liberados de Pirate Nation
([proofofplay/piratenation-art](https://github.com/proofofplay/piratenation-art), licencia **CC0-1.0**, dominio público).

## Referencias (el listón)

Dos referencias distintas, y no se mezclan:

- **Arte y mundo 3D → Pirate Nation** (`reference/*.png`): el juego comercial hecho con
  estos mismos assets CC0. Marca el agua, el terreno, la iluminación y la escala.
- **Objetos de UI y enganche → Clash of Clans / Clash Royale** (`reference/clash/*.jpg`): el
  estándar de control táctil con volumen físico, y de los bucles que hacen volver cada día.
  El diseño de retención está en [`RETENTION.md`](RETENTION.md).
- **Layout y contención del HUD → Kingshot** (`reference/kingshot/*.jpg`): un builder de móvil
  de 2024, y el contrapeso a Clash. Donde Clash enmarca cada valor en su propia píldora
  ornamentada, Kingshot agrupa todo en una sola cápsula translúcida con separadores finos y deja
  ver el mundo a través del cromo.

Donde Clash y Kingshot discrepan: **Clash manda en el objeto** (un botón, una píldora, un badge)
y **Kingshot manda en el layout** (cuántos objetos, cómo se agrupan, cuánto mundo queda visible).
Detalle completo en [`reference/README.md`](reference/README.md).

## Visión

Un juego pirata donde el jugador:

1. **Construye su propia isla** (estilo Clash of Clans): edificios que producen recursos, se mejoran con timers y desbloquean contenido.
2. **Explora el mar abierto** navegando con su barco: monstruos marinos por el camino, islas con recursos, cofres y jefes.
3. **Defiende su isla** de incursiones enemigas (flota no-muerta controlada por IA).

## Alcance actual: single-player, offline, sin servicios externos

**Decisión firme de esta fase:** nada de Supabase, Firebase, cuentas ni servidor.
El juego funciona 100% en el dispositivo:

- **Persistencia**: guardado local en el navegador (IndexedDB con fallback a localStorage), con
  autosave y **exportar/importar partida** como archivo JSON (backup manual del jugador).
- **Progreso offline**: al abrir el juego se calcula el tiempo transcurrido desde el último
  guardado (`Date.now()` delta) y se otorga la producción acumulada (con tope de almacén).
  En single-player no importa que el reloj del dispositivo sea manipulable.
- **"Otros jugadores"**: no existen de momento. La sensación de ser atacado la dan
  **incursiones PvE** de la facción no-muerta (fase 3). El diseño deja la puerta abierta al
  multijugador asíncrono real (ver última sección), pero **no se construye nada de red ahora**.
- **Distribución**: PWA instalable (funciona offline con service worker). Capacitor para
  tiendas de apps solo si algún día hace falta — no condiciona nada del código.

## Stack técnico

| Pieza | Elección | Motivo |
|---|---|---|
| Lenguaje | TypeScript estricto | Compartir lógica cliente/servidor si algún día hay multijugador |
| Render | Three.js | Requisito del proyecto; sobra para estética voxel |
| Bundler/dev | Vite | Estándar actual, HMR, build PWA sencillo |
| UI del juego | HTML/CSS superpuesto al canvas | Menús, HUD y paneles mucho más rápidos de hacer y accesibles que UI dentro de WebGL |
| Estado/sim | Módulo `sim/` propio, **puro** (sin imports de Three) | La simulación no sabe nada del render: clave para tests y futuro multijugador |
| Persistencia | `idb-keyval` (IndexedDB) + export/import JSON | Sin backend; guardados versionados con migraciones |
| Optimización assets | `@gltf-transform/cli` en scripts de Node | Los glTF de VoxEdit vienen sin optimizar |

Sin frameworks de motor (ECS pesados, physics engines): la física que necesitamos
(movimiento de barco, colisiones círculo/círculo, proyectiles) se escribe a mano en `sim/`.

### Regla de oro de arquitectura

`sim/` contiene TODA la lógica de juego (economía, grid, combate, incursiones) como
**funciones puras y deterministas**: timestep fijo + RNG con semilla propia
(nunca `Math.random()` directo). El render (`render/`) solo lee el estado y lo dibuja
interpolado. La UI (`ui/`) despacha acciones a la sim. Esta separación es la que
permitiría multijugador después sin reescribir, y de regalo hace la lógica testeable.

## Pipeline de assets (Fase 0, prerequisito de todo)

El repo de assets usa **Git LFS** (~cientos de GB completo): **nunca se clona entero**.
Se descargan archivos sueltos desde
`https://media.githubusercontent.com/media/proofofplay/piratenation-art/main/<ruta URL-encoded>`.

> ⚠️ Gotcha verificado: varias carpetas del repo tienen **espacios al final del nombre**
> (`Mob Enemies `, `Giant Squid `, `Blowfish Earth `...). Hay que URL-encodear cada
> segmento tal cual (`Mob%20Enemies%20/`), o la descarga da 404.

Los glTF son exports de VoxEdit: texturas embebidas en base64, un material por pieza
(ej. el Giant Squid: 82 meshes, 164 imágenes, 4,8 MB) y **animaciones incluidas**
(mobs: `idle`/`hit`/`attack`; barcos y palmeras: `Idle`). Pipeline por asset:

1. `tools/fetch-assets.mjs` — lee `tools/assets-manifest.json` (ruta origen → nombre destino)
   y descarga a `tools/raw/` (carpeta git-ignorada).
2. `tools/optimize.mjs` — con gltf-transform: merge de materiales/texturas (paletas),
   `prune` + `dedup` + `weld`, compresión meshopt, salida **`.glb`** a `game/public/assets/models/`.
   Objetivo: **< 300 KB por modelo**, conservando las animaciones.
3. Los `.glb` optimizados **sí se commitean** (son el "fuente" del juego; el raw no).

### Set inicial de assets (rutas reales verificadas en el repo)

| Uso en el juego | Asset | Ruta en `Voxel Game Assets/` |
|---|---|---|
| Barco inicial | Skiff (XS) | `ships/Pirate Ships/Pirate_s Skiff (XS)/VE/ship_pirate_XS01C/ship_pirate_XS01C.gltf` |
| Segundo barco | Sloop (S) | `ships/Pirate Ships/Pirate_s Sloop (S)/ship_pirate_small.gltf` |
| Ayuntamiento | Town Hall | `world items/buildings/Town Hall (Pirate Crew-Level Up) /…` |
| Producción de ron | Distillery | `world items/buildings/Distillery/…` |
| Producción de metal | Foundry | `world items/buildings/Foundry/…` |
| Producción de comida | Triple Wind Mill | `world items/buildings/Triple Wind Mill/…` |
| Astillero | Shipwright | `world items/buildings/Shipwright/…` |
| Muelle (punto de zarpe) | Docks | `world items/buildings/Docks/…` |
| Mercado (trueque de recursos) | Marketplace | `world items/buildings/Marketplace/…` |
| Almacén de oro | Bank | `world items/buildings/Bank/…` |
| Decoración/ambiente | Palmeras animadas | `world items/Trees/Palm Tree Animated/20221030/GLTF/PN-PalmTreeAnimated.gltf` |
| Recolectables en islas | Oak/Pine Tree, Iron/Copper Ore, coconut, banana… | `world items/harvestables/…` |
| Cofre de botín | Bandit Chest (open/closed) | `chests/Bandit Chest/chest_bandit.gltf` |
| Mob básico | Blowfish (6 variantes elementales) | `Mob Enemies /Blowfish/Blowfish <Elemento>/model.gltf` |
| Mob melee | Kelpling | `Mob Enemies /Kelpling/…` |
| Mob rápido | Hammerdead Shark | `Mob Enemies /Hammerdead Shark/…` |
| Primer boss | Giant Squid (kraken) | `Mob Enemies /Giant Squid /Giant Squid <Elemento>/model.gltf` |

(Dentro de cada carpeta de edificio hay que elegir el glTF concreto al descargar; las rutas
exactas se fijan en `assets-manifest.json` en la Fase 0.)

## Fases

Cada fase termina en algo **jugable y enseñable**. No se empieza una fase sin cerrar la anterior.

### Fase 0 — Fundaciones ✦ pequeña

- Esqueleto Vite + TS en `game/` (la web actual del repo no se toca; el juego vive en su carpeta).
- Pipeline de assets funcionando de punta a punta: manifest → fetch → optimize → `.glb` en `public/`.
- Escena Three.js base para móvil: cap de `pixelRatio` (≤ 2), sRGB + tone mapping, resize,
  loop con **sim a timestep fijo (30 Hz) + render interpolado**, carga de `.glb` con clips de animación.
- Input táctil unificado (pointer events): tap, drag, pinch.
- Módulo de guardado: `SaveStore` (IndexedDB), esquema versionado, autosave (intervalo +
  `visibilitychange`), export/import JSON.

**Hecho cuando:** en un móvil real se ve el Skiff con su animación `Idle` sobre un plano de
agua, a 60 fps, y la partida (un contador tonto) sobrevive a cerrar y reabrir el navegador.

### Fase 1 — Tu isla (builder) ✦ grande

- Isla en grid (p. ej. 40×40 celdas) con terreno voxel-style y agua alrededor.
- Cámara CoC: vista inclinada, pan con un dedo, pinch-zoom con límites.
- Construcción: menú de edificios → fantasma sobre el grid (verde/rojo según validez) →
  colocar; mover edificios ya construidos.
- Economía v1 — recursos: **oro, madera, metal, ron** (comida/molino queda para más adelante si aporta).
  - Producción por hora con tope; recoger tocando el edificio (burbuja de "listo").
  - Mejoras con coste + timer real; el nivel del Town Hall limita el nivel/número del resto.
  - Progreso offline al volver (producción acumulada, con tope de almacén).
- Edificios v1: Town Hall, Distillery, Foundry, aserradero (elegir modelo), Bank/almacenes,
  Shipwright, Docks, Marketplace (convierte recursos con comisión), palmeras decorativas.
- HUD estilo Clash (ver `RETENTION.md` para la especificación completa): barras de recurso
  arriba a la derecha, constructores `1/2` arriba al centro, botón de acción primaria abajo
  a la izquierda, tienda/misiones abajo a la derecha, badges rojos en lo reclamable.
- Ganchos de sesión desde el primer día: burbujas de recolección, etiqueta `¡Lleno!`,
  límite de constructores, recompensa diaria encadenada y misiones diarias.

**Hecho cuando:** se puede jugar una sesión de 10 min colocando y mejorando edificios, cerrar
el juego, volver al día siguiente y encontrar producción acumulada. Sin bugs de guardado.

### Fase 2 — Mar abierto y exploración ✦ grande

- Desde los Docks: botón "Zarpar" → escena de mar abierto.
- Mundo marino **generado con semilla fija por partida** (ruido determinista): islas de
  recursos, arrecifes, niebla de distancia. Chunks alrededor del barco para rendimiento.
- Control del barco: joystick virtual o mantener-y-arrastrar (probar ambos con gente).
- Combate arcade: cañones **automáticos** por andanada cuando hay enemigo en arco lateral;
  el jugador juega al posicionamiento y la esquiva (ADN "sea survivors").
- Mobs con IA simple (patrulla → aggro → ataque) usando sus clips `idle/hit/attack`.
  Dificultad por anillos: cuanto más lejos de casa, peores bichos, mejor botín.
- Islas PvE: recolectables (madera/mineral/fruta), cofres, y el **Giant Squid como primer boss**
  guardando una zona rica.
- Riesgo/recompensa: si te hunden pierdes parte de la carga y reapareces en tu isla.
  Todo el botín vuelve a la economía del builder (cierre del loop principal).

**Hecho cuando:** el loop completo isla → navegar → luchar/lootear → volver → construir
funciona y apetece repetirlo.

### Fase 3 — Defensa de la isla (incursiones PvE) ✦ media

- Medidor de "amenaza" que crece con tu riqueza/progreso; al llenarse (y solo con el juego
  abierto, nada se resuelve a tus espaldas): aviso de incursión de la flota no-muerta con
  cuenta atrás para prepararte.
- Edificios defensivos: cañón costero, mortero, torre (elegir modelos del repo); los barcos
  undead llegan por mar y desembarcan oleadas — tower-defense-lite sobre la propia isla.
- La resolución del combate usa la sim determinista (semilla + timestep fijo): mismo motor
  que serviría para raids multijugador el día de mañana.
- Recompensas por defender; reparaciones baratas (estilo CoC: perder duele por el botín, no
  destruye tu progreso).

**Hecho cuando:** defender tu isla es un evento emocionante que condiciona cómo la construyes
(colocación de defensas importa).

### Fase 4 — Progresión larga y meta ✦ media, incremental

- Astillero: desbloqueo de clases de barco (Skiff → Sloop → Galleon → Frigate → Marauder)
  usando **ship shards** como material (categoría que ya existe en los assets).
- Skins de barco como recompensas de logros/bosses (68 familias temáticas disponibles).
- Capitán personalizable con el sistema modular de Avatar (pelo, ropa, sombreros…).
- Colecciones y logros expuestos como **trofeos decorativos en tu isla** (159 modelos de
  logros y 222 coleccionables en el repo).
- Misiones desde el Bulletin Board / Taberna.

## Presupuesto de rendimiento (móvil de gama media)

- 60 fps estables; sim desacoplada a 30 Hz.
- **< 100 draw calls** por escena: materiales fusionados por el pipeline, `InstancedMesh`
  para palmeras/props/olas/proyectiles, merge estático del terreno.
- Descarga inicial **< 10 MB** (modelos .glb + JS); Three.js tree-shaken.
- Agua: un plano con shader de olas barato (vertex displacement + scroll de normales), nada
  de reflexiones en tiempo real.
- Sombras: una sola luz direccional con shadow map pequeño, o sombras blob fake bajo
  entidades si el shadow map penaliza.

## Estructura de carpetas

```
game/
  index.html
  package.json
  vite.config.ts
  public/assets/models/     ← .glb optimizados (commiteados)
  src/
    main.ts
    core/    ← loop, input táctil, SaveStore, eventos
    sim/     ← lógica pura y determinista: economía, grid, combate, incursiones, RNG con semilla
    render/  ← escena Three, agua, carga de modelos, animaciones, FX
    ui/      ← HUD y paneles en HTML/CSS
    data/    ← definiciones de diseño en JSON (edificios, mobs, barcos, costes, tablas)
  tools/
    assets-manifest.json    ← qué descargar del repo de Pirate Nation
    fetch-assets.mjs
    optimize.mjs
    raw/                    ← descargas sin optimizar (git-ignorado)
```

La web actual de La Leyenda (raíz del repo) queda intacta; el juego se sirve desde `game/`
(`vite build` con `base` configurada si se publica en GitHub Pages).

## Puerta abierta al multijugador (qué NO romper mientras tanto)

No se construye nada de red ahora, pero estas tres reglas mantienen el camino despejado:

1. **`sim/` pura y determinista** (semilla + timestep fijo, sin `Math.random()` ni `Date.now()`
   dentro de la sim): una futura resolución de raids en servidor reutilizaría este código tal cual.
2. **Estado de partida = un único objeto serializable versionado** (lo que hoy va a IndexedDB
   mañana podría ir a una base de datos remota cambiando solo `SaveStore`).
3. **El layout de la isla es data, no escena**: atacar la isla de otro jugador sería cargar su
   JSON en vez del tuyo.

Cuando/si llegue el momento: cuentas + snapshots de islas en un backend Node/TS reutilizando
`sim/`, incursiones PvE sustituidas por raids asíncronos contra islas reales. Nada del
código de las fases 0–4 se tira.

---

**Estado:** plan aprobado pendiente de arrancar Fase 0.
**Siguiente paso:** esqueleto Vite + pipeline de assets con el set inicial de la tabla.
