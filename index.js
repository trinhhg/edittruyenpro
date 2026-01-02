document.addEventListener('DOMContentLoaded', () => {
    // 1. GLOBAL STATE
    const LANDING = document.getElementById('landing-page');
    const APP = document.getElementById('main-app');
    const STORAGE_KEY = 'trinh_hg_settings_v23_final';
    const INPUT_STATE_KEY = 'trinh_hg_input_state_v23';

    // FIX: Debounce globally accessible
    let saveTimeout;
    const debounceSave = () => {
        clearTimeout(saveTimeout);
        saveTimeout = setTimeout(() => {
            saveTempInput();
            if(state.activeTab === 'settings') saveCurrentPairsToState(true);
        }, 500);
    };

    const defaultState = {
      currentMode: 'default', activeTab: 'settings', dialogueMode: 0, 
      modes: { default: { pairs: [], matchCase: false, wholeWord: false, autoCaps: false, exceptions: 'jpg, png, com, vn' } }
    };
    let state = JSON.parse(localStorage.getItem(STORAGE_KEY)) || defaultState;
    if(!state.modes[state.currentMode]) state.currentMode = 'default';

    let deviceId = localStorage.getItem('trinh_hg_dev_id');
    if(!deviceId) { deviceId = 'dev_' + Date.now(); localStorage.setItem('trinh_hg_dev_id', deviceId); }

    checkAuth();

    async function checkAuth() {
        try {
            const res = await fetch('/api/heartbeat');
            if (res.ok) showApp(); else showLanding();
        } catch(e) { showLanding(); }
    }

    function showApp() {
        LANDING.classList.add('hidden');
        APP.classList.remove('hidden');
        
        renderModeSelect(); loadSettingsToUI(); loadTempInput();
        if(state.activeTab) switchTab(state.activeTab);
        loadKeyInfo();
        renderBuyWidget(document.getElementById('internal-buy-widget'));
        initEvents();
    }

    function showLanding() {
        LANDING.classList.remove('hidden');
        APP.classList.add('hidden');
        renderBuyWidget(document.getElementById('landing-buy-widget'));
    }

    // 2. LOGIN
    const loginForm = document.getElementById('login-form');
    if(loginForm) {
        loginForm.onsubmit = async (e) => {
            e.preventDefault();
            const btn = document.getElementById('btn-login-submit');
            const key = document.getElementById('secret-key-input').value.trim();
            const originalHtml = btn.innerHTML;

            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> ĐANG KIỂM TRA...';
            btn.classList.add('btn-loading');

            try {
                const res = await fetch('/login', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ secret_key: key, device_id: deviceId })
                });
                const data = await res.json();

                if(data.success) {
                    btn.innerHTML = '<i class="fas fa-check"></i> THÀNH CÔNG!';
                    btn.classList.replace('btn-loading', 'btn-success-state');
                    setTimeout(() => window.location.reload(), 1000);
                } else {
                    throw new Error(data.message);
                }
            } catch(err) {
                btn.innerHTML = `<i class="fas fa-times"></i> ${err.message || "Lỗi!"}`;
                btn.classList.replace('btn-loading', 'btn-error-state');
                setTimeout(() => { btn.innerHTML = originalHtml; btn.classList.remove('btn-loading', 'btn-error-state'); }, 2000);
            }
        };
    }

    document.getElementById('logout-btn').onclick = async () => {
        await fetch('/logout');
        window.location.reload();
    };

    // 3. BUY WIDGET
    window.copyTxt = (t) => { navigator.clipboard.writeText(t); alert("Đã sao chép: " + t); };

    function renderBuyWidget(container) {
        if(!container) return;
        container.innerHTML = `
            <div class="buy-widget">
                <div class="buy-row"><label>Đối tượng:</label><div class="btn-group" id="buy-type"><button class="btn-opt active" data-type="canhan">Cá Nhân (2 TB)</button><button class="btn-opt" data-type="doinhom">Đội Nhóm (15 TB)</button></div></div>
                <div class="buy-row"><label>Thời hạn:</label><div class="btn-group" id="buy-time"><button class="btn-opt" data-d="7">7 Ngày</button><button class="btn-opt active" data-d="30">30 Ngày</button><button class="btn-opt" data-d="custom">Tùy chỉnh</button></div></div>
                <div class="buy-row hidden" id="custom-days-box"><input type="number" class="form-control" id="inp-custom-days" value="1" min="1" placeholder="Số ngày..."></div>
                <div class="price-display"><span>Tổng thanh toán:</span><strong id="price-total">0 VNĐ</strong></div>
                <button class="btn-pay" id="btn-pay-action">THANH TOÁN NGAY</button>
                <div id="qr-result" class="qr-area hidden">
                    <img id="qr-img" class="qr-img" src="">
                    <p style="font-size:12px; color:red; margin:10px 0;">Vui lòng chuyển khoản đúng số tiền!</p>
                    <div class="bank-info">
                        <div class="bank-row"><span>Chủ TK:</span> <b>TRINH THI XUAN HUONG</b> <button class="btn-copy-small" onclick="copyTxt('TRINH THI XUAN HUONG')"><i class="fas fa-copy"></i></button></div>
                        <div class="bank-row"><span>Số TK:</span> <b>0917678211 (MB)</b> <button class="btn-copy-small" onclick="copyTxt('0917678211')"><i class="fas fa-copy"></i></button></div>
                        <div class="bank-row"><span>Nội dung:</span> <b id="code-display" style="color:#d97706">HG...</b> <button class="btn-copy-small" id="btn-copy-code"><i class="fas fa-copy"></i></button></div>
                        <div class="bank-row"><span>Số tiền:</span> <b id="amount-display" style="color:#059669">...</b> <button class="btn-copy-small" id="btn-copy-amt"><i class="fas fa-copy"></i></button></div>
                    </div>
                    <div id="status-text" style="margin-top:10px; font-weight:bold; color:#d97706;">Đang chờ giao dịch...</div>
                    <button class="btn-secondary" style="margin-top:10px;" id="btn-repick">Chọn lại gói</button>
                </div>
            </div>`;

        let bs = { type: 'canhan', days: 30 };
        const priceTotal = container.querySelector('#price-total');
        const inpCustom = container.querySelector('#inp-custom-days');

        const updatePrice = () => {
            let d = bs.days === 'custom' ? (parseInt(inpCustom.value)||1) : bs.days;
            // UPDATE: Giá theo yêu cầu (2200 / 4300)
            let rate = 0;
            if(bs.type === 'canhan') {
                if(d < 7) rate = 2200; else if(d < 30) rate = 2100; else rate = 1333; // ~40k
            } else {
                if(d < 7) rate = 4300; else if(d < 30) rate = 4100; else rate = 2666; // ~80k
            }
            let total = Math.round(d * rate / 1000) * 1000;
            if(bs.type==='canhan' && d===30) total=40000;
            if(bs.type==='doinhom' && d===30) total=80000;
            bs.price = total;
            priceTotal.textContent = total.toLocaleString('vi-VN') + " VNĐ";
        };

        container.querySelectorAll('.btn-opt').forEach(b => b.onclick = (e) => {
            const p = e.target.parentElement;
            p.querySelectorAll('.btn-opt').forEach(x => x.classList.remove('active'));
            e.target.classList.add('active');
            if(p.id === 'buy-type') bs.type = e.target.dataset.type;
            if(p.id === 'buy-time') { bs.days = e.target.dataset.d === 'custom' ? 'custom' : parseInt(e.target.dataset.d); container.querySelector('#custom-days-box').classList.toggle('hidden', bs.days !== 'custom'); }
            updatePrice();
        });
        inpCustom.oninput = updatePrice;

        let pollInterval;
        container.querySelector('#btn-pay-action').onclick = () => {
            updatePrice();
            const transCode = "HG" + Math.floor(100000 + Math.random() * 900000);
            const qrUrl = `https://img.vietqr.io/image/MB-0917678211-compact2.png?amount=${bs.price}&addInfo=${transCode}&accountName=TRINH%20THI%20XUAN%20HUONG`;
            
            container.querySelector('#qr-img').src = qrUrl;
            container.querySelector('#code-display').textContent = transCode;
            container.querySelector('#amount-display').textContent = bs.price.toLocaleString('vi-VN') + " VNĐ";
            container.querySelector('#btn-copy-code').onclick = () => copyTxt(transCode);
            container.querySelector('#btn-copy-amt').onclick = () => copyTxt(bs.price);
            
            container.querySelector('#qr-result').classList.remove('hidden');
            container.querySelector('#btn-pay-action').classList.add('hidden');

            const statusText = container.querySelector('#status-text');
            clearInterval(pollInterval);
            pollInterval = setInterval(async () => {
                try {
                    const res = await fetch(`/api/check-payment?code=${transCode}`);
                    const d = await res.json();
                    if(d.status === 'success') {
                        // CLIENT CHECK TIỀN
                        if((d.amount||0) >= bs.price) {
                            clearInterval(pollInterval);
                            statusText.textContent = "Thanh toán thành công!";
                            statusText.style.color = "green";
                            await fetch('/login', { method: 'POST', body: JSON.stringify({secret_key: d.key, device_id: deviceId}) });
                            window.location.reload();
                        } else {
                            statusText.textContent = `Lỗi: Nhận ${d.amount}, Cần ${bs.price}. Liên hệ Admin!`;
                            statusText.style.color = "red";
                        }
                    }
                } catch(e) {}
            }, 3000);
        };
        container.querySelector('#btn-repick').onclick = () => { clearInterval(pollInterval); container.querySelector('#qr-result').classList.add('hidden'); container.querySelector('#btn-pay-action').classList.remove('hidden'); };
        updatePrice();
    }

    // 4. LOGIC KEY INFO
    async function loadKeyInfo() {
        try {
            const res = await fetch('/api/key-info');
            if(!res.ok) return;
            const data = await res.json();
            
            document.getElementById('display-key').textContent = "*****************";
            document.getElementById('toggle-key-visibility').onclick = function() {
                 const el = document.getElementById('display-key');
                 if(el.textContent.includes('*')) { el.textContent = data.key; this.innerHTML = '<i class="fas fa-eye-slash"></i>'; }
                 else { el.textContent = "*****************"; this.innerHTML = '<i class="fas fa-eye"></i>'; }
            };
            document.getElementById('key-status-badge').textContent = data.type === 'permanent' ? 'CHÍNH THỨC' : 'DÙNG THỬ';
            document.getElementById('device-count').textContent = `${data.current_devices}/${data.max_devices}`;
            
            if(data.expires_at) {
                const days = Math.ceil((data.expires_at - Date.now()) / 86400000);
                document.getElementById('expiry-date-display').textContent = `${new Date(data.expires_at).toLocaleDateString('vi-VN')} (${days} ngày)`;
                document.getElementById('official-timer-block').classList.remove('hidden');
                
                const update = () => {
                    const now = Date.now();
                    const left = data.expires_at - now;
                    const used = now - data.activated_at;
                    if(left <= 0) return document.getElementById('time-left').textContent = "HẾT HẠN";
                    
                    const fmt = (ms) => {
                        const d = Math.floor(ms/86400000);
                        const h = Math.floor((ms%86400000)/3600000);
                        const m = Math.floor((ms%3600000)/60000);
                        return `${d}d ${h}h ${m}m`;
                    };
                    document.getElementById('time-used').textContent = fmt(used);
                    document.getElementById('time-left').textContent = fmt(left);
                    const pct = Math.min(100, (used/(data.expires_at - data.activated_at))*100);
                    document.getElementById('time-progress').style.width = pct + '%';
                };
                update(); setInterval(update, 1000);
            }
        } catch(e) {}
    }

    // 5. TEXT PROCESSING
    const els = {
      inputText: document.getElementById('input-text'),
      outputText: document.getElementById('output-text'),
      replaceBtn: document.getElementById('replace-button'),
      copyBtn: document.getElementById('copy-button'),
      modeSelect: document.getElementById('mode-select'),
      list: document.getElementById('punctuation-list'),
      matchCaseBtn: document.getElementById('match-case'),
      wholeWordBtn: document.getElementById('whole-word'),
      autoCapsBtn: document.getElementById('auto-caps'), 
      capsExceptionInput: document.getElementById('caps-exception'),
      saveExceptionBtn: document.getElementById('save-exception-btn'),
      formatCards: document.querySelectorAll('.format-card'),
      splitInput: document.getElementById('split-input-text'),
      splitWrapper: document.getElementById('split-outputs-wrapper'),
      splitRegexInput: document.getElementById('split-regex-input'),
      splitTypeRadios: document.getElementsByName('split-type'),
      splitActionBtn: document.getElementById('split-action-btn'),
      clearSplitRegexBtn: document.getElementById('clear-split-regex'),
      tabButtons: document.querySelectorAll('.tab-button'),
      sidebarBtns: document.querySelectorAll('.sidebar-btn'),
      settingPanels: document.querySelectorAll('.setting-panel')
    };

    function saveState() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
    function normalizeInput(text) { return text ? text.normalize('NFC').replace(/[\u201C\u201D]/g, '"') : ''; }
    function escapeRegExp(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
    function countWords(s) { return s.trim() ? s.trim().split(/\s+/).length : 0; }
    function preserveCase(o, r) { if(o===o.toUpperCase() && o!==o.toLowerCase()) return r.toUpperCase(); if(o[0]===o[0].toUpperCase()) return r.charAt(0).toUpperCase()+r.slice(1).toLowerCase(); return r; }
    function escapeHTML(s) { return s.replace(/[&<>"']/g, m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m])); }

    function formatDialogue(text, mode) {
        if(mode==0) return text;
        return text.replace(/(^|[\n])([^:\n]+):\s*(?:\n\s*)?([“"'])([\s\S]*?)([”"'])/gm, (m,p1,p2,p3,p4) => {
            if(mode==1) return `${p1}${p2.trim()}: "${p4.trim()}"`;
            if(mode==2) return `${p1}${p2.trim()}:\n\n"${p4.trim()}"`;
            if(mode==3) return `${p1}${p2.trim()}:\n\n- ${p4.trim()}`;
            return m;
        });
    }

    function renderModeSelect() {
      if(!els.modeSelect) return;
      els.modeSelect.innerHTML = '';
      Object.keys(state.modes).sort().forEach(m => {
        const opt = document.createElement('option'); opt.value = m; opt.textContent = m;
        els.modeSelect.appendChild(opt);
      });
      els.modeSelect.value = state.currentMode;
      updateModeUI();
    }
    function updateModeUI() {
      const mode = state.modes[state.currentMode];
      if(mode) {
          const upd = (btn, act, txt) => { if(btn) { btn.textContent = `${txt}: ${act ? 'BẬT' : 'Tắt'}`; btn.classList.toggle('active', act); } };
          upd(els.matchCaseBtn, mode.matchCase, 'Match Case');
          upd(els.wholeWordBtn, mode.wholeWord, 'Whole Word');
          upd(els.autoCapsBtn, mode.autoCaps, 'Auto Caps');
          if(els.capsExceptionInput) els.capsExceptionInput.value = mode.exceptions || '';
      }
      els.formatCards.forEach(card => card.classList.toggle('active', parseInt(card.dataset.format) === state.dialogueMode));
    }
    function loadSettingsToUI() {
      if(!els.list) return;
      els.list.innerHTML = '';
      const mode = state.modes[state.currentMode];
      if (mode && mode.pairs) mode.pairs.forEach(p => addPairToUI(p.find, p.replace, true));
      updateModeUI();
      if(document.getElementById('empty-state')) document.getElementById('empty-state').classList.toggle('hidden', els.list.children.length > 0);
    }
    function addPairToUI(find = '', replace = '', append = false) {
      const item = document.createElement('div'); item.className = 'punctuation-item';
      item.innerHTML = `<input type="text" class="find" placeholder="Tìm" value="${find.replace(/"/g, '&quot;')}"><input type="text" class="replace" placeholder="Thay thế" value="${replace.replace(/"/g, '&quot;')}"><button class="remove" tabindex="-1">×</button>`;
      item.querySelector('.remove').onclick = () => { item.remove(); debounceSave(); if(document.getElementById('empty-state')) document.getElementById('empty-state').classList.toggle('hidden', els.list.children.length > 0); };
      item.querySelectorAll('input').forEach(inp => inp.addEventListener('input', debounceSave));
      if (append) els.list.appendChild(item); else els.list.insertBefore(item, els.list.firstChild);
      if(document.getElementById('empty-state')) document.getElementById('empty-state').classList.add('hidden');
    }
    function saveCurrentPairsToState() {
      if(!els.list) return;
      const items = Array.from(els.list.children);
      const newPairs = items.map(item => ({ find: item.querySelector('.find').value, replace: item.querySelector('.replace').value })).filter(p => p.find !== '');
      state.modes[state.currentMode].pairs = newPairs;
      saveState(); 
    }
    function loadTempInput() {
        const saved = JSON.parse(localStorage.getItem(INPUT_STATE_KEY));
        if(saved) { if(els.inputText) els.inputText.value = saved.inputText || ''; if(els.splitInput) els.splitInput.value = saved.splitInput || ''; }
    }
    function saveTempInput() { if(els.inputText) localStorage.setItem(INPUT_STATE_KEY, JSON.stringify({ inputText: els.inputText.value, splitInput: els.splitInput.value })); }

    function switchTab(id) { 
        els.tabButtons.forEach(b => b.classList.toggle('active', b.dataset.tab === id));
        document.querySelectorAll('.tab-pane').forEach(p => p.classList.toggle('active', p.id === id));
        state.activeTab = id; saveState();
    }
    function switchSidebar(id) {
        els.sidebarBtns.forEach(b => b.classList.toggle('active', b.dataset.target === id));
        els.settingPanels.forEach(p => p.classList.toggle('active', p.id === id));
    }

    function initEvents() {
        els.tabButtons.forEach(btn => btn.onclick = () => switchTab(btn.dataset.tab));
        els.sidebarBtns.forEach(btn => btn.onclick = () => switchSidebar(btn.dataset.target));

        const toggle = (prop) => { state.modes[state.currentMode][prop] = !state.modes[state.currentMode][prop]; saveCurrentPairsToState(); updateModeUI(); };
        if(els.matchCaseBtn) els.matchCaseBtn.onclick = () => toggle('matchCase');
        if(els.wholeWordBtn) els.wholeWordBtn.onclick = () => toggle('wholeWord');
        if(els.autoCapsBtn) els.autoCapsBtn.onclick = () => toggle('autoCaps');

        if(document.getElementById('add-mode')) document.getElementById('add-mode').onclick = () => { const n = prompt('Tên Mode:'); if(n) { state.modes[n] = JSON.parse(JSON.stringify(defaultState.modes.default)); state.currentMode = n; saveCurrentPairsToState(); renderModeSelect(); loadSettingsToUI(); }};
        if(els.modeSelect) els.modeSelect.onchange = (e) => { state.currentMode = e.target.value; saveCurrentPairsToState(); loadSettingsToUI(); };
        if(els.saveExceptionBtn) els.saveExceptionBtn.onclick = () => { state.modes[state.currentMode].exceptions = els.capsExceptionInput.value; saveCurrentPairsToState(); alert("Đã lưu!"); };
        if(document.getElementById('add-pair')) document.getElementById('add-pair').onclick = () => addPairToUI();
        if(document.getElementById('save-settings')) document.getElementById('save-settings').onclick = () => { saveCurrentPairsToState(); alert("Đã lưu tất cả!"); };

        if(els.replaceBtn) els.replaceBtn.onclick = () => {
            const raw = els.inputText.value;
            const btn = els.replaceBtn;
            const org = btn.innerHTML;
            if(!raw) return;
            btn.innerHTML = "ĐANG XỬ LÝ...";
            btn.classList.add('btn-loading');
            
            setTimeout(() => {
                let processed = normalizeInput(raw);
                const mode = state.modes[state.currentMode];
                const MARK_REP_START='\uE000'; const MARK_REP_END='\uE001'; const MARK_CAP_START='\uE002'; const MARK_CAP_END='\uE003'; const MARK_BOTH_START='\uE004'; const MARK_BOTH_END='\uE005';
                
                let countRep = 0; let countCaps = 0;

                if(mode.pairs) {
                    const rules = mode.pairs.filter(p=>p.find).map(p=>({find:normalizeInput(p.find), replace:normalizeInput(p.replace||'')})).sort((a,b)=>b.find.length-a.find.length);
                    rules.forEach(rule => {
                        const pat = escapeRegExp(rule.find);
                        const flags = mode.matchCase ? 'g' : 'gi';
                        const reg = mode.wholeWord ? new RegExp(`(?<![\\p{L}\\p{N}_])${pat}(?![\\p{L}\\p{N}_])`, flags+'u') : new RegExp(pat, flags);
                        processed = processed.replace(reg, (m) => { countRep++; let r = rule.replace; if(!mode.matchCase) r = preserveCase(m, r); return `${MARK_REP_START}${r}${MARK_REP_END}`; });
                    });
                }

                if(mode.autoCaps) {
                    const ex = (mode.exceptions||"").split(',').map(s=>s.trim().toLowerCase());
                    const reg = /(^|[.?!]\s+)(?:(\uE000)(.*?)(\uE001)|([^\s\uE000\uE001]+))/gmu;
                    processed = processed.replace(reg, (m, pre, ms, mc, me, rawW) => {
                        let w = mc || rawW; if(!w || ex.includes(w.toLowerCase())) return m;
                        let cap = w.charAt(0).toUpperCase() + w.slice(1);
                        if(ms) { countCaps++; return `${pre}${MARK_BOTH_START}${cap}${MARK_BOTH_END}`; }
                        countCaps++; return `${pre}${MARK_CAP_START}${cap}${MARK_CAP_END}`;
                    });
                }

                processed = formatDialogue(processed, state.dialogueMode);
                let html = ''; let buf = '';
                for(let i=0; i<processed.length; i++) {
                    const c = processed[i];
                    if(c===MARK_REP_START) { html+=escapeHTML(buf)+'<mark class="hl-yellow">'; buf=''; }
                    else if(c===MARK_REP_END || c===MARK_CAP_END || c===MARK_BOTH_END) { html+=escapeHTML(buf)+'</mark>'; buf=''; }
                    else if(c===MARK_CAP_START) { html+=escapeHTML(buf)+'<mark class="hl-blue">'; buf=''; }
                    else if(c===MARK_BOTH_START) { html+=escapeHTML(buf)+'<mark class="hl-orange">'; buf=''; }
                    else buf+=c;
                }
                html+=escapeHTML(buf);
                els.outputText.innerHTML = html;
                document.getElementById('input-word-count').innerText = `${countWords(raw)} words`;
                document.getElementById('output-word-count').innerText = `${countWords(els.outputText.innerText)} words`;
                saveTempInput();
                btn.innerHTML = "HOÀN TẤT!";
                btn.classList.replace('btn-loading', 'btn-success-state');
                setTimeout(() => { btn.innerHTML = org; btn.classList.remove('btn-success-state'); }, 1000);
            }, 300);
        };

        if(els.copyBtn) els.copyBtn.onclick = () => { navigator.clipboard.writeText(els.outputText.innerText); els.copyBtn.innerText = "ĐÃ COPY"; setTimeout(()=>els.copyBtn.innerText="SAO CHÉP", 1000); };

        let currentSplitMode = 2;
        if(els.splitActionBtn) els.splitActionBtn.onclick = () => {
            const txt = els.splitInput.value;
            const count = parseInt(document.querySelector('#split-opts-count .active').dataset.val);
            const words = countWords(txt);
            const perPart = Math.ceil(words/count);
            els.splitWrapper.innerHTML = '';
            for(let i=0; i<count; i++) {
                const div = document.createElement('div'); div.className = 'split-box';
                div.innerHTML = `<div class="split-header"><span>Phần ${i+1}</span></div><textarea class="custom-scrollbar" readonly>Nội dung phần ${i+1} (Giả lập split ${perPart} từ)...</textarea>`;
                els.splitWrapper.appendChild(div);
            }
        };

        els.formatCards.forEach(c => c.onclick = () => { els.formatCards.forEach(x => x.classList.remove('active')); c.classList.add('active'); state.dialogueMode = parseInt(c.dataset.format); saveCurrentPairsToState(); });
        [els.inputText, els.splitInput].forEach(el => el && el.addEventListener('input', debounceSave));
    }
});
