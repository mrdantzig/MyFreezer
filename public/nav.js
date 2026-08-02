(function renderNav() {
  const container = document.getElementById("nav");
  if (!container) return;

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (ch) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[ch]));
  }

  const token = localStorage.getItem("authToken");
  const nickname = escapeHtml(localStorage.getItem("nickname") || "");
  const path = location.pathname.split("/").pop() || "index.html";

  const MENU = [
    { href: "dashboard.html", icon: "🏠", label: "대시보드" },
    { href: "index.html", icon: "📷", label: "재료 인식" },
    { href: "step2.html", icon: "🍳", label: "레시피생성" },
    { href: "my-recipes.html", icon: "📕", label: "나의 레시피" },
    { href: "profile.html", icon: "👤", label: "프로필" },
    { href: "share.html", icon: "🎁", label: "추천" },
  ];

  const menuHtml = MENU.map((item) => {
    const isCurrent = item.href === path;
    return `<a href="${item.href}" class="menu-item${isCurrent ? " current" : ""}"><span class="menu-icon">${item.icon}</span>${item.label}</a>`;
  }).join("");

  const rightHtml = token
    ? `<span class="user-chip">👤 ${nickname || ""}</span><button type="button" id="logout-btn" class="logout-btn">로그아웃</button>`
    : `<a href="login.html" class="menu-item${path === "login.html" ? " current" : ""}">로그인</a><a href="signup.html" class="menu-item${path === "signup.html" ? " current" : ""}">회원가입</a>`;

  container.className = "app-header";
  container.innerHTML = `
    <div class="header-top">
      <a href="index.html" class="brand">🔍 <span>FridgeChef</span></a>
      <div class="header-right">${rightHtml}</div>
    </div>
    <nav class="header-menu">${menuHtml}</nav>
  `;

  const logoutBtn = document.getElementById("logout-btn");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", async () => {
      try {
        await fetch("/api/auth/logout", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        });
      } catch {
        // 네트워크 오류여도 클라이언트 세션은 정리한다.
      }
      localStorage.removeItem("authToken");
      localStorage.removeItem("nickname");
      location.href = "index.html";
    });
  }
})();
