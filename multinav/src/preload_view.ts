import { ipcRenderer, contextBridge } from 'electron';

ipcRenderer.send('view:hello');

function forward(ev: any) {
  ipcRenderer.send('view:inputEvent', ev);
}

function install() {
  window.addEventListener('mousemove', (e) => {
    forward({ type: 'mouseMove', x: e.clientX, y: e.clientY, movementX: e.movementX, movementY: e.movementY });
  }, { capture: true, passive: true });

  window.addEventListener('mousedown', (e) => {
    const button = e.button === 2 ? 'right' : e.button === 1 ? 'middle' : 'left';
    forward({ type: 'mouseDown', x: e.clientX, y: e.clientY, button });
  }, { capture: true });

  window.addEventListener('mouseup', (e) => {
    const button = e.button === 2 ? 'right' : e.button === 1 ? 'middle' : 'left';
    forward({ type: 'mouseUp', x: e.clientX, y: e.clientY, button });
  }, { capture: true });

  window.addEventListener('wheel', (e) => {
    forward({ type: 'mouseWheel', x: e.clientX, y: e.clientY, deltaX: e.deltaX, deltaY: e.deltaY, canScroll: true });
  }, { capture: true, passive: true });

  window.addEventListener('keydown', (e) => {
    forward({ type: 'keyDown', keyCode: e.key });
  }, { capture: true });

  window.addEventListener('keypress', (e) => {
    if (e.key.length === 1) forward({ type: 'char', keyCode: e.key });
  }, { capture: true });

  window.addEventListener('keyup', (e) => {
    forward({ type: 'keyUp', keyCode: e.key });
  }, { capture: true });
}

try { install(); } catch {}
contextBridge.exposeInMainWorld('multinavView', true);
// --- Scraper registry ----------------------------------------------------
type EmitFn = (payload: any) => void;
function emit(payload: any) {
  ipcRenderer.send('view:content', payload);
}

function oncePerChange(fn: () => string | null, emit: EmitFn, meta: {provider: string, model?: string}) {
  let last = "";
  const fire = () => {
    try {
      const text = fn() || "";
      if (text && text !== last) {
        last = text;
        emit({ provider: meta.provider, model: meta.model || null, text, detectedAt: new Date().toISOString() });
      }
    } catch {}
  };
  const mo = new MutationObserver(() => fire());
  mo.observe(document.documentElement, { subtree: true, childList: true, characterData: true });
  // try an initial pass in case DOM is already populated
  setTimeout(fire, 1200);
}

// --- CHATGPT assistant-only scraper (tight, noise-trimmed) ---
function scrapeChatGPT(): string | null {
  // ChatGPT (chatgpt.com / chat.openai.com) marks assistant turns in various ways.
  // Priority: explicit role/testid, then semantic fallbacks.
  const ASSISTANT_SEL = [
    '[data-message-author-role="assistant"]',
    '[data-testid="conversation-turn"][data-message-author-role="assistant"]',
    '[data-testid="response-message"]',
    'div[class*="assistant"], article.assistant'
  ].join(',');

  const container =
    document.querySelector<HTMLElement>('main [data-testid="conversation-panel"], main, [role="main"], body') || document.body;

  const nodes = Array.from(container.querySelectorAll<HTMLElement>(ASSISTANT_SEL))
    .filter(el => {
      const s = getComputedStyle(el);
      return s.display !== "none" && s.visibility !== "hidden" && (el.innerText || "").trim().length > 0;
    });

  if (!nodes.length) return null;

  const last = nodes[nodes.length - 1];

  // Clone and strip UI chrome (copy buttons, toolbars, menus, code-header widgets, avatars, badges)
  const clone = last.cloneNode(true) as HTMLElement;
  const JUNK_SEL = [
    'button', 'svg', '[role="menu"]', '[role="toolbar"]',
    '[data-testid*="copy"]', '[data-testid*="menu"]', '[data-testid*="toolbar"]', '[data-testid*="actions"]',
    'pre [class*="copy"]', 'pre [class*="toolbar"]', 'pre [data-testid*="copy"]',
    '[class*="timestamp"]', '[class*="avatar"]', '[class*="badge"]'
  ].join(',');

  clone.querySelectorAll(JUNK_SEL).forEach(n => n.remove());

  let text = (clone.innerText || "").trim();
  text = text
    .replace(/^\s*(Assistant|ChatGPT)\s*[:\-]\s*/i, "")
    .replace(/\b(Copy|Share|Report|More)\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n");

  if (!text || text.length < 3) return null;
  return text;
}


// --- GEMINI assistant-only scraper (tight, noise-trimmed) ---
function scrapeGemini(): string | null {
  // Gemini (gemini.google.com) uses c-wiz and data blocks; assistant messages often live in article/sections.
  const ASSISTANT_SEL = [
    '[data-author="assistant"]',
    '[data-role="assistant"]',
    'c-wiz[role="region"] article',
    'article[role="article"]',
    '[data-mdx-block][data-message-author-role="assistant"]',
    'div[class*="assistant"]'
  ].join(',');

  const container =
    document.querySelector<HTMLElement>('main, [role="main"], c-wiz[role="main"], body') || document.body;

  const nodes = Array.from(container.querySelectorAll<HTMLElement>(ASSISTANT_SEL))
    .filter(el => {
      const s = getComputedStyle(el);
      return s.display !== "none" && s.visibility !== "hidden" && (el.innerText || "").trim().length > 0;
    });

  if (!nodes.length) return null;

  const last = nodes[nodes.length - 1];

  // Strip UI chrome (toolbars, copy/share, menus, code headers, avatars, timestamps)
  const clone = last.cloneNode(true) as HTMLElement;
  const JUNK_SEL = [
    'button', 'svg', '[role="menu"]', '[role="toolbar"]',
    '[aria-label*="Copy"]', '[aria-label*="Share"]', '[aria-label*="More"]',
    '[data-tooltip*="Copy"]', '[data-tooltip*="Share"]', '[data-tooltip*="More"]',
    'pre [class*="copy"]', 'pre [class*="toolbar"]',
    '[class*="timestamp"]', '[class*="avatar"]', '[class*="badge"]'
  ].join(',');

  clone.querySelectorAll(JUNK_SEL).forEach(n => n.remove());

  let text = (clone.innerText || "").trim();
  text = text
    .replace(/^\s*(Assistant|Gemini)\s*[:\-]\s*/i, "")
    .replace(/\b(Copy|Share|More|Report)\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n");

  if (!text || text.length < 3) return null;
  return text;
}


// Copilot (copilot.microsoft.com / bing.com/chat)
function scrapeCopilot(): string | null {
  const nodes = document.querySelectorAll<HTMLElement>('[aria-live="polite"], .adaptive-card, .contentContainer, .response-message');
  for (let i = nodes.length - 1; i >= 0; i--) {
    const t = nodes[i].innerText.trim();
    if (t) return t;
  }
  return null;
}

// --- GROK.com assistant-only scraper (tight, noise-trimmed) ---
function scrapeGrok(): string | null {
  // Candidate selectors that reliably tag ASSISTANT blocks on grok.com.
  // We try explicit data-* first, then fall back to class hints that include "assistant".
  const ASSISTANT_SEL = [
    '[data-testid="assistant-message"]',
    '[data-author="assistant"]',
    '[data-variant="assistant"]',
    '[data-role="assistant"]',
    // common fallbacks:
    'article.assistant',
    'div[class*="assistant"]',
    'section[class*="assistant"]'
  ].join(',');

  // Prefer messages inside the main conversation container if present.
  const container = document.querySelector<HTMLElement>('[data-testid="conversation"], main, #__next') || document.body;

  // Collect all candidate assistant nodes within container
  const nodes = Array.from(container.querySelectorAll<HTMLElement>(ASSISTANT_SEL))
    // keep only visible & with some textual content
    .filter(el => {
      const style = window.getComputedStyle(el);
      if (style.visibility === "hidden" || style.display === "none") return false;
      // quick text presence check (before deep-clean)
      return (el.innerText || "").trim().length > 0;
    });

  if (!nodes.length) return null;

  // Take the LAST assistant message (the newest in the chat)
  const last = nodes[nodes.length - 1];

  // Deep-clean: clone the node, remove UI chrome (buttons, toolbars, menus, icons, code copy, etc.)
  const clone = last.cloneNode(true) as HTMLElement;
  const JUNK_SEL = [
    'button',
    'svg',
    '[role="menu"]',
    '[role="toolbar"]',
    '[data-testid*="copy"]',
    '[data-testid*="menu"]',
    '[data-testid*="toolbar"]',
    '[data-testid*="actions"]',
    // code block chrome
    'pre [class*="copy"]',
    'pre [class*="toolbar"]',
    // timestamps / avatars / badges
    '[class*="timestamp"]',
    '[class*="avatar"]',
    '[class*="badge"]'
  ].join(',');

  clone.querySelectorAll(JUNK_SEL).forEach(n => n.remove());

  // Extract text and normalize whitespace
  let text = (clone.innerText || "").trim();

  // Remove common UI labels the site sometimes injects
  text = text
    .replace(/^\s*(Assistant|Grok)\s*[:\-]\s*/i, "")        // leading "Assistant: "
    .replace(/\b(Copy|Share|Report|More)\b/gi, "")          // stray control words
    .replace(/\s{2,}/g, " ")                                // compress spaces
    .replace(/\n{3,}/g, "\n\n");                            // compress linebreaks

  // If text is still too short, treat as no new assistant content
  if (!text || text.length < 3) return null;
  return text;
}


// Generic fallback: look for longest "chat-like" container growing
function scrapeGeneric(): string | null {
  const all = Array.from(document.querySelectorAll<HTMLElement>('main, article, [role="main"], body'));
  let best = "";
  for (const el of all) {
    const t = el.innerText.trim();
    if (t.length > best.length) best = t;
  }
  return best || null;
}

(function bootScraper() {
  const host = location.hostname;
  if (/chatgpt\.com|chat\.openai\.com/i.test(host)) {
    oncePerChange(scrapeChatGPT, emit, { provider: 'chatgpt' });
    return;
  }
  if (/gemini\.google\.com/i.test(host)) {
    oncePerChange(scrapeGemini, emit, { provider: 'gemini' });
    return;
  }
  if (/copilot\.microsoft\.com|bing\.com/i.test(host)) {
    oncePerChange(scrapeCopilot, emit, { provider: 'copilot' });
    return;
  }
if (/grok\.com|chat\.x\.ai/i.test(host)) {
  oncePerChange(scrapeGrok, emit, { provider: 'grok' });
  return;
  }

  // default
  oncePerChange(scrapeGeneric, emit, { provider: 'generic' });
})();

