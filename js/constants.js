// ============================================================================
// constants.js
// ============================================================================

export const MEDIABUNNY_URL = 'https://cdn.jsdelivr.net/npm/mediabunny@1.24.0/+esm';
export const HANDLE_SIZE = 12;
export const HANDLE_HALF = HANDLE_SIZE / 2;

// Helper function for getElementById
export const $ = document.getElementById.bind(document);

// DOM Elements - Player Container
export const playerArea = $('playerArea');
export const videoContainer = $('videoContainer');
export const canvas = $('videoCanvas');
export const dropZone = $('dropZone');
export const loading = $('loading');
export const audioTrack = $('audioTrackMenu');

// DOM Elements - Playback Controls
export const playBtn = $('playBtn');
export const timeDisplay = $('timeDisplay');
export const progressContainer = $('progressContainer');
export const progressBar = $('progressBar');
export const volumeSlider = $('volumeSlider');
export const muteBtn = $('muteBtn');
export const fullscreenBtn = $('fullscreenBtn');
export const prevBtn = $('prevBtn');
export const nextBtn = $('nextBtn');

// DOM Elements - Sidebar & Playlist
export const sidebar = $('sidebar');
export const playlistContent = $('playlistContent');
export const videoControls = $('videoControls');

// DOM Elements - Progress & Time
export const progressHandle = $('progressHandle');
export const startTimeInput = $('startTime');
export const endTimeInput = $('endTime');

// DOM Elements - Settings & Menu
export const settingsCtrlBtn = $('settingsCtrlBtn');
export const settingsMenu = $('settingsMenu');

// DOM Elements - Loop & Cut Controls
export const loopBtn = $('loopBtn');
export const cutBtn = $('cutBtn');

// DOM Elements - Screenshot Controls
export const screenshotBtn = $('screenshotBtn');
export const screenshotOverlay = $('screenshotOverlay');
export const screenshotPreviewImg = $('screenshotPreviewImg');
export const closeScreenshotBtn = $('closeScreenshotBtn');
export const copyScreenshotBtn = $('copyScreenshotBtn');
export const downloadScreenshotBtn = $('downloadScreenshotBtn');

// DOM Elements - Playback Speed & Autoplay
export const playbackSpeedInput = $('playbackSpeedInput');
export const autoplayToggle = $('autoplayToggle');

// DOM Elements - URL Modal
export const urlModal = $('urlModal');
export const urlInput = $('urlInput');
export const loadUrlBtn = $('loadUrlBtn');
export const cancelUrlBtn = $('cancelUrlBtn');

// DOM Elements - Resize Modal
export const resizeBtn = $('resizeBtn');
export const resizeModal = $('resizeModal');
export const resizeWidthInput = $('resizeWidthInput');
export const resizeHeightInput = $('resizeHeightInput');
export const keepRatioToggle = $('keepRatioToggle');
export const resizeStartTimeInput = $('resizeStartTime');
export const resizeEndTimeInput = $('resizeEndTime');
export const cancelResizeBtn = $('cancelResizeBtn');
export const processResizeBtn = $('processResizeBtn');

// DOM Elements - Messages
export const showMessage = document.querySelector('.showMessage');

// DOM Elements - Crop Controls
export const cropBtn = $('cropBtn');
export const cropCanvas = $('cropCanvas');
export const panScanBtn = $('panScanBtn');
export const fixSizeBtn = document.getElementById('fixSizeBtn');

// DOM Elements - Dynamic Crop Options
export const cropModeRadios = document.querySelectorAll('input[name="cropMode"]');
export const cropModeNoneRadio = $('cropModeNone');
export const scaleOptionContainer = $('scaleOptionContainer');
export const scaleWithRatioToggle = $('scaleWithRatioToggle');
export const blurOptionContainer = $('blurOptionContainer');
export const smoothOptionContainer = $('smoothOptionContainer');
export const smoothPathToggle = $('smoothPathToggle');
export const blurBackgroundToggle = $('blurBackgroundToggle');
export const blurAmountInput = $('blurAmountInput');

// Canvas Contexts
export const ctx = canvas.getContext('2d', {
    alpha: false,
    desynchronized: true
});
export const cropCtx = cropCanvas.getContext('2d');

// Audio Nodes Set
export const queuedAudioNodes = new Set();