
const fs = require('fs');
const path = require('path');

async function testPdf() {
    try {
        // Dynamic import to match the ESM import in the TS file
        const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');

        console.log('pdfjsLib loaded:', Object.keys(pdfjsLib));

        // Create a dummy PDF buffer (this won't be a valid PDF, so it should fail parsing, but we want to see IF it runs)
        // Or better, try to read a real PDF if one exists.
        // I'll just check if the function is available.

        if (typeof pdfjsLib.getDocument === 'function') {
            console.log('getDocument is a function');
        } else {
            console.error('getDocument is NOT a function');
        }

    } catch (e) {
        console.error('Error:', e);
    }
}

testPdf();
