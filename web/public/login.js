const { startAuthentication } = SimpleWebAuthnBrowser;
const msg = document.getElementById("msg");

document.getElementById("passkey").addEventListener("click", async () => {
  msg.textContent = "";
  try {
    const optionsJSON = await (await fetch("/webauthn/login/options")).json();
    const assertion = await startAuthentication({ optionsJSON });
    const res = await fetch("/webauthn/login/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(assertion),
    });
    if (res.ok) {
      location.href = "/";
    } else {
      const e = await res.json().catch(() => ({}));
      msg.textContent = e.error === "unknown device"
        ? "この端末は未登録です。下のボタンから登録してください。"
        : "ログインに失敗しました。";
    }
  } catch (err) {
    msg.textContent = "パスキー認証がキャンセルされたか、利用できません。";
  }
});
