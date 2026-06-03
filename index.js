/**
 * 文字润色工坊 - SillyTavern Extension
 * 兼容写法：不使用 ES Module import，通过 SillyTavern 全局对象访问 API
 */

(function () {
    'use strict';

    const EXT_NAME = 'st-text-polish';

    // ─── 风格 Prompt ────────────────────────────────────────────────────────
    const stylePrompts = {
        literary:   '文学叙事风格：语言流畅优美，叙述张力强，善用长短句结合，情感与细节并重，如优秀的中文小说正文',
        poetic:     '诗意朦胧风格：语言如诗，多用意象与比喻，留有余白和遐想空间，如散文诗或意识流写作',
        elegant:    '古典雅致风格：借鉴古典文学语感，用词典雅，结构端庄，可适当融入古风用词但保持可读性',
        romantic:   '浪漫细腻风格：情感饱满真挚，细节描写动人，善于捕捉情绪的微妙变化，如言情小说上乘之作',
        dramatic:   '戏剧张力风格：节奏起伏跌宕，关键处有停顿感，情绪渲染强烈，如电影剧本或戏剧性小说',
        minimalist: '极简冷峻风格：语言克制简洁，不多余一字，以少胜多，言简意赅，如村上春树式笔触',
        fantasy:    '奇幻绮丽风格：想象瑰丽，用词华美，富有异域或超自然色彩，如玄幻奇幻小说精华段落',
        dark:       '暗黑哥特风格：基调深沉阴郁，充满隐喻和象征，神秘压抑中透露美感，如哥特文学或心理惊悚',
        custom:     '',
    };

    const intensityDesc = {
        1: '尽量保留原文，只做微小词句优化',
        2: '轻度改写，保留原意和结构，优化表达',
        3: '适度改写，保留核心内容，提升文学性',
        4: '深度重写，大幅提升表达质量，可改变句式',
        5: '完全重塑，以原文意思为基础彻底重写成高质量文本',
    };
    const intensityLabel = { 1: '极轻微', 2: '轻度', 3: '均衡', 4: '深度', 5: '大幅重写' };

    // ─── 默认设置 ────────────────────────────────────────────────────────────
    const defaultSettings = {
        apiUrl: 'https://api.anthropic.com',
        apiKey: '',
        model: 'claude-sonnet-4-20250514',
        style: 'literary',
        customStyle: '',
        intensity: 3,
    };

    // ─── 运行时状态 ──────────────────────────────────────────────────────────
    let settings = Object.assign({}, defaultSettings);
    let selectedPresets = new Set();
    let currentResult = '';
    let inputSnapshot = '';
    let isStreaming = false;
    let compareOn = false;

    // ─── 面板 HTML ───────────────────────────────────────────────────────────
    const PANEL_HTML = `
<div id="polish-panel-wrap" class="polish-panel">
  <div class="inline-drawer">
    <div class="inline-drawer-toggle inline-drawer-header">
      <b>⚙ API 设置</b>
      <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
    </div>
    <div class="inline-drawer-content">
      <label class="polish-label">API 地址</label>
      <input id="polish-api-url" type="text" class="text_pole" placeholder="https://api.anthropic.com" />
      <label class="polish-label" style="margin-top:8px;">API 密钥</label>
      <input id="polish-api-key" type="password" class="text_pole" placeholder="sk-ant-api03-..." autocomplete="off" />
      <label class="polish-label" style="margin-top:8px;">模型</label>
      <input id="polish-model" type="text" class="text_pole" placeholder="claude-sonnet-4-20250514" />
      <div id="polish-api-status" class="polish-api-status idle" style="margin-top:6px;">● 未连接</div>
    </div>
  </div>

  <div class="polish-section-title">润色风格</div>
  <div class="polish-style-grid">
    <div class="polish-chip active" data-style="literary"><span class="chip-icon">🖋</span><span class="chip-name">文学叙事</span></div>
    <div class="polish-chip" data-style="poetic"><span class="chip-icon">🌙</span><span class="chip-name">诗意朦胧</span></div>
    <div class="polish-chip" data-style="elegant"><span class="chip-icon">🏛</span><span class="chip-name">古典雅致</span></div>
    <div class="polish-chip" data-style="romantic"><span class="chip-icon">🌹</span><span class="chip-name">浪漫细腻</span></div>
    <div class="polish-chip" data-style="dramatic"><span class="chip-icon">⚡</span><span class="chip-name">戏剧张力</span></div>
    <div class="polish-chip" data-style="minimalist"><span class="chip-icon">◻</span><span class="chip-name">极简冷峻</span></div>
    <div class="polish-chip" data-style="fantasy"><span class="chip-icon">✨</span><span class="chip-name">奇幻绮丽</span></div>
    <div class="polish-chip" data-style="dark"><span class="chip-icon">🌑</span><span class="chip-name">暗黑哥特</span></div>
    <div class="polish-chip" data-style="custom"><span class="chip-icon">🎨</span><span class="chip-name">自定义</span></div>
  </div>
  <div id="polish-custom-style-box" style="display:none;margin-top:6px;">
    <input id="polish-custom-style" type="text" class="text_pole" placeholder="例如：江户武士风、赛博朋克…" />
  </div>

  <div class="polish-section-title">润色强度</div>
  <div class="polish-intensity-row">
    <span class="polish-intensity-tip">轻微</span>
    <input id="polish-intensity" type="range" min="1" max="5" value="3" step="1" style="flex:1;" />
    <span class="polish-intensity-tip">重塑</span>
    <span id="polish-intensity-label" class="polish-intensity-val">均衡</span>
  </div>

  <div class="polish-section-title">快速预设 <span class="polish-hint">（可多选）</span></div>
  <div class="polish-preset-row">
    <div class="polish-preset-tag" data-preset="保留原有人称视角">保留人称视角</div>
    <div class="polish-preset-tag" data-preset="增加感官细节描写">增加感官细节</div>
    <div class="polish-preset-tag" data-preset="加强动作节奏感">加强动作节奏</div>
    <div class="polish-preset-tag" data-preset="深化角色内心独白">深化内心独白</div>
    <div class="polish-preset-tag" data-preset="使用更多修辞手法">增加修辞手法</div>
    <div class="polish-preset-tag" data-preset="让结尾更有余韵">结尾有余韵</div>
    <div class="polish-preset-tag" data-preset="控制在原文长度的1.5倍以内">控制篇幅</div>
    <div class="polish-preset-tag" data-preset="适合小说正文风格">小说正文风</div>
  </div>

  <div style="margin-top:8px;">
    <input id="polish-extra-note" type="text" class="text_pole" placeholder="其他要求（可选）：例如 不要用感叹号…" />
  </div>

  <div class="polish-section-title">待润色文本</div>
  <textarea id="polish-input" class="text_pole" rows="5" placeholder="在这里输入待润色的文字，或点击「导入消息」从当前对话导入…"></textarea>
  <div class="polish-btn-row">
    <span id="polish-char-count" class="polish-char-count">0 字</span>
    <button id="polish-import-btn" class="menu_button">导入消息</button>
    <button id="polish-clear-btn" class="menu_button">清空</button>
    <button id="polish-run-btn" class="menu_button">✦ 润色</button>
  </div>

  <div id="polish-result-section" style="display:none;margin-top:10px;">
    <div class="polish-result-header">
      <span class="polish-result-tag">润色结果</span>
      <div class="polish-result-actions">
        <button id="polish-compare-btn" class="menu_button">对比</button>
        <button id="polish-copy-btn" class="menu_button">复制</button>
        <button id="polish-reuse-btn" class="menu_button">再次润色</button>
        <button id="polish-insert-btn" class="menu_button">发送到输入框</button>
      </div>
    </div>
    <div id="polish-result-normal">
      <div id="polish-loading" class="polish-loading" style="display:none;">
        <span></span><span></span><span></span><em>AI 润色中…</em>
      </div>
      <div id="polish-result-content" class="polish-result-content"></div>
    </div>
    <div id="polish-result-compare" class="polish-compare-grid" style="display:none;">
      <div class="polish-compare-pane">
        <div class="polish-compare-label">原文</div>
        <div id="polish-orig-text" class="polish-compare-text"></div>
      </div>
      <div class="polish-compare-pane">
        <div class="polish-compare-label">润色后</div>
        <div id="polish-new-text" class="polish-compare-text new"></div>
      </div>
    </div>
  </div>
</div>`;

    // ─── 构建 Prompt ─────────────────────────────────────────────────────────
    function buildPrompt(inputText) {
        const styleDesc = settings.style === 'custom'
            ? (settings.customStyle || '优美流畅的文学风格')
            : (stylePrompts[settings.style] || stylePrompts.literary);
        const presetsStr = selectedPresets.size > 0
            ? '\n额外要求：' + [...selectedPresets].join('、') : '';
        const noteEl = document.getElementById('polish-extra-note');
        const noteStr = (noteEl && noteEl.value) ? '\n特别说明：' + noteEl.value : '';
        return `你是一位专业的中文写作润色专家，擅长文学创作和语言美化。

请按照以下要求对文本进行润色：

【目标风格】${styleDesc}

【润色强度】${intensityDesc[settings.intensity] || intensityDesc[3]}${presetsStr}${noteStr}

【注意事项】
- 保持原文的核心意思和情节
- 不要添加原文没有的剧情或信息
- 直接输出润色后的文本，不要加任何说明或注释
- 不要输出"润色后："等前缀

【待润色文本】
${inputText}`;
    }

    // ─── 调用 API ─────────────────────────────────────────────────────────────
    async function callApi(prompt) {
        const url = (settings.apiUrl || 'https://api.anthropic.com').replace(/\/$/, '');
        const key = settings.apiKey;
        const model = settings.model || 'claude-sonnet-4-20250514';
        const isAnthropic = url.includes('anthropic.com');
        const endpoint = isAnthropic ? `${url}/v1/messages` : `${url}/v1/chat/completions`;
        const headers = { 'Content-Type': 'application/json' };
        if (isAnthropic) {
            headers['x-api-key'] = key;
            headers['anthropic-version'] = '2023-06-01';
        } else {
            headers['Authorization'] = 'Bearer ' + key;
        }
        const body = isAnthropic
            ? { model, max_tokens: 2048, stream: true, messages: [{ role: 'user', content: prompt }] }
            : { model, stream: true, messages: [{ role: 'system', content: '你是一位专业的中文写作润色专家。' }, { role: 'user', content: prompt }] };
        return fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(body) });
    }

    // ─── 润色主流程 ──────────────────────────────────────────────────────────
    async function startPolish() {
        const inputEl = document.getElementById('polish-input');
        const inputText = inputEl ? inputEl.value.trim() : '';
        if (!inputText) { toastr.warning('请输入要润色的文字'); return; }
        if (!settings.apiKey) { toastr.warning('请先填写 API 密钥'); return; }
        if (isStreaming) return;

        isStreaming = true;
        inputSnapshot = inputText;
        currentResult = '';
        compareOn = false;

        const runBtn = document.getElementById('polish-run-btn');
        const loading = document.getElementById('polish-loading');
        const resultContent = document.getElementById('polish-result-content');
        const resultSection = document.getElementById('polish-result-section');
        const compareGrid = document.getElementById('polish-result-compare');
        const normalView = document.getElementById('polish-result-normal');
        const compareBtn = document.getElementById('polish-compare-btn');

        if (runBtn) runBtn.disabled = true;
        resultSection.style.display = 'block';
        loading.style.display = 'flex';
        resultContent.textContent = '';
        resultContent.classList.remove('streaming');
        compareGrid.style.display = 'none';
        normalView.style.display = 'block';
        if (compareBtn) compareBtn.textContent = '对比';

        try {
            const isAnthropic = (settings.apiUrl || '').includes('anthropic.com');
            const response = await callApi(buildPrompt(inputText));
            if (!response.ok) {
                const err = await response.json().catch(() => ({}));
                throw new Error(err.error?.message || 'HTTP ' + response.status);
            }
            loading.style.display = 'none';
            resultContent.classList.add('streaming');

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop();
                for (const line of lines) {
                    if (!line.startsWith('data: ')) continue;
                    const data = line.slice(6).trim();
                    if (data === '[DONE]') continue;
                    try {
                        const parsed = JSON.parse(data);
                        let text = null;
                        if (isAnthropic) {
                            if (parsed.type === 'content_block_delta' && parsed.delta?.text) text = parsed.delta.text;
                        } else {
                            text = parsed.choices?.[0]?.delta?.content || null;
                        }
                        if (text) { currentResult += text; resultContent.textContent = currentResult; }
                    } catch (e) { /* 忽略 */ }
                }
            }
            resultContent.classList.remove('streaming');
            setApiStatus('ok');
            toastr.success('润色完成！');
        } catch (err) {
            loading.style.display = 'none';
            resultContent.classList.remove('streaming');
            resultContent.textContent = '❌ 错误：' + err.message;
            setApiStatus('err');
            toastr.error('润色失败：' + err.message);
        }

        isStreaming = false;
        if (runBtn) runBtn.disabled = false;
    }

    // ─── 工具函数 ─────────────────────────────────────────────────────────────
    function setApiStatus(state) {
        const el = document.getElementById('polish-api-status');
        if (!el) return;
        el.className = 'polish-api-status ' + state;
        el.textContent = { ok: '● 连接正常', err: '● 请求失败', idle: '● 未连接' }[state] || '● 未连接';
    }

    function updateCharCount() {
        const input = document.getElementById('polish-input');
        const count = document.getElementById('polish-char-count');
        if (input && count) count.textContent = (input.value?.length || 0) + ' 字';
    }

    function importLastMessage() {
        try {
            const ctx = SillyTavern.getContext();
            const chat = ctx.chat;
            if (!chat || !chat.length) { toastr.warning('当前没有聊天消息'); return; }
            for (let i = chat.length - 1; i >= 0; i--) {
                if (!chat[i].is_user && chat[i].mes) {
                    const tmp = document.createElement('div');
                    tmp.innerHTML = chat[i].mes;
                    const input = document.getElementById('polish-input');
                    if (input) { input.value = tmp.textContent || chat[i].mes; updateCharCount(); }
                    toastr.info('已导入最新 AI 消息');
                    return;
                }
            }
            toastr.warning('没有找到 AI 消息');
        } catch (e) { toastr.error('导入失败：' + e.message); }
    }

    function insertToInputBox() {
        if (!currentResult) return;
        const stInput = document.getElementById('send_textarea');
        if (stInput) {
            stInput.value = currentResult;
            stInput.dispatchEvent(new Event('input', { bubbles: true }));
            toastr.success('已发送到输入框');
        } else { toastr.warning('找不到输入框'); }
    }

    function toggleCompare() {
        if (!currentResult) return;
        compareOn = !compareOn;
        const normalView = document.getElementById('polish-result-normal');
        const compareGrid = document.getElementById('polish-result-compare');
        const btn = document.getElementById('polish-compare-btn');
        if (compareOn) {
            document.getElementById('polish-orig-text').textContent = inputSnapshot;
            document.getElementById('polish-new-text').textContent = currentResult;
            normalView.style.display = 'none';
            compareGrid.style.display = 'grid';
            if (btn) btn.textContent = '普通视图';
        } else {
            normalView.style.display = 'block';
            compareGrid.style.display = 'none';
            if (btn) btn.textContent = '对比';
        }
    }

    function saveSettings() {
        if (typeof extension_settings !== 'undefined') {
            extension_settings[EXT_NAME] = Object.assign({}, settings);
            if (typeof saveSettingsDebounced === 'function') saveSettingsDebounced();
        }
    }

    // ─── 绑定事件 ────────────────────────────────────────────────────────────
    function bindEvents() {
        document.getElementById('polish-api-url')?.addEventListener('change', function () {
            settings.apiUrl = this.value.trim(); saveSettings();
        });
        document.getElementById('polish-api-key')?.addEventListener('change', function () {
            settings.apiKey = this.value.trim(); saveSettings();
        });
        document.getElementById('polish-model')?.addEventListener('change', function () {
            settings.model = this.value.trim(); saveSettings();
        });
        document.querySelectorAll('#polish-panel-wrap .polish-chip').forEach(chip => {
            chip.addEventListener('click', function () {
                document.querySelectorAll('#polish-panel-wrap .polish-chip').forEach(c => c.classList.remove('active'));
                this.classList.add('active');
                settings.style = this.dataset.style;
                const box = document.getElementById('polish-custom-style-box');
                if (box) box.style.display = settings.style === 'custom' ? 'block' : 'none';
                saveSettings();
            });
        });
        document.getElementById('polish-custom-style')?.addEventListener('input', function () {
            settings.customStyle = this.value; saveSettings();
        });
        document.getElementById('polish-intensity')?.addEventListener('input', function () {
            settings.intensity = parseInt(this.value);
            const lbl = document.getElementById('polish-intensity-label');
            if (lbl) lbl.textContent = intensityLabel[settings.intensity] || '均衡';
            saveSettings();
        });
        document.querySelectorAll('#polish-panel-wrap .polish-preset-tag').forEach(tag => {
            tag.addEventListener('click', function () {
                const p = this.dataset.preset;
                if (selectedPresets.has(p)) { selectedPresets.delete(p); this.classList.remove('active'); }
                else { selectedPresets.add(p); this.classList.add('active'); }
            });
        });
        document.getElementById('polish-input')?.addEventListener('input', updateCharCount);
        document.getElementById('polish-run-btn')?.addEventListener('click', startPolish);
        document.getElementById('polish-import-btn')?.addEventListener('click', importLastMessage);
        document.getElementById('polish-clear-btn')?.addEventListener('click', () => {
            const el = document.getElementById('polish-input');
            if (el) el.value = '';
            updateCharCount();
            const rs = document.getElementById('polish-result-section');
            if (rs) rs.style.display = 'none';
            currentResult = '';
        });
        document.getElementById('polish-compare-btn')?.addEventListener('click', toggleCompare);
        document.getElementById('polish-copy-btn')?.addEventListener('click', () => {
            if (!currentResult) return;
            navigator.clipboard.writeText(currentResult).then(() => toastr.success('已复制到剪贴板'));
        });
        document.getElementById('polish-reuse-btn')?.addEventListener('click', () => {
            if (!currentResult) return;
            const el = document.getElementById('polish-input');
            if (el) { el.value = currentResult; updateCharCount(); }
            const rs = document.getElementById('polish-result-section');
            if (rs) rs.style.display = 'none';
            currentResult = '';
        });
        document.getElementById('polish-insert-btn')?.addEventListener('click', insertToInputBox);
    }

    // ─── 恢复已保存的设置到 UI ───────────────────────────────────────────────
    function restoreUI() {
        const f = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; };
        f('polish-api-url', settings.apiUrl);
        f('polish-api-key', settings.apiKey);
        f('polish-model', settings.model);
        const intEl = document.getElementById('polish-intensity');
        if (intEl) intEl.value = settings.intensity || 3;
        const lbl = document.getElementById('polish-intensity-label');
        if (lbl) lbl.textContent = intensityLabel[settings.intensity] || '均衡';
        document.querySelectorAll('#polish-panel-wrap .polish-chip').forEach(c => {
            c.classList.toggle('active', c.dataset.style === settings.style);
        });
        const box = document.getElementById('polish-custom-style-box');
        if (box) box.style.display = settings.style === 'custom' ? 'block' : 'none';
        setApiStatus(settings.apiKey ? 'idle' : 'idle');
    }

    // ─── 初始化入口 ──────────────────────────────────────────────────────────
    function init() {
        // 加载已保存设置
        if (typeof extension_settings !== 'undefined') {
            if (!extension_settings[EXT_NAME]) extension_settings[EXT_NAME] = Object.assign({}, defaultSettings);
            settings = Object.assign({}, defaultSettings, extension_settings[EXT_NAME]);
        }

        // 注入面板到扩展设置区域，尝试多个可能的容器
        const containers = ['#extensions_settings2', '#extensions_settings', '.extensions_block'];
        let injected = false;
        for (const sel of containers) {
            const container = document.querySelector(sel);
            if (container) {
                // 创建包装 drawer
                const wrapper = document.createElement('div');
                wrapper.innerHTML = `
                <div class="inline-drawer">
                  <div class="inline-drawer-toggle inline-drawer-header">
                    <b>文字润色工坊</b>
                    <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
                  </div>
                  <div class="inline-drawer-content">
                    ${PANEL_HTML}
                  </div>
                </div>`;
                container.appendChild(wrapper);
                injected = true;
                break;
            }
        }

        if (!injected) {
            console.warn('[文字润色工坊] 找不到扩展设置容器，延迟重试…');
            setTimeout(init, 1500);
            return;
        }

        bindEvents();
        restoreUI();
        console.log('[文字润色工坊] 加载完成 ✓');
    }

    // 等待页面就绪后执行
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        // ST 可能在 DOMContentLoaded 之后才注入扩展容器，稍作延迟
        setTimeout(init, 500);
    }

})();
