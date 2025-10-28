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
    aspectRatioMode: 'custom', // 'custom', '16:9', or '9:16'
    maxRatioRect: null, // Stores the maximum rectangle for fixed ratios
    aspectRatioLocked: false, // Whether we're using a fixed ratio

    // Dynamic Crop (Pan/Scan) State
    isPanning: false,
    panKeyframes: [],
    panRectSize: null,

    // Crop Configuration State
    scaleWithRatio: false,
    useBlurBackground: false,
    smoothPath: true,
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
    videoAspectRatio: 16 / 9,

    // Image to Video State
    selectedImageFile: null,
    selectedImageBlob: null,

    // recording
    screenrecording: false,

    //caption
    isPositioningCaptions: false,
    allWords: [],
    captionData: null,
    captionStyles: {
        fontSize: 15,       // As a percentage of video height
        color: '#FFFFFF',
        positionX: 50,
        positionY: 50,
        wordGroupSize: 1, // Changed from wordGroup
        highlightColor: '#006affff',
    },

    // --- NEW --- Blur Functionality State
    isBlurring: false,           // Is the user currently in blur mode?
    blurSegments: [],            // Array to store all blur segment data {startTime, endTime, points: [{x, y}]}
    currentBlurSegment: null,    // The segment currently being drawn
    isDrawingBlur: false,
    blurConfig: {
        isBlur: true,
        blurAmount: 15,
        plainColor: '#000000'
    },

    onFrameRenderCallbacks: [],

    // Mix Audio
    mixAudio : []
};