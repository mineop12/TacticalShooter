import * as THREE from 'three';

export interface TacticalMaterialLibrary {
  floorMat: THREE.MeshStandardMaterial;
  wallMat: THREE.MeshStandardMaterial;
  accentWallMat: THREE.MeshStandardMaterial;
  crateMat: THREE.MeshStandardMaterial;
  radianiteCrateMat: THREE.MeshStandardMaterial;
  trimMetalMat: THREE.MeshStandardMaterial;
  darkHullMat: THREE.MeshStandardMaterial;
  obeliskCoreMat: THREE.MeshStandardMaterial;
  cliffRockMat: THREE.MeshStandardMaterial;
  skyDomeMat: THREE.MeshBasicMaterial;
  dispose: () => void;
}

/**
 * Generates zero-404 procedural CanvasTextures with calibrated sRGB colorSpace,
 * anisotropy, linear bumpMaps, and a twilight atmospheric sky dome texture.
 */
export function createTacticalMaterialLibrary(
  renderer: THREE.WebGLRenderer
): TacticalMaterialLibrary {
  const maxAniso = renderer.capabilities.getMaxAnisotropy();
  const textures: THREE.Texture[] = [];
  const materials: THREE.Material[] = [];

  // 1. Tactical Courtyard Floor Grid Texture + Bump
  const floorCanvas = document.createElement('canvas');
  floorCanvas.width = 512;
  floorCanvas.height = 512;
  const fCtx = floorCanvas.getContext('2d')!;
  fCtx.fillStyle = '#1b2434';
  fCtx.fillRect(0, 0, 512, 512);

  const tileSize = 128;
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      const shade = (x + y) % 2 === 0 ? '#243044' : '#1e293b';
      fCtx.fillStyle = shade;
      fCtx.fillRect(x * tileSize + 3, y * tileSize + 3, tileSize - 6, tileSize - 6);

      // Subtle inner bevel frame on each architectural slab
      fCtx.strokeStyle = 'rgba(148, 163, 184, 0.14)';
      fCtx.lineWidth = 2;
      fCtx.strokeRect(x * tileSize + 8, y * tileSize + 8, tileSize - 16, tileSize - 16);

      // Corner tactical markings
      fCtx.fillStyle = '#38bdf8';
      fCtx.globalAlpha = 0.35;
      fCtx.fillRect(x * tileSize + 10, y * tileSize + 10, 12, 2);
      fCtx.fillRect(x * tileSize + 10, y * tileSize + 10, 2, 12);
      fCtx.globalAlpha = 1.0;
    }
  }
  // Micro-speckle concrete grain
  for (let i = 0; i < 2600; i++) {
    const gx = Math.random() * 512;
    const gy = Math.random() * 512;
    fCtx.fillStyle = i % 2 === 0 ? 'rgba(255,255,255,0.035)' : 'rgba(0,0,0,0.05)';
    fCtx.fillRect(gx, gy, 2, 2);
  }

  const floorTex = new THREE.CanvasTexture(floorCanvas);
  floorTex.colorSpace = THREE.SRGBColorSpace;
  floorTex.wrapS = THREE.RepeatWrapping;
  floorTex.wrapT = THREE.RepeatWrapping;
  floorTex.repeat.set(14, 14);
  floorTex.anisotropy = maxAniso;
  textures.push(floorTex);

  // Floor Bump Map (Linear)
  const floorBumpCanvas = document.createElement('canvas');
  floorBumpCanvas.width = 256;
  floorBumpCanvas.height = 256;
  const fbCtx = floorBumpCanvas.getContext('2d')!;
  fbCtx.fillStyle = '#808080';
  fbCtx.fillRect(0, 0, 256, 256);
  fbCtx.strokeStyle = '#282828';
  fbCtx.lineWidth = 3;
  for (let i = 0; i <= 256; i += 64) {
    fbCtx.beginPath();
    fbCtx.moveTo(i, 0);
    fbCtx.lineTo(i, 256);
    fbCtx.stroke();
    fbCtx.beginPath();
    fbCtx.moveTo(0, i);
    fbCtx.lineTo(256, i);
    fbCtx.stroke();
  }
  const floorBumpTex = new THREE.CanvasTexture(floorBumpCanvas);
  floorBumpTex.wrapS = THREE.RepeatWrapping;
  floorBumpTex.wrapT = THREE.RepeatWrapping;
  floorBumpTex.repeat.set(14, 14);
  textures.push(floorBumpTex);

  // 2. Architectural Concrete & Steel Wall Texture
  const wallCanvas = document.createElement('canvas');
  wallCanvas.width = 512;
  wallCanvas.height = 512;
  const wCtx = wallCanvas.getContext('2d')!;
  const wallGrad = wCtx.createLinearGradient(0, 0, 0, 512);
  wallGrad.addColorStop(0, '#475569');
  wallGrad.addColorStop(0.55, '#334155');
  wallGrad.addColorStop(1, '#1e293b');
  wCtx.fillStyle = wallGrad;
  wCtx.fillRect(0, 0, 512, 512);

  // Horizontal architectural Expansion Joints
  wCtx.fillStyle = '#0f172a';
  wCtx.fillRect(0, 220, 512, 10);
  wCtx.fillRect(0, 440, 512, 12);

  // Recessed armored bays
  for (let x = 0; x < 512; x += 128) {
    wCtx.fillStyle = '#1e293b';
    wCtx.fillRect(x, 0, 6, 512);
    wCtx.fillStyle = '#0f172a';
    wCtx.fillRect(x + 14, 28, 100, 174);
    wCtx.fillStyle = '#3b495e';
    wCtx.fillRect(x + 18, 32, 92, 166);

    // Lower bay panel
    wCtx.fillStyle = '#0f172a';
    wCtx.fillRect(x + 14, 246, 100, 176);
    wCtx.fillStyle = '#2d3a4d';
    wCtx.fillRect(x + 18, 250, 92, 168);
  }

  // Crisp high-visibility tactical hazard stripe along base
  wCtx.fillStyle = '#f97316';
  wCtx.fillRect(0, 462, 512, 10);
  wCtx.fillStyle = '#38bdf8';
  wCtx.fillRect(0, 10, 512, 4);

  const wallTex = new THREE.CanvasTexture(wallCanvas);
  wallTex.colorSpace = THREE.SRGBColorSpace;
  wallTex.wrapS = THREE.RepeatWrapping;
  wallTex.wrapT = THREE.RepeatWrapping;
  wallTex.repeat.set(4, 1);
  wallTex.anisotropy = maxAniso;
  textures.push(wallTex);

  // 3. Radianite Tactical Containment Crate Texture
  const crateCanvas = document.createElement('canvas');
  crateCanvas.width = 256;
  crateCanvas.height = 256;
  const cCtx = crateCanvas.getContext('2d')!;
  cCtx.fillStyle = '#0f766e';
  cCtx.fillRect(0, 0, 256, 256);
  cCtx.strokeStyle = '#2dd4bf';
  cCtx.lineWidth = 8;
  cCtx.strokeRect(10, 10, 236, 236);
  cCtx.fillStyle = '#115e59';
  cCtx.fillRect(24, 24, 208, 208);
  cCtx.strokeStyle = '#5eead4';
  cCtx.lineWidth = 4;
  cCtx.beginPath();
  cCtx.moveTo(24, 24);
  cCtx.lineTo(232, 232);
  cCtx.moveTo(232, 24);
  cCtx.lineTo(24, 232);
  cCtx.stroke();
  cCtx.fillStyle = '#042f2e';
  cCtx.fillRect(96, 96, 64, 64);
  cCtx.strokeStyle = '#2dd4bf';
  cCtx.lineWidth = 3;
  cCtx.strokeRect(96, 96, 64, 64);

  const crateTex = new THREE.CanvasTexture(crateCanvas);
  crateTex.colorSpace = THREE.SRGBColorSpace;
  crateTex.anisotropy = maxAniso;
  textures.push(crateTex);

  // 4. Heavy Ordnance Industrial Crate Texture (Warm Amber/Bronze)
  const ordCanvas = document.createElement('canvas');
  ordCanvas.width = 256;
  ordCanvas.height = 256;
  const oCtx = ordCanvas.getContext('2d')!;
  oCtx.fillStyle = '#b45309';
  oCtx.fillRect(0, 0, 256, 256);
  oCtx.strokeStyle = '#f59e0b';
  oCtx.lineWidth = 8;
  oCtx.strokeRect(10, 10, 236, 236);
  oCtx.fillStyle = '#92400e';
  oCtx.fillRect(26, 26, 204, 204);
  for (let y = 44; y < 210; y += 36) {
    oCtx.fillStyle = '#78350f';
    oCtx.fillRect(34, y, 188, 18);
  }
  oCtx.fillStyle = '#fbbf24';
  oCtx.fillRect(34, 118, 188, 16);

  const ordTex = new THREE.CanvasTexture(ordCanvas);
  ordTex.colorSpace = THREE.SRGBColorSpace;
  ordTex.anisotropy = maxAniso;
  textures.push(ordTex);

  // 5. Atmospheric Twilight Sky Dome Texture (Rich zenith-to-horizon gradient)
  const skyCanvas = document.createElement('canvas');
  skyCanvas.width = 512;
  skyCanvas.height = 256;
  const sCtx = skyCanvas.getContext('2d')!;
  const skyGrad = sCtx.createLinearGradient(0, 0, 0, 256);
  skyGrad.addColorStop(0.0, '#070b16');
  skyGrad.addColorStop(0.32, '#0f1c36');
  skyGrad.addColorStop(0.46, '#1e3a5f');
  skyGrad.addColorStop(0.52, '#3b2d54');
  skyGrad.addColorStop(0.57, '#7c2d3e');
  skyGrad.addColorStop(0.62, '#1e293b');
  skyGrad.addColorStop(1.0, '#090d16');
  sCtx.fillStyle = skyGrad;
  sCtx.fillRect(0, 0, 512, 256);

  // Subtle stars & high-altitude atmospheric bands in upper hemisphere
  for (let i = 0; i < 140; i++) {
    const sx = Math.random() * 512;
    const sy = Math.random() * 110;
    sCtx.fillStyle = i % 5 === 0 ? 'rgba(56, 189, 248, 0.55)' : 'rgba(248, 250, 252, 0.45)';
    sCtx.fillRect(sx, sy, 1.5, 1.5);
  }

  const skyTex = new THREE.CanvasTexture(skyCanvas);
  skyTex.colorSpace = THREE.SRGBColorSpace;
  textures.push(skyTex);

  const floorMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: floorTex,
    bumpMap: floorBumpTex,
    bumpScale: 0.015,
    roughness: 0.72,
    metalness: 0.18,
  });

  const wallMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: wallTex,
    bumpMap: floorBumpTex,
    bumpScale: 0.01,
    roughness: 0.62,
    metalness: 0.24,
  });

  const accentWallMat = new THREE.MeshStandardMaterial({
    color: 0x3b495e,
    roughness: 0.48,
    metalness: 0.38,
  });

  const crateMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: ordTex,
    roughness: 0.55,
    metalness: 0.28,
  });

  const radianiteCrateMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: crateTex,
    roughness: 0.36,
    metalness: 0.45,
    emissive: 0x0d9488,
    emissiveIntensity: 0.16,
  });

  const trimMetalMat = new THREE.MeshStandardMaterial({
    color: 0x334155,
    roughness: 0.54,
    metalness: 0.55,
  });

  const darkHullMat = new THREE.MeshStandardMaterial({
    color: 0x1e293b,
    roughness: 0.68,
    metalness: 0.28,
  });

  const obeliskCoreMat = new THREE.MeshStandardMaterial({
    color: 0x38bdf8,
    roughness: 0.18,
    metalness: 0.65,
    emissive: 0x0284c7,
    emissiveIntensity: 0.52,
  });

  const cliffRockMat = new THREE.MeshStandardMaterial({
    color: 0x1e2636,
    roughness: 0.88,
    metalness: 0.08,
  });

  const skyDomeMat = new THREE.MeshBasicMaterial({
    map: skyTex,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });

  materials.push(
    floorMat,
    wallMat,
    accentWallMat,
    crateMat,
    radianiteCrateMat,
    trimMetalMat,
    darkHullMat,
    obeliskCoreMat,
    cliffRockMat,
    skyDomeMat
  );

  return {
    floorMat,
    wallMat,
    accentWallMat,
    crateMat,
    radianiteCrateMat,
    trimMetalMat,
    darkHullMat,
    obeliskCoreMat,
    cliffRockMat,
    skyDomeMat,
    dispose: () => {
      textures.forEach((t) => t.dispose());
      materials.forEach((m) => m.dispose());
    },
  };
}
