require('dotenv').config();
const { GoogleGenAI } = require("@google/genai");

const apiKey = process.env.GEMINI_API_KEY;

async function main() {
  if (!apiKey) {
    console.error("No GEMINI_API_KEY found in environment!");
    process.exit(1);
  }

  const ai = new GoogleGenAI({ apiKey });

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.0-flash", // or "gemini-1.5-flash" if that's what you have access to
      contents: "Say hello from Gemini!",
    });
    console.log("Gemini API response:", response.text);
  } catch (err) {
    console.error("Gemini API error:", err);
  }
}

main();