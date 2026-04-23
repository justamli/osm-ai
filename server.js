import express from 'express';
import cors from 'cors';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import multer from 'multer';
import csvParser from 'csv-parser';
import { Readable } from 'stream';
import { queryAll, queryGet, queryRun } from './database.js';

const __filename = fileURLToPath(import.meta.url);
const upload = multer({ storage: multer.memoryStorage() });
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

// Update this to point to the local LM API
const LLM_API_URL = 'http://192.168.105.136:1234/api/v1/chat';
//const LLM_API_URL = 'http://127.0.0.1:1234/api/v1/chat';
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

// --- Weather Fetcher Feature (HKO Open Data API) ---
async function fetchWeatherData(location) {
  try {
    if (!location || location.toLowerCase() === 'unknown' || location.toLowerCase() === 'null') {
      return {
        status: "missing_information",
        location: null,
        message: "No specific location provided by user."
      };
    }

    const url = `https://data.weather.gov.hk/weatherAPI/opendata/weather.php?dataType=rhrread&lang=en`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`HKO API returned ${res.status}`);
    }

    const data = await res.json();

    // Normalize user location for matching
    const normLoc = location.toLowerCase();

    // Helper to find the matching place in an HKO data array
    const findPlaceData = (arr) => {
      if (!arr || !Array.isArray(arr)) return null;
      // Try exact or partial match for the user's intent location
      let match = arr.find(d => d.place && d.place.toLowerCase().includes(normLoc));
      if (!match) {
        // Fallback to HK Observatory or default if district match fails
        match = arr.find(d => d.place && d.place.toLowerCase().includes('hong kong observatory')) || arr[0];
      }
      return match;
    };

    const tempMatch = findPlaceData(data.temperature?.data);
    const humMatch = findPlaceData(data.humidity?.data);
    const rainMatch = findPlaceData(data.rainfall?.data);

    // Prepare the special tips / warnings if any
    const warnings = Array.isArray(data.warningMessage) ? data.warningMessage.join(" ") : (data.warningMessage || "");
    const specialTips = Array.isArray(data.specialWxTips) ? data.specialWxTips.join(" ") : (data.specialWxTips || "");

    let condition = [];
    if (warnings) condition.push(`Warning: ${warnings}`);
    if (specialTips) condition.push(`Tips: ${specialTips}`);
    if (condition.length === 0) condition.push("General condition: Normal");

    return {
      status: "success",
      source: "HKO Open Data API",
      queried_location: location,
      matched_station: tempMatch ? tempMatch.place : "Unknown",
      temperature: tempMatch ? `${tempMatch.value}°${tempMatch.unit}` : "N/A",
      humidity: humMatch ? `${humMatch.value}%` : "N/A",
      rainfall_max_past_hour: rainMatch && rainMatch.max !== undefined ? `${rainMatch.max} mm` : "N/A",
      alerts_and_tips: condition.join(" | ")
    };
  } catch (error) {
    return { status: "error", message: error.message };
  }
}

// --- Restaurant Search Feature (SQLite Database) ---
async function fetchRestaurantData(masterJson = {}) {
  try {
    const location = masterJson.location;
    const cuisine = masterJson.cuisine;

    let sql = 'SELECT * FROM restaurants WHERE 1=1';
    const params = [];

    const isValid = (val) => val && !['unknown', 'null', ''].includes(String(val).toLowerCase().trim());

    if (isValid(location)) {
      sql += ' AND region LIKE ?';
      params.push(`%${location}%`);
    }

    if (isValid(cuisine)) {
      sql += ' AND tag LIKE ?';
      params.push(`%${cuisine}%`);
    }

    sql += ' ORDER BY rating DESC LIMIT 5';

    const results = await queryAll(sql, params);

    const dbEnToZhRegion = {
      "Central": "中環", "Tsim Sha Tsui": "尖沙咀", "Causeway Bay": "銅鑼灣",
      "Mong Kok": "旺角", "Sham Shui Po": "深水埗", "Kowloon City": "九龍城",
      "Yuen Long": "元朗", "Tsuen Wan": "荃灣", "Sha Tin": "沙田",
      "Wan Chai": "灣仔", "Sai Wan": "西環", "Sheung Wan": "上環",
      "Tai Po": "大埔", "Kwun Tong": "觀塘", "North Point": "北角",
      "Tuen Mun": "屯門", "Tseung Kwan O": "將軍澳", "Sai Kung": "西貢",
      "Stanley": "赤柱", "Tin Shui Wai": "天水圍"
    };

    const formatRestaurants = (restaurants) => {
      return restaurants.map(r => ({
        ...r,
        region: dbEnToZhRegion[r.region] || r.region,
        tag: r.tag.replace("Japanese", "日本菜").replace("Thai", "泰國菜").replace("Dessert", "甜品").replace("Dim Sum", "點心") 
      }));
    };

    if (results.length === 0) {
      // Fallback: return top-rated restaurants across all regions
      const fallback = await queryAll('SELECT * FROM restaurants ORDER BY rating DESC LIMIT 5');
      return {
        status: "no_match",
        searched_location: location || null,
        searched_cuisine: cuisine || null,
        message: "No restaurants matched the specific filters. Here are some top-rated alternatives.",
        restaurants: formatRestaurants(fallback)
      };
    }

    return {
      status: "success",
      searched_location: location || null,
      searched_cuisine: cuisine || null,
      result_count: results.length,
      restaurants: formatRestaurants(results)
    };
  } catch (error) {
    console.error("Restaurant search failed:", error);
    return { status: "error", message: error.message };
  }
}

// 1. Service Layer Data Fetching (Mocked Database/Internet lookups)
async function fetchServiceData(intent, masterJson = {}) {
  const keywords = masterJson.keywords || [];
  if (intent === 'stock') {
    return await fetchStockData(keywords);
  }
  if (intent === 'ailaweather') {
    return await fetchWeatherData(masterJson.location);
  }
  if (intent === 'ailasearch') {
    return await fetchRestaurantData(masterJson);
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

    // Supply the LLM with valid map options so it properly translates Chinese to exact English names
    try {
      const regionsList = await queryAll('SELECT DISTINCT region FROM restaurants WHERE region IS NOT NULL AND region != ""');
      const tagsList = await queryAll('SELECT DISTINCT tag FROM restaurants WHERE tag IS NOT NULL AND tag != ""');
      
      const validDistricts = regionsList.map(r => r.region).join(", ");
      const validCuisines = tagsList.map(t => t.tag).join(", ");

      masterPrompt += `\n\nCRITICAL: If the user specified a location or cuisine in Chinese (e.g., "大澳"), you MUST translate and match it to its official English name from the following valid lists:\nValid Locations: ${validDistricts}\nValid Cuisines: ${validCuisines}`;
    } catch (e) {
      console.warn("Could not load DB mappings for prompt injection:", e.message);
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
          if (histIntent !== 'ailasearch') {
            offTopicCount++;
          } else {
            break;
          }
        }
      }
    }

    if (detectedIntent !== 'ailasearch') {
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
    const rawServiceData = await fetchServiceData(detectedIntent, masterJson || {});
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

      const locStr = String(masterJson.location || "").toLowerCase();
      if (masterJson.location && locStr !== "unknown" && locStr !== "null") {
        extractedData.push(`Location: ${masterJson.location}${mappedDistrictId ? ` (${mappedDistrictId})` : ''}`);
      } else {
        extractedData.push(`Location: null`);
      }

      const cuisStr = String(masterJson.cuisine || "").toLowerCase();
      if (masterJson.cuisine && cuisStr !== "unknown" && cuisStr !== "null") {
        extractedData.push(`Cuisine: ${masterJson.cuisine}${mappedCuisineId ? ` (${mappedCuisineId})` : ''}`);
      } else {
        extractedData.push(`Cuisine: null`);
      }

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

// --- RESTAURANT DATASTORE API ---

app.get('/api/restaurants', async (req, res) => {
  try {
    const restaurants = await queryAll('SELECT * FROM restaurants ORDER BY id DESC');
    res.json(restaurants);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/restaurants/:id', async (req, res) => {
  try {
    const r = await queryGet('SELECT * FROM restaurants WHERE id = ?', [req.params.id]);
    if (r) res.json(r);
    else res.status(404).json({ error: 'Not found' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/restaurants', async (req, res) => {
  try {
    const { region, rating, tag, name, phone_number, address, description, booking_available, queuing_available, phone_order_available } = req.body;
    const result = await queryRun(
      `INSERT INTO restaurants (region, rating, tag, name, phone_number, address, description, booking_available, queuing_available, phone_order_available) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [region, rating, tag, name, phone_number, address, description, booking_available, queuing_available, phone_order_available]
    );
    res.status(201).json({ id: result.lastID });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/restaurants/:id', async (req, res) => {
  try {
    const { region, rating, tag, name, phone_number, address, description, booking_available, queuing_available, phone_order_available } = req.body;
    const result = await queryRun(
      `UPDATE restaurants SET region=?, rating=?, tag=?, name=?, phone_number=?, address=?, description=?, booking_available=?, queuing_available=?, phone_order_available=? WHERE id=?`,
      [region, rating, tag, name, phone_number, address, description, booking_available, queuing_available, phone_order_available, req.params.id]
    );
    if (result.changes > 0) res.json({ success: true });
    else res.status(404).json({ error: 'Not found' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/restaurants/:id', async (req, res) => {
  try {
    const result = await queryRun('DELETE FROM restaurants WHERE id = ?', [req.params.id]);
    if (result.changes > 0) res.json({ success: true });
    else res.status(404).json({ error: 'Not found' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/restaurants/import', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const results = [];
  const stream = Readable.from(req.file.buffer.toString());

  stream.pipe(csvParser())
    .on('data', (data) => results.push(data))
    .on('end', async () => {
      try {
        // Collect all unique labels for translation
        const regionsToTranslate = results.map(r => r.地區 || r.region || r.REGION).filter(Boolean);
        const tagsToTranslate = results.map(r => r.Tag || r.tag || r.TAG).filter(Boolean);

        const translations = await bulkTranslate([...regionsToTranslate, ...tagsToTranslate]);

        let inserted = 0;
        const isTrue = (val) => val && (val.toUpperCase() === 'X' || val === 'true' || val === '1' || val === 'checked');

        for (const row of results) {
          try {
            const rawName = row.餐廳名稱 || row.name || row.Name || row.NAME;
            if (!rawName) continue;

            const rawRegion = row.地區 || row.region || row.REGION || null;
            const rawTag = row.Tag || row.tag || row.TAG || null;

            const translatedRegion = translations[rawRegion] || rawRegion;
            const translatedTag = translations[rawTag] || rawTag;

            await queryRun(
              `INSERT INTO restaurants (region, rating, tag, name, phone_number, address, description, booking_available, queuing_available, phone_order_available) 
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                translatedRegion,
                parseFloat(row.Google評分 || row.rating || row.RATING || '0'),
                translatedTag,
                rawName,
                row.phone_number || row['PHONE NUMBER'] || null,
                row.address || row.ADDRESS || null,
                row.點解推介呢間餐廳 || row.description || row.DESCRIPTION || null,
                isTrue(row.訂座 || row.booking_available || row.BOOKING_AVAILABLE),
                isTrue(row.排隊 || row.queuing_available || row.QUENING_AVAILABLE),
                isTrue(row.外賣 || row.phone_order_available || row.PHONE_ORDER_AVALIABLE)
              ]
            );
            inserted++;
          } catch (e) {
            console.error("Error inserting CSV row", e.message, row);
          }
        }
        res.json({ success: true, count: inserted });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    })
    .on('error', (error) => {
      res.status(500).json({ error: error.message });
    });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Backend Service Layer listening on port ${PORT} (accessible from other machines)`);
});
