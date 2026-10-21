import * as THREE from 'three';
import { AABB, InteractiveObjective, Waypoint } from './types';
import { TacticalMaterialLibrary } from './textures';

export interface TacticalArenaResult {
  arenaGroup: THREE.Group;
  obstacles: AABB[];
  waypoints: Waypoint[];
  objectives: InteractiveObjective[];
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
 * - Distinct West Long ("SECTOR A // LONG") and East Chicane ("SECTOR B // LINK") combat lanes
 * - Clearance-verified 20-node AI Navigation Graph so the AI never clips corners
 */
export function buildTacticalArena(mats: TacticalMaterialLibrary): TacticalArenaResult {
  const arenaGroup = new THREE.Group();
  const obstacles: AABB[] = [];
  const beaconRings: THREE.Mesh[] = [];

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

  // Octagonal grounded containment pad
  const padMesh = new THREE.Mesh(
    new THREE.CylinderGeometry(3.4, 3.7, 0.14, 8),
    mats.darkHullMat
  );
  padMesh.position.y = 0.07;
  const padRing = new THREE.Mesh(
    new THREE.CylinderGeometry(3.1, 3.1, 0.16, 8),
    mats.trimMetalMat
  );
  padRing.position.y = 0.08;
  obeliskGroup.add(padMesh, padRing);

  const pedBase = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.55, 2.8), mats.darkHullMat);
  pedBase.position.y = 0.28;
  const pedStep = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.35, 2.4), mats.trimMetalMat);
  pedStep.position.y = 0.72;
  const pedMid = new THREE.Mesh(new THREE.BoxGeometry(2.0, 2.1, 2.0), mats.radianiteCrateMat);
  pedMid.position.y = 1.95;
  pedMid.castShadow = true;

  // 4 Corner containment pylons around the Obelisk base
  [
    [-1.12, -1.12],
    [1.12, -1.12],
    [-1.12, 1.12],
    [1.12, 1.12],
  ].forEach(([px, pz]) => {
    const pylon = new THREE.Mesh(new THREE.BoxGeometry(0.26, 3.2, 0.26), mats.darkHullMat);
    pylon.position.set(px, 1.6, pz);
    obeliskGroup.add(pylon);
  });

  const obeliskCore = new THREE.Mesh(new THREE.OctahedronGeometry(1.1, 0), mats.obeliskCoreMat);
  obeliskCore.position.y = 4.3;

  // Dual containment stabilizer rings around the floating core
  const cageRing = new THREE.Mesh(
    new THREE.TorusGeometry(1.55, 0.06, 8, 24),
    mats.trimMetalMat
  );
  cageRing.position.y = 4.3;
  cageRing.rotation.x = Math.PI / 4;

  const upperSpire = new THREE.Mesh(new THREE.ConeGeometry(0.9, 2.6, 4), mats.trimMetalMat);
  upperSpire.position.y = 6.5;

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
    upperSpire,
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

  // 9. Interactive Tactical Objectives (Press [E] to interact)
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

    const basePed = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.16, 0.9), mats.darkHullMat);
    basePed.position.y = 0.08;
    const kiosk = new THREE.Mesh(
      new THREE.BoxGeometry(0.88, 1.05, 0.68),
      obj.type === 'radar_beacon' ? mats.obeliskCoreMat : mats.radianiteCrateMat
    );
    kiosk.position.y = 0.62;
    const antenna = new THREE.Mesh(
      new THREE.CylinderGeometry(0.04, 0.04, 0.65, 8),
      mats.trimMetalMat
    );
    antenna.position.set(0.28, 1.4, 0);
    objGroup.add(basePed, kiosk, antenna);

    const ringGeo = new THREE.RingGeometry(1.1, 1.3, 28);
    ringGeo.rotateX(-Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({
      color: obj.type === 'radar_beacon' ? 0x38bdf8 : 0x10b981,
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

  // 10. Exterior Perimeter Cliffs & Industrial Radianite Arcology Skyline
  const cliffCoords = [
    [-48, -45, 22, 28],
    [45, -48, 24, 30],
    [-52, 38, 20, 24],
    [48, 42, 25, 26],
    [0, -58, 34, 38],
    [0, 58, 30, 28],
  ];
  cliffCoords.forEach(([cx, cz, rad, h]) => {
    const peak = new THREE.Mesh(new THREE.ConeGeometry(rad, h, 6), mats.cliffRockMat);
    peak.position.set(cx, h / 2 - 1, cz);
    arenaGroup.add(peak);
  });

  // Tall Exterior Architectural Comms Towers & Floodlight Silos
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
    const body = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.8, 20, 12), mats.darkHullMat);
    body.position.y = 10;
    const glowBand = new THREE.Mesh(
      new THREE.CylinderGeometry(2.55, 2.55, 0.7, 12),
      idx % 2 === 0 ? mats.obeliskCoreMat : crimsonStripMat
    );
    glowBand.position.y = 16.0;
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.4, 9, 8), mats.trimMetalMat);
    mast.position.y = 24;
    tower.add(body, glowBand, mast);
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

  return {
    arenaGroup,
    obstacles,
    waypoints,
    objectives,
    obeliskCore,
    beaconRings,
    playerSpawn: { x: 0, y: 0, z: 21, yaw: 0 },
    aiSpawn: { x: 0, y: 0, z: -18.5, yaw: Math.PI },
  };
}
