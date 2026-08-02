const token = localStorage.getItem("authToken");
if (!token) {
  location.href = "login.html";
}

const recipeListEl = document.getElementById("recipe-list");
const emptyMessage = document.getElementById("empty-message");
const folderSelect = document.getElementById("folder-select");
const newFolderBtn = document.getElementById("new-folder-btn");
const newFolderForm = document.getElementById("new-folder-form");
const newFolderInput = document.getElementById("new-folder-input");
const cancelFolderBtn = document.getElementById("cancel-folder-btn");
const deleteFolderBtn = document.getElementById("delete-folder-btn");
const folderMessage = document.getElementById("folder-message");

let defaultFolderId = null;

function updateDeleteFolderBtn() {
  deleteFolderBtn.hidden = !folderSelect.value || folderSelect.value === defaultFolderId;
}

// 삭제처럼 되돌릴 수 없는 위험한 동작은 한 번의 클릭으로 바로 실행되지 않도록,
// 먼저 확인 문구로 바뀌었다가 일정 시간 안에 다시 누를 때만 실제 동작을 수행한다.
function armDoubleClickConfirm(button, confirmLabel, defaultLabel, onConfirm) {
  let armed = false;
  let timer = null;

  const revert = () => {
    armed = false;
    button.textContent = defaultLabel;
    button.classList.remove("confirming");
  };

  button.addEventListener("click", async () => {
    if (!armed) {
      armed = true;
      button.textContent = confirmLabel;
      button.classList.add("confirming");
      timer = setTimeout(revert, 3000);
      return;
    }
    clearTimeout(timer);
    await onConfirm(revert);
  });
}

function difficultyLabel(difficulty) {
  return { easy: "쉬움", medium: "보통", hard: "어려움" }[difficulty] || "난이도 정보 없음";
}

function formatDate(iso) {
  const d = new Date(iso);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
}

function starRow(item) {
  const wrap = document.createElement("div");
  wrap.className = "star-row";
  for (let i = 1; i <= 5; i += 1) {
    const star = document.createElement("button");
    star.type = "button";
    star.className = "star-btn";
    star.textContent = item.rating && i <= item.rating ? "★" : "☆";
    star.addEventListener("click", async () => {
      try {
        const res = await fetch(`/api/recipes/${item.id}/rate`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ rating: i }),
        });
        const body = await res.json();
        if (!body.success) return;
        item.rating = body.recipe.rating;
        Array.from(wrap.children).forEach((btn, idx) => {
          btn.textContent = idx + 1 <= item.rating ? "★" : "☆";
        });
      } catch {
        // 네트워크 오류 시 조용히 무시(별점은 부가 기능).
      }
    });
    wrap.appendChild(star);
  }
  return wrap;
}

function renderRecipes(items) {
  recipeListEl.innerHTML = "";
  emptyMessage.hidden = items.length > 0;

  items.forEach((item) => {
    const { recipe } = item;
    const card = document.createElement("article");
    card.className = "saved-recipe-card";

    const title = document.createElement("h3");
    title.textContent = recipe.title;

    const meta = document.createElement("p");
    meta.className = "recipe-meta";
    const timeText = recipe.cookTimeMinutes ? `${recipe.cookTimeMinutes}분` : "시간 정보 없음";
    meta.textContent = `저장일 ${formatDate(item.savedAt)} · ${timeText} · ${difficultyLabel(recipe.difficulty)}`;

    const sourceP = document.createElement("p");
    sourceP.className = "hint";
    sourceP.textContent = `당시 보유 재료: ${item.sourceIngredients.join(", ")}`;

    const cookInfo = document.createElement("p");
    cookInfo.className = "hint cook-info";
    cookInfo.textContent = item.cookCount
      ? `${item.cookCount}회 요리함 · 마지막 ${formatDate(item.lastCookedAt)}`
      : "아직 요리 기록이 없습니다.";

    const cookError = document.createElement("p");
    cookError.className = "hint error";
    cookError.hidden = true;

    const toggleBtn = document.createElement("button");
    toggleBtn.className = "toggle-btn";
    toggleBtn.type = "button";
    toggleBtn.textContent = "조리 단계 보기";

    const detail = document.createElement("div");
    detail.className = "recipe-detail";
    detail.hidden = true;
    const stepsOl = document.createElement("ol");
    recipe.steps.forEach((step) => {
      const li = document.createElement("li");
      li.textContent = step;
      stepsOl.appendChild(li);
    });
    detail.appendChild(stepsOl);

    toggleBtn.addEventListener("click", () => {
      detail.hidden = !detail.hidden;
      toggleBtn.textContent = detail.hidden ? "조리 단계 보기" : "조리 단계 숨기기";
    });

    const actionRow = document.createElement("div");
    actionRow.className = "recipe-action-row";

    const cookBtn = document.createElement("button");
    cookBtn.type = "button";
    cookBtn.className = "cook-btn";
    cookBtn.textContent = "🍳 요리했어요";
    cookBtn.addEventListener("click", async () => {
      cookBtn.disabled = true;
      cookError.hidden = true;
      try {
        const res = await fetch(`/api/recipes/${item.id}/cook`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        });
        const body = await res.json();
        if (!body.success) {
          cookError.textContent = body.error || "요리 기록을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.";
          cookError.hidden = false;
          return;
        }
        item.cookCount = body.recipe.cookCount;
        item.lastCookedAt = body.recipe.lastCookedAt;
        cookInfo.textContent = `${item.cookCount}회 요리함 · 마지막 ${formatDate(item.lastCookedAt)}`;
      } catch {
        cookError.textContent = "인터넷 연결을 확인한 뒤 다시 눌러 주세요.";
        cookError.hidden = false;
      } finally {
        cookBtn.disabled = false;
      }
    });

    const deleteBtn = document.createElement("button");
    deleteBtn.className = "delete-btn";
    deleteBtn.type = "button";
    deleteBtn.textContent = "삭제";
    armDoubleClickConfirm(deleteBtn, "정말 삭제할까요?", "삭제", async (revert) => {
      deleteBtn.disabled = true;
      try {
        const res = await fetch(`/api/recipes/${item.id}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` },
        });
        const body = await res.json();
        if (!body.success) {
          revert();
          return;
        }
        card.remove();
        emptyMessage.hidden = recipeListEl.children.length > 0;
      } catch {
        revert();
      } finally {
        deleteBtn.disabled = false;
      }
    });

    actionRow.append(cookBtn, deleteBtn);
    card.append(title, meta, sourceP, starRow(item), cookInfo, cookError, toggleBtn, detail, actionRow);
    recipeListEl.appendChild(card);
  });
}

async function loadRecipes(folderId) {
  try {
    const url = folderId ? `/api/recipes?folderId=${encodeURIComponent(folderId)}` : "/api/recipes";
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (res.status === 401) {
      location.href = "login.html";
      return;
    }
    const body = await res.json();
    if (!body.success) return;
    renderRecipes(body.recipes);
  } catch {
    // 네트워크 오류 시 빈 목록으로 남겨둔다.
  }
}

// forceDefault: true로 호출하면 URL의 folderId 파라미터를 무시하고 항상 첫 번째(기본) 폴더를
// 선택한다. 폴더 삭제 직후처럼 "삭제된 폴더 대신 기본 폴더로 이동"해야 하는 경우에 사용한다.
async function loadFolders({ forceDefault = false } = {}) {
  try {
    const res = await fetch("/api/folders", { headers: { Authorization: `Bearer ${token}` } });
    if (res.status === 401) {
      location.href = "login.html";
      return;
    }
    const body = await res.json();
    if (!body.success) return;

    folderSelect.innerHTML = "";
    const allOpt = document.createElement("option");
    allOpt.value = "";
    allOpt.textContent = "전체";
    folderSelect.appendChild(allOpt);

    body.folders.forEach((folder) => {
      const opt = document.createElement("option");
      opt.value = folder.id;
      opt.textContent = folder.name;
      folderSelect.appendChild(opt);
    });
    defaultFolderId = body.folders[0]?.id || null;

    if (forceDefault) {
      folderSelect.value = defaultFolderId || "";
    } else {
      // URL의 folderId 파라미터로 대시보드 등에서 드릴다운 진입 가능하게 한다.
      const requestedFolderId = new URLSearchParams(location.search).get("folderId");
      const validRequested =
        requestedFolderId !== null &&
        (requestedFolderId === "" || body.folders.some((f) => f.id === requestedFolderId));
      folderSelect.value = validRequested ? requestedFolderId : defaultFolderId || "";
    }
    updateDeleteFolderBtn();
    loadRecipes(folderSelect.value);
  } catch {
    // 네트워크 오류 시 폴더 없이 남겨둔다.
  }
}

folderSelect.addEventListener("change", () => {
  folderMessage.textContent = "";
  updateDeleteFolderBtn();
  loadRecipes(folderSelect.value);
});

armDoubleClickConfirm(deleteFolderBtn, "정말 삭제할까요?", "폴더 삭제", async (revert) => {
  deleteFolderBtn.disabled = true;
  folderMessage.textContent = "";
  try {
    const res = await fetch(`/api/folders/${folderSelect.value}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json();
    if (!body.success) {
      folderMessage.textContent = body.error || "폴더를 삭제하지 못했습니다.";
      revert();
      return;
    }
    revert();
    await loadFolders({ forceDefault: true });
  } catch {
    folderMessage.textContent = "네트워크 오류로 폴더를 삭제하지 못했습니다. 인터넷 연결을 확인한 뒤 다시 시도해 주세요.";
    revert();
  } finally {
    deleteFolderBtn.disabled = false;
  }
});

newFolderBtn.addEventListener("click", () => {
  newFolderForm.hidden = false;
  newFolderInput.focus();
});

cancelFolderBtn.addEventListener("click", () => {
  newFolderForm.hidden = true;
  newFolderInput.value = "";
});

newFolderForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = newFolderInput.value.trim();
  if (!name) return;
  try {
    const res = await fetch("/api/folders", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name }),
    });
    const body = await res.json();
    if (!body.success) return;
    newFolderForm.hidden = true;
    newFolderInput.value = "";
    await loadFolders();
    folderSelect.value = body.folder.id;
    loadRecipes(folderSelect.value);
  } catch {
    // 네트워크 오류 시 조용히 무시.
  }
});

loadFolders();
