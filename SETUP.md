# Running Smart Slides from scratch

The steps below are the same on every OS apart from installing the tools and copying the `.env` file.

You need:
- **Node.js 20 or newer** (this includes `npm`)
- **Git**
- **An LLM API key** from one of the supported providers (see [Choosing an LLM provider](#choosing-an-llm-provider)). A free Gemini key from [Google AI Studio](https://aistudio.google.com/apikey) is the easiest way to start.

## Windows

1. **Install the tools.** Open PowerShell and run:
   ```powershell
   winget install OpenJS.NodeJS.LTS
   winget install Git.Git
   ```
   Then **close and reopen PowerShell** so the new commands are found. (Or download the installers from nodejs.org and git-scm.com.)
2. **Get the code:**
   ```powershell
   git clone https://github.com/IsabellaCapriotti/smart_slides.git
   cd smart_slides
   ```
3. **Install dependencies:**
   ```powershell
   npm install
   ```
4. **Create your config file:**
   ```powershell
   Copy-Item .env.example .env
   notepad .env
   ```
   Set the key for your provider (see [Choosing an LLM provider](#choosing-an-llm-provider)), then save and close.
5. **Start it:**
   ```powershell
   npm run dev
   ```
6. Open **http://localhost:5173** in your browser. Press `Ctrl+C` in the terminal to stop.

## Mac

1. **Install the tools.** Open Terminal and run:
   ```bash
   xcode-select --install        # installs git, if you don't have it
   /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"   # Homebrew
   brew install node
   ```
   (If you already have Homebrew, skip the second line. Or install Node from nodejs.org.)
2. **Get the code:**
   ```bash
   git clone https://github.com/IsabellaCapriotti/smart_slides.git
   cd smart_slides
   ```
3. **Install dependencies:**
   ```bash
   npm install
   ```
4. **Create your config file:**
   ```bash
   cp .env.example .env
   open -e .env
   ```
   Set the key for your provider (see [Choosing an LLM provider](#choosing-an-llm-provider)), then save and close.
5. **Start it:**
   ```bash
   npm run dev
   ```
6. Open **http://localhost:5173**. Press `Ctrl+C` to stop.

## Linux

1. **Install the tools.** On Debian or Ubuntu:
   ```bash
   sudo apt update
   sudo apt install -y git curl
   curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
   sudo apt install -y nodejs
   ```
   On Fedora, run `sudo dnf install -y git nodejs` instead. Check that `node --version` prints v20 or higher.
2. **Get the code:**
   ```bash
   git clone https://github.com/IsabellaCapriotti/smart_slides.git
   cd smart_slides
   ```
3. **Install dependencies:**
   ```bash
   npm install
   ```
4. **Create your config file:**
   ```bash
   cp .env.example .env
   nano .env
   ```
   Set the key for your provider (see [Choosing an LLM provider](#choosing-an-llm-provider)), then save (`Ctrl+O`, Enter) and exit (`Ctrl+X`).
5. **Start it:**
   ```bash
   npm run dev
   ```
6. Open **http://localhost:5173**. Press `Ctrl+C` to stop.

## Choosing an LLM provider

The app talks to one LLM provider at a time, chosen by `LLM_PROVIDER` in your `.env` file. Keys are read only by the backend and are never sent to the browser.

`.env.example` defaults to Gemini, and the provider-specific lines are commented out. A line is commented out when it starts with `#`. To use a provider, delete the `#` in front of its lines and fill in the values. Then set `LLM_PROVIDER` to match and **restart `npm run dev`**, since `.env` is only read at startup.

| Provider | `LLM_PROVIDER` | Variables to set | Notes |
| --- | --- | --- | --- |
| Google Gemini (default) | `gemini` | `GEMINI_API_KEY`, optional `GEMINI_MODEL` | Free tier available; rate-limited to a few requests per minute |
| Anthropic (Claude) | `anthropic` | `ANTHROPIC_API_KEY`, optional `ANTHROPIC_MODEL` | Model defaults to `claude-sonnet-5-5` |
| OpenAI | `openai-compatible` | `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL` | Set the base URL to `https://api.openai.com/v1` |
| Other OpenAI-compatible (OpenRouter, Groq, ...) | `openai-compatible` | `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL` | Use the base URL from your provider's docs |
| NanoGPT | `nanogpt` | `NANOGPT_API_KEY`, `NANOGPT_MODEL` | Run `npm run models` to list valid model ids |

### Examples

**Gemini** (default):
```
LLM_PROVIDER=gemini
GEMINI_API_KEY=your-key-here
```

**Anthropic:**
```
LLM_PROVIDER=anthropic
ANTHROPIC_API_KEY=your-key-here
# ANTHROPIC_MODEL=claude-sonnet-5-5
```

**OpenAI:**
```
LLM_PROVIDER=openai-compatible
LLM_BASE_URL=https://api.openai.com/v1
LLM_API_KEY=your-key-here
LLM_MODEL=the-model-id-you-want-to-use
```

**OpenRouter** (or any other OpenAI-compatible service), same shape with a different base URL:
```
LLM_PROVIDER=openai-compatible
LLM_BASE_URL=https://openrouter.ai/api/v1
LLM_API_KEY=your-key-here
LLM_MODEL=the-model-id-you-want-to-use
```

**NanoGPT:**
```
LLM_PROVIDER=nanogpt
NANOGPT_API_KEY=your-key-here
NANOGPT_MODEL=a-model-id-from-npm-run-models
```

### Tips
- **Keep one provider's lines active.** Leaving several keys filled in is fine, but only the one named by `LLM_PROVIDER` is used.
- **Model quality matters.** The app relies on structured tool calls, so very small or "flash"-class models can be less reliable at producing good findings or making slide edits. If results look off, try a stronger model.
- **Never commit your `.env`.** It's git-ignored. Put keys there, not in `.env.example`.

## Troubleshooting
- **"Cannot reach the backend on port 8787":** `npm run dev` isn't running, or something else is using that port. Set `PORT=` in `.env` if so.
- **"The AI provider rejected the API key":** check the key in `.env`, then restart `npm run dev`. The server only reads `.env` at startup.
- **Rate-limit message:** free tiers allow only a few requests per minute. Wait a minute and retry, or switch providers.
- **"npm.ps1 cannot be loaded because running scripts is disabled" (Windows PowerShell):** your machine's PowerShell execution policy blocks npm's script wrapper. This depends on your system settings, so you may never see it. Either run the commands with `npm.cmd` (for example `npm.cmd install`, `npm.cmd run dev`), use Command Prompt or Git Bash instead, or allow scripts for your user with `Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned`.
- **Changed `.env` but nothing happened:** restart `npm run dev`.
