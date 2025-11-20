import { GoogleGenerativeAI } from "@google/generative-ai";

export const getGeminiModel = () => {
    const key = process.env.GEMINI_API_KEY;
    if (!key) {
        throw new Error("No Gemini API Key provided");
    }
    const genAI = new GoogleGenerativeAI(key);
    return genAI.getGenerativeModel({ model: "gemini-2.0-flash-001" });
};
