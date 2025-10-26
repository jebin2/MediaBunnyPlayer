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
	formatTime,
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
	guidedPanleInfo('Creating clip...');

	const generatedClips = []; // To store the file of each generated clip
	let processCanvas = null;
	let processCtx = null;

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
			let cropFuncToReset = null;

			if (state.panKeyframes.length > 1 && state.panRectSize) {
				cropFuncToReset = togglePanning;

				// =================== START OF NEW SMOOTHING LOGIC ===================
				// If the smooth path option is checked, preprocess the keyframes.
				if (state.smoothPath || state.dynamicCropMode == 'none') {
					guidedPanleInfo('Smoothing path...');
					// Replace the jerky keyframes with the new, smoothed version.
					state.panKeyframes = smoothPathWithMovingAverage(state.panKeyframes, 15);
				}
				guidedPanleInfo('Processing... and will be added to playlist');
				// =================== END OF NEW SMOOTHING LOGIC =====================
				const videoTrack = await input.getPrimaryVideoTrack();
				if (!videoTrack) throw new Error("No video track found for dynamic cropping.");

				// --- THE LOGIC IS NOW DRIVEN BY THE DYNAMIC CROP MODE ---

				if (state.dynamicCropMode === 'spotlight') {
					const outputWidth = videoTrack.codedWidth;
					const outputHeight = videoTrack.codedHeight;
					conversionOptions.video = {
						track: videoTrack,
						codec: 'avc',
						bitrate: QUALITY_HIGH,
						processedWidth: outputWidth,
						processedHeight: outputHeight,
						forceTranscode: true,
						process: (sample) => {
							const cropRect = getInterpolatedCropRect(sample.timestamp);
							if (!cropRect) return sample;
							const safeCropRect = clampRectToVideoBounds(cropRect);
							if (safeCropRect.width <= 0 || safeCropRect.height <= 0) return sample;
							if (!processCanvas) {
								processCanvas = new OffscreenCanvas(outputWidth, outputHeight);
								processCtx = processCanvas.getContext('2d', {
									alpha: false
								});
							}
							const videoFrame = sample._data || sample;

							if (state.useBlurBackground) {
								processCtx.drawImage(videoFrame, 0, 0, outputWidth, outputHeight);
								processCtx.filter = `blur(${state.blurAmount}px)`;
								processCtx.drawImage(processCanvas, 0, 0);
								processCtx.filter = 'none';
							} else {
								processCtx.fillStyle = 'black';
								processCtx.fillRect(0, 0, outputWidth, outputHeight);
							}
							processCtx.drawImage(videoFrame, Math.round(safeCropRect.x), Math.round(safeCropRect.y), Math.round(safeCropRect.width), Math.round(safeCropRect.height), Math.round(safeCropRect.x), Math.round(safeCropRect.y), Math.round(safeCropRect.width), Math.round(safeCropRect.height));
							return processCanvas;
						}
					};

				} else { // This block handles both 'max-size' and 'none' (Default)
					let outputWidth, outputHeight;

					if (state.dynamicCropMode === 'max-size') {
						const maxWidth = Math.max(...state.panKeyframes.map(kf => kf.rect.width));
						const maxHeight = Math.max(...state.panKeyframes.map(kf => kf.rect.height));
						outputWidth = Math.round(maxWidth / 2) * 2;
						outputHeight = Math.round(maxHeight / 2) * 2;
					} else { // This is the 'none' or Default case
						outputWidth = Math.round(state.panRectSize.width / 2) * 2;
						outputHeight = Math.round(state.panRectSize.height / 2) * 2;
					}

					conversionOptions.video = {
						track: videoTrack,
						codec: 'avc',
						bitrate: QUALITY_HIGH,
						processedWidth: outputWidth,
						processedHeight: outputHeight,
						forceTranscode: true,
						process: (sample) => {
							const cropRect = getInterpolatedCropRect(sample.timestamp);
							if (!cropRect) return sample;
							const safeCropRect = clampRectToVideoBounds(cropRect);
							if (safeCropRect.width <= 0 || safeCropRect.height <= 0) return sample;
							if (!processCanvas) {
								processCanvas = new OffscreenCanvas(outputWidth, outputHeight);
								processCtx = processCanvas.getContext('2d', {
									alpha: false
								});
							}
							const videoFrame = sample._data || sample;

							if (state.dynamicCropMode === 'max-size' && state.useBlurBackground) {
								processCtx.drawImage(videoFrame, 0, 0, outputWidth, outputHeight);
								processCtx.filter = 'blur(15px)';
								processCtx.drawImage(processCanvas, 0, 0);
								processCtx.filter = 'none';
							} else {
								processCtx.fillStyle = 'black';
								processCtx.fillRect(0, 0, outputWidth, outputHeight);
							}

							let destX, destY, destWidth, destHeight;
							if (state.dynamicCropMode == 'none' || (state.dynamicCropMode === 'max-size' && state.scaleWithRatio)) {
								const sourceAspectRatio = safeCropRect.width / safeCropRect.height;
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
							} else {
								destWidth = safeCropRect.width;
								destHeight = safeCropRect.height;
								destX = (outputWidth - destWidth) / 2;
								destY = (outputHeight - destHeight) / 2;
							}
							processCtx.drawImage(videoFrame, Math.round(safeCropRect.x), Math.round(safeCropRect.y), Math.round(safeCropRect.width), Math.round(safeCropRect.height), destX, destY, destWidth, destHeight);
							return processCanvas;
						}
					};
				}
			} else if (state.cropRect && state.cropRect.width > 0) { // Static crop remains unchanged
				cropFuncToReset = toggleStaticCrop;
				const evenWidth = Math.round(state.cropRect.width / 2) * 2;
				const evenHeight = Math.round(state.cropRect.height / 2) * 2;
				conversionOptions.video = {
					crop: {
						left: Math.round(state.cropRect.x),
						top: Math.round(state.cropRect.y),
						width: evenWidth,
						height: evenHeight
					}
				};
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
			const clipName = `${originalName}_clip_${i + 1}.mp4`;
			const cutClipFile = new File([output.target.buffer], clipName, {
				type: 'video/mp4'
			});
			state.playlist.push({
				type: 'file',
				name: clipName,
				file: cutClipFile,
				isCutClip: true
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