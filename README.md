Sprite Roguelike (Pixi.js + rot-js)

Quick start

- Install: `npm install`
- Dev server: `npm run dev`
- Build: `npm run build` (outputs to `dist/`)
- Preview build: `npm run preview`

Controls

- Move: Arrow keys or WASD
- Regenerate map: R

Notes

- Rendering uses Pixi v8 with generated textures (solid-colored sprites) for walls/floors/player. Replace with tiles later by loading a spritesheet and swapping textures.
- Map is generated with `rot-js` Digger; FOV uses precise shadowcasting with radius 8.
- World camera centers on the player by moving the root container.

