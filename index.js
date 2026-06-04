/**
 * 文字润色工坊 v2.0 — SillyTavern Extension
 * 规范参照 Persona Weaver，使用 callPopup 弹窗 + 魔棒按钮
 */
(function () {
    'use strict';

    const EXT_NAME   = 'st-text-polish';
    const WAND_BTN_ID = 'tp-wand-btn';

    // ── 风格 Prompt ──────────────────────────────────────────────────────────
    const STYLE_PROMPTS = {
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
    const INTENSITY_DESC = {
        1:'尽量保留原文，只做微小词句优化',
        2:'轻度改写，保留原意和结构，优化表达',
        3:'适度改写，保留核心内容，提升文学性',
        4:'深度重写，大幅提升表达质量，可改变句式',
        5:'完全重塑，以原文意思为基础彻底重写成高质量文本',
    };
    const INTENSITY_LABEL = { 1:'极轻微', 2:'轻度', 3:'均衡', 4:'深度', 5:'大幅重写' };

    // ── 默认设置 ─────────────────────────────────────────────────────────────
    const DEFAULT_SETTINGS = {
        apiUrl:      'https://api.anthropic.com',
        apiKey:      '',
        model:       '',
        style:       'literary',
        customStyle: '',
        intensity:   3,
    };

    // ── 运行时状态 ───────────────────────────────────────────────────────────
    let cfg          = Object.assign({}, DEFAULT_SETTINGS);
    let selPresets   = new Set();
    let currentResult = '';
    let inputSnapshot = '';
    let isStreaming   = false;
    let diffBlocks    = [];
    let lastRefineReq = '';
    let compareOn     = false;
    let evBound       = false;

    // ────────────────────────────────────────────────────────────────────────
    // POPUP HTML
    // ────────────────────────────────────────────────────────────────────────
    function buildPopupHtml() {
        return `
<div class="tp-wrapper">
    <!-- 顶部 Tab 导航 -->
    <div class="tp-tabs">
        <div class="tp-tab active" data-tab="polish">✦ 润色</div>
        <div class="tp-tab" data-tab="api">⚙ API</div>
    </div>

    <!-- 相对定位容器（diff overlay 绝对定位于此） -->
    <div class="tp-relative" style="flex:1;display:flex;flex-direction:column;overflow:hidden;">

        <!-- ══ 润色 Tab ══ -->
        <div id="tp-view-polish" class="tp-view active">
            <div class="tp-scroll">

                <!-- 风格选择 -->
                <div class="tp-card">
                    <div class="tp-card-title">润色风格</div>
                    <div class="tp-style-grid" id="tp-style-grid">
                        <div class="tp-chip active" data-style="literary"><span class="tp-chip-icon">🖋</span><span class="tp-chip-name">文学叙事</span></div>
                        <div class="tp-chip" data-style="poetic"><span class="tp-chip-icon">🌙</span><span class="tp-chip-name">诗意朦胧</span></div>
                        <div class="tp-chip" data-style="elegant"><span class="tp-chip-icon">🏛</span><span class="tp-chip-name">古典雅致</span></div>
                        <div class="tp-chip" data-style="romantic"><span class="tp-chip-icon">🌹</span><span class="tp-chip-name">浪漫细腻</span></div>
                        <div class="tp-chip" data-style="dramatic"><span class="tp-chip-icon">⚡</span><span class="tp-chip-name">戏剧张力</span></div>
                        <div class="tp-chip" data-style="minimalist"><span class="tp-chip-icon">◻</span><span class="tp-chip-name">极简冷峻</span></div>
                        <div class="tp-chip" data-style="fantasy"><span class="tp-chip-icon">✨</span><span class="tp-chip-name">奇幻绮丽</span></div>
                        <div class="tp-chip" data-style="dark"><span class="tp-chip-icon">🌑</span><span class="tp-chip-name">暗黑哥特</span></div>
                        <div class="tp-chip" data-style="custom"><span class="tp-chip-icon">🎨</span><span class="tp-chip-name">自定义</span></div>
                    </div>
                    <div id="tp-custom-style-box" style="display:none;margin-top:8px;">
                        <input id="tp-custom-style" type="text" class="tp-input"
                               placeholder="描述你想要的风格，例如：江户武士风、赛博朋克…" />
                    </div>

                    <div class="tp-divider"></div>

                    <!-- 强度 -->
                    <div class="tp-card-title" style="margin-bottom:8px;">润色强度</div>
                    <div class="tp-intensity-row">
                        <span class="tp-intensity-tip">轻微</span>
                        <input id="tp-intensity" type="range" min="1" max="5" value="3" step="1" />
                        <span class="tp-intensity-tip">重塑</span>
                        <span id="tp-intensity-label" class="tp-intensity-val">均衡</span>
                    </div>
                </div>

                <!-- 快速预设 -->
                <div class="tp-card">
                    <div class="tp-card-title">快速预设 <span class="tp-hint">（可多选）</span></div>
                    <div class="tp-preset-row" id="tp-preset-row">
                        <div class="tp-preset-tag" data-preset="保留原有人称视角">保留人称视角</div>
                        <div class="tp-preset-tag" data-preset="增加感官细节描写">增加感官细节</div>
                        <div class="tp-preset-tag" data-preset="加强动作节奏感">加强动作节奏</div>
                        <div class="tp-preset-tag" data-preset="深化角色内心独白">深化内心独白</div>
                        <div class="tp-preset-tag" data-preset="使用更多修辞手法">增加修辞手法</div>
                        <div class="tp-preset-tag" data-preset="让结尾更有余韵">结尾有余韵</div>
                        <div class="tp-preset-tag" data-preset="控制在原文长度的1.5倍以内">控制篇幅</div>
                        <div class="tp-preset-tag" data-preset="适合小说正文风格">小说正文风</div>
                    </div>
                    <input id="tp-extra-note" type="text" class="tp-input"
                           style="margin-top:8px;"
                           placeholder="其他要求（可选）：例如 不要用感叹号、避免欧式长句…" />
                </div>

                <!-- 输入区 -->
                <div class="tp-card">
                    <div class="tp-card-title">待润色文本</div>
                    <textarea id="tp-input" class="tp-textarea" rows="5"
                              placeholder="在这里输入待润色的文字，或点击下方按钮从当前对话导入最新 AI 消息…"></textarea>
                    <div class="tp-row" style="margin-top:8px;">
                        <span id="tp-char-count" class="tp-char-count">0 字</span>
                        <button id="tp-import-btn" class="tp-btn tp-btn-ghost" style="margin-left:auto;">
                            <i class="fa-solid fa-file-import"></i> 导入消息
                        </button>
                        <button id="tp-clear-input-btn" class="tp-btn tp-btn-ghost">
                            <i class="fa-solid fa-eraser"></i> 清空
                        </button>
                    </div>
                </div>

                <!-- 结果区 -->
                <div id="tp-result-section" style="display:none;">
                    <div class="tp-card">
                        <div class="tp-result-header">
                            <span class="tp-result-tag"><i class="fa-solid fa-wand-magic-sparkles"></i> 润色结果</span>
                            <div class="tp-result-actions">
                                <button id="tp-compare-btn" class="tp-btn tp-btn-ghost" style="padding:5px 10px;font-size:0.8rem;">对比视图</button>
                                <button id="tp-copy-btn" class="tp-btn tp-btn-ghost" style="padding:5px 10px;font-size:0.8rem;"><i class="fa-solid fa-copy"></i> 复制</button>
                                <button id="tp-send-btn" class="tp-btn tp-btn-ghost" style="padding:5px 10px;font-size:0.8rem;"><i class="fa-solid fa-arrow-up-from-bracket"></i> 发送到输入框</button>
                            </div>
                        </div>

                        <!-- 加载动画 -->
                        <div id="tp-loading" class="tp-loading" style="display:none;">
                            <span></span><span></span><span></span>
                            <em id="tp-loading-text">AI 润色中…</em>
                        </div>

                        <!-- 正文 -->
                        <div id="tp-result-content" class="tp-result-content"></div>

                        <!-- 润色意见区 -->
                        <div class="tp-divider"></div>
                        <div style="font-size:0.8rem;opacity:0.65;margin-bottom:5px;">对结果不满意？输入修改意见重新润色：</div>
                        <div class="tp-refine-area">
                            <textarea id="tp-refine-input" class="tp-textarea tp-refine-input"
                                      placeholder="例如：语气再强硬一些、去掉心理描写、结尾改成疑问句…"></textarea>
                            <button id="tp-refine-btn" class="tp-btn tp-btn-primary tp-btn-icon" title="执行润色/重写">
                                <i class="fa-solid fa-magic"></i>
                            </button>
                        </div>
                    </div>
                </div>

            </div><!-- end .tp-scroll -->

            <!-- 底部操作栏 -->
            <div class="tp-footer">
                <div class="tp-footer-left">
                    <button id="tp-reuse-btn" class="tp-btn tp-btn-ghost" title="将结果放回输入框，再次润色">
                        <i class="fa-solid fa-rotate-left"></i> 再次润色
                    </button>
                </div>
                <div class="tp-footer-right">
                    <button id="tp-run-btn" class="tp-btn tp-btn-primary">
                        <i class="fa-solid fa-wand-magic-sparkles"></i> 开始润色
                    </button>
                </div>
            </div>
        </div><!-- end tp-view-polish -->

        <!-- ══ API Tab ══ -->
        <div id="tp-view-api" class="tp-view">
            <div class="tp-scroll">
                <div class="tp-card">
                    <div class="tp-card-title">API 连接</div>

                    <div class="tp-row">
                        <label class="tp-label">API 地址</label>
                        <input id="tp-api-url" type="text" class="tp-input"
                               placeholder="https://api.anthropic.com" />
                    </div>
                    <div class="tp-row">
                        <label class="tp-label">API 密钥</label>
                        <input id="tp-api-key" type="password" class="tp-input"
                               placeholder="sk-ant-api03-…" autocomplete="off" />
                        <button id="tp-connect-btn" class="tp-btn tp-btn-primary tp-btn-icon" style="flex-shrink:0;">
                            <i class="fa-solid fa-plug"></i> 连接
                        </button>
                    </div>

                    <div id="tp-api-status" class="tp-api-status idle">● 未连接</div>
                </div>

                <!-- 模型选择（连接后显示） -->
                <div id="tp-model-card" class="tp-card" style="display:none;">
                    <div class="tp-card-title">选择模型</div>
                    <div class="tp-row">
                        <select id="tp-model-select" class="tp-select"></select>
                    </div>
                    <div id="tp-model-hint" style="font-size:0.76rem;opacity:0.5;margin-top:4px;"></div>
                </div>
            </div>
        </div><!-- end tp-view-api -->

        <!-- ══ Diff 对比视图（绝对覆盖） ══ -->
        <div id="tp-diff-overlay" class="tp-diff-overlay" style="display:none;">
            <div class="tp-diff-toolbar">
                <span class="tp-diff-hint"><i class="fa-solid fa-circle-info"></i> 点击高亮文字切换保留版本</span>
                <button class="tp-diff-mode-btn" data-mode="old"><i class="fa-solid fa-file-lines"></i> 原文</button>
                <button class="tp-diff-mode-btn" data-mode="new"><i class="fa-solid fa-file-circle-plus"></i> 新版</button>
                <button class="tp-diff-mode-btn" data-mode="final"><i class="fa-solid fa-eye"></i> 最终</button>
            </div>
            <div class="tp-diff-content">
                <div id="tp-diff-merge" class="tp-diff-merge-view" contenteditable="true"></div>
            </div>
            <div class="tp-diff-actions">
                <button id="tp-diff-reroll" class="tp-btn tp-btn-ghost" title="用相同意见重新生成">
                    <i class="fa-solid fa-rotate-right"></i> 重新生成
                </button>
                <div style="flex:1;"></div>
                <button id="tp-diff-cancel" class="tp-btn tp-btn-danger">
                    <i class="fa-solid fa-xmark"></i> 放弃
                </button>
                <button id="tp-diff-confirm" class="tp-btn tp-btn-primary">
                    <i class="fa-solid fa-check"></i> 应用
                </button>
            </div>
        </div>

    </div><!-- end .tp-relative -->
</div><!-- end .tp-wrapper -->
`;
    }

    // ────────────────────────────────────────────────────────────────────────
    // 工具函数
    // ────────────────────────────────────────────────────────────────────────
    function saveSettings() {
        if (typeof extension_settings !== 'undefined') {
            extension_settings[EXT_NAME] = Object.assign({}, cfg);
            if (typeof saveSettingsDebounced === 'function') saveSettingsDebounced();
        }
    }

    function loadSettings() {
        if (typeof extension_settings !== 'undefined' && extension_settings[EXT_NAME]) {
            cfg = Object.assign({}, DEFAULT_SETTINGS, extension_settings[EXT_NAME]);
        }
    }

    function setApiStatus(state) {
        const el = document.getElementById('tp-api-status');
        if (!el) return;
        const map = { ok:'● 已连接', err:'● 连接失败', idle:'● 未连接', connecting:'● 连接中…' };
        el.className = 'tp-api-status ' + state;
        el.textContent = map[state] || '● 未连接';
    }

    function updateCharCount() {
        const el = document.getElementById('tp-input');
        const cnt = document.getElementById('tp-char-count');
        if (el && cnt) cnt.textContent = (el.value?.length || 0) + ' 字';
    }

    function showToast(msg, type = 'info') {
        if (typeof toastr !== 'undefined') {
            if (type === 'success') toastr.success(msg);
            else if (type === 'error') toastr.error(msg);
            else if (type === 'warning') toastr.warning(msg);
            else toastr.info(msg);
        }
    }

    // ────────────────────────────────────────────────────────────────────────
    // Prompt 构建
    // ────────────────────────────────────────────────────────────────────────
    function buildPolishPrompt(inputText) {
        const styleDesc = cfg.style === 'custom'
            ? (cfg.customStyle || '优美流畅的文学风格')
            : (STYLE_PROMPTS[cfg.style] || STYLE_PROMPTS.literary);
        const presetsStr = selPresets.size > 0
            ? '\n额外要求：' + [...selPresets].join('、') : '';
        const noteEl = document.getElementById('tp-extra-note');
        const noteStr = noteEl?.value?.trim() ? '\n特别说明：' + noteEl.value.trim() : '';

        return `你是一位专业的中文写作润色专家，擅长文学创作和语言美化。

请按照以下要求对文本进行润色：

【目标风格】${styleDesc}

【润色强度】${INTENSITY_DESC[cfg.intensity] || INTENSITY_DESC[3]}${presetsStr}${noteStr}

【注意事项】
- 保持原文的核心意思和情节
- 不要添加原文没有的剧情或信息
- 直接输出润色后的文本，不要加任何说明或注释
- 不要输出"润色后："等前缀

【待润色文本】
${inputText}`;
    }

    function buildRefinePrompt(oldText, instruction) {
        return `你是一位专业的中文写作润色专家。

以下是一段已经润色过的文本：
"""
${oldText}
"""

用户对此文本不满意，请根据以下修改意见重新润色：
修改意见：${instruction}

【要求】
- 在保留原有文学风格的基础上，落实用户的具体修改意见
- 直接输出修改后的文本，不要加任何说明或前缀

【输出】`;
    }

    // ────────────────────────────────────────────────────────────────────────
    // API 调用
    // ────────────────────────────────────────────────────────────────────────
    function buildApiRequest(prompt) {
        const url   = (cfg.apiUrl || '').replace(/\/$/, '');
        const key   = cfg.apiKey;
        const model = cfg.model;
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
            ? { model, max_tokens: 2048, stream: true,
                messages: [{ role: 'user', content: prompt }] }
            : { model, stream: true,
                messages: [
                    { role: 'system', content: '你是一位专业的中文写作润色专家。' },
                    { role: 'user',   content: prompt }
                ]};

        return { endpoint, headers, body: JSON.stringify(body), isAnthropic };
    }

    async function streamApiCall(prompt, onChunk) {
        const { endpoint, headers, body, isAnthropic } = buildApiRequest(prompt);
        const response = await fetch(endpoint, { method: 'POST', headers, body });
        if (!response.ok) {
            const e = await response.json().catch(() => ({}));
            throw new Error(e.error?.message || 'HTTP ' + response.status);
        }

        const reader  = response.body.getReader();
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
                    if (text) onChunk(text);
                } catch (_) { /* 忽略不完整 JSON */ }
            }
        }
    }

    // ────────────────────────────────────────────────────────────────────────
    // 连接并拉取模型列表
    // ────────────────────────────────────────────────────────────────────────
    async function connectAndFetchModels() {
        const urlEl  = document.getElementById('tp-api-url');
        const keyEl  = document.getElementById('tp-api-key');
        const btn    = document.getElementById('tp-connect-btn');
        const modelCard = document.getElementById('tp-model-card');

        const url = (urlEl?.value || '').trim().replace(/\/$/, '');
        const key = (keyEl?.value || '').trim();

        if (!url) { showToast('请填写 API 地址', 'warning'); return; }
        if (!key) { showToast('请填写 API 密钥', 'warning'); return; }

        cfg.apiUrl = url;
        cfg.apiKey = key;
        saveSettings();

        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>'; }
        setApiStatus('connecting');
        if (modelCard) modelCard.style.display = 'none';

        const isAnthropic = url.includes('anthropic.com');

        try {
            let models = [];
            if (isAnthropic) {
                const res = await fetch(`${url}/v1/models`, {
                    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' }
                });
                if (!res.ok) { const e = await res.json().catch(()=>({})); throw new Error(e.error?.message || 'HTTP ' + res.status); }
                const data = await res.json();
                models = (data.data || []).map(m => ({ id: m.id, name: m.display_name || m.id }));
            } else {
                const cleanBase = url.replace(/\/chat\/completions$/, '');
                const ep = /\/v\d+$/.test(cleanBase) ? `${cleanBase}/models` : `${cleanBase}/v1/models`;
                const res = await fetch(ep, { headers: { 'Authorization': 'Bearer ' + key } });
                if (!res.ok) { const e = await res.json().catch(()=>({})); throw new Error(e.error?.message || 'HTTP ' + res.status); }
                const data = await res.json();
                const raw = data.data || data;
                models = (Array.isArray(raw) ? raw : []).map(m => ({
                    id: typeof m === 'string' ? m : m.id,
                    name: typeof m === 'string' ? m : (m.id || m.name || m)
                })).filter(m => m.id);
                models.sort((a,b) => {
                    const pri = id => (id.includes('gpt-4')||id.includes('claude')||id.includes('deepseek') ? 0 : id.includes('gpt-3') ? 1 : 2);
                    return pri(a.id) - pri(b.id);
                });
            }

            if (!models.length) throw new Error('未获取到任何模型');

            const sel = document.getElementById('tp-model-select');
            sel.innerHTML = '';
            models.forEach(m => {
                const opt = document.createElement('option');
                opt.value = m.id; opt.textContent = m.name;
                if (m.id === cfg.model) opt.selected = true;
                sel.appendChild(opt);
            });

            if (!cfg.model || !models.find(m => m.id === cfg.model)) {
                sel.value = models[0].id;
                cfg.model = models[0].id;
            } else {
                sel.value = cfg.model;
            }
            saveSettings();

            const hint = document.getElementById('tp-model-hint');
            if (hint) hint.textContent = `共 ${models.length} 个可用模型`;
            if (modelCard) modelCard.style.display = 'block';
            setApiStatus('ok');
            showToast(`连接成功，获取到 ${models.length} 个模型`, 'success');

        } catch (err) {
            setApiStatus('err');
            showToast('连接失败：' + err.message, 'error');
        }

        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-plug"></i> 连接'; }
    }

    // ────────────────────────────────────────────────────────────────────────
    // 主润色流程
    // ────────────────────────────────────────────────────────────────────────
    async function runPolish(prompt) {
        if (isStreaming) return;
        if (!cfg.apiKey)  { showToast('请先在 API 标签页连接 API', 'warning'); return; }
        if (!cfg.model)   { showToast('请先连接 API 并选择模型',   'warning'); return; }

        isStreaming = true;
        currentResult = '';
        compareOn = false;

        const runBtn      = document.getElementById('tp-run-btn');
        const loading     = document.getElementById('tp-loading');
        const resultSec   = document.getElementById('tp-result-section');
        const resultEl    = document.getElementById('tp-result-content');
        const diffOverlay = document.getElementById('tp-diff-overlay');

        if (runBtn) { runBtn.disabled = true; runBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 润色中…'; }
        if (diffOverlay) diffOverlay.style.display = 'none';
        resultSec.style.display = 'block';
        loading.style.display = 'flex';
        resultEl.textContent = '';
        resultEl.className = 'tp-result-content streaming';

        try {
            await streamApiCall(prompt, chunk => {
                currentResult += chunk;
                resultEl.textContent = currentResult;
            });
            resultEl.className = 'tp-result-content';
            setApiStatus('ok');
            showToast('润色完成！', 'success');
        } catch (err) {
            resultEl.className = 'tp-result-content';
            resultEl.style.color = '#e74c3c';
            resultEl.textContent = '❌ 错误：' + err.message;
            setApiStatus('err');
            showToast('润色失败：' + err.message, 'error');
        }

        loading.style.display = 'none';
        isStreaming = false;
        if (runBtn) { runBtn.disabled = false; runBtn.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i> 开始润色'; }
    }

    // ────────────────────────────────────────────────────────────────────────
    // Diff 相关
    // ────────────────────────────────────────────────────────────────────────
    function _esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

    function computeDiff(oldText, newText) {
        const tokenize = t => {
            const tokens = []; let cur = '';
            for (const ch of t) {
                cur += ch;
                if (/[，。！？；\n,.!?;：]/.test(ch)) { tokens.push(cur); cur = ''; }
            }
            if (cur) tokens.push(cur);
            return tokens;
        };
        const A = tokenize(oldText), B = tokenize(newText);
        const m = A.length, n = B.length;
        const dp = Array.from({length: m+1}, () => new Array(n+1).fill(0));
        for (let i=1;i<=m;i++) for (let j=1;j<=n;j++)
            dp[i][j] = A[i-1]===B[j-1] ? dp[i-1][j-1]+1 : Math.max(dp[i-1][j],dp[i][j-1]);

        let i=m, j=n; const res=[];
        while (i>0||j>0) {
            if (i>0&&j>0&&A[i-1]===B[j-1]) { res.unshift({type:'equal',value:A[i-1]}); i--;j--; }
            else if (j>0&&(i===0||dp[i][j-1]>=dp[i-1][j])) { res.unshift({type:'insert',value:B[j-1]}); j--; }
            else { res.unshift({type:'delete',value:A[i-1]}); i--; }
        }

        const blocks=[]; let cur=null;
        res.forEach(r => {
            if (r.type==='equal') { if(cur){blocks.push(cur);cur=null;} blocks.push({type:'equal',value:r.value}); }
            else {
                if(!cur) cur={type:'diff',oldText:'',newText:'',active:'new'};
                if(r.type==='delete') cur.oldText+=r.value;
                if(r.type==='insert') cur.newText+=r.value;
            }
        });
        if(cur) blocks.push(cur);
        return blocks;
    }

    function renderDiff(oldText, newText) {
        diffBlocks = computeDiff(oldText, newText);
        let html='';
        diffBlocks.forEach((b,idx) => {
            if(b.type==='equal') {
                html += `<span class="tp-idiff-equal" data-idx="${idx}">${_esc(b.value)}</span>`;
            } else {
                html += `<span class="tp-diff-group" data-index="${idx}">`;
                if(b.oldText) html += `<span class="tp-idiff-old ${b.active==='old'?'active':'inactive'}" data-idx="${idx}" title="点击保留原文">${_esc(b.oldText)}</span>`;
                if(b.newText) html += `<span class="tp-idiff-new ${b.active==='new'?'active':'inactive'}" data-idx="${idx}" title="点击保留新版">${_esc(b.newText)}</span>`;
                html += '</span>';
            }
        });
        const merge = document.getElementById('tp-diff-merge');
        if (merge) {
            merge.innerHTML = html;
            merge.className = 'tp-diff-merge-view';
        }
        document.querySelectorAll('.tp-diff-mode-btn').forEach(b => b.classList.remove('active'));
        const overlay = document.getElementById('tp-diff-overlay');
        if (overlay) overlay.style.display = 'flex';
    }

    function assembleDiff() {
        // 先从 DOM 同步编辑内容
        document.querySelectorAll('#tp-diff-merge .tp-idiff-equal').forEach(el => {
            const idx = parseInt(el.dataset.idx);
            if (!isNaN(idx) && diffBlocks[idx]) diffBlocks[idx].value = el.textContent;
        });
        document.querySelectorAll('#tp-diff-merge .tp-idiff-old.active').forEach(el => {
            const idx = parseInt(el.dataset.idx);
            if (!isNaN(idx) && diffBlocks[idx]) diffBlocks[idx].oldText = el.textContent;
        });
        document.querySelectorAll('#tp-diff-merge .tp-idiff-new.active').forEach(el => {
            const idx = parseInt(el.dataset.idx);
            if (!isNaN(idx) && diffBlocks[idx]) diffBlocks[idx].newText = el.textContent;
        });

        return diffBlocks.map(b => {
            if (b.type==='equal') return b.value;
            return b.active==='old' ? b.oldText : b.newText;
        }).join('');
    }

    // ────────────────────────────────────────────────────────────────────────
    // 导入最新 AI 消息
    // ────────────────────────────────────────────────────────────────────────
    function importLastMessage() {
        try {
            const ctx = SillyTavern.getContext();
            const chat = ctx.chat;
            if (!chat?.length) { showToast('当前没有聊天消息', 'warning'); return; }
            for (let i=chat.length-1; i>=0; i--) {
                if (!chat[i].is_user && chat[i].mes) {
                    const tmp = document.createElement('div');
                    tmp.innerHTML = chat[i].mes;
                    const input = document.getElementById('tp-input');
                    if (input) { input.value = tmp.textContent || chat[i].mes; updateCharCount(); }
                    showToast('已导入最新 AI 消息', 'success');
                    return;
                }
            }
            showToast('没有找到 AI 消息', 'warning');
        } catch (e) { showToast('导入失败：' + e.message, 'error'); }
    }

    // ────────────────────────────────────────────────────────────────────────
    // 恢复 UI 状态
    // ────────────────────────────────────────────────────────────────────────
    function restoreUI() {
        const s = id => document.getElementById(id);
        if (s('tp-api-url')) s('tp-api-url').value = cfg.apiUrl || '';
        if (s('tp-api-key')) s('tp-api-key').value = cfg.apiKey || '';
        if (s('tp-intensity')) s('tp-intensity').value = cfg.intensity || 3;
        if (s('tp-intensity-label')) s('tp-intensity-label').textContent = INTENSITY_LABEL[cfg.intensity] || '均衡';
        document.querySelectorAll('.tp-chip').forEach(c => c.classList.toggle('active', c.dataset.style === cfg.style));
        const customBox = s('tp-custom-style-box');
        if (customBox) customBox.style.display = cfg.style === 'custom' ? 'block' : 'none';
        if (s('tp-custom-style')) s('tp-custom-style').value = cfg.customStyle || '';

        if (cfg.apiKey && cfg.apiUrl) {
            // 有历史连接，自动重连拉取模型
            connectAndFetchModels();
        } else {
            setApiStatus('idle');
        }
    }

    // ────────────────────────────────────────────────────────────────────────
    // 弹窗绑定事件
    // ────────────────────────────────────────────────────────────────────────
    function bindPopupEvents() {
        const on  = (id, ev, fn) => { const el=document.getElementById(id); if(el) el.addEventListener(ev,fn); };
        const onQ = (sel, ev, fn) => document.querySelectorAll(sel).forEach(el => el.addEventListener(ev, fn));

        // Tab 切换
        onQ('.tp-tab', 'click', function() {
            document.querySelectorAll('.tp-tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.tp-view').forEach(v => v.classList.remove('active'));
            this.classList.add('active');
            const view = document.getElementById('tp-view-' + this.dataset.tab);
            if (view) view.classList.add('active');
        });

        // 风格芯片
        onQ('.tp-chip', 'click', function() {
            document.querySelectorAll('.tp-chip').forEach(c => c.classList.remove('active'));
            this.classList.add('active');
            cfg.style = this.dataset.style;
            const box = document.getElementById('tp-custom-style-box');
            if (box) box.style.display = cfg.style === 'custom' ? 'block' : 'none';
            saveSettings();
        });

        on('tp-custom-style',  'input',  function() { cfg.customStyle = this.value; saveSettings(); });

        // 强度滑块
        on('tp-intensity', 'input', function() {
            cfg.intensity = parseInt(this.value);
            const lbl = document.getElementById('tp-intensity-label');
            if (lbl) lbl.textContent = INTENSITY_LABEL[cfg.intensity] || '均衡';
            saveSettings();
        });

        // 预设标签
        onQ('.tp-preset-tag', 'click', function() {
            const p = this.dataset.preset;
            if (selPresets.has(p)) { selPresets.delete(p); this.classList.remove('active'); }
            else                   { selPresets.add(p);    this.classList.add('active'); }
        });

        // 输入框字数
        on('tp-input', 'input', updateCharCount);

        // 连接按钮
        on('tp-connect-btn', 'click', connectAndFetchModels);

        // API 输入保存
        on('tp-api-url', 'change', function() { cfg.apiUrl = this.value.trim(); saveSettings(); });
        on('tp-api-key', 'change', function() { cfg.apiKey = this.value.trim(); saveSettings(); });

        // 模型选择
        on('tp-model-select', 'change', function() { cfg.model = this.value; saveSettings(); });

        // 导入消息
        on('tp-import-btn', 'click', importLastMessage);

        // 清空输入
        on('tp-clear-input-btn', 'click', () => {
            const el = document.getElementById('tp-input');
            if (el) el.value = '';
            updateCharCount();
            const rs = document.getElementById('tp-result-section');
            if (rs) rs.style.display = 'none';
            currentResult = '';
        });

        // 开始润色
        on('tp-run-btn', 'click', () => {
            const inputEl = document.getElementById('tp-input');
            const text = inputEl?.value?.trim();
            if (!text) { showToast('请输入要润色的文字', 'warning'); return; }
            inputSnapshot = text;
            runPolish(buildPolishPrompt(text));
        });

        // 再次润色（把结果放回输入框）
        on('tp-reuse-btn', 'click', () => {
            if (!currentResult) return;
            const el = document.getElementById('tp-input');
            if (el) { el.value = currentResult; updateCharCount(); }
            const rs = document.getElementById('tp-result-section');
            if (rs) rs.style.display = 'none';
            currentResult = '';
            inputSnapshot = el.value;
        });

        // 复制结果
        on('tp-copy-btn', 'click', () => {
            if (!currentResult) return;
            navigator.clipboard.writeText(currentResult)
                .then(() => showToast('已复制到剪贴板', 'success'));
        });

        // 发送到输入框
        on('tp-send-btn', 'click', () => {
            if (!currentResult) return;
            const stInput = document.getElementById('send_textarea');
            if (stInput) {
                stInput.value = currentResult;
                stInput.dispatchEvent(new Event('input', { bubbles: true }));
                showToast('已发送到输入框', 'success');
            } else { showToast('找不到 ST 输入框', 'warning'); }
        });

        // 对比视图按钮
        on('tp-compare-btn', 'click', () => {
            if (!currentResult || !inputSnapshot) { showToast('暂无可对比的内容', 'warning'); return; }
            renderDiff(inputSnapshot, currentResult);
            document.getElementById('tp-compare-btn').textContent = '退出对比';
        });

        // 润色意见
        on('tp-refine-btn', 'click', async () => {
            if (isStreaming) return;
            const refineEl = document.getElementById('tp-refine-input');
            const instruction = refineEl?.value?.trim();
            if (!instruction) { showToast('请输入修改意见', 'warning'); return; }
            if (!currentResult) { showToast('没有可润色的结果', 'warning'); return; }
            lastRefineReq = instruction;
            const oldText = currentResult;
            await runPolish(buildRefinePrompt(oldText, instruction));
            if (currentResult && currentResult !== oldText) {
                renderDiff(oldText, currentResult);
            }
            if (refineEl) refineEl.value = '';
        });

        // Diff 模式按钮
        onQ('.tp-diff-mode-btn', 'click', function() {
            const merge = document.getElementById('tp-diff-merge');
            if (!merge) return;
            if (this.classList.contains('active')) {
                this.classList.remove('active');
                merge.className = 'tp-diff-merge-view';
                return;
            }
            document.querySelectorAll('.tp-diff-mode-btn').forEach(b => b.classList.remove('active'));
            this.classList.add('active');
            merge.className = 'tp-diff-merge-view tp-diff-mode-' + this.dataset.mode;
        });

        // Diff 片段点击切换
        document.getElementById('tp-diff-merge')?.addEventListener('click', function(e) {
            const el = e.target;
            if (!this.classList.contains('tp-diff-merge-view') || this.className.includes('tp-diff-mode-')) return;
            const idx = parseInt(el.dataset.idx);
            if (isNaN(idx) || !diffBlocks[idx]) return;
            if (el.classList.contains('tp-idiff-old') && !el.classList.contains('active')) {
                diffBlocks[idx].active = 'old';
                el.classList.add('active'); el.classList.remove('inactive');
                el.nextElementSibling?.classList.add('inactive'); el.nextElementSibling?.classList.remove('active');
            } else if (el.classList.contains('tp-idiff-new') && !el.classList.contains('active')) {
                diffBlocks[idx].active = 'new';
                el.classList.add('active'); el.classList.remove('inactive');
                el.previousElementSibling?.classList.add('inactive'); el.previousElementSibling?.classList.remove('active');
            }
        });

        // Diff 放弃
        on('tp-diff-cancel', 'click', () => {
            const overlay = document.getElementById('tp-diff-overlay');
            if (overlay) overlay.style.display = 'none';
            const compareBtn = document.getElementById('tp-compare-btn');
            if (compareBtn) compareBtn.textContent = '对比视图';
        });

        // Diff 应用
        on('tp-diff-confirm', 'click', () => {
            const final = assembleDiff();
            currentResult = final;
            const resultEl = document.getElementById('tp-result-content');
            if (resultEl) { resultEl.textContent = final; resultEl.style.color = ''; }
            const overlay = document.getElementById('tp-diff-overlay');
            if (overlay) overlay.style.display = 'none';
            const compareBtn = document.getElementById('tp-compare-btn');
            if (compareBtn) compareBtn.textContent = '对比视图';
            showToast('修改已应用', 'success');
        });

        // Diff 重新生成
        on('tp-diff-reroll', 'click', async () => {
            if (isStreaming || !lastRefineReq || !inputSnapshot) return;
            const oldText = inputSnapshot;
            await runPolish(buildRefinePrompt(oldText, lastRefineReq));
            if (currentResult) renderDiff(oldText, currentResult);
        });
    }

    // ────────────────────────────────────────────────────────────────────────
    // 打开弹窗
    // ────────────────────────────────────────────────────────────────────────
    async function openPopup() {
        loadSettings();
        const html = buildPopupHtml();

        // callPopup 是 ST 内置函数，wide+large 为标准参数
        if (typeof callPopup === 'function') {
            callPopup(html, 'text', '', { wide: true, large: true, okButton: 'Close' });
        } else {
            // 降级：直接插入 DOM
            const overlay = document.createElement('div');
            overlay.id = 'tp-fallback-overlay';
            overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;';
            const box = document.createElement('div');
            box.style.cssText = 'width:90%;max-width:700px;max-height:90vh;background:var(--SmartThemeBodyColor2,#1e1e2e);border-radius:12px;overflow:hidden;display:flex;flex-direction:column;';
            box.innerHTML = html;
            const closeBtn = document.createElement('button');
            closeBtn.textContent = '关闭';
            closeBtn.style.cssText = 'margin:8px 16px;padding:7px;border-radius:6px;border:1px solid;cursor:pointer;background:transparent;color:inherit;';
            closeBtn.onclick = () => overlay.remove();
            box.appendChild(closeBtn);
            overlay.appendChild(box);
            overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
            document.body.appendChild(overlay);
        }

        // 等 DOM 渲染完毕
        await new Promise(r => setTimeout(r, 80));

        restoreUI();
        bindPopupEvents();
        updateCharCount();
    }

    // ────────────────────────────────────────────────────────────────────────
    // 魔棒按钮（挂到 ST 输入区上方）
    // ────────────────────────────────────────────────────────────────────────
    function addWandButton() {
        if (document.getElementById(WAND_BTN_ID)) return;

        const btn = document.createElement('div');
        btn.id = WAND_BTN_ID;
        btn.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i> 文字润色';
        btn.title = '打开文字润色工坊';
        btn.addEventListener('click', openPopup);

        // 挂载到 send_form 上方（ST 标准输入区容器）
        const targets = [
            '#send_form',
            '#chat_input_area',
            '.mes_text:last-child',
            '#rightSendForm',
        ];
        let mounted = false;
        for (const sel of targets) {
            const container = document.querySelector(sel);
            if (container) {
                container.parentNode.insertBefore(btn, container);
                mounted = true;
                break;
            }
        }
        if (!mounted) document.body.appendChild(btn);
    }

    // ────────────────────────────────────────────────────────────────────────
    // 全局事件绑定（只执行一次）
    // ────────────────────────────────────────────────────────────────────────
    function bindGlobalEvents() {
        if (evBound) return;
        evBound = true;

        // 监听 ST 面板重置事件，确保按钮不丢失
        if (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) {
            try {
                const ctx = SillyTavern.getContext();
                if (ctx?.eventSource && ctx?.eventTypes) {
                    ctx.eventSource.on(ctx.eventTypes.APP_READY,           addWandButton);
                    ctx.eventSource.on(ctx.eventTypes.MOVABLE_PANELS_RESET, addWandButton);
                }
            } catch (_) {}
        }
    }

    // ────────────────────────────────────────────────────────────────────────
    // 入口
    // ────────────────────────────────────────────────────────────────────────
    function init() {
        loadSettings();
        addWandButton();
        bindGlobalEvents();
        console.log('[文字润色工坊] v2.0 加载完成 ✓');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => setTimeout(init, 600));
    } else {
        setTimeout(init, 600);
    }

})();
