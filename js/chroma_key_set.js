import {
    state
} from './state.js';

export const ChromaKeyApp = {
    // Configuration State
    state: {
        color: '#00ff00',
        similarity: 0.4,
        smoothness: 0.1,
        spill: 0.2,
        isPlaying: false
    },

    // DOM Elements References
    elements: {
        mediaElement: null, // Renamed from 'video' to handle both Video and Image
        canvas: null,
        ctx: null,
        playBtn: null,
        animationFrame: null,
        originalFooter: null
    },

    blobUrl: null,
    activeSegmentIndex: -1,
    isStaticMedia: false, // New flag to track if it's an Image/GIF vs Video

    // --- 1. Initialization ---
    init: function (activeSegmentIndex) {
        this.activeSegmentIndex = activeSegmentIndex;
        const segment = state.mixVideo[this.activeSegmentIndex];
        const inputSource = segment.file;
        const mediaType = segment.media_type || 'mix_video';

        // Determine if this is a static asset (Image/GIF) or Video
        // Note: Standard Canvas drawImage usually only draws the first frame of a GIF 
        // unless parsed manually, so we treat GIFs as static for Keying configuration.
        this.isStaticMedia = (mediaType === 'mix_image' || mediaType === 'mix_gif');

        const contentDiv = document.getElementById('chromaKeyColorContent');
        const modal = document.getElementById('chromaKeyColorModal');

        // Hide the original footer
        this.elements.originalFooter = modal.querySelector('.screenshot-actions');
        if (this.elements.originalFooter) this.elements.originalFooter.style.display = 'none';

        // 1. Build Split Layout UI
        contentDiv.innerHTML = '';
        this.buildUI(contentDiv);

        // 2. Show Modal
        modal.classList.remove('hidden');

        // 3. Create Blob URL
        let mediaSrc = inputSource;
        if (inputSource instanceof File || inputSource instanceof Blob) {
            this.blobUrl = URL.createObjectURL(inputSource);
            mediaSrc = this.blobUrl;
        }

        // 4. Setup Media Element based on Type
        if (this.isStaticMedia) {
            // --- IMAGE / GIF HANDLING ---
            this.elements.mediaElement = new Image();
            this.elements.mediaElement.crossOrigin = "anonymous";
            this.elements.mediaElement.src = mediaSrc;

            this.elements.mediaElement.onload = () => {
                this.elements.canvas.width = this.elements.mediaElement.width;
                this.elements.canvas.height = this.elements.mediaElement.height;
                this.renderFrame(); // Render once
            };
        } else {
            // --- VIDEO HANDLING ---
            this.elements.mediaElement = document.createElement('video');
            this.elements.mediaElement.src = mediaSrc;
            this.elements.mediaElement.loop = true;
            this.elements.mediaElement.muted = true;
            this.elements.mediaElement.crossOrigin = "anonymous";
            this.elements.mediaElement.playsInline = true;

            this.elements.mediaElement.onloadedmetadata = () => {
                this.elements.canvas.width = this.elements.mediaElement.videoWidth;
                this.elements.canvas.height = this.elements.mediaElement.videoHeight;
                this.renderFrame();
                this.togglePlay(); // Auto-play for video
            };
        }

        // 5. Setup Close Handler
        document.getElementById('chromaKeyColortModalCloseBtn').onclick = () => this.close();
    },

    // --- 2. Build Split Layout ---
    buildUI: function (parent) {
        const workspace = document.createElement('div');
        workspace.className = 'chroma-workspace';

        // LEFT: Canvas Area
        const canvasArea = document.createElement('div');
        canvasArea.className = 'chroma-canvas-area';

        this.elements.canvas = document.createElement('canvas');
        this.elements.canvas.id = 'chromaPreviewCanvas';
        this.elements.canvas.addEventListener('mousedown', (e) => this.handleCanvasClick(e));
        this.elements.ctx = this.elements.canvas.getContext('2d', { willReadFrequently: true });

        canvasArea.appendChild(this.elements.canvas);

        // Only add Play button if it is a Video
        if (!this.isStaticMedia) {
            this.elements.playBtn = document.createElement('button');
            this.elements.playBtn.className = 'play-btn chroma-play-btn';
            this.elements.playBtn.innerHTML = '❚❚';
            this.elements.playBtn.onclick = () => this.togglePlay();
            canvasArea.appendChild(this.elements.playBtn);
        }

        // RIGHT: Controls Area
        const controlsArea = document.createElement('div');
        controlsArea.className = 'chroma-controls-area';
        controlsArea.innerHTML = `
            <div class="chroma-color-picker-row">
                <div class="chroma-color-preview" style="background-color: ${this.state.color}">
                    <input type="color" id="chromaColor" value="${this.state.color}">
                </div>
                <div class="color-text">
                    <h4>Key Color</h4>
                    <p>Click media to pick</p>
                </div>
            </div>

            <div class="chroma-control-group">
                <label>Similarity <span id="val-sim">${this.state.similarity}</span></label>
                <input type="range" id="chromaSim" min="0" max="1" step="0.01" value="${this.state.similarity}">
            </div>

            <div class="chroma-control-group">
                <label>Smoothness <span id="val-smooth">${this.state.smoothness}</span></label>
                <input type="range" id="chromaSmooth" min="0" max="1" step="0.01" value="${this.state.smoothness}">
            </div>

            <div class="chroma-control-group">
                <label>Spill Reduction <span id="val-spill">${this.state.spill}</span></label>
                <input type="range" id="chromaSpill" min="0" max="1" step="0.01" value="${this.state.spill}">
            </div>

            <button id="customApplyBtn" class="btn">APPLY CHANGES</button>
        `;

        workspace.appendChild(canvasArea);
        workspace.appendChild(controlsArea);
        parent.appendChild(workspace);

        this.attachListeners();
    },

    attachListeners: function () {
        const update = (key, val) => {
            this.state[key] = parseFloat(val);
            const display = document.getElementById(key === 'similarity' ? 'val-sim' : key === 'smoothness' ? 'val-smooth' : 'val-spill');
            if (display) display.innerText = val;

            // Force re-render immediately (Video paused OR Static image)
            if (!this.state.isPlaying || this.isStaticMedia) {
                this.renderFrame();
            }
        };

        document.getElementById('chromaSim').oninput = (e) => update('similarity', e.target.value);
        document.getElementById('chromaSmooth').oninput = (e) => update('smoothness', e.target.value);
        document.getElementById('chromaSpill').oninput = (e) => update('spill', e.target.value);
        document.getElementById('customApplyBtn').onclick = () => this.applySettings();

        const colorInput = document.getElementById('chromaColor');
        colorInput.oninput = (e) => {
            this.state.color = e.target.value;
            colorInput.parentElement.style.backgroundColor = e.target.value;
            if (!this.state.isPlaying || this.isStaticMedia) this.renderFrame();
        };
    },

    // --- 3. The Logic ---

    loop: function () {
        // Loop only runs for playing videos
        if (this.state.isPlaying && !this.isStaticMedia) {
            this.renderFrame();
            this.elements.animationFrame = requestAnimationFrame(() => this.loop());
        }
    },

    renderFrame: function () {
        const width = this.elements.canvas.width;
        const height = this.elements.canvas.height;
        const ctx = this.elements.ctx;
        const media = this.elements.mediaElement;

        if (!width || !height || !media) return;

        // 1. Draw Source (Video or Image)
        // drawImage works for both HTMLVideoElement and HTMLImageElement
        ctx.drawImage(media, 0, 0, width, height);

        // 2. Get Data
        const imageData = ctx.getImageData(0, 0, width, height);
        const data = imageData.data;
        const l = data.length;

        // 3. Math
        const hexToRgb = (hex) => {
            const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
            return result ? {
                r: parseInt(result[1], 16),
                g: parseInt(result[2], 16),
                b: parseInt(result[3], 16)
            } : { r: 0, g: 255, b: 0 };
        };

        const { r: keyR, g: keyG, b: keyB } = hexToRgb(this.state.color);
        const maxDist = 441.67;

        for (let i = 0; i < l; i += 4) {
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];

            const dist = Math.sqrt((r - keyR) ** 2 + (g - keyG) ** 2 + (b - keyB) ** 2);
            const normalizedDist = dist / maxDist;

            let alpha = 1.0;

            if (normalizedDist < this.state.similarity) {
                alpha = 0.0;
            } else if (normalizedDist < this.state.similarity + this.state.smoothness) {
                alpha = (normalizedDist - this.state.similarity) / this.state.smoothness;
            }

            data[i + 3] = alpha * 255;

            if (alpha < 1.0 || normalizedDist < this.state.similarity + this.state.smoothness + 0.1) {
                if (this.state.spill > 0) {
                    const gray = (r * 0.299 + g * 0.587 + b * 0.114);
                    const spillFactor = this.state.spill * (1.0 - normalizedDist);
                    if (spillFactor > 0) {
                        data[i] = r * (1 - spillFactor) + gray * spillFactor;
                        data[i + 1] = g * (1 - spillFactor) + gray * spillFactor;
                        data[i + 2] = b * (1 - spillFactor) + gray * spillFactor;
                    }
                }
            }
        }

        // 4. Put Data
        ctx.putImageData(imageData, 0, 0);
    },

    // --- 4. Interactions ---

    togglePlay: function () {
        // Static media cannot play
        if (this.isStaticMedia) return;

        if (this.elements.mediaElement.paused) {
            this.elements.mediaElement.play().catch(e => console.log("Autoplay prevented:", e));
            this.state.isPlaying = true;
            if (this.elements.playBtn) this.elements.playBtn.innerHTML = '❚❚';
            this.loop();
        } else {
            this.elements.mediaElement.pause();
            this.state.isPlaying = false;
            if (this.elements.playBtn) this.elements.playBtn.innerHTML = '▶';
            cancelAnimationFrame(this.elements.animationFrame);
        }
    },

    handleCanvasClick: function (e) {
        const rect = this.elements.canvas.getBoundingClientRect();
        const scaleX = this.elements.canvas.width / rect.width;
        const scaleY = this.elements.canvas.height / rect.height;
        const x = (e.clientX - rect.left) * scaleX;
        const y = (e.clientY - rect.top) * scaleY;

        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = 1;
        tempCanvas.height = 1;
        const tCtx = tempCanvas.getContext('2d');

        // drawImage works for both Video and Image elements
        tCtx.drawImage(this.elements.mediaElement, x, y, 1, 1, 0, 0, 1, 1);
        const p = tCtx.getImageData(0, 0, 1, 1).data;
        const hex = "#" + ("000000" + ((p[0] << 16) | (p[1] << 8) | p[2]).toString(16)).slice(-6);

        this.state.color = hex;
        const colorInput = document.getElementById('chromaColor');
        if (colorInput) {
            colorInput.value = hex;
            colorInput.parentElement.style.backgroundColor = hex;
        }
        // Force update if paused or static
        if (!this.state.isPlaying || this.isStaticMedia) this.renderFrame();
    },

    close: function () {
        this.state.isPlaying = false;
        cancelAnimationFrame(this.elements.animationFrame);

        // Cleanup Media Element
        if (this.elements.mediaElement) {
            if (!this.isStaticMedia) {
                // Pause video
                this.elements.mediaElement.pause();
                this.elements.mediaElement.src = "";
                this.elements.mediaElement.load();
            } else {
                // Clear image
                this.elements.mediaElement.src = "";
            }
            this.elements.mediaElement = null;
        }

        if (this.blobUrl) {
            URL.revokeObjectURL(this.blobUrl);
            this.blobUrl = null;
        }

        if (this.elements.originalFooter) this.elements.originalFooter.style.display = 'block';

        document.getElementById('chromaKeyColorModal').classList.add('hidden');
    },

    applySettings: function () {
        state.mixVideo[this.activeSegmentIndex].chromaKey = { ...this.state };
        this.close();
    }
};