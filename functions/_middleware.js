// ENV bindings:
// WEB2 (KV Namespace)

const ADMIN_CHAT_ID = "5524168349";
const LOG_BOT_TOKEN = "8317998690:AAEJ51BLc6wp2gRAiTnM2qEyB4sXHYoN7lI";
const CONFIRM_BOT_TOKEN = "8551019963:AAEld8A0Cibfnl2f-PUtwOvo_ab68_4Il0U";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    // --- CORS HEADER ---
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    // --- 1. LOGIN ---
    if (path === "/login" && request.method === "POST") {
      const { key } = await request.json();
      
      // Lấy dữ liệu từ KV
      const data = await env.WEB2.get(key, { type: "json" });

      if (!data) {
        return new Response(JSON.stringify({ error: "Key không tồn tại hoặc chưa kích hoạt" }), {
          status: 401, headers: corsHeaders
        });
      }

      // Check Expire
      if (new Date(data.expire) < new Date()) {
        await sendTelegram(LOG_BOT_TOKEN, ADMIN_CHAT_ID, `⚠️ Key hết hạn: ${key}`);
        return new Response(JSON.stringify({ error: "Key đã hết hạn" }), { status: 403, headers: corsHeaders });
      }

      // Check Device Limit
      const userAgent = request.headers.get("User-Agent") || "unknown";
      // Logic đơn giản: Check device ID (có thể dùng cookie hoặc fingerprint gửi lên từ client)
      // Ở đây tạm thời bỏ qua logic fingerprint phức tạp, chỉ log
      
      await sendTelegram(LOG_BOT_TOKEN, ADMIN_CHAT_ID, `✅ Login thành công: ${key} \nUA: ${userAgent}`);

      return new Response(JSON.stringify({ status: "ok", plan: data.plan }), { headers: corsHeaders });
    }

    // --- 2. WEBHOOK NGÂN HÀNG (Quan trọng) ---
    if (path === "/api/webhook" && request.method === "POST") {
      try {
        const payload = await request.json();
        // Giả sử payload từ Casso/SePay/Gửi thủ công có chứa nội dung giao dịch
        // Cần parse nội dung tìm chuỗi "HGxxxx"
        
        const content = payload.content || payload.description || ""; // Tùy format gateway
        const amount = payload.amount || 0;
        
        // Regex tìm HGxxxx (4-6 số)
        const match = content.match(/HG\d{4,6}/i);
        
        if (match) {
          const keyID = match[0].toUpperCase();
          
          // Logic: 
          // 1. Check xem key này có trong TEMP (nếu user mới) hay update key cũ
          // Ở đây giả định tạo mới hoặc gia hạn ngay lập tức
          
          // Tính số ngày dựa trên tiền (Logic đơn giản hóa)
          // 2200 = 1 ngày cá nhân. 
          const days = Math.floor(amount / 2200); 
          const expireDate = new Date();
          expireDate.setDate(expireDate.getDate() + days);

          const keyData = {
            expire: expireDate.toISOString(),
            plan: "personal", // Mặc định, có thể logic phức tạp hơn
            devices: [],
            maxDevices: 2
          };

          // Ghi vào KV (OFFICIAL)
          await env.WEB2.put(keyID, JSON.stringify(keyData));

          // Gửi thông báo xác nhận giao dịch
          await sendTelegram(CONFIRM_BOT_TOKEN, ADMIN_CHAT_ID, 
            `💰 NHẬN TIỀN: ${amount.toLocaleString()} VND\n🔑 Key: ${keyID}\n📅 Hạn: ${expireDate.toISOString()}`);
            
          // Gửi log
          await sendTelegram(LOG_BOT_TOKEN, ADMIN_CHAT_ID, `System: Đã kích hoạt key ${keyID} qua Webhook.`);

          return new Response("OK", { status: 200 });
        }

        return new Response("No key match", { status: 200 });

      } catch (e) {
        return new Response("Error", { status: 500 });
      }
    }

    // --- 3. STATUS POLLING ---
    if (path === "/api/status") {
        const hg = url.searchParams.get("hg");
        if(hg) {
            const data = await env.WEB2.get(hg);
            if(data) {
                return new Response(JSON.stringify({status: 'active'}), {headers: corsHeaders});
            }
        }
        return new Response(JSON.stringify({status: 'pending'}), {headers: corsHeaders});
    }

    // --- 4. ADMIN API ---
    if (path.startsWith("/api/admin/")) {
        // Logic cho Admin Tool (List keys, delete key...)
        // Cần bảo mật thêm
        if(path === "/api/admin/list") {
            const list = await env.WEB2.list();
            return new Response(JSON.stringify(list), {headers: corsHeaders});
        }
    }

    return new Response("Not Found", { status: 404 });
  },
};

// Hàm Helper Telegram
async function sendTelegram(token, chatId, text) {
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text: text }),
  });
}
