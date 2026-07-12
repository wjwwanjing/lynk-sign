# 领克 APP 自动签到 - QX 

> iPhone QuantumultX 本地定时脚本，每天自动签到 + 查询账户信息 + 生成分享链接 + iOS 通知推送。

---

## 功能特性

纯本地运行、零外部代码依赖，所有逻辑都在你自己的 QX 里执行：

| 功能 | 说明 |
|------|------|
| 每日自动签到 | 核心功能，由 QX 自带定时器触发 |
| Token 缓存 + 自动轮换 | refreshToken 28 天自动续期，无需反复抓包 |
| 账户信息查询 | 能量体 / 成长等级 / 任务进度 |
| 分享链接生成 | 可复制到微信发，别人点击你 +5 能量体 |
| 自动分享刷积分 | 配小号走三步真实接口；无小号走自助分享任务（`reporting?type=99` 主上报，迁移自 xbgo/lynkco-daily） |
| HMAC-SHA256 签名 | 纯 JS 实现，满足阿里云 API 网关要求 |
| iOS 原生通知 | 结果直接推到通知栏，不依赖任何第三方推送渠道 |

---

## 快速开始

### 1. 安装 QuantumultX

App Store 购买并安装 [QuantumultX](https://apps.apple.com/app/quantumult-x/id1443988620)。

### 2. 抓包获取 Token

需要从领克 APP 抓两个值：**refreshToken** 和 **device_id**。

**具体操作：**

1. 在 QX 里开启 MITM（中间人）抓包
2. 安装并信任 CA 证书（QX → 其他设置 → MITM → 生成证书 → 安装 → 到系统设置里信任）
3. **先开抓包，再登录领克 APP**（refreshToken 只在登录响应里返回一次）
4. 登录成功后停止抓包

**找 refreshToken：**

在抓包记录里搜索 `mobileCodeLogin`，找到登录响应：

```json
{
  "code": "success",
  "data": {
    "centerTokenDto": {
      "token": "bearer<这是accessToken，10分钟有效，不要用>",
      "refreshToken": "bearer<这个就是要的，28天有效>",
      "refreshExpireAt": 1780000000000,
      "expireAt": 1780000000000
    }
  }
}
```

> 注意：`token` 和 `refreshToken` 长得一模一样，别搞混了。`refreshToken` 那个才是我们要的。

**找 device_id：**

随便找一个 `app-api-gw-toc.lynkco.com` 的请求，看请求头里的 `gl_dev_id` 字段，或者从登录 URL 的 `deviceId` 参数里拿。

### 2.5 自动获取 Token（推荐，免手动抓包）★

不想每次手动找 `refreshToken` / `device_id`？用 QX 的「重写规则」让脚本在登录时**自动拦截并保存**，配置一次永久免维护（之后每次刷新也会静默续期）。

**前提（一次性手动，绕不过）**：QX 已装好并信任 MITM CA 证书（设置 → 其他设置 → MITM → 生成证书 → 安装 → 到系统设置里信任）。这是 iOS 系统限制，任何自动化都无法免除。

**推荐做法：订阅远程重写模块（一行搞定，免手动写规则）**

打开 QX 配置文件（长按底部风车 → 配置文件），在 `[rewrite_remote]` 段加入一行，直接订阅仓库里的远程重写链接：

```ini
[rewrite_remote]
https://raw.githubusercontent.com/wjwwanjing/lynk-sign/main/lynk_rewrite.conf, tag=领克Token自动提取, update-interval=172800, opt-parser=false, enabled=true
```

这个远程模块（`lynk_rewrite.conf`）里已经写好了拦截规则和 `hostname`，QX 会自动拉取并合并 MITM 域名，你**不用再手动加 `[rewrite_local]` 规则、也不用手动配 hostname**。

> `update-interval=172800` 表示每 2 天自动检查一次远程更新；改了远程规则后也可在 QX「重写」页面下拉手动刷新。

**接下来**：

1. 确保 QX「重写」总开关已打开（底部风车 → 重写）。
2. 打开领克 APP **重新登录一次**（退出账号再登，或杀进程重登），拦截器会自动把 `refreshToken` 和 `device_id` 写入本地偏好，并弹一条「领克Token已自动保存」通知。之后每天自动签到时也会静默续期。

> 想手动写规则也行：在 `[rewrite_local]` 段加
> `^https?://app-services\.lynkco\.com\.cn/.*login url script-response-body https://raw.githubusercontent.com/wjwwanjing/lynk-sign/main/lynk_token.js`
> 并在 `[mitm]` 段的 `hostname` 里补上 `app-services.lynkco.com.cn`（脚本在本地则把末尾 URL 换成 `lynk_token.js` 文件名）。

> 自动获取后，下面「方法二：QX 偏好设置」里的 `lynk_refresh_token` / `lynk_device_id` **不用再手动填**；想临时覆盖仍可手动填（优先级更高）。`lynk_token_b`（B 账号）仍需手动填。

### 3. 配置脚本

**方法一：直接编辑脚本**

用文本编辑器打开 `lynk_qx.js`，修改顶部的配置区域：

```javascript
const REFRESH_TOKEN = $prefs.valueForKey("lynk_refresh_token") || "bearer你的refreshToken";
const DEVICE_ID     = $prefs.valueForKey("lynk_device_id")     || "你的device_id";
```

把你的值填到引号里（`||` 后面），保存。

**方法二：通过 QX 偏好设置**

QX → 设置 → 其他设置 → 脚本 → 找到 lynk_qx.js → 配置：

| 配置项 | 说明 |
|--------|------|
| `lynk_refresh_token` | refreshToken（`bearer<uuid>` 格式） |
| `lynk_device_id` | 设备 ID |
| `lynk_token_b` | B 账号 refreshToken，逗号分隔多个（可选，用于三步分享） |
| `lynk_share_cid` | 分享文章 ID（可选，默认 `2072260486405246976`） |
| `lynk_self_share` | 单步自助分享开关（`"1"`开/`"0"`关，默认开，无小号时用主账号自身上报，实验性） |

### 4. 添加到 QX 定时任务

打开 QX 配置文件（长按底部风车图标 → 配置文件），在 `[task_local]` 段添加：

```ini
[task_local]
0 9 * * * https://raw.githubusercontent.com/wjwwanjing/lynk-sign/main/lynk_qx.js, tag=领克签到, enabled=true
```

> 使用你自己的 GitHub 仓库的 **raw 原始文件地址**（注意不是 `github.com/.../blob/...` 网页地址，那个 QX 无法执行）。
> 想完全离线 / 不依赖网络时，把地址换成本地路径或 iCloud 路径即可，例如：`0 9 * * * lynk_qx.js, tag=领克签到, enabled=true`。
> ⚠️ 用远程地址时，**Token 一定要走 QX 偏好设置（方法二），千万别写进脚本顶部的 CONFIG 区**——否则脚本提交到公开仓库会泄露你的 refreshToken。

### 5. 手动测试

QX → 工具箱 → 脚本 → 找到「领克签到」→ 点运行，看通知和日志是否正常。

---

## Token 自动续期

脚本会自动管理 Token，不需要手动维护：

- **accessToken**（约 10 分钟有效）：每次运行时自动用 refreshToken 换取，缓存在 QX 本地，8 分钟内复用
- **refreshToken**（28 天有效）：每次 refresh 会返回新的 refreshToken，脚本自动保存

只要脚本每天正常运行，refreshToken 会一直自动续期，不需要重新抓包。

> 如果停用了 28 天以上没跑，refreshToken 会过期，需要重新抓包获取。

---

## 自动分享刷积分（可选）

脚本支持两种分享方式，**根据你有没有配小号自动选择**：

### 方式 A：三步分享（配了小号时用，已验证可加分）

使用 `lookup → check → report` 三步真实接口（与 APP 抓包看到的端点一致，已验证可加分）：

```
POST /app/v1/task/shareCodeToUserId       {shareCode: 主账号分享码}   # 1. 反查分享人
POST /app/v1/task/shareContentContectCheck {contentId, shareCode}     # 2. 后端前置校验
POST /app/v1/task/shareContentContectReporting {contentId, shareCode} # 3. 真正上报加分
```

用你的小号（B 账号）去模拟"别人点击了主账号的分享"，主账号获得 +5 能量体/人/天。

**配置**：在 QX 偏好设置中添加 `lynk_token_b`，填入 B 账号的 refreshToken（多个用英文逗号分隔）：

```
lynk_token_b = bearerB账号1的refreshToken,bearerB账号2的refreshToken
```

**工作流程**：
1. 主账号获取 shareCode
2. 对每个 B 账号：refresh 拿 accessToken → `lookup → check → report` 三步上报
3. B 账号的 refreshToken 也会自动续期保存
4. 通知里展示每个 B 账号的分享结果（`---自动分享 (n/N)---`）

### 方式 B：自助分享任务（不配小号，迁移自 xbgo/lynkco-daily）

**没配 `lynk_token_b` 时**，脚本会用**主账号自身**完成整套分享任务上报——**无需任何小号**。这套链路迁移自 [xbgo/lynkco-daily](https://github.com/xbgo/lynkco-daily) 的实测有效实现，关键点：**真正加分的一步是 `reporting?type=99`（带真实社区文章 `businessNo` + `eventData`）**，而不是单独调 `shareReporting`。

完整链路（`doShareTask`）：

```
POST /app/explore/home-page/square/index2                      # 1. 拉社区信息流，取最新文章 articleId 作为 businessNo
POST /app/v1/task/reporting?type=99  {businessNo, eventData}    # 2. ★真正加分的一步
GET  /app/v1/task/getShareCode        (带风险控制头)             # 3. 取 shareCode
POST /app/v1/task/shareReporting?shareCode=<code> {businessNo, eventData}  # 4. 分享回执
```

- **businessNo** 来源：优先从社区信息流 `square/index2` 取第一篇真实文章 ID；取不到才回退到配置的 `lynk_share_cid`。用真实文章而非固定 ID，更贴近官方 APP 行为。
- **风险控制头**：`getShareCode` 会带上 `use_security` / `risk_type` / `appVersion` / `risk_request_info`（含 `openTimeStamp`、`shareContentType=1`、`shareContentURL`）——这些头**在签名之后合并、不参与签名**，与官方一致。
- **成功判定**：以 `reporting?type=99` 是否返回成功（或"今日已完成"类提示）为准。
- 开关：`lynk_self_share`，默认 `"1"`（开启）；设 `"0"` 关闭。
- 通知里以 `---自助分享(单步)---` 展示最终结果（`OK 成功` / `FAIL <原因>`）。
- 运行日志（QX 脚本日志）会打印 `reporting?type=99` 和 `shareReporting` 各自的 `code` 和 `msg`，方便定位。

> ⚠️ **诚实提示**：是否真给主账号加分，取决于领克后端当前的任务规则。请**跑一次后看通知结果 + 到 APP 里核对能量体有没有真的增加**来确认。若显示 FAIL 或能量体没涨，请改用方式 A（配小号三步）或手动把分享链接发给真人点击。

> 两种方式互斥：**配了小号走 A，没配小号走 B**。都不想用就把 `lynk_self_share` 设 `"0"`，脚本仍会生成分享链接供你手动复制发人点击。

---

## 通知效果

签到成功后，iOS 通知栏会显示：

```
标题:    领克签到成功
副标题:  2026-07-09 09:00:15 | +3 能量体
内容:
  签到成功 | +3 能量体
  连续签到: 52天 | 补签卡: 0张
  能量体: 1888 | 累计: 5101
  等级: 二级 | 成长值: 1683
  ---任务进度---
  连续签到7天: 4 / 7 (1能量体)
  本月度签到25天: 7 / 25 (1补签卡)
  ---分享---
  https://h5.lynkco.com/...
  ---自动分享 (1/1)---
  B1: OK 成功
```

分享链接可以直接复制发到微信，别人点击后你 +5 能量体。

---

## 常见问题

**refreshToken 过期了怎么办？**
28 天有效，脚本会自动续期。如果停用超过 28 天没跑，需要重新抓包。

**accessToken 和 refreshToken 怎么区分？**
都长 `bearer<UUID>` 那样。看响应里的字段名：`token` 是 accessToken（10 分钟），`refreshToken` 才是 28 天的那个。

**签到失败？**
1. 先看日志（QX → 工具箱 → 脚本 → 日志）
2. 最常见原因是 refreshToken 过期，重新抓包
3. 如果提示"已签到"说明之前已经签过了，正常

**脚本怎么调试？**
QX → 工具箱 → 脚本 → 选脚本 → 运行，底部可以看 console.log 输出。

**分享链接点不开？**
链接比较长，确保完整复制。部分微信版本可能需要长按链接才能打开。

---

## 文件说明

| 文件 | 说明 |
|------|------|
| `lynk_qx.js` | QX 定时脚本（当前使用） |
| `lynk_token.js` | QX 重写脚本，自动拦截登录/刷新响应并保存 Token（免手动抓包） |
| `lynk_rewrite.conf` | QX 远程重写模块，供 `[rewrite_remote]` 一行订阅（含拦截规则 + hostname） |

---

## 安全提示

- 所有 Token 只存储在 QX 本地，不会上传到任何服务器
- 仅供个人学习研究使用，请遵守领克 APP 用户协议
- 抓包获取的 Token 请妥善保管，不要外泄
- 使用 GitHub 远程地址时，脚本每次运行从你的仓库拉最新版；Token 仍只存 QX 本地（走偏好设置），不会进仓库。仓库若设为 public，请勿在脚本 CONFIG 区写入任何 Token
