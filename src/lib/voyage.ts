/**
 * Voyage AI embeddings client (Anthropic 推奨パートナー)。
 * https://docs.voyageai.com/reference/embeddings-api
 */
import { fetch } from 'undici';
import { env } from './env.js';

export const VOYAGE_MODEL = 'voyage-3-large';
export const VOYAGE_MAX_TOKENS_PER_INPUT = 32_000;
export const VOYAGE_DIM = 1024;

type EmbedResponse = {
  data: Array<{ embedding: number[]; index: number }>;
  model: string;
  usage: { total_tokens: number };
};

export type InputType = 'document' | 'query';

export async function embed(
  inputs: string[],
  inputType: InputType = 'document',
): Promise<{ embeddings: number[][]; tokens: number }> {
  if (!env.VOYAGE_API_KEY) {
    throw new Error('VOYAGE_API_KEY is not set');
  }
  if (inputs.length === 0) return { embeddings: [], tokens: 0 };

  const res = await fetch('https://api.voyageai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.VOYAGE_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: VOYAGE_MODEL,
      input: inputs,
      input_type: inputType,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Voyage API ${res.status}: ${text.slice(0, 500)}`);
  }
  const data = (await res.json()) as EmbedResponse;
  const sorted = [...data.data].sort((a, b) => a.index - b.index);
  return { embeddings: sorted.map((d) => d.embedding), tokens: data.usage.total_tokens };
}

/**
 * Float32Array(1024) ↔ BLOB 変換。SQLite に保存する際に使う。
 */
export function vectorToBlob(vec: number[]): Buffer {
  const f = new Float32Array(vec);
  return Buffer.from(f.buffer, f.byteOffset, f.byteLength);
}

export function blobToVector(buf: Buffer): Float32Array {
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
}

export function cosine(a: Float32Array | number[], b: Float32Array | number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    dot += av * bv;
    na += av * av;
    nb += bv * bv;
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-12);
}
