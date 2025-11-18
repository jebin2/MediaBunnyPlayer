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
	AudioSample,
	VideoSampleSink
} from 'https://cdn.jsdelivr.net/npm/mediabunny@1.25.0/+esm';

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
	const audioEditTracks = state.mixAudio.filter(item => item.audio_edit_prop?.length > 0
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

		// =================================================================
		// START: FINAL AND CORRECTED DECODING LOGIC
		// =================================================================

		const sink = new AudioSampleSink(editAudioTrack);
		const sampleChunks = [];
		let totalFramesRead = 0;
		let overlayChannels = 0;
		let overlaySampleRate = 0;

		// 1. Use the 'samples()' async iterator to loop through all decoded audio chunks.
		//    This is the idiomatic way to read a track from start to finish.
		for await (const sample of sink.samples()) {
			if (totalFramesRead === 0) {
				// Learn the format from the very first sample
				overlayChannels = sample.numberOfChannels;
				overlaySampleRate = sample.sampleRate;
			}
			sampleChunks.push(sample);
			totalFramesRead += sample.numberOfFrames;
		}

		if (totalFramesRead === 0) {
			console.warn(`[AudioProcess] Track "${track.name}" yielded no audio frames. Skipping.`);
			continue;
		}

		const trueOverlayDuration = totalFramesRead / overlaySampleRate;
		console.log(`[AudioProcess]   - Successfully buffered full track. True duration: ${trueOverlayDuration.toFixed(4)}s (${totalFramesRead} frames @ ${overlaySampleRate}Hz).`);

		// 2. Combine all collected sample chunks into a single interleaved Float32Array.
		const overlayAudioData = new Float32Array(totalFramesRead * overlayChannels);
		let writeOffsetFrames = 0;

		for (const chunk of sampleChunks) {
			const chunkFrameCount = chunk.numberOfFrames;
			for (let c = 0; c < overlayChannels; c++) {
				const planeSizeBytes = chunk.allocationSize({ planeIndex: c, format: "f32-planar" });
				const planeData = new Float32Array(planeSizeBytes / 4);
				chunk.copyTo(planeData, { planeIndex: c, format: "f32-planar" });

				for (let i = 0; i < chunkFrameCount; i++) {
					const interleavedIndex = (writeOffsetFrames + i) * overlayChannels + c;
					overlayAudioData[interleavedIndex] = planeData[i];
				}
			}
			writeOffsetFrames += chunkFrameCount;
			chunk.close(); // IMPORTANT: Free up memory from each chunk after use.
		}

		// =================================================================
		// END: FINAL AND CORRECTED DECODING LOGIC
		// =================================================================

		// =================================================================
		// END: FINAL REVISED DECODING LOGIC
		// =================================================================

		audioEditSources.push({
			trueOverlayDuration, // Use our reliable, calculated duration
			overlayAudioData,
			overlayChannels,
			overlaySampleRate,
			audio_edit_prop: track.audio_edit_prop,
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
			for (const range of source.audio_edit_prop) {
				const overlapStart = Math.max(sampleTimestamp, parseTime(range.start));
				const overlapEnd = Math.min(sampleEndTime, parseTime(range.end));

				if (overlapStart >= overlapEnd) continue;

				modified = true;
				const startFrame = Math.round((overlapStart - sampleTimestamp) * sampleRate);
				const endFrame = Math.round((overlapEnd - sampleTimestamp) * sampleRate);

				for (let frame = startFrame; frame < endFrame; frame++) {
					const currentTime = sampleTimestamp + (frame / sampleRate);
					const inRangeTime = currentTime - parseTime(range.start);

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

						if (range.action === "replace") {
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

export const initializeMixVideoTracks = async () => {
	let mixVideoTracks = [];
	console.log("[MixVideo] Starting initialization of mix tracks...");

	for (const segment of state.mixVideo) {
		console.log(`[MixVideo] Initializing track: "${segment.name}" (Type: ${segment.media_type})`);

		const mixTrack = {
			segment: segment,
			input: null,
			frameSink: null,
			sampleIterator: null,
			currentOverlaySample: null,
			lastMixVideoTime: -1,
			duration: 0,
			// Image/GIF specific
			source: null,
			gifDecoder: null,
			gifTimeline: [], // [ { start: 0, end: 0.1, index: 0 }, ... ]
			_cachedKeyColor: null
		};

		try {
			// --- A. HANDLE GIF (Animated) ---
			if (segment.media_type === 'mix_gif') {
				if (!window.ImageDecoder) {
					console.warn("[MixVideo] ImageDecoder API not supported. GIF will be static.");
					// Fallback to static image loading below
				} else {
					try {
						const buffer = await segment.file.arrayBuffer();
						const decoder = new ImageDecoder({ data: buffer, type: "image/gif" });

						// Wait for metadata (track info)
						await decoder.tracks.ready;
						const track = decoder.tracks.selectedTrack;

						// Pre-calculate timeline (duration of each frame)
						let currentTime = 0;
						mixTrack.gifTimeline = [];

						// We loop through all frames to build the timing map
						for (let i = 0; i < track.frameCount; i++) {
							// Decode frame metadata only (fast) if possible, but ImageDecoder 
							// usually requires decoding to get duration.
							// Since we need accurate sync, we scan durations.
							const result = await decoder.decode({ frameIndex: i });
							const frameDuration = (result.image.duration || 100000) / 1e6; // microseconds to seconds

							mixTrack.gifTimeline.push({
								index: i,
								start: currentTime,
								end: currentTime + frameDuration
							});

							currentTime += frameDuration;
							result.image.close(); // Close immediately, we just needed the time
						}

						mixTrack.gifDecoder = decoder; // Keep decoder open for realtime playback
						mixTrack.duration = currentTime; // Total duration of GIF loop
						console.log(`[MixVideo] GIF loaded: ${track.frameCount} frames, ${mixTrack.duration.toFixed(2)}s duration`);

						mixVideoTracks.push(mixTrack);
						continue; // Done for GIF, skip to next segment

					} catch (gifErr) {
						console.error("[MixVideo] Failed to decode GIF frames. Falling back to static.", gifErr);
						// Fall through to static handler...
					}
				}
			}

			// --- B. HANDLE STATIC IMAGE (PNG, JPG, or Static GIF fallback) ---
			if (segment.media_type === 'mix_image' || segment.media_type === 'mix_gif') {
				try {
					mixTrack.source = await createImageBitmap(segment.file);
					mixTrack.duration = 10; // Arbitrary duration for static images (loops effectively forever)
					console.log(`[MixVideo] Static Image loaded: ${mixTrack.source.width}x${mixTrack.source.height}`);
				} catch (imgErr) {
					console.error(`[MixVideo] Failed to load image bitmap for ${segment.name}`, imgErr);
					continue;
				}
			}
			// --- C. HANDLE VIDEO ---
			else {
				const input = new Input({
					source: new BlobSource(segment.file),
					formats: ALL_FORMATS
				});
				mixTrack.input = input;

				const videoTrack = await input.getPrimaryVideoTrack();
				if (!videoTrack) {
					console.error(`[MixVideo] No video track found in ${segment.name}`);
					continue;
				}

				let duration = videoTrack.duration;
				if (!duration && input.info) duration = input.info.duration;
				if (!duration || isNaN(duration)) duration = 1000;

				mixTrack.duration = duration;
				const frameSink = new VideoSampleSink(videoTrack);
				mixTrack.frameSink = frameSink;
			}

			mixVideoTracks.push(mixTrack);

		} catch (error) {
			console.error(`[MixVideo] Error initializing ${segment.name}:`, error);
		}
	}
	return mixVideoTracks;
};

// Helper to detect background color from frame edges
const detectBackgroundColor = (data, width, height) => {
	// We will sample 4 points: Top-Left, Top-Right, Bottom-Left, Bottom-Right
	const positions = [
		0,                              // Top-Left
		(width - 1) * 4,                // Top-Right
		(width * (height - 1)) * 4,     // Bottom-Left
		(width * height - 1) * 4        // Bottom-Right
	];

	let r = 0, g = 0, b = 0;
	let count = 0;

	positions.forEach(pos => {
		if (pos < data.length) {
			r += data[pos];
			g += data[pos + 1];
			b += data[pos + 2];
			count++;
		}
	});

	// Return the average RGB values
	return {
		r: Math.round(r / count),
		g: Math.round(g / count),
		b: Math.round(b / count)
	};
};

const createVideoProcessFunction = async (videoTrack, state) => {
	const hasDynamicCrop = state.panKeyframes.length > 1 && state.panRectSize;
	const hasStaticCrop = state.cropRect && state.cropRect.width > 0;
	const hasBlur = state.blurSegments.length > 0;
	const hasMixVideo = state.mixVideo && state.mixVideo.length > 0;

	if (!hasDynamicCrop && !hasStaticCrop && !hasBlur && !hasMixVideo) {
		return null;
	}

	let outputWidth, outputHeight;
	let processCanvas = null;
	let processCtx = null;

	// Initialize mix video tracks
	let mixVideoTracks = [];
	if (hasMixVideo) {
		mixVideoTracks = await initializeMixVideoTracks(state);

		// NEW: Create and store an iterator and state for each track
		for (const track of mixVideoTracks) {
			// --- CRITICAL FIX: Check if frameSink exists before calling samples() ---
			// Images/GIFs do not have a frameSink, so we skip iterator creation for them.
			if (track.frameSink) {
				track.sampleIterator = track.frameSink.samples();
			}
			// -----------------------------------------------------------------------
			track.currentOverlaySample = null;
			track.lastMixVideoTime = -1;
		}
	}

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
	} else { // Only blurring or mix video
		outputWidth = videoTrack.codedWidth;
		outputHeight = videoTrack.codedHeight;
	}


	// 2. Create the unified process function
	const process = async (sample) => {
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

		if (!sourceRect || sourceRect.width <= 0 || sourceRect.height <= 0) {
			sample.close(); // IMPORTANT: still need to close the original frame
			return; // Return nothing to signal a skipped frame
		}
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

		// --- C. APPLY MIX VIDEO/IMAGE OVERLAYS ---
		if (hasMixVideo && mixVideoTracks.length > 0) {
			for (const mixTrack of mixVideoTracks) {
				const mixSegment = mixTrack.segment;
				const isStatic = (mixSegment.media_type === 'mix_image');
				const isGif = (mixSegment.media_type === 'mix_gif');

				for (const prop of mixSegment.video_edit_prop) {
					const rangeStart = parseTime(prop.start);
					const rangeEnd = parseTime(prop.end);

					if (currentTime >= rangeStart && currentTime <= rangeEnd) {
						let drawSource = null;

						// --- 1. HANDLE GIF (Animated) ---
						if (isGif && mixTrack.gifDecoder) {
							const timeInRange = currentTime - rangeStart;
							// Modulo for looping
							const gifTime = timeInRange % mixTrack.duration;

							// Find the correct frame index for this time
							const frameData = mixTrack.gifTimeline.find(f => gifTime >= f.start && gifTime < f.end);

							if (frameData) {
								// Decode the specific frame for this moment
								// Note: This is asynchronous. In a tight render loop, this might be slow.
								// Ideally, you cache the last decoded frame.
								try {
									// Check if we have a cached frame that is still valid
									if (mixTrack.currentOverlaySample &&
										mixTrack.lastMixVideoTime === frameData.index) {
										drawSource = mixTrack.currentOverlaySample;
									} else {
										// Decode new frame
										const result = await mixTrack.gifDecoder.decode({ frameIndex: frameData.index });

										// Close old cached frame to free GPU memory
										if (mixTrack.currentOverlaySample) mixTrack.currentOverlaySample.close();

										mixTrack.currentOverlaySample = result.image;
										mixTrack.lastMixVideoTime = frameData.index; // Store index instead of time for GIF
										drawSource = result.image;
									}
								} catch (e) {
									console.warn("GIF decode error", e);
								}
							}
						}
						// --- 2. HANDLE STATIC IMAGE ---
						else if (isStatic || (isGif && !mixTrack.gifDecoder)) {
							if (mixTrack.image || mixTrack.source) {
								drawSource = mixTrack.image || mixTrack.source;
							}
						}
						// --- 3. HANDLE VIDEO ---
						else {
							if (!mixTrack.sampleIterator) continue;

							const timeInRange = currentTime - rangeStart;
							const duration = mixTrack.duration || 1000;
							const mixVideoTime = timeInRange % duration;

							// Video Iterator Logic (Same as before)
							if (mixVideoTime < mixTrack.lastMixVideoTime) {
								if (mixTrack.currentOverlaySample) {
									mixTrack.currentOverlaySample.close();
									mixTrack.currentOverlaySample = null;
								}
								if (mixTrack.sampleIterator && mixTrack.sampleIterator.return) await mixTrack.sampleIterator.return();
								if (mixTrack.frameSink) mixTrack.sampleIterator = mixTrack.frameSink.samples();
							}
							mixTrack.lastMixVideoTime = mixVideoTime;

							try {
								while (!mixTrack.currentOverlaySample || mixTrack.currentOverlaySample.timestamp < mixVideoTime) {
									if (mixTrack.currentOverlaySample) mixTrack.currentOverlaySample.close();
									const { value, done } = await mixTrack.sampleIterator.next();
									if (done) { mixTrack.currentOverlaySample = null; break; }
									mixTrack.currentOverlaySample = value;
								}
								if (mixTrack.currentOverlaySample) drawSource = mixTrack.currentOverlaySample;
							} catch (error) {
								console.error(`[MixVideo] Error fetching frame:`, error);
							}
						}

						if (!drawSource) continue;

						const transform = prop.transform;
						const destX = Math.round(transform.x * outputWidth);
						const destY = Math.round(transform.y * outputHeight);
						const destWidth = Math.round(transform.width * outputWidth);
						const destHeight = Math.round(transform.height * outputHeight);

						if (destWidth <= 0 || destHeight <= 0) continue;

						if (prop.action === 'base') {
							if (typeof drawSource.draw === 'function') {
								drawSource.draw(processCtx, destX, destY, destWidth, destHeight);
							} else {
								processCtx.drawImage(drawSource, destX, destY, destWidth, destHeight);
							}
						} else if (prop.action === 'overlay') {
							processCtx.save();

							const srcW = drawSource.displayWidth || drawSource.width;
							const srcH = drawSource.displayHeight || drawSource.height;

							const tempCanvas = new OffscreenCanvas(srcW, srcH);
							const tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true });

							if (typeof drawSource.draw === 'function') {
								drawSource.draw(tempCtx, 0, 0);
							} else {
								tempCtx.drawImage(drawSource, 0, 0, srcW, srcH);
							}

							const imageData = tempCtx.getImageData(0, 0, srcW, srcH);
							const data = imageData.data;

							if (!mixTrack._cachedKeyColor) {
								mixTrack._cachedKeyColor = detectBackgroundColor(data, srcW, srcH);
							}
							let keyColor = mixTrack._cachedKeyColor;
							let similarity = 0.4, smoothness = 0.1, spill = 0.2;

							if (mixSegment.chromaKey) {
								const hexToRgb = (hex) => {
									const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
									return result ? { r: parseInt(result[1], 16), g: parseInt(result[2], 16), b: parseInt(result[3], 16) } : { r: 0, g: 255, b: 0 };
								};
								keyColor = hexToRgb(mixSegment.chromaKey.color);
								similarity = mixSegment.chromaKey.similarity;
								smoothness = mixSegment.chromaKey.smoothness;
								spill = mixSegment.chromaKey.spill;
							}

							const maxDist = 441.67;
							const keyR = keyColor.r, keyG = keyColor.g, keyB = keyColor.b;

							for (let i = 0; i < data.length; i += 4) {
								const r = data[i], g = data[i + 1], b = data[i + 2];
								const dist = Math.sqrt((r - keyR) ** 2 + (g - keyG) ** 2 + (b - keyB) ** 2);
								const normalizedDist = dist / maxDist;

								let alpha = 1.0;
								if (normalizedDist < similarity) alpha = 0.0;
								else if (normalizedDist < similarity + smoothness) alpha = (normalizedDist - similarity) / smoothness;

								data[i + 3] = alpha * 255;

								if (alpha < 1.0 || normalizedDist < similarity + smoothness + 0.1) {
									if (spill > 0) {
										const gray = (r * 0.299 + g * 0.587 + b * 0.114);
										const spillFactor = spill * (1.0 - normalizedDist);
										if (spillFactor > 0) {
											data[i] = r * (1 - spillFactor) + gray * spillFactor;
											data[i + 1] = g * (1 - spillFactor) + gray * spillFactor;
											data[i + 2] = b * (1 - spillFactor) + gray * spillFactor;
										}
									}
								}
							}

							tempCtx.putImageData(imageData, 0, 0);
							processCtx.drawImage(tempCanvas, destX, destY, destWidth, destHeight);
							processCtx.restore();
						}
					}
				}
			}
		}
		videoFrame.close();
		return processCanvas;
	};

	// Cleanup function for mix video tracks
	const dispose = () => {
		if (mixVideoTracks.length > 0) {
			console.log("[MixVideo] Disposing of mix video tracks and iterators");
			mixVideoTracks.forEach(track => {
				// Close the last cached sample, if it exists
				if (track.currentOverlaySample) {
					track.currentOverlaySample.close();
				}
				// Tell the iterator we are done with it to free resources
				if (track.sampleIterator) {
					track.sampleIterator.return();
				}
				if (track.input) {
					track.input.dispose();
				}
			});
		}
	};

	return {
		processedWidth: outputWidth,
		processedHeight: outputHeight,
		process,
		dispose
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
			const needsProcessing = (state.panKeyframes.length > 1 && state.panRectSize) || (state.cropRect && state.cropRect.width > 0) || state.blurSegments.length > 0 || state.mixVideo.length > 0;

			if (needsProcessing) {
				if (state.smoothPath && state.panKeyframes.length > 1) {
					guidedPanleInfo('Smoothing path...');
					state.panKeyframes = smoothPathWithMovingAverage(state.panKeyframes, 15);
				}
				const videoTrack = await input.getPrimaryVideoTrack();
				if (!videoTrack) throw new Error("A video track is required for processing.");

				const processOptions = await createVideoProcessFunction(videoTrack, state);
				if (processOptions) {
					conversionOptions.video = {
						track: videoTrack,
						codec: 'avc',
						bitrate: QUALITY_HIGH,
						forceTranscode: true,
						...processOptions
					};

					// Store dispose function
					state.videoProcessDispose = processOptions.dispose;
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
		if (state.videoProcessDispose) {
			state.videoProcessDispose();
			state.videoProcessDispose = null;
		}
	}
};