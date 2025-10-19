// js/utils.js

export const parseTime = (timeStr) => {
	const parts = timeStr.split(':').map(Number);
	if (parts.some(isNaN)) return NaN;
	let seconds = 0;
	if (parts.length === 3) {
		seconds = parts[0] * 3600 + parts[1] * 60 + parts[2];
	} else if (parts.length === 2) {
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
	const hours = Math.floor(s / 3600);
	const minutes = Math.floor((s % 3600) / 60);
	const seconds = Math.floor(s % 60);
	if (hours > 0) {
		return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
	}
	return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
};

export const escapeHTML = str => str.replace(/[&<>'"]/g,
	tag => ({
		'&': '&amp;', '<': '&lt;', '>': '&gt;',
		"'": '&#39;', '"': '&quot;'
	}[tag]));

export const smoothPathWithMovingAverage = (keyframes, windowSize = 15) => {
	if (keyframes.length < windowSize) return keyframes;
	const smoothedKeyframes = [];
	const halfWindow = Math.floor(windowSize / 2);
	for (let i = 0; i < keyframes.length; i++) {
		const start = Math.max(0, i - halfWindow);
		const end = Math.min(keyframes.length - 1, i + halfWindow);
		let sumX = 0, sumY = 0, sumWidth = 0, sumHeight = 0;
		for (let j = start; j <= end; j++) {
			sumX += keyframes[j].rect.x;
			sumY += keyframes[j].rect.y;
			sumWidth += keyframes[j].rect.width;
			sumHeight += keyframes[j].rect.height;
		}
		const count = (end - start) + 1;
		smoothedKeyframes.push({
			timestamp: keyframes[i].timestamp,
			rect: {
				x: sumX / count, y: sumY / count,
				width: sumWidth / count, height: sumHeight / count,
			}
		});
	}
	return smoothedKeyframes;
};