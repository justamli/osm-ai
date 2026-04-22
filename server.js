import express from 'express';
import cors from 'cors';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

// Update this to point to the local LM API
//const LLM_API_URL = 'http://192.168.105.136:1234/api/v1/chat';
const LLM_API_URL = 'http://127.0.0.1:1234/api/v1/chat';
const MODEL_NAME = 'gemma-4-e4b-it';

async function callLocalLLM(systemPrompt, userMessages) {
  const reqBody = {
    model: MODEL_NAME,
    system_prompt: systemPrompt,
    input: userMessages.map(m => `${m.role}: ${m.content}`).join('\n')
  };

  try {
    const response = await fetch(LLM_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(reqBody)
    });

    if (!response.ok) {
      throw new Error(`LM API Error: ${response.status}`);
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content ||
      data.output?.[0]?.content ||
      data.response || "No response found.";
  } catch (error) {
    console.error("Local LLM call failed:", error);
    throw error;
  }
}

// --- Stock Fetcher Feature ---
async function fetchStockData(keywords) {
  try {
    if (!keywords || keywords.length === 0) return { error: "No keywords to parse stock from" };

    // Resolve Ticker Using LLM
    const prompt = `What is the exact Google Finance ticker string (like AAPL:NASDAQ or JPM:NYSE) for the following keywords? Reply with ONLY the formal ticker string and NOTHING ELSE. If you cannot guess it, return "UNKNOWN".`;
    let ticker = await callLocalLLM(prompt, [{ role: "User", content: keywords.join(" ") }]);
    ticker = ticker.trim().toUpperCase();

    if (ticker === "UNKNOWN" || !ticker) {
      return { status: "error", message: "Could not resolve an exchange ticker for these keywords." };
    }

    // Native fetch from Google Finance
    const res = await fetch(`https://www.google.com/finance/quote/${ticker}`);
    const html = await res.text();

    // Regex extraction
    const priceMatch = html.match(/data-last-price="([^"]*)"/);
    const newsMatch = html.match(/class="Yfwt5">([^<]*)/);

    if (!priceMatch) {
      return { status: "error", tickerResolved: ticker, message: "Could not find price data on Google Finance for this ticker." };
    }

    return {
      status: "success",
      ticker: ticker,
      price: priceMatch[1],
      latestNews: newsMatch ? newsMatch[1] : "No recent news found."
    };
  } catch (error) {
    return { status: "error", message: error.message };
  }
}

// 1. Service Layer Data Fetching (Mocked Database/Internet lookups)
async function fetchServiceData(intent, keywords = []) {
  if (intent === 'stock') {
    return await fetchStockData(keywords);
  }
  if (intent === 'weather') {
    // Simulating grep from internet / real API call
    return {
      status: "success",
      location: "New York",
      temperature: "72°F",
      condition: "Sunny with light breeze",
      forecast: "Rain expected tomorrow"
    };
  }
  if (intent === 'restaurant') {
    return {
      status: "success",
      trending: "The Azure Lounge",
      rating: 4.8,
      cuisine: "Mediterranean"
    };
  }
  if (intent === 'greeting') {
    return {
      status: "success",
      accountInfo: "Guest User",
      lastLogin: "Today"
    };
  }
  if (intent === 'book') {
    return {
      status: "error",
      message: "No API provided"
    };
  }
  return {
    status: "info",
    message: "No specific context available."
  };
}

app.post('/api/chat', async (req, res) => {
  try {
    const { history, currentMessage } = req.body;

    console.log(history);
    console.log(currentMessage);
    // Layer 1: Master Layer - Intent Classification
    const masterPromptPath = path.join(__dirname, 'public', 'prompts', 'master.txt');
    let masterPrompt = await fs.readFile(masterPromptPath, 'utf8');

    // Supply the LLM with valid map options so it properly translates Chinese to exact English OpenRice names
    try {
      const mappingsPath = path.join(__dirname, 'public', 'config', 'openrice_mappings.json');
      const mappingsData = JSON.parse(await fs.readFile(mappingsPath, 'utf8'));
      const validDistricts = mappingsData.districts.map(d => d.name).join(", ");
      const validCuisines = mappingsData.cuisines.map(c => c.name).join(", ");
      
      masterPrompt += `\n\nCRITICAL: If the user specified a location or cuisine in Chinese (e.g., "大澳"), you MUST translate and match it to its official English name from the following valid lists. Do NOT invent your own phonetic translations (like "Daa Mau"):\nValid Locations: ${validDistricts}\nValid Cuisines: ${validCuisines}`;
    } catch (e) {
      console.warn("Could not load mappings for prompt injection:", e.message);
    }

    // Token Saving: Keep the last 10 messages so we don't lose location/cuisine context 
    const recentMasterHistory = (history || []).slice(-10);
    const masterMessages = [...recentMasterHistory, { role: "User", content: currentMessage }];
    let intentClassificationOutput = await callLocalLLM(masterPrompt, masterMessages);

    // Clean potential markdown blocks like ```json ... ```
    intentClassificationOutput = intentClassificationOutput.replace(/```json/g, '').replace(/```/g, '').trim();

    let masterJson;
    let detectedIntent = "default";
    try {
      masterJson = JSON.parse(intentClassificationOutput);
      detectedIntent = masterJson.intent.toLowerCase().trim().replace(/[^a-z0-9_]/g, '');
    } catch (e) {
      console.warn("Failed to parse Master Layer JSON, falling back to default.", intentClassificationOutput);
    }

    console.log(detectedIntent);

    // --- Off-Topic Penalty Logic ---
    let offTopicCount = 0;
    if (history && history.length > 0) {
      for (let i = history.length - 1; i >= 0; i--) {
        if (history[i].role === "User") {
          const histIntent = history[i].intent || 'default';
          if (histIntent !== 'restaurant') {
            offTopicCount++;
          } else {
            break;
          }
        }
      }
    }

    if (detectedIntent !== 'restaurant') {
      offTopicCount++;

      if (offTopicCount >= 3) {
        console.log(`[Penalty Activated] User off-topic for ${offTopicCount} consecutive turns. Routing to 'redirect'.`);
        detectedIntent = 'redirect';
      }
    }

    // Layer 2: Service Layer - Data Lookup
    const configPath = path.join(__dirname, 'public', 'config', 'intent_mapping.json');
    const configData = JSON.parse(await fs.readFile(configPath, 'utf8'));

    // Determine mapping, fallback to default if not found
    let mappedConfig = configData[detectedIntent];

    if (!mappedConfig) {
      detectedIntent = "default";
      mappedConfig = configData["default"];
    }

    // Fetch real service data (simulated database/internet lookup)
    const rawServiceData = await fetchServiceData(detectedIntent, masterJson?.keywords || []);
    let dynamicServiceData = typeof rawServiceData === 'object' ? JSON.stringify(rawServiceData, null, 2) : rawServiceData;

    // Map Location and Cuisine to OpenRice IDs
    let mappedDistrictId = null;
    let mappedCuisineId = null;
    
    if (masterJson && (masterJson.location || masterJson.cuisine)) {
      try {
        const mappingsPath = path.join(__dirname, 'public', 'config', 'openrice_mappings.json');
        const mappingsData = JSON.parse(await fs.readFile(mappingsPath, 'utf8'));
        const normalize = (s) => (s || "").toLowerCase().replace(/[^a-z0-9]/g, '');
        
        if (masterJson.location && masterJson.location !== "unknown") {
          const normLoc = normalize(masterJson.location);
          const match = mappingsData.districts.find(d => {
             const normName = normalize(d.name);
             return normName === normLoc || (normName.length > 3 && normLoc.includes(normName)) || (normLoc.length > 3 && normName.includes(normLoc));
          });
          if (match) mappedDistrictId = match.searchKey;
        }
        
        if (masterJson.cuisine && masterJson.cuisine !== "unknown") {
          const normCuis = normalize(masterJson.cuisine);
          const match = mappingsData.cuisines.find(c => {
             const normName = normalize(c.name);
             return normName === normCuis || (normName.length > 3 && normCuis.includes(normName)) || (normCuis.length > 3 && normName.includes(normCuis));
          });
          if (match) mappedCuisineId = match.searchKey;
        }
      } catch (e) {
        console.warn("Failed to map OpenRice IDs:", e.message);
      }
    }

    // Append master metadata to dynamic service data if available
    if (masterJson) {
      let extractedData = [];
      if (masterJson.keywords && masterJson.keywords.length > 0) extractedData.push(`Keywords: ${masterJson.keywords.join(", ")}`);
      if (masterJson.location) extractedData.push(`Location: ${masterJson.location}${mappedDistrictId ? ` (${mappedDistrictId})` : ''}`);
      if (masterJson.cuisine) extractedData.push(`Cuisine: ${masterJson.cuisine}${mappedCuisineId ? ` (${mappedCuisineId})` : ''}`);

      if (extractedData.length > 0) {
        dynamicServiceData += `\n\n[Extracted Data from User Status: ${extractedData.join(" | ")}]`;
      }
    }

    // Layer 3: Reply Creation Layer
    const systemPromptPath = path.join(__dirname, 'public', mappedConfig.system_prompt_file);
    let systemPrompt = await fs.readFile(systemPromptPath, 'utf8');

    // Inject the dynamically fetched service data into the prompt
    systemPrompt = systemPrompt + `\n\n[CONTEXT DATA INJECTED BY SERVICE LAYER: ${dynamicServiceData}]`;

    // Detect if this is a follow-up message (greeting already happened)
    const isFirstMessage = !history || history.length === 0;
    if (!isFirstMessage) {
      systemPrompt += `\n\n[CONVERSATION RULE: This is NOT the user's first message. Do NOT start with any greeting like "喂", "你好", "👋" or any welcoming phrase. Jump straight into your response naturally as a continuation of the conversation. Be concise and direct.]`;
    }

    // Token Saving: Keep a sliding window of the last 6 messages for the final reply
    const recentReplyHistory = (history || []).slice(-6);
    const messages = [...recentReplyHistory, { role: "User", content: currentMessage }];
    const finalReply = await callLocalLLM(systemPrompt, messages);

    res.json({
      reply: finalReply,
      debug: {
        layer1_masterOutput: intentClassificationOutput,
        layer1_intent: detectedIntent,
        layer2_serviceData: dynamicServiceData,
        layer2_keywords: masterJson?.keywords || [],
        layer3_promptFile: mappedConfig.system_prompt_file
      }
    });

  } catch (error) {
    console.error("Chat endpoint error:", error);
    res.status(500).json({ error: 'Internal server error while processing chat.' });
  }
});

// --- CRUD PROMPTS API ---

const configPath = path.join(__dirname, 'public', 'config', 'intent_mapping.json');
const promptsDir = path.join(__dirname, 'public', 'prompts');
const masterPromptPath = path.join(promptsDir, 'master.txt');

app.get('/api/prompts', async (req, res) => {
  try {
    const configData = JSON.parse(await fs.readFile(configPath, 'utf8'));
    const prompts = {};

    // Load all intents
    for (const intent of Object.keys(configData)) {
      const filePath = path.join(__dirname, 'public', configData[intent].system_prompt_file);
      try {
        const content = await fs.readFile(filePath, 'utf8');
        prompts[intent] = { content };
      } catch (e) {
        prompts[intent] = { content: "Error loading file." };
      }
    }

    // Load Master
    try {
      const masterContent = await fs.readFile(masterPromptPath, 'utf8');
      prompts["master"] = { content: masterContent, isSpecial: true };
    } catch (e) { }

    res.json(prompts);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/prompts', async (req, res) => {
  try {
    const { intent, content } = req.body;
    if (!intent || intent === 'master') return res.status(400).json({ error: "Invalid intent name" });

    // 1. Write the new text file
    const filePath = path.join(promptsDir, `${intent}.txt`);
    await fs.writeFile(filePath, content || "Default new prompt text.", 'utf8');

    // 2. Update JSON
    const configData = JSON.parse(await fs.readFile(configPath, 'utf8'));
    configData[intent] = {
      system_prompt_file: `prompts/${intent}.txt`,
      service_data: intent
    };
    await fs.writeFile(configPath, JSON.stringify(configData, null, 2), 'utf8');

    // 3. Auto-add to Master
    let masterContent = await fs.readFile(masterPromptPath, 'utf8');
    const newMasterLine = `- "${intent}": User is asking about ${intent}`;

    // We try to insert it before the Default line if it exists
    if (masterContent.includes('- "default":')) {
      masterContent = masterContent.replace('- "default":', `${newMasterLine}\n- "default":`);
    } else {
      masterContent += `\n${newMasterLine}`;
    }
    await fs.writeFile(masterPromptPath, masterContent, 'utf8');

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/prompts/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { content } = req.body;

    const filePath = id === 'master'
      ? masterPromptPath
      : path.join(promptsDir, `${id}.txt`);

    await fs.writeFile(filePath, content, 'utf8');
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/prompts/:id', async (req, res) => {
  try {
    const { id } = req.params;
    if (id === 'master' || id === 'default') return res.status(400).json({ error: "Cannot delete reserved intents" });

    // 1. Delete File
    const filePath = path.join(promptsDir, `${id}.txt`);
    try {
      await fs.unlink(filePath);
    } catch (e) { }

    // 2. Remove from JSON
    const configData = JSON.parse(await fs.readFile(configPath, 'utf8'));
    delete configData[id];
    await fs.writeFile(configPath, JSON.stringify(configData, null, 2), 'utf8');

    // 3. Auto-remove from Master
    let masterContent = await fs.readFile(masterPromptPath, 'utf8');
    // Using regex to remove the bullet point line for this intent
    const regex = new RegExp(`^-\\s*"${id}".*$\\n?`, 'gm');
    masterContent = masterContent.replace(regex, '');
    await fs.writeFile(masterPromptPath, masterContent, 'utf8');

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/prompts/restore-master', async (req, res) => {
  try {
    const defaultMaster = `You are an Intention Classification AI. 
Your ONLY job is to classify the user's intent into one of the following categories:
- "greeting": The user is saying hello, asking how you are, etc.
- "restaurant": The user is asking about food, restaurants, recommendations, cuisines etc.
- "weather": The user is asking about weather forecasting, temperature etc.
- "default": The user is asking about anything else.

You MUST reply with a VALID JSON object and absolutely NOTHING else. Do not use Markdown formatting or code blocks. The JSON must exactly match this structure:
{
  "intent": "<category>",
  "confidence": <0-100>,
  "keywords": ["<key>", "<words>"]
}`;

    await fs.writeFile(masterPromptPath, defaultMaster, 'utf8');
    res.json({ success: true, content: defaultMaster });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Backend Service Layer listening on port ${PORT} (accessible from other machines)`);
});
