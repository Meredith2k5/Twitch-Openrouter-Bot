# 🤖 Twitch OpenRouter AI Chatbot

Welcome to the official repository for the Twitch OpenRouter AI Chatbot! 

Section 1 is for viewers and streamers, if youve arrived here from Twitch chat or the bot is already active in your channel, you probably want this section.
Users can host several channels at once under one bot account so if this is too complex to setup you may still be able to have someone else host it for you. Memory persists per channel and is unique to each one.

Section 2 is for users who want to host the bot themselves and how to setup and use the more advanced functions. Section 3 is a quick setup for docker or python native.

This highly customizable, context-aware chatbot integrates powerful AI models (via OpenRouter) directly into your Twitch chat. 
The advantage of this is you can change models on the fly so the bot will always be up to date whenever new models release. 
You also have the choice of picking free models, cheap or the more expensive but deeper intelligence models. £5 tends to last 6-12 months using models such as Gemma 4 31b (id recommend starting here or Deepseek v4 flash is also both cheap and good).



---

## 📖 Section 1: Chat User Guide (For Twitch Viewers & Mods)

If you've just arrived from a Twitch stream and want to know how to interact with the AI, you're in the right place!

### 🧠 How the Bot's Brain Works
Every time you talk to the AI, it constructs its response using a specific formula behind the scenes:
**`[Persona/Prefix]` + `[Suffix/Rules]` + `[Your Twitch Message]`**

*   **Persona/Prefix:** This is *who* the bot is pretending to be (e.g., a pirate, an angry chef, or Will Smith).
*   **Suffix/Rules:** These are the hard-coded rules the bot must always follow (e.g., "Keep it under 200 characters, use Twitch emotes, be funny").
*   **Your Message:** The prompt or question you actually typed in chat.

By keeping the rules (Suffix) separate from the character (Prefix), the bot always behaves correctly for Twitch, no matter who it is pretending to be!

### 🎭 Set Personality vs. Dynamic Personas
The bot can switch between personalities on the fly. There are two ways the bot assumes a character:

1.  **The Set Personality (Permanent):** This is the bot's default state. If you mention the bot (e.g., `@tha_dank_joker`) or use its default trigger (e.g., `!joker`), it will reply using this permanent personality. 
2.  **Dynamic Personas (One-time / On-the-fly):** You can trigger a completely different personality for a single conversation thread by using a specific command. For example, if you type `!willsmith How was your day?`, the bot will temporarily reply as Will Smith, ignoring its default set personality.

**How to Add New Dynamic Personas (Mods/Broadcaster):**
You can create new dynamic personas on the fly using the `!prefix add` command. 
*   **Syntax:** `!prefix add !<command_name> <AI Prompt>`
*   **Example:** `!prefix add !gordon You are Gordon Ramsay. Criticize everything brutally.`
*   Now, anyone in chat can type `!gordon what do you think of my sandwich?` to get a customized response!

### ⚙️ Command Deep Dive
*Note: Most configuration commands are restricted to Moderators and the Broadcaster.*

| Command | User Level | Description |
| :--- | :--- | :--- |
| !bothelp | Everyone | Displays the help link/message for the bot. |
| !prefix add !<name> <prompt> | Mod/Admin | Creates a new dynamic persona (as explained above). |
| !prefix <prompt> | Mod/Admin | Overwrites the bot's **default** (permanent) personality and clears chat history. Use `!prefix show` to see the current one, or `!prefix reset` to clear it. |
| !set <name> | Mod/Admin | Changes the bot's permanent personality to one of the previously saved dynamic personas (e.g., `!set gordon`). |
| !listpersonality | Mod/Admin | Lists all the dynamic personas that have been saved to the channel. |
| !clearpersonality <name> | Mod/Admin | Deletes a saved dynamic persona (e.g., `!clearpersonality gordon`). |
| !suffix <prompt> | Mod/Admin | Updates the hidden "rules" the bot must follow. Use `!suffix show` or `!suffix reset`. |
| !reset | Mod/Admin | Wipes the bot's short-term memory (chat history) for the channel. Great if the AI gets confused! |
| !model <model_name> | Mod/Admin | Switches the OpenRouter AI model powering the bot (e.g., `!model google/gemma-4-31b-it`). Use `!model show` to see the current one. |
| !cfg | Mod/Admin | Displays the current technical configuration (Command triggers, Model, Prefix, Suffix). |
| !mutebot <minutes> | Mod/Admin | Silences the bot for a set number of minutes. Use `!mutebot permanent` to mute indefinitely. |
| !unmutebot | Mod/Admin | Unmutes the bot so it can reply again. |
| !commandtrigger <word> | Mod/Admin | Changes the default trigger word for the bot (e.g., `!commandtrigger chat`). |

### 🔗 Aliases
Don't like typing out long commands? The bot supports aliases! These act as alternative trigger words for the main commands. If you are not hosting the bot yourself, please contact whoever is hosting it if you have conflicts or want to suggest changes.
*   `!prefix` ➡️ `!personality`, `!persona`
*   `!suffix` ➡️ `!append`, `!rule`
*   `!set` ➡️ `!setpersona`, `!changepersona`
*   `!model` ➡️ `!switchmodel`
*   `!cfg` ➡️ `!config`, `!setup`
*   `!reset` ➡️ `!clear`, `!wipe`
*   `!commandtrigger` ➡️ `!triggers`
*   `!clearpersonality` ➡️ `!delpersona`, `!removepersona`, `!delpersonality`, `!rmpersonality`
*   `!listpersonality` ➡️ `!listpersona`, `!personas`, `!personalities`
*   `!bothelp` ➡️ `!help`, `!info`
*   `!mutebot` ➡️ `!mute`, `!silence`
*   `!unmutebot` ➡️ `!unmute`, `!speak`

> ⚠️ **Note:** If any commands or aliases conflict with other bots in your channel (like Nightbot or StreamElements), please contact the bot owner/host to change, add, or remove them via the `.env` file!

---

## 🛠️ Section 2: Hosting Guide & `.env` Setup

If you are hosting the bot, all configuration is managed via a `.env` file. The bot uses this file to connect to Twitch, authenticate with OpenRouter, and define its global limits.

Here is an in-depth breakdown of every variable:

### 1. Twitch Configuration
*   **`TWITCH_OAUTH`**: Your bot account's OAuth token (starts with `oauth:`). Get this from [twitchapps.com/tmi](https://twitchapps.com/tmi/).
*   **`BOT_USERNAME`**: The Twitch username of the account acting as the bot.
*   **`CHANNELS`**: A comma-separated list of channels the bot should join (no `#` symbols). Example: `channel1,channel2`.

### 2. OpenRouter & AI Settings
*   **`OPENROUTER_API_KEY`**: Your API key from [OpenRouter.ai](https://openrouter.ai/).
*   **`DEFAULT_MODEL`**: The fallback AI model if a channel hasn't set one (e.g., `google/gemma-4-31b-it`).
*   **`DEFAULT_SUFFIX`**: The global rules appended to every prompt. Use this to enforce character limits, mandate Twitch emotes, and enforce roleplay rules.

### 3. Bot Behavior & Limits
*   **`COOLDOWN_SECONDS`**: Global spam prevention. How many seconds a specific user must wait before triggering the bot again.
*   **`MAX_INPUT_CHARS`**: Truncates user messages longer than this value to save tokens and prevent prompt injection spam.
*   **`MAX_OUTPUT_CHARS`**: The absolute maximum length of the AI's response before the bot forcefully cuts it off.
*   **`SPLIT_AFTER_CHARS`**: Twitch has a 500-character limit per message. This setting tells the bot when to split a long AI response into a follow-up chat message (e.g., `250`).
*   **`MAX_SPLIT_MESSAGES`**: How many consecutive chat messages the bot is allowed to send for a single reply.
*   **`HISTORY_TURNS`**: How many previous messages the bot remembers per channel/persona to maintain context. Lower this to save API costs.
*   **`STATE_FILE`**: The JSON file where per-channel configurations (like dynamically added personas) are saved persistently (default: `channel_state.json`).

### 4. Triggers & Commands
*   **`TRIGGER_COMMANDS`**: Global fallback triggers (comma-separated, no `!`). e.g., `joker,chat,ai`.
*   **`TRIGGER_MENTIONS`**: If someone `@mentions` this exact string, the bot responds. Usually set to `@your_bot_name`.
*   **`DEFAULT_CHANNEL_COMMAND`**: The default command a channel uses before setting their own via `!commandtrigger`.

### 5. Custom Messages
*   **`HELP_MESSAGE`**: The text outputted when someone types `!bothelp`.
*   **`FALLBACK_MESSAGE`**: Displayed if OpenRouter returns an empty string or times out.
*   **`ERROR_MESSAGE`**: Displayed if the script throws a fatal error (e.g., API crash, invalid model).

### 6. Permissions & Logging
*   **`ALLOW_MOD_COMMANDS`**: Set to `1` to allow Twitch Moderators to use configuration commands (`!prefix`, `!model`, etc.). Set to `0` to restrict to the Broadcaster only.
*   **`DEBUG`**: Set to `1` to print system logs to the console.
*   **`LOG_REPLY`**: Set to `1` to print AI responses to the console.
*   **`LOG_REPLY_MAX_CHARS`**: Truncates console logs to keep your terminal clean.

### 7. Aliases
*   Variables like `ALIAS_PREFIX` and `ALIAS_MUTEBOT` allow you to define comma-separated alternative trigger words for admin commands. Do not include the `!` prefix here.

---

## 🚀 Section 3: Setup & Installation

You can run this bot natively using Node.js, or containerized using Docker. 

### Prerequisites
*   Ensure your Twitch bot account is registered and you have your OAuth token.
*   Create a `.env` file in the root directory based on the variables listed in Section 2.

### Option A: Running via Docker (Recommended)
Docker ensures the bot runs in an isolated environment and automatically restarts if it crashes.

1. Ensure Docker and Docker Compose are installed on your machine.
2. Open your terminal in the project directory.
3. Run the following command to build and start the bot:
   ```bash
   docker-compose up -d
   ```
4. The bot will automatically install dependencies based on the `package.json` file and start running in the background.
5. **To view logs:**
   ```bash
   docker-compose logs -f
   ```
6. **To stop the bot:**
   ```bash
   docker-compose down
   ```

### Option B: Running Natively (Node.js)
If you prefer running it directly on your host machine:

1. Ensure you have **Node.js (v18 or v20+)** installed.
2. Open your terminal in the project directory.
3. Install the required dependencies using the included `package.json` file:
   ```bash
   npm install
   ```
4. Start the bot:
   ```bash
   node index.js
   ```
   *(Or `npm start` if you have it configured in your `package.json`)*
5. You should see a console message confirming the bot has connected to Twitch!