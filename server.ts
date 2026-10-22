import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocket, WebSocketServer } from 'ws';
import {
  MultiplayerRole,
  MultiplayerRoomManager,
  MultiplayerRoomState,
  normalizeRoomCode,
} from './src/game/multiplayer.ts';
import { OperativeId, WeaponId } from './src/game/types.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface SocketSession {
  ws: WebSocket;
  code: string;
  playerId: string;
  role: MultiplayerRole;
}

async function startServer() {
  const app = express();
  app.use(express.json());

  // Allow cross-origin requests when frontend is hosted separately from backend
  app.use('/api', (req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }
    next();
  });

  const httpServer = http.createServer(app);
  const roomManager = new MultiplayerRoomManager();
  const roomSockets = new Map<string, Set<SocketSession>>();

  const broadcastToRoom = (
    code: string,
    payload: Record<string, unknown>,
    excludeWs?: WebSocket
  ) => {
    const norm = normalizeRoomCode(code);
    const sessions = roomSockets.get(norm);
    if (!sessions) return;
    const message = JSON.stringify(payload);
    for (const sess of sessions) {
      if (sess.ws !== excludeWs && sess.ws.readyState === WebSocket.OPEN) {
        sess.ws.send(message);
      }
    }
  };

  const broadcastRoomSync = (room: MultiplayerRoomState) => {
    broadcastToRoom(room.code, {
      type: 'mp:room_sync',
      room,
      serverTime: Date.now(),
    });
  };

  // ==========================================================================
  // REST API ENDPOINTS FOR CODE-BASED 1V1 MATCHMAKING & LOBBY DISCOVERY
  // ==========================================================================
  app.get('/api/multiplayer/rooms', (_req, res) => {
    const waitingRooms = roomManager.listPublicWaitingRooms().map((r) => ({
      code: r.code,
      hostCallsign: r.host.callsign,
      hostOperative: r.host.operative,
      createdAt: r.createdAt,
    }));
    res.json({
      ok: true,
      waitingRooms,
      serverTime: Date.now(),
    });
  });

  app.get('/api/multiplayer/room/:code', (req, res) => {
    const room = roomManager.getRoom(req.params.code);
    if (!room) {
      res.status(404).json({ ok: false, error: 'Room not found.' });
      return;
    }
    res.json({ ok: true, room, serverTime: Date.now() });
  });

  app.post('/api/multiplayer/create', (req, res) => {
    const { playerId, callsign, operative, isPublicQueue, preferredCode } = req.body || {};
    if (!playerId) {
      res.status(400).json({ ok: false, error: 'Missing playerId.' });
      return;
    }
    const validOp: OperativeId =
      operative === 'kai' || operative === 'nyx' ? operative : 'vex';
    const room = roomManager.createRoom({
      playerId: String(playerId),
      callsign: String(callsign || 'ALPHA-01'),
      operative: validOp,
      isPublicQueue: Boolean(isPublicQueue),
      preferredCode: preferredCode ? String(preferredCode) : undefined,
    });
    res.json({
      ok: true,
      room,
      role: 'host' as MultiplayerRole,
      serverTime: Date.now(),
    });
  });

  app.post('/api/multiplayer/join', (req, res) => {
    const { code, playerId, callsign, operative } = req.body || {};
    if (!playerId || !code) {
      res.status(400).json({ ok: false, error: 'Room code and playerId are required.' });
      return;
    }
    const validOp: OperativeId =
      operative === 'kai' || operative === 'nyx' ? operative : 'vex';
    const result = roomManager.joinRoomByCode({
      code: String(code),
      playerId: String(playerId),
      callsign: String(callsign || 'BRAVO-02'),
      operative: validOp,
    });
    if (!result.ok) {
      res.status(400).json({ ok: false, error: result.error });
      return;
    }
    broadcastRoomSync(result.room);
    res.json({
      ok: true,
      room: result.room,
      role: result.role,
      serverTime: Date.now(),
    });
  });

  app.post('/api/multiplayer/quickmatch', (req, res) => {
    const { playerId, callsign, operative } = req.body || {};
    if (!playerId) {
      res.status(400).json({ ok: false, error: 'Missing playerId.' });
      return;
    }
    const validOp: OperativeId =
      operative === 'kai' || operative === 'nyx' ? operative : 'vex';
    const result = roomManager.enqueueQuickMatch({
      playerId: String(playerId),
      callsign: String(callsign || 'OPERATIVE'),
      operative: validOp,
    });
    broadcastRoomSync(result.room);
    res.json({
      ok: true,
      room: result.room,
      role: result.role,
      matchedImmediately: result.matchedImmediately,
      serverTime: Date.now(),
    });
  });

  // HTTP Event Fallback Endpoint when WebSocket upgrades are blocked by proxies
  app.post('/api/multiplayer/event', (req, res) => {
    const msg = req.body || {};
    const code = normalizeRoomCode(String(msg.code || ''));
    const role: MultiplayerRole = msg.role === 'guest' ? 'guest' : 'host';
    const room = roomManager.getRoom(code);
    if (!room) {
      res.status(404).json({ ok: false, error: `Room ${code} not found.` });
      return;
    }

    if (msg.type === 'mp:state') {
      const updated = roomManager.updatePlayerTelemetry(code, role, {
        x: msg.x,
        y: msg.y,
        z: msg.z,
        vx: msg.vx,
        vz: msg.vz,
        yaw: msg.yaw,
        pitch: msg.pitch,
        weaponId: msg.weaponId,
        armor: msg.armor,
        armorType: msg.armorType,
        credits: msg.credits,
        isCrouching: msg.isCrouching,
        isSliding: msg.isSliding,
        isReloading: msg.isReloading,
      });
      if (updated) {
        broadcastToRoom(code, {
          type: 'mp:remote_state',
          role,
          player: updated,
          serverTime: Date.now(),
        });
      }
      res.json({ ok: true, room, serverTime: Date.now() });
      return;
    }

    if (msg.type === 'mp:shoot') {
      broadcastToRoom(code, {
        type: 'mp:remote_shoot',
        role,
        weaponId: msg.weaponId,
        originX: msg.originX,
        originY: msg.originY,
        originZ: msg.originZ,
        endX: msg.endX,
        endY: msg.endY,
        endZ: msg.endZ,
      });
      res.json({ ok: true, serverTime: Date.now() });
      return;
    }

    if (msg.type === 'mp:hit') {
      const dmgEvent = roomManager.applyHitDamage({
        code,
        attackerRole: role,
        weaponId: (msg.weaponId as WeaponId) || 'pistol',
        rawDamage: Number(msg.rawDamage) || 26,
        isHeadshot: Boolean(msg.isHeadshot),
        distance: Number(msg.distance) || 10,
        hitX: Number(msg.hitX) || 0,
        hitY: Number(msg.hitY) || 1,
        hitZ: Number(msg.hitZ) || 0,
      });
      const updatedRoom = roomManager.getRoom(code);
      if (dmgEvent && updatedRoom) {
        broadcastToRoom(code, {
          type: 'mp:damage',
          event: dmgEvent,
          room: updatedRoom,
          serverTime: Date.now(),
        });
      }
      res.json({
        ok: true,
        event: dmgEvent,
        room: updatedRoom,
        serverTime: Date.now(),
      });
      return;
    }

    if (msg.type === 'mp:deploy_now') {
      if (room.roundPhase === 'buy') {
        room.roundPhase = 'combat';
        room.phaseEndsAt = Date.now() + 95_000;
        room.announcement = 'COMBAT LIVE // ELIMINATE RIVAL OPERATIVE';
        broadcastRoomSync(room);
      }
      res.json({ ok: true, room, serverTime: Date.now() });
      return;
    }

    if (msg.type === 'mp:rematch') {
      roomManager.startMatchInRoom(room, Date.now());
      broadcastRoomSync(room);
      res.json({ ok: true, room, serverTime: Date.now() });
      return;
    }

    res.json({ ok: true, room, serverTime: Date.now() });
  });

  app.post('/api/multiplayer/leave', (req, res) => {
    const { code, playerId } = req.body || {};
    const norm = normalizeRoomCode(String(code || ''));
    const room = roomManager.getRoom(norm);
    if (room) {
      if (playerId && room.guest && room.guest.playerId === playerId) {
        room.guest = null;
        room.status = 'waiting';
        room.updatedAt = Date.now();
      } else if (playerId && room.host.playerId === playerId) {
        room.status = 'abandoned';
        room.updatedAt = Date.now();
      }
      broadcastRoomSync(room);
    }
    res.json({ ok: true });
  });

  // ==========================================================================
  // WEBSOCKET SERVER (/ws/match) FOR REAL-TIME 1V1 COMBAT & STATE SYNC
  // ==========================================================================
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', (request, socket, head) => {
    const reqUrl = request.url || '';
    if (reqUrl.startsWith('/ws/match')) {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    }
  });

  wss.on('connection', (ws: WebSocket) => {
    let activeSession: SocketSession | null = null;

    ws.on('message', (rawBuf) => {
      try {
        const msg = JSON.parse(String(rawBuf));
        if (!msg || typeof msg.type !== 'string') return;

        if (msg.type === 'mp:ping') {
          if (activeSession && typeof msg.lastRttMs === 'number') {
            roomManager.updatePlayerTelemetry(activeSession.code, activeSession.role, {
              pingMs: msg.lastRttMs,
            });
          }
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(
              JSON.stringify({
                type: 'mp:pong',
                clientSentAt: msg.clientSentAt,
                serverTime: Date.now(),
              })
            );
          }
          return;
        }

        if (msg.type === 'mp:join_socket') {
          const code = normalizeRoomCode(String(msg.code || ''));
          const playerId = String(msg.playerId || '');
          const room = roomManager.getRoom(code);
          if (!room) {
            ws.send(
              JSON.stringify({
                type: 'mp:error',
                error: `Room ${code} no longer exists.`,
              })
            );
            return;
          }

          let role: MultiplayerRole = 'host';
          if (room.host.playerId === playerId) {
            role = 'host';
            room.host.connected = true;
            room.host.lastSeenAt = Date.now();
          } else if (room.guest && room.guest.playerId === playerId) {
            role = 'guest';
            room.guest.connected = true;
            room.guest.lastSeenAt = Date.now();
          } else if (msg.role === 'guest' && room.guest) {
            role = 'guest';
            room.guest.connected = true;
          }

          activeSession = { ws, code, playerId, role };
          let set = roomSockets.get(code);
          if (!set) {
            set = new Set();
            roomSockets.set(code, set);
          }
          set.add(activeSession);

          broadcastRoomSync(room);
          return;
        }

        if (!activeSession) return;
        const { code, role } = activeSession;

        if (msg.type === 'mp:state') {
          const updated = roomManager.updatePlayerTelemetry(code, role, {
            x: msg.x,
            y: msg.y,
            z: msg.z,
            vx: msg.vx,
            vz: msg.vz,
            yaw: msg.yaw,
            pitch: msg.pitch,
            weaponId: msg.weaponId,
            armor: msg.armor,
            armorType: msg.armorType,
            credits: msg.credits,
            isCrouching: msg.isCrouching,
            isSliding: msg.isSliding,
            isReloading: msg.isReloading,
          });
          if (updated) {
            broadcastToRoom(
              code,
              {
                type: 'mp:remote_state',
                role,
                player: updated,
                serverTime: Date.now(),
              },
              ws
            );
          }
          return;
        }

        if (msg.type === 'mp:shoot') {
          broadcastToRoom(
            code,
            {
              type: 'mp:remote_shoot',
              role,
              weaponId: msg.weaponId,
              originX: msg.originX,
              originY: msg.originY,
              originZ: msg.originZ,
              endX: msg.endX,
              endY: msg.endY,
              endZ: msg.endZ,
            },
            ws
          );
          return;
        }

        if (msg.type === 'mp:hit') {
          const dmgEvent = roomManager.applyHitDamage({
            code,
            attackerRole: role,
            weaponId: (msg.weaponId as WeaponId) || 'pistol',
            rawDamage: Number(msg.rawDamage) || 26,
            isHeadshot: Boolean(msg.isHeadshot),
            distance: Number(msg.distance) || 10,
            hitX: Number(msg.hitX) || 0,
            hitY: Number(msg.hitY) || 1,
            hitZ: Number(msg.hitZ) || 0,
          });
          const room = roomManager.getRoom(code);
          if (dmgEvent && room) {
            broadcastToRoom(code, {
              type: 'mp:damage',
              event: dmgEvent,
              room,
              serverTime: Date.now(),
            });
          }
          return;
        }

        if (msg.type === 'mp:deploy_now') {
          const room = roomManager.getRoom(code);
          if (room && room.roundPhase === 'buy') {
            room.roundPhase = 'combat';
            room.phaseEndsAt = Date.now() + 95_000;
            room.announcement = 'COMBAT LIVE // ELIMINATE RIVAL OPERATIVE';
            broadcastRoomSync(room);
          }
          return;
        }

        if (msg.type === 'mp:rematch') {
          const room = roomManager.getRoom(code);
          if (room) {
            roomManager.startMatchInRoom(room, Date.now());
            broadcastRoomSync(room);
          }
          return;
        }
      } catch {}
    });

    ws.on('close', () => {
      if (!activeSession) return;
      const { code, role } = activeSession;
      const set = roomSockets.get(code);
      if (set) {
        set.delete(activeSession);
        if (set.size === 0) {
          roomSockets.delete(code);
        }
      }
      const room = roomManager.getRoom(code);
      if (room) {
        if (role === 'host') {
          room.host.connected = false;
        } else if (room.guest) {
          room.guest.connected = false;
        }
        broadcastRoomSync(room);
      }
    });
  });

  // Authoritative Server Phase & Round Timer Loop (200ms cadence)
  setInterval(() => {
    const transitions = roomManager.tickRooms(Date.now());
    for (const tr of transitions) {
      broadcastRoomSync(tr.room);
    }
  }, 200);

  // ==========================================================================
  // VITE DEV MIDDLEWARE OR PRODUCTION STATIC ASSETS
  // ==========================================================================
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const PORT = Number(process.env.PORT) || 3000;
  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`VANGUARD 1v1 Tactical Server & Matchmaking live on http://0.0.0.0:${PORT}`);
  });
}

startServer();
