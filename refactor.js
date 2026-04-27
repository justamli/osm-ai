const fs = require('fs');

let code = fs.readFileSync('server.js', 'utf8');

// Find start and end of app.post('/api/chat', ...)
const startIndex = code.indexOf("app.post('/api/chat', async (req, res) => {");
if (startIndex === -1) {
  console.log("Could not find app.post('/api/chat'");
  process.exit(1);
}

// Find the corresponding closing "});"
// We know it ends after res.status(500).json(...)
const endStr = "  }\n});";
let endIndex = code.indexOf(endStr, startIndex);
if (endIndex === -1) {
  console.log("Could not find end of app.post('/api/chat'");
  process.exit(1);
}
endIndex += endStr.length;

const originalBlock = code.substring(startIndex, endIndex);

let newBlock = `
async function processChatFlow(history, currentMessage) {
  try {
    // Layer 1: Master Layer - Intent Classification
    const masterPromptPath = path.join(__dirname, 'public', 'prompts', 'master.txt');
    let masterPrompt = await fs.readFile(masterPromptPath, 'utf8');

    // Supply the LLM with valid map options
    try {
      const regionsList = await queryAll('SELECT DISTINCT region FROM restaurants WHERE region IS NOT NULL AND region != ""');
      const tagsList = await queryAll('SELECT DISTINCT tag FROM restaurants WHERE tag IS NOT NULL AND tag != ""');
      
      const validDistricts = regionsList.map(r => r.region).join(", ");
      const validCuisines = tagsList.map(t => t.tag).join(", ");

      masterPrompt += \`\\n\\nCRITICAL: If the user specified a location or cuisine in Chinese (e.g., "大澳"), you MUST translate and match it to its official English name from the following valid lists:\\nValid Locations: \${validDistricts}\\nValid Cuisines: \${validCuisines}\`;
    } catch (e) {
      console.warn("Could not load DB mappings for prompt injection:", e.message);
    }

    const recentMasterHistory = (history || []).slice(-10);
    const masterMessages = [...recentMasterHistory, { role: "User", content: currentMessage }];
    let intentClassificationOutput = await callLocalLLM(masterPrompt, masterMessages);

    intentClassificationOutput = intentClassificationOutput.replace(/\`\`\`json/g, '').replace(/\`\`\`/g, '').trim();

    let masterJson;
    let detectedIntent = "default";
    try {
      masterJson = JSON.parse(intentClassificationOutput);
      detectedIntent = masterJson.intent.toLowerCase().trim().replace(/[^a-z0-9_]/g, '');
    } catch (e) {
      console.warn("Failed to parse Master Layer JSON, falling back to default.", intentClassificationOutput);
    }

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
        console.log(\`[Penalty Activated] User off-topic for \${offTopicCount} consecutive turns.\`);
        detectedIntent = 'redirect';
      }
    }

    const configPath = path.join(__dirname, 'public', 'config', 'intent_mapping.json');
    const configData = JSON.parse(await fs.readFile(configPath, 'utf8'));

    let mappedConfig = configData[detectedIntent] || configData["default"];
    if (!configData[detectedIntent]) detectedIntent = "default";

    const rawServiceData = await fetchServiceData(detectedIntent, masterJson || {});
    let dynamicServiceData = typeof rawServiceData === 'object' ? JSON.stringify(rawServiceData, null, 2) : rawServiceData;

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

    if (masterJson) {
      let extractedData = [];
      if (masterJson.keywords && masterJson.keywords.length > 0) extractedData.push(\`Keywords: \${masterJson.keywords.join(", ")}\`);

      const locStr = String(masterJson.location || "").toLowerCase();
      if (masterJson.location && locStr !== "unknown" && locStr !== "null") {
        extractedData.push(\`Location: \${masterJson.location}\${mappedDistrictId ? \` (\${mappedDistrictId})\` : ''}\`);
      } else {
        extractedData.push(\`Location: null\`);
      }

      const cuisStr = String(masterJson.cuisine || "").toLowerCase();
      if (masterJson.cuisine && cuisStr !== "unknown" && cuisStr !== "null") {
        extractedData.push(\`Cuisine: \${masterJson.cuisine}\${mappedCuisineId ? \` (\${mappedCuisineId})\` : ''}\`);
      } else {
        extractedData.push(\`Cuisine: null\`);
      }

      if (extractedData.length > 0) {
        dynamicServiceData += \`\\n\\n[Extracted Data from User Status: \${extractedData.join(" | ")}]\`;
      }
    }

    const systemPromptPath = path.join(__dirname, 'public', mappedConfig.system_prompt_file);
    let systemPrompt = await fs.readFile(systemPromptPath, 'utf8');

    systemPrompt = systemPrompt + \`\\n\\n[CONTEXT DATA INJECTED BY SERVICE LAYER: \${dynamicServiceData}]\`;

    const isFirstMessage = !history || history.length === 0;
    if (!isFirstMessage) {
      systemPrompt += \`\\n\\n[CONVERSATION RULE: This is NOT the user's first message. Do NOT start with any greeting like "喂", "你好", "👋" or any welcoming phrase. Jump straight into your response naturally as a continuation of the conversation. Be concise and direct.]\`;
    }

    const recentReplyHistory = (history || []).slice(-6);
    const messages = [...recentReplyHistory, { role: "User", content: currentMessage }];
    const finalReply = await callLocalLLM(systemPrompt, messages);

    return {
      reply: finalReply,
      intent: detectedIntent,
      debug: {
        layer1_masterOutput: intentClassificationOutput,
        layer1_intent: detectedIntent,
        layer2_serviceData: dynamicServiceData,
        layer2_keywords: masterJson?.keywords || [],
        layer3_promptFile: mappedConfig.system_prompt_file
      }
    };
  } catch (error) {
    throw error;
  }
}

app.post('/api/chat', async (req, res) => {
  try {
    const { history, currentMessage } = req.body;
    const result = await processChatFlow(history, currentMessage);
    res.json({ reply: result.reply, debug: result.debug });
  } catch (error) {
    console.error("Chat endpoint error:", error);
    res.status(500).json({ error: 'Internal server error while processing chat.' });
  }
});

app.post('/api/chat/session', async (req, res) => {
  try {
    const { sessionId, currentMessage } = req.body;
    if (!sessionId || !currentMessage) {
      return res.status(400).json({ error: 'sessionId and currentMessage are required' });
    }

    let history = [];
    const sessionRow = await queryGet('SELECT history FROM sessions WHERE session_id = ?', [sessionId]);
    if (sessionRow && sessionRow.history) {
      try {
        history = JSON.parse(sessionRow.history);
      } catch (e) {
        history = [];
      }
    }

    const result = await processChatFlow(history, currentMessage);

    history.push({ role: "User", content: currentMessage, intent: result.intent });
    history.push({ role: "AI", content: result.reply, intent: result.intent });

    if (sessionRow) {
      await queryRun('UPDATE sessions SET history = ?, updated_at = CURRENT_TIMESTAMP WHERE session_id = ?', [JSON.stringify(history), sessionId]);
    } else {
      await queryRun('INSERT INTO sessions (session_id, history) VALUES (?, ?)', [sessionId, JSON.stringify(history)]);
    }

    res.json({ reply: result.reply, debug: result.debug, sessionId });
  } catch (error) {
    console.error("Session chat endpoint error:", error);
    res.status(500).json({ error: 'Internal server error while processing session chat.' });
  }
});

app.get('/api/chat/session/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const sessionRow = await queryGet('SELECT history FROM sessions WHERE session_id = ?', [sessionId]);
    if (sessionRow && sessionRow.history) {
      res.json({ sessionId, history: JSON.parse(sessionRow.history) });
    } else {
      res.json({ sessionId, history: [] });
    }
  } catch (error) {
    console.error("Get session chat error:", error);
    res.status(500).json({ error: 'Internal server error while retrieving session history.' });
  }
});

app.delete('/api/chat/session/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    await queryRun('DELETE FROM sessions WHERE session_id = ?', [sessionId]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error while deleting session.' });
  }
});
`;

code = code.substring(0, startIndex) + newBlock.trim() + '\n\n' + code.substring(endIndex);

fs.writeFileSync('server.js', code, 'utf8');
console.log('Successfully updated server.js');
