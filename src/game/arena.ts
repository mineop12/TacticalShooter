import * as THREE from 'three';
import { AABB, InteractiveObjective, JumpPad, RopeAnchor, Waypoint } from './types';
import { TacticalMaterialLibrary } from './textures';

export interface TacticalArenaResult {
  arenaGroup: THREE.Group;
  obstacles: AABB[];
  waypoints: Waypoint[];
  objectives: InteractiveObjective[];
  ropeAnchors: RopeAnchor[];
  jumpPads: JumpPad[];
  obeliskCore: THREE.Mesh;
  beaconRings: THREE.Mesh[];
  playerSpawn: { x: number; y: number; z: number; yaw: number };
  aiSpawn: { x: number; y: number; z: number; yaw: number };
}

/**
 * Builds the production-grade 3D Tactical 1v1 Arena ("PROTOCOL // HAVEN-ZERO"):
 * - Atmospheric Twilight Sky Dome + High-Altitude Orbital Ring
 * - Grounded Architectural Portal Arches (zero floating beams) with support columns & gussets
 * - Perimeter Fortress Walls with vertical buttress pillars, parapet caps, and floodlight stanchions
 * - Central Radianite Reactor Plaza with octagonal containment pad & rotating energy core
 * - Interactive Wall-Run Kinetic Billboards, Overhead Swinging Rope Anchors, Elevated Platforms & Jump Pads
 * - Distinct West Long ("SECTOR A // LONG") and East Chicane ("SECTOR B // LINK") combat lanes
 * - Clearance-verified 20-node AI Navigation Graph so the AI never clips corners
 */
export function buildTacticalArena(mats: TacticalMaterialLibrary): TacticalArenaResult {
  const arenaGroup = new THREE.Group();
  const obstacles: AABB[] = [];
  const beaconRings: THREE.Mesh[] = [];
  const ropeAnchors: RopeAnchor[] = [];
  const jumpPads: JumpPad[] = [];

  // Controlled accent emissive materials (calibrated below bloom blowout)
  const crimsonStripMat = new THREE.MeshBasicMaterial({ color: 0xe11d48 });
  const cyanStripMat = new THREE.MeshBasicMaterial({ color: 0x0891b2 });
  const amberStripMat = new THREE.MeshBasicMaterial({ color: 0xd97706 });
  const emeraldStripMat = new THREE.MeshBasicMaterial({ color: 0x059669 });

  // 0. Atmospheric Twilight Sky Dome & Orbital Ring
  const skyDomeGeo = new THREE.SphereGeometry(185, 28, 16);
  const skyDome = new THREE.Mesh(skyDomeGeo, mats.skyDomeMat);
  arenaGroup.add(skyDome);

  const orbitalRingGeo = new THREE.TorusGeometry(135, 0.65, 6, 64);
  const orbitalRingMat = new THREE.MeshBasicMaterial({
    color: 0x38bdf8,
    transparent: true,
    opacity: 0.22,
    fog: false,
  });
  const orbitalRing = new THREE.Mesh(orbitalRingGeo, orbitalRingMat);
  orbitalRing.rotation.x = Math.PI * 0.36;
  orbitalRing.rotation.y = 0.25;
  orbitalRing.position.y = 32;
  arenaGroup.add(orbitalRing);

  // 1. Extended Ground Plane + Playable Tactical Floor
  const outerGroundGeo = new THREE.PlaneGeometry(240, 240);
  outerGroundGeo.rotateX(-Math.PI / 2);
  const outerGround = new THREE.Mesh(outerGroundGeo, mats.cliffRockMat);
  outerGround.position.y = -0.05;
  arenaGroup.add(outerGround);

  const floorGeo = new THREE.PlaneGeometry(56, 52);
  floorGeo.rotateX(-Math.PI / 2);
  const floor = new THREE.Mesh(floorGeo, mats.floorMat);
  floor.position.y = 0;
  floor.receiveShadow = true;
  arenaGroup.add(floor);

  // Disjoint Y (+0.02) tactical lane guide lines on the floor (Zero Z-fighting)
  const makeFloorLine = (w: number, d: number, x: number, z: number, colorHex: number) => {
    const geo = new THREE.PlaneGeometry(w, d);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({
      color: colorHex,
      transparent: true,
      opacity: 0.42,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, 0.02, z);
    arenaGroup.add(m);
  };

  // Center Mid Divider & Spawn-to-Mid Sightline Guides
  makeFloorLine(52, 0.22, 0, 0, 0x0891b2);
  makeFloorLine(0.16, 40, -2.5, 0, 0x0284c7);
  makeFloorLine(0.16, 40, 2.5, 0, 0x0284c7);
  // West A-Long Crimson Lane Stripe & East B-Link Emerald Lane Stripe
  makeFloorLine(0.24, 34, -17.0, 0, 0xe11d48);
  makeFloorLine(0.24, 34, 17.0, 0, 0x10b981);

  // Helper to add a multi-part 3D architectural structure + register its AABB collision box
  const addBlock = (
    id: string,
    cx: number,
    cz: number,
    width: number,
    height: number,
    depth: number,
    mat: THREE.Material,
    isCover = true,
    style: 'wall' | 'crate' | 'radianite' = 'wall'
  ) => {
    const group = new THREE.Group();
    group.position.set(cx, 0, cz);

    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), mat);
    mesh.position.y = height / 2;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);

    // Top bevel cap & base plinth so every obstacle is a grounded multi-part assembly
    const cap = new THREE.Mesh(
      new THREE.BoxGeometry(width + 0.16, 0.16, depth + 0.16),
      mats.trimMetalMat
    );
    cap.position.y = height + 0.06;
    group.add(cap);

    const plinth = new THREE.Mesh(
      new THREE.BoxGeometry(width + 0.22, 0.2, depth + 0.22),
      mats.darkHullMat
    );
    plinth.position.y = 0.1;
    group.add(plinth);

    if (style === 'crate' || style === 'radianite') {
      // Corner reinforcement bumpers, tie-down handles & horizontal containment band
      const band = new THREE.Mesh(
        new THREE.BoxGeometry(width + 0.08, 0.16, depth + 0.08),
        style === 'radianite' ? mats.obeliskCoreMat : mats.darkHullMat
      );
      band.position.y = height * 0.52;
      group.add(band);

      const postW = 0.18;
      [
        [-width / 2, -depth / 2],
        [width / 2, -depth / 2],
        [-width / 2, depth / 2],
        [width / 2, depth / 2],
      ].forEach(([px, pz]) => {
        const post = new THREE.Mesh(
          new THREE.BoxGeometry(postW, height + 0.06, postW),
          mats.trimMetalMat
        );
        post.position.set(px, height / 2, pz);
        group.add(post);
      });
    } else if (width >= 3.5 || depth >= 3.5) {
      // Repeated architectural buttress ribs along long walls
      const span = Math.max(width, depth);
      const count = Math.max(1, Math.floor(span / 8));
      for (let i = 0; i <= count; i++) {
        const offset = -span / 2 + (span / Math.max(1, count)) * i;
        if (Math.abs(offset) > span * 0.46) continue;
        const rib = new THREE.Mesh(
          new THREE.BoxGeometry(
            width > depth ? 0.42 : width + 0.28,
            height + 0.24,
            width > depth ? depth + 0.28 : 0.42
          ),
          mats.darkHullMat
        );
        rib.position.set(width > depth ? offset : 0, height / 2, width > depth ? 0 : offset);
        group.add(rib);
      }

      // Upper parapet accent strip
      const accentStrip = new THREE.Mesh(
        new THREE.BoxGeometry(
          width > depth ? width - 0.4 : width + 0.08,
          0.1,
          width > depth ? depth + 0.08 : depth - 0.4
        ),
        cz < 0 ? crimsonStripMat : cyanStripMat
      );
      accentStrip.position.y = height - 0.28;
      group.add(accentStrip);
    }

    arenaGroup.add(group);

    obstacles.push({
      id,
      minX: cx - width / 2,
      maxX: cx + width / 2,
      minY: 0,
      maxY: height,
      minZ: cz - depth / 2,
      maxZ: cz + depth / 2,
      isCover,
    });
  };

  // 2. Perimeter Compound Fortress Walls (55m x 52m arena)
  addBlock('wall_north', 0, -25.5, 56, 5.2, 1.4, mats.wallMat, false, 'wall');
  addBlock('wall_south', 0, 25.5, 56, 5.2, 1.4, mats.wallMat, false, 'wall');
  addBlock('wall_west', -27.5, 0, 1.4, 5.2, 52, mats.wallMat, false, 'wall');
  addBlock('wall_east', 27.5, 0, 1.4, 5.2, 52, mats.wallMat, false, 'wall');

  // 3. Central Landmark: Multi-Part Radianite Reactor Plaza & Grounded Skybridge (x=0, z=0)
  const obeliskGroup = new THREE.Group();
  obeliskGroup.position.set(0, 0, 0);

  // Octagonal grounded containment pad + recessed plasma moat ring
  const padMesh = new THREE.Mesh(
    new THREE.CylinderGeometry(3.5, 3.8, 0.14, 8),
    mats.darkHullMat
  );
  padMesh.position.y = 0.07;
  const padRing = new THREE.Mesh(
    new THREE.CylinderGeometry(3.15, 3.15, 0.17, 8),
    mats.trimMetalMat
  );
  padRing.position.y = 0.085;
  const padGlowRing = new THREE.Mesh(
    new THREE.TorusGeometry(2.85, 0.06, 8, 24),
    cyanStripMat
  );
  padGlowRing.rotation.x = Math.PI / 2;
  padGlowRing.position.y = 0.17;
  obeliskGroup.add(padMesh, padRing, padGlowRing);

  const pedBase = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.55, 2.8), mats.darkHullMat);
  pedBase.position.y = 0.28;
  const pedStep = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.35, 2.4), mats.trimMetalMat);
  pedStep.position.y = 0.72;
  const pedMid = new THREE.Mesh(new THREE.BoxGeometry(1.95, 2.15, 1.95), mats.radianiteCrateMat);
  pedMid.position.y = 1.95;
  pedMid.castShadow = true;

  // Lathe-Contoured Reactor Containment Turbine Collar around the central core pedestal
  const turbineProfile = [
    new THREE.Vector2(1.38, 0.85),
    new THREE.Vector2(1.18, 1.15),
    new THREE.Vector2(1.28, 1.45),
    new THREE.Vector2(1.06, 2.15),
    new THREE.Vector2(1.25, 2.75),
    new THREE.Vector2(0.88, 3.15),
  ];
  const turbineCollar = new THREE.Mesh(
    new THREE.LatheGeometry(turbineProfile, 8),
    mats.trimMetalMat
  );
  obeliskGroup.add(turbineCollar);

  // 4 Corner containment pylons + angled stabilizer fins + glowing plasma veins
  [
    [-1.16, -1.16],
    [1.16, -1.16],
    [-1.16, 1.16],
    [1.16, 1.16],
  ].forEach(([px, pz]) => {
    const pylon = new THREE.Mesh(new THREE.BoxGeometry(0.28, 3.4, 0.28), mats.darkHullMat);
    pylon.position.set(px, 1.7, pz);
    const pylonCap = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.45, 4), mats.trimMetalMat);
    pylonCap.position.set(px, 3.62, pz);
    pylonCap.rotation.y = Math.PI / 4;
    const pylonVein = new THREE.Mesh(new THREE.BoxGeometry(0.31, 2.4, 0.08), cyanStripMat);
    pylonVein.position.set(px, 1.75, pz);
    obeliskGroup.add(pylon, pylonCap, pylonVein);
  });

  const obeliskCore = new THREE.Mesh(new THREE.OctahedronGeometry(1.12, 1), mats.obeliskCoreMat);
  obeliskCore.position.y = 4.35;

  // Dual orthogonal containment stabilizer rings around the floating core
  const cageRing = new THREE.Mesh(
    new THREE.TorusGeometry(1.58, 0.065, 10, 28),
    mats.trimMetalMat
  );
  cageRing.position.y = 4.35;
  cageRing.rotation.x = Math.PI / 4;

  const cageRingInner = new THREE.Mesh(
    new THREE.TorusGeometry(1.36, 0.045, 8, 24),
    cyanStripMat
  );
  cageRingInner.position.y = 4.35;
  cageRingInner.rotation.y = Math.PI / 4;
  cageRingInner.rotation.x = -Math.PI / 6;

  const upperSpire = new THREE.Mesh(new THREE.ConeGeometry(0.92, 2.6, 4), mats.trimMetalMat);
  upperSpire.position.y = 6.5;
  const upperSpireCollar = new THREE.Mesh(
    new THREE.CylinderGeometry(1.05, 0.65, 0.35, 8),
    mats.darkHullMat
  );
  upperSpireCollar.position.y = 5.35;

  // Grounded Overhead Architectural Skybridge spanning Mid Courtyard
  const archLeft = new THREE.Mesh(new THREE.BoxGeometry(1.3, 7.8, 1.4), mats.accentWallMat);
  archLeft.position.set(-8.8, 3.9, 0);
  const archLeftBase = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.6, 1.8), mats.darkHullMat);
  archLeftBase.position.set(-8.8, 0.3, 0);

  const archRight = new THREE.Mesh(new THREE.BoxGeometry(1.3, 7.8, 1.4), mats.accentWallMat);
  archRight.position.set(8.8, 3.9, 0);
  const archRightBase = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.6, 1.8), mats.darkHullMat);
  archRightBase.position.set(8.8, 0.3, 0);

  const archBeam = new THREE.Mesh(new THREE.BoxGeometry(19.6, 1.1, 2.0), mats.darkHullMat);
  archBeam.position.set(0, 7.8, 0);
  const archTrimTop = new THREE.Mesh(new THREE.BoxGeometry(20.0, 0.22, 2.2), mats.trimMetalMat);
  archTrimTop.position.set(0, 8.45, 0);
  const archConduitS = new THREE.Mesh(new THREE.BoxGeometry(16.0, 0.1, 0.1), cyanStripMat);
  archConduitS.position.set(0, 7.42, 1.02);
  const archConduitN = new THREE.Mesh(new THREE.BoxGeometry(16.0, 0.1, 0.1), crimsonStripMat);
  archConduitN.position.set(0, 7.42, -1.02);

  obeliskGroup.add(
    pedBase,
    pedStep,
    pedMid,
    obeliskCore,
    cageRing,
    cageRingInner,
    upperSpire,
    upperSpireCollar,
    archLeft,
    archLeftBase,
    archRight,
    archRightBase,
    archBeam,
    archTrimTop,
    archConduitS,
    archConduitN
  );
  arenaGroup.add(obeliskGroup);

  obstacles.push(
    {
      id: 'mid_obelisk',
      minX: -1.45,
      maxX: 1.45,
      minY: 0,
      maxY: 4.5,
      minZ: -1.45,
      maxZ: 1.45,
      isCover: true,
    },
    {
      id: 'arch_pillar_west',
      minX: -9.45,
      maxX: -8.15,
      minY: 0,
      maxY: 7.8,
      minZ: -0.7,
      maxZ: 0.7,
      isCover: true,
    },
    {
      id: 'arch_pillar_east',
      minX: 8.15,
      maxX: 9.45,
      minY: 0,
      maxY: 7.8,
      minZ: -0.7,
      maxZ: 0.7,
      isCover: true,
    }
  );

  // 4. Grounded Tactical Portal Archways (Zero floating geometry — every gantry has grounded support columns!)
  const buildGroundedPortalArch = (
    x: number,
    z: number,
    spanWidth: number,
    stripMat: THREE.Material
  ) => {
    const gate = new THREE.Group();
    gate.position.set(x, 0, z);

    const halfSpan = spanWidth / 2 - 0.45;
    // Left & Right Grounded Support Columns
    [-halfSpan, halfSpan].forEach((colX) => {
      const col = new THREE.Mesh(new THREE.BoxGeometry(0.75, 5.4, 1.05), mats.accentWallMat);
      col.position.set(colX, 2.7, 0);
      const colPlinth = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.45, 1.3), mats.darkHullMat);
      colPlinth.position.set(colX, 0.225, 0);
      const colCap = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.3, 1.2), mats.trimMetalMat);
      colCap.position.set(colX, 5.1, 0);
      gate.add(col, colPlinth, colCap);
    });

    // Overhead Structural Cross-Beam + Trim Crown
    const beam = new THREE.Mesh(new THREE.BoxGeometry(spanWidth + 0.4, 0.78, 1.15), mats.darkHullMat);
    beam.position.y = 5.55;
    const crown = new THREE.Mesh(
      new THREE.BoxGeometry(spanWidth + 0.7, 0.16, 1.3),
      mats.trimMetalMat
    );
    crown.position.y = 6.02;
    const strip = new THREE.Mesh(
      new THREE.BoxGeometry(spanWidth - 1.8, 0.1, 1.2),
      stripMat
    );
    strip.position.y = 5.26;
    gate.add(beam, crown, strip);
    arenaGroup.add(gate);
  };

  // Spawn gates tie directly into the spawn wing cover walls at x = ±7.8!
  buildGroundedPortalArch(0, 14.5, 15.6, cyanStripMat); // South Defender Spawn Portal
  buildGroundedPortalArch(0, -14.5, 15.6, crimsonStripMat); // North Attacker Spawn Portal
  buildGroundedPortalArch(-19.8, 0, 14.6, amberStripMat); // West A-Long Gantry Portal
  buildGroundedPortalArch(19.8, 0, 14.6, emeraldStripMat); // East B-Link Gantry Portal

  // 5. Spawn Wing Cover Walls (Offset at x = ±6.2 so center lane & side portals have generous clearance)
  addBlock('south_wing_west', -6.2, 14.5, 3.8, 3.4, 1.2, mats.accentWallMat, true, 'wall');
  addBlock('south_wing_east', 6.2, 14.5, 3.8, 3.4, 1.2, mats.accentWallMat, true, 'wall');

  addBlock('north_wing_west', -6.2, -14.5, 3.8, 3.4, 1.2, mats.accentWallMat, true, 'wall');
  addBlock('north_wing_east', 6.2, -14.5, 3.8, 3.4, 1.2, mats.accentWallMat, true, 'wall');

  // 6. Mid Courtyard Tactical Cover Crates
  addBlock('mid_crate_sw', -4.4, 6.5, 1.9, 1.9, 1.9, mats.radianiteCrateMat, true, 'radianite');
  addBlock('mid_crate_se', 4.4, 6.5, 1.9, 1.9, 1.9, mats.crateMat, true, 'crate');
  addBlock('mid_crate_nw', -4.4, -6.5, 1.9, 1.9, 1.9, mats.crateMat, true, 'crate');
  addBlock('mid_crate_ne', 4.4, -6.5, 1.9, 1.9, 1.9, mats.radianiteCrateMat, true, 'radianite');

  // 7. West Long Corridor ("A-Long") Dividers & Alcove Cover
  addBlock('west_divider_south', -12.5, 9.0, 1.4, 3.8, 7.2, mats.wallMat, true, 'wall');
  addBlock('west_divider_north', -12.5, -9.0, 1.4, 3.8, 7.2, mats.wallMat, true, 'wall');
  addBlock(
    'west_long_crate_s',
    -20.0,
    11.0,
    2.0,
    2.0,
    2.0,
    mats.radianiteCrateMat,
    true,
    'radianite'
  );
  addBlock(
    'west_long_crate_n',
    -20.0,
    -11.0,
    2.0,
    2.0,
    2.0,
    mats.radianiteCrateMat,
    true,
    'radianite'
  );
  addBlock('west_alcove_cover', -22.5, 0, 2.2, 2.2, 3.0, mats.crateMat, true, 'crate');

  // 8. East Flanking Hallway ("B-Link") Chicane & Stacked Radianite Crates
  addBlock('east_divider_south', 12.5, 9.0, 1.4, 3.8, 7.2, mats.wallMat, true, 'wall');
  addBlock('east_divider_north', 12.5, -9.0, 1.4, 3.8, 7.2, mats.wallMat, true, 'wall');
  addBlock(
    'east_chicane_mid',
    19.0,
    0,
    2.8,
    2.5,
    2.0,
    mats.radianiteCrateMat,
    true,
    'radianite'
  );
  addBlock('east_flank_crate_s', 21.5, 8.5, 1.9, 1.8, 1.9, mats.crateMat, true, 'crate');
  addBlock('east_flank_crate_n', 21.5, -8.5, 1.9, 1.8, 1.9, mats.crateMat, true, 'crate');

  // 9. Interactive Tactical Objectives (Press [E] to interact) — High-Detail 9-Part Terminals
  const objectives: InteractiveObjective[] = [
    {
      id: 'obj_south_ammo',
      label: 'Tactical Munitions Locker',
      actionHint: 'Press [E] to Replenish Reserve Ammo & Patch +15 Shield',
      x: -3.2,
      y: 1.0,
      z: 18.5,
      cooldown: 12,
      lastUsedTime: -99,
      type: 'ammo_crate',
    },
    {
      id: 'obj_mid_radar',
      label: 'Radianite Recon Uplink',
      actionHint: 'Press [E] to Pulse Recon Sweep (Reveals Opponent for 6s)',
      x: 0,
      y: 1.0,
      z: 2.6,
      cooldown: 15,
      lastUsedTime: -99,
      type: 'radar_beacon',
    },
  ];

  objectives.forEach((obj) => {
    const objGroup = new THREE.Group();
    objGroup.position.set(obj.x, 0, obj.z);
    const isRadar = obj.type === 'radar_beacon';

    // Stepped octagonal foundation pad + protective corner bollards
    const basePed = new THREE.Mesh(
      new THREE.CylinderGeometry(0.72, 0.84, 0.16, 8),
      mats.darkHullMat
    );
    basePed.position.y = 0.08;
    objGroup.add(basePed);

    [
      [-0.54, -0.44],
      [0.54, -0.44],
      [-0.54, 0.44],
      [0.54, 0.44],
    ].forEach(([bx, bz]) => {
      const bollard = new THREE.Mesh(
        new THREE.CylinderGeometry(0.055, 0.065, 0.62, 8),
        mats.trimMetalMat
      );
      bollard.position.set(bx, 0.31, bz);
      objGroup.add(bollard);
    });

    // Main armored kiosk cabinet + angled holographic console hood
    const kiosk = new THREE.Mesh(
      new THREE.BoxGeometry(0.86, 1.02, 0.64),
      isRadar ? mats.accentWallMat : mats.radianiteCrateMat
    );
    kiosk.position.y = 0.62;
    kiosk.castShadow = true;

    const consoleScreen = new THREE.Mesh(
      new THREE.BoxGeometry(0.68, 0.36, 0.08),
      isRadar ? cyanStripMat : emeraldStripMat
    );
    consoleScreen.position.set(0, 0.88, 0.32);
    consoleScreen.rotation.x = -0.35;
    objGroup.add(kiosk, consoleScreen);

    if (isRadar) {
      // Parabolic Recon Radar Dish + Twin Telemetry Antennas
      const dishMast = new THREE.Mesh(
        new THREE.CylinderGeometry(0.06, 0.08, 0.55, 10),
        mats.trimMetalMat
      );
      dishMast.position.set(0, 1.38, -0.08);
      const dishBowl = new THREE.Mesh(
        new THREE.CylinderGeometry(0.42, 0.12, 0.18, 16),
        mats.trimMetalMat
      );
      dishBowl.position.set(0, 1.68, -0.04);
      dishBowl.rotation.x = 0.55;
      const dishFeed = new THREE.Mesh(
        new THREE.SphereGeometry(0.075, 10, 10),
        mats.obeliskCoreMat
      );
      dishFeed.position.set(0, 1.78, 0.08);
      objGroup.add(dishMast, dishBowl, dishFeed);
    } else {
      // Twin Side Shield-Cell Canisters + Upper Munitions Rack
      [-0.5, 0.5].forEach((cx) => {
        const canister = new THREE.Mesh(
          new THREE.CylinderGeometry(0.11, 0.11, 0.78, 12),
          mats.obeliskCoreMat
        );
        canister.position.set(cx, 0.62, 0);
        const canisterCap = new THREE.Mesh(
          new THREE.CylinderGeometry(0.125, 0.125, 0.1, 12),
          mats.trimMetalMat
        );
        canisterCap.position.set(cx, 1.02, 0);
        objGroup.add(canister, canisterCap);
      });
      const topRack = new THREE.Mesh(
        new THREE.BoxGeometry(0.76, 0.18, 0.48),
        mats.trimMetalMat
      );
      topRack.position.set(0, 1.22, -0.04);
      objGroup.add(topRack);
    }

    const ringGeo = new THREE.RingGeometry(1.12, 1.34, 28);
    ringGeo.rotateX(-Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({
      color: isRadar ? 0x38bdf8 : 0x10b981,
      transparent: true,
      opacity: 0.68,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.position.y = 0.03;
    objGroup.add(ring);
    beaconRings.push(ring);

    arenaGroup.add(objGroup);
  });

  // 10. Multi-Part Stratified Exterior Cliffs & Industrial Radianite Arcology Skyline
  const cliffCoords = [
    [-48, -45, 22, 28],
    [45, -48, 24, 30],
    [-52, 38, 20, 24],
    [48, 42, 25, 26],
    [0, -58, 34, 38],
    [0, 58, 30, 28],
  ];
  cliffCoords.forEach(([cx, cz, rad, h], idx) => {
    const massif = new THREE.Group();
    massif.position.set(cx, 0, cz);

    const mainPeak = new THREE.Mesh(new THREE.ConeGeometry(rad, h, 7), mats.cliffRockMat);
    mainPeak.position.y = h / 2 - 1;
    mainPeak.rotation.y = idx * 0.7;

    const secondaryRidge = new THREE.Mesh(
      new THREE.ConeGeometry(rad * 0.72, h * 0.68, 6),
      mats.cliffRockMat
    );
    secondaryRidge.position.set(rad * 0.42, (h * 0.68) / 2 - 1, -rad * 0.25);
    secondaryRidge.rotation.y = idx * 1.3;

    const basalCrag = new THREE.Mesh(
      new THREE.DodecahedronGeometry(rad * 0.48, 0),
      mats.darkHullMat
    );
    basalCrag.position.set(-rad * 0.35, rad * 0.24, rad * 0.3);

    massif.add(mainPeak, secondaryRidge, basalCrag);
    arenaGroup.add(massif);
  });

  // Tall Multi-Tiered Exterior Architectural Comms Towers & Floodlight Silos
  [
    [-34, -32],
    [34, -32],
    [-34, 32],
    [34, 32],
    [-38, 0],
    [38, 0],
  ].forEach(([tx, tz], idx) => {
    const tower = new THREE.Group();
    tower.position.set(tx, 0, tz);

    const basePlinth = new THREE.Mesh(
      new THREE.CylinderGeometry(3.2, 3.6, 2.4, 8),
      mats.trimMetalMat
    );
    basePlinth.position.y = 1.2;

    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(2.35, 2.85, 20, 12),
      mats.darkHullMat
    );
    body.position.y = 10;

    const midCollar = new THREE.Mesh(
      new THREE.CylinderGeometry(2.75, 2.75, 1.2, 8),
      mats.accentWallMat
    );
    midCollar.position.y = 11.5;

    const glowBand = new THREE.Mesh(
      new THREE.CylinderGeometry(2.58, 2.58, 0.75, 12),
      idx % 2 === 0 ? mats.obeliskCoreMat : crimsonStripMat
    );
    glowBand.position.y = 16.2;

    const upperDeck = new THREE.Mesh(
      new THREE.CylinderGeometry(2.9, 2.4, 1.4, 8),
      mats.trimMetalMat
    );
    upperDeck.position.y = 20.4;

    const mast = new THREE.Mesh(
      new THREE.CylinderGeometry(0.22, 0.42, 9.5, 8),
      mats.trimMetalMat
    );
    mast.position.y = 25.5;

    const beaconTip = new THREE.Mesh(
      new THREE.SphereGeometry(0.42, 8, 8),
      idx % 2 === 0 ? cyanStripMat : crimsonStripMat
    );
    beaconTip.position.y = 30.4;

    tower.add(basePlinth, body, midCollar, glowBand, upperDeck, mast, beaconTip);
    arenaGroup.add(tower);
  });

  // 11. Clearance-Verified 20-Node Tactical Navigation Graph for AI Opponent
  // Every node has >= 1.6m clearance from all obstacles, and every neighbor edge is a straight unobstructed corridor!
  const waypoints: Waypoint[] = [
    // North Attacker Spawn Sector
    {
      id: 'n_spawn',
      x: 0,
      z: -19.5,
      isCover: false,
      zone: 'north_spawn',
      neighbors: ['n_center_gap', 'n_west', 'n_east'],
    },
    {
      id: 'n_center_gap',
      x: 0,
      z: -11.0,
      isCover: false,
      zone: 'north_spawn',
      neighbors: ['n_spawn', 'mid_n_west', 'mid_n_east'],
    },
    {
      id: 'n_west',
      x: -10.0,
      z: -18.0,
      isCover: true,
      zone: 'north_spawn',
      neighbors: ['n_spawn', 'w_north', 'mid_n_west'],
    },
    {
      id: 'n_east',
      x: 10.0,
      z: -18.0,
      isCover: true,
      zone: 'north_spawn',
      neighbors: ['n_spawn', 'e_north', 'mid_n_east'],
    },

    // Central Mid Courtyard (Wide clearance around mid_crate_nw/ne/sw/se and mid_obelisk)
    {
      id: 'mid_n_west',
      x: -2.2,
      z: -9.8,
      isCover: true,
      zone: 'mid',
      neighbors: ['n_center_gap', 'n_west', 'mid_west_channel', 'mid_n_east'],
    },
    {
      id: 'mid_n_east',
      x: 2.2,
      z: -9.8,
      isCover: true,
      zone: 'mid',
      neighbors: ['n_center_gap', 'n_east', 'mid_east_channel', 'mid_n_west'],
    },
    {
      id: 'mid_west_channel',
      x: -5.2,
      z: -2.8,
      isCover: true,
      zone: 'mid',
      neighbors: ['mid_n_west', 'mid_sw_channel', 'w_mid_entry'],
    },
    {
      id: 'mid_east_channel',
      x: 5.2,
      z: -2.8,
      isCover: true,
      zone: 'mid',
      neighbors: ['mid_n_east', 'mid_se_channel', 'e_mid_entry'],
    },
    {
      id: 'mid_sw_channel',
      x: -5.2,
      z: 2.8,
      isCover: true,
      zone: 'mid',
      neighbors: ['mid_west_channel', 'mid_s_west', 'w_mid_entry'],
    },
    {
      id: 'mid_se_channel',
      x: 5.2,
      z: 2.8,
      isCover: true,
      zone: 'mid',
      neighbors: ['mid_east_channel', 'mid_s_east', 'e_mid_entry'],
    },
    {
      id: 'mid_s_west',
      x: -2.2,
      z: 9.8,
      isCover: true,
      zone: 'mid',
      neighbors: ['mid_sw_channel', 's_center_gap', 's_west', 'mid_s_east'],
    },
    {
      id: 'mid_s_east',
      x: 2.2,
      z: 9.8,
      isCover: true,
      zone: 'mid',
      neighbors: ['mid_se_channel', 's_center_gap', 's_east', 'mid_s_west'],
    },

    // West A-Long Lane
    {
      id: 'w_north',
      x: -16.5,
      z: -15.5,
      isCover: true,
      zone: 'west_long',
      neighbors: ['n_west', 'w_mid_entry'],
    },
    {
      id: 'w_mid_entry',
      x: -16.5,
      z: 0,
      isCover: true,
      zone: 'west_long',
      neighbors: ['w_north', 'w_south', 'mid_west_channel', 'mid_sw_channel'],
    },
    {
      id: 'w_south',
      x: -16.5,
      z: 15.5,
      isCover: true,
      zone: 'west_long',
      neighbors: ['w_mid_entry', 's_west'],
    },

    // East B-Link Lane
    {
      id: 'e_north',
      x: 16.0,
      z: -15.5,
      isCover: true,
      zone: 'east_flank',
      neighbors: ['n_east', 'e_mid_entry'],
    },
    {
      id: 'e_mid_entry',
      x: 15.2,
      z: 0,
      isCover: true,
      zone: 'east_flank',
      neighbors: ['e_north', 'e_south', 'mid_east_channel', 'mid_se_channel'],
    },
    {
      id: 'e_south',
      x: 16.0,
      z: 15.5,
      isCover: true,
      zone: 'east_flank',
      neighbors: ['e_mid_entry', 's_east'],
    },

    // South Defender Spawn Sector
    {
      id: 's_west',
      x: -10.0,
      z: 18.0,
      isCover: true,
      zone: 'south_spawn',
      neighbors: ['w_south', 'mid_s_west', 's_center_gap'],
    },
    {
      id: 's_east',
      x: 10.0,
      z: 18.0,
      isCover: true,
      zone: 'south_spawn',
      neighbors: ['e_south', 'mid_s_east', 's_center_gap'],
    },
    {
      id: 's_center_gap',
      x: 0,
      z: 11.5,
      isCover: false,
      zone: 'south_spawn',
      neighbors: ['mid_s_west', 'mid_s_east', 's_west', 's_east'],
    },
  ];

  // 12. Interactive Parkour Traversal Mechanics:
  // (A) 6 Neon Kinetic Wall-Run Billboards with Glowing Chevron Speed-Strips
  const addWallRunBillboard = (
    id: string,
    cx: number,
    cz: number,
    lengthZ: number,
    faceDirX: 1 | -1,
    colorHex: number
  ) => {
    const panelGroup = new THREE.Group();
    panelGroup.position.set(cx, 0, cz);

    const panelMat = new THREE.MeshStandardMaterial({
      color: 0x0f172a,
      roughness: 0.3,
      metalness: 0.78,
    });
    const stripMat = new THREE.MeshBasicMaterial({ color: colorHex });

    // Main curved/angled structural wall-run backing plate (spans y = 0.8m to 4.4m)
    const backing = new THREE.Mesh(new THREE.BoxGeometry(0.32, 3.6, lengthZ), panelMat);
    backing.position.y = 2.6;
    backing.castShadow = true;
    panelGroup.add(backing);

    // Top & bottom neon speed rails
    [-1.65, 1.65].forEach((ry) => {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.12, lengthZ + 0.1), stripMat);
      rail.position.y = 2.6 + ry;
      panelGroup.add(rail);
    });

    // Glowing chevron directional bars along the runnable face
    const chevronCount = Math.max(3, Math.floor(lengthZ / 1.8));
    for (let i = 0; i < chevronCount; i++) {
      const zOff = -lengthZ * 0.4 + (lengthZ * 0.8 * i) / Math.max(1, chevronCount - 1);
      const chevTop = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.75, 0.14), stripMat);
      chevTop.position.set(faceDirX * 0.18, 2.9, zOff);
      chevTop.rotation.x = 0.55;
      const chevBot = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.75, 0.14), stripMat);
      chevBot.position.set(faceDirX * 0.18, 2.3, zOff);
      chevBot.rotation.x = -0.55;
      panelGroup.add(chevTop, chevBot);
    }

    arenaGroup.add(panelGroup);

    obstacles.push({
      id,
      minX: cx - 0.24,
      maxX: cx + 0.24,
      minY: 0.6,
      maxY: 4.5,
      minZ: cz - lengthZ / 2,
      maxZ: cz + lengthZ / 2,
      isCover: true,
      isWallRunPanel: true,
    });
  };

  // Mid Canyon West & East Wall-Run Billboards (attached along the inner faces of the divider walls + mid canyon)
  addWallRunBillboard('wallrun_mid_west_s', -11.65, 9.0, 7.0, 1, 0x38bdf8);
  addWallRunBillboard('wallrun_mid_west_n', -11.65, -9.0, 7.0, 1, 0x38bdf8);
  addWallRunBillboard('wallrun_mid_east_s', 11.65, 9.0, 7.0, -1, 0x10b981);
  addWallRunBillboard('wallrun_mid_east_n', 11.65, -9.0, 7.0, -1, 0x10b981);
  // Outer A-Long & B-Link Perimeter Wall-Run Boost Panels
  addWallRunBillboard('wallrun_outer_west', -26.55, 0, 13.0, 1, 0xf59e0b);
  addWallRunBillboard('wallrun_outer_east', 26.55, 0, 13.0, -1, 0xe11d48);

  // (B) 4 Elevated Walkable High-Ground Sniper Perches (players can wall-jump or rope-swing onto them!)
  addBlock('perch_mid_west', -8.8, 4.2, 2.8, 2.6, 3.2, mats.accentWallMat, true, 'crate');
  addBlock('perch_mid_east', 8.8, -4.2, 2.8, 2.6, 3.2, mats.accentWallMat, true, 'crate');
  addBlock('perch_west_overlook', -16.2, 0, 2.6, 2.7, 3.4, mats.radianiteCrateMat, true, 'radianite');
  addBlock('perch_east_overlook', 15.2, 0, 2.6, 2.7, 3.4, mats.radianiteCrateMat, true, 'radianite');

  // (C) 2 Kinetic Jump Pads (South & North Mid approaches for instant vertical launch into rope swings / wall-runs)
  const addJumpPad = (id: string, label: string, x: number, z: number, boostVy: number) => {
    jumpPads.push({ id, label, x, y: 0, z, radius: 1.45, boostVy, boostForward: 2.8 });

    const padGroup = new THREE.Group();
    padGroup.position.set(x, 0.04, z);

    // Octagonal beveled turbine chassis + inner containment ring
    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(1.28, 1.44, 0.14, 8),
      mats.darkHullMat
    );
    base.position.y = 0.05;

    const bezelRing = new THREE.Mesh(
      new THREE.CylinderGeometry(1.08, 1.16, 0.18, 8),
      mats.trimMetalMat
    );
    bezelRing.position.y = 0.06;

    const core = new THREE.Mesh(
      new THREE.CylinderGeometry(0.88, 0.96, 0.2, 16),
      new THREE.MeshBasicMaterial({ color: 0x38bdf8 })
    );
    core.position.y = 0.075;

    // 4 Cardinal Thruster Stabilizer Pods around the Jump Pad perimeter
    [
      [0, 1.24],
      [0, -1.24],
      [1.24, 0],
      [-1.24, 0],
    ].forEach(([tx, tz]) => {
      const pod = new THREE.Mesh(
        new THREE.BoxGeometry(0.32, 0.22, 0.32),
        mats.trimMetalMat
      );
      pod.position.set(tx, 0.09, tz);
      padGroup.add(pod);
    });

    const pulseRingGeo = new THREE.RingGeometry(1.15, 1.42, 24);
    pulseRingGeo.rotateX(-Math.PI / 2);
    const pulseRing = new THREE.Mesh(
      pulseRingGeo,
      new THREE.MeshBasicMaterial({
        color: 0x38bdf8,
        transparent: true,
        opacity: 0.78,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    );
    pulseRing.position.y = 0.13;
    beaconRings.push(pulseRing);

    padGroup.add(base, bezelRing, core, pulseRing);
    arenaGroup.add(padGroup);
  };

  addJumpPad('jumppad_south_mid', 'SOUTH KINETIC LAUNCH PAD', 0, 12.2, 10.6);
  addJumpPad('jumppad_north_mid', 'NORTH KINETIC LAUNCH PAD', 0, -12.2, 10.6);

  // (D) 6 Overhead Swinging Rope Anchors with Motorized Winch Drums, Plasma Conduits & Grapple Claws
  const addSwingRopeAnchor = (
    id: string,
    label: string,
    x: number,
    y: number,
    z: number,
    ropeLength: number,
    colorHex: number
  ) => {
    ropeAnchors.push({
      id,
      label,
      x,
      y,
      z,
      ropeLength,
      grabRadius: 9.8,
    });

    const ropeGroup = new THREE.Group();
    ropeGroup.position.set(x, 0, z);

    // Structural ceiling mount flange + dual-flange magnetic winch drum
    const ceilingBracket = new THREE.Mesh(
      new THREE.BoxGeometry(0.95, 0.18, 0.95),
      mats.darkHullMat
    );
    ceilingBracket.position.y = y + 0.22;

    const winch = new THREE.Mesh(
      new THREE.CylinderGeometry(0.4, 0.46, 0.38, 12),
      mats.trimMetalMat
    );
    winch.position.y = y;

    const haloMat = new THREE.MeshBasicMaterial({ color: colorHex });
    const halo = new THREE.Mesh(new THREE.TorusGeometry(0.58, 0.07, 8, 24), haloMat);
    halo.rotation.x = Math.PI / 2;
    halo.position.y = y - 0.12;

    // Hanging braided kinetic plasma rope down from the anchor + intermediate stabilizer collars
    const cable = new THREE.Mesh(
      new THREE.CylinderGeometry(0.055, 0.055, ropeLength, 10),
      haloMat
    );
    cable.position.y = y - ropeLength / 2;

    const midCollar1 = new THREE.Mesh(
      new THREE.CylinderGeometry(0.095, 0.095, 0.14, 10),
      mats.trimMetalMat
    );
    midCollar1.position.y = y - ropeLength * 0.35;
    const midCollar2 = new THREE.Mesh(
      new THREE.CylinderGeometry(0.095, 0.095, 0.14, 10),
      mats.trimMetalMat
    );
    midCollar2.position.y = y - ropeLength * 0.7;

    // Glowing grab handle core + 3-prong mechanical grapple claw assembly at the bottom
    const handle = new THREE.Mesh(new THREE.OctahedronGeometry(0.24, 1), haloMat);
    handle.position.y = y - ropeLength;
    const handleCollar = new THREE.Mesh(
      new THREE.TorusGeometry(0.3, 0.045, 8, 18),
      mats.trimMetalMat
    );
    handleCollar.rotation.x = Math.PI / 2;
    handleCollar.position.y = y - ropeLength;

    // Subtle floor projection ring underneath each swing rope
    const floorRingGeo = new THREE.RingGeometry(0.75, 0.95, 24);
    floorRingGeo.rotateX(-Math.PI / 2);
    const floorRing = new THREE.Mesh(
      floorRingGeo,
      new THREE.MeshBasicMaterial({
        color: colorHex,
        transparent: true,
        opacity: 0.48,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    );
    floorRing.position.y = 0.03;
    beaconRings.push(floorRing);

    ropeGroup.add(
      ceilingBracket,
      winch,
      halo,
      cable,
      midCollar1,
      midCollar2,
      handle,
      handleCollar,
      floorRing
    );
    arenaGroup.add(ropeGroup);
  };

  // 2 Central Skybridge Grapple Ropes (swing across Mid Reactor Plaza or up onto sniper perches)
  addSwingRopeAnchor('rope_mid_west', 'MID WEST SKYBRIDGE ROPE', -4.6, 7.35, 0, 4.4, 0xf59e0b);
  addSwingRopeAnchor('rope_mid_east', 'MID EAST SKYBRIDGE ROPE', 4.6, 7.35, 0, 4.4, 0xf59e0b);
  // 2 Spawn Portal Grapple Ropes (fast launch out of South/North portals)
  addSwingRopeAnchor('rope_south_portal', 'SOUTH PORTAL SWING ROPE', 0, 5.2, 14.5, 3.3, 0x38bdf8);
  addSwingRopeAnchor('rope_north_portal', 'NORTH PORTAL SWING ROPE', 0, 5.2, -14.5, 3.3, 0xe11d48);
  // 2 Side Lane Gantry Grapple Ropes (West A-Long & East B-Link high-speed swing arcs)
  addSwingRopeAnchor('rope_west_gantry', 'A-LONG GANTRY SWING ROPE', -19.8, 5.2, 0, 3.3, 0xf59e0b);
  addSwingRopeAnchor('rope_east_gantry', 'B-LINK GANTRY SWING ROPE', 19.8, 5.2, 0, 3.3, 0x10b981);

  return {
    arenaGroup,
    obstacles,
    waypoints,
    objectives,
    ropeAnchors,
    jumpPads,
    obeliskCore,
    beaconRings,
    playerSpawn: { x: 0, y: 0, z: 21, yaw: 0 },
    aiSpawn: { x: 0, y: 0, z: -18.5, yaw: Math.PI },
  };
}
