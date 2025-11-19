export type ControlCategory = 'movement' | 'combat' | 'meta' | string;

export interface ControlEntry {
  device: 'keyboard' | 'mouse' | 'touch' | string;
  input: string;
  action: string;
}

export type GameStatus = 'working' | 'broken' | 'missing-assets' | 'unknown' | 'flaky';

export interface GameManifestEntry {
  id: string;
  title: string;
  description: string;
  entry: string;
  engine: string;
  controls: Record<ControlCategory, ControlEntry[]>;
  orientation: 'landscape' | 'portrait' | 'unknown' | string;
  thumbnail: string | null;
  tags?: string[];
  status: GameStatus;
  notes?: string;
}

export interface GamesManifest {
  $schema?: string;
  version: string;
  games: GameManifestEntry[];
}
