const shareLinkInput = document.getElementById("share-link");
const copyBtn = document.getElementById("copy-btn");
const copyMessage = document.getElementById("copy-message");

shareLinkInput.value = `${location.origin}/index.html`;

copyBtn.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(shareLinkInput.value);
    copyMessage.textContent = "링크가 복사되었습니다.";
  } catch {
    shareLinkInput.select();
    copyMessage.textContent = "복사 버튼이 지원되지 않으면 직접 선택해 복사해주세요.";
  }
});
