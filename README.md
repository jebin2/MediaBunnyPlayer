### MediaBunnyPlayer

A powerful, browser-based media player built with the `mediabunny` library. This player goes beyond simple playback, offering a suite of in-browser editing tools.

**Powered by:** [mediabunny](https://mediabunny.dev/).

### Functionality

*   **Advanced Playback:** Play local files, files from a URL, or entire folders. Includes standard controls, audio/subtitle track selection, and variable playback speed.
*   **Frame-by-Frame Seeking:** Precisely move forward or backward one frame at a time when the video is paused.
*   **Clipping & Trimming:** Select a start and end time to cut and export a new video clip from the source.
*   **Static Cropping:** Define a rectangular area to crop the video to a fixed region.
*   **Dynamic Panning & Zooming (Ken Burns Effect):** Create dynamic crops by recording a camera path. Lock a crop size and move it around during playback to create a pan-and-scan effect. You can also zoom in and out while recording the path.
*   **Video Conversion:** If you load an unsupported file format, the player will attempt to convert it to a playable MP4 in your browser automatically.
*   **Screenshot Tool:** Capture a high-quality screenshot of the current frame.
*   **Playlist Management:** Add multiple files and folders to a playlist for continuous playback.

### Keyboard Shortcuts

**Playback Controls:**
*   **`Space`** or **`K`**: Toggle Play/Pause.
*   **`ArrowLeft`**: Seek backward 5 seconds.
*   **`ArrowRight`**: Seek forward 5 seconds.
*   **`ArrowUp`**: Increase volume.
*   **`ArrowDown`**: Decrease volume.
*   **`M`**: Mute/Unmute audio.
*   **`F`**: Toggle fullscreen mode.
*   **`N`**: (When paused) Go to the next frame.
*   **`P`**: (When paused) Go to the previous frame.

**Editing & Tools:**
*   **`S`**: Take a screenshot.
*   **`C`**: Process and create the defined clip/crop.
*   **`L`**: (In Dynamic Crop mode) Lock/unlock the crop area size to start recording the path.
*   **`R`**: (In Dynamic Crop mode) Stop recording the camera path.
*   **`Shift + Mouse Wheel`**: (In Dynamic Crop mode) Zoom the crop area in and out.
*   **`Escape`**: Reset all editing configurations (crop, trim, etc.).

**Interface:**
*   **`//`** (Type two forward slashes quickly): Show/hide the shortcut keys help panel.
