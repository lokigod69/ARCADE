import manifestData from '../../games.manifest.json';
import type { GameManifestEntry, GamesManifest } from '../types/manifest';

const manifest = manifestData as GamesManifest;

export const gamesManifest: GamesManifest = manifest;

export const allGames: GameManifestEntry[] = manifest.games;

export const playableGames: GameManifestEntry[] = allGames.filter(
  (game) => game.status !== 'missing-assets' && game.status !== 'broken'
);

export function getGameById(id: string): GameManifestEntry | undefined {
  return allGames.find((game) => game.id === id);
}
