/**
 * AgentUp Browser Use 真窗剧场：现代光晕指针 + 呼吸边框 + 点击高亮。
 * 由 Playwright MCP --init-script 注入；监听 CDP 下发的 mousemove/mousedown。
 * 指针与呼吸边框常驻，避免用户把受控窗当成私人浏览器。
 */
(function agentupBrowserTheater() {
  if (window.__agentupTheaterInstalled) return;
  window.__agentupTheaterInstalled = true;

  var HOST_ID = "agentup-browser-theater-host";
  if (document.getElementById(HOST_ID)) return;

  var host = document.createElement("div");
  host.id = HOST_ID;
  host.setAttribute("data-agentup-theater", "1");
  // 盖在所有内容上，但不抢事件
  host.style.cssText =
    "all:initial;position:fixed;inset:0;z-index:2147483646;pointer-events:none;overflow:hidden;";

  var root = host.attachShadow({ mode: "open" });
  root.innerHTML =
    "<style>" +
    ":host{all:initial}" +
    "*{box-sizing:border-box}" +
    /* 视口呼吸边框：柔光晕 + 内外辉光标识「本页正被 AgentUp 控制」 */
    ".frame{" +
    "position:fixed;inset:0;pointer-events:none;z-index:0;" +
    "border:2px solid rgba(255,106,0,.88);" +
    "border-radius:3px;" +
    "box-shadow:" +
    "inset 0 0 24px rgba(255,106,0,.22)," +
    "inset 0 0 48px rgba(255,106,0,.12)," +
    "0 0 16px rgba(255,106,0,.35)," +
    "0 0 36px rgba(255,106,0,.22);" +
    "animation:agentup-breathe 2.4s ease-in-out infinite;" +
    "opacity:.9}" +
    "@keyframes agentup-breathe{" +
    "0%,100%{" +
    "opacity:.52;" +
    "border-color:rgba(255,106,0,.55);" +
    "box-shadow:inset 0 0 14px rgba(255,106,0,.14),inset 0 0 28px rgba(255,106,0,.08),0 0 10px rgba(255,106,0,.22),0 0 22px rgba(255,106,0,.12)" +
    "}" +
    "50%{" +
    "opacity:1;" +
    "border-color:rgba(255,106,0,.95);" +
    "box-shadow:inset 0 0 32px rgba(255,106,0,.32),inset 0 0 56px rgba(255,106,0,.16),0 0 22px rgba(255,106,0,.48),0 0 48px rgba(255,106,0,.28)" +
    "}}" +
    /* 现代箭头：外层光晕呼吸 + 内层实体指针；大位移用 glide 过渡（自动化 hover 瞬移时可见滑动） */
    ".cursor{" +
    "position:absolute;width:36px;height:36px;left:0;top:0;" +
    "transform:translate(24px,24px);opacity:1;" +
    "will-change:transform,filter;" +
    "z-index:2;" +
    "animation:agentup-cursor-breathe 2.4s ease-in-out infinite}" +
    ".cursor.glide{" +
    "transition:transform .32s cubic-bezier(.22,.61,.36,1)}" +
    ".cursor .glow{" +
    "position:absolute;left:-10px;top:-10px;width:48px;height:48px;" +
    "border-radius:50%;" +
    "background:radial-gradient(circle,rgba(255,106,0,.42) 0%,rgba(255,106,0,.16) 38%,rgba(255,106,0,0) 70%);" +
    "filter:blur(2px);" +
    "pointer-events:none}" +
    ".cursor svg{" +
    "position:relative;display:block;width:28px;height:28px;overflow:visible;" +
    "filter:drop-shadow(0 0 6px rgba(255,106,0,.55)) drop-shadow(0 1px 2px rgba(0,0,0,.4))}" +
    "@keyframes agentup-cursor-breathe{" +
    "0%,100%{filter:drop-shadow(0 0 4px rgba(255,106,0,.35))}" +
    "50%{filter:drop-shadow(0 0 12px rgba(255,106,0,.7))}}" +
    ".cursor.pulse{" +
    "animation:agentup-click-pulse .42s ease-out}" +
    "@keyframes agentup-click-pulse{" +
    "0%{filter:drop-shadow(0 0 0 rgba(255,106,0,.75)) drop-shadow(0 0 8px rgba(255,106,0,.5))}" +
    "100%{filter:drop-shadow(0 0 18px rgba(255,106,0,0)) drop-shadow(0 0 4px rgba(255,106,0,.35))}}" +
    ".hilite{" +
    "position:absolute;border:2px solid rgba(255,106,0,.95);border-radius:8px;" +
    "background:rgba(255,106,0,.1);" +
    "box-shadow:0 0 0 1px rgba(255,255,255,.55),0 0 14px rgba(255,106,0,.35);" +
    "opacity:0;transition:opacity .15s ease;pointer-events:none;z-index:1}" +
    ".hilite.visible{opacity:1}" +
    "</style>" +
    '<div class="frame" part="frame" aria-hidden="true"></div>' +
    '<div class="hilite" part="hilite"></div>' +
    '<div class="cursor" part="cursor" aria-hidden="true">' +
    '<div class="glow" aria-hidden="true"></div>' +
    '<svg viewBox="0 0 28 28" xmlns="http://www.w3.org/2000/svg">' +
    /* 白底橙边箭头，尖端对齐 (1,1) ≈ 屏幕坐标热点；外描边略软 */
    '<path d="M3 3 L3 22 L9.2 16.5 L13.8 25.2 L17.2 23.6 L12.4 14.6 L20.5 14.6 Z" ' +
    'fill="#fff" stroke="#ff6a00" stroke-width="1.6" stroke-linejoin="round"/>' +
    "</svg></div>";

  var cursor = root.querySelector(".cursor");
  var hilite = root.querySelector(".hilite");
  var hiliteTimer = 0;
  var glideTimer = 0;
  var lastX = 24;
  var lastY = 24;
  /** 大位移阈值：CDP hover 常是瞬移，超过此距离则做 .glide 过渡。 */
  var GLIDE_MIN_PX = 48;

  function mount() {
    var parent = document.documentElement || document.body;
    if (!parent) return;
    if (!host.isConnected) parent.appendChild(host);
  }

  /**
   * 指针常驻。短距/拖拽跟手无过渡；自动化 hover 瞬移则加 .glide 滑过去。
   */
  function showCursor(x, y) {
    mount();
    var dx = x - lastX;
    var dy = y - lastY;
    var dist = Math.sqrt(dx * dx + dy * dy);
    lastX = x;
    lastY = y;
    if (dist >= GLIDE_MIN_PX) {
      cursor.classList.add("glide");
      if (glideTimer) clearTimeout(glideTimer);
      glideTimer = setTimeout(function () {
        cursor.classList.remove("glide");
        glideTimer = 0;
      }, 360);
    } else {
      cursor.classList.remove("glide");
      if (glideTimer) {
        clearTimeout(glideTimer);
        glideTimer = 0;
      }
    }
    cursor.style.transform = "translate(" + x + "px," + y + "px)";
  }

  function pulse() {
    cursor.classList.remove("pulse");
    void cursor.offsetWidth;
    cursor.classList.add("pulse");
  }

  function highlightTarget(el) {
    if (!el || el === document.documentElement || el === document.body) {
      hilite.classList.remove("visible");
      return;
    }
    try {
      var rect = el.getBoundingClientRect();
      if (!rect || rect.width < 1 || rect.height < 1) {
        hilite.classList.remove("visible");
        return;
      }
      mount();
      hilite.style.left = rect.left - 3 + "px";
      hilite.style.top = rect.top - 3 + "px";
      hilite.style.width = rect.width + 6 + "px";
      hilite.style.height = rect.height + 6 + "px";
      hilite.classList.add("visible");
      if (hiliteTimer) clearTimeout(hiliteTimer);
      hiliteTimer = setTimeout(function () {
        hilite.classList.remove("visible");
      }, 900);
    } catch (_) {
      hilite.classList.remove("visible");
    }
  }

  function onMove(e) {
    showCursor(e.clientX, e.clientY);
  }

  function onDown(e) {
    showCursor(e.clientX, e.clientY);
    pulse();
    highlightTarget(e.target);
  }

  document.addEventListener("mousemove", onMove, true);
  document.addEventListener("mousedown", onDown, true);
  document.addEventListener("click", onDown, true);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount);
  } else {
    mount();
  }
  // 首屏就露出指针 + 边框，不必等第一次 CDP 移动
  showCursor(lastX, lastY);
})();
