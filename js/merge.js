// ============================================================================
// VIDEO MERGE FUNCTIONALITY
// ============================================================================

import {
    Input,
    ALL_FORMATS,
    BlobSource,
    Output,
    BufferTarget,
    Mp4OutputFormat,
    CanvasSource,
    EncodedPacketSink,
    EncodedAudioPacketSource,
    QUALITY_HIGH,
} from 'https://cdn.jsdelivr.net/npm/mediabunny@1.24.0/+esm';

/**
 * Merges multiple video clips into a single video file
 * @param {Object} options - Merge options
 * @param {Array<File>} options.files - Array of video files to merge
 * @param {Function} options.onProgress - Progress callback (0-1)
 * @param {Object} options.outputSettings - Optional output settings
 * @returns {Promise<Blob>} - The merged MP4 blob
 */
export const mergeVideoClips = async (options) => {
    const { files, onProgress, outputSettings = {} } = options;

    if (!files || files.length === 0) {
        throw new Error("No files provided for merging");
    }

    if (files.length === 1) {
        // If only one file, just return it as a blob
        return files[0];
    }

    // Track progress
    let totalDuration = 0;
    let processedDuration = 0;

    const updateProgress = (addedDuration = 0) => {
        if (onProgress && totalDuration > 0) {
            processedDuration += addedDuration;
            const progress = Math.min(processedDuration / totalDuration, 0.99);
            onProgress(progress);
        }
    };

    // Step 1: Get metadata from all clips
    const clipMetadata = [];
    for (const file of files) {
        const input = new Input({
            source: new BlobSource(file),
            formats: ALL_FORMATS
        });

        const videoTrack = await input.getPrimaryVideoTrack();
        const audioTrack = await input.getPrimaryAudioTrack();

        if (!videoTrack) {
            throw new Error(`File ${file.name} has no video track`);
        }

        const duration = await videoTrack.computeDuration();
        const videoConfig = await videoTrack.getDecoderConfig();
        const audioConfig = audioTrack ? await audioTrack.getDecoderConfig() : null;

        totalDuration += duration;

        clipMetadata.push({
            file,
            input,
            videoTrack,
            audioTrack,
            duration,
            videoConfig,
            audioConfig,
            width: videoConfig.codedWidth || videoConfig.displayWidth,
            height: videoConfig.codedHeight || videoConfig.displayHeight
        });
    }

    // Step 2: Determine output dimensions (use first clip's dimensions)
    const firstClip = clipMetadata[0];
    const outputWidth = outputSettings.width || firstClip.width;
    const outputHeight = outputSettings.height || firstClip.height;
    const outputFps = outputSettings.fps || 30;

    // Step 3: Create canvas for rendering
    const canvas = document.createElement('canvas');
    canvas.width = outputWidth;
    canvas.height = outputHeight;
    const ctx = canvas.getContext('2d');

    // Step 4: Create output
    const output = new Output({
        target: new BufferTarget(),
        format: new Mp4OutputFormat({ fastStart: 'in-memory' })
    });

    // Step 5: Add video track using CanvasSource
    const canvasSource = new CanvasSource(canvas, {
        codec: 'avc',
        bitrate: outputSettings.bitrate || QUALITY_HIGH
    });
    output.addVideoTrack(canvasSource, { frameRate: outputFps });

    // Step 6: Add audio track (if any clip has audio)
    let audioSource = null;
    const hasAudio = clipMetadata.some(clip => clip.audioTrack);
    
    if (hasAudio) {
        // Use the first clip's audio codec
        const firstAudioClip = clipMetadata.find(clip => clip.audioTrack);
        audioSource = new EncodedAudioPacketSource(firstAudioClip.audioTrack.codec);
        output.addAudioTrack(audioSource);
    }

    // Step 7: Start output
    await output.start();

    // Step 8: Process each clip sequentially - VIDEO AND AUDIO TOGETHER
    let currentTimestamp = 0;

    for (let clipIndex = 0; clipIndex < clipMetadata.length; clipIndex++) {
        const clip = clipMetadata[clipIndex];
        const clipStartTime = currentTimestamp;
        
        console.log(`Processing clip ${clipIndex + 1}/${clipMetadata.length}, start time: ${clipStartTime.toFixed(3)}s, duration: ${clip.duration.toFixed(3)}s`);

        // Decode all video frames first
        const frames = [];
        
        const decoder = new VideoDecoder({
            output: (frame) => {
                frames.push(frame);
            },
            error: (e) => {
                console.error('Video decoder error:', e);
            }
        });

        decoder.configure(clip.videoConfig);

        const videoPacketSink = new EncodedPacketSink(clip.videoTrack);
        
        for await (const packet of videoPacketSink.packets()) {
            const chunk = new EncodedVideoChunk({
                type: packet.isKeyframe ? 'key' : 'delta',
                timestamp: packet.timestamp * 1_000_000,
                duration: packet.duration ? packet.duration * 1_000_000 : undefined,
                data: packet.data
            });
            decoder.decode(chunk);
        }

        await decoder.flush();
        decoder.close();

        console.log(`Decoded ${frames.length} frames for clip with duration ${clip.duration.toFixed(3)}s (expected ~${Math.ceil(clip.duration * outputFps)} frames at ${outputFps}fps)`);

        // Collect all audio packets for this clip
        const audioPackets = [];
        if (clip.audioTrack && audioSource) {
            const audioSink = new EncodedPacketSink(clip.audioTrack);
            for await (const packet of audioSink.packets()) {
                audioPackets.push(packet);
            }
        }

        // Now interleave video frames and audio packets by timestamp
        // IMPORTANT: Only add frames that fall within this clip's duration
        const frameDuration = 1 / outputFps;
        const clipEndTime = clipStartTime + clip.duration;
        let frameIndex = 0;
        let audioIndex = 0;
        let videoTime = clipStartTime;  // Track actual video time written
        let firstAudioPacket = clipIndex === 0;

        while (frameIndex < frames.length || audioIndex < audioPackets.length) {
            const nextFrameTime = clipStartTime + (frameIndex * frameDuration);
            const nextAudioTime = audioIndex < audioPackets.length 
                ? clipStartTime + audioPackets[audioIndex].timestamp 
                : Infinity;

            // Decide whether to add video or audio next
            if (frameIndex < frames.length && nextFrameTime < clipEndTime && nextFrameTime <= nextAudioTime) {
                // Add video frame (only if within clip duration)
                const frame = frames[frameIndex];
                
                ctx.clearRect(0, 0, outputWidth, outputHeight);
                
                const scaleX = outputWidth / frame.displayWidth;
                const scaleY = outputHeight / frame.displayHeight;
                const scale = Math.min(scaleX, scaleY);
                
                const scaledWidth = frame.displayWidth * scale;
                const scaledHeight = frame.displayHeight * scale;
                const x = (outputWidth - scaledWidth) / 2;
                const y = (outputHeight - scaledHeight) / 2;

                ctx.drawImage(frame, x, y, scaledWidth, scaledHeight);

                await canvasSource.add(nextFrameTime, frameDuration);

                frame.close();
                frameIndex++;
                videoTime = nextFrameTime + frameDuration;
                updateProgress(frameDuration);
                
                // Debug log every 30 frames
                if (frameIndex % 30 === 0) {
                    console.log(`Clip ${clipIndex}: Added frame ${frameIndex}, timestamp: ${nextFrameTime.toFixed(3)}s`);
                }
            } else if (audioIndex < audioPackets.length) {
                // Add audio packet
                const packet = audioPackets[audioIndex];
                const newTimestamp = clipStartTime + packet.timestamp;
                const newPacket = packet.clone({ timestamp: newTimestamp });

                const metadata = firstAudioPacket 
                    ? { decoderConfig: clip.audioConfig } 
                    : undefined;

                await audioSource.add(newPacket, metadata);
                firstAudioPacket = false;
                audioIndex++;
            } else {
                // Both exhausted or video exceeded clip duration
                break;
            }
        }
        
        // Close any remaining frames that weren't used
        for (let i = frameIndex; i < frames.length; i++) {
            frames[i].close();
        }

        // Fill remaining duration if needed (hold last frame)
        const expectedEndTime = clipStartTime + clip.duration;
        
        console.log(`Video time after frames: ${videoTime.toFixed(3)}s, Expected end: ${expectedEndTime.toFixed(3)}s`);
        
        if (videoTime < expectedEndTime && frames.length > 0) {
            let fillTimestamp = videoTime;
            while (fillTimestamp < expectedEndTime) {
                await canvasSource.add(fillTimestamp, frameDuration);
                fillTimestamp += frameDuration;
                updateProgress(frameDuration);
            }
            console.log(`Filled to ${fillTimestamp.toFixed(3)}s`);
        }

        // Update current timestamp for next clip
        currentTimestamp += clip.duration;
        console.log(`Clip ${clipIndex + 1} complete. Next clip will start at: ${currentTimestamp.toFixed(3)}s`);
    }

    // Step 9: Close sources
    canvasSource.close();
    if (audioSource) {
        audioSource.close();
    }

    // Step 10: Finalize output
    if (onProgress) onProgress(1.0);
    await output.finalize();

    // Step 11: Return merged blob
    return new Blob([output.target.buffer], { type: 'video/mp4' });
};

/**
 * Simple wrapper for merging files from the playlist
 * @param {Array<Object>} playlistItems - Array of playlist items with {file, name}
 * @param {Function} onProgress - Progress callback
 * @returns {Promise<File>} - Merged video file
 */
export const mergePlaylistItems = async (playlistItems, onProgress) => {
    const files = playlistItems.map(item => item.file);
    const mergedBlob = await mergeVideoClips({ files, onProgress });
    
    // Generate output filename
    const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
    const fileName = `merged_${timestamp}.mp4`;
    
    return new File([mergedBlob], fileName, { type: 'video/mp4' });
};