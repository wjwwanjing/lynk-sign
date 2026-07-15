const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "lynk_sign_capture.js"), "utf8");
const saved = {};
const notifications = [];
let doneCount = 0;

vm.runInNewContext(source, {
  $request: {
    url: "https://app-api-gw-toc.lynkco.com/up/api/v1/user/sign?ignored=1",
    method: "POST",
    headers: {
      token: "secret-access-token",
      Authorization: "APPCODE secret-app-code",
      "X-Ca-Key": "new-key-123",
      "X-Ca-Signature": "must-not-be-saved",
      "X-Ca-Signature-Headers": "X-Ca-Key,X-Ca-Nonce",
      "X-Ca-Nonce": "must-not-be-saved",
      "X-Ca-Timestamp": "must-not-be-saved",
      gl_app_version: "5.0.0",
      gl_dev_id: "device-secret-value",
      "content-type": "application/json",
    },
    body: JSON.stringify({ private: "must-not-be-saved" }),
  },
  $response: {
    statusCode: 200,
    body: JSON.stringify({ code: "success", message: "操作成功", data: { private: "must-not-be-saved" } }),
  },
  $prefs: {
    setValueForKey(value, key) { saved[key] = value; return true; },
  },
  $notify(title, subtitle, body) { notifications.push({ title, subtitle, body }); },
  $done() { doneCount += 1; },
  JSON,
  String,
  Object,
  Date,
});

const meta = JSON.parse(saved.lynk_sign_capture);
assert.equal(meta.path, "/up/api/v1/user/sign");
assert.equal(meta.xCaKey, "new-key-123");
assert.equal(meta.hasAppCode, true);
assert.equal(meta.hasToken, true);
assert.equal(meta.appVersion, "5.0.0");
assert.deepEqual(Array.from(meta.deviceHeaderNames), ["gl_app_version", "gl_dev_id"]);
assert.equal(doneCount, 1);
assert.equal(notifications.length, 1);

const serialized = saved.lynk_sign_capture;
for (const secret of [
  "secret-access-token",
  "secret-app-code",
  "must-not-be-saved",
  "device-secret-value",
]) {
  assert.equal(serialized.includes(secret), false, `captured metadata leaked: ${secret}`);
}

console.log("lynk_sign_capture tests passed");

const statusSaved = {};
const statusNotifications = [];
let statusDoneCount = 0;

vm.runInNewContext(source, {
  $request: {
    url: "https://app-api-gw-toc.lynkco.com/up/api/v1/userReward/getContinueDaysAndSignCard",
    method: "GET",
    headers: {
      token: "status-secret-token",
      Authorization: "APPCODE status-secret-app-code",
      "X-Ca-Key": "current-status-key",
      "X-Ca-Signature": "status-signature-secret",
      "X-Ca-Signature-Headers": "X-Ca-Key,X-Ca-Nonce",
      gl_app_version: "5.1.0",
    },
  },
  $response: {
    statusCode: 200,
    body: JSON.stringify({ code: "success", message: "操作成功", data: { continueDays: 7 } }),
  },
  $prefs: {
    setValueForKey(value, key) { statusSaved[key] = value; return true; },
  },
  $notify(title, subtitle, body) { statusNotifications.push({ title, subtitle, body }); },
  $done() { statusDoneCount += 1; },
  JSON,
  String,
  Object,
  Date,
});

const statusMeta = JSON.parse(statusSaved.lynk_sign_status_capture);
assert.equal(statusMeta.captureType, "sign-status");
assert.equal(statusMeta.method, "GET");
assert.equal(statusMeta.path, "/up/api/v1/userReward/getContinueDaysAndSignCard");
assert.equal(statusMeta.xCaKey, "current-status-key");
assert.equal(statusMeta.hasAppCode, true);
assert.equal(statusDoneCount, 1);
assert.equal(statusNotifications.length, 1);
assert.match(statusNotifications[0].subtitle, /app-api-gw-toc\.lynkco\.com\/up\/api\/v1\/userReward/);
assert.equal(statusSaved.lynk_sign_status_capture.includes("status-secret-token"), false);
assert.equal(statusSaved.lynk_sign_status_capture.includes("status-secret-app-code"), false);
assert.equal(statusSaved.lynk_sign_status_capture.includes("status-signature-secret"), false);

console.log("lynk_sign status capture tests passed");
