import { createContext, useContext, type ReactNode } from 'react';
import { allGames, getGameById, playableGames } from '../lib/manifest';
import type { GameManifestEntry } from '../types/manifest';

interface ManifestContextValue {
  games: GameManifestEntry[];
  playableGames: GameManifestEntry[];
  getGame: (id: string) => GameManifestEntry | undefined;
}

const ManifestContext = createContext<ManifestContextValue | undefined>(undefined);

export function ManifestProvider({ children }: { children: ReactNode }) {
  const value: ManifestContextValue = {
    games: allGames,
    playableGames,
    getGame: getGameById
  };

  return <ManifestContext.Provider value={value}>{children}</ManifestContext.Provider>;
}

export function useManifest() {
  const ctx = useContext(ManifestContext);
  if (!ctx) {
    throw new Error('useManifest must be used within a ManifestProvider');
  }
  return ctx;
}
