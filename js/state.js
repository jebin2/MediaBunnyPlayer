// js/state.js

export const state = {
    // Media & Playback State
    playlist: [],
    currentPlayingFile: null,
    fileLoaded: false,
    audioContext: null,
    gainNode: null,
    videoSink: null,
    audioSink: null,
    totalDuration: 0,
    playing: false,
    isSeeking: false,
    audioContextStartTime: 0,
    playbackTimeAtStart: 0,
    videoFrameIterator: null,
    audioBufferIterator: null,
    nextFrame: null,
    queuedAudioNodes: new Set(),
    asyncId: 0,
    hideControlsTimeout: null,
    playbackLogicInterval: null,
    currentPlaybackRate: 1.0,
    isAutoplayEnabled: true,

    // Track State
    availableAudioTracks: [],
    availableSubtitleTracks: [],
    currentAudioTrack: null,
    currentSubtitleTrack: null,
    subtitleRenderer: null,
    SubtitleRendererConstructor: null,

    // Editing State
    isLooping: false,
    loopStartTime: 0,
    loopEndTime: 0,
    isCropping: false,
    isDrawingCrop: false,
    cropStart: { x: 0, y: 0 },
    cropEnd: { x: 0, y: 0 },
    cropRect: null,
    isPanning: false,
    panKeyframes: [],
    panRectSize: null,
    dynamicCropMode: 'none',
    scaleWithRatio: false,
    useBlurBackground: false,
    smoothPath: false,
    blurAmount: 15,
    isShiftPressed: false,
    isCropFixed: false,
    isDraggingCrop: false,
    isResizingCrop: false,
    resizeHandle: null,
    dragStartPos: { x: 0, y: 0 },
    originalCropRect: null,
    cropCanvasDimensions: null,
    currentScreenshotBlob: null,

    // UI State
    currentOpenFileAction: 'open-file',

    // Performance/Cache State
    playlistElementCache: new Map(),
    lastRenderedPlaylist: null,
    subtitleOverlayElement: null,
    lastSubtitleText: null,
    progressUpdateScheduled: false,
};

// Helper to update multiple state properties
export function updateState(newState) {
    Object.assign(state, newState);
}