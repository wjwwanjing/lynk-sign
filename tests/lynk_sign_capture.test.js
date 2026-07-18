const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "lynk_sign_capture.js"), "utf8");

function runCapture(request, response) {
  const saved = {};
  const notifications = [];
  let doneCount = 0;
  vm.runInNewContext(source, {
    $request: request,
    $response: response,
    $prefs: { setValueForKey(value, key) { saved[key] = value; return true; } },
    $notify(title, subtitle, body) { notifications.push({ title, subtitle, body }); },
    $done() { doneCount += 1; },
    JSON, String, Object, Array, Date, decodeURIComponent,
  });
  return { saved, notifications, doneCount };
}

// 1) 真实签到 POST：响应带奖励字段 → 认定为签到动作，保存 lynk_sign_capture，不泄露敏感值。
(function testRealSignActionCaptured() {
  const { saved, notifications, doneCount } = runCapture({
    url: "https://app-gateway-common.lynkco.com/up/api/v1/user/sign/doSign?ignored=1",
    method: "POST",
    headers: {
      token: "secret-access-token",
      Authorization: "APPCODE secret-app-code",
      "X-Ca-Key": "204644386",
      "X-Ca-Signature": "must-not-be-saved",
      "X-Ca-Signature-Headers": "X-Ca-Key,X-Ca-Timestamp,X-Ca-Nonce,X-Ca-Signature-Method",
      "X-Ca-Stage": "RELEASE",
      "X-Ca-Nonce": "must-not-be-saved",
      gl_app_version: "4.2.4",
      gl_dev_id: "device-secret-value",
      "user-agent": "CA_iOS_SDK_2.0",
      "content-type": "application/json",
    },
    body: JSON.stringify({ private: "must-not-be-saved" }),
  }, {
    statusCode: 200,
    body: JSON.stringify({ code: "success", message: "签到成功", data: { rewardEnergyNumber: 1, signStatus: 1 } }),
  });

  const meta = JSON.parse(saved.lynk_sign_capture);
  assert.equal(meta.captureType, "sign-post");
  assert.equal(meta.host, "app-gateway-common.lynkco.com");
  assert.equal(meta.path, "/up/api/v1/user/sign/doSign");
  assert.equal(meta.xCaKey, "204644386");
  assert.equal(meta.hasAppCode, true);
  assert.equal(meta.xCaStage, "RELEASE");
  assert.equal(meta.userAgent, "CA_iOS_SDK_2.0");
  assert.equal(meta.responseHasReward, true);
  assert.equal(doneCount, 1);
  assert.equal(notifications.length, 1);
  assert.match(notifications[0].title, /真实签到请求已捕获/);
  for (const secret of ["secret-access-token", "secret-app-code", "must-not-be-saved", "device-secret-value"]) {
    assert.equal(saved.lynk_sign_capture.includes(secret), false, `leaked: ${secret}`);
  }
  console.log("lynk_sign_capture: real sign action test passed");
})();

// 2) 状态探测 POST：响应无奖励字段 → 绝不保存为 sign-post（修复最初误抓 /sign/info 的 bug）。
(function testStatusProbeNotCapturedAsSign() {
  const { saved } = runCapture({
    url: "https://app-api-gw-toc.lynkco.com/up/api/v1/user/sign/info",
    method: "POST",
    headers: {
      token: "t", "X-Ca-Key": "204644386",
      "X-Ca-Signature-Headers": "X-Ca-Key,X-Ca-Timestamp,X-Ca-Nonce,X-Ca-Signature-Method",
      "content-type": "application/json",
    },
    body: JSON.stringify({}),
  }, {
    statusCode: 200,
    body: JSON.stringify({ code: "success", message: "操作成功", data: { signStatus: 1, continueDays: 8 } }),
  });

  assert.equal(saved.lynk_sign_capture, undefined, "status probe must NOT be saved as the sign action");
  console.log("lynk_sign_capture: status probe rejection test passed");
})();

// 3) 状态 GET 仍单独留档，供对照，但不会被当作签到动作。
(function testStatusGetStoredSeparately() {
  const { saved } = runCapture({
    url: "https://app-api-gw-toc.lynkco.com/up/api/v1/userReward/getContinueDaysAndSignCard",
    method: "GET",
    headers: { token: "t", "X-Ca-Key": "204644386" },
  }, {
    statusCode: 200,
    body: JSON.stringify({ code: "success", data: { continueDays: 8 } }),
  });

  assert.equal(saved.lynk_sign_capture, undefined);
  assert.ok(saved.lynk_sign_status_capture, "status GET should be logged separately");
  console.log("lynk_sign_capture: status GET test passed");
})();

console.log("lynk_sign_capture tests passed");
