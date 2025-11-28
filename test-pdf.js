const fs = require('fs');

async function testPdfParse() {
    try {
        console.log("Attempting to require pdf-parse...");
        const pdf = require('pdf-parse');
        console.log("pdf-parse required successfully.");
        console.log("Type of pdf export:", typeof pdf);

        if (typeof pdf === 'function') {
            console.log("pdf-parse is a function.");
        } else {
            console.log("pdf-parse export keys:", Object.keys(pdf));
            if (pdf.default) {
                console.log("pdf.default exists and is type:", typeof pdf.default);
            }
        }

    } catch (e) {
        console.error("Error requiring pdf-parse:", e);
    }
}

testPdfParse();
