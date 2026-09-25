# Maze Bot Project — Context for Claude Code

This project automates a fog-of-war maze minigame ("Coal Miner" / "Miner Maze")
running on BlueStacks via ADB screenshot + tap automation. Two working bot
scripts exist for two difficulty modes.

## Files in this project
- `bot.py` — Easy Mine (grid: 8 cols × 10 rows)
- `botm.py` — Medium Mine (grid: 15 cols × 19 rows)
- `screenshot.py` — standalone helper to grab a labeled screenshot on demand

## How the game works
- First-person cave view with a headlamp light cone; black = unexplored fog.
- A minimap in the bottom-left corner shows explored state as a simplified
  top-down grid: black = unexplored, tan = explored/walkable, yellow = player,
  red = hazard (damages HP, confirmed via in-game tutorial screen + testing).
- Exit is always bottom-right; start is always top-left.
- Walls are NOT shown on the minimap — only explored floor. So "wall" vs
  "still fog" is indistinguishable until you've actually walked there.
- Movement: MOVE pad (up/left/right/down) are simple single-tap-per-tile
  buttons — NOT a turn-then-move system (an in-game tutorial screen claimed
  otherwise; that was tested and found to be wrong/misleading — reverted).
- Post-round screens: "Play Again" (normal), "Play Level N" (level-up,
  appears periodically, not on a fixed schedule), ad interstitials with a
  close-X in variable position, and a "Enter the Mine" start screen.

## Calibration data (both currently at screen resolution 1080×1920)
Shared between both difficulty modes — confirmed identical via screenshot
comparison:
- `PLAY_AREA_BOX = (15, 1248, 111, 1368)` — minimap bounding box
- Move buttons: up (416,1592), left (334,1676), right (500,1676), down (416,1760)
- `PLAY_AGAIN_BUTTON = (540, 1279)`, `PLAY_LEVEL_BUTTON = (540, 852)`,
  `ENTER_MINE_BUTTON = (539, 1594)`
- Colors (RGB): fog `(10,4,0)`, open `(139,115,85)`, player `(255,215,0)`,
  hazard `(244,67,54)`

Easy mode: `GRID_ROWS=10, GRID_COLS=8`, ~12px tiles, patch-sample radius 3.
Medium mode: `GRID_ROWS=19, GRID_COLS=15`, ~6px tiles, patch-sample radius 1,
AND uses a separate `find_player_direct()` that searches the whole minimap
for player pixels directly rather than sampling assumed cell centers —
Medium's tiles are small enough that 1px rounding error in the naive
per-cell sampling approach was enough to miss the player marker entirely.

## Movement/pathfinding strategy (current, in botm.py — the more evolved one)
Confirmed via a real player's strategy transcript: this game's mazes are
built so backtracking over already-explored ground is almost never required.
Current approach in `botm.py`:
1. **Greedy priority rule** (primary): at each step, check immediate
   neighbors in order down → right → up → left; move toward whichever is
   still unexplored fog. Never re-enters an "open" (already-visited) tile.
2. **A*/frontier-BFS fallback** (rare): only triggered when no immediate
   neighbor is fog (a genuine junction/dead-end) — searches for the nearest
   reachable fog tile (bottom-right-biased) and paths to it.
3. Hazards and known-blocked (edge, direction) pairs are excluded from both.
4. Every single move is verified via a fresh screenshot before committing to
   the next one (no blind multi-move batching — that was tried and caused
   hard-to-diagnose "stuck" bugs when a batch partially failed).

`bot.py` (Easy) is one iteration behind — still uses the older
"commit-to-a-full-A*-path" approach rather than the greedy rule. Worth
backporting the greedy-priority approach from `botm.py` into `bot.py` if
Easy mode's step-count/speed becomes a concern.

## Known open items / things not yet done
- Exit-tile color/marker has never actually been identified/calibrated —
  the bot currently just runs until it fully maps the reachable area (no
  explicit "win" detection).
- Ladders were mentioned in an in-game tutorial screen (multi-floor mine,
  up/down buttons double as ladder controls) — never actually confirmed or
  handled. Current approach treats everything as one flat 2D grid via the
  minimap and has worked so far, but this is an unverified assumption.
- No config yet for difficulty levels beyond Easy/Medium (e.g. a "Hard"
  tier, if the game has one).
- Ad close-button detection is shape/color-based (searches for a small
  white circle in the top strip of the screen, prefers the leftmost match)
  since its position varies by ad network — this is inherently the least
  reliable piece and has a safeguard against infinite-tapping a
  non-functional coordinate, but may still occasionally fail on unusual ad
  layouts.

## Setup (already done by the user)
Python venv + ADB platform-tools installed and working on Windows. Standard
per-session commands: `cd maze-bot`, `venv\Scripts\activate`, then
`python bot.py` or `python botm.py`.
