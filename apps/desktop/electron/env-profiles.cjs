/**
 * Desktop 控制面 / 登录门面 URL：唯一维护处。
 * start-desktop / build-mac 只选 dev|prod；单 URL 覆盖仍可用 AGENTUP_BACKEND_URL / AGENTUP_WEB_URL。
 */
module.exports = {
  dev: {
    backendUrl: "http://127.0.0.1:8787",
    webUrl: "http://127.0.0.1:45280",
    // 开发态也打正式下载源，便于菜单「检查更新」联调；本地未发版时会显示已是最新或网络错误
    downloadsUrl: "https://downloads.agentup.me",
  },
  prod: {
    backendUrl: "https://api.agentup.me",
    webUrl: "https://agentup.me",
    downloadsUrl: "https://downloads.agentup.me",
  },
};
