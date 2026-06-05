/**
 * 文字润色工坊 v2.2 — SillyTavern Extension
 * 
 * v2.2 变更：
 * - 新增 API 类型选择器（OpenAI 兼容 / Anthropic 原生），适配中转 API
 * - 新增手动输入模型名功能，解决中转 API 无 /v1/models 端点问题
 * - 新增常用模型快速选择
 * - 新增 max_tokens 和 temperature 控制
 * - OpenAI 兼容请求默认携带 max_tokens
 * - 改进 URL 自动清理与端点拼接逻辑
 * - 改进模型获取失败时的降级处理
 * - 修复之前版本所有已知问题
 */
(function () {
    'use strict';

    const EXT_NAME    = 'st-text-polish';
    const WAND_BTN_ID = 'tp-wand-btn';

    // ── 强度配置 ──────────────────────────────────────────────────────────
    const INTENSITY = {
        1: { label: '极轻微', desc: '尽量保留原文，只做微小词句优化' },
        2: { label: '轻度',   desc: '轻度改写，保留原意和结构，优化表达' },
        3: { label: '均衡',   desc: '适度改写，保留核心内容，提升文学性' },
        4: { label: '深度',   desc: '深度重写，大幅提升表达质量，可改变句式' },
        5: { label: '大幅重写', desc: '完全重塑，以原文意思为基础彻底重写成高质量文本' },
    };

    // ── 风格 Prompt ──────────────────────────────────────────────────────
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

    // ── 常用模型预设 ─────────────────────────────────────────────────────
    const POPULAR_MODELS = [
        { group: 'Claude', models: ['claude-sonnet-4-20250514', 'claude-3-7-sonnet-20250219', 'claude-3-5-sonnet-20241022', 'claude-3-5-haiku-20241022'] },
        { group: 'GPT',    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'gpt-4.1-mini', 'o4-mini'] },
        { group: 'Gemini', models: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash'] },
        { group: 'DeepSeek', models: ['deepseek-chat', 'deepseek-reasoner'] },
        { group: 'Qwen',   models: ['qwen-plus', 'qwen-max', 'qwen3-235b-a22b'] },
    ];

    // ── 默认设置 ─────────────────────────────────────────────────────────
    const DEFAULT_SETTINGS = {
        apiUrl:      '',
        apiKey:      '',
        apiType:     'openai',   // 'openai'（中转/OpenAI 兼容）或 'anthropic'（原生）
        model:       '',
        style:       'literary',
        customStyle: '',
        intensity:   3,
        extraNote:   '',
        maxTokens:   4096,
        temperature: 0.7,
    };

    // ── 运行时状态 ───────────────────────────────────────────────────────
    let cfg             = Object.assign({}, DEFAULT_SETTINGS);
    let selPresets       = new Set();
    let currentResult    = '';
    let inputSnapshot    = '';
    let isStreaming       = false;
    let diffBlocks       = [];
    let lastRefineReq    = '';
    let evBound          = false;
    let modelsFetched    = false;
    let abortController  = null;

    // ── 安全转义 ─────────────────────────────────────────────────────────
    function _esc(s) {
        const d = document.createElement('div');
        d.textContent = String(s);
        return d.innerHTML;
    }

    // ────────────────────────────────────────────────────────────────────────
    // POPUP HTML
    // ────────────────────────────────────────────────────────────────────────
    function buildPopupHtml() {
        // 构建常用模型选项
        let modelOptionsHtml = '<option value="">── 手动输入或从列表选择 ──</option>';
        POPULAR_MODELS.forEach(g => {
            modelOptionsHtml += `<optgroup label="${g.group}">`;
            g.models.forEach(m => {
                modelOptionsHtml += `<option value="${m}">${m}</option>`;
            });
            modelOptionsHtml += '</optgroup>';
        });

        return `
<div class="tp-wrapper">
    <div class="tp-tabs">
        <div class="tp-tab active" data-tab="polish">✦ 润色</div>
        <div class="tp-tab" data-tab="api">⚙ API</div>
    </div>

    <div class="tp-relative" style="flex:1;display:flex;flex-direction:column;overflow:hidden;">

        <!-- ══ 润色 Tab ══ -->
        <div id="tp-view-polish" class="tp-view active">
            <div class="tp-scroll">

                <!-- 风格 + 强度 -->
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
                                <button id="tp-stop-btn" class="tp-btn tp-btn-danger" style="display:none;padding:5px 10px;font-size:0.8rem;">
                                    <i class="fa-solid fa-stop"></i> 停止
                                </button>
                                <button id="tp-compare-btn" class="tp-btn tp-btn-ghost" style="padding:5px 10px;font-size:0.8rem;">对比视图</button>
                                <button id="tp-copy-btn" class="tp-btn tp-btn-ghost" style="padding:5px 10px;font-size:0.8rem;"><i class="fa-solid fa-copy"></i> 复制</button>
                                <button id="tp-send-btn" class="tp-btn tp-btn-ghost" style="padding:5px 10px;font-size:0.8rem;"><i class="fa-solid fa-arrow-up-from-bracket"></i> 发送到输入框</button>
                            </div>
                        </div>

                        <div id="tp-loading" class="tp-loading" style="display:none;">
                            <span></span><span></span><span></span>
                            <em>AI 润色中…</em>
                        </div>

                        <div id="tp-result-content" class="tp-result-content"></div>

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

                <!-- API 连接 -->
                <div class="tp-card">
                    <div class="tp-card-title">API 连接</div>

                    <div class="tp-row">
                        <label class="tp-label">API 类型</label>
                        <select id="tp-api-type" class="tp-select">
                            <option value="openai">OpenAI 兼容（中转 API 选此项）</option>
                            <option value="anthropic">Anthropic 原生</option>
                        </select>
                    </div>

                    <div class="tp-row">
                        <label class="tp-label">API 地址</label>
                        <input id="tp-api-url" type="text" class="tp-input"
                               placeholder="例如：https://api.example.com" />
                    </div>
                    <div id="tp-url-hint" class="tp-hint" style="margin:-4px 0 6px 68px;">
                        中转 API 填写服务商提供的地址，无需加 /v1 后缀
                    </div>

                    <div class="tp-row">
                        <label class="tp-label">API 密钥</label>
                        <input id="tp-api-key" type="password" class="tp-input"
                               placeholder="sk-…" autocomplete="off" />
                    </div>

                    <div class="tp-row" style="justify-content:flex-end;gap:8px;">
                        <button id="tp-connect-btn" class="tp-btn tp-btn-primary" style="flex-shrink:0;">
                            <i class="fa-solid fa-plug"></i> 连接并获取模型
                        </button>
                    </div>

                    <div id="tp-api-status" class="tp-api-status idle">● 未连接</div>
                </div>

                <!-- 模型选择 -->
                <div class="tp-card">
                    <div class="tp-card-title">模型设置</div>

                    <div id="tp-model-card-fetched" style="display:none;">
                        <div class="tp-row">
                            <label class="tp-label">在线模型</label>
                            <select id="tp-model-select" class="tp-select"></select>
                        </div>
                        <div id="tp-model-hint" style="font-size:0.76rem;opacity:0.5;margin-top:4px;"></div>
                        <div class="tp-divider"></div>
                    </div>

                    <div class="tp-row">
                        <label class="tp-label">当前模型</label>
                        <input id="tp-model-manual" type="text" class="tp-input"
                               placeholder="输入模型名称，如 claude-sonnet-4-20250514" />
                    </div>

                    <div style="margin-top:8px;">
                        <div style="font-size:0.76rem;opacity:0.5;margin-bottom:6px;">
                            <i class="fa-solid fa-bolt"></i> 常用模型快速填入：
                        </div>
                        <div class="tp-preset-row" id="tp-model-presets">
                            ${POPULAR_MODELS.map(g => 
                                g.models.slice(0, 2).map(m => 
                                    `<div class="tp-preset-tag tp-model-quick" data-model="${m}">${m}</div>`
                                ).join('')
                            ).join('')}
                        </div>
                    </div>
                </div>

                <!-- 生成参数 -->
                <div class="tp-card">
                    <div class="tp-card-title">生成参数</div>

                    <div class="tp-row">
                        <label class="tp-label">最大输出</label>
                        <input id="tp-max-tokens" type="number" class="tp-input" 
                               min="256" max="32768" step="256" placeholder="4096" style="max-width:120px;" />
                        <span class="tp-hint">tokens</span>
                    </div>

                    <div class="tp-row" style="margin-top:4px;">
                        <label class="tp-label">温度</label>
                        <input id="tp-temperature" type="range" min="0" max="1.5" value="0.7" step="0.1"
                               style="flex:1;accent-color:var(--SmartThemeQuoteColor);" />
                        <span id="tp-temp-label" class="tp-intensity-val" style="min-width:36px;">0.7</span>
                    </div>
                    <div class="tp-hint" style="margin-top:2px;">
                        低温度更稳定一致，高温度更富创意变化
                    </div>
                </div>

            </div>
        </div><!-- end tp-view-api -->

        <!-- ══ Diff 对比视图 ══ -->
        <div id="tp-diff-overlay" class="tp-diff-overlay" style="display:none;">
            <div class="tp-diff-toolbar">
                <span class="tp-diff-hint" id="tp-diff-hint">
                    <i class="fa-solid fa-circle-info"></i> 点击高亮文字切换保留版本
                </span>
                <button class="tp-diff-mode-btn" data-mode="old"><i class="fa-solid fa-file-lines"></i> 原文</button>
                <button class="tp-diff-mode-btn" data-mode="new"><i class="fa-solid fa-file-circle-plus"></i> 新版</button>
                <button class="tp-diff-mode-btn" data-mode="final"><i class="fa-solid fa-eye"></i> 最终</button>
            </div>
            <div class="tp-diff-content">
                <div id="tp-diff-merge" class="tp-diff-merge-view" contenteditable="false"></div>
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
    // 设置持久化
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
        // 兼容旧版设置：自动迁移
        if (!cfg.apiType) {
            cfg.apiType = (cfg.apiUrl || '').includes('anthropic.com') ? 'anthropic' : 'openai';
        }
        if (!cfg.maxTokens) cfg.maxTokens = 4096;
        if (cfg.temperature === undefined || cfg.temperature === null) cfg.temperature = 0.7;
    }

    // ────────────────────────────────────────────────────────────────────────
    // UI 工具
    // ────────────────────────────────────────────────────────────────────────
    function setApiStatus(state, customMsg) {
        const el = document.getElementById('tp-api-status');
        if (!el) return;
        const map = {
            ok:          '● 已连接',
            err:         '● 连接失败',
            idle:        '● 未连接',
            connecting:  '● 连接中…',
            manual:      '● 手动模式（未验证连接）',
        };
        el.className = 'tp-api-status ' + state;
        el.textContent = customMsg || map[state] || '● 未连接';
    }

    function updateCharCount() {
        const el  = document.getElementById('tp-input');
        const cnt = document.getElementById('tp-char-count');
        if (el && cnt) cnt.textContent = (el.value?.length || 0) + ' 字';
    }

    function showToast(msg, type = 'info') {
        if (typeof toastr === 'undefined') return;
        toastr[type === 'success' ? 'success' : type === 'error' ? 'error' : type === 'warning' ? 'warning' : 'info'](msg);
    }

    function setResultBtnsDisabled(disabled) {
        ['tp-compare-btn', 'tp-copy-btn', 'tp-send-btn', 'tp-refine-btn', 'tp-reuse-btn'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.disabled = disabled;
        });
        const stopBtn = document.getElementById('tp-stop-btn');
        if (stopBtn) stopBtn.style.display = disabled ? 'inline-flex' : 'none';
    }

    // ────────────────────────────────────────────────────────────────────────
    // URL 清理工具
    // ────────────────────────────────────────────────────────────────────────
    function cleanApiUrl(url) {
        return (url || '')
            .trim()
            .replace(/\/+$/, '')                         // 去除末尾斜杠
            .replace(/\/v\d+\/?(chat\/completions)?$/, '') // 去除 /v1/chat/completions
            .replace(/\/v\d+\/?$/, '');                   // 去除 /v1
    }

    // ────────────────────────────────────────────────────────────────────────
    // Prompt 构建
    // ────────────────────────────────────────────────────────────────────────
    function buildPolishPrompt(inputText) {
        const styleDesc = cfg.style === 'custom'
            ? (cfg.customStyle || '优美流畅的文学风格')
            : (STYLE_PROMPTS[cfg.style] || STYLE_PROMPTS.literary);
        const intensityInfo = INTENSITY[cfg.intensity] || INTENSITY[3];
        const presetsStr   = selPresets.size > 0 ? '\n额外要求：' + [...selPresets].join('、') : '';
        const noteStr      = cfg.extraNote ? '\n特别说明：' + cfg.extraNote : '';

        return `你是一位专业的中文写作润色专家，擅长文学创作和语言美化。

请按照以下要求对文本进行润色：

【目标风格】${styleDesc}

【润色强度】${intensityInfo.desc}${presetsStr}${noteStr}

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
    // API 调用（根据 cfg.apiType 切换格式）
    // ────────────────────────────────────────────────────────────────────────
    function buildApiRequest(prompt) {
        const baseUrl     = cleanApiUrl(cfg.apiUrl);
        const key         = cfg.apiKey;
        const model       = cfg.model;
        const isAnthropic = cfg.apiType === 'anthropic';
        const maxTokens   = cfg.maxTokens || 4096;
        const temperature = cfg.temperature ?? 0.7;

        let endpoint, headers, body;

        if (isAnthropic) {
            // Anthropic 原生格式
            endpoint = `${baseUrl}/v1/messages`;
            headers = {
                'Content-Type': 'application/json',
                'x-api-key': key,
                'anthropic-version': '2023-06-01',
            };
            body = {
                model,
                max_tokens: maxTokens,
                temperature,
                stream: true,
                messages: [{ role: 'user', content: prompt }],
            };
        } else {
            // OpenAI 兼容格式（中转 API 使用此格式）
            endpoint = `${baseUrl}/v1/chat/completions`;
            headers = {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + key,
            };
            body = {
                model,
                max_tokens: maxTokens,
                temperature,
                stream: true,
                messages: [
                    { role: 'system', content: '你是一位专业的中文写作润色专家。' },
                    { role: 'user',   content: prompt },
                ],
            };
        }

        return { endpoint, headers, body: JSON.stringify(body), isAnthropic };
    }

    async function streamApiCall(prompt, onChunk) {
        abortController?.abort();
        abortController = new AbortController();

        const { endpoint, headers, body, isAnthropic } = buildApiRequest(prompt);

        const response = await fetch(endpoint, {
            method: 'POST', headers, body,
            signal: abortController.signal,
        });

        if (!response.ok) {
            let errMsg = 'HTTP ' + response.status;
            try {
                const e = await response.json();
                errMsg = e.error?.message || e.message || e.detail || errMsg;
            } catch (_) {}
            throw new Error(errMsg);
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
                        if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
                            text = parsed.delta.text;
                        }
                    } else {
                        text = parsed.choices?.[0]?.delta?.content || null;
                    }
                    if (text) onChunk(text);
                } catch (_) { /* 忽略不完整 JSON */ }
            }
        }
    }

    // ────────────────────────────────────────────────────────────────────────
    // 连接并拉取模型
    // ────────────────────────────────────────────────────────────────────────
    async function connectAndFetchModels(force = false) {
        const urlEl     = document.getElementById('tp-api-url');
        const keyEl     = document.getElementById('tp-api-key');
        const typeEl    = document.getElementById('tp-api-type');
        const btn       = document.getElementById('tp-connect-btn');
        const fetchedCard = document.getElementById('tp-model-card-fetched');

        const url  = cleanApiUrl(urlEl?.value || cfg.apiUrl || '');
        const key  = (keyEl?.value || cfg.apiKey || '').trim();
        const type = typeEl?.value || cfg.apiType || 'openai';

        if (!url)  { showToast('请填写 API 地址', 'warning'); return; }
        if (!key)  { showToast('请填写 API 密钥', 'warning'); return; }

        if (!force && modelsFetched && url === cfg.apiUrl && key === cfg.apiKey && type === cfg.apiType) {
            if (fetchedCard) fetchedCard.style.display = 'block';
            setApiStatus('ok');
            return;
        }

        cfg.apiUrl  = url;
        cfg.apiKey  = key;
        cfg.apiType = type;
        saveSettings();

        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 连接中…'; }
        setApiStatus('connecting');
        if (fetchedCard) fetchedCard.style.display = 'none';

        const isAnthropic = type === 'anthropic';

        try {
            let models = [];

            if (isAnthropic) {
                const res = await fetch(`${url}/v1/models`, {
                    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
                });
                if (!res.ok) throw new Error(await getErrorMsg(res));
                const data = await res.json();
                models = (data.data || []).map(m => ({ id: m.id, name: m.display_name || m.id }));
            } else {
                // OpenAI 兼容（中转）：尝试获取模型列表
                const ep = `${url}/v1/models`;
                const res = await fetch(ep, {
                    headers: { 'Authorization': 'Bearer ' + key },
                });
                if (!res.ok) throw new Error(await getErrorMsg(res));
                const data = await res.json();
                const raw  = data.data || data;
                models = (Array.isArray(raw) ? raw : []).map(m => ({
                    id:   typeof m === 'string' ? m : m.id,
                    name: typeof m === 'string' ? m : (m.id || m.name || m),
                })).filter(m => m.id);

                // 排序：常用模型优先
                models.sort((a, b) => {
                    const pri = id => {
                        if (id.includes('claude'))   return 0;
                        if (id.includes('gpt-4'))    return 1;
                        if (id.includes('deepseek')) return 2;
                        if (id.includes('qwen'))     return 3;
                        if (id.includes('gemini'))   return 4;
                        return 5;
                    };
                    return pri(a.id) - pri(b.id);
                });
            }

            if (models.length > 0) {
                const sel = document.getElementById('tp-model-select');
                if (sel) {
                    sel.innerHTML = '';
                    models.forEach(m => {
                        const opt = document.createElement('option');
                        opt.value = m.id;
                        opt.textContent = m.name;
                        if (m.id === cfg.model) opt.selected = true;
                        sel.appendChild(opt);
                    });
                    if (!cfg.model || !models.find(m => m.id === cfg.model)) {
                        sel.value = models[0].id;
                        cfg.model = models[0].id;
                    } else {
                        sel.value = cfg.model;
                    }
                    // 同步到手动输入框
                    const manualEl = document.getElementById('tp-model-manual');
                    if (manualEl) manualEl.value = cfg.model;
                }

                const hint = document.getElementById('tp-model-hint');
                if (hint) hint.textContent = `共 ${models.length} 个可用模型`;
                if (fetchedCard) fetchedCard.style.display = 'block';
                setApiStatus('ok');
                modelsFetched = true;
                showToast(`连接成功，获取到 ${models.length} 个模型`, 'success');
            } else {
                throw new Error('未获取到任何模型');
            }

            saveSettings();

        } catch (err) {
            // 模型获取失败时降级为手动模式
            modelsFetched = false;
            if (fetchedCard) fetchedCard.style.display = 'none';

            // 判断是否是认证失败（真正的错误）还是仅仅不支持 /v1/models
            const isAuthError = /401|403|unauthorized|forbidden/i.test(err.message);

            if (isAuthError) {
                setApiStatus('err', '● 认证失败，请检查 API 密钥');
                showToast('认证失败：' + err.message, 'error');
            } else {
                // 可能是中转 API 不支持 /v1/models，降级为手动输入
                setApiStatus('manual', '● 无法获取模型列表，请手动输入模型名');
                showToast('无法获取模型列表（中转 API 常见），请在下方手动输入模型名称', 'warning');
                // 保存设置，虽然没有获取到模型列表，但 API 地址和密钥已保存
                saveSettings();
            }
        }

        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-plug"></i> 连接并获取模型'; }
    }

    // 辅助：提取错误信息
    async function getErrorMsg(res) {
        try {
            const e = await res.json();
            return e.error?.message || e.message || e.detail || 'HTTP ' + res.status;
        } catch (_) {
            return 'HTTP ' + res.status;
        }
    }

    // ────────────────────────────────────────────────────────────────────────
    // 主润色流程
    // ────────────────────────────────────────────────────────────────────────
    async function runPolish(prompt) {
        if (isStreaming) return;
        if (!cfg.apiKey) { showToast('请先在 API 标签页填写 API 密钥', 'warning'); return; }
        if (!cfg.apiUrl) { showToast('请先在 API 标签页填写 API 地址', 'warning'); return; }
        if (!cfg.model)  { showToast('请先设置模型名称（API 标签页）', 'warning'); return; }

        isStreaming   = true;
        currentResult = '';

        const runBtn    = document.getElementById('tp-run-btn');
        const loading   = document.getElementById('tp-loading');
        const resultSec = document.getElementById('tp-result-section');
        const resultEl  = document.getElementById('tp-result-content');
        const diffOv    = document.getElementById('tp-diff-overlay');

        if (runBtn)  { runBtn.disabled = true; runBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 润色中…'; }
        if (diffOv)  diffOv.style.display = 'none';
        resultSec.style.display = 'block';
        loading.style.display   = 'flex';

        resultEl.textContent  = '';
        resultEl.style.color  = '';
        resultEl.className    = 'tp-result-content streaming';
        setResultBtnsDisabled(true);

        try {
            await streamApiCall(prompt, chunk => {
                currentResult += chunk;
                resultEl.textContent = currentResult;
            });
            resultEl.className = 'tp-result-content';
            setApiStatus('ok');
            showToast('润色完成！', 'success');
        } catch (err) {
            if (err.name === 'AbortError') {
                resultEl.className = 'tp-result-content';
                showToast('已停止生成', 'info');
            } else {
                resultEl.className   = 'tp-result-content';
                resultEl.style.color = '#e74c3c';
                resultEl.textContent = '❌ 错误：' + err.message;
                setApiStatus('err');
                showToast('润色失败：' + err.message, 'error');
            }
        }

        loading.style.display = 'none';
        isStreaming = false;
        setResultBtnsDisabled(false);
        if (runBtn) { runBtn.disabled = false; runBtn.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i> 开始润色'; }
    }

    // ────────────────────────────────────────────────────────────────────────
    // Diff 算法
    // ────────────────────────────────────────────────────────────────────────
    const DIFF_TOKEN_LIMIT = 400;

    function tokenize(t) {
        const tokens = []; let cur = '';
        for (const ch of t) {
            cur += ch;
            if (/[，。！？；\n,.!?;：]/.test(ch)) { tokens.push(cur); cur = ''; }
        }
        if (cur) tokens.push(cur);
        return tokens;
    }

    function computeDiff(oldText, newText) {
        const A = tokenize(oldText), B = tokenize(newText);

        if (A.length > DIFF_TOKEN_LIMIT || B.length > DIFF_TOKEN_LIMIT) {
            return [{ type: 'diff', oldText, newText, active: 'new' }];
        }

        const m = A.length, n = B.length;
        const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
        for (let i = 1; i <= m; i++)
            for (let j = 1; j <= n; j++)
                dp[i][j] = A[i-1] === B[j-1] ? dp[i-1][j-1] + 1 : Math.max(dp[i-1][j], dp[i][j-1]);

        let i = m, j = n; const res = [];
        while (i > 0 || j > 0) {
            if (i > 0 && j > 0 && A[i-1] === B[j-1]) { res.unshift({ type: 'equal', value: A[i-1] }); i--; j--; }
            else if (j > 0 && (i === 0 || dp[i][j-1] >= dp[i-1][j])) { res.unshift({ type: 'insert', value: B[j-1] }); j--; }
            else { res.unshift({ type: 'delete', value: A[i-1] }); i--; }
        }

        const blocks = []; let cur = null;
        res.forEach(r => {
            if (r.type === 'equal') {
                if (cur) { blocks.push(cur); cur = null; }
                blocks.push({ type: 'equal', value: r.value });
            } else {
                if (!cur) cur = { type: 'diff', oldText: '', newText: '', active: 'new' };
                if (r.type === 'delete') cur.oldText += r.value;
                if (r.type === 'insert') cur.newText += r.value;
            }
        });
        if (cur) blocks.push(cur);
        return blocks;
    }

    function renderDiff(oldText, newText) {
        diffBlocks = computeDiff(oldText, newText);
        let html = '';
        diffBlocks.forEach((b, idx) => {
            if (b.type === 'equal') {
                html += `<span class="tp-idiff-equal" data-idx="${idx}">${_esc(b.value)}</span>`;
            } else {
                html += `<span class="tp-diff-group" data-index="${idx}">`;
                if (b.oldText) html += `<span class="tp-idiff-old ${b.active === 'old' ? 'active' : 'inactive'}" data-idx="${idx}" title="点击保留原文">${_esc(b.oldText)}</span>`;
                if (b.newText) html += `<span class="tp-idiff-new ${b.active === 'new' ? 'active' : 'inactive'}" data-idx="${idx}" title="点击保留新版">${_esc(b.newText)}</span>`;
                html += '</span>';
            }
        });
        const merge = document.getElementById('tp-diff-merge');
        if (merge) { merge.innerHTML = html; merge.className = 'tp-diff-merge-view'; }
        document.querySelectorAll('.tp-diff-mode-btn').forEach(b => b.classList.remove('active'));
        const overlay = document.getElementById('tp-diff-overlay');
        if (overlay) overlay.style.display = 'flex';
    }

    function assembleDiff() {
        return diffBlocks.map(b => {
            if (b.type === 'equal') return b.value;
            return b.active === 'old' ? b.oldText : b.newText;
        }).join('');
    }

    // ────────────────────────────────────────────────────────────────────────
    // 导入最新 AI 消息
    // ────────────────────────────────────────────────────────────────────────
    function importLastMessage() {
        try {
            const ctx  = SillyTavern.getContext();
            const chat = ctx.chat;
            if (!chat?.length) { showToast('当前没有聊天消息', 'warning'); return; }
            for (let i = chat.length - 1; i >= 0; i--) {
                if (!chat[i].is_user && chat[i].mes) {
                    const tmp = document.createElement('div');
                    const raw = chat[i].mes;
                    tmp.innerHTML = typeof DOMPurify !== 'undefined'
                        ? DOMPurify.sanitize(raw, { ALLOWED_TAGS: [] })
                        : raw.replace(/<[^>]*>/g, '');
                    const input = document.getElementById('tp-input');
                    if (input) { input.value = tmp.textContent || raw; updateCharCount(); }
                    showToast('已导入最新 AI 消息', 'success');
                    return;
                }
            }
            showToast('没有找到 AI 消息', 'warning');
        } catch (e) { showToast('导入失败：' + e.message, 'error'); }
    }

    // ────────────────────────────────────────────────────────────────────────
    // 恢复 UI 到已保存状态
    // ────────────────────────────────────────────────────────────────────────
    function restoreUI() {
        const s = id => document.getElementById(id);

        // API 设置
        if (s('tp-api-type'))      s('tp-api-type').value      = cfg.apiType || 'openai';
        if (s('tp-api-url'))       s('tp-api-url').value       = cfg.apiUrl || '';
        if (s('tp-api-key'))       s('tp-api-key').value       = cfg.apiKey || '';
        if (s('tp-model-manual'))  s('tp-model-manual').value  = cfg.model || '';
        if (s('tp-max-tokens'))    s('tp-max-tokens').value    = cfg.maxTokens || 4096;
        if (s('tp-temperature'))   s('tp-temperature').value   = cfg.temperature ?? 0.7;
        if (s('tp-temp-label'))    s('tp-temp-label').textContent = String(cfg.temperature ?? 0.7);

        // 润色设置
        if (s('tp-extra-note'))    s('tp-extra-note').value    = cfg.extraNote || '';
        if (s('tp-intensity'))     s('tp-intensity').value     = cfg.intensity || 3;
        if (s('tp-intensity-label')) s('tp-intensity-label').textContent = (INTENSITY[cfg.intensity] || INTENSITY[3]).label;

        document.querySelectorAll('.tp-chip').forEach(c =>
            c.classList.toggle('active', c.dataset.style === cfg.style));
        const customBox = s('tp-custom-style-box');
        if (customBox) customBox.style.display = cfg.style === 'custom' ? 'block' : 'none';
        if (s('tp-custom-style')) s('tp-custom-style').value = cfg.customStyle || '';

        // URL 提示更新
        updateUrlHint();

        // 自动连接
        if (!modelsFetched && cfg.apiKey && cfg.apiUrl) {
            connectAndFetchModels(false);
        } else if (modelsFetched) {
            setApiStatus('ok');
            const mc = s('tp-model-card-fetched');
            if (mc) mc.style.display = 'block';
        } else if (cfg.model && cfg.apiKey) {
            setApiStatus('manual');
        } else {
            setApiStatus('idle');
        }
    }

    // URL 提示文字更新
    function updateUrlHint() {
        const hintEl = document.getElementById('tp-url-hint');
        const typeEl = document.getElementById('tp-api-type');
        if (!hintEl || !typeEl) return;
        if (typeEl.value === 'anthropic') {
            hintEl.textContent = 'Anthropic 原生 API 地址：https://api.anthropic.com';
        } else {
            hintEl.textContent = '中转 API 填写服务商提供的地址，无需加 /v1 后缀';
        }
    }

    // ────────────────────────────────────────────────────────────────────────
    // 弹窗内事件绑定
    // ────────────────────────────────────────────────────────────────────────
    function bindPopupEvents() {
        const on  = (id, ev, fn) => { const el = document.getElementById(id); if (el) el.addEventListener(ev, fn); };
        const onQ = (sel, ev, fn) => document.querySelectorAll(sel).forEach(el => el.addEventListener(ev, fn));

        // Tab 切换
        onQ('.tp-tab', 'click', function () {
            document.querySelectorAll('.tp-tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.tp-view').forEach(v => v.classList.remove('active'));
            this.classList.add('active');
            const view = document.getElementById('tp-view-' + this.dataset.tab);
            if (view) view.classList.add('active');
        });

        // 风格芯片
        onQ('.tp-chip', 'click', function () {
            document.querySelectorAll('.tp-chip').forEach(c => c.classList.remove('active'));
            this.classList.add('active');
            cfg.style = this.dataset.style;
            const box = document.getElementById('tp-custom-style-box');
            if (box) box.style.display = cfg.style === 'custom' ? 'block' : 'none';
            saveSettings();
        });

        on('tp-custom-style', 'input', function () { cfg.customStyle = this.value; saveSettings(); });

        // 强度滑块
        on('tp-intensity', 'input', function () {
            cfg.intensity = parseInt(this.value);
            const lbl = document.getElementById('tp-intensity-label');
            if (lbl) lbl.textContent = (INTENSITY[cfg.intensity] || INTENSITY[3]).label;
            saveSettings();
        });

        // 预设标签
        onQ('.tp-preset-tag:not(.tp-model-quick)', 'click', function () {
            const p = this.dataset.preset;
            if (!p) return;
            if (selPresets.has(p)) { selPresets.delete(p); this.classList.remove('active'); }
            else                   { selPresets.add(p);    this.classList.add('active'); }
        });

        on('tp-extra-note', 'input', function () { cfg.extraNote = this.value; saveSettings(); });
        on('tp-input', 'input', updateCharCount);

        // ── API 标签页事件 ──

        // API 类型切换
        on('tp-api-type', 'change', function () {
            cfg.apiType = this.value;
            updateUrlHint();
            modelsFetched = false; // 切换类型后需重新连接
            saveSettings();
        });

        // 连接按钮
        on('tp-connect-btn', 'click', () => {
            const urlEl  = document.getElementById('tp-api-url');
            const keyEl  = document.getElementById('tp-api-key');
            const typeEl = document.getElementById('tp-api-type');
            if (urlEl)  cfg.apiUrl  = cleanApiUrl(urlEl.value);
            if (keyEl)  cfg.apiKey  = keyEl.value.trim();
            if (typeEl) cfg.apiType = typeEl.value;
            connectAndFetchModels(true);
        });

        on('tp-api-url', 'change', function () { cfg.apiUrl = cleanApiUrl(this.value); saveSettings(); });
        on('tp-api-key', 'change', function () { cfg.apiKey = this.value.trim(); saveSettings(); });

        // 在线模型下拉选择 → 同步到手动输入框
        on('tp-model-select', 'change', function () {
            cfg.model = this.value;
            const manualEl = document.getElementById('tp-model-manual');
            if (manualEl) manualEl.value = this.value;
            saveSettings();
        });

        // 手动输入模型名
        on('tp-model-manual', 'change', function () {
            cfg.model = this.value.trim();
            saveSettings();
        });
        // 实时同步（input 事件）
        on('tp-model-manual', 'input', function () {
            cfg.model = this.value.trim();
        });

        // 常用模型快速填入
        onQ('.tp-model-quick', 'click', function () {
            const model = this.dataset.model;
            if (!model) return;
            cfg.model = model;
            const manualEl = document.getElementById('tp-model-manual');
            if (manualEl) manualEl.value = model;
            saveSettings();
            showToast('已选择模型：' + model, 'info');
        });

        // 生成参数
        on('tp-max-tokens', 'change', function () {
            cfg.maxTokens = parseInt(this.value) || 4096;
            saveSettings();
        });

        on('tp-temperature', 'input', function () {
            cfg.temperature = parseFloat(this.value);
            const lbl = document.getElementById('tp-temp-label');
            if (lbl) lbl.textContent = cfg.temperature.toFixed(1);
            saveSettings();
        });

        // ── 润色操作事件 ──

        on('tp-import-btn', 'click', importLastMessage);

        on('tp-clear-input-btn', 'click', () => {
            const el = document.getElementById('tp-input');
            if (el) el.value = '';
            updateCharCount();
            const rs = document.getElementById('tp-result-section');
            if (rs) rs.style.display = 'none';
            currentResult = '';
        });

        on('tp-stop-btn', 'click', () => { abortController?.abort(); });

        on('tp-run-btn', 'click', () => {
            const inputEl = document.getElementById('tp-input');
            const text    = inputEl?.value?.trim();
            if (!text) { showToast('请输入要润色的文字', 'warning'); return; }
            inputSnapshot = text;
            runPolish(buildPolishPrompt(text));
        });

        on('tp-reuse-btn', 'click', () => {
            if (!currentResult) return;
            const el = document.getElementById('tp-input');
            if (el) { el.value = currentResult; updateCharCount(); }
            const rs = document.getElementById('tp-result-section');
            if (rs) rs.style.display = 'none';
            inputSnapshot = currentResult;
            currentResult = '';
        });

        on('tp-copy-btn', 'click', () => {
            if (!currentResult) return;
            navigator.clipboard.writeText(currentResult)
                .then(() => showToast('已复制到剪贴板', 'success'));
        });

        on('tp-send-btn', 'click', () => {
            if (!currentResult) return;
            const stInput = document.getElementById('send_textarea');
            if (stInput) {
                stInput.value = currentResult;
                stInput.dispatchEvent(new Event('input', { bubbles: true }));
                showToast('已发送到输入框', 'success');
            } else { showToast('找不到 ST 输入框', 'warning'); }
        });

        on('tp-compare-btn', 'click', () => {
            if (!currentResult || !inputSnapshot) { showToast('暂无可对比的内容', 'warning'); return; }
            renderDiff(inputSnapshot, currentResult);
        });

        on('tp-refine-btn', 'click', async () => {
            if (isStreaming) return;
            const refineEl    = document.getElementById('tp-refine-input');
            const instruction = refineEl?.value?.trim();
            if (!instruction) { showToast('请输入修改意见', 'warning'); return; }
            if (!currentResult) { showToast('没有可润色的结果', 'warning'); return; }
            lastRefineReq     = instruction;
            const oldText     = currentResult;
            inputSnapshot     = oldText;
            await runPolish(buildRefinePrompt(oldText, instruction));
            if (currentResult && currentResult !== oldText) {
                renderDiff(oldText, currentResult);
            }
            if (refineEl) refineEl.value = '';
        });

        // Diff 模式按钮
        onQ('.tp-diff-mode-btn', 'click', function () {
            const merge = document.getElementById('tp-diff-merge');
            if (!merge) return;
            if (this.classList.contains('active')) {
                this.classList.remove('active');
                merge.className = 'tp-diff-merge-view';
                const hint = document.getElementById('tp-diff-hint');
                if (hint) hint.style.display = '';
                return;
            }
            document.querySelectorAll('.tp-diff-mode-btn').forEach(b => b.classList.remove('active'));
            this.classList.add('active');
            merge.className = 'tp-diff-merge-view tp-diff-mode-' + this.dataset.mode;
            const hint = document.getElementById('tp-diff-hint');
            if (hint) hint.style.display = 'none';
        });

        // Diff 片段点击切换
        const mergeEl = document.getElementById('tp-diff-merge');
        if (mergeEl) {
            mergeEl.addEventListener('click', function (e) {
                const el = e.target;
                if (this.className.includes('tp-diff-mode-')) return;
                const idx = parseInt(el.dataset.idx);
                if (isNaN(idx) || !diffBlocks[idx] || diffBlocks[idx].type !== 'diff') return;

                if (el.classList.contains('tp-idiff-old') && !el.classList.contains('active')) {
                    diffBlocks[idx].active = 'old';
                    el.classList.add('active');    el.classList.remove('inactive');
                    const sibling = el.nextElementSibling;
                    if (sibling?.classList.contains('tp-idiff-new')) {
                        sibling.classList.add('inactive'); sibling.classList.remove('active');
                    }
                } else if (el.classList.contains('tp-idiff-new') && !el.classList.contains('active')) {
                    diffBlocks[idx].active = 'new';
                    el.classList.add('active');    el.classList.remove('inactive');
                    const sibling = el.previousElementSibling;
                    if (sibling?.classList.contains('tp-idiff-old')) {
                        sibling.classList.add('inactive'); sibling.classList.remove('active');
                    }
                }
            });
        }

        on('tp-diff-cancel', 'click', () => {
            const overlay = document.getElementById('tp-diff-overlay');
            if (overlay) overlay.style.display = 'none';
        });

        on('tp-diff-confirm', 'click', () => {
            const final    = assembleDiff();
            currentResult  = final;
            const resultEl = document.getElementById('tp-result-content');
            if (resultEl) { resultEl.textContent = final; resultEl.style.color = ''; }
            const overlay  = document.getElementById('tp-diff-overlay');
            if (overlay) overlay.style.display = 'none';
            showToast('修改已应用', 'success');
        });

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
        document.getElementById('tp-fallback-overlay')?.remove();

        const html = buildPopupHtml();

        if (typeof callPopup === 'function') {
            callPopup(html, 'text', '', { wide: true, large: true, okButton: 'Close' });
        } else {
            const overlay = document.createElement('div');
            overlay.id    = 'tp-fallback-overlay';
            overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;';
            const box = document.createElement('div');
            box.style.cssText = 'width:90%;max-width:700px;max-height:90vh;background:var(--SmartThemeBodyColor2,#1e1e2e);border-radius:12px;overflow:hidden;display:flex;flex-direction:column;position:relative;';
            box.innerHTML = html;
            const closeBtn = document.createElement('button');
            closeBtn.textContent = '关闭';
            closeBtn.style.cssText = 'margin:8px 16px 12px;padding:7px;border-radius:6px;border:1px solid var(--SmartThemeBorderColor,#555);cursor:pointer;background:transparent;color:inherit;';
            closeBtn.onclick = () => { abortController?.abort(); overlay.remove(); };
            box.appendChild(closeBtn);
            overlay.appendChild(box);
            overlay.addEventListener('click', e => {
                if (e.target === overlay) { abortController?.abort(); overlay.remove(); }
            });
            document.body.appendChild(overlay);
        }

        await new Promise(r => setTimeout(r, 80));
        restoreUI();
        bindPopupEvents();
        updateCharCount();
    }

    // ────────────────────────────────────────────────────────────────────────
    // 魔棒按钮
    // ────────────────────────────────────────────────────────────────────────
    function addWandButton() {
        if (document.getElementById(WAND_BTN_ID)) return;

        const btn = document.createElement('div');
        btn.id    = WAND_BTN_ID;
        btn.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i> 文字润色';
        btn.title = '打开文字润色工坊';
        btn.addEventListener('click', openPopup);

        const targets = ['#send_form', '#chat_input_area', '#rightSendForm', '#send_textarea'];
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
    // 全局事件
    // ────────────────────────────────────────────────────────────────────────
    function bindGlobalEvents() {
        if (evBound) return;
        evBound = true;
        if (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) {
            try {
                const ctx = SillyTavern.getContext();
                if (ctx?.eventSource && ctx?.eventTypes) {
                    ctx.eventSource.on(ctx.eventTypes.APP_READY,            addWandButton);
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
        console.log('[文字润色工坊] v2.2 加载完成 ✓');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => setTimeout(init, 600));
    } else {
        setTimeout(init, 600);
    }

})();
