let setupEventListeners, renderLoop, updatePlaylistUIOptimized;
let dynamicVideoUrl, registerServiceWorker, resize_define;
let setupImageToVideo, setupRecordingListeners;

const loadLocalModules = async () => {
    if (!setupEventListeners) {
        // LOAD ALL MODULES IN PARALLEL
        // This prevents the UI from freezing waiting for one file after another
        const [
            eventListenersModule,
            playerModule,
            playlistModule,
            utilityModule,
            resizeModule,
            imageToVideoModule,
            recordingModule
        ] = await Promise.all([
            import('./eventListeners.js'),
            import('./player.js'),
            import('./playlist.js'),
            import('./utility.js'),
            import('./resize.js'),
            import('./imageToVideo.js'),
            import('./recording.js')
        ]);

        // Assign exports
        setupEventListeners = eventListenersModule.setupEventListeners;
        renderLoop = playerModule.renderLoop;
        updatePlaylistUIOptimized = playlistModule.updatePlaylistUIOptimized;
        dynamicVideoUrl = utilityModule.dynamicVideoUrl;
        registerServiceWorker = utilityModule.registerServiceWorker;
        resize_define = resizeModule.resize_define;
        setupImageToVideo = imageToVideoModule.setupImageToVideo;
        setupRecordingListeners = recordingModule.setupRecordingListeners;
    }
};

let canEncodeAudio;
let registerMp3Encoder;

const loadAudioEncoderModules = async () => {
    // As per the documentation, check if the browser can encode MP3 natively.
    // If not, register the custom WASM-based encoder.
    if (!canEncodeAudio || !registerMp3Encoder) {
        const module = await import('https://cdn.jsdelivr.net/npm/mediabunny@1.25.0/+esm');
        canEncodeAudio = module.canEncodeAudio;

        const mp3Module = await import('https://cdn.jsdelivr.net/npm/@mediabunny/mp3-encoder@1.24.0/+esm');
        registerMp3Encoder = mp3Module.registerMp3Encoder;
    }
};

export const full_player = async () => {
    await loadLocalModules();
    await loadAudioEncoderModules();

    setupEventListeners();
    renderLoop();
    dynamicVideoUrl();
    updatePlaylistUIOptimized();

    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
             registerServiceWorker(); 
        });
    }

    resize_define();
    setupImageToVideo();
    setupRecordingListeners();
}