import { describe, it, expect } from 'vitest';
import { createEmptyMap, generateDungeon, computeVisible, canWalk, inBounds, type GameMap } from './core';

function countFloors(map: GameMap) {
  let c = 0;
  for (let y = 0; y < map.length; y++) for (let x = 0; x < map[0].length; x++) if (map[y][x].walkable) c++;
  return c;
}

describe('dungeon generation', () => {
  it('creates a map of correct size', () => {
    const { map } = generateDungeon(40, 25, 123);
    expect(map.length).toBe(25);
    expect(map[0].length).toBe(40);
  });

  it('has a reasonable number of floor tiles', () => {
    const { map } = generateDungeon(40, 25, 123);
    const floors = countFloors(map);
    expect(floors).toBeGreaterThan(40); // at least some rooms/corridors
  });

  it('start position is on a walkable tile and in bounds', () => {
    const { map, start } = generateDungeon(40, 25, 123);
    expect(inBounds(40, 25, start.x, start.y)).toBe(true);
    expect(map[start.y][start.x].walkable).toBe(true);
  });

  it('is deterministic with the same seed', () => {
    const A = generateDungeon(40, 25, 999).map.map((r) => r.map((t) => t.walkable));
    const B = generateDungeon(40, 25, 999).map.map((r) => r.map((t) => t.walkable));
    expect(A).toEqual(B);
  });
});

describe('FOV', () => {
  it('includes the origin tile', () => {
    const { map, start } = generateDungeon(40, 25, 321);
    const vis = computeVisible(map, start.x, start.y, 8);
    expect(vis.has(`${start.x},${start.y}`)).toBe(true);
  });

  it('does not include out-of-bounds tiles', () => {
    const { map, start } = generateDungeon(20, 10, 321);
    const vis = computeVisible(map, start.x, start.y, 20);
    for (const id of vis) {
      const [x, y] = id.split(',').map(Number);
      expect(inBounds(20, 10, x, y)).toBe(true);
    }
  });
});

describe('movement', () => {
  it('canWalk returns true on floor and false on wall', () => {
    const { map } = generateDungeon(20, 10, 555);
    // find a floor and a wall
    let fx = -1, fy = -1, wx = -1, wy = -1;
    for (let y = 0; y < 10; y++) {
      for (let x = 0; x < 20; x++) {
        if (map[y][x].walkable && fx === -1) { fx = x; fy = y; }
        if (!map[y][x].walkable && wx === -1) { wx = x; wy = y; }
      }
    }
    expect(canWalk(map, fx, fy)).toBe(true);
    expect(canWalk(map, wx, wy)).toBe(false);
  });
});

