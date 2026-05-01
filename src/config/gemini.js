import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(import.meta.env.VITE_GEMINI_KEY);

export async function askGemini(prompt, history = []) {
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash-lite" });
    const chat = model.startChat({
      history: history.map(m => ({
        role: m.role,
        parts: [{ text: m.text }]
      })),
      generationConfig: { maxOutputTokens: 1000 }
    });
    const result = await chat.sendMessage(prompt);
    return result.response.text();
  } catch (err) {
    console.error("Gemini error:", err);
    return "Sorry, I couldn't process that. Try again!";
  }
}