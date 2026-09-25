import subprocess
import numpy as np
import cv2
import time
import sys

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

if __name__ == "__main__":
    # Optional label, e.g.: python screenshot.py gameover
    label = sys.argv[1] if len(sys.argv) > 1 else "shot"
    timestamp = time.strftime("%H%M%S")
    filename = f"{label}_{timestamp}.png"

    img = capture_frame()
    cv2.imwrite(filename, img)
    print(f"Saved: {filename}  (size: {img.shape[1]}x{img.shape[0]})")
