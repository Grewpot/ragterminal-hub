/* Loaded synchronously right after the site header on every page.
   Restores the signed-in state from localStorage before the first paint, so the
   account button never flashes "Sign In" -> "My profile" -> "@name" while you
   move between Discover, Community and Download. header-auth.js (and Community's
   auth-ui.js) then verify and refresh it in the background. */
(function () {
  "use strict";
  var CACHE_KEY = "ragterminal.header-account.v1";
  var root = document.documentElement;
  var button = document.getElementById("header-signin") || document.getElementById("signin");
  var store = null;
  try { store = window.localStorage; } catch (error) { /* storage blocked: fall back to live auth */ }

  function sessionUserId() {
    if (!store) return null;
    try {
      for (var i = 0; i < store.length; i++) {
        var key = store.key(i);
        if (!/^sb-.+-auth-token$/.test(key)) continue;
        var session = JSON.parse(store.getItem(key) || "null");
        var user = session && (session.user || (session.currentSession && session.currentSession.user));
        if (user && user.id) return user.id;
      }
    } catch (error) { /* unreadable session: treat as signed out */ }
    return null;
  }
  function cachedLabel(uid) {
    if (!store) return "";
    try {
      var saved = JSON.parse(store.getItem(CACHE_KEY) || "null");
      return saved && saved.uid === uid && typeof saved.label === "string" ? saved.label : "";
    } catch (error) { return ""; }
  }
  function saveLabel(uid, label) {
    try { store.setItem(CACHE_KEY, JSON.stringify({ uid: uid, label: label })); } catch (error) { /* ignore */ }
  }
  function clearLabel() {
    try { store.removeItem(CACHE_KEY); } catch (error) { /* ignore */ }
  }

  function showSignedIn(uid, label, persist) {
    root.classList.add("hub-authed");
    if (button) {
      button.textContent = label;
      button.title = "Manage your community profile";
      button.setAttribute("aria-label", "Open your community profile");
      if (button.tagName === "A") button.href = "/community.html?auth=signin";
    }
    if (persist && store) saveLabel(uid, label);
  }
  function showSignedOut() {
    root.classList.remove("hub-authed");
    if (store) clearLabel();
    if (button) {
      button.textContent = "Sign In";
      button.title = "Sign in to your RAGTerminal Hub account";
      button.setAttribute("aria-label", "Sign in");
      if (button.tagName === "A") button.href = "/community.html?auth=signin";
    }
  }

  window.ragHubHeaderAccount = { signedIn: showSignedIn, signedOut: showSignedOut, cachedLabel: cachedLabel };

  var uid = sessionUserId();
  if (uid) showSignedIn(uid, cachedLabel(uid) || "My profile", false);
  else if (store) clearLabel();

  // Community owns its own #signin button through auth-ui.js; mirror its result so
  // the other pages know the @username immediately after signing in or out there.
  if (button && button.id === "signin") {
    window.addEventListener("ragHubAuthChanged", function () {
      var text = (button.textContent || "").trim();
      var id = sessionUserId();
      if (id && text && text.toLowerCase() !== "sign in") showSignedIn(id, text, true);
      else showSignedOut();
    });
  }

  // Prefetch the three primary destinations on hover/focus so navigation can start
  // from the browser cache. Respect data-saving preferences and only prefetch once.
  var prefetched = Object.create(null);
  var tabPaths = { "/": true, "/index.html": true, "/community.html": true, "/download.html": true };
  function normalizePath(path) { return path === "/index.html" ? "/" : path; }
  function prefetchTab(anchor) {
    if (!anchor || !anchor.href || (navigator.connection && navigator.connection.saveData)) return;
    var url;
    try { url = new URL(anchor.href, window.location.href); } catch (error) { return; }
    if (url.origin !== window.location.origin || !tabPaths[url.pathname]) return;
    var path = normalizePath(url.pathname);
    if (path === normalizePath(window.location.pathname) || prefetched[path]) return;
    prefetched[path] = true;
    var hint = document.createElement("link");
    hint.rel = "prefetch";
    hint.href = path;
    document.head.appendChild(hint);
  }
  document.querySelectorAll(".top .links a").forEach(function (anchor) {
    anchor.addEventListener("pointerenter", function () { prefetchTab(anchor); }, { passive: true });
    anchor.addEventListener("focus", function () { prefetchTab(anchor); }, { passive: true });
  });
})();
