// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================


import { $ } from './constants.js';
import { loadMedia } from './player.js'

export const parseTime = (timeStr) => {
	const parts = timeStr.split(':').map(Number);
	if (parts.some(isNaN)) return NaN;
	let seconds = 0;
	if (parts.length === 2) {
		seconds = parts[0] * 60 + parts[1];
	} else if (parts.length === 1) {
		seconds = parts[0];
	} else {
		return NaN;
	}
	return seconds;
};

export const formatTime = s => {
	if (!isFinite(s) || s < 0) return '00:00';
	const minutes = Math.floor(s / 60);
	const seconds = Math.floor(s % 60);
	return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
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
				urlPlayOverlay.classList.remove('hidden');
				const startBtn = urlPlayOverlay.querySelector('button') || urlPlayOverlay;
				startBtn.addEventListener('click', () => {
					urlPlayOverlay.classList.add('hidden');
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