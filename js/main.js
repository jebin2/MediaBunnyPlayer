// js/main.js

import { setupEventListeners } from './eventListeners.js';
import { renderLoop, loadMedia } from './player.js';
import { updatePlaylistUIOptimized } from './ui.js';

function initialize() {
    setupEventListeners();
    renderLoop();

    const urlParams = new URLSearchParams(window.location.search);
    const videoUrl = urlParams.get('video_url');
    if (videoUrl) {
        try {
            const decodedUrl = decodeURIComponent(videoUrl);
            const urlPlayOverlay = document.getElementById('urlPlayOverlay');
            if (urlPlayOverlay) {
                urlPlayOverlay.classList.remove('hidden');
                const startBtn = urlPlayOverlay.querySelector('button') || urlPlayOverlay;
                startBtn.addEventListener('click', () => {
                    urlPlayOverlay.classList.add('hidden');
                    loadMedia(decodedUrl);
                }, { once: true });
            } else {
                loadMedia(decodedUrl);
            }
        } catch (e) {
            console.error("Error parsing video_url:", e);
        }
    } else {
        updatePlaylistUIOptimized();
    }

    if ('serviceWorker' in navigator && window.location.protocol.startsWith('http')) {
        navigator.serviceWorker.register('service-worker.js')
            .catch(err => console.log('ServiceWorker registration failed:', err));
    }
}

document.addEventListener('DOMContentLoaded', initialize);