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

    // Step 8: Process each clip sequentially
    let currentTimestamp = 0;
    let lastAudioTimestamp = 0; // Track global audio timestamp

    for (let clipIndex = 0; clipIndex < clipMetadata.length; clipIndex++) {
        const clip = clipMetadata[clipIndex];
        const clipStartTime = currentTimestamp;

        // Create video decoder for this clip
        const frames = [];
        let decoderReady = false;
        
        const decoder = new VideoDecoder({
            output: (frame) => {
                frames.push(frame);
            },
            error: (e) => {
                console.error('Video decoder error:', e);
            }
        });

        // Configure decoder
        decoder.configure(clip.videoConfig);
        decoderReady = true;

        // Decode all video packets
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

        // Wait for all frames to be decoded
        await decoder.flush();
        decoder.close();

        // Calculate expected number of frames for this clip's duration
        const expectedFrames = Math.ceil(clip.duration * outputFps);
        
        // If we have fewer frames than expected, we need to extend the last frame
        // If we have more, we'll use what we have (original fps might be higher)
        const framesToUse = frames.length > 0 ? frames.length : expectedFrames;

        // Now render all frames to canvas and add to output
        const frameDuration = 1 / outputFps;
        let frameTimestamp = 0;
        
        // Render decoded frames
        for (let i = 0; i < frames.length; i++) {
            const frame = frames[i];
            
            // Clear canvas
            ctx.clearRect(0, 0, outputWidth, outputHeight);
            
            // Calculate scaling to fit
            const scaleX = outputWidth / frame.displayWidth;
            const scaleY = outputHeight / frame.displayHeight;
            const scale = Math.min(scaleX, scaleY);
            
            const scaledWidth = frame.displayWidth * scale;
            const scaledHeight = frame.displayHeight * scale;
            const x = (outputWidth - scaledWidth) / 2;
            const y = (outputHeight - scaledHeight) / 2;

            // Draw frame to canvas
            ctx.drawImage(frame, x, y, scaledWidth, scaledHeight);

            // Add canvas frame to output with adjusted timestamp
            const newTimestamp = clipStartTime + frameTimestamp;
            await canvasSource.add(newTimestamp, frameDuration);

            // Close frame to free memory
            frame.close();

            // Update progress
            updateProgress(frameDuration);
            
            frameTimestamp += frameDuration;
        }
        
        // Fill remaining duration if we're short on frames (hold last frame)
        const expectedDuration = clip.duration;
        const actualDuration = frameTimestamp;
        
        if (actualDuration < expectedDuration && frames.length > 0) {
            // Hold the last frame for the remaining duration
            const remainingDuration = expectedDuration - actualDuration;
            const remainingFrames = Math.ceil(remainingDuration * outputFps);
            
            for (let i = 0; i < remainingFrames; i++) {
                const newTimestamp = clipStartTime + frameTimestamp;
                await canvasSource.add(newTimestamp, frameDuration);
                frameTimestamp += frameDuration;
                updateProgress(frameDuration);
            }
        }

        // Process audio (if exists)
        if (clip.audioTrack && audioSource) {
            const audioSink = new EncodedPacketSink(clip.audioTrack);
            let firstAudioPacket = clipIndex === 0;

            for await (const packet of audioSink.packets()) {
                // Adjust timestamp to continue from previous clip
                let newTimestamp = clipStartTime + packet.timestamp;
                
                // Ensure timestamps are strictly increasing (must be greater than last)
                if (newTimestamp <= lastAudioTimestamp) {
                    newTimestamp = lastAudioTimestamp + 0.001; // Add 1ms to avoid collision
                }
                
                const newPacket = packet.clone({ timestamp: newTimestamp });

                const metadata = firstAudioPacket 
                    ? { decoderConfig: clip.audioConfig } 
                    : undefined;

                await audioSource.add(newPacket, metadata);
                firstAudioPacket = false;
                lastAudioTimestamp = newTimestamp; // Update global tracker
            }
        }

        // Update current timestamp for next clip
        currentTimestamp += clip.duration;
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