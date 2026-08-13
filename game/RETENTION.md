# El enganche — diseño de retención

Documento hermano de `PLAN.md`. El plan dice **qué** construimos; este dice **por qué el
jugador vuelve mañana**. La referencia de arte sigue siendo Pirate Nation, pero la UI y
todos los bucles de esta página se miden contra **Clash of Clans / Clash Royale**
(capturas reales en `reference/clash/`).

> Nota de alcance: el juego es single-player y offline (ver `PLAN.md`). Todo lo de aquí
> funciona sin servidor. Lo que en Clash es social (clanes, ligas contra humanos) se
> sustituye por equivalentes PvE o se aparca para una fase posterior.

## El principio que lo ordena todo

En Clash nunca terminas la sesión con las manos vacías **ni** con todo resuelto. Cada vez
que cierras el juego dejas algo **en marcha** (un timer) y algo **esperándote** (recursos
acumulándose). Volver siempre tiene una recompensa concreta y visible, y siempre hay una
razón para volver otra vez después.

Regla de diseño: **nunca dejes al jugador sin un timer corriendo y sin algo que recoger.**
Si una sesión termina con la isla "vacía" (nada construyéndose, nada produciendo), el bucle
se ha roto y hay que arreglarlo.

## Los tres relojes

Clash superpone tres escalas de tiempo. Copiamos la estructura:

| Reloj | En Clash | En La Leyenda | Función |
|---|---|---|---|
| **Minutos** | Recolectar oro/elixir, atacar | Recoger producción, una salida al mar | Da algo que hacer *ahora* |
| **Horas** | Mejoras de edificios, cofres | Mejoras, expediciones, cofres | Da la razón para volver *hoy* |
| **Días/semanas** | Ayuntamiento, ligas, temporadas | Astillero, amenaza, temporadas | Da la razón para seguir *este mes* |

Una sesión sana toca los tres: recoges (minutos), lanzas una mejora larga (horas), avanzas
un peldaño de una meta grande (días).

## Bucle de sesión (2–5 minutos, el 80% de las sesiones)

1. **Abres** → la isla ya tiene burbujas de recurso flotando sobre los edificios. Producción
   offline aplicada, con tope de almacén.
2. **Recoges** tocando cada burbuja: números que suben, sonido, la barra de recursos se llena.
3. **Gastas**: subes un edificio de nivel o colocas uno nuevo. Se inicia un timer.
4. **Opcional**: sales a navegar 2–3 minutos, vuelves con botín.
5. **Cierras** con algo construyéndose y los productores llenándose otra vez.

El paso 5 no es casualidad: la UI debe empujar activamente a dejar un timer corriendo
(ver "Constructores" abajo).

## Los ganchos concretos

### 1. Constructores (el recurso escaso de verdad)
Copiado directo de Clash: solo puedes tener **N mejoras simultáneas** (empezamos con 1,
llegas a 4). El límite no es el oro, es el constructor. Esto convierte "¿en qué gasto?" en
una decisión real y crea el hábito de volver a liberar constructores.

- HUD: contador `1/2` arriba con botón `+` — el mismo sitio que en Clash.
- Un constructor libre debe **molestar visualmente** (icono parpadeando): es la señal de
  "tienes trabajo pendiente".

### 2. Producción con tope
Cada productor acumula hasta su almacén y **se para**. Etiqueta `¡Lleno!` sobre el edificio
(literal de Clash). Enseña dos cosas a la vez: vuelve pronto, y sube el almacén.

### 3. Burbujas de recolección
La recompensa por abrir el juego debe ser **táctil y visible en 1 segundo**. Burbuja flotante
sobre cada edificio con producción lista; tocarla lanza el número hacia la barra de recursos.

### 4. Cofres con temporizador
El bucle de Clash Royale. Vuelves del mar con un cofre → ocupa un hueco (4 huecos) → tarda
en abrirse (15 min – 8 h según rareza) → o esperas, o gastas gemas. La apertura es una
**escena dedicada** con las recompensas reveladas de una en una (`reference/clash/cr_chest_reward.png`).

### 5. Recompensa diaria encadenada
7 días, con el día 7 claramente mejor. Se reinicia si fallas un día. Es el gancho de hábito
más barato de implementar y el más efectivo.

### 6. Misiones (diarias y de progresión)
- **Diarias** (3, se renuevan a medianoche): "recoge 500 de ron", "hunde 5 monstruos",
  "sube un edificio". Recompensa en gemas.
- **De progresión**: la cadena larga que enseña el juego y da un premio gordo al final.
- Punto de entrada: el tablón de anuncios, con **badge numérico rojo** cuando hay algo
  reclamable. El badge rojo es media batalla de la retención.

### 7. Amenaza e incursiones (nuestro sustituto del PvP)
El medidor de amenaza sube con tu riqueza. Al llenarse, aviso de incursión no-muerta con
cuenta atrás. Da un pico de tensión y hace que la colocación de defensas importe. Tras una
incursión, **escudo temporal** (como el `2d 16h` de Clash): descanso garantizado, y un
recordatorio elegante de cuándo vuelve a ser interesante conectarse.

### 8. Temporadas
Cada 4 semanas: un tema (Vikingos, No-muertos, Anubis — las familias de barcos del repo ya
lo dan gratis), una tabla de recompensas por progreso y skins exclusivas. Es lo que evita
que el juego se sienta "terminado" al llegar al máximo.

### 9. Gemas
Moneda premium que acelera timers y compra huecos. En single-player sin tienda real se ganan
jugando (logros, misiones, cofres). Mantiene la mecánica de decisión ("¿acelero o espero?")
sin necesidad de monetización.

## Especificación de HUD (contra `reference/clash/coc_hud_collect.png`)

Layout de Clash, adaptado a móvil en vertical y horizontal:

- **Arriba izquierda**: nivel del capitán + barra de XP; trofeos; buzón de novedades.
- **Arriba centro**: constructores `1/2` con `+`; escudo activo con tiempo restante.
- **Arriba derecha**: barras de recurso apiladas — oro, madera, metal, ron — cada una con
  barra de llenado, cantidad e icono voxel. Gemas con `+`.
- **Abajo izquierda**: botón grande de acción primaria (**¡Zarpar!**, el equivalente a
  "Attack!"), y el botón de construir.
- **Abajo derecha**: tienda, ajustes, misiones (con badge).
- **Modo construcción**: rejilla verde translúcida bajo el edificio, botones `✗` / `✓`
  flotantes, flechas de arrastre (`reference/clash/coc_build_mode.png`).

Lenguaje visual: texto blanco grueso con contorno oscuro, paneles crema/madera con borde
dorado, CTA verde, cerrar rojo, esquinas muy redondeadas, todo con sombra dura. Los iconos
son renders voxel de los propios assets sobre un swatch de color — que es exactamente lo que
hace Pirate Nation, así que arte y UI encajan sin fricción.

## Qué NO copiamos

- **Muros de pago y esperas abusivas.** Los timers existen para dar ritmo, no para vender
  atajos: sin tienda real, calibramos a que un jugador sin gastar tenga un juego cómodo.
- **Clanes y chat.** No hay multijugador en esta fase.
- **Energía / vidas.** No limitamos cuánto se puede jugar; el límite natural son los
  constructores y la producción.

## Cómo se mide

Cada gancho es una pieza que un crítico puede evaluar por separado, con el mismo listón que
el resto del proyecto:

- **Visual**: A/B ciego del HUD y los paneles contra las capturas de `reference/clash/`.
- **Funcional**: se puede jugar una sesión de 3 minutos, cerrar, volver al día siguiente y
  encontrar producción acumulada, un cofre listo y una misión reclamable.
- **De diseño**: al cerrar el juego, ¿queda un timer corriendo y algo que recoger? Si no,
  el bucle está roto.
