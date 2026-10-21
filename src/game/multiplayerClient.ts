import {
  DamageResolutionEvent,
  isValidRoomCode,
  MultiplayerRole,
  MultiplayerRoomManager,
  MultiplayerRoomState,
  normalizeRoomCode,
} from './multiplayer.ts';
import { OperativeId, WeaponId } from './types.ts';
import { WEAPONS } from './weapons.ts';

export type TransportMode = 'server' | 'local-mesh';

export interface PublicRoomSummary {
  code: string;
  hostCallsign: string;
  hostOperative: OperativeId;
  createdAt: number;
}

const STORAGE_ROOMS_KEY = 'vanguard_mp_rooms_v1';
const STORAGE_EVENT_KEY = 'vanguard_mp_event_v1';
const BROADCAST_CHANNEL_NAME = 'vanguard_mp_channel_v1';

// Shared in-browser room authority for static-host fallback & cross-tab play
const localRoomManager = new MultiplayerRoomManager();
let lastDetectedTransportMode: TransportMode = 'server';

export function getDetectedTransportMode(): TransportMode {
  return lastDetectedTransportMode;
}

function hydrateLocalRoomsFromStorage(): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    const raw = window.localStorage.getItem(STORAGE_ROOMS_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      const now = Date.now();
      for (const item of parsed) {
        if (item && typeof item.code === 'string' && now - (item.updatedAt || 0) < 45 * 60 * 1000) {
          localRoomManager.upsertRoom(item as MultiplayerRoomState);
        }
      }
    }
  } catch {}
}

function persistLocalRoomsToStorage(): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    const rooms = localRoomManager.getAllRooms();
    window.localStorage.setItem(STORAGE_ROOMS_KEY, JSON.stringify(rooms));
  } catch {}
}

function emitBroadcastEvent(payload: Record<string, unknown>): void {
  if (typeof window === 'undefined') return;
  try {
    if (typeof BroadcastChannel !== 'undefined') {
      const bc = new BroadcastChannel(BROADCAST_CHANNEL_NAME);
      bc.postMessage(payload);
      bc.close();
    }
  } catch {}
  try {
    if (window.localStorage) {
      window.localStorage.setItem(
        STORAGE_EVENT_KEY,
        JSON.stringify({ ...payload, _nonce: Math.random(), _ts: Date.now() })
      );
    }
  } catch {}
}

function resolveApiUrl(path: string): string {
  const envBase =
    typeof import.meta !== 'undefined' &&
    import.meta.env &&
    typeof import.meta.env.VITE_MULTIPLAYER_SERVER_URL === 'string'
      ? import.meta.env.VITE_MULTIPLAYER_SERVER_URL.trim().replace(/\/+$/, '')
      : '';
  if (envBase) {
    return `${envBase}${path}`;
  }
  return path;
}

let serverApiAvailable: boolean | null = null;

export function resetServerApiAvailabilityForTesting(val: boolean | null = null): void {
  serverApiAvailable = val;
}

async function safeFetchJson<T = Record<string, unknown>>(
  path: string,
  init?: RequestInit,
  timeoutMs = 2500
): Promise<{ ok: true; status: number; data: T } | { ok: false; status: number; error: string }> {
  if (serverApiAvailable === false) {
    return { ok: false, status: 404, error: 'STATIC_HOST_NO_API' };
  }

  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer =
    controller && typeof window !== 'undefined'
      ? window.setTimeout(() => controller.abort(), timeoutMs)
      : null;

  try {
    const res = await fetch(resolveApiUrl(path), {
      ...init,
      signal: controller ? controller.signal : undefined,
    });
    const contentType = res.headers.get('content-type') || '';
    const text = await res.text();
    if (!contentType.includes('application/json') && text.trim().startsWith('<')) {
      // Static host returned HTML (e.g. SPA fallback index.html or 404/405 page)
      serverApiAvailable = false;
      return {
        ok: false,
        status: res.status || 404,
        error: 'STATIC_HOST_NO_API',
      };
    }
    const data = JSON.parse(text) as T;
    if (!res.ok) {
      if (res.status === 404 || res.status === 405) {
        serverApiAvailable = false;
      }
      const errField =
        data && typeof data === 'object' && 'error' in data && typeof data.error === 'string'
          ? data.error
          : `HTTP ${res.status}`;
      return { ok: false, status: res.status, error: errField };
    }
    serverApiAvailable = true;
    return { ok: true, status: res.status, data };
  } catch (err) {
    serverApiAvailable = false;
    return {
      ok: false,
      status: 0,
      error: err instanceof Error ? err.message : 'NETWORK_UNREACHABLE',
    };
  } finally {
    if (timer !== null && typeof window !== 'undefined') {
      window.clearTimeout(timer);
    }
  }
}

export async function fetchWaitingRoomsClient(): Promise<{
  waitingRooms: PublicRoomSummary[];
  transportMode: TransportMode;
}> {
  hydrateLocalRoomsFromStorage();
  const localWaiting = localRoomManager.listPublicWaitingRooms().map((r) => ({
    code: r.code,
    hostCallsign: r.host.callsign,
    hostOperative: r.host.operative,
    createdAt: r.createdAt,
  }));

  const resp = await safeFetchJson<{ ok?: boolean; waitingRooms?: PublicRoomSummary[] }>(
    '/api/multiplayer/rooms'
  );

  if (resp.ok && resp.data?.ok && Array.isArray(resp.data.waitingRooms)) {
    lastDetectedTransportMode = 'server';
    const mergedByCode = new Map<string, PublicRoomSummary>();
    for (const item of localWaiting) mergedByCode.set(item.code, item);
    for (const item of resp.data.waitingRooms) mergedByCode.set(item.code, item);
    return {
      waitingRooms: Array.from(mergedByCode.values()),
      transportMode: 'server',
    };
  }

  lastDetectedTransportMode = 'local-mesh';
  return {
    waitingRooms: localWaiting,
    transportMode: 'local-mesh',
  };
}

export async function getRoomByCodeClient(code: string): Promise<{
  ok: boolean;
  room?: MultiplayerRoomState;
  transportMode: TransportMode;
}> {
  const norm = normalizeRoomCode(code);
  hydrateLocalRoomsFromStorage();

  const resp = await safeFetchJson<{ ok?: boolean; room?: MultiplayerRoomState }>(
    `/api/multiplayer/room/${norm}`
  );
  if (resp.ok && resp.data?.ok && resp.data.room) {
    lastDetectedTransportMode = 'server';
    localRoomManager.upsertRoom(resp.data.room);
    persistLocalRoomsToStorage();
    return { ok: true, room: resp.data.room, transportMode: 'server' };
  }

  const localRoom = localRoomManager.getRoom(norm);
  if (localRoom) {
    return { ok: true, room: localRoom, transportMode: 'local-mesh' };
  }

  return { ok: false, transportMode: lastDetectedTransportMode };
}

export async function createRoomClient(params: {
  playerId: string;
  callsign: string;
  operative: OperativeId;
  isPublicQueue: boolean;
  preferredCode?: string;
}): Promise<{
  ok: true;
  room: MultiplayerRoomState;
  role: MultiplayerRole;
  transportMode: TransportMode;
}> {
  hydrateLocalRoomsFromStorage();

  const resp = await safeFetchJson<{
    ok?: boolean;
    room?: MultiplayerRoomState;
    role?: MultiplayerRole;
  }>('/api/multiplayer/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });

  if (resp.ok && resp.data?.ok && resp.data.room) {
    lastDetectedTransportMode = 'server';
    localRoomManager.upsertRoom(resp.data.room);
    persistLocalRoomsToStorage();
    emitBroadcastEvent({
      type: 'mp:room_sync',
      room: resp.data.room,
      serverTime: Date.now(),
    });
    return {
      ok: true,
      room: resp.data.room,
      role: resp.data.role || 'host',
      transportMode: 'server',
    };
  }

  // Automatic local/cross-tab relay fallback when hosted on static or serverless platforms
  lastDetectedTransportMode = 'local-mesh';
  const room = localRoomManager.createRoom({
    playerId: params.playerId,
    callsign: params.callsign,
    operative: params.operative,
    isPublicQueue: params.isPublicQueue,
    preferredCode: params.preferredCode,
  });
  persistLocalRoomsToStorage();
  emitBroadcastEvent({
    type: 'mp:room_sync',
    room,
    serverTime: Date.now(),
  });

  return {
    ok: true,
    room,
    role: 'host',
    transportMode: 'local-mesh',
  };
}

export async function joinRoomByCodeClient(params: {
  code: string;
  playerId: string;
  callsign: string;
  operative: OperativeId;
}): Promise<
  | {
      ok: true;
      room: MultiplayerRoomState;
      role: MultiplayerRole;
      transportMode: TransportMode;
    }
  | {
      ok: false;
      error: string;
    }
> {
  const norm = normalizeRoomCode(params.code);
  if (!isValidRoomCode(norm)) {
    return { ok: false, error: 'Enter a valid 6-character room code (e.g. 7K9X2M).' };
  }

  hydrateLocalRoomsFromStorage();

  const resp = await safeFetchJson<{
    ok?: boolean;
    room?: MultiplayerRoomState;
    role?: MultiplayerRole;
    error?: string;
  }>('/api/multiplayer/join', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...params, code: norm }),
  });

  if (resp.ok && resp.data?.ok && resp.data.room && resp.data.role) {
    lastDetectedTransportMode = 'server';
    localRoomManager.upsertRoom(resp.data.room);
    persistLocalRoomsToStorage();
    emitBroadcastEvent({
      type: 'mp:room_sync',
      room: resp.data.room,
      serverTime: Date.now(),
    });
    return {
      ok: true,
      room: resp.data.room,
      role: resp.data.role,
      transportMode: 'server',
    };
  }

  // Check local/cross-tab room registry
  const localJoin = localRoomManager.joinRoomByCode({
    code: norm,
    playerId: params.playerId,
    callsign: params.callsign,
    operative: params.operative,
  });

  if (localJoin.ok) {
    persistLocalRoomsToStorage();
    emitBroadcastEvent({
      type: 'mp:room_sync',
      room: localJoin.room,
      serverTime: Date.now(),
    });
    return {
      ok: true,
      room: localJoin.room,
      role: localJoin.role,
      transportMode: 'local-mesh',
    };
  }

  // If the backend returned a specific room validation error (e.g., room not found or full), surface it cleanly
  if (resp.status === 400 || resp.status === 404) {
    return {
      ok: false,
      error: resp.error !== 'STATIC_HOST_NO_API' ? resp.error : localJoin.error,
    };
  }

  return { ok: false, error: localJoin.error };
}

export async function quickMatchClient(params: {
  playerId: string;
  callsign: string;
  operative: OperativeId;
}): Promise<{
  ok: true;
  room: MultiplayerRoomState;
  role: MultiplayerRole;
  matchedImmediately: boolean;
  transportMode: TransportMode;
}> {
  hydrateLocalRoomsFromStorage();

  const resp = await safeFetchJson<{
    ok?: boolean;
    room?: MultiplayerRoomState;
    role?: MultiplayerRole;
    matchedImmediately?: boolean;
  }>('/api/multiplayer/quickmatch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });

  if (resp.ok && resp.data?.ok && resp.data.room && resp.data.role) {
    lastDetectedTransportMode = 'server';
    localRoomManager.upsertRoom(resp.data.room);
    persistLocalRoomsToStorage();
    emitBroadcastEvent({
      type: 'mp:room_sync',
      room: resp.data.room,
      serverTime: Date.now(),
    });
    return {
      ok: true,
      room: resp.data.room,
      role: resp.data.role,
      matchedImmediately: Boolean(resp.data.matchedImmediately),
      transportMode: 'server',
    };
  }

  // Automatic local/cross-tab fallback
  lastDetectedTransportMode = 'local-mesh';
  const result = localRoomManager.enqueueQuickMatch({
    playerId: params.playerId,
    callsign: params.callsign,
    operative: params.operative,
  });
  persistLocalRoomsToStorage();
  emitBroadcastEvent({
    type: 'mp:room_sync',
    room: result.room,
    serverTime: Date.now(),
  });

  return {
    ok: true,
    room: result.room,
    role: result.role,
    matchedImmediately: result.matchedImmediately,
    transportMode: 'local-mesh',
  };
}

export async function fillWithSimulatedChallengerClient(
  code: string,
  hostOperative: OperativeId
): Promise<MultiplayerRoomState | null> {
  const norm = normalizeRoomCode(code);
  hydrateLocalRoomsFromStorage();

  const simOperative: OperativeId =
    hostOperative === 'vex' ? 'nyx' : hostOperative === 'nyx' ? 'kai' : 'vex';
  const simPlayerId = `sim_challenger_${norm}`;
  const simCallsign = 'PHANTOM-X9';

  const joined = await joinRoomByCodeClient({
    code: norm,
    playerId: simPlayerId,
    callsign: simCallsign,
    operative: simOperative,
  });

  if (joined.ok) {
    return joined.room;
  }
  return null;
}

export interface MultiplayerConnectionHandle {
  send: (payload: Record<string, unknown>) => void;
  close: () => void;
}

export function createMultiplayerConnection(options: {
  code: string;
  role: MultiplayerRole;
  playerId: string;
  onMessage: (msg: Record<string, unknown>) => void;
}): MultiplayerConnectionHandle {
  const code = normalizeRoomCode(options.code);
  const { role, playerId, onMessage } = options;

  let closed = false;
  let ws: WebSocket | null = null;
  let wsOpen = false;
  let bc: BroadcastChannel | null = null;
  let pingTimer: number | null = null;
  let authorityTickTimer: number | null = null;
  let httpPollTimer: number | null = null;
  let reconnectTimer: number | null = null;

  hydrateLocalRoomsFromStorage();

  const deliver = (msg: Record<string, unknown>) => {
    if (closed) return;
    try {
      onMessage(msg);
    } catch {}
  };

  // 1. Setup Cross-Tab BroadcastChannel + Storage Event Listener
  if (typeof window !== 'undefined' && typeof BroadcastChannel !== 'undefined') {
    try {
      bc = new BroadcastChannel(BROADCAST_CHANNEL_NAME);
      bc.onmessage = (ev) => {
        if (closed || !ev.data || typeof ev.data !== 'object') return;
        const msg = ev.data as Record<string, unknown>;
        if (msg.room && typeof (msg.room as MultiplayerRoomState).code === 'string') {
          const r = msg.room as MultiplayerRoomState;
          if (normalizeRoomCode(r.code) === code) {
            localRoomManager.upsertRoom(r);
            deliver(msg);
          }
          return;
        }
        if (msg.code && normalizeRoomCode(String(msg.code)) !== code) return;
        deliver(msg);
      };
    } catch {}
  }

  const onStorageEvent = (ev: StorageEvent) => {
    if (closed) return;
    if (ev.key === STORAGE_ROOMS_KEY) {
      hydrateLocalRoomsFromStorage();
      const updated = localRoomManager.getRoom(code);
      if (updated) {
        deliver({ type: 'mp:room_sync', room: updated, serverTime: Date.now() });
      }
    } else if (ev.key === STORAGE_EVENT_KEY && ev.newValue) {
      try {
        const msg = JSON.parse(ev.newValue) as Record<string, unknown>;
        if (msg.code && normalizeRoomCode(String(msg.code)) !== code) return;
        deliver(msg);
      } catch {}
    }
  };

  if (typeof window !== 'undefined') {
    window.addEventListener('storage', onStorageEvent);
  }

  // Process outbound message in local/mesh room manager (used when WS is not open or for instant cross-tab sync)
  const processMessageLocally = (payload: Record<string, unknown>) => {
    hydrateLocalRoomsFromStorage();
    const type = String(payload.type || '');

    if (type === 'mp:ping') {
      deliver({
        type: 'mp:pong',
        clientSentAt: payload.clientSentAt,
        serverTime: Date.now(),
      });
      return;
    }

    if (type === 'mp:state') {
      const updated = localRoomManager.updatePlayerTelemetry(code, role, {
        x: payload.x as number,
        y: payload.y as number,
        z: payload.z as number,
        vx: payload.vx as number,
        vz: payload.vz as number,
        yaw: payload.yaw as number,
        pitch: payload.pitch as number,
        weaponId: payload.weaponId as WeaponId,
        armor: payload.armor as number,
        armorType: payload.armorType as 'none' | 'light' | 'heavy',
        credits: payload.credits as number,
        isCrouching: Boolean(payload.isCrouching),
        isSliding: Boolean(payload.isSliding),
        isReloading: Boolean(payload.isReloading),
      });
      if (updated) {
        persistLocalRoomsToStorage();
        emitBroadcastEvent({
          type: 'mp:remote_state',
          code,
          role,
          player: updated,
          serverTime: Date.now(),
        });
      }
      return;
    }

    if (type === 'mp:shoot') {
      emitBroadcastEvent({
        type: 'mp:remote_shoot',
        code,
        role,
        weaponId: payload.weaponId,
        originX: payload.originX,
        originY: payload.originY,
        originZ: payload.originZ,
        endX: payload.endX,
        endY: payload.endY,
        endZ: payload.endZ,
      });
      return;
    }

    if (type === 'mp:hit') {
      const dmgEvent: DamageResolutionEvent | null = localRoomManager.applyHitDamage({
        code,
        attackerRole: role,
        weaponId: (payload.weaponId as WeaponId) || 'pistol',
        rawDamage: Number(payload.rawDamage) || 26,
        isHeadshot: Boolean(payload.isHeadshot),
        distance: Number(payload.distance) || 10,
        hitX: Number(payload.hitX) || 0,
        hitY: Number(payload.hitY) || 1,
        hitZ: Number(payload.hitZ) || 0,
      });
      const room = localRoomManager.getRoom(code);
      if (dmgEvent && room) {
        persistLocalRoomsToStorage();
        const dmgMsg = {
          type: 'mp:damage',
          code,
          event: dmgEvent,
          room,
          serverTime: Date.now(),
        };
        deliver(dmgMsg);
        emitBroadcastEvent(dmgMsg);
      }
      return;
    }

    if (type === 'mp:deploy_now') {
      const room = localRoomManager.getRoom(code);
      if (room && room.roundPhase === 'buy') {
        room.roundPhase = 'combat';
        room.phaseEndsAt = Date.now() + 95_000;
        room.announcement = 'COMBAT LIVE // ELIMINATE RIVAL OPERATIVE';
        room.updatedAt = Date.now();
        persistLocalRoomsToStorage();
        const syncMsg = { type: 'mp:room_sync', code, room, serverTime: Date.now() };
        deliver(syncMsg);
        emitBroadcastEvent(syncMsg);
      }
      return;
    }

    if (type === 'mp:rematch') {
      const room = localRoomManager.getRoom(code);
      if (room) {
        localRoomManager.startMatchInRoom(room, Date.now());
        persistLocalRoomsToStorage();
        const syncMsg = { type: 'mp:room_sync', code, room, serverTime: Date.now() };
        deliver(syncMsg);
        emitBroadcastEvent(syncMsg);
      }
      return;
    }
  };

  // 2. Connect WebSocket to Backend Server (when available)
  const connectWs = () => {
    if (closed || typeof window === 'undefined' || typeof WebSocket === 'undefined') return;
    try {
      const envBase =
        typeof import.meta !== 'undefined' &&
        import.meta.env &&
        typeof import.meta.env.VITE_MULTIPLAYER_SERVER_URL === 'string'
          ? import.meta.env.VITE_MULTIPLAYER_SERVER_URL.trim().replace(/\/+$/, '')
          : '';

      let wsUrl: string;
      if (envBase) {
        wsUrl = envBase.replace(/^http/, 'ws') + '/ws/match';
      } else {
        const wsProto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        wsUrl = `${wsProto}//${window.location.host}/ws/match`;
      }

      const socket = new WebSocket(wsUrl);
      ws = socket;

      socket.onopen = () => {
        if (closed) {
          socket.close();
          return;
        }
        wsOpen = true;
        lastDetectedTransportMode = 'server';
        socket.send(
          JSON.stringify({
            type: 'mp:join_socket',
            code,
            role,
            playerId,
          })
        );
      };

      socket.onmessage = (ev) => {
        if (closed) return;
        try {
          const msg = JSON.parse(String(ev.data)) as Record<string, unknown>;
          if (!msg || typeof msg.type !== 'string') return;
          if (msg.room) {
            localRoomManager.upsertRoom(msg.room as MultiplayerRoomState);
            persistLocalRoomsToStorage();
          }
          deliver(msg);
        } catch {}
      };

      socket.onerror = () => {
        wsOpen = false;
      };

      socket.onclose = () => {
        wsOpen = false;
        if (!closed && lastDetectedTransportMode === 'server') {
          reconnectTimer = window.setTimeout(connectWs, 2500);
        }
      };
    } catch {
      wsOpen = false;
    }
  };

  connectWs();

  // 3. Emit initial room sync immediately from local cache so HUD is populated without waiting
  const initialRoom = localRoomManager.getRoom(code);
  if (initialRoom) {
    window.setTimeout(() => {
      if (!closed) {
        deliver({ type: 'mp:room_sync', room: initialRoom, serverTime: Date.now() });
      }
    }, 20);
  }

  // 4. Ping & Local Authority Timer Loop (ticks round phase transitions and simulated challenger if active)
  pingTimer = window.setInterval(() => {
    if (closed) return;
    if (ws && wsOpen && ws.readyState === WebSocket.OPEN) {
      ws.send(
        JSON.stringify({
          type: 'mp:ping',
          clientSentAt: Date.now(),
        })
      );
    } else {
      deliver({
        type: 'mp:pong',
        clientSentAt: Date.now() - 8,
        serverTime: Date.now(),
      });
    }
  }, 2000);

  let simBotShotCooldown = 0;

  authorityTickTimer = window.setInterval(() => {
    if (closed) return;
    // If WebSocket is not open, run authoritative room phase transitions locally
    if (!wsOpen) {
      hydrateLocalRoomsFromStorage();
      const transitions = localRoomManager.tickRooms(Date.now());
      for (const tr of transitions) {
        if (normalizeRoomCode(tr.room.code) === code) {
          persistLocalRoomsToStorage();
          const syncMsg = {
            type: 'mp:room_sync',
            code,
            room: tr.room,
            serverTime: Date.now(),
          };
          deliver(syncMsg);
          emitBroadcastEvent(syncMsg);
        }
      }
    }

    // If the room has a simulated online challenger (`sim_challenger_`), drive its live 1v1 movement & combat
    const room = localRoomManager.getRoom(code);
    if (
      room &&
      room.status === 'active' &&
      room.guest &&
      room.guest.playerId.startsWith('sim_challenger_') &&
      role === 'host'
    ) {
      const now = Date.now();
      const tSec = now / 1000;
      const guest = room.guest;
      const host = room.host;

      if (guest.health > 0 && (room.roundPhase === 'combat' || room.roundPhase === 'buy')) {
        const weaponChoice: WeaponId =
          room.roundNumber >= 3 ? 'rifle' : room.roundNumber === 2 ? 'smg' : 'pistol';
        const targetZ = room.roundPhase === 'buy' ? -16.5 : -4.5 + Math.cos(tSec * 0.9) * 4.5;
        const targetX = Math.sin(tSec * 1.45) * 6.2;
        const nextX = guest.x + (targetX - guest.x) * 0.18;
        const nextZ = guest.z + (targetZ - guest.z) * 0.14;
        const dx = host.x - nextX;
        const dz = host.z - nextZ;
        const aimYaw = Math.atan2(-dx, -dz);

        const updatedGuest = localRoomManager.updatePlayerTelemetry(
          code,
          'guest',
          {
            x: nextX,
            y: 0,
            z: nextZ,
            vx: (targetX - guest.x) * 2.2,
            vz: (targetZ - guest.z) * 2.2,
            yaw: aimYaw,
            pitch: 0,
            weaponId: weaponChoice,
            armor: room.roundNumber >= 2 ? 25 : 0,
            armorType: room.roundNumber >= 2 ? 'light' : 'none',
          },
          now
        );

        if (updatedGuest) {
          deliver({
            type: 'mp:remote_state',
            role: 'guest',
            player: updatedGuest,
            serverTime: now,
          });
        }

        // Simulated challenger fires periodically during combat when within range
        simBotShotCooldown = Math.max(0, simBotShotCooldown - 0.2);
        const dist = Math.hypot(dx, dz);
        if (room.roundPhase === 'combat' && host.health > 0 && dist < 34 && simBotShotCooldown <= 0) {
          simBotShotCooldown = 1.35;
          deliver({
            type: 'mp:remote_shoot',
            role: 'guest',
            weaponId: weaponChoice,
            originX: nextX,
            originY: 1.4,
            originZ: nextZ,
            endX: host.x + (Math.random() - 0.5) * 1.4,
            endY: 1.3,
            endZ: host.z + (Math.random() - 0.5) * 1.4,
          });

          // 28% hit probability when unobstructed in mid-range
          if (Math.random() < 0.28) {
            const spec = WEAPONS[weaponChoice];
            if (ws && wsOpen && ws.readyState === WebSocket.OPEN) {
              // If connected to server, let local sim or server resolve
            }
            const dmgEv = localRoomManager.applyHitDamage({
              code,
              attackerRole: 'guest',
              weaponId: weaponChoice,
              rawDamage: spec.bodyDamage,
              isHeadshot: false,
              distance: dist,
              hitX: host.x,
              hitY: 1.25,
              hitZ: host.z,
              now,
            });
            const updatedRoom = localRoomManager.getRoom(code);
            if (dmgEv && updatedRoom) {
              persistLocalRoomsToStorage();
              deliver({
                type: 'mp:damage',
                event: dmgEv,
                room: updatedRoom,
                serverTime: now,
              });
            }
          }
        }
      }
    }
  }, 200);

  // 5. HTTP Poll Fallback when server REST API is active but WebSocket upgrade was blocked
  httpPollTimer = window.setInterval(async () => {
    if (closed || wsOpen || lastDetectedTransportMode !== 'server') return;
    const res = await safeFetchJson<{ ok?: boolean; room?: MultiplayerRoomState; serverTime?: number }>(
      `/api/multiplayer/room/${code}`
    );
    if (res.ok && res.data?.ok && res.data.room) {
      const r = res.data.room;
      localRoomManager.upsertRoom(r);
      deliver({
        type: 'mp:room_sync',
        room: r,
        serverTime: res.data.serverTime || Date.now(),
      });
      const opp = role === 'host' ? r.guest : r.host;
      if (opp) {
        deliver({
          type: 'mp:remote_state',
          role: role === 'host' ? 'guest' : 'host',
          player: opp,
          serverTime: res.data.serverTime || Date.now(),
        });
      }
    }
  }, 350);

  return {
    send: (payload: Record<string, unknown>) => {
      if (closed) return;
      if (ws && wsOpen && ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(JSON.stringify(payload));
        } catch {}
      } else if (lastDetectedTransportMode === 'server') {
        // Send over HTTP fallback endpoint AND local broadcast
        safeFetchJson('/api/multiplayer/event', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...payload, code, role, playerId }),
        }).then((res) => {
          if (res.ok && res.data && typeof res.data === 'object') {
            const d = res.data as Record<string, unknown>;
            if (d.event && d.room) {
              deliver({
                type: 'mp:damage',
                event: d.event,
                room: d.room,
                serverTime: d.serverTime || Date.now(),
              });
            } else if (d.room) {
              deliver({
                type: 'mp:room_sync',
                room: d.room,
                serverTime: d.serverTime || Date.now(),
              });
            }
          }
        });
      }
      // Always mirror to local/cross-tab manager so cross-tab play and static hosts stay in sync
      processMessageLocally(payload);
    },
    close: () => {
      closed = true;
      if (pingTimer !== null) window.clearInterval(pingTimer);
      if (authorityTickTimer !== null) window.clearInterval(authorityTickTimer);
      if (httpPollTimer !== null) window.clearInterval(httpPollTimer);
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
      if (typeof window !== 'undefined') {
        window.removeEventListener('storage', onStorageEvent);
      }
      if (bc) {
        try {
          bc.close();
        } catch {}
        bc = null;
      }
      if (ws) {
        try {
          ws.onclose = null;
          ws.close();
        } catch {}
        ws = null;
      }
    },
  };
}
