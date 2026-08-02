const token = localStorage.getItem("authToken");
if (!token) {
  location.href = "login.html";
}

const statTilesEl = document.getElementById("stat-tiles");
const folderChartEl = document.getElementById("folder-chart");
const chartEmptyEl = document.getElementById("chart-empty");

function tile({ label, value, delta, deltaGood, deltaEmptyText, href }) {
  const div = document.createElement(href ? "a" : "div");
  div.className = "stat-tile";
  if (href) {
    div.href = href;
    div.classList.add("clickable");
  }

  const labelEl = document.createElement("p");
  labelEl.className = "stat-label";
  labelEl.textContent = label;

  const valueEl = document.createElement("p");
  valueEl.className = "stat-value";
  valueEl.textContent = value;

  div.append(labelEl, valueEl);

  if (delta) {
    const deltaEl = document.createElement("p");
    deltaEl.className = `stat-delta ${deltaGood ? "good" : "muted"}`;
    deltaEl.textContent = delta;
    div.append(deltaEl);
  } else if (deltaEmptyText) {
    const deltaEl = document.createElement("p");
    deltaEl.className = "stat-delta muted";
    deltaEl.textContent = deltaEmptyText;
    div.append(deltaEl);
  }

  return div;
}

function renderStatTiles(stats) {
  statTilesEl.innerHTML = "";

  statTilesEl.append(
    tile({
      label: "저장된 레시피",
      value: `${stats.savedCount}개`,
      delta: stats.savedThisWeek > 0 ? `↑ +${stats.savedThisWeek} 이번주` : "",
      deltaGood: true,
      deltaEmptyText: stats.savedThisWeek === 0 ? "이번주 저장 없음" : "",
      href: "my-recipes.html?folderId=",
    }),
    tile({
      label: "요리한 횟수",
      value: `${stats.cookCountTotal}회`,
      delta: stats.cookedThisMonth > 0 ? `↑ +${stats.cookedThisMonth} 이번달` : "",
      deltaGood: true,
      deltaEmptyText: stats.cookedThisMonth === 0 ? "이번달 기록 없음" : "",
      href: "my-recipes.html?folderId=",
    }),
    tile({
      label: "평균 평점",
      value: stats.averageRating ? `${stats.averageRating.toFixed(1)} ⭐` : "- ⭐",
      deltaEmptyText: stats.averageRating ? "" : "아직 평점을 매긴 레시피가 없음",
      href: "my-recipes.html?folderId=",
    }),
    tile({
      label: "레시피 폴더",
      value: `${stats.folderCount}개`,
      href: "my-recipes.html",
    })
  );
}

function renderFolderChart(breakdown) {
  folderChartEl.innerHTML = "";
  const total = breakdown.reduce((sum, f) => sum + f.count, 0);

  if (total === 0) {
    chartEmptyEl.hidden = false;
    return;
  }
  chartEmptyEl.hidden = true;

  const max = Math.max(...breakdown.map((f) => f.count), 1);

  breakdown.forEach((f) => {
    const row = document.createElement("a");
    row.className = "bar-row clickable";
    row.href = `my-recipes.html?folderId=${encodeURIComponent(f.folderId)}`;

    const label = document.createElement("span");
    label.className = "bar-label";
    label.textContent = f.name;

    const track = document.createElement("div");
    track.className = "bar-track";
    const fill = document.createElement("div");
    fill.className = "bar-fill";
    fill.style.width = `${(f.count / max) * 100}%`;
    track.appendChild(fill);

    const value = document.createElement("span");
    value.className = "bar-value";
    value.textContent = `${f.count}개`;

    row.append(label, track, value);
    folderChartEl.appendChild(row);
  });
}

async function loadDashboard() {
  try {
    const res = await fetch("/api/dashboard", { headers: { Authorization: `Bearer ${token}` } });
    if (res.status === 401) {
      location.href = "login.html";
      return;
    }
    const body = await res.json();
    if (!body.success) return;
    renderStatTiles(body.stats);
    renderFolderChart(body.stats.folderBreakdown);
  } catch {
    // 네트워크 오류 시 빈 화면으로 남겨둔다.
  }
}

loadDashboard();
