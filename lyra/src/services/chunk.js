// Text chunking for ingestion.
//
// Splits on markdown-style headings and blank lines, then packs paragraphs into
// chunks of ~targetTokens (rough word≈token heuristic) with a little overlap so
// a concept that straddles a boundary is still retrievable. Each chunk keeps the
// nearest heading so citations can name a location.

const WORDS_PER_TOKEN = 0.75; // ~1.3 tokens/word; approximate for budgeting

function approxTokens(text) {
  return Math.ceil((text.trim().split(/\s+/).filter(Boolean).length) / WORDS_PER_TOKEN);
}

/**
 * @returns {Array<{ordinal:number, heading:string|null, text:string, tokens:number}>}
 */
export function chunkText(raw, { targetTokens = 220, overlapTokens = 30 } = {}) {
  const lines = String(raw).replace(/\r\n/g, '\n').split('\n');
  const blocks = [];
  let heading = null;
  let buf = [];
  const flush = () => { if (buf.join('\n').trim()) blocks.push({ heading, text: buf.join('\n').trim() }); buf = []; };

  for (const line of lines) {
    const h = line.match(/^\s{0,3}#{1,6}\s+(.*)$/);
    if (h) { flush(); heading = h[1].trim(); continue; }
    if (line.trim() === '') { flush(); continue; }
    buf.push(line);
  }
  flush();

  // Pack blocks into chunks under the token budget.
  const chunks = [];
  let cur = { heading: null, parts: [], tokens: 0 };
  const push = () => {
    if (!cur.parts.length) return;
    const text = cur.parts.join('\n\n');
    chunks.push({ ordinal: chunks.length, heading: cur.heading, text, tokens: approxTokens(text) });
  };

  for (const b of blocks) {
    const t = approxTokens(b.text);
    if (cur.tokens && cur.tokens + t > targetTokens) {
      push();
      // carry a short overlap tail from the previous chunk
      const tail = cur.parts.length ? cur.parts[cur.parts.length - 1] : '';
      const overlap = tail.split(/\s+/).slice(-Math.round(overlapTokens * WORDS_PER_TOKEN)).join(' ');
      cur = { heading: b.heading ?? cur.heading, parts: overlap ? [overlap] : [], tokens: approxTokens(overlap) };
    }
    if (!cur.parts.length) cur.heading = b.heading ?? cur.heading;
    cur.parts.push(b.text);
    cur.tokens += t;
  }
  push();
  return chunks.filter((c) => c.text.trim().length > 0).map((c, i) => ({ ...c, ordinal: i }));
}
