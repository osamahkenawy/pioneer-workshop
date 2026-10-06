import React from 'react';

/**
 * HtmlPreview — renders author-supplied HTML inside a sandboxed iframe.
 *
 * Email templates and legal pages are deliberately HTML, so they cannot simply
 * be rendered as text. They used to go through dangerouslySetInnerHTML, which
 * executed any <script> or onerror= in the previewing admin's own session and
 * origin.
 *
 * A sandboxed iframe keeps the markup exactly as authored — images, tables and
 * inline styles all still render, which matters for email — while `sandbox=""`
 * (no allow-* flags) blocks scripts, forms, popups and top-level navigation and
 * puts the document in an opaque origin with no access to the parent.
 */
export default function HtmlPreview({ html, dir = 'ltr', minHeight = 200, style }) {
  const doc = `<!DOCTYPE html><html dir="${dir === 'rtl' ? 'rtl' : 'ltr'}"><head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: https:; style-src 'unsafe-inline'; font-src data: https:">
<style>body{margin:0;padding:0;font-family:Inter,system-ui,sans-serif;font-size:14px;line-height:1.7;color:#374151}</style>
</head><body>${html || ''}</body></html>`;

  return (
    <iframe
      title="preview"
      sandbox=""
      srcDoc={doc}
      style={{ width: '100%', minHeight, border: 0, display: 'block', ...style }}
    />
  );
}
