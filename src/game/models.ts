import * as THREE from 'three';
import { WeaponId } from './types';

export interface AIOperativeRig {
  root: THREE.Group;
  bodyGroup: THREE.Group;
  headGroup: THREE.Group;
  leftLeg: THREE.Group;
  rightLeg: THREE.Group;
  weaponArm: THREE.Group;
  muzzleFlash: THREE.Mesh;
  visorMat: THREE.MeshStandardMaterial;
  armorMat: THREE.MeshStandardMaterial;
  telegraphRing: THREE.Mesh;
  hitTargets: THREE.Mesh[];
  setHitFlash: (active: boolean) => void;
  setTelegraphState: (intensity: number) => void;
  setEquippedWeapon: (weaponId: WeaponId) => void;
}

/**
 * Helper to extrude a 2D polygon silhouette along X (thickness) with machined bevels.
 * Input points are [z, y] in weapon space; the resulting geometry is centered on X=0.
 */
function createBeveledProfileGeometry(
  pointsZY: Array<[number, number]>,
  thicknessX: number,
  bevelSize = 0.0032
): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  for (let i = 0; i < pointsZY.length; i++) {
    const [z, y] = pointsZY[i];
    if (i === 0) shape.moveTo(z, y);
    else shape.lineTo(z, y);
  }
  shape.closePath();

  const extrudeDepth = Math.max(0.004, thicknessX - bevelSize * 2);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: extrudeDepth,
    bevelEnabled: true,
    bevelSegments: 2,
    steps: 1,
    bevelSize,
    bevelThickness: bevelSize,
  });

  // Rotate so shape X (z-coord) maps to -Z/+Z and extrusion Z maps to X
  geo.rotateY(-Math.PI / 2);
  geo.translate(extrudeDepth * 0.5, 0, 0);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Helper to revolve a 2D radial profile [radius, zOffset] around the Z axis using LatheGeometry.
 * Ideal for contoured barrels, multi-baffle suppressors, muzzle brakes, and sniper optic bells.
 */
function createLatheZGeometry(
  profileRZ: Array<[number, number]>,
  segments = 20
): THREE.BufferGeometry {
  const points = profileRZ.map(([r, z]) => new THREE.Vector2(Math.max(0.0005, r), z));
  const geo = new THREE.LatheGeometry(points, segments);
  geo.rotateX(Math.PI / 2);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Helper to create a smooth 3D TubeGeometry conduit along control points.
 */
function createConduitTubeGeometry(
  pts: Array<[number, number, number]>,
  radius: number,
  tubularSegments = 16,
  radialSegments = 8
): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(
    pts.map(([x, y, z]) => new THREE.Vector3(x, y, z))
  );
  return new THREE.TubeGeometry(curve, tubularSegments, radius, radialSegments, false);
}

/**
 * Generates procedural micro-bump textures (brushed metal, stippled polymer, carbon weave)
 * so 3D weapons, gloves, and operative armor catch studio environment highlights realistically.
 */
let _cachedWeaponTextures: {
  brushedBump: THREE.CanvasTexture;
  stippleBump: THREE.CanvasTexture;
  carbonBump: THREE.CanvasTexture;
} | null = null;

function getSharedModelMicroTextures() {
  if (_cachedWeaponTextures) return _cachedWeaponTextures;
  if (typeof document === 'undefined') {
    const fallback = new THREE.CanvasTexture(
      Object.assign(
        { width: 4, height: 4 },
        {}
      ) as unknown as HTMLCanvasElement
    );
    return { brushedBump: fallback, stippleBump: fallback, carbonBump: fallback };
  }

  // 1. Brushed Anodized Gunmetal Micro-Grain
  const c1 = document.createElement('canvas');
  c1.width = 128;
  c1.height = 128;
  const ctx1 = c1.getContext('2d');
  if (ctx1) {
    ctx1.fillStyle = '#808080';
    ctx1.fillRect(0, 0, 128, 128);
    for (let y = 0; y < 128; y++) {
      const shade = 116 + ((y * 17) % 24);
      ctx1.fillStyle = `rgb(${shade},${shade},${shade})`;
      ctx1.fillRect(0, y, 128, 1);
    }
    ctx1.strokeStyle = '#606060';
    ctx1.lineWidth = 1;
    for (let i = 0; i < 16; i++) {
      const pos = i * 8;
      ctx1.beginPath();
      ctx1.moveTo(0, pos);
      ctx1.lineTo(128, pos);
      ctx1.stroke();
    }
  }
  const brushedBump = new THREE.CanvasTexture(c1);
  brushedBump.wrapS = THREE.RepeatWrapping;
  brushedBump.wrapT = THREE.RepeatWrapping;
  brushedBump.repeat.set(3, 3);

  // 2. Stippled Tactical Polymer Grip & Ripstop Fabric Weave
  const c2 = document.createElement('canvas');
  c2.width = 128;
  c2.height = 128;
  const ctx2 = c2.getContext('2d');
  if (ctx2) {
    ctx2.fillStyle = '#787878';
    ctx2.fillRect(0, 0, 128, 128);
    for (let y = 0; y < 128; y += 4) {
      for (let x = 0; x < 128; x += 4) {
        const bright = ((x + y) % 8 === 0) ? 165 : 92;
        ctx2.fillStyle = `rgb(${bright},${bright},${bright})`;
        ctx2.fillRect(x, y, 3, 3);
      }
    }
  }
  const stippleBump = new THREE.CanvasTexture(c2);
  stippleBump.wrapS = THREE.RepeatWrapping;
  stippleBump.wrapT = THREE.RepeatWrapping;
  stippleBump.repeat.set(6, 6);

  // 3. Carbon-Fiber & Armored Plate Twill Weave
  const c3 = document.createElement('canvas');
  c3.width = 128;
  c3.height = 128;
  const ctx3 = c3.getContext('2d');
  if (ctx3) {
    ctx3.fillStyle = '#707070';
    ctx3.fillRect(0, 0, 128, 128);
    for (let y = 0; y < 128; y += 8) {
      for (let x = 0; x < 128; x += 8) {
        const offset = (y / 8) % 2 === 0 ? 0 : 4;
        ctx3.fillStyle = '#b0b0b0';
        ctx3.fillRect((x + offset) % 128, y, 4, 4);
        ctx3.fillStyle = '#484848';
        ctx3.fillRect((x + offset + 4) % 128, y + 4, 4, 4);
      }
    }
  }
  const carbonBump = new THREE.CanvasTexture(c3);
  carbonBump.wrapS = THREE.RepeatWrapping;
  carbonBump.wrapT = THREE.RepeatWrapping;
  carbonBump.repeat.set(4, 4);

  _cachedWeaponTextures = { brushedBump, stippleBump, carbonBump };
  return _cachedWeaponTextures;
}

/**
 * Builds a high-detail articulated cyber-tactical AI operative with grounded bottom-center pivot,
 * sculpted beveled ballistic helmet & panoramic visor, multi-plate chest rig & glowing reactor core,
 * dual-arm weapon stance, contoured limb armor, and detailed 3rd-person weapon models.
 */
export function createAIOperativeModel(): AIOperativeRig {
  const root = new THREE.Group();
  const microTex = getSharedModelMicroTextures();

  // Contact shadow disc grounded at y = 0.015
  const shadowGeo = new THREE.CircleGeometry(0.64, 24);
  shadowGeo.rotateX(-Math.PI / 2);
  const shadowMat = new THREE.MeshBasicMaterial({
    color: 0x000000,
    transparent: true,
    opacity: 0.45,
    depthWrite: false,
  });
  const shadowDisc = new THREE.Mesh(shadowGeo, shadowMat);
  shadowDisc.position.y = 0.015;
  root.add(shadowDisc);

  // Telegraph warning ring on ground when winding up shot
  const ringGeo = new THREE.RingGeometry(0.68, 0.84, 28);
  ringGeo.rotateX(-Math.PI / 2);
  const ringMat = new THREE.MeshBasicMaterial({
    color: 0xf43f5e,
    transparent: true,
    opacity: 0,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const telegraphRing = new THREE.Mesh(ringGeo, ringMat);
  telegraphRing.position.y = 0.025;
  root.add(telegraphRing);

  const hullMat = new THREE.MeshStandardMaterial({
    color: 0x1e293b,
    roughness: 0.68,
    metalness: 0.32,
    bumpMap: microTex.stippleBump,
    bumpScale: 0.004,
  });

  const armorMat = new THREE.MeshStandardMaterial({
    color: 0x991b1b,
    roughness: 0.32,
    metalness: 0.68,
    bumpMap: microTex.carbonBump,
    bumpScale: 0.005,
  });

  const trimMat = new THREE.MeshStandardMaterial({
    color: 0x94a3b8,
    roughness: 0.22,
    metalness: 0.9,
    bumpMap: microTex.brushedBump,
    bumpScale: 0.003,
  });

  const darkGunMat = new THREE.MeshStandardMaterial({
    color: 0x0f172a,
    roughness: 0.38,
    metalness: 0.82,
    bumpMap: microTex.brushedBump,
    bumpScale: 0.003,
  });

  const visorMat = new THREE.MeshStandardMaterial({
    color: 0xf43f5e,
    emissive: 0xf43f5e,
    emissiveIntensity: 0.95,
    roughness: 0.16,
    metalness: 0.85,
  });

  const cyanCoreMat = new THREE.MeshStandardMaterial({
    color: 0x38bdf8,
    emissive: 0x0284c7,
    emissiveIntensity: 0.85,
    roughness: 0.18,
    metalness: 0.5,
  });

  const bodyGroup = new THREE.Group();
  root.add(bodyGroup);

  // 1. Sculpted Articulated Legs with Contoured Thighs, Beveled Knee Guards, Shin Greaves & Combat Boots
  const createLeg = (offsetX: number) => {
    const leg = new THREE.Group();
    leg.position.set(offsetX, 0.82, 0);
    const sideSign = offsetX < 0 ? -1 : 1;

    // Upper thigh muscle/suit core
    const thigh = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.105, 0.24, 8, 14),
      hullMat
    );
    thigh.position.y = -0.2;
    thigh.castShadow = true;
    leg.add(thigh);

    // Outer beveled ballistic thigh plate + holster/utility pod
    const thighArmorGeo = createBeveledProfileGeometry(
      [
        [-0.1, -0.05],
        [0.11, -0.05],
        [0.09, -0.34],
        [-0.08, -0.34],
      ],
      0.06,
      0.008
    );
    const thighArmor = new THREE.Mesh(thighArmorGeo, armorMat);
    thighArmor.position.set(sideSign * 0.09, 0, 0);
    leg.add(thighArmor);

    // Sculpted angular knee pad with metallic cap
    const kneePadGeo = createBeveledProfileGeometry(
      [
        [-0.04, -0.34],
        [0.14, -0.36],
        [0.15, -0.48],
        [-0.04, -0.5],
      ],
      0.22,
      0.012
    );
    const kneePad = new THREE.Mesh(kneePadGeo, armorMat);
    const kneeCap = new THREE.Mesh(
      new THREE.BoxGeometry(0.16, 0.06, 0.04),
      trimMat
    );
    kneeCap.position.set(0, -0.42, 0.145);
    leg.add(kneePad, kneeCap);

    // Tapered shin & armored front greave
    const shin = new THREE.Mesh(
      new THREE.CylinderGeometry(0.095, 0.078, 0.38, 12),
      hullMat
    );
    shin.position.y = -0.61;
    shin.castShadow = true;

    const shinGreaveGeo = createBeveledProfileGeometry(
      [
        [0.02, -0.48],
        [0.125, -0.5],
        [0.11, -0.74],
        [0.01, -0.74],
      ],
      0.18,
      0.01
    );
    const shinGreave = new THREE.Mesh(shinGreaveGeo, darkGunMat);
    leg.add(shin, shinGreave);

    // Multi-part tactical combat boot with ankle cuff & lugged sole
    const bootGeo = createBeveledProfileGeometry(
      [
        [-0.11, -0.71],
        [0.08, -0.71],
        [0.19, -0.77],
        [0.19, -0.82],
        [-0.11, -0.82],
      ],
      0.21,
      0.012
    );
    const boot = new THREE.Mesh(bootGeo, darkGunMat);
    const bootToeCap = new THREE.Mesh(
      new THREE.BoxGeometry(0.215, 0.055, 0.12),
      trimMat
    );
    bootToeCap.position.set(0, -0.79, 0.13);
    leg.add(boot, bootToeCap);

    return leg;
  };

  const leftLeg = createLeg(-0.165);
  const rightLeg = createLeg(0.165);
  bodyGroup.add(leftLeg, rightLeg);

  // 2. Sculpted Pelvis, Tactical Utility Belt & Pouches
  const pelvisGeo = createBeveledProfileGeometry(
    [
      [-0.15, 0.97],
      [0.16, 0.97],
      [0.13, 0.79],
      [-0.13, 0.79],
    ],
    0.48,
    0.018
  );
  const pelvis = new THREE.Mesh(pelvisGeo, hullMat);
  bodyGroup.add(pelvis);

  const belt = new THREE.Mesh(
    new THREE.BoxGeometry(0.52, 0.075, 0.34),
    darkGunMat
  );
  belt.position.y = 0.95;
  const beltBuckle = new THREE.Mesh(
    new THREE.BoxGeometry(0.12, 0.085, 0.36),
    trimMat
  );
  beltBuckle.position.y = 0.95;
  bodyGroup.add(belt, beltBuckle);

  [-0.18, 0.18].forEach((px) => {
    const pouch = new THREE.Mesh(
      new THREE.BoxGeometry(0.1, 0.12, 0.08),
      armorMat
    );
    pouch.position.set(px, 0.94, 0.17);
    bodyGroup.add(pouch);
  });

  // 3. Sculpted Torso, Angular Ballistic Chest Cuirass & Hexagonal Radianite Core
  const torsoGeo = createBeveledProfileGeometry(
    [
      [-0.16, 1.54],
      [0.17, 1.54],
      [0.14, 0.98],
      [-0.14, 0.98],
    ],
    0.52,
    0.024
  );
  const torso = new THREE.Mesh(torsoGeo, hullMat);
  torso.castShadow = true;
  bodyGroup.add(torso);

  const chestPlateGeo = createBeveledProfileGeometry(
    [
      [-0.18, 1.5],
      [0.2, 1.5],
      [0.23, 1.32],
      [0.17, 1.08],
      [-0.17, 1.08],
    ],
    0.48,
    0.02
  );
  const chestPlate = new THREE.Mesh(chestPlateGeo, armorMat);
  bodyGroup.add(chestPlate);

  // Armored collar gorget around the neck
  const collar = new THREE.Mesh(
    new THREE.CylinderGeometry(0.18, 0.22, 0.09, 12),
    darkGunMat
  );
  collar.position.set(0, 1.55, 0);
  bodyGroup.add(collar);

  // Glowing Chest Reactor Core with Bezel Ring
  const chestCoreBezel = new THREE.Mesh(
    new THREE.CylinderGeometry(0.085, 0.095, 0.04, 6),
    trimMat
  );
  chestCoreBezel.rotation.x = Math.PI / 2;
  chestCoreBezel.position.set(0, 1.33, 0.225);
  const chestCore = new THREE.Mesh(
    new THREE.CylinderGeometry(0.062, 0.062, 0.05, 6),
    visorMat
  );
  chestCore.rotation.x = Math.PI / 2;
  chestCore.position.set(0, 1.33, 0.23);
  bodyGroup.add(chestCoreBezel, chestCore);

  // Sculpted Thruster/Comms Backpack with Dual Glowing Core Vents
  const backPackGeo = createBeveledProfileGeometry(
    [
      [-0.16, 1.48],
      [-0.3, 1.44],
      [-0.32, 1.12],
      [-0.16, 1.08],
    ],
    0.36,
    0.018
  );
  const backPack = new THREE.Mesh(backPackGeo, trimMat);
  const packVentL = new THREE.Mesh(
    new THREE.CylinderGeometry(0.032, 0.042, 0.08, 10),
    visorMat
  );
  packVentL.position.set(-0.11, 1.12, -0.26);
  const packVentR = new THREE.Mesh(
    new THREE.CylinderGeometry(0.032, 0.042, 0.08, 10),
    visorMat
  );
  packVentR.position.set(0.11, 1.12, -0.26);
  bodyGroup.add(backPack, packVentL, packVentR);

  // 4. Sloped Multi-Layer Shoulder Pauldrons
  const createPauldron = (isLeft: boolean) => {
    const pGroup = new THREE.Group();
    const sign = isLeft ? -1 : 1;
    pGroup.position.set(sign * 0.34, 1.43, 0);
    pGroup.rotation.z = sign * -0.18;

    const mainPlateGeo = createBeveledProfileGeometry(
      [
        [-0.17, 0.1],
        [0.17, 0.1],
        [0.15, -0.14],
        [-0.15, -0.14],
      ],
      0.18,
      0.015
    );
    const mainPlate = new THREE.Mesh(mainPlateGeo, armorMat);
    const trimStripe = new THREE.Mesh(
      new THREE.BoxGeometry(0.195, 0.04, 0.35),
      trimMat
    );
    trimStripe.position.y = 0.06;
    pGroup.add(mainPlate, trimStripe);
    return pGroup;
  };
  bodyGroup.add(createPauldron(true), createPauldron(false));

  // 5. Articulated Dual-Arm Combat Stance (`weaponArm`)
  const weaponArm = new THREE.Group();
  weaponArm.position.set(0.32, 1.34, 0.1);

  // Right Upper Arm & Forearm
  const rightUpperArm = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.072, 0.22, 8, 12),
    hullMat
  );
  rightUpperArm.rotation.x = Math.PI / 2 - 0.25;
  rightUpperArm.position.set(0, -0.03, 0.08);
  const rightForearm = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.064, 0.24, 8, 12),
    darkGunMat
  );
  rightForearm.rotation.x = Math.PI / 2;
  rightForearm.position.set(-0.03, -0.06, 0.26);
  const rightGlove = new THREE.Mesh(
    new THREE.SphereGeometry(0.068, 10, 10),
    armorMat
  );
  rightGlove.position.set(-0.055, -0.05, 0.38);

  // Left Support Arm reaching across the chest to stabilize the weapon forend
  const leftUpperArm = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.07, 0.26, 8, 12),
    hullMat
  );
  leftUpperArm.position.set(-0.62, -0.04, 0.12);
  leftUpperArm.rotation.set(Math.PI / 2 - 0.18, 0.52, 0);

  const leftForearm = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.062, 0.28, 8, 12),
    darkGunMat
  );
  leftForearm.position.set(-0.34, -0.05, 0.36);
  leftForearm.rotation.set(Math.PI / 2, 0.82, 0);

  const leftSupportGlove = new THREE.Mesh(
    new THREE.SphereGeometry(0.064, 10, 10),
    armorMat
  );
  leftSupportGlove.position.set(-0.08, -0.03, 0.52);

  weaponArm.add(
    rightUpperArm,
    rightForearm,
    rightGlove,
    leftUpperArm,
    leftForearm,
    leftSupportGlove
  );

  // 6. High-Detail 3rd-Person Weapon Models for the AI Operative
  const aiWeaponMeshes: Record<WeaponId, THREE.Group> = {
    pistol: new THREE.Group(),
    smg: new THREE.Group(),
    shotgun: new THREE.Group(),
    rifle: new THREE.Group(),
    sniper: new THREE.Group(),
  };

  // (1) AI Pistol (Classic-9)
  const aiPistolSlide = new THREE.Mesh(
    createBeveledProfileGeometry(
      [
        [0.24, 0.04],
        [0.54, 0.04],
        [0.56, 0.01],
        [0.24, 0.0],
      ],
      0.06,
      0.005
    ),
    trimMat
  );
  aiPistolSlide.position.set(-0.06, 0, 0);
  const aiPistolFrame = new THREE.Mesh(
    new THREE.BoxGeometry(0.054, 0.04, 0.28),
    darkGunMat
  );
  aiPistolFrame.position.set(-0.06, -0.01, 0.38);
  const aiPistolGrip = new THREE.Mesh(
    new THREE.BoxGeometry(0.05, 0.14, 0.075),
    darkGunMat
  );
  aiPistolGrip.position.set(-0.06, -0.07, 0.28);
  aiPistolGrip.rotation.x = -0.2;
  const aiPistolCore = new THREE.Mesh(
    new THREE.BoxGeometry(0.062, 0.012, 0.18),
    cyanCoreMat
  );
  aiPistolCore.position.set(-0.06, 0.015, 0.42);
  aiWeaponMeshes.pistol.add(aiPistolSlide, aiPistolFrame, aiPistolGrip, aiPistolCore);

  // (2) AI SMG (Spectre-VX)
  const aiSmgBody = new THREE.Mesh(
    createBeveledProfileGeometry(
      [
        [0.2, 0.06],
        [0.62, 0.06],
        [0.64, -0.02],
        [0.22, -0.03],
      ],
      0.075,
      0.006
    ),
    darkGunMat
  );
  aiSmgBody.position.set(-0.06, 0, 0);
  const aiSmgSupp = new THREE.Mesh(
    createLatheZGeometry([
      [0.022, 0],
      [0.028, 0.02],
      [0.028, 0.24],
      [0.018, 0.26],
    ], 14),
    trimMat
  );
  aiSmgSupp.position.set(-0.06, 0.025, 0.62);
  const aiSmgMag = new THREE.Mesh(
    new THREE.BoxGeometry(0.042, 0.22, 0.058),
    armorMat
  );
  aiSmgMag.position.set(-0.06, -0.12, 0.48);
  aiSmgMag.rotation.x = 0.22;
  const aiSmgHolo = new THREE.Mesh(
    new THREE.BoxGeometry(0.05, 0.045, 0.08),
    visorMat
  );
  aiSmgHolo.position.set(-0.06, 0.08, 0.38);
  aiWeaponMeshes.smg.add(aiSmgBody, aiSmgSupp, aiSmgMag, aiSmgHolo);

  // (3) AI Shotgun (Judge-12)
  const aiSgBody = new THREE.Mesh(
    createBeveledProfileGeometry(
      [
        [0.16, 0.065],
        [0.76, 0.065],
        [0.78, -0.015],
        [0.18, -0.025],
      ],
      0.09,
      0.007
    ),
    darkGunMat
  );
  aiSgBody.position.set(-0.06, 0, 0);
  const aiSgBarrel = new THREE.Mesh(
    new THREE.CylinderGeometry(0.024, 0.024, 0.28, 12),
    trimMat
  );
  aiSgBarrel.rotation.x = Math.PI / 2;
  aiSgBarrel.position.set(-0.06, 0.035, 0.84);
  const aiSgDrum = new THREE.Mesh(
    new THREE.CylinderGeometry(0.095, 0.095, 0.09, 16),
    armorMat
  );
  aiSgDrum.rotation.x = Math.PI / 2;
  aiSgDrum.position.set(-0.06, -0.09, 0.48);
  aiWeaponMeshes.shotgun.add(aiSgBody, aiSgBarrel, aiSgDrum);

  // (4) AI Rifle (Vandal-AR)
  const aiRifleBody = new THREE.Mesh(
    createBeveledProfileGeometry(
      [
        [0.14, 0.068],
        [0.74, 0.065],
        [0.76, -0.015],
        [0.16, -0.025],
      ],
      0.08,
      0.006
    ),
    darkGunMat
  );
  aiRifleBody.position.set(-0.06, 0, 0);
  const aiRifleBarrel = new THREE.Mesh(
    createLatheZGeometry([
      [0.02, 0],
      [0.018, 0.24],
      [0.026, 0.25],
      [0.026, 0.34],
    ], 12),
    trimMat
  );
  aiRifleBarrel.position.set(-0.06, 0.03, 0.74);
  const aiRifleMag = new THREE.Mesh(
    new THREE.BoxGeometry(0.048, 0.22, 0.082),
    armorMat
  );
  aiRifleMag.position.set(-0.06, -0.11, 0.5);
  aiRifleMag.rotation.x = 0.28;
  const aiRifleSight = new THREE.Mesh(
    new THREE.BoxGeometry(0.052, 0.048, 0.09),
    visorMat
  );
  aiRifleSight.position.set(-0.06, 0.085, 0.38);
  const aiRifleCore = new THREE.Mesh(
    new THREE.BoxGeometry(0.086, 0.014, 0.42),
    cyanCoreMat
  );
  aiRifleCore.position.set(-0.06, 0.025, 0.46);
  aiWeaponMeshes.rifle.add(aiRifleBody, aiRifleBarrel, aiRifleMag, aiRifleSight, aiRifleCore);

  // (5) AI Sniper (Operator-SR)
  const aiSniperBody = new THREE.Mesh(
    createBeveledProfileGeometry(
      [
        [0.1, 0.07],
        [0.84, 0.068],
        [0.86, -0.02],
        [0.12, -0.03],
      ],
      0.086,
      0.007
    ),
    darkGunMat
  );
  aiSniperBody.position.set(-0.06, 0, 0);
  const aiSniperBarrel = new THREE.Mesh(
    createLatheZGeometry([
      [0.024, 0],
      [0.019, 0.42],
      [0.034, 0.44],
      [0.034, 0.56],
    ], 14),
    trimMat
  );
  aiSniperBarrel.position.set(-0.06, 0.032, 0.84);
  const aiSniperScope = new THREE.Mesh(
    createLatheZGeometry([
      [0.032, 0],
      [0.022, 0.08],
      [0.022, 0.28],
      [0.038, 0.38],
    ], 14),
    armorMat
  );
  aiSniperScope.position.set(-0.06, 0.115, 0.34);
  const aiSniperCore = new THREE.Mesh(
    new THREE.BoxGeometry(0.092, 0.016, 0.56),
    cyanCoreMat
  );
  aiSniperCore.position.set(-0.06, 0.025, 0.5);
  aiWeaponMeshes.sniper.add(aiSniperBody, aiSniperBarrel, aiSniperScope, aiSniperCore);

  (Object.keys(aiWeaponMeshes) as WeaponId[]).forEach((wid) => {
    aiWeaponMeshes[wid].visible = wid === 'pistol';
    weaponArm.add(aiWeaponMeshes[wid]);
  });

  const flashGeo = new THREE.OctahedronGeometry(0.16, 0);
  const flashMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(1.6, 1.15, 0.35),
    transparent: true,
    opacity: 0.92,
    depthWrite: false,
  });
  const muzzleFlash = new THREE.Mesh(flashGeo, flashMat);
  muzzleFlash.position.set(-0.06, 0.02, 0.85);
  muzzleFlash.visible = false;
  weaponArm.add(muzzleFlash);

  bodyGroup.add(weaponArm);

  // 7. Sculpted Ballistic Helmet, Panoramic Glowing Visor & Comms Array (`headGroup`)
  const headGroup = new THREE.Group();
  headGroup.position.set(0, 1.68, 0);

  const helmetGeo = createBeveledProfileGeometry(
    [
      [-0.18, -0.14],
      [0.16, -0.15],
      [0.2, 0.02],
      [0.15, 0.18],
      [-0.16, 0.19],
      [-0.2, 0.02],
    ],
    0.32,
    0.026
  );
  const helmet = new THREE.Mesh(helmetGeo, hullMat);
  helmet.castShadow = true;
  headGroup.add(helmet);

  // Sculpted dorsal helmet crest
  const helmetCrestGeo = createBeveledProfileGeometry(
    [
      [-0.17, 0.16],
      [0.16, 0.15],
      [0.12, 0.23],
      [-0.14, 0.23],
    ],
    0.11,
    0.012
  );
  const helmetCrest = new THREE.Mesh(helmetCrestGeo, armorMat);
  headGroup.add(helmetCrest);

  // Panoramic wrap-around glowing combat visor + cheek mandible plates
  const visorGeo = createBeveledProfileGeometry(
    [
      [0.02, -0.03],
      [0.215, -0.02],
      [0.225, 0.075],
      [0.02, 0.085],
    ],
    0.335,
    0.012
  );
  const visor = new THREE.Mesh(visorGeo, visorMat);
  headGroup.add(visor);

  // Dual side comms earpieces + whip antenna
  [-0.175, 0.175].forEach((ex) => {
    const earpiece = new THREE.Mesh(
      new THREE.CylinderGeometry(0.065, 0.065, 0.04, 12),
      trimMat
    );
    earpiece.rotation.z = Math.PI / 2;
    earpiece.position.set(ex, 0.01, -0.02);
    headGroup.add(earpiece);
  });

  const commsAntenna = new THREE.Mesh(
    new THREE.CylinderGeometry(0.006, 0.012, 0.26, 8),
    trimMat
  );
  commsAntenna.position.set(-0.15, 0.24, -0.1);
  commsAntenna.rotation.x = -0.22;
  const antennaTip = new THREE.Mesh(
    new THREE.SphereGeometry(0.014, 8, 8),
    visorMat
  );
  antennaTip.position.set(-0.15, 0.36, -0.13);
  headGroup.add(commsAntenna, antennaTip);

  bodyGroup.add(headGroup);

  const hitboxMat = new THREE.MeshBasicMaterial({ visible: false });
  const headHitbox = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.46, 0.46), hitboxMat);
  headHitbox.position.set(0, 0.02, 0);
  headHitbox.userData.hitbox = 'head';
  headGroup.add(headHitbox);

  const bodyHitbox = new THREE.Mesh(new THREE.BoxGeometry(0.78, 1.5, 0.56), hitboxMat);
  bodyHitbox.position.set(0, 0.76, 0);
  bodyHitbox.userData.hitbox = 'body';
  bodyGroup.add(bodyHitbox);

  const setHitFlash = (active: boolean) => {
    if (active) {
      armorMat.emissive.setHex(0xffffff);
      armorMat.emissiveIntensity = 0.65;
      hullMat.emissive.setHex(0xf43f5e);
      hullMat.emissiveIntensity = 0.35;
    } else {
      armorMat.emissive.setHex(0x000000);
      armorMat.emissiveIntensity = 0;
      hullMat.emissive.setHex(0x000000);
      hullMat.emissiveIntensity = 0;
    }
  };

  const setTelegraphState = (intensity: number) => {
    const clamped = Math.max(0, Math.min(1, intensity));
    visorMat.emissiveIntensity = 0.85 + clamped * 1.4;
    ringMat.opacity = clamped * 0.68;
    const scale = 1 + clamped * 0.35;
    telegraphRing.scale.set(scale, 1, scale);
  };

  const setEquippedWeapon = (weaponId: WeaponId) => {
    (Object.keys(aiWeaponMeshes) as WeaponId[]).forEach((wid) => {
      aiWeaponMeshes[wid].visible = wid === weaponId;
    });
    leftSupportGlove.visible = weaponId !== 'pistol';
    leftForearm.visible = weaponId !== 'pistol';
    leftUpperArm.visible = weaponId !== 'pistol';
    muzzleFlash.position.z =
      weaponId === 'sniper' ? 1.42 : weaponId === 'rifle' ? 1.1 : weaponId === 'pistol' ? 0.58 : 0.92;
  };

  return {
    root,
    bodyGroup,
    headGroup,
    leftLeg,
    rightLeg,
    weaponArm,
    muzzleFlash,
    visorMat,
    armorMat,
    telegraphRing,
    hitTargets: [headHitbox, bodyHitbox],
    setHitFlash,
    setTelegraphState,
    setEquippedWeapon,
  };
}

export interface ArticulatedWeaponParts {
  group: THREE.Group;
  magGroup: THREE.Group;
  slideOrBoltGroup: THREE.Group;
}

export interface FirstPersonWeaponRig {
  root: THREE.Group;
  inspectPivot: THREE.Group;
  weaponGroups: Record<WeaponId, THREE.Group>;
  rightArmGroup: THREE.Group;
  leftArmGroup: THREE.Group;
  leftSupportDefaultPos: THREE.Vector3;
  muzzleFlash: THREE.Object3D;
  muzzleLight: THREE.PointLight;
  shellMesh: THREE.Mesh;
  setActiveWeapon: (id: WeaponId) => void;
  setArticulation: (magOffsetY: number, magOffsetZ: number, slidePullBack: number) => void;
  updateAccentColor: (hex: number) => void;
}

/**
 * Builds sculpted, chamfered 30-45 part first-person 3D firearms using beveled ExtrudeGeometry
 * silhouettes, LatheGeometry contoured barrels/muzzle brakes/optics, TubeGeometry plasma conduits,
 * procedural micro-bump textures, articulated slides/bolts/pumps, detachable magazines, and 5-finger tactical hands.
 */
export function createFirstPersonWeaponRig(initialAccentHex = 0xf43f5e): FirstPersonWeaponRig {
  const root = new THREE.Group();
  const inspectPivot = new THREE.Group();
  root.add(inspectPivot);

  const microTex = getSharedModelMicroTextures();

  // Precision-tuned PBR firearm materials with procedural micro-bump maps
  const gunMetalMat = new THREE.MeshStandardMaterial({
    color: 0x243247,
    roughness: 0.26,
    metalness: 0.88,
    bumpMap: microTex.brushedBump,
    bumpScale: 0.0025,
  });

  const receiverAlloyMat = new THREE.MeshStandardMaterial({
    color: 0x334155,
    roughness: 0.32,
    metalness: 0.82,
    bumpMap: microTex.brushedBump,
    bumpScale: 0.0022,
  });

  const darkPolymerMat = new THREE.MeshStandardMaterial({
    color: 0x111827,
    roughness: 0.68,
    metalness: 0.2,
    bumpMap: microTex.carbonBump,
    bumpScale: 0.0028,
  });

  const stippledGripMat = new THREE.MeshStandardMaterial({
    color: 0x0b111e,
    roughness: 0.86,
    metalness: 0.12,
    bumpMap: microTex.stippleBump,
    bumpScale: 0.0045,
  });

  const brushedSteelMat = new THREE.MeshStandardMaterial({
    color: 0xcbd5e1,
    roughness: 0.16,
    metalness: 0.95,
    bumpMap: microTex.brushedBump,
    bumpScale: 0.0018,
  });

  const titaniumMat = new THREE.MeshStandardMaterial({
    color: 0x64748b,
    roughness: 0.28,
    metalness: 0.86,
    bumpMap: microTex.brushedBump,
    bumpScale: 0.002,
  });

  const accentMat = new THREE.MeshStandardMaterial({
    color: initialAccentHex,
    emissive: initialAccentHex,
    emissiveIntensity: 0.55,
    roughness: 0.22,
    metalness: 0.72,
  });

  const radianiteCoreMat = new THREE.MeshStandardMaterial({
    color: 0x38bdf8,
    emissive: 0x0284c7,
    emissiveIntensity: 0.85,
    roughness: 0.16,
    metalness: 0.48,
  });

  const tritiumSightMat = new THREE.MeshStandardMaterial({
    color: 0x34d399,
    emissive: 0x10b981,
    emissiveIntensity: 0.95,
    roughness: 0.15,
    metalness: 0.3,
  });

  const opticLensMat = new THREE.MeshBasicMaterial({
    color: 0x38bdf8,
    transparent: true,
    opacity: 0.28,
    depthWrite: false,
  });

  const sleeveFabricMat = new THREE.MeshStandardMaterial({
    color: 0x172033,
    roughness: 0.78,
    metalness: 0.12,
    bumpMap: microTex.stippleBump,
    bumpScale: 0.0038,
  });

  const sleeveRibMat = new THREE.MeshStandardMaterial({
    color: 0x0f172a,
    roughness: 0.84,
    metalness: 0.1,
    bumpMap: microTex.carbonBump,
    bumpScale: 0.003,
  });

  const gloveLeatherMat = new THREE.MeshStandardMaterial({
    color: 0x1e2636,
    roughness: 0.76,
    metalness: 0.08,
    bumpMap: microTex.stippleBump,
    bumpScale: 0.0032,
  });

  const glovePalmGripMat = new THREE.MeshStandardMaterial({
    color: 0x141b26,
    roughness: 0.88,
    metalness: 0.05,
    bumpMap: microTex.stippleBump,
    bumpScale: 0.0042,
  });

  const carbonKnuckleMat = new THREE.MeshStandardMaterial({
    color: 0x283344,
    roughness: 0.42,
    metalness: 0.52,
    bumpMap: microTex.carbonBump,
    bumpScale: 0.0045,
  });

  const brassMat = new THREE.MeshStandardMaterial({
    color: 0xfbbf24,
    emissive: 0xd97706,
    emissiveIntensity: 0.28,
    roughness: 0.2,
    metalness: 0.94,
  });

  const createPicatinnyRail = (length: number, count: number, yPos: number, zCenter: number) => {
    const railGroup = new THREE.Group();
    const base = new THREE.Mesh(
      new THREE.BoxGeometry(0.03, 0.007, length),
      titaniumMat
    );
    base.position.set(0, yPos, zCenter);
    railGroup.add(base);

    const step = length / count;
    for (let i = 0; i < count; i++) {
      const tooth = new THREE.Mesh(
        new THREE.BoxGeometry(0.034, 0.0055, step * 0.55),
        brushedSteelMat
      );
      tooth.position.set(0, yPos + 0.0055, zCenter - length / 2 + i * step + step * 0.5);
      railGroup.add(tooth);
    }
    return railGroup;
  };

  const createPanoramicHoloSight = (yPos: number, zPos: number): THREE.Group => {
    const sight = new THREE.Group();
    const baseClamp = new THREE.Mesh(
      new THREE.BoxGeometry(0.044, 0.014, 0.092),
      darkPolymerMat
    );
    baseClamp.position.set(0, yPos, zPos);

    // Sculpted canted protective hood
    const hoodProfile = createBeveledProfileGeometry(
      [
        [zPos + 0.038, yPos + 0.006],
        [zPos - 0.038, yPos + 0.006],
        [zPos - 0.028, yPos + 0.046],
        [zPos + 0.032, yPos + 0.046],
      ],
      0.048,
      0.002
    );
    const hoodOuter = new THREE.Mesh(hoodProfile, gunMetalMat);
    sight.add(baseClamp, hoodOuter);

    // Clear inner window cutout & reflex lens
    const glass = new THREE.Mesh(
      new THREE.PlaneGeometry(0.034, 0.028),
      opticLensMat
    );
    glass.position.set(0, yPos + 0.026, zPos - 0.015);

    // Crisp holo-ring + center dot reticle
    const holoRing = new THREE.Mesh(
      new THREE.RingGeometry(0.005, 0.0065, 16),
      accentMat
    );
    holoRing.position.set(0, yPos + 0.026, zPos - 0.014);
    const holoDot = new THREE.Mesh(
      new THREE.CircleGeometry(0.0018, 10),
      radianiteCoreMat
    );
    holoDot.position.set(0, yPos + 0.026, zPos - 0.013);

    sight.add(glass, holoRing, holoDot);
    return sight;
  };

  const createCurvedTriggerAndGuard = (yPos: number, zPos: number): THREE.Group => {
    const tg = new THREE.Group();
    const guardGeo = createBeveledProfileGeometry(
      [
        [zPos + 0.022, yPos],
        [zPos - 0.046, yPos],
        [zPos - 0.052, yPos - 0.014],
        [zPos - 0.038, yPos - 0.032],
        [zPos + 0.012, yPos - 0.032],
      ],
      0.016,
      0.0015
    );
    const guardMesh = new THREE.Mesh(guardGeo, titaniumMat);

    // Curved match trigger blade
    const triggerBlade = new THREE.Mesh(
      new THREE.CylinderGeometry(0.0035, 0.005, 0.024, 8),
      accentMat
    );
    triggerBlade.position.set(0, yPos - 0.014, zPos - 0.012);
    triggerBlade.rotation.x = -0.35;

    tg.add(guardMesh, triggerBlade);
    return tg;
  };

  const buildWeaponParts = (id: WeaponId): ArticulatedWeaponParts => {
    const g = new THREE.Group();
    const magGroup = new THREE.Group();
    const slideOrBoltGroup = new THREE.Group();
    g.add(magGroup);
    g.add(slideOrBoltGroup);

    if (id === 'pistol') {
      // ======================================================================
      // CLASSIC-9 // SCULPTED TACTICAL SIDEARM
      // ======================================================================
      // 1. Beveled Lower Frame & Ergonomic Beaver-Tail Grip (ExtrudeGeometry)
      const frameGeo = createBeveledProfileGeometry(
        [
          [0.065, 0.016],
          [0.042, 0.022],
          [-0.225, 0.022],
          [-0.238, 0.004],
          [-0.215, -0.014],
          [-0.035, -0.014],
          [0.012, -0.125],
          [0.068, -0.122],
          [0.042, -0.012],
        ],
        0.042,
        0.003
      );
      const frameMesh = new THREE.Mesh(frameGeo, darkPolymerMat);

      // Contoured Stippled Grip Panels & Flared Magwell
      const gripPanelGeo = createBeveledProfileGeometry(
        [
          [0.034, -0.016],
          [-0.018, -0.016],
          [0.016, -0.108],
          [0.056, -0.106],
        ],
        0.046,
        0.002
      );
      const gripPanels = new THREE.Mesh(gripPanelGeo, stippledGripMat);

      const magwellFlare = new THREE.Mesh(
        new THREE.BoxGeometry(0.048, 0.014, 0.064),
        titaniumMat
      );
      magwellFlare.position.set(0, -0.122, 0.04);
      magwellFlare.rotation.x = 0.22;

      // Ambidextrous Slide Stop Lever & Mag Release Button
      const slideStopLever = new THREE.Mesh(
        new THREE.BoxGeometry(0.048, 0.009, 0.038),
        brushedSteelMat
      );
      slideStopLever.position.set(0, 0.016, -0.025);
      const magReleaseBtn = new THREE.Mesh(
        new THREE.CylinderGeometry(0.006, 0.006, 0.047, 10),
        accentMat
      );
      magReleaseBtn.rotation.z = Math.PI / 2;
      magReleaseBtn.position.set(0, -0.026, -0.004);

      // Under-barrel Tactical Laser/Light Module with Dual Emitter Lenses & Radianite Conduit
      const tacLightBody = new THREE.Mesh(
        new THREE.BoxGeometry(0.038, 0.026, 0.088),
        receiverAlloyMat
      );
      tacLightBody.position.set(0, -0.021, -0.168);
      const tacLightLens = new THREE.Mesh(
        new THREE.CylinderGeometry(0.0095, 0.0095, 0.012, 14),
        radianiteCoreMat
      );
      tacLightLens.rotation.x = Math.PI / 2;
      tacLightLens.position.set(0, -0.019, -0.212);
      const laserDiode = new THREE.Mesh(
        new THREE.CylinderGeometry(0.004, 0.004, 0.014, 10),
        accentMat
      );
      laserDiode.rotation.x = Math.PI / 2;
      laserDiode.position.set(0, -0.03, -0.212);

      // Braided Radianite Power Conduit Tube linking Laser Module to Frame Core
      const pistolConduit = new THREE.Mesh(
        createConduitTubeGeometry(
          [
            [-0.02, -0.022, -0.145],
            [-0.024, -0.008, -0.105],
            [-0.022, 0.012, -0.065],
          ],
          0.0032,
          12,
          8
        ),
        radianiteCoreMat
      );

      // Skeletonized Combat Hammer
      const hammer = new THREE.Mesh(
        new THREE.BoxGeometry(0.01, 0.022, 0.018),
        brushedSteelMat
      );
      hammer.position.set(0, 0.034, 0.052);
      hammer.rotation.x = -0.45;

      // 2. Sculpted Chamfered Upper Slide (Articulated slideOrBoltGroup)
      const slideGeo = createBeveledProfileGeometry(
        [
          [0.055, 0.022],
          [-0.235, 0.022],
          [-0.252, 0.038],
          [-0.238, 0.062],
          [0.042, 0.062],
        ],
        0.046,
        0.0035
      );
      const slideMesh = new THREE.Mesh(slideGeo, gunMetalMat);

      // Exposed Titanium Barrel Hood at the Ejection Port
      const ejectionPort = new THREE.Mesh(
        new THREE.BoxGeometry(0.048, 0.02, 0.058),
        brushedSteelMat
      );
      ejectionPort.position.set(0.002, 0.048, -0.062);

      // Angled Front & Rear Slide Cocking Serrations
      for (let i = 0; i < 5; i++) {
        const rearSerr = new THREE.Mesh(
          new THREE.BoxGeometry(0.049, 0.028, 0.0045),
          darkPolymerMat
        );
        rearSerr.position.set(0, 0.042, 0.022 - i * 0.011);
        rearSerr.rotation.x = 0.22;
        const frontSerr = new THREE.Mesh(
          new THREE.BoxGeometry(0.049, 0.024, 0.0045),
          darkPolymerMat
        );
        frontSerr.position.set(0, 0.04, -0.165 - i * 0.011);
        frontSerr.rotation.x = 0.22;
        slideOrBoltGroup.add(rearSerr, frontSerr);
      }

      // Micro Reflex Red-Dot Plate & 3-Dot Tritium Night Sights on Slide
      const frontSight = new THREE.Mesh(
        new THREE.BoxGeometry(0.008, 0.014, 0.016),
        tritiumSightMat
      );
      frontSight.position.set(0, 0.068, -0.225);
      const rearSightL = new THREE.Mesh(
        new THREE.BoxGeometry(0.011, 0.013, 0.014),
        tritiumSightMat
      );
      rearSightL.position.set(-0.012, 0.068, 0.032);
      const rearSightR = new THREE.Mesh(
        new THREE.BoxGeometry(0.011, 0.013, 0.014),
        tritiumSightMat
      );
      rearSightR.position.set(0.012, 0.068, 0.032);
      const slideBackplate = new THREE.Mesh(
        new THREE.BoxGeometry(0.028, 0.026, 0.006),
        accentMat
      );
      slideBackplate.position.set(0, 0.042, 0.052);

      slideOrBoltGroup.add(
        slideMesh,
        ejectionPort,
        frontSight,
        rearSightL,
        rearSightR,
        slideBackplate
      );

      // Lathe-Contoured Match Barrel & Stepped Multi-Port Compensator
      const latheBarrel = new THREE.Mesh(
        createLatheZGeometry(
          [
            [0.011, -0.285],
            [0.018, -0.28],
            [0.021, -0.27],
            [0.016, -0.25],
            [0.021, -0.242],
            [0.012, -0.232],
            [0.0115, 0.02],
          ],
          18
        ),
        brushedSteelMat
      );
      latheBarrel.position.set(0, 0.042, 0);

      const compensator = new THREE.Mesh(
        new THREE.CylinderGeometry(0.022, 0.024, 0.052, 6),
        titaniumMat
      );
      compensator.rotation.x = Math.PI / 2;
      compensator.position.set(0, 0.041, -0.26);

      const accentLine = new THREE.Mesh(
        new THREE.BoxGeometry(0.048, 0.005, 0.21),
        accentMat
      );
      accentLine.position.set(0, 0.023, -0.09);

      // 3. Detachable 12-Round Magazine with Brass Top Cartridge & Witness Windows
      const magBody = new THREE.Mesh(
        new THREE.BoxGeometry(0.034, 0.125, 0.048),
        brushedSteelMat
      );
      magBody.position.set(0, -0.065, 0.024);
      magBody.rotation.x = 0.22;
      const magPad = new THREE.Mesh(
        new THREE.BoxGeometry(0.044, 0.016, 0.062),
        accentMat
      );
      magPad.position.set(0, -0.132, 0.04);
      magPad.rotation.x = 0.22;
      const topCartridge = new THREE.Mesh(
        new THREE.CylinderGeometry(0.005, 0.005, 0.022, 8),
        brassMat
      );
      topCartridge.rotation.x = Math.PI / 2;
      topCartridge.position.set(0, 0.002, 0.008);
      magGroup.add(magBody, magPad, topCartridge);

      g.add(
        frameMesh,
        gripPanels,
        magwellFlare,
        slideStopLever,
        magReleaseBtn,
        tacLightBody,
        tacLightLens,
        laserDiode,
        pistolConduit,
        hammer,
        latheBarrel,
        compensator,
        accentLine,
        createCurvedTriggerAndGuard(-0.012, -0.012)
      );
    } else if (id === 'smg') {
      // ======================================================================
      // SPECTRE-VX // SILENCED VECTOR-STYLE TACTICAL SMG
      // ======================================================================
      // 1. Sculpted Upper Receiver & Angled Kriss-Vector Forward Magwell
      const upperGeo = createBeveledProfileGeometry(
        [
          [0.09, 0.015],
          [-0.31, 0.015],
          [-0.33, 0.052],
          [-0.29, 0.068],
          [0.075, 0.068],
        ],
        0.056,
        0.0035
      );
      const upperMesh = new THREE.Mesh(upperGeo, gunMetalMat);

      const vectorLowerGeo = createBeveledProfileGeometry(
        [
          [0.065, 0.015],
          [-0.24, 0.015],
          [-0.21, -0.075],
          [-0.14, -0.075],
          [-0.11, -0.015],
          [-0.02, -0.015],
          [0.018, -0.115],
          [0.065, -0.112],
          [0.042, -0.01],
        ],
        0.05,
        0.003
      );
      const lowerMesh = new THREE.Mesh(vectorLowerGeo, darkPolymerMat);

      // Vented Octagonal Barrel Shroud with 4 Cooling Slots
      const shroud = new THREE.Mesh(
        new THREE.CylinderGeometry(0.032, 0.032, 0.16, 8),
        titaniumMat
      );
      shroud.rotation.x = Math.PI / 2;
      shroud.position.set(0, 0.038, -0.28);
      for (let i = 0; i < 4; i++) {
        const vent = new THREE.Mesh(
          new THREE.BoxGeometry(0.068, 0.01, 0.02),
          darkPolymerMat
        );
        vent.position.set(0, 0.042, -0.22 - i * 0.032);
        g.add(vent);
      }

      // Lathe-Contoured Multi-Baffle Tactical Suppressor with Stepped Expansion Chambers
      const suppressorLathe = new THREE.Mesh(
        createLatheZGeometry(
          [
            [0.012, -0.58],
            [0.024, -0.575],
            [0.024, -0.51],
            [0.021, -0.505],
            [0.025, -0.495],
            [0.025, -0.43],
            [0.021, -0.425],
            [0.026, -0.415],
            [0.026, -0.34],
            [0.019, -0.32],
          ],
          20
        ),
        darkPolymerMat
      );
      suppressorLathe.position.set(0, 0.038, 0);
      for (let i = 0; i < 4; i++) {
        const heatRing = new THREE.Mesh(
          new THREE.CylinderGeometry(0.0265, 0.0265, 0.01, 18),
          i === 0 ? accentMat : titaniumMat
        );
        heatRing.rotation.x = Math.PI / 2;
        heatRing.position.set(0, 0.038, -0.36 - i * 0.052);
        g.add(heatRing);
      }

      // Side-Mounted Tactical PEQ Laser Box on Right Rail + Braided Plasma Conduit
      const peqBox = new THREE.Mesh(
        new THREE.BoxGeometry(0.022, 0.032, 0.078),
        receiverAlloyMat
      );
      peqBox.position.set(0.036, 0.042, -0.23);
      const peqEmitter = new THREE.Mesh(
        new THREE.CylinderGeometry(0.005, 0.005, 0.012, 10),
        radianiteCoreMat
      );
      peqEmitter.rotation.x = Math.PI / 2;
      peqEmitter.position.set(0.038, 0.046, -0.272);

      const smgConduit = new THREE.Mesh(
        createConduitTubeGeometry(
          [
            [0.028, -0.035, -0.16],
            [0.034, 0.005, -0.19],
            [0.036, 0.036, -0.21],
          ],
          0.0038,
          14,
          8
        ),
        radianiteCoreMat
      );

      // Reciprocating Side-Folding Charging Handle & Bolt Carrier
      const boltCarrier = new THREE.Mesh(
        new THREE.BoxGeometry(0.058, 0.022, 0.082),
        brushedSteelMat
      );
      boltCarrier.position.set(0, 0.044, -0.12);
      const chargingKnob = new THREE.Mesh(
        new THREE.CylinderGeometry(0.008, 0.008, 0.044, 8),
        accentMat
      );
      chargingKnob.rotation.z = Math.PI / 2;
      chargingKnob.position.set(-0.042, 0.046, -0.14);
      slideOrBoltGroup.add(boltCarrier, chargingKnob);

      // Top Picatinny Rail & Panoramic Holo Sight
      const topRail = createPicatinnyRail(0.36, 12, 0.07, -0.1);
      const sight = createPanoramicHoloSight(0.074, -0.07);

      // Angled CQB Foregrip
      const foregripGeo = createBeveledProfileGeometry(
        [
          [-0.24, -0.01],
          [-0.31, -0.01],
          [-0.29, -0.085],
          [-0.255, -0.085],
        ],
        0.032,
        0.002
      );
      const foregrip = new THREE.Mesh(foregripGeo, stippledGripMat);

      // Dual-Strut Skeletonized Folding Stock
      const strutTop = new THREE.Mesh(
        new THREE.CylinderGeometry(0.007, 0.007, 0.21, 8),
        titaniumMat
      );
      strutTop.rotation.x = Math.PI / 2;
      strutTop.position.set(0, 0.042, 0.175);
      const strutBot = new THREE.Mesh(
        new THREE.CylinderGeometry(0.006, 0.006, 0.21, 8),
        titaniumMat
      );
      strutBot.rotation.x = Math.PI / 2 + 0.14;
      strutBot.position.set(0, 0.005, 0.175);
      const buttPad = new THREE.Mesh(
        new THREE.BoxGeometry(0.048, 0.11, 0.026),
        stippledGripMat
      );
      buttPad.position.set(0, 0.012, 0.28);

      const coreVein = new THREE.Mesh(
        new THREE.BoxGeometry(0.06, 0.007, 0.28),
        radianiteCoreMat
      );
      coreVein.position.set(0, 0.036, -0.12);

      // Detachable Extended 30-Round Ribbed Magazine
      const magBody = new THREE.Mesh(
        new THREE.BoxGeometry(0.034, 0.19, 0.046),
        receiverAlloyMat
      );
      magBody.position.set(0, -0.125, -0.178);
      magBody.rotation.x = -0.22;
      const magBase = new THREE.Mesh(
        new THREE.BoxGeometry(0.04, 0.022, 0.054),
        accentMat
      );
      magBase.position.set(0, -0.22, -0.2);
      magBase.rotation.x = -0.22;
      const magWindow = new THREE.Mesh(
        new THREE.BoxGeometry(0.036, 0.12, 0.012),
        radianiteCoreMat
      );
      magWindow.position.set(0, -0.125, -0.178);
      magWindow.rotation.x = -0.22;
      magGroup.add(magBody, magBase, magWindow);

      g.add(
        upperMesh,
        lowerMesh,
        shroud,
        suppressorLathe,
        peqBox,
        peqEmitter,
        smgConduit,
        topRail,
        sight,
        foregrip,
        strutTop,
        strutBot,
        buttPad,
        coreVein,
        createCurvedTriggerAndGuard(-0.014, -0.025)
      );
    } else if (id === 'shotgun') {
      // ======================================================================
      // JUDGE-12 // HEAVY COMBAT AUTO-SHOTGUN WITH ROTARY DRUM
      // ======================================================================
      // 1. Chamfered Heavy Combat Receiver
      const receiverGeo = createBeveledProfileGeometry(
        [
          [0.09, -0.018],
          [-0.24, -0.018],
          [-0.26, 0.065],
          [0.06, 0.065],
        ],
        0.066,
        0.004
      );
      const receiver = new THREE.Mesh(receiverGeo, gunMetalMat);

      // Lathe-Contoured Heavy Combat Barrel & Integrated Door-Breacher Choke
      const upperBarrel = new THREE.Mesh(
        createLatheZGeometry(
          [
            [0.016, -0.68],
            [0.028, -0.675],
            [0.025, -0.61],
            [0.019, -0.59],
            [0.021, -0.22],
            [0.023, -0.05],
          ],
          18
        ),
        brushedSteelMat
      );
      upperBarrel.position.set(0, 0.046, 0);

      const lowerTube = new THREE.Mesh(
        new THREE.CylinderGeometry(0.016, 0.016, 0.5, 14),
        titaniumMat
      );
      lowerTube.rotation.x = Math.PI / 2;
      lowerTube.position.set(0, 0.008, -0.32);

      // Barrel Clamp Bracket linking Upper Barrel & Lower Gas Tube
      const barrelClamp = new THREE.Mesh(
        new THREE.BoxGeometry(0.044, 0.068, 0.028),
        gunMetalMat
      );
      barrelClamp.position.set(0, 0.027, -0.52);

      // Perforated Upper Barrel Heat-Shield with 6 Vent Ports
      const heatShield = new THREE.Mesh(
        new THREE.BoxGeometry(0.046, 0.022, 0.36),
        darkPolymerMat
      );
      heatShield.position.set(0, 0.062, -0.36);
      for (let i = 0; i < 6; i++) {
        const port = new THREE.Mesh(
          new THREE.BoxGeometry(0.05, 0.008, 0.032),
          titaniumMat
        );
        port.position.set(0, 0.064, -0.21 - i * 0.054);
        g.add(port);
      }

      // Braided Hydraulic Recoil-Dampening Conduit Tube along Receiver
      const shotgunConduit = new THREE.Mesh(
        createConduitTubeGeometry(
          [
            [-0.035, 0.018, 0.04],
            [-0.038, 0.022, -0.12],
            [-0.032, 0.012, -0.25],
          ],
          0.0042,
          14,
          8
        ),
        radianiteCoreMat
      );

      // Articulated Ribbed Pump-Action Forend & Chrome Bolt Carrier
      const pumpGeo = createBeveledProfileGeometry(
        [
          [-0.25, 0.012],
          [-0.46, 0.012],
          [-0.44, -0.034],
          [-0.27, -0.034],
        ],
        0.064,
        0.003
      );
      const pumpHandle = new THREE.Mesh(pumpGeo, stippledGripMat);
      const pumpAccent = new THREE.Mesh(
        new THREE.BoxGeometry(0.068, 0.008, 0.16),
        accentMat
      );
      pumpAccent.position.set(0, -0.01, -0.355);
      const ejectionBolt = new THREE.Mesh(
        new THREE.BoxGeometry(0.07, 0.026, 0.095),
        brushedSteelMat
      );
      ejectionBolt.position.set(0.002, 0.038, -0.11);
      slideOrBoltGroup.add(pumpHandle, pumpAccent, ejectionBolt);

      // Side-Saddle 5-Shell Tactical Carrier (Glowing Radianite Buckshot Shells)
      const shellCarrier = new THREE.Group();
      for (let i = 0; i < 5; i++) {
        const shellHull = new THREE.Mesh(
          new THREE.CylinderGeometry(0.0085, 0.0085, 0.042, 10),
          radianiteCoreMat
        );
        shellHull.position.set(0.039, 0.024, -0.04 - i * 0.032);
        const shellBrass = new THREE.Mesh(
          new THREE.CylinderGeometry(0.009, 0.009, 0.014, 10),
          brassMat
        );
        shellBrass.position.set(0.039, 0.002, -0.04 - i * 0.032);
        shellCarrier.add(shellHull, shellBrass);
      }

      // Detachable Cylindrical Rotary Drum Magazine (`magGroup`) with Radial Reinforcement Ribs
      const drumCylinder = new THREE.Mesh(
        new THREE.CylinderGeometry(0.072, 0.072, 0.068, 20),
        darkPolymerMat
      );
      drumCylinder.rotation.x = Math.PI / 2;
      drumCylinder.position.set(0, -0.078, -0.155);
      const drumHub = new THREE.Mesh(
        new THREE.CylinderGeometry(0.026, 0.026, 0.074, 14),
        accentMat
      );
      drumHub.rotation.x = Math.PI / 2;
      drumHub.position.set(0, -0.078, -0.155);
      const drumCoreRing = new THREE.Mesh(
        new THREE.TorusGeometry(0.048, 0.004, 8, 20),
        radianiteCoreMat
      );
      drumCoreRing.position.set(0, -0.078, -0.19);
      const drumNeck = new THREE.Mesh(
        new THREE.BoxGeometry(0.042, 0.055, 0.058),
        titaniumMat
      );
      drumNeck.position.set(0, -0.025, -0.155);
      magGroup.add(drumCylinder, drumHub, drumCoreRing, drumNeck);

      // Top Rail, Ghost-Ring Iron Sight, Front Fiber-Optic Blade & Shock-Absorbing Tactical Stock
      const topRail = createPicatinnyRail(0.3, 9, 0.069, -0.08);
      const ghostRingRear = new THREE.Mesh(
        new THREE.TorusGeometry(0.012, 0.0025, 8, 16),
        titaniumMat
      );
      ghostRingRear.position.set(0, 0.084, 0.035);
      const frontBladeSight = new THREE.Mesh(
        new THREE.BoxGeometry(0.006, 0.018, 0.018),
        tritiumSightMat
      );
      frontBladeSight.position.set(0, 0.076, -0.58);

      const stockGeo = createBeveledProfileGeometry(
        [
          [0.06, 0.045],
          [0.09, -0.018],
          [0.02, -0.115],
          [0.068, -0.115],
          [0.105, -0.025],
          [0.28, -0.045],
          [0.28, 0.042],
        ],
        0.054,
        0.003
      );
      const stock = new THREE.Mesh(stockGeo, darkPolymerMat);

      g.add(
        receiver,
        upperBarrel,
        lowerTube,
        barrelClamp,
        heatShield,
        shotgunConduit,
        shellCarrier,
        topRail,
        ghostRingRear,
        frontBladeSight,
        stock,
        createCurvedTriggerAndGuard(-0.018, 0.03)
      );
    } else if (id === 'rifle') {
      // ======================================================================
      // VANDAL-AR // SCULPTED HEAVY ASSAULT RIFLE (Flagship Model)
      // ======================================================================
      // 1. Chamfered Upper Receiver (ExtrudeGeometry with angled front/rear facets)
      const upperGeo = createBeveledProfileGeometry(
        [
          [0.085, 0.012],
          [-0.285, 0.012],
          [-0.305, 0.068],
          [0.065, 0.068],
        ],
        0.058,
        0.0035
      );
      const upperReceiver = new THREE.Mesh(upperGeo, gunMetalMat);

      // 2. Sculpted Lower Receiver with Flared Magwell & Integrated Pistol Grip
      const lowerGeo = createBeveledProfileGeometry(
        [
          [0.085, 0.012],
          [-0.265, 0.012],
          [-0.245, -0.045],
          [-0.145, -0.045],
          [-0.125, -0.015],
          [-0.035, -0.015],
          [0.015, -0.128],
          [0.068, -0.124],
          [0.038, -0.012],
        ],
        0.052,
        0.003
      );
      const lowerReceiver = new THREE.Mesh(lowerGeo, receiverAlloyMat);

      const gripOverlayGeo = createBeveledProfileGeometry(
        [
          [0.032, -0.022],
          [-0.025, -0.022],
          [0.018, -0.118],
          [0.062, -0.115],
        ],
        0.056,
        0.002
      );
      const gripOverlay = new THREE.Mesh(gripOverlayGeo, stippledGripMat);

      // Ambidextrous Fire-Selector Switch & Forward Assist Plunger
      const fireSelector = new THREE.Mesh(
        new THREE.BoxGeometry(0.06, 0.008, 0.022),
        accentMat
      );
      fireSelector.position.set(0, 0.004, 0.025);
      fireSelector.rotation.x = 0.35;

      // 3. Octagonal Vented M-LOK Handguard with 5 Cooling Cutouts & Exposed Gas System
      const handguardGeo = createBeveledProfileGeometry(
        [
          [-0.285, 0.004],
          [-0.625, 0.008],
          [-0.645, 0.062],
          [-0.285, 0.066],
        ],
        0.052,
        0.003
      );
      const handguard = new THREE.Mesh(handguardGeo, titaniumMat);

      // M-LOK Ventilation Slots along the Handguard Sides
      for (let i = 0; i < 5; i++) {
        const slot = new THREE.Mesh(
          new THREE.BoxGeometry(0.056, 0.014, 0.042),
          stippledGripMat
        );
        slot.position.set(0, 0.036, -0.335 - i * 0.058);
        g.add(slot);
      }

      // Stainless Steel Gas Block, Lathe-Contoured Match Barrel & 3-Chamber Muzzle Brake
      const gasBlock = new THREE.Mesh(
        new THREE.BoxGeometry(0.034, 0.048, 0.052),
        gunMetalMat
      );
      gasBlock.position.set(0, 0.042, -0.65);

      const barrelLathe = new THREE.Mesh(
        createLatheZGeometry(
          [
            [0.012, -0.86],
            [0.022, -0.855],
            [0.022, -0.78],
            [0.016, -0.77],
            [0.021, -0.755],
            [0.015, -0.74],
            [0.015, -0.58],
            [0.018, -0.32],
          ],
          20
        ),
        brushedSteelMat
      );
      barrelLathe.position.set(0, 0.036, 0);

      // External Braided Radianite Energy Conduit curving from Receiver into Handguard
      const rifleConduit = new THREE.Mesh(
        createConduitTubeGeometry(
          [
            [0.031, 0.02, -0.18],
            [0.034, 0.026, -0.34],
            [0.029, 0.034, -0.54],
          ],
          0.004,
          16,
          8
        ),
        radianiteCoreMat
      );

      // 4. Reciprocating Chrome Bolt Carrier & Ambidextrous Charging Handle
      const boltCarrier = new THREE.Mesh(
        new THREE.BoxGeometry(0.062, 0.024, 0.105),
        brushedSteelMat
      );
      boltCarrier.position.set(0.002, 0.042, -0.11);
      const chargingHandle = new THREE.Mesh(
        new THREE.BoxGeometry(0.046, 0.012, 0.022),
        accentMat
      );
      chargingHandle.position.set(-0.04, 0.045, -0.145);
      slideOrBoltGroup.add(boltCarrier, chargingHandle);

      // 5. Full-Length Picatinny Rail, Panoramic Holo Sight, Laser Box & Rear Status Indicator
      const topRail = createPicatinnyRail(0.62, 18, 0.072, -0.25);
      const sight = createPanoramicHoloSight(0.076, -0.11);

      const frontLaserBox = new THREE.Mesh(
        new THREE.BoxGeometry(0.036, 0.018, 0.072),
        darkPolymerMat
      );
      frontLaserBox.position.set(0, 0.082, -0.52);
      const frontLaserLens = new THREE.Mesh(
        new THREE.CylinderGeometry(0.005, 0.005, 0.01, 10),
        accentMat
      );
      frontLaserLens.rotation.x = Math.PI / 2;
      frontLaserLens.position.set(0.01, 0.082, -0.558);

      const rearStatusLed = new THREE.Mesh(
        new THREE.BoxGeometry(0.026, 0.01, 0.008),
        tritiumSightMat
      );
      rearStatusLed.position.set(0, 0.054, 0.084);

      // 6. Detachable Curved 25-Round Ribbed Waffle Magazine (`magGroup`)
      const magGeo = createBeveledProfileGeometry(
        [
          [-0.155, -0.02],
          [-0.235, -0.02],
          [-0.275, -0.215],
          [-0.192, -0.225],
        ],
        0.038,
        0.0025
      );
      const magBody = new THREE.Mesh(magGeo, darkPolymerMat);
      for (let r = 0; r < 4; r++) {
        const rib = new THREE.Mesh(
          new THREE.BoxGeometry(0.042, 0.008, 0.072),
          r === 3 ? accentMat : titaniumMat
        );
        rib.position.set(0, -0.075 - r * 0.036, -0.202 - r * 0.008);
        rib.rotation.x = -0.22;
        magGroup.add(rib);
      }
      const magBrassRound = new THREE.Mesh(
        new THREE.CylinderGeometry(0.0055, 0.0055, 0.036, 8),
        brassMat
      );
      magBrassRound.rotation.x = Math.PI / 2;
      magBrassRound.position.set(0, -0.015, -0.195);
      magGroup.add(magBody, magBrassRound);

      // 7. Skeletonized Tactical Buttstock with Cheek Riser & Rubber Recoil Pad
      const stockGeo = createBeveledProfileGeometry(
        [
          [0.065, 0.062],
          [0.275, 0.056],
          [0.275, -0.052],
          [0.235, -0.052],
          [0.085, 0.008],
        ],
        0.048,
        0.003
      );
      const stockMesh = new THREE.Mesh(stockGeo, darkPolymerMat);
      const recoilPad = new THREE.Mesh(
        new THREE.BoxGeometry(0.052, 0.112, 0.022),
        stippledGripMat
      );
      recoilPad.position.set(0, 0.002, 0.284);

      // Sleek Operative Accent Trim & Subtle Radianite Energy Conduit
      const accentTrim = new THREE.Mesh(
        new THREE.BoxGeometry(0.062, 0.008, 0.44),
        accentMat
      );
      accentTrim.position.set(0, 0.038, -0.24);

      const radianiteConduit = new THREE.Mesh(
        new THREE.BoxGeometry(0.056, 0.006, 0.26),
        radianiteCoreMat
      );
      radianiteConduit.position.set(0, 0.02, -0.45);

      g.add(
        upperReceiver,
        lowerReceiver,
        gripOverlay,
        fireSelector,
        handguard,
        gasBlock,
        barrelLathe,
        rifleConduit,
        topRail,
        sight,
        frontLaserBox,
        frontLaserLens,
        rearStatusLed,
        stockMesh,
        recoilPad,
        accentTrim,
        radianiteConduit,
        createCurvedTriggerAndGuard(-0.015, -0.015)
      );
    } else {
      // ======================================================================
      // OPERATOR-SR // ANTI-MATERIEL FLUTED SNIPER RIFLE
      // ======================================================================
      // 1. Sculpted Precision Chassis & Thumbhole Buttstock (ExtrudeGeometry)
      const chassisGeo = createBeveledProfileGeometry(
        [
          [0.28, 0.055],
          [0.28, -0.055],
          [0.22, -0.055],
          [0.08, -0.01],
          [0.055, -0.12],
          [0.01, -0.12],
          [-0.025, -0.025],
          [-0.52, -0.015],
          [-0.55, 0.065],
          [0.08, 0.068],
        ],
        0.064,
        0.004
      );
      const chassis = new THREE.Mesh(chassisGeo, gunMetalMat);

      const cheekRiser = new THREE.Mesh(
        new THREE.BoxGeometry(0.056, 0.032, 0.16),
        stippledGripMat
      );
      cheekRiser.position.set(0, 0.068, 0.18);

      const radianiteCore = new THREE.Mesh(
        new THREE.BoxGeometry(0.068, 0.01, 0.46),
        radianiteCoreMat
      );
      radianiteCore.position.set(0, 0.034, -0.24);

      // High-Voltage Radianite Capacitor Tube curving along the Sniper Chassis
      const sniperConduit = new THREE.Mesh(
        createConduitTubeGeometry(
          [
            [-0.035, 0.015, 0.02],
            [-0.038, 0.028, -0.22],
            [-0.034, 0.038, -0.48],
          ],
          0.0048,
          16,
          8
        ),
        radianiteCoreMat
      );

      // 2. Lathe-Contoured Heavy Fluted Match Barrel & Arrowhead 3-Port Tank Muzzle Brake
      const heavyBarrel = new THREE.Mesh(
        createLatheZGeometry(
          [
            [0.017, -0.96],
            [0.019, -0.78],
            [0.016, -0.76],
            [0.02, -0.6],
            [0.017, -0.58],
            [0.022, -0.4],
            [0.024, -0.25],
          ],
          20
        ),
        brushedSteelMat
      );
      heavyBarrel.position.set(0, 0.042, 0);

      const muzzleBrakeGeo = createBeveledProfileGeometry(
        [
          [-0.93, 0.018],
          [-1.04, 0.014],
          [-1.06, 0.068],
          [-0.93, 0.065],
        ],
        0.064,
        0.0025
      );
      const muzzleBrake = new THREE.Mesh(muzzleBrakeGeo, darkPolymerMat);

      // 3. Folding Spring-Loaded Tactical Bipod with Articulated Ski Feet
      const bipodLeft = new THREE.Mesh(
        new THREE.CylinderGeometry(0.007, 0.007, 0.24, 8),
        titaniumMat
      );
      bipodLeft.rotation.x = Math.PI / 2;
      bipodLeft.position.set(-0.034, -0.012, -0.52);
      const bipodRight = new THREE.Mesh(
        new THREE.CylinderGeometry(0.007, 0.007, 0.24, 8),
        titaniumMat
      );
      bipodRight.rotation.x = Math.PI / 2;
      bipodRight.position.set(0.034, -0.012, -0.52);

      // 4. Lathe-Contoured Variable Zoom Sniper Optic with Objective/Ocular Bells & Turrets
      const scopeRail = createPicatinnyRail(0.38, 12, 0.074, -0.18);
      const unifiedScopeBody = new THREE.Mesh(
        createLatheZGeometry(
          [
            [0.036, -0.43],
            [0.036, -0.35],
            [0.022, -0.29],
            [0.022, -0.05],
            [0.029, 0.01],
            [0.029, 0.055],
          ],
          24
        ),
        gunMetalMat
      );
      unifiedScopeBody.position.set(0, 0.118, 0);

      const frontLens = new THREE.Mesh(new THREE.CircleGeometry(0.032, 18), opticLensMat);
      frontLens.position.set(0, 0.118, -0.431);
      const rearLens = new THREE.Mesh(new THREE.CircleGeometry(0.025, 16), opticLensMat);
      rearLens.position.set(0, 0.118, 0.056);

      const elevationTurret = new THREE.Mesh(
        new THREE.CylinderGeometry(0.014, 0.014, 0.026, 14),
        accentMat
      );
      elevationTurret.position.set(0, 0.146, -0.18);

      const windageTurret = new THREE.Mesh(
        new THREE.CylinderGeometry(0.013, 0.013, 0.024, 14),
        titaniumMat
      );
      windageTurret.rotation.z = Math.PI / 2;
      windageTurret.position.set(0.028, 0.118, -0.18);

      const scopeRing1 = new THREE.Mesh(
        new THREE.CylinderGeometry(0.03, 0.03, 0.03, 16),
        accentMat
      );
      scopeRing1.rotation.x = Math.PI / 2;
      scopeRing1.position.set(0, 0.118, -0.26);
      const scopeRing2 = new THREE.Mesh(
        new THREE.CylinderGeometry(0.03, 0.03, 0.03, 16),
        accentMat
      );
      scopeRing2.rotation.x = Math.PI / 2;
      scopeRing2.position.set(0, 0.118, -0.09);

      // 5. Reciprocating Fluted Sniper Bolt & Oversized Tactical Bolt Knob
      const boltBody = new THREE.Mesh(
        new THREE.BoxGeometry(0.068, 0.026, 0.12),
        brushedSteelMat
      );
      boltBody.position.set(0, 0.044, -0.07);
      const boltStem = new THREE.Mesh(
        new THREE.CylinderGeometry(0.006, 0.006, 0.052, 8),
        brushedSteelMat
      );
      boltStem.rotation.z = Math.PI / 2;
      boltStem.position.set(0.044, 0.044, -0.05);
      const boltKnob = new THREE.Mesh(
        new THREE.SphereGeometry(0.013, 12, 12),
        stippledGripMat
      );
      boltKnob.position.set(0.068, 0.044, -0.05);
      slideOrBoltGroup.add(boltBody, boltStem, boltKnob);

      // 6. Detachable 5-Round Heavy Box Magazine (`magGroup`)
      const mag = new THREE.Mesh(
        new THREE.BoxGeometry(0.048, 0.14, 0.115),
        receiverAlloyMat
      );
      mag.position.set(0, -0.075, -0.2);
      const magPad = new THREE.Mesh(
        new THREE.BoxGeometry(0.054, 0.02, 0.125),
        accentMat
      );
      magPad.position.set(0, -0.148, -0.2);
      magGroup.add(mag, magPad);

      g.add(
        chassis,
        cheekRiser,
        radianiteCore,
        sniperConduit,
        heavyBarrel,
        muzzleBrake,
        bipodLeft,
        bipodRight,
        scopeRail,
        unifiedScopeBody,
        frontLens,
        rearLens,
        elevationTurret,
        windageTurret,
        scopeRing1,
        scopeRing2,
        createCurvedTriggerAndGuard(-0.02, -0.01)
      );
    }

    return { group: g, magGroup, slideOrBoltGroup };
  };

  const partsByWeapon: Record<WeaponId, ArticulatedWeaponParts> = {
    pistol: buildWeaponParts('pistol'),
    smg: buildWeaponParts('smg'),
    shotgun: buildWeaponParts('shotgun'),
    rifle: buildWeaponParts('rifle'),
    sniper: buildWeaponParts('sniper'),
  };

  const weaponGroups: Record<WeaponId, THREE.Group> = {
    pistol: partsByWeapon.pistol.group,
    smg: partsByWeapon.smg.group,
    shotgun: partsByWeapon.shotgun.group,
    rifle: partsByWeapon.rifle.group,
    sniper: partsByWeapon.sniper.group,
  };

  let currentWeaponId: WeaponId = 'pistol';

  (Object.keys(weaponGroups) as WeaponId[]).forEach((id) => {
    weaponGroups[id].visible = id === 'pistol';
    inspectPivot.add(weaponGroups[id]);
  });

  // ==========================================================================
  // HELPER: SMOOTH SINGLE-CAPSULE PHALANX & UNIFIED TACTICAL GLOVE BUILDER
  // ==========================================================================
  const _upAxis = new THREE.Vector3(0, 1, 0);
  const _zAxis = new THREE.Vector3(0, 0, 1);
  const _segDir = new THREE.Vector3();
  const _segMid = new THREE.Vector3();

  // Creates a single smooth, seamless CapsuleGeometry between p1 and p2 (zero protruding balls)
  const createSmoothCapsuleSegment = (
    p1: [number, number, number],
    p2: [number, number, number],
    radius: number,
    mat: THREE.Material
  ): THREE.Mesh => {
    const v1 = new THREE.Vector3(p1[0], p1[1], p1[2]);
    const v2 = new THREE.Vector3(p2[0], p2[1], p2[2]);
    _segDir.subVectors(v2, v1);
    const len = Math.max(0.001, _segDir.length());
    _segMid.addVectors(v1, v2).multiplyScalar(0.5);
    const mesh = new THREE.Mesh(
      new THREE.CapsuleGeometry(radius, len, 8, 14),
      mat
    );
    mesh.position.copy(_segMid);
    mesh.quaternion.setFromUnitVectors(_upAxis, _segDir.normalize());
    return mesh;
  };

  // Builds a smooth, natural 2-segment gloved finger with carbon-fiber knuckle guard
  const createSmoothGloveFinger = (
    mcp: [number, number, number],
    pip: [number, number, number],
    tip: [number, number, number],
    radius: number
  ): THREE.Group => {
    const fg = new THREE.Group();
    fg.add(
      createSmoothCapsuleSegment(mcp, pip, radius, gloveLeatherMat),
      createSmoothCapsuleSegment(pip, tip, radius * 0.9, glovePalmGripMat)
    );
    const knuckleGuard = new THREE.Mesh(
      new THREE.SphereGeometry(radius * 0.96, 8, 8),
      carbonKnuckleMat
    );
    knuckleGuard.scale.set(1.0, 0.65, 1.0);
    knuckleGuard.position.set(mcp[0], mcp[1], mcp[2]);
    fg.add(knuckleGuard);
    return fg;
  };

  // ==========================================================================
  // HELPER: COAXIAL TAPERED FOREARM SLEEVE, CUFF & HOLOGRAPHIC CHRONO-WATCH
  // ==========================================================================
  const createCoaxialForearm = (
    wristPos: [number, number, number],
    elbowPos: [number, number, number],
    isLeft: boolean
  ): THREE.Group => {
    const armWrapper = new THREE.Group();
    const vWrist = new THREE.Vector3(wristPos[0], wristPos[1], wristPos[2]);
    const vElbow = new THREE.Vector3(elbowPos[0], elbowPos[1], elbowPos[2]);
    const dir = new THREE.Vector3().subVectors(vElbow, vWrist);
    const totalLen = dir.length();

    // Orient armCore so its local +Z axis points directly from Wrist (z=0) to Elbow (z=totalLen)
    const armCore = new THREE.Group();
    armCore.position.copy(vWrist);
    armCore.quaternion.setFromUnitVectors(_zAxis, dir.normalize());

    // 1. Fitted Neoprene Tactical Glove Wrist Cuff (z = -0.006 to +0.038)
    const wristCuff = new THREE.Mesh(
      new THREE.CylinderGeometry(0.025, 0.022, 0.046, 16),
      sleeveRibMat
    );
    wristCuff.rotation.x = Math.PI / 2;
    wristCuff.scale.set(1.16, 0.86, 1.0);
    wristCuff.position.set(0, 0, 0.016);
    armCore.add(wristCuff);

    // Velcro Wrist Strap & Compact Accent Tag at the Cuff
    const velcroStrap = new THREE.Mesh(
      new THREE.CylinderGeometry(0.026, 0.025, 0.015, 16),
      carbonKnuckleMat
    );
    velcroStrap.rotation.x = Math.PI / 2;
    velcroStrap.scale.set(1.16, 0.87, 1.0);
    velcroStrap.position.set(0, 0, 0.024);
    armCore.add(velcroStrap);

    const cuffAccentTag = new THREE.Mesh(
      new THREE.BoxGeometry(0.009, 0.004, 0.02),
      accentMat
    );
    cuffAccentTag.position.set(isLeft ? 0.019 : -0.019, 0.017, 0.024);
    armCore.add(cuffAccentTag);

    // 2. Lathe-Contoured Muscular Ripstop Combat Jacket Sleeve with Rolled Cuff Folds
    const sleeveLen = Math.max(0.36, totalLen - 0.024);
    const sleeveMesh = new THREE.Mesh(
      createLatheZGeometry(
        [
          [0.025, 0.024],
          [0.031, 0.065],
          [0.039, 0.14],
          [0.044, 0.24],
          [0.042, 0.26],
          [0.047, 0.32],
          [0.049, 0.024 + sleeveLen],
        ],
        18
      ),
      sleeveFabricMat
    );
    sleeveMesh.scale.set(1.14, 0.88, 1.0);
    armCore.add(sleeveMesh);

    // 3. Sculpted Carbon-Fiber Forearm Vambrace Plate + Accent Conduit Strip
    const vambrace = new THREE.Mesh(
      new THREE.CylinderGeometry(0.038, 0.029, 0.14, 14, 1, false, -0.85, 1.7),
      carbonKnuckleMat
    );
    vambrace.rotation.x = Math.PI / 2;
    vambrace.scale.set(1.14, 0.9, 1.0);
    vambrace.position.set(0, 0.003, 0.125);
    armCore.add(vambrace);

    const vambraceStripe = new THREE.Mesh(
      new THREE.BoxGeometry(0.008, 0.004, 0.11),
      accentMat
    );
    vambraceStripe.position.set(isLeft ? 0.018 : -0.018, 0.028, 0.125);
    armCore.add(vambraceStripe);

    // 4. Coaxial Tactical Chrono-Watch on the Left Wrist (flush on upper-inner wrist)
    if (isLeft) {
      const watchStrap = new THREE.Mesh(
        new THREE.CylinderGeometry(0.027, 0.026, 0.016, 16),
        glovePalmGripMat
      );
      watchStrap.rotation.x = Math.PI / 2;
      watchStrap.scale.set(1.15, 0.87, 1.0);
      watchStrap.position.set(0, 0, 0.046);
      armCore.add(watchStrap);

      const watchHead = new THREE.Group();
      watchHead.position.set(0.012, 0.019, 0.046);
      watchHead.rotation.z = -0.45;

      const watchCase = new THREE.Mesh(
        new THREE.CylinderGeometry(0.013, 0.0145, 0.0055, 16),
        darkPolymerMat
      );
      const watchBezel = new THREE.Mesh(
        new THREE.TorusGeometry(0.0125, 0.0016, 8, 20),
        brushedSteelMat
      );
      watchBezel.rotation.x = Math.PI / 2;
      watchBezel.position.y = 0.0028;

      const watchScreen = new THREE.Mesh(
        new THREE.CylinderGeometry(0.011, 0.011, 0.0016, 16),
        radianiteCoreMat
      );
      watchScreen.position.y = 0.0028;

      const watchBar = new THREE.Mesh(
        new THREE.BoxGeometry(0.01, 0.0015, 0.0024),
        accentMat
      );
      watchBar.position.set(0, 0.0038, 0);

      watchHead.add(watchCase, watchBezel, watchScreen, watchBar);
      armCore.add(watchHead);
    }

    armWrapper.add(armCore);
    return armWrapper;
  };

  // ==========================================================================
  // 1. RIGHT FIRING HAND & FOREARM RIG (Clean Unified Palm & Pistol Grip)
  // ==========================================================================
  const rightArmGroup = new THREE.Group();
  const rightWristPos: [number, number, number] = [0.02, -0.064, 0.062];
  // Angles steeply down and slightly right into the bent right elbow
  const rightElbowPos: [number, number, number] = [0.22, -0.38, 0.28];

  rightArmGroup.add(createCoaxialForearm(rightWristPos, rightElbowPos, false));

  // Single Unified Smooth Contoured Right Palm Cushion cupping the rear & right side of the grip
  const rightPalmCushion = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.022, 0.036, 10, 16),
    gloveLeatherMat
  );
  rightPalmCushion.position.set(0.016, -0.056, 0.038);
  rightPalmCushion.rotation.set(0.32, 0.18, -0.15);
  rightPalmCushion.scale.set(0.68, 1.05, 1.18);
  rightArmGroup.add(rightPalmCushion);

  // Molded Carbon-Fiber Dorsal Armor Plate on Right Firing Hand
  const rightDorsalPlate = new THREE.Mesh(
    new THREE.BoxGeometry(0.006, 0.044, 0.032),
    carbonKnuckleMat
  );
  rightDorsalPlate.position.set(0.028, -0.055, 0.034);
  rightDorsalPlate.rotation.set(0.32, 0.18, -0.15);
  rightArmGroup.add(rightDorsalPlate);

  // Smooth Thumb Web Cushion wrapping around the top beavertail of the grip
  rightArmGroup.add(
    createSmoothCapsuleSegment(
      [0.016, -0.036, 0.052],
      [-0.014, -0.03, 0.036],
      0.0125,
      gloveLeatherMat
    )
  );

  // Right Thumb resting smoothly forward along the upper-left side of the grip
  rightArmGroup.add(
    createSmoothGloveFinger(
      [-0.014, -0.03, 0.036],
      [-0.024, -0.031, 0.008],
      [-0.023, -0.029, -0.016],
      0.0092
    )
  );

  // Right Index (Trigger) Finger reaching smoothly into the trigger guard
  const triggerFingerGroup = new THREE.Group();
  triggerFingerGroup.position.set(0.022, -0.028, 0.014);
  triggerFingerGroup.add(
    createSmoothGloveFinger(
      [0, 0, 0],
      [0.001, -0.002, -0.022],
      [-0.018, -0.003, -0.034],
      0.0082
    )
  );
  rightArmGroup.add(triggerFingerGroup);

  // Right Middle, Ring, and Pinky Fingers wrapped snugly around the front strap of the pistol grip
  rightArmGroup.add(
    createSmoothGloveFinger(
      [0.022, -0.048, 0.016],
      [0.012, -0.049, -0.014],
      [-0.018, -0.049, -0.01],
      0.0086
    ),
    createSmoothGloveFinger(
      [0.022, -0.066, 0.022],
      [0.012, -0.067, -0.008],
      [-0.018, -0.067, -0.004],
      0.0082
    ),
    createSmoothGloveFinger(
      [0.02, -0.083, 0.028],
      [0.01, -0.084, -0.002],
      [-0.016, -0.084, 0.002],
      0.0076
    )
  );

  inspectPivot.add(rightArmGroup);

  // ==========================================================================
  // 2. LEFT SUPPORT HAND & FOREARM RIG (Dedicated Pistol Grip + Rifle C-Clamp)
  // ==========================================================================
  const leftArmGroup = new THREE.Group();
  const leftSupportDefaultPos = new THREE.Vector3(-0.004, 0.006, -0.35);
  leftArmGroup.position.copy(leftSupportDefaultPos);

  const leftWristPos: [number, number, number] = [-0.032, -0.03, 0.046];
  // Angles naturally outward-left and back into the lower-left shoulder/elbow
  const leftElbowPos: [number, number, number] = [-0.26, -0.34, 0.34];

  leftArmGroup.add(createCoaxialForearm(leftWristPos, leftElbowPos, true));

  // A. LEFT FOREND SUPPORT HAND (for SMG, Shotgun, Rifle, Sniper horizontal handguards)
  const leftForendHandGroup = new THREE.Group();

  // Unified Smooth Left Palm Cushion cupping the bottom-left of the handguard
  const leftForendPalm = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.021, 0.038, 10, 16),
    gloveLeatherMat
  );
  leftForendPalm.position.set(-0.024, -0.022, 0.012);
  leftForendPalm.rotation.set(Math.PI / 2 - 0.25, -0.22, -0.45);
  leftForendPalm.scale.set(0.72, 1.0, 1.15);
  leftForendHandGroup.add(leftForendPalm);

  // Sleek Matte Molded Dorsal Guard Plate on the back of the left glove
  const leftDorsalPlate = new THREE.Mesh(
    new THREE.BoxGeometry(0.006, 0.024, 0.048),
    carbonKnuckleMat
  );
  leftDorsalPlate.position.set(-0.032, -0.018, 0.008);
  leftDorsalPlate.rotation.set(-0.15, -0.18, -0.42);
  leftForendHandGroup.add(leftDorsalPlate);

  // Left Thumb in a forward tactical C-clamp along the left rail of the handguard
  leftForendHandGroup.add(
    createSmoothGloveFinger(
      [-0.032, -0.012, 0.028],
      [-0.03, 0.008, -0.002],
      [-0.025, 0.02, -0.034],
      0.0092
    )
  );

  // 4 Left Support Fingers tucked cleanly underneath the bottom of the handguard
  leftForendHandGroup.add(
    createSmoothGloveFinger(
      [-0.022, -0.016, -0.032],
      [0.004, -0.02, -0.034],
      [0.024, -0.006, -0.032],
      0.0084
    ),
    createSmoothGloveFinger(
      [-0.022, -0.018, -0.012],
      [0.004, -0.022, -0.014],
      [0.024, -0.008, -0.012],
      0.0086
    ),
    createSmoothGloveFinger(
      [-0.021, -0.02, 0.008],
      [0.003, -0.023, 0.006],
      [0.022, -0.01, 0.008],
      0.0082
    ),
    createSmoothGloveFinger(
      [-0.02, -0.022, 0.026],
      [0.002, -0.024, 0.025],
      [0.02, -0.012, 0.026],
      0.0076
    )
  );
  leftArmGroup.add(leftForendHandGroup);

  // B. LEFT PISTOL SUPPORT HAND (for Classic-9 vertical two-handed thumbs-forward grip)
  const leftPistolHandGroup = new THREE.Group();

  // Unified Smooth Left Palm cupping the left side of the pistol grip seamlessly
  const leftPistolPalm = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.02, 0.036, 10, 16),
    gloveLeatherMat
  );
  leftPistolPalm.position.set(-0.022, -0.012, 0.022);
  leftPistolPalm.rotation.set(0.35, -0.2, 0.18);
  leftPistolPalm.scale.set(0.65, 1.05, 1.15);
  leftPistolHandGroup.add(leftPistolPalm);

  const leftPistolDorsalPlate = new THREE.Mesh(
    new THREE.BoxGeometry(0.006, 0.042, 0.028),
    carbonKnuckleMat
  );
  leftPistolDorsalPlate.position.set(-0.03, -0.01, 0.02);
  leftPistolDorsalPlate.rotation.set(0.22, -0.18, 0.15);
  leftPistolHandGroup.add(leftPistolDorsalPlate);

  // Left Support Thumb pointing forward along the left side of the pistol frame (thumbs-forward grip)
  leftPistolHandGroup.add(
    createSmoothGloveFinger(
      [-0.024, 0.018, 0.016],
      [-0.024, 0.028, -0.016],
      [-0.022, 0.028, -0.044],
      0.009
    )
  );

  // Left Support Fingers wrapping horizontally across the front of the pistol grip (never sticking up!)
  leftPistolHandGroup.add(
    createSmoothGloveFinger(
      [-0.02, 0.004, 0.002],
      [-0.01, 0.004, -0.024],
      [0.014, 0.004, -0.022],
      0.0082
    ),
    createSmoothGloveFinger(
      [-0.02, -0.012, 0.008],
      [-0.01, -0.012, -0.018],
      [0.014, -0.012, -0.016],
      0.008
    ),
    createSmoothGloveFinger(
      [-0.019, -0.028, 0.014],
      [-0.009, -0.028, -0.012],
      [0.012, -0.028, -0.01],
      0.0076
    )
  );
  leftArmGroup.add(leftPistolHandGroup);

  inspectPivot.add(leftArmGroup);

  // Ejected Brass Shell Casing Mesh (reused Zero-GC mesh)
  const shellGeo = new THREE.CylinderGeometry(0.006, 0.006, 0.024, 8);
  shellGeo.rotateZ(Math.PI / 2);
  const shellMesh = new THREE.Mesh(shellGeo, brassMat);
  shellMesh.visible = false;
  root.add(shellMesh);

  // ==========================================================================
  // 3. CONTROLLED HDR STARBURST MUZZLE FLASH (Subtle Bloom Pop)
  // ==========================================================================
  const muzzleFlash = new THREE.Group();
  const flashCoreMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(1.9, 1.75, 1.3),
    transparent: true,
    opacity: 0.94,
    depthWrite: false,
  });
  const flashSpikeMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(1.65, 1.05, 0.28),
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
  });
  const flashRingMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(0.95, 1.45, 1.85),
    transparent: true,
    opacity: 0.65,
    depthWrite: false,
  });

  const flashCore = new THREE.Mesh(new THREE.OctahedronGeometry(0.048, 0), flashCoreMat);
  const flashSpikeA = new THREE.Mesh(new THREE.OctahedronGeometry(0.095, 0), flashSpikeMat);
  flashSpikeA.scale.set(1.4, 0.34, 0.45);
  const flashSpikeB = new THREE.Mesh(new THREE.OctahedronGeometry(0.095, 0), flashSpikeMat);
  flashSpikeB.scale.set(0.34, 1.4, 0.45);
  const flashJet = new THREE.Mesh(new THREE.ConeGeometry(0.036, 0.15, 8), flashSpikeMat);
  flashJet.rotation.x = -Math.PI / 2;
  flashJet.position.z = -0.075;
  const flashShockRing = new THREE.Mesh(new THREE.TorusGeometry(0.058, 0.0055, 6, 16), flashRingMat);
  flashShockRing.position.z = -0.02;

  muzzleFlash.add(flashCore, flashSpikeA, flashSpikeB, flashJet, flashShockRing);
  muzzleFlash.position.set(0, 0.04, -0.28);
  muzzleFlash.visible = false;
  root.add(muzzleFlash);

  const muzzleLight = new THREE.PointLight(0xfbbf24, 0, 6.5, 1.8);
  muzzleLight.position.set(0, 0.05, -0.65);
  root.add(muzzleLight);

  root.position.set(0.22, -0.175, -0.4);

  // Initialize default visibility for pistol vs forend hand groups
  leftPistolHandGroup.visible = true;
  leftForendHandGroup.visible = false;

  return {
    root,
    inspectPivot,
    weaponGroups,
    rightArmGroup,
    leftArmGroup,
    leftSupportDefaultPos,
    muzzleFlash,
    muzzleLight,
    shellMesh,
    setActiveWeapon: (id: WeaponId) => {
      currentWeaponId = id;
      (Object.keys(weaponGroups) as WeaponId[]).forEach((k) => {
        weaponGroups[k].visible = k === id;
        partsByWeapon[k].magGroup.position.set(0, 0, 0);
        partsByWeapon[k].slideOrBoltGroup.position.set(0, 0, 0);
      });
      leftPistolHandGroup.visible = id === 'pistol';
      leftForendHandGroup.visible = id !== 'pistol';

      if (id === 'pistol') {
        leftSupportDefaultPos.set(-0.008, -0.052, 0.014);
        muzzleFlash.position.z = -0.28;
      } else if (id === 'smg') {
        leftSupportDefaultPos.set(-0.004, -0.012, -0.24);
        muzzleFlash.position.z = -0.58;
      } else if (id === 'shotgun') {
        leftSupportDefaultPos.set(-0.006, -0.01, -0.34);
        muzzleFlash.position.z = -0.68;
      } else if (id === 'rifle') {
        leftSupportDefaultPos.set(-0.004, 0.008, -0.36);
        muzzleFlash.position.z = -0.86;
      } else {
        leftSupportDefaultPos.set(-0.004, 0.004, -0.38);
        muzzleFlash.position.z = -1.08;
      }
      leftArmGroup.position.copy(leftSupportDefaultPos);
      leftArmGroup.rotation.set(0, 0, 0);
    },
    setArticulation: (magOffsetY: number, magOffsetZ: number, slidePullBack: number) => {
      const activeParts = partsByWeapon[currentWeaponId];
      if (!activeParts) return;
      activeParts.magGroup.position.set(0, magOffsetY, magOffsetZ);
      activeParts.slideOrBoltGroup.position.set(0, 0, slidePullBack);
      const squeeze = Math.min(1, slidePullBack * 10);
      triggerFingerGroup.rotation.x = squeeze * 0.22;
      triggerFingerGroup.position.z = 0.014 + squeeze * 0.005;
    },
    updateAccentColor: (hex: number) => {
      accentMat.color.setHex(hex);
      accentMat.emissive.setHex(hex);
    },
  };
}
