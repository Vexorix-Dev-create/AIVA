// /api/chat.js
// Vercel Serverless Function — menghubungkan AIVA ke Groq API.
// Wajib set environment variable GROQ_API_KEY di dashboard Vercel
// (Project Settings → Environment Variables) sebelum deploy.

// Pemetaan pilihan model di frontend AIVA ke model Groq yang sebenarnya.
// Groq tidak menghost GLM secara native, jadi "glm" dialihkan ke model
// Groq lain yang setara agar tetap berfungsi.
const MODEL_MAP = {
  groq: "qwen/qwen3-32b",       // label UI: "Qwen (Smart)"
  qwen: "openai/gpt-oss-20b",   // label UI: "Aiva"
  glm: "openai/gpt-oss-120b",   // label UI: "GLM (z.ai)" — fallback, GLM asli tidak tersedia di Groq
  gpt: "openai/gpt-oss-20b",    // label UI: "GPT-OSS 20B"
};

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ reply: "Server error: metode tidak diizinkan." });
    return;
  }

  if (!process.env.GROQ_API_KEY) {
    res.status(200).json({
      reply: "Server error: GROQ_API_KEY belum diatur di environment variable Vercel.",
    });
    return;
  }

  try {
    const { message, api, history, userName } = req.body || {};

    if (!message || typeof message !== "string" || !message.trim()) {
      res.status(200).json({ reply: "Server error: pesan kosong." });
      return;
    }

    const model = MODEL_MAP[api] || MODEL_MAP.groq;

    const systemPrompt =
      "Kamu adalah AIVA (Artificial Intelligence Virtual Assistant), asisten AI ramah, membantu, dan berbahasa Indonesia. " +
      "Jawab dengan jelas, ringkas, dan sopan." +
      (userName ? ` Nama pengguna yang kamu ajak bicara adalah ${userName}.` : "");

    // Ambil maksimal 20 pesan terakhir dari history agar payload tidak terlalu besar
    const historyMessages = Array.isArray(history)
      ? history.slice(-20).map((h) => ({
          role: h.role === "assistant" ? "assistant" : "user",
          content: String(h.content || ""),
        }))
      : [];

    const messages = [
      { role: "system", content: systemPrompt },
      ...historyMessages,
      { role: "user", content: message },
    ];

    const groqResp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.7,
        max_tokens: 2048,
      }),
    });

    if (!groqResp.ok) {
      const errText = await groqResp.text().catch(() => "");
      console.error("Groq API error:", groqResp.status, errText);
      res.status(200).json({
        reply: `Server error: Groq API mengembalikan status ${groqResp.status}.`,
      });
      return;
    }

    const data = await groqResp.json();
    const reply =
      data?.choices?.[0]?.message?.content?.trim() ||
      "Maaf, AIVA tidak bisa memberikan jawaban saat ini. Coba lagi ya.";

    res.status(200).json({ reply });
  } catch (err) {
    console.error("AIVA /api/chat error:", err);
    res.status(200).json({ reply: "Server error: terjadi kesalahan internal pada server." });
  }
};
