// ============================================================================
// state.js
// ============================================================================

export const state = {
    // Playlist State
    playlist: [],
    selectedFiles: new Set(),
    currentPlayingFile: null,
    fileLoaded: false,

    // Audio/Video State
    audioContext: null,
    gainNode: null,
    videoSink: null,
    audioSink: null,

    // Playback State
    totalDuration: 0,
    playing: false,
    isSeeking: false,
    audioContextStartTime: 0,
    playbackTimeAtStart: 0,

    // Iterator State
    videoFrameIterator: null,
    audioBufferIterator: null,
    nextFrame: null,

    // Async & Timeout State
    asyncId: 0,
    hideControlsTimeout: null,

    // Track Management State
    availableAudioTracks: [],
    availableSubtitleTracks: [],
    currentAudioTrack: null,
    currentSubtitleTrack: null,
    subtitleRenderer: null,
    SubtitleRendererConstructor: null,

    // Loop State
    isLooping: false,
    loopStartTime: 0,
    loopEndTime: 0,
    playbackLogicInterval: null,

    // Screenshot State
    currentScreenshotBlob: null,

    // Playback Control State
    currentPlaybackRate: 1.0,
    isAutoplayEnabled: true,

    // Static Crop State
    isCropping: false,
    isDrawingCrop: false,
    cropStart: { x: 0, y: 0 },
    cropEnd: { x: 0, y: 0 },
    cropRect: null,

    // Dynamic Crop (Pan/Scan) State
    isPanning: false,
    panKeyframes: [],
    panRectSize: null,

    // Crop Configuration State
    scaleWithRatio: false,
    useBlurBackground: false,
    smoothPath: false,
    blurAmount: 15,
    dynamicCropMode: 'none',

    // UI Action State
    currentOpenFileAction: 'open-file',

    // Keyboard State
    isShiftPressed: false,
    buffer: '',

    // Video Track State
    videoTrack: null,

    // Crop Manipulation State
    cropCanvasDimensions: null,
    isCropFixed: false,
    isDraggingCrop: false,
    isResizingCrop: false,
    resizeHandle: null,
    dragStartPos: { x: 0, y: 0 },
    originalCropRect: null,

    // Performance Optimization State
    playlistElementCache: new Map(),
    lastRenderedPlaylist: null,
    subtitleOverlayElement: null,
    lastSubtitleText: null,
    progressUpdateScheduled: false,

    // Resize Timeout
    resizeTimeout: null,

    //resize video
    videoAspectRatio: 16/9
};