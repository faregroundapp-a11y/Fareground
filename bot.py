import cv2
import numpy as np
import subprocess
import time
import msvcrt  # Windows-only: lets us check for a keypress without pausing the loop
from collections import deque
from heapq import heappush, heappop

# ── CALIBRATED VALUES (from your screenshots) ───────────────────────────
PLAY_AREA_BOX = (15, 1248, 111, 1368)   # minimap: x0, y0, x1, y1
GRID_ROWS = 10
GRID_COLS = 8

TAP_COORDS = {
    "up":    (416, 1592),
    "left":  (334, 1676),
    "right": (500, 1676),
    "down":  (416, 1760),
}

# Post-round screens
PLAY_AGAIN_BUTTON = (540, 1279)   # "Play Again" — normal game-over screen
PLAY_LEVEL_BUTTON = (540, 852)    # "Play Level N" — level-up screen
ENTER_MINE_BUTTON = (539, 1594)   # "Enter the Mine" — very first start screen

# ── SCREEN CAPTURE ───────────────────────────────────────────────────────
def capture_frame():
    data = subprocess.run(
        ["adb", "exec-out", "screencap", "-p"],
        capture_output=True
    ).stdout
    arr = np.frombuffer(data, np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        raise RuntimeError("Screenshot failed — check `adb devices`, only one should be listed.")
    return img

# ── GRID READING ─────────────────────────────────────────────────────────
def classify_color(bgr):
    b, g, r = int(bgr[0]), int(bgr[1]), int(bgr[2])
    if r > 200 and g > 150 and b < 60:
        return "player"      # (255, 215, 0) bright yellow
    if 120 < r < 160 and 95 < g < 135 and 65 < b < 105:
        return "open"        # (139, 115, 85) explored tan
    return "fog"              # unexplored / unknown

def classify_grid(img):
    x0, y0, x1, y1 = PLAY_AREA_BOX
    play = img[y0:y1, x0:x1]
    h, w = play.shape[:2]
    cell_h, cell_w = h / GRID_ROWS, w / GRID_COLS

    grid = [["fog" for _ in range(GRID_COLS)] for _ in range(GRID_ROWS)]
    for r in range(GRID_ROWS):
        for c in range(GRID_COLS):
            cy = int((r + 0.5) * cell_h)
            cx = int((c + 0.5) * cell_w)
            patch = play[max(0, cy-3):cy+3, max(0, cx-3):cx+3]
            if patch.size == 0:
                continue
            avg_color = patch.mean(axis=(0, 1))
            grid[r][c] = classify_color(avg_color)
    return grid

def find_player(grid):
    for r, row in enumerate(grid):
        for c, val in enumerate(row):
            if val == "player":
                return (r, c)
    return None

# ── AD CLOSE-BUTTON DETECTION ────────────────────────────────────────────
def _has_x_pattern(gray_img, cx, cy, radius):
    """Checks both diagonals through (cx, cy) for dark pixels. A real X
    mark has dark pixels along BOTH diagonals crossing the center — this
    is what actually distinguishes an X from a lookalike white circle
    (a dropdown chevron, a stray bright spot inside an Install button,
    etc.), which shape/color alone couldn't tell apart."""
    h, w = gray_img.shape
    diag1_dark = 0
    diag2_dark = 0
    samples = 8
    for i in range(-samples, samples + 1):
        t = i / samples
        x1, y1 = int(cx + t * radius * 0.6), int(cy + t * radius * 0.6)
        x2, y2 = int(cx + t * radius * 0.6), int(cy - t * radius * 0.6)
        if 0 <= y1 < h and 0 <= x1 < w and gray_img[y1, x1] < 120:
            diag1_dark += 1
        if 0 <= y2 < h and 0 <= x2 < w and gray_img[y2, x2] < 120:
            diag2_dark += 1
    return diag1_dark >= samples and diag2_dark >= samples

def _find_cta_button_bbox(top_strip):
    """Finds the bounding box of any blue/green call-to-action button
    (Install, Play, Download, etc.) so we can exclude anything near it
    from being mistaken for a close button. Confirmed necessary: an
    Install button's rounded corner/edge can coincidentally produce a
    small light, roughly-circular shape that even passes the X-pattern
    check by chance — this happened in a real ad screenshot."""
    hsv = cv2.cvtColor(top_strip, cv2.COLOR_BGR2HSV)
    blue_mask = cv2.inRange(hsv, (100, 100, 100), (130, 255, 255))
    green_mask = cv2.inRange(hsv, (40, 100, 100), (80, 255, 255))
    cta_mask = blue_mask | green_mask
    ys, xs = np.where(cta_mask)
    if len(xs) < 200:  # not enough matching pixels to be a real button
        return None
    return (xs.min(), ys.min(), xs.max(), ys.max())

def find_ad_close_button(img):
    """Looks for the actual X close button in the top strip of the
    screen. Requires ALL of:
    1. A small, genuinely circular light-colored blob.
    2. An actual X-cross pattern inside it (dark pixels on both
       diagonals) — avoids matching dropdown chevrons, etc.
    3. NOT near any detected CTA button (Install/Play/Download) — avoids
       a button's own rounded edge being mistaken for a close button.
    Returns (x, y) of the real close button, or None if nothing
    genuinely matches — many ads simply don't show a close button until
    a mandatory view delay passes, so None is a normal, expected result,
    not a failure."""
    top_strip = img[0:220, :]
    gray = cv2.cvtColor(top_strip, cv2.COLOR_BGR2GRAY)
    hsv = cv2.cvtColor(top_strip, cv2.COLOR_BGR2HSV)
    mask = cv2.inRange(hsv, (0, 0, 180), (180, 60, 255))

    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    cta_bbox = _find_cta_button_bbox(top_strip)
    margin = 40

    candidates = []
    for cnt in contours:
        area = cv2.contourArea(cnt)
        if area < 1200 or area > 4000:
            continue
        x, y, cw, ch = cv2.boundingRect(cnt)
        aspect = cw / float(ch) if ch else 0
        if not (0.8 < aspect < 1.25):
            continue
        cx, cy = x + cw // 2, y + ch // 2

        if cta_bbox:
            bx0, by0, bx1, by1 = cta_bbox
            if (bx0 - margin <= cx <= bx1 + margin) and (by0 - margin <= cy <= by1 + margin):
                continue  # too close to a CTA button — not a real close button

        radius = max(cw, ch) // 2
        if _has_x_pattern(gray, cx, cy, radius):
            candidates.append((cx, cy))

    if not candidates:
        return None

    candidates.sort(key=lambda p: p[0])
    return candidates[0]

# ── MEMORY (merges each new reading into what we've learned so far) ─────
class MazeMemory:
    def __init__(self, rows, cols):
        self.grid = [["fog" for _ in range(cols)] for _ in range(rows)]

    def update(self, new_grid):
        for r in range(len(new_grid)):
            for c in range(len(new_grid[0])):
                if new_grid[r][c] != "fog":
                    self.grid[r][c] = new_grid[r][c]

# ── PATHFINDING ───────────────────────────────────────────────────────────
def astar(grid, start, goal, blocked=None, current_pos=None):
    rows, cols = len(grid), len(grid[0])
    blocked = blocked or set()

    def neighbors(pos):
        r, c = pos
        for dr, dc in [(-1, 0), (1, 0), (0, -1), (0, 1)]:
            nr, nc = r + dr, c + dc
            if 0 <= nr < rows and 0 <= nc < cols and grid[nr][nc] != "wall":
                direction = direction_from(pos, (nr, nc))
                if (pos, direction) in blocked:
                    continue
                yield (nr, nc)

    def h(a, b):
        return abs(a[0] - b[0]) + abs(a[1] - b[1])

    frontier = [(0, start)]
    came_from = {start: None}
    cost = {start: 0}

    while frontier:
        _, current = heappop(frontier)
        if current == goal:
            break
        for nxt in neighbors(current):
            new_cost = cost[current] + 1
            if nxt not in cost or new_cost < cost[nxt]:
                cost[nxt] = new_cost
                heappush(frontier, (new_cost + h(nxt, goal), nxt))
                came_from[nxt] = current

    if goal not in came_from:
        return []

    path = []
    node = goal
    while node != start:
        path.append(node)
        node = came_from[node]
    path.reverse()
    return path

def find_nearest_frontier(grid, start, blocked=None):
    """Find the nearest actual fog tile to step into next,
    biased toward the bottom-right corner (where the exit tends to be)."""
    rows, cols = len(grid), len(grid[0])
    blocked = blocked or set()
    q = deque([start])
    visited = {start}
    fog_candidates = []

    while q:
        r, c = q.popleft()
        for dr, dc in [(-1, 0), (1, 0), (0, -1), (0, 1)]:
            nr, nc = r + dr, c + dc
            if 0 <= nr < rows and 0 <= nc < cols and (nr, nc) not in visited:
                direction = direction_from((r, c), (nr, nc))
                if ((r, c), direction) in blocked:
                    continue
                visited.add((nr, nc))
                if grid[nr][nc] == "fog":
                    fog_candidates.append((nr, nc))
                else:
                    q.append((nr, nc))

    if not fog_candidates:
        return None

    # Prefer fog tiles closest to the bottom-right corner
    fog_candidates.sort(key=lambda p: -(p[0] + p[1]))
    return fog_candidates[0]

def direction_from(a, b):
    dr, dc = b[0] - a[0], b[1] - a[1]
    if dr == -1: return "up"
    if dr == 1: return "down"
    if dc == -1: return "left"
    if dc == 1: return "right"
    return None

# ── MOVEMENT ───────────────────────────────────────────────────────────────
# Simple single-tap movement — each tap directly moves the character one
# tile in that direction. (We briefly tried a "turn then move" two-tap
# system based on the in-game tutorial text, but that turned out to make
# things worse — the buttons apparently just move directly.)
def move(direction):
    x, y = TAP_COORDS[direction]
    subprocess.run(["adb", "shell", "input", "tap", str(x), str(y)])
    print(f"Moved: {direction}")

def tap_at(x, y):
    subprocess.run(["adb", "shell", "input", "tap", str(x), str(y)])
    print(f"Tapped: ({x}, {y})")

# ── SCREEN STATE DETECTION ───────────────────────────────────────────────
def _has_cta_button_anywhere(img):
    """Checks the ENTIRE screen (not just the top strip) for any blue or
    green call-to-action button (Install, Play Now, Download, etc.).
    Our own game's real Play Again / Level Up / Enter Mine screens never
    show anything like this — so if one is found anywhere, whatever
    triggered a color-match below is almost certainly a random ad that
    happened to have similar coloring in that specific screen region,
    not our own game's UI. Confirmed necessary: a completely unrelated
    playable ad (fake match-3 gameplay, 'FAIL' screens, 'Play Now'
    prompts) was fooling the narrow per-region color checks below."""
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    blue_mask = cv2.inRange(hsv, (100, 100, 100), (130, 255, 255))
    green_mask = cv2.inRange(hsv, (40, 100, 100), (80, 255, 255))
    cta_mask = blue_mask | green_mask
    return cta_mask.sum() > 255 * 3000  # a real button is a solid, sizeable blob

def is_level_up_screen(img):
    """True if the orange 'Play Level N' button fill color is present in
    the region where we calibrated it, AND no CTA button (Install/Play
    Now/etc.) is visible anywhere on screen — a real ad could otherwise
    coincidentally match the narrow color check."""
    if _has_cta_button_anywhere(img):
        return False
    region = img[820:890, 440:645]
    mask = ((np.abs(region[:, :, 0].astype(int) - 0) < 25) &
            (np.abs(region[:, :, 1].astype(int) - 152) < 25) &
            (np.abs(region[:, :, 2].astype(int) - 255) < 25))
    return mask.sum() > 500

def is_game_over_screen(img):
    """True if the brown 'Play Again' button fill color is present in
    the region where we calibrated it, AND no CTA button is visible
    anywhere on screen."""
    if _has_cta_button_anywhere(img):
        return False
    region = img[1230:1330, 430:650]
    mask = ((np.abs(region[:, :, 0].astype(int) - 19) < 20) &
            (np.abs(region[:, :, 1].astype(int) - 69) < 20) &
            (np.abs(region[:, :, 2].astype(int) - 139) < 20))
    return mask.sum() > 500

def is_start_screen(img):
    """True if the 'Enter the Mine' button fill color is present in
    the region where we calibrated it, AND no CTA button is visible
    anywhere on screen."""
    if _has_cta_button_anywhere(img):
        return False
    region = img[1550:1650, 20:1060]
    mask = ((np.abs(region[:, :, 0].astype(int) - 19) < 20) &
            (np.abs(region[:, :, 1].astype(int) - 69) < 20) &
            (np.abs(region[:, :, 2].astype(int) - 139) < 20))
    return mask.sum() > 500

# ── HANDLE WHATEVER SCREEN SHOWS AFTER A ROUND ───────────────────────────
def handle_post_round_screen(max_attempts=20):
    """Called when the maze-solving loop gets 'stuck'. Figures out what
    screen is currently showing (ad / level-up / normal game-over) and
    taps through it so a new round can begin.

    IMPORTANT: the real close-X only appears once an ad has actually
    finished playing — there's nothing useful to detect or tap during
    the ad itself. So when nothing is recognized, this just WAITS
    (without tapping anything) rather than guessing. max_attempts is
    ~20 × ~2s ≈ 40s — enough for most ads to finish, without making
    every single post-round transition take a very long time if
    something isn't recognized for an unrelated reason.

    Ad detection now runs FIRST, before the level-up/game-over color
    checks. Those checks only look at whether a specific small region has
    roughly the right color — if an ad happens to have similar coloring
    in that same screen area, it could get misclassified as "level up"
    and blindly tapped, landing on the ad's actual clickable content
    (e.g. sending you to the Play Store). Checking for a real, verified
    X close button first avoids that — a genuine ad will have one.

    A detected ad-close candidate must show up on TWO consecutive checks
    before we actually tap it — a one-off false read (rare, but happened
    with an Install button's rounded edge in testing) shouldn't be
    enough to trigger a real tap."""
    pending_candidate = None

    for attempt in range(max_attempts):
        img = capture_frame()

        ad_button = find_ad_close_button(img)
        if ad_button:
            if ad_button == pending_candidate:
                print(f"Confirmed ad close button at {ad_button} — tapping.")
                tap_at(*ad_button)
                pending_candidate = None
                time.sleep(2)
            else:
                print(f"Possible ad close button at {ad_button} — confirming next check...")
                pending_candidate = ad_button
                time.sleep(1)
            continue  # loop back and check again — might take a few taps

        pending_candidate = None  # nothing detected this check, reset

        if is_start_screen(img):
            print("Detected START MENU screen — tapping Enter the Mine.")
            tap_at(*ENTER_MINE_BUTTON)
            time.sleep(2)
            return "started"

        if is_level_up_screen(img):
            print("Detected LEVEL UP screen — tapping Play Level.")
            tap_at(*PLAY_LEVEL_BUTTON)
            time.sleep(2)
            return "leveled_up"

        if is_game_over_screen(img):
            print("Detected normal game-over screen — tapping Play Again.")
            tap_at(*PLAY_AGAIN_BUTTON)
            time.sleep(2)
            return "restarted"

        # No known screen and no close button yet — most likely still
        # mid-ad. Just wait; don't tap anything, don't guess.
        print(f"Nothing to act on yet (attempt {attempt+1}/{max_attempts}), waiting...")
        time.sleep(2)

    print("Couldn't recognize the screen after several attempts — "
          "you may need to handle this one manually.")
    return "unknown"

# ── STOP CONTROL ─────────────────────────────────────────────────────────
def stop_requested():
    """Non-blocking check: returns True if 'q' was pressed since the last check."""
    if msvcrt.kbhit():
        key = msvcrt.getch()
        if key.lower() == b'q':
            return True
    return False

# ── STUCK DETECTION ──────────────────────────────────────────────────────
# If the player hasn't actually changed grid position in this many
# consecutive steps, something is wrong (new round started with stale
# memory, an ad/popup is blocking input, etc.) — safer to stop and reset
# than to keep hammering directions forever.
STUCK_THRESHOLD = 8

# ── SPEED SETTINGS ────────────────────────────────────────────────────────
# Delay after every single move before we trust the next screenshot.
# We verify EVERY move now (no blind batching) — this is the main knob
# for the speed/reliability tradeoff. Lower = faster but riskier if the
# game needs more time to render the new state.
MOVE_DELAY = 0.2

# ── ONE ROUND OF MAZE-SOLVING ────────────────────────────────────────────
def solve_one_round(max_steps=300):
    """Runs the explore-and-move loop until either:
       - it finishes exploring (no more fog reachable), or
       - it gets stuck (player position hasn't changed in STUCK_THRESHOLD
         steps — usually means a new round started with stale memory, or
         a popup/ad is blocking input), or
       - the user presses 'q'.
       Returns "stuck", "done", or "stopped".

       Moves ONE step at a time and re-screenshots after every single
       move to verify it actually worked. UNLIKE before, it commits to
       a full computed path and keeps following it step-by-step until
       that path runs out or a move fails — it does NOT throw the plan
       away and recompute a fresh target from scratch after every move.
       That was causing a lot of wasted zig-zagging as the frontier
       target flickered between near-identical options as tiny bits of
       fog got revealed each step."""
    memory = MazeMemory(GRID_ROWS, GRID_COLS)
    blocked = set()
    steps = 0
    unchanged_pos_counter = 0
    previous_reported_pos = None
    last_move = None       # (from_pos, direction) we just attempted
    no_player_streak = 0
    current_path = None    # the plan we're currently committed to
    path_index = 0          # how far along current_path we've gotten

    while steps < max_steps:
        if stop_requested():
            print("\nStop requested — halting bot.")
            return "stopped"

        steps += 1
        img = capture_frame()
        grid = classify_grid(img)
        memory.update(grid)

        player_pos = find_player(grid)
        if player_pos is None:
            no_player_streak += 1
            print(f"Couldn't find player this frame ({no_player_streak}/6)...")
            if no_player_streak >= 6:
                print("No player detected for a while — probably not on the maze screen.")
                return "stuck"
            time.sleep(0.5)
            continue
        no_player_streak = 0

        # Track whether the player's position is changing AT ALL across
        # steps — if it's frozen for too long, something's wrong (new
        # round with stale memory, a popup, an ad, etc.)
        if player_pos == previous_reported_pos:
            unchanged_pos_counter += 1
        else:
            unchanged_pos_counter = 0
        previous_reported_pos = player_pos

        if unchanged_pos_counter >= STUCK_THRESHOLD:
            print(f"\nPlayer position hasn't changed in {STUCK_THRESHOLD} steps — "
                  f"likely a new round or a blocking popup. Resetting.")
            return "stuck"

        # Did the move we just attempted actually work?
        move_failed = False
        if last_move is not None:
            from_pos, direction = last_move
            if player_pos == from_pos:
                print(f"Move {direction} from {from_pos} didn't work — marking blocked.")
                blocked.add((from_pos, direction))
                move_failed = True
            last_move = None

        print(f"--- Step {steps} | Player at {player_pos} ---")
        for row in memory.grid:
            print(" ".join(cell[0].upper() for cell in row))

        # Decide whether we need a fresh plan: either we don't have one,
        # we've finished it, or the last move along it just failed.
        need_new_plan = (
            current_path is None or
            path_index >= len(current_path) or
            move_failed
        )

        if need_new_plan:
            target = find_nearest_frontier(memory.grid, player_pos, blocked)
            if target is None:
                print("No more fog to explore — maze may be fully mapped or solved.")
                return "done"

            current_path = astar(memory.grid, player_pos, target, blocked, player_pos)
            path_index = 0
            if not current_path:
                print("No path found to target, stopping.")
                return "done"

        next_step = current_path[path_index]
        direction = direction_from(player_pos, next_step)
        if direction:
            move(direction)
            last_move = (player_pos, direction)
        path_index += 1

        time.sleep(MOVE_DELAY)

    return "done"

# ── MAIN LOOP (repeats across rounds) ────────────────────────────────────
def main():
    print("Press 'q' at any time to stop the bot.\n")

    # Handle whatever screen we're on right now before diving into solving —
    # covers a cold start from the very first "Enter the Mine" screen.
    handle_post_round_screen()

    while True:
        result = solve_one_round()

        if result == "stopped":
            break

        if result == "stuck":
            print("Attempting to recognize and handle the post-round screen...")
            outcome = handle_post_round_screen()
            print(f"Post-round handling result: {outcome}")
            time.sleep(1)
            continue

        if result == "done":
            print("Round finished (explored everything reachable).")
            print("Attempting to recognize and handle the post-round screen...")
            outcome = handle_post_round_screen()
            print(f"Post-round handling result: {outcome}")
            time.sleep(1)
            continue

if __name__ == "__main__":
    main()
