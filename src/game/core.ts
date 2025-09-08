import { FOV, Map as ROTMap, RNG, Path } from 'rot-js';

export type Tile = {
  walkable: boolean;
  visible: boolean;
  explored: boolean;
};

export type GameMap = Tile[][];

export type DungeonGenResult = {
  map: GameMap;
  start: { x: number; y: number };
};

export function createEmptyMap(w: number, h: number): GameMap {
  const rows: GameMap = [] as unknown as GameMap;
  for (let y = 0; y < h; y++) {
    const row: Tile[] = [];
    for (let x = 0; x < w; x++) row.push({ walkable: false, visible: false, explored: false });
    rows.push(row);
  }
  return rows;
}

export function inBounds(w: number, h: number, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < w && y < h;
}

export function generateDungeon(w: number, h: number, seed?: number): DungeonGenResult {
  if (typeof seed === 'number') RNG.setSeed(seed);
  const map = createEmptyMap(w, h);
  const digger = new ROTMap.Digger(w, h, {
    roomWidth: [4, 10],
    roomHeight: [3, 8],
    corridorLength: [2, 8],
  });
  const floors: Array<[number, number]> = [];
  digger.create((x, y, value) => {
    const cell = map[y][x];
    cell.walkable = value === 0; // 0 = floor
    if (cell.walkable) floors.push([x, y]);
  });
  const idx = Math.floor(RNG.getUniform() * floors.length) || 0;
  const [sx, sy] = floors[idx] ?? [1, 1];
  return { map, start: { x: sx, y: sy } };
}

export function canWalk(map: GameMap, x: number, y: number): boolean {
  const h = map.length;
  const w = map[0]?.length ?? 0;
  return inBounds(w, h, x, y) && map[y][x].walkable;
}

// Returns a Set of "x,y" strings that are visible from (ox, oy)
export function computeVisible(map: GameMap, ox: number, oy: number, radius: number): Set<string> {
  const h = map.length;
  const w = map[0]?.length ?? 0;
  const visible = new Set<string>();
  const lightPasses = (x: number, y: number) => inBounds(w, h, x, y) && map[y][x].walkable;
  const fov = new FOV.PreciseShadowcasting(lightPasses, { topology: 4 });
  fov.compute(ox, oy, radius, (x, y) => {
    if (inBounds(w, h, x, y)) visible.add(`${x},${y}`);
  });
  return visible;
}

export function allFloorPositions(map: GameMap): Array<{ x: number; y: number }> {
  const h = map.length;
  const w = map[0]?.length ?? 0;
  const res: Array<{ x: number; y: number }> = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (map[y][x].walkable) res.push({ x, y });
  return res;
}

export function sampleFloors(
  map: GameMap,
  count: number,
  exclude: Set<string>,
  minManhattan = 0,
  from?: { x: number; y: number }
): Array<{ x: number; y: number }> {
  const floors = allFloorPositions(map).filter((p) => !exclude.has(`${p.x},${p.y}`));
  if (from && minManhattan > 0) {
    const fx = from.x, fy = from.y;
    for (let i = floors.length - 1; i >= 0; i--) {
      const d = Math.abs(floors[i].x - fx) + Math.abs(floors[i].y - fy);
      if (d < minManhattan) floors.splice(i, 1);
    }
  }
  const result: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < count && floors.length; i++) {
    const idx = Math.floor(RNG.getUniform() * floors.length);
    result.push(floors[idx]);
    floors.splice(idx, 1);
  }
  return result;
}

export function aStarNextStep(
  map: GameMap,
  from: { x: number; y: number },
  to: { x: number; y: number },
  blocks: Set<string>
): { x: number; y: number } | null {
  const h = map.length;
  const w = map[0]?.length ?? 0;
  const passable = (x: number, y: number) => inBounds(w, h, x, y) && map[y][x].walkable && !blocks.has(`${x},${y}`);
  const astar = new Path.AStar(to.x, to.y, passable, { topology: 4 });
  const path: Array<[number, number]> = [];
  astar.compute(from.x, from.y, (x, y) => path.push([x, y]));
  if (path.length < 2) return null; // already there or no path
  const [nx, ny] = path[1];
  return { x: nx, y: ny };
}

export function generateOverworld(w: number, h: number, seed?: number): DungeonGenResult {
  if (typeof seed === 'number') RNG.setSeed(seed);
  const map = createEmptyMap(w, h);
  const cellular = new ROTMap.Cellular(w, h);
  cellular.randomize(0.45);
  // Run a few smoothing iterations
  for (let i = 0; i < 4; i++) cellular.create();
  cellular.create((x, y, value) => {
    map[y][x].walkable = value === 0; // 0 = open (grass), 1 = tree
  });
  // Ensure we have a reasonable amount of open space; invert if needed
  const openCount = allFloorPositions(map).length;
  if (openCount < (w * h) * 0.15) {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) map[y][x].walkable = !map[y][x].walkable;
  }
  // Choose a random open start near center if possible
  const floors = allFloorPositions(map);
  let start = { x: 1, y: 1 };
  if (floors.length) {
    floors.sort((a, b) => {
      const ca = Math.abs(a.x - Math.floor(w / 2)) + Math.abs(a.y - Math.floor(h / 2));
      const cb = Math.abs(b.x - Math.floor(w / 2)) + Math.abs(b.y - Math.floor(h / 2));
      return ca - cb;
    });
    start = floors[Math.floor(RNG.getUniform() * Math.min(200, floors.length))] ?? floors[0];
  }
  return { map, start };
}

export function reachableFrom(map: GameMap, sx: number, sy: number): Set<string> {
  const h = map.length;
  const w = map[0]?.length ?? 0;
  const key = (x: number, y: number) => `${x},${y}`;
  const seen = new Set<string>();
  const q: Array<[number, number]> = [];
  const inb = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h;
  if (!inb(sx, sy) || !map[sy][sx].walkable) return seen;
  seen.add(key(sx, sy));
  q.push([sx, sy]);
  const dirs: Array<[number, number]> = [[1,0],[-1,0],[0,1],[0,-1]];
  while (q.length) {
    const [x, y] = q.shift()!;
    for (const d of dirs) {
      const nx = x + d[0], ny = y + d[1];
      const k = key(nx, ny);
      if (!seen.has(k) && inb(nx, ny) && map[ny][nx].walkable) {
        seen.add(k);
        q.push([nx, ny]);
      }
    }
  }
  return seen;
}
