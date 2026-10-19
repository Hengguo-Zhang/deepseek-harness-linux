# DeepSeek Harness：官方版本追踪与 Linux OTA

这是面向 **Ubuntu 24.04、amd64/x86_64** 的非官方 Linux 分发补丁。官方 macOS、Windows 的构建和更新路径保持原状。Linux 桌面沿用现有的“检查更新 / 下载 / 安装并重启”界面，更新整个桌面程序及其随附运行时。关闭窗口会隐藏到系统托盘（Ubuntu 由 AppIndicator 扩展提供），托盘菜单可重新打开窗口或退出。

## 1. 建立公开分发仓库

推荐使用随附的 `deepseek-harness-linux-distribution-starter.zip`：解压后，将其中的 `.github/`、`linux-distribution/`、本 README 和 LICENSE 推送到你自己的 **公开 GitHub 仓库**。这个精简分发仓库不需要存放完整官方源码；Actions 每次会根据固定提交下载官方源码，再应用仓库中的 Linux 补丁。也可以把完整补丁源码推送到 fork。下文以 `YOUR_NAME/deepseek-harness-linux` 为例。仓库应专用于这个 Linux 更新通道：不要把其他软件的 Release 标为 Latest。工作流会拒绝覆盖已经发布的 Linux 版本，也会拒绝把当前更新通道降到较低版本。

在 GitHub 创建一个空的公开仓库，然后在精简包解压目录执行（将仓库地址替换为自己的）：

```sh
git init -b main
git add .github linux-distribution README-LINUX-OTA.md LICENSE
git commit -m "Add unofficial Linux OTA distribution"
git remote add origin https://github.com/YOUR_NAME/deepseek-harness-linux.git
git push -u origin main
```

确认默认分支包含 `.github/workflows/linux-ota.yml` 和完整 `linux-distribution/`；其中的补丁已包含根目录构建脚本和桌面 Linux 修改。在 GitHub 的 **Actions** 页面启用工作流；fork 的定时工作流通常需要主动启用。定时触发只运行默认分支，每 6 小时检查一次；首次推送以及 main 分支的工作流或维护补丁变更也会触发构建；长期无活动的公开仓库可能需要重新启用定时运行。

本工作流不会推送回官方仓库。发布标签为 `linux-v0.2.1-rc.2`，与官方 `dsh-v0.2.1-rc.2` 分开，避免 fork 中已有官方标签发生冲突。

## 2. 配置变量与权限

在 **Settings → Secrets and variables → Actions → Variables** 可设置：

| 变量 | 默认值 | 含义 |
| --- | --- | --- |
| `DSH_TRACK_PRERELEASES` | `true` | 跟踪官方 RC。设为 `false` 仅接受稳定语义版本标签。 |
| `DSH_UPSTREAM_SOURCE` | `tags` | 从官方 tags 选择版本；设为 `releases` 仅接受已有非草稿 GitHub Release 的 tags。 |

官方来源固定为 `deepseek-ai/deepseek-harness`。不需要配置 DeepSeek API Key、云存储密钥或个人 GitHub Token；同仓库发布使用 GitHub 自动提供的 `GITHUB_TOKEN`。若组织策略限制写入，允许此工作流的 `publish` 作业使用 `contents: write`。发现和构建作业只有仓库读取权限；构建步骤不注入发布令牌，源码检出后不保存 Git 凭据。组织若要求更严格的令牌隔离，可进一步将构建放入独立仓库；第三方 Actions 自身仍由 GitHub 提供作业运行环境。

Linux feed 在构建时自动写为 `https://github.com/YOUR_NAME/deepseek-harness-linux/releases/latest/download/`，不需要手改应用源码。`DSH_LINUX_OTA_REPOSITORY` 是**本机构建参数**；Actions 直接使用当前分发仓库名，避免把更新发到另一个仓库。公开分发不需要把访问令牌放入桌面应用。

## 3. 第一次发布与安装

在 **Actions → Linux official tracking and OTA → Run workflow** 运行。`upstream_tag` 留空会选择符合策略的最新语义版本；也可输入已存在的官方标签，例如 `dsh-v0.2.1-rc.2`。分支名、任意提交和非版本标签不会作为手动更新目标。

工作流解析版本大小而不是依赖标签返回顺序，固定官方提交 SHA，再核对根包和桌面包版本。随后按顺序检查维护的 `linux-amd64-0.2.1.patch`、`linux-amd64.patch`，只应用能够完整通过 `git apply --check` 的补丁。二者都不适用时停止；不会忽略失败片段或发布未经补丁的新版本。

Ubuntu 24.04 构建完成后，工作流验证 `.deb`、版本、文件长度、SHA-512、feed 地址及源码记录。发布作业先上传草稿资源，再公开完整 Release；用户可见的 Latest 不会指向上传一半的版本。失败后重新运行 `publish` 作业可用原始构建资源补传缺失文件，已有文件只有 GitHub 返回的 SHA-256 相同时才会复用。若重新构建使草稿已有文件发生变化，或已有文件缺少可核验摘要，工作流停止；确认仍为未公开草稿后，手动删除草稿再重新运行。任何资源都不会被覆盖。最终 metadata 中的 DEB 地址绑定具体 `linux-v…` 标签，因此检查后即使另有新版本发布，也会下载原来选中的文件。

Release 包含：

- `*.deb`：Ubuntu amd64 安装包。
- `latest-linux.yml`：electron-updater 版本与 SHA-512 信息。
- `app-update.yml`：包内 feed 配置的副本，便于核对；应用实际读取安装包内 `resources/app-update.yml`。
- `linux-source.json`：官方标签、提交 SHA、分发仓库、构建工作流提交及所用 Linux 补丁的 SHA-256。

下载首个 DEB 后安装：

```sh
sudo apt install ./deepseek-harness-*-linux-amd64.deb
```

安装包的准确文件名以 Release 为准。先前没有配置 OTA 源的 Linux 安装需要手动安装一次这份新包，此后才能使用应用内更新。

## 4. 应用内更新与权限

应用作为普通桌面用户运行。现有“检查更新”界面读取 Linux feed，由 electron-updater 下载并校验 DEB。用户选择安装后，通过 `/usr/bin/pkexec` 调用系统 `/usr/bin/dpkg --install`，系统图形认证窗口请求管理员授权。不会以 root 身份启动 Electron。安装由系统包管理器执行，DEB 的维护脚本会按标准安装流程运行，因此应只使用你控制的发行仓库。

Ubuntu 需要 `pkexec`、`polkitd` 和正在运行的图形认证代理。安装被取消、权限不足、包管理器锁被占用或 `dpkg` 失败时，应用报告错误并保留当前进程；只有安装成功后才安排普通用户进程重启。更新可能中断正在进行的任务，应先保存工作。`dpkg` 失败可能已经部分改变系统包状态；根据错误修复包管理器后再重试，不能把失败视为事务回滚。

如果系统缺少认证工具，可执行：

```sh
sudo apt install pkexec polkitd
```

本方案针对普通 Ubuntu 桌面 DEB 安装，不适用于 Snap、Flatpak、AppImage、arm64 或无图形认证代理的纯命令行环境。遇到依赖不满足时，关闭应用并使用 `sudo apt install ./下载的文件.deb` 让系统处理依赖；不要用 `sudo` 启动桌面应用。

## 5. 本地构建

本地构建使用完整 patched source archive，精简分发仓库本身不包含应用源码。在 Ubuntu 24.04 amd64 安装 Node.js `^22.19.0` 或 `>=24.0.0`（Actions 固定使用 Node 24），以及根 `package.json` 的 `packageManager` 指定的 pnpm（本次旧版为 11.7.0，新版为 11.28.5）。不要使用 Ubuntu 软件源里版本不符合要求的旧 Node。构建脚本会核对版本并给出缺失提示。

```sh
sudo apt update
sudo apt install build-essential python3 pkg-config libx11-dev libxkbfile-dev libsecret-1-dev libnss3 libatk-bridge2.0-0t64 libdrm2 libgbm1 libasound2t64 fakeroot dpkg-dev libarchive-tools rpm
export DSH_LINUX_OTA_REPOSITORY=YOUR_NAME/deepseek-harness-linux
bash ./build-linux-amd64-deb.sh
```

输出位于 `dist/linux-ota/`。本地只生成包，不上传 Release；不要把 `linux-unpacked/` 或 `builder-effective-config.yaml` 当作发布资源。先运行 Actions 完成首次发布更容易保持版本和源码记录一致。

## 6. 维护 Linux 补丁

补丁分别面向提供的 `0.2.0-rc.2` 基础源码与官方 `0.2.1-rc.2` 源码。上游以后改动桌面运行时准备流程、包构建流程或 updater 时，可能需要维护新补丁。构建停止后，在独立目录检出工作流显示的官方提交，审阅差异，修正 Linux 代码，运行相关桌面测试和构建，再生成包含新增文件的完整补丁。将新补丁加入工作流的有序候选列表，先用 `git apply --check` 检查干净官方源码，再重试发布。不要对上游补丁失败使用 `--reject` 后继续打包。

一次官方版本只能公开发布一次。应用版本遵循官方语义版本；`+linux.N` 不会让 electron-updater 判定为新版，而给稳定版追加 `-linux.N` 会使其低于原稳定版。因此当前工作流不使用伪造版本号来覆盖相同官方版本；同版本补丁应在公开发布前修复，或在后续官方版本中发布。需要独立 Linux 修订通道时，应先制定与官方 RC/稳定版都保持单调递增的版本策略。

此 feed 是专用 Linux 通道。即使源版本为 RC，分发 Release 仍标记为 GitHub **非 prerelease**，以便 `/releases/latest/download/` 正常工作；Release 标题、说明和 `linux-source.json` 会明确标出官方 RC。若不接受 RC，请在首次发布前设置 `DSH_TRACK_PRERELEASES=false`。

## 7. 检查与验收范围

无需凭据的本地检查（完整工作区安装依赖后，可再运行 `pnpm exec vitest run apps/desktop/tests/update-coordinator.spec.ts apps/desktop/tests/linux-update.spec.ts apps/desktop/tests/desktop-build-paths.spec.ts apps/desktop/tests/cli-launcher.spec.ts`）：

```sh
node --test linux-distribution/tests/*.test.mjs
node --check linux-distribution/tracking.mjs
node --check linux-distribution/publish.mjs
bash -n build-linux-amd64-deb.sh
```

追踪测试覆盖版本排序、RC 策略、手动标签、已发布版本跳过、草稿重试和已公开不完整版本拒绝；资源测试覆盖不可变下载地址、内容篡改、路径越界、feed/版本/源码记录不一致。完整 DEB 构建还需要网络下载官方包依赖和 Electron。`Hengguo-Zhang/deepseek-harness-linux` 已实测公开 Release 创建、GitHub Latest 重定向和真实下载（`linux-v0.2.1-rc.2`）；图形授权窗口、安装后重启仍需在 Ubuntu 桌面上点击确认，未自动化。

SHA-512 用于检验下载内容是否符合 feed，不能替代独立签名；分发仓库及其发布权限是更新信任来源。请保护仓库写权限，并审阅官方新版本与 Linux 补丁后使用。
