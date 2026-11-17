import tiktoken from '@dqbd/tiktoken';

const { get_encoding } = tiktoken;

// Same cl100k_base encoder opencommit uses, so commitslice's token math stays identical to
// oco's MAX_REQUEST_TOKENS budget. The full `@dqbd/tiktoken` entry loads the WASM from disk
// synchronously (the `/lite` entry would need an ESM wasm-module import that plain node rejects).
let encoding;

function encoder() {
  if (!encoding) encoding = get_encoding('cl100k_base');
  return encoding;
}

export function countTokens(text) {
  if (!text) return 0;
  return encoder().encode(text).length;
}
