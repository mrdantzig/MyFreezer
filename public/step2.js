const noIngredientsSection = document.getElementById("no-ingredients-section");
const mainSection = document.getElementById("main-section");
const ingredientChipList = document.getElementById("ingredient-chip-list");
const filterForm = document.getElementById("filter-form");
const dietInput = document.getElementById("diet-input");
const spicyInput = document.getElementById("spicy-input");
const maxTimeInput = document.getElementById("max-time-input");
const generateBtn = document.getElementById("generate-btn");
const statusEl = document.getElementById("status");
const errorSection = document.getElementById("error-section");
const errorMessage = document.getElementById("error-message");
const retryBtn = document.getElementById("retry-btn");
const recipeListEl = document.getElementById("recipe-list");

let ingredients = [];
let requestInFlight = false; // 클라이언트 측 디바운스
let foldersCache = null; // 폴더 목록은 여러 카드가 공유하므로 한 번만 불러온다.

async function loadFolders() {
  if (foldersCache) return foldersCache;
  const token = localStorage.getItem("authToken");
  try {
    const res = await fetch("/api/folders", { headers: { Authorization: `Bearer ${token}` } });
    const body = await res.json();
    foldersCache = body.success ? body.folders : [];
  } catch {
    foldersCache = [];
  }
  return foldersCache;
}

function loadIngredients() {
  try {
    const stored = JSON.parse(localStorage.getItem("confirmedIngredients") || "[]");
    return Array.isArray(stored) ? stored.filter((s) => typeof s === "string" && s.trim()) : [];
  } catch {
    return [];
  }
}

function renderIngredientChips() {
  ingredientChipList.innerHTML = "";
  ingredients.forEach((name, index) => {
    const li = document.createElement("li");
    const label = document.createElement("span");
    label.textContent = name;
    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.textContent = "×";
    removeBtn.addEventListener("click", () => {
      ingredients.splice(index, 1);
      renderIngredientChips();
    });
    li.append(label, removeBtn);
    ingredientChipList.appendChild(li);
  });
}

function showError(message) {
  errorSection.hidden = false;
  errorMessage.textContent = message;
}

function hideError() {
  errorSection.hidden = true;
  errorMessage.textContent = "";
}

function difficultyLabel(difficulty) {
  return { easy: "쉬움", medium: "보통", hard: "어려움" }[difficulty] || "난이도 정보 없음";
}

function renderRecipes(recipes) {
  recipeListEl.innerHTML = "";
  recipes.forEach((recipe, index) => {
    const card = document.createElement("article");
    card.className = "recipe-card";

    const title = document.createElement("h3");
    title.textContent = recipe.title;

    const meta = document.createElement("p");
    meta.className = "recipe-meta";
    const timeText = recipe.cookTimeMinutes ? `${recipe.cookTimeMinutes}분` : "예상 시간 정보 없음";
    meta.textContent = `${timeText} · ${difficultyLabel(recipe.difficulty)}`;

    const ingredientsP = document.createElement("p");
    ingredientsP.textContent = `필요 재료: ${recipe.ingredients.join(", ")}`;

    const toggleBtn = document.createElement("button");
    toggleBtn.className = "toggle-btn";
    toggleBtn.type = "button";
    toggleBtn.textContent = "조리 단계 보기";

    const detail = document.createElement("div");
    detail.className = "recipe-detail";
    detail.hidden = true;

    if (recipe.missingIngredients?.length) {
      const missingP = document.createElement("p");
      missingP.className = "missing-note";
      missingP.textContent = `추가로 필요한 재료: ${recipe.missingIngredients.join(", ")}`;
      detail.appendChild(missingP);
    }

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

    const saveBtn = document.createElement("button");
    saveBtn.className = "save-btn";
    saveBtn.type = "button";
    saveBtn.textContent = "이 레시피 저장하기";

    const saveForm = document.createElement("div");
    saveForm.className = "save-folder-form";
    saveForm.hidden = true;
    const folderSelect = document.createElement("select");
    const confirmSaveBtn = document.createElement("button");
    confirmSaveBtn.type = "button";
    confirmSaveBtn.className = "save-btn";
    confirmSaveBtn.textContent = "저장 확인";
    saveForm.append(folderSelect, confirmSaveBtn);

    const savedNote = document.createElement("p");
    savedNote.className = "hint";

    async function doSave(folderId) {
      const token = localStorage.getItem("authToken");
      confirmSaveBtn.disabled = true;
      savedNote.textContent = "저장하는 중입니다...";
      try {
        const res = await fetch("/api/recipes", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ recipe, sourceIngredients: ingredients, folderId }),
        });
        const body = await res.json();
        if (!body.success) {
          savedNote.textContent = body.error || "저장에 실패했습니다.";
          return;
        }
        saveForm.hidden = true;
        savedNote.innerHTML = '저장되었습니다! <a href="my-recipes.html">내 레시피에서 확인하기</a>';
      } catch {
        savedNote.textContent = "서버와 통신할 수 없습니다.";
      } finally {
        confirmSaveBtn.disabled = false;
      }
    }

    saveBtn.addEventListener("click", async () => {
      const token = localStorage.getItem("authToken");
      if (!token) {
        savedNote.innerHTML = '로그인 후 저장할 수 있습니다. <a href="login.html">로그인하러 가기</a>';
        return;
      }
      const folders = await loadFolders();
      if (folders.length <= 1) {
        // 폴더가 default 하나뿐이면 바로 저장한다.
        doSave(folders[0]?.id);
        return;
      }
      folderSelect.innerHTML = "";
      folders.forEach((folder) => {
        const opt = document.createElement("option");
        opt.value = folder.id;
        opt.textContent = folder.name;
        folderSelect.appendChild(opt);
      });
      saveForm.hidden = false;
    });

    confirmSaveBtn.addEventListener("click", () => doSave(folderSelect.value));

    card.append(title, meta, ingredientsP, toggleBtn, detail, saveBtn, saveForm, savedNote);
    recipeListEl.appendChild(card);
  });
}

async function generateRecipes() {
  if (requestInFlight) return;
  if (ingredients.length === 0) {
    showError("재료를 1개 이상 입력해주세요.");
    return;
  }

  requestInFlight = true;
  generateBtn.disabled = true;
  hideError();
  statusEl.textContent = "레시피를 생성하는 중입니다...";
  recipeListEl.innerHTML = "";

  const preferences = {
    diet: dietInput.value.trim(),
    spicy: spicyInput.checked,
    maxCookTime: maxTimeInput.value ? Number(maxTimeInput.value) : null,
  };

  try {
    const res = await fetch("/api/generate-recipes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ingredients, preferences }),
    });
    const body = await res.json();

    if (!body.success) {
      showError(body.error || "레시피 생성에 실패했습니다. 잠시 후 다시 시도해주세요.");
      return;
    }

    renderRecipes(body.recipes);
  } catch (err) {
    showError("서버와 통신할 수 없습니다. 잠시 후 다시 시도해주세요.");
  } finally {
    statusEl.textContent = "";
    requestInFlight = false;
    generateBtn.disabled = false;
  }
}

const addIngredientForm = document.getElementById("add-ingredient-form");
const addIngredientInput = document.getElementById("add-ingredient-input");

addIngredientForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const name = addIngredientInput.value.trim();
  if (!name) return;
  ingredients.push(name);
  addIngredientInput.value = "";
  renderIngredientChips();
});

generateBtn.addEventListener("click", generateRecipes);
retryBtn.addEventListener("click", () => {
  hideError();
  generateRecipes();
});

ingredients = loadIngredients();
if (ingredients.length === 0) {
  noIngredientsSection.hidden = false;
} else {
  mainSection.hidden = false;
  renderIngredientChips();
}
