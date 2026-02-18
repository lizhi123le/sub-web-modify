// Cloudflare Pages Functions - Sub API Proxy

export async function onRequest(context) {
  const request = context.request;
  const backendApi = "https://url.v1.mk";
  
  // 获取原始请求的 URL 和参数
  const url = new URL(request.url);
  const pathInfo = url.pathname;
  const queryString = url.search;
  
  // 构建后端 URL，保留 /sub 路径
  const backendUrl = backendApi + pathInfo + queryString;
  
  // 复制请求头
  const headers = new Headers(request.headers);
  headers.set("Host", "url.v1.mk");
  headers.set("X-Forwarded-Host", url.host);
  headers.set("X-Forwarded-Proto", "https");
  
  try {
    const response = await fetch(backendUrl, {
      method: request.method,
      headers: headers,
      body: request.method !== "GET" && request.method !== "HEAD" ? await request.text() : undefined
    });
    
    // 复制响应头
    const responseHeaders = new Headers(response.headers);
    responseHeaders.set("Access-Control-Allow-Origin", "*");
    
    return new Response(response.body, {
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
