import './setup/webgl-suppress';
import * as PIXI from 'pixi.js';
import { generateDungeon, generateOverworld, computeVisible, canWalk as coreCanWalk, sampleFloors, aStarNextStep, reachableFrom, type Tile } from './game/core';
import { createGeneratedAtlas } from './gfx/sprites';

// Config
const TILE_SIZE = 16;
const MAP_W = 80;
const MAP_H = 50;
const FOV_RADIUS = 8;

type Enemy = { x: number; y: number; sprite: PIXI.AnimatedSprite; seen: boolean; name: string; hp: number; maxHp: number; atkMin: number; atkMax: number };
type Player = { x: number; y: number; hp: number; maxHp: number; atkMin: number; atkMax: number; gold: number };

type ItemKind = 'potion';
type Item = { x: number; y: number; kind: ItemKind; sprite: PIXI.Sprite; label?: PIXI.Text };

type Door = { x: number; y: number; open: boolean; sprite: PIXI.Sprite; label: PIXI.Text } | null;
type HouseType = 'inn' | 'tavern' | 'smith' | 'mage';
type HouseDoor = { x: number; y: number; open: boolean; sprite: PIXI.Sprite; label: PIXI.Text; kind: HouseType };

type FeatureKind = 'path' | 'house';
type Feature = { x: number; y: number; kind: FeatureKind; sprite: PIXI.Sprite };

type GameState = {
  map: Tile[][];
  player: Player;
  enemies: Enemy[];
  items: Item[];
  inventory: { potion: number };
  world: 'dungeon' | 'overworld' | 'house';
  door: Door;
  features: Feature[];
  npcs: Array<{ x: number; y: number; sprite: PIXI.Sprite; label: PIXI.Text; name: string }>;
  houseDoors: HouseDoor[];
  currentHouse?: { kind: HouseType; x: number; y: number };
};

// Simple world save snapshots (store references to map; we rebuild sprites on restore)
type DungeonSave = { map: Tile[][]; door: { x: number; y: number; open: boolean }; player: { x: number; y: number } };
type OverworldSave = { map: Tile[][]; door: { x: number; y: number; open: boolean }; player: { x: number; y: number } };

let dungeonSave: DungeonSave | null = null;
let overworldSave: (OverworldSave & { features?: Array<{ x: number; y: number; kind: FeatureKind }>; houses?: Array<{ x: number; y: number; open: boolean; kind: HouseType }> }) | null = null;
let transitionFlag: 'none' | 'toOverworld' | 'toDungeon' = 'none';

// Helpers
const inBounds = (x: number, y: number) => x >= 0 && y >= 0 && x < MAP_W && y < MAP_H;

// Wrap core dungeon gen with width/height + time-based seed
function makeDungeon(): { map: Tile[][]; start: { x: number; y: number } } {
  return generateDungeon(MAP_W, MAP_H, Date.now());
}

function makeOverworld(): { map: Tile[][]; start: { x: number; y: number } } {
  return generateOverworld(MAP_W, MAP_H, Date.now());
}

async function main() {
  // PIXI setup
  const app = new PIXI.Application();
  const appDiv = document.getElementById('app')!;
  const stack = document.getElementById('stack')!;
  const statsEl = document.createElement('div');
  statsEl.className = 'stats';
  stack.appendChild(statsEl);
  const logEl = document.createElement('div');
  logEl.className = 'log';
  stack.appendChild(logEl);
  function log(msg: string) {
    logEl.textContent = msg;
  }
  // Inventory modal elements
  const invModal = document.getElementById('inventory-modal') as HTMLDivElement;
  const invList = document.getElementById('inventory-list') as HTMLUListElement;
  let inventoryOpen = false;
  let invIndex = 0;
  type InvEntry = { key: ItemKind; name: string; count: number };
  function inventoryEntries(): InvEntry[] {
    const entries: InvEntry[] = [];
    if (state?.inventory?.potion > 0) entries.push({ key: 'potion', name: 'Healing Potion', count: state.inventory.potion });
    return entries;
  }
  function renderInventory() {
    const entries = inventoryEntries();
    if (invIndex >= entries.length) invIndex = Math.max(0, entries.length - 1);
    const html = entries.length
      ? entries.map((e, i) => `<li class="${i === invIndex ? 'selected' : ''}">${e.count}× ${e.name}</li>`).join('')
      : '<li>(empty)</li>';
    invList.innerHTML = html;
  }
  function openInventory() { inventoryOpen = true; invModal.style.display = 'flex'; invIndex = 0; renderInventory(); }
  function closeInventory() { inventoryOpen = false; invModal.style.display = 'none'; }
  function toggleInventory() { inventoryOpen ? closeInventory() : openInventory(); }
  function moveInventorySelection(delta: number) {
    const entries = inventoryEntries();
    if (!entries.length) return;
    invIndex = (invIndex + delta + entries.length) % entries.length;
    renderInventory();
  }
  function useSelectedInventoryItem() {
    const entries = inventoryEntries();
    if (!entries.length) return;
    const entry = entries[invIndex];
    if (entry.key === 'potion' && state.inventory.potion > 0) {
      state.inventory.potion -= 1;
      state.player.hp = Math.min(state.player.maxHp, state.player.hp + 5);
      log('You drink a healing potion (+5 HP).');
      renderStats();
      renderInventory();
      if (state.inventory.potion === 0) renderInventory();
    }
  }
  await app.init({
    width: Math.min(window.innerWidth, MAP_W * TILE_SIZE),
    height: Math.min(window.innerHeight, MAP_H * TILE_SIZE),
    background: '#0f0f12',
    antialias: false,
    preference: 'webgl',
    powerPreference: 'high-performance',
    hello: 0,
  });
  // Place canvas above log, inside the stack container
  stack.insertBefore(app.canvas, logEl);

  // Handle WebGL context lost/restored to reduce noisy console messages
  app.canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    // Pixi will attempt to restore the context automatically
    console.warn('WebGL context lost (prevented default, auto-restore).');
  });
  app.canvas.addEventListener('webglcontextrestored', () => {
    console.info('WebGL context restored.');
  });

  // Filter specific noisy WebGL warnings unless ?debug is present
  const DEBUG = new URLSearchParams(location.search).has('debug');
  if (!DEBUG) {
    const _origWarn = console.warn.bind(console);
    const _origError = console.error.bind(console);
    console.warn = (...args: unknown[]) => {
      const msg = typeof args[0] === 'string' ? args[0] : '';
      if (msg.includes('WebGL context was lost')) return;
      if (msg.includes('lazy initialization')) return;
      if (msg.includes('incurring lazy initialization')) return;
      _origWarn(...args as [any]);
    };
    console.error = (...args: unknown[]) => {
      const msg = typeof args[0] === 'string' ? args[0] : '';
      if (msg.includes('WebGL context was lost')) return;
      if (msg.includes('lazy initialization')) return;
      if (msg.includes('incurring lazy initialization')) return;
      _origError(...args as [any]);
    };
  }

  // Swap to sprite-based textures (generated atlas for now).
  const atlas = createGeneratedAtlas(app, TILE_SIZE);

  // Force immediate texture upload to GPU to prevent lazy initialization warnings
  {
    const warmTextures = [atlas.floor, atlas.wall, atlas.shroud, atlas.grass, atlas.tree, atlas.doorClosed, atlas.doorOpen, atlas.path, atlas.house, ...atlas.playerFrames, ...atlas.enemyFrames, atlas.potion];
    
    // Force texture upload by accessing the GPU resource directly
    for (const texture of warmTextures) {
      if (texture.source && !texture.source.resource) {
        // Create a minimal sprite and force a render pass
        const tempSprite = new PIXI.Sprite(texture);
        tempSprite.x = -1000; // Position off-screen
        tempSprite.y = -1000;
        app.stage.addChild(tempSprite);
        
        // Force render to upload texture
        app.renderer.render(app.stage);
        
        // Clean up
        app.stage.removeChild(tempSprite);
        tempSprite.destroy();
      }
    }
  }

  // World and layers (ensures correct draw order)
  const world = new PIXI.Container();
  const floorLayer = new PIXI.Container();
  const featureLayer = new PIXI.Container();
  const itemsLayer = new PIXI.Container();
  const entityLayer = new PIXI.Container();
  const fogLayer = new PIXI.Container();
  world.addChild(floorLayer, featureLayer, itemsLayer, entityLayer, fogLayer);
  app.stage.addChild(world);

  // Tile sprites and shroud overlays
  const tileSprites: PIXI.Sprite[][] = [];
  const shroudSprites: PIXI.Sprite[][] = [];

  // Prewarm GPU using a DOM canvas-based texture to avoid non-DOM upload warnings
  {
    const c = document.createElement('canvas');
    c.width = 1; c.height = 1;
    const warmTex = PIXI.Texture.from(c);
    const warmSprite = new PIXI.Sprite(warmTex);
    app.stage.addChild(warmSprite);
    app.renderer.render(app.stage);
    app.stage.removeChild(warmSprite);
    warmTex.destroy(true);
  }

  function buildMapSprites(state: GameState) {
    for (let y = 0; y < MAP_H; y++) {
      const row: PIXI.Sprite[] = [];
      const shRow: PIXI.Sprite[] = [];
      for (let x = 0; x < MAP_W; x++) {
        const t = state.map[y][x];
        let tex: PIXI.Texture;
        if (state.world === 'dungeon') {
          tex = t.walkable ? atlas.floor : atlas.wall;
        } else if (state.world === 'overworld') {
          tex = t.walkable ? atlas.grass : atlas.tree;
        } else {
          // house interior floor by type
          const hk = state.currentHouse?.kind ?? 'inn';
          const floorTex = hk === 'inn' || hk === 'tavern' ? atlas.wood : (hk === 'smith' ? atlas.stone : atlas.rune);
          tex = t.walkable ? floorTex : atlas.wall;
        }
        const sprite = new PIXI.Sprite(tex);
        if (state.world === 'overworld') {
          // Make sure outdoor tiles pop even on dim displays
          sprite.tint = t.walkable ? 0x39b54a : 0x1f4d29;
        }
        sprite.x = x * TILE_SIZE;
        sprite.y = y * TILE_SIZE;
        floorLayer.addChild(sprite);
        row.push(sprite);

        const sh = new PIXI.Sprite(atlas.shroud);
        sh.alpha = 0.82; // fog overlay
        sh.x = sprite.x;
        sh.y = sprite.y;
        fogLayer.addChild(sh);
        shRow.push(sh);
      }
      tileSprites.push(row);
      shroudSprites.push(shRow);
    }
  }

  // Player
  const playerSprite = new PIXI.AnimatedSprite({ textures: atlas.playerFrames, autoUpdate: true });
  playerSprite.animationSpeed = 0.05; // subtle idle shimmer
  playerSprite.play();
  entityLayer.addChild(playerSprite);

  // State
  let state: GameState = { map: [], player: { x: 1, y: 1, hp: 10, maxHp: 10, atkMin: 2, atkMax: 4, gold: 0 }, enemies: [], items: [], inventory: { potion: 0 }, world: 'dungeon', door: null, features: [], npcs: [], houseDoors: [] };
  let gameOver = false;

  function randInt(min: number, max: number) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }
  
  function renderStats() {
    const p = state.player;
    statsEl.innerHTML = `<span class="hp">HP ${p.hp}/${p.maxHp}</span> • <span class="atk">ATK ${p.atkMin}–${p.atkMax}</span> • <span class="gold">G ${p.gold}</span>`;
  }
  
  function clearEnemies() {
    for (const e of state.enemies) e.sprite.destroy();
    state.enemies = [];
  }
  function clearItems() {
    for (const i of state.items) { i.sprite.destroy(); i.label?.destroy(); }
    state.items = [];
  }

  function clearFeatures() {
    for (const f of state.features) f.sprite.destroy();
    state.features = [];
  }
  function clearNpcs() {
    for (const n of state.npcs) { n.sprite.destroy(); n.label.destroy(); }
    state.npcs = [];
  }

  function spawnEnemies(count = 8) {
    if (state.world !== 'dungeon') return; // no enemies outside for now
    const exclude = new Set<string>();
    exclude.add(`${state.player.x},${state.player.y}`);
    const spots = sampleFloors(state.map, count, exclude, 6, state.player);
    for (const p of spots) {
      const s = new PIXI.AnimatedSprite({ textures: atlas.enemyFrames, autoUpdate: true });
      s.animationSpeed = 0.06;
      s.play();
      s.x = p.x * TILE_SIZE;
      s.y = p.y * TILE_SIZE;
      entityLayer.addChild(s);
      state.enemies.push({ x: p.x, y: p.y, sprite: s, seen: false, name: 'slime', hp: 5, maxHp: 5, atkMin: 1, atkMax: 2 });
    }
    if (count > 0) log(`You sense ${count} slimes nearby.`);
  }

  function isOccupied(x: number, y: number): boolean {
    return state.enemies.some((e) => e.x === x && e.y === y) || (state.player.x === x && state.player.y === y);
  }

  function enemyAt(x: number, y: number): Enemy | undefined {
    return state.enemies.find((e) => e.x === x && e.y === y);
  }
  function itemAt(x: number, y: number): Item | undefined {
    return state.items.find((i) => i.x === x && i.y === y);
  }

  function clearDoor() {
    if (state.door) {
      state.door.sprite.destroy();
      state.door.label.destroy();
    }
    state.door = null;
  }

  function clearHouseDoors() {
    for (const d of state.houseDoors) { d.sprite.destroy(); d.label.destroy(); }
    state.houseDoors = [];
  }

  function placeExitDoor() {
    // Find edge wall with interior adjacent floor, reachable from player
    const reach = reachableFrom(state.map, state.player.x, state.player.y);
    const candidates: Array<{ x: number; y: number; adjX: number; adjY: number }> = [];
    for (let x = 0; x < MAP_W; x++) {
      if (!state.map[0][x].walkable && state.map[1][x].walkable && reach.has(`${x},${1}`)) candidates.push({ x, y: 0, adjX: x, adjY: 1 });
      if (!state.map[MAP_H - 1][x].walkable && state.map[MAP_H - 2][x].walkable && reach.has(`${x},${MAP_H - 2}`)) candidates.push({ x, y: MAP_H - 1, adjX: x, adjY: MAP_H - 2 });
    }
    for (let y = 0; y < MAP_H; y++) {
      if (!state.map[y][0].walkable && state.map[y][1].walkable && reach.has(`${1},${y}`)) candidates.push({ x: 0, y, adjX: 1, adjY: y });
      if (!state.map[y][MAP_W - 1].walkable && state.map[y][MAP_W - 2].walkable && reach.has(`${MAP_W - 2},${y}`)) candidates.push({ x: MAP_W - 1, y, adjX: MAP_W - 2, adjY: y });
    }
    let spot: { x: number; y: number; adjX: number; adjY: number } | null = null;
    if (candidates.length) {
      spot = candidates[Math.floor(Math.random() * candidates.length)];
    } else {
      // Fallback: choose a reachable interior tile that touches the boundary, and put a door on the boundary side
      for (const key of reach) {
        const [rx, ry] = key.split(',').map(Number);
        if (ry === 1 && !state.map[0][rx].walkable) { spot = { x: rx, y: 0, adjX: rx, adjY: 1 }; break; }
        if (ry === MAP_H - 2 && !state.map[MAP_H - 1][rx].walkable) { spot = { x: rx, y: MAP_H - 1, adjX: rx, adjY: MAP_H - 2 }; break; }
        if (rx === 1 && !state.map[ry][0].walkable) { spot = { x: 0, y: ry, adjX: 1, adjY: ry }; break; }
        if (rx === MAP_W - 2 && !state.map[ry][MAP_W - 1].walkable) { spot = { x: MAP_W - 1, y: ry, adjX: MAP_W - 2, adjY: ry }; break; }
      }
      if (!spot) return; // give up; extremely unlikely
    }
    const s = new PIXI.Sprite(atlas.doorClosed);
    s.x = spot.x * TILE_SIZE; s.y = spot.y * TILE_SIZE;
    itemsLayer.addChild(s);
    const label = new PIXI.Text({ text: 'O to open', style: { fill: '#f7d154', fontSize: 10 } });
    label.anchor.set(0.5, 1);
    label.x = s.x + TILE_SIZE / 2; label.y = s.y - 2; label.visible = false;
    itemsLayer.addChild(label);
    state.door = { x: spot.x, y: spot.y, open: false, sprite: s, label };
  }

  function placeEntranceDoorOutside() {
    // Place door on a grass tile and set player just outside it
    // Prefer the 'start' area at center-ish; find a walkable tile for door and one adjacent for player
    const candidates: Array<{ x: number; y: number }> = [];
    for (let y = 1; y < MAP_H - 1; y++) for (let x = 1; x < MAP_W - 1; x++) if (state.map[y][x].walkable) candidates.push({ x, y });
    if (!candidates.length) return;
    const doorPos = candidates[Math.floor(Math.random() * candidates.length)];
    const s = new PIXI.Sprite(atlas.doorClosed);
    s.x = doorPos.x * TILE_SIZE; s.y = doorPos.y * TILE_SIZE;
    itemsLayer.addChild(s);
    const label = new PIXI.Text({ text: 'O to enter', style: { fill: '#f7d154', fontSize: 10 } });
    label.anchor.set(0.5, 1);
    label.x = s.x + TILE_SIZE / 2; label.y = s.y - 2; label.visible = false;
    itemsLayer.addChild(label);
    state.door = { x: doorPos.x, y: doorPos.y, open: false, sprite: s, label };
    // place player on adjacent grass
    const dirs: Array<[number, number]> = [[1,0],[-1,0],[0,1],[0,-1]];
    for (const d of dirs) {
      const nx = doorPos.x + d[0], ny = doorPos.y + d[1];
      if (nx >= 0 && ny >= 0 && nx < MAP_W && ny < MAP_H && state.map[ny][nx].walkable) {
        state.player.x = nx; state.player.y = ny; break;
      }
    }
  }

  function enterHouse(kind: HouseType) {
    // Save overworld snapshot including houses before entering
    overworldSave = {
      map: state.map,
      door: state.door ? { x: state.door.x, y: state.door.y, open: state.door.open } : { x: 0, y: 0, open: false },
      player: { x: state.player.x, y: state.player.y },
      features: state.features.map(f => ({ x: f.x, y: f.y, kind: f.kind })),
      houses: state.houseDoors.map(h => ({ x: h.x, y: h.y, open: h.open, kind: h.kind }))
    };
    state.world = 'house';
    state.currentHouse = { kind, x: state.player.x, y: state.player.y };
    transitionFlag = 'none';
    // Build interior room
    state.map = Array.from({ length: MAP_H }, () => Array.from({ length: MAP_W }, () => ({ walkable: false, visible: false, explored: false })));
    const rw = 20, rh = 12;
    const rx0 = Math.floor((MAP_W - rw) / 2), ry0 = Math.floor((MAP_H - rh) / 2);
    for (let y = ry0; y < ry0 + rh; y++) for (let x = rx0; x < rx0 + rw; x++) state.map[y][x].walkable = true;
    clearFeatures(); clearNpcs(); clearDoor();
    // Decor common lamps
    const addFeature = (x:number,y:number,tex:PIXI.Texture,blocks=false)=>{ const s=new PIXI.Sprite(tex); s.x=x*TILE_SIZE; s.y=y*TILE_SIZE; featureLayer.addChild(s); state.features.push({x,y,kind:'house',sprite:s} as any); if(blocks) state.map[y][x].walkable=false; };
    addFeature(rx0+1, ry0+1, atlas.lamp, false);
    addFeature(rx0+rw-2, ry0+1, atlas.lamp, false);
    // Kind-specific decoration
    if (kind === 'inn') {
      for (let i=0;i<4;i++) addFeature(rx0+2+i*4, ry0+2, atlas.bed, true);
      for (let i=0;i<2;i++) addFeature(rx0+rw-3, ry0+3+i*3, atlas.bed, true);
      for (let x=rx0+3; x<rx0+rw-3; x++) addFeature(x, ry0+rh-3, atlas.bar, true);
      const ns = new PIXI.Sprite(atlas.npc); ns.tint=0xffe29b; ns.x=(rx0+Math.floor(rw/2))*TILE_SIZE; ns.y=(ry0+rh-4)*TILE_SIZE; entityLayer.addChild(ns);
      const lbl = new PIXI.Text({text:'E to talk', style:{fill:'#f7d154', fontSize:10}}); lbl.anchor.set(0.5,1); lbl.x = ns.x + TILE_SIZE/2; lbl.y = ns.y - 2; lbl.visible=false; itemsLayer.addChild(lbl);
      state.npcs.push({ x: rx0+Math.floor(rw/2), y: ry0+rh-4, sprite: ns, label: lbl, name: 'Innkeeper' });
    } else if (kind === 'tavern') {
      for (let x=rx0+2; x<rx0+rw-2; x++) addFeature(x, ry0+2, atlas.bar, true);
      for (let i=0;i<3;i++) addFeature(rx0+4+i*5, ry0+6, atlas.table, true);
      const ns = new PIXI.Sprite(atlas.npc); ns.tint=0xffbe76; ns.x=(rx0+3)*TILE_SIZE; ns.y=(ry0+3)*TILE_SIZE; entityLayer.addChild(ns);
      const lbl = new PIXI.Text({text:'E to talk', style:{fill:'#f7d154', fontSize:10}}); lbl.anchor.set(0.5,1); lbl.x = ns.x + TILE_SIZE/2; lbl.y = ns.y - 2; lbl.visible=false; itemsLayer.addChild(lbl);
      state.npcs.push({ x: rx0+3, y: ry0+3, sprite: ns, label: lbl, name: 'Barkeep' });
    } else if (kind === 'smith') {
      addFeature(rx0+3, ry0+3, atlas.anvil, true);
      addFeature(rx0+rw-4, ry0+3, atlas.shelf, true);
      addFeature(rx0+rw-4, ry0+5, atlas.shelf, true);
      const ns = new PIXI.Sprite(atlas.npc); ns.tint=0xc0c0c0; ns.x=(rx0+4)*TILE_SIZE; ns.y=(ry0+5)*TILE_SIZE; entityLayer.addChild(ns);
      const lbl = new PIXI.Text({text:'E to talk', style:{fill:'#f7d154', fontSize:10}}); lbl.anchor.set(0.5,1); lbl.x = ns.x + TILE_SIZE/2; lbl.y = ns.y - 2; lbl.visible=false; itemsLayer.addChild(lbl);
      state.npcs.push({ x: rx0+4, y: ry0+5, sprite: ns, label: lbl, name: 'Blacksmith' });
    } else { // mage
      for (let y=ry0+4;y<ry0+8;y++) for (let x=rx0+7;x<rx0+13;x++) addFeature(x,y, atlas.rune, false);
      addFeature(rx0+rw-5, ry0+3, atlas.shelf, true);
      addFeature(rx0+rw-7, ry0+3, atlas.shelf, true);
      const ns = new PIXI.Sprite(atlas.npc); ns.tint=0xa29bfe; ns.x=(rx0+10)*TILE_SIZE; ns.y=(ry0+6)*TILE_SIZE; entityLayer.addChild(ns);
      const lbl = new PIXI.Text({text:'E to talk', style:{fill:'#f7d154', fontSize:10}}); lbl.anchor.set(0.5,1); lbl.x = ns.x + TILE_SIZE/2; lbl.y = ns.y - 2; lbl.visible=false; itemsLayer.addChild(lbl);
      state.npcs.push({ x: rx0+10, y: ry0+6, sprite: ns, label: lbl, name: 'Mage' });
    }
    // Exit door
    const ex = rx0 + Math.floor(rw / 2), ey = ry0 + rh; const doorY = ey - 1; const doorX = ex;
    state.map[doorY][doorX].walkable = true;
    const ds = new PIXI.Sprite(atlas.doorOpen); ds.x = doorX*TILE_SIZE; ds.y = doorY*TILE_SIZE; itemsLayer.addChild(ds);
    const label = new PIXI.Text({ text: 'O to exit', style: { fill: '#f7d154', fontSize: 10 } }); label.anchor.set(0.5,1); label.x=ds.x+TILE_SIZE/2; label.y=ds.y-2; label.visible=false; itemsLayer.addChild(label);
    state.door = { x: doorX, y: doorY, open: true, sprite: ds, label };
    state.player.x = doorX; state.player.y = doorY - 1;
    buildMapSprites(state); updateFOVAndVisibility(); updatePlayerSprite(); centerCameraOnPlayer(); app.renderer.render(app.stage);
  }
  function rebuildFeaturesFromState() {
    clearFeatures();
    for (const f of state.features) {
      const tex = f.kind === 'path' ? atlas.path : atlas.house;
      const s = new PIXI.Sprite(tex);
      s.x = f.x * TILE_SIZE; s.y = f.y * TILE_SIZE;
      featureLayer.addChild(s);
      f.sprite = s;
    }
    // Rebuild house doors if saved
    clearHouseDoors();
    if (overworldSave?.houses) {
      for (const h of overworldSave.houses) {
        const s = new PIXI.Sprite(h.open ? atlas.doorOpen : atlas.doorClosed);
        s.x = h.x * TILE_SIZE; s.y = h.y * TILE_SIZE;
        itemsLayer.addChild(s);
        const label = new PIXI.Text({ text: 'O to enter', style: { fill: '#f7d154', fontSize: 10 } });
        label.anchor.set(0.5, 1); label.x = s.x + TILE_SIZE/2; label.y = s.y - 2; label.visible = false;
        itemsLayer.addChild(label);
        state.houseDoors.push({ x: h.x, y: h.y, open: h.open, sprite: s, label, kind: h.kind });
        // ensure blocking if closed
        state.map[h.y][h.x].walkable = h.open;
      }
    }
  }

  function placeVillage() {
    // Simple 5x5 plaza with 4 houses in corners and paths cross
    const reach = reachableFrom(state.map, state.player.x, state.player.y);
    const tries = 50;
    for (let t = 0; t < tries; t++) {
      const cx = 3 + Math.floor(Math.random() * (MAP_W - 6));
      const cy = 3 + Math.floor(Math.random() * (MAP_H - 6));
      // center tile must be reachable and on grass
      if (!reach.has(`${cx},${cy}`)) continue;
      // Check area is on grass (walkable)
      let ok = true;
      for (let y = cy - 2; y <= cy + 2 && ok; y++) {
        for (let x = cx - 2; x <= cx + 2; x++) {
          if (!state.map[y][x].walkable) { ok = false; break; }
        }
      }
      if (!ok) continue;
      // Paths: lines through center
      const pathTiles: Array<{ x: number; y: number }> = [];
      for (let x = cx - 2; x <= cx + 2; x++) pathTiles.push({ x, y: cy });
      for (let y = cy - 2; y <= cy + 2; y++) pathTiles.push({ x: cx, y });
      // Houses: 2x2 blocks in corners, each with its own door facing center
      const houseTopLefts: Array<{ x: number; y: number }> = [
        { x: cx - 2, y: cy - 2 }, // NW
        { x: cx + 1, y: cy - 2 }, // NE
        { x: cx - 2, y: cy + 1 }, // SW
        { x: cx + 1, y: cy + 1 }, // SE
      ];
      // Types shuffled
      const kinds: HouseType[] = ['inn','tavern','smith','mage'];
      for (let i = kinds.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [kinds[i], kinds[j]] = [kinds[j], kinds[i]]; }

      // Apply features
      for (const p of pathTiles) {
        const s = new PIXI.Sprite(atlas.path);
        s.x = p.x * TILE_SIZE; s.y = p.y * TILE_SIZE;
        featureLayer.addChild(s);
        state.features.push({ x: p.x, y: p.y, kind: 'path', sprite: s });
      }
      // Place houses and doors
      clearHouseDoors();
      houseTopLefts.forEach((tl, idx) => {
        const kind = kinds[idx];
        // which tile within 2x2 is the door (facing plaza center)
        const dx = tl.x < cx ? 1 : 0;
        const dy = tl.y < cy ? 1 : 0;
        const doorX = tl.x + dx;
        const doorY = tl.y + dy;
        for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) {
          const px = tl.x + x, py = tl.y + y;
          if (px === doorX && py === doorY) continue; // skip house tile, door will be drawn here
          const hs = new PIXI.Sprite(atlas.house);
          hs.x = px * TILE_SIZE; hs.y = py * TILE_SIZE;
          featureLayer.addChild(hs);
          state.features.push({ x: px, y: py, kind: 'house', sprite: hs });
          state.map[py][px].walkable = false;
        }
        // Door sprite
        const ds = new PIXI.Sprite(atlas.doorClosed);
        ds.x = doorX * TILE_SIZE; ds.y = doorY * TILE_SIZE;
        itemsLayer.addChild(ds);
        const label = new PIXI.Text({ text: `O to enter`, style: { fill: '#f7d154', fontSize: 10 } });
        label.anchor.set(0.5, 1); label.x = ds.x + TILE_SIZE/2; label.y = ds.y - 2; label.visible = false;
        itemsLayer.addChild(label);
        state.houseDoors.push({ x: doorX, y: doorY, open: false, sprite: ds, label, kind });
        state.map[doorY][doorX].walkable = false;
        // Icon letter on roof near center of 2x2
        const iconMap: Record<HouseType, { ch: string; color: string }> = {
          inn: { ch: 'I', color: '#ffffff' },
          tavern: { ch: 'T', color: '#ffd166' },
          smith: { ch: 'S', color: '#d3d3d3' },
          mage: { ch: 'M', color: '#a29bfe' },
        };
        const ic = iconMap[kind];
        const icon = new PIXI.Text({ text: ic.ch, style: { fill: ic.color, fontSize: 10 } });
        icon.anchor.set(0.5);
        icon.x = (tl.x + 1) * TILE_SIZE - TILE_SIZE/2; // center of 2x2 cluster
        icon.y = (tl.y + 1) * TILE_SIZE - TILE_SIZE/2;
        featureLayer.addChild(icon);
      });
      log('You discover a village.');
      return;
    }
  }

  function removeEnemy(enemy: Enemy) {
    const idx = state.enemies.indexOf(enemy);
    if (idx >= 0) state.enemies.splice(idx, 1);
    enemy.sprite.destroy();
  }

  function playerAttack(enemy: Enemy) {
    const dmg = randInt(state.player.atkMin, state.player.atkMax);
    enemy.hp -= dmg;
    if (enemy.hp <= 0) {
      // Capture drop tile BEFORE removing enemy
      const dropTileX = enemy.x;
      const dropTileY = enemy.y;
      removeEnemy(enemy);
      const coins = randInt(1, 3);
      state.player.gold += coins;
      log(`You slay the ${enemy.name}! +${coins} gold`);
      renderStats();
      // 30% chance to drop a potion at enemy position
      if (Math.random() < 0.3) {
        const drop = new PIXI.Sprite(atlas.potion);
        drop.x = dropTileX * TILE_SIZE;
        drop.y = dropTileY * TILE_SIZE;
        itemsLayer.addChild(drop);
        // Tooltip label
        const label = new PIXI.Text({ text: 'P to pick up', style: { fill: '#f7d154', fontSize: 10 } });
        label.anchor.set(0.5, 1);
        label.x = drop.x + TILE_SIZE / 2;
        label.y = drop.y - 2;
        itemsLayer.addChild(label);
        state.items.push({ x: dropTileX, y: dropTileY, kind: 'potion', sprite: drop, label });
        drop.visible = true; // will be reconciled on next FOV update
        label.visible = false; // only show on same tile
        log('A healing potion drops.');
      }
      return 'killed' as const;
    } else {
      log(`You hit the ${enemy.name} for ${dmg}.`);
      return 'hit' as const;
    }
  }

  function enemyAttack(enemy: Enemy) {
    const dmg = randInt(enemy.atkMin, enemy.atkMax);
    state.player.hp -= dmg;
    log(`The ${enemy.name} hits you for ${dmg}.`);
    if (state.player.hp <= 0) {
      state.player.hp = 0;
      gameOver = true;
      log('You die. Press R to restart.');
    }
    renderStats();
  }

  function moveEnemies() {
    if (gameOver) return;
    const blocks = new Set<string>();
    for (const e of state.enemies) blocks.add(`${e.x},${e.y}`);
    blocks.add(`${state.player.x},${state.player.y}`);
    for (const e of state.enemies) {
      // Free current tile temporarily to allow moving off it
      blocks.delete(`${e.x},${e.y}`);
      // If adjacent, attack instead of moving
      const dx = Math.abs(e.x - state.player.x);
      const dy = Math.abs(e.y - state.player.y);
      if (dx + dy === 1) {
        enemyAttack(e);
        blocks.add(`${e.x},${e.y}`);
        if (gameOver) return;
        continue;
      }
      const step = aStarNextStep(state.map, { x: e.x, y: e.y }, state.player, blocks);
      let nx = e.x, ny = e.y;
      if (step && !isOccupied(step.x, step.y) && coreCanWalk(state.map, step.x, step.y)) {
        nx = step.x; ny = step.y;
      } else {
        // random nudge if no path
        const dirs: Array<[number, number]> = [[1,0],[-1,0],[0,1],[0,-1]];
        const d = dirs[Math.floor(Math.random()*dirs.length)];
        const rx = e.x + d[0], ry = e.y + d[1];
        if (coreCanWalk(state.map, rx, ry) && !isOccupied(rx, ry)) { nx = rx; ny = ry; }
      }
      e.x = nx; e.y = ny;
      e.sprite.x = nx * TILE_SIZE;
      e.sprite.y = ny * TILE_SIZE;
      blocks.add(`${e.x},${e.y}`);
    }
  }
  function regen(fullReset = false) {
    // clear old sprites if any
    for (const row of tileSprites) for (const s of row) s.destroy();
    for (const row of shroudSprites) for (const s of row) s.destroy();
    tileSprites.length = 0;
    shroudSprites.length = 0;

    clearDoor();
    // Handle transitions with saves
    clearItems();
    clearEnemies();
    clearFeatures();
    clearHouseDoors();
    if (state.world === 'dungeon' && transitionFlag === 'toDungeon' && dungeonSave) {
      // Restore previous dungeon
      state.map = dungeonSave.map;
      // Recreate door
      const s = new PIXI.Sprite(dungeonSave.door.open ? atlas.doorOpen : atlas.doorClosed);
      s.x = dungeonSave.door.x * TILE_SIZE; s.y = dungeonSave.door.y * TILE_SIZE;
      itemsLayer.addChild(s);
      const label = new PIXI.Text({ text: 'O to open', style: { fill: '#f7d154', fontSize: 10 } });
      label.anchor.set(0.5, 1); label.x = s.x + TILE_SIZE/2; label.y = s.y - 2; label.visible = false;
      itemsLayer.addChild(label);
      state.door = { x: dungeonSave.door.x, y: dungeonSave.door.y, open: dungeonSave.door.open, sprite: s, label };
      // Player position: just inside where they left
      state.player.x = dungeonSave.player.x; state.player.y = dungeonSave.player.y;
    } else if (state.world === 'overworld' && transitionFlag === 'toOverworld') {
      if (overworldSave) {
        state.map = overworldSave.map;
        const s = new PIXI.Sprite(overworldSave.door.open ? atlas.doorOpen : atlas.doorClosed);
        s.x = overworldSave.door.x * TILE_SIZE; s.y = overworldSave.door.y * TILE_SIZE;
        itemsLayer.addChild(s);
        const label = new PIXI.Text({ text: 'O to enter', style: { fill: '#f7d154', fontSize: 10 } });
        label.anchor.set(0.5, 1); label.x = s.x + TILE_SIZE/2; label.y = s.y - 2; label.visible = false;
        itemsLayer.addChild(label);
        state.door = { x: overworldSave.door.x, y: overworldSave.door.y, open: overworldSave.door.open, sprite: s, label };
        // restore features
        if (overworldSave.features) {
          state.features = overworldSave.features.map(f => ({ x: f.x, y: f.y, kind: f.kind, sprite: new PIXI.Sprite(f.kind === 'path' ? atlas.path : atlas.house) }));
          for (const f of state.features) { f.sprite.x = f.x * TILE_SIZE; f.sprite.y = f.y * TILE_SIZE; featureLayer.addChild(f.sprite); }
        }
        // restore house doors
        if (overworldSave.houses) {
          for (const h of overworldSave.houses) {
            const dh = new PIXI.Sprite(h.open ? atlas.doorOpen : atlas.doorClosed);
            dh.x = h.x * TILE_SIZE; dh.y = h.y * TILE_SIZE; itemsLayer.addChild(dh);
            const l = new PIXI.Text({ text: 'O to enter', style: { fill: '#f7d154', fontSize: 10 } });
            l.anchor.set(0.5,1); l.x = dh.x + TILE_SIZE/2; l.y = dh.y - 2; l.visible = false; itemsLayer.addChild(l);
            state.houseDoors.push({ x: h.x, y: h.y, open: h.open, sprite: dh, label: l, kind: h.kind });
            state.map[h.y][h.x].walkable = h.open;
          }
        }
        state.player.x = overworldSave.player.x; state.player.y = overworldSave.player.y;
      } else {
        const g = makeOverworld();
        state.map = g.map;
        placeEntranceDoorOutside();
        placeVillage();
        // Save overworld snapshot
        if (state.door) overworldSave = { map: state.map, door: { x: state.door.x, y: state.door.y, open: state.door.open }, player: { x: state.player.x, y: state.player.y }, features: state.features.map(f => ({ x: f.x, y: f.y, kind: f.kind })), houses: state.houseDoors.map(h => ({ x: h.x, y: h.y, open: h.open, kind: h.kind })) };
      }
    } else {
      // Regular regeneration (R) or initial load
      const g = state.world === 'dungeon' ? makeDungeon() : makeOverworld();
      state.map = g.map;
      state.player.x = g.start.x; state.player.y = g.start.y;
      if (state.world === 'dungeon' && fullReset) {
        state.player.hp = 10; state.player.maxHp = 10; state.player.atkMin = 2; state.player.atkMax = 4; state.player.gold = 0;
        state.inventory.potion = 0;
      }
      if (state.world === 'dungeon') {
        spawnEnemies(10);
        placeExitDoor();
      } else {
        placeEntranceDoorOutside();
        placeVillage();
        overworldSave = { map: state.map, door: state.door ? { x: state.door.x, y: state.door.y, open: state.door.open } : { x: 0, y: 0, open: false }, player: { x: state.player.x, y: state.player.y }, features: state.features.map(f => ({ x: f.x, y: f.y, kind: f.kind })) };
      }
    }
    transitionFlag = 'none';
    buildMapSprites(state);
    updateFOVAndVisibility();
    updatePlayerSprite();
    centerCameraOnPlayer();
    // Pre-render once to initialize GPU resources eagerly
    // Adjust background to match world ambiance
    app.renderer.background.color = state.world === 'dungeon' ? 0x0f0f12 : 0x8ecae6; // dark vs sky blue
    app.renderer.render(app.stage);
    log(state.world === 'dungeon' ? 'You enter a new dungeon.' : 'You step outside. The air is fresh.');
    renderStats();
  }

function updateFOVAndVisibility() {
  // Reset visible
  for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) state.map[y][x].visible = false;

  const radius = state.world === 'overworld' ? Math.max(12, FOV_RADIUS) : (state.world === 'house' ? 14 : FOV_RADIUS);
  const vis = computeVisible(state.map, state.player.x, state.player.y, radius);
  // Always reveal the player's current tile, regardless of topology quirks
  vis.add(`${state.player.x},${state.player.y}`);
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      if (vis.has(`${x},${y}`)) {
        const t = state.map[y][x];
        t.visible = true;
        t.explored = true;
      }
    }
  }
  // Update enemy visibility to match FOV
  let spotted = false;
  for (const e of state.enemies) {
    const visible = vis.has(`${e.x},${e.y}`);
    e.sprite.visible = visible;
    if (visible && !e.seen && !spotted) {
      e.seen = true;
      spotted = true;
      log(`You spot a ${e.name}.`);
    }
  }
  // Items visibility and tooltip display when standing on item
  for (const it of state.items) {
    const visible = vis.has(`${it.x},${it.y}`);
    it.sprite.visible = visible;
    if (it.label) {
      it.label.x = it.sprite.x + TILE_SIZE / 2;
      it.label.y = it.sprite.y - 2;
      it.label.visible = visible && state.player.x === it.x && state.player.y === it.y;
    }
  }
  // Door label when adjacent
  if (state.door) {
    const d = state.door;
    const visible = vis.has(`${d.x},${d.y}`);
    const adj = Math.abs(state.player.x - d.x) + Math.abs(state.player.y - d.y) === 1;
    d.label.visible = visible && adj && !d.open;
  }
  // House door labels when adjacent
  if (state.world === 'overworld') {
    for (const hd of state.houseDoors) {
      const visible = vis.has(`${hd.x},${hd.y}`);
      const adj = Math.abs(state.player.x - hd.x) + Math.abs(state.player.y - hd.y) === 1;
      hd.label.visible = visible && adj && !hd.open;
    }
  }
  // NPC talk label when adjacent (inside house)
  if (state.world === 'house') {
    for (const n of state.npcs) {
      const visible = vis.has(`${n.x},${n.y}`);
      const adj = Math.abs(state.player.x - n.x) + Math.abs(state.player.y - n.y) === 1;
      n.label.visible = visible && adj;
    }
  }

  // Update shroud alpha (world-specific)
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      const t = state.map[y][x];
      const sh = shroudSprites[y][x];
      if (t.visible) { sh.alpha = 0; continue; }
      if (t.explored) {
        // Slight dim outdoors to indicate outside FOV; stronger in dungeons
        sh.alpha = state.world === 'overworld' ? 0.18 : (state.world === 'house' ? 0.35 : 0.65);
      } else {
        sh.alpha = state.world === 'overworld' ? 1.0 : (state.world === 'house' ? 0.85 : 0.9);
      }
    }
  }
  }

const canWalk = (x: number, y: number) => coreCanWalk(state.map, x, y);

  function updatePlayerSprite() {
    playerSprite.x = state.player.x * TILE_SIZE;
    playerSprite.y = state.player.y * TILE_SIZE;
  }

  function centerCameraOnPlayer() {
    const viewW = app.renderer.width;
    const viewH = app.renderer.height;
    const targetX = state.player.x * TILE_SIZE + TILE_SIZE / 2;
    const targetY = state.player.y * TILE_SIZE + TILE_SIZE / 2;
    world.x = Math.floor(viewW / 2 - targetX);
    world.y = Math.floor(viewH / 2 - targetY);
  }

  // Input: turn-based movement
  const keyToDelta: Record<string, [number, number]> = {
    ArrowUp: [0, -1],
    ArrowDown: [0, 1],
    ArrowLeft: [-1, 0],
    ArrowRight: [1, 0],
    w: [0, -1],
    s: [0, 1],
    a: [-1, 0],
    d: [1, 0],
  };

  window.addEventListener('keydown', (e) => {
    if (inventoryOpen) {
      if (e.key === 'i' || e.key === 'I' || e.key === 'Escape') { toggleInventory(); return; }
      if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') { e.preventDefault(); moveInventorySelection(-1); return; }
      if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') { e.preventDefault(); moveInventorySelection(1); return; }
      if (e.key === 'Enter') { e.preventDefault(); useSelectedInventoryItem(); return; }
      // ignore other keys while modal open
      return;
    }
    if (gameOver && !(e.key === 'r' || e.key === 'R')) {
      log('You are dead. Press R to restart.');
      return;
    }
    if (e.key === 'r' || e.key === 'R') {
      gameOver = false;
      regen(true);
      return;
    }
    if ((e.key === 'o' || e.key === 'O')) {
      // Try main door
      if (state.door && !state.door.open) {
        const d0 = state.door;
        const adj0 = Math.abs(state.player.x - d0.x) + Math.abs(state.player.y - d0.y) === 1;
        if (adj0) {
          d0.open = true; d0.sprite.texture = atlas.doorOpen; state.map[d0.y][d0.x].walkable = true; log('You open the door.'); updateFOVAndVisibility();
          return;
        }
      }
      // Try house doors (overworld)
      if (state.world === 'overworld') {
        for (const hd of state.houseDoors) {
          if (!hd.open && Math.abs(state.player.x - hd.x) + Math.abs(state.player.y - hd.y) === 1) {
            hd.open = true; hd.sprite.texture = atlas.doorOpen; state.map[hd.y][hd.x].walkable = true; log(`You open the ${hd.kind}.`); updateFOVAndVisibility(); return;
          }
        }
      }
      log('You are too far to open the door.');
      return;
    }
    if (e.key === 'i' || e.key === 'I') { toggleInventory(); return; }
    if (e.key === 'e' || e.key === 'E') {
      if (state.world === 'house') {
        const npc = state.npcs.find(n => Math.abs(state.player.x - n.x) + Math.abs(state.player.y - n.y) === 1);
        if (npc) {
          const msg = npc.name === 'Innkeeper' ? 'A warm bed heals the soul.'
                    : npc.name === 'Barkeep' ? 'Care for a drink? Tales are traded here.'
                    : npc.name === 'Blacksmith' ? 'Need your gear mended?'
                    : 'Arcane knowledge for a price.';
          log(msg);
          return;
        }
      }
    }
    if (e.key === 'p' || e.key === 'P') {
      const it = itemAt(state.player.x, state.player.y);
      if (it && it.kind === 'potion') {
        state.inventory.potion += 1;
        it.sprite.destroy();
        it.label?.destroy();
        state.items.splice(state.items.indexOf(it), 1);
        log('You pick up a healing potion.');
        renderInventory();
        renderStats();
      } else {
        log('There is nothing to pick up.');
      }
      return;
    }
    const d = keyToDelta[e.key];
    if (!d) return;
    e.preventDefault();
  const nx = state.player.x + d[0];
  const ny = state.player.y + d[1];
  const foe = enemyAt(nx, ny);
  if (foe) {
    const result = playerAttack(foe);
    if (result === 'killed') {
      state.player.x = nx;
      state.player.y = ny;
      updatePlayerSprite();
    }
    updateFOVAndVisibility();
    centerCameraOnPlayer();
    moveEnemies();
    updateFOVAndVisibility();
    renderStats();
    return;
  }
  if (canWalk(nx, ny)) {
    state.player.x = nx;
    state.player.y = ny;
    updatePlayerSprite();
    updateFOVAndVisibility();
    centerCameraOnPlayer();
    moveEnemies();
    updateFOVAndVisibility();
    const dir = d[0] === 1 ? 'east' : d[0] === -1 ? 'west' : d[1] === 1 ? 'south' : 'north';
    log(`You move ${dir}.`);
    renderStats();
    // Transition if stepping through opened door
    if (state.world === 'dungeon' && state.door && state.door.open && state.player.x === state.door.x && state.player.y === state.door.y) {
      // Save dungeon snapshot
      dungeonSave = { map: state.map, door: { x: state.door.x, y: state.door.y, open: true }, player: { x: state.player.x, y: state.player.y } };
      state.world = 'overworld';
      transitionFlag = 'toOverworld';
      regen();
    }
    if (state.world === 'overworld' && state.door && state.door.open && state.player.x === state.door.x && state.player.y === state.door.y) {
      state.world = 'dungeon';
      transitionFlag = 'toDungeon';
      regen();
    }
    if (state.world === 'overworld') {
      const hd = state.houseDoors.find(h => h.open && h.x === state.player.x && h.y === state.player.y);
      if (hd) { enterHouse(hd.kind); return; }
    }
    // Enter house from overworld
    if (state.world === 'overworld') {
      const hd = state.houseDoors.find(h => h.open && h.x === state.player.x && h.y === state.player.y);
      if (hd) {
        // Save overworld including house doors
        overworldSave = {
          map: state.map,
          door: state.door ? { x: state.door.x, y: state.door.y, open: state.door.open } : { x: 0, y: 0, open: false },
          player: { x: state.player.x, y: state.player.y },
          features: state.features.map(f => ({ x: f.x, y: f.y, kind: f.kind })),
          houses: state.houseDoors.map(h => ({ x: h.x, y: h.y, open: h.open, kind: h.kind }))
        };
        state.world = 'house';
        state.currentHouse = { kind: hd.kind, x: hd.x, y: hd.y };
        transitionFlag = 'none';
        // Build simple interior map
        // Walls everywhere, carve central room
        state.map = Array.from({ length: MAP_H }, (_, y) => Array.from({ length: MAP_W }, (_, x) => ({ walkable: false, visible: false, explored: false })));
        const rw = 20, rh = 12;
        const rx0 = Math.floor((MAP_W - rw) / 2), ry0 = Math.floor((MAP_H - rh) / 2);
        for (let y = ry0; y < ry0 + rh; y++) for (let x = rx0; x < rx0 + rw; x++) state.map[y][x].walkable = true;
        // Place exit door at bottom center of room
        clearDoor();
        const ex = rx0 + Math.floor(rw / 2), ey = ry0 + rh; // on wall; use ey-1 tile as door tile
        const doorY = ey - 1; const doorX = ex;
        state.map[doorY][doorX].walkable = true;
        const ds = new PIXI.Sprite(atlas.doorOpen);
        ds.x = doorX * TILE_SIZE; ds.y = doorY * TILE_SIZE; itemsLayer.addChild(ds);
        const label = new PIXI.Text({ text: 'O to exit', style: { fill: '#f7d154', fontSize: 10 } });
        label.anchor.set(0.5, 1); label.x = ds.x + TILE_SIZE/2; label.y = ds.y - 2; label.visible = false;
        itemsLayer.addChild(label);
        state.door = { x: doorX, y: doorY, open: true, sprite: ds, label };
        // Place player inside near door
        state.player.x = doorX; state.player.y = doorY - 1;
        buildMapSprites(state);
        updateFOVAndVisibility(); updatePlayerSprite(); centerCameraOnPlayer(); app.renderer.render(app.stage);
      }
    }
    // Exit house back to overworld when stepping onto interior door
    if (state.world === 'house' && state.door && state.player.x === state.door.x && state.player.y === state.door.y) {
      state.world = 'overworld';
      transitionFlag = 'toOverworld';
      // Return to the house door tile outside
      if (overworldSave && state.currentHouse) {
        overworldSave.player = { x: state.currentHouse.x, y: state.currentHouse.y };
      }
      regen();
    }
  } else {
    log('You bump into a wall.');
  }
  });

  // Handle resize
  window.addEventListener('resize', () => {
    const w = Math.min(window.innerWidth, MAP_W * TILE_SIZE);
    const h = Math.min(window.innerHeight, MAP_H * TILE_SIZE);
    app.renderer.resize(w, h);
    centerCameraOnPlayer();
  });

  // Start
  regen();
}

// Kick it off (no top-level await)
main().catch((err) => console.error(err));
