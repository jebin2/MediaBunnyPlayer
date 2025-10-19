// js/editing.js

import { Input, ALL_FORMATS, BlobSource, UrlSource, Conversion, Output, Mp4OutputFormat, BufferTarget, QUALITY_HIGH } from 'https://cdn.jsdelivr.net/npm/mediabunny@1.24.0/+esm';
import { state, updateState } from './state.js';
import * as C from './constants.js';
import * as UI from './ui.js';
import { formatTime, parseTime, smoothPathWithMovingAverage } from './utils.js';
import { pause, getPlaybackTime, play, loadMedia } from './player.js';

export const handleConversion = async (source, fileName) => {
	UI.showStatusMessage('Unsupported format. Converting to MP4...');
	let input;
	try {
		input = new Input({ source, formats: ALL_FORMATS });
		const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() });
		const conversion = await Conversion.init({ input, output });
		if (!conversion.isValid) {
			let reason = 'the file contains no convertible tracks.';
			if (conversion.discardedTracks.length > 0) {
				const firstReason = conversion.discardedTracks[0].reason;
				reason = firstReason === 'undecodable_source_codec' ? 'its codec is unsupported for conversion.' : `internal error (${firstReason}).`;
			}
			throw new Error(`Could not convert because ${reason}`);
		}
		conversion.onProgress = (p) => UI.showStatusMessage(`Converting... (${Math.round(p * 100)}%)`);
		await conversion.execute();
		UI.showStatusMessage('Conversion complete. Loading...');
		const blob = new Blob([output.target.buffer], { type: 'video/mp4' });
		const convertedFile = new File([blob], (fileName.split('.').slice(0, -1).join('.') || 'converted') + '.mp4', { type: 'video/mp4' });
		await loadMedia(convertedFile, true);
	} catch (error) {
		UI.showError(`Conversion Failed: ${error.message}`);
		UI.showDropZoneUI();
	} finally {
		if (input) input.dispose();
		UI.hideStatusMessage();
	}
};

export const handleCutAction = async () => {
	if (!state.fileLoaded) return;
	if (state.playing) pause();
	const start = parseTime(C.startTimeInput.value);
	const end = parseTime(C.endTimeInput.value);
	if (isNaN(start) || isNaN(end) || start >= end || start < 0 || end > state.totalDuration) {
		return UI.showError("Invalid start or end time for cutting.");
	}
	UI.hideTrackMenus();
	UI.showStatusMessage('Cutting clip...');
	let input;
	try {
		const source = (state.currentPlayingFile instanceof File) ? new BlobSource(state.currentPlayingFile) : new UrlSource(state.currentPlayingFile);
		input = new Input({ source, formats: ALL_FORMATS });
		const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() });
		const conversionOptions = { input, output, trim: { start, end } };

		if (state.panKeyframes.length > 1 && state.panRectSize) {
			if (state.smoothPath) {
				UI.showStatusMessage('Smoothing path...');
				updateState({ panKeyframes: smoothPathWithMovingAverage(state.panKeyframes, 15) });
			}
			const videoTrack = await input.getPrimaryVideoTrack();
			if (!videoTrack) throw new Error("No video track for dynamic cropping.");
            let outputWidth, outputHeight;
            if (state.dynamicCropMode === 'spotlight') {
                outputWidth = videoTrack.codedWidth; outputHeight = videoTrack.codedHeight;
            } else if (state.dynamicCropMode === 'max-size') {
                outputWidth = Math.round(Math.max(...state.panKeyframes.map(kf => kf.rect.width)) / 2) * 2;
                outputHeight = Math.round(Math.max(...state.panKeyframes.map(kf => kf.rect.height)) / 2) * 2;
            } else {
                outputWidth = Math.round(state.panRectSize.width / 2) * 2;
                outputHeight = Math.round(state.panRectSize.height / 2) * 2;
            }
			conversionOptions.video = {
				track: videoTrack, codec: 'avc', bitrate: QUALITY_HIGH, processedWidth: outputWidth, processedHeight: outputHeight, forceTranscode: true,
				process: (sample) => {
                    const cropRect = getInterpolatedCropRect(sample.timestamp); if (!cropRect) return sample;
					const safeRect = clampRectToVideoBounds(cropRect); if (safeRect.width <= 0 || safeRect.height <= 0) return sample;
					const canvas = new OffscreenCanvas(outputWidth, outputHeight);
                    const ctx = canvas.getContext('2d', { alpha: false });
					const frame = sample._data || sample;
                    if ((state.dynamicCropMode === 'spotlight' || state.dynamicCropMode === 'max-size') && state.useBlurBackground) {
                        ctx.drawImage(frame, 0, 0, outputWidth, outputHeight);
                        ctx.filter = `blur(${state.blurAmount}px)`; ctx.drawImage(canvas, 0, 0); ctx.filter = 'none';
                    } else {
                        ctx.fillStyle = 'black'; ctx.fillRect(0, 0, outputWidth, outputHeight);
                    }
                    if (state.dynamicCropMode === 'spotlight') {
                        ctx.drawImage(frame, safeRect.x, safeRect.y, safeRect.width, safeRect.height, safeRect.x, safeRect.y, safeRect.width, safeRect.height);
                    } else {
                        let destX, destY, destWidth, destHeight;
                        if (state.dynamicCropMode === 'max-size' && state.scaleWithRatio) {
                            const srcAspect = safeRect.width / safeRect.height; const outAspect = outputWidth / outputHeight;
                            if (srcAspect > outAspect) { destWidth = outputWidth; destHeight = destWidth / srcAspect; }
                            else { destHeight = outputHeight; destWidth = destHeight * srcAspect; }
                            destX = (outputWidth - destWidth) / 2; destY = (outputHeight - destHeight) / 2;
                        } else {
                            destWidth = safeRect.width; destHeight = safeRect.height;
                            destX = (outputWidth - destWidth) / 2; destY = (outputHeight - destHeight) / 2;
                        }
                        ctx.drawImage(frame, safeRect.x, safeRect.y, safeRect.width, safeRect.height, destX, destY, destWidth, destHeight);
                    }
					return canvas;
				}
			};
		} else if (state.cropRect?.width > 0) {
			const { x, y, width, height } = state.cropRect;
			conversionOptions.video = { crop: { left: Math.round(x), top: Math.round(y), width: Math.round(width/2)*2, height: Math.round(height/2)*2 } };
		}

		const conversion = await Conversion.init(conversionOptions);
		if (!conversion.isValid) throw new Error('Could not create a valid conversion.');
		conversion.onProgress = (p) => UI.showStatusMessage(`Cutting... (${Math.round(p * 100)}%)`);
		await conversion.execute();
		const originalName = (state.currentPlayingFile.name || 'video').split('.').slice(0, -1).join('.');
		const clipName = `${originalName}_${formatTime(start)}-${formatTime(end)}_edited.mp4`.replace(/:/g, '_');
		const cutClipFile = new File([output.target.buffer], clipName, { type: 'video/mp4' });
		state.playlist.push({ type: 'file', name: clipName, file: cutClipFile, isCutClip: true });
		UI.updatePlaylistUIOptimized();
		UI.showInfo('Clip added to playlist!');
		setTimeout(UI.hideStatusMessage, 2000);
	} catch (error) {
		console.error("Cut error:", error);
		UI.showError(`Failed to cut clip: ${error.message}`);
	} finally {
		if (input) input.dispose();
		UI.hideStatusMessage();
	}
};

export const takeScreenshot = () => {
	if (!state.fileLoaded || !C.canvas) return UI.showError("No video loaded.");
	C.canvas.toBlob((blob) => {
		if (!blob) return UI.showError("Failed to create screenshot.");
		updateState({ currentScreenshotBlob: blob });
		if (C.screenshotPreviewImg.src.startsWith('blob:')) URL.revokeObjectURL(C.screenshotPreviewImg.src);
		C.screenshotPreviewImg.src = URL.createObjectURL(blob);
		C.screenshotOverlay.classList.remove('hidden');
		UI.hideTrackMenus();
	}, 'image/png');
};

export const toggleStaticCrop = (e, reset = false) => {
	const isCropping = !reset && !state.isCropping;
    updateState({ isCropping, isPanning: false });
	C.panScanBtn.textContent = 'Dynamic ✂️'; C.cropBtn.textContent = isCropping ? 'Cropping...' : '✂️';
	C.cropCanvas.classList.toggle('hidden', !isCropping);
	C.panScanBtn.classList.remove('hover_highlight'); C.cropBtn.classList.toggle('hover_highlight', isCropping);
	UI.updateShortcutKeysVisibility();
	if (isCropping) {
		updateState({ cropCanvasDimensions: UI.positionCropCanvas(), isCropFixed: false });
	} else {
		C.cropCtx.clearRect(0, 0, C.cropCanvas.width, C.cropCanvas.height);
		updateState({ cropRect: null, cropCanvasDimensions: null, isCropFixed: false });
	}
    UI.updateFixSizeButton();
};

export const togglePanning = (e, reset = false) => {
	const isPanning = !reset && !state.isPanning;
    updateState({ isPanning, isCropping: false, panKeyframes: [], panRectSize: null });
	C.cropBtn.textContent = '✂️'; C.panScanBtn.textContent = isPanning ? 'Recording... (L to lock)' : 'Dynamic ✂️';
	C.cropCanvas.classList.toggle('hidden', !isPanning);
	C.cropBtn.classList.remove('hover_highlight'); C.panScanBtn.classList.toggle('hover_highlight', isPanning);
	UI.updateShortcutKeysVisibility();
	if (isPanning) {
		updateState({ cropCanvasDimensions: UI.positionCropCanvas(), isCropFixed: false });
	} else {
		C.cropCtx.clearRect(0, 0, C.cropCanvas.width, C.cropCanvas.height);
		updateState({ cropCanvasDimensions: null, isCropFixed: false });
	}
    UI.updateFixSizeButton();
};

export const toggleCropFixed = () => {
    updateState({ isCropFixed: !state.isCropFixed });
	UI.updateFixSizeButton();
	if (state.isCropFixed) {
		if (state.isCropping && state.cropRect) {
			state.cropRect.width = Math.round(state.cropRect.width / 2) * 2;
			state.cropRect.height = Math.round(state.cropRect.height / 2) * 2;
			updateState({ cropRect: clampRectToVideoBounds(state.cropRect) });
			UI.drawCropWithHandles(state.cropRect);
		} else if (state.isPanning && state.panRectSize) {
			state.panRectSize.width = Math.round(state.panRectSize.width / 2) * 2;
			state.panRectSize.height = Math.round(state.panRectSize.height / 2) * 2;
			const lastFrame = state.panKeyframes.at(-1);
			if (lastFrame) {
				lastFrame.rect.width = state.panRectSize.width;
				lastFrame.rect.height = state.panRectSize.height;
				lastFrame.rect = clampRectToVideoBounds(lastFrame.rect);
			}
		}
		UI.showInfo(state.isPanning ? "Size locked! Move cursor to record path." : "Size locked!");
	} else {
		UI.showInfo("Crop area can be resized.");
		const currentRect = state.isCropping ? state.cropRect : state.panKeyframes.at(-1)?.rect;
        if(currentRect) UI.drawCropWithHandles(currentRect);
	}
};

export const getScaledCoordinates = (e) => {
	const rect = C.cropCanvas.getBoundingClientRect();
	const scaleX = C.cropCanvas.width / rect.width;
	const scaleY = C.cropCanvas.height / rect.height;
	return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
};

export const getInterpolatedCropRect = (timestamp) => {
	if (!state.panKeyframes?.length) return null;
	let prevKey = state.panKeyframes[0], nextKey = null;
	for (let i = 1; i < state.panKeyframes.length; i++) {
		if (state.panKeyframes[i].timestamp > timestamp) {
			nextKey = state.panKeyframes[i]; break;
		}
		prevKey = state.panKeyframes[i];
	}
	if (!nextKey) return prevKey.rect;
	const timeDiff = nextKey.timestamp - prevKey.timestamp;
	if (timeDiff <= 0) return prevKey.rect;
	const t = (timestamp - prevKey.timestamp) / timeDiff;
	const x = prevKey.rect.x + (nextKey.rect.x - prevKey.rect.x) * t;
	const y = prevKey.rect.y + (nextKey.rect.y - prevKey.rect.y) * t;
	return clampRectToVideoBounds({ ...prevKey.rect, x, y });
};

export const clampRectToVideoBounds = (rect) => {
	if (!C.canvas.width || !C.canvas.height) return rect;
	let { x, y, width, height } = rect;
	x = Math.max(0, Math.min(x, C.canvas.width - width));
	y = Math.max(0, Math.min(y, C.canvas.height - height));
	return { x, y, width, height };
};

export const getResizeHandle = (x, y, rect) => {
	if (!rect || state.isCropFixed) return null;
    const HANDLE_SIZE = 12;
	const handles = [
		{ name: 'nw', x: rect.x, y: rect.y }, { name: 'ne', x: rect.x + rect.width, y: rect.y },
		{ name: 'sw', x: rect.x, y: rect.y + rect.height }, { name: 'se', x: rect.x + rect.width, y: rect.y + rect.height }];
	for (const handle of handles) {
		if (Math.hypot(x - handle.x, y - handle.y) <= HANDLE_SIZE) return handle.name;
	}
	return null;
};

export const isInsideCropRect = (x, y, rect) => rect && x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height;

export const getCursorForHandle = (handle) => ({ nw: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', se: 'nwse-resize', move: 'move' }[handle] || 'crosshair');

export const applyResize = (handle, deltaX, deltaY, originalRect) => {
	let { x, y, width, height } = { ...originalRect };
	if (handle.includes('w')) { x += deltaX; width -= deltaX; }
	if (handle.includes('e')) { width += deltaX; }
	if (handle.includes('n')) { y += deltaY; height -= deltaY; }
	if (handle.includes('s')) { height += deltaY; }
	if (width < 20) { width = 20; if (handle.includes('w')) x = originalRect.x + originalRect.width - 20; }
	if (height < 20) { height = 20; if (handle.includes('n')) y = originalRect.y + originalRect.height - 20; }
	return clampRectToVideoBounds({ x, y, width, height });
};

export const resetAllConfigs = () => {
    if (state.playing) pause();
    if (state.isCropping) toggleStaticCrop(null, true);
    if (state.isPanning) togglePanning(null, true);
    updateState({
        dynamicCropMode: 'none', scaleWithRatio: false, useBlurBackground: false,
        smoothPath: false, blurAmount: 15, isLooping: false, loopStartTime: 0, loopEndTime: 0
    });
    C.$('cropModeNone').checked = true;
    C.scaleWithRatioToggle.checked = false; C.smoothPathToggle.checked = false;
    C.blurBackgroundToggle.checked = false; C.blurAmountInput.value = 15;
    if (state.fileLoaded) {
        C.startTimeInput.value = formatTime(0);
        C.endTimeInput.value = formatTime(state.totalDuration);
    }
    C.loopBtn.textContent = 'Loop'; C.loopBtn.classList.remove('hover_highlight');
    UI.updateDynamicCropOptionsUI();
    UI.showInfo("All configurations have been reset.");
};