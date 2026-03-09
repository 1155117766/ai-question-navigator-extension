(() => {
  const EXT_ROOT_ID = "aqn-root";
  const ATTR_ANCHOR_ID = "data-aqn-anchor-id";

  const Platform = {
    CHATGPT: "chatgpt",
    GEMINI: "gemini",
    UNKNOWN: "unknown"
  };

  function hostMatches(host, expectedHost) {
    return host === expectedHost || host.endsWith(`.${expectedHost}`);
  }

  function detectPlatform() {
    const host = window.location.hostname;
    if (hostMatches(host, "chatgpt.com") || hostMatches(host, "chat.openai.com")) return Platform.CHATGPT;
    if (hostMatches(host, "gemini.google.com")) return Platform.GEMINI;
    return Platform.UNKNOWN;
  }

  function normalizeText(text) {
    return (text || "").replace(/\s+/g, " ").trim();
  }

  function shortText(text, maxLen = 120) {
    if (text.length <= maxLen) return text;
    return `${text.slice(0, maxLen - 1)}…`;
  }

  function sanitizeText(platform, text) {
    let out = normalizeText(text);
    if (!out) return "";
    if (platform === Platform.GEMINI) {
      out = out
        .replace(/\b(copy|copied|edit|retry|share)\b/gi, "")
        .replace(/复制|已复制|编辑|重试|分享/g, "")
        .trim();
    }
    return out;
  }

  function canonicalQuestionText(text) {
    return normalizeText(text)
      .replace(/^[\u200B-\u200D\uFEFF\s]+/g, "")
      .replace(/^(Q\s*\d+[\s:：.-]*)+/i, "")
      .trim();
  }

  function ensureAnchor(node, id) {
    if (!node.getAttribute(ATTR_ANCHOR_ID)) {
      node.setAttribute(ATTR_ANCHOR_ID, id);
      node.id = id;
    }
  }

  function hashMessage(text, idx, sessionId) {
    const base = `${sessionId}::${text}::${idx}`;
    let h = 0;
    for (let i = 0; i < base.length; i += 1) {
      h = (h << 5) - h + base.charCodeAt(i);
      h |= 0;
    }
    return `aqn-msg-${Math.abs(h)}`;
  }

  function getSessionId(platform) {
    const search = new URLSearchParams(window.location.search);
    const queryId =
      search.get("conversation_id") ||
      search.get("conversationId") ||
      search.get("chatId") ||
      search.get("id") ||
      "";

    if (queryId) return `${platform}-${queryId}`;

    const path = window.location.pathname || "/";
    const slug = path.replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "") || "home";
    return `${platform}-${slug}`;
  }

  function createRoot() {
    if (document.getElementById(EXT_ROOT_ID)) return;
    const root = document.createElement("div");
    root.id = EXT_ROOT_ID;
    root.innerHTML = `
      <div id="aqn-float" class="aqn-collapsed" role="complementary" aria-label="Question navigator">
        <button id="aqn-handle" title="导航">
          <span class="aqn-handle-mark"></span>
          <span class="aqn-handle-title">导航</span>
          <span id="aqn-count" class="aqn-count">0</span>
        </button>
        <aside id="aqn-panel">
          <ul id="aqn-list"></ul>
        </aside>
      </div>
    `;
    document.body.appendChild(root);
  }

  function collectChatGPTMessages(sessionId) {
    const turns = Array.from(document.querySelectorAll("article[data-testid*='conversation-turn'], [data-testid*='conversation-turn']"));
    const out = [];
    const seenCanonical = new Set();

    turns.forEach((turn, idx) => {
      if (!(turn instanceof Element)) return;
      const userRoot = turn.querySelector("[data-message-author-role='user']");
      if (!(userRoot instanceof Element)) return;
      if (userRoot.closest(`#${EXT_ROOT_ID}`)) return;

      const textNode = userRoot.querySelector("[data-message-content='true'], .whitespace-pre-wrap") || userRoot;
      const raw = sanitizeText(Platform.CHATGPT, textNode.textContent || userRoot.textContent || "");
      const canonical = canonicalQuestionText(raw);
      if (!canonical) return;
      if (/^Q\s*\d+[\s:：.-]+/i.test(normalizeText(raw))) return;
      if (seenCanonical.has(canonical)) return;
      seenCanonical.add(canonical);

      const id = hashMessage(canonical, idx, sessionId);
      ensureAnchor(userRoot, id);
      out.push({ id, text: canonical, short: shortText(canonical), index: out.length + 1 });
    });

    return out;
  }

  function collectGeminiMessages(sessionId) {
    const selectors = [
      "user-query",
      "[data-test-id='user-query']",
      "[class*='user-query']",
      "message-content[is-user]",
      "[data-author='user']"
    ];

    const nodes = [];
    selectors.forEach((s) => {
      try {
        document.querySelectorAll(s).forEach((n) => {
          if (n instanceof Element && !n.closest(`#${EXT_ROOT_ID}`)) nodes.push(n);
        });
      } catch (_err) {}
    });

    const unique = Array.from(new Set(nodes));
    const out = [];
    const seenCanonical = new Set();

    unique.forEach((node, idx) => {
      const raw = sanitizeText(Platform.GEMINI, node.textContent || "");
      const canonical = canonicalQuestionText(raw);
      if (!canonical) return;
      if (/^Q\s*\d+[\s:：.-]+/i.test(normalizeText(raw))) return;
      if (seenCanonical.has(canonical)) return;
      seenCanonical.add(canonical);

      const id = hashMessage(canonical, idx, sessionId);
      ensureAnchor(node, id);
      out.push({ id, text: canonical, short: shortText(canonical), index: out.length + 1 });
    });

    return out;
  }

  function collectMessages(platform, sessionId) {
    if (platform === Platform.CHATGPT) return collectChatGPTMessages(sessionId);
    if (platform === Platform.GEMINI) return collectGeminiMessages(sessionId);
    return [];
  }

  function scrollToMessage(id) {
    const target = document.getElementById(id) || document.querySelector(`[${ATTR_ANCHOR_ID}='${id}']`);
    if (!target) return;
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    target.classList.add("aqn-highlight");
    window.setTimeout(() => target.classList.remove("aqn-highlight"), 1200);
  }

  function render(messages) {
    const list = document.getElementById("aqn-list");
    const count = document.getElementById("aqn-count");
    if (!list || !count) return;

    count.textContent = String(messages.length);
    list.innerHTML = "";

    if (messages.length === 0) {
      const empty = document.createElement("li");
      empty.className = "aqn-empty";
      empty.textContent = "当前未识别到用户问题";
      list.appendChild(empty);
      return;
    }

    messages.forEach((m) => {
      const li = document.createElement("li");
      li.className = "aqn-item";
      const goto = document.createElement("button");
      goto.className = "aqn-goto";
      goto.textContent = `Q${m.index}  ${m.short}`;
      goto.title = m.text;
      goto.addEventListener("click", () => scrollToMessage(m.id));
      li.appendChild(goto);
      list.appendChild(li);
    });
  }

  function sameMessages(a, b) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) {
      if (a[i].id !== b[i].id || a[i].text !== b[i].text) return false;
    }
    return true;
  }

  function init() {
    const platform = detectPlatform();
    if (platform === Platform.UNKNOWN) return;

    if (!document.body) {
      window.setTimeout(init, 120);
      return;
    }

    createRoot();

    const state = {
      platform,
      sessionId: getSessionId(platform),
      messages: []
    };

    const floating = document.getElementById("aqn-float");
    const handle = document.getElementById("aqn-handle");
    const panel = document.getElementById("aqn-panel");

    let lastHref = location.href;
    let scanTimer = null;

    const refresh = () => {
      const next = collectMessages(state.platform, state.sessionId);
      if (sameMessages(next, state.messages)) return;
      state.messages = next;
      render(state.messages);
    };

    const scheduleRefresh = (delay = 100) => {
      if (scanTimer) window.clearTimeout(scanTimer);
      scanTimer = window.setTimeout(() => {
        scanTimer = null;
        refresh();
      }, delay);
    };

    const onRouteChanged = () => {
      const href = location.href;
      if (href === lastHref) return;
      lastHref = href;
      state.sessionId = getSessionId(state.platform);
      scheduleRefresh(90);
      window.setTimeout(refresh, 360);
      window.setTimeout(refresh, 780);
    };

    handle?.addEventListener("click", (e) => {
      e.preventDefault();
      floating?.classList.add("aqn-open");
    });

    floating?.addEventListener("mouseenter", () => {
      floating.classList.add("aqn-open");
    });

    floating?.addEventListener("mouseleave", (event) => {
      const nextTarget = event.relatedTarget;
      if (nextTarget instanceof Node && floating.contains(nextTarget)) return;
      floating.classList.remove("aqn-open");
    });

    panel?.addEventListener("mouseleave", () => {
      floating?.classList.remove("aqn-open");
    });

    refresh();

    const observer = new MutationObserver(() => {
      onRouteChanged();
      scheduleRefresh(90);
    });

    observer.observe(document.body || document.documentElement, {
      childList: true,
      subtree: true
    });

    window.addEventListener("popstate", onRouteChanged);

    const cleanup = () => {
      observer.disconnect();
      window.removeEventListener("popstate", onRouteChanged);
      if (scanTimer) {
        window.clearTimeout(scanTimer);
        scanTimer = null;
      }
    };

    window.addEventListener("pagehide", cleanup, { once: true });
    window.addEventListener("beforeunload", cleanup, { once: true });
  }

  init();
})();
