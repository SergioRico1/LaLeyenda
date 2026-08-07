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
  'panel.builders': 'Constructores',
  'panel.ranks': 'Rangos de Capitán',
  'panel.log': 'Diario de a Bordo',
  'panel.gems': 'Gemas',
  'res.oro': 'Oro',
  'res.madera': 'Madera',
  'res.ron': 'Ron',
  'res.metal': 'Metal',
  'res.gemas': 'Gemas',
} as const;

export type CopyKey = keyof typeof COPY;
export const t = (key: CopyKey): string => COPY[key];
