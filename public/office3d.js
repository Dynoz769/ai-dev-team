// 3D AI Office: chibi workers at two rows of desks in a dark, warmly lit office, with a
// meeting table in front. Each worker's pose, screen, bubble and desk panel show what
// they are doing right now, and they walk to the table for meetings.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { CSS2DRenderer, CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";

const PI = Math.PI;
const lerp = (a, b, t) => a + (b - a) * t;

// ---------- layout ----------
// Two rows of three desks facing the camera. [x, z] is where the worker sits.
const DESKS = {
  product: [-5, -5.6], design: [0, -5.6], techlead: [5, -5.6],
  backend: [-5, 0], frontend: [0, 0], qa: [5, 0],
};
const TABLE = new THREE.Vector3(0, 0, 5.8);
const SEAT_R = 2.15;
const ARC_R = 3.3; // walking ring around the table
const AISLE_Z = 2.2; // walkway between the front desks and the table
// Seat angle around the table (0 = toward the camera). Back row takes the far side.
const SEAT_ANGLE = { product: 235, design: 180, techlead: 125, backend: 300, frontend: 0, qa: 60 };

// Looks based on the reference: black hair, big eyes, glasses, dark clothes.
const LOOKS = {
  product: { skin: 0xf1c9a6, hair: "short", glasses: true, top: 0x4b5058, female: false },
  design: { skin: 0xf3cdb3, hair: "long", glasses: false, top: 0xe9a3b8, female: true },
  techlead: { skin: 0xe9bf98, hair: "short", glasses: true, top: 0x1e2126, female: false },
  backend: { skin: 0xe6b893, hair: "messy", glasses: true, top: 0x2b2f37, female: false },
  frontend: { skin: 0xefc6a2, hair: "messy", glasses: false, top: 0x202328, female: false },
  qa: { skin: 0xf2ccb0, hair: "long", glasses: true, top: 0x26272c, female: true },
};
const HAIR = 0x0b0b0c;

// ---------- small helpers ----------
const mat = (color, opts = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.75, metalness: 0.05, ...opts });
function mesh(geo, material, { x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, shadow = true } = {}) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  m.castShadow = shadow;
  m.receiveShadow = true;
  return m;
}
const box = (w, h, d, material, o) => mesh(new THREE.BoxGeometry(w, h, d), material, o);
const cyl = (rt, rb, h, material, o, seg = 24) => mesh(new THREE.CylinderGeometry(rt, rb, h, seg), material, o);
const sph = (r, material, o, seg = 24) => mesh(new THREE.SphereGeometry(r, seg, seg), material, o);
const capsule = (r, len, material, o) => mesh(new THREE.CapsuleGeometry(r, len, 8, 16), material, o);
const scaled = (m, x, y, z) => (m.scale.set(x, y, z), m);

function canvasTexture(w, h, draw) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const ctx = c.getContext("2d");
  draw(ctx, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return { tex: t, ctx, canvas: c };
}

function plant(x, z, s = 1) {
  const g = new THREE.Group();
  g.add(cyl(0.32, 0.24, 0.55, mat(0xd9d4cc), { y: 0.27 }));
  const leaf = mat(0x2f7d43, { roughness: 0.8 });
  const leaf2 = mat(0x3f9a55, { roughness: 0.8 });
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * PI * 2;
    const l = sph(0.28, i % 2 ? leaf : leaf2, { x: Math.cos(a) * 0.25, y: 0.75 + Math.random() * 0.5, z: Math.sin(a) * 0.25 }, 12);
    l.scale.set(0.7, 1.4, 0.4);
    l.rotation.set(Math.sin(a) * 0.6, a, Math.cos(a) * 0.6);
    g.add(l);
  }
  g.position.set(x, 0, z);
  g.scale.setScalar(s);
  return g;
}

// ---------- room ----------
function buildRoom(scene) {
  // Dark grey stone tiles.
  const floor = canvasTexture(1024, 1024, (g, w, h) => {
    const tile = 128;
    for (let y = 0; y < h; y += tile) for (let x = 0; x < w; x += tile) {
      const l = 17 + Math.random() * 4;
      g.fillStyle = `hsl(220, 6%, ${l}%)`;
      g.fillRect(x, y, tile, tile);
      for (let i = 0; i < 40; i++) {
        g.fillStyle = `rgba(255,255,255,${Math.random() * 0.03})`;
        g.fillRect(x + Math.random() * tile, y + Math.random() * tile, 2, 2);
      }
      g.strokeStyle = "rgba(0,0,0,.45)"; g.lineWidth = 3; g.strokeRect(x, y, tile, tile);
    }
  });
  floor.tex.wrapS = floor.tex.wrapT = THREE.RepeatWrapping;
  floor.tex.repeat.set(3, 2.2);
  scene.add(mesh(new THREE.PlaneGeometry(24, 19), mat(0xffffff, { map: floor.tex, roughness: 0.45, metalness: 0.1 }), { rx: -PI / 2, z: 1.5, shadow: false }));

  const wallMat = mat(0x24221f, { roughness: 0.85 });
  scene.add(box(24, 5, 0.3, wallMat, { y: 2.5, z: -7.9 }));
  scene.add(box(0.3, 5, 17, wallMat, { x: -12, y: 2.5, z: 0.5 }));

  // Back wall feature panel with sign and LED strip, like a reception wall.
  scene.add(box(8.5, 3.2, 0.12, mat(0x15161a, { roughness: 0.6 }), { y: 2.3, z: -7.68 }));
  scene.add(box(8.5, 0.05, 0.08, new THREE.MeshBasicMaterial({ color: 0xffe2b0 }), { y: 3.93, z: -7.62, shadow: false }));
  scene.add(box(8.5, 0.05, 0.08, new THREE.MeshBasicMaterial({ color: 0xffd59a }), { y: 0.7, z: -7.62, shadow: false }));
  const sign = canvasTexture(1024, 320, (g, w, h) => {
    g.fillStyle = "#15161a"; g.fillRect(0, 0, w, h);
    g.strokeStyle = "#e8eeff"; g.lineWidth = 6;
    g.strokeRect(150, 105, 60, 60); g.strokeRect(175, 130, 60, 60); // logo
    g.font = "600 84px Inter, Segoe UI, sans-serif"; g.fillStyle = "#f2f4f8"; g.textAlign = "left";
    g.fillText("AI Dev Team", 270, 175);
    g.font = "36px Inter, Segoe UI, sans-serif"; g.fillStyle = "#c9cfdb"; g.textAlign = "center";
    g.fillText("Build it together.", w / 2, 250);
  });
  scene.add(mesh(new THREE.PlaneGeometry(5.6, 1.75), new THREE.MeshBasicMaterial({ map: sign.tex }), { y: 2.45, z: -7.6, shadow: false }));
  const signLight = new THREE.PointLight(0xffe0b8, 8, 7, 2);
  signLight.position.set(0, 3.6, -6.8);
  scene.add(signLight);

  // Left wall: lit glass panel with words.
  const words = canvasTexture(256, 512, (g, w, h) => {
    const grd = g.createLinearGradient(0, 0, w, h);
    grd.addColorStop(0, "#3b4a63"); grd.addColorStop(1, "#1f2735");
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
    g.font = "600 44px Inter, Segoe UI, sans-serif"; g.fillStyle = "#e8eeff";
    ["Focus", "Build", "Improve", "Repeat"].forEach((t, i) => g.fillText(t, 26, 120 + i * 70));
  });
  scene.add(mesh(new THREE.PlaneGeometry(4, 3.2), new THREE.MeshBasicMaterial({ map: words.tex }), { x: -11.83, y: 2.2, z: -2.5, ry: PI / 2, shadow: false }));

  // Right side: glass wall with frosted words.
  const glass = new THREE.MeshPhysicalMaterial({ color: 0xa8c4e6, transparent: true, opacity: 0.12, roughness: 0.15, side: THREE.DoubleSide });
  scene.add(mesh(new THREE.PlaneGeometry(13, 4.6), glass, { x: 11.5, y: 2.3, z: -1.3, ry: -PI / 2, shadow: false }));
  for (let z = -7.5; z <= 5; z += 2.5) scene.add(box(0.08, 4.6, 0.08, mat(0x2a2c31, { metalness: 0.6 }), { x: 11.5, y: 2.3, z, shadow: false }));
  const glassText = canvasTexture(512, 512, (g) => {
    g.font = "600 64px Inter, Segoe UI, sans-serif"; g.fillStyle = "rgba(240,244,255,.85)";
    ["Better", "Code,", "Happier", "Teams"].forEach((t, i) => g.fillText(t, 30, 110 + i * 95));
  });
  scene.add(mesh(new THREE.PlaneGeometry(3.2, 3.2), new THREE.MeshBasicMaterial({ map: glassText.tex, transparent: true }), { x: 11.42, y: 2.6, z: -3.5, ry: -PI / 2, shadow: false }));

  // Shelves with decor on both sides of the feature wall.
  const shelfMat = mat(0x3a2d22);
  for (const sx of [-7.6, 7.6]) {
    scene.add(box(2.4, 3.8, 0.45, mat(0x1a1715), { x: sx, y: 1.9, z: -7.5 }));
    for (let r = 0; r < 4; r++) {
      const y = 0.55 + r * 0.9;
      scene.add(box(2.2, 0.06, 0.4, shelfMat, { x: sx, y, z: -7.35 }));
      // books, boxes and small pots
      let x = sx - 0.95;
      while (x < sx + 0.9) {
        const kind = Math.random();
        if (kind < 0.5) {
          const bw = 0.07 + Math.random() * 0.06, bh = 0.3 + Math.random() * 0.2;
          scene.add(box(bw, bh, 0.3, mat(new THREE.Color().setHSL(0.08, 0.15, 0.25 + Math.random() * 0.3)), { x: x + bw / 2, y: y + bh / 2 + 0.03, z: -7.35, shadow: false }));
          x += bw + 0.01;
        } else if (kind < 0.7) {
          scene.add(cyl(0.09, 0.07, 0.18, mat(0xd8d2c8), { x: x + 0.1, y: y + 0.12, z: -7.35, shadow: false }, 12));
          x += 0.3;
        } else x += 0.25;
      }
    }
    // Warm shelf light.
    const l = new THREE.PointLight(0xffc98a, 3, 3, 2);
    l.position.set(sx, 3.6, -6.9);
    scene.add(l);
  }

  // Whiteboard on an easel behind the designer.
  const wb = new THREE.Group();
  const notes = canvasTexture(256, 320, (g, w, h) => {
    g.fillStyle = "#f4f2ec"; g.fillRect(0, 0, w, h);
    const colors = ["#ffd166", "#8ce0b5", "#9fb5ff", "#ff9fb5"];
    for (let i = 0; i < 9; i++) { g.fillStyle = colors[i % 4]; g.fillRect(20 + (i % 3) * 75, 30 + Math.floor(i / 3) * 90, 60, 55); }
    g.strokeStyle = "#555"; g.lineWidth = 2;
    g.beginPath(); g.moveTo(20, 300); g.lineTo(236, 300); g.stroke();
  });
  wb.add(mesh(new THREE.PlaneGeometry(1.4, 1.75), new THREE.MeshStandardMaterial({ map: notes.tex, roughness: 0.6 }), { y: 2.1, z: 0.03 }));
  wb.add(box(1.5, 1.85, 0.05, mat(0xb08a62), { y: 2.1 }));
  for (const lx of [-0.6, 0.6]) wb.add(box(0.06, 2.6, 0.06, mat(0xb08a62), { x: lx, y: 1.3, z: -0.1 }));
  wb.position.set(2.3, 0, -7.35);
  wb.rotation.y = -0.15;
  scene.add(wb);

  // Lounge corner at the front right.
  const sofaMat = mat(0x8d8f94, { roughness: 0.95 });
  const sofa = new THREE.Group();
  sofa.add(box(1.4, 0.45, 1.1, sofaMat, { y: 0.35 }));
  sofa.add(box(1.4, 0.8, 0.3, sofaMat, { y: 0.75, z: -0.45 }));
  for (const s of [-1, 1]) sofa.add(box(0.25, 0.65, 1.1, sofaMat, { x: s * 0.7, y: 0.45 }));
  sofa.position.set(9.6, 0, 3.6);
  sofa.rotation.y = -PI / 2.4;
  scene.add(sofa);
  scene.add(cyl(0.65, 0.65, 0.06, mat(0x1c1c1c, { metalness: 0.3 }), { x: 8.2, y: 0.5, z: 5.2 }, 32));
  scene.add(cyl(0.05, 0.05, 0.5, mat(0x1c1c1c), { x: 8.2, y: 0.25, z: 5.2 }, 8));
  scene.add(box(0.5, 0.06, 0.35, mat(0xe9e4da), { x: 8.1, y: 0.56, z: 5.1, ry: 0.4 }));

  // Plants.
  for (const [x, z, s] of [[-10.8, -7.1, 1.5], [10.6, -7.1, 1.4], [-4.6, -7.2, 1.2], [4.6, -7.2, 1.1], [-11, 6.5, 1.5], [10.8, 7, 1.4], [10.9, -0.5, 1.3]]) {
    scene.add(plant(x, z, s));
  }

  // Warm lights over desks and the table.
  for (const [x, z] of [...Object.values(DESKS), [TABLE.x, TABLE.z]]) {
    const l = new THREE.PointLight(0xffcf96, x === 0 && z === TABLE.z ? 14 : 8, 6.5, 1.6);
    l.position.set(x, 3.6, z + 0.8);
    scene.add(l);
  }
}

// ---------- desk ----------
function buildDesk(scene, x, z, side) {
  const g = new THREE.Group();
  const wood = mat(0x8a6446, { roughness: 0.5 });
  const dark = mat(0x16181d, { roughness: 0.6 });
  const metal = mat(0x2a2d33, { metalness: 0.5, roughness: 0.4 });
  const silver = mat(0xc9ccd2, { metalness: 0.7, roughness: 0.3 });

  g.add(box(2.7, 0.08, 1.15, wood, { y: 0.92, z: 0.85 }));
  g.add(box(2.7, 0.86, 0.08, dark, { y: 0.45, z: 1.42 })); // front panel
  for (const lx of [-1.3, 1.3]) g.add(box(0.08, 0.88, 1.1, dark, { x: lx, y: 0.45, z: 0.85 }));

  // Name panel on the desk front (drawn on a canvas, like a status display).
  const card = canvasTexture(640, 160, () => {});
  g.add(mesh(new THREE.PlaneGeometry(2.4, 0.6), new THREE.MeshBasicMaterial({ map: card.tex, transparent: true }), { y: 0.5, z: 1.47, shadow: false }));

  // Main all-in-one monitor in front of the worker (screen faces them, silver back to us).
  const imac = new THREE.Group();
  imac.add(box(0.95, 0.56, 0.06, silver, {}));
  imac.add(box(0.88, 0.49, 0.01, mat(0x0a0c10, { emissive: 0x1c2a44, emissiveIntensity: 0.6 }), { z: -0.035, shadow: false }));
  imac.add(box(0.13, 0.22, 0.05, silver, { y: -0.36, z: 0.05, rx: 0.15 }));
  imac.add(box(0.32, 0.02, 0.24, silver, { y: -0.45, z: 0.05 }));
  imac.add(box(0.12, 0.12, 0.012, mat(0xe7e9ed, { metalness: 0.8 }), { y: 0.05, z: 0.035, shadow: false })); // logo plate
  imac.position.set(0, 1.41, 1.08);
  g.add(imac);

  // Side monitor angled toward the camera: this one shows what they're doing.
  const mon = new THREE.Group();
  mon.add(box(0.95, 0.6, 0.05, mat(0x15171c, { metalness: 0.3 }), {}));
  const screen = canvasTexture(256, 160, () => {});
  mon.add(mesh(new THREE.PlaneGeometry(0.88, 0.53), new THREE.MeshBasicMaterial({ map: screen.tex }), { z: 0.03, shadow: false }));
  mon.add(box(0.06, 0.32, 0.06, metal, { y: -0.45, z: -0.03 }));
  mon.add(box(0.32, 0.03, 0.22, metal, { y: -0.6, z: -0.03 }));
  mon.position.set(side * 1.0, 1.57, 0.7);
  mon.rotation.y = -side * PI * 0.32;
  g.add(mon);
  const glow = new THREE.PointLight(0x7fa8ff, 0, 2.2, 2);
  glow.position.set(side * 0.6, 1.5, 0.5);
  g.add(glow);

  g.add(box(0.75, 0.03, 0.22, mat(0xe3e5e9), { y: 0.975, z: 0.5 })); // keyboard
  g.add(box(0.1, 0.03, 0.16, mat(0xe3e5e9), { x: -side * 0.55, y: 0.975, z: 0.5 })); // mouse
  g.add(cyl(0.075, 0.065, 0.16, mat(0xf2efe9), { x: -side * 0.95, y: 1.04, z: 0.55 })); // mug
  const p = plant(-side * 1.05, 1.15, 0.35);
  p.position.y = 0.96;
  g.add(p);
  // Small warm desk candle/lamp like in the reference.
  g.add(sph(0.05, new THREE.MeshBasicMaterial({ color: 0xffc56b }), { x: -side * 0.75, y: 1.0, z: 1.1, shadow: false }, 10));

  // Chair.
  const chair = new THREE.Group();
  const fabric = mat(0x1f2229, { roughness: 0.9 });
  chair.add(box(0.72, 0.1, 0.65, fabric, { y: 0.5 }));
  chair.add(box(0.72, 0.85, 0.1, fabric, { y: 1.0, z: -0.36 }));
  chair.add(cyl(0.04, 0.04, 0.45, metal, { y: 0.25 }, 8));
  chair.add(cyl(0.35, 0.35, 0.04, metal, { y: 0.04 }, 5));
  g.add(chair);

  g.position.set(x, 0, z);
  scene.add(g);
  return { group: g, screen, glow, card, cardKey: "" };
}

function drawCard(card, name, label, busy) {
  const g = card.ctx, W = 640, H = 160;
  g.clearRect(0, 0, W, H);
  g.fillStyle = "rgba(14,16,20,.95)";
  g.beginPath(); g.roundRect(4, 4, W - 8, H - 8, 18); g.fill();
  g.fillStyle = busy ? "#f5b942" : "#3ccf8e";
  g.shadowColor = g.fillStyle; g.shadowBlur = 18;
  g.beginPath(); g.arc(58, 80, 17, 0, PI * 2); g.fill();
  g.shadowBlur = 0;
  g.fillStyle = "#f2f4f8"; g.font = "600 46px Inter, Segoe UI, sans-serif";
  g.fillText(name, 100, 70);
  g.fillStyle = "#aab2c2"; g.font = "34px Inter, Segoe UI, sans-serif";
  let text = label;
  while (g.measureText(text).width > W - 130 && text.length > 3) text = text.slice(0, -2);
  if (text !== label) text = text.slice(0, -1) + "…";
  g.fillText(text, 100, 120);
  card.tex.needsUpdate = true;
}

function buildMeetingTable(scene) {
  const g = new THREE.Group();
  const wood = mat(0x6e4a32, { roughness: 0.4 });
  g.add(cyl(1.35, 1.35, 0.1, wood, { y: 0.88 }, 48));
  g.add(cyl(0.2, 0.3, 0.85, mat(0x1c1e22, { metalness: 0.5 }), { y: 0.43 }));
  g.add(cyl(0.7, 0.7, 0.05, mat(0x1c1e22, { metalness: 0.5 }), { y: 0.03 }));
  g.add(box(0.5, 0.02, 0.35, mat(0xbfc5cf, { metalness: 0.6 }), { y: 0.95, x: 0.3, z: 0.2, ry: 0.4 }));
  g.add(box(0.35, 0.01, 0.45, mat(0xf3f1ec), { y: 0.94, x: -0.4, z: -0.3, ry: -0.3 }));
  g.add(cyl(0.06, 0.05, 0.14, mat(0xf2efe9), { y: 1.0, x: -0.1, z: 0.5 }, 12));
  const fabric = mat(0x2a2d36, { roughness: 0.9 });
  for (const a of Object.values(SEAT_ANGLE)) {
    const r = (a * PI) / 180;
    const c = new THREE.Group();
    c.add(box(0.62, 0.08, 0.56, fabric, { y: 0.5 }));
    c.add(box(0.62, 0.65, 0.08, fabric, { y: 0.88, z: -0.31 }));
    c.add(cyl(0.04, 0.04, 0.45, mat(0x1c1e22), { y: 0.25 }, 8));
    c.position.set(Math.sin(r) * (SEAT_R + 0.05), 0, Math.cos(r) * (SEAT_R + 0.05));
    c.rotation.y = Math.atan2(-c.position.x, -c.position.z);
    g.add(c);
  }
  scene.add(mesh(new THREE.CircleGeometry(3.4, 48), mat(0x2b2e36, { roughness: 1 }), { rx: -PI / 2, y: 0.01, x: TABLE.x, z: TABLE.z, shadow: false }));
  g.position.copy(TABLE);
  scene.add(g);
}

// ---------- character ----------
// Chibi style from the reference: big round head, big glossy eyes, black hair,
// thick black glasses, dark hoodie/top, small body.
function buildCharacter(look) {
  const skin = mat(look.skin, { roughness: 0.55 });
  const skinShade = mat(new THREE.Color(look.skin).multiplyScalar(0.9), { roughness: 0.6 });
  const hairM = new THREE.MeshPhysicalMaterial({ color: HAIR, roughness: 0.45, metalness: 0, clearcoat: 0.3, clearcoatRoughness: 0.5 });
  const top = mat(look.top, { roughness: 0.85 });
  const topDark = mat(new THREE.Color(look.top).multiplyScalar(0.8), { roughness: 0.85 });
  const pants = mat(0x1d2027, { roughness: 0.9 });
  const black = mat(0x0b0b0b, { roughness: 0.3 });
  const white = mat(0xffffff, { roughness: 0.2 });

  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const HIP = 0.72;

  const legs = [];
  for (const s of [-1, 1]) {
    const hip = new THREE.Group();
    hip.position.set(s * 0.14, HIP, 0);
    hip.add(capsule(0.11, 0.2, pants, { y: -0.16 }));
    const knee = new THREE.Group();
    knee.position.y = -0.33;
    knee.add(capsule(0.1, 0.2, pants, { y: -0.16 }));
    knee.add(scaled(sph(0.12, mat(0xf2f2f2), { y: -0.34, z: 0.06 }, 12), 1, 0.6, 1.5)); // sneakers
    hip.add(knee);
    body.add(hip);
    legs.push({ hip, knee });
  }

  // Torso: small rounded top with a hood at the back.
  body.add(scaled(capsule(0.3, 0.3, top, { y: HIP + 0.33 }), 1.05, 1, 0.85));
  body.add(scaled(sph(0.24, topDark, { y: HIP + 0.66, z: -0.16 }, 16), 1.3, 0.7, 0.8)); // hood
  if (!look.female) for (const s of [-1, 1]) body.add(cyl(0.012, 0.012, 0.2, mat(0xdddddd), { x: s * 0.07, y: HIP + 0.5, z: 0.25 }, 6));
  body.add(scaled(sph(0.11, skin, { y: HIP + 0.66, z: 0.03 }, 12), 1, 0.7, 1)); // neck

  const arms = [];
  for (const s of [-1, 1]) {
    const sh = new THREE.Group();
    sh.position.set(s * 0.36, HIP + 0.58, 0);
    sh.add(capsule(0.095, 0.16, top, { y: -0.13 }));
    const el = new THREE.Group();
    el.position.y = -0.28;
    el.add(capsule(0.085, 0.14, top, { y: -0.1 }));
    el.add(sph(0.09, skin, { y: -0.27 }, 14));
    sh.add(el);
    body.add(sh);
    arms.push({ sh, el, side: s });
  }

  // Head.
  const neck = new THREE.Group();
  neck.position.y = HIP + 0.74;
  body.add(neck);
  const head = new THREE.Group();
  head.position.y = 0.52;
  neck.add(head);
  const R = 0.56;
  head.add(scaled(sph(R, skin, {}, 40), 1.04, 0.98, 1));
  for (const s of [-1, 1]) head.add(scaled(sph(0.1, skinShade, { x: s * 0.57, y: -0.03 }, 12), 0.6, 1, 0.8)); // ears
  head.add(scaled(sph(0.05, skinShade, { y: -0.1, z: 0.555 }, 12), 1.1, 0.8, 0.7)); // nose

  // Big glossy eyes: white, dark brown iris, pupil, two highlights.
  const eyes = new THREE.Group();
  for (const s of [-1, 1]) {
    const ex = s * 0.2;
    eyes.add(scaled(sph(0.12, white, { x: ex, y: 0.0, z: 0.49 }, 20), 1, 1.12, 0.45));
    eyes.add(scaled(sph(0.088, mat(0x3a2414, { roughness: 0.2 }), { x: ex, y: -0.005, z: 0.525 }, 20), 1, 1.08, 0.4));
    eyes.add(scaled(sph(0.05, black, { x: ex, y: -0.005, z: 0.545 }, 16), 1, 1.08, 0.35));
    eyes.add(sph(0.026, white, { x: ex + 0.035, y: 0.04, z: 0.565, shadow: false }, 10));
    eyes.add(sph(0.012, white, { x: ex - 0.03, y: -0.04, z: 0.565, shadow: false }, 8));
    // Thick dark brows and a hint of lashes.
    eyes.add(box(0.17, 0.035, 0.03, hairM, { x: ex, y: 0.17, z: 0.51, rz: s * -0.1 }));
    if (look.female) eyes.add(box(0.2, 0.025, 0.03, black, { x: ex + s * 0.01, y: 0.11, z: 0.54, rz: s * -0.2 }));
    head.add(scaled(sph(0.08, mat(0xff8f8f, { transparent: true, opacity: 0.3 }), { x: s * 0.3, y: -0.16, z: 0.45 }, 10), 1, 0.55, 0.4)); // blush
  }
  head.add(eyes);
  const mouth = mesh(new THREE.TorusGeometry(0.065, 0.016, 8, 20, PI), mat(0x7a3b30), { y: -0.24, z: 0.53, rz: PI });
  head.add(mouth);

  if (look.glasses) {
    const frame = mat(0x0d0d0d, { metalness: 0.3, roughness: 0.35 });
    for (const s of [-1, 1]) {
      const ring = mesh(new THREE.TorusGeometry(0.15, 0.028, 10, 32), frame, { x: s * 0.2, y: 0.0, z: 0.6 });
      ring.scale.set(1.12, 0.92, 1);
      head.add(ring);
      head.add(box(0.03, 0.03, 0.5, frame, { x: s * 0.37, y: 0.03, z: 0.36, ry: s * 0.15 })); // temples
      head.add(mesh(new THREE.CircleGeometry(0.15, 24), new THREE.MeshPhysicalMaterial({ color: 0xffffff, transparent: true, opacity: 0.08, roughness: 0 }), { x: s * 0.2, z: 0.6, shadow: false }));
    }
    head.add(box(0.1, 0.03, 0.03, frame, { y: 0.02, z: 0.6 })); // bridge
  }

  // Hair: smooth glossy black "helmet" with soft bangs, like the reference.
  head.add(scaled(mesh(new THREE.SphereGeometry(R + 0.05, 48, 24, 0, PI * 2, 0, PI * 0.5), hairM, { y: 0.06, rx: -0.42 }), 1.07, 1.06, 1.05));
  // Back of the head.
  head.add(scaled(sph(R + 0.03, hairM, { y: 0.0, z: -0.08 }, 32), 1.05, 1.0, 0.98));
  // Bangs: overlapping flattened lobes across the forehead.
  const bang = (x, y, z, rz, w = 0.2) => head.add(scaled(sph(w, hairM, { x, y, z, rz }, 24), 1.25, 0.6, 0.5));
  if (look.hair === "long") {
    bang(-0.24, 0.36, 0.42, 0.45); bang(0, 0.4, 0.45, 0); bang(0.24, 0.36, 0.42, -0.45);
    // Long straight hair down to the shoulders, framing the face.
    head.add(scaled(capsule(0.42, 0.55, hairM, { y: -0.42, z: -0.2 }), 1.35, 1, 0.75));
    for (const sd of [-1, 1]) head.add(scaled(capsule(0.17, 0.55, hairM, { x: sd * 0.52, y: -0.42, z: 0.1 }), 1, 1, 0.8));
  } else {
    // Swept fringe to one side plus a few soft spikes on top.
    bang(-0.26, 0.36, 0.4, 0.6); bang(-0.04, 0.4, 0.45, 0.4); bang(0.2, 0.38, 0.43, 0.3);
    const spikes = look.hair === "messy" ? [[-0.15, 0.1], [0.12, 0.0], [0.0, -0.2], [0.25, -0.15], [-0.28, -0.1]] : [[0.05, 0.05], [-0.15, -0.1]];
    for (const [x, z] of spikes) {
      const c = mesh(new THREE.ConeGeometry(0.15, 0.22, 16), hairM, { x, y: 0.57, z, rx: z * 1.2 - 0.2, rz: -x * 1.4 });
      head.add(c);
    }
    for (const sd of [-1, 1]) head.add(scaled(sph(0.15, hairM, { x: sd * 0.52, y: 0.12, z: 0.1 }, 16), 0.5, 1.1, 0.9)); // sideburns
  }

  const mug = cyl(0.065, 0.055, 0.14, mat(0xf2efe9), { y: -0.33, z: 0.05 });
  mug.visible = false;
  arms[1].el.add(mug);

  const anchor = new THREE.Object3D();
  anchor.position.y = 0.85;
  head.add(anchor);

  return { root, body, legs, arms, neck, head, eyes, mouth, mug, anchor };
}

const CODE_COLORS = ["#c792ea", "#82aaff", "#c3e88d", "#ffcb6b", "#89ddff", "#f78c6c"];
function drawScreen(s, mode, activity, t) {
  const g = s.ctx, W = 256, H = 160;
  g.fillStyle = "#0d1117"; g.fillRect(0, 0, W, H);
  if (mode === "coding") {
    for (let i = 0; i < 9; i++) {
      const w = 40 + ((i * 53) % 140);
      const indent = (i % 3) * 14;
      const progress = i === 8 ? ((t * 60) % w) : w;
      g.fillStyle = CODE_COLORS[i % CODE_COLORS.length];
      g.fillRect(14 + indent, 12 + i * 16, Math.max(0, progress - indent), 7);
    }
    if ((t * 2) % 1 < 0.5) { g.fillStyle = "#fff"; g.fillRect(14 + ((t * 60) % 150), 140, 3, 10); }
  } else if (mode === "reading") {
    const off = (t * 20) % 16;
    for (let i = 0; i < 12; i++) {
      g.fillStyle = i === 5 ? "#2b3550" : "transparent";
      g.fillRect(0, i * 16 - off, W, 16);
      g.fillStyle = "#6b7795";
      g.fillRect(14, i * 16 - off + 5, 60 + ((i * 37) % 150), 6);
    }
  } else if (mode === "running" || mode === "testing") {
    g.font = "bold 14px monospace";
    g.fillStyle = "#3ccf8e";
    g.fillText(("$ " + (activity || "").replace(/^\$ /, "")).slice(0, 26), 10, 22);
    if (mode === "testing") {
      const p = (t * 0.4) % 1;
      g.fillStyle = "#262d3d"; g.fillRect(10, 130, 236, 10);
      g.fillStyle = "#3ccf8e"; g.fillRect(10, 130, 236 * p, 10);
      g.font = "13px monospace";
      for (let i = 0; i < Math.floor(p * 5); i++) g.fillText(`✓ test ${i + 1} passed`, 10, 48 + i * 16);
    } else {
      g.font = "13px monospace"; g.fillStyle = "#9aa3b5";
      const n = Math.floor((t * 3) % 6);
      for (let i = 0; i < n; i++) g.fillText("> " + ["compiling…", "bundling…", "ok", "linting…", "done"][i % 5], 10, 48 + i * 16);
      if ((t * 2) % 1 < 0.5) { g.fillStyle = "#3ccf8e"; g.fillRect(10, 48 + n * 16 - 10, 8, 12); }
    }
  } else if (mode === "writing") {
    g.fillStyle = "#eef1f7"; g.fillRect(0, 0, W, H);
    g.fillStyle = "#3a4458"; g.font = "bold 16px sans-serif"; g.fillText("Spec", 14, 24);
    const lines = Math.floor((t * 2) % 9);
    g.fillStyle = "#9aa3b5";
    for (let i = 0; i < lines; i++) g.fillRect(14, 38 + i * 13, 70 + ((i * 41) % 150), 6);
  } else if (mode === "thinking") {
    g.fillStyle = "#1a2133"; g.fillRect(0, 0, W, H);
    for (let i = 0; i < 3; i++) {
      g.globalAlpha = 0.3 + 0.7 * Math.max(0, Math.sin(t * 4 - i * 0.8));
      g.fillStyle = "#9fb5ff"; g.beginPath(); g.arc(104 + i * 24, 80, 8, 0, PI * 2); g.fill();
    }
    g.globalAlpha = 1;
  } else {
    // idle / standby / away: calm dashboard screensaver.
    const grd = g.createLinearGradient(0, 0, W, H);
    grd.addColorStop(0, "#16203a"); grd.addColorStop(1, "#0d1117");
    g.fillStyle = grd; g.fillRect(0, 0, W, H);
    g.fillStyle = "rgba(127,162,255,.5)";
    for (let i = 0; i < 6; i++) {
      const h = 20 + 30 * (0.5 + 0.5 * Math.sin(t * 0.6 + i));
      g.fillRect(40 + i * 30, 130 - h, 18, h);
    }
    g.fillStyle = "rgba(232,238,255,.6)"; g.font = "bold 14px sans-serif"; g.fillText("AI Dev Team", 14, 24);
  }
  s.tex.needsUpdate = true;
}

// ---------- paths ----------
const angleOf = (p) => Math.atan2(p.x - TABLE.x, p.z - TABLE.z);
const onRing = (a, r = ARC_R) => new THREE.Vector3(TABLE.x + Math.sin(a) * r, 0, TABLE.z + Math.cos(a) * r);
/** Points along the shorter arc around the table, so nobody walks through it. */
function arc(fromAngle, toAngle) {
  let d = toAngle - fromAngle;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  const steps = Math.max(1, Math.ceil(Math.abs(d) / (PI / 5)));
  const pts = [];
  for (let i = 1; i <= steps; i++) pts.push(onRing(fromAngle + (d * i) / steps));
  return pts;
}

// ---------- the office ----------
export function createOffice3D(container, roles) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0d0e11);
  scene.fog = new THREE.Fog(0x0d0e11, 26, 45);

  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
  camera.position.set(0, 11.2, 17.5);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.45;
  container.appendChild(renderer.domElement);

  const labels = new CSS2DRenderer();
  labels.domElement.className = "labels3d";
  container.appendChild(labels.domElement);

  const controls = new OrbitControls(camera, labels.domElement);
  controls.target.set(0, 0.9, -0.6);
  controls.enableDamping = true;
  controls.enablePan = false;
  controls.minDistance = 7;
  controls.maxDistance = 28;
  controls.minPolarAngle = 0.3;
  controls.maxPolarAngle = 1.2;
  controls.minAzimuthAngle = -0.9;
  controls.maxAzimuthAngle = 0.9;

  scene.add(new THREE.HemisphereLight(0xe6e9ff, 0x4a3a2c, 1.5));
  const sun = new THREE.DirectionalLight(0xfff0dd, 1.4);
  sun.position.set(-5, 15, 9);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -13, right: 13, top: 10, bottom: -10, near: 1, far: 45 });
  sun.shadow.bias = -0.0005;
  scene.add(sun);

  const fill = new THREE.DirectionalLight(0xffe6cc, 0.9); // soft light on the faces
  fill.position.set(0, 6, 14);
  scene.add(fill);

  buildRoom(scene);
  buildMeetingTable(scene);

  const tableLabelEl = document.createElement("div");
  tableLabelEl.className = "table-label3d";
  const tableLabel = new CSS2DObject(tableLabelEl);
  tableLabel.position.set(TABLE.x, 2.9, TABLE.z);
  tableLabel.visible = false;
  scene.add(tableLabel);

  const agents = {};
  for (const r of roles) {
    const [dx, dz] = DESKS[r.id];
    const side = dx < 0 ? -1 : dx > 0 ? 1 : (dz < -1 ? 1 : -1);
    const desk = buildDesk(scene, dx, dz, side);
    const ch = buildCharacter(LOOKS[r.id] ?? LOOKS.techlead);
    ch.root.position.set(dx, 0, dz);
    scene.add(ch.root);

    const bubbleEl = document.createElement("div");
    bubbleEl.className = "bubble3d";
    bubbleEl.innerHTML = `<div class="bubble-anchor"><div class="bubble"></div></div>`;
    ch.anchor.add(new CSS2DObject(bubbleEl));

    // Walkway: step sideways into the aisle between desks, then forward to the ring.
    const aisleX = dx < 0 ? -2.5 : dx > 0 ? 2.5 : (SEAT_ANGLE[r.id] > 180 ? -2.5 : 2.5);
    const a = (SEAT_ANGLE[r.id] * PI) / 180;
    const seat = onRing(a, SEAT_R);
    const deskPos = new THREE.Vector3(dx, 0, dz);
    const aisleBack = new THREE.Vector3(aisleX, 0, dz - 0.1);
    const aisleFront = new THREE.Vector3(aisleX, 0, AISLE_Z);
    const ringIn = onRing(angleOf(aisleFront));
    const toTable = [aisleBack, aisleFront, ringIn, ...arc(angleOf(aisleFront), a), seat];
    const toDesk = [onRing(a), ...arc(a, angleOf(aisleFront)), aisleFront, aisleBack, deskPos];

    agents[r.id] = {
      name: r.name, ch, desk, side, bubbleEl,
      toTable, toDesk, seatFacing: Math.atan2(TABLE.x - seat.x, TABLE.z - seat.z),
      at: "desk", path: [], facing: 0,
      state: { mode: "idle", activity: "", label: "Free", talking: false, speech: "", atTable: false },
      phase: Math.random() * 10,
      lastScreen: 0,
    };
    drawCard(desk.card, r.name, "Free", false);
  }

  function resize() {
    const w = container.clientWidth, h = container.clientHeight;
    renderer.setSize(w, h);
    labels.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(container);
  resize();

  const timer = new THREE.Timer();
  const tmp = new THREE.Vector3();

  function setPose(ag, dt, t) {
    const { ch, state } = ag;
    const walking = ag.path.length > 0;
    const k = 1 - Math.pow(0.001, dt);
    const P = { hipX: [0, 0], kneeX: [0, 0], shX: [0, 0], shZ: [0.1, -0.1], elX: [0, 0], headX: 0, headY: 0, headZ: 0, bodyY: 0, bob: 0 };
    let mug = false;

    if (walking) {
      const w = t * 9;
      P.hipX = [Math.sin(w) * 0.55, -Math.sin(w) * 0.55];
      P.kneeX = [Math.max(0, -Math.sin(w)) * 0.8, Math.max(0, Math.sin(w)) * 0.8];
      P.shX = [-Math.sin(w) * 0.45, Math.sin(w) * 0.45];
      P.elX = [-0.3, -0.3];
      P.bob = Math.abs(Math.sin(w)) * 0.06;
    } else {
      P.hipX = [-PI / 2, -PI / 2];
      P.kneeX = [PI / 2, PI / 2];
      P.bodyY = -0.1;
      const m = state.mode;
      const atDesk = ag.at === "desk";
      if (atDesk && (m === "coding" || m === "writing" || m === "running" || m === "testing")) {
        const fast = m === "coding" || m === "writing" ? 22 : 6;
        P.shX = [-1.05 + Math.sin(t * fast) * 0.06, -1.05 + Math.sin(t * fast + 1.5) * 0.06];
        P.elX = [-0.75, -0.75];
        P.shZ = [0.25, -0.25];
        P.headX = 0.1;
        P.headY = m === "running" || m === "testing" ? ag.side * 0.4 : Math.sin(t * 0.4 + ag.phase) * 0.08;
      } else if (atDesk && m === "reading") {
        P.shX = [-0.9, -1.0];
        P.elX = [-0.7, -0.6];
        P.headX = 0.08 + Math.sin(t * 0.8) * 0.04;
        P.headY = ag.side * 0.45 + Math.sin(t * 1.3) * 0.1;
      } else if (m === "thinking") {
        P.shX = [-0.9, -1.15];
        P.elX = [-0.6, -2.3];
        P.shZ = [0.2, 0.15];
        P.headX = -0.18;
        P.headZ = Math.sin(t * 1.2) * 0.1;
        P.headY = Math.sin(t * 0.5) * 0.15;
      } else if (state.talking) {
        P.shX = [-0.9, -0.8 + Math.sin(t * 4) * 0.35];
        P.elX = [-0.6, -1.2 + Math.sin(t * 5) * 0.3];
        P.shZ = [0.15, -0.35];
        P.headX = Math.sin(t * 6) * 0.06;
        P.headZ = Math.sin(t * 2.3) * 0.06;
      } else if (m === "meeting") {
        P.shX = [-0.85, -0.85];
        P.elX = [-0.7, -0.7];
        P.headX = 0.05 + Math.max(0, Math.sin(t * 2.2 + ag.phase)) * 0.12;
      } else {
        const sip = m === "idle" && (t + ag.phase * 3) % 9 < 1.6;
        P.shX = [-0.8, sip ? -1.3 : -0.8];
        P.elX = [-0.6, sip ? -2.1 : -0.6];
        P.headX = sip ? -0.15 : 0.04 + Math.sin(t * 0.7 + ag.phase) * 0.03;
        P.headY = m === "standby" ? ag.side * 0.3 : Math.sin(t * 0.3 + ag.phase) * 0.25;
        mug = sip;
      }
    }

    if (!walking && ag.at === "table" && ag.lookAt && !state.talking) {
      tmp.copy(ag.lookAt).sub(ch.root.position);
      const yaw = Math.atan2(tmp.x, tmp.z) - ch.root.rotation.y;
      P.headY = Math.max(-0.9, Math.min(0.9, Math.atan2(Math.sin(yaw), Math.cos(yaw))));
    }

    ch.legs.forEach((l, i) => { l.hip.rotation.x = lerp(l.hip.rotation.x, P.hipX[i], k); l.knee.rotation.x = lerp(l.knee.rotation.x, P.kneeX[i], k); });
    ch.arms.forEach((a, i) => {
      a.sh.rotation.x = lerp(a.sh.rotation.x, P.shX[i], k);
      a.sh.rotation.z = lerp(a.sh.rotation.z, P.shZ[i], k);
      a.el.rotation.x = lerp(a.el.rotation.x, P.elX[i], k);
    });
    ch.head.rotation.x = lerp(ch.head.rotation.x, P.headX, k);
    ch.head.rotation.y = lerp(ch.head.rotation.y, P.headY, k);
    ch.head.rotation.z = lerp(ch.head.rotation.z, P.headZ, k);
    ch.body.position.y = lerp(ch.body.position.y, P.bodyY + P.bob, k * 1.5);
    ch.body.scale.y = 1 + Math.sin(t * 1.6 + ag.phase) * 0.008;
    ch.mug.visible = mug;
    const blink = (t + ag.phase) % 4.2 < 0.12;
    ch.eyes.scale.y = lerp(ch.eyes.scale.y, blink ? 0.1 : 1, 0.6);
    ch.mouth.scale.y = state.talking ? 1 + Math.abs(Math.sin(t * 14)) * 1.6 : 1;
  }

  function step(ag, dt) {
    const root = ag.ch.root;
    if (ag.path.length) {
      const target = ag.path[0];
      tmp.copy(target).sub(root.position).setY(0);
      const d = tmp.length();
      const speed = 2.8 * dt;
      if (d <= speed) {
        root.position.copy(target);
        ag.path.shift();
      } else {
        tmp.normalize();
        root.position.addScaledVector(tmp, speed);
        ag.facing = Math.atan2(tmp.x, tmp.z);
      }
      if (!ag.path.length) ag.facing = ag.at === "table" ? ag.seatFacing : 0;
    }
    let diff = ag.facing - root.rotation.y;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    root.rotation.y += diff * Math.min(1, dt * 8);
  }

  function frame() {
    timer.update();
    const dt = Math.min(timer.getDelta(), 0.25); // time-based, so slow machines still move at the right speed
    const t = timer.getElapsed();
    let talker = null;
    for (const ag of Object.values(agents)) if (ag.at === "table" && ag.state.talking && !ag.path.length) talker = ag.ch.root.position;
    for (const ag of Object.values(agents)) {
      ag.lookAt = talker;
      step(ag, dt);
      setPose(ag, dt, t);
      if (t - ag.lastScreen > 0.1) {
        ag.lastScreen = t;
        const m = ag.at === "desk" && !ag.path.length ? ag.state.mode : "away";
        drawScreen(ag.desk.screen, m, ag.state.activity, t);
        ag.desk.glow.intensity = m === "away" || m === "idle" || m === "standby" ? 0.6 : 2.2;
      }
    }
    controls.update();
    renderer.render(scene, camera);
    labels.render(scene, camera);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  /** Called whenever the dashboard gets new state. */
  function update(perAgent, meetingTitle) {
    for (const [id, s] of Object.entries(perAgent)) {
      const ag = agents[id];
      if (!ag) continue;
      ag.state = s;
      const want = s.atTable ? "table" : "desk";
      if (ag.at !== want) {
        ag.at = want;
        ag.path = (want === "table" ? ag.toTable : ag.toDesk).map((p) => p.clone());
      }
      const bubble = ag.bubbleEl.querySelector(".bubble");
      let html = "", cls = "bubble";
      if (s.talking) { html = s.speech; cls += " speech show"; }
      else if (s.mode === "thinking") { html = '<span class="dots"><i></i><i></i><i></i></span>'; cls += " thought show"; }
      else if (s.mode === "standby") { html = '<span class="dots"><i></i><i></i><i></i></span>'; cls += " show small"; }
      else if (ICONS[s.mode]) { html = ICONS[s.mode]; cls += " show"; }
      if (bubble.className !== cls) bubble.className = cls;
      if (bubble.innerHTML !== html) bubble.innerHTML = html;

      const busy = !(s.mode === "idle" || s.mode === "standby");
      const label = s.atTable && !s.talking && s.mode !== "thinking" ? "In a meeting" : s.label;
      const key = `${label}|${busy}`;
      if (ag.desk.cardKey !== key) {
        ag.desk.cardKey = key;
        drawCard(ag.desk.card, ag.name, label, busy);
      }
    }
    tableLabelEl.textContent = meetingTitle || "";
    tableLabel.visible = !!meetingTitle; // CSS2DRenderer controls display itself
  }

  return { update };
}

const ICONS = { reading: "📖", coding: "⌨️", running: '<span class="spin">⚙️</span>', testing: "🧪", writing: '<span class="wiggle">📝</span>' };
