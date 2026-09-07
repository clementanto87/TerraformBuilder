/**
 * Pack registry.
 *
 * A pack is data, so a new cloud — or a team's own module library — is
 * registered here without touching the engine.
 */

import type { ProviderPack, ResourceDef } from '@/core/types';
import { azurePack } from './azure';

export const packs: ProviderPack[] = [azurePack];

export const defaultPack = azurePack;

export const packById = (id: string): ProviderPack =>
  packs.find((pack) => pack.id === id) ?? defaultPack;

/** Merges runtime-discovered definitions (from an import) into a pack. */
export function withDiscovered(pack: ProviderPack, discovered: ResourceDef[]): ProviderPack {
  if (discovered.length === 0) return pack;
  const known = new Set(pack.resources.map((def) => def.id));
  const additions = discovered.filter((def) => !known.has(def.id));
  if (additions.length === 0) return pack;
  return { ...pack, resources: [...pack.resources, ...additions] };
}

export { azurePack };
