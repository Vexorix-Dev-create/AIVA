// /api/multi-chat.js
// Vercel Serverless Function — mode MultiMind AIVA, mengirim pesan yang sama
// ke beberapa model Groq sekaligus secara paralel.
// Wajib set environment variable GROQ_API_KEY di dashboard Vercel.

const MODEL_MAP = {
  groq: "qwen/qwen3-32b",
  qwen: "openai/gpt-oss-20b",
  glm: "openai/gpt-oss-120b",
  gpt: "openai/gpt-oss-20b",
};

async function askOneModel(apiKey, api, systemPrompt, historyMessages, message) {
  const model = MODEL_MAP[api] || MODEL_MAP.groq;
  try {
    const resp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          ...historyMessages,
          { role: "user", content: message },
        ],
        temperature: 0.7,
        max_tokens: 2048,
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => "");
      console.error(`Groq API error [${api}]:`, resp.status, errText);
      return `Gagal: server mengembalikan status ${resp.status}.`;
    }

    const data = await resp.json();
    return data?.choices?.[0]?.message?.content?.trim() || "Gagal: tidak ada respons.";
  } catch (err) {
    console.error(`AIVA /api/multi-chat error [${api}]:`, err);
    return "Gagal: terjadi kesalahan saat menghubungi model.";
  }
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Metode tidak diizinkan." });
    return;
  }

  if (!process.env.GROQ_API_KEY) {
    res.status(200).json({ error: "GROQ_API_KEY belum diatur di environment variable Vercel." });
    return;
  }

  try {
    const { message, models, history, userName } = req.body || {};

    if (!message || typeof message !== "string" || !message.trim()) {
      res.status(200).json({ error: "Pesan kosong." });
      return;
    }

    const selectedModels = Array.isArray(models) && models.length ? models : ["groq", "qwen", "glm", "gpt"];

    const systemPrompt =
      "Kamu adalah AIVA (Artificial Intelligence Virtual Assistant), asisten AI ramah, membantu, dan berbahasa Indonesia. " +
      "Jawab dengan jelas, ringkas, dan sopan." +
      (userName ? ` Nama pengguna yang kamu ajak bicara adalah ${userName}.` : "");

    const historyMessages = Array.isArray(history)
      ? history.slice(-12).map((h) => ({
          role: h.role === "assistant" ? "assistant" : "user",
          content: String(h.content || ""),
        }))
      : [];

    // Jalankan semua model secara paralel untuk kecepatan
    const results = await Promise.all(
      selectedModels.map((api) =>
        askOneModel(process.env.GROQ_API_KEY, api, systemPrompt, historyMessages, message)
      )
    );

    const replies = {};
    selectedModels.forEach((api, i) => {
      replies[api] = results[i];
    });

    res.status(200).json({ replies });
  } catch (err) {
    console.error("AIVA /api/multi-chat error:", err);
    res.status(200).json({ error: "Terjadi kesalahan internal pada server." });
  }
};
