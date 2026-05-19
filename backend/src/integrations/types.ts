/**
 * Common shape every league integration normalizes to.
 * Routes consume `NormalizedLeague`; integrations are responsible for mapping
 * their platform-specific payloads into this shape.
 */

export interface NormalizedTeam {
  externalId: string;      // platform's team/roster ID
  teamName: string;
  ownerName: string | null;
  // Players are identified by platform-specific ID;
  // the league sync service joins these to our canonical player table.
  playerIds: {
    sleeper?: string[];
    espn?: string[];
    fantrax?: string[];
    names?: string[];      // fallback for platforms that only expose names
  };
}

export interface NormalizedLeague {
  platform: 'sleeper' | 'espn' | 'fantrax';
  externalId: string;
  leagueName: string | null;
  scoringFormat: 'points' | '9cat' | '8cat' | 'other' | null;
  teamCount: number;
  teams: NormalizedTeam[];
}

export interface LeagueFetchOptions {
  // ESPN private leagues require both cookies
  espn?: {
    swid?: string;
    s2?: string;
  };
}
