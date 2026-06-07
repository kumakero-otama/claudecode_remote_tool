const { startRegistration } = SimpleWebAuthnBrowser;
const msg = document.getElementById("msg");

document.getElementById("register").addEventListener("click", async () => {
  msg.textContent = "";
  try {
    const optionsJSON = await (await fetch("/webauthn/register/options")).json();
    if (optionsJSON.error) {
      location.href = "/login";
      return;
    }
    const attestation = await startRegistration({ optionsJSON });
    const res = await fetch("/webauthn/register/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(attestation),
    });
    if (res.ok) {
      location.href = "/";
    } else {
      msg.textContent = "登録に失敗しました。もう一度お試しください。";
    }
  } catch (err) {
    msg.textContent = "パスキー登録がキャンセルされたか、利用できません。";
  }
});
