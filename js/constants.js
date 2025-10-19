// js/constants.js

export const MEDIABUNNY_URL = 'https://cdn.jsdelivr.net/npm/mediabunny@1.24.0/+esm';
export const $ = document.getElementById.bind(document);

// Main Layout
export const playerArea = $('playerArea');
export const videoContainer = $('videoContainer');
export const canvas = $('videoCanvas');
export const dropZone = $('dropZone');
export const loading = $('loading');
export const showMessage = document.querySelector('.showMessage');

// Player Controls
export const playBtn = $('playBtn');
export const prevBtn = $('prevBtn');
export const nextBtn = $('nextBtn');
export const timeDisplay = $('timeDisplay');
export const progressContainer = $('progressContainer');
export const progressBar = $('progressBar');
export const progressHandle = $('progressHandle');
export const volumeSlider = $('volumeSlider');
export const muteBtn = $('muteBtn');
export const fullscreenBtn = $('fullscreenBtn');
export const videoControls = $('videoControls');
export const playbackSpeedInput = $('playbackSpeedInput');
export const autoplayToggle = $('autoplayToggle');

// Editing Controls
export const loopBtn = $('loopBtn');
export const cutBtn = $('cutBtn');
export const cropBtn = $('cropBtn');
export const panScanBtn = $('panScanBtn');
export const cropCanvas = $('cropCanvas');
export const startTimeInput = $('startTime');
export const endTimeInput = $('endTime');
export const fixSizeBtn = $('fixSizeBtn');
export const resetAllBtn = $('resetAllBtn');
export const shortcutKeysPanel = $('shortcutKeysPanel');

// Screenshot Feature
export const screenshotBtn = $('screenshotBtn');
export const screenshotOverlay = $('screenshotOverlay');
export const screenshotPreviewImg = $('screenshotPreviewImg');
export const closeScreenshotBtn = $('closeScreenshotBtn');
export const copyScreenshotBtn = $('copyScreenshotBtn');
export const downloadScreenshotBtn = $('downloadScreenshotBtn');

// Playlist
export const sidebar = $('sidebar');
export const playlistContent = $('playlistContent');
export const clearPlaylistBtn = $('clearPlaylistBtn');
export const chooseFileBtn = $('chooseFileBtn');
export const togglePlaylistBtn = $('togglePlaylistBtn');
export const fileInput = $('fileInput');
export const folderInput = $('folderInput');

// URL Modal
export const urlModal = $('urlModal');
export const urlInput = $('urlInput');
export const loadUrlBtn = $('loadUrlBtn');
export const cancelUrlBtn = $('cancelUrlBtn');

// Action Buttons
export const mainActionBtn = $('mainActionBtn');
export const dropdownActionBtn = $('dropdownActionBtn');
export const actionDropdownMenu = $('actionDropdownMenu');

// Menus
export const settingsCtrlBtn = $('settingsCtrlBtn');
export const settingsMenu = $('settingsMenu');
export const audioTrackCtrlBtn = $('audioTrackCtrlBtn');
export const subtitleTrackCtrlBtn = $('subtitleTrackCtrlBtn');
export const audioTrackMenu = $('audioTrackMenu');
export const subtitleTrackMenu = $('subtitleTrackMenu');
export const audioTrackList = $('audioTrackList');
export const subtitleTrackList = $('subtitleTrackList');

// Dynamic Crop Options
export const cropModeRadios = document.querySelectorAll('input[name="cropMode"]');
export const scaleOptionContainer = $('scaleOptionContainer');
export const scaleWithRatioToggle = $('scaleWithRatioToggle');
export const blurOptionContainer = $('blurOptionContainer');
export const smoothOptionContainer = $('smoothOptionContainer');
export const smoothPathToggle = $('smoothPathToggle');
export const blurBackgroundToggle = $('blurBackgroundToggle');
export const blurAmountInput = $('blurAmountInput');

// Canvas Contexts
export const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
export const cropCtx = cropCanvas.getContext('2d');