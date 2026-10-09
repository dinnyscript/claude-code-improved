// A stand-in for claude.ai's chat layout (sidebar, thread, composer with a Send
// button in the bottom-right corner). Add ?mode=dark for claude.ai's dark theme.
module.exports = function mockClaudePage(url) {
  const u = new URL(url);
  const id = u.pathname.split('/').pop();
  const dark = u.searchParams.get('mode') === 'dark';
  const bg = dark ? '#262624' : '#faf9f5', side = dark ? '#1f1e1d' : '#f0eee6', fg = dark ? '#eee' : '#1f1f1f', bubble = dark ? '#141413' : '#f0eee6', card = dark ? '#30302e' : '#fff';
  return `<!doctype html><html data-mode="${dark ? 'dark' : 'light'}"><head><meta charset="utf-8"><title>${id === 'new' ? 'Claude' : 'Chat ' + id + ' - Claude'}</title><link rel="icon" href="/favicon.ico">
  <style>body{margin:0;font-family:system-ui,sans-serif;background:${bg};color:${fg}} .app{display:flex;height:100vh}
  nav{width:260px;background:${side};padding:16px;box-sizing:border-box} nav a{display:block;padding:6px 8px;border-radius:6px;color:inherit;text-decoration:none}
  main{flex:1;display:flex;flex-direction:column;position:relative} header{padding:12px 24px;font-weight:600;border-bottom:1px solid rgba(128,128,128,.2)}
  .thread{flex:1;overflow:auto;padding:24px 15%} .user{background:${bubble};padding:12px 16px;border-radius:12px;margin:12px 0 12px auto;max-width:70%}
  pre{background:${dark ? '#1a1a1a' : '#2b2b2b'};color:#ddd;padding:12px;border-radius:8px}
  .composer{margin:0 15% 20px;background:${card};border:1px solid rgba(128,128,128,.3);border-radius:16px;padding:14px;min-height:60px;display:flex;align-items:flex-end;gap:8px}
  textarea{flex:1;border:0;background:transparent;color:inherit;font:inherit;resize:none;outline:none} button{background:#c96442;color:#fff;border:0;border-radius:8px;padding:8px 12px}
  </style></head><body><div class="app"><nav><b>Claude</b><br><br><a href="/new">+ New chat</a><a href="/chat/aaaa-1111">Refactor auth module</a><a href="/chat/bbbb-2222">Trip planning</a><a href="/chat/cccc-3333">SQL perf question</a></nav>
  <main><header>Plan for ${id}</header><div class="thread" id="thread"><div class="user">How do I refactor this function so it's testable?</div>
  <div data-is-streaming="false"><p>Here's an approach: extract the side effects behind an interface and inject them.</p><pre>function save(db, user) {\n  return db.insert(user);\n}</pre><p>Then test with a fake db.</p></div></div>
  <div class="composer"><textarea id="composer" placeholder="Reply to Claude..."></textarea><button aria-label="Send message">↑</button></div></main></div></body></html>`;
};
