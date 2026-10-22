import {
  DamageResolutionEvent,
  isValidRoomCode,
  MultiplayerRole,
  MultiplayerRoomManager,
  MultiplayerRoomState,
  normalizeRoomCode,
} from './multiplayer.ts';
import { OperativeId, WeaponId } from './types.ts';
import {
  closeAllOtherWebRtcChannels,
  discoverWebRtcPublicRooms,
  getActiveWebRtcChannel,
  isWebRtcSupported,
  joinWebRtcHost,
  startWebRtcHost,
  WebRtcChannelHandle,
} from './webrtcMesh.ts';
import { WEAPONS } from './weapons.ts';

export type TransportMode = 'server' | 'webrtc' | 'local-mesh';

export interface PublicRoomSummary {
  code: string;
  hostCallsign: string;
  hostOperative: OperativeId;
  createdAt: number;
}

const STORAGE_ROOMS_KEY = 'vanguard_mp_rooms_v1';
const STORAGE_EVENT_KEY = 'vanguard_mp_event_v1';
const STORAGE_CUSTOM_SERVER_KEY = 'vanguard_custom_server_url';
const BROADCAST_CHANNEL_NAME = 'vanguard_mp_channel_v1';

// Shared in-browser room authority for static-host fallback & cross-tab play
const localRoomManager = new MultiplayerRoomManager();
let lastDetectedTransportMode: TransportMode = isWebRtcSupported() ? 'webrtc' : 'server';

// In-memory pub/sub listener set for zero-latency same-tab updates
type LocalEventListener = (event: Record<string, unknown>) => void;
const localEventListeners = new Set<LocalEventListener>();

export function subscribeLocalMultiplayerEvents(listener: LocalEventListener): () => void {
  localEventListeners.add(listener);
  return () => {
    localEventListeners.delete(listener);
  };
}

export function getDetectedTransportMode(): TransportMode {
  return lastDetectedTransportMode;
}

export function getCustomServerUrl(): string {
  if (typeof window === 'undefined' || !window.localStorage) return '';
  return window.localStorage.getItem(STORAGE_CUSTOM_SERVER_KEY) || '';
}

export function setCustomServerUrl(url: string): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  const clean = url.trim().replace(/\/+$/, '');
  if (clean) {
    window.localStorage.setItem(STORAGE_CUSTOM_SERVER_KEY, clean);
  } else {
    window.localStorage.removeItem(STORAGE_CUSTOM_SERVER_KEY);
  }
}

export function isVercelHost(): boolean {
  if (typeof window === 'undefined') return false;
  return window.location.hostname.includes('vercel.app');
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

/**
 * Distribute an event across local components, tabs, and optional storage listeners.
 * CRITICAL: To prevent 22Hz disk-thrashing and storage event storms, high-frequency
 * telemetry events (mp:state, mp:ping) are NEVER written to localStorage.
 */
function emitBroadcastEvent(payload: Record<string, unknown>, writeToLocalStorage = false): void {
  // 1. Same-process in-memory listeners
  for (const listener of localEventListeners) {
    try {
      listener(payload);
    } catch {}
  }

  if (typeof window === 'undefined') return;

  // 2. Cross-tab BroadcastChannel
  try {
    if (typeof BroadcastChannel !== 'undefined') {
      const bc = new BroadcastChannel(BROADCAST_CHANNEL_NAME);
      bc.postMessage(payload);
      bc.close();
    }
  } catch {}

  // 3. Fallback localStorage event trigger ONLY for structural room events
  if (writeToLocalStorage) {
    try {
      if (window.localStorage) {
        window.localStorage.setItem(
          STORAGE_EVENT_KEY,
          JSON.stringify({ ...payload, _nonce: Math.random(), _ts: Date.now() })
        );
      }
    } catch {}
  }
}

function resolveApiUrl(path: string): string {
  const custom = getCustomServerUrl();
  if (custom) {
    return `${custom}${path}`;
  }
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
      if (res.status === 405) {
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

/**
 * Ensures a hosted room has an active WebRTC P2P listener and public lobby beacon registered.
 */
export function ensureHostRoomPublished(room: MultiplayerRoomState): WebRtcChannelHandle | null {
  if (!isWebRtcSupported()) return null;
  const code = normalizeRoomCode(room.code);
  const existing = getActiveWebRtcChannel(code);
  if (existing && existing.role === 'host' && !existing.isClosed()) {
    return existing;
  }

  try {
    const handle = startWebRtcHost({
      roomCode: code,
      isPublicQueue: room.isPublicQueue,
      getPublicSummary: () => {
        const current = localRoomManager.getRoom(code) || room;
        if (!current || current.guest !== null || current.status !== 'waiting') {
          return null;
        }
        return {
          code: current.code,
          hostCallsign: current.host.callsign,
          hostOperative: current.host.operative,
          createdAt: current.createdAt,
        };
      },
      onGuestJoinRequest: (req) => {
        hydrateLocalRoomsFromStorage();
        if (!localRoomManager.getRoom(code)) {
          localRoomManager.upsertRoom(room);
        }
        const joinRes = localRoomManager.joinRoomByCode({
          code,
          playerId: req.playerId,
          callsign: req.callsign,
          operative: req.operative,
        });
        if (joinRes.ok) {
          persistLocalRoomsToStorage();
          emitBroadcastEvent(
            {
              type: 'mp:room_sync',
              room: joinRes.room,
              serverTime: Date.now(),
            },
            true
          );
          return { ok: true, room: joinRes.room };
        }
        return { ok: false, error: joinRes.error };
      },
      onMessage: (msg) => {
        emitBroadcastEvent(msg, msg.type === 'mp:room_sync' || msg.type === 'mp:damage');
      },
    });
    if (lastDetectedTransportMode === 'local-mesh') {
      lastDetectedTransportMode = 'webrtc';
    }
    return handle;
  } catch {
    return null;
  }
}

export async function fetchWaitingRoomsClient(includeBeaconScan = false): Promise<{
  waitingRooms: PublicRoomSummary[];
  transportMode: TransportMode;
}> {
  hydrateLocalRoomsFromStorage();
  const mergedByCode = new Map<string, PublicRoomSummary>();

  for (const r of localRoomManager.listPublicWaitingRooms()) {
    mergedByCode.set(r.code, {
      code: r.code,
      hostCallsign: r.host.callsign,
      hostOperative: r.host.operative,
      createdAt: r.createdAt,
    });
  }

  const resp = await safeFetchJson<{ ok?: boolean; waitingRooms?: PublicRoomSummary[] }>(
    '/api/multiplayer/rooms'
  );

  if (resp.ok && resp.data?.ok && Array.isArray(resp.data.waitingRooms)) {
    if (!isVercelHost()) {
      lastDetectedTransportMode = 'server';
    } else if (isWebRtcSupported()) {
      lastDetectedTransportMode = 'webrtc';
    }
    for (const item of resp.data.waitingRooms) {
      mergedByCode.set(normalizeRoomCode(item.code), item);
    }
  } else {
    lastDetectedTransportMode = isWebRtcSupported() ? 'webrtc' : 'local-mesh';
  }

  if ((includeBeaconScan || isVercelHost() || !resp.ok) && isWebRtcSupported()) {
    try {
      const beaconRooms = await discoverWebRtcPublicRooms(1400);
      for (const b of beaconRooms) {
        mergedByCode.set(normalizeRoomCode(b.code), b);
      }
    } catch {}
  }

  return {
    waitingRooms: Array.from(mergedByCode.values()),
    transportMode: lastDetectedTransportMode,
  };
}

export async function getRoomByCodeClient(code: string): Promise<{
  ok: boolean;
  room?: MultiplayerRoomState;
  transportMode: TransportMode;
}> {
  const norm = normalizeRoomCode(code);
  hydrateLocalRoomsFromStorage();

  // Check local room first if guest already joined via WebRTC callback
  const localRoom = localRoomManager.getRoom(norm);
  if (localRoom && localRoom.guest) {
    return {
      ok: true,
      room: localRoom,
      transportMode: lastDetectedTransportMode,
    };
  }

  const resp = await safeFetchJson<{ ok?: boolean; room?: MultiplayerRoomState }>(
    `/api/multiplayer/room/${norm}`
  );
  if (resp.ok && resp.data?.ok && resp.data.room) {
    localRoomManager.upsertRoom(resp.data.room);
    persistLocalRoomsToStorage();
    return { ok: true, room: resp.data.room, transportMode: lastDetectedTransportMode };
  }

  if (localRoom) {
    return { ok: true, room: localRoom, transportMode: lastDetectedTransportMode };
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

  // 1. Create room in local authority
  let room = localRoomManager.createRoom({
    playerId: params.playerId,
    callsign: params.callsign,
    operative: params.operative,
    isPublicQueue: params.isPublicQueue,
    preferredCode: params.preferredCode,
  });
  persistLocalRoomsToStorage();

  // Close any obsolete WebRTC channels for other codes
  closeAllOtherWebRtcChannels(room.code);

  // 2. Also register room with backend / Vercel serverless API if available
  try {
    const resp = await safeFetchJson<{
      ok?: boolean;
      room?: MultiplayerRoomState;
      role?: MultiplayerRole;
    }>('/api/multiplayer/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...params, preferredCode: room.code }),
    });

    if (resp.ok && resp.data?.ok && resp.data.room) {
      room = localRoomManager.upsertRoom(resp.data.room);
      persistLocalRoomsToStorage();
      lastDetectedTransportMode = isVercelHost() && isWebRtcSupported() ? 'webrtc' : 'server';
    } else {
      lastDetectedTransportMode = isWebRtcSupported() ? 'webrtc' : 'local-mesh';
    }
  } catch {
    lastDetectedTransportMode = isWebRtcSupported() ? 'webrtc' : 'local-mesh';
  }

  // 3. Always publish WebRTC P2P Host listener for this room code and wait until signaling is ready
  const rtcHandle = ensureHostRoomPublished(room);
  if (rtcHandle) {
    await rtcHandle.waitUntilReady(2400);
    if (isVercelHost() || serverApiAvailable === false) {
      lastDetectedTransportMode = 'webrtc';
    }
  } else if (serverApiAvailable === false) {
    lastDetectedTransportMode = isWebRtcSupported() ? 'webrtc' : 'local-mesh';
  }

  emitBroadcastEvent(
    {
      type: 'mp:room_sync',
      room,
      serverTime: Date.now(),
    },
    true
  );

  return {
    ok: true,
    room,
    role: 'host',
    transportMode: lastDetectedTransportMode,
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

  // 1. Check cross-tab / local room registry first (instant for same-browser testing)
  const localRoom = localRoomManager.getRoom(norm);
  if (
    localRoom &&
    (localRoom.guest === null ||
      localRoom.guest.playerId === params.playerId ||
      localRoom.host.playerId === params.playerId)
  ) {
    const localJoin = localRoomManager.joinRoomByCode({
      code: norm,
      playerId: params.playerId,
      callsign: params.callsign,
      operative: params.operative,
    });
    if (localJoin.ok) {
      persistLocalRoomsToStorage();
      emitBroadcastEvent(
        {
          type: 'mp:room_sync',
          room: localJoin.room,
          serverTime: Date.now(),
        },
        true
      );
      // Also notify server if available in background
      safeFetchJson('/api/multiplayer/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...params, code: norm }),
      }).catch(() => {});
      return {
        ok: true,
        room: localJoin.room,
        role: localJoin.role,
        transportMode: lastDetectedTransportMode,
      };
    }
  }

  // 2. Prioritize direct WebRTC P2P connection when WebRTC is supported
  // This handshakes directly with the host browser, exchanging live room state without server race conditions
  let webrtcError: string | null = null;
  if (isWebRtcSupported()) {
    try {
      const webrtcJoin = await joinWebRtcHost({
        roomCode: norm,
        playerId: params.playerId,
        callsign: params.callsign,
        operative: params.operative,
        onMessage: (msg) => {
          emitBroadcastEvent(msg, msg.type === 'mp:room_sync' || msg.type === 'mp:damage');
        },
        timeoutMs: 6500,
      });

      if (webrtcJoin.ok) {
        lastDetectedTransportMode = 'webrtc';
        localRoomManager.upsertRoom(webrtcJoin.room);
        persistLocalRoomsToStorage();
        emitBroadcastEvent(
          {
            type: 'mp:room_sync',
            room: webrtcJoin.room,
            serverTime: Date.now(),
          },
          true
        );

        // Notify server backend asynchronously in the background so REST room query stays aligned
        safeFetchJson('/api/multiplayer/join', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...params, code: norm }),
        }).catch(() => {});

        return {
          ok: true,
          room: webrtcJoin.room,
          role: webrtcJoin.role,
          transportMode: 'webrtc',
        };
      } else {
        webrtcError = webrtcJoin.error;
      }
    } catch (e) {
      webrtcError = e instanceof Error ? e.message : null;
    }
  }

  // 3. Fallback to server REST API join if WebRTC was not supported or failed
  let serverRoomResult: { room: MultiplayerRoomState; role: MultiplayerRole } | null = null;
  let explicitError: string | null = null;

  try {
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
      serverRoomResult = {
        room: resp.data.room,
        role: resp.data.role,
      };
    } else if (!resp.ok && resp.status === 400 && resp.error && !resp.error.toLowerCase().includes('not found')) {
      explicitError = resp.error;
    }
  } catch {}

  if (serverRoomResult) {
    lastDetectedTransportMode = 'server';
    localRoomManager.upsertRoom(serverRoomResult.room);
    persistLocalRoomsToStorage();
    emitBroadcastEvent(
      {
        type: 'mp:room_sync',
        room: serverRoomResult.room,
        serverTime: Date.now(),
      },
      true
    );
    return {
      ok: true,
      room: serverRoomResult.room,
      role: serverRoomResult.role,
      transportMode: 'server',
    };
  }

  if (explicitError) {
    return { ok: false, error: explicitError };
  }

  return {
    ok: false,
    error:
      webrtcError ||
      `Room ${norm} not found. Ensure the host has created room ${norm} and is waiting in the lobby.`,
  };
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

  // 1. First check if there is an open public room on WebRTC beacons (especially on Vercel)
  if (isWebRtcSupported()) {
    try {
      const beaconRooms = await discoverWebRtcPublicRooms(1500);
      for (const b of beaconRooms) {
        const joined = await joinRoomByCodeClient({
          code: b.code,
          playerId: params.playerId,
          callsign: params.callsign,
          operative: params.operative,
        });
        if (joined.ok) {
          return {
            ok: true,
            room: joined.room,
            role: joined.role,
            matchedImmediately: true,
            transportMode: joined.transportMode,
          };
        }
      }
    } catch {}
  }

  // 2. Try server / serverless quickmatch endpoint
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
    const room = localRoomManager.upsertRoom(resp.data.room);
    persistLocalRoomsToStorage();

    // Always also publish WebRTC Host listener if we are the waiting host!
    if (resp.data.role === 'host' && !room.guest) {
      const rtcHandle = ensureHostRoomPublished(room);
      if (rtcHandle) {
        await rtcHandle.waitUntilReady(2200);
      }
    } else if (resp.data.role === 'guest' && isVercelHost() && isWebRtcSupported()) {
      // Connect WebRTC guest channel to the matched room
      await joinWebRtcHost({
        roomCode: room.code,
        playerId: params.playerId,
        callsign: params.callsign,
        operative: params.operative,
        onMessage: (msg) => emitBroadcastEvent(msg, msg.type === 'mp:room_sync' || msg.type === 'mp:damage'),
        timeoutMs: 4000,
      }).catch(() => {});
    }

    lastDetectedTransportMode = isVercelHost() && isWebRtcSupported() ? 'webrtc' : 'server';
    emitBroadcastEvent(
      {
        type: 'mp:room_sync',
        room,
        serverTime: Date.now(),
      },
      true
    );
    return {
      ok: true,
      room,
      role: resp.data.role,
      matchedImmediately: Boolean(resp.data.matchedImmediately),
      transportMode: lastDetectedTransportMode,
    };
  }

  // 3. Local / WebRTC P2P Quick-Match Queue
  const result = localRoomManager.enqueueQuickMatch({
    playerId: params.playerId,
    callsign: params.callsign,
    operative: params.operative,
  });
  persistLocalRoomsToStorage();

  if (result.role === 'host') {
    const rtcHandle = ensureHostRoomPublished(result.room);
    if (rtcHandle) {
      await rtcHandle.waitUntilReady(2200);
    }
  }

  lastDetectedTransportMode = isWebRtcSupported() ? 'webrtc' : 'local-mesh';
  emitBroadcastEvent(
    {
      type: 'mp:room_sync',
      room: result.room,
      serverTime: Date.now(),
    },
    true
  );

  return {
    ok: true,
    room: result.room,
    role: result.role,
    matchedImmediately: result.matchedImmediately,
    transportMode: lastDetectedTransportMode,
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

  const localJoin = localRoomManager.joinRoomByCode({
    code: norm,
    playerId: simPlayerId,
    callsign: simCallsign,
    operative: simOperative,
  });

  if (localJoin.ok) {
    persistLocalRoomsToStorage();
    emitBroadcastEvent(
      {
        type: 'mp:room_sync',
        room: localJoin.room,
        serverTime: Date.now(),
      },
      true
    );
    return localJoin.room;
  }

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

export function leaveMultiplayerRoomClient(code: string, playerId?: string): void {
  const norm = normalizeRoomCode(code);
  const activeRtc = getActiveWebRtcChannel(norm);
  if (activeRtc) {
    try {
      activeRtc.send({ type: 'mp:player_left', code: norm, playerId });
    } catch {}
    activeRtc.close();
  }

  // Notify backend API if reachable
  safeFetchJson('/api/multiplayer/leave', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: norm, playerId }),
  }).catch(() => {});

  hydrateLocalRoomsFromStorage();
  const room = localRoomManager.getRoom(norm);
  if (room) {
    if (playerId && room.guest && room.guest.playerId === playerId) {
      room.guest = null;
      room.status = 'waiting';
      room.updatedAt = Date.now();
    } else if (playerId && room.host.playerId === playerId) {
      room.status = 'abandoned';
      room.updatedAt = Date.now();
    }
    persistLocalRoomsToStorage();
  }

  emitBroadcastEvent({ type: 'mp:player_left', code: norm, playerId }, true);
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
  let unsubscribeLocalEvents: (() => void) | null = null;

  // Deduplication sets to prevent processing identical hits or damage events multiple times
  const seenDamageEventIds = new Set<string>();
  const seenHitEventIds = new Set<string>();

  hydrateLocalRoomsFromStorage();

  const deliver = (msg: Record<string, unknown>) => {
    if (closed) return;
    try {
      onMessage(msg);
    } catch {}
  };

  const sendOverWebRtc = (msg: Record<string, unknown>): boolean => {
    const webrtc = getActiveWebRtcChannel(code);
    if (webrtc && webrtc.isConnected()) {
      try {
        webrtc.send(msg);
        return true;
      } catch {}
    }
    return false;
  };

  // Handle incoming messages arriving from remote peer or local event bus
  const handleIncomingPeerMessage = (msg: Record<string, unknown>) => {
    if (closed || !msg || typeof msg.type !== 'string') return;

    if (msg.type === 'mp:room_sync' && msg.room) {
      const r = msg.room as MultiplayerRoomState;
      if (normalizeRoomCode(r.code) === code) {
        localRoomManager.upsertRoom(r);
        deliver(msg);
      }
      return;
    }

    if (msg.type === 'mp:damage' && msg.event) {
      const ev = msg.event as DamageResolutionEvent;
      if (ev.eventId && seenDamageEventIds.has(ev.eventId)) {
        return; // Idempotent deduplication: already resolved
      }
      if (ev.eventId) {
        seenDamageEventIds.add(ev.eventId);
        if (seenDamageEventIds.size > 200) {
          const first = seenDamageEventIds.values().next().value;
          if (first) seenDamageEventIds.delete(first);
        }
      }
      if (msg.room) {
        localRoomManager.upsertRoom(msg.room as MultiplayerRoomState);
      }
      deliver(msg);
      return;
    }

    if (
      msg.type === 'mp:remote_state' ||
      msg.type === 'mp:remote_shoot' ||
      msg.type === 'mp:pong' ||
      msg.type === 'mp:player_left'
    ) {
      if (msg.room) {
        localRoomManager.upsertRoom(msg.room as MultiplayerRoomState);
      }
      deliver(msg);
      return;
    }

    // Direct action routed from remote Guest to authoritative Host:
    const senderRole: MultiplayerRole =
      msg.role === 'host' || msg.role === 'guest'
        ? msg.role
        : role === 'host'
          ? 'guest'
          : 'host';

    if (msg.type === 'mp:state') {
      const updated = localRoomManager.updatePlayerTelemetry(code, senderRole, {
        x: msg.x as number,
        y: msg.y as number,
        z: msg.z as number,
        vx: msg.vx as number,
        vz: msg.vz as number,
        yaw: msg.yaw as number,
        pitch: msg.pitch as number,
        weaponId: msg.weaponId as WeaponId,
        armor: msg.armor as number,
        armorType: msg.armorType as 'none' | 'light' | 'heavy',
        credits: msg.credits as number,
        isCrouching: Boolean(msg.isCrouching),
        isSliding: Boolean(msg.isSliding),
        isReloading: Boolean(msg.isReloading),
      });
      if (updated) {
        deliver({
          type: 'mp:remote_state',
          code,
          role: senderRole,
          player: updated,
          serverTime: Date.now(),
        });
      }
      return;
    }

    if (msg.type === 'mp:shoot') {
      deliver({
        type: 'mp:remote_shoot',
        code,
        role: senderRole,
        weaponId: msg.weaponId,
        originX: msg.originX,
        originY: msg.originY,
        originZ: msg.originZ,
        endX: msg.endX,
        endY: msg.endY,
        endZ: msg.endZ,
      });
      return;
    }

    if (msg.type === 'mp:hit' && role === 'host') {
      const hitId = typeof msg.eventId === 'string' ? msg.eventId : `${senderRole}_${Date.now()}`;
      if (seenHitEventIds.has(hitId)) {
        return;
      }
      seenHitEventIds.add(hitId);
      if (seenHitEventIds.size > 200) {
        const first = seenHitEventIds.values().next().value;
        if (first) seenHitEventIds.delete(first);
      }

      const dmgEvent: DamageResolutionEvent | null = localRoomManager.applyHitDamage({
        code,
        attackerRole: senderRole,
        weaponId: (msg.weaponId as WeaponId) || 'pistol',
        rawDamage: Number(msg.rawDamage) || 26,
        isHeadshot: Boolean(msg.isHeadshot),
        distance: Number(msg.distance) || 10,
        hitX: Number(msg.hitX) || 0,
        hitY: Number(msg.hitY) || 1,
        hitZ: Number(msg.hitZ) || 0,
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
        sendOverWebRtc(dmgMsg);
        emitBroadcastEvent(dmgMsg, true);
      }
      return;
    }

    if (msg.type === 'mp:deploy_now' && role === 'host') {
      const room = localRoomManager.getRoom(code);
      if (room && room.roundPhase === 'buy') {
        room.roundPhase = 'combat';
        room.phaseEndsAt = Date.now() + 95_000;
        room.announcement = 'COMBAT LIVE // ELIMINATE RIVAL OPERATIVE';
        room.updatedAt = Date.now();
        persistLocalRoomsToStorage();
        const syncMsg = { type: 'mp:room_sync', code, room, serverTime: Date.now() };
        deliver(syncMsg);
        sendOverWebRtc(syncMsg);
        emitBroadcastEvent(syncMsg, true);
      }
      return;
    }

    if (msg.type === 'mp:rematch' && role === 'host') {
      const room = localRoomManager.getRoom(code);
      if (room) {
        localRoomManager.startMatchInRoom(room, Date.now());
        persistLocalRoomsToStorage();
        const syncMsg = { type: 'mp:room_sync', code, room, serverTime: Date.now() };
        deliver(syncMsg);
        sendOverWebRtc(syncMsg);
        emitBroadcastEvent(syncMsg, true);
      }
      return;
    }
  };

  // Register direct WebRTC/WSS message handler if channel is active (or publish if host)
  if (role === 'host') {
    const currentRoom = localRoomManager.getRoom(code);
    if (currentRoom) {
      ensureHostRoomPublished(currentRoom);
    }
  }
  const activeRtc = getActiveWebRtcChannel(code);
  if (activeRtc) {
    activeRtc.setMessageHandler(handleIncomingPeerMessage);
  }

  // 1. Subscribe to same-tab in-memory event bus
  unsubscribeLocalEvents = subscribeLocalMultiplayerEvents((msg) => {
    if (closed || !msg) return;
    if (msg.code && normalizeRoomCode(String(msg.code)) !== code) return;
    handleIncomingPeerMessage(msg);
  });

  // 2. Setup Cross-Tab BroadcastChannel + Storage Event Listener
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

  // 3. Connect WebSocket to Backend Server (when available and not on static Vercel host)
  const connectWs = () => {
    if (
      closed ||
      isVercelHost() ||
      typeof window === 'undefined' ||
      typeof WebSocket === 'undefined'
    ) {
      return;
    }
    try {
      const envBase =
        typeof import.meta !== 'undefined' &&
        import.meta.env &&
        typeof import.meta.env.VITE_MULTIPLAYER_SERVER_URL === 'string'
          ? import.meta.env.VITE_MULTIPLAYER_SERVER_URL.trim().replace(/\/+$/, '')
          : '';

      const custom = getCustomServerUrl();
      let wsUrl: string;
      if (custom) {
        wsUrl = custom.replace(/^http/, 'ws') + '/ws/match';
      } else if (envBase) {
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

  // 4. Emit initial room sync immediately from local cache so HUD is populated without waiting
  const initialRoom = localRoomManager.getRoom(code);
  if (initialRoom) {
    window.setTimeout(() => {
      if (!closed) {
        deliver({ type: 'mp:room_sync', room: initialRoom, serverTime: Date.now() });
      }
    }, 20);
  }

  // 5. Ping & Local Authority Timer Loop
  pingTimer = window.setInterval(() => {
    if (closed) return;
    const webrtc = getActiveWebRtcChannel(code);
    if (webrtc && webrtc.isConnected()) {
      sendOverWebRtc({
        type: 'mp:ping',
        clientSentAt: Date.now(),
      });
    } else if (ws && wsOpen && ws.readyState === WebSocket.OPEN) {
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
    const currentRtc = getActiveWebRtcChannel(code);
    if (currentRtc) {
      currentRtc.setMessageHandler(handleIncomingPeerMessage);
    }

    // If WebSocket is not open, Host runs authoritative room phase transitions locally and broadcasts over WebRTC
    if (!wsOpen && role === 'host') {
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
          sendOverWebRtc(syncMsg);
          emitBroadcastEvent(syncMsg, true);
        }
      }
    }

    // Simulated challenger (`sim_challenger_`) logic
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

          if (Math.random() < 0.28) {
            const spec = WEAPONS[weaponChoice];
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

  // 6. Polling fallback only when WebSocket and WebRTC are both disconnected
  httpPollTimer = window.setInterval(async () => {
    const webrtc = getActiveWebRtcChannel(code);
    if (closed || wsOpen || (webrtc && webrtc.isConnected()) || serverApiAvailable === false) {
      return;
    }
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
  }, 450);

  return {
    send: (payload: Record<string, unknown>) => {
      if (closed) return;
      const type = String(payload.type || '');
      const webrtc = getActiveWebRtcChannel(code);
      const rtcConnected = Boolean(webrtc && webrtc.isConnected());

      // If WebSocket is actively open, use it
      if (ws && wsOpen && ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(JSON.stringify(payload));
        } catch {}
      }

      // Handle message types cleanly without spamming REST /api/multiplayer/event
      if (type === 'mp:ping') {
        if (rtcConnected) {
          sendOverWebRtc({ type: 'mp:ping', clientSentAt: payload.clientSentAt });
        } else if (!wsOpen) {
          deliver({
            type: 'mp:pong',
            clientSentAt: payload.clientSentAt,
            serverTime: Date.now(),
          });
        }
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
          const remoteStateMsg = {
            type: 'mp:remote_state',
            code,
            role,
            player: updated,
            serverTime: Date.now(),
          };
          if (rtcConnected) {
            sendOverWebRtc(remoteStateMsg);
          }
          // Broadcast to other tabs/listeners without writing 22Hz to localStorage
          emitBroadcastEvent(remoteStateMsg, false);
        }
        return;
      }

      if (type === 'mp:shoot') {
        const remoteShootMsg = {
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
        };
        if (rtcConnected) {
          sendOverWebRtc(remoteShootMsg);
        }
        emitBroadcastEvent(remoteShootMsg, false);
        return;
      }

      if (type === 'mp:hit') {
        const hitId =
          typeof payload.eventId === 'string'
            ? payload.eventId
            : `hit_${role}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        const hitPayload = { ...payload, eventId: hitId, code, role };

        if (role === 'guest') {
          // Guest forwards hit to host authority via WebRTC or BroadcastChannel
          if (rtcConnected) {
            sendOverWebRtc(hitPayload);
          } else {
            emitBroadcastEvent(hitPayload, true);
          }
          return;
        }

        // Host processes hit
        if (seenHitEventIds.has(hitId)) return;
        seenHitEventIds.add(hitId);

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
          sendOverWebRtc(dmgMsg);
          emitBroadcastEvent(dmgMsg, true);
        }
        return;
      }

      if (type === 'mp:deploy_now') {
        if (role === 'guest') {
          if (rtcConnected) {
            sendOverWebRtc({ type: 'mp:deploy_now', code, role });
          } else {
            emitBroadcastEvent({ type: 'mp:deploy_now', code, role }, true);
          }
          return;
        }
        const room = localRoomManager.getRoom(code);
        if (room && room.roundPhase === 'buy') {
          room.roundPhase = 'combat';
          room.phaseEndsAt = Date.now() + 95_000;
          room.announcement = 'COMBAT LIVE // ELIMINATE RIVAL OPERATIVE';
          room.updatedAt = Date.now();
          persistLocalRoomsToStorage();
          const syncMsg = { type: 'mp:room_sync', code, room, serverTime: Date.now() };
          deliver(syncMsg);
          sendOverWebRtc(syncMsg);
          emitBroadcastEvent(syncMsg, true);
        }
        return;
      }

      if (type === 'mp:rematch') {
        if (role === 'guest') {
          if (rtcConnected) {
            sendOverWebRtc({ type: 'mp:rematch', code, role });
          } else {
            emitBroadcastEvent({ type: 'mp:rematch', code, role }, true);
          }
          return;
        }
        const room = localRoomManager.getRoom(code);
        if (room) {
          localRoomManager.startMatchInRoom(room, Date.now());
          persistLocalRoomsToStorage();
          const syncMsg = { type: 'mp:room_sync', code, room, serverTime: Date.now() };
          deliver(syncMsg);
          sendOverWebRtc(syncMsg);
          emitBroadcastEvent(syncMsg, true);
        }
        return;
      }
    },
    close: () => {
      closed = true;
      const rtc = getActiveWebRtcChannel(code);
      if (rtc) {
        rtc.setMessageHandler(null);
      }
      if (unsubscribeLocalEvents) {
        unsubscribeLocalEvents();
        unsubscribeLocalEvents = null;
      }
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
