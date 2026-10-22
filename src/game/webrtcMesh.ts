import Peer, { DataConnection } from 'peerjs';
import { MultiplayerRole, MultiplayerRoomState, normalizeRoomCode } from './multiplayer.ts';
import { OperativeId } from './types.ts';

export interface WebRtcJoinRequest {
  type: 'mp:join_request';
  code: string;
  playerId: string;
  callsign: string;
  operative: OperativeId;
}

export interface WebRtcJoinResponse {
  type: 'mp:join_response';
  ok: boolean;
  code: string;
  room?: MultiplayerRoomState;
  role?: MultiplayerRole;
  error?: string;
  serverTime?: number;
}

export interface WebRtcPublicBeaconSummary {
  code: string;
  hostCallsign: string;
  hostOperative: OperativeId;
  createdAt: number;
}

export interface WebRtcChannelHandle {
  role: MultiplayerRole;
  roomCode: string;
  send: (payload: Record<string, unknown>) => void;
  close: () => void;
  isConnected: () => boolean;
  isSignalingReady: () => boolean;
  waitUntilReady: (timeoutMs?: number) => Promise<boolean>;
  setMessageHandler: (handler: ((msg: Record<string, unknown>) => void) | null) => void;
}

// Robust STUN + TURN (UDP & TCP/443) ICE configuration so connections succeed across NATs, mobile hotspots, and firewalls
const RTC_ICE_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' },
    {
      urls: [
        'turn:openrelay.metered.ca:80',
        'turn:openrelay.metered.ca:443',
        'turn:openrelay.metered.ca:443?transport=tcp',
      ],
      username: 'openrelayproject',
      credential: 'openrelayproject',
    },
  ],
  iceCandidatePoolSize: 8,
};

const PUBLIC_BEACON_SLOTS = 4;

// Global active WebRTC channel registry keyed by normalized room code
const activeChannels = new Map<string, WebRtcChannelHandle>();

export function getActiveWebRtcChannel(roomCode: string): WebRtcChannelHandle | null {
  const norm = normalizeRoomCode(roomCode);
  return activeChannels.get(norm) || null;
}

export function registerActiveWebRtcChannel(roomCode: string, handle: WebRtcChannelHandle): void {
  const norm = normalizeRoomCode(roomCode);
  activeChannels.set(norm, handle);
}

export function unregisterActiveWebRtcChannel(roomCode: string): void {
  const norm = normalizeRoomCode(roomCode);
  const existing = activeChannels.get(norm);
  if (existing) {
    try {
      existing.close();
    } catch {}
    activeChannels.delete(norm);
  }
}

export function isWebRtcSupported(): boolean {
  return typeof window !== 'undefined' && typeof RTCPeerConnection !== 'undefined';
}

/**
 * Generates the deterministic peer ID for a given tactical room code.
 * Example: code "7K9X2M" -> "vanguard-1v1-7K9X2M"
 */
export function getHostPeerId(roomCode: string): string {
  return `vanguard-1v1-${normalizeRoomCode(roomCode)}`;
}

function getBeaconSlotPeerId(slotIndex: number): string {
  return `vanguard-1v1-pub-slot-${slotIndex}`;
}

/**
 * Starts an auxiliary PeerJS public lobby beacon on one of the shared discovery slots
 * so other players on static hosts (like Vercel) can see open public rooms and Quick Match into them.
 */
function startPublicLobbyBeacon(
  getSummary: () => WebRtcPublicBeaconSummary | null
): { close: () => void } {
  if (!isWebRtcSupported()) {
    return { close: () => {} };
  }

  let closed = false;
  let beaconPeer: Peer | null = null;
  let slotAttempt = Math.floor(Math.random() * PUBLIC_BEACON_SLOTS);
  let triedSlots = 0;

  const tryClaimSlot = (slotIdx: number) => {
    if (closed || triedSlots >= PUBLIC_BEACON_SLOTS) return;
    triedSlots += 1;

    try {
      const p = new Peer(getBeaconSlotPeerId(slotIdx), {
        debug: 0,
        config: RTC_ICE_CONFIG,
      });
      beaconPeer = p;

      p.on('error', (err) => {
        if (closed) return;
        if (err.type === 'unavailable-id') {
          try {
            p.destroy();
          } catch {}
          beaconPeer = null;
          slotAttempt = (slotIdx + 1) % PUBLIC_BEACON_SLOTS;
          tryClaimSlot(slotAttempt);
        }
      });

      p.on('disconnected', () => {
        if (!closed && beaconPeer && !beaconPeer.destroyed) {
          try {
            beaconPeer.reconnect();
          } catch {}
        }
      });

      p.on('connection', (conn) => {
        if (closed) {
          conn.close();
          return;
        }
        const replyWithInfo = () => {
          const summary = getSummary();
          try {
            conn.send({
              type: 'mp:beacon_info',
              summary,
              serverTime: Date.now(),
            });
          } catch {}
        };
        conn.on('open', replyWithInfo);
        conn.on('data', (data) => {
          if (data && typeof data === 'object' && (data as Record<string, unknown>).type === 'mp:beacon_query') {
            replyWithInfo();
          }
        });
      });
    } catch {}
  };

  tryClaimSlot(slotAttempt);

  return {
    close: () => {
      if (closed) return;
      closed = true;
      if (beaconPeer) {
        try {
          beaconPeer.destroy();
        } catch {}
        beaconPeer = null;
      }
    },
  };
}

/**
 * Queries the public PeerJS lobby beacon slots to discover open waiting rooms across devices.
 */
export async function discoverWebRtcPublicRooms(
  timeoutMs = 1600
): Promise<WebRtcPublicBeaconSummary[]> {
  if (!isWebRtcSupported()) return [];

  return new Promise((resolve) => {
    let settled = false;
    const discovered = new Map<string, WebRtcPublicBeaconSummary>();
    let scannerPeer: Peer | null = null;
    const connections: DataConnection[] = [];

    const finish = () => {
      if (settled) return;
      settled = true;
      for (const c of connections) {
        try {
          c.close();
        } catch {}
      }
      if (scannerPeer) {
        try {
          scannerPeer.destroy();
        } catch {}
        scannerPeer = null;
      }
      resolve(Array.from(discovered.values()));
    };

    const timer = window.setTimeout(finish, timeoutMs);

    try {
      const scannerId = `vanguard-scan-${Math.random().toString(36).slice(2, 9)}`;
      scannerPeer = new Peer(scannerId, {
        debug: 0,
        config: RTC_ICE_CONFIG,
      });

      scannerPeer.on('error', () => {
        // Ignore individual slot lookup errors
      });

      scannerPeer.on('open', () => {
        if (settled || !scannerPeer) return;
        let completedSlots = 0;
        const checkDone = () => {
          completedSlots += 1;
          if (completedSlots >= PUBLIC_BEACON_SLOTS) {
            window.clearTimeout(timer);
            finish();
          }
        };

        for (let i = 0; i < PUBLIC_BEACON_SLOTS; i++) {
          try {
            const conn = scannerPeer.connect(getBeaconSlotPeerId(i), {
              reliable: true,
              serialization: 'json',
            });
            connections.push(conn);

            let slotDone = false;
            const markSlotDone = () => {
              if (slotDone) return;
              slotDone = true;
              checkDone();
            };

            conn.on('open', () => {
              try {
                conn.send({ type: 'mp:beacon_query' });
              } catch {}
            });

            conn.on('data', (raw) => {
              if (raw && typeof raw === 'object') {
                const msg = raw as Record<string, unknown>;
                if (msg.type === 'mp:beacon_info' && msg.summary && typeof msg.summary === 'object') {
                  const s = msg.summary as WebRtcPublicBeaconSummary;
                  if (s.code && s.hostCallsign) {
                    discovered.set(normalizeRoomCode(s.code), {
                      code: normalizeRoomCode(s.code),
                      hostCallsign: String(s.hostCallsign),
                      hostOperative: s.hostOperative || 'vex',
                      createdAt: Number(s.createdAt) || Date.now(),
                    });
                  }
                }
              }
              markSlotDone();
            });

            conn.on('close', markSlotDone);
            conn.on('error', markSlotDone);
          } catch {
            checkDone();
          }
        }
      });
    } catch {
      window.clearTimeout(timer);
      finish();
    }
  });
}

/**
 * Initializes a WebRTC Host listener for the room code.
 * Allows remote opponents on any static host (like Vercel) to connect directly.
 */
export function startWebRtcHost(params: {
  roomCode: string;
  isPublicQueue?: boolean;
  getPublicSummary?: () => WebRtcPublicBeaconSummary | null;
  onGuestJoinRequest: (
    req: WebRtcJoinRequest
  ) => { ok: true; room: MultiplayerRoomState } | { ok: false; error: string };
  onMessage: (msg: Record<string, unknown>) => void;
}): WebRtcChannelHandle {
  const code = normalizeRoomCode(params.roomCode);
  const existing = activeChannels.get(code);
  if (existing && existing.role === 'host' && existing.isSignalingReady()) {
    return existing;
  }
  unregisterActiveWebRtcChannel(code);

  const peerId = getHostPeerId(code);
  let closed = false;
  let signalingReady = false;
  let peer: Peer | null = null;
  const connectedGuests = new Set<DataConnection>();
  const readyCallbacks: Array<(ready: boolean) => void> = [];
  let directMessageHandler: ((msg: Record<string, unknown>) => void) | null = null;
  let reconnectTimer: number | null = null;

  const publicBeacon =
    params.isPublicQueue && params.getPublicSummary
      ? startPublicLobbyBeacon(params.getPublicSummary)
      : null;

  const notifyReady = (val: boolean) => {
    while (readyCallbacks.length > 0) {
      const cb = readyCallbacks.shift();
      try {
        cb?.(val);
      } catch {}
    }
  };

  const attachPeerListeners = (p: Peer) => {
    p.on('open', () => {
      if (closed) return;
      signalingReady = true;
      notifyReady(true);
    });

    p.on('disconnected', () => {
      if (closed) return;
      signalingReady = false;
      try {
        p.reconnect();
      } catch {}
    });

    p.on('error', (err) => {
      if (closed) return;
      if (err.type === 'unavailable-id') {
        // Previous peer instance with this room code is still recycling; retry after a short delay
        if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
        reconnectTimer = window.setTimeout(() => {
          if (closed) return;
          try {
            p.destroy();
          } catch {}
          try {
            peer = new Peer(peerId, { debug: 0, config: RTC_ICE_CONFIG });
            attachPeerListeners(peer);
          } catch {}
        }, 700);
      } else if (err.type === 'network' || err.type === 'server-error' || err.type === 'socket-error') {
        try {
          p.reconnect();
        } catch {}
      }
    });

    p.on('connection', (conn) => {
      if (closed) {
        conn.close();
        return;
      }

      if (conn.open) {
        connectedGuests.add(conn);
      }

      conn.on('open', () => {
        connectedGuests.add(conn);
      });

      conn.on('data', (data) => {
        if (closed || !data || typeof data !== 'object') return;
        connectedGuests.add(conn);
        const msg = data as Record<string, unknown>;

        if (msg.type === 'mp:join_request') {
          const req = msg as unknown as WebRtcJoinRequest;
          const joinRes = params.onGuestJoinRequest(req);
          if (joinRes.ok) {
            // Once guest joins, close public beacon so room is no longer listed as waiting
            publicBeacon?.close();
            const resp: WebRtcJoinResponse = {
              type: 'mp:join_response',
              ok: true,
              code,
              room: joinRes.room,
              role: 'guest',
              serverTime: Date.now(),
            };
            try {
              conn.send(resp);
            } catch {}
          } else {
            const resp: WebRtcJoinResponse = {
              type: 'mp:join_response',
              ok: false,
              code,
              error: joinRes.error,
              serverTime: Date.now(),
            };
            try {
              conn.send(resp);
            } catch {}
          }
          return;
        }

        if (msg.type === 'mp:ping') {
          try {
            conn.send({
              type: 'mp:pong',
              clientSentAt: msg.clientSentAt,
              serverTime: Date.now(),
            });
          } catch {}
          return;
        }

        params.onMessage(msg);
        if (directMessageHandler) {
          try {
            directMessageHandler(msg);
          } catch {}
        }
      });

      conn.on('close', () => {
        connectedGuests.delete(conn);
      });

      conn.on('error', () => {
        connectedGuests.delete(conn);
      });
    });
  };

  if (isWebRtcSupported()) {
    try {
      peer = new Peer(peerId, {
        debug: 0,
        config: RTC_ICE_CONFIG,
      });
      attachPeerListeners(peer);
    } catch {
      notifyReady(false);
    }
  } else {
    notifyReady(false);
  }

  const handle: WebRtcChannelHandle = {
    role: 'host',
    roomCode: code,
    send: (payload: Record<string, unknown>) => {
      if (closed) return;
      for (const conn of connectedGuests) {
        if (conn.open) {
          try {
            conn.send(payload);
          } catch {}
        }
      }
    },
    close: () => {
      if (closed) return;
      closed = true;
      signalingReady = false;
      notifyReady(false);
      publicBeacon?.close();
      if (reconnectTimer !== null && typeof window !== 'undefined') {
        window.clearTimeout(reconnectTimer);
      }
      for (const conn of connectedGuests) {
        try {
          conn.close();
        } catch {}
      }
      connectedGuests.clear();
      if (peer) {
        try {
          peer.destroy();
        } catch {}
        peer = null;
      }
      activeChannels.delete(code);
    },
    isConnected: () => {
      for (const conn of connectedGuests) {
        if (conn.open) return true;
      }
      return false;
    },
    isSignalingReady: () => signalingReady && !closed,
    waitUntilReady: (timeoutMs = 2800) => {
      if (signalingReady) return Promise.resolve(true);
      if (closed || !isWebRtcSupported()) return Promise.resolve(false);
      return new Promise((resolve) => {
        const t = window.setTimeout(() => {
          resolve(signalingReady);
        }, timeoutMs);
        readyCallbacks.push((val) => {
          window.clearTimeout(t);
          resolve(val);
        });
      });
    },
    setMessageHandler: (handler) => {
      directMessageHandler = handler;
    },
  };

  registerActiveWebRtcChannel(code, handle);
  return handle;
}

/**
 * Connects as a Guest to an existing WebRTC Host by room code.
 * Automatically retries transient signaling lookups and uses STUN+TURN ICE servers.
 */
export async function joinWebRtcHost(params: {
  roomCode: string;
  playerId: string;
  callsign: string;
  operative: OperativeId;
  onMessage: (msg: Record<string, unknown>) => void;
  timeoutMs?: number;
}): Promise<
  | {
      ok: true;
      room: MultiplayerRoomState;
      role: 'guest';
      handle: WebRtcChannelHandle;
    }
  | {
      ok: false;
      error: string;
    }
> {
  const code = normalizeRoomCode(params.roomCode);
  if (!isWebRtcSupported()) {
    return { ok: false, error: 'WebRTC is not supported in this browser environment.' };
  }

  const maxAttempts = 3;
  const perAttemptTimeoutMs = Math.max(3500, Math.floor((params.timeoutMs || 9000) / maxAttempts));
  let lastError = `Room ${code} was not found on the network.`;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const attemptRes = await attemptSingleWebRtcJoin({
      code,
      playerId: params.playerId,
      callsign: params.callsign,
      operative: params.operative,
      onMessage: params.onMessage,
      timeoutMs: perAttemptTimeoutMs,
    });

    if (attemptRes.ok) {
      return attemptRes;
    }

    lastError = attemptRes.error;
    // If host explicitly rejected (e.g. room is full), do not retry
    if (attemptRes.nonRetryable) {
      break;
    }

    if (attempt < maxAttempts) {
      await new Promise((r) => window.setTimeout(r, 650));
    }
  }

  return { ok: false, error: lastError };
}

function attemptSingleWebRtcJoin(params: {
  code: string;
  playerId: string;
  callsign: string;
  operative: OperativeId;
  onMessage: (msg: Record<string, unknown>) => void;
  timeoutMs: number;
}): Promise<
  | {
      ok: true;
      room: MultiplayerRoomState;
      role: 'guest';
      handle: WebRtcChannelHandle;
    }
  | {
      ok: false;
      error: string;
      nonRetryable?: boolean;
    }
> {
  const { code } = params;
  const hostPeerId = getHostPeerId(code);

  return new Promise((resolve) => {
    let settled = false;
    let timer: number | null = null;
    let reqRetryTimer: number | null = null;
    let peer: Peer | null = null;
    let conn: DataConnection | null = null;
    let directMessageHandler: ((msg: Record<string, unknown>) => void) | null = null;

    const cleanupTimers = () => {
      if (timer !== null) {
        window.clearTimeout(timer);
        timer = null;
      }
      if (reqRetryTimer !== null) {
        window.clearInterval(reqRetryTimer);
        reqRetryTimer = null;
      }
    };

    const fail = (error: string, nonRetryable = false) => {
      if (settled) return;
      settled = true;
      cleanupTimers();
      if (conn) {
        try {
          conn.close();
        } catch {}
      }
      if (peer) {
        try {
          peer.destroy();
        } catch {}
      }
      resolve({ ok: false, error, nonRetryable });
    };

    timer = window.setTimeout(() => {
      fail(
        `Room ${code} did not respond in time. Ensure the host still has room ${code} open.`
      );
    }, params.timeoutMs);

    try {
      const guestPeerId = `vanguard-g-${params.playerId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8)}-${Math.floor(Math.random() * 100000)}`;
      peer = new Peer(guestPeerId, {
        debug: 0,
        config: RTC_ICE_CONFIG,
      });

      peer.on('error', (err) => {
        if (err.type === 'peer-unavailable') {
          fail(
            `Room ${code} not found. Ensure the host has created room ${code} and is waiting in the lobby.`
          );
        } else {
          fail(`P2P network error: ${err.message || 'Could not reach signaling server'}`);
        }
      });

      peer.on('open', () => {
        if (settled || !peer) return;

        conn = peer.connect(hostPeerId, {
          reliable: true,
          serialization: 'json',
        });

        const sendJoinReq = () => {
          if (settled || !conn || !conn.open) return;
          const req: WebRtcJoinRequest = {
            type: 'mp:join_request',
            code,
            playerId: params.playerId,
            callsign: params.callsign,
            operative: params.operative,
          };
          try {
            conn.send(req);
          } catch {}
        };

        if (conn.open) {
          sendJoinReq();
        } else {
          conn.on('open', () => {
            sendJoinReq();
            // Periodically re-send join request until join_response arrives
            reqRetryTimer = window.setInterval(sendJoinReq, 650);
          });
        }

        conn.on('data', (raw) => {
          if (!raw || typeof raw !== 'object') return;
          const msg = raw as Record<string, unknown>;

          if (msg.type === 'mp:join_response') {
            const resp = msg as unknown as WebRtcJoinResponse;
            if (resp.ok && resp.room) {
              if (settled) return;
              settled = true;
              cleanupTimers();

              let guestClosed = false;
              const handle: WebRtcChannelHandle = {
                role: 'guest',
                roomCode: code,
                send: (payload: Record<string, unknown>) => {
                  if (guestClosed || !conn || !conn.open) return;
                  try {
                    conn.send(payload);
                  } catch {}
                },
                close: () => {
                  if (guestClosed) return;
                  guestClosed = true;
                  if (conn) {
                    try {
                      conn.close();
                    } catch {}
                  }
                  if (peer) {
                    try {
                      peer.destroy();
                    } catch {}
                  }
                  activeChannels.delete(code);
                },
                isConnected: () => Boolean(conn && conn.open && !guestClosed),
                isSignalingReady: () => Boolean(peer && !peer.destroyed && !guestClosed),
                waitUntilReady: () => Promise.resolve(true),
                setMessageHandler: (handler) => {
                  directMessageHandler = handler;
                },
              };

              registerActiveWebRtcChannel(code, handle);

              resolve({
                ok: true,
                room: resp.room,
                role: 'guest',
                handle,
              });
              return;
            } else {
              fail(resp.error || `Host rejected join request for room ${code}.`, true);
              return;
            }
          }

          if (msg.type === 'mp:ping') {
            try {
              conn?.send({
                type: 'mp:pong',
                clientSentAt: msg.clientSentAt,
                serverTime: Date.now(),
              });
            } catch {}
            return;
          }

          params.onMessage(msg);
          if (directMessageHandler) {
            try {
              directMessageHandler(msg);
            } catch {}
          }
        });

        conn.on('close', () => {
          if (!settled) {
            fail('Connection to host was closed.');
          }
        });

        conn.on('error', (err) => {
          if (!settled) {
            fail(err.message || 'Connection error with host.');
          }
        });
      });
    } catch (e) {
      fail(e instanceof Error ? e.message : 'Could not initialize P2P network.');
    }
  });
}
