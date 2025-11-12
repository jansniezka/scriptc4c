const ASSISTANT_CONFIG = {
  SHORT: {
    id: process.env.ASSISTANT_ID_SHORT,
    name: "Skrócona wersja",
  },
  PRODUCT: {
    id: process.env.ASSISTANT_ID_PRODUCT,
    name: "Produktowa wersja",
  },
  DETAILED: {
    id: process.env.ASSISTANT_ID_DETAILED,
    name: "Szczegółowa wersja",
  },
};

const REQUIRED_ENV_VARS = [
  "OPENAI_API_KEY",
  "ASSISTANT_ID_SHORT",
  "ASSISTANT_ID_PRODUCT",
  "ASSISTANT_ID_DETAILED",
];

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ success: false, error: "Method Not Allowed" });
  }

  const missingRequired = REQUIRED_ENV_VARS.filter((key) => !process.env[key]);
  if (missingRequired.length > 0) {
    return res.status(500).json({
      success: false,
      error: `Brak wymaganych zmiennych środowiskowych: ${missingRequired.join(", ")}`,
    });
  }

  const body = normalizeRequestBody(req.body);
  const action = body?.action || "ask";

  try {
    if (action === "ask") {
      const response = await handleAsk(body);
      return res.status(response.status).json(response.payload);
    }

    if (action === "rate") {
      const response = await handleRate(body);
      return res.status(response.status).json(response.payload);
    }

    return res.status(400).json({ success: false, error: "Nieznana akcja" });
  } catch (error) {
    console.error("assistant-proxy error:", error);
    return res.status(500).json({
      success: false,
      error: "Wystąpił niespodziewany błąd serwera.",
      details: error?.message,
    });
  }
};

async function handleAsk(body) {
  const question = typeof body?.question === "string" ? body.question.trim() : "";
  const assistantKey = typeof body?.assistantKey === "string" ? body.assistantKey.trim().toUpperCase() : "";

  if (!question) {
    return buildResponse(400, { success: false, error: "Brak pytania." });
  }

  if (!assistantKey || !ASSISTANT_CONFIG[assistantKey]?.id) {
    return buildResponse(400, { success: false, error: "Nieprawidłowy identyfikator asystenta." });
  }

  const assistant = ASSISTANT_CONFIG[assistantKey];

  const answer = await runAssistant(assistant.id, question);

  await sendToSpreadsheet({
    question,
    answer,
    assistantName: assistant.name,
    assistantId: assistant.id,
    isRated: "false",
    updateExisting: "false",
  });

  return buildResponse(200, {
    success: true,
    answer,
    assistantKey,
    assistantName: assistant.name,
  });
}

async function handleRate(body) {
  const rating = body?.rating === "positive" ? "positive" : body?.rating === "negative" ? "negative" : null;
  const question = typeof body?.question === "string" ? body.question.trim() : "";
  const answer = typeof body?.answer === "string" ? body.answer.trim() : "";
  const assistantKey = typeof body?.assistantKey === "string" ? body.assistantKey.trim().toUpperCase() : "";

  if (!rating) {
    return buildResponse(400, { success: false, error: "Nieprawidłowy typ oceny." });
  }
  if (!question) {
    return buildResponse(400, { success: false, error: "Brak pytania do oceny." });
  }
  if (!answer) {
    return buildResponse(400, { success: false, error: "Brak odpowiedzi do oceny." });
  }
  if (!assistantKey || !ASSISTANT_CONFIG[assistantKey]?.id) {
    return buildResponse(400, { success: false, error: "Nieprawidłowy identyfikator asystenta." });
  }

  const assistant = ASSISTANT_CONFIG[assistantKey];

  await sendToSpreadsheet({
    question,
    answer,
    assistantName: assistant.name,
    assistantId: assistant.id,
    isRated: rating,
    updateExisting: "true",
  });

  return buildResponse(200, { success: true });
}

async function runAssistant(assistantId, question) {
  const apiKey = process.env.OPENAI_API_KEY;
  const baseHeaders = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
    "OpenAI-Beta": "assistants=v2",
  };

  const threadRes = await fetch("https://api.openai.com/v1/threads", {
    method: "POST",
    headers: baseHeaders,
    body: JSON.stringify({}),
  });

  if (!threadRes.ok) {
    throw new Error(`Nie można utworzyć wątku: ${await threadRes.text()}`);
  }

  const thread = await threadRes.json();

  const messageRes = await fetch(`https://api.openai.com/v1/threads/${thread.id}/messages`, {
    method: "POST",
    headers: baseHeaders,
    body: JSON.stringify({ role: "user", content: question }),
  });

  if (!messageRes.ok) {
    throw new Error(`Nie można wysłać wiadomości: ${await messageRes.text()}`);
  }

  const runRes = await fetch(`https://api.openai.com/v1/threads/${thread.id}/runs`, {
    method: "POST",
    headers: baseHeaders,
    body: JSON.stringify({ assistant_id: assistantId }),
  });

  if (!runRes.ok) {
    throw new Error(`Nie można uruchomić asystenta: ${await runRes.text()}`);
  }

  const run = await runRes.json();
  let status = run.status;

  while (["queued", "in_progress"].includes(status)) {
    await wait(2000);
    const statusRes = await fetch(`https://api.openai.com/v1/threads/${thread.id}/runs/${run.id}`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "OpenAI-Beta": "assistants=v2",
      },
    });

    if (!statusRes.ok) {
      throw new Error(`Nie można sprawdzić statusu uruchomienia: ${await statusRes.text()}`);
    }

    const statusJson = await statusRes.json();
    status = statusJson.status;
  }

  if (status !== "completed") {
    throw new Error(`Uruchomienie zakończyło się statusem: ${status}`);
  }

  const messagesRes = await fetch(`https://api.openai.com/v1/threads/${thread.id}/messages`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "OpenAI-Beta": "assistants=v2",
    },
  });

  if (!messagesRes.ok) {
    throw new Error(`Nie można pobrać wiadomości: ${await messagesRes.text()}`);
  }

  const messagesJson = await messagesRes.json();
  const reply = messagesJson.data.find((msg) => msg.role === "assistant");

  const rawText = reply?.content?.[0]?.text?.value || "Brak odpowiedzi.";
  return cleanAnswer(rawText);
}

function cleanAnswer(text) {
  return (text || "")
    .replace(/【[\d:†source]+】/g, "")
    .replace(/\r\n/g, "\n")
    .trim();
}

async function sendToSpreadsheet({ question, answer, assistantName, assistantId, isRated, updateExisting }) {
  if (!process.env.GOOGLE_WEBHOOK_URL || !process.env.GOOGLE_SHEET_ID) {
    return;
  }

  try {
    const url = new URL(process.env.GOOGLE_WEBHOOK_URL);
    url.searchParams.set("question", question);
    url.searchParams.set("answer", answer);
    url.searchParams.set("assistantName", assistantName);
    url.searchParams.set("assistantId", assistantId);
    url.searchParams.set("sheetId", process.env.GOOGLE_SHEET_ID);
    url.searchParams.set("sheetName", process.env.GOOGLE_SHEET_NAME || "Sheet1");
    url.searchParams.set("isRated", isRated);
    url.searchParams.set("updateExisting", updateExisting);
    url.searchParams.set("callback", "noop");

    const response = await fetch(url.toString());
    if (!response.ok) {
      const body = await response.text();
      console.warn("Google webhook warn:", body);
    }
  } catch (error) {
    console.warn("Google webhook error:", error);
  }
}

function buildResponse(status, payload) {
  return { status, payload };
}

function normalizeRequestBody(body) {
  if (!body) {
    return {};
  }

  if (typeof body === "string") {
    return safeJsonParse(body);
  }

  return body;
}

function safeJsonParse(value) {
  try {
    return value ? JSON.parse(value) : {};
  } catch (error) {
    return {};
  }
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}


