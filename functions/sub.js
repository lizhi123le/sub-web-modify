// Cloudflare Pages Functions - Sub API Proxy
// 简单的后端API转发
// 环境变量: BACKEND_API_URL

const DEFAULT_BACKEND = "https://url.v1.mk";

// 处理订阅转换请求
async function handleSubRequest(request, url, backend) {
  const backendUrl = backend + url.pathname + url.search;
  
  // 构建转发的请求头
  const headers = new Headers(request.headers);
  headers.set("Host", new URL(backend).host);
  headers.set("X-Forwarded-Host", url.host);
  headers.set("X-Forwarded-Proto", url.protocol.replace(":", ""));
  headers.set("Referer", backend);
  
  try {
    const response = await fetch(backendUrl, {
      method: request.method,
      headers: headers,
      body: request.method !== "GET" && request.method !== "HEAD" ? await request.text() : undefined
    });
    
    // 获取响应内容
    const content = await response.text();
    
    // 构建响应头
    const responseHeaders = new Headers(response.headers);
    responseHeaders.set("Access-Control-Allow-Origin", "*");
    
    // 移除可能暴露真实后端的头
    responseHeaders.delete("server");
    responseHeaders.delete("x-served-by");
    
    return new Response(content, {
      status: response.status,
      headers: responseHeaders
    });
  } catch (e) {
    return new Response("Error: " + e.message, {
      status: 500,
      headers: { 
        "Content-Type": "text/plain; charset=utf-8",
        "Access-Control-Allow-Origin": "*"
      }
    });
  }
}

// 处理版本请求
async function handleVersionRequest(backend) {
  try {
    const response = await fetch(`${backend}/version`, {
      signal: AbortSignal.timeout(5000)
    });
    
    const text = await response.text();
    return new Response(text, {
      status: 200,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Access-Control-Allow-Origin": "*"
      }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: "Backend unavailable", message: e.message }), {
      status: 503,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
      }
    });
  }
}

export async function onRequest(context) {
  const request = context.request;
  const env = context.env;
  const url = new URL(request.url);
  
  // 获取后端地址
  const BACKEND = env.BACKEND_API_URL || DEFAULT_BACKEND;
  
  // 根路径 - 返回简单说明
  if (url.pathname === "/" || url.pathname === "") {
    return new Response(`<!DOCTYPE html>
<html>
<head><title>sub-web-modify</title></head>
<body>
<h1>Sub Web Modify - API Proxy</h1>
<p>Backend: ${BACKEND}</p>
<p>Use: /sub?url=YOUR_SUBSCRIPTION_URL</p>
<p>Version: /version</p>
</body>
</html>`, {
      headers: { "Content-Type": "text/html; charset=utf-8" }
    });
  }
  
  // 版本端点
  if (url.pathname === "/version") {
    return await handleVersionRequest(BACKEND);
  }
  
  // 订阅转换端点 (/sub)
  if (url.pathname === "/sub" || url.pathname.startsWith("/sub")) {
    return await handleSubRequest(request, url, BACKEND);
  }
  
  return new Response("Not Found", { status: 404 });
}
