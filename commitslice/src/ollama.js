import { ollamaEndpoint, readOcoConfig } from './opencommitConfig.js';

// Thin Ollama chat wrapper. It mirrors opencommit's OllamaEngine: POST /api/chat,
// stream:false, temperature 0 / top_p 0.1, reading model and URL from oco's config so
// both commitslice and oco hit the exact same local model.
export async function chat(messages, { model, temperature = 0, topP = 0.1, timeoutMs = 30000, json = false } = {}) {
  const ep = ollamaEndpoint(readOcoConfig());
  const body = {
    model: model || ep.model,
    messages,
    options: { temperature, top_p: topP },
    stream: false
  };
  if (json) body.format = 'json';

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${ep.base}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    if (!res.ok) throw new Error(`ollama ${res.status} ${res.statusText}`);
    const data = await res.json();
    return data?.message?.content ?? '';
  } finally {
    clearTimeout(timer);
  }
}

export async function pingOllama(timeoutMs = 3000) {
  const ep = ollamaEndpoint(readOcoConfig());
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${ep.base}/api/tags`, { signal: controller.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export function ollamaInfo() {
  return ollamaEndpoint(readOcoConfig());
}
