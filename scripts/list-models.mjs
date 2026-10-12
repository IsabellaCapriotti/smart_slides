// Lists model ids available to the provider configured in .env.
// Run: npm run models
import dotenv from 'dotenv';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../.env') });

const env = process.env;
const provider = (env.LLM_PROVIDER || (env.GEMINI_API_KEY ? 'gemini' : env.NANOGPT_API_KEY ? 'nanogpt' : 'openai-compatible')).toLowerCase();

const targets = {
  gemini: { url: 'https://generativelanguage.googleapis.com/v1beta/openai/models', key: env.GEMINI_API_KEY },
  nanogpt: {
    url: `${env.NANOGPT_BASE_URL || 'https://nano-gpt.com/api/subscription/v1'}/models`,
    key: env.NANOGPT_API_KEY,
  },
  'openai-compatible': { url: `${env.LLM_BASE_URL}/models`, key: env.LLM_API_KEY },
};

const t = targets[provider];
if (!t || !t.key) {
  console.error(`No API key configured for provider "${provider}". Check your .env file.`);
  process.exit(1);
}

const res = await fetch(t.url, { headers: { Authorization: `Bearer ${t.key}` } });
const text = await res.text();
if (!res.ok) {
  console.error(`Request failed (${res.status}): ${text.slice(0, 400)}`);
  process.exit(1);
}
const json = JSON.parse(text);
const list = (json.data ?? json.models ?? []).map((m) => m.id ?? m.name).filter(Boolean).sort();
console.log(`${list.length} models available via ${provider}:\n`);
console.log(list.join('\n'));
