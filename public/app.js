// 주의: 이 값들은 server.js의 동명의 상수(MAX_FILE_SIZE, ALLOWED_MIME_TYPES)와
// 반드시 동기화되어야 한다(브라우저/서버가 별도 런타임이라 모듈을 공유할 수 없음). 여기는
// 사용자 경험을 위한 사전 검증일 뿐이며, 실제 강제는 항상 서버 쪽 값으로 이뤄진다.
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const ALLOWED_TYPES = ["image/jpeg", "image/png"];

const dropZone = document.getElementById("drop-zone");
const fileInput = document.getElementById("file-input");
const preview = document.getElementById("preview");
const dropZoneContent = document.getElementById("drop-zone-content");
const recognizeBtn = document.getElementById("recognize-btn");
const statusEl = document.getElementById("status");
const resultSection = document.getElementById("result-section");
const ingredientListEl = document.getElementById("ingredient-list");
const addForm = document.getElementById("add-form");
const addInput = document.getElementById("add-input");
const confirmBtn = document.getElementById("confirm-btn");
const confirmMessage = document.getElementById("confirm-message");
const errorSection = document.getElementById("error-section");
const errorMessage = document.getElementById("error-message");
const retryBtn = document.getElementById("retry-btn");

let selectedFile = null;
let ingredients = []; // { name, source: 'recognized' | 'manual' }
let requestInFlight = false; // 클라이언트 측 디바운스: 동시 요청 방지

function resetResult() {
  ingredients = [];
  resultSection.hidden = true;
  ingredientListEl.innerHTML = "";
  confirmMessage.textContent = "";
}

function showError(message) {
  errorSection.hidden = false;
  errorMessage.textContent = message;
}

function hideError() {
  errorSection.hidden = true;
  errorMessage.textContent = "";
}

function setFile(file) {
  if (!ALLOWED_TYPES.includes(file.type)) {
    showError("JPEG 또는 PNG 이미지만 업로드할 수 있습니다.");
    return;
  }
  if (file.size > MAX_FILE_SIZE) {
    showError("이미지 용량은 10MB 이하만 가능합니다.");
    return;
  }
  hideError();
  selectedFile = file;
  recognizeBtn.disabled = false;
  resetResult();

  const reader = new FileReader();
  reader.onload = (e) => {
    preview.src = e.target.result;
    preview.hidden = false;
    dropZoneContent.hidden = true;
  };
  reader.readAsDataURL(file);
}

fileInput.addEventListener("change", () => {
  if (fileInput.files[0]) setFile(fileInput.files[0]);
});

dropZone.addEventListener("click", () => fileInput.click());

["dragenter", "dragover"].forEach((eventName) => {
  dropZone.addEventListener(eventName, (e) => {
    e.preventDefault();
    dropZone.classList.add("dragover");
  });
});

["dragleave", "drop"].forEach((eventName) => {
  dropZone.addEventListener(eventName, (e) => {
    e.preventDefault();
    dropZone.classList.remove("dragover");
  });
});

dropZone.addEventListener("drop", (e) => {
  const file = e.dataTransfer.files[0];
  if (file) setFile(file);
});

function renderIngredients() {
  ingredientListEl.innerHTML = "";
  ingredients.forEach((ing, index) => {
    const li = document.createElement("li");
    if (ing.source === "manual") li.classList.add("manual");
    const label = document.createElement("span");
    label.textContent = ing.name;
    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.textContent = "×";
    removeBtn.addEventListener("click", () => {
      ingredients.splice(index, 1);
      renderIngredients();
    });
    li.appendChild(label);
    li.appendChild(removeBtn);
    ingredientListEl.appendChild(li);
  });
}

addForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const name = addInput.value.trim();
  if (!name) return;
  ingredients.push({ name, source: "manual" });
  addInput.value = "";
  renderIngredients();
});

confirmBtn.addEventListener("click", () => {
  const names = ingredients.map((ing) => ing.name);
  // 2단계(레시피 생성)로 넘길 인터페이스: localStorage에 확정 재료 목록 저장
  localStorage.setItem("confirmedIngredients", JSON.stringify(names));
  confirmMessage.textContent = `확정된 재료 ${names.length}개가 저장되었습니다: ${names.join(", ")}`;
  document.getElementById("go-step2-link").hidden = false;
});

async function recognize() {
  if (!selectedFile || requestInFlight) return;

  requestInFlight = true;
  recognizeBtn.disabled = true;
  hideError();
  statusEl.textContent = "이미지를 분석하는 중입니다...";
  resultSection.hidden = true;

  const formData = new FormData();
  formData.append("image", selectedFile);

  try {
    const res = await fetch("/api/recognize-ingredients", {
      method: "POST",
      body: formData,
    });
    const body = await res.json();

    if (!body.success) {
      showError(body.error || "재료 인식에 실패했습니다. 재료를 직접 입력해 진행할 수 있습니다.");
      ingredients = [];
      renderIngredients();
      resultSection.hidden = false;
      return;
    }

    ingredients = body.ingredients;
    renderIngredients();
    resultSection.hidden = false;
  } catch (err) {
    showError("서버와 통신할 수 없습니다. 잠시 후 다시 시도해주세요.");
  } finally {
    statusEl.textContent = "";
    requestInFlight = false;
    recognizeBtn.disabled = false;
  }
}

recognizeBtn.addEventListener("click", recognize);
retryBtn.addEventListener("click", () => {
  hideError();
  recognize();
});
