const form = document.getElementById("login-form");
const emailInput = document.getElementById("email-input");
const passwordInput = document.getElementById("password-input");
const errorMessage = document.getElementById("error-message");

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  errorMessage.textContent = "";
  const submitBtn = form.querySelector("button[type=submit]");
  submitBtn.disabled = true;

  try {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: emailInput.value.trim(), password: passwordInput.value }),
    });
    const body = await res.json();

    if (!body.success) {
      errorMessage.textContent = body.error || "로그인에 실패했습니다.";
      return;
    }

    localStorage.setItem("authToken", body.token);
    localStorage.setItem("nickname", body.user.nickname);
    location.href = "my-recipes.html";
  } catch {
    errorMessage.textContent = "서버와 통신할 수 없습니다.";
  } finally {
    submitBtn.disabled = false;
  }
});
