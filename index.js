/**
 * 文字润色工坊 - SillyTavern Extension
 * 通过自定义 API（兼容 Anthropic / OpenAI 格式）对文字进行 AI 润色
 */

import { getContext, renderExtensionTemplateAsync, saveSettingsDebounced } from '../../../extensions.js';
import { addOneMessage, substituteParams } from '../../../../script.js';

const EXT_NAME = 'st-text-polish';
const MODULE_NAME = '文字润色工坊';

// ─── 默认设置 ───────────────────────────────────────────────────────────────
const defaultSettings = {
    apiUrl: 'https://api.anthropic.com',
    apiKey: '',
    model: 'claude-sonnet-4-20250514',
    style: 'literary',
    customStyle: '',
    intensity: 3,
    extraNote: '',
};

// ─── 风格 Prompt 映射 ────────────────────────────────────────────────────────
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

// ─── 运行时状态 ──────────────────────────────────────────────────────────────
let settings = Object.assign({}, defaultSettings);
let selectedPresets = new Set();
let currentResult = '';
let inputSnapshot = '';
let isStreaming = false;
let compareOn = false;

// ─── 构建 Prompt ─────────────────────────────────────────────────────────────
function buildPrompt(inputText) {
    const styleDesc = settings.style === 'custom'
        ? (settings.customStyle || '优美流畅的文学风格')
        : stylePrompts[settings.style];

    const presetsStr = selectedPresets.size > 0
        ? `\n额外要求：${[...selectedPresets].join('、')}` : '';
    const noteStr = settings.extraNote
        ? `\n特别说明：${settings.extraNote}` : '';

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

// ─── 检测 API 兼容性并发送请求 ───────────────────────────────────────────────
async function callApi(prompt) {
    const url = (settings.apiUrl || 'https://api.anthropic.com').replace(/\/$/, '');
    const key = settings.apiKey;
    const model = settings.model || 'claude-sonnet-4-20250514';

    // 判断是 Anthropic 还是 OpenAI 兼容接口
    const isAnthropic = url.includes('anthropic.com') || url.includes('/v1') && !url.includes('openai');
    const endpoint = isAnthropic
        ? `${url}/v1/messages`
        : `${url}/v1/chat/completions`;

    const headers = { 'Content-Type': 'application/json' };
    if (isAnthropic) {
        headers['x-api-key'] = key;
        headers['anthropic-version'] = '2023-06-01';
    } else {
        headers['Authorization'] = `Bearer ${key}`;
    }

    const body = isAnthropic
        ? {
            model,
            max_tokens: 2048,
            stream: true,
            messages: [{ role: 'user', content: prompt }],
          }
        : {
            model,
            stream: true,
            messages: [
                { role: 'system', content: '你是一位专业的中文写作润色专家。' },
                { role: 'user', content: prompt },
            ],
          };

    return fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
    });
}

// ─── 解析 SSE 流（兼容两种格式）──────────────────────────────────────────────
function extractDeltaText(parsedData, isAnthropic) {
    if (isAnthropic) {
        if (parsedData.type === 'content_block_delta' && parsedData.delta?.text) {
            return parsedData.delta.text;
        }
    } else {
        const delta = parsedData.choices?.[0]?.delta?.content;
        if (delta) return delta;
    }
    return null;
}

// ─── 主润色流程 ──────────────────────────────────────────────────────────────
async function startPolish() {
    const inputText = document.getElementById('polish-input')?.value?.trim();
    if (!inputText) { toastr.warning('请输入要润色的文字'); return; }
    if (!settings.apiKey) { toastr.warning('请先在设置中填写 API 密钥'); return; }
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

    if (runBtn) { runBtn.disabled = true; runBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 润色中…'; }
    resultSection.style.display = 'block';
    loading.style.display = 'flex';
    resultContent.textContent = '';
    resultContent.classList.remove('streaming');
    compareGrid.style.display = 'none';
    normalView.style.display = 'block';
    const compareBtn = document.getElementById('polish-compare-btn');
    if (compareBtn) compareBtn.textContent = '对比';

    try {
        const url = (settings.apiUrl || '').replace(/\/$/, '');
        const isAnthropic = url.includes('anthropic.com');
        const response = await callApi(buildPrompt(inputText));

        if (!response.ok) {
            const err = await response.json().catch(() => ({ error: { message: `HTTP ${response.status}` } }));
            throw new Error(err.error?.message || `HTTP ${response.status}`);
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
                    const text = extractDeltaText(parsed, isAnthropic);
                    if (text) {
                        currentResult += text;
                        resultContent.textContent = currentResult;
                    }
                } catch (e) { /* 忽略不完整 JSON */ }
            }
        }

        resultContent.classList.remove('streaming');
        updateApiStatus('ok');
        toastr.success('润色完成！');

    } catch (err) {
        loading.style.display = 'none';
        resultContent.classList.remove('streaming');
        resultContent.style.color = 'var(--SmartThemeQuoteColor, #e74c3c)';
        resultContent.textContent = '❌ 错误：' + err.message;
        updateApiStatus('err');
        toastr.error('润色失败：' + err.message);
    }

    isStreaming = false;
    if (runBtn) { runBtn.disabled = false; runBtn.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i> 润色'; }
}

// ─── API 状态显示 ─────────────────────────────────────────────────────────────
function updateApiStatus(state) {
    const el = document.getElementById('polish-api-status');
    if (!el) return;
    el.className = 'polish-api-status ' + state;
    el.textContent = { ok: '● 连接正常', err: '● 请求失败', idle: '● 未连接' }[state] || '● 未连接';
}

// ─── 从最新 AI 消息导入文字 ──────────────────────────────────────────────────
function importLastMessage() {
    const context = SillyTavern.getContext();
    const chat = context.chat;
    if (!chat || chat.length === 0) { toastr.warning('当前没有聊天消息'); return; }

    // 找最后一条非 user 消息
    for (let i = chat.length - 1; i >= 0; i--) {
        if (!chat[i].is_user && chat[i].mes) {
            const input = document.getElementById('polish-input');
            if (input) {
                // 去除 HTML 标签，只取纯文本
                const tmp = document.createElement('div');
                tmp.innerHTML = chat[i].mes;
                input.value = tmp.textContent || tmp.innerText || chat[i].mes;
                updateCharCount();
            }
            toastr.info('已导入最新 AI 消息');
            return;
        }
    }
    toastr.warning('没有找到 AI 消息');
}

// ─── 将结果插入 ST 输入框 ─────────────────────────────────────────────────────
function insertToInputBox() {
    if (!currentResult) return;
    const stInput = document.getElementById('send_textarea');
    if (stInput) {
        stInput.value = currentResult;
        stInput.dispatchEvent(new Event('input', { bubbles: true }));
        toastr.success('已发送到输入框');
    } else {
        toastr.warning('找不到 ST 输入框');
    }
}

// ─── 字数统计 ─────────────────────────────────────────────────────────────────
function updateCharCount() {
    const input = document.getElementById('polish-input');
    const count = document.getElementById('polish-char-count');
    if (input && count) count.textContent = (input.value?.length || 0) + ' 字';
}

// ─── 对比视图切换 ─────────────────────────────────────────────────────────────
function toggleCompare() {
    if (!currentResult) return;
    compareOn = !compareOn;
    const normalView = document.getElementById('polish-result-normal');
    const compareGrid = document.getElementById('polish-result-compare');
    const compareBtn = document.getElementById('polish-compare-btn');

    if (compareOn) {
        document.getElementById('polish-orig-text').textContent = inputSnapshot;
        document.getElementById('polish-new-text').textContent = currentResult;
        normalView.style.display = 'none';
        compareGrid.style.display = 'grid';
        if (compareBtn) compareBtn.textContent = '普通视图';
    } else {
        normalView.style.display = 'block';
        compareGrid.style.display = 'none';
        if (compareBtn) compareBtn.textContent = '对比';
    }
}

// ─── 保存设置 ─────────────────────────────────────────────────────────────────
function saveSettings() {
    extension_settings[EXT_NAME] = settings;
    saveSettingsDebounced();
}

// ─── 绑定面板事件 ─────────────────────────────────────────────────────────────
function bindPanelEvents() {
    // API 设置输入
    document.getElementById('polish-api-url')?.addEventListener('change', function () {
        settings.apiUrl = this.value.trim();
        saveSettings();
    });
    document.getElementById('polish-api-key')?.addEventListener('change', function () {
        settings.apiKey = this.value.trim();
        updateApiStatus(this.value.trim() ? 'idle' : 'idle');
        saveSettings();
    });
    document.getElementById('polish-model')?.addEventListener('change', function () {
        settings.model = this.value.trim();
        saveSettings();
    });

    // 风格芯片
    document.querySelectorAll('.polish-chip').forEach(chip => {
        chip.addEventListener('click', function () {
            document.querySelectorAll('.polish-chip').forEach(c => c.classList.remove('active'));
            this.classList.add('active');
            settings.style = this.dataset.style;
            const customBox = document.getElementById('polish-custom-style-box');
            if (customBox) customBox.style.display = settings.style === 'custom' ? 'block' : 'none';
            saveSettings();
        });
    });

    // 自定义风格
    document.getElementById('polish-custom-style')?.addEventListener('input', function () {
        settings.customStyle = this.value;
        saveSettings();
    });

    // 强度滑块
    document.getElementById('polish-intensity')?.addEventListener('input', function () {
        settings.intensity = parseInt(this.value);
        const label = document.getElementById('polish-intensity-label');
        if (label) label.textContent = intensityLabel[settings.intensity] || '均衡';
        saveSettings();
    });

    // 预设标签
    document.querySelectorAll('.polish-preset-tag').forEach(tag => {
        tag.addEventListener('click', function () {
            const p = this.dataset.preset;
            if (selectedPresets.has(p)) {
                selectedPresets.delete(p);
                this.classList.remove('active');
            } else {
                selectedPresets.add(p);
                this.classList.add('active');
            }
        });
    });

    // 额外说明
    document.getElementById('polish-extra-note')?.addEventListener('input', function () {
        settings.extraNote = this.value;
    });

    // 输入框
    document.getElementById('polish-input')?.addEventListener('input', updateCharCount);

    // 按钮
    document.getElementById('polish-run-btn')?.addEventListener('click', startPolish);
    document.getElementById('polish-import-btn')?.addEventListener('click', importLastMessage);
    document.getElementById('polish-clear-btn')?.addEventListener('click', () => {
        const input = document.getElementById('polish-input');
        if (input) input.value = '';
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
        const input = document.getElementById('polish-input');
        if (input) {
            input.value = currentResult;
            updateCharCount();
        }
        const rs = document.getElementById('polish-result-section');
        if (rs) rs.style.display = 'none';
        currentResult = '';
    });
    document.getElementById('polish-insert-btn')?.addEventListener('click', insertToInputBox);
}

// ─── 填充已保存的设置 ────────────────────────────────────────────────────────
function restoreSettingsToUI() {
    const urlEl = document.getElementById('polish-api-url');
    const keyEl = document.getElementById('polish-api-key');
    const modelEl = document.getElementById('polish-model');
    const intensityEl = document.getElementById('polish-intensity');
    const intensityLabel = document.getElementById('polish-intensity-label');
    const customStyleEl = document.getElementById('polish-custom-style');

    if (urlEl) urlEl.value = settings.apiUrl || '';
    if (keyEl) keyEl.value = settings.apiKey || '';
    if (modelEl) modelEl.value = settings.model || 'claude-sonnet-4-20250514';
    if (intensityEl) intensityEl.value = settings.intensity || 3;
    if (intensityLabel) intensityLabel.textContent = intensityLabel[settings.intensity] || '均衡';
    if (customStyleEl) customStyleEl.value = settings.customStyle || '';

    // 恢复风格选择
    document.querySelectorAll('.polish-chip').forEach(chip => {
        chip.classList.toggle('active', chip.dataset.style === settings.style);
    });
    const customBox = document.getElementById('polish-custom-style-box');
    if (customBox) customBox.style.display = settings.style === 'custom' ? 'block' : 'none';

    updateApiStatus(settings.apiKey ? 'idle' : 'idle');
}

// ─── 扩展入口 ────────────────────────────────────────────────────────────────
jQuery(async () => {
    // 加载已保存设置
    if (!extension_settings[EXT_NAME]) {
        extension_settings[EXT_NAME] = Object.assign({}, defaultSettings);
    }
    settings = Object.assign({}, defaultSettings, extension_settings[EXT_NAME]);

    // 渲染面板 HTML
    const panelHtml = await renderExtensionTemplateAsync(
        `third-party/${EXT_NAME}`, 'panel'
    );

    // 挂载到扩展设置面板
    $('#extensions_settings').append(panelHtml);

    // 绑定事件 & 恢复 UI
    bindPanelEvents();
    restoreSettingsToUI();

    console.log(`[${MODULE_NAME}] 加载完成`);
});
