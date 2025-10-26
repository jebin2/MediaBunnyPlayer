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
    Conversion,
} from 'https://cdn.jsdelivr.net/npm/mediabunny@1.24.2/+esm';

/**
 * Standardizes a single video clip to a consistent format in memory.
 */
const standardizeClip = async (file, standard) => {
    const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
    const output = new Output({
        target: new BufferTarget(),
        format: new Mp4OutputFormat()
    });

    const conversion = await Conversion.init({
        input,
        output,
        video: {
            codec: standard.videoCodec,
            frameRate: standard.fps,
        },
        audio: {
            codec: standard.audioCodec, // This will now be 'opus'
            sampleRate: standard.audioSampleRate,
        }
    });

    await conversion.execute();
    const standardizedBlob = new Blob([output.target.buffer], { type: 'video/mp4' });
    return new File([standardizedBlob], `standardized_${file.name}`, { type: 'video/mp4' });
};


export const mergeVideoClips = async (options) => {
    const { files, onProgress, outputSettings = {} } = options;

    console.log("--- Starting Merge Process ---");
    if (!files || files.length === 0) throw new Error("No files provided");

    // ====================================================================
    // STEP 1: STANDARDIZE ALL CLIPS
    // ====================================================================
    console.log("Step 1: Standardizing all clips to a common format...");
    const standardFormat = {
        fps: outputSettings.fps || 30,
        videoCodec: 'avc',
        audioCodec: 'opus', // FIX: Use Opus for broad encoder support
        audioSampleRate: 48000
    };

    const standardizedFiles = await Promise.all(
        files.map(file => standardizeClip(file, standardFormat))
    );
    console.log("All clips have been standardized.");

    // The rest of the logic now operates on these clean, standardized files.
    
    console.log("Step 2: Gathering metadata from standardized clips...");
    const clipMetadata = [];
    for (const file of standardizedFiles) {
        const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
        const videoTrack = await input.getPrimaryVideoTrack();
        const audioTrack = await input.getPrimaryAudioTrack(); // This should now exist
        if (!videoTrack) throw new Error(`Standardized file ${file.name} has no video track`);
        if (!audioTrack) console.warn(`Standardized file ${file.name} is missing an audio track after conversion.`);

        const duration = await videoTrack.computeDuration();
        const videoConfig = await videoTrack.getDecoderConfig();
        const audioConfig = audioTrack ? await audioTrack.getDecoderConfig() : null;

        clipMetadata.push({ duration, videoTrack, audioTrack, videoConfig, audioConfig });
    }

    const outputFps = standardFormat.fps;
    const firstClip = clipMetadata[0];
    const outputWidth = outputSettings.width || firstClip.videoConfig.codedWidth;
    const outputHeight = outputSettings.height || firstClip.videoConfig.codedHeight;

    const output = new Output({
        target: new BufferTarget(),
        format: new Mp4OutputFormat({ fastStart: 'in-memory' })
    });

    const canvas = document.createElement('canvas');
    canvas.width = outputWidth;
    canvas.height = outputHeight;
    const ctx = canvas.getContext('2d');

    const canvasSource = new CanvasSource(canvas, {
        codec: standardFormat.videoCodec,
        bitrate: outputSettings.bitrate || QUALITY_HIGH
    });
    output.addVideoTrack(canvasSource, { frameRate: outputFps });

    const audioSource = new EncodedAudioPacketSource(standardFormat.audioCodec); // Use 'opus'
    output.addAudioTrack(audioSource);

    await output.start();

    // --- Process Video Clips ---
    let currentVideoTimestamp = 0;
    for (const clip of clipMetadata) {
        const frames = [];
        // FIX: Add the required 'error' callback to the constructor
        const decoder = new VideoDecoder({
            output: (frame) => frames.push(frame),
            error: (e) => console.error("Video decoder error:", e)
        });
        decoder.configure(clip.videoConfig);

        const videoPacketSink = new EncodedPacketSink(clip.videoTrack);
        for await (const packet of videoPacketSink.packets()) {
            decoder.decode(new EncodedVideoChunk({
                type: packet.isKeyframe ? 'key' : 'delta',
                timestamp: packet.timestamp * 1_000_000,
                duration: packet.duration ? packet.duration * 1_000_000 : undefined,
                data: packet.data
            }));
        }
        await decoder.flush();
        decoder.close();

        const frameDuration = 1 / outputFps;
        for (let i = 0; i < frames.length; i++) {
            const newTimestamp = currentVideoTimestamp + (i * frameDuration);
            ctx.drawImage(frames[i], 0, 0, outputWidth, outputHeight);
            await canvasSource.add(newTimestamp, frameDuration);
            frames[i].close();
        }
        currentVideoTimestamp += clip.duration;
    }

    // --- Process Audio Clips ---
    let currentAudioTimestamp = 0;
    let isFirstPacketEver = true;
    for (const clip of clipMetadata) {
        if (!clip.audioTrack) continue; // Skip if audio was missing

        const audioSink = new EncodedPacketSink(clip.audioTrack);
        for await (const packet of audioSink.packets()) {
            const newTimestamp = currentAudioTimestamp + packet.timestamp;
            const newPacket = packet.clone({ timestamp: newTimestamp });
            const metadata = isFirstPacketEver ? { decoderConfig: clip.audioConfig } : undefined;
            await audioSource.add(newPacket, metadata);
            isFirstPacketEver = false;
        }
        currentAudioTimestamp += clip.duration;
    }

    // --- Finalize ---
    console.log("Finalizing merged output...");
    canvasSource.close();
    audioSource.close();
    if (onProgress) onProgress(1.0);
    await output.finalize();
    console.log("Merge complete!");
    return new Blob([output.target.buffer], { type: 'video/mp4' });
};