/* Share links: on the public website (no shared database), a student shares a set of notes as a link.
   The link itself carries the notes' study cards, study guide and (optionally) the notes text, compressed:
     https://www.universalstudyguide.com/#get--<payload>
   Nothing is uploaded anywhere. Opening the link shows a preview and "Add to my notes".
   Payload: "z" + base64url(deflate-raw(JSON)) where the browser can compress, else "u" + base64url(JSON).
   JSON: { v: 1, t: title, c: course, k: [[type, front, back, term, topic], …], g: guide text, n: notes text }.
   A link can come from anyone, so it is size-limited, checked field by field (SharedLibrary.cleanBody) and
   shown escaped, exactly like the shared library. */
(function (root) {
  'use strict';
  const { U, Store } = root.MSG;
  const MAX_LINK = 2000000;      // characters we're willing to read from a link
  const MAX_JSON = 3000000;      // characters after decompressing (stops "zip bombs")
  const LONG_LINK = 8000;        // above this some chat apps cut links

  /* ---------- encoding ---------- */
  const b64url = (bytes) => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
  const unb64url = (str) => { const s = atob(str.replace(/-/g, '+').replace(/_/g, '/')); const out = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i); return out; };
  const canZip = () => typeof root.CompressionStream === 'function' && typeof root.DecompressionStream === 'function';
  async function pipe(bytes, stream, cap) {
    const reader = new Blob([bytes]).stream().pipeThrough(stream).getReader();
    const parts = []; let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (cap && size > cap) { reader.cancel(); throw new Error('too big'); }
      parts.push(value);
    }
    const out = new Uint8Array(size); let o = 0; parts.forEach((p) => { out.set(p, o); o += p.length; });
    return out;
  }

  /* The payload for a note: its cards, its AI study guide, and the notes text if asked. */
  async function encode(note, withNotes) {
    const cards = Store.cardsForNote(note.id).slice(0, 400).map((c) => [c.type, c.front, c.back, c.term || '', c.topic || '']);
    const data = { v: 1, t: String(note.title).slice(0, 120), c: String(note.course || '').slice(0, 100), k: cards, g: note.guide || '', n: withNotes ? String(note.content).slice(0, 80000) : '' };
    const bytes = new TextEncoder().encode(JSON.stringify(data));
    return canZip() ? 'z' + b64url(await pipe(bytes, new root.CompressionStream('deflate-raw'))) : 'u' + b64url(bytes);
  }
  /* The link's contents, checked; throws if it isn't a readable share link. */
  async function decode(payload) {
    const p = String(payload || '');
    if (p.length < 2 || p.length > MAX_LINK || !/^[zu][A-Za-z0-9_-]+$/.test(p)) throw new Error('bad');
    let bytes = unb64url(p.slice(1));
    if (p[0] === 'z') { if (!canZip()) throw new Error('old browser'); bytes = await pipe(bytes, new root.DecompressionStream('deflate-raw'), MAX_JSON); }
    const o = JSON.parse(new TextDecoder().decode(bytes));
    if (!o || o.v !== 1 || !Array.isArray(o.k)) throw new Error('bad');
    const b = root.MSG.SharedLibrary.cleanBody({ cards: o.k.map((x) => (Array.isArray(x) ? { type: x[0], front: x[1], back: x[2], term: x[3] || null, topic: x[4] } : null)), guide: o.g, notes: o.n, course: o.c });
    b.title = (typeof o.t === 'string' ? o.t : '').slice(0, 120).trim() || 'Shared notes';
    return b;
  }

  const base = () => location.origin + location.pathname;
  root.MSG.ShareLinks = { encode, decode, base, LONG_LINK, canZip };
})(typeof window !== 'undefined' ? window : globalThis);
