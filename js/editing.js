// ============================================================================
// VIDEO PROCESSING & CUTTING
// ============================================================================

import {
	Input,
	ALL_FORMATS,
	BlobSource,
	UrlSource,
	Conversion,
	Output,
	Mp4OutputFormat,
	BufferTarget,
	QUALITY_HIGH
} from 'https://cdn.jsdelivr.net/npm/mediabunny@1.24.2/+esm';

// Import the new mergeVideos function
import { mergeVideoClips } from './merge.js';
import {
	startTimeInput,
	endTimeInput
} from './constants.js';
import {
	state
} from './state.js';
import {
	resetAllConfigs,
	getTrimRanges
} from './settings.js'
import {
	clampRectToVideoBounds,
	getInterpolatedCropRect,
	smoothPathWithMovingAverage,
	togglePanning,
	toggleStaticCrop
} from './crop.js'
import {
	guidedPanleInfo,
	parseTime,
} from './utility.js'
import {
	hideTrackMenus,
	pause
} from './player.js'
import {
	updatePlaylistUIOptimized
} from './playlist.js'
import {
	hideStatusMessage,
	showError,
	showStatusMessage
} from './ui.js'

const createVideoProcessFunction = (videoTrack, state) => {
	const hasDynamicCrop = state.panKeyframes.length > 1 && state.panRectSize;
	const hasStaticCrop = state.cropRect && state.cropRect.width > 0;
	const hasBlur = state.blurSegments.length > 0;

	if (!hasDynamicCrop && !hasStaticCrop && !hasBlur) {
		return null;
	}

	let outputWidth, outputHeight;
	let processCanvas = null;
	let processCtx = null;

	// 1. Determine Output Dimensions based on crop type
	if (hasDynamicCrop) {
		if (state.dynamicCropMode === 'max-size') {
			const maxWidth = Math.max(...state.panKeyframes.map(kf => kf.rect.width));
			const maxHeight = Math.max(...state.panKeyframes.map(kf => kf.rect.height));
			outputWidth = Math.round(maxWidth / 2) * 2;
			outputHeight = Math.round(maxHeight / 2) * 2;
		} else if (state.dynamicCropMode === 'spotlight') {
			outputWidth = videoTrack.codedWidth;
			outputHeight = videoTrack.codedHeight;
		} else { // 'none' or Default
			outputWidth = Math.round(state.panRectSize.width / 2) * 2;
			outputHeight = Math.round(state.panRectSize.height / 2) * 2;
		}
	} else if (hasStaticCrop) {
		outputWidth = Math.round(state.cropRect.width / 2) * 2;
		outputHeight = Math.round(state.cropRect.height / 2) * 2;
	} else { // Only blurring
		outputWidth = videoTrack.codedWidth;
		outputHeight = videoTrack.codedHeight;
	}


	// 2. Create the unified process function
	const process = (sample) => {
		if (!processCanvas) {
			processCanvas = new OffscreenCanvas(outputWidth, outputHeight);
			processCtx = processCanvas.getContext('2d', { alpha: false });
		}

		const videoFrame = sample._data || sample;
		const currentTime = sample.timestamp;
		let sourceRect;

		// Determine the source rectangle to crop from the original video
		if (hasDynamicCrop) {
			sourceRect = getInterpolatedCropRect(currentTime);
		} else if (hasStaticCrop) {
			sourceRect = state.cropRect;
		} else { // No crop, use the full frame
			sourceRect = { x: 0, y: 0, width: videoTrack.codedWidth, height: videoTrack.codedHeight };
		}

		if (!sourceRect || sourceRect.width <= 0 || sourceRect.height <= 0) return sample;
		const safeSourceRect = clampRectToVideoBounds(sourceRect);


		// --- A. DRAW THE (POTENTIALLY CROPPED) BACKGROUND AND FRAME ---
		processCtx.fillStyle = 'black';
		processCtx.fillRect(0, 0, outputWidth, outputHeight);

		if (state.dynamicCropMode === 'spotlight') {
			// Spotlight mode draws the full frame with a background effect
			if (state.useBlurBackground) {
				processCtx.drawImage(videoFrame, 0, 0, outputWidth, outputHeight);
				processCtx.filter = `blur(${state.blurAmount}px)`;
				processCtx.drawImage(processCanvas, 0, 0);
				processCtx.filter = 'none';
			}
			processCtx.drawImage(videoFrame, Math.round(safeSourceRect.x), Math.round(safeSourceRect.y), Math.round(safeSourceRect.width), Math.round(safeSourceRect.height), Math.round(safeSourceRect.x), Math.round(safeSourceRect.y), Math.round(safeSourceRect.width), Math.round(safeSourceRect.height));
		} else {
			// All other modes draw a cropped portion into the output canvas
			let destX = 0, destY = 0, destWidth = outputWidth, destHeight = outputHeight;
			if (hasDynamicCrop && (state.dynamicCropMode === 'none' || (state.dynamicCropMode === 'max-size' && state.scaleWithRatio))) {
				// Handle letterboxing/scaling for dynamic crops
				const sourceAspectRatio = safeSourceRect.width / safeSourceRect.height;
				const outputAspectRatio = outputWidth / outputHeight;
				if (sourceAspectRatio > outputAspectRatio) {
					destWidth = outputWidth;
					destHeight = destWidth / sourceAspectRatio;
				} else {
					destHeight = outputHeight;
					destWidth = destHeight * sourceAspectRatio;
				}
				destX = (outputWidth - destWidth) / 2;
				destY = (outputHeight - destHeight) / 2;
			}
			processCtx.drawImage(videoFrame, Math.round(safeSourceRect.x), Math.round(safeSourceRect.y), Math.round(safeSourceRect.width), Math.round(safeSourceRect.height), destX, destY, destWidth, destHeight);
		}


		// --- B. APPLY BLUR SEGMENTS (IF ANY) ---
		if (hasBlur) {
			state.blurSegments.forEach(segment => {
				if (currentTime >= segment.startTime && currentTime <= segment.endTime && segment.points.length > 2) {
					processCtx.save();
					processCtx.beginPath();

					// IMPORTANT: Translate blur coordinates from the original video space
					// to the new processed canvas space.
					const translatedX = segment.points[0].x - safeSourceRect.x;
					const translatedY = segment.points[0].y - safeSourceRect.y;
					processCtx.moveTo(translatedX, translatedY);
					for (let i = 1; i < segment.points.length; i++) {
						processCtx.lineTo(segment.points[i].x - safeSourceRect.x, segment.points[i].y - safeSourceRect.y);
					}
					processCtx.closePath();
					processCtx.clip();

					if (state.blurConfig.isBlur) {
						processCtx.filter = `blur(${state.blurConfig.blurAmount}px)`;
						processCtx.drawImage(processCanvas, 0, 0);
					} else {
						processCtx.fillStyle = state.blurConfig.plainColor; // #000000
						processCtx.fill(); // This will fill the path defined above
					}

					processCtx.restore(); // Remove clip and filter for next frame/segment
				}
			});
		}

		return processCanvas;
	};

	return {
		processedWidth: outputWidth,
		processedHeight: outputHeight,
		process
	};
};

export const handleCutAction = async () => {
	if (!state.fileLoaded) return;
	if (state.playing) pause();

	// Get all the trim ranges from the UI
	const trimRanges = getTrimRanges();

	if (!trimRanges || trimRanges.length === 0) {
		showError("No trim ranges have been defined. Please add at least one range to cut.");
		return;
	}

	hideTrackMenus();

	const generatedClips = []; // To store the file of each generated clip

	try {
		// Process each trim range individually
		for (let i = 0; i < trimRanges.length; i++) {
			const range = trimRanges[i];
			const start = parseTime(range.start);
			const end = parseTime(range.end);

			if (isNaN(start) || isNaN(end) || start >= end || start < 0 || end > state.totalDuration) {
				showError(`Invalid time range provided for clip ${i + 1} (${range.start} - ${range.end}). Skipping.`);
				continue; // Skip this invalid range
			}

			showStatusMessage(`Processing clip ${i + 1} of ${trimRanges.length}...`);

			// --- This is the core conversion logic, now inside a loop ---
			const source = (state.currentPlayingFile instanceof File) ? new BlobSource(state.currentPlayingFile) : new UrlSource(state.currentPlayingFile);
			const input = new Input({
				source,
				formats: ALL_FORMATS
			});
			const output = new Output({
				format: new Mp4OutputFormat({
					fastStart: 'in-memory'
				}),
				target: new BufferTarget()
			});

			const conversionOptions = {
				input,
				output,
				trim: {
					start,
					end
				}
			};
			const needsProcessing = (state.panKeyframes.length > 1 && state.panRectSize) || (state.cropRect && state.cropRect.width > 0) || state.blurSegments.length > 0;

			if (needsProcessing) {
				if (state.smoothPath && state.panKeyframes.length > 1) {
					guidedPanleInfo('Smoothing path...');
					state.panKeyframes = smoothPathWithMovingAverage(state.panKeyframes, 15);
				}
				const videoTrack = await input.getPrimaryVideoTrack();
				if (!videoTrack) throw new Error("A video track is required for processing.");

				const processOptions = createVideoProcessFunction(videoTrack, state);
				if (processOptions) {
					conversionOptions.video = {
						track: videoTrack,
						codec: 'avc',
						bitrate: QUALITY_HIGH,
						forceTranscode: true,
						...processOptions
					};
				}
			}

			const conversion = await Conversion.init(conversionOptions);
			if (!conversion.isValid) {
				console.error(`Could not create a valid conversion for the range ${range.start}-${range.end}`);
				continue; // Skip to the next range
			}

			conversion.onProgress = (progress) => {
				showStatusMessage(`Creating clip ${i + 1}/${trimRanges.length}... (${Math.round(progress * 100)}%)`);
			};

			await conversion.execute();

			const originalName = (state.currentPlayingFile.name || 'video').split('.').slice(0, -1).join('.');
			const clipName = `${originalName}_clip_${new Date().getTime()}.mp4`;
			const cutClipFile = new File([output.target.buffer], clipName, {
				type: 'video/mp4'
			});

			generatedClips.push(cutClipFile);
			if (input) input.dispose(); // Dispose of the input for this clip
		}


		// --- MERGE LOGIC ---
		if (generatedClips.length === 0) {
			throw new Error("All clip creations failed. Nothing to add to the playlist.");
		}

		let finalFile;

		if (generatedClips.length > 1) {
			showStatusMessage('Merging clips...');
			guidedPanleInfo('Clips created. Now merging...');

			const mergedBlob = await mergeVideoClips({
				files: generatedClips,
				onProgress: (progress) => {
					console.log(`${Math.round(progress * 100)}%`);
				}
			});
			const originalName = (state.currentPlayingFile.name || 'video').split('.').slice(0, -1).join('.');
			const finalFileName = `${originalName}_merged_${new Date().getTime()}.mp4`;
			finalFile = new File([mergedBlob], finalFileName, {
				type: 'video/mp4'
			});
			showStatusMessage('Clips successfully merged!');
			guidedPanleInfo('Clips successfully merged!');
			// Add the final (potentially merged) clip to the playlist
			state.playlist.push({
				type: 'file',
				name: finalFile.name,
				file: finalFile,
				isCutClip: true
			});
		} else {
			state.playlist.push({
				type: 'file',
				name: generatedClips[0].name,
				file: generatedClips[0],
				isCutClip: true
			});
			// If there was only one clip, just use it directly
			showStatusMessage('Clip successfully created!');
			guidedPanleInfo('Clip successfully created!');
		}
		updatePlaylistUIOptimized();
		setTimeout(hideStatusMessage, 2000);
	} catch (error) {
		console.error("Error during cutting:", error);
		showError(`Failed to cut the clip: ${error.message}`);
		hideStatusMessage();
	} finally {
		guidedPanleInfo("");
		resetAllConfigs();
	}
};