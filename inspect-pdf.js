
const fs = require('fs');
const path = require('path');

// Mock DOMMatrix if needed (based on previous errors)
if (typeof DOMMatrix === 'undefined') {
    global.DOMMatrix = class DOMMatrix {
        constructor() { return this; }
        toString() { return ''; }
    };
}

try {
    const pdfParse = require('pdf-parse');
    console.log('Type of pdfParse:', typeof pdfParse);
    console.log('Keys of pdfParse:', Object.keys(pdfParse));

    // Try to see if it has a default export nested
    const parser = pdfParse.default || pdfParse;
    console.log('Using parser:', typeof parser);

    // Create a dummy PDF buffer (minimal valid PDF header/trailer if possible, or just random bytes might fail but throw specific error)
    // A minimal PDF is complex to construct manually.
    // Let's just try to instantiate if it's a class.

    if (typeof parser === 'function') {
        try {
            // Try calling as function
            console.log('Attempting function call with empty buffer...');
            const result = parser(Buffer.from(''));
            console.log('Function call result type:', typeof result);
            if (result && typeof result.then === 'function') {
                result.then(data => console.log('Promise resolved:', Object.keys(data || {})))
                    .catch(e => console.log('Promise rejected:', e.message));
            }
        } catch (e) {
            console.log('Function call error:', e.message);

            if (e.message.includes('Class constructor')) {
                console.log('Attempting new Class()...');
                try {
                    // Try instantiation of the module itself (if it was the class)
                    const instance = new parser(Buffer.from(''));
                    console.log('Instance created from module:', instance);
                } catch (e2) {
                    console.log('Instantiation error (module):', e2.message);
                }
            }
        }
    } else {
        // It's an object (as seen in logs).
        // Try accessing PDFParse property
        if (pdfParse.PDFParse) {
            console.log('Found PDFParse property. Type:', typeof pdfParse.PDFParse);
            try {
                const instance = new pdfParse.PDFParse(Buffer.from(''));
                console.log('new PDFParse(buffer) result:', instance);
            } catch (e) {
                console.log('new PDFParse(buffer) error:', e.message);
            }
        }

        // Try getDocument if it looks like pdfjs-dist?
        if (pdfParse.getDocument) {
            console.log('Found getDocument. Calling it...');
        }
    }

} catch (e) {
    console.error('Require error:', e);
}
