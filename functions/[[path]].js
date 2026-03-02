// Cloudflare Pages Functions - Sub API Proxy
// 简单的后端API转发
// 环境变量: BACKEND_API_URL

const DEFAULT_BACKEND = "https://url.v1.mk";

// 处理订阅转换请求
// 处理订阅转换请求
async function handleSubRequest(request, url, backend, env) {
  const urlParam = url.searchParams.get("url");
  if (!urlParam) {
    return new Response("Missing URL parameter", { status: 400 });
  }

  const host = url.origin;
  const subInternalDir = "sub/internal";
  const replacements = {};
  const replacedURIs = [];
  const keys = [];

  // 获取内存缓存或KV (在 Pages Functions 中, env 可能包含 KV 绑定)
  const SUB_CACHE = env.SUB_CACHE || new Map();
  const isKV = typeof SUB_CACHE.put === 'function';

  async function cachePut(key, value, headers) {
    if (isKV) {
      await SUB_CACHE.put(key, value);
      if (headers) await SUB_CACHE.put(key + "_headers", JSON.stringify(headers));
    } else {
      // 注意：内存缓存在 Pages Functions 中通常不可跨请求持久
      SUB_CACHE.set(key, value);
      if (headers) SUB_CACHE.set(key + "_headers", JSON.stringify(headers));
    }
  }

  async function cacheDelete(key) {
    if (isKV) {
      await SUB_CACHE.delete(key).catch(() => {});
      await SUB_CACHE.delete(key + "_headers").catch(() => {});
    } else {
      SUB_CACHE.delete(key);
      SUB_CACHE.delete(key + "_headers");
    }
  }

  const urlParts = urlParam.split("|").filter((part) => part.trim() !== "");
  
  for (const part of urlParts) {
    const key = generateRandomStr(16);
    let plaintextData = "";
    let responseHeaders = {};

    if (part.startsWith("http://") || part.startsWith("https://")) {
      try {
        const response = await fetch(part, {
          headers: {
            "User-Agent": request.headers.get("User-Agent") || "Mozilla/5.0",
          }
        });
        if (response.ok) {
          plaintextData = await response.text();
          responseHeaders = Object.fromEntries(response.headers);
        }
      } catch (e) {
        console.error("Fetch failed:", part, e.message);
        continue;
      }
    } else {
      // 处理直接传入的内容
      plaintextData = part;
    }

    if (plaintextData) {
      const parsed = parseData(plaintextData);
      let obfuscatedData = plaintextData;

      if (parsed.format === "base64") {
        const links = parsed.data.split(/\r?\n/).filter(l => l.trim());
        const newLinks = [];
        for (const link of links) {
          const nl = replaceInUri(link, replacements, false);
          newLinks.push(nl || link);
        }
        obfuscatedData = utf8ToBase64(newLinks.join("\r\n"));
      } else if (parsed.format === "yaml") {
        obfuscatedData = replaceYAMLContent(plaintextData, replacements);
      }

      await cachePut(key, obfuscatedData, responseHeaders);
      keys.push(key);
      replacedURIs.push(`${host}/${subInternalDir}/${key}`);
    }
  }

  if (replacedURIs.length === 0) {
    return new Response("No valid nodes found", { status: 400 });
  }

  const newUrl = replacedURIs.join("|");
  const originalParams = new URL(request.url).searchParams;
  originalParams.set("url", newUrl);
  
  // 确保 backend 是 origin
  const backendBase = backend.replace(/(https?:\/\/[^/]+).*$/, "$1");
  const backendUrl = backendBase + "/sub?" + originalParams.toString();
  
  try {
    const response = await fetch(backendUrl, {
      method: "GET",
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      }
    });
    
    let content = await response.text();
    
    // 恢复映射
    if (Object.keys(replacements).length > 0) {
      const recoveryRegex = new RegExp(
        Object.keys(replacements).map(escapeRegExp).join("|"),
        "g"
      );
      
      const target = url.searchParams.get("target");
      
      try {
        // 先尝试 Base64 解码
        const decoded = urlSafeBase64Decode(content);
        // 如果解码成功且包含特征字符 (或者原本就是 base64 响应)
        if (decoded && (decoded.includes("://") || decoded.includes("proxies:") || decoded.includes("port:"))) {
          const recovered = decoded.replace(recoveryRegex, (match) => replacements[match] || match);
          // 只有当明确要求 target=base64 时才重编码，否则返回明文
          if (target === "base64") {
            content = utf8ToBase64(recovered);
          } else {
            content = recovered;
          }
        } else {
          // 如果不是 base64，直接替换
          content = content.replace(recoveryRegex, (match) => replacements[match] || match);
        }
      } catch (e) {
        // 解码失败则作为明文替换
        content = content.replace(recoveryRegex, (match) => replacements[match] || match);
      }
    }
    
    // 清理缓存
    if (isKV) {
      for (const k of keys) await cacheDelete(k);
    }
    
    const responseHeaders = new Headers();
    responseHeaders.set("Content-Type", "text/plain; charset=utf-8");
    responseHeaders.set("Access-Control-Allow-Origin", "*");
    
    return new Response(content, {
      status: response.status,
      headers: responseHeaders
    });
  } catch (e) {
    return new Response("Error: " + e.message, { status: 500 });
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

  // 内部临时订阅端点 (必须最先判断，防止被 /sub 拦截)
  if (url.pathname.includes("/internal/")) {
    const pathSegments = url.pathname.split("/").filter(s => s);
    const key = pathSegments[pathSegments.length - 1];
    const SUB_CACHE = env.SUB_CACHE || new Map();
    const isKV = typeof SUB_CACHE.get === 'function' && SUB_CACHE.constructor.name !== 'Map';
    
    let content, headersJson;
    if (isKV) {
      content = await SUB_CACHE.get(key);
      headersJson = await SUB_CACHE.get(key + "_headers");
    } else {
      content = SUB_CACHE.get(key);
      headersJson = SUB_CACHE.get(key + "_headers");
    }

    if (!content) return new Response("Not Found", { status: 404 });

    const headers = new Headers(headersJson ? JSON.parse(headersJson) : { "Content-Type": "text/plain; charset=utf-8", "Access-Control-Allow-Origin": "*" });
    headers.set("Access-Control-Allow-Origin", "*");
    return new Response(content, { headers });
  }
  
  // 订阅转换端点 (/sub)
  if (url.pathname === "/sub" || url.pathname.startsWith("/sub")) {
    return await handleSubRequest(request, url, BACKEND, env);
  }

  // 版本端点
  if (url.pathname === "/version") {
    return await handleVersionRequest(BACKEND);
  }
  
  // 其余请求（如首页、静态资源）则交给 Pages 静态服务器处理
  return await context.next();
}

// --- Obfuscation Utilities ---

function generateRandomStr(len) {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < len; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

function generateRandomUUID() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0;
    const v = c == "x" ? r : (r & 3) | 8;
    return v.toString(16);
  });
}

function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function urlSafeBase64Encode(input) {
  return btoa(input).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function urlSafeBase64Decode(input) {
  try {
    const padded = input + "=".repeat((4 - (input.length % 4)) % 4);
    const base64 = padded.replace(/-/g, "+").replace(/_/g, "/");
    return base64ToUtf8(base64);
  } catch (e) {
    try {
      return base64ToUtf8(input);
    } catch (e2) {
      return input;
    }
  }
}

function base64ToUtf8(str) {
  try {
    return decodeURIComponent(escape(atob(str)));
  } catch (e) {
    return atob(str);
  }
}

function utf8ToBase64(str) {
  return btoa(unescape(encodeURIComponent(str)));
}

function parseData(data) {
  if (data.includes("proxies:")) return { format: "yaml", data: data };
  try {
    const decoded = urlSafeBase64Decode(data.trim());
    if (decoded.includes("://") || decoded.includes("proxies:")) return { format: "base64", data: decoded };
  } catch (e) {}
  return { format: "unknown", data: data };
}

function replaceInUri(link, replacements, isRecovery) {
  if (link.startsWith("ss://")) return replaceSS(link, replacements, isRecovery);
  if (link.startsWith("ssr://")) return replaceSSR(link, replacements, isRecovery);
  if (link.startsWith("vmess://")) return replaceVmess(link, replacements, isRecovery);
  if (link.startsWith("trojan://") || link.startsWith("vless://")) return replaceTrojan(link, replacements, isRecovery);
  if (link.startsWith("hysteria://")) return replaceHysteria(link, replacements, isRecovery);
  if (link.startsWith("hysteria2://")) return replaceHysteria2(link, replacements, isRecovery);
  if (link.startsWith("socks://") || link.startsWith("socks5://")) return replaceSocks(link, replacements, isRecovery);
  return link;
}

function replaceSS(link, replacements, isRecovery) {
  const randomPassword = generateRandomStr(12);
  const randomDomain = randomPassword + ".com";
  let tempLink = link.slice(5).split("#")[0];
  if (tempLink.includes("@")) {
    const match = tempLink.match(/(\S+?)@(\[?[\da-fA-F:]+\]?|[\d\.]+|[\w\.-]+):/);
    if (!match) return link;
    const [full, base64Data, server] = match;
    try {
      const decoded = urlSafeBase64Decode(base64Data);
      const parts = decoded.split(":");
      if (parts.length < 2) return link;
      const encryption = parts[0];
      const password = parts.slice(1).join(":");
      replacements[randomDomain] = server;
      replacements[randomPassword] = password;
      const newStr = urlSafeBase64Encode(encryption + ":" + randomPassword);
      return link.replace(base64Data, newStr).replace(server, randomDomain);
    } catch (e) { return link; }
  }
  return link;
}

function replaceVmess(link, replacements, isRecovery) {
  let tempLink = link.replace("vmess://", "");
  try {
    const decoded = urlSafeBase64Decode(tempLink);
    const jsonData = JSON.parse(decoded);
    const server = jsonData.add;
    const uuid = jsonData.id;
    const randomDomain = generateRandomStr(10) + ".com";
    const randomUUID = generateRandomUUID();
    replacements[randomDomain] = server;
    replacements[randomUUID] = uuid;
    jsonData.add = randomDomain;
    jsonData.id = randomUUID;
    return "vmess://" + utf8ToBase64(JSON.stringify(jsonData));
  } catch (e) {
    return link;
  }
}

function replaceTrojan(link, replacements, isRecovery) {
  const match = link.match(/(vless|trojan):\/\/(.*?)@(\[?[\da-fA-F:]+\]?|[\d\.]+|[\w\.-]+):/);
  if (!match) return link;
  const [full, proto, uuid, server] = match;
  const randomDomain = generateRandomStr(10) + ".com";
  const randomUUID = generateRandomUUID();
  replacements[randomDomain] = server;
  replacements[randomUUID] = uuid;
  return link.replace(uuid, randomUUID).replace(server, randomDomain);
}

function replaceSSR(link, replacements, isRecovery) {
  try {
    let data = link.slice(6).replace("\r", "").split("#")[0];
    let decoded = urlSafeBase64Decode(data);
    const match = decoded.match(/([\[\]\da-fA-F:\.]+|[\w\.-]+):(\d+?):(\S+?):(\S+?):(\S+?):(\S+)\//);
    if (!match) return link;
    const [, server, port, proto, method, obfs, password] = match;
    
    if (isRecovery) {
      const originalServer = replacements[server];
      const originalPass = replacements[urlSafeBase64Decode(password)];
      if (!originalServer || !originalPass) return link;
      return "ssr://" + urlSafeBase64Encode(decoded.replace(server, originalServer).replace(password, urlSafeBase64Encode(originalPass)));
    } else {
      const randomDomain = generateRandomStr(12) + ".com";
      const randomPass = generateRandomStr(12);
      replacements[randomDomain] = server;
      replacements[randomPass] = urlSafeBase64Decode(password);
      return "ssr://" + urlSafeBase64Encode(decoded.replace(server, randomDomain).replace(password, urlSafeBase64Encode(randomPass)));
    }
  } catch (e) { return link; }
}

function replaceSocks(link, replacements, isRecovery) {
  try {
    let temp = link.replace(/^socks5?:\/\//, "");
    const hashSplit = temp.split("#");
    const hashPart = hashSplit.length > 1 ? "#" + hashSplit[1] : "";
    temp = hashSplit[0];
    
    const atIndex = temp.indexOf("@");
    if (isRecovery) {
      let result = link;
      for (const [key, value] of Object.entries(replacements)) {
        if (/^\d+\.\d+\.\d+\.\d+$/.test(key)) {
          result = result.replace(new RegExp(escapeRegExp(key), "g"), value);
        } else {
          result = result.replace(new RegExp(`(^|[^\\w])${escapeRegExp(key)}($|[^\\w])`, "g"), (m, p1, p2) => p1 + value + p2);
        }
      }
      return result;
    }
    
    const fakeIP = `10.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}`;
    const randomPass = generateRandomStr(12);
    
    if (atIndex !== -1) {
      const authBase64 = temp.slice(0, atIndex);
      const serverPort = temp.slice(atIndex + 1);
      const auth = atob(authBase64);
      const [user, pass] = auth.split(":");
      const serverMatch = serverPort.match(/^(\[?[\da-fA-F:]+\]?|[\d\.]+|[\w\.-]+):(\d+)$/);
      if (!serverMatch) return link;
      const [, server, port] = serverMatch;
      replacements[fakeIP] = server;
      if (pass) replacements[randomPass] = pass;
      return `socks://${utf8ToBase64(user + ":" + randomPass)}@${fakeIP}:${port}${hashPart}`;
    } else {
      const serverMatch = temp.match(/^(\[?[\da-fA-F:]+\]?|[\d\.]+|[\w\.-]+):(\d+)$/);
      if (!serverMatch) return link;
      const [, server, port] = serverMatch;
      replacements[fakeIP] = server;
      return `socks://${fakeIP}:${port}${hashPart}`;
    }
  } catch (e) { return link; }
}

function replaceHysteria(link, replacements, isRecovery) {
  const match = link.match(/hysteria:\/\/(\[?[\da-fA-F:]+\]?|[\d\.]+|[\w\.-]+):/);
  if (!match) return link;
  const server = match[1];
  if (isRecovery) {
    const original = replacements[server];
    return original ? link.replace(server, original) : link;
  } else {
    const randomDomain = generateRandomStr(12) + ".com";
    replacements[randomDomain] = server;
    return link.replace(server, randomDomain);
  }
}

function replaceHysteria2(link, replacements, isRecovery) {
  const match = link.match(/(hysteria2):\/\/(.*)@(\[?[\da-fA-F:]+\]?|[\d\.]+|[\w\.-]+):/);
  if (!match) return link;
  const [full, proto, uuid, server] = match;
  const randomDomain = generateRandomStr(10) + ".com";
  const randomUUID = generateRandomUUID();
  replacements[randomDomain] = server;
  replacements[randomUUID] = uuid;
  return link.replace(uuid, randomUUID).replace(server, randomDomain);
}

function replaceYAMLContent(content, replacements) {
  let result = content;
  const serverRegex = /server:\s*(\S+)/g;
  result = result.replace(serverRegex, (match, server) => {
    if (server.includes(".") || server.includes(":")) {
       const randomDomain = generateRandomStr(12) + ".com";
       replacements[randomDomain] = server;
       return `server: ${randomDomain}`;
    }
    return match;
  });
  const uuidRegex = /uuid:\s*(\S+)/g;
  result = result.replace(uuidRegex, (match, uuid) => {
    const randomUUID = generateRandomUUID();
    replacements[randomUUID] = uuid;
    return `uuid: ${randomUUID}`;
  });
  const passRegex = /password:\s*(\S+)/g;
  result = result.replace(passRegex, (match, pass) => {
    const randomPass = generateRandomStr(12);
    replacements[randomPass] = pass;
    return `password: ${randomPass}`;
  });
  return result;
}
