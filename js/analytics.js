/* Vercel Web Analytics for the public website: page views and visitors, no cookies. It only runs where Vercel
   serves the site (the /_vercel/insights script exists only there), never on GitHub Pages, locally, in tests,
   or inside claude.ai. The script and its reports stay on the site's own address, so the security policy
   (script-src 'self', connect-src 'self') allows them. */
(function (root) {
  'use strict';
  const host = root.location && root.location.hostname;
  if (!host || !/(^|\.)universalstudyguide\.com$|\.vercel\.app$/.test(host)) return;
  if (root.claude) return;
  root.va = root.va || function () { (root.vaq = root.vaq || []).push(arguments); };
  const s = document.createElement('script');
  s.defer = true; s.src = '/_vercel/insights/script.js';
  document.head.appendChild(s);
})(typeof window !== 'undefined' ? window : globalThis);
