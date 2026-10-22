import { MultiplayerRoomManager, normalizeRoomCode } from '../src/game/multiplayer.ts';

// Shared warm-instance room manager for Vercel Serverless Functions
const globalScope = globalThis;
if (!globalScope.__vanguardRoomManager) {
  globalScope.__vanguardRoomManager = new MultiplayerRoomManager();
}
const roomManager = globalScope.__vanguardRoomManager;

export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname.replace(/\/+$/, '');
  const now = Date.now();
  roomManager.tickRooms(now);

  if (req.method === 'GET' && pathname.endsWith('/api/multiplayer/rooms')) {
    const waitingRooms = roomManager.listPublicWaitingRooms().map((r) => ({
      code: r.code,
      hostCallsign: r.host.callsign,
      hostOperative: r.host.operative,
      createdAt: r.createdAt,
    }));
    res.status(200).json({
      ok: true,
      waitingRooms,
      serverTime: now,
    });
    return;
  }

  const roomMatch = pathname.match(/\/api\/multiplayer\/room\/([A-Za-z0-9_-]+)$/);
  if (req.method === 'GET' && roomMatch) {
    const code = normalizeRoomCode(roomMatch[1]);
    const room = roomManager.getRoom(code);
    if (!room) {
      res.status(404).json({ ok: false, error: 'Room not found.' });
      return;
    }
    res.status(200).json({ ok: true, room, serverTime: now });
    return;
  }

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};

  if (req.method === 'POST' && pathname.endsWith('/api/multiplayer/create')) {
    const { playerId, callsign, operative, isPublicQueue, preferredCode } = body;
    if (!playerId) {
      res.status(400).json({ ok: false, error: 'Missing playerId.' });
      return;
    }
    const validOp = operative === 'kai' || operative === 'nyx' ? operative : 'vex';
    const room = roomManager.createRoom({
      playerId: String(playerId),
      callsign: String(callsign || 'ALPHA-01'),
      operative: validOp,
      isPublicQueue: Boolean(isPublicQueue),
      preferredCode: preferredCode ? String(preferredCode) : undefined,
      now,
    });
    res.status(200).json({
      ok: true,
      room,
      role: 'host',
      serverTime: now,
    });
    return;
  }

  if (req.method === 'POST' && pathname.endsWith('/api/multiplayer/join')) {
    const { code, playerId, callsign, operative } = body;
    if (!playerId || !code) {
      res.status(400).json({ ok: false, error: 'Room code and playerId are required.' });
      return;
    }
    const validOp = operative === 'kai' || operative === 'nyx' ? operative : 'vex';
    const result = roomManager.joinRoomByCode({
      code: String(code),
      playerId: String(playerId),
      callsign: String(callsign || 'BRAVO-02'),
      operative: validOp,
      now,
    });
    if (!result.ok) {
      res.status(400).json({ ok: false, error: result.error });
      return;
    }
    res.status(200).json({
      ok: true,
      room: result.room,
      role: result.role,
      serverTime: now,
    });
    return;
  }

  if (req.method === 'POST' && pathname.endsWith('/api/multiplayer/quickmatch')) {
    const { playerId, callsign, operative } = body;
    if (!playerId) {
      res.status(400).json({ ok: false, error: 'Missing playerId.' });
      return;
    }
    const validOp = operative === 'kai' || operative === 'nyx' ? operative : 'vex';
    const result = roomManager.enqueueQuickMatch({
      playerId: String(playerId),
      callsign: String(callsign || 'OPERATIVE'),
      operative: validOp,
      now,
    });
    res.status(200).json({
      ok: true,
      room: result.room,
      role: result.role,
      matchedImmediately: result.matchedImmediately,
      serverTime: now,
    });
    return;
  }

  if (req.method === 'POST' && pathname.endsWith('/api/multiplayer/event')) {
    const code = normalizeRoomCode(String(body.code || ''));
    const role = body.role === 'guest' ? 'guest' : 'host';
    const room = roomManager.getRoom(code);
    if (!room) {
      res.status(404).json({ ok: false, error: `Room ${code} not found.` });
      return;
    }

    if (body.type === 'mp:state') {
      roomManager.updatePlayerTelemetry(
        code,
        role,
        {
          x: body.x,
          y: body.y,
          z: body.z,
          vx: body.vx,
          vz: body.vz,
          yaw: body.yaw,
          pitch: body.pitch,
          weaponId: body.weaponId,
          armor: body.armor,
          armorType: body.armorType,
          credits: body.credits,
          isCrouching: body.isCrouching,
          isSliding: body.isSliding,
          isReloading: body.isReloading,
        },
        now
      );
      res.status(200).json({ ok: true, room, serverTime: now });
      return;
    }

    if (body.type === 'mp:hit') {
      const dmgEvent = roomManager.applyHitDamage({
        code,
        attackerRole: role,
        weaponId: body.weaponId || 'pistol',
        rawDamage: Number(body.rawDamage) || 26,
        isHeadshot: Boolean(body.isHeadshot),
        distance: Number(body.distance) || 10,
        hitX: Number(body.hitX) || 0,
        hitY: Number(body.hitY) || 1,
        hitZ: Number(body.hitZ) || 0,
        now,
      });
      const updatedRoom = roomManager.getRoom(code);
      res.status(200).json({
        ok: true,
        event: dmgEvent,
        room: updatedRoom,
        serverTime: now,
      });
      return;
    }

    if (body.type === 'mp:deploy_now') {
      if (room.roundPhase === 'buy') {
        room.roundPhase = 'combat';
        room.phaseEndsAt = now + 95000;
        room.announcement = 'COMBAT LIVE // ELIMINATE RIVAL OPERATIVE';
        room.updatedAt = now;
      }
      res.status(200).json({ ok: true, room, serverTime: now });
      return;
    }

    if (body.type === 'mp:rematch') {
      roomManager.startMatchInRoom(room, now);
      res.status(200).json({ ok: true, room, serverTime: now });
      return;
    }

    res.status(200).json({ ok: true, room, serverTime: now });
    return;
  }

  if (req.method === 'POST' && pathname.endsWith('/api/multiplayer/leave')) {
    const { code, playerId } = body;
    const norm = normalizeRoomCode(String(code || ''));
    const room = roomManager.getRoom(norm);
    if (room) {
      if (playerId && room.guest && room.guest.playerId === playerId) {
        room.guest = null;
        room.status = 'waiting';
        room.updatedAt = now;
      } else if (playerId && room.host.playerId === playerId) {
        room.status = 'abandoned';
        room.updatedAt = now;
      }
    }
    res.status(200).json({ ok: true });
    return;
  }

  res.status(404).json({ ok: false, error: 'Endpoint not found.' });
}
