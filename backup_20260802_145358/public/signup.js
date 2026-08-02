const form = document.getElementById("signup-form");
const emailInput = document.getElementById("email-input");
const passwordInput = document.getElementById("password-input");
const passwordConfirmInput = document.getElementById("password-confirm-input");
const nicknameInput = document.getElementById("nickname-input");
const errorMessage = document.getElementById("error-message");

// 서버(server.js)의 MIN_PASSWORD_LENGTH / MAX_PASSWORD_LENGTH와 동일한 값.
// 값을 바꿀 경우 서버 쪽 상수도 함께 확인해야 한다.
const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 128;

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  errorMessage.textContent = "";

  if (passwordInput.value.length < MIN_PASSWORD_LENGTH || passwordInput.value.length > MAX_PASSWORD_LENGTH) {
    errorMessage.textContent = `비밀번호는 ${MIN_PASSWORD_LENGTH}자 이상 ${MAX_PASSWORD_LENGTH}자 이하로 입력해 주세요.`;
    return;
  }

  if (passwordInput.value !== passwordConfirmInput.value) {
    errorMessage.textContent = "비밀번호가 일치하지 않습니다.";
    return;
  }

  const submitBtn = form.querySelector("button[type=submit]");
  submitBtn.disabled = true;

  try {
    const res = await fetch("/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: emailInput.value.trim(),
        password: passwordInput.value,
        nickname: nicknameInput.value.trim(),
      }),
    });
    const body = await res.json();

    if (!body.success) {
      errorMessage.textContent = body.error || "회원가입에 실패했습니다.";
      return;
    }

    localStorage.setItem("authToken", body.token);
    localStorage.setItem("nickname", body.user.nickname);
    location.href = "profile.html";
  } catch {
    errorMessage.textContent = "서버와 통신할 수 없습니다.";
  } finally {
    submitBtn.disabled = false;
  }
});
