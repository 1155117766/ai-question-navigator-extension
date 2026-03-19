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
        .replace(/^(你说|你說)[\s:：，,]*/i, "")
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

  function sortNodesInDomOrder(nodes) {
    return nodes.slice().sort((a, b) => {
      if (!(a instanceof Node) || !(b instanceof Node)) return 0;
      if (a === b) return 0;
      const pos = a.compareDocumentPosition(b);
      if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
      if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
      return 0;
    });
  }

  function getLiveUserNodes(platform) {
    if (platform === Platform.CHATGPT) {
      const turns = Array.from(document.querySelectorAll("article[data-testid*='conversation-turn'], [data-testid*='conversation-turn']"));
      const nodes = turns
        .map((turn) => (turn instanceof Element ? turn.querySelector("[data-message-author-role='user']") : null))
        .filter((n) => n instanceof Element && !n.closest(`#${EXT_ROOT_ID}`));
      return sortNodesInDomOrder(Array.from(new Set(nodes)));
    }

    if (platform === Platform.GEMINI) {
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
      return sortNodesInDomOrder(Array.from(new Set(nodes)));
    }

    return [];
  }

  function getScrollContainer() {
    const main = document.querySelector("main");
    if (main instanceof HTMLElement) {
      const st = window.getComputedStyle(main);
      if (/(auto|scroll)/.test(st.overflowY || "") && main.scrollHeight > main.clientHeight + 40) return main;
    }
    return document.scrollingElement || document.documentElement;
  }

  function scrollElementToTop(target) {
    if (!(target instanceof HTMLElement)) return;

    const container = getScrollContainer();
    const viewportOffset = 16;
    const beforeTop = window.scrollY;

    if (container instanceof HTMLElement && container !== document.documentElement && container !== document.body) {
      const containerRect = container.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      const nextTop = container.scrollTop + (targetRect.top - containerRect.top) - viewportOffset;
      container.scrollTo({
        top: Math.max(0, nextTop),
        behavior: "smooth"
      });
      window.setTimeout(() => {
        const afterRect = target.getBoundingClientRect();
        const movedEnough = Math.abs(afterRect.top - targetRect.top) > 8;
        if (!movedEnough) {
          target.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      }, 180);
      return;
    }

    const targetTop = window.scrollY + target.getBoundingClientRect().top - viewportOffset;
    window.scrollTo({
      top: Math.max(0, targetTop),
      behavior: "smooth"
    });
    window.setTimeout(() => {
      const movedEnough = Math.abs(window.scrollY - beforeTop) > 8;
      if (!movedEnough) {
        target.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }, 180);
  }

  function focusTarget(el) {
    scrollElementToTop(el);
    el.classList.add("aqn-highlight");
    window.setTimeout(() => el.classList.remove("aqn-highlight"), 1200);
  }

  function pickBestCandidate(candidates, message, totalCount) {
    if (candidates.length === 0) return null;
    if (candidates.length === 1) return candidates[0];

    const occurrence = Math.max(1, Number(message.occurrence || 1));
    if (occurrence <= candidates.length) {
      return candidates[occurrence - 1];
    }

    const ratio = totalCount > 1 ? (message.index - 1) / (totalCount - 1) : 0;
    const targetIdx = Math.max(0, Math.min(candidates.length - 1, Math.round(ratio * (candidates.length - 1))));
    return candidates[targetIdx];
  }

  function findTargetByMessage(message, state) {
    const direct = document.getElementById(message.id) || document.querySelector(`[${ATTR_ANCHOR_ID}='${message.id}']`);
    if (direct instanceof HTMLElement) return direct;

    const targetCanonical = canonicalQuestionText(message.text);
    if (!targetCanonical) return null;

    const nodes = getLiveUserNodes(state.platform);
    const exact = [];
    const fuzzy = [];
    for (const node of nodes) {
      const raw = sanitizeText(state.platform, node.textContent || "");
      const canonical = canonicalQuestionText(raw);
      if (!canonical) continue;
      if (canonical === targetCanonical) {
        exact.push(node);
        continue;
      }
      // Fallback only for truncated/partially rendered text.
      if (canonical.startsWith(targetCanonical) || targetCanonical.startsWith(canonical)) {
        fuzzy.push(node);
      }
    }

    const candidates = exact.length > 0 ? exact : fuzzy;
    const best = pickBestCandidate(candidates, message, state.messages.length);
    if (best) ensureAnchor(best, message.id);
    return best;
  }

  async function scrollToMessage(message, state) {
    let target = findTargetByMessage(message, state);
    if (target) {
      focusTarget(target);
      return;
    }

    const container = getScrollContainer();
    if (!(container instanceof HTMLElement)) return;

    const maxScroll = Math.max(0, container.scrollHeight - container.clientHeight);
    if (maxScroll <= 0) return;

    const ratio = state.messages.length > 1 ? (message.index - 1) / (state.messages.length - 1) : 0;
    const approx = Math.max(0, Math.min(maxScroll, Math.floor(maxScroll * ratio)));
    const positions = [
      approx,
      Math.max(0, approx - Math.floor(maxScroll * 0.2)),
      Math.min(maxScroll, approx + Math.floor(maxScroll * 0.2)),
      0,
      maxScroll
    ];

    for (const pos of positions) {
      container.scrollTop = pos;
      await new Promise((resolve) => window.setTimeout(resolve, 140));
      target = findTargetByMessage(message, state);
      if (target) {
        focusTarget(target);
        return;
      }
    }
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

  function isFreshComposerPage(platform) {
    if (platform === Platform.CHATGPT) {
      const path = window.location.pathname || "/";
      const isNewChatPath = path === "/" || /^\/\?.*$/.test(path);
      const hasConversationPath = /\/c\/[a-z0-9-]+/i.test(path);
      const hasUserMessages = getLiveUserNodes(platform).length > 0;
      const hasComposer =
        document.querySelector("form textarea") ||
        document.querySelector("[contenteditable='true']") ||
        document.querySelector("textarea[placeholder]");
      return !hasConversationPath && isNewChatPath && !!hasComposer && !hasUserMessages;
    }

    if (platform === Platform.GEMINI) {
      const hasUserMessages = getLiveUserNodes(platform).length > 0;
      const hasComposer =
        document.querySelector("rich-textarea textarea") ||
        document.querySelector("textarea") ||
        document.querySelector("[contenteditable='true']");
      return !!hasComposer && !hasUserMessages;
    }

    return false;
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
    const occurrenceMap = new Map();

    turns.forEach((turn) => {
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

      const occurrence = (occurrenceMap.get(canonical) || 0) + 1;
      occurrenceMap.set(canonical, occurrence);
      const id = hashMessage(canonical, occurrence, sessionId);
      ensureAnchor(userRoot, id);
      out.push({ id, text: canonical, short: shortText(canonical), index: out.length + 1, occurrence });
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
    const occurrenceMap = new Map();

    unique.forEach((node) => {
      const raw = sanitizeText(Platform.GEMINI, node.textContent || "");
      const canonical = canonicalQuestionText(raw);
      if (!canonical) return;
      if (/^Q\s*\d+[\s:：.-]+/i.test(normalizeText(raw))) return;
      if (seenCanonical.has(canonical)) return;
      seenCanonical.add(canonical);

      const occurrence = (occurrenceMap.get(canonical) || 0) + 1;
      occurrenceMap.set(canonical, occurrence);
      const id = hashMessage(canonical, occurrence, sessionId);
      ensureAnchor(node, id);
      out.push({ id, text: canonical, short: shortText(canonical), index: out.length + 1, occurrence });
    });

    return out;
  }

  function collectMessages(platform, sessionId) {
    if (platform === Platform.CHATGPT) return collectChatGPTMessages(sessionId);
    if (platform === Platform.GEMINI) return collectGeminiMessages(sessionId);
    return [];
  }

  function render(state) {
    const messages = state.messages;
    const list = document.getElementById("aqn-list");
    const count = document.getElementById("aqn-count");
    const floating = document.getElementById("aqn-float");
    if (!list || !count) return;

    const mobile = window.matchMedia("(max-width: 820px)").matches;
    const minH = mobile ? 170 : 150;
    const maxH = mobile ? Math.min(Math.floor(window.innerHeight * 0.66), 462) : Math.min(Math.floor(window.innerHeight * 0.605), 396);
    const baseH = mobile ? 92 : 84;
    const perItemH = mobile ? 56 : 48;
    const targetH = Math.max(minH, Math.min(maxH, baseH + Math.max(messages.length, 1) * perItemH));
    floating?.style.setProperty("--aqn-open-height", `${targetH}px`);

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
      goto.addEventListener("click", () => {
        void scrollToMessage(m, state);
      });
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

    render(state);

    const floating = document.getElementById("aqn-float");
    const handle = document.getElementById("aqn-handle");
    const panel = document.getElementById("aqn-panel");

    let lastHref = location.href;
    let scanTimer = null;

    const refresh = () => {
      if (isFreshComposerPage(state.platform)) {
        if (state.messages.length > 0) {
          state.messages = [];
          render(state);
        }
        return;
      }

      const next = collectMessages(state.platform, state.sessionId);
      if (sameMessages(next, state.messages)) return;
      state.messages = next;
      render(state);
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
      state.messages = [];
      render(state);
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
