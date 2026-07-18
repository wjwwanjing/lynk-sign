const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const script = fs.readFileSync(path.join(__dirname, "..", "lynk_qx.js"), "utf8");

async function runQx(preferences, responder) {
  const requests = [];
  const notifications = [];
  const saved = { ...preferences };
  let doneCount = 0;
  let resolveDone;
  const done = new Promise((resolve) => { resolveDone = resolve; });

  const context = {
    console: { log() {} },
    setTimeout,
    clearTimeout,
    Promise,
    Date,
    Math,
    JSON,
    String,
    Number,
    Object,
    Array,
    RegExp,
    isFinite,
    parseInt,
    encodeURIComponent,
    $prefs: {
      valueForKey(key) { return saved[key] == null ? null : saved[key]; },
      setValueForKey(value, key) { saved[key] = value; return true; },
    },
    $notify(title, subtitle, body) { notifications.push({ title, subtitle, body }); },
    $done() {
      doneCount += 1;
      resolveDone();
    },
    $task: {
      async fetch(request) {
        requests.push(request);
        const body = await responder(request, requests);
        return { statusCode: 200, body: JSON.stringify(body) };
      },
    },
  };

  vm.runInNewContext(script, context, { filename: "lynk_qx.js" });
  await Promise.race([
    done,
    new Promise((_, reject) => setTimeout(() => reject(new Error("QX script timed out")), 3000)),
  ]);
  assert.equal(doneCount, 1, "$done must be called exactly once");
  return { requests, notifications, saved };
}

function jsonBody(request) {
  return request.body ? JSON.parse(request.body) : null;
}

async function testSelfShare() {
  let growthReads = 0;
  const result = await runQx({
    lynk_refresh_token: "main-refresh",
    lynk_device_id: "main-device",
    lynk_self_share: "1",
    lynk_share_delay: "0",
    lynk_verify_delay: "0",
  }, async (request) => {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/auth/login/refresh")) {
      return { code: "success", data: { centerTokenDto: { token: "main-access", refreshToken: "main-refresh-new" } } };
    }
    if (url.pathname.endsWith("getContinueDaysAndSignCard")) {
      return { code: "success", data: { signStatus: 1, continuousSignDays: 8, signCardNumber: 1 } };
    }
    if (url.pathname === "/app/energy/myEnergy") {
      return { code: "success", data: { point: 705, incomePoint: 840 } };
    }
    if (url.pathname === "/app/energy/my/growth") {
      growthReads += 1;
      return { code: "success", data: { accountLevelVo: { name: "一级", growth: growthReads <= 2 ? 100 : 105 } } };
    }
    if (url.pathname.endsWith("getTaskList")) return { code: "success", data: [] };
    if (url.pathname.endsWith("square/index2")) {
      return { code: "success", data: { rows: [{ contentType: "文章", articleId: "article-999" }] } };
    }
    if (url.pathname.endsWith("getShareCode")) return { code: "success", data: "share+/code" };
    if (url.pathname.endsWith("/reporting")) return { code: "success", message: "ok" };
    if (url.pathname.endsWith("/shareReporting")) return { code: "success", message: "ok" };
    throw new Error(`Unexpected request: ${request.method} ${request.url}`);
  });

  const getCode = result.requests.find((request) => request.url.includes("/getShareCode"));
  assert.ok(getCode, "getShareCode request missing");
  assert.match(getCode.headers.Authorization, /^APPCODE /);
  const risk = JSON.parse(getCode.headers.risk_request_info);
  assert.match(risk.shareContentURL, /^https:\/\/h5\.lynkco\.com\//);
  assert.match(risk.shareContentURL, /article-999/);

  const report = result.requests.find((request) => request.url.includes("/reporting?type=99"));
  assert.equal(report.headers.token, "main-access");
  assert.equal(jsonBody(report).businessNo, "article-999");

  const click = result.requests.find((request) => request.url.includes("/shareReporting?"));
  assert.ok(click, "shareReporting request missing");
  assert.equal(click.headers.token, undefined, "visitor callback must not carry token");
  assert.match(click.headers.Authorization, /^APPCODE /, "visitor callback must carry APPCODE");
  assert.match(click.url, /shareCode=share%2B%2Fcode/);
  assert.equal(jsonBody(click).businessNo, "article-999");

  assert.equal(result.saved.lynk_refresh_token, "main-refresh-new");
  assert.match(result.notifications[0].body, /奖励已到账 \+5/);
  assert.match(result.notifications[0].body, /Co积分: 705 \| 累计积分: 840/);
  assert.match(result.notifications[0].body, /能量体: 105 \| 等级: 一级/);
  assert.match(result.notifications[0].body, /https:\/\/h5\.lynkco\.com\//);
}

async function testSecondaryShare() {
  let mainGrowthReads = 0;
  const result = await runQx({
    lynk_refresh_token: "main-refresh",
    lynk_device_id: "main-device",
    lynk_token_b: "b-refresh",
    lynk_device_id_b: "b-device",
    lynk_self_share: "0",
    lynk_share_delay: "0",
    lynk_verify_delay: "0",
  }, async (request) => {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/auth/login/refresh")) {
      const isB = url.searchParams.get("refreshToken") === "b-refresh";
      assert.equal(url.searchParams.get("deviceId"), isB ? "b-device" : "main-device");
      return {
        code: "success",
        data: { centerTokenDto: { token: isB ? "b-access" : "main-access", refreshToken: isB ? "b-refresh-new" : "main-refresh-new" } },
      };
    }
    if (url.pathname.endsWith("getContinueDaysAndSignCard")) {
      return { code: "success", data: { signStatus: 1 } };
    }
    if (url.pathname === "/app/energy/myEnergy") {
      return { code: "success", data: { point: 705, incomePoint: 840 } };
    }
    if (url.pathname === "/app/energy/my/growth") {
      assert.equal(request.headers.token, "main-access", "reward verification must query main account");
      mainGrowthReads += 1;
      return { code: "success", data: { accountLevelVo: { name: "二级", growth: mainGrowthReads <= 2 ? 300 : 305 } } };
    }
    if (url.pathname.endsWith("getTaskList")) return { code: "success", data: [] };
    if (url.pathname.endsWith("square/index2")) {
      return { code: "success", data: [{ contentTypeCode: "article", articleId: "article-b" }] };
    }
    if (url.pathname.endsWith("getShareCode")) return { code: "success", data: "code-b" };
    if (url.pathname.endsWith("shareCodeToUserId") ||
        url.pathname.endsWith("shareContentContectCheck") ||
        url.pathname.endsWith("shareContentContectReporting")) {
      assert.equal(request.headers.token, "b-access");
      const body = jsonBody(request);
      if (body.contentId) assert.equal(body.contentId, "article-b");
      return { code: "success", message: "ok" };
    }
    throw new Error(`Unexpected request: ${request.method} ${request.url}`);
  });

  assert.equal(result.saved.lynk_token_b, "b-refresh-new");
  assert.match(result.notifications[0].body, /B1: OK 主账号奖励已到账 \+5/);
}

async function testAcceptedWithoutRewardIsFailure() {
  const result = await runQx({
    lynk_refresh_token: "main-refresh",
    lynk_device_id: "main-device",
    lynk_self_share: "1",
    lynk_share_delay: "0",
    lynk_verify_delay: "0",
  }, async (request) => {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/auth/login/refresh")) {
      return { code: "success", data: { centerTokenDto: { token: "main-access" } } };
    }
    if (url.pathname.endsWith("getContinueDaysAndSignCard")) return { code: "success", data: { signStatus: 1 } };
    if (url.pathname === "/app/energy/myEnergy") return { code: "success", data: { point: 500, incomePoint: 600 } };
    if (url.pathname === "/app/energy/my/growth") return { code: "success", data: { accountLevelVo: { name: "二级", growth: 604 } } };
    if (url.pathname.endsWith("getTaskList")) return { code: "success", data: [] };
    if (url.pathname.endsWith("square/index2")) return { code: "success", data: [{ articleId: "article-no-reward" }] };
    if (url.pathname.endsWith("getShareCode")) return { code: "success", data: "code-no-reward" };
    if (url.pathname.endsWith("/reporting") || url.pathname.endsWith("/shareReporting")) {
      return { code: "success", message: "ok" };
    }
    throw new Error(`Unexpected request: ${request.method} ${request.url}`);
  });

  assert.match(result.notifications[0].body, /FAIL 两步上报成功，但能量余额未变化/);
  assert.doesNotMatch(result.notifications[0].body, /奖励已到账/);
}

async function testAmbiguousSignResponseIsRechecked() {
  let signInfoReads = 0;
  const result = await runQx({
    lynk_refresh_token: "main-refresh",
    lynk_device_id: "main-device",
    lynk_self_share: "0",
    lynk_share_delay: "0",
    lynk_verify_delay: "0",
  }, async (request) => {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/auth/login/refresh")) {
      return { code: "success", data: { centerTokenDto: { token: "main-access" } } };
    }
    if (url.pathname.endsWith("getContinueDaysAndSignCard")) {
      signInfoReads += 1;
      return { code: "success", data: { signStatus: signInfoReads >= 2 ? 1 : 0 } };
    }
    if (url.pathname.endsWith("/user/sign/upgrade")) return {};
    if (url.pathname === "/app/energy/myEnergy") return { code: "success", data: { point: 800, incomePoint: 1000 } };
    if (url.pathname === "/app/energy/my/growth") return { code: "success", data: {} };
    if (url.pathname.endsWith("getTaskList")) return { code: "success", data: [] };
    if (url.pathname.endsWith("square/index2")) return { code: "success", data: [{ articleId: "article-sign" }] };
    if (url.pathname.endsWith("getShareCode")) return { code: "success", data: "code-sign" };
    throw new Error(`Unexpected request: ${request.method} ${request.url}`);
  });

  assert.equal(signInfoReads, 2, "ambiguous sign response must trigger a status recheck");
  assert.match(result.notifications[0].body, /签到成功 \| 复查确认已签到/);
  assert.doesNotMatch(result.notifications[0].body, /未知错误/);
}

async function testAlreadySignedBusinessResponse() {
  const result = await runQx({
    lynk_refresh_token: "main-refresh",
    lynk_device_id: "main-device",
    lynk_self_share: "0",
    lynk_share_delay: "0",
  }, async (request) => {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/auth/login/refresh")) {
      return { code: "success", data: { centerTokenDto: { token: "main-access" } } };
    }
    if (url.pathname.endsWith("getContinueDaysAndSignCard")) return { code: "success", data: { signStatus: 0 } };
    if (url.pathname.endsWith("/user/sign/upgrade")) return { code: "sign.already", message: "今日已签到" };
    if (url.pathname === "/app/energy/myEnergy") return { code: "success", data: { point: 810, incomePoint: 1010 } };
    if (url.pathname === "/app/energy/my/growth") return { code: "success", data: {} };
    if (url.pathname.endsWith("getTaskList")) return { code: "success", data: [] };
    if (url.pathname.endsWith("square/index2")) return { code: "success", data: [{ articleId: "article-already" }] };
    if (url.pathname.endsWith("getShareCode")) return { code: "success", data: "code-already" };
    throw new Error(`Unexpected request: ${request.method} ${request.url}`);
  });

  assert.match(result.notifications[0].body, /已签到 \| 无新增/);
  assert.doesNotMatch(result.notifications[0].body, /签到失败/);
}

async function testSignUsesIosGatewayAuthAndCachesDate() {
  const result = await runQx({
    lynk_refresh_token: "main-refresh",
    lynk_device_id: "main-device",
    lynk_self_share: "0",
    lynk_share_delay: "0",
  }, async (request) => {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/auth/login/refresh")) {
      return { code: "success", data: { centerTokenDto: { token: "main-access" } } };
    }
    if (url.pathname.endsWith("getContinueDaysAndSignCard")) return { code: "success", data: { continueDays: 6 } };
    if (url.pathname.endsWith("/user/sign/upgrade")) {
      assert.equal(url.hostname, "app-api-gw-toc.lynkco.com");
      assert.equal(request.headers.Authorization, undefined);
      assert.equal(request.headers.token, "main-access");
      assert.equal(request.headers["X-Ca-Key"], "203760416");
      assert.ok(request.headers["X-Ca-Signature"]);
      return { code: "success", data: { rewardEnergyNumber: 1 } };
    }
    if (url.pathname === "/app/energy/myEnergy") return { code: "success", data: { point: 811, incomePoint: 1011 } };
    if (url.pathname === "/app/energy/my/growth") return { code: "success", data: {} };
    if (url.pathname.endsWith("getTaskList")) return { code: "success", data: [] };
    if (url.pathname.endsWith("square/index2")) return { code: "success", data: [{ articleId: "article-device" }] };
    if (url.pathname.endsWith("getShareCode")) return { code: "success", data: "code-device" };
    throw new Error(`Unexpected request: ${request.method} ${request.url}`);
  });

  assert.match(result.saved.lynk_last_sign_date, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(result.notifications[0].body, /签到成功 \| \+1 能量体/);
}

async function testSignSupportsPathOverride() {
  const result = await runQx({
    lynk_refresh_token: "main-refresh",
    lynk_device_id: "main-device",
    lynk_self_share: "0",
    lynk_share_delay: "0",
    lynk_sign_path: "/up/api/v2/user/sign",
  }, async (request) => {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/auth/login/refresh")) {
      return { code: "success", data: { centerTokenDto: { token: "main-access" } } };
    }
    if (url.pathname.endsWith("getContinueDaysAndSignCard")) return { code: "success", data: { continueDays: 6 } };
    if (url.pathname === "/up/api/v2/user/sign") {
      assert.equal(url.hostname, "app-api-gw-toc.lynkco.com");
      assert.ok(request.headers["X-Ca-Key"]);
      assert.equal(request.headers.Authorization, undefined);
      assert.equal(request.headers["X-Ca-Key"], "203760416");
      assert.equal(request.headers.token, "main-access");
      return { code: "success", data: {} };
    }
    if (url.pathname === "/app/energy/myEnergy") return { code: "success", data: { point: 820, incomePoint: 1020 } };
    if (url.pathname === "/app/energy/my/growth") return { code: "success", data: {} };
    if (url.pathname.endsWith("getTaskList")) return { code: "success", data: [] };
    if (url.pathname.endsWith("square/index2")) return { code: "success", data: [{ articleId: "article-private" }] };
    if (url.pathname.endsWith("getShareCode")) return { code: "success", data: "code-private" };
    throw new Error(`Unexpected request: ${request.method} ${request.url}`);
  });

  assert.match(result.notifications[0].body, /签到成功/);
}

async function testLegacySignPathPreferenceIsMigrated() {
  let signPosts = 0;
  const result = await runQx({
    lynk_refresh_token: "main-refresh",
    lynk_device_id: "main-device",
    lynk_self_share: "0",
    lynk_share_delay: "0",
    lynk_sign_path: "/up/api/v1/user/sign",
  }, async (request) => {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/auth/login/refresh")) {
      return { code: "success", data: { centerTokenDto: { token: "main-access" } } };
    }
    if (url.pathname.endsWith("getContinueDaysAndSignCard")) return { code: "success", data: { continueDays: 6 } };
    if (url.pathname.endsWith("/user/sign/upgrade")) {
      signPosts += 1;
      assert.equal(request.headers.Authorization, undefined);
      assert.equal(request.headers.token, "main-access");
      assert.ok(request.headers["X-Ca-Signature"]);
      assert.equal(request.headers["X-Ca-Key"], "203760416");
      return { code: "success", data: { rewardEnergyNumber: 1 } };
    }
    if (url.pathname === "/app/energy/myEnergy") return { code: "success", data: { point: 821, incomePoint: 1021 } };
    if (url.pathname === "/app/energy/my/growth") return { code: "success", data: {} };
    if (url.pathname.endsWith("getTaskList")) return { code: "success", data: [] };
    if (url.pathname.endsWith("square/index2")) return { code: "success", data: [{ articleId: "article-fallback" }] };
    if (url.pathname.endsWith("getShareCode")) return { code: "success", data: "code-fallback" };
    throw new Error(`Unexpected request: ${request.method} ${request.url}`);
  });

  assert.equal(signPosts, 1, "legacy /user/sign preference must migrate to /user/sign/upgrade");
  assert.match(result.notifications[0].body, /签到成功 \| \+1 能量体/);
}

// 捕获到「响应带奖励字段」的真实签到 POST 时，重放其 host/path/Key，不回退默认端点。
async function testCapturedRewardSignProfileIsReplayed() {
  const captured = {
    captureType: "sign-post",
    method: "POST",
    host: "app-api-gw-toc.lynkco.com",
    path: "/up/api/v1/user/sign/upgrade",
    xCaKey: "203760416",
    signatureHeaders: "X-Ca-Key,X-Ca-Timestamp,X-Ca-Nonce,X-Ca-Stage",
    hasAppCode: false,
    hasCepAuthentication: false,
    useSecurity: true,
    hasRiskType: false,
    xCaVersion: "1",
    contentType: "application/json",
    accept: "*/*",
    publicPlatform: "iOS",
    appVersion: "4.2.4",
    appBuild: "40204067",
    deviceHeaderNames: ["gl_app_build", "gl_app_version", "gl_dev_id"],
    responseHasReward: true,
  };
  let signPosts = 0;
  const result = await runQx({
    lynk_refresh_token: "main-refresh",
    lynk_device_id: "main-device",
    lynk_self_share: "0",
    lynk_share_delay: "0",
    lynk_sign_capture: JSON.stringify(captured),
  }, async (request) => {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/auth/login/refresh")) {
      return { code: "success", data: { centerTokenDto: { token: "main-access" } } };
    }
    if (url.pathname.endsWith("getContinueDaysAndSignCard")) return { code: "success", data: { continueDays: 6 } };
    if (url.pathname === "/up/api/v1/user/sign/upgrade") {
      signPosts += 1;
      assert.equal(url.hostname, "app-api-gw-toc.lynkco.com");
      assert.equal(request.headers["X-Ca-Key"], "203760416");
      assert.equal(request.headers.Authorization, undefined);
      assert.equal(request.headers.token, "main-access");
      assert.equal(request.headers.use_security, "true");
      assert.equal(request.headers["x-ca-version"], "1");
      assert.equal(request.headers["x-ca-stage"], "RELEASE");
      assert.equal(request.headers["X-Ca-Signature-Headers"], captured.signatureHeaders);
      assert.equal(request.headers.gl_dev_id, "main-device");
      assert.equal(request.headers.gl_app_version, "4.2.4");
      const stringToSign = [
        "POST", "*/*", "", "application/json", "",
        `X-Ca-Key:${request.headers["X-Ca-Key"]}`,
        `X-Ca-Nonce:${request.headers["X-Ca-Nonce"]}`,
        "X-Ca-Stage:RELEASE",
        `X-Ca-Timestamp:${request.headers["X-Ca-Timestamp"]}`,
        "/up/api/v1/user/sign/upgrade",
      ].join("\n");
      const expectedSignature = crypto.createHmac("sha256", "IbyhE02AwkUzvupDon3xTZ3JIeddlppP")
        .update(stringToSign).digest("base64");
      assert.equal(request.headers["X-Ca-Signature"], expectedSignature);
      return { code: "success", data: { rewardEnergyNumber: 1 } };
    }
    if (url.pathname === "/app/energy/myEnergy") return { code: "success", data: { point: 821, incomePoint: 1021 } };
    if (url.pathname === "/app/energy/my/growth") return { code: "success", data: {} };
    if (url.pathname.endsWith("getTaskList")) return { code: "success", data: [] };
    if (url.pathname.endsWith("square/index2")) return { code: "success", data: [{ articleId: "article-cap" }] };
    if (url.pathname.endsWith("getShareCode")) return { code: "success", data: "code-cap" };
    throw new Error(`Unexpected request: ${request.method} ${request.url}`);
  });

  assert.equal(signPosts, 1);
  assert.match(result.notifications[0].body, /签到成功 \| \+1 能量体/);
}

// 捕获到的 POST 若响应不含奖励字段（状态探测），绝不当作签到动作 —— 修复最初的 bug。
async function testCapturedNonRewardPostIsIgnored() {
  const captured = {
    captureType: "sign-post",
    method: "POST",
    host: "app-api-gw-toc.lynkco.com",
    path: "/up/api/v1/user/sign/info",
    xCaKey: "204644386",
    signatureHeaders: "X-Ca-Key,X-Ca-Timestamp,X-Ca-Nonce,X-Ca-Signature-Method",
    hasAppCode: false,
    responseHasReward: false,
  };
  let defaultSignPosts = 0;
  const result = await runQx({
    lynk_refresh_token: "main-refresh",
    lynk_device_id: "main-device",
    lynk_self_share: "0",
    lynk_share_delay: "0",
    lynk_sign_capture: JSON.stringify(captured),
  }, async (request) => {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/auth/login/refresh")) {
      return { code: "success", data: { centerTokenDto: { token: "main-access" } } };
    }
    if (url.pathname.endsWith("getContinueDaysAndSignCard")) return { code: "success", data: { continueDays: 6 } };
    if (url.pathname === "/up/api/v1/user/sign/info") throw new Error("non-reward captured probe must never be replayed as the sign action");
    if (url.pathname === "/up/api/v1/user/sign/upgrade") {
      defaultSignPosts += 1;
      return { code: "success", data: { rewardEnergyNumber: 1 } };
    }
    if (url.pathname === "/app/energy/myEnergy") return { code: "success", data: { point: 821, incomePoint: 1021 } };
    if (url.pathname === "/app/energy/my/growth") return { code: "success", data: {} };
    if (url.pathname.endsWith("getTaskList")) return { code: "success", data: [] };
    if (url.pathname.endsWith("square/index2")) return { code: "success", data: [{ articleId: "article-probe" }] };
    if (url.pathname.endsWith("getShareCode")) return { code: "success", data: "code-probe" };
    throw new Error(`Unexpected request: ${request.method} ${request.url}`);
  });

  assert.equal(defaultSignPosts, 1, "must fall back to default endpoint, ignoring the non-reward capture");
  assert.match(result.notifications[0].body, /签到成功/);
}

async function testLocalSignDateSkipsDuplicatePost() {
  const today = new Date();
  const dateKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const result = await runQx({
    lynk_refresh_token: "main-refresh",
    lynk_device_id: "main-device",
    lynk_self_share: "0",
    lynk_share_delay: "0",
    lynk_last_sign_date: dateKey,
  }, async (request) => {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/auth/login/refresh")) {
      return { code: "success", data: { centerTokenDto: { token: "main-access" } } };
    }
    if (url.pathname.endsWith("getContinueDaysAndSignCard")) return { code: "success", data: { continueDays: 7 } };
    if (url.pathname.endsWith("/user/sign/upgrade")) throw new Error("sign POST must be skipped after a local success record");
    if (url.pathname === "/app/energy/myEnergy") return { code: "success", data: { point: 812, incomePoint: 1012 } };
    if (url.pathname === "/app/energy/my/growth") return { code: "success", data: {} };
    if (url.pathname.endsWith("getTaskList")) return { code: "success", data: [] };
    if (url.pathname.endsWith("square/index2")) return { code: "success", data: [{ articleId: "article-cache" }] };
    if (url.pathname.endsWith("getShareCode")) return { code: "success", data: "code-cache" };
    throw new Error(`Unexpected request: ${request.method} ${request.url}`);
  });

  assert.equal(result.requests.some((request) => new URL(request.url).pathname.endsWith("/user/sign/upgrade")), false);
  assert.match(result.notifications[0].body, /已签到 \| 无新增/);
}

async function testDayInfoSkipsDuplicateSignPost() {
  const result = await runQx({
    lynk_refresh_token: "main-refresh",
    lynk_device_id: "main-device",
    lynk_self_share: "0",
    lynk_share_delay: "0",
  }, async (request) => {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/auth/login/refresh")) {
      return { code: "success", data: { centerTokenDto: { token: "main-access" } } };
    }
    if (url.pathname.endsWith("getContinueDaysAndSignCard")) return { code: "success", data: { continueDays: 8 } };
    if (url.pathname.endsWith("/user/sign/day/info")) {
      assert.equal(url.hostname, "app-api-gw-toc.lynkco.com");
      assert.equal(request.headers.Authorization, undefined);
      assert.ok(request.headers["X-Ca-Key"]);
      return { code: "success", data: { todaySigned: 1 } };
    }
    if (url.pathname.endsWith("/user/sign/upgrade")) throw new Error("sign POST must be skipped when day/info confirms signed");
    if (url.pathname === "/app/energy/myEnergy") return { code: "success", data: { point: 830, incomePoint: 1030 } };
    if (url.pathname === "/app/energy/my/growth") return { code: "success", data: {} };
    if (url.pathname.endsWith("getTaskList")) return { code: "success", data: [] };
    if (url.pathname.endsWith("square/index2")) return { code: "success", data: [{ articleId: "article-day-info" }] };
    if (url.pathname.endsWith("getShareCode")) return { code: "success", data: "code-day-info" };
    throw new Error(`Unexpected request: ${request.method} ${request.url}`);
  });

  assert.equal(result.requests.some((request) => new URL(request.url).pathname === "/up/api/v1/user/sign/upgrade"), false);
  assert.match(result.notifications[0].body, /已签到 \| 无新增/);
  assert.match(result.saved.lynk_last_sign_date, /^\d{4}-\d{2}-\d{2}$/);
}

(async () => {
  await testSelfShare();
  await testSecondaryShare();
  await testAcceptedWithoutRewardIsFailure();
  await testAmbiguousSignResponseIsRechecked();
  await testAlreadySignedBusinessResponse();
  await testSignUsesIosGatewayAuthAndCachesDate();
  await testSignSupportsPathOverride();
  await testLegacySignPathPreferenceIsMigrated();
  await testCapturedRewardSignProfileIsReplayed();
  await testCapturedNonRewardPostIsIgnored();
  await testLocalSignDateSkipsDuplicatePost();
  await testDayInfoSkipsDuplicateSignPost();
  console.log("lynk_qx tests passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
