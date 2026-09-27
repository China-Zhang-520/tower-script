// ============================================================
// 权限检查 & 初始化（针对打包版优化）
// ============================================================
if (!auto.service) {
    toast("⚠️ 请先开启无障碍服务");
    auto.waitFor();
}
log("✅ 无障碍服务已就绪");

if (!floaty.checkPermission()) {
    toast("⚠️ 请授予悬浮窗权限");
    try { floaty.requestPermission(); } catch (e) {}
    exit();
}
log("✅ 悬浮窗权限正常");

toast("请确保 APP 显示在前台，5秒后申请截图");
sleep(5000);

var captureOk = false;
for (var i = 0; i < 5; i++) {
    try {
        if (requestScreenCapture()) {
            captureOk = true;
            break;
        }
    } catch (e) {
        log("⚠️ 截图权限申请异常: " + e);
    }
    toast("⚠️ 截图申请失败，3秒后重试。（第 " + (i+1) + " 次）");
    sleep(3000);
}

if (!captureOk) {
    toast("❌ 截图权限申请失败，请保持 APP 在前台后重启 APP");
    exit();
}
log("✅ 截图权限已获取");
log("ℹ️ 请手动确认：设置 → 应用 → Auto.js → 权限 → 允许「后台弹出界面」");
log("ℹ️ 请手动确认：设置 → 电池 → Auto.js → 无限制 / 不优化");

// ============================================================
// ⭐⭐ 自动分辨率适配 ⭐⭐
// ============================================================
var BASE_W = 1224;
var BASE_H = 2700;

var REAL_W = device.width;
var REAL_H = device.height;

var SCALE_X = REAL_W / BASE_W;
var SCALE_Y = REAL_H / BASE_H;

log("📱 当前分辨率: " + REAL_W + "x" + REAL_H);
log("📏 缩放比例: X=" + SCALE_X.toFixed(3) + " Y=" + SCALE_Y.toFixed(3));

// ⭐ 坐标转换
function P(x, y) {
    return {
        x: Math.round(x * SCALE_X),
        y: Math.round(y * SCALE_Y)
    };
}

// ⭐ 区域转换
function R(x, y, w, h) {
    return {
        x: Math.round(x * SCALE_X),
        y: Math.round(y * SCALE_Y),
        w: Math.round(w * SCALE_X),
        h: Math.round(h * SCALE_Y)
    };
}

// ============================================================
// 坐标配置（全部用 P / R 包裹）
// ============================================================
var searchIcon   = P(97, 2019);
var beastOption  = P(410, 2084);
var panelSearch  = P(589, 2589);
var rallyBtn     = P(643, 1186);
var confirmRally = P(616, 1736);
var deployBtn    = P(933, 2586);
var ertydfgh     = P(139, 2551);

// ⭐ 识别区域（"6/6"位置，已验证 ✅）
var COUNT_REGION = R(330, 485, 75, 78);

// ⭐ 弹窗文字识别区域（已验证 ✅）
var DIALOG_REGION   = R(140, 1280, 940, 170);
var DIALOG_OK_POINT = P(800, 1600);

// ⭐ 盾兵识别区域（1/2/3 行）
var SHIELD_REGION_1 = R(250, 1190, 230, 85);
var SHIELD_REGION_2 = R(250, 1430, 230, 85);
var SHIELD_REGION_3 = R(250, 1680, 230, 85);

// ⭐ 对应行的"+"号按钮
var SHIELD_PLUS_1   = P(1105, 1320);
var SHIELD_PLUS_2   = P(1105, 1550);
var SHIELD_PLUS_3   = P(1105, 1810);

// ============================================================
// OCR 初始化
// ============================================================
var ocr = null;
try {
    ocr = $ocr.create();
    log("✅ OCR 初始化成功");
} catch (e) {
    log("❌ OCR 初始化失败，请确认 Auto.js 版本或 OCR 模块是否安装: " + e);
}

// ============================================================
// 全局控制变量
// ============================================================
var isRunning = false;
var isThreadRunning = false;

// ============================================================
// 核心防封函数
// ============================================================
function randomPress(x, y, duration, offset) {
    var rx = x + Math.floor(Math.random() * (offset * 2)) - offset;
    var ry = y + Math.floor(Math.random() * (offset * 2)) - offset;
    var rd = duration + Math.floor(Math.random() * 100) - 50;
    press(rx, ry, rd);
}

// ============================================================
// 可中断的等待
// ============================================================
function interruptibleSleep(ms) {
    var elapsed = 0;
    while (elapsed < ms) {
        if (!isRunning) return false;
        sleep(200);
        elapsed += 200;
    }
    return true;
}

// ============================================================
// OCR 识别集结人数
// ============================================================
function detectRallyCount() {
    if (!ocr) return null;
    var img = null, clip = null;
    try {
        img = captureScreen();
        if (!img) return null;

        clip = images.clip(img,
            COUNT_REGION.x, COUNT_REGION.y,
            COUNT_REGION.w, COUNT_REGION.h);

        var results = ocr.detect(clip);
        var text = "";
        if (results && results.length) {
            for (var i = 0; i < results.length; i++) {
                text += (results[i].text || "");
            }
        }
        if (!text) return null;

        var digits = text.replace(/\D/g, "");
        if (digits.length < 2) return null;

        var total = parseInt(digits.charAt(digits.length - 1), 10);
        var cur   = parseInt(digits.charAt(digits.length - 2), 10);
        if (total !== 6) return null;

        toast("识别队列数量 " + cur + "/" + total);
        return { current: cur, total: total, raw: text };
    } catch (e) {
        log("⚠️ OCR 识别异常: " + e);
        return null;
    } finally {
        try { if (clip) clip.recycle(); } catch (e) {}
        try { if (img) img.recycle(); } catch (e) {}
    }
}

// ============================================================
// ⭐ 检测"重复出征"弹窗
// ============================================================
function checkAndDismissDeployDialog() {
    if (!ocr) return false;
    var img = null, clip = null;
    try {
        img = captureScreen();
        if (!img) return false;

        clip = images.clip(img,
            DIALOG_REGION.x, DIALOG_REGION.y,
            DIALOG_REGION.w, DIALOG_REGION.h);

        var results = ocr.detect(clip);
        var text = "";
        if (results && results.length) {
            for (var i = 0; i < results.length; i++) {
                text += (results[i].text || "");
            }
        }

        if (text.indexOf("发兵") >= 0 ||
            text.indexOf("依然") >= 0 ||
            text.indexOf("出征目标") >= 0) {

            log("⚠️ 检测到重复出征弹窗: [" + text + "]");
            toast("⚠️ 检测到弹窗，点确定");
            randomPress(DIALOG_OK_POINT.x, DIALOG_OK_POINT.y, 200, 8);
            return true;
        }

        log("ℹ️ 未识别到弹窗 (raw=" + text + ")");
        return false;

    } catch (e) {
        log("⚠️ 弹窗检测异常: " + e);
        return false;
    } finally {
        try { if (clip) clip.recycle(); } catch (e) {}
        try { if (img) img.recycle(); } catch (e) {}
    }
}

// ============================================================
// ⭐ 识别 3 行兵种，返回盾兵所在行的"+"号坐标
// ============================================================
function findShieldRow() {
    if (!ocr) return null;

    var regions = [SHIELD_REGION_1, SHIELD_REGION_2, SHIELD_REGION_3];
    var pluses  = [SHIELD_PLUS_1, SHIELD_PLUS_2, SHIELD_PLUS_3];
    var found = null;

    for (var i = 0; i < regions.length; i++) {
        if (!isRunning) return null;

        var img = null, clip = null;
        try {
            img = captureScreen();
            if (!img) continue;

            clip = images.clip(img, regions[i].x, regions[i].y, regions[i].w, regions[i].h);
            var results = ocr.detect(clip);
            var text = "";
            if (results && results.length) {
                for (var k = 0; k < results.length; k++) {
                    text += (results[k].text || "");
                }
            }

            log("🔎 第" + (i+1) + "行识别: [" + text + "]");

            if (text.indexOf("盾兵") >= 0 ||
                text.indexOf("盾") >= 0 ||
                (text.indexOf("兵") >= 0 && text.indexOf("盾") >= 0)) {
                log("🎯 第" + (i+1) + "行检测到盾兵，准备点 + 号");
                found = pluses[i];
                break;
            }
        } catch (e) {
            log("⚠️ 第" + (i+1) + "行识别异常: " + e);
        } finally {
            try { if (clip) clip.recycle(); } catch (e) {}
            try { if (img) img.recycle(); } catch (e) {}
        }

        sleep(400);
    }

    return found;
}

// ============================================================
// 悬浮窗（图片按钮版）
// ============================================================
var floatIcon = images.read("/sdcard/冬日辅助数据库/icon.png");

var w;
if (floatIcon) {
    w = floaty.rawWindow(
        <frame gravity="center">
            <img id="btnToggle" w="50" h="50" />
        </frame>
    );
    w.btnToggle.setImageBitmap(floatIcon.bitmap);
    log("✅ 悬浮窗图片加载成功");
} else {
    w = floaty.rawWindow(
        <frame gravity="center">
            <button id="btnToggle" text="开始" bg="#FF4081" textColor="white" w="50" h="50" textSize="12" />
        </frame>
    );
    log("⚠️ 未找到 icon.png，使用默认按钮");
}

w.setSize(-2, -2);
w.setPosition(50, 100);

// 拖动 + 点击
var downX, downY, winX, winY, isMoved;

w.btnToggle.setOnTouchListener(function(view, event) {
    var action = event.getAction();

    if (action == event.ACTION_DOWN) {
        downX = event.getRawX();
        downY = event.getRawY();
        winX = w.getX();
        winY = w.getY();
        isMoved = false;
        return true;
    } else if (action == event.ACTION_MOVE) {
        var dx = event.getRawX() - downX;
        var dy = event.getRawY() - downY;
        if (Math.abs(dx) > 10 || Math.abs(dy) > 10) {
            isMoved = true;
            w.setPosition(winX + dx, winY + dy);
            return true;
        }
    } else if (action == event.ACTION_UP) {
        if (!isMoved) {
            toggleRunning();
        }
        return true;
    }
    return false;
});

// ============================================================
// 核心打巨兽流程
// ============================================================
function startBeastRally() {
    if (!isRunning) return;
    log("1. 打开搜索面板");
    randomPress(searchIcon.x, searchIcon.y, 200, 15);
    sleep(1500 + Math.random() * 500);

    if (!isRunning) return;
    log("2. 选择冰原巨兽");
    randomPress(beastOption.x, beastOption.y, 200, 10);
    sleep(1500 + Math.random() * 500);

    if (!isRunning) return;
    log("3. 点击搜索按钮");
    randomPress(panelSearch.x, panelSearch.y, 200, 15);
    sleep(1500 + Math.random() * 500);

    if (!isRunning) return;
    log("4. 点击集结按钮");
    randomPress(rallyBtn.x, rallyBtn.y, 200, 15);
    sleep(1500 + Math.random() * 500);

    if (!isRunning) return;
    log("5. 点击发起集结");
    randomPress(confirmRally.x, confirmRally.y, 200, 15);
    sleep(1500 + Math.random() * 500);

    if (!isRunning) return;
    log("6. 全部撤回");
    randomPress(ertydfgh.x, ertydfgh.y, 200, 10);
    sleep(1500 + Math.random() * 500);

    // ⭐ 识别盾兵，找到就点对应的 + 号
    if (!isRunning) return;
    log("6.5 开始识别盾兵...");
    sleep(600);

    var shieldPlus = findShieldRow();
    if (shieldPlus) {
        log("✅ 识别到盾兵，点击 + 号: (" + shieldPlus.x + ", " + shieldPlus.y + ")");
        toast("✅ 识别到盾兵，点击 +");
        randomPress(shieldPlus.x, shieldPlus.y, 200, 8);
        sleep(1500 + Math.random() * 500);
    } else {
        log("ℹ️ 未识别到盾兵，跳过 + 号点击");
    }

    if (!isRunning) return;
    log("8. 点击出征");
    randomPress(deployBtn.x, deployBtn.y, 200, 15);
    sleep(1500);

    if (isRunning) {
        if (checkAndDismissDeployDialog()) {
            log("✅ 弹窗已点确定");
        } else {
            log("ℹ️ 未识别到弹窗，不操作");
        }
    }

    sleep(500);
    log("✅ 一轮完成！");
}

// ============================================================
// 一键开关
// ============================================================
function toggleRunning() {
    if (isRunning) {
        isRunning = false;
        toast("⏸️ 已停止");
        log("⏸️ 用户点击停止");
    } else {
        isRunning = true;
        toast("▶️ 已启动");
        log("▶️ 用户点击启动");

        if (!isThreadRunning) {
            isThreadRunning = true;
            threads.start(function() {
                while (isRunning) {
                    try {
                        startBeastRally();
                        if (!isRunning) break;

                        log("🔍 开始识别集结人数...");
                        var needRestart = false;

                        while (isRunning && !needRestart) {
                            var c = detectRallyCount();

                            if (c) {
                                log("📊 识别到: " + c.current + "/" + c.total +
                                    "  (raw=" + c.raw + ")");
                                toast("📊 队列 " + c.current + "/" + c.total);

                                if (c.current >= c.total) {
                                    log("✅ 已满 6/6，等待 4 秒再识别");
                                    if (!interruptibleSleep(4000)) break;
                                } else {
                                    log("⚠️ 未满 (" + c.current + "/" + c.total + ")，准备重新发起集结");
                                    needRestart = true;
                                }
                            } else {
                                log("❓ 未识别到人数，2 秒后重试");
                                if (!interruptibleSleep(2000)) break;
                            }
                        }

                        if (!isRunning) break;

                        if (!interruptibleSleep(3000 + Math.floor(Math.random() * 3000))) break;

                    } catch (e) {
                        log("❌ 一轮异常: " + e);
                    }
                }
                isThreadRunning = false;
                log("⏹️ 后台线程已退出");
            });
        }
    }
}

// ============================================================
// 启动提示 & 保活
// ============================================================
toast("🚀 脚本已加载，点击悬浮窗开始");
log("🚀 脚本已加载，点击悬浮窗开始");

setInterval(function() {}, 1000);
