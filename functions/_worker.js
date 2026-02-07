// Cloudflare Pages Functions - Main Entry
// 处理所有 /api/* 和 /version 路由

// 处理 /version 路由
async function handleVersion(request, env) {
  // 优先使用环境变量，否则使用默认值
  var backendApi = env.BACKEND_API_URL || "https://url.v1.mk";
  var backendVersionUrl = backendApi + "/version";

  var backendVersion = null;
  var backendError = null;

  // 尝试获取后端 API 版本信息
  try {
    var response = await fetch(backendVersionUrl, {
      method: "GET",
      headers: {
        "User-Agent": "sub-web-modify-version-checker"
      }
    });
    if (response.ok) {
      backendVersion = await response.json();
    } else {
      backendError = "HTTP " + response.status;
    }
  } catch (error) {
    backendError = error.message;
  }

  var data = {
    frontend: {
      name: "sub-web-modify",
      version: "1.0.0",
      description: "订阅转换前端",
      repository: "https://github.com/cmliu/sub-web-modify"
    },
    backendApi: {
      url: backendApi,
      versionEndpoint: backendVersionUrl,
      version: backendVersion,
      error: backendError
    },
    timestamp: new Date().toISOString(),
    requestUrl: new URL(request.url).origin
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
async function onRequest(context) {
  var request = context.request;
  var env = context.env;
  var url = new URL(request.url);

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

export { onRequest };
