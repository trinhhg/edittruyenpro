// functions/_middleware.js

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  
  // --- CẤU HÌNH ---
  const ADMIN_SECRET = env.ADMIN_SECRET || "trinhhg_admin_secret_123"; // Đổi secret này trong Dashboard CF
  const CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS, DELETE",
    "Access-Control-Allow-Headers": "Content-Type, X-Admin-Secret",
  };

  // --- HÀM GIÁ TUYẾN TÍNH ---
  const calculateTotal = (days, type) => {
    const d = parseInt(days);
    if (d < 1) return 0;
    
    // Gói Cá nhân: 1 ngày 2200, 30 ngày 40000 (~1333/ngày)
    // Gói Đội nhóm: 1 ngày 4300, 30 ngày 80000 (~2666/ngày)
    const pricing = {
      personal: { start: 2200, end: 40000/30 },
      group: { start: 4300, end: 80000/30 }
    };
    
    const p = pricing[type] || pricing.personal;
    
    // Nếu mua 1 ngày -> giá gốc. Nếu > 1 ngày -> giảm dần tuyến tính
    let unitPrice = p.start;
    if (d > 1) {
       // Công thức nội suy tuyến tính: y = y1 + (x - x1) * (y2 - y1) / (x2 - x1)
       // Ở đây x2 (max days) tạm tính là 30 để đạt mức giá min
       const slope = (p.end - p.start) / 29; 
       unitPrice = p.start + (Math.min(d, 30) - 1) * slope;
    }
    
    return Math.floor(unitPrice * d);
  };

  // --- XỬ LÝ CORS (OPTIONS) ---
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }

  // --- 1. WEBHOOK (MacroDroid -> Server) ---
  if (url.pathname === "/api/webhook" && request.method === "POST") {
    try {
      const data = await request.json(); 
      // data format mong đợi: { "message": "...", "amount": 40000, "sender": "..." } hoặc chỉnh MacroDroid gửi đúng JSON
      
      const amount = parseInt(data.amount || 0);
      if (amount <= 0) return new Response("Invalid Amount", { status: 400 });

      // Tạo Key Temp
      const keyStr = `TEMP-${Math.random().toString(36).substr(2, 8).toUpperCase()}`;
      const now = Date.now();
      
      const sessionData = {
        key: keyStr,
        type: "temp",
        paid_amount: amount,
        devices: [],
        created_at: now,
        expires_at: now + (24 * 60 * 60 * 1000), // 24h
        status: "active"
      };

      // Lưu KV
      await env.WEB1.put(keyStr, JSON.stringify(sessionData), { expirationTtl: 86400 });

      // Báo Telegram
      if (env.TG_NOTIFY && env.TG_PAYMENT) {
        const msg = `💰 <b>Tiền về:</b> ${amount.toLocaleString()} VND\n🔑 <b>Key:</b> <code>${keyStr}</code>\n⏰ Hạn: 24h (Chờ duyệt)`;
        await fetch(`https://api.telegram.org/bot${env.TG_NOTIFY}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: env.TG_PAYMENT, text: msg, parse_mode: "HTML" })
        });
      }

      return new Response(JSON.stringify({ success: true, key: keyStr }), { headers: CORS_HEADERS });
    } catch (e) {
      return new Response("Error: " + e.message, { status: 500 });
    }
  }

  // --- 2. AUTHENTICATION (Login & Heartbeat) ---
  if (url.pathname === "/api/auth" && request.method === "POST") {
    const { key, device_id } = await request.json();
    const rawData = await env.WEB1.get(key);
    
    if (!rawData) return new Response(JSON.stringify({ valid: false, msg: "Key không tồn tại hoặc đã hết hạn" }), { headers: CORS_HEADERS });
    
    const data = JSON.parse(rawData);
    
    // Check hết hạn
    if (Date.now() > data.expires_at) {
        return new Response(JSON.stringify({ valid: false, msg: "Key đã hết hạn" }), { headers: CORS_HEADERS });
    }

    // Check thiết bị
    if (!data.devices.includes(device_id)) {
        if (data.devices.length >= (data.max_devices || 1)) { // Mặc định 1 thiết bị nếu chưa set
             return new Response(JSON.stringify({ valid: false, msg: "Quá giới hạn thiết bị!" }), { headers: CORS_HEADERS });
        }
        data.devices.push(device_id);
        // Cập nhật lại KV với thiết bị mới
        await env.WEB1.put(key, JSON.stringify(data)); 
    }

    return new Response(JSON.stringify({ valid: true, data: data }), { headers: CORS_HEADERS });
  }

  // --- 3. TÍNH GIÁ (Cho Client tham khảo) ---
  if (url.pathname === "/api/price") {
    const days = url.searchParams.get("days") || 1;
    const type = url.searchParams.get("type") || "personal";
    const total = calculateTotal(days, type);
    return new Response(JSON.stringify({ total }), { headers: CORS_HEADERS });
  }

  // --- 4. ADMIN API (Yêu cầu Secret) ---
  if (url.pathname.startsWith("/api/admin")) {
    const secret = request.headers.get("X-Admin-Secret");
    if (secret !== ADMIN_SECRET) return new Response("Unauthorized", { status: 403, headers: CORS_HEADERS });

    // 4.1 List Keys
    if (url.pathname === "/api/admin/list") {
        const type = url.searchParams.get("type") || "temp"; // temp hoặc official
        const list = await env.WEB1.list({ prefix: type === "temp" ? "TEMP-" : "OFFICIAL-" });
        const keys = [];
        for (const k of list.keys) {
            const val = await env.WEB1.get(k.name);
            if(val) keys.push(JSON.parse(val));
        }
        return new Response(JSON.stringify(keys), { headers: CORS_HEADERS });
    }

    // 4.2 Upgrade Key
    if (url.pathname === "/api/admin/upgrade" && request.method === "POST") {
        const { key, days, max_devices } = await request.json();
        const oldDataStr = await env.WEB1.get(key);
        if(!oldDataStr) return new Response("Key not found", { status: 404, headers: CORS_HEADERS });

        const oldData = JSON.parse(oldDataStr);
        const newKey = key.startsWith("TEMP-") ? key.replace("TEMP-", "OFFICIAL-") : key;
        
        const newData = {
            ...oldData,
            key: newKey,
            type: "official",
            expires_at: Date.now() + (days * 24 * 60 * 60 * 1000),
            max_devices: max_devices || 1,
            updated_at: Date.now()
        };

        // Lưu key mới (Official)
        await env.WEB1.put(newKey, JSON.stringify(newData));
        // Xóa key cũ nếu đổi tên
        if (newKey !== key) await env.WEB1.delete(key);

        return new Response(JSON.stringify({ success: true, new_key: newKey }), { headers: CORS_HEADERS });
    }
    
    // 4.3 Reset Device
    if (url.pathname === "/api/admin/reset-device" && request.method === "POST") {
         const { key } = await request.json();
         const dataStr = await env.WEB1.get(key);
         if (dataStr) {
             const data = JSON.parse(dataStr);
             data.devices = [];
             await env.WEB1.put(key, JSON.stringify(data));
             return new Response(JSON.stringify({ success: true }), { headers: CORS_HEADERS });
         }
         return new Response("Error", { status: 400, headers: CORS_HEADERS });
    }
  }

  return context.next();
}
