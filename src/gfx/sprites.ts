import * as PIXI from 'pixi.js';

export type GameTextures = {
  floor: PIXI.Texture;
  wall: PIXI.Texture;
  shroud: PIXI.Texture;
  playerFrames: PIXI.Texture[];
  enemyFrames: PIXI.Texture[];
  potion: PIXI.Texture;
  grass: PIXI.Texture;
  tree: PIXI.Texture;
  doorClosed: PIXI.Texture;
  doorOpen: PIXI.Texture;
  path: PIXI.Texture;
  house: PIXI.Texture;
  wood: PIXI.Texture;      // indoor wood floor
  stone: PIXI.Texture;     // indoor stone floor
  rune: PIXI.Texture;      // magic floor
  bed: PIXI.Texture;
  table: PIXI.Texture;
  bar: PIXI.Texture;
  anvil: PIXI.Texture;
  shelf: PIXI.Texture;
  lamp: PIXI.Texture;
  npc: PIXI.Texture;
};

// Create a tiny generated atlas so we have real sprite frames
export function createGeneratedAtlas(app: PIXI.Application, tile = 16): GameTextures {
  const cols = 22;
  const rows = 1;
  const w = cols * tile;
  const h = rows * tile;

  // Draw into a Canvas2D (DOM element) to avoid non-DOM upload warnings
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;

  // Floor (0): checkerboard
  ctx.fillStyle = '#24242b';
  ctx.fillRect(0, 0, tile, tile);
  for (let y = 0; y < tile; y += 4) {
    for (let x = 0; x < tile; x += 4) {
      const even = ((x + y) / 4) % 2 === 0;
      ctx.fillStyle = even ? '#2f2f38' : '#272730';
      ctx.fillRect(x, y, 4, 4);
    }
  }

  // Wall (1)
  const wallX = tile;
  ctx.fillStyle = '#131319';
  ctx.fillRect(wallX, 0, tile, tile);
  ctx.fillStyle = '#1a1a22';
  ctx.fillRect(wallX + 1, 1, tile - 2, tile - 2);

  // Player frame 0 (2)
  const p0X = tile * 2;
  ctx.clearRect(p0X, 0, tile, tile);
  ctx.fillStyle = '#2b2410';
  ctx.beginPath();
  ctx.arc(p0X + tile / 2 + 1, tile / 2 + 1, tile * 0.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#f7d154';
  ctx.beginPath();
  ctx.arc(p0X + tile / 2, tile / 2, tile * 0.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(p0X + tile * 0.35, tile * 0.28, 3, 3);

  // Player frame 1 (3)
  const p1X = tile * 3;
  ctx.clearRect(p1X, 0, tile, tile);
  ctx.fillStyle = '#2b2410';
  ctx.beginPath();
  ctx.arc(p1X + tile / 2 + 1, tile / 2 + 1, tile * 0.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#f8de76';
  ctx.beginPath();
  ctx.arc(p1X + tile / 2, tile / 2, tile * 0.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(p1X + tile * 0.45, tile * 0.32, 2, 2);

  // Enemy frames (4,5): purple blob, 2 frames
  const e0X = tile * 4;
  const e1X = tile * 5;
  ctx.clearRect(e0X, 0, tile, tile);
  ctx.fillStyle = '#2a1230';
  ctx.beginPath();
  ctx.arc(e0X + tile / 2 + 1, tile / 2 + 1, tile * 0.35, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#b26ad6';
  ctx.beginPath();
  ctx.arc(e0X + tile / 2, tile / 2, tile * 0.35, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(e0X + tile * 0.55, tile * 0.40, 2, 2);

  ctx.clearRect(e1X, 0, tile, tile);
  ctx.fillStyle = '#2a1230';
  ctx.beginPath();
  ctx.arc(e1X + tile / 2 + 1, tile / 2 + 1, tile * 0.35, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#c07ae6';
  ctx.beginPath();
  ctx.arc(e1X + tile / 2, tile / 2, tile * 0.35, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(e1X + tile * 0.45, tile * 0.36, 2, 2);

  // Potion (6): red vial (transparent background)
  const potX = tile * 6;
  ctx.clearRect(potX, 0, tile, tile);
  // Bottle
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(potX + Math.round(tile * 0.46), Math.round(tile * 0.12), 3, 4); // cork
  ctx.fillStyle = '#b0d7ff';
  ctx.beginPath();
  ctx.arc(potX + tile / 2, tile * 0.58, tile * 0.35, 0, Math.PI * 2);
  ctx.fill();
  // Liquid
  ctx.fillStyle = '#ff4d59';
  ctx.beginPath();
  ctx.arc(potX + tile / 2, tile * 0.62, tile * 0.28, 0, Math.PI * 2);
  ctx.fill();
  // Highlight
  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  ctx.beginPath();
  ctx.arc(potX + tile * 0.58, tile * 0.48, tile * 0.07, 0, Math.PI * 2);
  ctx.fill();

  // Grass (7): brighter green checker
  const grassX = tile * 7;
  ctx.fillStyle = '#2f8f2f';
  ctx.fillRect(grassX, 0, tile, tile);
  for (let y = 0; y < tile; y += 4) {
    for (let x = 0; x < tile; x += 4) {
      const even = ((x + y) / 4) % 2 === 0;
      ctx.fillStyle = even ? '#38a33a' : '#2e8f32';
      ctx.fillRect(grassX + x, y, 4, 4);
    }
  }

  // Tree (8): trunk + canopy (brighter outdoors, with shadow ring)
  const treeX = tile * 8;
  ctx.clearRect(treeX, 0, tile, tile);
  ctx.fillStyle = '#7a4a2a';
  ctx.fillRect(treeX + tile * 0.43, tile * 0.55, Math.max(2, Math.floor(tile * 0.14)), Math.max(3, Math.floor(tile * 0.35)));
  // Shadow ring
  ctx.fillStyle = '#297a44';
  ctx.beginPath();
  ctx.arc(treeX + tile / 2, tile * 0.45, tile * 0.46, 0, Math.PI * 2);
  ctx.fill();
  // Canopy
  ctx.fillStyle = '#3fa95b';
  ctx.beginPath();
  ctx.arc(treeX + tile / 2, tile * 0.45, tile * 0.45, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#56c774';
  ctx.beginPath();
  ctx.arc(treeX + tile * 0.6, tile * 0.35, tile * 0.2, 0, Math.PI * 2);
  ctx.fill();

  // Door closed (9)
  const doorCX = tile * 9;
  ctx.clearRect(doorCX, 0, tile, tile);
  ctx.fillStyle = '#2a2a33';
  ctx.fillRect(doorCX, 0, tile, tile);
  ctx.fillStyle = '#6b4b2a';
  ctx.fillRect(doorCX + 3, 2, tile - 6, tile - 4);
  ctx.fillStyle = '#c9a36b';
  ctx.fillRect(doorCX + tile - 6, Math.floor(tile / 2) - 1, 2, 2); // knob

  // Door open (10)
  const doorOX = tile * 10;
  ctx.clearRect(doorOX, 0, tile, tile);
  ctx.fillStyle = '#2a2a33';
  ctx.fillRect(doorOX, 0, tile, tile);
  ctx.fillStyle = '#000000';
  ctx.fillRect(doorOX + 3, 2, tile - 6, tile - 4);

  // Path (11): light dirt
  const pathX = tile * 11;
  ctx.fillStyle = '#bda67a';
  ctx.fillRect(pathX, 0, tile, tile);
  for (let y = 0; y < tile; y += 4) {
    for (let x = 0; x < tile; x += 4) {
      const even = ((x + y) / 4) % 2 === 0;
      ctx.fillStyle = even ? '#cbb88e' : '#a89263';
      ctx.fillRect(pathX + x, y, 4, 4);
    }
  }

  // House (12): simple orange roof
  const houseX = tile * 12;
  ctx.clearRect(houseX, 0, tile, tile);
  ctx.fillStyle = '#cc5a2a';
  ctx.fillRect(houseX, 0, tile, tile);
  ctx.fillStyle = '#e37040';
  ctx.fillRect(houseX + 2, 2, tile - 4, tile - 4);

  // Wood floor (13) – high-contrast
  const woodX = tile * 13;
  ctx.fillStyle = '#e1b07a'; ctx.fillRect(woodX, 0, tile, tile);
  ctx.fillStyle = '#f1cc9d'; for (let y = 0; y < tile; y += 4) ctx.fillRect(woodX, y, tile, 2);

  // Stone floor (14) – high-contrast
  const stoneX = tile * 14;
  ctx.fillStyle = '#e3e3e3'; ctx.fillRect(stoneX, 0, tile, tile);
  ctx.fillStyle = '#ffffff'; for (let y = 0; y < tile; y += 4) for (let x = 0; x < tile; x += 4) ctx.fillRect(stoneX + x, y, 3, 3);

  // Rune floor (15) – high-contrast
  const runeX = tile * 15;
  ctx.fillStyle = '#cfd4ff'; ctx.fillRect(runeX, 0, tile, tile);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(runeX + tile * 0.45, tile * 0.2, 2, tile * 0.6);
  ctx.fillRect(runeX + tile * 0.3, tile * 0.45, tile * 0.4, 2);

  // Bed (16)
  const bedX = tile * 16;
  ctx.clearRect(bedX, 0, tile, tile);
  ctx.fillStyle = '#743a2a'; ctx.fillRect(bedX + 1, 1, tile - 2, tile - 2);
  ctx.fillStyle = '#c34a3a'; ctx.fillRect(bedX + 2, 2, tile - 4, tile - 6);
  ctx.fillStyle = '#e7e7ff'; ctx.fillRect(bedX + 2, tile - 6, tile - 4, 4);

  // Table (17)
  const tableX = tile * 17;
  ctx.fillStyle = '#7b4e2d'; ctx.fillRect(tableX + 1, 4, tile - 2, tile - 8);
  ctx.fillStyle = '#5b3c22'; ctx.fillRect(tableX + 2, 5, tile - 4, tile - 10);

  // Bar counter (18)
  const barX = tile * 18;
  ctx.fillStyle = '#6b3e23'; ctx.fillRect(barX, 0, tile, tile);
  ctx.fillStyle = '#4a2b17'; ctx.fillRect(barX, tile - 5, tile, 5);

  // Anvil (19)
  const anvilX = tile * 19;
  ctx.fillStyle = '#2f2f35'; ctx.fillRect(anvilX + 2, 6, tile - 4, 4);
  ctx.fillStyle = '#4b4b55'; ctx.fillRect(anvilX + 4, 3, tile - 8, 3);

  // Shelf (20)
  const shelfX = tile * 20;
  ctx.fillStyle = '#633d22'; ctx.fillRect(shelfX + 1, 1, tile - 2, tile - 2);
  ctx.fillStyle = '#b55'; ctx.fillRect(shelfX + 3, 4, tile - 6, 2);
  ctx.fillStyle = '#5b5'; ctx.fillRect(shelfX + 3, 8, tile - 6, 2);

  // Lamp (21)
  const lampX = tile * 21;
  ctx.clearRect(lampX, 0, tile, tile);
  ctx.fillStyle = '#444'; ctx.fillRect(lampX + tile/2 - 1, tile - 5, 2, 4);
  ctx.fillStyle = '#ffcc55'; ctx.beginPath(); ctx.arc(lampX + tile/2, 4, 3, 0, Math.PI * 2); ctx.fill();

  // NPC (22) - small person icon
  const npcX = tile * 22; // note: cols larger by 1; but we set cols=22 earlier, index 0..21. We'll reuse lamp texture for npc by derivation

  const atlasTex = PIXI.Texture.from(canvas);
  
  // Force immediate upload of atlas texture
  if (atlasTex.source && app.renderer) {
    app.renderer.texture.initSource(atlasTex.source);
  }
  
  const floor = new PIXI.Texture({ source: atlasTex.source, frame: new PIXI.Rectangle(0, 0, tile, tile) });
  const wall = new PIXI.Texture({ source: atlasTex.source, frame: new PIXI.Rectangle(wallX, 0, tile, tile) });
  const player0 = new PIXI.Texture({ source: atlasTex.source, frame: new PIXI.Rectangle(p0X, 0, tile, tile) });
  const player1 = new PIXI.Texture({ source: atlasTex.source, frame: new PIXI.Rectangle(p1X, 0, tile, tile) });
  const enemy0 = new PIXI.Texture({ source: atlasTex.source, frame: new PIXI.Rectangle(e0X, 0, tile, tile) });
  const enemy1 = new PIXI.Texture({ source: atlasTex.source, frame: new PIXI.Rectangle(e1X, 0, tile, tile) });
  const potion = new PIXI.Texture({ source: atlasTex.source, frame: new PIXI.Rectangle(potX, 0, tile, tile) });
  const grass = new PIXI.Texture({ source: atlasTex.source, frame: new PIXI.Rectangle(grassX, 0, tile, tile) });
  const tree = new PIXI.Texture({ source: atlasTex.source, frame: new PIXI.Rectangle(treeX, 0, tile, tile) });
  const doorClosed = new PIXI.Texture({ source: atlasTex.source, frame: new PIXI.Rectangle(doorCX, 0, tile, tile) });
  const doorOpen = new PIXI.Texture({ source: atlasTex.source, frame: new PIXI.Rectangle(doorOX, 0, tile, tile) });
  const path = new PIXI.Texture({ source: atlasTex.source, frame: new PIXI.Rectangle(pathX, 0, tile, tile) });
  const house = new PIXI.Texture({ source: atlasTex.source, frame: new PIXI.Rectangle(houseX, 0, tile, tile) });
  const wood = new PIXI.Texture({ source: atlasTex.source, frame: new PIXI.Rectangle(woodX, 0, tile, tile) });
  const stone = new PIXI.Texture({ source: atlasTex.source, frame: new PIXI.Rectangle(stoneX, 0, tile, tile) });
  const rune = new PIXI.Texture({ source: atlasTex.source, frame: new PIXI.Rectangle(runeX, 0, tile, tile) });
  const bed = new PIXI.Texture({ source: atlasTex.source, frame: new PIXI.Rectangle(bedX, 0, tile, tile) });
  const table = new PIXI.Texture({ source: atlasTex.source, frame: new PIXI.Rectangle(tableX, 0, tile, tile) });
  const bar = new PIXI.Texture({ source: atlasTex.source, frame: new PIXI.Rectangle(barX, 0, tile, tile) });
  const anvil = new PIXI.Texture({ source: atlasTex.source, frame: new PIXI.Rectangle(anvilX, 0, tile, tile) });
  const shelf = new PIXI.Texture({ source: atlasTex.source, frame: new PIXI.Rectangle(shelfX, 0, tile, tile) });
  const lamp = new PIXI.Texture({ source: atlasTex.source, frame: new PIXI.Rectangle(lampX, 0, tile, tile) });
  const npc = player0; // reuse player texture for NPCs

  // Shroud as a canvas-based texture as well
  const shCanvas = document.createElement('canvas');
  shCanvas.width = tile;
  shCanvas.height = tile;
  const shCtx = shCanvas.getContext('2d')!;
  shCtx.fillStyle = '#000000';
  shCtx.fillRect(0, 0, tile, tile);
  const shroud = PIXI.Texture.from(shCanvas);
  
  // Force immediate upload of shroud texture
  if (shroud.source && app.renderer) {
    app.renderer.texture.initSource(shroud.source);
  }

  return { floor, wall, shroud, playerFrames: [player0, player1], enemyFrames: [enemy0, enemy1], potion, grass, tree, doorClosed, doorOpen, path, house, wood, stone, rune, bed, table, bar, anvil, shelf, lamp, npc };
}
