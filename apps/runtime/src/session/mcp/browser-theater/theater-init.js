/**
 * AgentUp Browser Use 真窗剧场：模拟鼠标 + 点击高亮。
 * 由 Playwright MCP --init-script 注入；监听 CDP 下发的 mousemove/mousedown。
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
    ".cursor{" +
    "position:absolute;width:22px;height:22px;margin:-4px 0 0 -4px;" +
    "border-radius:50%;border:2px solid #ff6a00;background:rgba(255,106,0,.22);" +
    "box-shadow:0 0 0 2px rgba(255,255,255,.85),0 2px 10px rgba(0,0,0,.28);" +
    "opacity:0;transform:translate(-100px,-100px);transition:opacity .12s ease;" +
    "will-change:transform,opacity}" +
    ".cursor.visible{opacity:1}" +
    ".cursor .dot{" +
    "position:absolute;left:50%;top:50%;width:6px;height:6px;margin:-3px 0 0 -3px;" +
    "border-radius:50%;background:#ff6a00}" +
    ".cursor.pulse{" +
    "animation:agentup-pulse .38s ease-out}" +
    "@keyframes agentup-pulse{" +
    "0%{box-shadow:0 0 0 2px rgba(255,255,255,.85),0 0 0 0 rgba(255,106,0,.45)}" +
    "100%{box-shadow:0 0 0 2px rgba(255,255,255,.55),0 0 0 18px rgba(255,106,0,0)}}" +
    ".hilite{" +
    "position:absolute;border:2px solid #ff6a00;border-radius:6px;" +
    "background:rgba(255,106,0,.12);box-shadow:0 0 0 1px rgba(255,255,255,.7);" +
    "opacity:0;transition:opacity .15s ease;pointer-events:none}" +
    ".hilite.visible{opacity:1}" +
    "</style>" +
    '<div class="hilite" part="hilite"></div>' +
    '<div class="cursor" part="cursor"><div class="dot"></div></div>';

  var cursor = root.querySelector(".cursor");
  var hilite = root.querySelector(".hilite");
  var hideTimer = 0;
  var hiliteTimer = 0;

  function mount() {
    var parent = document.documentElement || document.body;
    if (!parent) return;
    if (!host.isConnected) parent.appendChild(host);
  }

  function showCursor(x, y) {
    mount();
    cursor.style.transform = "translate(" + x + "px," + y + "px)";
    cursor.classList.add("visible");
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(function () {
      cursor.classList.remove("visible");
      cursor.classList.remove("pulse");
    }, 1600);
  }

  function pulse() {
    cursor.classList.remove("pulse");
    // 强制重启动画
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
})();
