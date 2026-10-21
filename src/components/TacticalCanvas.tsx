import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { buildTacticalArena } from '../game/arena';
import { soundEngine } from '../game/audio';
import { createAIOperativeModel, createFirstPersonWeaponRig } from '../game/models';
import {
  DamageResolutionEvent,
  getSpawnForRole,
  MultiplayerRole,
  MultiplayerRoomState,
} from '../game/multiplayer';
import {
  calculateDamageWithArmor,
  calculateRoundEconomy,
  canPurchaseArmor,
  canPurchaseWeapon,
  checkMatchVictory,
  computeFireCyclePose,
  computeSlideVelocityFactor,
  computeWeaponInspectPose,
  computeWeaponReloadPose,
  evaluateAITacticalState,
  findBestTacticalWaypoint,
  hasCorridorClearance,
  hasLineOfSight,
  intersectRayAABB,
  KILL_CREDIT_BONUS,
  MAX_CREDITS,
  resolveCircleAABBCollision,
  selectAICombatWeapon,
  selectAILoadoutForRound,
  STARTING_CREDITS,
  TARGET_ROUND_WINS,
} from '../game/rules';
import { createTacticalMaterialLibrary } from '../game/textures';
import {
  AIBehaviorState,
  AIDifficulty,
  ArmorType,
  GameAppState,
  GameSettings,
  HitFeedback,
  HudSnapshot,
  InteractiveObjective,
  KillFeedEntry,
  MatchSummaryStats,
  OperativeId,
  RoundPhase,
  WeaponId,
  WeaponInstanceState,
} from '../game/types';
import { AI_DIFFICULTY_CONFIGS, ARMOR_SPECS, OPERATIVES, WEAPONS } from '../game/weapons';

export interface TacticalEngineAPI {
  startNewMatch: (operative: OperativeId, difficulty: AIDifficulty, practiceMode: boolean) => void;
  startMultiplayerMatch: (
    room: MultiplayerRoomState,
    role: MultiplayerRole,
    playerId: string,
    callsign: string,
    operative: OperativeId
  ) => void;
  resumeGame: () => void;
  pauseGame: () => void;
  returnToTitle: () => void;
  restartMatch: () => void;
  purchaseWeapon: (weaponId: WeaponId) => boolean;
  purchaseArmor: (armorType: ArmorType) => boolean;
  equipWeapon: (weaponId: WeaponId) => void;
  inspectWeapon: () => void;
  skipBuyPhase: () => void;
  interactObjective: () => void;
  toggleBuyMenu: () => void;
  practiceAction: (
    action: 'refill_credits' | 'spawn_bot_mid' | 'sim_round_win' | 'sim_match_win' | 'heal_player'
  ) => void;
  requestPointerLock: () => void;
}

interface TacticalCanvasProps {
  settings: GameSettings;
  onHudUpdate: (snapshot: HudSnapshot) => void;
  onToggleBuyMenu: () => void;
  onRegisterApi: (api: TacticalEngineAPI) => void;
}

// Pre-allocated math helpers outside the animation loop (Zero-GC render loop)
const _rayOrigin = new THREE.Vector3();
const _rayDir = new THREE.Vector3();
const _targetPos = new THREE.Vector3();
const _forward = new THREE.Vector3();
const _right = new THREE.Vector3();
const _moveVec = new THREE.Vector3();
const _euler = new THREE.Euler(0, 0, 0, 'YXZ');
const _dummyMatrix = new THREE.Matrix4();
const _particlePos = new THREE.Vector3();
const _particleScale = new THREE.Vector3();
const _particleQuat = new THREE.Quaternion();
const _ndcMouse = new THREE.Vector2();

const MAX_PARTICLES = 64;
const BUY_PHASE_DURATION = 5.0; // Short 5s buy phase before combat starts
const COMBAT_PHASE_DURATION = 100.0;
const ROUND_END_DURATION = 3.0;

interface ParticleSlot {
  active: boolean;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  maxLife: number;
  size: number;
  colorHex: number;
}

export const TacticalCanvas: React.FC<TacticalCanvasProps> = ({
  settings,
  onHudUpdate,
  onToggleBuyMenu,
  onRegisterApi,
}) => {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const settingsRef = useRef<GameSettings>(settings);
  const onHudUpdateRef = useRef(onHudUpdate);
  const onToggleBuyMenuRef = useRef(onToggleBuyMenu);

  useEffect(() => {
    settingsRef.current = settings;
    soundEngine.setVolume(settings.masterVolume, settings.muted);
  }, [settings]);

  useEffect(() => {
    onHudUpdateRef.current = onHudUpdate;
  }, [onHudUpdate]);

  useEffect(() => {
    onToggleBuyMenuRef.current = onToggleBuyMenu;
  }, [onToggleBuyMenu]);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    // 1. Detect Software WebGL from GPU renderer string
    const isSoftwareGl = (() => {
      const probeCanvas = document.createElement('canvas');
      const gl = probeCanvas.getContext('webgl2');
      if (!gl) return true;
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
      const gpu = String(gl.getParameter(param));
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
    })();

    const renderer = new THREE.WebGLRenderer({
      antialias: !isSoftwareGl,
      powerPreference: 'high-performance',
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.04;
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = !isSoftwareGl;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.setSize(container.clientWidth || window.innerWidth, container.clientHeight || window.innerHeight);

    container.innerHTML = '';
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const skyHorizonColor = new THREE.Color(0x0d1526);
    scene.background = skyHorizonColor;
    scene.fog = new THREE.FogExp2(0x0d1526, 0.014);

    // 2. Studio Environment Map via RoomEnvironment + PMREMGenerator
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    scene.environment = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
    pmremGenerator.dispose();

    // 3. Camera & First-Person Weapon Rig
    const initW = container.clientWidth || window.innerWidth;
    const initH = container.clientHeight || window.innerHeight;
    const camera = new THREE.PerspectiveCamera(
      settingsRef.current.fov,
      initW / initH,
      0.1,
      240
    );
    scene.add(camera);

    const fpWeaponRig = createFirstPersonWeaponRig(OPERATIVES.vex.accentColor);
    camera.add(fpWeaponRig.root);

    // 3b. Subtle Post-Processing Bloom Pipeline (Reduced intensity & high threshold to prevent washout)
    const composer = new EffectComposer(renderer);
    const renderPass = new RenderPass(scene, camera);
    composer.addPass(renderPass);

    const bloomScale = isSoftwareGl ? 0.5 : 1.0;
    const bloomPass = new UnrealBloomPass(
      new THREE.Vector2(Math.max(1, initW * bloomScale), Math.max(1, initH * bloomScale)),
      0.14, // subtle baseline bloom strength (reduced so scene & guns stay crisp)
      0.22, // tight glow radius
      0.92 // high threshold so only HDR muzzle flashes, Radianite cores, and optics bloom
    );
    composer.addPass(bloomPass);

    const outputPass = new OutputPass();
    composer.addPass(outputPass);

    // 4. Balanced 3-Point Studio & Warm/Cool Arena Lighting Rig
    const hemiLight = new THREE.HemisphereLight(0x38bdf8, 0x1e293b, 0.85);
    hemiLight.position.set(0, 35, 0);
    scene.add(hemiLight);

    const keyLight = new THREE.DirectionalLight(0xffedd5, 1.9);
    keyLight.position.set(22, 38, 18);
    keyLight.castShadow = !isSoftwareGl;
    keyLight.shadow.mapSize.width = 1024;
    keyLight.shadow.mapSize.height = 1024;
    const d = 30;
    keyLight.shadow.camera.left = -d;
    keyLight.shadow.camera.right = d;
    keyLight.shadow.camera.top = d;
    keyLight.shadow.camera.bottom = -d;
    keyLight.shadow.camera.near = 2;
    keyLight.shadow.camera.far = 90;
    keyLight.shadow.bias = -0.0005;
    keyLight.shadow.normalBias = 0.02;
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0x38bdf8, 0.75);
    rimLight.position.set(-24, 20, -22);
    scene.add(rimLight);

    // 5. Build Procedural Tactical Arena & AI Operative Model
    const mats = createTacticalMaterialLibrary(renderer);
    const arena = buildTacticalArena(mats);
    scene.add(arena.arenaGroup);

    const aiRig = createAIOperativeModel();
    scene.add(aiRig.root);

    // Player Bullet Tracer Line (reused Zero-GC line geometry with HDR color for bloom)
    const tracerGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, 0, -1),
    ]);
    const tracerMat = new THREE.LineBasicMaterial({
      color: new THREE.Color(2.4, 1.85, 0.45),
      transparent: true,
      opacity: 0,
    });
    const tracerLine = new THREE.Line(tracerGeo, tracerMat);
    tracerLine.frustumCulled = false;
    scene.add(tracerLine);
    let tracerTimer = 0;

    // AI Opponent Bullet Tracer Line (reused Zero-GC line geometry with HDR color for bloom)
    const aiTracerGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, 0, -1),
    ]);
    const aiTracerMat = new THREE.LineBasicMaterial({
      color: new THREE.Color(2.5, 0.42, 0.72),
      transparent: true,
      opacity: 0,
    });
    const aiTracerLine = new THREE.Line(aiTracerGeo, aiTracerMat);
    aiTracerLine.frustumCulled = false;
    scene.add(aiTracerLine);
    let aiTracerTimer = 0;

    // 6. Zero-GC Pooled Particle Ring Buffer (InstancedMesh)
    const particleGeo = new THREE.BoxGeometry(0.08, 0.08, 0.08);
    const particleMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const particleMesh = new THREE.InstancedMesh(particleGeo, particleMat, MAX_PARTICLES);
    particleMesh.frustumCulled = false;
    scene.add(particleMesh);

    const particles: ParticleSlot[] = Array.from({ length: MAX_PARTICLES }, () => ({
      active: false,
      x: 0,
      y: -100,
      z: 0,
      vx: 0,
      vy: 0,
      vz: 0,
      life: 0,
      maxLife: 0.3,
      size: 1,
      colorHex: 0xfbbf24,
    }));
    let particleCursor = 0;
    const _pColor = new THREE.Color();

    const spawnParticles = (
      wx: number,
      wy: number,
      wz: number,
      count: number,
      colorHex: number,
      speedScale = 4.5
    ) => {
      for (let i = 0; i < count; i++) {
        const slot = particles[particleCursor];
        particleCursor = (particleCursor + 1) % MAX_PARTICLES;
        slot.active = true;
        slot.x = wx;
        slot.y = wy;
        slot.z = wz;
        slot.vx = (Math.random() - 0.5) * speedScale * 2;
        slot.vy = Math.random() * speedScale + 1.2;
        slot.vz = (Math.random() - 0.5) * speedScale * 2;
        slot.maxLife = 0.18 + Math.random() * 0.22;
        slot.life = slot.maxLife;
        slot.size = 0.7 + Math.random() * 1.1;
        slot.colorHex = colorHex;
      }
    };

    if (!isSoftwareGl) {
      renderer.compile(scene, camera);
    }

    // 7. Mutable Simulation State
    const raycaster = new THREE.Raycaster();
    const keysHeld = new Set<string>();
    const keysJustPressed = new Set<string>();
    let mouseLeftHeld = false;
    let mouseLeftJustPressed = false;
    let mouseRightHeld = false;
    let pointerLocked = false;

    const createInitialInventory = (): Record<WeaponId, WeaponInstanceState | null> => ({
      pistol: {
        id: 'pistol',
        ammoInMag: WEAPONS.pistol.magSize,
        ammoReserve: WEAPONS.pistol.maxReserve,
      },
      smg: null,
      shotgun: null,
      rifle: null,
      sniper: null,
    });

    const sim = {
      appState: 'title' as GameAppState,
      roundPhase: 'buy' as RoundPhase,
      roundNumber: 1,
      playerScore: 0,
      aiScore: 0,
      phaseTimer: BUY_PHASE_DURATION,
      isPracticeMode: false,
      difficulty: 'normal' as AIDifficulty,
      operative: 'vex' as OperativeId,

      // Player combatant state
      playerX: arena.playerSpawn.x,
      playerY: 0,
      playerZ: arena.playerSpawn.z,
      playerVx: 0,
      playerVy: 0,
      playerVz: 0,
      playerYaw: arena.playerSpawn.yaw,
      playerPitch: 0,
      recoilPitchOffset: 0,
      recoilYawOffset: 0,
      isGrounded: true,
      coyoteTimer: 0,
      jumpBufferTimer: 0,
      walkBobPhase: 0,
      footstepAccum: 0,
      isSliding: false,
      slideTimer: 0,
      slideDuration: 0.68,
      slideCooldown: 0,
      slideDirX: 0,
      slideDirZ: -1,
      cameraRoll: 0,
      playerHealth: 100,
      playerArmor: 0,
      playerArmorType: 'none' as ArmorType,
      playerCredits: STARTING_CREDITS,
      playerLossStreak: 0,
      ownedWeapons: createInitialInventory(),
      activeWeaponId: 'pistol' as WeaponId,
      fireCooldown: 0,
      isReloading: false,
      reloadTimer: 0,
      reloadDuration: 1.4,
      isInspecting: false,
      inspectTimer: 0,
      inspectDuration: 2.4,
      equipTimer: 0,
      equipDuration: 0.32,
      fireBoltCycleTimer: 0,
      fireBoltCycleDuration: 0.14,
      gunKickZ: 0,
      gunKickY: 0,
      gunKickPitch: 0,
      gunKickRoll: 0,
      sprayStreak: 0,
      sprayDecayTimer: 0,
      swayX: 0,
      swayY: 0,
      swayRoll: 0,
      jumpLandDip: 0,
      shellTimer: 0,
      shellX: 0,
      shellY: 0,
      shellZ: 0,
      shellVx: 0,
      shellVy: 0,
      shellVz: 0,

      // Match telemetry
      playerKills: 0,
      playerDeaths: 0,
      shotsFired: 0,
      shotsHit: 0,
      headshots: 0,
      totalDamageDealt: 0,
      totalCreditsEarned: STARTING_CREDITS,

      // AI Opponent state (with multi-weapon primary + sidearm inventory)
      aiX: 2.6,
      aiY: 0,
      aiZ: -14.5,
      aiStuckTimer: 0,
      aiYaw: Math.PI,
      aiHealth: 100,
      aiArmor: 25,
      aiCredits: STARTING_CREDITS,
      aiLossStreak: 0,
      aiPrimaryWeaponId: 'pistol' as WeaponId,
      aiWeaponId: 'pistol' as WeaponId,
      aiPrimaryAmmo: WEAPONS.pistol.magSize,
      aiSidearmAmmo: WEAPONS.pistol.magSize,
      aiAmmoInMag: WEAPONS.pistol.magSize,
      aiState: 'patrol' as AIBehaviorState,
      aiTargetX: 2.8,
      aiTargetZ: -6.5,
      aiLastKnownPlayerX: 0,
      aiLastKnownPlayerZ: 21,
      aiWaypointTimer: 0,
      aiReactionTimer: 0,
      aiWindupTimer: 0,
      aiBurstShotsLeft: 0,
      aiFireCooldown: 0,
      aiReloadTimer: 0,
      aiLastSawPlayerTime: -99,
      aiStrafeDir: 1,
      aiStrafeTimer: 0,
      aiCrouchOffset: 0,
      aiCrouchTimer: 0,
      aiIsCrouching: false,
      aiHitFlashTimer: 0,
      aiKoTimer: 0, // Death topple animation timer

      // Recon & Feel
      reconRevealTimer: 0,
      hitstopTimer: 0,
      cameraTrauma: 0,
      muzzleFlashTimer: 0,
      aiMuzzleFlashTimer: 0,
      roundAnnouncement: 'BUY PHASE // PRESS [B] FOR ARMORY' as string | null,
      roundWinner: null as 'PLAYER' | 'AI' | null,
      killFeed: [] as KillFeedEntry[],
      lastHitFeedback: null as HitFeedback | null,
      matchSummary: null as MatchSummaryStats | null,

      // Real-Time 1v1 Online Multiplayer Telemetry
      isMultiplayer: false,
      multiplayerRoomCode: null as string | null,
      multiplayerRole: 'host' as MultiplayerRole,
      multiplayerPlayerId: '',
      playerCallsign: 'STRIKER-01',
      opponentCallsign: null as string | null,
      opponentOperative: 'vex' as OperativeId,
      opponentConnected: false,
      pingMs: 18,
      remoteTargetX: 0,
      remoteTargetY: 0,
      remoteTargetZ: -18.5,
      remoteTargetYaw: Math.PI,
      remoteSpeed: 0,
    };

    const syncBodyDataset = (state: GameAppState) => {
      document.body.dataset.state = state;
    };

    const emitHudSnapshot = () => {
      const activeWeapon =
        sim.ownedWeapons[sim.activeWeaponId] ||
        sim.ownedWeapons.pistol || {
          id: 'pistol',
          ammoInMag: WEAPONS.pistol.magSize,
          ammoReserve: WEAPONS.pistol.maxReserve,
        };

      // Check nearby objective
      let nearbyObjective: InteractiveObjective | null = null;
      for (let i = 0; i < arena.objectives.length; i++) {
        const obj = arena.objectives[i];
        const dist = Math.hypot(sim.playerX - obj.x, sim.playerZ - obj.z);
        if (dist <= 3.2) {
          nearbyObjective = obj;
          break;
        }
      }

      const aiVisibleOnRadar =
        sim.isPracticeMode ||
        sim.reconRevealTimer > 0 ||
        sim.aiLastSawPlayerTime > performance.now() / 1000 - 2.0;

      onHudUpdateRef.current({
        appState: sim.appState,
        roundPhase: sim.roundPhase,
        roundNumber: sim.roundNumber,
        playerScore: sim.playerScore,
        aiScore: sim.aiScore,
        targetRounds: TARGET_ROUND_WINS,
        phaseTimeRemaining: Math.max(0, sim.phaseTimer),
        playerHealth: sim.playerHealth,
        playerMaxHealth: 100,
        playerArmor: sim.playerArmor,
        playerArmorType: sim.playerArmorType,
        playerCredits: sim.playerCredits,
        activeWeapon: { ...activeWeapon },
        ownedWeapons: { ...sim.ownedWeapons },
        isReloading: sim.isReloading,
        reloadProgress: sim.isReloading
          ? Math.min(1, 1 - sim.reloadTimer / Math.max(0.1, sim.reloadDuration))
          : 0,
        isInspecting: sim.isInspecting,
        inspectProgress: sim.isInspecting
          ? Math.min(1, 1 - sim.inspectTimer / Math.max(0.1, sim.inspectDuration))
          : 0,
        isAiming: mouseRightHeld,
        isCrouching:
          sim.isSliding ||
          keysHeld.has('ControlLeft') ||
          keysHeld.has('ControlRight') ||
          keysHeld.has('KeyC'),
        isSliding: sim.isSliding,
        isWalking: keysHeld.has('ShiftLeft') || keysHeld.has('ShiftRight'),
        aiHealth: sim.aiHealth,
        aiMaxHealth: 100,
        aiArmor: sim.aiArmor,
        aiState: sim.aiState,
        aiWeaponId: sim.aiWeaponId,
        aiVisibleOnRadar,
        aiPosition: { x: sim.aiX, z: sim.aiZ },
        playerPosition: { x: sim.playerX, z: sim.playerZ, yaw: sim.playerYaw },
        nearbyObjective,
        killFeed: sim.killFeed,
        lastHitFeedback: sim.lastHitFeedback,
        roundAnnouncement: sim.roundAnnouncement,
        roundWinner: sim.roundWinner,
        isPracticeMode: sim.isPracticeMode,
        difficulty: sim.difficulty,
        operative: sim.operative,
        pointerLocked,
        matchSummary: sim.matchSummary,
        isMultiplayer: sim.isMultiplayer,
        multiplayerRoomCode: sim.multiplayerRoomCode,
        multiplayerRole: sim.multiplayerRole,
        opponentCallsign: sim.opponentCallsign,
        opponentOperative: sim.opponentOperative,
        opponentConnected: sim.opponentConnected,
        pingMs: sim.pingMs,
      });
    };

    // Setup a round reset (preserves survivor weapons and updates economy)
    const setupRound = (isFirstRound: boolean, survivedPlayer: boolean, survivedAI: boolean) => {
      sim.roundPhase = sim.isPracticeMode ? 'combat' : 'buy';
      sim.phaseTimer = sim.isPracticeMode ? COMBAT_PHASE_DURATION : BUY_PHASE_DURATION;
      sim.roundWinner = null;
      sim.roundAnnouncement = sim.isPracticeMode
        ? 'PRACTICE RANGE // FREE COMBAT & ARMORY [B]'
        : `ROUND ${sim.roundNumber} // BUY PHASE [B]`;

      // Player position & health reset
      sim.playerX = arena.playerSpawn.x;
      sim.playerY = 0;
      sim.playerZ = arena.playerSpawn.z;
      sim.playerVx = 0;
      sim.playerVy = 0;
      sim.playerVz = 0;
      sim.playerYaw = arena.playerSpawn.yaw;
      sim.playerPitch = 0;
      sim.recoilPitchOffset = 0;
      sim.recoilYawOffset = 0;
      sim.isSliding = false;
      sim.slideTimer = 0;
      sim.slideCooldown = 0;
      sim.cameraRoll = 0;
      sim.playerHealth = 100;
      sim.isReloading = false;
      sim.reloadTimer = 0;
      sim.isInspecting = false;
      sim.inspectTimer = 0;
      sim.equipTimer = 0.32;
      sim.fireBoltCycleTimer = 0;
      sim.gunKickZ = 0;
      sim.gunKickPitch = 0;
      sim.gunKickRoll = 0;
      sim.shellTimer = 0;
      fpWeaponRig.shellMesh.visible = false;
      sim.fireCooldown = 0;

      if (isFirstRound) {
        sim.ownedWeapons = createInitialInventory();
        sim.activeWeaponId = 'pistol';
        sim.playerArmor = sim.isPracticeMode ? 50 : 0;
        sim.playerArmorType = sim.isPracticeMode ? 'heavy' : 'none';
      } else if (!survivedPlayer) {
        sim.ownedWeapons = createInitialInventory();
        sim.activeWeaponId = 'pistol';
        sim.playerArmor = 0;
        sim.playerArmorType = 'none';
      } else {
        // Refill mags of owned weapons on round start
        (Object.keys(sim.ownedWeapons) as WeaponId[]).forEach((wid) => {
          const w = sim.ownedWeapons[wid];
          if (w) {
            w.ammoInMag = WEAPONS[wid].magSize;
            w.ammoReserve = WEAPONS[wid].maxReserve;
          }
        });
      }

      fpWeaponRig.setActiveWeapon(sim.activeWeaponId);

      // AI Opponent setup & economy purchase (AI carries both Primary Weapon + Sidearm)
      const aiBuy = selectAILoadoutForRound(
        sim.aiCredits,
        !isFirstRound && survivedAI ? sim.aiPrimaryWeaponId : null
      );
      sim.aiPrimaryWeaponId = sim.isPracticeMode ? 'rifle' : aiBuy.weaponId;
      sim.aiWeaponId = sim.aiPrimaryWeaponId;
      sim.aiCredits = aiBuy.remainingCredits;
      sim.aiArmor = ARMOR_SPECS[aiBuy.armorType].points;
      sim.aiHealth = 100;
      sim.aiPrimaryAmmo = WEAPONS[sim.aiPrimaryWeaponId].magSize;
      sim.aiSidearmAmmo = WEAPONS.pistol.magSize;
      sim.aiAmmoInMag = sim.aiPrimaryAmmo;
      sim.aiState = 'patrol';
      aiRig.setEquippedWeapon(sim.aiWeaponId);

      // Spawn AI in North-Mid staging area so sightlines & flanking routes engage quickly
      const side = isFirstRound ? 1 : sim.roundNumber % 2 === 1 ? 1 : -1;
      sim.aiX = side * 2.5;
      sim.aiY = 0;
      sim.aiZ = -13.5;
      sim.aiStuckTimer = 0;
      sim.aiYaw = Math.PI;
      sim.aiTargetX = side * 2.6;
      sim.aiTargetZ = -5.5;
      sim.aiLastKnownPlayerX = arena.playerSpawn.x;
      sim.aiLastKnownPlayerZ = arena.playerSpawn.z;
      sim.aiReactionTimer = 0;
      sim.aiWindupTimer = 0;
      sim.aiBurstShotsLeft = 0;
      sim.aiFireCooldown = 0;
      sim.aiReloadTimer = 0;
      sim.aiCrouchOffset = 0;
      sim.aiCrouchTimer = 0;
      sim.aiIsCrouching = false;
      sim.aiKoTimer = 0;
      sim.sprayStreak = 0;
      sim.sprayDecayTimer = 0;

      aiRig.root.position.set(sim.aiX, 0, sim.aiZ);
      aiRig.root.rotation.set(0, sim.aiYaw, 0);
      aiRig.bodyGroup.rotation.set(0, 0, 0);
      aiRig.bodyGroup.position.set(0, 0, 0);
      aiRig.weaponArm.rotation.set(0, 0, 0);
      aiRig.setHitFlash(false);
      aiRig.setTelegraphState(0);

      emitHudSnapshot();
    };

    const finishMatch = (winner: 'PLAYER' | 'AI') => {
      sim.roundPhase = 'match_over';
      sim.appState = 'gameover';
      syncBodyDataset('gameover');
      try {
        document.exitPointerLock?.();
      } catch {}
      pointerLocked = false;
      keysHeld.clear();
      mouseLeftHeld = false;
      mouseRightHeld = false;

      sim.matchSummary = {
        winner,
        playerRounds: sim.playerScore,
        aiRounds: sim.aiScore,
        totalRoundsPlayed: sim.playerScore + sim.aiScore,
        playerKills: sim.playerKills,
        playerDeaths: sim.playerDeaths,
        shotsFired: sim.shotsFired,
        shotsHit: sim.shotsHit,
        headshots: sim.headshots,
        totalDamageDealt: sim.totalDamageDealt,
        creditsEarned: sim.totalCreditsEarned,
        difficulty: sim.difficulty,
        operative: sim.operative,
        isPractice: sim.isPracticeMode,
      };
      soundEngine.playRoundTransition(winner === 'PLAYER');
      emitHudSnapshot();
    };

    const endRound = (winner: 'PLAYER' | 'AI', reasonText: string) => {
      if (sim.roundPhase === 'round_end' || sim.roundPhase === 'match_over') return;

      // In Practice mode, respawn the AI after a short beat without ending the match
      if (sim.isPracticeMode) {
        if (winner === 'PLAYER') {
          sim.playerScore += 1;
          sim.playerCredits = Math.min(MAX_CREDITS, sim.playerCredits + KILL_CREDIT_BONUS);
        } else {
          sim.aiScore += 1;
        }
        sim.roundPhase = 'round_end';
        sim.phaseTimer = 1.8;
        sim.roundWinner = winner;
        sim.roundAnnouncement = `${reasonText} // RESPAWNING BOT`;
        soundEngine.playRoundTransition(winner === 'PLAYER');
        emitHudSnapshot();
        return;
      }

      sim.roundPhase = 'round_end';
      sim.phaseTimer = ROUND_END_DURATION;
      sim.roundWinner = winner;

      if (winner === 'PLAYER') {
        sim.playerScore += 1;
      } else {
        sim.aiScore += 1;
      }

      // Economy update
      const playerEco = calculateRoundEconomy(
        sim.playerCredits,
        winner === 'PLAYER',
        sim.playerLossStreak,
        winner === 'PLAYER' ? 1 : 0
      );
      sim.playerCredits = playerEco.nextCredits;
      sim.playerLossStreak = playerEco.nextLossStreak;
      sim.totalCreditsEarned += playerEco.awardBreakdown;

      const aiEco = calculateRoundEconomy(
        sim.aiCredits,
        winner === 'AI',
        sim.aiLossStreak,
        winner === 'AI' ? 1 : 0
      );
      sim.aiCredits = aiEco.nextCredits;
      sim.aiLossStreak = aiEco.nextLossStreak;

      sim.roundAnnouncement = `${reasonText} // +${playerEco.awardBreakdown} CREDITS`;
      soundEngine.playRoundTransition(winner === 'PLAYER');
      emitHudSnapshot();
    };

    // Player Weapon Firing with Raycast, Recoil, Spread, Wall Occlusion & Hit Detection
    const firePlayerWeapon = (clickClientX?: number, clickClientY?: number) => {
      if (sim.appState !== 'playing' || sim.playerHealth <= 0) return;
      if (sim.roundPhase === 'round_end' || sim.roundPhase === 'match_over') return;

      // If player shoots during Buy Phase, immediately transition to live combat!
      if (sim.roundPhase === 'buy') {
        sim.roundPhase = 'combat';
        sim.phaseTimer = COMBAT_PHASE_DURATION;
        sim.roundAnnouncement = null;
      }

      const weaponInst = sim.ownedWeapons[sim.activeWeaponId];
      if (!weaponInst) return;
      const spec = WEAPONS[sim.activeWeaponId];

      if (sim.isReloading) return;
      if (sim.fireCooldown > 0) return;

      // Cancel active weapon inspection when firing
      sim.isInspecting = false;
      sim.inspectTimer = 0;

      if (weaponInst.ammoInMag <= 0) {
        // Trigger auto-reload if reserve ammo is available
        if (weaponInst.ammoReserve > 0) {
          sim.isReloading = true;
          sim.reloadDuration = spec.reloadTime;
          sim.reloadTimer = spec.reloadTime;
          soundEngine.playReload(spec.reloadTime);
          emitHudSnapshot();
        }
        return;
      }

      // Consume ammo & set fire interval
      weaponInst.ammoInMag -= 1;
      sim.fireCooldown = 1 / spec.fireRate;
      sim.shotsFired += 1;

      // Muzzle flash, audio, bolt reciprocation & brass shell ejection
      soundEngine.playWeaponFire(spec.id, false);
      fpWeaponRig.muzzleFlash.visible = true;
      fpWeaponRig.muzzleFlash.rotation.z = Math.random() * Math.PI;
      fpWeaponRig.muzzleFlash.scale.setScalar(0.88 + Math.random() * 0.48);
      fpWeaponRig.muzzleLight.intensity = 3.8;
      sim.muzzleFlashTimer = 0.055;
      sim.fireBoltCycleDuration =
        spec.id === 'sniper' ? 0.56 : spec.id === 'shotgun' ? 0.48 : 0.14;
      sim.fireBoltCycleTimer = sim.fireBoltCycleDuration;

      // Eject spinning brass shell casing from ejection port
      sim.shellTimer = 0.28;
      sim.shellX = 0.035;
      sim.shellY = 0.045;
      sim.shellZ = -0.08;
      sim.shellVx = 0.85 + Math.random() * 0.35;
      sim.shellVy = 0.68 + Math.random() * 0.28;
      sim.shellVz = 0.12 + (Math.random() - 0.5) * 0.15;
      fpWeaponRig.shellMesh.visible = true;

      // Acoustic gunshot awareness: AI hears un-suppressed shots & updates threat coordinate
      sim.aiLastKnownPlayerX = sim.playerX;
      sim.aiLastKnownPlayerZ = sim.playerZ;
      const nowSecForShot = performance.now() / 1000;
      if (nowSecForShot - sim.aiLastSawPlayerTime > 1.8) {
        sim.aiLastSawPlayerTime = nowSecForShot - 1.4;
      }

      // Movement & stance spread calculation
      const speedHoriz = Math.hypot(sim.playerVx, sim.playerVz);
      const isCrouching =
        keysHeld.has('ControlLeft') || keysHeld.has('ControlRight') || keysHeld.has('KeyC');
      let currentSpread = spec.baseSpread + (speedHoriz / 7.0) * spec.moveSpreadPenalty;
      if (mouseRightHeld) currentSpread *= spec.adsSpreadMultiplier;
      if (isCrouching) currentSpread *= 0.65;
      if (!sim.isGrounded) currentSpread += 0.065;

      camera.getWorldPosition(_rayOrigin);

      // Determine base aim direction:
      // If not pointer-locked and the user clicked a specific viewport coordinate that intersects the AI, allow direct viewport aim
      let baseDirSet = false;
      if (
        !pointerLocked &&
        typeof clickClientX === 'number' &&
        typeof clickClientY === 'number' &&
        sim.aiHealth > 0
      ) {
        const rect = renderer.domElement.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          _ndcMouse.x = ((clickClientX - rect.left) / rect.width) * 2 - 1;
          _ndcMouse.y = -((clickClientY - rect.top) / rect.height) * 2 + 1;
          raycaster.setFromCamera(_ndcMouse, camera);
          const directHits = raycaster.intersectObjects(aiRig.hitTargets, false);
          if (directHits.length > 0) {
            _forward.copy(raycaster.ray.direction).normalize();
            baseDirSet = true;
          }
        }
      }

      if (!baseDirSet) {
        camera.getWorldDirection(_forward);
      }

      let totalHitDamage = 0;
      let anyHeadshot = false;
      let hitPointWorld: THREE.Vector3 | null = null;
      let tracerEnd = _rayOrigin.clone().addScaledVector(_forward, 45);

      aiRig.root.updateMatrixWorld(true);

      for (let p = 0; p < spec.pellets; p++) {
        _rayDir.copy(_forward);
        if (currentSpread > 0.0005) {
          _rayDir.x += (Math.random() - 0.5) * currentSpread * 2;
          _rayDir.y += (Math.random() - 0.5) * currentSpread * 2;
          _rayDir.z += (Math.random() - 0.5) * currentSpread * 2;
          _rayDir.normalize();
        }

        // 1. Find closest wall/cover AABB intersection distance
        let closestWallDist = spec.range;
        for (let i = 0; i < arena.obstacles.length; i++) {
          const hitT = intersectRayAABB(
            _rayOrigin.x,
            _rayOrigin.y,
            _rayOrigin.z,
            _rayDir.x,
            _rayDir.y,
            _rayDir.z,
            closestWallDist,
            arena.obstacles[i]
          );
          if (hitT !== null && hitT < closestWallDist) {
            closestWallDist = hitT;
          }
        }

        // 2. Raycast against AI Operative hitboxes
        raycaster.set(_rayOrigin, _rayDir);
        raycaster.near = 0.1;
        raycaster.far = closestWallDist; // Strictly cannot shoot through walls!

        const hits = sim.aiHealth > 0 ? raycaster.intersectObjects(aiRig.hitTargets, false) : [];
        if (hits.length > 0 && hits[0].distance < closestWallDist) {
          const hit = hits[0];
          const isHead = hit.object.userData.hitbox === 'head';
          if (isHead) anyHeadshot = true;
          const rawDmg = isHead ? spec.headDamage : spec.bodyDamage;
          totalHitDamage += rawDmg;
          hitPointWorld = hit.point.clone();
          tracerEnd = hit.point.clone();
        } else if (closestWallDist < spec.range) {
          // Wall impact sparks
          const wallHitPos = _rayOrigin.clone().addScaledVector(_rayDir, closestWallDist);
          tracerEnd = wallHitPos;
          if (p === 0) {
            spawnParticles(wallHitPos.x, wallHitPos.y, wallHitPos.z, 5, spec.tracerColor, 3.2);
          }
        }
      }

      // Update visible bullet tracer
      const posAttr = tracerGeo.getAttribute('position') as THREE.BufferAttribute;
      posAttr.setXYZ(0, _rayOrigin.x + 0.18, _rayOrigin.y - 0.12, _rayOrigin.z);
      posAttr.setXYZ(1, tracerEnd.x, tracerEnd.y, tracerEnd.z);
      posAttr.needsUpdate = true;
      tracerMat.color.setHex(spec.tracerColor);
      tracerMat.opacity = 0.85;
      tracerTimer = 0.07;

      if (sim.isMultiplayer) {
        sendMultiplayerMessage({
          type: 'mp:shoot',
          weaponId: spec.id,
          originX: _rayOrigin.x + 0.18,
          originY: _rayOrigin.y - 0.12,
          originZ: _rayOrigin.z,
          endX: tracerEnd.x,
          endY: tracerEnd.y,
          endZ: tracerEnd.z,
        });
      }

      // Apply progressive spray streak + crisp axial recoil kick (zero random camera jitter or gun wobble)
      sim.sprayStreak = Math.min(15, sim.sprayStreak + 1);
      sim.sprayDecayTimer = (1 / spec.fireRate) * 1.65;
      const sprayMult = 1 + sim.sprayStreak * 0.055;
      const adsRecoilMult = mouseRightHeld ? 0.72 : 1.0;

      sim.recoilPitchOffset = Math.min(
        0.21,
        sim.recoilPitchOffset + spec.recoilPitch * sprayMult * adsRecoilMult
      );
      // Smooth deterministic S-curve horizontal drift only on sustained spray (zero random shake on tap/burst)
      const sprayYawFactor = Math.min(1, Math.max(0, (sim.sprayStreak - 2) / 6));
      sim.recoilYawOffset +=
        Math.sin(sim.sprayStreak * 0.72) * spec.recoilYaw * sprayYawFactor * adsRecoilMult;

      const isHeavyGun = spec.id === 'sniper' || spec.id === 'shotgun';
      // Crisp straight-back shoulder recoil impulse with tight, non-flapping muzzle rise
      sim.gunKickZ = Math.min(
        0.058,
        sim.gunKickZ + (isHeavyGun ? 0.046 : 0.026) + spec.recoilPitch * 0.25
      );
      sim.gunKickY = Math.min(0.008, sim.gunKickY + (isHeavyGun ? 0.005 : 0.002));
      sim.gunKickPitch = Math.min(
        0.052,
        sim.gunKickPitch + (isHeavyGun ? 0.038 : 0.015) + spec.recoilPitch * 0.35
      );
      sim.gunKickRoll = 0;

      // Process Opponent Damage if hit
      if (totalHitDamage > 0 && hitPointWorld && sim.aiHealth > 0) {
        sim.shotsHit += 1;
        if (anyHeadshot) sim.headshots += 1;
        const dist = _rayOrigin.distanceTo(hitPointWorld);

        if (sim.isMultiplayer) {
          // Server-authoritative damage calculation & round resolution via WebSocket
          sim.aiHitFlashTimer = 0.075;
          aiRig.setHitFlash(true);
          spawnParticles(
            hitPointWorld.x,
            hitPointWorld.y,
            hitPointWorld.z,
            anyHeadshot ? 16 : 8,
            anyHeadshot ? 0xfbbf24 : 0xf43f5e,
            anyHeadshot ? 6.2 : 4.0
          );
          sendMultiplayerMessage({
            type: 'mp:hit',
            weaponId: spec.id,
            rawDamage: totalHitDamage,
            isHeadshot: anyHeadshot,
            distance: dist,
            hitX: hitPointWorld.x,
            hitY: hitPointWorld.y,
            hitZ: hitPointWorld.z,
          });
        } else {
          const dmgRes = calculateDamageWithArmor(
            totalHitDamage,
            sim.aiHealth,
            sim.aiArmor,
            dist,
            spec.range,
            spec.falloffStart
          );

          sim.aiHealth = dmgRes.newHealth;
          sim.aiArmor = dmgRes.newArmor;
          sim.totalDamageDealt += dmgRes.totalDamage;
          sim.aiHitFlashTimer = 0.075;
          aiRig.setHitFlash(true);

          // Alert AI immediately to player's direction when shot
          sim.aiLastSawPlayerTime = performance.now() / 1000;

          // Weight-scaled juice: hitstop, particles, hitmarker sound (no random camera shake)
          soundEngine.playHitMarker(anyHeadshot, dmgRes.eliminated);
          spawnParticles(
            hitPointWorld.x,
            hitPointWorld.y,
            hitPointWorld.z,
            anyHeadshot ? 18 : 9,
            anyHeadshot ? 0xfbbf24 : 0xf43f5e,
            anyHeadshot ? 6.5 : 4.2
          );

          if (anyHeadshot || dmgRes.eliminated) {
            sim.hitstopTimer = dmgRes.eliminated ? 0.045 : 0.028;
          }

          sim.lastHitFeedback = {
            damage: dmgRes.totalDamage,
            isHeadshot: anyHeadshot,
            isKill: dmgRes.eliminated,
            timestamp: performance.now(),
            worldX: hitPointWorld.x,
            worldY: hitPointWorld.y,
            worldZ: hitPointWorld.z,
          };

          if (dmgRes.eliminated) {
            sim.playerKills += 1;
            sim.aiKoTimer = 0.45;
            aiRig.setTelegraphState(0);
            sim.killFeed = [
              {
                id: `kf_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                killer: 'PLAYER' as const,
                victim: 'AI' as const,
                weaponId: spec.id,
                weaponName: spec.name,
                isHeadshot: anyHeadshot,
                timestamp: performance.now(),
              },
              ...sim.killFeed,
            ].slice(0, 4);

            endRound('PLAYER', anyHeadshot ? 'HEADSHOT ELIMINATION' : 'OPPONENT ELIMINATED');
          }
        }
      }

      emitHudSnapshot();
    };

    // Start Reloading
    const triggerReload = () => {
      if (sim.appState !== 'playing' || sim.isReloading || sim.playerHealth <= 0) return;
      const inst = sim.ownedWeapons[sim.activeWeaponId];
      if (!inst) return;
      const spec = WEAPONS[sim.activeWeaponId];
      if (inst.ammoInMag >= spec.magSize || inst.ammoReserve <= 0) return;

      sim.isInspecting = false;
      sim.inspectTimer = 0;
      sim.isReloading = true;
      sim.reloadDuration = spec.reloadTime;
      sim.reloadTimer = spec.reloadTime;
      soundEngine.playReload(spec.reloadTime);
      emitHudSnapshot();
    };

    // Start 3D Weapon & Tactical Arm Inspection ([Y], [I], or [V] key)
    const triggerWeaponInspect = () => {
      if (sim.appState !== 'playing' || sim.isReloading || sim.playerHealth <= 0) return;
      if (mouseRightHeld) {
        mouseRightHeld = false;
      }
      sim.isInspecting = true;
      sim.inspectDuration = 2.4;
      sim.inspectTimer = sim.inspectDuration;
      soundEngine.playWeaponInspect();
      emitHudSnapshot();
    };

    // Interact with Arena Objective ([E] key)
    const triggerObjectiveInteract = () => {
      if (sim.appState !== 'playing' || sim.playerHealth <= 0) return;
      const nowSec = performance.now() / 1000;
      for (let i = 0; i < arena.objectives.length; i++) {
        const obj = arena.objectives[i];
        const dist = Math.hypot(sim.playerX - obj.x, sim.playerZ - obj.z);
        if (dist <= 3.4 && nowSec - obj.lastUsedTime >= obj.cooldown) {
          obj.lastUsedTime = nowSec;
          soundEngine.playBuySound();
          if (obj.type === 'ammo_crate') {
            const w = sim.ownedWeapons[sim.activeWeaponId];
            if (w) {
              w.ammoInMag = WEAPONS[sim.activeWeaponId].magSize;
              w.ammoReserve = WEAPONS[sim.activeWeaponId].maxReserve;
            }
            sim.playerArmor = Math.min(50, sim.playerArmor + 15);
            if (sim.playerArmorType === 'none') sim.playerArmorType = 'light';
            sim.roundAnnouncement = 'MUNITIONS LOCKER // AMMO & +15 SHIELD RESTORED';
          } else {
            sim.reconRevealTimer = 6.0;
            sim.roundAnnouncement = 'RADIANITE RECON // OPPONENT POSITION REVEALED (6S)';
          }
          emitHudSnapshot();
          break;
        }
      }
    };

    // ====================================================================
    // 7b. REAL-TIME 1V1 MULTIPLAYER WEBSOCKET CLIENT & SYNC MANAGER
    // ====================================================================
    let mpSocket: WebSocket | null = null;
    let mpReconnectTimer: number | null = null;
    let mpPingInterval: number | null = null;
    let mpStateEmitAccum = 0;

    const closeMultiplayerSocket = () => {
      if (mpReconnectTimer !== null) {
        window.clearTimeout(mpReconnectTimer);
        mpReconnectTimer = null;
      }
      if (mpPingInterval !== null) {
        window.clearInterval(mpPingInterval);
        mpPingInterval = null;
      }
      if (mpSocket) {
        mpSocket.onclose = null;
        mpSocket.onmessage = null;
        mpSocket.onerror = null;
        try {
          mpSocket.close();
        } catch {}
        mpSocket = null;
      }
    };

    const sendMultiplayerMessage = (payload: Record<string, unknown>) => {
      if (mpSocket && mpSocket.readyState === WebSocket.OPEN) {
        try {
          mpSocket.send(JSON.stringify(payload));
        } catch {}
      }
    };

    const resetLocalMultiplayerSpawnForRound = (
      role: MultiplayerRole,
      survivedLastRound: boolean,
      isFirstRound: boolean
    ) => {
      const mySpawn = getSpawnForRole(role);
      sim.playerX = mySpawn.x;
      sim.playerY = mySpawn.y;
      sim.playerZ = mySpawn.z;
      sim.playerVx = 0;
      sim.playerVy = 0;
      sim.playerVz = 0;
      sim.playerYaw = mySpawn.yaw;
      sim.playerPitch = 0;
      sim.recoilPitchOffset = 0;
      sim.recoilYawOffset = 0;
      sim.isSliding = false;
      sim.slideTimer = 0;
      sim.slideCooldown = 0;
      sim.cameraRoll = 0;
      sim.playerHealth = 100;
      sim.isReloading = false;
      sim.reloadTimer = 0;
      sim.isInspecting = false;
      sim.inspectTimer = 0;
      sim.equipTimer = 0.32;
      sim.fireBoltCycleTimer = 0;
      sim.gunKickZ = 0;
      sim.gunKickPitch = 0;
      sim.gunKickRoll = 0;

      if (isFirstRound || !survivedLastRound) {
        sim.ownedWeapons = createInitialInventory();
        sim.activeWeaponId = 'pistol';
        sim.playerArmor = 0;
        sim.playerArmorType = 'none';
      } else {
        (Object.keys(sim.ownedWeapons) as WeaponId[]).forEach((wid) => {
          const w = sim.ownedWeapons[wid];
          if (w) {
            w.ammoInMag = WEAPONS[wid].magSize;
            w.ammoReserve = WEAPONS[wid].maxReserve;
          }
        });
      }
      fpWeaponRig.setActiveWeapon(sim.activeWeaponId);
    };

    const applyRoomSyncToSim = (
      room: MultiplayerRoomState,
      serverTime: number,
      forceSpawnReset = false
    ) => {
      const role = sim.multiplayerRole;
      const myState = role === 'host' ? room.host : room.guest;
      const oppState = role === 'host' ? room.guest : room.host;

      const prevRound = sim.roundNumber;
      const prevPhase = sim.roundPhase;
      const isNewBuyRound =
        forceSpawnReset ||
        room.roundNumber !== prevRound ||
        (room.roundPhase === 'buy' && prevPhase !== 'buy');

      sim.roundNumber = room.roundNumber;
      sim.roundPhase = room.roundPhase;
      sim.phaseTimer = Math.max(0.5, (room.phaseEndsAt - serverTime) / 1000);
      sim.playerScore = role === 'host' ? room.hostScore : room.guestScore;
      sim.aiScore = role === 'host' ? room.guestScore : room.hostScore;
      sim.roundAnnouncement = room.announcement;
      sim.killFeed = (room.killFeed || []).map((entry) =>
        role === 'guest'
          ? {
              ...entry,
              killer: entry.killer === 'PLAYER' ? 'AI' : 'PLAYER',
              victim: entry.victim === 'PLAYER' ? 'AI' : 'PLAYER',
            }
          : entry
      );

      if (myState) {
        if (isNewBuyRound) {
          sim.playerCredits = myState.credits;
          resetLocalMultiplayerSpawnForRound(
            role,
            myState.survivedLastRound,
            room.roundNumber === 1
          );
        }
        sim.playerHealth = myState.health;
      }

      if (oppState) {
        sim.opponentCallsign = oppState.callsign;
        sim.opponentOperative = oppState.operative;
        sim.opponentConnected = oppState.connected;
        sim.aiHealth = oppState.health;
        sim.aiArmor = oppState.armor;
        if (oppState.weaponId && oppState.weaponId !== sim.aiWeaponId) {
          sim.aiWeaponId = oppState.weaponId;
          aiRig.setEquippedWeapon(sim.aiWeaponId);
        }
        if (isNewBuyRound) {
          sim.aiX = oppState.x;
          sim.aiY = oppState.y;
          sim.aiZ = oppState.z;
          sim.aiYaw = oppState.yaw;
          sim.remoteTargetX = oppState.x;
          sim.remoteTargetY = oppState.y;
          sim.remoteTargetZ = oppState.z;
          sim.remoteTargetYaw = oppState.yaw;
          sim.aiKoTimer = 0;
          aiRig.root.position.set(sim.aiX, 0, sim.aiZ);
          aiRig.root.rotation.set(0, sim.aiYaw, 0);
          aiRig.bodyGroup.rotation.set(0, 0, 0);
          aiRig.bodyGroup.position.set(0, 0, 0);
          aiRig.setHitFlash(false);
        }
      } else {
        sim.opponentCallsign = null;
        sim.opponentConnected = false;
      }

      if (room.status === 'finished' || room.roundPhase === 'match_over') {
        const won = room.matchWinner === role;
        finishMatch(won ? 'PLAYER' : 'AI');
        return;
      }

      emitHudSnapshot();
    };

    const connectMultiplayerSocket = (
      code: string,
      role: MultiplayerRole,
      playerId: string
    ) => {
      closeMultiplayerSocket();
      const wsProto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${wsProto}//${window.location.host}/ws/match`;
      const ws = new WebSocket(wsUrl);
      mpSocket = ws;

      ws.onopen = () => {
        ws.send(
          JSON.stringify({
            type: 'mp:join_socket',
            code,
            role,
            playerId,
          })
        );
        mpPingInterval = window.setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(
              JSON.stringify({
                type: 'mp:ping',
                clientSentAt: Date.now(),
                lastRttMs: sim.pingMs,
              })
            );
          }
        }, 2000);
      };

      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(String(ev.data));
          if (!msg || typeof msg.type !== 'string') return;

          if (msg.type === 'mp:pong') {
            if (typeof msg.clientSentAt === 'number') {
              sim.pingMs = Math.max(1, Math.min(999, Date.now() - msg.clientSentAt));
            }
            return;
          }

          if (msg.type === 'mp:room_sync' && msg.room) {
            applyRoomSyncToSim(msg.room as MultiplayerRoomState, msg.serverTime || Date.now());
            return;
          }

          if (msg.type === 'mp:remote_state' && msg.role !== sim.multiplayerRole && msg.player) {
            const p = msg.player;
            sim.opponentConnected = true;
            sim.opponentCallsign = p.callsign || sim.opponentCallsign;
            sim.remoteTargetX = Number.isFinite(p.x) ? p.x : sim.remoteTargetX;
            sim.remoteTargetY = Number.isFinite(p.y) ? p.y : 0;
            sim.remoteTargetZ = Number.isFinite(p.z) ? p.z : sim.remoteTargetZ;
            sim.remoteTargetYaw = Number.isFinite(p.yaw) ? p.yaw : sim.remoteTargetYaw;
            sim.remoteSpeed = Math.hypot(p.vx || 0, p.vz || 0);
            sim.aiIsCrouching = Boolean(p.isCrouching || p.isSliding);
            sim.aiArmor = typeof p.armor === 'number' ? p.armor : sim.aiArmor;
            if (p.weaponId && p.weaponId !== sim.aiWeaponId) {
              sim.aiWeaponId = p.weaponId;
              aiRig.setEquippedWeapon(sim.aiWeaponId);
            }
            return;
          }

          if (msg.type === 'mp:remote_shoot' && msg.role !== sim.multiplayerRole) {
            const shotWep: WeaponId = msg.weaponId || sim.aiWeaponId;
            aiRig.muzzleFlash.visible = true;
            aiRig.muzzleFlash.rotation.z = Math.random() * Math.PI;
            sim.aiMuzzleFlashTimer = 0.065;
            soundEngine.playWeaponFire(shotWep, true);

            const aiPosAttr = aiTracerGeo.getAttribute('position') as THREE.BufferAttribute;
            aiPosAttr.setXYZ(
              0,
              Number(msg.originX) || sim.aiX,
              Number(msg.originY) || 1.35,
              Number(msg.originZ) || sim.aiZ
            );
            aiPosAttr.setXYZ(
              1,
              Number(msg.endX) || sim.playerX,
              Number(msg.endY) || 1.35,
              Number(msg.endZ) || sim.playerZ
            );
            aiPosAttr.needsUpdate = true;
            aiTracerMat.opacity = 0.9;
            aiTracerTimer = 0.085;
            return;
          }

          if (msg.type === 'mp:damage' && msg.event && msg.room) {
            const dmgEv = msg.event as DamageResolutionEvent;
            const room = msg.room as MultiplayerRoomState;

            if (dmgEv.victimRole === sim.multiplayerRole) {
              // Local player took damage from remote opponent
              sim.playerHealth = dmgEv.newHealth;
              sim.playerArmor = dmgEv.newArmor;
              if (sim.playerArmor <= 0) sim.playerArmorType = 'none';
              sim.cameraTrauma = Math.min(1, sim.cameraTrauma + 0.34);
              soundEngine.playPlayerHurt();
              if (dmgEv.eliminated) {
                sim.playerDeaths += 1;
                soundEngine.playRoundTransition(false);
              }
            } else if (dmgEv.attackerRole === sim.multiplayerRole) {
              // Local player's shot damaged remote opponent
              sim.aiHealth = dmgEv.newHealth;
              sim.aiArmor = dmgEv.newArmor;
              sim.totalDamageDealt += dmgEv.damageApplied;
              soundEngine.playHitMarker(dmgEv.isHeadshot, dmgEv.eliminated);
              sim.lastHitFeedback = {
                damage: dmgEv.damageApplied,
                isHeadshot: dmgEv.isHeadshot,
                isKill: dmgEv.eliminated,
                timestamp: performance.now(),
                worldX: dmgEv.hitX,
                worldY: dmgEv.hitY,
                worldZ: dmgEv.hitZ,
              };
              if (dmgEv.eliminated) {
                sim.playerKills += 1;
                sim.aiKoTimer = 0.45;
                soundEngine.playRoundTransition(true);
              }
            }

            applyRoomSyncToSim(room, msg.serverTime || Date.now());
            return;
          }
        } catch {}
      };

      ws.onclose = () => {
        if (sim.isMultiplayer && sim.appState !== 'title' && sim.multiplayerRoomCode) {
          mpReconnectTimer = window.setTimeout(() => {
            if (sim.isMultiplayer && sim.multiplayerRoomCode) {
              connectMultiplayerSocket(
                sim.multiplayerRoomCode,
                sim.multiplayerRole,
                sim.multiplayerPlayerId
              );
            }
          }, 1500);
        }
      };
    };

    // 8. Register External API for UI Components
    const api: TacticalEngineAPI = {
      startNewMatch: (operative: OperativeId, difficulty: AIDifficulty, practiceMode: boolean) => {
        closeMultiplayerSocket();
        sim.isMultiplayer = false;
        sim.multiplayerRoomCode = null;
        sim.opponentCallsign = null;
        sim.opponentConnected = false;
        aiRig.root.visible = true;

        sim.operative = operative;
        sim.difficulty = difficulty;
        sim.isPracticeMode = practiceMode;
        sim.playerScore = 0;
        sim.aiScore = 0;
        sim.roundNumber = 1;
        sim.playerCredits = practiceMode ? MAX_CREDITS : STARTING_CREDITS;
        sim.aiCredits = STARTING_CREDITS;
        sim.playerLossStreak = 0;
        sim.aiLossStreak = 0;
        sim.playerKills = 0;
        sim.playerDeaths = 0;
        sim.shotsFired = 0;
        sim.shotsHit = 0;
        sim.headshots = 0;
        sim.totalDamageDealt = 0;
        sim.totalCreditsEarned = sim.playerCredits;
        sim.killFeed = [];
        sim.matchSummary = null;
        sim.appState = 'playing';
        syncBodyDataset('playing');

        fpWeaponRig.updateAccentColor(OPERATIVES[operative].accentColor);
        keysHeld.clear();
        mouseLeftHeld = false;
        mouseRightHeld = false;

        if (document.activeElement instanceof HTMLElement) {
          document.activeElement.blur();
        }

        setupRound(true, false, false);
      },

      startMultiplayerMatch: (
        room: MultiplayerRoomState,
        role: MultiplayerRole,
        playerId: string,
        callsign: string,
        operative: OperativeId
      ) => {
        sim.isMultiplayer = true;
        sim.isPracticeMode = false;
        sim.multiplayerRoomCode = room.code;
        sim.multiplayerRole = role;
        sim.multiplayerPlayerId = playerId;
        sim.playerCallsign = callsign;
        sim.operative = operative;
        sim.playerKills = 0;
        sim.playerDeaths = 0;
        sim.shotsFired = 0;
        sim.shotsHit = 0;
        sim.headshots = 0;
        sim.totalDamageDealt = 0;
        sim.totalCreditsEarned = STARTING_CREDITS;
        sim.matchSummary = null;
        sim.appState = 'playing';
        syncBodyDataset('playing');

        fpWeaponRig.updateAccentColor(OPERATIVES[operative].accentColor);
        keysHeld.clear();
        mouseLeftHeld = false;
        mouseRightHeld = false;

        if (document.activeElement instanceof HTMLElement) {
          document.activeElement.blur();
        }

        const oppSpawn = getSpawnForRole(role === 'host' ? 'guest' : 'host');
        sim.aiX = oppSpawn.x;
        sim.aiY = oppSpawn.y;
        sim.aiZ = oppSpawn.z;
        sim.aiYaw = oppSpawn.yaw;
        sim.remoteTargetX = oppSpawn.x;
        sim.remoteTargetY = oppSpawn.y;
        sim.remoteTargetZ = oppSpawn.z;
        sim.remoteTargetYaw = oppSpawn.yaw;
        sim.remoteSpeed = 0;

        applyRoomSyncToSim(room, Date.now(), true);
        connectMultiplayerSocket(room.code, role, playerId);
      },

      resumeGame: () => {
        if (sim.appState === 'paused') {
          sim.appState = 'playing';
          syncBodyDataset('playing');
          keysHeld.clear();
          mouseLeftHeld = false;
          emitHudSnapshot();
        }
      },

      pauseGame: () => {
        if (sim.appState === 'playing') {
          sim.appState = 'paused';
          syncBodyDataset('paused');
          try {
            document.exitPointerLock?.();
          } catch {}
          pointerLocked = false;
          keysHeld.clear();
          mouseLeftHeld = false;
          mouseRightHeld = false;
          emitHudSnapshot();
        }
      },

      returnToTitle: () => {
        closeMultiplayerSocket();
        sim.isMultiplayer = false;
        sim.multiplayerRoomCode = null;
        aiRig.root.visible = true;
        sim.appState = 'title';
        syncBodyDataset('title');
        try {
          document.exitPointerLock?.();
        } catch {}
        pointerLocked = false;
        keysHeld.clear();
        mouseLeftHeld = false;
        mouseRightHeld = false;
        emitHudSnapshot();
      },

      restartMatch: () => {
        if (sim.isMultiplayer) {
          sim.appState = 'playing';
          syncBodyDataset('playing');
          sendMultiplayerMessage({ type: 'mp:rematch' });
          emitHudSnapshot();
        } else {
          api.startNewMatch(sim.operative, sim.difficulty, sim.isPracticeMode);
        }
      },

      purchaseWeapon: (weaponId: WeaponId) => {
        const check = canPurchaseWeapon(sim.playerCredits, sim.ownedWeapons, weaponId);
        if (!check.allowed) return false;
        sim.playerCredits -= check.cost;
        sim.ownedWeapons[weaponId] = {
          id: weaponId,
          ammoInMag: WEAPONS[weaponId].magSize,
          ammoReserve: WEAPONS[weaponId].maxReserve,
        };
        sim.activeWeaponId = weaponId;
        sim.isReloading = false;
        sim.isInspecting = false;
        sim.inspectTimer = 0;
        sim.equipTimer = sim.equipDuration;
        fpWeaponRig.setActiveWeapon(weaponId);
        soundEngine.playBuySound();
        emitHudSnapshot();
        return true;
      },

      purchaseArmor: (armorType: ArmorType) => {
        const check = canPurchaseArmor(
          sim.playerCredits,
          sim.playerArmor,
          sim.playerArmorType,
          armorType
        );
        if (!check.allowed) return false;
        sim.playerCredits -= check.cost;
        sim.playerArmor = ARMOR_SPECS[armorType].points;
        sim.playerArmorType = armorType;
        soundEngine.playBuySound();
        emitHudSnapshot();
        return true;
      },

      equipWeapon: (weaponId: WeaponId) => {
        if (sim.ownedWeapons[weaponId] && sim.activeWeaponId !== weaponId) {
          sim.activeWeaponId = weaponId;
          sim.isReloading = false;
          sim.isInspecting = false;
          sim.inspectTimer = 0;
          sim.equipTimer = sim.equipDuration;
          fpWeaponRig.setActiveWeapon(weaponId);
          soundEngine.playWeaponEquip();
          emitHudSnapshot();
        }
      },

      inspectWeapon: () => {
        triggerWeaponInspect();
      },

      skipBuyPhase: () => {
        if (sim.roundPhase === 'buy') {
          if (sim.isMultiplayer) {
            sendMultiplayerMessage({ type: 'mp:deploy_now' });
          } else {
            sim.roundPhase = 'combat';
            sim.phaseTimer = COMBAT_PHASE_DURATION;
            sim.roundAnnouncement = 'COMBAT LIVE // ELIMINATE OPPONENT';
            soundEngine.playRoundTransition(null);
            emitHudSnapshot();
          }
        }
      },

      interactObjective: () => {
        triggerObjectiveInteract();
      },

      toggleBuyMenu: () => {
        onToggleBuyMenuRef.current();
      },

      practiceAction: (action) => {
        if (action === 'refill_credits') {
          sim.playerCredits = MAX_CREDITS;
          soundEngine.playBuySound();
        } else if (action === 'heal_player') {
          sim.playerHealth = 100;
          sim.playerArmor = 50;
          sim.playerArmorType = 'heavy';
          soundEngine.playBuySound();
        } else if (action === 'spawn_bot_mid') {
          // Place AI directly in clear sightline in front of player in Mid Courtyard and cycle its primary gun
          const aiGunRotation: WeaponId[] = ['rifle', 'sniper', 'smg', 'shotgun', 'pistol'];
          const nextIdx = (aiGunRotation.indexOf(sim.aiPrimaryWeaponId) + 1) % aiGunRotation.length;
          sim.aiPrimaryWeaponId = aiGunRotation[nextIdx];
          sim.aiWeaponId = sim.aiPrimaryWeaponId;
          sim.aiPrimaryAmmo = WEAPONS[sim.aiPrimaryWeaponId].magSize;
          sim.aiSidearmAmmo = WEAPONS.pistol.magSize;
          sim.aiAmmoInMag = sim.aiPrimaryAmmo;
          aiRig.setEquippedWeapon(sim.aiWeaponId);

          sim.aiHealth = 100;
          sim.aiArmor = 25;
          sim.aiKoTimer = 0;
          sim.aiX = 0;
          sim.aiZ = sim.playerZ - 11;
          aiRig.root.position.set(sim.aiX, 0, sim.aiZ);
          aiRig.bodyGroup.rotation.set(0, 0, 0);
          soundEngine.playBuySound();
        } else if (action === 'sim_round_win') {
          sim.aiHealth = 0;
          sim.playerKills += 1;
          sim.killFeed = [
            {
              id: `kf_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
              killer: 'PLAYER' as const,
              victim: 'AI' as const,
              weaponId: sim.activeWeaponId,
              weaponName: WEAPONS[sim.activeWeaponId].name,
              isHeadshot: true,
              timestamp: performance.now(),
            },
            ...sim.killFeed,
          ].slice(0, 4);
          endRound('PLAYER', 'TACTICAL OVERRIDE // ROUND WON');
        } else if (action === 'sim_match_win') {
          sim.playerScore = TARGET_ROUND_WINS;
          finishMatch('PLAYER');
        }
        emitHudSnapshot();
      },

      requestPointerLock: () => {
        try {
          renderer.domElement.requestPointerLock?.();
        } catch {}
      },
    };

    onRegisterApi(api);

    // Check URL `?autostart=1` query parameter
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('autostart') === '1') {
      api.startNewMatch('vex', 'normal', false);
    } else {
      syncBodyDataset('title');
      emitHudSnapshot();
    }

    // 9. Event Listeners (Keyboard, Mouse, PointerLock, Resize, Blur)
    const onKeyDown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement
      ) {
        return;
      }

      if (!keysHeld.has(e.code)) {
        keysJustPressed.add(e.code);
      }
      keysHeld.add(e.code);

      if (sim.appState === 'title') {
        if (document.querySelector('[role="dialog"]')) {
          return;
        }
        if (e.code === 'Enter' || e.code === 'Space') {
          e.preventDefault();
          api.startNewMatch(sim.operative, sim.difficulty, false);
        }
        return;
      }

      if (e.code === 'Escape' || e.code === 'KeyP') {
        e.preventDefault();
        if (sim.appState === 'playing') {
          api.pauseGame();
        } else if (sim.appState === 'paused') {
          api.resumeGame();
        }
        return;
      }

      if (sim.appState !== 'playing') return;

      if (e.code === 'KeyB') {
        e.preventDefault();
        onToggleBuyMenuRef.current();
      } else if (e.code === 'KeyR') {
        triggerReload();
      } else if (e.code === 'KeyY' || e.code === 'KeyI' || e.code === 'KeyV') {
        e.preventDefault();
        triggerWeaponInspect();
      } else if (e.code === 'KeyE') {
        triggerObjectiveInteract();
      } else if (e.code === 'Digit1' && sim.ownedWeapons.pistol) {
        api.equipWeapon('pistol');
      } else if (e.code === 'Digit2' && sim.ownedWeapons.smg) {
        api.equipWeapon('smg');
      } else if (e.code === 'Digit3' && sim.ownedWeapons.shotgun) {
        api.equipWeapon('shotgun');
      } else if (e.code === 'Digit4' && sim.ownedWeapons.rifle) {
        api.equipWeapon('rifle');
      } else if (e.code === 'Digit5' && sim.ownedWeapons.sniper) {
        api.equipWeapon('sniper');
      } else if (e.code === 'KeyF') {
        // Quick-aim & fire assist for keyboard-only accessibility
        if (sim.aiHealth > 0) {
          if (
            !hasLineOfSight(
              sim.playerX,
              camera.position.y,
              sim.playerZ,
              sim.aiX,
              1.68,
              sim.aiZ,
              arena.obstacles
            )
          ) {
            sim.playerX = sim.aiX >= 0 ? 2.5 : -2.5;
            camera.position.x = sim.playerX;
          }
          const dx = sim.aiX - sim.playerX;
          const dz = sim.aiZ - sim.playerZ;
          const horizDist = Math.max(0.1, Math.hypot(dx, dz));
          sim.playerYaw = Math.atan2(-dx, -dz);
          sim.playerPitch = Math.atan2(1.68 - camera.position.y, horizDist);
          sim.recoilPitchOffset = 0;
          sim.recoilYawOffset = 0;
          _euler.set(sim.playerPitch, sim.playerYaw, 0, 'YXZ');
          camera.quaternion.setFromEuler(_euler);
          camera.updateMatrixWorld(true);
          firePlayerWeapon();
        }
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      keysHeld.delete(e.code);
      // Variable jump cut if Space released early while ascending
      if (e.code === 'Space' && sim.playerVy > 0) {
        sim.playerVy *= 0.48;
      }
    };

    const onMouseDown = (e: MouseEvent) => {
      if (sim.appState !== 'playing') return;
      // Only handle clicks directly on the WebGL canvas
      if (e.target !== renderer.domElement) return;

      if (e.button === 0) {
        mouseLeftHeld = true;
        mouseLeftJustPressed = true;
        if (!pointerLocked) {
          try {
            renderer.domElement.requestPointerLock?.();
          } catch {}
        }
        firePlayerWeapon(e.clientX, e.clientY);
      } else if (e.button === 2) {
        mouseRightHeld = !mouseRightHeld; // Toggle or hold ADS
        emitHudSnapshot();
      }
    };

    const onMouseUp = (e: MouseEvent) => {
      if (e.button === 0) {
        mouseLeftHeld = false;
      }
    };

    const onMouseMove = (e: MouseEvent) => {
      if (sim.appState !== 'playing') return;
      const sens = settingsRef.current.mouseSensitivity * 0.0022;
      if (document.pointerLockElement === renderer.domElement) {
        const dyaw = -e.movementX * sens;
        const dpitch = -e.movementY * sens;
        sim.playerYaw += dyaw;
        sim.playerPitch = Math.max(
          -Math.PI / 2.2,
          Math.min(Math.PI / 2.2, sim.playerPitch + dpitch)
        );
        // Ultra-tight rotational inertia (zero roll wobble)
        sim.swayX = Math.max(-0.0035, Math.min(0.0035, sim.swayX - e.movementX * 0.00003));
        sim.swayY = Math.max(-0.0025, Math.min(0.0025, sim.swayY + e.movementY * 0.000025));
        sim.swayRoll = 0;
      } else if (e.target === renderer.domElement && (e.movementX !== 0 || e.movementY !== 0)) {
        sim.playerYaw -= e.movementX * sens * 0.65;
        sim.playerPitch = Math.max(
          -Math.PI / 2.4,
          Math.min(Math.PI / 2.4, sim.playerPitch - e.movementY * sens * 0.65)
        );
        sim.swayX = Math.max(-0.0035, Math.min(0.0035, sim.swayX - e.movementX * 0.000025));
        sim.swayY = Math.max(-0.0025, Math.min(0.0025, sim.swayY + e.movementY * 0.00002));
        sim.swayRoll = 0;
      }
    };

    const onPointerLockChange = () => {
      pointerLocked = document.pointerLockElement === renderer.domElement;
      emitHudSnapshot();
    };

    const onContextMenu = (e: MouseEvent) => {
      if (e.target === renderer.domElement) {
        e.preventDefault();
      }
    };

    const onBlurOrVisibility = () => {
      keysHeld.clear();
      keysJustPressed.clear();
      mouseLeftHeld = false;
      mouseRightHeld = false;
    };

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          camera.aspect = width / height;
          camera.updateProjectionMatrix();
          renderer.setSize(width, height);
          composer.setSize(width, height);
          bloomPass.resolution.set(
            Math.max(1, width * bloomScale),
            Math.max(1, height * bloomScale)
          );
        }
      }
    });
    resizeObserver.observe(container);

    const onWebglContextLost = (e: Event) => {
      e.preventDefault();
    };

    const onWebglContextRestored = () => {
      try {
        renderer.compile(scene, camera);
      } catch {}
    };

    renderer.domElement.addEventListener('webglcontextlost', onWebglContextLost);
    renderer.domElement.addEventListener('webglcontextrestored', onWebglContextRestored);

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mouseup', onMouseUp);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('blur', onBlurOrVisibility);
    document.addEventListener('pointerlockchange', onPointerLockChange);
    document.addEventListener('contextmenu', onContextMenu);

    // 10. Main 60Hz Simulation & Software-WebGL Paced Loop
    let lastTimeMs = performance.now();
    const startTimeMs = lastTimeMs;
    let frameId = 0;
    let hudEmitAccum = 0;
    let titleOrbitAngle = 0;

    function afterDraw(cb: () => void) {
      const gl = renderer.getContext() as WebGL2RenderingContext;
      const sync = gl.fenceSync ? gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0) : null;
      gl.flush();
      const poll = () => {
        if (!sync) {
          frameId = window.setTimeout(cb, 80);
          return;
        }
        const state = gl.getSyncParameter(sync, gl.SYNC_STATUS);
        if (state === gl.UNSIGNALED) {
          frameId = window.setTimeout(poll, 5);
        } else {
          gl.deleteSync(sync);
          frameId = window.setTimeout(cb, 80);
        }
      };
      frameId = window.setTimeout(poll, 5);
    }

    function tick() {
      const nowMs = performance.now();
      const rawDt = Math.max(0.001, (nowMs - lastTimeMs) / 1000);
      lastTimeMs = nowMs;
      const dt = Math.min(rawDt, 0.05); // Clamp frame delta time <= 0.05s
      const elapsed = (nowMs - startTimeMs) / 1000;

      // Animate central obelisk reactor & objective rings
      arena.obeliskCore.rotation.y = elapsed * 0.9;
      arena.obeliskCore.position.y = 4.2 + Math.sin(elapsed * 2.2) * 0.16;
      for (let i = 0; i < arena.beaconRings.length; i++) {
        const s = 1 + Math.sin(elapsed * 3 + i) * 0.08;
        arena.beaconRings[i].scale.set(s, 1, s);
      }

      // Update pooled particles in-place (Zero GC)
      for (let i = 0; i < MAX_PARTICLES; i++) {
        const p = particles[i];
        if (p.active) {
          p.life -= dt;
          if (p.life <= 0) {
            p.active = false;
            _particlePos.set(0, -100, 0);
            _particleScale.set(0, 0, 0);
          } else {
            p.vy -= 14.0 * dt;
            p.x += p.vx * dt;
            p.y = Math.max(0.04, p.y + p.vy * dt);
            p.z += p.vz * dt;
            const scale = (p.life / p.maxLife) * p.size;
            _particlePos.set(p.x, p.y, p.z);
            _particleScale.set(scale, scale, scale);
            _pColor.setHex(p.colorHex);
            particleMesh.setColorAt(i, _pColor);
          }
        } else {
          _particlePos.set(0, -100, 0);
          _particleScale.set(0, 0, 0);
        }
        _dummyMatrix.compose(_particlePos, _particleQuat, _particleScale);
        particleMesh.setMatrixAt(i, _dummyMatrix);
      }
      particleMesh.instanceMatrix.needsUpdate = true;
      if (particleMesh.instanceColor) particleMesh.instanceColor.needsUpdate = true;

      // Update transient visual timers (tracers, muzzle flashes, hit flashes, camera trauma)
      if (tracerTimer > 0) {
        tracerTimer -= dt;
        tracerMat.opacity = Math.max(0, (tracerTimer / 0.07) * 0.85);
      }
      if (aiTracerTimer > 0) {
        aiTracerTimer -= dt;
        aiTracerMat.opacity = Math.max(0, (aiTracerTimer / 0.085) * 0.9);
      }
      if (sim.muzzleFlashTimer > 0) {
        sim.muzzleFlashTimer -= dt;
        if (sim.muzzleFlashTimer <= 0) {
          fpWeaponRig.muzzleFlash.visible = false;
          fpWeaponRig.muzzleLight.intensity = 0;
        }
      }
      if (sim.aiMuzzleFlashTimer > 0) {
        sim.aiMuzzleFlashTimer -= dt;
        if (sim.aiMuzzleFlashTimer <= 0) {
          aiRig.muzzleFlash.visible = false;
        }
      }
      if (sim.aiHitFlashTimer > 0) {
        sim.aiHitFlashTimer -= dt;
        if (sim.aiHitFlashTimer <= 0) {
          aiRig.setHitFlash(false);
        }
      }
      if (sim.cameraTrauma > 0) {
        sim.cameraTrauma = Math.max(0, sim.cameraTrauma - dt * 2.4);
      }
      if (sim.reconRevealTimer > 0) {
        sim.reconRevealTimer = Math.max(0, sim.reconRevealTimer - dt);
      }

      // Mode 1: Title Screen Live World Camera Tour
      if (sim.appState === 'title') {
        titleOrbitAngle += dt * 0.22;
        const camRadius = 18.5;
        camera.position.set(
          Math.sin(titleOrbitAngle) * camRadius,
          6.8 + Math.sin(titleOrbitAngle * 1.7) * 1.1,
          Math.cos(titleOrbitAngle) * camRadius
        );
        camera.lookAt(0, 2.2, 0);
        fpWeaponRig.root.visible = false;

        // Subtle idle animation for AI showcase in courtyard
        aiRig.root.position.set(2.5, 0, -3.5);
        aiRig.root.rotation.y = Math.sin(elapsed * 0.8) * 0.5;
      } else if (sim.appState === 'playing') {
        fpWeaponRig.root.visible = !(mouseRightHeld && sim.activeWeaponId === 'sniper');

        // Sim-level Hitstop check
        if (sim.hitstopTimer > 0) {
          sim.hitstopTimer -= dt;
        } else {
          // Advance Phase Timers (Server-authoritative in 1v1 Multiplayer, local in AI/Practice)
          if (sim.isMultiplayer) {
            sim.phaseTimer = Math.max(0, sim.phaseTimer - dt);
          } else {
            sim.phaseTimer -= dt;
            if (sim.roundPhase === 'buy' && sim.phaseTimer <= 0) {
              sim.roundPhase = 'combat';
              sim.phaseTimer = COMBAT_PHASE_DURATION;
              sim.roundAnnouncement = 'COMBAT LIVE // ELIMINATE OPPONENT';
              soundEngine.playRoundTransition(null);
              emitHudSnapshot();
            } else if (sim.roundPhase === 'combat' && sim.phaseTimer <= 0) {
              // Round time expired: higher HP combatant wins the round
              const playerTotal = sim.playerHealth + sim.playerArmor;
              const aiTotal = sim.aiHealth + sim.aiArmor;
              endRound(playerTotal >= aiTotal ? 'PLAYER' : 'AI', 'TIME EXPIRED');
            } else if (sim.roundPhase === 'round_end' && sim.phaseTimer <= 0) {
              if (sim.isPracticeMode) {
                setupRound(false, true, false);
              } else {
                const matchWinner = checkMatchVictory(sim.playerScore, sim.aiScore, TARGET_ROUND_WINS);
                if (matchWinner) {
                  finishMatch(matchWinner);
                } else {
                  sim.roundNumber += 1;
                  setupRound(false, sim.playerHealth > 0, sim.aiHealth > 0);
                }
              }
            }
          }

          // Clear round banner announcement after 3.2s into combat
          if (
            sim.roundPhase === 'combat' &&
            COMBAT_PHASE_DURATION - sim.phaseTimer > 3.2 &&
            sim.roundAnnouncement &&
            sim.roundAnnouncement.startsWith('COMBAT LIVE')
          ) {
            sim.roundAnnouncement = null;
          }

          // Keyboard Arrow look support (zero roll wobble)
          const lookSpeed = 1.9 * dt;
          if (keysHeld.has('ArrowLeft')) {
            sim.playerYaw += lookSpeed;
            sim.swayX = Math.min(0.003, sim.swayX + dt * 0.012);
          }
          if (keysHeld.has('ArrowRight')) {
            sim.playerYaw -= lookSpeed;
            sim.swayX = Math.max(-0.003, sim.swayX - dt * 0.012);
          }
          if (keysHeld.has('ArrowUp')) {
            sim.playerPitch = Math.min(Math.PI / 2.2, sim.playerPitch + lookSpeed * 0.7);
            sim.swayY = Math.max(-0.0025, sim.swayY - dt * 0.01);
          }
          if (keysHeld.has('ArrowDown')) {
            sim.playerPitch = Math.max(-Math.PI / 2.2, sim.playerPitch - lookSpeed * 0.7);
            sim.swayY = Math.min(0.0025, sim.swayY + dt * 0.01);
          }

          // ====================================================================
          // PLAYER MOVEMENT, TACTICAL KNEE-SLIDE & SUBTLE 3-AXIS HEAD BOBBLE
          // ====================================================================
          const crouchKeyHeld =
            keysHeld.has('ControlLeft') || keysHeld.has('ControlRight') || keysHeld.has('KeyC');
          const crouchJustPressed =
            keysJustPressed.has('ControlLeft') ||
            keysJustPressed.has('ControlRight') ||
            keysJustPressed.has('KeyC') ||
            keysJustPressed.has('KeyX');
          const isWalking = keysHeld.has('ShiftLeft') || keysHeld.has('ShiftRight');
          const spec = WEAPONS[sim.activeWeaponId];

          if (sim.slideCooldown > 0) {
            sim.slideCooldown = Math.max(0, sim.slideCooldown - dt);
          }

          const forwardInput =
            (keysHeld.has('KeyW') ? 1 : 0) - (keysHeld.has('KeyS') ? 1 : 0);
          const rightInput =
            (keysHeld.has('KeyD') ? 1 : 0) - (keysHeld.has('KeyA') ? 1 : 0);

          _forward.set(-Math.sin(sim.playerYaw), 0, -Math.cos(sim.playerYaw)).normalize();
          _right.set(Math.cos(sim.playerYaw), 0, -Math.sin(sim.playerYaw)).normalize();

          _moveVec.set(0, 0, 0);
          _moveVec.addScaledVector(_forward, forwardInput);
          _moveVec.addScaledVector(_right, rightInput);

          const currentHorizSpeed = Math.hypot(sim.playerVx, sim.playerVz);

          // Initiate Tactical Knee-Slide when pressing Crouch ([Ctrl]/[C]) while running or pressing [X]
          if (
            crouchJustPressed &&
            sim.isGrounded &&
            !sim.isSliding &&
            sim.slideCooldown <= 0 &&
            !isWalking &&
            (currentHorizSpeed > 3.1 || keysJustPressed.has('KeyX'))
          ) {
            sim.isSliding = true;
            sim.slideDuration = 0.68;
            sim.slideTimer = sim.slideDuration;
            sim.slideCooldown = 1.05;
            if (_moveVec.lengthSq() > 0.001) {
              _moveVec.normalize();
              sim.slideDirX = _moveVec.x;
              sim.slideDirZ = _moveVec.z;
            } else {
              sim.slideDirX = _forward.x;
              sim.slideDirZ = _forward.z;
            }
            sim.jumpLandDip = -0.035;
            soundEngine.playTacticalSlide();
            // AI hears tactical slide friction within 22m
            if (Math.hypot(sim.playerX - sim.aiX, sim.playerZ - sim.aiZ) <= 22.0) {
              sim.aiLastKnownPlayerX = sim.playerX;
              sim.aiLastKnownPlayerZ = sim.playerZ;
            }
            emitHudSnapshot();
          }

          if (sim.isSliding) {
            sim.slideTimer -= dt;
            if (sim.slideTimer <= 0 || !sim.isGrounded) {
              sim.isSliding = false;
              sim.slideTimer = 0;
              emitHudSnapshot();
            } else {
              const slideProgress = 1 - sim.slideTimer / sim.slideDuration;
              const slideSpeed =
                6.8 * spec.moveSpeedMultiplier * computeSlideVelocityFactor(slideProgress);
              sim.playerVx = sim.slideDirX * slideSpeed;
              sim.playerVz = sim.slideDirZ * slideSpeed;
            }
          }

          const isCrouching = crouchKeyHeld && !sim.isSliding;

          if (!sim.isSliding) {
            let maxMoveSpeed = 6.8 * spec.moveSpeedMultiplier;
            if (isWalking) maxMoveSpeed *= 0.54;
            if (isCrouching) maxMoveSpeed *= 0.48;
            if (mouseRightHeld) maxMoveSpeed *= 0.76;

            if (_moveVec.lengthSq() > 0.001) {
              _moveVec.normalize().multiplyScalar(maxMoveSpeed);
            }

            const accel = sim.isGrounded ? 18.0 : 5.5;
            sim.playerVx = THREE.MathUtils.damp(sim.playerVx, _moveVec.x, accel, dt);
            sim.playerVz = THREE.MathUtils.damp(sim.playerVz, _moveVec.z, accel, dt);
          }

          // Coyote time & Jump buffer (Jumping during a slide performs a momentum slide-jump!)
          if (sim.isGrounded) {
            sim.coyoteTimer = 0.1;
          } else {
            sim.coyoteTimer = Math.max(0, sim.coyoteTimer - dt);
          }

          if (keysJustPressed.has('Space')) {
            sim.jumpBufferTimer = 0.12;
          } else {
            sim.jumpBufferTimer = Math.max(0, sim.jumpBufferTimer - dt);
          }

          if (sim.jumpBufferTimer > 0 && sim.coyoteTimer > 0) {
            if (sim.isSliding) {
              sim.isSliding = false;
              sim.slideTimer = 0;
              sim.playerVx *= 1.08;
              sim.playerVz *= 1.08;
            }
            sim.playerVy = 7.4;
            sim.isGrounded = false;
            sim.coyoteTimer = 0;
            sim.jumpBufferTimer = 0;
            sim.jumpLandDip = 0.032; // Upward takeoff impulse on weapon
            soundEngine.playJump(false);
          }

          // Gravity & vertical integration
          sim.playerVy -= 20.0 * dt;
          sim.playerY += sim.playerVy * dt;
          if (sim.playerY <= 0) {
            if (!sim.isGrounded && sim.playerVy < -2.0) {
              soundEngine.playJump(true);
              sim.jumpLandDip = -0.055; // Crisp landing compression dip on weapon & arms
            }
            sim.playerY = 0;
            sim.playerVy = 0;
            sim.isGrounded = true;
          }

          // Horizontal collision resolution against arena AABBs + stability bounds clamp
          const nextX = THREE.MathUtils.clamp(sim.playerX + sim.playerVx * dt, -26.5, 26.5);
          const nextZ = THREE.MathUtils.clamp(sim.playerZ + sim.playerVz * dt, -24.5, 24.5);
          const colRes = resolveCircleAABBCollision(
            nextX,
            nextZ,
            sim.playerY,
            sim.isSliding ? 1.05 : 1.75,
            0.46,
            arena.obstacles
          );
          sim.playerX = Number.isFinite(colRes.x) ? colRes.x : arena.playerSpawn.x;
          sim.playerZ = Number.isFinite(colRes.z) ? colRes.z : arena.playerSpawn.z;

          // If player slides head-on into a wall, end slide cleanly
          if (sim.isSliding && colRes.collided && Math.hypot(sim.playerVx, sim.playerVz) < 2.0) {
            sim.isSliding = false;
            sim.slideTimer = 0;
          }

          // Footsteps, Acoustic AI Alert & Walk Bob synced to actual distance traveled
          const stepDist = Math.hypot(sim.playerVx, sim.playerVz) * dt;
          if (sim.isGrounded && !sim.isSliding && stepDist > 0.001) {
            sim.walkBobPhase += stepDist * 2.35;
            sim.footstepAccum += stepDist;
            if (sim.footstepAccum >= 2.3 && !isWalking && !isCrouching) {
              sim.footstepAccum = 0;
              soundEngine.playFootstep(false);
              // AI hears loud un-shifted footsteps within 28m!
              if (Math.hypot(sim.playerX - sim.aiX, sim.playerZ - sim.aiZ) <= 28.0) {
                sim.aiLastKnownPlayerX = sim.playerX;
                sim.aiLastKnownPlayerZ = sim.playerZ;
              }
            }
          }

          // Weapon Cooldown, Auto-Fire & Reload Progress
          if (sim.fireCooldown > 0) {
            sim.fireCooldown = Math.max(0, sim.fireCooldown - dt);
          }

          if (sim.isReloading) {
            sim.reloadTimer -= dt;
            if (sim.reloadTimer <= 0) {
              sim.isReloading = false;
              const inst = sim.ownedWeapons[sim.activeWeaponId];
              if (inst) {
                const needed = spec.magSize - inst.ammoInMag;
                const transfer = Math.min(needed, inst.ammoReserve);
                inst.ammoInMag += transfer;
                inst.ammoReserve -= transfer;
              }
              emitHudSnapshot();
            }
          } else if (mouseLeftHeld && spec.automatic && sim.fireCooldown <= 0) {
            firePlayerWeapon();
          }

          // Recoil decay, Progressive Spray Decay, Subtle Head Bobble & Rock-Solid Camera Transform
          if (sim.sprayDecayTimer > 0) {
            sim.sprayDecayTimer = Math.max(0, sim.sprayDecayTimer - dt);
          } else {
            sim.sprayStreak = Math.max(0, sim.sprayStreak - dt * 6.5);
          }
          sim.recoilPitchOffset = THREE.MathUtils.damp(sim.recoilPitchOffset, 0, 11.5, dt);
          sim.recoilYawOffset = THREE.MathUtils.damp(sim.recoilYawOffset, 0, 11.5, dt);

          const speedRatio = Math.min(1, Math.hypot(sim.playerVx, sim.playerVz) / 6.8);
          const headBobScale =
            sim.isGrounded && !sim.isSliding
              ? speedRatio * (mouseRightHeld ? 0.2 : isCrouching ? 0.35 : isWalking ? 0.5 : 0.75)
              : 0;

          // Ultra-subtle, rock-steady head bobble (minimal vertical/lateral glide, near-zero roll)
          const bobOffsetY = Math.sin(sim.walkBobPhase * Math.PI * 2) * 0.0045 * headBobScale;
          const bobOffsetX = Math.cos(sim.walkBobPhase * Math.PI) * 0.002 * headBobScale;
          const bobRollZ = Math.sin(sim.walkBobPhase * Math.PI) * 0.0007 * headBobScale;

          const targetEyeHeight = sim.isSliding ? 0.78 : isCrouching ? 1.08 : 1.66;
          const currentEyeY = THREE.MathUtils.damp(
            camera.position.y - sim.playerY,
            targetEyeHeight + bobOffsetY,
            16,
            dt
          );
          camera.position.set(
            sim.playerX + _right.x * bobOffsetX,
            sim.playerY + currentEyeY,
            sim.playerZ + _right.z * bobOffsetX
          );

          const targetCameraRoll = (sim.isSliding ? 0.055 : 0) + bobRollZ;
          sim.cameraRoll = THREE.MathUtils.damp(sim.cameraRoll, targetCameraRoll, 16, dt);

          // Smooth deterministic damage flinch (only when hit by enemy, no random white-noise jitter)
          const flinchPitch = sim.cameraTrauma * sim.cameraTrauma * 0.018;

          _euler.set(
            sim.playerPitch + sim.recoilPitchOffset + flinchPitch,
            sim.playerYaw + sim.recoilYawOffset,
            sim.cameraRoll,
            'YXZ'
          );
          camera.quaternion.setFromEuler(_euler);

          // ADS FOV interpolation (with subtle widening burst during knee-slide)
          const slideFovBoost = sim.isSliding ? 4.5 : 0;
          const targetFov =
            (mouseRightHeld
              ? settingsRef.current.fov * spec.adsFovMultiplier
              : settingsRef.current.fov) + slideFovBoost;
          if (Math.abs(camera.fov - targetFov) > 0.05) {
            camera.fov = THREE.MathUtils.damp(camera.fov, targetFov, 14, dt);
            camera.updateProjectionMatrix();
          }

          // ====================================================================
          // PROCEDURAL FIRST-PERSON GUN & TACTICAL ARM ANIMATION SYSTEM
          // ====================================================================
          // 1. Decay spring impulses with tight, non-wobbly critical damping
          sim.gunKickZ = THREE.MathUtils.damp(sim.gunKickZ, 0, 22, dt);
          sim.gunKickY = THREE.MathUtils.damp(sim.gunKickY, 0, 24, dt);
          sim.gunKickPitch = THREE.MathUtils.damp(sim.gunKickPitch, 0, 22, dt);
          sim.gunKickRoll = THREE.MathUtils.damp(sim.gunKickRoll, 0, 26, dt);
          sim.swayX = THREE.MathUtils.damp(sim.swayX, 0, 18, dt);
          sim.swayY = THREE.MathUtils.damp(sim.swayY, 0, 18, dt);
          sim.swayRoll = THREE.MathUtils.damp(sim.swayRoll, 0, 18, dt);
          sim.jumpLandDip = THREE.MathUtils.damp(sim.jumpLandDip, 0, 16, dt);

          if (sim.equipTimer > 0) {
            sim.equipTimer = Math.max(0, sim.equipTimer - dt);
          }
          if (sim.fireBoltCycleTimer > 0) {
            sim.fireBoltCycleTimer = Math.max(0, sim.fireBoltCycleTimer - dt);
          }

          // Update ejected brass shell casing trajectory
          if (sim.shellTimer > 0) {
            sim.shellTimer -= dt;
            if (sim.shellTimer <= 0) {
              fpWeaponRig.shellMesh.visible = false;
            } else {
              sim.shellVy -= 6.5 * dt;
              sim.shellX += sim.shellVx * dt;
              sim.shellY += sim.shellVy * dt;
              sim.shellZ += sim.shellVz * dt;
              fpWeaponRig.shellMesh.position.set(sim.shellX, sim.shellY, sim.shellZ);
              fpWeaponRig.shellMesh.rotation.x += 22 * dt;
              fpWeaponRig.shellMesh.rotation.y += 18 * dt;
            }
          }

          // 2. Advance 3D Weapon Inspection Timer
          if (sim.isInspecting) {
            sim.inspectTimer -= dt;
            if (sim.inspectTimer <= 0 || mouseRightHeld || mouseLeftHeld || sim.isReloading) {
              sim.isInspecting = false;
              sim.inspectTimer = 0;
              emitHudSnapshot();
            }
          }

          const inspectProgress = sim.isInspecting
            ? Math.min(1, Math.max(0, 1 - sim.inspectTimer / sim.inspectDuration))
            : 0;
          const inspectPose = computeWeaponInspectPose(inspectProgress);

          const reloadProgress = sim.isReloading
            ? Math.min(1, Math.max(0, 1 - sim.reloadTimer / Math.max(0.1, sim.reloadDuration)))
            : 0;
          const reloadPose = computeWeaponReloadPose(reloadProgress);

          // Compute weapon-specific post-shot bolt/slide/pump cycle pose
          const fireCycleProgress =
            sim.fireBoltCycleTimer > 0 && sim.fireBoltCycleDuration > 0
              ? Math.min(1, Math.max(0, 1 - sim.fireBoltCycleTimer / sim.fireBoltCycleDuration))
              : 1;
          const fireCyclePose = computeFireCyclePose(sim.activeWeaponId, fireCycleProgress);

          // Equip draw progress (1 -> 0 as weapon whips into ready position)
          const equipNorm = sim.equipTimer / sim.equipDuration;
          const equipDropY = -0.18 * equipNorm * equipNorm;
          const equipPitch = -0.45 * equipNorm;
          const equipRoll = 0.25 * equipNorm;
          const equipBoltPull =
            equipNorm > 0.15 && equipNorm < 0.7
              ? Math.sin(((equipNorm - 0.15) / 0.55) * Math.PI) * 0.055
              : 0;

          // Rock-steady weapon stance (locked-in shoulder mount, zero roll wobble)
          const breatheX = 0;
          const breatheY = Math.cos(elapsed * 2.2) * 0.00025;
          const walkGlideScale = sim.isSliding ? 0.05 : mouseRightHeld ? 0.15 : speedRatio;
          const lissajousX =
            Math.cos(sim.walkBobPhase * Math.PI) * 0.0012 * walkGlideScale;
          const lissajousY =
            Math.abs(Math.sin(sim.walkBobPhase * Math.PI * 2)) * 0.0014 * walkGlideScale;
          const lissajousRoll = 0;
          const crouchCantZ = !mouseRightHeld
            ? sim.isSliding
              ? 0.24
              : isCrouching
                ? 0.09
                : 0
            : 0;
          const crouchOffsetX = !mouseRightHeld
            ? sim.isSliding
              ? -0.026
              : isCrouching
                ? -0.012
                : 0
            : 0;
          const slideOffsetY = sim.isSliding && !mouseRightHeld ? 0.012 : 0;

          const baseVmX = mouseRightHeld ? 0.0 : 0.22;
          const baseVmY = mouseRightHeld ? -0.145 : -0.175;
          const baseVmZ = mouseRightHeld ? -0.35 : -0.4;

          const targetRootX =
            baseVmX +
            breatheX +
            lissajousX +
            sim.swayX +
            crouchOffsetX +
            reloadPose.rootPosX;
          const targetRootY =
            baseVmY +
            breatheY +
            lissajousY +
            sim.swayY +
            sim.gunKickY +
            sim.jumpLandDip * 0.35 +
            equipDropY +
            slideOffsetY +
            reloadPose.rootPosY;
          const targetRootZ = baseVmZ + sim.gunKickZ + reloadPose.rootPosZ;

          fpWeaponRig.root.position.x = THREE.MathUtils.damp(
            fpWeaponRig.root.position.x,
            targetRootX,
            28,
            dt
          );
          fpWeaponRig.root.position.y = THREE.MathUtils.damp(
            fpWeaponRig.root.position.y,
            targetRootY,
            28,
            dt
          );
          fpWeaponRig.root.position.z = THREE.MathUtils.damp(
            fpWeaponRig.root.position.z,
            targetRootZ,
            30,
            dt
          );

          const targetRootRotX =
            sim.gunKickPitch + equipPitch + reloadPose.rootRotX + fireCyclePose.extraRotX * 0.22;
          const targetRootRotY = sim.swayX * 0.35 + reloadPose.rootRotY;
          const targetRootRotZ =
            lissajousRoll +
            crouchCantZ +
            equipRoll +
            reloadPose.rootRotZ +
            fireCyclePose.extraRotZ * 0.18;

          fpWeaponRig.root.rotation.x = THREE.MathUtils.damp(
            fpWeaponRig.root.rotation.x,
            targetRootRotX,
            28,
            dt
          );
          fpWeaponRig.root.rotation.y = THREE.MathUtils.damp(
            fpWeaponRig.root.rotation.y,
            targetRootRotY,
            24,
            dt
          );
          fpWeaponRig.root.rotation.z = THREE.MathUtils.damp(
            fpWeaponRig.root.rotation.z,
            targetRootRotZ,
            24,
            dt
          );

          // Apply 3-phase 3D firearm & first-person arm inspection transforms
          fpWeaponRig.inspectPivot.position.x = THREE.MathUtils.damp(
            fpWeaponRig.inspectPivot.position.x,
            inspectPose.posX,
            14,
            dt
          );
          fpWeaponRig.inspectPivot.position.y = THREE.MathUtils.damp(
            fpWeaponRig.inspectPivot.position.y,
            inspectPose.posY,
            14,
            dt
          );
          fpWeaponRig.inspectPivot.position.z = THREE.MathUtils.damp(
            fpWeaponRig.inspectPivot.position.z,
            inspectPose.posZ,
            14,
            dt
          );
          fpWeaponRig.inspectPivot.rotation.x = THREE.MathUtils.damp(
            fpWeaponRig.inspectPivot.rotation.x,
            inspectPose.rotX,
            14,
            dt
          );
          fpWeaponRig.inspectPivot.rotation.y = THREE.MathUtils.damp(
            fpWeaponRig.inspectPivot.rotation.y,
            inspectPose.rotY,
            14,
            dt
          );
          fpWeaponRig.inspectPivot.rotation.z = THREE.MathUtils.damp(
            fpWeaponRig.inspectPivot.rotation.z,
            inspectPose.rotZ,
            14,
            dt
          );

          // Combine left-hand support offsets from Reload, Inspect, and Post-Shot Pump/Bolt Action
          const targetLeftX =
            fpWeaponRig.leftSupportDefaultPos.x +
            inspectPose.leftArmOffsetX +
            reloadPose.leftArmOffsetX;
          const targetLeftY =
            fpWeaponRig.leftSupportDefaultPos.y +
            inspectPose.leftArmOffsetY +
            reloadPose.leftArmOffsetY +
            fireCyclePose.leftArmOffsetY;
          const targetLeftZ =
            fpWeaponRig.leftSupportDefaultPos.z +
            inspectPose.leftArmOffsetZ +
            reloadPose.leftArmOffsetZ +
            fireCyclePose.leftArmOffsetZ;

          fpWeaponRig.leftArmGroup.position.x = THREE.MathUtils.damp(
            fpWeaponRig.leftArmGroup.position.x,
            targetLeftX,
            18,
            dt
          );
          fpWeaponRig.leftArmGroup.position.y = THREE.MathUtils.damp(
            fpWeaponRig.leftArmGroup.position.y,
            targetLeftY,
            18,
            dt
          );
          fpWeaponRig.leftArmGroup.position.z = THREE.MathUtils.damp(
            fpWeaponRig.leftArmGroup.position.z,
            targetLeftZ,
            18,
            dt
          );
          fpWeaponRig.leftArmGroup.rotation.x = THREE.MathUtils.damp(
            fpWeaponRig.leftArmGroup.rotation.x,
            reloadPose.leftArmRotX,
            16,
            dt
          );
          fpWeaponRig.leftArmGroup.rotation.z = THREE.MathUtils.damp(
            fpWeaponRig.leftArmGroup.rotation.z,
            inspectPose.leftArmRotZ + reloadPose.leftArmRotZ,
            16,
            dt
          );

          // Drive articulated moving weapon sub-parts (detachable magazine + reciprocating slide/bolt/pump)
          const totalSlidePull = Math.max(
            fireCyclePose.slidePullBack,
            equipBoltPull,
            reloadPose.slidePullBack,
            inspectPose.slidePullBack
          );
          fpWeaponRig.setArticulation(
            reloadPose.magOffsetY,
            reloadPose.magOffsetZ,
            totalSlidePull
          );

          // ====================================================================
          // 1V1 ONLINE MULTIPLAYER SYNC OR OFFLINE AI OPPONENT COMBAT LOOP
          // ====================================================================
          if (sim.isMultiplayer) {
            mpStateEmitAccum += dt;
            if (mpStateEmitAccum >= 0.045) {
              mpStateEmitAccum = 0;
              sendMultiplayerMessage({
                type: 'mp:state',
                x: sim.playerX,
                y: sim.playerY,
                z: sim.playerZ,
                vx: sim.playerVx,
                vz: sim.playerVz,
                yaw: sim.playerYaw,
                pitch: sim.playerPitch,
                weaponId: sim.activeWeaponId,
                armor: sim.playerArmor,
                armorType: sim.playerArmorType,
                credits: sim.playerCredits,
                isCrouching,
                isSliding: sim.isSliding,
                isReloading: sim.isReloading,
              });
            }

            aiRig.root.visible = sim.opponentConnected;
            if (sim.aiHealth <= 0) {
              if (sim.aiKoTimer > 0) {
                sim.aiKoTimer = Math.max(0, sim.aiKoTimer - dt);
                const progress = 1 - sim.aiKoTimer / 0.45;
                aiRig.bodyGroup.rotation.x = -progress * (Math.PI / 2.1);
                aiRig.bodyGroup.position.y = -progress * 0.35;
              }
            } else if (sim.opponentConnected) {
              sim.aiX = THREE.MathUtils.damp(sim.aiX, sim.remoteTargetX, 16, dt);
              sim.aiY = THREE.MathUtils.damp(sim.aiY, sim.remoteTargetY, 16, dt);
              sim.aiZ = THREE.MathUtils.damp(sim.aiZ, sim.remoteTargetZ, 16, dt);

              let yawDiff = sim.remoteTargetYaw - sim.aiYaw;
              while (yawDiff > Math.PI) yawDiff -= Math.PI * 2;
              while (yawDiff < -Math.PI) yawDiff += Math.PI * 2;
              sim.aiYaw += yawDiff * Math.min(1, 16 * dt);

              sim.aiCrouchOffset = THREE.MathUtils.damp(
                sim.aiCrouchOffset,
                sim.aiIsCrouching ? 0.36 : 0,
                14,
                dt
              );
              aiRig.bodyGroup.position.y = -sim.aiCrouchOffset;
              aiRig.bodyGroup.rotation.x = 0;

              if (sim.remoteSpeed > 0.25) {
                const swing = Math.sin(elapsed * 11.5) * 0.5;
                aiRig.leftLeg.rotation.x = swing;
                aiRig.rightLeg.rotation.x = -swing;
              } else {
                aiRig.leftLeg.rotation.x = THREE.MathUtils.damp(aiRig.leftLeg.rotation.x, 0, 10, dt);
                aiRig.rightLeg.rotation.x = THREE.MathUtils.damp(aiRig.rightLeg.rotation.x, 0, 10, dt);
              }

              // Radar visibility when local player has direct line of sight to remote opponent
              const oppLos = hasLineOfSight(
                sim.playerX,
                currentEyeY,
                sim.playerZ,
                sim.aiX,
                1.58 - sim.aiCrouchOffset,
                sim.aiZ,
                arena.obstacles
              );
              if (oppLos) {
                sim.aiLastSawPlayerTime = performance.now() / 1000;
              }

              aiRig.root.position.set(sim.aiX, sim.aiY, sim.aiZ);
              aiRig.root.rotation.y = sim.aiYaw;
            }
          } else if (sim.aiHealth <= 0) {
            // Smooth KO topple animation
            if (sim.aiKoTimer > 0) {
              sim.aiKoTimer = Math.max(0, sim.aiKoTimer - dt);
              const progress = 1 - sim.aiKoTimer / 0.45;
              aiRig.bodyGroup.rotation.x = -progress * (Math.PI / 2.1);
              aiRig.bodyGroup.position.y = -progress * 0.35;
            }
          } else if (sim.roundPhase === 'combat' && sim.playerHealth > 0) {
            const diffCfg = AI_DIFFICULTY_CONFIGS[sim.difficulty];
            const nowSec = performance.now() / 1000;
            const toPlayerX = sim.playerX - sim.aiX;
            const toPlayerZ = sim.playerZ - sim.aiZ;
            const distToPlayer = Math.max(0.1, Math.hypot(toPlayerX, toPlayerZ));

            // 1. Line of Sight Check (AI eyes to Player eyes — strictly blocked by walls!)
            const aiEyeY = 1.58 - sim.aiCrouchOffset;
            const losClear = hasLineOfSight(
              sim.aiX,
              aiEyeY,
              sim.aiZ,
              sim.playerX,
              currentEyeY,
              sim.playerZ,
              arena.obstacles
            );

            if (losClear) {
              if (nowSec - sim.aiLastSawPlayerTime > 1.3) {
                sim.aiReactionTimer = diffCfg.reactionDelayMs / 1000;
              }
              sim.aiLastSawPlayerTime = nowSec;
              sim.aiLastKnownPlayerX = sim.playerX;
              sim.aiLastKnownPlayerZ = sim.playerZ;
            } else if (sim.isReloading && distToPlayer <= 20.0) {
              // Smart AI hears player reload click within 20m and updates threat coordinates to push!
              sim.aiLastKnownPlayerX = sim.playerX;
              sim.aiLastKnownPlayerZ = sim.playerZ;
              if (nowSec - sim.aiLastSawPlayerTime > 2.0) {
                sim.aiLastSawPlayerTime = nowSec - 1.5;
              }
            }

            // 1b. Dynamic Mid-Combat AI Weapon Switching (Primary vs Sidearm based on range & mag state)
            if (sim.aiReloadTimer <= 0) {
              const desiredAiWeapon = selectAICombatWeapon(
                sim.aiPrimaryWeaponId,
                sim.aiPrimaryAmmo,
                sim.aiSidearmAmmo,
                distToPlayer,
                losClear
              );
              if (desiredAiWeapon !== sim.aiWeaponId) {
                sim.aiWeaponId = desiredAiWeapon;
                sim.aiAmmoInMag =
                  desiredAiWeapon === 'pistol' ? sim.aiSidearmAmmo : sim.aiPrimaryAmmo;
                sim.aiFireCooldown = 0.22; // Brief fast-draw swap delay
                sim.aiWindupTimer = 0;
                sim.aiBurstShotsLeft = 0;
                aiRig.setEquippedWeapon(sim.aiWeaponId);
                soundEngine.playWeaponEquip();
                emitHudSnapshot();
              }
            }

            const aiWeaponSpec = WEAPONS[sim.aiWeaponId];
            const timeSinceSaw = nowSec - sim.aiLastSawPlayerTime;

            // 2. Evaluate AI Tactical State
            const nextState = evaluateAITacticalState({
              currentState: sim.aiState,
              hp: sim.aiHealth,
              ammoInMag: sim.aiAmmoInMag,
              hasLOS: losClear,
              timeSinceLastSawPlayer: timeSinceSaw,
              difficulty: sim.difficulty,
            });

            if (nextState !== sim.aiState) {
              sim.aiState = nextState;
              sim.aiWaypointTimer = 0; // Immediately pick appropriate tactical node on state change
              if (nextState === 'reload' && sim.aiReloadTimer <= 0) {
                sim.aiReloadTimer = WEAPONS[sim.aiPrimaryWeaponId].reloadTime;
              }
            }

            // 3. Handle AI Reloading (Reloads primary + sidearm and re-equips primary weapon)
            if (sim.aiReloadTimer > 0) {
              sim.aiReloadTimer -= dt;
              if (sim.aiReloadTimer <= 0) {
                sim.aiPrimaryAmmo = WEAPONS[sim.aiPrimaryWeaponId].magSize;
                sim.aiSidearmAmmo = WEAPONS.pistol.magSize;
                sim.aiWeaponId = sim.aiPrimaryWeaponId;
                sim.aiAmmoInMag = sim.aiPrimaryAmmo;
                aiRig.setEquippedWeapon(sim.aiWeaponId);
                sim.aiState = losClear ? 'attack' : 'patrol';
              }
            }

            // 4. BFS Graph-Connected Waypoint Selection & Corridor Clearance Steering
            sim.aiWaypointTimer -= dt;
            const distToTarget = Math.hypot(sim.aiTargetX - sim.aiX, sim.aiTargetZ - sim.aiZ);

            if (sim.aiWaypointTimer <= 0 || distToTarget < 0.95) {
              const mode =
                sim.aiState === 'cover' || sim.aiState === 'reload'
                  ? 'cover'
                  : sim.aiState === 'reposition' || sim.aiState === 'attack'
                    ? 'flank'
                    : 'patrol';
              const wp = findBestTacticalWaypoint(
                sim.aiX,
                sim.aiZ,
                sim.aiLastKnownPlayerX,
                sim.aiLastKnownPlayerZ,
                arena.waypoints,
                arena.obstacles,
                mode
              );
              sim.aiTargetX = wp.x;
              sim.aiTargetZ = wp.z;
              sim.aiWaypointTimer = mode === 'cover' ? 1.25 : 1.75;
            }

            let desiredVx = 0;
            let desiredVz = 0;

            if (sim.aiState === 'attack' && losClear) {
              // Dynamic Jiggle-Peek Strafe + Corridor Clearance Check + Tactical Crouch-Peek
              sim.aiStrafeTimer -= dt;
              if (sim.aiStrafeTimer <= 0) {
                sim.aiStrafeDir = Math.random() > 0.45 ? -sim.aiStrafeDir : sim.aiStrafeDir;
                sim.aiStrafeTimer = (0.38 + Math.random() * 0.35) / diffCfg.strafeFrequency;
              }

              // Crouch-peek on Normal/Hard to throw off player headshot aim
              sim.aiCrouchTimer -= dt;
              if (sim.aiCrouchTimer <= 0 && sim.difficulty !== 'easy') {
                sim.aiIsCrouching = Math.random() < (sim.difficulty === 'hard' ? 0.55 : 0.32);
                sim.aiCrouchTimer = 0.55 + Math.random() * 0.65;
              }

              const perpX = -toPlayerZ / distToPlayer;
              const perpZ = toPlayerX / distToPlayer;
              const forwardX = toPlayerX / distToPlayer;
              const forwardZ = toPlayerZ / distToPlayer;

              // Verify strafe direction has corridor clearance; if blocked by wall/crate, reverse strafe immediately!
              const testStrafeX = sim.aiX + perpX * sim.aiStrafeDir * 1.45;
              const testStrafeZ = sim.aiZ + perpZ * sim.aiStrafeDir * 1.45;
              if (
                !hasCorridorClearance(
                  sim.aiX,
                  sim.aiZ,
                  testStrafeX,
                  testStrafeZ,
                  0.52,
                  arena.obstacles
                )
              ) {
                sim.aiStrafeDir = -sim.aiStrafeDir;
              }

              // Close distance with SMG/Shotgun or when player is reloading; maintain spacing with Rifle/Sniper
              const idealRange =
                sim.aiWeaponId === 'shotgun'
                  ? 7.0
                  : sim.aiWeaponId === 'smg'
                    ? 10.5
                    : sim.aiWeaponId === 'sniper'
                      ? 21.0
                      : 14.5;
              const reloadPushBonus = sim.isReloading && sim.aiHealth > 45 ? 0.38 : 0;
              const rangePush =
                (distToPlayer > idealRange + 3.2
                  ? 0.48
                  : distToPlayer < idealRange - 3.2
                    ? -0.45
                    : 0) + reloadPushBonus;

              desiredVx =
                (perpX * sim.aiStrafeDir * 0.78 + forwardX * rangePush) * diffCfg.moveSpeed;
              desiredVz =
                (perpZ * sim.aiStrafeDir * 0.78 + forwardZ * rangePush) * diffCfg.moveSpeed;
            } else if (distToTarget > 0.25) {
              sim.aiIsCrouching = sim.aiState === 'cover' && distToTarget < 1.25;
              let dirX = (sim.aiTargetX - sim.aiX) / distToTarget;
              let dirZ = (sim.aiTargetZ - sim.aiZ) / distToTarget;

              // 3-Sensor Whisker Corridor Avoidance: check forward, +34 deg, and -34 deg rays
              const probeDist = 1.45;
              if (
                !hasCorridorClearance(
                  sim.aiX,
                  sim.aiZ,
                  sim.aiX + dirX * probeDist,
                  sim.aiZ + dirZ * probeDist,
                  0.48,
                  arena.obstacles
                )
              ) {
                const cosA = Math.cos(0.58);
                const sinA = Math.sin(0.58);
                const leftDirX = dirX * cosA - dirZ * sinA;
                const leftDirZ = dirX * sinA + dirZ * cosA;
                const rightDirX = dirX * cosA + dirZ * sinA;
                const rightDirZ = -dirX * sinA + dirZ * cosA;

                const leftClear = hasCorridorClearance(
                  sim.aiX,
                  sim.aiZ,
                  sim.aiX + leftDirX * probeDist,
                  sim.aiZ + leftDirZ * probeDist,
                  0.46,
                  arena.obstacles
                );
                const rightClear = hasCorridorClearance(
                  sim.aiX,
                  sim.aiZ,
                  sim.aiX + rightDirX * probeDist,
                  sim.aiZ + rightDirZ * probeDist,
                  0.46,
                  arena.obstacles
                );

                if (leftClear && !rightClear) {
                  dirX = leftDirX;
                  dirZ = leftDirZ;
                } else if (rightClear && !leftClear) {
                  dirX = rightDirX;
                  dirZ = rightDirZ;
                } else {
                  const oldX = dirX;
                  dirX = -dirZ * sim.aiStrafeDir;
                  dirZ = oldX * sim.aiStrafeDir;
                }
              }

              desiredVx = dirX * diffCfg.moveSpeed;
              desiredVz = dirZ * diffCfg.moveSpeed;
            }

            const clampedAiNextX = THREE.MathUtils.clamp(sim.aiX + desiredVx * dt, -26.5, 26.5);
            const clampedAiNextZ = THREE.MathUtils.clamp(sim.aiZ + desiredVz * dt, -24.5, 24.5);
            const aiNext = resolveCircleAABBCollision(
              clampedAiNextX,
              clampedAiNextZ,
              0,
              1.8,
              0.48,
              arena.obstacles
            );
            const aiMovedDist = Math.hypot(aiNext.x - sim.aiX, aiNext.z - sim.aiZ);
            sim.aiX = Number.isFinite(aiNext.x) ? aiNext.x : 0;
            sim.aiZ = Number.isFinite(aiNext.z) ? aiNext.z : -13.5;

            // Real-Time Velocity Stuck Watchdog: if AI intended to move but moved < 38% of expected distance
            const intendedSpeed = Math.hypot(desiredVx, desiredVz);
            if (intendedSpeed > 1.2 && aiMovedDist < intendedSpeed * dt * 0.38) {
              sim.aiStuckTimer += dt;
              if (sim.aiStuckTimer > 0.2) {
                sim.aiStuckTimer = 0;
                sim.aiStrafeDir = -sim.aiStrafeDir;
                // Immediately pick an open escape waypoint with guaranteed corridor clearance
                let bestEscapeWp = arena.waypoints[0];
                let bestEscapeScore = -Infinity;
                for (let w = 0; w < arena.waypoints.length; w++) {
                  const cand = arena.waypoints[w];
                  const d = Math.hypot(cand.x - sim.aiX, cand.z - sim.aiZ);
                  if (
                    d > 1.8 &&
                    d < 13.5 &&
                    hasCorridorClearance(sim.aiX, sim.aiZ, cand.x, cand.z, 0.52, arena.obstacles)
                  ) {
                    const score = -d + (Math.random() - 0.5) * 3.5;
                    if (score > bestEscapeScore) {
                      bestEscapeScore = score;
                      bestEscapeWp = cand;
                    }
                  }
                }
                sim.aiTargetX = bestEscapeWp.x;
                sim.aiTargetZ = bestEscapeWp.z;
                sim.aiWaypointTimer = 0.85;
              }
            } else {
              sim.aiStuckTimer = Math.max(0, sim.aiStuckTimer - dt * 2.0);
            }

            // Smoothly interpolate AI crouch posture
            sim.aiCrouchOffset = THREE.MathUtils.damp(
              sim.aiCrouchOffset,
              sim.aiIsCrouching ? 0.36 : 0,
              12,
              dt
            );
            aiRig.bodyGroup.position.y = -sim.aiCrouchOffset;

            // Animate AI legs & aiming arm pitch
            if (aiMovedDist > 0.001) {
              const swing = Math.sin(elapsed * 11.5) * 0.5;
              aiRig.leftLeg.rotation.x = swing;
              aiRig.rightLeg.rotation.x = -swing;
            } else {
              aiRig.leftLeg.rotation.x = THREE.MathUtils.damp(aiRig.leftLeg.rotation.x, 0, 10, dt);
              aiRig.rightLeg.rotation.x = THREE.MathUtils.damp(aiRig.rightLeg.rotation.x, 0, 10, dt);
            }

            // Predictive Target Leading when rotating AI toward player
            const leadFactor =
              losClear && sim.difficulty === 'hard'
                ? 0.16
                : losClear && sim.difficulty === 'normal'
                  ? 0.09
                  : 0;
            const predictedPlayerX = sim.playerX + sim.playerVx * leadFactor;
            const predictedPlayerZ = sim.playerZ + sim.playerVz * leadFactor;

            const lookAtX = losClear
              ? predictedPlayerX
              : timeSinceSaw < 4.0
                ? sim.aiLastKnownPlayerX
                : sim.aiTargetX;
            const lookAtZ = losClear
              ? predictedPlayerZ
              : timeSinceSaw < 4.0
                ? sim.aiLastKnownPlayerZ
                : sim.aiTargetZ;
            const desiredYaw = Math.atan2(lookAtX - sim.aiX, lookAtZ - sim.aiZ);
            let angleDiff = desiredYaw - sim.aiYaw;
            while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
            while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
            sim.aiYaw += angleDiff * Math.min(1, diffCfg.aimSpeed * dt);

            // Pitch AI weapon arm toward player vertical elevation when engaging
            const targetArmPitch = losClear
              ? -Math.atan2(currentEyeY - (1.34 - sim.aiCrouchOffset), distToPlayer)
              : 0.12;
            aiRig.weaponArm.rotation.x = THREE.MathUtils.damp(
              aiRig.weaponArm.rotation.x,
              targetArmPitch,
              12,
              dt
            );

            aiRig.root.position.set(sim.aiX, 0, sim.aiZ);
            aiRig.root.rotation.y = sim.aiYaw;

            // 5. AI Attack Telegraph, Facing Cone Verification, Multi-Shot Burst & 3D Tracer
            if (sim.aiFireCooldown > 0) {
              sim.aiFireCooldown = Math.max(0, sim.aiFireCooldown - dt);
            }
            if (sim.aiReactionTimer > 0) {
              sim.aiReactionTimer = Math.max(0, sim.aiReactionTimer - dt);
            }

            const withinWeaponRange = distToPlayer <= aiWeaponSpec.range;
            const isFacingPlayer = Math.abs(angleDiff) < 0.42;

            if (
              losClear &&
              isFacingPlayer &&
              (sim.aiState === 'attack' || distToPlayer < 12.0) &&
              sim.aiReactionTimer <= 0 &&
              sim.aiReloadTimer <= 0 &&
              sim.aiAmmoInMag > 0 &&
              withinWeaponRange
            ) {
              if (
                sim.aiBurstShotsLeft <= 0 &&
                sim.aiWindupTimer <= 0 &&
                sim.aiFireCooldown <= 0
              ) {
                sim.aiWindupTimer = diffCfg.windupDurationSec;
                soundEngine.playTelegraphAlert();
              }

              if (sim.aiWindupTimer > 0) {
                sim.aiWindupTimer -= dt;
                const windupProgress =
                  1 - Math.max(0, sim.aiWindupTimer) / diffCfg.windupDurationSec;
                aiRig.setTelegraphState(windupProgress);

                if (sim.aiWindupTimer <= 0) {
                  sim.aiBurstShotsLeft = aiWeaponSpec.automatic
                    ? sim.difficulty === 'hard'
                      ? 4
                      : 3
                    : 1;
                }
              }

              if (sim.aiWindupTimer <= 0 && sim.aiBurstShotsLeft > 0 && sim.aiFireCooldown <= 0) {
                // Fire AI weapon & decrement active magazine slot!
                aiRig.setTelegraphState(0.6);
                sim.aiBurstShotsLeft -= 1;
                sim.aiAmmoInMag = Math.max(0, sim.aiAmmoInMag - 1);
                if (sim.aiWeaponId === 'pistol' && sim.aiPrimaryWeaponId !== 'pistol') {
                  sim.aiSidearmAmmo = sim.aiAmmoInMag;
                } else {
                  sim.aiPrimaryAmmo = sim.aiAmmoInMag;
                }

                const baseShotInterval = 1 / aiWeaponSpec.fireRate;
                sim.aiFireCooldown =
                  sim.aiBurstShotsLeft > 0
                    ? baseShotInterval * (sim.difficulty === 'easy' ? 1.35 : 1.08)
                    : baseShotInterval *
                      (sim.difficulty === 'easy' ? 2.0 : sim.difficulty === 'normal' ? 1.4 : 1.12);

                aiRig.muzzleFlash.visible = true;
                aiRig.muzzleFlash.rotation.z = Math.random() * Math.PI;
                sim.aiMuzzleFlashTimer = 0.065;
                soundEngine.playWeaponFire(sim.aiWeaponId, true);

                // Verify LOS again and apply difficulty spread (sliding player is slightly harder for AI to hit)
                const slideDodgePenalty = sim.isSliding ? 1.25 : 1.0;
                const aimError =
                  (Math.random() - 0.5) * diffCfg.spreadRadians * 2 * slideDodgePenalty;
                const hitThreshold = Math.atan2(0.48, Math.max(2, distToPlayer));
                const didHitPlayer = Math.abs(aimError) <= hitThreshold && losClear;

                // Draw visible 3D AI bullet tracer from AI muzzle toward player
                const aiMuzzleX = sim.aiX + Math.sin(sim.aiYaw) * 0.75;
                const aiMuzzleY = 1.32 - sim.aiCrouchOffset;
                const aiMuzzleZ = sim.aiZ + Math.cos(sim.aiYaw) * 0.75;
                const traceEndX = didHitPlayer
                  ? sim.playerX
                  : sim.playerX + Math.sin(aimError * 8) * 1.4;
                const traceEndY = didHitPlayer ? currentEyeY - 0.18 : currentEyeY + aimError * 2;
                const traceEndZ = didHitPlayer
                  ? sim.playerZ
                  : sim.playerZ + Math.cos(aimError * 8) * 1.4;

                const aiPosAttr = aiTracerGeo.getAttribute('position') as THREE.BufferAttribute;
                aiPosAttr.setXYZ(0, aiMuzzleX, aiMuzzleY, aiMuzzleZ);
                aiPosAttr.setXYZ(1, traceEndX, traceEndY, traceEndZ);
                aiPosAttr.needsUpdate = true;
                aiTracerMat.opacity = 0.9;
                aiTracerTimer = 0.085;

                if (didHitPlayer) {
                  const isAiHeadshot = Math.random() < diffCfg.headshotChance;
                  const baseDmg = isAiHeadshot
                    ? aiWeaponSpec.headDamage
                    : aiWeaponSpec.bodyDamage;
                  const diffDmgMult =
                    sim.difficulty === 'easy' ? 0.55 : sim.difficulty === 'normal' ? 0.78 : 1.0;

                  const dmgRes = calculateDamageWithArmor(
                    Math.round(baseDmg * diffDmgMult),
                    sim.playerHealth,
                    sim.playerArmor,
                    distToPlayer,
                    aiWeaponSpec.range,
                    aiWeaponSpec.falloffStart
                  );

                  sim.playerHealth = dmgRes.newHealth;
                  sim.playerArmor = dmgRes.newArmor;
                  if (sim.playerArmor <= 0) sim.playerArmorType = 'none';

                  sim.cameraTrauma = Math.min(1, sim.cameraTrauma + 0.34);
                  soundEngine.playPlayerHurt();

                  if (dmgRes.eliminated) {
                    sim.playerDeaths += 1;
                    sim.killFeed = [
                      {
                        id: `kf_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                        killer: 'AI' as const,
                        victim: 'PLAYER' as const,
                        weaponId: sim.aiWeaponId,
                        weaponName: aiWeaponSpec.name,
                        isHeadshot: isAiHeadshot,
                        timestamp: performance.now(),
                      },
                      ...sim.killFeed,
                    ].slice(0, 4);
                    endRound('AI', 'YOU WERE ELIMINATED');
                  }
                } else {
                  // Near-miss impact sparks
                  spawnParticles(traceEndX, Math.max(0.1, traceEndY), traceEndZ, 4, 0xf43f5e, 3.0);
                }
              }
            } else {
              sim.aiWindupTimer = 0;
              sim.aiBurstShotsLeft = 0;
              aiRig.setTelegraphState(0);
            }
          }
        }
      }

      // Clear single-frame edge-triggered inputs
      keysJustPressed.clear();
      mouseLeftJustPressed = false;

      // Throttle HUD state synchronization to ~10Hz
      hudEmitAccum += dt;
      if (hudEmitAccum >= 0.1) {
        hudEmitAccum = 0;
        emitHudSnapshot();
      }

      // Subtle post-processing bloom pass with controlled muzzle-flash glow spike
      const quality = settingsRef.current.graphicsQuality;
      if (quality === 'performance') {
        renderer.render(scene, camera);
      } else {
        const baseStrength = quality === 'ultra' ? 0.16 : 0.11;
        const flashBoost =
          (sim.muzzleFlashTimer > 0 ? 0.12 : 0) + (sim.aiMuzzleFlashTimer > 0 ? 0.06 : 0);
        bloomPass.strength = baseStrength + flashBoost;
        composer.render();
      }

      if (isSoftwareGl) {
        afterDraw(tick);
      } else {
        frameId = requestAnimationFrame(tick);
      }
    }

    frameId = requestAnimationFrame(tick);

    return () => {
      closeMultiplayerSocket();
      cancelAnimationFrame(frameId);
      clearTimeout(frameId);
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener('webglcontextlost', onWebglContextLost);
      renderer.domElement.removeEventListener('webglcontextrestored', onWebglContextRestored);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('blur', onBlurOrVisibility);
      document.removeEventListener('pointerlockchange', onPointerLockChange);
      document.removeEventListener('contextmenu', onContextMenu);
      composer.dispose();
      mats.dispose();
      renderer.dispose();
    };
  }, [onRegisterApi]);

  return (
    <div
      ref={mountRef}
      data-testid="tactical-webgl-canvas"
      className="fixed inset-0 w-full h-full overflow-hidden bg-[#0b0f17]"
    />
  );
};
