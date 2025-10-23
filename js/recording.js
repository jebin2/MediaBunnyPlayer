// FILE: js/recording.js

import {
    CanvasSource,
    MediaStreamAudioTrackSource,
    Mp4OutputFormat,
    Output,
    QUALITY_HIGH,
    StreamTarget,
} from 'https://cdn.jsdelivr.net/npm/mediabunny@1.24.0/+esm';

import {
    recordingControls,
    startRecFloatingBtn,
    pauseRecBtn,
    stopRecBtn,
    recTimer,
    recordScreenBtn,
    settingsMenu
} from './constants.js';
import { state } from './state.js';
import { showInfo, showError } from './ui.js';
import { updatePlaylistUIOptimized, openPlaylist } from './playlist.js';

// --- CONSTANTS ---
const FRAME_RATE = 30;
const HANDLE_SIZE = 12;

// --- MODULE STATE ---
const rec = {
    isRecording: false,
    isPaused: false,
    selection: null,
    mediaStream: null,
    output: null,
    videoSource: null,
    captureInterval: null,
    startTime: 0,
    elapsedPausedTime: 0,
    pauseStartTime: 0,
    timerInterval: null,
    chunks: [],
    videoElement: document.createElement('video'),
    canvas: document.createElement('canvas'),
    selectionContainer: null,
    selectionCanvas: null,
    selectionBox: null,
    isResizing: false,
    isDragging: false,
    resizeHandle: null,
    dragStartPos: { x: 0, y: 0 },
    originalSelection: null,
    maxWidth: 0,
    maxHeight: 0,
    mode: 'idle',
    isSelectionInteractive: true,
};
rec.ctx = rec.canvas.getContext('2d');

const showRecordingModePrompt = (stream) => {
    // Get references to the modal and its buttons from the HTML
    const modal = document.getElementById('recordingModeModal');
    const fullAreaBtn = document.getElementById('recordFullAreaBtn');
    const cropAreaBtn = document.getElementById('selectCropAreaBtn');
    const cancelBtn = document.getElementById('cancelRecordingBtn');

    // A simple function to hide the modal
    const hideModal = () => {
        modal.classList.add('hidden');
    };

    // Define the action for the "Full Area" button
    fullAreaBtn.onclick = () => {
        hideModal();
        const videoTrack = stream.getVideoTracks()[0];
        const settings = videoTrack.getSettings();

        // Define the selection as the full dimensions of the stream
        rec.selection = {
            x: 0, y: 0,
            width: Math.round(settings.width / 2) * 2,   // Enforce even dimensions for the codec
            height: Math.round(settings.height / 2) * 2,
        };

        document.getElementById("guideinforec").classList.add("hidden");
        rec.mode = 'recording';
        state.tempStream = stream; // Store stream for startRecording() to use
        startRecording();
        updateUI(); // This will show the floating timer/stop controls
    };

    // Define the action for the "Crop Area" button
    cropAreaBtn.onclick = () => {
        hideModal();
        // Proceed with the original cropping UI flow
        createInteractiveUI(stream);
    };

    // Define the action for the "Cancel" button
    cancelBtn.onclick = () => {
        hideModal();
        // Stop all stream tracks to release the screen share and turn off the browser's "sharing" indicator
        stream.getTracks().forEach(track => track.stop());
        showInfo("Recording cancelled.");
    };

    // Finally, make the modal visible
    modal.classList.remove('hidden');
};

/**
 * [STEP 1] Asks for screen permission.
 */
export const initiateScreenRecording = async () => {
    try {
        const stream = await navigator.mediaDevices.getDisplayMedia({
            video: { cursor: "always" },
            // preferCurrentTab: true,
            selfBrowserSurface: "include",
            surfaceSwitching: "include",
            audio: { echoCancellation: true, noiseSuppression: true }
        });
        showRecordingModePrompt(stream);
    } catch (err) {
        showError("Screen recording permission was denied.");
    }
};

/**
 * [STEP 2] Creates the entire interactive UI structure.
 */
const createInteractiveUI = (stream) => {
    rec.selectionContainer = document.createElement('div');
    rec.selectionContainer.style.cssText = 'position:fixed; top:0; left:0; width:100vw; height:100vh; z-index:9998; cursor:crosshair;';

    rec.selectionCanvas = document.createElement('canvas');
    rec.selectionCanvas.width = window.innerWidth;
    rec.selectionCanvas.height = window.innerHeight;
    rec.selectionCanvas.style.cssText = 'pointer-events:none; position:absolute; top:0; left:0;';

    rec.selectionBox = document.createElement('div');
    rec.selectionBox.style.cssText = 'position:absolute; display:none; border: 2px dashed #fff; box-sizing: border-box; cursor:move;';

    ['top-left', 'top-right', 'bottom-left', 'bottom-right', 'top', 'bottom', 'left', 'right'].forEach(h => {
        const handle = document.createElement('div');
        handle.dataset.handle = h;
        handle.style.cssText = `position:absolute; width:${HANDLE_SIZE}px; height:${HANDLE_SIZE}px; background:#fff; border:1px solid #333;`;
        rec.selectionBox.appendChild(handle);
    });

    rec.selectionContainer.appendChild(rec.selectionCanvas);
    rec.selectionContainer.appendChild(rec.selectionBox);
    document.body.appendChild(rec.selectionContainer);

    rec.videoElement.style.cssText = 'position:fixed; top:-9999px; left:-9999px;';
    rec.videoElement.muted = true;
    document.body.appendChild(rec.videoElement);

    rec.mode = 'idle';
    rec.selection = null;
    updateUI();

    rec.selectionContainer.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('pointermove', onPointerMove);
    document.addEventListener('pointerup', onPointerUp);

    state.tempStream = stream;
};

/**
 * [STEP 3] Starts the recording process after "Start" is clicked.
 */
const startRecording = async () => {
    const stream = state.tempStream;
    if (!stream || !rec.selection) return;
    delete state.tempStream;
    rec.mediaStream = stream;
    const videoTrack = rec.mediaStream.getVideoTracks()[0];
    if (videoTrack) { videoTrack.onended = () => stopRecording(); }
    resetState();
    rec.isRecording = true;
    rec.startTime = Date.now();
    rec.elapsedPausedTime = 0;

    // Dimensions are now guaranteed to be even.
    rec.maxWidth = Math.round(rec.selection.width / 2) * 2;
    rec.maxHeight = Math.round(rec.selection.height / 2) * 2;
    rec.canvas.width = rec.maxWidth;
    rec.canvas.height = rec.maxHeight;
    rec.videoElement.srcObject = rec.mediaStream;

    // Wait for the video to be ready to avoid a black screen race condition.
    await new Promise(resolve => {
        rec.videoElement.onplaying = resolve;
        rec.videoElement.play();
    });

    rec.output = new Output({
        format: new Mp4OutputFormat({ fastStart: 'fragmented' }),
        target: new StreamTarget(new WritableStream({ write: chunk => rec.chunks.push(chunk.data) })),
    });
    rec.videoSource = new CanvasSource(rec.canvas, {
        codec: 'avc',
        bitrate: QUALITY_HIGH,
        // Add this line to allow the video dimensions to change during recording.
        sizeChangeBehavior: 'passThrough' // or 'crop' depending on desired behavior
    });
    rec.output.addVideoTrack(rec.videoSource, { frameRate: FRAME_RATE });
    const audioTrack = rec.mediaStream.getAudioTracks()[0];
    if (audioTrack) {
        const audioSource = new MediaStreamAudioTrackSource(audioTrack, { codec: 'opus', bitrate: QUALITY_HIGH });
        rec.output.addAudioTrack(audioSource);
    }
    await rec.output.start();
    startTimer();
    rec.captureInterval = setInterval(captureFrame, 1000 / FRAME_RATE);
};


// --- CORE RECORDING & INTERACTION LOGIC ---
const captureFrame = () => {
    if (!rec.isRecording || rec.isPaused || !rec.selection) return;

    // --- MODIFICATION START ---
    // Ensure current selection dimensions are even
    const currentWidth = Math.round(rec.selection.width / 2) * 2;
    const currentHeight = Math.round(rec.selection.height / 2) * 2;

    // Check if the selection has grown larger than our canvas
    let needsResize = false;
    if (currentWidth > rec.maxWidth) {
        rec.maxWidth = currentWidth;
        needsResize = true;
    }
    if (currentHeight > rec.maxHeight) {
        rec.maxHeight = currentHeight;
        needsResize = true;
    }

    // Resize the canvas if necessary to fit the largest selection
    if (needsResize) {
        rec.canvas.width = rec.maxWidth;
        rec.canvas.height = rec.maxHeight;
    }

    // Fill the entire canvas with black. This creates the "padding".
    rec.ctx.fillStyle = '#000';
    rec.ctx.fillRect(0, 0, rec.canvas.width, rec.canvas.height);

    // Calculate the centered position for the current selection
    const destX = (rec.canvas.width - currentWidth) / 2;
    const destY = (rec.canvas.height - currentHeight) / 2;

    // Draw the current video selection onto the center of our (potentially larger) black canvas
    rec.ctx.drawImage(rec.videoElement,
        rec.selection.x, rec.selection.y, rec.selection.width, rec.selection.height, // Source
        destX, destY, currentWidth, currentHeight // Destination (centered)
    );
    // --- MODIFICATION END ---

    const elapsedTime = (Date.now() - rec.startTime - rec.elapsedPausedTime) / 1000;
    if (elapsedTime >= 0) {
        rec.videoSource.add(elapsedTime);
    }
};

const togglePause = () => {
    rec.isPaused = !rec.isPaused;
    if (rec.isPaused) {
        rec.pauseStartTime = Date.now();
        pauseRecBtn.textContent = '▶️ Resume';
        stopTimer();
    } else {
        rec.elapsedPausedTime += Date.now() - rec.pauseStartTime;
        pauseRecBtn.textContent = '⏸️ Pause';
        startTimer();
    }
};
// --- POINTER EVENT HANDLERS ---
const onPointerDown = (e) => {
    if (e.target === rec.selectionBox || rec.selectionBox.contains(e.target)) {
        const handle = e.target.dataset.handle;
        if (handle) { rec.isResizing = true; rec.resizeHandle = handle; } else { rec.isDragging = true; }
        rec.originalSelection = { ...rec.selection };
        rec.dragStartPos = { x: e.clientX, y: e.clientY };
        return;
    }
    if (rec.mode === 'idle' || rec.mode === 'selected') {
        rec.mode = 'drawing';
        rec.dragStartPos = { x: e.clientX, y: e.clientY };
        rec.selection = { x: e.clientX, y: e.clientY, width: 0, height: 0 };
        updateUI();
    }
};

const onPointerMove = (e) => {
    const { clientX: x, clientY: y } = e;
    if (rec.mode === 'drawing') {
        const start = rec.dragStartPos;
        rec.selection = { x: Math.min(start.x, x), y: Math.min(start.y, y), width: Math.abs(start.x - x), height: Math.abs(start.y - y) };
    } else if (rec.isResizing) {
        rec.selection = applyResizeToSelection(rec.resizeHandle, x - rec.dragStartPos.x, y - rec.dragStartPos.y, rec.originalSelection);
    } else if (rec.isDragging) {
        rec.selection.x = rec.originalSelection.x + (x - rec.dragStartPos.x);
        rec.selection.y = rec.originalSelection.y + (y - rec.dragStartPos.y);
    }
    if (rec.mode === 'drawing' || rec.isResizing || rec.isDragging) {
        updateUI();
    }
};

const onPointerUp = () => {
    if (rec.mode === 'drawing') {
        if (rec.selection.width < 50 || rec.selection.height < 50) {
            cancelSelection();
            return;
        }

        // =======================================================================
        // THE PRIMARY FIX IS HERE: Enforce even dimensions for the AVC codec.
        // This prevents the "dimensions not supported" error.
        // =======================================================================
        rec.selection.width = Math.round(rec.selection.width / 2) * 2;
        rec.selection.height = Math.round(rec.selection.height / 2) * 2;
        // =======================================================================

        rec.mode = 'selected';
        rec.isSelectionInteractive = true;
    }
    rec.isResizing = false;
    rec.isDragging = false;
    updateUI(); // Update UI to show the (potentially) adjusted selection box size
};

const updateFloatingControlsUI = () => {
    if (rec.mode === 'selected') {
        recordingControls.classList.remove('hidden');
        startRecFloatingBtn.style.display = 'block';
        pauseRecBtn.style.display = 'none';
        stopRecBtn.style.display = 'none';
        recTimer.style.display = 'none';
    } else if (rec.mode === 'recording') {
        recordingControls.classList.remove('hidden');
        startRecFloatingBtn.style.display = 'none';
        pauseRecBtn.style.display = 'block';
        stopRecBtn.style.display = 'block';
        recTimer.style.display = 'block';
    } else { // Handles 'idle' and other states
        recordingControls.classList.add('hidden');
    }
};

// --- UI UPDATE & DRAWING ---
const updateUI = () => {
    updateFloatingControlsUI();
    if (!rec.selectionContainer) return;

    // Update canvas overlay
    const ctx = rec.selectionCanvas.getContext('2d');
    const { width, height } = rec.selectionCanvas;
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.fillRect(0, 0, width, height);

    if (rec.mode === 'idle') {
        ctx.font = '24px sans-serif';
        ctx.fillStyle = '#fff';
        ctx.textAlign = 'center';
        ctx.fillText('Click and drag to select an area', width / 2, height / 2);
    }

    if (rec.mode === 'recording' || rec.mode === 'selected') {
        if (rec.isSelectionInteractive) {
            // UNLOCKED: We can move/resize the box, but page is blocked.
            rec.selectionContainer.style.pointerEvents = 'auto';
            rec.selectionBox.style.pointerEvents = 'auto';
            rec.selectionBox.style.border = '2px dashed #fff'; // Visual feedback: Dashed = editable
        } else {
            // LOCKED: We can interact with the page, but the box is static.
            rec.selectionContainer.style.pointerEvents = 'none';
            // The box also needs to be 'none' to allow clicks to pass through.
            rec.selectionBox.style.pointerEvents = 'none';
            rec.selectionBox.style.border = '2px solid #007bff'; // Visual feedback: Solid blue = locked
        }
    } else {
        // Default behavior for drawing the initial selection.
        rec.selectionContainer.style.pointerEvents = 'auto';
        rec.selectionBox.style.pointerEvents = 'auto'; // Does not matter much here
        rec.isSelectionInteractive = true; // Reset state when not selecting
    }

    rec.selectionBox.style.display = rec.selection ? 'block' : 'none';
    if (rec.selection) {
        ctx.clearRect(rec.selection.x, rec.selection.y, rec.selection.width, rec.selection.height);
        rec.selectionBox.style.left = `${rec.selection.x}px`;
        rec.selectionBox.style.top = `${rec.selection.y}px`;
        rec.selectionBox.style.width = `${rec.selection.width}px`;
        rec.selectionBox.style.height = `${rec.selection.height}px`;

        const handles = Array.from(rec.selectionBox.children);
        handles.forEach(handle => {
            const pos = handle.dataset.handle;
            if (pos.includes('right')) handle.style.left = `${rec.selection.width - HANDLE_SIZE}px`; else if (pos.includes('left')) handle.style.left = '0px'; else handle.style.left = `${rec.selection.width / 2 - HANDLE_SIZE / 2}px`;
            if (pos.includes('bottom')) handle.style.top = `${rec.selection.height - HANDLE_SIZE}px`; else if (pos.includes('top')) handle.style.top = '0px'; else handle.style.top = `${rec.selection.height / 2 - HANDLE_SIZE / 2}px`;
            handle.style.cursor = getCursorForHandle(pos);
        });
    }
};

const cancelSelection = () => {
    if (state.tempStream) { state.tempStream.getTracks().forEach(track => track.stop()); delete state.tempStream; }
    if (rec.selectionContainer) { document.body.removeChild(rec.selectionContainer); rec.selectionContainer = null; }
    // BLACK SCREEN FIX: Clean up the video element when done.
    if (rec.videoElement) { rec.videoElement.remove(); }
    rec.mode = 'idle';
    recordingControls.classList.add('hidden');
    showInfo("Recording cancelled.");
};

const stopRecording = async () => {
    state.screenrecording = false;
    document.getElementById("guideinforec").classList.remove("hidden");
    if (!rec.isRecording) return;
    rec.isRecording = false;
    cancelSelection();
    stopTimer();
    clearInterval(rec.captureInterval);
    rec.mediaStream?.getTracks().forEach(track => track.stop());
    recordingControls.classList.add('hidden');
    await rec.output.finalize();
    const blob = new Blob(rec.chunks, { type: rec.output.format.mimeType });
    const timestamp = new Date().toLocaleString().replace(/[/:]/g, '-');
    const fileName = `Recording ${timestamp}.mp4`;
    const recordedFile = new File([blob], fileName, { type: blob.type });
    state.playlist.push({ type: 'file', name: fileName, file: recordedFile, isCutClip: true });
    updatePlaylistUIOptimized();
    openPlaylist();
    showInfo("Recording added to playlist!");
};

const getHandlePositions = (rect) => {
    return {
        'top-left': { x: rect.x, y: rect.y },
        'top-right': { x: rect.x + rect.width, y: rect.y },
        'bottom-left': { x: rect.x, y: rect.y + rect.height },
        'bottom-right': { x: rect.x + rect.width, y: rect.y + rect.height },
        'top': { x: rect.x + rect.width / 2, y: rect.y },
        'bottom': { x: rect.x + rect.width / 2, y: rect.y + rect.height },
        'left': { x: rect.x, y: rect.y + rect.height / 2 },
        'right': { x: rect.x + rect.width, y: rect.y + rect.height / 2 },
    };
};

const getResizeHandleAt = (x, y, rect) => {
    const positions = getHandlePositions(rect);
    for (const [name, pos] of Object.entries(positions)) {
        if (Math.abs(x - pos.x) < HANDLE_SIZE && Math.abs(y - pos.y) < HANDLE_SIZE) {
            return name;
        }
    }
    return null;
};

const applyResizeToSelection = (handle, dx, dy, original) => {
    let { x, y, width, height } = original;
    if (handle.includes('left')) { x += dx; width -= dx; }
    if (handle.includes('right')) { width += dx; }
    if (handle.includes('top')) { y += dy; height -= dy; }
    if (handle.includes('bottom')) { height += dy; }
    return { x, y, width, height };
};

const isInsideSelection = (x, y, rect) => (x > rect.x && x < rect.x + rect.width && y > rect.y && y < rect.y + rect.height);
const getCursorForHandle = (handle) => {
    if (handle.includes('top') || handle.includes('bottom')) return 'ns-resize';
    if (handle.includes('left') || handle.includes('right')) return 'ew-resize';
    return 'default';
};
const startTimer = () => {
    // Clear any existing interval to prevent duplicates
    if (rec.timerInterval) clearInterval(rec.timerInterval);

    rec.timerInterval = setInterval(() => {
        // This calculation is now safe and correct
        const totalSeconds = Math.floor((Date.now() - rec.startTime - rec.elapsedPausedTime) / 1000);
        if (totalSeconds < 0) return; // Safeguard
        const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
        const seconds = String(totalSeconds % 60).padStart(2, '0');
        recTimer.textContent = `${minutes}:${seconds}`;
    }, 1000);
};

const stopTimer = () => {
    clearInterval(rec.timerInterval);
    rec.timerInterval = null;
};
// =======================================================================

const resetState = () => {
    rec.isPaused = false;
    rec.chunks = [];
    rec.elapsedPausedTime = 0;
    recTimer.textContent = '00:00';
    pauseRecBtn.textContent = '⏸️ Pause';
};

export const setupRecordingListeners = () => {
    startRecFloatingBtn.addEventListener('click', () => {
        if (rec.mode === 'selected') {
            rec.mode = 'recording';
            startRecording();
            updateUI();
        }
    });
    recordScreenBtn.onclick = (e) => {
        e.stopPropagation();
        state.screenrecording = true
        settingsMenu.classList.add('hidden');
        initiateScreenRecording();
    };
    pauseRecBtn.addEventListener('click', togglePause);
    stopRecBtn.addEventListener('click', stopRecording);
};

export const lenvetlistener = () => {
    rec.isSelectionInteractive = !rec.isSelectionInteractive;
    // Re-run the UI update to apply the new pointer-events and border style
    updateUI();

    // Optional: Show a quick message to the user
    const message = rec.isSelectionInteractive ? "Selection Unlocked" : "Selection Locked";
    if (rec.isSelectionInteractive) {
        document.getElementById("guideinforec").classList.remove("hidden");
    } else {
        document.getElementById("guideinforec").classList.add("hidden");
    }
    showInfo(message);

}