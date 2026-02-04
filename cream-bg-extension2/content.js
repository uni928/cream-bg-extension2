(() => {
  // ====== 設定 ======
  let CREAM = "rgb(255, 243, 214)"; // #FFF3D6
  let BLACK = "rgb(18, 18, 18)";    // 真っ黒より少し柔らかい黒
const DARK_PAGE_THRESHOLD = 255 - 80;
  const THRESHOLD = 160;              // 0-255: これ以上を「薄い=クリーム」、未満を「濃い=黒」
  const ALPHA_MIN = 0.12;             // 透明すぎる色は無視
  const MAX_NODES_PER_TICK = 500;     // 負荷対策（1フレームあたり処理上限）
  const OBSERVE_MUTATIONS = true;

  if(isDarkThemePage()) {
  //CREAM = "rgb(18, 18, 18)";
  //BLACK = "rgb(255, 243, 214)";
  }

  // 変換対象の CSS プロパティ（“単色”になりやすいもの）
  const COLOR_PROPS = [
    "color",
    "background-color",
    "border-top-color",
    "border-right-color",
    "border-bottom-color",
    "border-left-color",
    "outline-color",
    "text-decoration-color",
    "caret-color",
    "column-rule-color",
    "box-shadow",    // 単色影なら置換（複雑な場合はスキップしがち）
    "text-shadow"    // 同上
  ];

  // SVG 等（アイコン）の単色対応（fill/stroke が rgb/rgba で取れる場合だけ）
  const SVG_PROPS = ["fill", "stroke"];

  // 既に適用した要素（再処理減らす）
  const touched = new WeakSet();

  // ====== 色パース＆判定 ======
  function parseRgbOrRgba(str) {
    if (!str) return null;
    const s = str.trim().toLowerCase();
    if (s === "transparent") return null;

    const m = s.match(
      /^rgba?\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)(?:\s*\/\s*([0-9.]+)\s*)?(?:\s*,\s*([0-9.]+))?\s*\)$/
    );
    // ↑ 一部ブラウザの "rgb(r g b / a)" っぽい表記も拾えるように軽くケア
    if (!m) return null;

    const r = clamp255(Number(m[1]));
    const g = clamp255(Number(m[2]));
    const b = clamp255(Number(m[3]));
    const aRaw = m[4] ?? m[5];
    const a = aRaw == null ? 1 : clamp01(Number(aRaw));
    if (a < ALPHA_MIN) return null;

    return { r, g, b, a };
  }

  function parseRgb(str) {
    if (!str) return null;
    const s = str.trim().toLowerCase();
    if (s === "transparent") return null;

    const m = s.match(
      /^rgba?\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)(?:\s*,\s*([0-9.]+))?\s*\)$/
    );
    if (!m) return null;

    const r = clamp255(m[1]);
    const g = clamp255(m[2]);
    const b = clamp255(m[3]);
    const a = m[4] == null ? 1 : clamp01(m[4]);
    if (a < ALPHA_MIN) return null;

    return { r, g, b };
  }

  // ====== ★ 追加：ダークテーマ判定 ======
  function isDarkThemePage() {
    const bodyBg = getComputedStyle(document.body).backgroundColor;
    const htmlBg = getComputedStyle(document.documentElement).backgroundColor;

    const c1 = parseRgb(bodyBg);
    const c2 = parseRgb(htmlBg);

    const candidates = [c1, c2].filter(Boolean);
    if (candidates.length === 0) return false;

    // どちらかが十分暗ければ「ダークテーマ」
    return candidates.some(c => luma(c) > DARK_PAGE_THRESHOLD);
  }

  function clamp255(n) {
    n = Number.isFinite(n) ? n : 0;
    return Math.max(0, Math.min(255, n));
  }
  function clamp01(n) {
    n = Number.isFinite(n) ? n : 0;
    return Math.max(0, Math.min(1, n));
  }

  // “薄い/濃い”判定：簡易輝度（Rec.601）
  function luma({ r, g, b }) {
    return 0.299 * r + 0.587 * g + 0.114 * b;
  }

  function toTwoTone(colorStr) {
    const c = parseRgbOrRgba(colorStr);
    if (!c) return null;
    return luma(c) >= THRESHOLD ? CREAM : BLACK;
  }

  // ====== box-shadow / text-shadow の単色置換（簡易） ======
  // 影の色部分が rgb/rgba で含まれている場合のみ置換。複数影でも対応（ただし複雑な表記はスキップされることあり）
  function replaceShadowsTwoTone(shadowStr) {
    if (!shadowStr || shadowStr === "none") return null;
    // rgb(...) / rgba(...) を拾って 2 値化して差し替える（単純置換）
    const re = /rgba?\([^)]+\)/gi;
    let changed = false;
    const out = shadowStr.replace(re, (m) => {
      const tt = toTwoTone(m);
      if (!tt) return m;
      changed = true;
      return tt;
    });
    return changed ? out : null;
  }

  // ====== 適用ロジック ======
  function shouldSkip(el) {
    if (!(el instanceof Element)) return true;
    const tag = el.tagName;
    if (tag === "SCRIPT" || tag === "STYLE" || tag === "NOSCRIPT") return true;
    // 既に処理済み（ただし動的変更に追随したいならここを外す/弱める）
    if (touched.has(el)) return true;
    return false;
  }

  function setImportant(el, prop, value) {
    // style.setProperty(prop, value, 'important') で !important を付けられる
    el.style.setProperty(prop, value, "important");
  }

  function processElement(el) {
    if (shouldSkip(el)) return;

    const cs = getComputedStyle(el);

    // 小さすぎる要素まで触ると崩れが増えるので軽い保険（必要なら外してOK）
    const rect = el.getBoundingClientRect();
    const tiny = rect.width < 8 || rect.height < 8;

    // 1) 通常の色プロパティ
    for (const prop of COLOR_PROPS) {
      if (prop === "box-shadow" || prop === "text-shadow") continue;

      const val = cs.getPropertyValue(prop);
      const tt = toTwoTone(val);
      if (!tt) continue;

      // 背景系は tiny だと崩れやすいので控えめに
      if (tiny && prop.includes("background")) continue;

      setImportant(el, prop, tt);
    }

    // 2) shadows
    const bs = replaceShadowsTwoTone(cs.getPropertyValue("box-shadow"));
    if (bs) setImportant(el, "box-shadow", bs);

    const ts = replaceShadowsTwoTone(cs.getPropertyValue("text-shadow"));
    if (ts) setImportant(el, "text-shadow", ts);

    // 3) SVG の fill / stroke（Element に対して computedStyle で取れる範囲）
    // ※ img（ラスター）は無理。inline svg の単色っぽいところだけ効く
    for (const prop of SVG_PROPS) {
      const val = cs.getPropertyValue(prop);
      const tt = toTwoTone(val);
      if (!tt) continue;
      setImportant(el, prop, tt);
    }

    // 4) 背景画像/グラデは “単色” じゃないので基本そのまま（ここで消すこともできる）
    // 例: 2色化を徹底したいなら ↓ を ON にするとかなり強烈に二値化するが、崩れやすい
    // if (cs.backgroundImage && cs.backgroundImage !== "none") {
    //   setImportant(el, "background-image", "none");
    // }

    touched.add(el);
  }

  function scan(root = document.documentElement) {
    const all = root.querySelectorAll("*");
    let i = 0;

    function tick() {
      const end = Math.min(all.length, i + MAX_NODES_PER_TICK);
      for (; i < end; i++) processElement(all[i]);
      if (i < all.length) requestAnimationFrame(tick);
    }
    tick();
  }

  // 初回：全走査
  scan();

  // SPA 対応：追加ノードだけ処理
  if (OBSERVE_MUTATIONS) {
    const mo = new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const n of m.addedNodes) {
          if (!(n instanceof Element)) continue;

          processElement(n);

          // 追加要素配下も適度に（重いページ対策で上限）
          const kids = n.querySelectorAll?.("*");
          if (!kids) continue;
          let count = 0;
          for (const k of kids) {
            processElement(k);
            if (++count > 400) break;
          }
        }
      }
    });

    mo.observe(document.documentElement, { childList: true, subtree: true });
  }
})();

