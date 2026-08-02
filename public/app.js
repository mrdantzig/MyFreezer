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

// Vercel 서버리스 함수는 요청 본문 크기를 4.5MB로 강제 제한한다(플랫폼 고정값, 서버 코드로
// 바꿀 수 없음). 모바일 카메라 사진은 흔히 4~8MB라 원본 그대로 올리면 서버에 도달하기도 전에
// 요청이 거부되고, app.js는 이를 구분되지 않는 네트워크 에러("서버와 통신할 수 없습니다")로
// 표시하게 된다. 그래서 업로드 직전에 캔버스로 리사이즈/재인코딩해 여유 있게 줄여서 보낸다.
const UPLOAD_MAX_DIMENSION = 1600;
const UPLOAD_TARGET_BYTES = 3.5 * 1024 * 1024;

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("IMAGE_DECODE_FAILED"));
    };
    img.src = url;
  });
}

function canvasToBlob(canvas, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("CANVAS_ENCODE_FAILED"))),
      "image/jpeg",
      quality
    );
  });
}

// 인식 정확도에 큰 영향 없는 선에서 화질을 단계적으로 낮춰가며 목표 용량 이하가 될 때까지 재인코딩한다.
async function compressForUpload(file) {
  const img = await loadImage(file);
  const scale = Math.min(1, UPLOAD_MAX_DIMENSION / Math.max(img.width, img.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  let quality = 0.85;
  let blob = await canvasToBlob(canvas, quality);
  while (blob.size > UPLOAD_TARGET_BYTES && quality > 0.4) {
    quality -= 0.15;
    blob = await canvasToBlob(canvas, quality);
  }
  return blob;
}

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

  try {
    let uploadBlob;
    try {
      uploadBlob = await compressForUpload(selectedFile);
    } catch (compressErr) {
      // 압축 자체가 실패하면(예: 브라우저 호환성 문제) 원본으로 폴백 — 원본이 작으면 어차피 통과된다.
      uploadBlob = selectedFile;
    }

    const formData = new FormData();
    formData.append("image", uploadBlob, selectedFile.name || "image.jpg");

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
