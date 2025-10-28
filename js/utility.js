// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================


import { $, sidebar, captionMenu, settingsMenu, blurMenu, mixAudioMenu } from './constants.js';
import { positionCropCanvas } from './crop.js';
import { loadMedia } from './player.js'
import { state } from './state.js'

/**
 * Parses an hh:mm:ss or mm:ss time string into a total number of seconds.
 * @param {string} timeString - The time string to parse (e.g., "01:23" or "01:05:10").
 * @returns {number} The total number of seconds.
 */
export const parseTime = (timeString) => {
    const parts = timeString.split(':').map(parseFloat);
    let totalSeconds = 0;

    if (parts.some(isNaN)) return NaN; // Check for invalid number parts

    if (parts.length === 3) { // hh:mm:ss format
        totalSeconds = (parts[0] * 3600) + (parts[1] * 60) + parts[2];
    } else if (parts.length === 2) { // mm:ss format
        totalSeconds = (parts[0] * 60) + parts[1];
    } else {
        return NaN; // Invalid format
    }
    return totalSeconds;
};

/**
 * Converts a total number of seconds into an hh:mm:ss or mm:ss string format.
 * @param {number} totalSeconds - The total seconds to format.
 * @returns {string} The formatted time string (e.g., "01:23" or "01:05:10").
 */
export const formatTime = (totalSeconds) => {
    if (!isFinite(totalSeconds) || totalSeconds < 0) return '00:00';
    const secondsNum = parseInt(totalSeconds, 10);
    if (isNaN(secondsNum)) return "00:00";

    const hours = Math.floor(secondsNum / 3600);
    const minutes = Math.floor((secondsNum % 3600) / 60);
    const seconds = secondsNum % 60;

    const paddedMinutes = String(minutes).padStart(2, '0');
    const paddedSeconds = String(seconds).padStart(2, '0');

    if (hours > 0) {
        const paddedHours = String(hours).padStart(2, '0');
        return `${paddedHours}:${paddedMinutes}:${paddedSeconds}`;
    } else {
        return `${paddedMinutes}:${paddedSeconds}`;
    }
};

export const escapeHTML = str => str.replace(/[&<>'"]/g,
	tag => ({
		'&': '&amp;',
		'<': '&lt;',
		'>': '&gt;',
		"'": '&#39;',
		'"': '&quot;'
	}[tag]));

export const guidedPanleInfo = (info) => {
	const guide_panel = document.getElementById('guide_panel');
	const guide_info = document.getElementById('guide_info');
	if (info) {
		guide_panel.classList.remove('hidden');
		guide_info.innerText = info
	} else {
		guide_panel.classList.add('hidden');
		guide_info.innerText = info
	}
}

export const updateShortcutKeysVisibility = () => {
	const panel = $('shortcutKeysPanel');
	panel.classList.toggle('hidden');
};

export const dynamicVideoUrl = () => {
	const urlParams = new URLSearchParams(window.location.search);
	const videoUrl = urlParams.get('video_url');
	if (videoUrl) {
		try {
			const muted = urlParams.get('auto_play') === "true";
			const decodedUrl = decodeURIComponent(videoUrl);
			const urlPlayOverlay = $('urlPlayOverlay');
			if (!muted && urlPlayOverlay) {
				document.getElementById("entryloading").classList.add('hidden');
				urlPlayOverlay.classList.remove('hidden');
				const startBtn = urlPlayOverlay.querySelector('button') || urlPlayOverlay;
				startBtn.addEventListener('click', () => {
					loadMedia(decodedUrl, false);
				}, {
					once: true
				});
			} else {
				loadMedia(decodedUrl, false, muted);
			}
		} catch (e) {
			console.error("Error parsing video_url:", e);
		}
	}
}

export const registerServiceWorker = () => {
	if ('serviceWorker' in navigator && window.location.protocol.startsWith('http')) {
		navigator.serviceWorker.register('service-worker.js')
			.catch(err => console.log('ServiceWorker registration failed:', err));
	}
}

export const rightPanel = (type = 'playlist', show = true) => {
	if (playerArea.classList.contains('playlist-visible')) {
		playerArea.classList.remove('playlist-visible');
	}
	sidebar.classList.add('hidden');
	settingsMenu.classList.add('hidden');
	captionMenu.classList.add('hidden');
	blurMenu.classList.add('hidden');
	mixAudioMenu.classList.add('hidden');

	if (show) {
		let menu;
		playerArea.classList.toggle('playlist-visible');
		switch (type) {
			case "playlist":
				menu = sidebar;
				break
			case "settings":
				menu = settingsMenu;
				break
			case "caption":
				menu = captionMenu;
				break
			case "blur":
				menu = blurMenu;
				break
			case "mixAudio":
				menu = mixAudioMenu;
				break
			default:
				menu = sidebar;
		}
		menu.classList.toggle('hidden');
	}

	setTimeout(() => {
		state.cropCanvasDimensions = positionCropCanvas();
	}, 200);
};