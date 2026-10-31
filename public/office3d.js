// 3D AI Office: chibi agents in a cosy dark office. They walk between their desk and the
// meeting table, and their pose, screen and bubble show what they are doing right now.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { CSS2DRenderer, CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";

const PI = Math.PI;
const lerp = (a, b, t) => a + (b - a) * t;

// ---------- layout ----------
const TABLE = new THREE.Vector3(0, 0, -0.2);
const SEAT_R = 2.15;
// Desks: three on the left, three on the right. [x, z]
const DESKS = { product: [-5.6, -3.5], design: [-5.6, -0.3], techlead: [-5.6, 2.9], frontend: [5.6, -3.5], backend: [5.6, -0.3], qa: [5.6, 2.9] };
// Seat angle around the meeting table (0 = toward the camera).
const SEAT_ANGLE = { product: 180, design: 240, techlead: 300, qa: 0, backend: 60, frontend: 120 };

const LOOKS = {
  product: { skin: 0xf2c79a, hair: 0x2b1d14, style: "side", glasses: false, pants: 0x2b3245 },
  design: { skin: 0xe9b48a, hair: 0x5a2a1c, style: "bun", glasses: false, pants: 0x3a2f45 },
  techlead: { skin: 0xc68a5a, hair: 0x161616, style: "short", glasses: true, pants: 0x232a38 },
  frontend: { skin: 0xf6d2b0, hair: 0x2a2a2a, style: "spiky", glasses: true, pants: 0x2d3a4a },
  backend: { skin: 0x9a6440, hair: 0x101010, style: "short", glasses: true, pants: 0x262626 },
  qa: { skin: 0xf3cfb3, hair: 0x1d1d1d, style: "long", glasses: true, pants: 0x30364a },
};

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
const capsule = (r, len, material, o) => mesh(new THREE.CapsuleGeometry(r, len, 6, 16), material, o);

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

// ---------- room ----------
function buildRoom(scene) {
  // Wooden floor.
  const floor = canvasTexture(1024, 1024, (g, w, h) => {
    const plank = 64;
    for (let y = 0; y < h; y += plank) {
      for (let x = (y / plank) % 2 ? -128 : 0; x < w; x += 256) {
        const l = 30 + Math.random() * 10;
        g.fillStyle = `hsl(24, 32%, ${l}%)`;
        g.fillRect(x, y, 256, plank);
        g.strokeStyle = "rgba(0,0,0,.35)";
        g.lineWidth = 3;
        g.strokeRect(x, y, 256, plank);
        for (let i = 0; i < 6; i++) {
          g.strokeStyle = `rgba(0,0,0,${0.05 + Math.random() * 0.06})`;
          g.lineWidth = 1;
          g.beginPath();
          const yy = y + 8 + Math.random() * (plank - 16);
          g.moveTo(x, yy); g.bezierCurveTo(x + 80, yy + 4, x + 170, yy - 4, x + 256, yy);
          g.stroke();
        }
      }
    }
  });
  floor.tex.wrapS = floor.tex.wrapT = THREE.RepeatWrapping;
  floor.tex.repeat.set(2, 1.5);
  const fl = mesh(new THREE.PlaneGeometry(18, 13), mat(0xffffff, { map: floor.tex, roughness: 0.6 }), { rx: -PI / 2, z: -0.2, shadow: false });
  scene.add(fl);

  // Meeting rug.
  scene.add(mesh(new THREE.CircleGeometry(3.1, 48), mat(0x2c3550, { roughness: 1 }), { rx: -PI / 2, y: 0.01, x: TABLE.x, z: TABLE.z, shadow: false }));

  // Back wall with sign, shelves and slogans.
  const wallMat = mat(0x1d222c, { roughness: 0.9 });
  scene.add(box(18, 4.5, 0.3, wallMat, { y: 2.25, z: -6.4 }));
  for (let x = -8; x <= 8; x += 2) scene.add(box(0.06, 4.5, 0.05, mat(0x2a303c), { x, y: 2.25, z: -6.23, shadow: false })); // panel lines
  scene.add(box(0.3, 4.5, 13, wallMat, { x: -9, y: 2.25, z: -0.2 }));
  scene.add(box(0.3, 4.5, 13, wallMat, { x: 9, y: 2.25, z: -0.2 }));

  const sign = canvasTexture(1024, 256, (g, w, h) => {
    g.fillStyle = "#0b0f18"; g.fillRect(0, 0, w, h);
    g.strokeStyle = "#7fa2ff"; g.lineWidth = 6; g.strokeRect(10, 10, w - 20, h - 20);
    g.font = "bold 92px Inter, Segoe UI, sans-serif"; g.fillStyle = "#e8eeff"; g.textAlign = "center";
    g.shadowColor = "#7fa2ff"; g.shadowBlur = 24;
    g.fillText("AI Dev Team", w / 2, 130);
    g.font = "40px Inter, Segoe UI, sans-serif"; g.fillStyle = "#9fb5ff"; g.shadowBlur = 10;
    g.fillText("Think · Build · Test · Ship", w / 2, 200);
  });
  scene.add(mesh(new THREE.PlaneGeometry(4.6, 1.15), new THREE.MeshBasicMaterial({ map: sign.tex }), { y: 3.1, z: -6.22, shadow: false }));
  const signLight = new THREE.PointLight(0x7fa2ff, 6, 7, 2);
  signLight.position.set(0, 3.1, -5.4);
  scene.add(signLight);

  // Glowing neon words on the side of the back wall.
  for (const [i, word] of ["Focus", "Build", "Improve", "Repeat"].entries()) {
    const t = canvasTexture(256, 64, (g, w, h) => {
      g.font = "italic 40px Georgia, serif"; g.fillStyle = "#ffe9c7"; g.shadowColor = "#ffb347"; g.shadowBlur = 16;
      g.fillText(word, 40, 46);
    });
    scene.add(mesh(new THREE.PlaneGeometry(1.6, 0.4), new THREE.MeshBasicMaterial({ map: t.tex, transparent: true }), { x: -7.0, y: 3.5 - i * 0.5, z: -6.22, shadow: false }));
  }

  // Bookshelves.
  const shelfMat = mat(0x5b3f2b);
  for (const sx of [-4.2, 4.2]) {
    for (let r = 0; r < 3; r++) {
      const y = 1.2 + r * 0.8;
      scene.add(box(2.6, 0.08, 0.5, shelfMat, { x: sx, y, z: -6.0 }));
      let x = sx - 1.2;
      while (x < sx + 1.1) {
        const bw = 0.08 + Math.random() * 0.1, bh = 0.35 + Math.random() * 0.25;
        if (Math.random() < 0.15) { x += 0.25; continue; }
        scene.add(box(bw, bh, 0.36, mat(new THREE.Color().setHSL(Math.random(), 0.35, 0.35 + Math.random() * 0.2)), { x: x + bw / 2, y: y + 0.04 + bh / 2, z: -6.0, shadow: false }));
        x += bw + 0.015;
      }
    }
  }

  // Glass partitions at the front corners.
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x9fc3ff, transparent: true, opacity: 0.08, roughness: 0.1, metalness: 0, side: THREE.DoubleSide });
  for (const gx of [-9, 9]) {
    scene.add(mesh(new THREE.PlaneGeometry(2.6, 2.4), glass, { x: gx, y: 1.2, z: 5.2, ry: PI / 2, shadow: false }));
  }

  // Plants.
  for (const [x, z, s] of [[-8.2, -5.6, 1.3], [8.2, -5.6, 1.3], [-2.3, -5.8, 1], [2.3, -5.8, 1], [-8.3, 5.2, 1.1], [8.3, 5.2, 1.1]]) {
    scene.add(plant(x, z, s));
  }

  // Warm lights over each desk and the meeting table (ceiling is out of view).
  for (const [x, z] of [...Object.values(DESKS), [TABLE.x, TABLE.z]]) {
    const l = new THREE.PointLight(0xffc98a, x === 0 ? 14 : 9, 6.5, 1.6);
    l.position.set(x, 3.4, z + 0.6);
    scene.add(l);
  }
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

// ---------- desk ----------
function buildDesk(scene, x, z, side) {
  const g = new THREE.Group();
  const wood = mat(0x8a6446, { roughness: 0.55 });
  const metal = mat(0x2a2d33, { metalness: 0.5, roughness: 0.4 });
  g.add(box(2.4, 0.08, 1.0, wood, { y: 0.92, z: 0.85 }));
  for (const lx of [-1.1, 1.1]) g.add(box(0.06, 0.9, 0.9, metal, { x: lx, y: 0.45, z: 0.85 }));
  g.add(box(2.2, 0.5, 0.04, mat(0x5e4430), { y: 0.62, z: 1.3 })); // modesty panel

  // Monitor angled toward the agent and the camera.
  const mon = new THREE.Group();
  mon.add(box(1.0, 0.62, 0.05, mat(0x15171c, { metalness: 0.3 }), {}));
  const screen = canvasTexture(256, 160, () => {});
  const scr = mesh(new THREE.PlaneGeometry(0.92, 0.55), new THREE.MeshBasicMaterial({ map: screen.tex }), { z: 0.03, shadow: false });
  mon.add(scr);
  mon.add(box(0.06, 0.3, 0.06, metal, { y: -0.45, z: -0.03 }));
  mon.add(box(0.35, 0.03, 0.25, metal, { y: -0.6, z: -0.03 }));
  // Side monitor on the outer side of the desk, so it doesn't hide the agent's face;
  // the screen faces both the agent and the camera.
  mon.position.set(side * 0.85, 1.57, 0.65);
  mon.rotation.y = -side * PI * 0.25;
  g.add(mon);
  const glow = new THREE.PointLight(0x7fa8ff, 0, 2.2, 2);
  glow.position.set(side * 0.5, 1.5, 0.6);
  g.add(glow);

  g.add(box(0.7, 0.03, 0.22, mat(0x2b2f38), { x: -side * 0.1, y: 0.975, z: 0.55 })); // keyboard
  g.add(box(0.12, 0.03, 0.18, mat(0x2b2f38), { x: -side * 0.45, y: 0.975, z: 0.55 })); // mouse
  g.add(cyl(0.08, 0.07, 0.17, mat(0xf2efe9), { x: -side * 0.85, y: 1.05, z: 0.6 })); // mug
  g.add(box(0.4, 0.06, 0.3, mat(0xd6cfc4), { x: -side * 0.4, y: 0.99, z: 1.05, ry: 0.3 })); // notebook
  const p = plant(-side * 0.95, 1.15, 0.38);
  p.position.y = 0.96;
  g.add(p);

  // Chair.
  const chair = new THREE.Group();
  const fabric = mat(0x2d3140, { roughness: 0.9 });
  chair.add(box(0.7, 0.1, 0.65, fabric, { y: 0.5 }));
  chair.add(box(0.7, 0.75, 0.1, fabric, { y: 0.95, z: -0.35 }));
  chair.add(cyl(0.04, 0.04, 0.45, metal, { y: 0.25 }, 8));
  chair.add(cyl(0.35, 0.35, 0.04, metal, { y: 0.04 }, 5));
  g.add(chair);

  g.position.set(x, 0, z);
  scene.add(g);
  return { group: g, screen, glow };
}

function buildMeetingTable(scene) {
  const g = new THREE.Group();
  const wood = mat(0x6e4a32, { roughness: 0.45 });
  g.add(cyl(1.35, 1.35, 0.1, wood, { y: 0.88 }, 48));
  g.add(cyl(0.2, 0.3, 0.85, mat(0x2a2d33, { metalness: 0.5 }), { y: 0.43 }));
  g.add(cyl(0.7, 0.7, 0.05, mat(0x2a2d33, { metalness: 0.5 }), { y: 0.03 }));
  // Laptop and papers.
  g.add(box(0.5, 0.02, 0.35, mat(0xbfc5cf, { metalness: 0.6 }), { y: 0.95, x: 0.3, z: 0.2, ry: 0.4 }));
  g.add(box(0.35, 0.01, 0.45, mat(0xf3f1ec), { y: 0.94, x: -0.4, z: -0.3, ry: -0.3 }));
  const fabric = mat(0x3a3f52, { roughness: 0.9 });
  for (const a of Object.values(SEAT_ANGLE)) {
    const r = (a * PI) / 180;
    const c = new THREE.Group();
    c.add(box(0.6, 0.08, 0.55, fabric, { y: 0.5 }));
    c.add(box(0.6, 0.6, 0.08, fabric, { y: 0.85, z: -0.3 }));
    c.add(cyl(0.04, 0.04, 0.45, mat(0x2a2d33), { y: 0.25 }, 8));
    c.position.set(Math.sin(r) * (SEAT_R + 0.05), 0, Math.cos(r) * (SEAT_R + 0.05));
    c.rotation.y = Math.atan2(-c.position.x, -c.position.z);
    g.add(c);
  }
  g.position.copy(TABLE);
  scene.add(g);
}

// ---------- character ----------
function buildCharacter(color, look) {
  const skin = mat(look.skin, { roughness: 0.6 });
  const hairM = mat(look.hair, { roughness: 0.85 });
  const shirt = mat(color, { roughness: 0.85 });
  const pants = mat(look.pants, { roughness: 0.9 });
  const dark = mat(0x111111, { roughness: 0.3 });

  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const HIP = 0.75;

  // Legs: hip → knee → foot.
  const legs = [];
  for (const s of [-1, 1]) {
    const hip = new THREE.Group();
    hip.position.set(s * 0.15, HIP, 0);
    hip.add(capsule(0.12, 0.22, pants, { y: -0.17 }));
    const knee = new THREE.Group();
    knee.position.y = -0.35;
    knee.add(capsule(0.11, 0.22, pants, { y: -0.17 }));
    knee.add(box(0.2, 0.1, 0.32, dark, { y: -0.35, z: 0.06 }));
    hip.add(knee);
    body.add(hip);
    legs.push({ hip, knee });
  }

  // Torso: hoodie with hood and pocket.
  const torso = capsule(0.33, 0.38, shirt, { y: HIP + 0.38 });
  torso.scale.set(1, 1, 0.82);
  body.add(torso);
  const hood = mesh(new THREE.TorusGeometry(0.22, 0.08, 10, 24), shirt, { y: HIP + 0.74, z: -0.12, rx: PI / 2.4 });
  body.add(hood);
  body.add(box(0.36, 0.14, 0.04, mat(new THREE.Color(color).multiplyScalar(0.8)), { y: HIP + 0.22, z: 0.27 }));
  for (const s of [-1, 1]) body.add(cyl(0.012, 0.012, 0.22, mat(0xeeeeee), { x: s * 0.07, y: HIP + 0.58, z: 0.27 }, 6)); // hoodie strings

  // Arms: shoulder → elbow → hand.
  const arms = [];
  for (const s of [-1, 1]) {
    const sh = new THREE.Group();
    sh.position.set(s * 0.4, HIP + 0.66, 0);
    sh.add(capsule(0.1, 0.18, shirt, { y: -0.14 }));
    const el = new THREE.Group();
    el.position.y = -0.3;
    el.add(capsule(0.09, 0.16, shirt, { y: -0.12 }));
    el.add(sph(0.1, skin, { y: -0.3 }, 14));
    sh.add(el);
    body.add(sh);
    arms.push({ sh, el, side: s });
  }

  // Head.
  const neck = new THREE.Group();
  neck.position.y = HIP + 0.86;
  body.add(neck);
  const head = new THREE.Group();
  head.position.y = 0.45;
  neck.add(head);
  head.add(sph(0.5, skin, {}, 32));
  for (const s of [-1, 1]) head.add(sph(0.1, skin, { x: s * 0.49, y: -0.02 }, 12)); // ears
  const eyes = new THREE.Group();
  for (const s of [-1, 1]) {
    const e = sph(0.075, dark, { x: s * 0.17, y: -0.02, z: 0.45 }, 16);
    e.scale.set(1, 1.25, 0.6);
    eyes.add(e);
    eyes.add(sph(0.025, mat(0xffffff, { emissive: 0xffffff, emissiveIntensity: 0.4 }), { x: s * 0.17 + 0.025, y: 0.02, z: 0.5 }, 8));
    const brow = box(0.14, 0.025, 0.02, hairM, { x: s * 0.17, y: 0.14, z: 0.46, rz: s * -0.12 });
    eyes.add(brow);
    const cheek = sph(0.07, mat(0xff8f8f, { transparent: true, opacity: 0.35 }), { x: s * 0.27, y: -0.14, z: 0.4 }, 10);
    cheek.scale.set(1, 0.6, 0.4);
    head.add(cheek);
  }
  head.add(eyes);
  const mouth = mesh(new THREE.TorusGeometry(0.06, 0.014, 6, 16, PI), mat(0x5a2a22), { y: -0.2, z: 0.47, rz: PI });
  head.add(mouth);
  if (look.glasses) {
    const frame = mat(0x1a1a1a, { metalness: 0.4, roughness: 0.3 });
    for (const s of [-1, 1]) head.add(mesh(new THREE.TorusGeometry(0.12, 0.018, 8, 24), frame, { x: s * 0.17, y: -0.01, z: 0.48 }));
    head.add(box(0.1, 0.02, 0.02, frame, { y: 0.01, z: 0.5 }));
    for (const s of [-1, 1]) head.add(box(0.02, 0.02, 0.4, frame, { x: s * 0.3, y: 0.01, z: 0.3 }));
  }

  // Hair styles.
  const cap = mesh(new THREE.SphereGeometry(0.53, 32, 16, 0, PI * 2, 0, PI * 0.55), hairM, { y: 0.03, rx: -0.25 });
  head.add(cap);
  if (look.style === "side") {
    const swoop = sph(0.32, hairM, { x: -0.15, y: 0.3, z: 0.27, rz: 0.4 });
    swoop.scale.set(1.3, 0.45, 0.6);
    head.add(swoop);
  } else if (look.style === "bun") {
    head.add(sph(0.22, hairM, { y: 0.45, z: -0.2 }));
    head.add(capsule(0.3, 0.2, hairM, { y: -0.15, z: -0.22 }));
  } else if (look.style === "spiky") {
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * PI * 2;
      head.add(mesh(new THREE.ConeGeometry(0.12, 0.3, 8), hairM, { x: Math.cos(a) * 0.3, y: 0.45, z: Math.sin(a) * 0.3 - 0.05, rx: Math.sin(a) * 0.6, rz: -Math.cos(a) * 0.6 }));
    }
  } else if (look.style === "long") {
    const back = capsule(0.42, 0.45, hairM, { y: -0.2, z: -0.2 });
    back.scale.set(1.15, 1, 0.7);
    head.add(back);
  } else {
    const fringe = sph(0.3, hairM, { y: 0.32, z: 0.28 });
    fringe.scale.set(1.3, 0.45, 0.6);
    head.add(fringe);
  }

  // Mug used when sipping coffee.
  const mug = cyl(0.07, 0.06, 0.15, mat(0xf2efe9), { y: -0.36, z: 0.05 });
  mug.visible = false;
  arms[1].el.add(mug);

  // Bubble anchor above the head.
  const anchor = new THREE.Object3D();
  anchor.position.y = 0.75;
  head.add(anchor);

  return { root, body, legs, arms, neck, head, eyes, mouth, mug, anchor };
}

// ---------- screen drawing ----------
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

// ---------- the office ----------
export function createOffice3D(container, roles) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0e1119);
  scene.fog = new THREE.Fog(0x0e1119, 22, 40);

  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
  camera.position.set(0, 10.5, 13.2);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.25;
  container.appendChild(renderer.domElement);

  const labels = new CSS2DRenderer();
  labels.domElement.className = "labels3d";
  container.appendChild(labels.domElement);

  const controls = new OrbitControls(camera, labels.domElement);
  controls.target.set(0, 0.4, -0.5);
  controls.enableDamping = true;
  controls.enablePan = false;
  controls.minDistance = 7;
  controls.maxDistance = 24;
  controls.minPolarAngle = 0.35;
  controls.maxPolarAngle = 1.2;
  controls.minAzimuthAngle = -0.9;
  controls.maxAzimuthAngle = 0.9;

  scene.add(new THREE.HemisphereLight(0xc8d4ff, 0x3a2a1e, 1.1));
  const sun = new THREE.DirectionalLight(0xfff0dd, 1.6);
  sun.position.set(-6, 14, 8);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -10, right: 10, top: 8, bottom: -8, near: 1, far: 40 });
  sun.shadow.bias = -0.0005;
  scene.add(sun);

  buildRoom(scene);
  buildMeetingTable(scene);

  // Meeting label floating over the table.
  const tableLabelEl = document.createElement("div");
  tableLabelEl.className = "table-label3d";
  const tableLabel = new CSS2DObject(tableLabelEl);
  tableLabel.position.set(TABLE.x, 2.6, TABLE.z);
  scene.add(tableLabel);
  tableLabel.visible = false;

  const agents = {};
  for (const r of roles) {
    const [dx, dz] = DESKS[r.id];
    const side = dx < 0 ? -1 : 1;
    const desk = buildDesk(scene, dx, dz, side);
    const ch = buildCharacter(r.color, LOOKS[r.id] ?? LOOKS.product);
    ch.root.position.set(dx, 0, dz);
    scene.add(ch.root);

    const bubbleEl = document.createElement("div");
    bubbleEl.className = "bubble3d";
    bubbleEl.innerHTML = `<div class="bubble-anchor"><div class="bubble"></div></div>`;
    const bubbleObj = new CSS2DObject(bubbleEl);
    ch.anchor.add(bubbleObj);

    const cardEl = document.createElement("div");
    cardEl.className = "card3d";
    cardEl.innerHTML = `<span class="dot green"></span><div><b>${r.name}</b><small></small></div>`;

    const a = (SEAT_ANGLE[r.id] * PI) / 180;
    const seat = new THREE.Vector3(TABLE.x + Math.sin(a) * SEAT_R, 0, TABLE.z + Math.cos(a) * SEAT_R);
    agents[r.id] = {
      ch, desk, side, bubbleEl, cardEl,
      deskPos: new THREE.Vector3(dx, 0, dz),
      deskExit: new THREE.Vector3(dx - side * 1.9, 0, dz + 0.2),
      seat,
      seatApproach: seat.clone().add(seat.clone().sub(TABLE).setY(0).normalize().multiplyScalar(0.8)),
      seatFacing: Math.atan2(TABLE.x - seat.x, TABLE.z - seat.z),
      at: "desk", path: [], facing: 0,
      state: { mode: "idle", activity: "", talking: false, speech: "", atTable: false },
      phase: Math.random() * 10,
      lastScreen: 0,
    };
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

  // ---------- per-frame animation ----------
  const timer = new THREE.Timer();
  const tmp = new THREE.Vector3();

  function setPose(ag, dt, t) {
    const { ch, state } = ag;
    const walking = ag.path.length > 0;
    const seated = !walking;
    const k = 1 - Math.pow(0.001, dt); // smoothing
    const P = { hipX: [0, 0], kneeX: [0, 0], shX: [0, 0], shZ: [0.12, -0.12], elX: [0, 0], headX: 0, headY: 0, headZ: 0, bodyY: 0, bob: 0 };
    let mug = false;

    if (walking) {
      const w = t * 9;
      P.hipX = [Math.sin(w) * 0.55, -Math.sin(w) * 0.55];
      P.kneeX = [Math.max(0, -Math.sin(w)) * 0.8, Math.max(0, Math.sin(w)) * 0.8];
      P.shX = [-Math.sin(w) * 0.45, Math.sin(w) * 0.45];
      P.elX = [-0.3, -0.3];
      P.bob = Math.abs(Math.sin(w)) * 0.06;
    } else if (seated) {
      P.hipX = [-PI / 2, -PI / 2];
      P.kneeX = [PI / 2, PI / 2];
      P.bodyY = -0.2;
      const m = state.mode;
      const atDesk = ag.at === "desk";
      if (atDesk && (m === "coding" || m === "writing" || m === "running" || m === "testing")) {
        const fast = m === "coding" || m === "writing" ? 22 : 6;
        P.shX = [-1.05 + Math.sin(t * fast) * 0.06, -1.05 + Math.sin(t * fast + 1.5) * 0.06];
        P.elX = [-0.75, -0.75];
        P.shZ = [0.25, -0.25];
        P.headX = 0.12;
        P.headY = ag.side * 0.45;
      } else if (atDesk && m === "reading") {
        P.shX = [-0.9, -1.0];
        P.elX = [-0.7, -0.6];
        P.headX = 0.08 + Math.sin(t * 0.8) * 0.04;
        P.headY = ag.side * 0.45 + Math.sin(t * 1.3) * 0.12;
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
        P.headX = 0.05 + Math.max(0, Math.sin(t * 2.2 + ag.phase)) * 0.12; // nodding
      } else {
        // idle / standby at desk: relaxed, sipping coffee now and then.
        const sip = m === "idle" && (t + ag.phase * 3) % 9 < 1.6;
        P.shX = [-0.8, sip ? -1.3 : -0.8];
        P.elX = [-0.6, sip ? -2.1 : -0.6];
        P.headX = sip ? -0.15 : 0.04 + Math.sin(t * 0.7 + ag.phase) * 0.03;
        P.headY = m === "standby" ? ag.side * 0.35 : Math.sin(t * 0.3 + ag.phase) * 0.25;
        mug = sip;
      }
    }

    // Listeners look at whoever is talking at the table.
    if (seated && ag.at === "table" && ag.lookAt && !state.talking) {
      tmp.copy(ag.lookAt).sub(ch.root.position);
      const yaw = Math.atan2(tmp.x, tmp.z) - ch.root.rotation.y;
      P.headY = Math.atan2(Math.sin(yaw), Math.cos(yaw));
      P.headY = Math.max(-0.9, Math.min(0.9, P.headY));
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
    ch.body.scale.y = 1 + Math.sin(t * 1.6 + ag.phase) * 0.008; // breathing
    ch.mug.visible = mug;
    // Blink.
    const blink = (t + ag.phase) % 4.2 < 0.12;
    ch.eyes.scale.y = lerp(ch.eyes.scale.y, blink ? 0.1 : 1, 0.6);
    // Talking mouth.
    ch.mouth.scale.y = state.talking ? 1 + Math.abs(Math.sin(t * 14)) * 1.6 : 1;
  }

  function step(ag, dt) {
    const root = ag.ch.root;
    if (ag.path.length) {
      const target = ag.path[0];
      tmp.copy(target).sub(root.position).setY(0);
      const d = tmp.length();
      const speed = 2.6 * dt;
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
      // Screens redraw ~10 times a second.
      if (t - ag.lastScreen > 0.1) {
        ag.lastScreen = t;
        const m = ag.at === "desk" && !ag.path.length ? ag.state.mode : "away";
        drawScreen(ag.desk.screen, m, ag.state.activity, t);
        ag.desk.glow.intensity = m === "away" || m === "idle" || m === "standby" ? 0.6 : 2.2;
      }
    }
    for (const ag of Object.values(agents)) {
      const p = ag.ch.root.position;
      // At the desk the card sits beside it on the aisle side, so it never covers a face.
      if (ag.at === "desk" && !ag.path.length) ag.cardObj.position.set(p.x - ag.side * 1.85, 0.6, p.z + 0.9);
      else ag.cardObj.position.set(p.x, 0.05, p.z + 0.7);
    }
    controls.update();
    renderer.render(scene, camera);
    labels.render(scene, camera);
    requestAnimationFrame(frame);
  }
  // Attach card objects for frame().
  for (const ag of Object.values(agents)) {
    const obj = new CSS2DObject(ag.cardEl);
    scene.add(obj);
    ag.cardObj = obj;
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
        ag.path = want === "table"
          ? [ag.deskExit.clone(), ag.seatApproach.clone(), ag.seat.clone()]
          : [ag.seatApproach.clone(), ag.deskExit.clone(), ag.deskPos.clone()];
      }
      // Bubble.
      const bubble = ag.bubbleEl.querySelector(".bubble");
      let html = "", cls = "bubble";
      if (s.talking) { html = s.speech; cls += " speech show"; }
      else if (s.mode === "thinking") { html = '<span class="dots"><i></i><i></i><i></i></span>'; cls += " thought show"; }
      else if (s.mode === "standby") { html = '<span class="dots"><i></i><i></i><i></i></span>'; cls += " show small"; }
      else if (ICONS[s.mode]) { html = ICONS[s.mode]; cls += " show"; }
      if (bubble.className !== cls) bubble.className = cls;
      if (bubble.innerHTML !== html) bubble.innerHTML = html;
      // Card.
      ag.cardEl.querySelector("small").textContent = s.label;
      ag.cardEl.querySelector("small").title = s.activity;
      ag.cardEl.querySelector(".dot").className = `dot ${s.mode === "idle" || s.mode === "standby" ? "green" : "amber pulse"}`;
    }
    tableLabelEl.textContent = meetingTitle || "";
    tableLabel.visible = !!meetingTitle; // CSS2DRenderer controls display itself
  }

  return { update };
}

const ICONS = { reading: "📖", coding: "⌨️", running: '<span class="spin">⚙️</span>', testing: "🧪", writing: '<span class="wiggle">📝</span>' };
