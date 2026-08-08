/**
 * copy.ts — UI_SPEC §8. The game is Spanish (`lang="es"`); every string lives
 * here so a future i18n pass has one file to walk.
 *
 * Casing is TITLE CASE everywhere. Clash's small-cap look ("BuilDeRS") is a
 * property of the proprietary Supercell Magic font — hand-typed capitals read
 * as a typo (§6.16). Genuine `small-caps` appears only on timer unit
 * suffixes, where it is a faithful match.
 */
export const COPY = {
  'cta.sail': '¡Zarpar!',
  'cta.build': 'Construir',
  'cta.chests': 'Cofres',
  'cta.log': 'Diario',
  'cta.settings': 'Ajustes',
  'cta.upgrade': 'Mejorar',
  'cta.claim': 'Reclamar',
  'cta.collectAll': 'Recoger Todo',
  'cta.finishNow': 'Terminar\nYa',
  'cta.returnHome': 'Volver a la Isla',
  'cta.start': 'Empezar',
  'chip.full': '¡Lleno!',
  'chip.noBuilders': 'Sin constructores',
  'chip.storageMax': 'Almacén al máximo',
  'chip.repairing': 'Reparando',
  'chip.oneChest': 'Solo un cofre a la vez',
  'label.gotIt': 'Lo has conseguido:',
  'label.loot': 'Botín:',
  'banner.victory': '¡Botín!',
  'banner.returned': 'La Isla Resistió',
  'guide.idleBuilder': 'Carpintero sin trabajo',

  /* §3.5 — every refusal and every unbuilt route answers out loud. A tap that
   * changes nothing and says nothing is the one thing the spec forbids twice. */
  'toast.chestReady': '¡Cofre listo!',
  'toast.questDone': '¡Misión completada!',
  'toast.builderGone': 'Se acabó el carpintero de guardia',
  'toast.levelUp': '¡Nivel',
  'toast.soon': 'Muy pronto',
  'toast.sailLocked': 'Construye el Astillero',
  'panel.builders': 'Constructores',
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
  | 'town-hall-too-low' | 'not-enough-resources' | 'not-enough-gems' | 'store-full'
  | 'nothing-to-collect' | 'slot-busy' | 'another-chest-unlocking' | 'not-ready' | 'already-claimed';

const REFUSAL: Record<RefusalKey, string> = {
  'unknown-building': 'No disponible',
  busy: 'Ya está en obras',
  'no-builders': 'Sin constructores libres',
  'max-level': 'Nivel máximo',
  'max-count': 'Ya tienes el máximo',
  'cell-occupied': 'Aquí no cabe',
  'town-hall-too-low': 'Requiere Ayuntamiento',
  'not-enough-resources': 'Recursos insuficientes',
  'not-enough-gems': 'Gemas insuficientes',
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
