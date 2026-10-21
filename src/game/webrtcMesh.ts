import Peer, { DataConnection } from 'peerjs';
import { MultiplayerRole, MultiplayerRoomState, normalizeRoomCode } from './multiplayer';
import { OperativeId } from './types';

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

export interface WebRtcChannelHandle {
  role: MultiplayerRole;
  roomCode: string;
  send: (payload: Record<string, unknown>) => void;
  close: () => void;
  isConnected: () => boolean;
}

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

/**
 * Generates the deterministic peer ID for a given tactical room code.
 * Example: code "7K9X2M" -> "vanguard-1v1-7K9X2M"
 */
export function getHostPeerId(roomCode: string): string {
  return `vanguard-1v1-${normalizeRoomCode(roomCode)}`;
}

/**
 * Initializes a WebRTC Host listener for the room code.
 * Allows remote opponents on any static host (like Vercel) to connect directly.
 */
export function startWebRtcHost(params: {
  roomCode: string;
  onGuestJoinRequest: (req: WebRtcJoinRequest) => { ok: true; room: MultiplayerRoomState } | { ok: false; error: string };
  onMessage: (msg: Record<string, unknown>) => void;
}): WebRtcChannelHandle {
  const code = normalizeRoomCode(params.roomCode);
  unregisterActiveWebRtcChannel(code);

  const peerId = getHostPeerId(code);
  let closed = false;
  let peer: Peer | null = null;
  const connectedGuests = new Set<DataConnection>();

  try {
    peer = new Peer(peerId, {
      debug: 0,
    });

    peer.on('error', (err) => {
      // If the peer ID is taken (e.g. fast tab refresh), handle gracefully
      if (err.type === 'unavailable-id') {
        // ID still held by previous peer session; will recycle shortly
      }
    });

    peer.on('connection', (conn) => {
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

        params.onMessage(msg);
      });

      conn.on('close', () => {
        connectedGuests.delete(conn);
      });

      conn.on('error', () => {
        connectedGuests.delete(conn);
      });
    });
  } catch {}

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
  };

  registerActiveWebRtcChannel(code, handle);
  return handle;
}

/**
 * Connects as a Guest to an existing WebRTC Host by room code.
 * Sends join request and awaits authoritative room acceptance.
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
  const hostPeerId = getHostPeerId(code);
  const timeoutMs = params.timeoutMs || 7000;

  return new Promise((resolve) => {
    let settled = false;
    let timer: number | null = null;
    let peer: Peer | null = null;
    let conn: DataConnection | null = null;

    const cleanup = () => {
      if (timer !== null) {
        window.clearTimeout(timer);
        timer = null;
      }
    };

    const fail = (error: string) => {
      if (settled) return;
      settled = true;
      cleanup();
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
      resolve({ ok: false, error });
    };

    timer = window.setTimeout(() => {
      fail(`P2P Connection to room ${code} timed out. Verify that the host is currently in the room.`);
    }, timeoutMs);

    try {
      // Ephemeral guest peer ID
      const guestPeerId = `vanguard-g-${params.playerId.slice(0, 8)}-${Math.floor(Math.random() * 100000)}`;
      peer = new Peer(guestPeerId, { debug: 0 });

      peer.on('error', (err) => {
        if (err.type === 'peer-unavailable') {
          fail(`Room ${code} was not found on the network. Check the code or have the host re-create it.`);
        } else {
          fail(`P2P Network error: ${err.message || 'Could not reach peer network'}`);
        }
      });

      peer.on('open', () => {
        if (settled || !peer) return;

        conn = peer.connect(hostPeerId, { reliable: true });

        const sendJoinReq = () => {
          if (settled || !conn) return;
          const req: WebRtcJoinRequest = {
            type: 'mp:join_request',
            code,
            playerId: params.playerId,
            callsign: params.callsign,
            operative: params.operative,
          };
          try {
            conn.send(req);
          } catch (e) {
            fail(e instanceof Error ? e.message : 'Failed to send join request');
          }
        };

        if (conn.open) {
          sendJoinReq();
        } else {
          conn.on('open', sendJoinReq);
        }

        conn.on('data', (raw) => {
          if (!raw || typeof raw !== 'object') return;
          const msg = raw as Record<string, unknown>;

          if (msg.type === 'mp:join_response') {
            const resp = msg as unknown as WebRtcJoinResponse;
            if (resp.ok && resp.room) {
              if (settled) return;
              settled = true;
              cleanup();

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
              fail(resp.error || `Host rejected join request for room ${code}.`);
              return;
            }
          }

          // Forward live match gameplay message to subscriber
          params.onMessage(msg);
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
