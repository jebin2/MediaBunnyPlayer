let setupEventListeners, renderLoop, updatePlaylistUIOptimized;
let dynamicVideoUrl, registerServiceWorker, resize_define;
let setupImageToVideo, setupRecordingListeners;

const loadLocalModules = async () => {
    if (!setupEventListeners) {
        const eventListenersModule = await import('./eventListeners.js');
        setupEventListeners = eventListenersModule.setupEventListeners;

        const playerModule = await import('./player.js');
        renderLoop = playerModule.renderLoop;

        const playlistModule = await import('./playlist.js');
        updatePlaylistUIOptimized = playlistModule.updatePlaylistUIOptimized;

        const utilityModule = await import('./utility.js');
        dynamicVideoUrl = utilityModule.dynamicVideoUrl;
        registerServiceWorker = utilityModule.registerServiceWorker;

        const resizeModule = await import('./resize.js');
        resize_define = resizeModule.resize_define;

        const imageToVideoModule = await import('./imageToVideo.js');
        setupImageToVideo = imageToVideoModule.setupImageToVideo;

        const recordingModule = await import('./recording.js');
        setupRecordingListeners = recordingModule.setupRecordingListeners;
    }
};

let canEncodeAudio;
let registerMp3Encoder;

const loadAudioEncoderModules = async () => {
    // As per the documentation, check if the browser can encode MP3 natively.
    // If not, register the custom WASM-based encoder.
    if (!canEncodeAudio || !registerMp3Encoder) {
        const module = await import('https://cdn.jsdelivr.net/npm/mediabunny@1.24.0/+esm');
        canEncodeAudio = module.canEncodeAudio;

        const mp3Module = await import('https://cdn.jsdelivr.net/npm/@mediabunny/mp3-encoder@1.24.0/+esm');
        registerMp3Encoder = mp3Module.registerMp3Encoder;
    }
};

let gemini_test;

const geminiModulesFunc = async () => {
    if (!gemini_test) {
        const geminiModuleConst = await import('./gemini.js');
        gemini_test = geminiModuleConst.gemini_test;
    }
};

export const full_player = async () => {
    await loadLocalModules();
    await loadAudioEncoderModules();
    await geminiModulesFunc()

    setupEventListeners();
    renderLoop();
    dynamicVideoUrl();
    updatePlaylistUIOptimized();
    registerServiceWorker();
    resize_define();
    setupImageToVideo();
    setupRecordingListeners();
    gemini_test();
}