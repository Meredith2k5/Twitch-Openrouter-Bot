const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");
dotenv.config();

const tmi = require("tmi.js");

const ENV_PATH = path.join(__dirname, ".env");
const STATE_PATH = path.join(__dirname, process.env.STATE_FILE || "channel_state.json");

function toInt(v, def) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : def;
}

function toFloat(v, def) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : def;
}

function toBool(v, def = false) {
  if (v === undefined) return def;
  const s = String(v).trim().toLowerCase();
  return s === "1" || s === "true" || s === "yes";
}

function splitCsv(v) {
  return String(v || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function safeTrim(s = "") {
  return String(s).replace(/\s+/g, " ").trim();
}

const DEBUG = toBool(process.env.DEBUG, false);
const LOG_REPLY = toBool(process.env.LOG_REPLY, false);
const LOG_REPLY_MAX_CHARS = toInt(process.env.LOG_REPLY_MAX_CHARS, 300);

function log(...args) {
  if (DEBUG) console.log(new Date().toISOString(), ...args);
}

function clipForLog(s, max) {
  const t = safeTrim(String(s || ""));
  return t.length <= max ? t : t.slice(0, max) + "…";
}

// ---- persistent per-channel state ----
function loadState() {
  try {
    if (!fs.existsSync(STATE_PATH)) return {};
    const raw = fs.readFileSync(STATE_PATH, "utf8");
    const obj = JSON.parse(raw || "{}");
    if (obj && typeof obj === "object") {
      for (const [key, val] of Object.entries(obj)) {
        if (val.command && !val.commands) {
          val.commands = [val.command.replace(/^!/, "").toLowerCase()];
          delete val.command;
        }
      }
      saveState(obj);
      return obj;
    }
    return {};
  } catch (e) {
    console.error("Failed to load channel state:", e);
    return {};
  }
}

function saveState(state) {
  try {
    fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2), "utf8");
  } catch (e) {
    console.error("Failed to save channel state:", e);
  }
}

// ----- history management -----
const historyByChannel = new Map();

function getHistory(historyKey, maxTurns) {
  if (!maxTurns || maxTurns <= 0) return [];
  const arr = historyByChannel.get(historyKey) || [];
  return arr.slice(-maxTurns * 2);
}

function pushHistory(historyKey, maxTurns, role, content) {
  if (!maxTurns || maxTurns <= 0) return;
  const arr = historyByChannel.get(historyKey) || [];
  arr.push({ role, content });
  while (arr.length > maxTurns * 2) arr.shift();
  historyByChannel.set(historyKey, arr);
}

function clearHistory(channel) {
  // Clear the main channel history
  historyByChannel.delete(channel);
  
  // Clear all sub-histories for dynamic personalities on this channel
  for (const key of historyByChannel.keys()) {
    if (key.startsWith(`${channel}:`)) {
      historyByChannel.delete(key);
    }
  }
  log("History cleared for channel and its personalities:", channel);
}

// ----- normalize multiple commands -----
function normalizeCommands(input) {
  return Array.from(
    new Set(
      splitCsv(input).map((s) =>
        safeTrim(s)
          .split(/\s+/)[0]
          .replace(/^!/, "")
          .toLowerCase()
      )
    )
  ).filter(Boolean);
}

// ----- admin command alias matcher -----
function getAdminCommand(msg, baseCmd, envAliases) {
  const lower = msg.toLowerCase();
  const aliases = [baseCmd, ...splitCsv(envAliases).map(a => a.toLowerCase())];
  for (const alias of aliases) {
    const trigger = "!" + alias;
    if (lower === trigger || lower.startsWith(trigger + " ")) {
      return { hit: true, triggerLength: trigger.length };
    }
  }
  return { hit: false };
}

// conservative send queue
const sendQueues = new Map();
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
async function queuedSay(client, channel, message) {
  const prev = sendQueues.get(channel) || Promise.resolve();
  const next = prev
    .catch(() => {})
    .then(async () => {
      await client.say(channel, message);
      await sleep(1100);
    });
  sendQueues.set(channel, next);
  return next;
}

function clipForTwitch(msg) {
  return msg.length <= 490 ? msg : msg.slice(0, 490);
}

function splitForTwitch(text, splitAfterChars, maxParts) {
  const parts = [];
  let remaining = text.trim();
  while (remaining.length > splitAfterChars && parts.length < maxParts - 1) {
    let cut = remaining.lastIndexOf(" ", splitAfterChars);
    if (cut < 50) cut = splitAfterChars;
    parts.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trim();
  }
  if (remaining) parts.push(remaining);
  return parts;
}

// Cleaned up OpenRouter fetch
async function openRouterChat({ apiKey, model, messages, temperature, maxTokens }) {
  const url = "https://openrouter.ai/api/v1/chat/completions";
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json"
  };

  const body = { model, messages, temperature, max_tokens: maxTokens };
  const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`OpenRouter ${res.status}: ${txt.slice(0, 300)}`);
  }
  const data = await res.json();
  return data?.choices?.[0]?.message?.content ?? "";
}

(async () => {
  if (!process.env.TWITCH_OAUTH) throw new Error("Missing TWITCH_OAUTH in .env");
  if (!process.env.BOT_USERNAME) throw new Error("Missing BOT_USERNAME in .env");
  if (!process.env.CHANNELS) throw new Error("Missing CHANNELS in .env");
  if (!process.env.OPENROUTER_API_KEY) throw new Error("Missing OPENROUTER_API_KEY in .env");

  // Load Configurations safely
  const cfg = {
    botUsername: process.env.BOT_USERNAME,
    channels: splitCsv(process.env.CHANNELS).map((c) => c.toLowerCase()),

    // Custom Messages
    helpMessage: process.env.HELP_MESSAGE || "Need help using the bot? Check out the guide here: https://github.com/your-username/your-repo-name",
    fallbackMessage: process.env.FALLBACK_MESSAGE || "…I’ve got nothing. Which is impressive, even for me.",
    errorMessage: process.env.ERROR_MESSAGE || "AI had a wobble. Try again in a sec.",

    defaultModel: process.env.DEFAULT_MODEL || "openai/gpt-4o-mini",
    defaultSuffix: process.env.DEFAULT_SUFFIX || "",

    triggers: {
      commands: splitCsv(process.env.TRIGGER_COMMANDS).map((s) =>
        s.replace(/^!/, "").toLowerCase()
      ),
      mentions: splitCsv(process.env.TRIGGER_MENTIONS).length
        ? splitCsv(process.env.TRIGGER_MENTIONS)
        : [`@${process.env.BOT_USERNAME}`]
    },

    defaultChannelCommands: (() => {
      const cmds = splitCsv(process.env.DEFAULT_CHANNEL_COMMAND)
        .map((s) => s.replace(/^!/, "").toLowerCase())
        .filter(Boolean);
      return cmds.length ? cmds : null;
    })(),

    cooldownSeconds: toInt(process.env.COOLDOWN_SECONDS, 8),
    maxInputChars: toInt(process.env.MAX_INPUT_CHARS, 350),
    maxOutputChars: toInt(process.env.MAX_OUTPUT_CHARS, 380),
    splitAfterChars: toInt(process.env.SPLIT_AFTER_CHARS, 380),
    maxSplitMessages: toInt(process.env.MAX_SPLIT_MESSAGES, 2),

    allowModCommands: toBool(process.env.ALLOW_MOD_COMMANDS, true),
    historyTurns: toInt(process.env.HISTORY_TURNS, 0),
    aiTemperature: toFloat(process.env.AI_TEMPERATURE, 0.9),
    aiMaxTokens: toInt(process.env.AI_MAX_TOKENS, 500)
  };

  let channelState = loadState();

  const modelByChannel = new Map();
  for (const ch of cfg.channels) {
    const key = `#${ch}`;
    modelByChannel.set(key, channelState[key]?.model || cfg.defaultModel);
  }

  const lastUsed = new Map();

  const client = new tmi.Client({
    options: { debug: false },
    connection: { secure: true, reconnect: true },
    identity: {
      username: cfg.botUsername,
      password: process.env.TWITCH_OAUTH
    },
    channels: cfg.channels
  });

  client.on("connected", (addr, port) => {
    console.log(`✅ Connected: ${addr}:${port}`);
    console.log(`Joined channels: ${cfg.channels.map((c) => `#${c}`).join(", ")}`);
  });

  client.on("message", async (channel, tags, message, self) => {
    try {
      if (self) return;
      const msg = (message || "").trim();
      if (!msg) return;

      const lower = msg.toLowerCase();
      const username = (tags.username || "someone").toLowerCase();
      
      // Ensure channelState exists for this channel for safe reading
      channelState[channel] = channelState[channel] || {};
      const st = channelState[channel];

      const isAdmin = (() => {
        const isBroadcaster = tags.badges?.broadcaster === "1" || username === channel.replace(/^#/, "");
        const isMod = !!tags.mod;
        return isBroadcaster || (cfg.allowModCommands && isMod);
      })();

      // ====================== PUBLIC COMMANDS ======================
      
      // !bothelp
      const helpMatch = getAdminCommand(msg, "bothelp", process.env.ALIAS_BOTHELP);
      if (helpMatch.hit) {
        await queuedSay(client, channel, clipForTwitch(cfg.helpMessage));
        return;
      }

      // ====================== ADMIN COMMANDS ======================

      // !mutebot
      const muteMatch = getAdminCommand(msg, "mutebot", process.env.ALIAS_MUTEBOT);
      if (muteMatch.hit) {
        if (!isAdmin) return;
        const arg = safeTrim(msg.slice(muteMatch.triggerLength)).toLowerCase();

        if (arg === "permanent" || arg === "perm") {
          st.muteUntil = 9999999999999; // Essentially permanent
          saveState(channelState);
          await queuedSay(client, channel, clipForTwitch("Bot muted permanently. Use !unmutebot to restore."));
          return;
        }

        const mins = parseInt(arg, 10);
        if (isNaN(mins) || mins <= 0) {
          await queuedSay(client, channel, clipForTwitch("Format: !mutebot <minutes> OR !mutebot permanent"));
          return;
        }

        st.muteUntil = Date.now() + (mins * 60 * 1000);
        saveState(channelState);
        await queuedSay(client, channel, clipForTwitch(`Bot muted for ${mins} minute(s).`));
        return;
      }

      // !unmutebot
      const unmuteMatch = getAdminCommand(msg, "unmutebot", process.env.ALIAS_UNMUTEBOT);
      if (unmuteMatch.hit) {
        if (!isAdmin) return;
        if (st.muteUntil) {
          delete st.muteUntil;
          saveState(channelState);
          await queuedSay(client, channel, clipForTwitch("Bot unmuted! I'm back."));
        } else {
          await queuedSay(client, channel, clipForTwitch("Bot is not currently muted."));
        }
        return;
      }

      // !commandtrigger
      const triggerMatch = getAdminCommand(msg, "commandtrigger", process.env.ALIAS_COMMANDTRIGGER);
      if (triggerMatch.hit) {
        if (!isAdmin) return;
        const arg = safeTrim(msg.slice(triggerMatch.triggerLength));

        if (!arg) {
          const current = (st.commands || cfg.defaultChannelCommands).join(", ");
          await queuedSay(client, channel, clipForTwitch(`Command triggers: ${current}`));
          return;
        }
        if (arg.toLowerCase() === "reset") {
          delete st.commands;
          saveState(channelState);
          await queuedSay(client, channel, clipForTwitch(`Triggers reset. Using default: ${cfg.defaultChannelCommands.join(", ")}`));
          return;
        }
        
        const newCmds = normalizeCommands(arg);
        if (!newCmds.length) return;
        st.commands = newCmds;
        saveState(channelState);
        await queuedSay(client, channel, clipForTwitch(`Triggers set: ${newCmds.join(", ")}`));
        return;
      }

      // !prefix (or aliases) & !prefix add !name
      const prefixMatch = getAdminCommand(msg, "prefix", process.env.ALIAS_PREFIX);
      if (prefixMatch.hit) {
        if (!isAdmin) return;
        const arg = safeTrim(msg.slice(prefixMatch.triggerLength));

        // ADD PERSONALITY: !prefix add !willsmith you are Will Smith
        if (arg.toLowerCase().startsWith("add !")) {
          const subArg = safeTrim(arg.slice(4));
          const firstSpace = subArg.indexOf(" ");
          if (firstSpace === -1) {
            await queuedSay(client, channel, clipForTwitch("Format: !prefix add !name <prompt>"));
            return;
          }
          const pName = subArg.slice(0, firstSpace).replace(/^!/, "").toLowerCase();
          const pPrompt = safeTrim(subArg.slice(firstSpace));
          
          st.personalities = st.personalities || {};
          st.personalities[pName] = pPrompt;
          saveState(channelState);
          await queuedSay(client, channel, clipForTwitch(`Personality '!${pName}' saved.`));
          return;
        }

        if (!arg || arg.toLowerCase() === "show") {
          const current = st.prefix || "(none)";
          await queuedSay(client, channel, clipForTwitch(`Prefix: ${clipForLog(current, 120)}`));
          return;
        }
        if (arg.toLowerCase() === "reset") {
          delete st.prefix;
          saveState(channelState);
          clearHistory(channel);
          await queuedSay(client, channel, clipForTwitch("Prefix cleared + history reset."));
          return;
        }

        st.prefix = arg;
        saveState(channelState);
        clearHistory(channel);
        await queuedSay(client, channel, clipForTwitch("Prefix updated + history reset."));
        return;
      }

      // !set (set permanent personality from saved list)
      const setMatch = getAdminCommand(msg, "set", process.env.ALIAS_SET);
      if (setMatch.hit) {
        if (!isAdmin) return;
        const pName = safeTrim(msg.slice(setMatch.triggerLength)).replace(/^!/, "").toLowerCase();
        if (!pName) return;

        if (st.personalities && st.personalities[pName]) {
          st.prefix = st.personalities[pName];
          saveState(channelState);
          clearHistory(channel);
          await queuedSay(client, channel, clipForTwitch(`Channel personality permanently set to ${pName}. History cleared.`));
        } else {
          await queuedSay(client, channel, clipForTwitch(`Personality '!${pName}' not found.`));
        }
        return;
      }
      
      // !listpersonality
      const listPersonaMatch = getAdminCommand(msg, "listpersonality", process.env.ALIAS_LISTPERSONALITY);
      if (listPersonaMatch.hit) {
        if (!isAdmin) return;
        if (!st.personalities || Object.keys(st.personalities).length === 0) {
          await queuedSay(client, channel, clipForTwitch("No saved personalities on this channel."));
          return;
        }
        const pList = Object.keys(st.personalities).map(p => `!${p}`).join(", ");
        await queuedSay(client, channel, clipForTwitch(`Saved personalities: ${pList}`));
        return;
      }

      // !clearpersonality
      const clearPersonaMatch = getAdminCommand(msg, "clearpersonality", process.env.ALIAS_CLEARPERSONALITY);
      if (clearPersonaMatch.hit) {
        if (!isAdmin) return;
        const pName = safeTrim(msg.slice(clearPersonaMatch.triggerLength)).replace(/^!/, "").toLowerCase();
        if (!pName) {
            await queuedSay(client, channel, clipForTwitch("Format: !clearpersonality <name>"));
            return;
        }
        if (st.personalities && st.personalities[pName]) {
            delete st.personalities[pName];
            saveState(channelState);
            historyByChannel.delete(`${channel}:${pName}`); // Clean up isolated history
            await queuedSay(client, channel, clipForTwitch(`Personality '!${pName}' deleted.`));
        } else {
            await queuedSay(client, channel, clipForTwitch(`Personality '!${pName}' not found.`));
        }
        return;
      }

      // !suffix (or aliases)
      const suffixMatch = getAdminCommand(msg, "suffix", process.env.ALIAS_SUFFIX);
      if (suffixMatch.hit) {
        if (!isAdmin) return;
        const arg = safeTrim(msg.slice(suffixMatch.triggerLength));

        if (!arg || arg.toLowerCase() === "show") {
          const current = st.suffix !== undefined ? st.suffix : cfg.defaultSuffix;
          await queuedSay(client, channel, clipForTwitch(`Suffix: ${clipForLog(current || "(none)", 120)}`));
          return;
        }
        if (arg.toLowerCase() === "reset") {
          delete st.suffix;
          saveState(channelState);
          await queuedSay(client, channel, clipForTwitch("Suffix cleared. Using default if set."));
          return;
        }

        st.suffix = arg;
        saveState(channelState);
        await queuedSay(client, channel, clipForTwitch("Suffix updated."));
        return;
      }

      // !reset
      const resetMatch = getAdminCommand(msg, "reset", process.env.ALIAS_RESET);
      if (resetMatch.hit) {
        if (!isAdmin) return;
        clearHistory(channel);
        await queuedSay(client, channel, clipForTwitch("Chat history reset for this channel."));
        return;
      }

      // !cfg
      const cfgMatch = getAdminCommand(msg, "cfg", process.env.ALIAS_CFG);
      if (cfgMatch.hit) {
        if (!isAdmin) return;
        const cmds = (st.commands || cfg.defaultChannelCommands).join(", ");
        const pref = st.prefix ? clipForLog(st.prefix, 60) : "(none)";
        const suff = (st.suffix !== undefined ? st.suffix : cfg.defaultSuffix) ? clipForLog((st.suffix !== undefined ? st.suffix : cfg.defaultSuffix), 60) : "(none)";
        const model = modelByChannel.get(channel) || cfg.defaultModel;
        await queuedSay(client, channel, clipForTwitch(`cmds=${cmds} | model=${model} | prefix=${pref} | suffix=${suff}`));
        return;
      }

      // !model
      const modelMatch = getAdminCommand(msg, "model", process.env.ALIAS_MODEL);
      if (modelMatch.hit) {
        if (!isAdmin) return;
        const current = modelByChannel.get(channel) || cfg.defaultModel;
        const requested = safeTrim(msg.slice(modelMatch.triggerLength));
        if (!requested || requested.toLowerCase() === "show") {
          await queuedSay(client, channel, clipForTwitch(`Current model: ${current}`));
          return;
        }
        modelByChannel.set(channel, requested);
        st.model = requested;
        saveState(channelState);
        await queuedSay(client, channel, clipForTwitch(`Model switched to: ${requested}`));
        return;
      }

      // ====================== MUTE CHECK ======================
      // Check if the bot is currently muted before validating AI generation triggers
      if (st.muteUntil && st.muteUntil > Date.now()) {
          return; 
      }

      // ====================== TRIGGERS (Standard & Dynamic) ======================
      const channelCmds = st.commands || cfg.defaultChannelCommands || cfg.triggers.commands || ["chat"];
      let commandHit = false;
      let prefixLength = 0;
      let bypassHistory = false;
      let dynamicPrefixText = "";
      let dynamicPersonaName = "";

      // 1. Check Standard Commands
      for (const cmd of channelCmds) {
        const lcCmd = cmd.toLowerCase();
        const variants = [lcCmd, `!${lcCmd}`];
        for (const pat of variants) {
          if (lower === pat || lower.startsWith(pat + " ")) {
            commandHit = true; prefixLength = pat.length; break;
          }
          if (lower.startsWith(pat + ",")) {
            commandHit = true; prefixLength = pat.length + 1; break;
          }
        }
        if (commandHit) break;
      }

      // 2. Check Dynamic Personalities (Gets its own isolated history key)
      if (!commandHit && st.personalities) {
        for (const [pName, pPrompt] of Object.entries(st.personalities)) {
          const pat = `!${pName}`;
          if (lower === pat || lower.startsWith(pat + " ")) {
            commandHit = true;
            prefixLength = pat.length;
            bypassHistory = true;
            dynamicPrefixText = pPrompt;
            dynamicPersonaName = pName;
            break;
          }
        }
      }

      const mentionHit = cfg.triggers.mentions.some((m) => lower.includes(m.toLowerCase()));
      if (!commandHit && !mentionHit) return;

      // Cooldown enforcement
      const key = `${channel}|${username}`;
      const now = Date.now();
      const last = lastUsed.get(key) || 0;
      const cdMs = (cfg.cooldownSeconds || 0) * 1000;
      if (cdMs > 0 && now - last < cdMs) return;
      lastUsed.set(key, now);

      // Extract Prompt
      let userText = msg;
      if (commandHit) {
        userText = safeTrim(msg.slice(prefixLength));
      }
      for (const m of cfg.triggers.mentions) {
        userText = userText.replace(new RegExp(m, "ig"), "");
      }
      userText = safeTrim(userText);

      if (!userText) {
        await queuedSay(client, channel, clipForTwitch(`@${tags.username} Give me an actual prompt.`));
        return;
      }
      if (userText.length > cfg.maxInputChars) {
        userText = userText.slice(0, cfg.maxInputChars) + "…";
      }

      // Build System Prompt
      const model = modelByChannel.get(channel) || cfg.defaultModel;
      
      const activePrefix = bypassHistory ? dynamicPrefixText : (st.prefix ? safeTrim(st.prefix) : "");
      const activeSuffix = st.suffix !== undefined ? safeTrim(st.suffix) : safeTrim(cfg.defaultSuffix);

      let finalSystemPrompt = "";
      if (activePrefix) {
        finalSystemPrompt += `Channel persona/prefix:
${activePrefix}

`;
      }
      if (activeSuffix) {
        finalSystemPrompt += `Rules:
${activeSuffix}`;
      }

      // Isolated History Management
      const historyKey = bypassHistory ? `${channel}:${dynamicPersonaName}` : channel;
      const currentTurns = bypassHistory ? 3 : cfg.historyTurns; // Dynamic personas strictly remember last 3 turns

      const history = getHistory(historyKey, currentTurns);
      const userLine = `${tags.username}: ${userText}`;

      const messages = [
        { role: "system", content: finalSystemPrompt || "You are a helpful chat bot." },
        ...history,
        { role: "user", content: userLine }
      ];

      const replyRaw = await openRouterChat({
        apiKey: process.env.OPENROUTER_API_KEY,
        model,
        messages,
        temperature: cfg.aiTemperature,
        maxTokens: cfg.aiMaxTokens
      });

      // Apply the fallback message from your configs if API returns empty
      let reply = safeTrim(replyRaw) || cfg.fallbackMessage;

      if (LOG_REPLY) {
        console.log(new Date().toISOString(), "Reply", clipForLog(reply, LOG_REPLY_MAX_CHARS));
      }

      // Save history to the designated memory lane
      pushHistory(historyKey, currentTurns, "user", userLine);
      pushHistory(historyKey, currentTurns, "assistant", reply);

      const totalMax = (cfg.maxOutputChars || 380) * (cfg.maxSplitMessages || 2);
      reply = reply.slice(0, totalMax);

      const parts = splitForTwitch(reply, cfg.splitAfterChars || 380, cfg.maxSplitMessages || 2);
      for (const part of parts) {
        await queuedSay(client, channel, clipForTwitch(part));
      }
    } catch (err) {
      console.error(err);
      try {
        // Send the configurable error message directly to Twitch chat
        await queuedSay(client, channel, clipForTwitch(cfg.errorMessage));
      } catch {}
    }
  });

  await client.connect();
})();