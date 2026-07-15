const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "lynk_token.js"), "utf8");
const saved = { lynk_refresh_token: "old-refresh", lynk_at_cache: "old-cache" };
let doneCount = 0;

vm.runInNewContext(source, {
  $request: {
    url: "https://app-services.lynkco.com.cn/auth/login/mobileCodeLogin?deviceId=device%20from%20url&appVersion=4.9.1",
    headers: {},
  },
  $response: {
    body: JSON.stringify({ data: { centerTokenDto: { refreshToken: "new-refresh" } } }),
  },
  $prefs: {
    valueForKey(key) { return saved[key] == null ? null : saved[key]; },
    setValueForKey(value, key) { saved[key] = value; return true; },
  },
  $notify() {},
  $done() { doneCount += 1; },
  JSON,
  String,
  decodeURIComponent,
});

assert.equal(saved.lynk_device_id, "device from url");
assert.equal(saved.lynk_share_app_version, "4.9.1");
assert.equal(saved.lynk_refresh_token, "new-refresh");
assert.equal(saved.lynk_at_cache, "");
assert.equal(doneCount, 1);
console.log("lynk_token tests passed");
