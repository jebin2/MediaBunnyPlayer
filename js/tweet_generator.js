// FILE: js/tweet_generator.js

import {
    Input,
    ALL_FORMATS,
    BlobSource,
    Output,
    BufferTarget,
    Mp4OutputFormat,
    CanvasSource,
    EncodedPacketSink, // Use this to READ encoded packets
    EncodedAudioPacketSource, // Use this to WRITE encoded audio packets
    QUALITY_HIGH,
} from 'https://cdn.jsdelivr.net/npm/mediabunny@1.25.0/+esm';

import {
    $,
    SocialMediaPostOpenbtn,
    SocialMediaPostModal
} from './constants.js';

import { showInfo, showError } from './ui.js';

export const setupTweetGenerator = () => {
    
    $('SocialMediaPostModalCloseBtn').onclick = () => {
        $('SocialMediaPostModal').classList.add('hidden');
    }
    SocialMediaPostOpenbtn.onclick = (e) => {
        e.stopPropagation();
        SocialMediaPostModal.classList.remove('hidden');
    };
    document.getElementById('SocialMediaPostScreenShotBtn').addEventListener('click', () => {
        captureScaledScreenshot('#twitter-widget-0');
    });
};

export const captureElementScreenshot = async (elementSelector) => {
    const element = document.querySelector(elementSelector);
    if (!element) {
        showError(`Screenshot failed: Element "${elementSelector}" not found.`);
        return;
    }

    const rect = element.getBoundingClientRect();
    const cropArea = {
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height,
    };

    if (cropArea.width < 1 || cropArea.height < 1) {
        showError("Screenshot failed: The element has no size. Is it visible?");
        return;
    }

    showInfo("Please select the screen or tab containing the tweet.");

    try {
        // Step 1: Request the screen share stream. We start simple.
        const stream = await navigator.mediaDevices.getDisplayMedia({
            video: { cursor: "omit" },
            audio: false,
            // These settings prevent the browser from automatically lowering the resolution
            // or frame rate for performance. We want one perfect frame.
            video: {
                // @ts-ignore
                // This is a newer, powerful constraint. It tells the browser NOT to scale the video source.
                // We want the raw pixels from the screen.
                
                displaySurface: "browser",   // ensures crisp text
                logicalSurface: false,       // force physical pixels
                resizeMode: "none",
                width: { ideal: 99999 },     // tells Chrome “give max resolution”
                height: { ideal: 99999 }
            },
            // Hint that we prefer crispness over a high frame rate.
            preferCurrentTab: true,
            selfBrowserSurface: "include",
        });

        const track = stream.getVideoTracks()[0];

        // --- KEY QUALITY IMPROVEMENT ---
        // After getting the track, we can check its settings and apply even more constraints
        // to ensure we have the highest possible resolution from the user's display.
        const settings = track.getSettings();
        console.log(`[Screenshot] Initial stream resolution: ${settings.width}x${settings.height}`);
        console.log(`[Screenshot] System Device Pixel Ratio: ${window.devicePixelRatio}`);
        
        // This ensures our final capture matches the screen's native resolution.
        await track.applyConstraints({
            width: settings.width,
            height: settings.height
        });

        // Step 2: Use ImageCapture for a high-fidelity frame grab.
        const imageCapture = new ImageCapture(track);
        const bitmap = await imageCapture.grabFrame();

        // Step 3: Stop the stream immediately.
        track.stop();

        // Step 4: Prepare the canvas for a high-quality crop.
        const canvas = document.createElement('canvas');
        
        // The Device Pixel Ratio is CRUCIAL. getBoundingClientRect gives us CSS pixels,
        // but the screen capture (bitmap) is in physical pixels. We must account for this.
        const dpr = window.devicePixelRatio || 1;
        canvas.width = cropArea.width * dpr;
        canvas.height = cropArea.height * dpr;
        
        const ctx = canvas.getContext('2d', { alpha: false });
        if (!ctx) {
             showError("Could not create canvas context.");
             return;
        }

        // --- ANOTHER KEY QUALITY IMPROVEMENT ---
        // Disable image smoothing. When drawing the captured image onto our smaller canvas,
        // the browser might try to "smooth" or anti-alias it, which causes blur. We want sharp, raw pixels.
        ctx.imageSmoothingEnabled = false;

        // Step 5: Draw the cropped region from the full-resolution bitmap to our canvas.
        ctx.drawImage(
            bitmap,
            cropArea.x * dpr,       // Source X (physical pixels from top-left of screen)
            cropArea.y * dpr,       // Source Y
            cropArea.width * dpr,   // Source Width
            cropArea.height * dpr,  // Source Height
            0,                      // Destination X (on our new canvas)
            0,                      // Destination Y
            canvas.width,           // Destination Width
            canvas.height           // Destination Height
        );


        // Step 6: Convert to blob for better performance and download.
        canvas.toBlob((blob) => {
            if (!blob) {
                showError("Failed to create image blob.");
                return;
            }
            const dataUrl = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = dataUrl;
            const timestamp = new Date().toLocaleString().replace(/[/:]/g, '-');
            link.download = `tweet-screenshot-${timestamp}.png`;
            link.click();

            // Clean up the object URL after a short delay
            setTimeout(() => URL.revokeObjectURL(dataUrl), 100);

            showInfo("Screenshot saved!");
        }, 'image/png'); // Specify PNG format, which is lossless.

    } catch (err) {
        console.error("Screenshot error:", err);
        showError("Screenshot was cancelled or an error occurred.");
    }
};

/**
 * The definitive client-side screenshot function. It intelligently calculates the
 * maximum scale factor and uses a robust CSS transform to perfectly center
 * the element before capturing.
 * @param {string} elementSelector The CSS selector for the element (iframe) to capture.
 */
async function captureScaledScreenshot(elementSelector) {
    const element = document.querySelector(elementSelector);
    if (!element) {
        showError(`Screenshot failed: Element "${elementSelector}" not found.`);
        return;
    }

    // --- INTELLIGENT SCALING CALCULATION (Unchanged) ---
    const originalRect = element.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const maxScaleX = viewportWidth / originalRect.width;
    const maxScaleY = viewportHeight / originalRect.height;
    const scaleFactor = Math.min(maxScaleX, maxScaleY) * 0.95;
    const finalScaleFactor = Math.max(1, scaleFactor);

    // --- PREPARATION AND UI STAGING ---
    const originalParent = element.parentElement;
    const overlay = document.createElement('div');
    overlay.style.cssText = `
        position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
        background-color: rgba(255, 255, 255, 0.9); z-index: 9999;
    `; // Note: display:flex has been removed as it's no longer needed.

    // Store ALL original styles that we will be changing to ensure a perfect restoration.
    const originalStyles = {
        position: element.style.position,
        top: element.style.top,
        left: element.style.left,
        transform: element.style.transform,
        transformOrigin: element.style.transformOrigin,
    };

    // --- THE CRITICAL CENTERING FIX ---
    // This is the robust way to center an element of any size.
    element.style.position = 'absolute';
    element.style.top = '50%';
    element.style.left = '50%';
    // First, translate it back by half its size, THEN scale it.
    element.style.transform = `translate(-50%, -50%) scale(${finalScaleFactor})`;
    
    document.body.appendChild(overlay);
    overlay.appendChild(element); // Append element to overlay AFTER setting styles

    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));

    const rect = element.getBoundingClientRect();
    const cropArea = {
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height,
    };

    try {
        showInfo("Please select this browser tab to capture the screenshot.");

        const stream = await navigator.mediaDevices.getDisplayMedia({
            video: { cursor: "omit", resizeMode: "none" },
            audio: false,
            preferCurrentTab: true,
        });

        const track = stream.getVideoTracks()[0];
        const imageCapture = new ImageCapture(track);
        const bitmap = await imageCapture.grabFrame();
        track.stop();

        // --- PROCESSING AND DOWNLOAD (Unchanged) ---
        const canvas = document.createElement('canvas');
        const dpr = window.devicePixelRatio || 1;
        canvas.width = cropArea.width * dpr;
        canvas.height = cropArea.height * dpr;
        const ctx = canvas.getContext('2d', { alpha: false });
        ctx.imageSmoothingEnabled = false;

        ctx.drawImage(
            bitmap,
            cropArea.x * dpr, cropArea.y * dpr,
            cropArea.width * dpr, cropArea.height * dpr,
            0, 0, canvas.width, canvas.height
        );

        canvas.toBlob((blob) => {
            if (blob) {
                const dataUrl = URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.href = dataUrl;
                link.download = `tweet-screenshot-${Date.now()}@${finalScaleFactor.toFixed(2)}x.png`;
                link.click();
                setTimeout(() => URL.revokeObjectURL(dataUrl), 100);
                showInfo("Screenshot saved!");
            } else {
                showError("Failed to create image blob.");
            }
        }, 'image/png');

    } catch (err) {
        console.error("Screenshot error:", err);
        showError("Screenshot was cancelled or an error occurred.");
    } finally {
        // --- GUARANTEED CLEANUP ---
        // Restore all original styles for a seamless experience.
        element.style.position = originalStyles.position;
        element.style.top = originalStyles.top;
        element.style.left = originalStyles.left;
        element.style.transform = originalStyles.transform;
        element.style.transformOrigin = originalStyles.transformOrigin;

        originalParent.appendChild(element);
        document.body.removeChild(overlay);
    }
}