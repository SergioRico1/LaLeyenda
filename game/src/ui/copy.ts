/**
 * copy.ts — UI_SPEC §8. The game is Spanish (`lang="es"`); every string lives
 * here so a future i18n pass has one file to walk.
 *
 * Casing is TITLE CASE everywhere. Clash's small-cap look ("BuilDeRS") is a
 * property of the proprietary Supercell Magic font — hand-typed capitals read
 * as a typo (§6.16). Genuine `small-caps` appears only on timer unit
 * suffixes, where it is a faithful match.
 *
 * THE VOICE (round 11 — one reader over every string, see game/VOICE.md):
 * a warm first mate speaking to their captain. Second person singular (tú),
 * always. One word per thing, never a synonym: **carpintero** (never
 * constructor/obrero), **madera / oro / ron / metal / gemas**, **cofre**,
 * **Ayuntamiento**, **Astillero**. Exclamation marks are spent only on
 * payoffs the player earned (¡Botín!, ¡Cofre listo!, ¡Zarpar!) — a refusal
 * or a hint never shouts. Refusals are short, name the fix, and say "te"
 * rather than reading like a bank statement.
 */
export const COPY = {
  'cta.sail': '¡Zarpar!',
  'cta.build': 'Construir',
  'cta.chests': 'Cofres',
  'cta.log': 'Diario',
  'cta.settings': 'Ajustes',
  /* LAYOUT_SPEC §1 slot 1 — the island IS the builder: the destination is your
   * island, and what you do there is build on it. */
  'cta.island': 'Isla',
  'cta.upgrade': 'Mejorar',
  'cta.claim': 'Reclamar',
  'cta.collectAll': 'Recoger Todo',
  'cta.finishNow': 'Terminar\nYa',
  'cta.returnHome': 'Volver a la Isla',
  'cta.start': 'Empezar',
  'chip.full': '¡Lleno!',
  'chip.noBuilders': 'Sin carpinteros',
  'chip.storageMax': 'Almacén al máximo',
  'chip.repairing': 'Reparando',
  'chip.oneChest': 'Solo un cofre a la vez',
  'label.gotIt': 'Lo has conseguido:',
  'label.loot': 'Botín:',
  'banner.victory': '¡Botín!',
  'banner.returned': 'La Isla Resistió',
  'guide.idleBuilder': 'Carpintero sin trabajo',

  /* LAYOUT_SPEC §4 — the objective line. One per §4.8 resolver verdict, in the
   * resolver's own priority order. Sentence case, not Title Case: these are
   * sentences the game says out loud, and §1.9's Title Case rule is about
   * labels. Each one has to fit a 390pt line beside its progress figure, so
   * they name the verb and the object and stop. */
  'obj.builder': 'Un carpintero está libre',
  'obj.chest': 'Tienes un cofre esperando',
  'obj.log': 'Recompensas por reclamar',
  'obj.store': 'Amplía el almacén de',
  'obj.sail': 'Zarpa en busca de botín',
  'obj.collect': 'Recoge lo producido',
  'obj.collectTip': 'Toca las burbujas de la isla',

  /* §3.5 — every refusal and every unbuilt route answers out loud. A tap that
   * changes nothing and says nothing is the one thing the spec forbids twice. */
  'toast.chestReady': '¡Cofre listo!',
  'toast.questDone': '¡Misión completada!',
  'toast.builderGone': 'Se acabó el carpintero de guardia',
  'toast.levelUp': '¡Nivel',
  'toast.soon': 'Muy pronto',
  /* The base line for a locked ¡Zarpar! — true once the Ayuntamiento allows
   * the Astillero. Below that hall level the walked audit (R11 #7) caught it
   * naming a building the picker refuses with a different reason, so the call
   * site goes through `sailLockedLine` below, which names the REAL next step. */
  'toast.sailLocked': 'Construye el Astillero y zarpamos',
  'panel.builders': 'Carpinteros',
  'panel.ranks': 'Rangos de Capitán',
  'panel.log': 'Diario de a Bordo',
  'panel.gems': 'Gemas',
  'res.oro': 'Oro',
  'res.madera': 'Madera',
  'res.ron': 'Ron',
  'res.metal': 'Metal',
  'res.gemas': 'Gemas',

  /* §3.15 build mode */
  'panel.build': 'Construir',
  'build.place': 'Colocar',
  'build.confirm': 'Confirmar',
  'build.cancel': 'Cancelar',
  'build.owned': 'Tienes',
  'build.nothingHere': 'Aquí no cabe',

  /* §3.16 the upgrade sheet */
  'sheet.level': 'Nivel',
  'sheet.next': 'Siguiente nivel',
  'sheet.rate': 'Producción',
  'sheet.capacity': 'Capacidad del edificio',
  'sheet.storage': 'Almacenamiento',
  'sheet.unlocks': 'Desbloquea',
  'sheet.working': 'En obras',
  'sheet.perHour': '/h',
  'sheet.maxLevel': 'Nivel máximo alcanzado',
  'sheet.close': 'Cerrar',

  /* LAYOUT_SPEC item 5 — the 2×2 stat grid. Grid cells are ~150px wide on a
   * 390pt screen, so these are the SHORT forms; 'sheet.capacity' above stays
   * long because nothing else uses it now. */
  'stat.rate': 'Producción',
  'stat.capacity': 'Capacidad',
  'stat.storage': 'Almacenamiento',
  'stat.fillsIn': 'Se llena en',
  'stat.maxLevel': 'Nivel máx',
  'stat.buildings': 'Edificios',
  'stat.resources': 'Recursos',
  'stat.time': 'Tiempo',
} as const;

export type CopyKey = keyof typeof COPY;
export const t = (key: CopyKey): string => COPY[key];

/**
 * §3.5 — a tap is never silent. Every refusal the sim can return has a line
 * here, so a greyed row or a blocked CTA always says which key is missing
 * rather than simply failing to respond.
 *
 * `town-hall-too-low` is the only one that needs a figure, and it is the most
 * important one in the game: it is the single place the player is told what the
 * Ayuntamiento is actually for.
 */
export type RefusalKey =
  | 'unknown-building' | 'busy' | 'no-builders' | 'max-level' | 'max-count' | 'cell-occupied'
  | 'too-close' | 'obstacle' | 'unknown-obstacle'
  | 'town-hall-too-low' | 'not-enough-resources' | 'not-enough-gems' | 'store-full'
  | 'nothing-to-collect' | 'slot-busy' | 'another-chest-unlocking' | 'not-ready' | 'already-claimed';

const REFUSAL: Record<RefusalKey, string> = {
  'unknown-building': 'No disponible',
  busy: 'Ya está en obras',
  'no-builders': 'Sin carpinteros libres',
  'max-level': 'Nivel máximo',
  'max-count': 'Ya tienes el máximo',
  'cell-occupied': 'Aquí no cabe',
  // reference/SPACING.md: nothing abuts. The line names the fix, not the rule —
  // the player does not need to know the number, only which way to drag.
  'too-close': 'Demasiado pegado',
  'obstacle': 'Despeja el terreno',
  'unknown-obstacle': 'Ya está despejado',
  'town-hall-too-low': 'Requiere Ayuntamiento',
  // "Recursos/Gemas insuficientes" was the one place the first mate spoke like
  // a cashpoint. Same length, same information, the game's own register.
  'not-enough-resources': 'Te faltan recursos',
  'not-enough-gems': 'Te faltan gemas',
  'store-full': 'Almacén al máximo',
  'nothing-to-collect': 'Nada que recoger',
  'slot-busy': 'Hueco ocupado',
  'another-chest-unlocking': 'Solo un cofre a la vez',
  'not-ready': 'Todavía no',
  'already-claimed': 'Ya reclamado',
};

export function refusalText(key: RefusalKey, townHall?: number): string {
  const base = REFUSAL[key] ?? 'No disponible';
  return key === 'town-hall-too-low' && townHall ? `${base} ${townHall}` : base;
}

/**
 * The locked ¡Zarpar! line — audit R11 #7.
 *
 * Walked cold, the refusal said "Construye el Astillero" while the picker
 * refused that very row with "Requiere Ayuntamiento 3": two answers to one
 * tap, and the first one was a door two doors away. This resolves it by
 * naming the step the player can actually take TODAY.
 *
 * Both figures come from the caller (islandScene has the state and the
 * balance in hand — see VOICE.md patch 3), so if the Astillero's gate ever
 * moves from Ayuntamiento 3 the line moves with it instead of lying.
 */
export function sailLockedLine(townHall: number, astilleroAt: number): string {
  return townHall < astilleroAt
    ? `El mar pide un Astillero: sube el Ayuntamiento a ${astilleroAt}`
    : COPY['toast.sailLocked'];
}

/**
 * §3.16's unlock row on the Ayuntamiento sheet — audit R11 #8.
 *
 * `townHallUnlocks` deals ids; buildings and resources already carry labels in
 * balance.json, but the FEATURE ids (a chest slot, a carpenter, a hull, a
 * season) had none — so the game's most-read sheet printed "Desbloquea:
 * Destilería · Bodega · tablon", and at TH3 it would have printed
 * "canon_costero · cofre_hueco_4". Every id balance.json can deal is named
 * here; present.ts consults this table last (see VOICE.md patch 2).
 *
 * Terminology holds the line: carpintero (never constructor), and the hull
 * names match seaHud's SHIP_LABEL — sloop is Balandra everywhere.
 */
export const UNLOCK_LABEL: Record<string, string> = {
  tablon: 'Tablón de Anuncios',
  canon_costero: 'Cañón Costero',
  cofre_hueco_4: '4º Hueco de Cofre',
  defensas: 'Defensas',
  recoger_todo: 'Recoger Todo',
  mortero: 'Mortero',
  sloop: 'Balandra',
  amenaza: 'Incursiones',
  constructor_4: '4º Carpintero',
  temporadas: 'Temporadas',
};
