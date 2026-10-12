# Running Smart Slides from scratch

The steps below are the same on every OS apart from installing the tools and copying the `.env` file.

You need:
- **Node.js 20 or newer** (this includes `npm`)
- **Git**
- **An LLM API key.** A free one from [Google AI Studio](https://aistudio.google.com/apikey) works.

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
   npm.cmd install
   ```
   Use `npm.cmd` rather than `npm`, because PowerShell's default policy often blocks `npm`.
4. **Create your config file:**
   ```powershell
   Copy-Item .env.example .env
   notepad .env
   ```
   Set `GEMINI_API_KEY=` to your key, then save and close.
5. **Start it:**
   ```powershell
   npm.cmd run dev
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
   Set `GEMINI_API_KEY=` to your key, then save and close.
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
   Set `GEMINI_API_KEY=` to your key, then save (`Ctrl+O`, Enter) and exit (`Ctrl+X`).
5. **Start it:**
   ```bash
   npm run dev
   ```
6. Open **http://localhost:5173**. Press `Ctrl+C` to stop.

## Troubleshooting
- **"Cannot reach the backend on port 8787":** `npm run dev` isn't running, or something else is using that port. Set `PORT=` in `.env` if so.
- **"The AI provider rejected the API key":** check the key in `.env`, then restart `npm run dev`. The server only reads `.env` at startup.
- **Rate-limit message:** free tiers allow only a few requests per minute. Wait a minute and retry, or switch providers.
- **Using another provider:** set `LLM_PROVIDER=` (`gemini`, `nanogpt`, `anthropic`, or `openai-compatible`) and the matching key variables in `.env`. The comments in `.env.example` list them.
