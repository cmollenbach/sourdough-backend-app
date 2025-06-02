const express = require('express');
const router = express.Router();
const { GoogleGenAI } = require('@google/genai');

const apiKey = process.env.GEMINI_API_KEY;

router.get('/explain', async (req, res) => {
  const term = req.query.term;
  if (!term) return res.status(400).json({ error: 'Missing term' });

  if (!apiKey) {
    return res.status(500).json({ error: 'Gemini API key not configured.' });
  }

  const ai = new GoogleGenAI({ apiKey });

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.0-flash", // or "gemini-1.5-flash" if that's what you have access to
      contents: `Explain the following baking concept for a sourdough baker: ${term.replace(/_/g, ' ')}`
    });
    res.json({ explanation: response.text });
  } catch (err) {
    console.error("Gemini API error:", err);
    res.status(500).json({ error: 'Failed to get explanation from Gemini.' });
  }
});

router.post('/generate', async (req, res) => {
  const { prompt } = req.body;
  if (!prompt) return res.status(400).json({ error: 'Missing prompt' });

  if (!apiKey) {
    return res.status(500).json({ error: 'Gemini API key not configured.' });
  }

  const ai = new GoogleGenAI({ apiKey });

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.0-flash",
      contents: prompt
    });
    // Adjust response extraction as needed for Gemini SDK
    res.json({ result: response.text || response.candidates?.[0]?.content?.parts?.[0]?.text || "No response." });
  } catch (err) {
    console.error("Gemini API error:", err);
    res.status(500).json({ error: 'Failed to get response from Gemini.' });
  }
});

module.exports = router;