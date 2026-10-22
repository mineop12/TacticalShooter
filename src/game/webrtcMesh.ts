import Peer, { DataConnection } from 'peerjs';
import { MultiplayerRole, MultiplayerRoomState, normalizeRoomCode } from './multiplayer.ts';
import { OperativeId } from './types.ts';

export interface WebRtcJoinRequest {
  type: 'mp:join_request';
  code: string;
  playerId: string;
  callsign: string;
  operative: OperativeId;
  requestId?: string;
}

export interface WebRtcJoinResponse {
  type: 'mp:join_response';
  ok: boolean;
  code: string;
  targetPlayerId?: string;
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
  isClosed: () => boolean;
  waitUntilReady: (timeoutMs?: number) => Promise<boolean>;
  setMessageHandler: (handler: ((msg: Record<string, unknown>) => void) | null) => void;
}

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

// Redundant global WSS (WebSocket over TLS) MQTT brokers for instant zero-NAT cloud relay
const WSS_RELAY_BROKERS = [
  'wss://broker.emqx.io:8084/mqtt',
  'wss://broker.hivemq.com:8884/mqtt',
  'wss://test.mosquitto.org:8081/mqtt',
];

const TOPIC_PREFIX = 'vanguard_arena_1v1_v2';
const PUBLIC_DISCOVER_TOPIC = `${TOPIC_PREFIX}/public/discover`;
const PUBLIC_ANNOUNCE_TOPIC = `${TOPIC_PREFIX}/public/announce`;

// ============================================================================
// LIGHTWEIGHT MQTT 3.1.1 OVER WEBSOCKETS RELAY CLIENT (ZERO NAT / PORT 443 WSS)
// ============================================================================

function encodeVarLength(len: number): number[] {
  const bytes: number[] = [];
  do {
    let encoded = len % 128;
    len = Math.floor(len / 128);
    if (len > 0) encoded |= 0x80;
    bytes.push(encoded);
  } while (len > 0);
  return bytes;
}

function encodeUtf8WithLen(str: string): Uint8Array {
  const raw = new TextEncoder().encode(str);
  const out = new Uint8Array(2 + raw.length);
  out[0] = (raw.length >> 8) & 0xff;
  out[1] = raw.length & 0xff;
  out.set(raw, 2);
  return out;
}

function buildMqttConnectPacket(clientId: string): Uint8Array {
  const protoName = encodeUtf8WithLen('MQTT');
  const clientBytes = encodeUtf8WithLen(clientId);
  const remLen = protoName.length + 4 + clientBytes.length;
  const remBytes = encodeVarLength(remLen);
  const pkt = new Uint8Array(1 + remBytes.length + remLen);
  let idx = 0;
  pkt[idx++] = 0x10; // CONNECT
  for (const b of remBytes) pkt[idx++] = b;
  pkt.set(protoName, idx);
  idx += protoName.length;
  pkt[idx++] = 0x04; // MQTT 3.1.1
  pkt[idx++] = 0x02; // Clean Session
  pkt[idx++] = 0x00; // Keep Alive MSB
  pkt[idx++] = 0x2d; // Keep Alive LSB (45s)
  pkt.set(clientBytes, idx);
  return pkt;
}

function buildMqttSubscribePacket(topic: string, packetId = 1): Uint8Array {
  const topicBytes = encodeUtf8WithLen(topic);
  const remLen = 2 + topicBytes.length + 1;
  const remBytes = encodeVarLength(remLen);
  const pkt = new Uint8Array(1 + remBytes.length + remLen);
  let idx = 0;
  pkt[idx++] = 0x82; // SUBSCRIBE
  for (const b of remBytes) pkt[idx++] = b;
  pkt[idx++] = (packetId >> 8) & 0xff;
  pkt[idx++] = packetId & 0xff;
  pkt.set(topicBytes, idx);
  idx += topicBytes.length;
  pkt[idx++] = 0x00; // Requested QoS 0
  return pkt;
}

function buildMqttPublishPacket(topic: string, jsonPayload: string): Uint8Array {
  const topicBytes = encodeUtf8WithLen(topic);
  const payloadBytes = new TextEncoder().encode(jsonPayload);
  const remLen = topicBytes.length + payloadBytes.length;
  const remBytes = encodeVarLength(remLen);
  const pkt = new Uint8Array(1 + remBytes.length + remLen);
  let idx = 0;
  pkt[idx++] = 0x30; // PUBLISH QoS 0
  for (const b of remBytes) pkt[idx++] = b;
  pkt.set(topicBytes, idx);
  idx += topicBytes.length;
  pkt.set(payloadBytes, idx);
  return pkt;
}

type TopicMessageHandler = (topic: string, msg: Record<string, unknown>) => void;

interface SharedWssRelay {
  subscribe: (topic: string, handler: TopicMessageHandler) => () => void;
  publish: (topic: string, data: Record<string, unknown>) => void;
  isConnected: () => boolean;
  waitUntilConnected: (timeoutMs?: number) => Promise<boolean>;
}

const cachedPublicBeacons = new Map<
  string,
  { summary: WebRtcPublicBeaconSummary; updatedAt: number }
>();

let sharedRelayInstance: SharedWssRelay | null = null;

function getSharedWssRelay(): SharedWssRelay {
  if (sharedRelayInstance) return sharedRelayInstance;

  if (typeof window === 'undefined' || typeof WebSocket === 'undefined') {
    sharedRelayInstance = {
      subscribe: () => () => {},
      publish: () => {},
      isConnected: () => false,
      waitUntilConnected: () => Promise.resolve(false),
    };
    return sharedRelayInstance;
  }

  const topicListeners = new Map<string, Set<TopicMessageHandler>>();
  const sockets = new Map<string, { ws: WebSocket; ready: boolean }>();
  const readyWaiters: Array<(val: boolean) => void> = [];
  const seenMsgIds = new Set<string>();
  let pktIdCounter = 1;

  const notifyConnected = () => {
    while (readyWaiters.length > 0) {
      const cb = readyWaiters.shift();
      try {
        cb?.(true);
      } catch {}
    }
  };

  const dispatchTopicMessage = (topic: string, msg: Record<string, unknown>) => {
    // Update live public beacon cache automatically whenever announce packets arrive
    if (topic === PUBLIC_ANNOUNCE_TOPIC || topic === PUBLIC_DISCOVER_TOPIC) {
      if (msg.type === 'mp:beacon_info' && msg.summary && typeof msg.summary === 'object') {
        const s = msg.summary as WebRtcPublicBeaconSummary;
        if (s.code && s.hostCallsign) {
          const norm = normalizeRoomCode(s.code);
          cachedPublicBeacons.set(norm, {
            summary: {
              code: norm,
              hostCallsign: String(s.hostCallsign),
              hostOperative: s.hostOperative || 'vex',
              createdAt: Number(s.createdAt) || Date.now(),
            },
            updatedAt: Date.now(),
          });
        }
      } else if (msg.type === 'mp:beacon_remove' && typeof msg.code === 'string') {
        cachedPublicBeacons.delete(normalizeRoomCode(msg.code));
      }
    }

    const listeners = topicListeners.get(topic);
    if (listeners) {
      for (const fn of Array.from(listeners)) {
        try {
          fn(topic, msg);
        } catch {}
      }
    }
  };

  const connectBroker = (brokerUrl: string) => {
    try {
      const ws = new WebSocket(brokerUrl, 'mqtt');
      ws.binaryType = 'arraybuffer';
      const entry = { ws, ready: false };
      sockets.set(brokerUrl, entry);

      ws.onopen = () => {
        const clientId = `vg_${Math.random().toString(36).slice(2, 11)}`;
        try {
          ws.send(buildMqttConnectPacket(clientId) as any);
        } catch {}
      };

      ws.onmessage = (ev) => {
        if (!(ev.data instanceof ArrayBuffer)) return;
        const buf = new Uint8Array(ev.data);
        let offset = 0;

        while (offset < buf.length) {
          const header = buf[offset++];
          const pktType = header >> 4;

          let remLen = 0;
          let multiplier = 1;
          while (offset < buf.length) {
            const encoded = buf[offset++];
            remLen += (encoded & 0x7f) * multiplier;
            if ((encoded & 0x80) === 0) break;
            multiplier *= 128;
          }

          const endOffset = offset + remLen;
          if (endOffset > buf.length) break;

          if (pktType === 2) {
            // CONNACK
            entry.ready = true;
            try {
              ws.send(buildMqttSubscribePacket(PUBLIC_ANNOUNCE_TOPIC, ++pktIdCounter) as any);
            } catch {}
            for (const t of topicListeners.keys()) {
              try {
                ws.send(buildMqttSubscribePacket(t, ++pktIdCounter) as any);
              } catch {}
            }
            notifyConnected();
          } else if (pktType === 3) {
            // PUBLISH
            let cursor = offset;
            if (cursor + 2 <= endOffset) {
              const topicLen = (buf[cursor] << 8) | buf[cursor + 1];
              cursor += 2;
              if (cursor + topicLen <= endOffset) {
                const topic = new TextDecoder().decode(buf.subarray(cursor, cursor + topicLen));
                cursor += topicLen;
                const qos = (header >> 1) & 0x03;
                if (qos > 0) {
                  cursor += 2;
                }
                if (cursor <= endOffset) {
                  const jsonStr = new TextDecoder().decode(buf.subarray(cursor, endOffset));
                  try {
                    const parsed = JSON.parse(jsonStr) as Record<string, unknown>;
                    if (parsed && typeof parsed === 'object') {
                      const mid = typeof parsed._mid === 'string' ? parsed._mid : '';
                      if (mid) {
                        if (seenMsgIds.has(mid)) {
                          offset = endOffset;
                          continue;
                        }
                        seenMsgIds.add(mid);
                        if (seenMsgIds.size > 800) {
                          const first = seenMsgIds.values().next().value;
                          if (first) seenMsgIds.delete(first);
                        }
                      }
                      dispatchTopicMessage(topic, parsed);
                    }
                  } catch {}
                }
              }
            }
          }

          offset = endOffset;
        }
      };

      ws.onerror = () => {
        entry.ready = false;
      };

      ws.onclose = () => {
        entry.ready = false;
        sockets.delete(brokerUrl);
        window.setTimeout(() => connectBroker(brokerUrl), 2200);
      };
    } catch {}
  };

  for (const url of WSS_RELAY_BROKERS) {
    connectBroker(url);
  }

  window.setInterval(() => {
    const pingPkt = new Uint8Array([0xc0, 0x00]);
    for (const { ws, ready } of sockets.values()) {
      if (ready && ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(pingPkt);
        } catch {}
      }
    }
  }, 20000);

  sharedRelayInstance = {
    subscribe: (topic: string, handler: TopicMessageHandler) => {
      let set = topicListeners.get(topic);
      const isFirst = !set || set.size === 0;
      if (!set) {
        set = new Set();
        topicListeners.set(topic, set);
      }
      set.add(handler);

      if (isFirst) {
        for (const { ws, ready } of sockets.values()) {
          if (ready && ws.readyState === WebSocket.OPEN) {
            try {
              ws.send(buildMqttSubscribePacket(topic, ++pktIdCounter) as any);
            } catch {}
          }
        }
      }

      return () => {
        const currentSet = topicListeners.get(topic);
        if (currentSet) {
          currentSet.delete(handler);
          if (currentSet.size === 0) {
            topicListeners.delete(topic);
          }
        }
      };
    },
    publish: (topic: string, data: Record<string, unknown>) => {
      const mid =
        typeof data._mid === 'string'
          ? data._mid
          : `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
      const payload = JSON.stringify({ ...data, _mid: mid });
      const pkt = buildMqttPublishPacket(topic, payload);
      for (const { ws, ready } of sockets.values()) {
        if (ready && ws.readyState === WebSocket.OPEN) {
          try {
            ws.send(pkt as any);
          } catch {}
        }
      }
    },
    isConnected: () => {
      for (const { ws, ready } of sockets.values()) {
        if (ready && ws.readyState === WebSocket.OPEN) return true;
      }
      return false;
    },
    waitUntilConnected: (timeoutMs = 1800) => {
      for (const { ws, ready } of sockets.values()) {
        if (ready && ws.readyState === WebSocket.OPEN) return Promise.resolve(true);
      }
      return new Promise((resolve) => {
        const t = window.setTimeout(() => resolve(false), timeoutMs);
        readyWaiters.push((val) => {
          window.clearTimeout(t);
          resolve(val);
        });
      });
    },
  };

  return sharedRelayInstance;
}

// ============================================================================
// HYBRID WEBRTC + WSS CLOUD RELAY ROOM CHANNELS
// ============================================================================

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

export function closeAllOtherWebRtcChannels(keepRoomCode?: string): void {
  const keepNorm = keepRoomCode ? normalizeRoomCode(keepRoomCode) : '';
  for (const [code, handle] of Array.from(activeChannels.entries())) {
    if (code !== keepNorm) {
      try {
        handle.close();
      } catch {}
      activeChannels.delete(code);
    }
  }
}

export function isWebRtcSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    (typeof RTCPeerConnection !== 'undefined' || typeof WebSocket !== 'undefined')
  );
}

export function getHostPeerId(roomCode: string): string {
  return `vanguard-1v1-${normalizeRoomCode(roomCode)}`;
}

function getRoomTopicToHost(code: string): string {
  return `${TOPIC_PREFIX}/room/${normalizeRoomCode(code)}/to_host`;
}

function getRoomTopicToGuest(code: string): string {
  return `${TOPIC_PREFIX}/room/${normalizeRoomCode(code)}/to_guest`;
}

/**
 * Discovers open public waiting rooms across devices via the shared WSS Cloud Relay.
 */
export async function discoverWebRtcPublicRooms(
  timeoutMs = 650
): Promise<WebRtcPublicBeaconSummary[]> {
  if (typeof window === 'undefined' || typeof WebSocket === 'undefined') return [];

  const relay = getSharedWssRelay();
  const now = Date.now();
  // Prune stale cached beacons older than 20 seconds
  for (const [code, entry] of cachedPublicBeacons.entries()) {
    if (now - entry.updatedAt > 20000) {
      cachedPublicBeacons.delete(code);
    }
  }

  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      unsubAnnounce();
      const results: WebRtcPublicBeaconSummary[] = [];
      const cutoff = Date.now() - 20000;
      for (const entry of cachedPublicBeacons.values()) {
        if (entry.updatedAt >= cutoff) {
          results.push(entry.summary);
        }
      }
      resolve(results);
    };

    const unsubAnnounce = relay.subscribe(PUBLIC_ANNOUNCE_TOPIC, () => {});
    window.setTimeout(finish, timeoutMs);

    relay.waitUntilConnected(Math.min(500, timeoutMs)).then((connected) => {
      if (!settled && connected) {
        relay.publish(PUBLIC_DISCOVER_TOPIC, {
          type: 'mp:beacon_query',
          ts: Date.now(),
        });
      }
    });
  });
}

/**
 * Initializes a Dual-Transport (WSS Cloud Relay + WebRTC P2P) Host listener for the room code.
 * Never tears down an active host channel for the same room code unless explicitly closed.
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
  if (existing && existing.role === 'host' && !existing.isClosed()) {
    return existing;
  }
  unregisterActiveWebRtcChannel(code);

  const peerId = getHostPeerId(code);
  const toHostTopic = getRoomTopicToHost(code);
  const toGuestTopic = getRoomTopicToGuest(code);
  const wssRelay = getSharedWssRelay();

  let closed = false;
  let rtcSignalingReady = false;
  let peer: Peer | null = null;
  const connectedGuests = new Set<DataConnection>();
  const readyCallbacks: Array<(ready: boolean) => void> = [];
  let directMessageHandler: ((msg: Record<string, unknown>) => void) | null = null;
  let reconnectTimer: number | null = null;
  let beaconTimer: number | null = null;
  const dedupInbound = new Set<string>();

  const notifyReady = (val: boolean) => {
    while (readyCallbacks.length > 0) {
      const cb = readyCallbacks.shift();
      try {
        cb?.(val);
      } catch {}
    }
  };

  const broadcastPublicBeacon = () => {
    if (closed || !params.isPublicQueue || !params.getPublicSummary) return;
    const summary = params.getPublicSummary();
    if (summary) {
      cachedPublicBeacons.set(code, { summary, updatedAt: Date.now() });
      wssRelay.publish(PUBLIC_ANNOUNCE_TOPIC, {
        type: 'mp:beacon_info',
        summary,
        serverTime: Date.now(),
      });
    } else {
      cachedPublicBeacons.delete(code);
      wssRelay.publish(PUBLIC_ANNOUNCE_TOPIC, {
        type: 'mp:beacon_remove',
        code,
        serverTime: Date.now(),
      });
    }
  };

  const deliverInboundMessage = (msg: Record<string, unknown>) => {
    if (closed) return;
    const mid = typeof msg._mid === 'string' ? msg._mid : '';
    if (mid) {
      if (dedupInbound.has(mid)) return;
      dedupInbound.add(mid);
      if (dedupInbound.size > 600) {
        const first = dedupInbound.values().next().value;
        if (first) dedupInbound.delete(first);
      }
    }
    params.onMessage(msg);
    if (directMessageHandler) {
      try {
        directMessageHandler(msg);
      } catch {}
    }
  };

  const handleJoinReqAndBuildResponse = (req: WebRtcJoinRequest): WebRtcJoinResponse => {
    const joinRes = params.onGuestJoinRequest(req);
    if (joinRes.ok) {
      cachedPublicBeacons.delete(code);
      wssRelay.publish(PUBLIC_ANNOUNCE_TOPIC, {
        type: 'mp:beacon_remove',
        code,
        serverTime: Date.now(),
      });
      return {
        type: 'mp:join_response',
        ok: true,
        code,
        targetPlayerId: req.playerId,
        room: joinRes.room,
        role: 'guest',
        serverTime: Date.now(),
      };
    }
    return {
      type: 'mp:join_response',
      ok: false,
      code,
      targetPlayerId: req.playerId,
      error: joinRes.error,
      serverTime: Date.now(),
    };
  };

  // 1. Subscribe to room topic and public discovery topic on Shared WSS Cloud Relay
  const unsubToHost = wssRelay.subscribe(toHostTopic, (_topic, msg) => {
    if (closed) return;

    if (msg.type === 'mp:join_request') {
      const req = msg as unknown as WebRtcJoinRequest;
      const resp = handleJoinReqAndBuildResponse(req);
      wssRelay.publish(toGuestTopic, resp as unknown as Record<string, unknown>);
      return;
    }

    if (msg.type === 'mp:ping') {
      wssRelay.publish(toGuestTopic, {
        type: 'mp:pong',
        clientSentAt: msg.clientSentAt,
        serverTime: Date.now(),
      });
      return;
    }

    deliverInboundMessage(msg);
  });

  const unsubDiscover =
    params.isPublicQueue && params.getPublicSummary
      ? wssRelay.subscribe(PUBLIC_DISCOVER_TOPIC, (_topic, msg) => {
          if (closed) return;
          if (msg.type === 'mp:beacon_query') {
            broadcastPublicBeacon();
          }
        })
      : () => {};

  wssRelay.waitUntilConnected(1200).then((ok) => {
    if (ok && !closed) {
      broadcastPublicBeacon();
      notifyReady(true);
    }
  });

  if (params.isPublicQueue && params.getPublicSummary && typeof window !== 'undefined') {
    beaconTimer = window.setInterval(broadcastPublicBeacon, 3000);
  }

  // 2. Also start PeerJS WebRTC Host in parallel for direct P2P low-latency DataChannel
  const attachPeerListeners = (p: Peer) => {
    p.on('open', () => {
      if (closed) return;
      rtcSignalingReady = true;
      notifyReady(true);
    });

    p.on('disconnected', () => {
      if (closed) return;
      rtcSignalingReady = false;
      try {
        p.reconnect();
      } catch {}
    });

    p.on('error', (err) => {
      if (closed) return;
      if (err.type === 'unavailable-id') {
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
        }, 800);
      } else if (
        err.type === 'network' ||
        err.type === 'server-error' ||
        err.type === 'socket-error'
      ) {
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
          const resp = handleJoinReqAndBuildResponse(req);
          try {
            conn.send(resp);
          } catch {}
          wssRelay.publish(toGuestTopic, resp as unknown as Record<string, unknown>);
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

        deliverInboundMessage(msg);
      });

      conn.on('close', () => {
        connectedGuests.delete(conn);
      });
      conn.on('error', () => {
        connectedGuests.delete(conn);
      });
    });
  };

  if (typeof window !== 'undefined' && typeof RTCPeerConnection !== 'undefined') {
    try {
      peer = new Peer(peerId, {
        debug: 0,
        config: RTC_ICE_CONFIG,
      });
      attachPeerListeners(peer);
    } catch {}
  }

  const handle: WebRtcChannelHandle = {
    role: 'host',
    roomCode: code,
    send: (payload: Record<string, unknown>) => {
      if (closed) return;
      const mid =
        typeof payload._mid === 'string'
          ? payload._mid
          : `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
      const tagged = { ...payload, _mid: mid };

      // Send over WSS Cloud Relay
      wssRelay.publish(toGuestTopic, tagged);

      // And send over direct WebRTC DataChannel if open
      for (const conn of connectedGuests) {
        if (conn.open) {
          try {
            conn.send(tagged);
          } catch {}
        }
      }
    },
    close: () => {
      if (closed) return;
      closed = true;
      rtcSignalingReady = false;
      notifyReady(false);
      unsubToHost();
      unsubDiscover();
      if (beaconTimer !== null && typeof window !== 'undefined') {
        window.clearInterval(beaconTimer);
      }
      cachedPublicBeacons.delete(code);
      wssRelay.publish(PUBLIC_ANNOUNCE_TOPIC, {
        type: 'mp:beacon_remove',
        code,
        serverTime: Date.now(),
      });
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
      if (closed) return false;
      if (wssRelay.isConnected()) return true;
      for (const conn of connectedGuests) {
        if (conn.open) return true;
      }
      return false;
    },
    isSignalingReady: () => (rtcSignalingReady || wssRelay.isConnected()) && !closed,
    isClosed: () => closed,
    waitUntilReady: (timeoutMs = 1500) => {
      if (rtcSignalingReady || wssRelay.isConnected()) return Promise.resolve(true);
      if (closed || !isWebRtcSupported()) return Promise.resolve(false);
      return new Promise((resolve) => {
        const t = window.setTimeout(() => {
          resolve(rtcSignalingReady || wssRelay.isConnected());
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
 * Connects as a Guest to an existing Host by room code using both WSS Cloud Relay AND WebRTC P2P simultaneously.
 * Whichever transport responds first completes the join handshake immediately.
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
    return { ok: false, error: 'Online P2P is not supported in this environment.' };
  }

  const existing = activeChannels.get(code);
  if (existing && existing.role === 'guest') {
    unregisterActiveWebRtcChannel(code);
  }

  const toHostTopic = getRoomTopicToHost(code);
  const toGuestTopic = getRoomTopicToGuest(code);
  const hostPeerId = getHostPeerId(code);
  const wssRelay = getSharedWssRelay();
  const totalTimeoutMs = params.timeoutMs || 7000;

  return new Promise((resolve) => {
    let settled = false;
    let guestClosed = false;
    let timer: number | null = null;
    let reqRetryTimer: number | null = null;
    let peer: Peer | null = null;
    let conn: DataConnection | null = null;
    let directMessageHandler: ((msg: Record<string, unknown>) => void) | null = null;
    const dedupInbound = new Set<string>();

    const deliverInbound = (msg: Record<string, unknown>) => {
      if (guestClosed) return;
      const mid = typeof msg._mid === 'string' ? msg._mid : '';
      if (mid) {
        if (dedupInbound.has(mid)) return;
        dedupInbound.add(mid);
        if (dedupInbound.size > 600) {
          const first = dedupInbound.values().next().value;
          if (first) dedupInbound.delete(first);
        }
      }
      params.onMessage(msg);
      if (directMessageHandler) {
        try {
          directMessageHandler(msg);
        } catch {}
      }
    };

    const cleanupHandshakeTimers = () => {
      if (timer !== null) {
        window.clearTimeout(timer);
        timer = null;
      }
      if (reqRetryTimer !== null) {
        window.clearInterval(reqRetryTimer);
        reqRetryTimer = null;
      }
    };

    // 1. Subscribe to Guest topic on Shared WSS Cloud Relay
    const unsubToGuest = wssRelay.subscribe(toGuestTopic, (_topic, msg) => {
      if (guestClosed) return;

      if (msg.type === 'mp:join_response') {
        const resp = msg as unknown as WebRtcJoinResponse;
        if (resp.targetPlayerId && resp.targetPlayerId !== params.playerId) {
          return;
        }
        handleJoinResponse(resp);
        return;
      }

      if (msg.type === 'mp:ping') {
        wssRelay.publish(toHostTopic, {
          type: 'mp:pong',
          clientSentAt: msg.clientSentAt,
          serverTime: Date.now(),
        });
        return;
      }

      deliverInbound(msg);
    });

    const failAll = (error: string) => {
      if (settled) return;
      settled = true;
      guestClosed = true;
      cleanupHandshakeTimers();
      unsubToGuest();
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

    const handleJoinResponse = (resp: WebRtcJoinResponse) => {
      if (settled) return;
      if (resp.ok && resp.room) {
        settled = true;
        cleanupHandshakeTimers();

        const handle: WebRtcChannelHandle = {
          role: 'guest',
          roomCode: code,
          send: (payload: Record<string, unknown>) => {
            if (guestClosed) return;
            const mid =
              typeof payload._mid === 'string'
                ? payload._mid
                : `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
            const tagged = { ...payload, _mid: mid };
            wssRelay.publish(toHostTopic, tagged);
            if (conn && conn.open) {
              try {
                conn.send(tagged);
              } catch {}
            }
          },
          close: () => {
            if (guestClosed) return;
            guestClosed = true;
            unsubToGuest();
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
          isConnected: () =>
            !guestClosed && (wssRelay.isConnected() || Boolean(conn && conn.open)),
          isSignalingReady: () =>
            !guestClosed && (wssRelay.isConnected() || Boolean(peer && !peer.destroyed)),
          isClosed: () => guestClosed,
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
      } else {
        failAll(resp.error || `Host rejected join request for room ${code}.`);
      }
    };

    const sendJoinReqEverywhere = () => {
      if (settled || guestClosed) return;
      const req: WebRtcJoinRequest = {
        type: 'mp:join_request',
        code,
        playerId: params.playerId,
        callsign: params.callsign,
        operative: params.operative,
        requestId: `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      };
      if (wssRelay.isConnected()) {
        wssRelay.publish(toHostTopic, req as unknown as Record<string, unknown>);
      }
      if (conn && conn.open) {
        try {
          conn.send(req);
        } catch {}
      }
    };

    wssRelay.waitUntilConnected(1000).then((ok) => {
      if (ok && !settled) {
        // Brief 35ms delay after subscribing to ensure SUBACK on broker before first request
        window.setTimeout(sendJoinReqEverywhere, 35);
      }
    });

    // Retry join request every 450ms across both WSS Relay and WebRTC until host responds
    reqRetryTimer = window.setInterval(sendJoinReqEverywhere, 450);

    timer = window.setTimeout(() => {
      failAll(
        `Room ${code} did not respond. Verify the 6-character code and make sure the host still has room ${code} open.`
      );
    }, totalTimeoutMs);

    // 2. Also initiate direct PeerJS WebRTC connection in parallel
    if (typeof RTCPeerConnection !== 'undefined') {
      try {
        const guestPeerId = `vanguard-g-${params.playerId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8)}-${Math.floor(Math.random() * 100000)}`;
        peer = new Peer(guestPeerId, {
          debug: 0,
          config: RTC_ICE_CONFIG,
        });

        peer.on('error', () => {
          // Do not fail early on PeerJS error because WSS Cloud Relay operates in parallel
        });

        peer.on('open', () => {
          if (settled || guestClosed || !peer) return;
          try {
            conn = peer.connect(hostPeerId, {
              reliable: true,
              serialization: 'json',
            });

            conn.on('open', () => {
              sendJoinReqEverywhere();
            });

            conn.on('data', (raw) => {
              if (guestClosed || !raw || typeof raw !== 'object') return;
              const msg = raw as Record<string, unknown>;
              if (msg.type === 'mp:join_response') {
                handleJoinResponse(msg as unknown as WebRtcJoinResponse);
                return;
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
              deliverInbound(msg);
            });
          } catch {}
        });
      } catch {}
    }
  });
}

// Pre-warm shared WSS relay in browser environments so lobby discovery & room joins have 0ms setup delay
if (typeof window !== 'undefined' && typeof WebSocket !== 'undefined') {
  getSharedWssRelay();
}
