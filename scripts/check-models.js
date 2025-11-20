const { GoogleGenerativeAI } = require("@google/generative-ai");

const apiKey = "AIzaSyCFultBc4tdqbu6P55pPiIFOTPTM1Tpa8s";
const genAI = new GoogleGenerativeAI(apiKey);

async function listModels() {
    try {
        console.log("Fetching available models...");
        // The SDK might not expose listModels directly on the instance in older versions, 
        // or it might be on a specific manager. 
        // According to documentation, it's usually via a ModelManager or similar, 
        // but for the JS SDK, sometimes we just try to generate content to test, 
        // OR we can try to use the REST API if the SDK doesn't support listing easily in this version.
        // However, let's try the standard way if it exists, or just a simple fetch if not.

        // Actually, the node SDK usually doesn't have a direct 'listModels' method on the top level class 
        // in some versions. Let's check if we can use the API directly via fetch if the SDK fails,
        // but let's try to see if we can just use a known working model like 'gemini-pro' as a fallback 
        // if we can't list them.

        // Wait, the user specifically asked to call ListModels.
        // Let's try to use the raw REST API for this to be sure, as it's dependency-free (mostly).

        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
        const data = await response.json();

        if (data.models) {
            console.log("Available Models:");
            data.models.forEach(m => {
                if (m.supportedGenerationMethods && m.supportedGenerationMethods.includes("generateContent")) {
                    console.log(`- ${m.name} (${m.displayName})`);
                }
            });
        } else {
            console.log("No models found or error:", data);
        }
    } catch (error) {
        console.error("Error listing models:", error);
    }
}

listModels();
