// Cloudflare Pages Functions - Main Entry
// 处理所有 /api/* 和 /version 路由

// 版本信息
const VERSION = {
  name: "sub-web-modify",
  version: "1.0.0",
  description: "订阅转换前端",
  // 后端 API 地址：优先使用环境变量，否则使用默认值
  backendApi: "https://url.v1.mk",
  documentation: "https://github.com/cmliu/sub-web-modify"
};

// 处理 /version 路由
async function handleVersion(request, env) {
  // 优先使用 Cloudflare Pages 环境变量中的后端地址
  const backendApi = env.BACKEND_API_URL || "https://url.v1.mk";

  const data = {
    name: "sub-web-modify",
    version: "1.0.0",
    description: "订阅转换前端",
    backendApi: backendApi,
    documentation: "https://github.com/cmliu/sub-web-modify",
    timestamp: new Date().toISOString(),
    url: new URL(request.url).origin
  };

  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    }
  });
}

// 处理 CORS 预检请求
async function handleOptions(request) {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    }
  });
}

// 主请求处理函数
export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  // 处理 /version 路由
  if (url.pathname === "/version") {
    if (request.method === "OPTIONS") {
      return handleOptions(request);
    }
    return handleVersion(request, env);
  }

  // 其他路由返回 404
  return new Response(JSON.stringify({ error: "Not Found" }), {
    status: 404,
    headers: { "Content-Type": "application/json" }
  });
}
