export type WeaponId = 'pistol' | 'smg' | 'shotgun' | 'rifle' | 'sniper';

export type WeaponSlot = 1 | 2 | 3 | 4 | 5;

export type ArmorType = 'none' | 'light' | 'heavy';

export type AIDifficulty = 'easy' | 'normal' | 'hard';

export type AIBehaviorState = 'patrol' | 'attack' | 'reposition' | 'cover' | 'reload';

export type OperativeId = 'vex' | 'kai' | 'nyx';

export type GameAppState = 'title' | 'playing' | 'paused' | 'gameover';

export type RoundPhase = 'buy' | 'combat' | 'round_end' | 'match_over';

export interface WeaponStats {
  id: WeaponId;
  slot: WeaponSlot;
  name: string;
  codeName: string;
  category: string;
  roleDesc: string;
  cost: number;
  headDamage: number;
  bodyDamage: number;
  legDamage: number;
  fireRate: number; // shots per second
  automatic: boolean;
  magSize: number;
  maxReserve: number;
  reloadTime: number; // seconds
  recoilPitch: number; // radians per shot
  recoilYaw: number; // radians per shot
  baseSpread: number; // radians
  moveSpreadPenalty: number;
  adsSpreadMultiplier: number;
  adsFovMultiplier: number;
  moveSpeedMultiplier: number;
  pellets: number;
  range: number;
  falloffStart: number;
  tracerColor: number;
}

export interface WeaponInstanceState {
  id: WeaponId;
  ammoInMag: number;
  ammoReserve: number;
}

export interface OperativeProfile {
  id: OperativeId;
  name: string;
  callsign: string;
  role: string;
  origin: string;
  accentHex: string;
  accentColor: number;
  secondaryHex: string;
  signatureWeapon: WeaponId;
  bio: string;
}

export interface GameSettings {
  mouseSensitivity: number; // 0.2 to 3.0
  fov: number; // 70 to 110
  masterVolume: number; // 0 to 1
  muted: boolean;
  graphicsQuality: 'performance' | 'balanced' | 'ultra';
  showMinimap: boolean;
  crosshairColor: string;
  showFps?: boolean;
}

export interface AABB {
  id: string;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
  isCover?: boolean;
  isWallRunPanel?: boolean;
  label?: string;
}

export interface RopeAnchor {
  id: string;
  label: string;
  x: number;
  y: number;
  z: number;
  ropeLength: number;
  grabRadius: number;
}

export interface JumpPad {
  id: string;
  label: string;
  x: number;
  y: number;
  z: number;
  radius: number;
  boostVy: number;
  boostForward: number;
}

export interface WallContact {
  wallId: string;
  normalX: number;
  normalZ: number;
  tangentX: number;
  tangentZ: number;
  side: 'left' | 'right';
  distance: number;
  isWallRunPanel: boolean;
}

export interface Waypoint {
  id: string;
  x: number;
  z: number;
  isCover: boolean;
  zone: 'south_spawn' | 'north_spawn' | 'mid' | 'west_long' | 'east_flank';
  neighbors: string[];
}

export interface InteractiveObjective {
  id: string;
  label: string;
  actionHint: string;
  x: number;
  y: number;
  z: number;
  cooldown: number;
  lastUsedTime: number;
  type: 'ammo_crate' | 'radar_beacon';
}

export interface KillFeedEntry {
  id: string;
  killer: 'PLAYER' | 'AI';
  victim: 'PLAYER' | 'AI';
  weaponId?: WeaponId;
  weaponName: string;
  isHeadshot: boolean;
  timestamp: number;
}

export interface HitFeedback {
  damage: number;
  isHeadshot: boolean;
  isKill: boolean;
  timestamp: number;
  worldX: number;
  worldY: number;
  worldZ: number;
}

export interface MatchSummaryStats {
  winner: 'PLAYER' | 'AI';
  playerRounds: number;
  aiRounds: number;
  totalRoundsPlayed: number;
  playerKills: number;
  playerDeaths: number;
  shotsFired: number;
  shotsHit: number;
  headshots: number;
  totalDamageDealt: number;
  creditsEarned: number;
  difficulty: AIDifficulty;
  operative: OperativeId;
  isPractice: boolean;
}

export interface HudSnapshot {
  appState: GameAppState;
  roundPhase: RoundPhase;
  roundNumber: number;
  playerScore: number;
  aiScore: number;
  targetRounds: number;
  phaseTimeRemaining: number;
  playerHealth: number;
  playerMaxHealth: number;
  playerArmor: number;
  playerArmorType: ArmorType;
  playerCredits: number;
  activeWeapon: WeaponInstanceState;
  ownedWeapons: Record<WeaponId, WeaponInstanceState | null>;
  isReloading: boolean;
  reloadProgress: number; // 0 to 1
  isInspecting: boolean;
  inspectProgress: number; // 0 to 1
  isAiming: boolean;
  isCrouching: boolean;
  isSliding: boolean;
  isWalking: boolean;
  isWallRunning?: boolean;
  wallRunSide?: 'left' | 'right' | null;
  isSwinging?: boolean;
  activeRopeAnchorId?: string | null;
  nearbyRopeAnchor?: RopeAnchor | null;
  canWallJump?: boolean;
  aiHealth: number;
  aiMaxHealth: number;
  aiArmor: number;
  aiState: AIBehaviorState;
  aiWeaponId: WeaponId;
  aiVisibleOnRadar: boolean;
  aiPosition: { x: number; z: number };
  playerPosition: { x: number; z: number; yaw: number };
  nearbyObjective: InteractiveObjective | null;
  killFeed: KillFeedEntry[];
  lastHitFeedback: HitFeedback | null;
  roundAnnouncement: string | null;
  roundWinner: 'PLAYER' | 'AI' | null;
  isPracticeMode: boolean;
  difficulty: AIDifficulty;
  operative: OperativeId;
  pointerLocked: boolean;
  matchSummary: MatchSummaryStats | null;
  isMultiplayer?: boolean;
  multiplayerRoomCode?: string | null;
  multiplayerRole?: 'host' | 'guest' | null;
  opponentCallsign?: string;
  opponentOperative?: OperativeId;
  opponentConnected?: boolean;
  pingMs?: number;
  fps?: number;
  frameTimeMs?: number;
}

