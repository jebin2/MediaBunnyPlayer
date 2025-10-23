// FILE: js/recording.js

import {
    CanvasSource,
    MediaStreamAudioTrackSource,
    Mp4OutputFormat,
    Output,
    QUALITY_HIGH,
    StreamTarget,
} from 'https://cdn.jsdelivr.net/npm/mediabunny@1.24.0/+esm';

import { recordingControls, pauseRecBtn, stopRecBtn, recTimer, recordScreenBtn } from './constants.js';
import { state } from './state.js';
import { showInfo, showError } from './ui.js';
import { updatePlaylistUIOptimized, openPlaylist } from './playlist.js';

// --- MODULE STATE ---
const rec = {
    isRecording: false,
    isPaused: false,
    selection: { x: 0, y: 0, width: 0, height: 0 },
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
};
rec.ctx = rec.canvas.getContext('2d');

const FRAME_RATE = 30; // Capture 30 frames per second

/**
 * [STEP 1] Asks the user for screen permission. This is the new entry point.
 */
export const initiateScreenRecording = async () => {
    let stream;
    try {
        // First, get permission and the stream from the browser's native UI
        stream = await navigator.mediaDevices.getDisplayMedia({
            video: { cursor: "always" },
            // preferCurrentTab: true,
            selfBrowserSurface: "include",
            surfaceSwitching: "include",
            audio: { echoCancellation: true, noiseSuppression: true }
        });

        // If successful, proceed to show the area selection overlay
        showSelectionArea(stream);

    } catch (err) {
        // This catch block will trigger if the user clicks "Cancel" in the browser's share-screen popup
        showError("Screen recording permission was denied.");
        // Clean up the stream if it exists but the user cancelled later
        if (stream) {
            stream.getTracks().forEach(track => track.stop());
        }
        return;
    }
};

/**
 * [STEP 2] Creates and shows a full-screen overlay for area selection.
 * It now receives the stream that the user has already approved.
 * @param {MediaStream} stream The screen/window/tab stream.
 */
const showSelectionArea = (stream) => {
    const selectionContainer = document.createElement('div');
    selectionContainer.style.cssText = 'position:fixed; top:0; left:0; width:100vw; height:100vh; background:rgba(0,0,0,0.3); z-index:9999; cursor:crosshair;';

    const selectionBox = document.createElement('div');
    selectionBox.style.cssText = 'position:absolute; border: 2px dashed #fff; box-sizing: border-box; background: rgba(255, 255, 255, 0.1);';

    selectionContainer.appendChild(selectionBox);
    document.body.appendChild(selectionContainer);

    let isSelecting = false;
    let startX = 0, startY = 0;

    const onMouseDown = (e) => {
        isSelecting = true;
        startX = e.clientX;
        startY = e.clientY;
        selectionBox.style.left = `${startX}px`;
        selectionBox.style.top = `${startY}px`;
        selectionBox.style.width = '0px';
        selectionBox.style.height = '0px';
    };

    const onMouseMove = (e) => {
        if (!isSelecting) return;
        const width = e.clientX - startX;
        const height = e.clientY - startY;
        selectionBox.style.width = `${Math.abs(width)}px`;
        selectionBox.style.height = `${Math.abs(height)}px`;
        selectionBox.style.left = `${width > 0 ? startX : e.clientX}px`;
        selectionBox.style.top = `${height > 0 ? startY : e.clientY}px`;
    };

    const onMouseUp = () => {
        isSelecting = false;
        document.body.removeChild(selectionContainer);

        const selection = {
            x: parseInt(selectionBox.style.left, 10),
            y: parseInt(selectionBox.style.top, 10),
            width: Math.max(10, parseInt(selectionBox.style.width, 10)),
            height: Math.max(10, parseInt(selectionBox.style.height, 10)),
        };

        // Ensure dimensions are even for better encoder compatibility
        selection.width = Math.floor(selection.width / 2) * 2;
        selection.height = Math.floor(selection.height / 2) * 2;

        // [STEP 3] Now start the actual recording with the stream and the selected area
        startRecording(stream, selection);
    };

    selectionContainer.addEventListener('mousedown', onMouseDown);
    selectionContainer.addEventListener('mousemove', onMouseMove);
    selectionContainer.addEventListener('mouseup', onMouseUp, { once: true });
};

/**
 * [STEP 3] Initializes the MediaBunny recorder and starts capturing.
 * @param {MediaStream} stream The approved media stream.
 * @param {object} selection The user-defined crop area.
 */
const startRecording = async (stream, selection) => {
    rec.mediaStream = stream;
    rec.selection = selection;

    const videoTrack = rec.mediaStream.getVideoTracks()[0];
    if (videoTrack) {
        videoTrack.onended = () => {
            // This event is fired when the stream is stopped externally.
            // We just need to call our existing stop function.
            // The check `if (!rec.isRecording) return;` inside stopRecording()
            // will prevent it from running twice.
            stopRecording();
        };
    }

    resetState();
    rec.isRecording = true;

    // Configure the canvas and video element for capturing frames
    rec.canvas.width = rec.selection.width;
    rec.canvas.height = rec.selection.height;
    rec.videoElement.srcObject = rec.mediaStream;
    rec.videoElement.play();

    // Setup MediaBunny output
    rec.output = new Output({
        format: new Mp4OutputFormat({ fastStart: 'fragmented' }),
        target: new StreamTarget(new WritableStream({ write: chunk => rec.chunks.push(chunk.data) })),
    });

    rec.videoSource = new CanvasSource(rec.canvas, { codec: 'avc', bitrate: QUALITY_HIGH });
    rec.output.addVideoTrack(rec.videoSource, { frameRate: FRAME_RATE });

    const audioTrack = rec.mediaStream.getAudioTracks()[0];
    if (audioTrack) {
        const audioSource = new MediaStreamAudioTrackSource(audioTrack, { codec: 'opus', bitrate: QUALITY_HIGH });
        rec.output.addAudioTrack(audioSource);
    }

    await rec.output.start();

    // Start UI
    recordingControls.classList.remove('hidden');
    startTimer();
    rec.captureInterval = setInterval(captureFrame, 1000 / FRAME_RATE);
};


// --- CORE RECORDING FUNCTIONS (Unchanged from before) ---

const captureFrame = () => {
    if (!rec.isRecording || rec.isPaused) return;
    rec.ctx.drawImage(rec.videoElement,
        rec.selection.x, rec.selection.y, rec.selection.width, rec.selection.height,
        0, 0, rec.canvas.width, rec.canvas.height
    );
    const elapsedTime = (Date.now() - rec.startTime - rec.elapsedPausedTime) / 1000;
    rec.videoSource.add(elapsedTime);
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

const stopRecording = async () => {
    if (!rec.isRecording) return;
    rec.isRecording = false;
    stopTimer();
    clearInterval(rec.captureInterval);
    rec.mediaStream.getTracks().forEach(track => track.stop());
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

const startTimer = () => {
    rec.startTime = Date.now();
    rec.timerInterval = setInterval(() => {
        const totalSeconds = Math.floor((Date.now() - rec.startTime - rec.elapsedPausedTime) / 1000);
        const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
        const seconds = String(totalSeconds % 60).padStart(2, '0');
        recTimer.textContent = `${minutes}:${seconds}`;
    }, 1000);
};

const stopTimer = () => clearInterval(rec.timerInterval);

const resetState = () => {
    rec.isPaused = false;
    rec.chunks = [];
    rec.elapsedPausedTime = 0;
    recTimer.textContent = '00:00';
    pauseRecBtn.textContent = '⏸️ Pause';
};

export const setupRecordingListeners = () => {
    recordScreenBtn.onclick = (e) => {
        e.stopPropagation();
        settingsMenu.classList.add('hidden'); // Hide the settings menu
        initiateScreenRecording(); // Start the recording process
    };
    pauseRecBtn.addEventListener('click', togglePause);
    stopRecBtn.addEventListener('click', stopRecording);
};