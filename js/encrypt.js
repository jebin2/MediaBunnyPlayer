<script src="https://cdnjs.cloudflare.com/ajax/libs/seedrandom/3.0.5/seedrandom.min.js"></script>

async function getSeedFromPassword(password) {
    const encoder = new TextEncoder();
    const data = encoder.encode(password);
    const hashBuffer = await window.crypto.subtle.digest('SHA-256', data);
    
    // Convert the buffer to a hex string to act as a reliable string seed
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const seed = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    return seed;
}
async function exampleUsage() {
    console.log("Generating PRNG for 'testpass'...");
    
    // STEP 1 & 2: Get the string seed from the password
    const seed1 = await getSeedFromPassword("testpass");
    console.log("Seed from 'testpass':", seed1);

    // STEP 3: Initialize the PRNG with the seed (CORRECTED)
    // We MUST use 'new' to get a local PRNG instance.
    const prng1 = new Math.seedrandom(seed1);

    // Generate and print the first 3 numbers
    console.log("First 3 numbers for 'testpass':");
    console.log(prng1()); // This will now work correctly
    console.log(prng1());
    console.log(prng1());
    
    console.log("\n-----------------------------------\n");
    
    console.log("Generating PRNG for a DIFFERENT password 'anotherpass'...");
    const seed2 = await getSeedFromPassword("anotherpass");
    const prng2 = new Math.seedrandom(seed2);

    console.log("First 3 numbers for 'anotherpass':");
    console.log(prng2());
    console.log(prng2());
    console.log(prng2());

    console.log("\n-----------------------------------\n");
    
    console.log("Regenerating PRNG for 'testpass' to show it's deterministic...");
    const seed3 = await getSeedFromPassword("testpass");
    const prng3 = new Math.seedrandom(seed3);

    console.log("First 3 numbers for 'testpass' (second time):");
    console.log(prng3()); // This will match the first number from prng1
    console.log(prng3()); // This will match the second number from prng1
    console.log(prng3()); // This will match the third number from prng1
}

// Run the example
exampleUsage();

async function processVideoWithPassword(input, output, password) {
    // STEP 1 & 2: Get the numerical seed from the password
    const seed = await getSeedFromPassword(password);

    // STEP 3: Initialize the PRNG with the seed
    const prng = new Math.seedrandom(seed);

    const conversionOptions = {
        input,
        output,
        video: {
            // ... other video options
            forceTranscode: true,
            process: (sample) => {
                // This 'process' function is called for every single frame
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                canvas.width = sample.displayWidth;
                canvas.height = sample.displayHeight;

                // Draw the original (or noisy) frame to the canvas
                ctx.drawImage(sample, 0, 0);
                const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                const pixelData = imageData.data; // The array of RGBA values

                // STEP 4: Generate the noise mask for THIS frame
                // We pull a new sequence of random numbers for each frame.
                for (let i = 0; i < pixelData.length; i++) {
                    // We only apply noise to R, G, B channels, not Alpha
                    if ((i + 1) % 4 !== 0) {
                        // Generate a pseudo-random byte (0-255) from our seeded PRNG
                        const noiseByte = Math.floor(prng() * 256);
                        
                        // Apply the noise using XOR
                        pixelData[i] = pixelData[i] ^ noiseByte;
                    }
                }

                // Put the modified pixel data back
                ctx.putImageData(imageData, 0, 0);
                
                // Return the canvas, MediaBunny will encode this frame
                return canvas;
            }
        }
    };
}