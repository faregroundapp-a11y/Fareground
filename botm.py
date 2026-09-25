"""
Coal Miner / Miner Maze Bot — MEDIUM MODE (15 cols x 19 rows)
=============================================================
Strict "Zero-Backtrack" Implementation:
- Direct implementation of the video guide:
  1. Click in one direction until stopped.
  2. NEVER re-enter visited or tan areas (Zero Backtracking).
  3. Direction priority: Down -> Right -> Left -> Up.
  4. Obstacles (fire/gas/water) are passable.
  5. Fast 0.12s speed cadence with turn double-tap.
"""

import cv2
import numpy as np
import subprocess
import time
import msvcrt

# ── CALIBRATED COORDINATES (1080x1920) ──────────────────────────────
PLAY_AREA_BOX = (15, 1248, 111, 1368)   # Minimap: x0, y0, x1, y1 (96x120)
GRID_ROWS = 19
GRID_COLS = 15

TAP_COORDS = {
    "up":    (416, 1592),
    "left":  (334, 1676),
    "right": (500, 1676),
    "down":  (416, 1760),
}

# Post-Round Navigation Buttons
PLAY_AGAIN_BUTTON = (540, 1279)   # "Play Again" button (shot_161608.png)
PLAY_LEVEL_BUTTON = (540, 852)    # "📺 Play Level N" button (shot_162328.png)
ENTER_MINE_BUTTON = (539, 1594)   # "Enter the Mine" button (shot_210608.png)

STEP_DELAY = 0.12                 # Fast cadence matching the video

# ── SCREEN CAPTURE & INPUT VIA ADB ──────────────────────────────────
def capture_frame():
    result = subprocess.run(
        ["adb", "exec-out", "screencap", "-p"],
        capture_output=True
    )
    if result.returncode != 0 or not result.stdout:
        raise RuntimeError("ADB screencap failed. Make sure BlueStacks ADB is connected.")
    return cv2.imdecode(np.frombuffer(result.stdout, np.uint8), cv2.IMREAD_COLOR)

def tap(x, y):
    subprocess.run(["adb", "shell", "input", "tap", str(x), str(y)])

def send_tap(direction, is_turn=False):
    """First tap turns the miner, second tap steps forward."""
    x, y = TAP_COORDS[direction]
    if is_turn:
        tap(x, y)
        time.sleep(0.06)
        tap(x, y)
    else:
        tap(x, y)

# ── DIRECT PIXEL CENTROID LOCATOR ───────────────────────────────────
def find_player(minimap_img):
    """Finds the player's yellow marker on the minimap."""
    hsv = cv2.cvtColor(minimap_img, cv2.COLOR_BGR2HSV)
    mask = cv2.inRange(hsv, (18, 140, 180), (38, 255, 255))
    
    bgr_mask = (
        (minimap_img[:, :, 0] < 70) &
        (minimap_img[:, :, 1] > 150) &
        (minimap_img[:, :, 2] > 200)
    )
    combined = mask | (bgr_mask.astype(np.uint8) * 255)
    ys, xs = np.where(combined > 0)
    if len(xs) == 0:
        return None

    cell_h = minimap_img.shape[0] / float(GRID_ROWS)
    cell_w = minimap_img.shape[1] / float(GRID_COLS)

    r = int(float(np.mean(ys)) / cell_h)
    c = int(float(np.mean(xs)) / cell_w)
    return (max(0, min(GRID_ROWS - 1, r)), max(0, min(GRID_COLS - 1, c)))

def is_tan_or_visited(minimap_img, r, c, visited_set):
    """Returns True if this tile has ALREADY been walked on."""
    if (r, c) in visited_set:
        return True
    cell_h = minimap_img.shape[0] / float(GRID_ROWS)
    cell_w = minimap_img.shape[1] / float(GRID_COLS)
    cy, cx = int((r + 0.5) * cell_h), int((c + 0.5) * cell_w)
    patch = minimap_img[max(0, cy-1):cy+2, max(0, cx-1):cx+2]
    if patch.size == 0:
        return False
    b, g, r_col = patch.mean(axis=(0, 1))
    # Tan explored floor color:
    if 115 < r_col < 170 and 90 < g < 140 and 60 < b < 115:
        return True
    return False

# ── SCREEN STATE & MENU HANDLING ────────────────────────────────────
def is_minimap_active(img):
    x0, y0, x1, y1 = PLAY_AREA_BOX
    play = img[y0:y1, x0:x1]
    if play is None or play.size == 0:
        return False
    yellow = ((play[:, :, 2] > 190) & (play[:, :, 1] > 140) & (play[:, :, 0] < 80)).sum()
    tan = ((play[:, :, 2] > 115) & (play[:, :, 2] < 170) & (play[:, :, 1] > 90) & (play[:, :, 1] < 140)).sum()
    return (yellow > 5 or tan > 25)

def is_start_screen(img):
    region = img[1550:1640, 30:1050]
    mask = ((np.abs(region[:, :, 0].astype(int) - 19) < 25) &
            (np.abs(region[:, :, 1].astype(int) - 69) < 25) &
            (np.abs(region[:, :, 2].astype(int) - 139) < 25))
    return mask.sum() > 400

def is_level_up_screen(img):
    region = img[820:890, 440:645]
    mask = ((np.abs(region[:, :, 0].astype(int) - 0) < 30) &
            (np.abs(region[:, :, 1].astype(int) - 152) < 30) &
            (np.abs(region[:, :, 2].astype(int) - 255) < 30))
    return mask.sum() > 400

def is_game_over_screen(img):
    region = img[1230:1330, 430:650]
    mask = ((np.abs(region[:, :, 0].astype(int) - 19) < 25) &
            (np.abs(region[:, :, 1].astype(int) - 69) < 25) &
            (np.abs(region[:, :, 2].astype(int) - 139) < 25))
    return mask.sum() > 400

def find_ad_close_button(img):
    if is_minimap_active(img):
        return None
    top_strip = img[0:200, :]
    hsv = cv2.cvtColor(top_strip, cv2.COLOR_BGR2HSV)
    mask = cv2.inRange(hsv, (0, 0, 180), (180, 50, 255))
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    for cnt in contours:
        area = cv2.contourArea(cnt)
        if area < 150 or area > 6000:
            continue
        x, y, cw, ch = cv2.boundingRect(cnt)
        cx, cy = x + cw // 2, y + ch // 2
        # Exclude in-game back arrow at (117, 18)
        if cx < 200 and cy < 85:
            continue
        aspect = cw / float(ch)
        if 0.65 < aspect < 1.45:
            return (cx, cy)
    return None

def handle_post_round():
    for _ in range(12):
        img = capture_frame()
        if is_start_screen(img):
            print("Auto-Bot: Found Start Screen -> Tapping Enter the Mine")
            tap(*ENTER_MINE_BUTTON)
            time.sleep(2)
            return "started"
        if is_level_up_screen(img):
            print("Auto-Bot: Found Level Up Screen -> Tapping Play Level")
            tap(*PLAY_LEVEL_BUTTON)
            time.sleep(2)
            return "leveled_up"
        if is_game_over_screen(img):
            print("Auto-Bot: Found Escaped Screen -> Tapping Play Again")
            tap(*PLAY_AGAIN_BUTTON)
            time.sleep(2)
            return "restarted"
        ad_btn = find_ad_close_button(img)
        if ad_btn:
            print(f"Auto-Bot: Found Ad 'X' at {ad_btn} -> Tapping")
            tap(*ad_btn)
            time.sleep(2)
            continue
        time.sleep(1.2)
    return "unknown"

# ── AUTONOMOUS RUNNER ────────────────────────────────────────────────
def solve_level():
    current_dir = "down"   # Start by pushing south toward bottom-right exit
    visited = set()
    blocked = set()        # Confirmed wall hits: (pos, dir)
    stuck_counter = 0
    prev_pos = None

    print("\n--- Level Started: Strict Zero-Backtrack Runner Active ---")

    while True:
        if msvcrt.kbhit() and msvcrt.getch().lower() == b'q':
            return "stopped"

        img = capture_frame()
        x0, y0, x1, y1 = PLAY_AREA_BOX
        minimap_crop = img[y0:y1, x0:x1]
        player_pos = find_player(minimap_crop)

        # Minimap closed -> exit reached or round ended
        if player_pos is None:
            time.sleep(0.2)
            if not is_minimap_active(img):
                print("🏆 Minimap closed! Exit reached successfully.")
                return "done"
            continue

        visited.add(player_pos)

        # Track if miner advanced
        if player_pos == prev_pos:
            stuck_counter += 1
        else:
            stuck_counter = 0
        prev_pos = player_pos

        if stuck_counter >= 8:
            print("Stationary for 8 ticks -> Checking end screens.")
            return "stuck"

        # Adjacent neighbors
        r, c = player_pos
        offsets = {
            "down":  (r + 1, c),
            "right": (r,     c + 1),
            "left":  (r,     c - 1),
            "up":    (r - 1, c),
        }

        # ── 1. CORRIDOR MOMENTUM ("Keep clicking in one direction") ──
        # Can we continue in current_dir without hitting a wall or visited tile?
        tr, tc = offsets[current_dir]
        can_continue = (
            0 <= tr < GRID_ROWS and 0 <= tc < GRID_COLS and
            (player_pos, current_dir) not in blocked and
            not is_tan_or_visited(minimap_crop, tr, tc, visited) and
            stuck_counter == 0
        )

        if can_continue:
            # Just keep clicking!
            send_tap(current_dir, is_turn=False)
            time.sleep(STEP_DELAY)
            continue

        # ── 2. STOPPED BY WALL -> CHANGE DIRECTION ──────────────────
        if stuck_counter > 0:
            blocked.add((player_pos, current_dir))

        # Priority: DOWN -> RIGHT -> LEFT -> UP (Strictly unvisited/black)
        priority = ["down", "right", "left", "up"]
        chosen = None

        for d in priority:
            if d == current_dir:
                continue
            nr, nc = offsets[d]
            if not (0 <= nr < GRID_ROWS and 0 <= nc < GRID_COLS):
                continue
            if (player_pos, d) in blocked:
                continue
            
            # STRICT ZERO-BACKTRACK: Only step into brand new black squares!
            if is_tan_or_visited(minimap_crop, nr, nc, visited):
                continue

            chosen = d
            break

        if chosen:
            current_dir = chosen
            # Double-tap to turn character and take the first step into the new hall
            send_tap(current_dir, is_turn=True)
            print(f"-> Moving into new direction: {current_dir.upper()} at {player_pos}")
        else:
            # If no unvisited neighbor exists, try any unblocked direction
            for d in priority:
                if (player_pos, d) not in blocked:
                    nr, nc = offsets[d]
                    if 0 <= nr < GRID_ROWS and 0 <= nc < GRID_COLS:
                        current_dir = d
                        send_tap(current_dir, is_turn=True)
                        break

        time.sleep(STEP_DELAY)

# ── MAIN AUTOPILOT LOOP ─────────────────────────────────────────────
def main():
    print("==================================================")
    print("  MINER MAZE BOT — ZERO-BACKTRACK CORRIDOR RUNNER")
    print("  Cadence: 0.12s • Priority: Down -> Right -> Left -> Up")
    print("  Controls: Press 'q' in this window to stop.")
    print("==================================================")

    handle_post_round()

    while True:
        res = solve_level()
        if res == "stopped":
            print("Bot stopped by user.")
            break
        print("Round finished. Handling transitions...")
        time.sleep(0.8)
        handle_post_round()
        time.sleep(0.8)

if __name__ == "__main__":
    main()