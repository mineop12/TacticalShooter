import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isValidRoomCode,
  MultiplayerRoomManager,
  normalizeRoomCode,
} from './multiplayer.ts';
import {
  createRoomClient,
  fetchWaitingRoomsClient,
  fillWithSimulatedChallengerClient,
  joinRoomByCodeClient,
  leaveMultiplayerRoomClient,
  quickMatchClient,
  subscribeLocalMultiplayerEvents,
} from './multiplayerClient.ts';
import {
  calculateDamageWithArmor,
  calculateRoundEconomy,
  canPurchaseArmor,
  canPurchaseWeapon,
  checkMatchVictory,
  computeFireCyclePose,
  computeRopeSwingStep,
  computeSlideVelocityFactor,
  computeSubtleAimAssist,
  computeWallJumpImpulse,
  computeWallRunStep,
  computeWeaponInspectPose,
  computeWeaponReloadPose,
  cycleWeaponSelection,
  detectRunnableWall,
  evaluateAITacticalState,
  findBestRopeAnchor,
  findBestTacticalWaypoint,
  findSupportFloorHeight,
  hasCorridorClearance,
  hasLineOfSight,
  reconcileAnimatedKillFeed,
  resolveCircleAABBCollision,
  resolveKillFeedWeaponId,
  selectAICombatWeapon,
  selectAILoadoutForRound,
} from './rules';
import { AABB, KillFeedEntry, RopeAnchor, Waypoint, WeaponId, WeaponInstanceState } from './types';

test('calculateDamageWithArmor applies 66% shield absorption and eliminates at 0 HP', () => {
  const unarmored = calculateDamageWithArmor(160, 100, 0, 10, 100, 50);
  assert.equal(unarmored.totalDamage, 160);
  assert.equal(unarmored.newHealth, 0);
  assert.equal(unarmored.eliminated, true);

  const armoredBody = calculateDamageWithArmor(40, 100, 50, 12, 100, 50);
  assert.equal(armoredBody.totalDamage, 40);
  assert.equal(armoredBody.armorDamage, 26);
  assert.equal(armoredBody.healthDamage, 14);
  assert.equal(armoredBody.newArmor, 24);
  assert.equal(armoredBody.newHealth, 86);
  assert.equal(armoredBody.eliminated, false);

  const armoredHead = calculateDamageWithArmor(160, 100, 50, 15, 100, 50);
  assert.equal(armoredHead.newHealth, 0);
  assert.equal(armoredHead.eliminated, true);
});

test('calculateRoundEconomy awards win/loss streak credits and caps at 9000', () => {
  const winRes = calculateRoundEconomy(800, true, 1, 1);
  assert.equal(winRes.nextCredits, 4000);
  assert.equal(winRes.nextLossStreak, 0);

  const loss1 = calculateRoundEconomy(800, false, 0, 0);
  assert.equal(loss1.nextCredits, 2700);
  assert.equal(loss1.nextLossStreak, 1);

  const loss2 = calculateRoundEconomy(2700, false, 1, 0);
  assert.equal(loss2.nextCredits, 5100);
  assert.equal(loss2.nextLossStreak, 2);

  const capped = calculateRoundEconomy(8500, true, 0, 1);
  assert.equal(capped.nextCredits, 9000);
});

test('canPurchaseWeapon and canPurchaseArmor validate credits and existing inventory', () => {
  const owned: Record<WeaponId, WeaponInstanceState | null> = {
    pistol: { id: 'pistol', ammoInMag: 12, ammoReserve: 36 },
    smg: null,
    shotgun: null,
    rifle: null,
    sniper: null,
  };

  assert.equal(canPurchaseWeapon(800, owned, 'rifle').allowed, false);
  assert.equal(canPurchaseWeapon(3000, owned, 'rifle').allowed, true);
  assert.equal(canPurchaseWeapon(3000, owned, 'pistol').allowed, false);

  assert.equal(canPurchaseArmor(300, 0, 'none', 'light').allowed, false);
  assert.equal(canPurchaseArmor(400, 0, 'none', 'light').allowed, true);
  assert.equal(canPurchaseArmor(1000, 50, 'heavy', 'heavy').allowed, false);
});

test('hasLineOfSight blocks vision through walls and allows clear sightlines', () => {
  const wall: AABB = {
    id: 'mid_wall',
    minX: -4,
    maxX: 4,
    minY: 0,
    maxY: 3.5,
    minZ: -1,
    maxZ: 1,
  };

  const blocked = hasLineOfSight(0, 1.5, -10, 0, 1.5, 10, [wall]);
  assert.equal(blocked, false);

  const clear = hasLineOfSight(-12, 1.5, -10, -12, 1.5, 10, [wall]);
  assert.equal(clear, true);
});

test('resolveCircleAABBCollision prevents walking through solid walls', () => {
  const crate: AABB = {
    id: 'crate',
    minX: -1,
    maxX: 1,
    minY: 0,
    maxY: 2,
    minZ: -1,
    maxZ: 1,
  };

  const res = resolveCircleAABBCollision(1.2, 0, 0, 1.8, 0.45, [crate]);
  assert.equal(res.collided, true);
  assert.ok(res.x >= 1.44);
});

test('checkMatchVictory triggers at 13 rounds', () => {
  assert.equal(checkMatchVictory(12, 11), null);
  assert.equal(checkMatchVictory(13, 8), 'PLAYER');
  assert.equal(checkMatchVictory(4, 13), 'AI');
});

test('evaluateAITacticalState transitions to reload, attack, and cover appropriately', () => {
  assert.equal(
    evaluateAITacticalState({
      currentState: 'attack',
      hp: 100,
      ammoInMag: 0,
      hasLOS: true,
      timeSinceLastSawPlayer: 0,
      difficulty: 'normal',
    }),
    'reload'
  );

  assert.equal(
    evaluateAITacticalState({
      currentState: 'patrol',
      hp: 100,
      ammoInMag: 25,
      hasLOS: true,
      timeSinceLastSawPlayer: 0,
      difficulty: 'hard',
    }),
    'attack'
  );

  assert.equal(
    evaluateAITacticalState({
      currentState: 'attack',
      hp: 20,
      ammoInMag: 15,
      hasLOS: false,
      timeSinceLastSawPlayer: 1.2,
      difficulty: 'normal',
    }),
    'cover'
  );
});

test('selectAILoadoutForRound purchases appropriate tier weapons and shields', () => {
  const eco = selectAILoadoutForRound(800, null);
  assert.equal(eco.weaponId, 'pistol');
  assert.equal(eco.armorType, 'light');

  const fullBuy = selectAILoadoutForRound(4200, null);
  assert.equal(fullBuy.weaponId, 'rifle');
  assert.equal(fullBuy.armorType, 'heavy');
});

test('computeWeaponInspectPose produces distinct 3-phase rotation, slide check, and settles to zero', () => {
  const startPose = computeWeaponInspectPose(0);
  assert.equal(startPose.rotY, 0);
  assert.equal(startPose.rotZ, 0);

  const phase1Peak = computeWeaponInspectPose(0.38);
  assert.ok(phase1Peak.rotY > 0.5);
  assert.ok(phase1Peak.rotZ > 0.4);
  assert.ok(phase1Peak.posY > 0.08);

  const phase2Mid = computeWeaponInspectPose(0.58);
  assert.ok(phase2Mid.slidePullBack > 0.01);

  const phase2Peak = computeWeaponInspectPose(0.78);
  assert.ok(phase2Peak.rotY < -0.4);
  assert.ok(phase2Peak.rotZ < -0.4);

  const endPose = computeWeaponInspectPose(1.0);
  assert.equal(endPose.rotY, 0);
  assert.equal(endPose.rotZ, 0);
});

test('computeWeaponReloadPose animates magazine drop, seating, and slide rack before settling', () => {
  const startPose = computeWeaponReloadPose(0);
  assert.equal(startPose.magOffsetY, 0);
  assert.equal(startPose.slidePullBack, 0);

  const magOut = computeWeaponReloadPose(0.28);
  assert.ok(magOut.magOffsetY < -0.2);

  const slideRack = computeWeaponReloadPose(0.75);
  assert.equal(slideRack.magOffsetY, 0);
  assert.ok(slideRack.slidePullBack > 0.04);

  const endPose = computeWeaponReloadPose(1.0);
  assert.equal(endPose.magOffsetY, 0);
  assert.equal(endPose.slidePullBack, 0);
});

test('findBestTacticalWaypoint routes via connected graph hops around walls instead of through walls', () => {
  const wallBetweenNorthAndSouth: AABB = {
    id: 'wall_mid',
    minX: -10,
    maxX: 10,
    minY: 0,
    maxY: 4,
    minZ: -1,
    maxZ: 1,
  };
  const waypoints: Waypoint[] = [
    { id: 'wp_north', x: 0, z: -10, isCover: false, zone: 'north_spawn', neighbors: ['wp_flank'] },
    { id: 'wp_flank', x: 15, z: 0, isCover: true, zone: 'east_flank', neighbors: ['wp_north', 'wp_south'] },
    { id: 'wp_south', x: 0, z: 10, isCover: true, zone: 'mid', neighbors: ['wp_flank'] },
  ];

  // AI at (0, -10) wants to reach threat at (0, 12), but wall_mid blocks direct path to wp_south.
  // BFS must return wp_flank as the immediate reachable next hop!
  const nextHop = findBestTacticalWaypoint(0, -10, 0, 12, waypoints, [wallBetweenNorthAndSouth], 'patrol');
  assert.equal(nextHop.id, 'wp_flank');
});

test('computeSlideVelocityFactor starts with high burst speed and decelerates smoothly', () => {
  const startBoost = computeSlideVelocityFactor(0);
  const midBoost = computeSlideVelocityFactor(0.5);
  const endBoost = computeSlideVelocityFactor(1.0);
  assert.ok(startBoost > 1.35);
  assert.ok(midBoost < startBoost && midBoost > endBoost);
  assert.ok(Math.abs(endBoost - 0.52) < 0.01);
});

test('selectAICombatWeapon dynamically switches between primary weapon and sidearm based on ammo and range', () => {
  // Emergency sidearm draw when rifle runs empty in close LOS duel
  assert.equal(selectAICombatWeapon('rifle', 0, 12, 11.0, true), 'pistol');
  // Sniper switches to sidearm when player rushes within CQB (< 9.5m)
  assert.equal(selectAICombatWeapon('sniper', 5, 12, 6.5, true), 'pistol');
  // Sniper stays on sniper at long range
  assert.equal(selectAICombatWeapon('sniper', 5, 12, 22.0, true), 'sniper');
  // Shotgun switches to sidearm at long range (> 16.5m)
  assert.equal(selectAICombatWeapon('shotgun', 7, 12, 21.0, true), 'pistol');
});

test('hasCorridorClearance detects shoulder clipping against crate corners even when center ray is clear', () => {
  const cornerCrate: AABB = {
    id: 'corner_crate',
    minX: 0.25,
    maxX: 2.5,
    minY: 0,
    maxY: 2.0,
    minZ: -1.0,
    maxZ: 1.0,
  };
  // Center line at X = 0 is clear, but a 0.54m shoulder corridor clips minX = 0.25!
  assert.equal(hasLineOfSight(0, 0.9, -4, 0, 0.9, 4, [cornerCrate]), true);
  assert.equal(hasCorridorClearance(0, -4, 0, 4, 0.54, [cornerCrate]), false);
  // Path at X = -1.0 has full 0.54m shoulder clearance
  assert.equal(hasCorridorClearance(-1.0, -4, -1.0, 4, 0.54, [cornerCrate]), true);
});

test('computeFireCyclePose animates shotgun pump forend and sniper bolt-action pull', () => {
  const shotgunPumpMid = computeFireCyclePose('shotgun', 0.58);
  assert.ok(shotgunPumpMid.slidePullBack > 0.05);
  assert.ok(shotgunPumpMid.leftArmOffsetZ > 0.05);

  const sniperBoltMid = computeFireCyclePose('sniper', 0.6);
  assert.ok(sniperBoltMid.slidePullBack > 0.06);
  assert.ok(sniperBoltMid.extraRotZ > 0.1);

  const settled = computeFireCyclePose('rifle', 1.0);
  assert.equal(settled.slidePullBack, 0);
  assert.equal(settled.leftArmOffsetZ, 0);
});

test('MultiplayerRoomManager creates 6-char code rooms, validates join codes, pairs quick-match, and resolves authoritative 1v1 combat', () => {
  assert.equal(normalizeRoomCode(' ab-7k9x '), 'AB7K9X');
  assert.equal(isValidRoomCode('AB7K9X'), true);
  assert.equal(isValidRoomCode('SHORT'), false);

  const mgr = new MultiplayerRoomManager();
  const room = mgr.createRoom({
    playerId: 'host_1',
    callsign: 'vanguard_alpha',
    operative: 'vex',
    preferredCode: 'VG1234',
    now: 1000,
  });

  assert.equal(room.code, 'VG1234');
  assert.equal(room.status, 'waiting');
  assert.equal(room.host.callsign, 'VANGUARD_ALPHA');

  // Joining with invalid code fails cleanly
  const badJoin = mgr.joinRoomByCode({
    code: '99',
    playerId: 'guest_1',
    callsign: 'bravo',
    operative: 'kai',
  });
  assert.equal(badJoin.ok, false);

  // Valid second player joins by code and starts active 1v1 match
  const joinRes = mgr.joinRoomByCode({
    code: 'vg-1234',
    playerId: 'guest_1',
    callsign: 'bravo_two',
    operative: 'kai',
    now: 2000,
  });
  assert.equal(joinRes.ok, true);
  if (joinRes.ok) {
    assert.equal(joinRes.role, 'guest');
    assert.equal(joinRes.room.status, 'active');
    assert.equal(joinRes.room.guest?.callsign, 'BRAVO_TWO');
  }

  // Third player attempting to join full 1v1 room is rejected
  const thirdPlayer = mgr.joinRoomByCode({
    code: 'VG1234',
    playerId: 'intruder_3',
    callsign: 'charlie',
    operative: 'nyx',
    now: 2500,
  });
  assert.equal(thirdPlayer.ok, false);

  // Authoritative hit damage & elimination awards round score and economy credits
  const hitEvent = mgr.applyHitDamage({
    code: 'VG1234',
    attackerRole: 'host',
    weaponId: 'sniper',
    rawDamage: 255,
    isHeadshot: true,
    distance: 18,
    hitX: 0,
    hitY: 1.6,
    hitZ: -15,
    now: 3000,
  });
  assert.ok(hitEvent);
  assert.equal(hitEvent.eliminated, true);
  assert.equal(hitEvent.roundEnded, true);
  assert.equal(hitEvent.roundWinner, 'host');
  assert.equal(room.hostScore, 1);
  assert.equal(room.guestScore, 0);
  assert.ok(room.host.credits > 800);

  // Quick-match queue pairs waiting public players automatically
  const q1 = mgr.enqueueQuickMatch({
    playerId: 'qm_p1',
    callsign: 'SOLO_1',
    operative: 'vex',
    now: 4000,
  });
  assert.equal(q1.matchedImmediately, false);
  assert.equal(q1.role, 'host');

  const q2 = mgr.enqueueQuickMatch({
    playerId: 'qm_p2',
    callsign: 'SOLO_2',
    operative: 'nyx',
    now: 4500,
  });
  assert.equal(q2.matchedImmediately, true);
  assert.equal(q2.role, 'guest');
  assert.equal(q2.room.code, q1.room.code);
  assert.equal(q2.room.status, 'active');
});

test('reconcileAnimatedKillFeed manages entering, expiring, displaced exiting, and pruned kill feed items', () => {
  const k1: KillFeedEntry = {
    id: 'kill_1',
    killer: 'PLAYER',
    victim: 'AI',
    weaponName: 'Vanguard-47',
    isHeadshot: true,
    timestamp: 1000,
  };
  const k2: KillFeedEntry = {
    id: 'kill_2',
    killer: 'AI',
    victim: 'PLAYER',
    weaponName: 'Operator-SR',
    isHeadshot: false,
    timestamp: 2000,
  };

  // 1. Initial entry starts in 'entering' phase
  const step1 = reconcileAnimatedKillFeed([], [k1], 1000, 4800, 280);
  assert.equal(step1.length, 1);
  assert.equal(step1[0].id, 'kill_1');
  assert.equal(step1[0].phase, 'entering');

  // 2. Second kill arrives; both are in 'entering' phase
  const step2 = reconcileAnimatedKillFeed(step1, [k2, k1], 2000, 4800, 280);
  assert.equal(step2.length, 2);
  assert.equal(step2[0].id, 'kill_2');
  assert.equal(step2[0].phase, 'entering');
  assert.equal(step2[1].id, 'kill_1');
  assert.equal(step2[1].phase, 'entering');

  // 3. When k1 is removed from incoming feed (displaced or cleared), it transitions to 'exiting' instead of disappearing immediately
  const step3 = reconcileAnimatedKillFeed(step2, [k2], 3000, 4800, 280);
  assert.equal(step3.length, 2);
  assert.equal(step3[0].id, 'kill_2');
  assert.equal(step3[0].phase, 'entering');
  assert.equal(step3[1].id, 'kill_1');
  assert.equal(step3[1].phase, 'exiting');
  assert.equal(step3[1].exitStartedAt, 3000);

  // 4. After exitDurationMs (280ms), k1 is pruned while k2 remains until visibleDurationMs (4800ms)
  const step4 = reconcileAnimatedKillFeed(step3, [k2], 3300, 4800, 280);
  assert.equal(step4.length, 1);
  assert.equal(step4[0].id, 'kill_2');

  // 5. Once k2 exceeds visibleDurationMs (2000 + 4800 = 6800), it automatically transitions to 'exiting'
  const step5 = reconcileAnimatedKillFeed(step4, [k2], 6850, 4800, 280);
  assert.equal(step5.length, 1);
  assert.equal(step5[0].phase, 'exiting');

  // 6. After exitDurationMs (6850 + 280 = 7130), k2 is pruned cleanly
  const step6 = reconcileAnimatedKillFeed(step5, [k2], 7150, 4800, 280);
  assert.equal(step6.length, 0);

  // Verify weapon icon resolution from weaponId or weaponName
  assert.equal(resolveKillFeedWeaponId({ weaponId: 'sniper', weaponName: 'Operator-SR' }), 'sniper');
  assert.equal(resolveKillFeedWeaponId({ weaponName: 'Classic-9' }), 'pistol');
  assert.equal(resolveKillFeedWeaponId({ weaponName: 'Spectre-VX' }), 'smg');
  assert.equal(resolveKillFeedWeaponId({ weaponName: 'Judge-12' }), 'shotgun');
  assert.equal(resolveKillFeedWeaponId({ weaponName: 'Vandal-AR' }), 'rifle');
});

test('multiplayerClient seamlessly falls back to local-mesh authority when hosted on static server or network fails', async () => {
  const origFetch = globalThis.fetch;
  try {
    // Simulate static host returning 404 HTML page for /api/multiplayer/*
    globalThis.fetch = (async () =>
      new Response('<!DOCTYPE html><html><body>404 Not Found</body></html>', {
        status: 404,
        headers: { 'content-type': 'text/html' },
      })) as typeof fetch;

    const created = await createRoomClient({
      playerId: 'static_host_1',
      callsign: 'VEX-HOST',
      operative: 'vex',
      isPublicQueue: true,
      preferredCode: 'ST9911',
    });

    assert.equal(created.ok, true);
    assert.ok(created.transportMode === 'webrtc' || created.transportMode === 'local-mesh');
    assert.equal(created.room.code, 'ST9911');
    assert.equal(created.role, 'host');

    const waiting = await fetchWaitingRoomsClient();
    assert.ok(waiting.transportMode === 'webrtc' || waiting.transportMode === 'local-mesh');
    assert.ok(waiting.waitingRooms.some((r) => r.code === 'ST9911'));

    // Simulate network rejection (e.g., offline / unreachable server)
    globalThis.fetch = (async () => {
      throw new Error('Failed to fetch');
    }) as typeof fetch;

    const joined = await joinRoomByCodeClient({
      code: 'st-9911',
      playerId: 'static_guest_2',
      callsign: 'NYX-GUEST',
      operative: 'nyx',
    });

    assert.equal(joined.ok, true);
    if (joined.ok) {
      assert.equal(joined.role, 'guest');
      assert.equal(joined.room.status, 'active');
      assert.equal(joined.room.guest?.callsign, 'NYX-GUEST');
    }

    // Quick match & simulated challenger fill also succeed without server
    const qm = await quickMatchClient({
      playerId: 'solo_qm_player',
      callsign: 'SOLO-QM',
      operative: 'kai',
    });
    assert.equal(qm.ok, true);
    assert.equal(qm.transportMode, 'local-mesh');

    const filled = await fillWithSimulatedChallengerClient(qm.room.code, 'kai');
    assert.ok(filled);
    assert.equal(filled.status, 'active');
    assert.equal(filled.guest?.callsign, 'PHANTOM-X9');
  } finally {
    globalThis.fetch = origFetch;
  }
});

test('cycleWeaponSelection cycles to next/prev owned weapons on mouse wheel and wraps around', () => {
  const owned = {
    pistol: { id: 'pistol', ammoInMag: 12, ammoReserve: 36 },
    rifle: { id: 'rifle', ammoInMag: 25, ammoReserve: 75 },
    sniper: { id: 'sniper', ammoInMag: 5, ammoReserve: 15 },
  };

  // From pistol (order: pistol, rifle, sniper):
  assert.equal(cycleWeaponSelection(owned, 'pistol', 'next'), 'rifle');
  assert.equal(cycleWeaponSelection(owned, 'rifle', 'next'), 'sniper');
  assert.equal(cycleWeaponSelection(owned, 'sniper', 'next'), 'pistol'); // wrap around

  // Previous (scroll up):
  assert.equal(cycleWeaponSelection(owned, 'pistol', 'prev'), 'sniper'); // wrap backwards
  assert.equal(cycleWeaponSelection(owned, 'sniper', 'prev'), 'rifle');
  assert.equal(cycleWeaponSelection(owned, 'rifle', 'prev'), 'pistol');

  // Single weapon owned: stays on that weapon
  const singleOwned = { pistol: { id: 'pistol', ammoInMag: 12, ammoReserve: 36 } };
  assert.equal(cycleWeaponSelection(singleOwned, 'pistol', 'next'), 'pistol');
  assert.equal(cycleWeaponSelection(singleOwned, 'pistol', 'prev'), 'pistol');
});

test('findSupportFloorHeight allows players to land on and walk across elevated platforms and crates', () => {
  const highPlatform: AABB = {
    id: 'catwalk_mid',
    minX: -2,
    maxX: 2,
    minY: 0,
    maxY: 2.8,
    minZ: -2,
    maxZ: 2,
  };

  // Player descending from y = 3.0 to y = 2.75 above the platform lands on y = 2.8
  assert.equal(findSupportFloorHeight(0, 0, 3.0, 2.75, 0.44, [highPlatform]), 2.8);

  // Player off the platform edge returns to ground level (0)
  assert.equal(findSupportFloorHeight(4.0, 0, 2.8, 2.6, 0.44, [highPlatform]), 0);
});

test('detectRunnableWall, computeWallRunStep, and computeWallJumpImpulse power wall-running and wall-jumping', () => {
  const wallPanel: AABB = {
    id: 'wallrun_west',
    minX: -13.2,
    maxX: -11.8,
    minY: 0,
    maxY: 4.5,
    minZ: -12,
    maxZ: 12,
    isWallRunPanel: true,
  };

  // Airborne player at x = -11.25 moving north (vz = -7.0, yaw = 0) near east face of wallPanel
  const contact = detectRunnableWall(-11.25, 1.5, 0, 0, -7.0, 0, [wallPanel]);
  assert.ok(contact);
  assert.equal(contact.wallId, 'wallrun_west');
  assert.equal(contact.normalX, 1);
  assert.equal(contact.normalZ, 0);
  assert.equal(contact.side, 'left'); // Wall is to the player's left when facing north

  // Wall-run step maintains fast forward glide along the wall and counteracts gravity
  const step = computeWallRunStep(0, -2.5, -7.0, contact, 0.2, 0.016);
  assert.equal(step.shouldDetach, false);
  assert.ok(Math.abs(step.vz) >= 8.2);
  assert.ok(step.vy > -1.0); // Reduced fall speed
  assert.ok(step.targetRoll > 0.1); // Camera tilts right when wall is on the left

  // Wall-jump impulse launches player upward and pushes away from the wall normal
  const jump = computeWallJumpImpulse(step.vx, step.vz, 0, contact);
  assert.ok(jump.vy >= 8.0);
  assert.ok(jump.vx >= 5.5); // Pushed away in +X normal direction
  assert.ok(jump.vz < -5.0); // Preserves forward northward momentum
});

test('findBestRopeAnchor and computeRopeSwingStep power 3D pendulum rope swinging while keeping gunplay active', () => {
  const anchors: RopeAnchor[] = [
    {
      id: 'rope_mid_bridge',
      label: 'MID SKYBRIDGE GRAPPLE',
      x: 0,
      y: 7.4,
      z: 0,
      ropeLength: 4.6,
      grabRadius: 9.5,
    },
  ];

  // Player approaching mid at (0, 1.2, 5.5) looking north/upward finds the overhead rope anchor
  const found = findBestRopeAnchor(0, 1.2, 5.5, 0, 0.25, anchors);
  assert.ok(found);
  assert.equal(found.id, 'rope_mid_bridge');

  // Swinging step constrains player harness (y + 1.2) to pendulum arc and accelerates forward swing
  const swing = computeRopeSwingStep(0, 2.8, 3.8, 0, -1.0, -6.5, 0, -1, found, 4.6, 0.05);
  assert.ok(swing.z < 3.8); // Moves northward along pendulum arc
  const distToAnchor = Math.hypot(swing.x - found.x, swing.y + 1.2 - found.y, swing.z - found.z);
  assert.ok(distToAnchor <= 4.65); // Constrained by rope length
  assert.ok(Math.hypot(swing.vx, swing.vy, swing.vz) > 4.0);
});

test('computeSubtleAimAssist provides gentle tracking nudge inside a narrow cone and ignores wide angles', () => {
  // Target is due North at (0, 0, -15) while player eye is at (0, 1.66, 0)
  // Looking slightly off-center (yaw = 0.035 rad ~ 2.0 deg, pitch = -0.01 rad) engages subtle assist
  const nearTarget = computeSubtleAimAssist(0, 1.66, 0, 0.035, -0.01, 0, 0, -15, 0.016, false);
  assert.equal(nearTarget.engaged, true);
  assert.ok(Math.abs(nearTarget.nextYaw) < 0.035); // Gently nudged closer to 0.0 ideal yaw
  assert.ok(nearTarget.sensitivityScale < 1.0 && nearTarget.sensitivityScale >= 0.82);
  assert.ok(nearTarget.magnetStrength > 0 && nearTarget.magnetStrength <= 0.35);

  // Looking far away from target (yaw = 0.35 rad ~ 20 deg) does not engage aim assist at all
  const farOff = computeSubtleAimAssist(0, 1.66, 0, 0.35, 0, 0, 0, -15, 0.016, true);
  assert.equal(farOff.engaged, false);
  assert.equal(farOff.nextYaw, 0.35);
  assert.equal(farOff.sensitivityScale, 1.0);
  assert.equal(farOff.magnetStrength, 0);
});

test('MultiplayerRoomManager cleans up older waiting rooms when the same host creates a new room', () => {
  const mgr = new MultiplayerRoomManager();
  const hostId = 'player_veteran_host';
  const room1 = mgr.createRoom({
    playerId: hostId,
    callsign: 'GHOST-01',
    operative: 'vex',
    isPublicQueue: true,
  });
  assert.equal(mgr.listPublicWaitingRooms().length, 1);
  assert.equal(mgr.listPublicWaitingRooms()[0].code, room1.code);

  // When same host creates another room, the old waiting room is automatically purged
  const room2 = mgr.createRoom({
    playerId: hostId,
    callsign: 'GHOST-01',
    operative: 'nyx',
    isPublicQueue: true,
  });
  assert.equal(mgr.listPublicWaitingRooms().length, 1);
  assert.equal(mgr.listPublicWaitingRooms()[0].code, room2.code);
  assert.equal(mgr.getRoom(room1.code), undefined);
});

test('MultiplayerRoomManager applies damage with unique eventId and updates player identity on reconnect', () => {
  const mgr = new MultiplayerRoomManager();
  const room = mgr.createRoom({
    playerId: 'host_p1',
    callsign: 'ALPHA-01',
    operative: 'vex',
    isPublicQueue: false,
    preferredCode: 'TST111',
  });
  mgr.joinRoomByCode({
    code: 'TST111',
    playerId: 'guest_p2',
    callsign: 'BRAVO-02',
    operative: 'kai',
  });

  // Start match
  mgr.startMatchInRoom(room, Date.now());

  // Apply hit damage with eventId
  const dmg = mgr.applyHitDamage({
    code: 'TST111',
    attackerRole: 'host',
    weaponId: 'rifle',
    rawDamage: 40,
    isHeadshot: false,
    distance: 12,
    hitX: 0,
    hitY: 1.2,
    hitZ: 0,
  });
  assert.ok(dmg);
  assert.ok(dmg.eventId.startsWith('dmg_'));
  assert.equal(dmg.attackerRole, 'host');
  assert.equal(dmg.victimRole, 'guest');
  assert.equal(dmg.damageApplied, 40);

  // Guest reconnects with updated callsign/operative
  const reconnected = mgr.joinRoomByCode({
    code: 'TST111',
    playerId: 'guest_p2',
    callsign: 'BRAVO-UPDATED',
    operative: 'nyx',
  });
  assert.ok(reconnected.ok);
  assert.equal(reconnected.room.guest?.callsign, 'BRAVO-UPDATED');
  assert.equal(reconnected.room.guest?.operative, 'nyx');
});

test('subscribeLocalMultiplayerEvents delivers instant notifications and leaveMultiplayerRoomClient marks room vacated', async () => {
  const received: string[] = [];
  const unsubscribe = subscribeLocalMultiplayerEvents((msg) => {
    if (msg.type === 'mp:room_sync' && msg.room) {
      received.push((msg.room as { code: string }).code);
    }
  });

  const created = await createRoomClient({
    playerId: 'test_local_host_99',
    callsign: 'NEXUS-01',
    operative: 'vex',
    isPublicQueue: false,
  });
  assert.ok(created.ok);
  assert.ok(received.includes(created.room.code));

  // Departure marks guest left or host abandoned
  leaveMultiplayerRoomClient(created.room.code, 'test_local_host_99');

  unsubscribe();
});



