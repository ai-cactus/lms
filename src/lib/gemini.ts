// This is the Vertex AI Client configuration
// Using direct API calls because the official Node.js SDK @google-cloud/vertexai
// strictly requires Application Default Credentials (ADC) / Service Account files.
// Since we are providing a specific "Vertex API Key" string (starts with AQ...),
// we must use the REST API endpoint directly to authenticate successfully with this key.
// This IS using Vertex AI (aiplatform.googleapis.com).

interface GenerationResponse {
    response: {
        text: () => string;
    };
}

export const getGeminiModel = () => {
    // Utilizing the Vertex API Key provided
    const apiKey = process.env.GEMINI_API_KEY || process.env.GEMINI_API_SECRET;
    const modelId = "gemini-2.5-flash-lite";

    if (!apiKey) {
        throw new Error("API Key is missing. Please ensure GEMINI_API_KEY is set in .env.local");
    }

    return {
        generateContent: async (prompt: string): Promise<GenerationResponse> => {
            // Using the global AI Platform publisher endpoint as requested
            // curl "https://aiplatform.googleapis.com/v1/publishers/google/models/${modelId}:generateContent?key=${API_KEY}"
            const endpoint = `https://aiplatform.googleapis.com/v1/publishers/google/models/${modelId}:generateContent?key=${apiKey}`;

            console.log(`[Vertex AI Client] Connecting to: aiplatform.googleapis.com`);
            console.log(`[Vertex AI Client] Model: ${modelId}`);

            const response = await fetch(endpoint, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    contents: [{
                        role: "user",
                        parts: [{ text: prompt }]
                    }],
                    generationConfig: {
                        temperature: 0.2, // Low temperature for consistent analysis results
                        maxOutputTokens: 8192,
                    }
                })
            });

            if (!response.ok) {
                const errorBody = await response.text();
                // Throwing detailed error to help with permission debugging
                throw new Error(`Vertex AI API Error (${response.status}): ${errorBody}`);
            }

            const data = await response.json();

            // Extract text from standard Vertex AI response structure
            const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";

            return {
                response: {
                    text: () => text
                }
            };
        }
    };
};
