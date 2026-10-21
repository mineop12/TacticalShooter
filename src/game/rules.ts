import {
  AABB,
  AIBehaviorState,
  AIDifficulty,
  ArmorType,
  KillFeedEntry,
  Waypoint,
  WeaponId,
  WeaponInstanceState,
} from './types.ts';
import { AI_DIFFICULTY_CONFIGS, ARMOR_SPECS, WEAPONS } from './weapons.ts';

export const MAX_CREDITS = 9000;
export const STARTING_CREDITS = 800;
export const ROUND_WIN_CREDITS = 3000;
export const ROUND_LOSS_BASE_CREDITS = 1900;
export const ROUND_LOSS_STREAK_BONUS = 500;
export const KILL_CREDIT_BONUS = 200;
export const TARGET_ROUND_WINS = 13;

export interface DamageResult {
  totalDamage: number;
  healthDamage: number;
  armorDamage: number;
  newHealth: number;
  newArmor: number;
  eliminated: boolean;
}

/**
 * Calculates distance-scaled damage and splits absorption between Armor (66%) and Health.
 */
export function calculateDamageWithArmor(
  baseDamage: number,
  currentHealth: number,
  currentArmor: number,
  distance: number,
  maxRange: number,
  falloffStart: number
): DamageResult {
  if (currentHealth <= 0) {
    return {
      totalDamage: 0,
      healthDamage: 0,
      armorDamage: 0,
      newHealth: 0,
      newArmor: currentArmor,
      eliminated: true,
    };
  }

  let scale = 1.0;
  if (distance > falloffStart) {
    const span = Math.max(1, maxRange - falloffStart);
    const excess = Math.min(span, distance - falloffStart);
    scale = 1.0 - (excess / span) * 0.35;
  }

  const effectiveDamage = Math.max(1, Math.round(baseDamage * scale));

  let armorDamage = 0;
  let healthDamage = effectiveDamage;

  if (currentArmor > 0) {
    const desiredArmorAbsorb = Math.round(effectiveDamage * 0.66);
    armorDamage = Math.min(currentArmor, desiredArmorAbsorb);
    healthDamage = effectiveDamage - armorDamage;
  }

  const newArmor = Math.max(0, currentArmor - armorDamage);
  const newHealth = Math.max(0, currentHealth - healthDamage);

  return {
    totalDamage: effectiveDamage,
    healthDamage,
    armorDamage,
    newHealth,
    newArmor,
    eliminated: newHealth <= 0,
  };
}

/**
 * Calculates updated credits after a round finishes.
 */
export function calculateRoundEconomy(
  currentCredits: number,
  wonRound: boolean,
  consecutiveLosses: number,
  killsInRound: number
): { nextCredits: number; awardBreakdown: number; nextLossStreak: number } {
  const killBonus = killsInRound * KILL_CREDIT_BONUS;
  if (wonRound) {
    const award = ROUND_WIN_CREDITS + killBonus;
    return {
      nextCredits: Math.min(MAX_CREDITS, currentCredits + award),
      awardBreakdown: award,
      nextLossStreak: 0,
    };
  } else {
    const newStreak = consecutiveLosses + 1;
    const streakTier = Math.min(2, newStreak - 1);
    const award = ROUND_LOSS_BASE_CREDITS + streakTier * ROUND_LOSS_STREAK_BONUS + killBonus;
    return {
      nextCredits: Math.min(MAX_CREDITS, currentCredits + award),
      awardBreakdown: award,
      nextLossStreak: newStreak,
    };
  }
}

/**
 * Checks if player can buy or refill a weapon.
 */
export function canPurchaseWeapon(
  credits: number,
  ownedWeapons: Record<WeaponId, WeaponInstanceState | null>,
  weaponId: WeaponId
): { allowed: boolean; reason?: string; cost: number } {
  const spec = WEAPONS[weaponId];
  const existing = ownedWeapons[weaponId];

  if (existing && existing.ammoInMag === spec.magSize && existing.ammoReserve === spec.maxReserve) {
    return { allowed: false, reason: 'Already owned & full ammo', cost: 0 };
  }

  if (existing) {
    return { allowed: true, cost: 0 };
  }

  if (credits < spec.cost) {
    return { allowed: false, reason: 'Insufficient credits', cost: spec.cost };
  }

  return { allowed: true, cost: spec.cost };
}

/**
 * Checks if player can buy armor.
 */
export function canPurchaseArmor(
  credits: number,
  currentArmor: number,
  currentArmorType: ArmorType,
  targetArmor: ArmorType
): { allowed: boolean; reason?: string; cost: number } {
  const spec = ARMOR_SPECS[targetArmor];
  if (targetArmor === 'none') {
    return { allowed: false, reason: 'Invalid shield', cost: 0 };
  }
  if (currentArmor === spec.points && currentArmorType === targetArmor) {
    return { allowed: false, reason: 'Shield already at maximum', cost: 0 };
  }
  if (currentArmor > spec.points) {
    return { allowed: false, reason: 'Higher shield already equipped', cost: 0 };
  }
  if (credits < spec.cost) {
    return { allowed: false, reason: 'Insufficient credits', cost: spec.cost };
  }
  return { allowed: true, cost: spec.cost };
}

/**
 * AI economy purchase decision at the start of a round.
 */
export function selectAILoadoutForRound(
  aiCredits: number,
  survivedWithWeapon: WeaponId | null
): { weaponId: WeaponId; armorType: ArmorType; remainingCredits: number } {
  let credits = aiCredits;
  let weaponId: WeaponId = survivedWithWeapon || 'pistol';
  let armorType: ArmorType = 'none';

  if (weaponId === 'pistol') {
    if (credits >= 5700) {
      weaponId = 'sniper';
      credits -= WEAPONS.sniper.cost;
    } else if (credits >= 3300) {
      weaponId = 'rifle';
      credits -= WEAPONS.rifle.cost;
    } else if (credits >= 2250) {
      weaponId = 'shotgun';
      credits -= WEAPONS.shotgun.cost;
    } else if (credits >= 2000) {
      weaponId = 'smg';
      credits -= WEAPONS.smg.cost;
    }
  }

  if (credits >= ARMOR_SPECS.heavy.cost) {
    armorType = 'heavy';
    credits -= ARMOR_SPECS.heavy.cost;
  } else if (credits >= ARMOR_SPECS.light.cost) {
    armorType = 'light';
    credits -= ARMOR_SPECS.light.cost;
  }

  return { weaponId, armorType, remainingCredits: credits };
}

/**
 * Resolves 2D XZ circle collision against an array of 3D AABB obstacles.
 */
export function resolveCircleAABBCollision(
  posX: number,
  posZ: number,
  posY: number,
  height: number,
  radius: number,
  boxes: AABB[],
  arenaHalfWidth = 27.2,
  arenaHalfLength = 25.2
): { x: number; z: number; collided: boolean } {
  let x = Math.max(-arenaHalfWidth + radius, Math.min(arenaHalfWidth - radius, posX));
  let z = Math.max(-arenaHalfLength + radius, Math.min(arenaHalfLength - radius, posZ));
  let collided = x !== posX || z !== posZ;

  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i];
    if (posY >= b.maxY - 0.05 || posY + height <= b.minY + 0.05) {
      continue;
    }

    const closestX = Math.max(b.minX, Math.min(x, b.maxX));
    const closestZ = Math.max(b.minZ, Math.min(z, b.maxZ));

    const dx = x - closestX;
    const dz = z - closestZ;
    const distSq = dx * dx + dz * dz;

    if (distSq < radius * radius) {
      collided = true;
      const dist = Math.sqrt(distSq);
      if (dist > 0.0001) {
        const overlap = radius - dist;
        x += (dx / dist) * overlap;
        z += (dz / dist) * overlap;
      } else {
        const penLeft = Math.abs(x - b.minX);
        const penRight = Math.abs(b.maxX - x);
        const penTop = Math.abs(z - b.minZ);
        const penBottom = Math.abs(b.maxZ - z);
        const minPen = Math.min(penLeft, penRight, penTop, penBottom);
        if (minPen === penLeft) x = b.minX - radius;
        else if (minPen === penRight) x = b.maxX + radius;
        else if (minPen === penTop) z = b.minZ - radius;
        else z = b.maxZ + radius;
      }
    }
  }

  return { x, z, collided };
}

/**
 * Slab method 3D Ray vs AABB intersection test.
 * Returns distance `t` along ray if hit within `[0, maxDist]`, otherwise `null`.
 */
export function intersectRayAABB(
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  maxDist: number,
  box: AABB
): number | null {
  let tmin = 0;
  let tmax = maxDist;

  if (Math.abs(dx) < 1e-8) {
    if (ox < box.minX || ox > box.maxX) return null;
  } else {
    const invD = 1 / dx;
    let t1 = (box.minX - ox) * invD;
    let t2 = (box.maxX - ox) * invD;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
    }
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }

  if (Math.abs(dy) < 1e-8) {
    if (oy < box.minY || oy > box.maxY) return null;
  } else {
    const invD = 1 / dy;
    let t1 = (box.minY - oy) * invD;
    let t2 = (box.maxY - oy) * invD;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
    }
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }

  if (Math.abs(dz) < 1e-8) {
    if (oz < box.minZ || oz > box.maxZ) return null;
  } else {
    const invD = 1 / dz;
    let t1 = (box.minZ - oz) * invD;
    let t2 = (box.maxZ - oz) * invD;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
    }
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }

  return tmin >= 0 && tmin <= maxDist ? tmin : null;
}

/**
 * Checks whether a clear line of sight exists between two 3D points without hitting any AABB wall/cover.
 */
export function hasLineOfSight(
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  obstacles: AABB[]
): boolean {
  const vx = bx - ax;
  const vy = by - ay;
  const vz = bz - az;
  const dist = Math.sqrt(vx * vx + vy * vy + vz * vz);
  if (dist < 0.001) return true;

  const dx = vx / dist;
  const dy = vy / dist;
  const dz = vz / dist;

  for (let i = 0; i < obstacles.length; i++) {
    const hitT = intersectRayAABB(ax, ay, az, dx, dy, dz, dist - 0.05, obstacles[i]);
    if (hitT !== null) {
      return false;
    }
  }
  return true;
}

/**
 * Checks if either combatant has reached the target round wins (13).
 */
export function checkMatchVictory(
  playerScore: number,
  aiScore: number,
  targetRounds = TARGET_ROUND_WINS
): 'PLAYER' | 'AI' | null {
  if (playerScore >= targetRounds) return 'PLAYER';
  if (aiScore >= targetRounds) return 'AI';
  return null;
}

/**
 * Evaluates AI tactical state transitions based on health, ammo, line-of-sight, sound awareness, and difficulty.
 */
export function evaluateAITacticalState(params: {
  currentState: AIBehaviorState;
  hp: number;
  ammoInMag: number;
  hasLOS: boolean;
  timeSinceLastSawPlayer: number;
  difficulty: AIDifficulty;
}): AIBehaviorState {
  const { hp, ammoInMag, hasLOS, timeSinceLastSawPlayer, difficulty } = params;
  const config = AI_DIFFICULTY_CONFIGS[difficulty];

  if (ammoInMag <= 0) {
    return 'reload';
  }

  if (hp <= config.coverRetreatThresholdHp && !hasLOS) {
    return 'cover';
  }

  if (hasLOS) {
    if (hp <= config.coverRetreatThresholdHp * 0.65 && Math.random() < 0.35) {
      return 'reposition';
    }
    return 'attack';
  }

  if (timeSinceLastSawPlayer < 6.0) {
    return 'reposition';
  }

  return 'patrol';
}

/**
 * Checks whether a full-width corridor of `radius` (e.g. 0.54m) is clear between two XZ points
 * by testing 3 parallel rays (center, left shoulder, right shoulder) so the AI never clips corners!
 */
export function hasCorridorClearance(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  radius: number,
  obstacles: AABB[]
): boolean {
  const dx = bx - ax;
  const dz = bz - az;
  const dist = Math.hypot(dx, dz);
  if (dist < 0.001) return true;

  const perpX = (-dz / dist) * radius;
  const perpZ = (dx / dist) * radius;

  if (!hasLineOfSight(ax, 1.0, az, bx, 1.0, bz, obstacles)) return false;
  if (!hasLineOfSight(ax + perpX, 1.0, az + perpZ, bx + perpX, 1.0, bz + perpZ, obstacles)) {
    return false;
  }
  if (!hasLineOfSight(ax - perpX, 1.0, az - perpZ, bx - perpX, 1.0, bz - perpZ, obstacles)) {
    return false;
  }
  return true;
}

/**
 * Selects the best tactical destination waypoint AND computes the immediate next-hop waypoint
 * along the arena navigation graph using BFS shortest-path and 3-ray corridor clearance
 * so the AI never walks into walls, clips crate corners, or freezes in place!
 */
export function findBestTacticalWaypoint(
  aiX: number,
  aiZ: number,
  threatX: number,
  threatZ: number,
  waypoints: Waypoint[],
  obstacles: AABB[],
  mode: 'cover' | 'flank' | 'patrol',
  lastWaypointId?: string
): Waypoint {
  if (waypoints.length === 0) {
    return {
      id: 'fallback',
      x: 0,
      z: 0,
      isCover: true,
      zone: 'mid',
      neighbors: [],
    };
  }

  // 1. Find the waypoint closest to the AI's current position with clear corridor access
  let currentWp = waypoints[0];
  let minStartDist = Infinity;
  for (let i = 0; i < waypoints.length; i++) {
    const wp = waypoints[i];
    const d = Math.hypot(wp.x - aiX, wp.z - aiZ);
    const clear = hasCorridorClearance(aiX, aiZ, wp.x, wp.z, 0.48, obstacles);
    const penalty = clear ? 0 : 18;
    if (d + penalty < minStartDist) {
      minStartDist = d + penalty;
      currentWp = wp;
    }
  }

  // 2. Score all candidate goal waypoints based on tactical mode
  let goalWp = currentWp;
  let bestScore = -Infinity;

  for (let i = 0; i < waypoints.length; i++) {
    const wp = waypoints[i];
    const distFromAI = Math.hypot(wp.x - aiX, wp.z - aiZ);
    const distFromThreat = Math.hypot(wp.x - threatX, wp.z - threatZ);
    const losToThreat = hasLineOfSight(wp.x, 1.5, wp.z, threatX, 1.5, threatZ, obstacles);

    let score = 0;
    if (mode === 'cover') {
      // Strongly prefer waypoints that break LOS to threat and are reachable quickly
      score += !losToThreat ? 125 : -75;
      score += wp.isCover ? 38 : 0;
      score -= distFromAI * 2.1;
      score += Math.min(distFromThreat, 18) * 1.3;
    } else if (mode === 'flank') {
      // Prefer mid or flank zones at tactical engagement distance (9-20m) that pressure the player
      const idealDistDelta = Math.abs(distFromThreat - 13.0);
      score -= idealDistDelta * 2.3;
      score -= distFromAI * 0.55;
      if (wp.zone === 'east_flank' || wp.zone === 'west_long' || wp.zone === 'mid') {
        score += 36;
      }
      if (losToThreat && distFromThreat >= 7 && distFromThreat <= 24) {
        score += 32; // Good peek angle on threat
      }
      // Never pick the waypoint we are already standing on during flank!
      if (distFromAI < 2.6) score -= 240;
      if (lastWaypointId && wp.id === lastWaypointId) score -= 45;
    } else {
      // Patrol mode: actively advance toward the threat's coordinate across mid or flank lanes
      score -= distFromThreat * 1.65;
      if (wp.zone === 'mid' || wp.zone === 'east_flank' || wp.zone === 'west_long') {
        score += 38;
      }
      if (losToThreat) score += 24;
      // Never pick the waypoint we are already standing on during patrol!
      if (distFromAI < 2.8) score -= 260;
      if (lastWaypointId && wp.id === lastWaypointId) score -= 50;
    }

    if (score > bestScore) {
      bestScore = score;
      goalWp = wp;
    }
  }

  // 3. Only go directly to goalWp if it is nearby (<= 11m) AND has full 3-ray shoulder clearance!
  const directDist = Math.hypot(goalWp.x - aiX, goalWp.z - aiZ);
  if (
    directDist <= 11.0 &&
    hasCorridorClearance(aiX, aiZ, goalWp.x, goalWp.z, 0.52, obstacles)
  ) {
    return goalWp;
  }

  // 4. Otherwise, run BFS over the waypoint graph from `currentWp` to `goalWp` and return the first hop!
  const wpMap = new Map<string, Waypoint>();
  for (let i = 0; i < waypoints.length; i++) {
    wpMap.set(waypoints[i].id, waypoints[i]);
  }

  const queue: string[] = [currentWp.id];
  const parentMap = new Map<string, string>();
  const visited = new Set<string>([currentWp.id]);

  while (queue.length > 0) {
    const currId = queue.shift()!;
    if (currId === goalWp.id) break;
    const node = wpMap.get(currId);
    if (!node) continue;
    for (let n = 0; n < node.neighbors.length; n++) {
      const nextId = node.neighbors[n];
      if (!visited.has(nextId)) {
        visited.add(nextId);
        parentMap.set(nextId, currId);
        queue.push(nextId);
      }
    }
  }

  // Backtrack from goalWp to find the immediate child of currentWp
  if (visited.has(goalWp.id) && goalWp.id !== currentWp.id) {
    let stepId = goalWp.id;
    while (parentMap.get(stepId) && parentMap.get(stepId) !== currentWp.id) {
      stepId = parentMap.get(stepId)!;
    }
    const nextHop = wpMap.get(stepId);
    if (nextHop) {
      // If AI is still far from currentWp and cannot cleanly reach nextHop directly, step to currentWp first
      if (
        Math.hypot(currentWp.x - aiX, currentWp.z - aiZ) > 1.8 &&
        !hasCorridorClearance(aiX, aiZ, nextHop.x, nextHop.z, 0.5, obstacles)
      ) {
        return currentWp;
      }
      return nextHop;
    }
  }

  // Fallback: if already standing on currentWp, pick its first neighbor toward the threat
  if (Math.hypot(currentWp.x - aiX, currentWp.z - aiZ) < 1.8 && currentWp.neighbors.length > 0) {
    let bestNeighbor = currentWp;
    let bestNDist = Infinity;
    for (let i = 0; i < currentWp.neighbors.length; i++) {
      const nb = wpMap.get(currentWp.neighbors[i]);
      if (nb && nb.id !== lastWaypointId) {
        const d = Math.hypot(nb.x - threatX, nb.z - threatZ);
        if (d < bestNDist) {
          bestNDist = d;
          bestNeighbor = nb;
        }
      }
    }
    return bestNeighbor;
  }

  return currentWp;
}

export interface WeaponInspectPose {
  posX: number;
  posY: number;
  posZ: number;
  rotX: number;
  rotY: number;
  rotZ: number;
  leftArmOffsetX: number;
  leftArmOffsetY: number;
  leftArmOffsetZ: number;
  leftArmRotZ: number;
  slidePullBack: number;
}

/**
 * Computes a smooth 3-phase 3D weapon & first-person arm inspection pose for progress in [0, 1].
 * Phase 1 (0..0.38): Lift & cant left to show left receiver, Picatinny rail, optic & radianite core.
 * Phase 2 (0.38..0.78): Roll right to showcase barrel profile, magazine, wrist holo-watch & tactile press-check.
 * Phase 3 (0.78..1.0): Smoothly settle back to neutral combat stance.
 */
export function computeWeaponInspectPose(progress: number): WeaponInspectPose {
  const t = Math.max(0, Math.min(1, progress));
  const smooth = (x: number) => x * x * (3 - 2 * x);

  if (t <= 0 || t >= 1) {
    return {
      posX: 0,
      posY: 0,
      posZ: 0,
      rotX: 0,
      rotY: 0,
      rotZ: 0,
      leftArmOffsetX: 0,
      leftArmOffsetY: 0,
      leftArmOffsetZ: 0,
      leftArmRotZ: 0,
      slidePullBack: 0,
    };
  }

  if (t < 0.38) {
    const p = smooth(t / 0.38);
    return {
      posX: -0.155 * p,
      posY: 0.12 * p,
      posZ: -0.045 * p,
      rotX: 0.2 * p,
      rotY: 0.82 * p,
      rotZ: 0.54 * p,
      leftArmOffsetX: -0.06 * p,
      leftArmOffsetY: -0.05 * p,
      leftArmOffsetZ: 0.05 * p,
      leftArmRotZ: -0.38 * p,
      slidePullBack: 0,
    };
  } else if (t < 0.78) {
    const localT = (t - 0.38) / 0.4;
    const p = smooth(localT);
    // Crisp press-check on the slide/bolt in the middle of Phase 2
    const pressCheck = Math.sin(localT * Math.PI);
    return {
      posX: -0.155 + 0.055 * p,
      posY: 0.12 - 0.015 * p,
      posZ: -0.045 + 0.025 * p,
      rotX: 0.2 - 0.34 * p,
      rotY: 0.82 - 1.44 * p,
      rotZ: 0.54 - 1.08 * p,
      leftArmOffsetX: -0.06 + 0.04 * p,
      leftArmOffsetY: -0.05 + 0.03 * p,
      leftArmOffsetZ: 0.05 - 0.02 * p,
      leftArmRotZ: -0.38 + 0.22 * p,
      slidePullBack: pressCheck * 0.034,
    };
  } else {
    const p = 1 - smooth((t - 0.78) / 0.22);
    return {
      posX: -0.1 * p,
      posY: 0.105 * p,
      posZ: -0.02 * p,
      rotX: -0.14 * p,
      rotY: -0.62 * p,
      rotZ: -0.54 * p,
      leftArmOffsetX: -0.02 * p,
      leftArmOffsetY: -0.02 * p,
      leftArmOffsetZ: 0.03 * p,
      leftArmRotZ: -0.16 * p,
      slidePullBack: 0,
    };
  }
}

export interface WeaponReloadPose {
  rootPosX: number;
  rootPosY: number;
  rootPosZ: number;
  rootRotX: number;
  rootRotY: number;
  rootRotZ: number;
  magOffsetY: number;
  magOffsetZ: number;
  slidePullBack: number;
  leftArmOffsetX: number;
  leftArmOffsetY: number;
  leftArmOffsetZ: number;
  leftArmRotX: number;
  leftArmRotZ: number;
}

/**
 * Computes a tactile 4-stage choreographed reload animation for progress in [0, 1]:
 * - Stage 1 (0.00..0.28): Cant weapon into workspace & drop empty magazine out of magwell.
 * - Stage 2 (0.28..0.64): Left hand brings fresh magazine up and seats it firmly with an upward slap impulse.
 * - Stage 3 (0.64..0.86): Left hand reaches up to rack the slide/bolt/pump back & release forward with snap.
 * - Stage 4 (0.86..1.00): Settle weapon & left support hand back onto the foregrip.
 */
export function computeWeaponReloadPose(progress: number): WeaponReloadPose {
  const t = Math.max(0, Math.min(1, progress));
  const smooth = (x: number) => x * x * (3 - 2 * x);

  if (t <= 0 || t >= 1) {
    return {
      rootPosX: 0,
      rootPosY: 0,
      rootPosZ: 0,
      rootRotX: 0,
      rootRotY: 0,
      rootRotZ: 0,
      magOffsetY: 0,
      magOffsetZ: 0,
      slidePullBack: 0,
      leftArmOffsetX: 0,
      leftArmOffsetY: 0,
      leftArmOffsetZ: 0,
      leftArmRotX: 0,
      leftArmRotZ: 0,
    };
  }

  if (t < 0.28) {
    // Stage 1: Tilt gun & pull magazine down with subtle wrist snap
    const p = smooth(t / 0.28);
    return {
      rootPosX: -0.068 * p,
      rootPosY: 0.045 * p,
      rootPosZ: -0.025 * p,
      rootRotX: 0.24 * p,
      rootRotY: 0.38 * p,
      rootRotZ: 0.52 * p,
      magOffsetY: -0.28 * p,
      magOffsetZ: 0.045 * p,
      slidePullBack: 0,
      leftArmOffsetX: 0.024 * p,
      leftArmOffsetY: -0.24 * p,
      leftArmOffsetZ: 0.15 * p,
      leftArmRotX: -0.38 * p,
      leftArmRotZ: -0.28 * p,
    };
  } else if (t < 0.64) {
    // Stage 2: Insert fresh magazine & slap upwards at t ~ 0.58
    const localT = (t - 0.28) / 0.36;
    const p = smooth(localT);
    const slapBump = localT > 0.72 ? Math.sin(((localT - 0.72) / 0.28) * Math.PI) * 0.042 : 0;
    return {
      rootPosX: -0.068,
      rootPosY: 0.045 + slapBump,
      rootPosZ: -0.025,
      rootRotX: 0.24 - slapBump * 2.1,
      rootRotY: 0.38,
      rootRotZ: 0.52 + slapBump * 1.4,
      magOffsetY: -0.28 * (1 - p),
      magOffsetZ: 0.045 * (1 - p),
      slidePullBack: 0,
      leftArmOffsetX: 0.024,
      leftArmOffsetY: -0.24 * (1 - p) - 0.035 + slapBump * 0.5,
      leftArmOffsetZ: 0.15 * (1 - p) + 0.08,
      leftArmRotX: -0.38 * (1 - p),
      leftArmRotZ: -0.28 * (1 - p),
    };
  } else if (t < 0.86) {
    // Stage 3: Rack the slide / charging handle / pump with sharp spring release
    const localT = (t - 0.64) / 0.22;
    const rackCurve = Math.sin(localT * Math.PI);
    return {
      rootPosX: -0.068 + 0.025 * localT,
      rootPosY: 0.045 - 0.018 * rackCurve,
      rootPosZ: -0.025 - 0.042 * rackCurve,
      rootRotX: 0.24 - 0.12 * localT + 0.08 * rackCurve,
      rootRotY: 0.38 - 0.22 * localT,
      rootRotZ: 0.52 - 0.28 * localT,
      magOffsetY: 0,
      magOffsetZ: 0,
      slidePullBack: 0.072 * rackCurve,
      leftArmOffsetX: 0.014 * rackCurve,
      leftArmOffsetY: 0.06 * rackCurve,
      leftArmOffsetZ: 0.13 * rackCurve,
      leftArmRotX: 0.22 * rackCurve,
      leftArmRotZ: 0.18 * rackCurve,
    };
  } else {
    // Stage 4: Settle cleanly back to neutral combat stance
    const p = 1 - smooth((t - 0.86) / 0.14);
    return {
      rootPosX: -0.043 * p,
      rootPosY: 0.045 * p,
      rootPosZ: -0.025 * p,
      rootRotX: 0.12 * p,
      rootRotY: 0.16 * p,
      rootRotZ: 0.24 * p,
      magOffsetY: 0,
      magOffsetZ: 0,
      slidePullBack: 0,
      leftArmOffsetX: 0,
      leftArmOffsetY: 0,
      leftArmOffsetZ: 0,
      leftArmRotX: 0,
      leftArmRotZ: 0,
    };
  }
}

export interface WeaponFireCyclePose {
  slidePullBack: number;
  leftArmOffsetZ: number;
  leftArmOffsetY: number;
  extraRotZ: number;
  extraRotX: number;
}

/**
 * Computes weapon-specific post-shot mechanical action choreography for `progress` in [0, 1]
 * (where 0 = instant of shot, 1 = cycle complete):
 * - Automatic / Pistol (`pistol`, `smg`, `rifle`): high-speed reciprocating blowback slide/bolt cycle.
 * - Shotgun (`shotgun`): initial blast recoil followed by left support hand pumping the forend back & forth.
 * - Sniper (`sniper`): heavy barrel rise followed by tactile manual bolt-action pull & lock.
 */
export function computeFireCyclePose(
  weaponId: WeaponId,
  progress: number
): WeaponFireCyclePose {
  const t = Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 1));
  if (t <= 0 || t >= 1) {
    return {
      slidePullBack: 0,
      leftArmOffsetZ: 0,
      leftArmOffsetY: 0,
      extraRotZ: 0,
      extraRotX: 0,
    };
  }

  if (weaponId === 'shotgun') {
    // 0..0.30: blast kick; 0.30..0.92: manual pump rack back and forth
    if (t < 0.3) {
      const b = Math.sin((t / 0.3) * Math.PI);
      return {
        slidePullBack: 0.015 * b,
        leftArmOffsetZ: 0,
        leftArmOffsetY: 0,
        extraRotZ: -0.06 * b,
        extraRotX: 0.08 * b,
      };
    } else if (t < 0.92) {
      const pumpT = (t - 0.3) / 0.62;
      const pumpCurve = Math.sin(pumpT * Math.PI);
      return {
        slidePullBack: 0.075 * pumpCurve,
        leftArmOffsetZ: 0.075 * pumpCurve,
        leftArmOffsetY: -0.012 * pumpCurve,
        extraRotZ: 0.14 * pumpCurve,
        extraRotX: -0.05 * pumpCurve,
      };
    }
    return { slidePullBack: 0, leftArmOffsetZ: 0, leftArmOffsetY: 0, extraRotZ: 0, extraRotX: 0 };
  }

  if (weaponId === 'sniper') {
    // 0..0.28: heavy anti-materiel recoil; 0.28..0.94: manual bolt-handle lift & pull back
    if (t < 0.28) {
      const b = Math.sin((t / 0.28) * Math.PI);
      return {
        slidePullBack: 0.02 * b,
        leftArmOffsetZ: 0,
        leftArmOffsetY: 0,
        extraRotZ: -0.08 * b,
        extraRotX: 0.12 * b,
      };
    } else if (t < 0.94) {
      const boltT = (t - 0.28) / 0.66;
      const boltCurve = Math.sin(boltT * Math.PI);
      return {
        slidePullBack: 0.088 * boltCurve,
        leftArmOffsetZ: 0.03 * boltCurve,
        leftArmOffsetY: 0.025 * boltCurve,
        extraRotZ: 0.22 * boltCurve,
        extraRotX: 0.04 * boltCurve,
      };
    }
    return { slidePullBack: 0, leftArmOffsetZ: 0, leftArmOffsetY: 0, extraRotZ: 0, extraRotX: 0 };
  }

  // Pistol, SMG, Rifle: crisp high-speed reciprocating slide/bolt blowback
  const blowback = Math.sin(t * Math.PI);
  return {
    slidePullBack: 0.062 * blowback,
    leftArmOffsetZ: 0,
    leftArmOffsetY: 0,
    extraRotZ: 0,
    extraRotX: 0,
  };
}

/**
 * Computes the speed multiplier during a tactical knee-slide for progress in [0, 1].
 * Starts with a fast burst (1.42x run speed) and smoothly decelerates with friction to 0.52x.
 */
export function computeSlideVelocityFactor(progress: number): number {
  const t = Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 0));
  const easeOut = 1 - t * t;
  return 0.52 + 0.9 * easeOut;
}

/**
 * Determines which weapon the AI should dynamically equip during combat:
 * - Emergency sidearm draw: If primary weapon is empty (`primaryAmmo <= 0`), sidearm has ammo,
 *   and player is in LOS within 18m, switch immediately to sidearm (`pistol`) instead of reloading in the open.
 * - Range-adaptive switching:
 *   - If primary is `sniper` and player closes within 9.5m, switch to `pistol` for CQB fire rate.
 *   - If primary is `shotgun` and player is beyond 16.5m, switch to `pistol` for ranged accuracy.
 *   - Otherwise, use the primary weapon whenever it has ammo or when safe in cover.
 */
export function selectAICombatWeapon(
  primaryWeaponId: WeaponId,
  primaryAmmo: number,
  sidearmAmmo: number,
  distToPlayer: number,
  hasLOS: boolean
): WeaponId {
  if (primaryWeaponId === 'pistol') {
    return 'pistol';
  }

  // Emergency fast-draw sidearm when primary runs dry in active close/medium LOS duel
  if (primaryAmmo <= 0 && sidearmAmmo > 0 && hasLOS && distToPlayer <= 18.0) {
    return 'pistol';
  }

  // Range-adaptive tactical switching when sidearm has ammo
  if (sidearmAmmo > 0) {
    if (primaryWeaponId === 'sniper' && distToPlayer < 9.5 && hasLOS) {
      return 'pistol';
    }
    if (primaryWeaponId === 'shotgun' && distToPlayer > 16.5) {
      return 'pistol';
    }
  }

  return primaryWeaponId;
}

export interface AnimatedKillFeedEntry extends KillFeedEntry {
  addedAt: number;
  exitStartedAt: number | null;
  phase: 'entering' | 'exiting';
}

/**
 * Reconciles the HUD kill feed list with entry and exit animation lifecycle states.
 * - New items enter with `phase: 'entering'`.
 * - Items that exceed `visibleDurationMs` or are displaced/removed from `incomingFeed`
 *   transition to `phase: 'exiting'` and remain in the list for `exitDurationMs` so
 *   their CSS exit animation completes smoothly before unmounting.
 */
export function reconcileAnimatedKillFeed(
  previousItems: AnimatedKillFeedEntry[],
  incomingFeed: KillFeedEntry[],
  nowMs: number,
  visibleDurationMs = 4800,
  exitDurationMs = 280
): AnimatedKillFeedEntry[] {
  const prevById = new Map<string, AnimatedKillFeedEntry>();
  for (const item of previousItems) {
    prevById.set(item.id, item);
  }

  const incomingIds = new Set<string>();
  const result: AnimatedKillFeedEntry[] = [];

  for (const entry of incomingFeed) {
    incomingIds.add(entry.id);
    const existing = prevById.get(entry.id);
    if (existing) {
      const shouldStartExit =
        existing.exitStartedAt === null && nowMs - existing.addedAt >= visibleDurationMs;
      const exitStartedAt = shouldStartExit ? nowMs : existing.exitStartedAt;
      result.push({
        ...entry,
        addedAt: existing.addedAt,
        exitStartedAt,
        phase: exitStartedAt !== null ? 'exiting' : 'entering',
      });
    } else {
      result.push({
        ...entry,
        addedAt: nowMs,
        exitStartedAt: null,
        phase: 'entering',
      });
    }
  }

  // Preserve removed/displaced items in 'exiting' state until their exit animation finishes
  for (const oldItem of previousItems) {
    if (!incomingIds.has(oldItem.id)) {
      const exitStartedAt = oldItem.exitStartedAt !== null ? oldItem.exitStartedAt : nowMs;
      result.push({
        ...oldItem,
        exitStartedAt,
        phase: 'exiting',
      });
    }
  }

  // Prune items whose exit animation has completed
  return result
    .filter((item) => item.exitStartedAt === null || nowMs - item.exitStartedAt < exitDurationMs)
    .slice(0, 6);
}

/**
 * Resolves a WeaponId from a KillFeedEntry (using `weaponId` directly if present,
 * or matching `weaponName` against known tactical weapon names/codes).
 */
export function resolveKillFeedWeaponId(
  entry: Pick<KillFeedEntry, 'weaponId' | 'weaponName'>
): WeaponId {
  if (
    entry.weaponId &&
    (entry.weaponId === 'pistol' ||
      entry.weaponId === 'smg' ||
      entry.weaponId === 'shotgun' ||
      entry.weaponId === 'rifle' ||
      entry.weaponId === 'sniper')
  ) {
    return entry.weaponId;
  }

  const raw = (entry.weaponName || '').toLowerCase();
  if (raw.includes('classic') || raw.includes('pistol') || raw.includes('sidearm')) {
    return 'pistol';
  }
  if (raw.includes('spectre') || raw.includes('smg')) {
    return 'smg';
  }
  if (raw.includes('judge') || raw.includes('shotgun')) {
    return 'shotgun';
  }
  if (raw.includes('operator') || raw.includes('sniper')) {
    return 'sniper';
  }
  return 'rifle';
}




