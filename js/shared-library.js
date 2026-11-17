/* Shared library: students and teachers publish a set of notes (its study cards and its AI-made guide)
   for everyone who can open the claude.ai version, and anyone can add a shared guide to their own notes.

   Storage (the claude.ai `db` capability; see the rules passed when publishing, in DEVELOPMENT.md):
     library/<authorId>                    index document { guides: [summary, …] } — one per author
     library/<authorId>/guides/<guideId>   the shared guide { title, subject, level, by, cards, guide, notes }
   Everyone reads; each author writes only under their own id; the site's owner can remove any guide.
   Shared data is written by other people, so every field is checked and capped on read, and shown escaped.
   Routes: #library, #share (pick notes), #share--<noteId>, #shared--<guideId>. */
(function (root) {
  'use strict';
  const { U, Store, Library, Modes, Guides } = root.MSG;
  const esc = U.esc;
  // The claude.ai page, for links people can send (inside claude.ai the page runs on a sandbox address).
  const SITE_URL = 'https://claude.ai/artifact/UKoHcpR26SUxNA5ccNJ1vR';
  const LEVELS = ['Elementary', 'Middle school', 'High school', 'AP & IB', 'College'];
  const MAX_GUIDES_PER_AUTHOR = 50;

  let ui = null;
  const L = { state: 'idle', db: null, me: null, owner: false, canShare: null, index: [], bodies: {}, unsub: null, slow: false };

  /* ---------- reading shared data safely ---------- */
  const str = (v, max) => (typeof v === 'string' ? v : v == null ? '' : String(v)).slice(0, max);
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const okId = (v) => typeof v === 'string' && /^[a-z0-9]{6,40}$/.test(v);
  function cleanMeta(m, uid) {
    if (!m || !okId(m.id)) return null;
    const level = Number.isInteger(m.level) && m.level >= 0 && m.level <= 4 ? m.level : null;
    return { id: m.id, uid, title: str(m.title, 120) || 'Untitled guide', subject: str(m.subject, 60), level, by: str(m.by, 40) || 'A student',
      cards: Math.max(0, Math.min(999, num(m.cards))), checks: Math.max(0, Math.min(99, num(m.checks))), hasGuide: !!m.hasGuide, updatedAt: num(m.updatedAt) };
  }
  function cleanBody(b) {
    if (!b) return null;
    const cards = (Array.isArray(b.cards) ? b.cards : []).filter((c) => c && c.front != null && c.back != null).slice(0, 400).map((c) => ({
      type: ['qa', 'def', 'cloze', 'problem'].includes(c.type) ? c.type : 'qa', front: str(c.front, 2000), back: str(c.back, 2000),
      term: c.term == null ? null : str(c.term, 200), topic: str(c.topic, 200), work: c.work == null ? undefined : str(c.work, 2000) }));
    return { cards, guide: str(b.guide, 60000), notes: str(b.notes, 80000), course: str(b.course, 100) };
  }

  /* ---------- connecting ---------- */
  function available() { return !!(root.MSG.Sync && root.MSG.Sync.inClaude); }
  async function connect() {
    if (L.state !== 'idle') return;
    if (!available()) { L.state = 'off'; return; }
    L.state = 'loading';
    let db = null, user = null;
    try { [db, user] = await Promise.all([root.claude.use('db'), root.claude.use('user')]); } catch (e) { /* unavailable below */ }
    if (!db || !user) { L.state = 'signedout'; rerender(); return; }
    L.db = db;
    try { L.me = await user.id(); } catch (e) { L.me = null; }
    try { L.owner = !!(await user.isOwner()); } catch (e) { L.owner = false; }
    try { L.canShare = await user.can('data.write'); } catch (e) { L.canShare = null; }
    const timer = setTimeout(() => { L.slow = true; rerender(); }, 10000);
    L.unsub = db.collection('library').onSnapshot((snap) => {
      const list = [];
      snap.docs.forEach((d) => { const g = d.data() && d.data().guides; if (Array.isArray(g)) g.slice(0, MAX_GUIDES_PER_AUTHOR).forEach((m) => { const c = cleanMeta(m, d.id); if (c) list.push(c); }); });
      L.index = list.sort((a, b) => b.updatedAt - a.updatedAt);
      if (!snap.metadata.fromCache) { clearTimeout(timer); L.slow = false; }
      L.state = 'ok'; rerender();
    }, () => { clearTimeout(timer); L.state = 'error'; rerender(); });
  }
  function rerender() { if (/^#(library|share|shared|get)\b/.test(location.hash)) ui.route(); }
  async function body(meta) {
    if (L.bodies[meta.id]) return L.bodies[meta.id];
    const snap = await L.db.doc('library/' + meta.uid + '/guides/' + meta.id).get();
    const b = snap.exists ? cleanBody(snap.data()) : null;
    if (b) L.bodies[meta.id] = b;
    return b;
  }
  const mine = (m) => m.uid === L.me;
  const canRemove = (m) => mine(m) || L.owner;

  /* ---------- views ---------- */
  function offView(title) {
    const msg = L.state === 'signedout' ? 'Sign in to claude.ai to see the shared library.'
      : 'The shared library lives on the claude.ai version of this site, where everyone has an account to share from.';
    return `<div class="page-head"><div><h1>${esc(title)}</h1></div></div><div class="card empty"><p>📚 ${msg}</p>
      ${L.state === 'off' ? `<p class="muted">Open the claude.ai version to browse guides that students and teachers have shared, or to share your own.</p><a class="btn primary" href="${SITE_URL}#library" target="_blank" rel="noopener">Open the shared library ↗</a>` : ''}</div>`;
  }
  function loadingNote() {
    if (L.state === 'error') return '<p class="feedback bad small">The library couldn\'t be loaded right now. Try again later.</p>';
    if (L.slow) return '<p class="muted small">Still loading the library… it may be out of date.</p>';
    return L.state === 'loading' || L.state === 'idle' ? '<p class="muted">Loading the library…</p>' : '';
  }
  function guideCard(m) {
    const subj = String(m.subject).toLowerCase().replace(/&/g, '').replace(/[^a-z]+/g, '-').replace(/^-|-$/g, '');
    return `<a class="card cat-card lib-card" data-subject="${esc(subj)}" href="#shared--${m.id}"><span class="cat-icon">${m.hasGuide ? '📘' : '🃏'}</span><span>
      <b>${esc(m.title)}</b>
      <span class="small muted">${m.subject ? esc(m.subject) : 'Any subject'}${m.level != null ? ' · ' + LEVELS[m.level] : ''}</span>
      <span class="small">${ui.plural(m.cards, 'card')}${m.hasGuide ? ' · study guide' : ''}${m.checks ? ' · ' + ui.plural(m.checks, 'question') : ''}</span>
      <span class="small muted">Shared by ${esc(m.by)}${mine(m) ? ' (you)' : ''}</span></span></a>`;
  }
  /* ---------- public website: share links (js/share-links.js) ---------- */
  const SL = () => root.MSG.ShareLinks;
  function notesToShare(title, intro) {
    const notes = Store.current().notes;
    return `<div class="card stack"><h2>${title}</h2><p class="small">${intro}</p>
      ${notes.length ? `<ul class="list">${notes.map((n) => `<li><div><b>${esc(n.title)}</b> <span class="muted small">${ui.plural(Store.cardsForNote(n.id).length, 'card')}${n.guide ? ' · study guide' : ''}</span></div><a class="btn small primary" href="#share--${n.id}">🔗 Get share link</a></li>`).join('')}</ul>` : '<p class="muted">You don\'t have any notes yet. <a href="#notes-new">Add notes</a> first.</p>'}</div>`;
  }
  function linksLibraryView() {
    return `<div class="page-head"><div><h1>Shared library</h1><p class="muted">Share your notes with anyone, and add notes others share with you.</p></div></div>
      <div class="grid editor"><div class="stack">
        ${notesToShare('Share my notes with a link', 'Pick a set of notes to get a link. Anyone who opens it can see your study cards and study guide, and add them to their own notes. Your notes stay in your browser; the link carries a copy.')}
      </div><div class="stack">
        <div class="card stack"><h2>Got a link?</h2><p class="small">Just open the link a classmate or teacher sent you. It opens here with a preview and an <b>Add to my notes</b> button.</p></div>
        <div class="card stack"><h2>Browse everyone's guides</h2><p class="small">A library you can browse and search, with guides from students and teachers, is on the claude.ai version of this site.</p><a class="btn" href="${SITE_URL}#library" target="_blank" rel="noopener">Open the claude.ai library ↗</a></div>
      </div></div>`;
  }
  const LK = { key: '', link: '', busy: false };
  function shareLinkView(noteId) {
    const n = Store.note(noteId);
    if (!n) return ui.notFound();
    if (!Store.cardsForNote(n.id).length) return `<div class="card empty"><p>These notes have no study cards to share yet.</p><a class="btn" href="#note--${n.id}">Back to the notes</a></div>`;
    const withNotes = sessionGet('linkNotes') === '1';
    const key = n.id + '|' + withNotes + '|' + n.updatedAt + '|' + (n.guideAt || 0) + '|' + Store.cardsForNote(n.id).length;
    if (LK.key !== key && !LK.busy) {
      LK.busy = true;
      SL().encode(n, withNotes).then((p) => { LK.key = key; LK.link = SL().base() + '#get--' + p; LK.busy = false; rerender(); }, () => { LK.busy = false; LK.key = key; LK.link = ''; rerender(); });
    }
    const ready = LK.key === key;
    return `<div class="page-head"><div><a href="#note--${n.id}" class="muted small">← ${esc(n.title)}</a><h1>Share with a link</h1><p class="muted">Anyone who opens this link can see and add a copy of these notes. Leave out anything personal.</p></div></div>
      <div class="card stack narrow-wide">
        <p class="small">The link includes <b>${ui.plural(Store.cardsForNote(n.id).length, 'study card')}</b>${n.guide ? ' and your <b>study guide</b>' : ''}${withNotes ? ', and your <b>notes text</b>' : ''}.</p>
        <label class="check"><input type="checkbox" data-action="link-notes" ${withNotes ? 'checked' : ''}> Also include my notes text</label>
        ${!ready ? '<p class="muted">Making your link…</p>' : LK.link ? `<textarea id="shareLink" class="share-link" rows="3" readonly aria-label="Share link">${esc(LK.link)}</textarea>
          <div class="row"><button class="btn primary" type="button" data-action="link-copy">Copy link</button><a class="btn" href="${esc(LK.link)}" target="_blank" rel="noopener">Test it ↗</a></div>
          ${LK.link.length > SL().LONG_LINK ? `<p class="small feedback bad">This link is long (${LK.link.length.toLocaleString()} characters). It works in browsers and email, but some chat apps cut long links short. ${withNotes ? 'Leaving out the notes text makes it shorter.' : 'Sharing a smaller set of notes makes it shorter.'}</p>` : ''}
          <p class="small muted">Send it by text, email, Google Classroom or a class chat.</p>` : '<p class="feedback bad small">The link couldn\'t be made. Try again.</p>'}
      </div>`;
  }
  const GOT = {};
  function getView(payload) {
    const p = String(payload || '');
    if (!GOT[p]) { GOT[p] = { state: 'loading' }; SL().decode(p).then((b) => { GOT[p] = { state: 'ok', b }; rerender(); }, () => { GOT[p] = { state: 'bad' }; rerender(); }); }
    const g = GOT[p];
    if (g.state === 'loading') return '<div class="card empty"><p>Opening the shared notes…</p></div>';
    if (g.state === 'bad') return '<div class="card empty"><p>This share link isn\'t complete or can\'t be read.</p><p class="muted">Ask for the link again. Some apps cut long links short, so try sending it by email.</p><a class="btn" href="#dashboard">Go home</a></div>';
    const b = g.b;
    const guide = b.guide ? Guides.parseOne('link', b.guide) : null;
    const me = Store.current();
    const add = me ? '<button class="btn primary" data-action="link-add">+ Add to my notes</button>'
      : `<form class="start-form" data-form="create-profile" data-next="#get--${esc(p)}"><input name="name" required maxlength="40" placeholder="Your first name or nickname" aria-label="Your name"><button class="btn primary" type="submit">Start studying</button></form><p class="small muted">Make your profile to add these notes and study them.</p>`;
    return `<div class="topic-hero"><div><p class="eyebrow">Shared with you</p><h1><span class="cat-icon">${guide ? '📘' : '🃏'}</span>${esc(b.title)}</h1>
        <p class="muted">${ui.plural(b.cards.length, 'study card')}${guide ? ' · study guide' : ''}${b.notes ? ' · notes' : ''}</p>${add}</div></div>
      ${guide && guide.sections.length ? root.MSG.Study.guideHtml(guide, { src: 'link', title: 'Study guide' }) : ''}
      <div class="card"><h2>Study cards</h2><div class="card-list">${b.cards.slice(0, 30).map((c) => `<div class="card-row"><div class="cr-main"><div class="cr-front">${ui.fmt(c.front)}</div><div class="cr-back">${ui.fmt(c.back)}</div></div></div>`).join('')}</div>${b.cards.length > 30 ? `<p class="muted small">…and ${b.cards.length - 30} more.</p>` : ''}</div>
      ${b.notes ? `<details class="card"><summary>Notes</summary><div class="notes-body">${ui.md(b.notes)}</div></details>` : ''}`;
  }

  function libraryView() {
    connect();
    if (L.state === 'off') return linksLibraryView();
    if (['off', 'signedout'].includes(L.state)) return offView('Shared library');
    const q = (sessionGet('libFilter') || '').toLowerCase();
    const subj = sessionGet('libSubject') || 'all';
    const subjects = Array.from(new Set(L.index.map((m) => m.subject).filter(Boolean))).sort();
    const list = L.index.filter((m) => (subj === 'all' || m.subject === subj) && (!q || (m.title + ' ' + m.subject + ' ' + m.by).toLowerCase().includes(q)));
    const shareBtn = L.canShare === false ? '' : '<a class="btn primary" href="#share">+ Share my notes</a>';
    return `<div class="page-head"><div><h1>Shared library</h1><p class="muted">Study guides shared by students and teachers. Add any of them to your notes and study them every way.</p></div>${shareBtn}</div>
      ${loadingNote()}
      ${L.index.length ? `<div class="row"><input class="search" type="search" placeholder="Search the library…" value="${esc(q)}" data-input="lib-filter" aria-label="Search the library"></div>
        ${subjects.length > 1 ? `<div class="subject-chips">${['all'].concat(subjects).map((s) => `<button class="chip-btn ${subj === s ? 'active' : ''}" data-action="lib-subject" data-subject="${esc(s)}">${s === 'all' ? 'All subjects' : esc(s)}</button>`).join('')}</div>` : ''}
        <div class="grid three">${list.map(guideCard).join('') || '<p class="muted">No guides match.</p>'}</div>`
        : L.state === 'ok' ? `<div class="card empty"><p>📚 No guides shared yet.</p><p class="muted">Be the first: share a set of your notes, with its study cards and study guide.</p>${shareBtn}</div>` : ''}
      ${L.canShare === false ? '<p class="small muted">To share your own notes here, ask the person who shared this page with you for Contributor access.</p>' : ''}`;
  }
  function sharePickView() {
    connect();
    if (L.state === 'off') return `<div class="page-head"><div><a href="#library" class="muted small">← Shared library</a><h1>Share my notes</h1></div></div>` + notesToShare('Pick notes to share', 'You\'ll get a link that anyone can open to add a copy of these notes.');
    if (['off', 'signedout'].includes(L.state)) return offView('Share to the library');
    const notes = Store.current().notes;
    return `<div class="page-head"><div><a href="#library" class="muted small">← Shared library</a><h1>Share to the library</h1><p class="muted">Pick a set of notes. Its study cards, and its study guide if it has one, are shared.</p></div></div>
      ${notes.length ? `<div class="card"><ul class="list">${notes.map((n) => `<li><div><b>${esc(n.title)}</b> <span class="muted small">${ui.plural(Store.cardsForNote(n.id).length, 'card')}${n.guide ? ' · study guide' : ''}${n.sharedId ? ' · shared' : ''}</span></div><a class="btn small ${n.sharedId ? '' : 'primary'}" href="#share--${n.id}">${n.sharedId ? 'Update' : 'Share'}</a></li>`).join('')}</ul></div>`
        : '<div class="card empty"><p>You don\'t have any notes yet.</p><a class="btn primary" href="#notes-new">Add notes</a></div>'}`;
  }
  function shareView(noteId) {
    connect();
    if (L.state === 'off') return shareLinkView(noteId);
    if (['off', 'signedout'].includes(L.state)) return offView('Share to the library');
    const n = Store.note(noteId);
    if (!n) return ui.notFound();
    const cards = Store.cardsForNote(n.id);
    const prev = n.sharedId && L.index.find((m) => m.id === n.sharedId && mine(m));
    const cat = Library.get(n.categoryId);
    const subjects = Library.groups().map((g) => g.subject);
    const subjNow = prev ? prev.subject : cat ? cat.subject : '';
    const levelNow = prev ? prev.level : cat ? cat.band : null;
    if (!cards.length) return `<div class="card empty"><p>These notes have no study cards to share yet.</p><a class="btn" href="#note--${n.id}">Back to the notes</a></div>`;
    return `<div class="page-head"><div><a href="#note--${n.id}" class="muted small">← ${esc(n.title)}</a><h1>${prev ? 'Update your shared guide' : 'Share to the library'}</h1></div></div>
      <form class="card stack narrow" data-form="lib-share" data-id="${n.id}">
        <label>Title<input id="libTitle" name="title" required maxlength="120" value="${esc(prev ? prev.title : n.title)}"></label>
        <label>Subject<select id="libSubject" name="subject"><option value="">Choose a subject</option>${subjects.concat(['Other']).map((s) => `<option ${s === subjNow ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select></label>
        <label>Level<select id="libLevel" name="level"><option value="">Any level</option>${LEVELS.map((l, i) => `<option value="${i}" ${levelNow === i ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <label>Shown as "Shared by"<input id="libBy" name="by" required maxlength="40" value="${esc(prev ? prev.by : Store.current().name)}"></label>
        <label class="check"><input type="checkbox" name="notes" id="libNotes"> Also share my original notes text</label>
        <p class="small">Shares <b>${ui.plural(cards.length, 'study card')}</b>${n.guide ? ' and your <b>study guide</b>' : ''}. ${n.guide ? '' : 'Tip: make a study guide for these notes first (on the notes page) so others get one too.'}</p>
        <p class="small muted">Everyone who can open this site can read what you share, so leave out anything personal. You can update it or stop sharing at any time.</p>
        <p class="form-error" role="alert" hidden></p>
        <div class="row"><button class="btn primary" type="submit">${prev ? 'Update shared guide' : 'Share'}</button>${prev ? `<button class="btn ghost" type="button" data-action="lib-remove" data-id="${prev.id}">Stop sharing</button>` : ''}</div>
      </form>`;
  }
  let viewing = null; // the guide id whose body is being fetched
  function sharedView(gid) {
    connect();
    if (['off', 'signedout'].includes(L.state)) return offView('Shared library');
    const m = L.index.find((x) => x.id === gid);
    if (!m) return `<div class="page-head"><div><a href="#library" class="muted small">← Shared library</a></div></div>${L.state === 'ok' ? '<div class="card empty"><p>This guide isn\'t in the library anymore.</p><a class="btn" href="#library">Browse the library</a></div>' : loadingNote()}`;
    const b = L.bodies[m.id];
    if (!b && viewing !== m.id) { viewing = m.id; body(m).then(() => { viewing = null; rerender(); }, () => { viewing = null; L.bodies[m.id] = { cards: [], guide: '', notes: '', course: '', failed: true }; rerender(); }); }
    const g = b && b.guide ? Guides.parseOne('shared_' + m.id, b.guide) : null;
    const link = SITE_URL + '#shared--' + m.id;
    return `<div class="topic-hero"><div><a href="#library" class="muted small no-print">← Shared library</a><h1><span class="cat-icon">${m.hasGuide ? '📘' : '🃏'}</span>${esc(m.title)}</h1>
        <p class="muted">${m.subject ? esc(m.subject) : 'Any subject'}${m.level != null ? ' · ' + LEVELS[m.level] : ''} · shared by ${esc(m.by)}${mine(m) ? ' (you)' : ''} · ${ui.plural(m.cards, 'card')}</p>
        <div class="row no-print"><button class="btn primary" data-action="lib-add" data-id="${m.id}" ${b && !b.failed ? '' : 'disabled'}>+ Add to my notes</button><button class="btn" data-action="lib-copy" data-link="${esc(link)}">🔗 Copy link</button>${canRemove(m) ? `<button class="btn ghost" data-action="lib-remove" data-id="${m.id}">${mine(m) ? 'Stop sharing' : 'Remove from library'}</button>` : ''}</div>
        <p class="small muted no-print">Teachers: send this link to your class. Everyone who opens it gets the cards and guide, and their progress stays private.</p></div></div>
      ${!b ? '<p class="muted">Loading the guide…</p>' : b.failed ? '<div class="card empty"><p>This guide couldn\'t be loaded. Try again later.</p></div>' : `
        ${g && g.sections.length ? root.MSG.Study.guideHtml(g, { src: 'shared_' + m.id, title: 'Study guide' }) : ''}
        <div class="card"><h2>Study cards</h2><div class="card-list">${b.cards.slice(0, 30).map((c) => `<div class="card-row"><div class="cr-main"><div class="cr-front">${ui.fmt(c.front)}</div><div class="cr-back">${ui.fmt(c.back)}</div></div></div>`).join('')}</div>${b.cards.length > 30 ? `<p class="muted small">…and ${b.cards.length - 30} more. Add it to your notes to study them all.</p>` : ''}</div>
        ${b.notes ? `<details class="card"><summary>Original notes</summary><div class="notes-body">${ui.md(b.notes)}</div></details>` : ''}`}`;
  }
  function sessionGet(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } }
  function sessionSet(k, v) { try { sessionStorage.setItem(k, v); } catch (e) { /* ignore */ } }

  /* ---------- writing ---------- */
  async function share(f) {
    const n = Store.note(f.dataset.id);
    const errEl = f.querySelector('.form-error');
    const btn = f.querySelector('button[type=submit]');
    const fail = (msg) => { errEl.textContent = msg; errEl.hidden = false; btn.disabled = false; };
    if (!L.db || !L.me) { fail('The library isn\'t available right now.'); return; }
    errEl.hidden = true; btn.disabled = true;
    const gid = n.sharedId && /^[a-z0-9]{6,40}$/.test(n.sharedId) ? n.sharedId : U.uid().toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20).padEnd(8, '0');
    const cards = Store.cardsForNote(n.id).slice(0, 400).map((c) => ({ type: c.type, front: String(c.front).slice(0, 2000), back: String(c.back).slice(0, 2000), term: c.term || null, topic: c.topic || '', work: c.work || null }));
    const level = f.level.value === '' ? null : Number(f.level.value);
    const meta = { id: gid, title: f.title.value.trim().slice(0, 120), subject: f.subject.value.slice(0, 60), level, by: f.by.value.trim().slice(0, 40), cards: cards.length, hasGuide: !!n.guide, checks: n.guide ? (Modes.noteGuide(n) || { check: [] }).check.length : 0, updatedAt: Date.now() };
    const doc = Object.assign({}, meta, { course: n.course || '', cards, guide: n.guide || '', notes: f.notes.checked ? String(n.content).slice(0, 80000) : '' });
    while (JSON.stringify(doc).length > 240000 && (doc.notes || doc.cards.length > 50)) { if (doc.notes) doc.notes = ''; else doc.cards = doc.cards.slice(0, Math.floor(doc.cards.length * 0.8)); }
    meta.cards = doc.cards.length;
    try {
      await L.db.doc('library/' + L.me + '/guides/' + gid).set(doc);
      const idx = await L.db.doc('library/' + L.me).get();
      const list = (idx.exists && Array.isArray(idx.data().guides) ? idx.data().guides : []).filter((x) => x && x.id !== gid);
      if (list.length >= MAX_GUIDES_PER_AUTHOR) { await L.db.doc('library/' + L.me + '/guides/' + gid).delete(); fail('You can share up to ' + MAX_GUIDES_PER_AUTHOR + ' guides. Stop sharing an old one first.'); return; }
      await L.db.doc('library/' + L.me).set({ guides: [meta].concat(list), updatedAt: Date.now() });
      Store.setNoteShared(n.id, gid);
      delete L.bodies[gid];
      ui.toast(n.sharedId ? 'Shared guide updated' : 'Shared to the library 📚');
      ui.go('#shared--' + gid);
    } catch (e) {
      fail(e && e.code === 'quota_exceeded' ? 'The library is full right now. Ask the site\'s owner to remove old guides.' : e && e.code === 'invalid_argument' ? 'You don\'t have permission to share here. Ask the person who shared this page with you for Contributor access.' : 'Sharing didn\'t work. Check your connection and try again.');
    }
  }
  async function remove(gid) {
    const m = L.index.find((x) => x.id === gid);
    if (!m || !canRemove(m)) return;
    if (!(await ui.ask(mine(m) ? 'Stop sharing "' + m.title + '"? It will be removed from the library. Copies others already added stay in their notes.' : 'Remove "' + m.title + '" from the library?', mine(m) ? 'Stop sharing' : 'Remove'))) return;
    try {
      const idxRef = L.db.doc('library/' + m.uid);
      const idx = await idxRef.get();
      const list = (idx.exists && Array.isArray(idx.data().guides) ? idx.data().guides : []).filter((x) => x && x.id !== gid);
      await idxRef.set({ guides: list, updatedAt: Date.now() });
      await L.db.doc('library/' + m.uid + '/guides/' + gid).delete();
      Store.current().notes.forEach((n) => { if (n.sharedId === gid) Store.setNoteShared(n.id, null); });
      ui.toast('Removed from the library');
      ui.go('#library');
    } catch (e) { ui.toast('That didn\'t work. Try again.'); }
  }
  /* A shared guide becomes the student's own notes: its cards (written as "front :: back" lines, so editing
     the notes later keeps them) and its study guide. */
  async function addToMine(gid) {
    const m = L.index.find((x) => x.id === gid);
    const b = m && L.bodies[gid];
    if (!b || b.failed) return;
    addBody(m.title, b);
  }
  /* Shared notes (from the library or a link) become the student's own notes: the cards (written as
     "front :: back" lines, so editing the notes later keeps them) and the study guide. */
  function addBody(title, b) {
    const content = b.notes || b.cards.map((c) => String(c.front).replace(/\s*\n\s*/g, ' ') + ' :: ' + String(c.back).replace(/\s*\n\s*/g, ' ')).join('\n');
    const cards = b.notes ? root.MSG.parseNotes(b.notes, { title }) : b.cards;
    const note = Store.addNote({ title, course: b.course, categoryId: '', content }, cards.length ? cards : b.cards);
    if (b.guide) Store.setNoteGuide(note.id, b.guide);
    ui.toast('Added to My Notes ✨');
    ui.go('#note--' + note.id);
  }

  function init(helpers) {
    ui = helpers;
    return {
      views: { library: libraryView, share: (id) => (id ? shareView(id) : sharePickView()), shared: sharedView, get: getView },
      actions: {
        'lib-subject': (el) => { sessionSet('libSubject', el.dataset.subject); ui.route(); },
        'lib-remove': (el) => remove(el.dataset.id),
        'lib-add': (el) => addToMine(el.dataset.id),
        'link-add': () => { const p = location.hash.replace(/^#get--/, ''); const g = GOT[p]; if (g && g.b) addBody(g.b.title, g.b); },
        'link-notes': (el) => { sessionSet('linkNotes', el.checked ? '1' : '0'); ui.route(); },
        'link-copy': () => { const t = document.getElementById('shareLink'); (navigator.clipboard ? navigator.clipboard.writeText(t.value) : Promise.reject()).then(() => ui.toast('Link copied! Send it to anyone.'), () => { t.select(); ui.toast('Press Ctrl+C (or ⌘C) to copy the link.'); }); },
        'lib-copy': (el) => { const t = el.dataset.link; (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(() => ui.toast('Link copied. Send it to your class!'), () => ui.toast('Copy this link: ' + t)); }
      },
      forms: { 'lib-share': share }
    };
  }

  root.MSG.SharedLibrary = { init, cleanMeta, cleanBody, SITE_URL, state: L };
})(typeof window !== 'undefined' ? window : globalThis);
