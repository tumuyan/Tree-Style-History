#!/usr/bin/env bash
# 让云原生开发环境里的 Chromium 自动带上本仓库的扩展（/workspace/chrome）。
#
# 为什么需要它：镜像里的 Chromium 只是一个普通浏览器，不会读仓库，也没人替它加
# --load-extension。如果不做这层，每次重建环境都要手动
#   chrome://extensions → 开发者模式 → 加载已解压的扩展程序 → 选 /workspace/chrome
# 而环境销毁后 profile 不在漫游范围内（/root 下的东西不保留），下次还得重来一遍。
#
# 做法（两条，都幂等，可重复执行）：
#   1) 在 /usr/local/bin 放一个 chromium 同名 shim：先于 /usr/bin/chromium 被找到，
#      exec 真浏览器时补上 --load-extension=<仓库>/chrome。
#      这样不管从面板点图标、桌面双击、还是在终端敲 chromium，走的都是同一条路。
#   2) 把 /usr/share/applications/chromium*.desktop 的 Exec 指向这个 shim
#      （镜像构建期已经给它们补过 --no-sandbox，这里只是换个可执行文件）。
#
# 关于 --load-extension：Chrome/Edge 早已移除「侧载」用的其它途径，命令行 flag 是
# 唯一可靠的办法（本仓库 e2e/pages.spec.mjs 也是这么加载的，只是那里由 Playwright 传）。
# 它每启动一次都要带上，光把扩展信息写进 profile 的 Preferences 是不行的 —— 实测过：
# 预置 extensions.settings 后启动，页面一律 ERR_BLOCKED_BY_CLIENT。
#
# 环境变量（供测试/覆盖，正常使用不用管）：
#   DEV_BROWSER_PREFIX   安装前缀，默认 /usr/local
#   DEV_BROWSER_DESKTOP  .desktop 目录，默认 /usr/share/applications
#   DEV_BROWSER_BIN      真浏览器，默认自动探测
set -u

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXT_DIR="$REPO_DIR/chrome"
PREFIX="${DEV_BROWSER_PREFIX:-/usr/local}"
DESKTOP_DIR="${DEV_BROWSER_DESKTOP:-/usr/share/applications}"
SHIM="$PREFIX/bin/chromium"

# 不在桌面镜像里（没有 chromium）就静默跳过：这套东西只对带桌面的开发环境有意义。
if [ -n "${DEV_BROWSER_BIN:-}" ]; then
  REAL_BIN="$DEV_BROWSER_BIN"
else
  REAL_BIN=""
  for c in /usr/bin/chromium /usr/bin/chromium-browser /usr/bin/google-chrome; do
    [ -x "$c" ] && { REAL_BIN="$c"; break; }
  done
fi
if [ -z "$REAL_BIN" ] || [ ! -f "$EXT_DIR/manifest.json" ]; then
  echo "dev-browser.sh: 未找到 chromium 或 $EXT_DIR/manifest.json，跳过（当前环境不需要）"
  exit 0
fi

# ── 1. shim ────────────────────────────────────────────────────────────────
mkdir -p "$PREFIX/bin"
cat >"$SHIM" <<EOF
#!/usr/bin/env bash
# 由 scripts/dev-browser.sh 生成：启动 Chromium 时自动加载 $EXT_DIR
# 直接改这个文件没用，改 scripts/dev-browser.sh 后重新执行它。
#
# 实测（Chrome 153 headless）只有两种启动方式能真正渲染出扩展页面：
#   1) chromium --headless=new <扩展页 URL>
#   2) chromium --headless=new about:blank，再用 CDP 打开扩展页
# --app=<扩展页 URL> 渲染成空白页；不带 --headless 在无 DISPLAY 的容器里直接退出。
# 桌面里有 DISPLAY，走普通窗口模式即可，所以这里不写 --headless，交给调用方决定。
set -u
exec "$REAL_BIN" --no-sandbox --load-extension="$EXT_DIR" "\$@"
EOF
chmod +x "$SHIM"

# ── 2. .desktop 指向 shim ──────────────────────────────────────────────────
# 镜像构建期已经把 --no-sandbox 写进 Exec，这里只换可执行文件本身，其余参数保留。
# 幂等：Exec 已经是 shim 时不再改，避免反复执行把行越拼越长。
patched=0
for f in "$DESKTOP_DIR"/chromium*.desktop "$DESKTOP_DIR"/google-chrome*.desktop; do
  [ -f "$f" ] || continue
  grep -q "^Exec=$SHIM" "$f" && continue
  sed -i -E "s#^Exec=.*/(chromium|chromium-browser|google-chrome)([^ ]*)(.*)\$#Exec=$SHIM\3#" "$f"
  grep -q "^Exec=$SHIM" "$f" && patched=$((patched + 1))
done
# 镜像里 chromium.desktop 常见写法是 Exec=chromium --no-sandbox %U（不带路径），
# 上面的正则覆盖不到，这里再兜一次：只替换行首那个裸命令名。
for f in "$DESKTOP_DIR"/chromium*.desktop "$DESKTOP_DIR"/google-chrome*.desktop; do
  [ -f "$f" ] || continue
  grep -q "^Exec=$SHIM" "$f" && continue
  sed -i -E "s#^Exec=(chromium|chromium-browser|google-chrome)([ ])#Exec=$SHIM\2#" "$f"
  grep -q "^Exec=$SHIM" "$f" && patched=$((patched + 1))
done

# ── 3. 桌面/菜单里再加一个「直接打开树状历史页」的入口 ─────────────────────
# 扩展 id 由 chrome 按扩展目录的绝对路径算（sha256 前 16 字节 → 每 hex 字符映射 a-p），
# 路径固定为 /workspace/chrome 时它也是固定的，所以这里能算出来、不用去浏览器里抄。
ext_id() {
  printf '%s' "$EXT_DIR" | sha256sum | cut -c1-32 | tr '0123456789abcdef' 'abcdefghijklmnop'
}
EXT_ID="$(ext_id)"
LAUNCHER="$PREFIX/bin/open-tree-history"
cat >"$LAUNCHER" <<EOF
#!/usr/bin/env bash
# 由 scripts/dev-browser.sh 生成：直接在已加载本仓库扩展的 Chromium 里打开树状历史页。
# 用「位置参数传 URL」而不是 --app=：--app= 在 headless 下会渲染出空白页（实测过）。
exec "$SHIM" chrome-extension://$EXT_ID/history2.html
EOF
chmod +x "$LAUNCHER"
mkdir -p "$HOME/Desktop" "$HOME/.local/share/applications"
cat >"$HOME/.local/share/applications/tree-style-history.desktop" <<EOF
[Desktop Entry]
Type=Application
Version=1.0
Name=Tree Style History
Comment=Open the tree history page in Chromium (extension pre-loaded)
Exec=$LAUNCHER
Icon=$EXT_DIR/images/tree-48.png
Terminal=false
Categories=Utility;
StartupNotify=false
EOF
cp "$HOME/.local/share/applications/tree-style-history.desktop" "$HOME/Desktop/" 2>/dev/null || true
command -v gio >/dev/null 2>&1 && \
  gio set "$HOME/Desktop/tree-style-history.desktop" metadata::trusted true >/dev/null 2>&1 || true

echo "dev-browser.sh: 已就绪"
echo "  shim:     $SHIM -> $REAL_BIN --load-extension=$EXT_DIR"
echo "  .desktop: 改写 $patched 个"
echo "  扩展 id:  $EXT_ID（入口：桌面/菜单里的 Tree Style History）"
