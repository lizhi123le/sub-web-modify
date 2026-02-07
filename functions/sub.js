// Cloudflare Pages Functions - Sub API Proxy
// 代理 /sub 请求到后端 API

export async function onRequest(request) {
  const url = new URL(request.url);
  
  // 从环境变量获取后端地址，如果没有则使用默认值
  const backendUrl = url.searchParams.get('backend') || 'https://url.v1.mk';
  
  // 构建后端请求 URL
  const backendPath = url.pathname.replace(/\/sub/, '/sub') + url.search;
  
  try {
    const response = await fetch(backendUrl + backendPath, {
      method: request.method,
      headers: {
        'User-Agent': 'Sub-Web-Modify/1.0',
        'Accept': request.headers.get('Accept') || '*/*',
        'Referer': url.origin
      }
    });

    const responseHeaders = new Headers(response.headers);
    responseHeaders.set('Access-Control-Allow-Origin', '*');
    responseHeaders.set('Cache-Control', 'no-store, no-cache, must-revalidate');

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: 'Backend request failed', message: error.message }), {
      status: 502,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }
}
