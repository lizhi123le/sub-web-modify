// Cloudflare Pages Functions - Sub API Proxy
// 添加了版本端点、订阅内容端点、KV缓存等功能
// 需要绑定 KV 命名空间: SUBSCRIPTION_CACHE
// 环境变量: BACKEND_API_URL

// 环境变量配置
const BACKEND = process.env.BACKEND_API_URL || "https://url.v1.mk";
const CACHE_TTL = 3600; // 缓存时间 1 小时

// 生成随机字符串
function generateRandomStr(len) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < len; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// 获取当前主机
function getHost(request) {
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}`;
}

// 获取缓存存储 (支持 KV 和内存缓存)
function getCacheStorage(env) {
  if (env.SUBSCRIPTION_CACHE) {
    return {
      type: 'kv',
      get: async (key) => await env.SUBSCRIPTION_CACHE.get(key),
      put: async (key, value, ttl) => await env.SUBSCRIPTION_CACHE.put(key, value, { expirationTtl: ttl || CACHE_TTL }),
      delete: async (key) => await env.SUBSCRIPTION_CACHE.delete(key)
    };
  }
  // 降级到内存缓存 (仅用于开发)
  const memoryCache = new Map();
  return {
    type: 'memory',
    get: (key) => memoryCache.get(key),
    put: (key, value) => { memoryCache.set(key, value); },
    delete: (key) => memoryCache.delete(key)
  };
}

// 处理订阅转换请求
async function handleSubRequest(request, url, backend, host, cache, env) {
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
    let content = await response.text();
    
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

// 处理订阅内容请求 (缓存)
async function handleSubscriptionRequest(request, url, host, cache) {
  const pathParts = url.pathname.split("/").filter(p => p);
  const key = pathParts[pathParts.length - 1];
  
  if (!key || key.includes("..") || key.includes("/")) {
    return new Response("Invalid key", { status: 400 });
  }
  
  try {
    const content = await cache.get(key);
    
    if (!content) {
      return new Response("Not Found", { status: 404 });
    }
    
    // 恢复原始域名替换
    let responseContent = content;
    const headersStr = await cache.get(key + "_headers");
    const headers = headersStr ? JSON.parse(headersStr) : { "Content-Type": "text/plain;charset=UTF-8" };
    
    // 替换回原始后端域名（从缓存内容中恢复）
    // 这里不做反向替换，因为缓存存储的已经是替换后的内容
    headers["Access-Control-Allow-Origin"] = "*";
    
    return new Response(responseContent, { headers });
  } catch (e) {
    return new Response("Cache Error: " + e.message, { status: 500 });
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
  const env = context.env;  // 获取环境变量（含 KV）
  const url = new URL(request.url);
  const host = getHost(request);
  const pathParts = url.pathname.split("/").filter(p => p);
  
  // 获取缓存存储
  const cache = getCacheStorage(env);
  
  // 根路径 - 返回简单说明
  if (url.pathname === "/" || url.pathname === "") {
    return new Response(`<!DOCTYPE html>
<html>
<head><title>sub-web-modify</title></head>
<body>
<h1>Sub Web Modify - API Proxy</h1>
<p>Backend: ${BACKEND}</p>
<p>Cache: ${cache.type === 'kv' ? 'KV Storage' : 'Memory (dev only)'}</p>
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
  
  // 订阅内容端点
  if (pathParts[0] === "subscription" && pathParts.length >= 2) {
    return await handleSubscriptionRequest(request, url, host, cache);
  }
  
  // 订阅转换端点 (/sub)
  if (url.pathname === "/sub" || url.pathname.startsWith("/sub")) {
    return await handleSubRequest(request, url, BACKEND, host, cache, env);
  }
  
  return new Response("Not Found", { status: 404 });
}
