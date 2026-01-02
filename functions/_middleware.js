// === CẤU HÌNH HỆ THỐNG ===
const TG_NOTIFY_BOT_TOKEN = "8317998690:AAEJ51BLc6wp2gRAiTnM2qEyB4sXHYoN7lI"; 
const TG_PAYMENT_BOT_TOKEN = "8551019963:AAEld8A0Cibfnl2f-PUtwOvo_ab68_4Il0U"; 
const TG_ADMIN_ID = "5524168349";
const ADMIN_SECRET = "trinhhg_admin_secret_123"; 
const APP_VERSION = "2025.12.13.01";

// Cấu hình CORS để Admin Tool chạy được từ mọi nơi
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS, DELETE",
  "Access-Control-Allow-Headers": "Content-Type, x-admin-secret",
};

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  // Xử lý Preflight Request (CORS)
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // --- HELPERS ---
  async function sendTelegram(token, chatId, msg) {
      if(!token) return;
      try {
          await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
              method: 'POST',
              headers: {'Content-Type': 'application/json'},
              body: JSON.stringify({ chat_id: chatId, text: msg, parse_mode: "HTML" })
          });
      } catch(e) {}
  }

  function getCookie(req, name) {
      const c = req.headers.get("Cookie");
      if(!c) return null;
      const m = c.match(new RegExp(name + "=([^;]+)"));
      return m ? m[1] : null;
  }

  // --- 1. WEBHOOK (AUTO BANKING) ---
  if (url.pathname === "/api/webhook" && request.method === "POST") {
      try {
          const data = await request.json();
          const message = (data.message || "").toUpperCase(); 
          const title = data.title || "";
          
          if (title.includes("HIỂN THỊ TRÊN") || message.includes("ĐANG CHẠY")) {
             return new Response(JSON.stringify({ skipped: true }), { headers: corsHeaders });
          }

          // A. Bóc tách số tiền (VD: +10,000VND hoặc 10.000 VND)
          let amount = 0;
          const amountMatch = message.match(/([\d.,]+)\s*VND/);
          if (amountMatch) {
              // Xóa dấu chấm/phẩy để lấy số nguyên
              amount = parseInt(amountMatch[1].replace(/[.,]/g, ''));
          }

          // B. Bóc tách Mã Giao Dịch (HGxxxx)
          const codeMatch = message.match(/HG\d+/);
          
          if (codeMatch) {
              const transCode = codeMatch[0];
              // Tạo Key Tạm
              const tempKey = "TEMP-" + Math.random().toString(36).substring(2, 10).toUpperCase();
              const now = Date.now();
              
              const keyData = {
                  type: "temp",
                  status: "temp", // Chờ duyệt
                  duration_seconds: 86400, // 24h dùng thử
                  activated_at: now,
                  expires_at: now + 86400000,
                  max_devices: 2,
                  devices: [],
                  paid_amount: amount, // Lưu số tiền thực nhận
                  trans_code: transCode,
                  raw_message: message, 
                  note: `Auto-gen: ${transCode}`
              };

              // Lưu vào KV
              await env.WEB1.put(tempKey, JSON.stringify(keyData));
              // Map mã giao dịch sang Key để Client polling
              await env.WEB1.put(`TRANS_${transCode}`, tempKey, {expirationTtl: 3600});

              // Báo Admin
              const notifyMsg = `💰 <b>TIỀN VỀ:</b> ${amount.toLocaleString()} VND\nMã GD: <code>${transCode}</code>\nKey Tạm: <code>${tempKey}</code>`;
              context.waitUntil(sendTelegram(TG_NOTIFY_BOT_TOKEN, TG_ADMIN_ID, notifyMsg));
          }

          return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
      } catch (e) {
          return new Response(JSON.stringify({ error: e.message }), { status: 400, headers: corsHeaders });
      }
  }

  // --- 2. ADMIN API: LIST KEYS ---
  if (url.pathname === "/api/admin/list") {
      const secret = request.headers.get("x-admin-secret");
      const type = url.searchParams.get("type"); // 'temp' or 'official'
      if(secret !== ADMIN_SECRET) return new Response("Unauthorized", {status: 401, headers: corsHeaders});

      // Trick: KV list không filter status được, nên ta fetch theo prefix nếu có thể
      const pfx = type === 'temp' ? 'TEMP-' : ''; 
      const list = await env.WEB1.list({ prefix: pfx });
      
      const keys = [];
      for(const k of list.keys) {
          if(k.name.startsWith("TRANS_")) continue; // Bỏ qua file mapping
          const val = await env.WEB1.get(k.name);
          if(val) {
              const d = JSON.parse(val);
              // Filter logic
              if(type === 'temp' && d.status === 'official') continue;
              if(type === 'official' && d.status !== 'official') continue;
              
              keys.push({ key: k.name, ...d });
          }
      }
      return new Response(JSON.stringify(keys), {headers: {...corsHeaders, "Content-Type": "application/json"}});
  }

  // --- 3. ADMIN API: UPGRADE KEY ---
  if (url.pathname === "/api/admin/upgrade" && request.method === "POST") {
      const secret = request.headers.get("x-admin-secret");
      if(secret !== ADMIN_SECRET) return new Response("Unauthorized", {status: 401, headers: corsHeaders});

      const { key, duration, devices } = await request.json();
      const val = await env.WEB1.get(key);
      if(!val) return new Response("Key not found", {status: 404, headers: corsHeaders});

      const data = JSON.parse(val);
      const now = Date.now();

      // Nâng cấp
      data.type = "permanent";
      data.status = "official";
      data.duration_seconds = parseInt(duration);
      data.max_devices = parseInt(devices);
      data.activated_at = now; // Reset ngày kích hoạt
      data.expires_at = now + (data.duration_seconds * 1000);
      data.note += " [APPROVED]";

      await env.WEB1.put(key, JSON.stringify(data));
      return new Response(JSON.stringify({ success: true }), {headers: {...corsHeaders, "Content-Type": "application/json"}});
  }

  // --- 4. ADMIN API: DELETE KEY ---
  if (url.pathname === "/api/admin/delete" && request.method === "POST") {
      const secret = request.headers.get("x-admin-secret");
      if(secret !== ADMIN_SECRET) return new Response("Unauthorized", {status: 401, headers: corsHeaders});

      const { key } = await request.json();
      await env.WEB1.delete(key);
      return new Response(JSON.stringify({ success: true }), {headers: {...corsHeaders, "Content-Type": "application/json"}});
  }

  // --- 5. CHECK PAYMENT (POLLING) ---
  if (url.pathname === "/api/check-payment") {
      const code = url.searchParams.get("code");
      const key = await env.WEB1.get(`TRANS_${code}`);
      let amount = 0;
      if(key) {
          const keyVal = await env.WEB1.get(key);
          if(keyVal) amount = JSON.parse(keyVal).paid_amount || 0;
      }
      // Trả về cả Key và Số tiền để Client kiểm tra
      return new Response(JSON.stringify({ 
          status: key ? 'success' : 'pending', 
          key: key, 
          amount: amount 
      }), {headers: {...corsHeaders, "Content-Type": "application/json"}});
  }

  // --- 6. AUTH & HEARTBEAT ---
  if (url.pathname === "/api/key-info") {
      const userKey = getCookie(request, "auth_vip");
      if(!userKey) return new Response("Unauthorized", {status: 401, headers: corsHeaders});
      const val = await env.WEB1.get(userKey);
      if(!val) return new Response("Not Found", {status: 404, headers: corsHeaders});
      const d = JSON.parse(val);
      return new Response(JSON.stringify({
          key: userKey, type: d.type, status: d.status,
          activated_at: d.activated_at, expires_at: d.expires_at,
          max_devices: d.max_devices, current_devices: (d.devices||[]).length
      }), {headers: {...corsHeaders, "Content-Type": "application/json"}});
  }

  if (url.pathname === "/api/heartbeat") {
      const userKey = getCookie(request, "auth_vip");
      if(!userKey) return new Response("No Key", {status: 401, headers: corsHeaders});
      const val = await env.WEB1.get(userKey);
      if(!val) return new Response("Invalid", {status: 401, headers: corsHeaders});
      const d = JSON.parse(val);
      if(d.expires_at && Date.now() > d.expires_at) return new Response("Expired", {status: 401, headers: corsHeaders});
      return new Response("OK", { status: 200, headers: { ...corsHeaders, "x-app-version": APP_VERSION } });
  }

  if (url.pathname === "/login" && request.method === "POST") {
    try {
        const formData = await request.json();
        const inputKey = (formData.secret_key || "").trim();
        const deviceId = (formData.device_id || "unknown").trim();
        const ip = request.headers.get("CF-Connecting-IP") || "Unknown";

        const keyVal = await env.WEB1.get(inputKey);
        if (!keyVal) return new Response(JSON.stringify({success: false, message: "Key không tồn tại!"}), {headers:{"Content-Type":"application/json"}});

        let keyData = JSON.parse(keyVal);
        const now = Date.now();

        if (!keyData.activated_at) { keyData.activated_at = now; keyData.expires_at = now + (keyData.duration_seconds * 1000); keyData.devices = []; }
        if (keyData.expires_at && now > keyData.expires_at) return new Response(JSON.stringify({success: false, message: "Key đã hết hạn!"}), {headers:{"Content-Type":"application/json"}});

        let devices = keyData.devices || [];
        const existing = devices.find(d => d.id === deviceId);
        if (!existing) {
            if (devices.length >= keyData.max_devices) return new Response(JSON.stringify({success: false, message: `Quá giới hạn ${keyData.max_devices} thiết bị!`}), {headers:{"Content-Type":"application/json"}});
            devices.push({ id: deviceId, ip: ip, ua: request.headers.get("User-Agent") });
            keyData.devices = devices;
            await env.WEB1.put(inputKey, JSON.stringify(keyData));
        }

        context.waitUntil(sendTelegram(TG_NOTIFY_BOT_TOKEN, TG_ADMIN_ID, `🚀 <b>LOGIN:</b> ${inputKey}`));

        // Set Cookie Mạnh
        return new Response(JSON.stringify({success: true}), {
            status: 200,
            headers: { 
                "Content-Type": "application/json",
                "Set-Cookie": `auth_vip=${inputKey}; Path=/; Max-Age=31536000; SameSite=Lax; Secure`, 
                ...corsHeaders 
            },
        });
    } catch (e) { return new Response(JSON.stringify({success: false, message: "Lỗi Server"}), {headers:{"Content-Type":"application/json"}}); }
  }

  if (url.pathname === "/logout") {
      return new Response(null, { status: 302, headers: { "Location": "/", "Set-Cookie": `auth_vip=; Path=/; HttpOnly; Secure; Max-Age=0` } });
  }

  return next();
}
