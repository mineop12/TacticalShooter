import {
  calculateDamageWithArmor,
  calculateRoundEconomy,
  checkMatchVictory,
  STARTING_CREDITS,
  TARGET_ROUND_WINS,
} from './rules.ts';
import { ArmorType, KillFeedEntry, OperativeId, RoundPhase, WeaponId } from './types.ts';
import { ARMOR_SPECS, WEAPONS } from './weapons.ts';

export type MultiplayerRole = 'host' | 'guest';

export type RoomStatus = 'waiting' | 'active' | 'finished';

export interface MultiplayerPlayerState {
  playerId: string;
  role: MultiplayerRole;
  callsign: string;
  operative: OperativeId;
  connected: boolean;
  ready: boolean;
  x: number;
  y: number;
  z: number;
  vx: number;
  vz: number;
  yaw: number;
  pitch: number;
  health: number;
  armor: number;
  armorType: ArmorType;
  credits: number;
  lossStreak: number;
  weaponId: WeaponId;
  survivedLastRound: boolean;
  isCrouching: boolean;
  isSliding: boolean;
  isReloading: boolean;
  kills: number;
  deaths: number;
  pingMs: number;
  lastSeenAt: number;
}

export interface MultiplayerRoomState {
  code: string;
  isPublicQueue: boolean;
  status: RoomStatus;
  roundNumber: number;
  roundPhase: RoundPhase;
  phaseEndsAt: number;
  targetRounds: number;
  hostScore: number;
  guestScore: number;
  roundWinner: MultiplayerRole | null;
  matchWinner: MultiplayerRole | null;
  announcement: string | null;
  killFeed: KillFeedEntry[];
  host: MultiplayerPlayerState;
  guest: MultiplayerPlayerState | null;
  createdAt: number;
  updatedAt: number;
}

export interface DamageResolutionEvent {
  attackerRole: MultiplayerRole;
  victimRole: MultiplayerRole;
  weaponId: WeaponId;
  weaponName: string;
  damageApplied: number;
  newHealth: number;
  newArmor: number;
  isHeadshot: boolean;
  eliminated: boolean;
  hitX: number;
  hitY: number;
  hitZ: number;
  roundEnded: boolean;
  roundWinner: MultiplayerRole | null;
  matchWinner: MultiplayerRole | null;
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function normalizeRoomCode(raw: string): string {
  return String(raw || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 6);
}

export function isValidRoomCode(code: string): boolean {
  const norm = normalizeRoomCode(code);
  return norm.length === 6 && /^[A-Z0-9]{6}$/.test(norm);
}

export function generateRoomCode(existingCodes?: Set<string>): string {
  for (let attempt = 0; attempt < 50; attempt++) {
    let code = '';
    for (let i = 0; i < 6; i++) {
      const idx = Math.floor(Math.random() * CODE_ALPHABET.length);
      code += CODE_ALPHABET[idx];
    }
    if (!existingCodes || !existingCodes.has(code)) {
      return code;
    }
  }
  return 'VG' + Math.floor(1000 + Math.random() * 8999).toString();
}

export function getSpawnForRole(role: MultiplayerRole): {
  x: number;
  y: number;
  z: number;
  yaw: number;
} {
  if (role === 'host') {
    return { x: 0, y: 0, z: 21, yaw: 0 };
  }
  return { x: 0, y: 0, z: -18.5, yaw: Math.PI };
}

export function createInitialMultiplayerPlayer(
  playerId: string,
  role: MultiplayerRole,
  callsign: string,
  operative: OperativeId,
  now = Date.now()
): MultiplayerPlayerState {
  const spawn = getSpawnForRole(role);
  const cleanCallsign =
    String(callsign || '')
      .trim()
      .slice(0, 16)
      .toUpperCase() || (role === 'host' ? 'ALPHA-01' : 'BRAVO-02');

  return {
    playerId,
    role,
    callsign: cleanCallsign,
    operative,
    connected: true,
    ready: true,
    x: spawn.x,
    y: spawn.y,
    z: spawn.z,
    vx: 0,
    vz: 0,
    yaw: spawn.yaw,
    pitch: 0,
    health: 100,
    armor: 0,
    armorType: 'none',
    credits: STARTING_CREDITS,
    lossStreak: 0,
    weaponId: 'pistol',
    survivedLastRound: false,
    isCrouching: false,
    isSliding: false,
    isReloading: false,
    kills: 0,
    deaths: 0,
    pingMs: 18,
    lastSeenAt: now,
  };
}

export const MP_BUY_DURATION_MS = 10_000;
export const MP_COMBAT_DURATION_MS = 95_000;
export const MP_ROUND_END_DURATION_MS = 3_400;

export class MultiplayerRoomManager {
  private rooms = new Map<string, MultiplayerRoomState>();

  public getRoom(code: string): MultiplayerRoomState | undefined {
    return this.rooms.get(normalizeRoomCode(code));
  }

  public upsertRoom(room: MultiplayerRoomState): MultiplayerRoomState {
    const code = normalizeRoomCode(room.code);
    const copy: MultiplayerRoomState = JSON.parse(JSON.stringify(room));
    copy.code = code;
    this.rooms.set(code, copy);
    return copy;
  }

  public getAllRooms(): MultiplayerRoomState[] {
    return Array.from(this.rooms.values());
  }

  public listPublicWaitingRooms(): MultiplayerRoomState[] {
    const list: MultiplayerRoomState[] = [];
    for (const room of this.rooms.values()) {
      if (room.status === 'waiting' && room.guest === null && room.host.connected) {
        list.push(room);
      }
    }
    return list;
  }

  public createRoom(params: {
    playerId: string;
    callsign: string;
    operative: OperativeId;
    isPublicQueue?: boolean;
    preferredCode?: string;
    now?: number;
  }): MultiplayerRoomState {
    const now = params.now ?? Date.now();
    const existing = new Set(this.rooms.keys());
    const preferred = params.preferredCode ? normalizeRoomCode(params.preferredCode) : '';
    const code =
      preferred.length === 6 && !existing.has(preferred)
        ? preferred
        : generateRoomCode(existing);

    const host = createInitialMultiplayerPlayer(
      params.playerId,
      'host',
      params.callsign,
      params.operative,
      now
    );

    const room: MultiplayerRoomState = {
      code,
      isPublicQueue: Boolean(params.isPublicQueue),
      status: 'waiting',
      roundNumber: 1,
      roundPhase: 'buy',
      phaseEndsAt: now + MP_BUY_DURATION_MS,
      targetRounds: TARGET_ROUND_WINS,
      hostScore: 0,
      guestScore: 0,
      roundWinner: null,
      matchWinner: null,
      announcement: `WAITING FOR CHALLENGER // CODE: ${code}`,
      killFeed: [],
      host,
      guest: null,
      createdAt: now,
      updatedAt: now,
    };

    this.rooms.set(code, room);
    return room;
  }

  public joinRoomByCode(params: {
    code: string;
    playerId: string;
    callsign: string;
    operative: OperativeId;
    now?: number;
  }):
    | { ok: true; room: MultiplayerRoomState; role: MultiplayerRole }
    | { ok: false; error: string } {
    const now = params.now ?? Date.now();
    const normCode = normalizeRoomCode(params.code);
    if (!isValidRoomCode(normCode)) {
      return { ok: false, error: 'Enter a valid 6-character tactical room code.' };
    }

    const room = this.rooms.get(normCode);
    if (!room) {
      return { ok: false, error: `Room ${normCode} not found. Verify the 6-character code.` };
    }

    // Reconnect support if same playerId rejoins
    if (room.host.playerId === params.playerId) {
      room.host.connected = true;
      room.host.lastSeenAt = now;
      room.updatedAt = now;
      return { ok: true, room, role: 'host' };
    }
    if (room.guest && room.guest.playerId === params.playerId) {
      room.guest.connected = true;
      room.guest.lastSeenAt = now;
      room.updatedAt = now;
      return { ok: true, room, role: 'guest' };
    }

    if (room.guest !== null && room.guest.connected) {
      return { ok: false, error: `Room ${normCode} is already full (2/2 operatives).` };
    }

    const guest = createInitialMultiplayerPlayer(
      params.playerId,
      'guest',
      params.callsign,
      params.operative,
      now
    );
    room.guest = guest;
    this.startMatchInRoom(room, now);
    return { ok: true, room, role: 'guest' };
  }

  public enqueueQuickMatch(params: {
    playerId: string;
    callsign: string;
    operative: OperativeId;
    now?: number;
  }): { room: MultiplayerRoomState; role: MultiplayerRole; matchedImmediately: boolean } {
    const now = params.now ?? Date.now();
    for (const room of this.rooms.values()) {
      if (
        room.isPublicQueue &&
        room.status === 'waiting' &&
        room.guest === null &&
        room.host.connected &&
        room.host.playerId !== params.playerId
      ) {
        const joined = this.joinRoomByCode({
          code: room.code,
          playerId: params.playerId,
          callsign: params.callsign,
          operative: params.operative,
          now,
        });
        if (joined.ok) {
          return { room: joined.room, role: joined.role, matchedImmediately: true };
        }
      }
    }

    const created = this.createRoom({
      playerId: params.playerId,
      callsign: params.callsign,
      operative: params.operative,
      isPublicQueue: true,
      now,
    });
    return { room: created, role: 'host', matchedImmediately: false };
  }

  public startMatchInRoom(room: MultiplayerRoomState, now = Date.now()): void {
    room.status = 'active';
    room.roundNumber = 1;
    room.hostScore = 0;
    room.guestScore = 0;
    room.roundWinner = null;
    room.matchWinner = null;
    room.killFeed = [];

    room.host.credits = STARTING_CREDITS;
    room.host.lossStreak = 0;
    room.host.weaponId = 'pistol';
    room.host.armor = 0;
    room.host.armorType = 'none';
    room.host.survivedLastRound = false;
    room.host.kills = 0;
    room.host.deaths = 0;

    if (room.guest) {
      room.guest.credits = STARTING_CREDITS;
      room.guest.lossStreak = 0;
      room.guest.weaponId = 'pistol';
      room.guest.armor = 0;
      room.guest.armorType = 'none';
      room.guest.survivedLastRound = false;
      room.guest.kills = 0;
      room.guest.deaths = 0;
    }

    this.setupRoundInRoom(room, true, now);
  }

  public setupRoundInRoom(
    room: MultiplayerRoomState,
    isFirstRound: boolean,
    now = Date.now()
  ): void {
    room.roundPhase = 'buy';
    room.phaseEndsAt = now + MP_BUY_DURATION_MS;
    room.roundWinner = null;
    room.announcement = `ROUND ${room.roundNumber} // BUY PHASE [B]`;

    const resetPlayerForRound = (p: MultiplayerPlayerState) => {
      const spawn = getSpawnForRole(p.role);
      p.x = spawn.x;
      p.y = spawn.y;
      p.z = spawn.z;
      p.vx = 0;
      p.vz = 0;
      p.yaw = spawn.yaw;
      p.pitch = 0;
      p.health = 100;
      p.isCrouching = false;
      p.isSliding = false;
      p.isReloading = false;
      if (isFirstRound || !p.survivedLastRound) {
        p.weaponId = 'pistol';
        p.armor = 0;
        p.armorType = 'none';
      }
    };

    resetPlayerForRound(room.host);
    if (room.guest) {
      resetPlayerForRound(room.guest);
    }
    room.updatedAt = now;
  }

  public updatePlayerTelemetry(
    code: string,
    role: MultiplayerRole,
    patch: Partial<
      Pick<
        MultiplayerPlayerState,
        | 'x'
        | 'y'
        | 'z'
        | 'vx'
        | 'vz'
        | 'yaw'
        | 'pitch'
        | 'weaponId'
        | 'armor'
        | 'armorType'
        | 'credits'
        | 'isCrouching'
        | 'isSliding'
        | 'isReloading'
        | 'pingMs'
      >
    >,
    now = Date.now()
  ): MultiplayerPlayerState | null {
    const room = this.getRoom(code);
    if (!room) return null;
    const player = role === 'host' ? room.host : room.guest;
    if (!player) return null;

    if (typeof patch.x === 'number' && Number.isFinite(patch.x)) {
      player.x = Math.max(-26.5, Math.min(26.5, patch.x));
    }
    if (typeof patch.y === 'number' && Number.isFinite(patch.y)) {
      player.y = Math.max(0, Math.min(8, patch.y));
    }
    if (typeof patch.z === 'number' && Number.isFinite(patch.z)) {
      player.z = Math.max(-24.5, Math.min(24.5, patch.z));
    }
    if (typeof patch.vx === 'number' && Number.isFinite(patch.vx)) player.vx = patch.vx;
    if (typeof patch.vz === 'number' && Number.isFinite(patch.vz)) player.vz = patch.vz;
    if (typeof patch.yaw === 'number' && Number.isFinite(patch.yaw)) player.yaw = patch.yaw;
    if (typeof patch.pitch === 'number' && Number.isFinite(patch.pitch)) player.pitch = patch.pitch;
    if (patch.weaponId && WEAPONS[patch.weaponId]) player.weaponId = patch.weaponId;
    if (patch.armorType && ARMOR_SPECS[patch.armorType]) {
      player.armorType = patch.armorType;
    }
    if (typeof patch.armor === 'number' && Number.isFinite(patch.armor)) {
      player.armor = Math.max(0, Math.min(50, patch.armor));
    }
    if (typeof patch.credits === 'number' && Number.isFinite(patch.credits)) {
      player.credits = Math.max(0, Math.min(9000, patch.credits));
    }
    if (typeof patch.isCrouching === 'boolean') player.isCrouching = patch.isCrouching;
    if (typeof patch.isSliding === 'boolean') player.isSliding = patch.isSliding;
    if (typeof patch.isReloading === 'boolean') player.isReloading = patch.isReloading;
    if (typeof patch.pingMs === 'number' && Number.isFinite(patch.pingMs)) {
      player.pingMs = Math.max(1, Math.min(999, Math.round(patch.pingMs)));
    }

    player.lastSeenAt = now;
    room.updatedAt = now;
    return player;
  }

  public applyHitDamage(params: {
    code: string;
    attackerRole: MultiplayerRole;
    weaponId: WeaponId;
    rawDamage: number;
    isHeadshot: boolean;
    distance: number;
    hitX: number;
    hitY: number;
    hitZ: number;
    now?: number;
  }): DamageResolutionEvent | null {
    const now = params.now ?? Date.now();
    const room = this.getRoom(params.code);
    if (!room || room.status !== 'active' || !room.guest) return null;
    if (room.roundPhase !== 'combat' && room.roundPhase !== 'buy') return null;

    // If a shot lands during late buy phase, transition immediately to combat
    if (room.roundPhase === 'buy') {
      room.roundPhase = 'combat';
      room.phaseEndsAt = now + MP_COMBAT_DURATION_MS;
    }

    const attacker = params.attackerRole === 'host' ? room.host : room.guest;
    const victimRole: MultiplayerRole = params.attackerRole === 'host' ? 'guest' : 'host';
    const victim = victimRole === 'host' ? room.host : room.guest;

    if (!attacker || !victim || attacker.health <= 0 || victim.health <= 0) {
      return null;
    }

    const spec = WEAPONS[params.weaponId] || WEAPONS.pistol;
    const dmgRes = calculateDamageWithArmor(
      params.rawDamage,
      victim.health,
      victim.armor,
      params.distance,
      spec.range,
      spec.falloffStart
    );

    victim.health = dmgRes.newHealth;
    victim.armor = dmgRes.newArmor;
    room.updatedAt = now;

    let roundEnded = false;
    let roundWinner: MultiplayerRole | null = null;
    let matchWinner: MultiplayerRole | null = null;

    if (dmgRes.eliminated) {
      attacker.kills += 1;
      victim.deaths += 1;
      roundEnded = true;
      roundWinner = params.attackerRole;

      const kfEntry: KillFeedEntry = {
        id: `mp_kf_${now}_${Math.random().toString(36).slice(2, 6)}`,
        killer: params.attackerRole === 'host' ? 'PLAYER' : 'AI',
        victim: params.attackerRole === 'host' ? 'AI' : 'PLAYER',
        weaponId: spec.id,
        weaponName: spec.name,
        isHeadshot: params.isHeadshot,
        timestamp: now,
      };
      room.killFeed = [kfEntry, ...room.killFeed].slice(0, 5);

      this.concludeRound(room, roundWinner, 'OPPONENT ELIMINATED', true, now);
      matchWinner = room.matchWinner;
    }

    return {
      attackerRole: params.attackerRole,
      victimRole,
      weaponId: spec.id,
      weaponName: spec.name,
      damageApplied: dmgRes.totalDamage,
      newHealth: victim.health,
      newArmor: victim.armor,
      isHeadshot: params.isHeadshot,
      eliminated: dmgRes.eliminated,
      hitX: params.hitX,
      hitY: params.hitY,
      hitZ: params.hitZ,
      roundEnded,
      roundWinner,
      matchWinner,
    };
  }

  public concludeRound(
    room: MultiplayerRoomState,
    winnerRole: MultiplayerRole,
    reason: string,
    gotKill: boolean,
    now = Date.now()
  ): void {
    if (room.roundPhase === 'round_end' || room.roundPhase === 'match_over') return;

    room.roundWinner = winnerRole;
    if (winnerRole === 'host') {
      room.hostScore += 1;
    } else {
      room.guestScore += 1;
    }

    room.host.survivedLastRound = room.host.health > 0;
    const hostEcon = calculateRoundEconomy(
      room.host.credits,
      winnerRole === 'host',
      room.host.lossStreak,
      winnerRole === 'host' && gotKill ? 1 : 0
    );
    room.host.credits = hostEcon.nextCredits;
    room.host.lossStreak = hostEcon.nextLossStreak;

    if (room.guest) {
      room.guest.survivedLastRound = room.guest.health > 0;
      const guestEcon = calculateRoundEconomy(
        room.guest.credits,
        winnerRole === 'guest',
        room.guest.lossStreak,
        winnerRole === 'guest' && gotKill ? 1 : 0
      );
      room.guest.credits = guestEcon.nextCredits;
      room.guest.lossStreak = guestEcon.nextLossStreak;
    }

    const winnerCallsign =
      winnerRole === 'host' ? room.host.callsign : room.guest?.callsign || 'CHALLENGER';

    const matchCheck = checkMatchVictory(room.hostScore, room.guestScore, room.targetRounds);
    if (matchCheck) {
      room.matchWinner = matchCheck === 'PLAYER' ? 'host' : 'guest';
      room.roundPhase = 'match_over';
      room.status = 'finished';
      room.announcement = `${winnerCallsign} WINS THE 1V1 MATCH // ${reason}`;
    } else {
      room.roundPhase = 'round_end';
      room.phaseEndsAt = now + MP_ROUND_END_DURATION_MS;
      room.announcement = `${winnerCallsign} WON ROUND ${room.roundNumber} // ${reason}`;
    }
    room.updatedAt = now;
  }

  public tickRooms(now = Date.now()): Array<{
    type: 'phase_changed' | 'round_started';
    room: MultiplayerRoomState;
  }> {
    const transitions: Array<{
      type: 'phase_changed' | 'round_started';
      room: MultiplayerRoomState;
    }> = [];

    for (const room of this.rooms.values()) {
      if (room.status !== 'active' || !room.guest) continue;

      if (room.roundPhase === 'buy' && now >= room.phaseEndsAt) {
        room.roundPhase = 'combat';
        room.phaseEndsAt = now + MP_COMBAT_DURATION_MS;
        room.announcement = 'COMBAT LIVE // ELIMINATE RIVAL OPERATIVE';
        room.updatedAt = now;
        transitions.push({ type: 'phase_changed', room });
      } else if (room.roundPhase === 'combat' && now >= room.phaseEndsAt) {
        const hostTotal = room.host.health + room.host.armor;
        const guestTotal = room.guest.health + room.guest.armor;
        const winner: MultiplayerRole = hostTotal >= guestTotal ? 'host' : 'guest';
        this.concludeRound(room, winner, 'TIME EXPIRED', false, now);
        transitions.push({ type: 'phase_changed', room });
      } else if (room.roundPhase === 'round_end' && now >= room.phaseEndsAt) {
        room.roundNumber += 1;
        this.setupRoundInRoom(room, false, now);
        transitions.push({ type: 'round_started', room });
      }
    }

    // Prune abandoned rooms older than 45 minutes
    for (const [code, room] of this.rooms.entries()) {
      if (now - room.updatedAt > 45 * 60 * 1000) {
        this.rooms.delete(code);
      }
    }

    return transitions;
  }
}
