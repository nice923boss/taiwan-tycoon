// Building and owner-flag models for the 3D board. Each level has its own
// shape: 1 to 4 houses grow from a cottage to an apartment block, and a hotel
// is a tiered red tower. Local +x runs along the row, +z faces the outer edge.
// Geometries and materials are shared, so rebuilding only creates meshes.

import * as THREE from 'three';

const HOUSE = '#36a85e';
const ROOF = '#8a4b2a';
const TRIM = '#e9e2cf';
const STEEL = '#c3ccd4';
const HOTEL = '#d93a32';
const GOLD = '#f2b632';
const GLASS = '#e4f4ff';
const LAMP = '#ffe08a';
const POLE = '#5a4c40';

const cache = new Map();
const once = (key, make) => {
  if (!cache.has(key)) cache.set(key, make());
  return cache.get(key);
};

const plain = (color) => once(`m:${color}`, () => new THREE.MeshStandardMaterial({ color, roughness: 0.7 }));

// Wall material with `floors` rows and `cols` columns of windows.
function facade(wall, glass, floors, cols) {
  return once(`f:${wall}:${floors}:${cols}`, () => {
    const c = document.createElement('canvas');
    c.width = 32 * cols;
    c.height = 32 * floors;
    const x = c.getContext('2d');
    x.fillStyle = wall;
    x.fillRect(0, 0, c.width, c.height);
    x.fillStyle = glass;
    for (let f = 0; f < floors; f += 1) {
      for (let k = 0; k < cols; k += 1) x.fillRect(k * 32 + 9, f * 32 + 8, 14, 15);
    }
    const map = new THREE.CanvasTexture(c);
    map.colorSpace = THREE.SRGBColorSpace;
    return new THREE.MeshStandardMaterial({ map, roughness: 0.7 });
  });
}

const boxGeo = (w, h, d) => once(`b:${w}:${h}:${d}`, () => new THREE.BoxGeometry(w, h, d));

// Box with windows on all four walls and a plain top.
function block(w, h, d, floors, cols, wall, glass = GLASS) {
  const front = facade(wall, glass, floors, cols);
  const side = facade(wall, glass, floors, Math.max(1, Math.round((cols * d) / w)));
  const top = plain(wall);
  return new THREE.Mesh(boxGeo(w, h, d), [side, side, top, top, front, front]);
}

const box = (w, h, d, color) => new THREE.Mesh(boxGeo(w, h, d), plain(color));

// Gable roof: a triangular prism whose ridge runs along the row.
function roof(w, d, h) {
  const geo = once(`r:${w}:${d}:${h}`, () => {
    const shape = new THREE.Shape([new THREE.Vector2(-d / 2, 0), new THREE.Vector2(d / 2, 0), new THREE.Vector2(0, h)]);
    const g = new THREE.ExtrudeGeometry(shape, { depth: w, bevelEnabled: false });
    g.translate(0, 0, -w / 2);
    g.rotateY(Math.PI / 2);
    return g;
  });
  return new THREE.Mesh(geo, plain(ROOF));
}

// Rooftop water tank, common on Taiwanese buildings.
const tank = () => new THREE.Mesh(once('tank', () => new THREE.CylinderGeometry(0.035, 0.035, 0.07, 12)), plain(STEEL));
const spire = () => new THREE.Mesh(once('spire', () => new THREE.ConeGeometry(0.05, 0.14, 12)), plain(GOLD));

// Model for `level` houses (5 = hotel), standing on y = 0.
export function buildingModel(level) {
  const g = new THREE.Group();
  const add = (mesh, x, y, z) => {
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    g.add(mesh);
  };
  switch (level) {
    case 1: // cottage
      add(block(0.24, 0.13, 0.18, 1, 2, HOUSE), 0, 0.065, 0);
      add(roof(0.28, 0.22, 0.1), 0, 0.13, 0);
      break;
    case 2: // two-storey house with a chimney
      add(block(0.28, 0.24, 0.2, 2, 2, HOUSE), 0, 0.12, 0);
      add(roof(0.32, 0.24, 0.11), 0, 0.24, 0);
      add(box(0.04, 0.1, 0.04, ROOF), 0.08, 0.33, 0.04);
      break;
    case 3: // three-storey townhouse with a flat roof
      add(block(0.24, 0.36, 0.22, 3, 2, HOUSE), 0, 0.18, 0);
      add(box(0.26, 0.03, 0.24, TRIM), 0, 0.375, 0);
      add(tank(), 0.05, 0.425, -0.04);
      break;
    case 4: // apartment block with a lower wing
      add(block(0.26, 0.52, 0.24, 6, 3, HOUSE), -0.06, 0.26, 0);
      add(block(0.14, 0.27, 0.2, 3, 1, HOUSE), 0.14, 0.135, 0.01);
      add(box(0.28, 0.03, 0.26, TRIM), -0.06, 0.535, 0);
      add(tank(), -0.12, 0.585, -0.05);
      add(tank(), -0.03, 0.585, -0.05);
      break;
    default: // hotel: podium, tower, crown and spire
      add(block(0.42, 0.12, 0.26, 1, 5, HOTEL, LAMP), 0, 0.06, 0);
      add(block(0.26, 0.38, 0.18, 5, 3, HOTEL, LAMP), 0, 0.31, -0.01);
      add(box(0.2, 0.06, 0.14, GOLD), 0, 0.53, -0.01);
      add(spire(), 0, 0.63, -0.01);
  }
  return g;
}

// Pole with a cloth in the owner's color; a mortgaged square flies it
// darkened at half-mast. Turn the group to face the camera.
export function flagModel(color, mortgaged) {
  const g = new THREE.Group();
  const pole = new THREE.Mesh(once('pole', () => new THREE.CylinderGeometry(0.012, 0.012, 0.42, 6)), plain(POLE));
  pole.position.y = 0.21;
  pole.castShadow = true;
  const knob = new THREE.Mesh(once('knob', () => new THREE.SphereGeometry(0.022, 10, 8)), plain(GOLD));
  knob.position.y = 0.43;
  const mat = once(`c:${color}:${mortgaged}`, () => new THREE.MeshStandardMaterial({
    color: mortgaged ? new THREE.Color(color).lerp(new THREE.Color('#4a4a4a'), 0.6) : color,
    roughness: 0.8,
    side: THREE.DoubleSide,
  }));
  const cloth = new THREE.Mesh(once('cloth', () => new THREE.PlaneGeometry(0.2, 0.13)), mat);
  cloth.position.set(0.1, mortgaged ? 0.16 : 0.34, 0);
  cloth.castShadow = true;
  g.add(pole, knob, cloth);
  return g;
}
