const token = localStorage.getItem("authToken");
if (!token) {
  location.href = "login.html";
}

const form = document.getElementById("profile-form");
const emailDisplay = document.getElementById("email-display");
const nicknameInput = document.getElementById("nickname-input");
const dietInput = document.getElementById("diet-input");
const allergyInput = document.getElementById("allergy-input");
const message = document.getElementById("message");

function splitCsv(value) {
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

async function loadProfile() {
  try {
    const res = await fetch("/api/profile", { headers: { Authorization: `Bearer ${token}` } });
    if (res.status === 401) {
      location.href = "login.html";
      return;
    }
    const body = await res.json();
    if (!body.success) {
      message.textContent = body.error || "프로필을 불러오지 못했습니다.";
      return;
    }
    emailDisplay.value = body.user.email;
    nicknameInput.value = body.user.nickname;
    dietInput.value = (body.user.dietaryPreferences || []).join(", ");
    allergyInput.value = (body.user.allergies || []).join(", ");
    localStorage.setItem("nickname", body.user.nickname);
  } catch {
    message.textContent = "서버와 통신할 수 없습니다.";
  }
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  message.textContent = "";
  const submitBtn = form.querySelector("button[type=submit]");
  submitBtn.disabled = true;

  try {
    const res = await fetch("/api/profile", {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        nickname: nicknameInput.value.trim(),
        dietaryPreferences: splitCsv(dietInput.value),
        allergies: splitCsv(allergyInput.value),
      }),
    });
    const body = await res.json();
    if (!body.success) {
      message.textContent = body.error || "저장에 실패했습니다.";
      return;
    }
    localStorage.setItem("nickname", body.user.nickname);
    message.textContent = "저장되었습니다.";
  } catch {
    message.textContent = "서버와 통신할 수 없습니다.";
  } finally {
    submitBtn.disabled = false;
  }
});

loadProfile();
