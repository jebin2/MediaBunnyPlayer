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
	QUALITY_HIGH,
	AudioSampleSink,
	AudioSample
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

const createAudioProcessFunction = async (primaryAudioTrack, state) => {
	const audioEditTracks = state.playlist.filter(item =>
		item.media_type === 'mix_audio' && item.audio_edit_prop?.time_ranges?.length > 0
	);

	if (audioEditTracks.length === 0) {
		console.log("[AudioProcess] No audio edit tracks with time ranges found.");
		return null;
	}

	const audioEditSources = [];
	for (const track of audioEditTracks) {
		console.log(`[AudioProcess] Initializing and pre-buffering audio edit track: "${track.name}"`);
		const audioInput = new Input({
			source: new BlobSource(track.file),
			formats: ALL_FORMATS
		});
		const editAudioTrack = await audioInput.getPrimaryAudioTrack();
		if (!editAudioTrack) {
			console.warn(`[AudioProcess] No audio track in "${track.name}". Skipping.`);
			continue;
		}
		const canDecode = await editAudioTrack.canDecode();
		if (!canDecode) {
			console.warn(`[AudioProcess] Cannot decode "${track.name}". Skipping.`);
			continue;
		}

		const reportedDuration = await editAudioTrack.computeDuration();
		if (reportedDuration <= 0) {
			console.warn(`[AudioProcess] Overlay track "${track.name}" has no duration. Skipping.`);
			continue;
		}

		// Decode the entire overlay track into a single AudioSample
		const sink = new AudioSampleSink(editAudioTrack);
		const fullOverlaySample = await sink.getSample(0, { duration: reportedDuration });
		const overlayFrameCount = fullOverlaySample.numberOfFrames;
		const overlayChannels = fullOverlaySample.numberOfChannels;
		const overlaySampleRate = fullOverlaySample.sampleRate;

		// =================================================================
		// START: CRITICAL FIX - CALCULATE THE TRUE DURATION
		// =================================================================
		// We trust the frame count of the data we actually received, not the reported duration.
		const trueOverlayDuration = overlayFrameCount / overlaySampleRate;
		console.log(`[AudioProcess]   - Reported duration: ${reportedDuration.toFixed(4)}s. True buffered duration: ${trueOverlayDuration.toFixed(4)}s (${overlayFrameCount} frames @ ${overlaySampleRate}Hz).`);
		// =================================================================
		// END: CRITICAL FIX
		// =================================================================

		const overlayAudioData = new Float32Array(overlayFrameCount * overlayChannels);
		for (let c = 0; c < overlayChannels; c++) {
			const planeSizeBytes = fullOverlaySample.allocationSize({ planeIndex: c, format: "f32-planar" });
			const planeData = new Float32Array(planeSizeBytes / 4);
			fullOverlaySample.copyTo(planeData, { planeIndex: c, format: "f32-planar" });
			for (let i = 0; i < overlayFrameCount; i++) {
				overlayAudioData[i * overlayChannels + c] = planeData[i];
			}
		}
		fullOverlaySample.close();

		audioEditSources.push({
			trueOverlayDuration, // Use our reliable, calculated duration
			overlayAudioData,
			overlayChannels,
			overlaySampleRate,
			action: track.audio_edit_prop.action,
			time_ranges: track.audio_edit_prop.time_ranges.map(r => ({
				start: parseTime(r.start),
				end: parseTime(r.end)
			})),
			input: audioInput,
		});
	}

	if (audioEditSources.length === 0) {
		console.log("[AudioProcess] No valid overlay sources could be prepared.");
		return null;
	}

	const process = async (originalSample) => {
		const sampleTimestamp = originalSample.timestamp;
		const sampleDuration = originalSample.numberOfFrames / originalSample.sampleRate;
		const sampleEndTime = sampleTimestamp + sampleDuration;
		const channels = originalSample.numberOfChannels;
		const sampleRate = originalSample.sampleRate;
		const frameCount = originalSample.numberOfFrames;

		const originalData = new Float32Array(frameCount * channels);
		for (let c = 0; c < channels; c++) {
			const planeSizeBytes = originalSample.allocationSize({ planeIndex: c, format: "f32-planar" });
			const planeData = new Float32Array(planeSizeBytes / 4);
			originalSample.copyTo(planeData, { planeIndex: c, format: "f32-planar" });
			for (let i = 0; i < frameCount; i++) {
				originalData[i * channels + c] = planeData[i];
			}
		}

		let modified = false;

		for (const source of audioEditSources) {
			for (const range of source.time_ranges) {
				const overlapStart = Math.max(sampleTimestamp, range.start);
				const overlapEnd = Math.min(sampleEndTime, range.end);

				if (overlapStart >= overlapEnd) continue;

				modified = true;
				const startFrame = Math.round((overlapStart - sampleTimestamp) * sampleRate);
				const endFrame = Math.round((overlapEnd - sampleTimestamp) * sampleRate);

				for (let frame = startFrame; frame < endFrame; frame++) {
					const currentTime = sampleTimestamp + (frame / sampleRate);
					const inRangeTime = currentTime - range.start;

					// =================================================================
					// START: CRITICAL FIX - Use the true duration for the loop
					// =================================================================
					const overlayTime = inRangeTime % source.trueOverlayDuration;
					// =================================================================
					// END: CRITICAL FIX
					// =================================================================

					const overlayFrame = Math.floor(overlayTime * source.overlaySampleRate);

					for (let c = 0; c < channels; c++) {
						const originalIndex = frame * channels + c;
						const editC = Math.min(c, source.overlayChannels - 1);
						const overlayIndex = (overlayFrame * source.overlayChannels) + editC;

						// Safeguard to prevent reading beyond the buffer, which causes blanking
						if (overlayIndex >= source.overlayAudioData.length) continue;

						const originalValue = originalData[originalIndex];
						const editValue = source.overlayAudioData[overlayIndex];

						if (source.action === "replace") {
							originalData[originalIndex] = editValue;
						} else { // overlay
							originalData[originalIndex] = (originalValue + editValue) / 2;
						}
					}
				}
			}
		}

		if (modified) {
			const mixedSample = new AudioSample({
				data: originalData,
				format: "f32",
				numberOfChannels: channels,
				sampleRate,
				timestamp: sampleTimestamp
			});
			originalSample.close();
			return mixedSample;
		} else {
			return originalSample;
		}
	};

	return {
		process,
		dispose: () => {
			console.log("[AudioProcess] Disposing of all audio edit sources.");
			audioEditSources.forEach(s => s.input.dispose())
		}
	};
};

// Helper with debug logging
const mixAudioSamplesWithLog = async (originalSample, editSample, timestamp) => {
	console.log(`[AudioMix] Starting mix for timestamp ${timestamp.toFixed(4)}s`);
	const channels = originalSample.numberOfChannels;
	const sampleRate = originalSample.sampleRate;
	const frameCount = originalSample.numberOfFrames;

	console.log(`[AudioMix]   - Original sample: ${channels} channels, ${sampleRate} Hz, ${frameCount} frames.`);
	console.log(`[AudioMix]   - Edit sample: ${editSample.numberOfChannels} channels, ${editSample.sampleRate} Hz, ${editSample.numberOfFrames} frames.`);

	const mixedChannels = [];
	for (let c = 0; c < channels; c++) {
		const origBytes = originalSample.allocationSize({ planeIndex: c, format: "f32-planar" });
		const origData = new Float32Array(origBytes / 4);
		originalSample.copyTo(origData, { planeIndex: c, format: "f32-planar" });

		const editC = Math.min(c, editSample.numberOfChannels - 1);
		const editBytes = editSample.allocationSize({ planeIndex: editC, format: "f32-planar" });
		const editData = new Float32Array(editBytes / 4);
		editSample.copyTo(editData, { planeIndex: editC, format: "f32-planar" });

		const len = Math.min(origData.length, editData.length);
		const mixedData = new Float32Array(len);
		for (let i = 0; i < len; i++) {
			mixedData[i] = (origData[i] + editData[i]) / 2;
		}

		console.log(`[AudioMix]   - Channel ${c}: Mixed ${len} frames.`);
		mixedChannels.push(mixedData);
	}

	const totalFrames = mixedChannels[0].length;
	const interleavedData = new Float32Array(totalFrames * channels);
	for (let frame = 0; frame < totalFrames; frame++) {
		for (let channel = 0; channel < channels; channel++) {
			interleavedData[frame * channels + channel] = mixedChannels[channel][frame];
		}
	}

	const mixedSample = new AudioSample({
		data: interleavedData,
		format: "f32", // interleaved
		numberOfChannels: channels,
		sampleRate,
		timestamp
	});

	console.log(`[AudioMix] Finished mixing. Created new AudioSample with ${totalFrames} frames.`);

	originalSample.close();
	editSample.close();

	return mixedSample;
};

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

			const primaryAudioTrack = await input.getPrimaryAudioTrack();
			if (primaryAudioTrack) {
				const audioProcessOptions = await createAudioProcessFunction(primaryAudioTrack, state);
				if (audioProcessOptions) {
					conversionOptions.audio = {
						track: primaryAudioTrack,
						codec: 'opus',
						bitrate: 128e3,
						forceTranscode: true,
						...audioProcessOptions
					};

					// Store dispose function for cleanup
					state.audioProcessDispose = audioProcessOptions.dispose;
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