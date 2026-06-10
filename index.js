/**
 * 文字润色工坊 v2.3 — SillyTavern Extension
 * 新增：1.导入输入框文字 2.多档API保存 3.润色历史 4.主题Tab 5.Prompt编辑
 */
(function () {
    'use strict';

    const EXT_NAME    = 'st-text-polish';
    const WAND_BTN_ID = 'tp-wand-btn';
    const MAX_HISTORY  = 3;
    const MAX_PROFILES = 5;

    const INTENSITY = {
        1: { label: '极轻微', desc: '尽量保留原文，只做微小词句优化' },
        2: { label: '轻度',   desc: '轻度改写，保留原意和结构，优化表达' },
        3: { label: '均衡',   desc: '适度改写，保留核心内容，提升文学性' },
        4: { label: '深度',   desc: '深度重写，大幅提升表达质量，可改变句式' },
        5: { label: '大幅重写', desc: '完全重塑，以原文意思为基础彻底重写' },
    };

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

    const POPULAR_MODELS = [
        { group: 'Claude',   models: ['claude-sonnet-4-20250514','claude-3-7-sonnet-20250219','claude-3-5-sonnet-20241022','claude-3-5-haiku-20241022'] },
        { group: 'GPT',      models: ['gpt-4o','gpt-4o-mini','gpt-4.1','gpt-4.1-mini','o4-mini'] },
        { group: 'Gemini',   models: ['gemini-2.5-flash','gemini-2.5-pro','gemini-2.0-flash'] },
        { group: 'DeepSeek', models: ['deepseek-chat','deepseek-reasoner'] },
        { group: 'Qwen',     models: ['qwen-plus','qwen-max','qwen3-235b-a22b'] },
    ];

    const DEFAULT_SYSTEM_PROMPT = '你是一位专业的中文写作润色专家，擅长文学创作和语言美化。请严格遵循用户的风格要求进行润色，直接输出润色结果，不要加任何说明或注释。';

    const DEFAULT_PROFILE = { name:'默认配置', apiUrl:'', apiKey:'', apiType:'openai', model:'', maxTokens:4096, temperature:0.7 };

    const DEFAULT_SETTINGS = {
        profiles: [Object.assign({}, DEFAULT_PROFILE)],
        activeProfile: 0,
        style: 'literary', customStyle: '', intensity: 3, extraNote: '',
        systemPrompt: DEFAULT_SYSTEM_PROMPT,
        themeUrl: '',
        history: [],
    };

    let cfg            = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
    let selPresets     = new Set();
    let currentResult  = '';
    let inputSnapshot  = '';
    let isStreaming    = false;
    let diffBlocks     = [];
    let lastRefineReq  = '';
    let evBound        = false;
    let modelsFetched  = false;
    let abortController = null;

    function activeProf() {
        return cfg.profiles[cfg.activeProfile || 0] || cfg.profiles[0] || Object.assign({}, DEFAULT_PROFILE);
    }

    function _esc(s) { const d=document.createElement('div'); d.textContent=String(s); return d.innerHTML; }

    // ── 设置持久化 ──────────────────────────────────────────────────────────
    function saveSettings() {
        if (typeof extension_settings !== 'undefined') {
            extension_settings[EXT_NAME] = JSON.parse(JSON.stringify(cfg));
            if (typeof saveSettingsDebounced === 'function') saveSettingsDebounced();
        }
    }

    function loadSettings() {
        if (typeof extension_settings !== 'undefined' && extension_settings[EXT_NAME]) {
            const saved = extension_settings[EXT_NAME];
            cfg = Object.assign(JSON.parse(JSON.stringify(DEFAULT_SETTINGS)), JSON.parse(JSON.stringify(saved)));
            if (!cfg.profiles || !Array.isArray(cfg.profiles) || cfg.profiles.length === 0) {
                cfg.profiles = [Object.assign({}, DEFAULT_PROFILE, {
                    apiUrl: saved.apiUrl||'', apiKey: saved.apiKey||'',
                    apiType: saved.apiType||'openai', model: saved.model||'',
                    maxTokens: saved.maxTokens||4096, temperature: saved.temperature??0.7,
                })];
                cfg.activeProfile = 0;
            }
            if (!cfg.history) cfg.history = [];
            if (!cfg.systemPrompt) cfg.systemPrompt = DEFAULT_SYSTEM_PROMPT;
        }
    }

    // ── UI 工具 ─────────────────────────────────────────────────────────────
    function showToast(msg, type) {
        if (typeof toastr === 'undefined') return;
        toastr[type==='success'?'success':type==='error'?'error':type==='warning'?'warning':'info'](msg);
    }

    function setApiStatus(state, msg) {
        const el = document.getElementById('tp-api-status'); if (!el) return;
        const map = {ok:'● 已连接',err:'● 连接失败',idle:'● 未连接',connecting:'● 连接中…',manual:'● 手动模式（未验证连接）'};
        el.className = 'tp-api-status ' + state;
        el.textContent = msg || map[state] || '● 未连接';
    }

    function updateCharCount() {
        const el=document.getElementById('tp-input'), cnt=document.getElementById('tp-char-count');
        if (el && cnt) cnt.textContent = (el.value?.length||0) + ' 字';
    }

    function setResultBtnsDisabled(d) {
        ['tp-compare-btn','tp-copy-btn','tp-send-btn','tp-refine-btn','tp-reuse-btn'].forEach(id=>{
            const el=document.getElementById(id); if(el) el.disabled=d;
        });
        const s=document.getElementById('tp-stop-btn'); if(s) s.style.display=d?'inline-flex':'none';
    }

    function cleanApiUrl(url) {
        return (url||'').trim().replace(/\/+$/,'').replace(/\/v\d+\/?(chat\/completions)?$/,'').replace(/\/v\d+\/?$/,'');
    }

    function updateUrlHint() {
        const h=document.getElementById('tp-url-hint'), t=document.getElementById('tp-api-type'); if(!h||!t) return;
        h.textContent = t.value==='anthropic' ? 'Anthropic 原生 API：https://api.anthropic.com' : '中转 API 填写服务商地址，无需加 /v1 后缀';
    }

    // ── 润色历史 ────────────────────────────────────────────────────────────
    function addHistory(input, output) {
        if (!input || !output) return;
        cfg.history.unshift({ ts: new Date().toLocaleString(), input: input.slice(0,80)+(input.length>80?'…':''), output });
        if (cfg.history.length > MAX_HISTORY) cfg.history = cfg.history.slice(0, MAX_HISTORY);
        saveSettings();
        renderHistory();
    }

    function renderHistory() {
        const list=document.getElementById('tp-history-list'), empty=document.getElementById('tp-history-empty');
        if (!list) return;
        list.innerHTML = '';
        if (!cfg.history || cfg.history.length === 0) { if(empty) empty.style.display=''; return; }
        if (empty) empty.style.display = 'none';
        cfg.history.forEach((item, idx) => {
            const el = document.createElement('div');
            el.className = 'tp-hist-item';
            el.innerHTML = '<div class="tp-hist-meta"><span class="tp-hint">'+_esc(item.ts)+'</span>'
                +'<div style="display:flex;gap:4px;">'
                +'<button class="tp-btn tp-btn-ghost" style="padding:2px 8px;font-size:0.76rem;" data-load="'+idx+'"><i class="fa-solid fa-rotate-left"></i> 恢复</button>'
                +'<button class="tp-btn tp-btn-danger" style="padding:2px 8px;font-size:0.76rem;" data-del="'+idx+'"><i class="fa-solid fa-xmark"></i></button>'
                +'</div></div>'
                +'<div class="tp-hist-preview">'+_esc(item.input)+'</div>';
            el.querySelector('[data-load]').addEventListener('click', () => {
                const resultEl=document.getElementById('tp-result-content');
                const inputEl=document.getElementById('tp-input');
                if (resultEl) { resultEl.textContent=item.output; resultEl.style.color=''; }
                if (inputEl)  { inputEl.value=item.output; updateCharCount(); }
                currentResult = item.output;
                const rs=document.getElementById('tp-result-section'); if(rs) rs.style.display='block';
                showToast('已恢复历史润色结果','success');
            });
            el.querySelector('[data-del]').addEventListener('click', () => {
                cfg.history.splice(idx,1); saveSettings(); renderHistory();
            });
            list.appendChild(el);
        });
    }

    // ── 主题 ────────────────────────────────────────────────────────────────
    const BUILTIN_THEMES = {
        '': '',
        'dark-ink': '.tp-card-title,.tp-tab.active,.tp-result-tag{color:#c9a96e;}.tp-card-title::before,.tp-btn-primary{background:#c9a96e;}.tp-btn-primary{border-color:#c9a96e;color:#1a1008;}.tp-tab.active{border-bottom-color:#c9a96e;}.tp-chip.active{border-color:#c9a96e;background:rgba(201,169,110,0.12);}.tp-chip.active .tp-chip-name,.tp-api-status.ok{color:#c9a96e;}.tp-preset-tag.active{border-color:#c9a96e;color:#c9a96e;}',
        'warm-paper': '.tp-card-title,.tp-tab.active,.tp-result-tag{color:#c0763a;}.tp-card-title::before,.tp-btn-primary{background:#c0763a;}.tp-btn-primary{border-color:#c0763a;color:#fff;}.tp-tab.active{border-bottom-color:#c0763a;}.tp-chip.active{border-color:#c0763a;background:rgba(192,118,58,0.12);}.tp-chip.active .tp-chip-name{color:#c0763a;}.tp-preset-tag.active{border-color:#c0763a;color:#c0763a;}',
        'forest': '.tp-card-title,.tp-tab.active,.tp-result-tag{color:#5a9e72;}.tp-card-title::before,.tp-btn-primary{background:#5a9e72;}.tp-btn-primary{border-color:#5a9e72;color:#fff;}.tp-tab.active{border-bottom-color:#5a9e72;}.tp-chip.active{border-color:#5a9e72;background:rgba(90,158,114,0.12);}.tp-chip.active .tp-chip-name{color:#5a9e72;}.tp-preset-tag.active{border-color:#5a9e72;color:#5a9e72;}',
    };

    function applyBuiltinTheme(key) {
        let el=document.getElementById('tp-builtin-style');
        if (!el) { el=document.createElement('style'); el.id='tp-builtin-style'; document.head.appendChild(el); }
        el.textContent = BUILTIN_THEMES[key]||'';
    }

    async function loadExternalTheme(url) {
        const statusEl=document.getElementById('tp-theme-status');
        if (!url) { removeExternalTheme(); if(statusEl) statusEl.style.display='none'; cfg.themeUrl=''; saveSettings(); return; }
        if (statusEl) { statusEl.style.display='block'; statusEl.style.background='rgba(240,173,78,0.1)'; statusEl.style.color='#f0ad4e'; statusEl.textContent='⏳ 加载中…'; }
        try {
            const res = await fetch(url); if (!res.ok) throw new Error('HTTP '+res.status);
            const css = await res.text();
            let el=document.getElementById('tp-external-theme');
            if (!el) { el=document.createElement('style'); el.id='tp-external-theme'; document.head.appendChild(el); }
            el.textContent = css; cfg.themeUrl=url; saveSettings();
            if (statusEl) { statusEl.style.background='rgba(92,184,92,0.1)'; statusEl.style.color='#5cb85c'; statusEl.textContent='✓ 加载成功'; }
            showToast('外部主题加载成功','success');
        } catch(e) {
            if (statusEl) { statusEl.style.background='rgba(231,76,60,0.1)'; statusEl.style.color='#e74c3c'; statusEl.textContent='❌ 加载失败：'+e.message; }
            showToast('主题加载失败：'+e.message,'error');
        }
    }

    function removeExternalTheme() { const el=document.getElementById('tp-external-theme'); if(el) el.textContent=''; }

    // ── Prompt 构建 ──────────────────────────────────────────────────────────
    function buildPolishPrompt(inputText) {
        const sd = cfg.style==='custom' ? (cfg.customStyle||'优美流畅的文学风格') : (STYLE_PROMPTS[cfg.style]||STYLE_PROMPTS.literary);
        const ii = INTENSITY[cfg.intensity]||INTENSITY[3];
        const ps = selPresets.size>0 ? '\n额外要求：'+[...selPresets].join('、') : '';
        const ns = cfg.extraNote ? '\n特别说明：'+cfg.extraNote : '';
        return '请按照以下要求对文本进行润色：\n\n【目标风格】'+sd+'\n\n【润色强度】'+ii.desc+ps+ns
            +'\n\n【注意事项】\n- 保持原文的核心意思和情节\n- 不要添加原文没有的剧情或信息\n- 直接输出润色后的文本，不要加任何说明或注释\n- 不要输出"润色后："等前缀\n\n【待润色文本】\n'+inputText;
    }

    function buildRefinePrompt(old, inst) {
        return '以下是一段已经润色过的文本：\n"""\n'+old+'\n"""\n\n用户对此文本不满意，请根据以下修改意见重新润色：\n修改意见：'+inst+'\n\n【要求】\n- 在保留原有文学风格的基础上，落实用户的具体修改意见\n- 直接输出修改后的文本，不要加任何说明或前缀';
    }

    // ── API 调用 ─────────────────────────────────────────────────────────────
    function buildApiRequest(prompt) {
        const p=activeProf(), base=cleanApiUrl(p.apiUrl), isAnt=p.apiType==='anthropic';
        const sys=(cfg.systemPrompt||DEFAULT_SYSTEM_PROMPT).trim();
        let endpoint, headers, body;
        if (isAnt) {
            endpoint = base+'/v1/messages';
            headers  = {'Content-Type':'application/json','x-api-key':p.apiKey,'anthropic-version':'2023-06-01'};
            body     = {model:p.model,max_tokens:p.maxTokens||4096,temperature:p.temperature??0.7,stream:true,system:sys,messages:[{role:'user',content:prompt}]};
        } else {
            endpoint = base+'/v1/chat/completions';
            headers  = {'Content-Type':'application/json','Authorization':'Bearer '+p.apiKey};
            body     = {model:p.model,max_tokens:p.maxTokens||4096,temperature:p.temperature??0.7,stream:true,messages:[{role:'system',content:sys},{role:'user',content:prompt}]};
        }
        return {endpoint, headers, body:JSON.stringify(body), isAnt};
    }

    async function streamApiCall(prompt, onChunk) {
        abortController?.abort();
        abortController = new AbortController();
        const {endpoint,headers,body,isAnt} = buildApiRequest(prompt);
        const res = await fetch(endpoint, {method:'POST',headers,body,signal:abortController.signal});
        if (!res.ok) {
            let msg='HTTP '+res.status;
            try { const e=await res.json(); msg=e.error?.message||e.message||e.detail||msg; } catch(_){}
            throw new Error(msg);
        }
        const reader=res.body.getReader(), decoder=new TextDecoder();
        let buffer='';
        while(true) {
            const {done,value}=await reader.read(); if(done) break;
            buffer += decoder.decode(value,{stream:true});
            const lines=buffer.split('\n'); buffer=lines.pop();
            for (const line of lines) {
                if (!line.startsWith('data: ')) continue;
                const data=line.slice(6).trim(); if(data==='[DONE]') continue;
                try {
                    const parsed=JSON.parse(data);
                    let text=null;
                    if (isAnt) { if(parsed.type==='content_block_delta'&&parsed.delta?.text) text=parsed.delta.text; }
                    else { text=parsed.choices?.[0]?.delta?.content||null; }
                    if (text) onChunk(text);
                } catch(_){}
            }
        }
    }

    // ── 连接并拉取模型 ───────────────────────────────────────────────────────
    async function connectAndFetchModels(force) {
        const urlEl=document.getElementById('tp-api-url'), keyEl=document.getElementById('tp-api-key'), typeEl=document.getElementById('tp-api-type');
        const btn=document.getElementById('tp-connect-btn'), fetchedCard=document.getElementById('tp-model-card-fetched');
        const prof=activeProf();
        const url=cleanApiUrl(urlEl?.value||prof.apiUrl||''), key=(keyEl?.value||prof.apiKey||'').trim(), type=typeEl?.value||prof.apiType||'openai';
        if (!url) { showToast('请填写 API 地址','warning'); return; }
        if (!key) { showToast('请填写 API 密钥','warning'); return; }
        if (!force && modelsFetched && url===prof.apiUrl && key===prof.apiKey && type===prof.apiType) {
            if(fetchedCard) fetchedCard.style.display='block'; setApiStatus('ok'); return;
        }
        prof.apiUrl=url; prof.apiKey=key; prof.apiType=type; saveSettings();
        if(btn){btn.disabled=true;btn.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i> 连接中…';}
        setApiStatus('connecting');
        if(fetchedCard) fetchedCard.style.display='none';
        try {
            let models=[];
            if (type==='anthropic') {
                const res=await fetch(url+'/v1/models',{headers:{'x-api-key':key,'anthropic-version':'2023-06-01'}});
                if(!res.ok) throw new Error(await getErrMsg(res));
                const data=await res.json();
                models=(data.data||[]).map(m=>({id:m.id,name:m.display_name||m.id}));
            } else {
                const res=await fetch(url+'/v1/models',{headers:{'Authorization':'Bearer '+key}});
                if(!res.ok) throw new Error(await getErrMsg(res));
                const data=await res.json(); const raw=data.data||data;
                models=(Array.isArray(raw)?raw:[]).map(m=>({id:typeof m==='string'?m:m.id,name:typeof m==='string'?m:(m.id||m.name||m)})).filter(m=>m.id);
                models.sort((a,b)=>{const p=id=>(id.includes('claude')?0:id.includes('gpt-4')?1:id.includes('deepseek')?2:id.includes('qwen')?3:id.includes('gemini')?4:5);return p(a.id)-p(b.id);});
            }
            if (models.length > 0) {
                const sel=document.getElementById('tp-model-select');
                if(sel){
                    sel.innerHTML='';
                    models.forEach(m=>{const opt=document.createElement('option');opt.value=m.id;opt.textContent=m.name;if(m.id===prof.model)opt.selected=true;sel.appendChild(opt);});
                    if(!prof.model||!models.find(m=>m.id===prof.model)){sel.value=models[0].id;prof.model=models[0].id;}
                    else sel.value=prof.model;
                    const me=document.getElementById('tp-model-manual'); if(me) me.value=prof.model;
                }
                const hint=document.getElementById('tp-model-hint'); if(hint) hint.textContent='共 '+models.length+' 个可用模型';
                if(fetchedCard) fetchedCard.style.display='block';
                setApiStatus('ok'); modelsFetched=true; saveSettings();
                showToast('连接成功，获取到 '+models.length+' 个模型','success');
            } else throw new Error('未获取到任何模型');
        } catch(err) {
            modelsFetched=false; if(fetchedCard) fetchedCard.style.display='none';
            if(/401|403|unauthorized|forbidden/i.test(err.message)){setApiStatus('err','● 认证失败，请检查 API 密钥');showToast('认证失败：'+err.message,'error');}
            else{setApiStatus('manual','● 无法获取模型列表，请手动输入模型名');showToast('无法获取模型列表（中转API常见），请手动填写模型名','warning');saveSettings();}
        }
        if(btn){btn.disabled=false;btn.innerHTML='<i class="fa-solid fa-plug"></i> 连接并获取模型';}
    }

    async function getErrMsg(res) {
        try{const e=await res.json();return e.error?.message||e.message||e.detail||'HTTP '+res.status;}catch(_){return 'HTTP '+res.status;}
    }

    // ── 主润色流程 ───────────────────────────────────────────────────────────
    async function runPolish(prompt, origInput) {
        if(isStreaming) return;
        const prof=activeProf();
        if(!prof.apiKey){showToast('请先填写 API 密钥','warning');return;}
        if(!prof.apiUrl){showToast('请先填写 API 地址','warning');return;}
        if(!prof.model){showToast('请先设置模型名称','warning');return;}
        isStreaming=true; currentResult='';
        const runBtn=document.getElementById('tp-run-btn'), loading=document.getElementById('tp-loading');
        const resultSec=document.getElementById('tp-result-section'), resultEl=document.getElementById('tp-result-content');
        const diffOv=document.getElementById('tp-diff-overlay');
        if(runBtn){runBtn.disabled=true;runBtn.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i> 润色中…';}
        if(diffOv) diffOv.style.display='none';
        resultSec.style.display='block'; loading.style.display='flex';
        resultEl.textContent=''; resultEl.style.color=''; resultEl.className='tp-result-content streaming';
        setResultBtnsDisabled(true);
        try {
            await streamApiCall(prompt, chunk=>{currentResult+=chunk;resultEl.textContent=currentResult;});
            resultEl.className='tp-result-content'; setApiStatus('ok'); showToast('润色完成！','success');
            if(origInput && currentResult) addHistory(origInput, currentResult);
        } catch(err) {
            if(err.name==='AbortError'){resultEl.className='tp-result-content';showToast('已停止生成','info');}
            else{resultEl.className='tp-result-content';resultEl.style.color='#e74c3c';resultEl.textContent='❌ 错误：'+err.message;setApiStatus('err');showToast('润色失败：'+err.message,'error');}
        }
        loading.style.display='none'; isStreaming=false; setResultBtnsDisabled(false);
        if(runBtn){runBtn.disabled=false;runBtn.innerHTML='<i class="fa-solid fa-wand-magic-sparkles"></i> 开始润色';}
    }

    // ── Diff ──────────────────────────────────────────────────────────────────
    const DIFF_LIMIT=400;
    function tokenize(t){const tk=[]; let c=''; for(const ch of t){c+=ch;if(/[，。！？；\n,.!?;：]/.test(ch)){tk.push(c);c='';}} if(c)tk.push(c); return tk;}
    function computeDiff(ot,nt){
        const A=tokenize(ot),B=tokenize(nt);
        if(A.length>DIFF_LIMIT||B.length>DIFF_LIMIT) return [{type:'diff',oldText:ot,newText:nt,active:'new'}];
        const m=A.length,n=B.length,dp=Array.from({length:m+1},()=>new Array(n+1).fill(0));
        for(let i=1;i<=m;i++)for(let j=1;j<=n;j++)dp[i][j]=A[i-1]===B[j-1]?dp[i-1][j-1]+1:Math.max(dp[i-1][j],dp[i][j-1]);
        let i=m,j=n; const res=[];
        while(i>0||j>0){if(i>0&&j>0&&A[i-1]===B[j-1]){res.unshift({type:'equal',value:A[i-1]});i--;j--;}else if(j>0&&(i===0||dp[i][j-1]>=dp[i-1][j])){res.unshift({type:'insert',value:B[j-1]});j--;}else{res.unshift({type:'delete',value:A[i-1]});i--;}}
        const blocks=[]; let cur=null;
        res.forEach(r=>{if(r.type==='equal'){if(cur){blocks.push(cur);cur=null;}blocks.push({type:'equal',value:r.value});}else{if(!cur)cur={type:'diff',oldText:'',newText:'',active:'new'};if(r.type==='delete')cur.oldText+=r.value;if(r.type==='insert')cur.newText+=r.value;}});
        if(cur)blocks.push(cur); return blocks;
    }
    function renderDiff(ot,nt){
        diffBlocks=computeDiff(ot,nt); let html='';
        diffBlocks.forEach((b,i)=>{
            if(b.type==='equal'){html+='<span class="tp-idiff-equal" data-idx="'+i+'">'+_esc(b.value)+'</span>';}
            else{html+='<span class="tp-diff-group">';if(b.oldText)html+='<span class="tp-idiff-old '+(b.active==='old'?'active':'inactive')+'" data-idx="'+i+'">'+_esc(b.oldText)+'</span>';if(b.newText)html+='<span class="tp-idiff-new '+(b.active==='new'?'active':'inactive')+'" data-idx="'+i+'">'+_esc(b.newText)+'</span>';html+='</span>';}
        });
        const merge=document.getElementById('tp-diff-merge');
        if(merge){merge.innerHTML=html;merge.className='tp-diff-merge-view';}
        document.querySelectorAll('.tp-diff-mode-btn').forEach(b=>b.classList.remove('active'));
        const ov=document.getElementById('tp-diff-overlay'); if(ov) ov.style.display='flex';
    }
    function assembleDiff(){return diffBlocks.map(b=>b.type==='equal'?b.value:(b.active==='old'?b.oldText:b.newText)).join('');}

    // ── 导入 ──────────────────────────────────────────────────────────────────
    function importLastMessage(){
        try{
            const ctx=SillyTavern.getContext(),chat=ctx.chat;
            if(!chat?.length){showToast('当前没有聊天消息','warning');return;}
            for(let i=chat.length-1;i>=0;i--){
                if(!chat[i].is_user&&chat[i].mes){
                    const tmp=document.createElement('div'),raw=chat[i].mes;
                    tmp.innerHTML=typeof DOMPurify!=='undefined'?DOMPurify.sanitize(raw,{ALLOWED_TAGS:[]}):raw.replace(/<[^>]*>/g,'');
                    const el=document.getElementById('tp-input'); if(el){el.value=tmp.textContent||raw;updateCharCount();}
                    showToast('已导入最新 AI 消息','success'); return;
                }
            }
            showToast('没有找到 AI 消息','warning');
        }catch(e){showToast('导入失败：'+e.message,'error');}
    }

    function importFromChatInput(){
        const st=document.getElementById('send_textarea');
        if(!st||!st.value.trim()){showToast('ST 输入框为空','warning');return;}
        const el=document.getElementById('tp-input'); if(el){el.value=st.value;updateCharCount();}
        showToast('已导入输入框文字','success');
    }

    // ── 恢复 UI ──────────────────────────────────────────────────────────────
    function restoreUI(){
        const s=id=>document.getElementById(id), prof=activeProf();
        if(s('tp-extra-note'))     s('tp-extra-note').value     = cfg.extraNote||'';
        if(s('tp-intensity'))      s('tp-intensity').value      = cfg.intensity||3;
        if(s('tp-intensity-label'))s('tp-intensity-label').textContent=(INTENSITY[cfg.intensity]||INTENSITY[3]).label;
        document.querySelectorAll('.tp-chip').forEach(c=>c.classList.toggle('active',c.dataset.style===cfg.style));
        const cb=s('tp-custom-style-box'); if(cb) cb.style.display=cfg.style==='custom'?'block':'none';
        if(s('tp-custom-style'))   s('tp-custom-style').value   = cfg.customStyle||'';
        if(s('tp-api-type'))       s('tp-api-type').value       = prof.apiType||'openai';
        if(s('tp-api-url'))        s('tp-api-url').value        = prof.apiUrl||'';
        if(s('tp-api-key'))        s('tp-api-key').value        = prof.apiKey||'';
        if(s('tp-model-manual'))   s('tp-model-manual').value   = prof.model||'';
        if(s('tp-max-tokens'))     s('tp-max-tokens').value     = prof.maxTokens||4096;
        if(s('tp-temperature'))    s('tp-temperature').value    = prof.temperature??0.7;
        if(s('tp-temp-label'))     s('tp-temp-label').textContent= String(prof.temperature??0.7);
        if(s('tp-system-prompt'))  s('tp-system-prompt').value  = cfg.systemPrompt||DEFAULT_SYSTEM_PROMPT;
        if(s('tp-theme-url'))      s('tp-theme-url').value      = cfg.themeUrl||'';
        updateUrlHint();
        if(!modelsFetched&&prof.apiKey&&prof.apiUrl) connectAndFetchModels(false);
        else if(modelsFetched){setApiStatus('ok');const mc=s('tp-model-card-fetched');if(mc)mc.style.display='block';}
        else if(prof.model&&prof.apiKey) setApiStatus('manual');
        else setApiStatus('idle');
        renderHistory();
        if(cfg.themeUrl) loadExternalTheme(cfg.themeUrl);
    }

    // ── 刷新档位下拉 ────────────────────────────────────────────────────────
    function rebuildProfileSelect(){
        const sel=document.getElementById('tp-profile-select'); if(!sel) return;
        sel.innerHTML='';
        cfg.profiles.forEach((p,i)=>{const opt=document.createElement('option');opt.value=i;opt.textContent=p.name||('配置'+(i+1));if(i===cfg.activeProfile)opt.selected=true;sel.appendChild(opt);});
    }

    // ── 绑定弹窗事件 ─────────────────────────────────────────────────────────
    function bindPopupEvents(){
        const on=(id,ev,fn)=>{const el=document.getElementById(id);if(el)el.addEventListener(ev,fn);};
        const onQ=(sel,ev,fn)=>document.querySelectorAll(sel).forEach(el=>el.addEventListener(ev,fn));

        onQ('.tp-tab','click',function(){
            document.querySelectorAll('.tp-tab').forEach(t=>t.classList.remove('active'));
            document.querySelectorAll('.tp-view').forEach(v=>v.classList.remove('active'));
            this.classList.add('active');
            const v=document.getElementById('tp-view-'+this.dataset.tab); if(v) v.classList.add('active');
        });

        onQ('.tp-chip','click',function(){
            document.querySelectorAll('.tp-chip').forEach(c=>c.classList.remove('active'));
            this.classList.add('active'); cfg.style=this.dataset.style;
            const b=document.getElementById('tp-custom-style-box'); if(b)b.style.display=cfg.style==='custom'?'block':'none';
            saveSettings();
        });
        on('tp-custom-style','input',function(){cfg.customStyle=this.value;saveSettings();});
        on('tp-intensity','input',function(){
            cfg.intensity=parseInt(this.value);
            const l=document.getElementById('tp-intensity-label'); if(l)l.textContent=(INTENSITY[cfg.intensity]||INTENSITY[3]).label;
            saveSettings();
        });
        onQ('.tp-preset-tag:not(.tp-model-quick)','click',function(){
            const p=this.dataset.preset; if(!p) return;
            if(selPresets.has(p)){selPresets.delete(p);this.classList.remove('active');}else{selPresets.add(p);this.classList.add('active');}
        });
        on('tp-extra-note','input',function(){cfg.extraNote=this.value;saveSettings();});
        on('tp-input','input',updateCharCount);

        // 导入按钮
        on('tp-import-chat-btn','click',importFromChatInput);
        on('tp-import-btn','click',importLastMessage);
        on('tp-clear-input-btn','click',()=>{
            const el=document.getElementById('tp-input'); if(el) el.value=''; updateCharCount();
            const rs=document.getElementById('tp-result-section'); if(rs) rs.style.display='none'; currentResult='';
        });

        // 停止/润色
        on('tp-stop-btn','click',()=>abortController?.abort());
        on('tp-run-btn','click',()=>{
            const el=document.getElementById('tp-input'), text=el?.value?.trim();
            if(!text){showToast('请输入要润色的文字','warning');return;}
            inputSnapshot=text; runPolish(buildPolishPrompt(text),text);
        });
        on('tp-reuse-btn','click',()=>{
            if(!currentResult) return;
            const el=document.getElementById('tp-input'); if(el){el.value=currentResult;updateCharCount();}
            const rs=document.getElementById('tp-result-section'); if(rs) rs.style.display='none';
            inputSnapshot=currentResult; currentResult='';
        });
        on('tp-copy-btn','click',()=>{if(!currentResult)return;navigator.clipboard.writeText(currentResult).then(()=>showToast('已复制到剪贴板','success'));});
        on('tp-send-btn','click',()=>{
            if(!currentResult) return;
            const st=document.getElementById('send_textarea');
            if(st){st.value=currentResult;st.dispatchEvent(new Event('input',{bubbles:true}));showToast('已发送到输入框','success');}
            else showToast('找不到 ST 输入框','warning');
        });
        on('tp-compare-btn','click',()=>{
            if(!currentResult||!inputSnapshot){showToast('暂无可对比的内容','warning');return;}
            renderDiff(inputSnapshot,currentResult);
        });
        on('tp-refine-btn','click',async()=>{
            if(isStreaming) return;
            const re=document.getElementById('tp-refine-input'), inst=re?.value?.trim();
            if(!inst){showToast('请输入修改意见','warning');return;}
            if(!currentResult){showToast('没有可润色的结果','warning');return;}
            lastRefineReq=inst; const old=currentResult; inputSnapshot=old;
            await runPolish(buildRefinePrompt(old,inst),null);
            if(currentResult&&currentResult!==old) renderDiff(old,currentResult);
            if(re) re.value='';
        });

        // 历史折叠
        on('tp-history-toggle','click',()=>{
            const b=document.getElementById('tp-history-body'), a=document.querySelector('.tp-history-arrow'); if(!b) return;
            const open=b.style.display==='none'||!b.style.display;
            b.style.display=open?'block':'none'; if(a)a.style.transform=open?'rotate(180deg)':'rotate(0)';
        });

        // API Tab
        on('tp-api-type','change',function(){activeProf().apiType=this.value;updateUrlHint();modelsFetched=false;saveSettings();});
        on('tp-connect-btn','click',()=>{
            const p=activeProf();
            const ue=document.getElementById('tp-api-url'),ke=document.getElementById('tp-api-key'),te=document.getElementById('tp-api-type');
            if(ue)p.apiUrl=cleanApiUrl(ue.value); if(ke)p.apiKey=ke.value.trim(); if(te)p.apiType=te.value;
            connectAndFetchModels(true);
        });
        on('tp-api-url','change',function(){activeProf().apiUrl=cleanApiUrl(this.value);saveSettings();});
        on('tp-api-key','change',function(){activeProf().apiKey=this.value.trim();saveSettings();});
        on('tp-model-select','change',function(){
            activeProf().model=this.value;
            const me=document.getElementById('tp-model-manual'); if(me)me.value=this.value;
            saveSettings();
        });
        on('tp-model-manual','input',function(){activeProf().model=this.value.trim();});
        on('tp-model-manual','change',function(){activeProf().model=this.value.trim();saveSettings();});
        onQ('.tp-model-quick','click',function(){
            const m=this.dataset.model; if(!m) return;
            activeProf().model=m;
            const me=document.getElementById('tp-model-manual'); if(me)me.value=m;
            saveSettings(); showToast('已选择模型：'+m,'info');
        });
        on('tp-max-tokens','change',function(){activeProf().maxTokens=parseInt(this.value)||4096;saveSettings();});
        on('tp-temperature','input',function(){
            activeProf().temperature=parseFloat(this.value);
            const l=document.getElementById('tp-temp-label'); if(l)l.textContent=activeProf().temperature.toFixed(1);
            saveSettings();
        });

        // 档位管理
        on('tp-profile-select','change',function(){
            cfg.activeProfile=parseInt(this.value)||0; modelsFetched=false; saveSettings();
            const p=activeProf(), s=id=>document.getElementById(id);
            if(s('tp-profile-name'))  s('tp-profile-name').value  = p.name||'';
            if(s('tp-api-type'))      s('tp-api-type').value      = p.apiType||'openai';
            if(s('tp-api-url'))       s('tp-api-url').value       = p.apiUrl||'';
            if(s('tp-api-key'))       s('tp-api-key').value       = p.apiKey||'';
            if(s('tp-model-manual'))  s('tp-model-manual').value  = p.model||'';
            if(s('tp-max-tokens'))    s('tp-max-tokens').value    = p.maxTokens||4096;
            if(s('tp-temperature'))   s('tp-temperature').value   = p.temperature??0.7;
            if(s('tp-temp-label'))    s('tp-temp-label').textContent=String(p.temperature??0.7);
            const fc=s('tp-model-card-fetched'); if(fc) fc.style.display='none';
            updateUrlHint(); setApiStatus(p.model&&p.apiKey?'manual':'idle');
            showToast('已切换到：'+p.name,'info');
        });
        on('tp-profile-save-btn','click',()=>{
            const ne=document.getElementById('tp-profile-name'), p=activeProf();
            p.name=(ne?.value||'配置'+(cfg.activeProfile+1)).trim(); saveSettings();
            const sel=document.getElementById('tp-profile-select');
            if(sel){const opt=sel.options[cfg.activeProfile];if(opt)opt.textContent=p.name;}
            showToast('档位名称已保存','success');
        });
        on('tp-profile-add-btn','click',()=>{
            if(cfg.profiles.length>=MAX_PROFILES){showToast('最多保存 '+MAX_PROFILES+' 个档位','warning');return;}
            cfg.profiles.push(Object.assign({},DEFAULT_PROFILE,{name:'配置'+(cfg.profiles.length+1)}));
            cfg.activeProfile=cfg.profiles.length-1; modelsFetched=false; saveSettings();
            rebuildProfileSelect();
            const sel=document.getElementById('tp-profile-select');
            if(sel){sel.value=cfg.activeProfile;sel.dispatchEvent(new Event('change'));}
            showToast('已新建档位','success');
        });
        on('tp-profile-del-btn','click',()=>{
            if(cfg.profiles.length<=1){showToast('至少保留一个档位','warning');return;}
            cfg.profiles.splice(cfg.activeProfile,1);
            cfg.activeProfile=Math.max(0,cfg.activeProfile-1); modelsFetched=false; saveSettings();
            rebuildProfileSelect();
            const sel=document.getElementById('tp-profile-select');
            if(sel){sel.value=cfg.activeProfile;sel.dispatchEvent(new Event('change'));}
            showToast('已删除档位','success');
        });

        // Prompt Tab
        on('tp-prompt-save-btn','click',()=>{
            const el=document.getElementById('tp-system-prompt');
            cfg.systemPrompt=(el?.value||'').trim()||DEFAULT_SYSTEM_PROMPT;
            saveSettings(); showToast('Prompt 已保存','success');
        });
        on('tp-prompt-reset-btn','click',()=>{
            if(!confirm('确定恢复默认 System Prompt？')) return;
            cfg.systemPrompt=DEFAULT_SYSTEM_PROMPT;
            const el=document.getElementById('tp-system-prompt'); if(el)el.value=DEFAULT_SYSTEM_PROMPT;
            saveSettings(); showToast('已恢复默认 Prompt','success');
        });

        // 主题 Tab
        onQ('.tp-theme-chip','click',function(){
            document.querySelectorAll('.tp-theme-chip').forEach(c=>c.classList.remove('active'));
            this.classList.add('active'); applyBuiltinTheme(this.dataset.theme||'');
        });
        on('tp-theme-load-btn','click',()=>{const ue=document.getElementById('tp-theme-url');loadExternalTheme(ue?.value?.trim()||'');});
        on('tp-theme-clear-btn','click',()=>{
            const ue=document.getElementById('tp-theme-url'); if(ue)ue.value='';
            removeExternalTheme(); cfg.themeUrl=''; saveSettings();
            const se=document.getElementById('tp-theme-status'); if(se)se.style.display='none';
            showToast('外部主题已清除','info');
        });

        // Diff
        onQ('.tp-diff-mode-btn','click',function(){
            const m=document.getElementById('tp-diff-merge'); if(!m) return;
            if(this.classList.contains('active')){this.classList.remove('active');m.className='tp-diff-merge-view';const h=document.getElementById('tp-diff-hint');if(h)h.style.display='';return;}
            document.querySelectorAll('.tp-diff-mode-btn').forEach(b=>b.classList.remove('active'));
            this.classList.add('active'); m.className='tp-diff-merge-view tp-diff-mode-'+this.dataset.mode;
            const h=document.getElementById('tp-diff-hint'); if(h)h.style.display='none';
        });
        const mergeEl=document.getElementById('tp-diff-merge');
        if(mergeEl){
            mergeEl.addEventListener('click',function(e){
                const el=e.target; if(this.className.includes('tp-diff-mode-')) return;
                const idx=parseInt(el.dataset.idx); if(isNaN(idx)||!diffBlocks[idx]||diffBlocks[idx].type!=='diff') return;
                if(el.classList.contains('tp-idiff-old')&&!el.classList.contains('active')){
                    diffBlocks[idx].active='old'; el.classList.add('active');el.classList.remove('inactive');
                    const s=el.nextElementSibling; if(s?.classList.contains('tp-idiff-new')){s.classList.add('inactive');s.classList.remove('active');}
                }else if(el.classList.contains('tp-idiff-new')&&!el.classList.contains('active')){
                    diffBlocks[idx].active='new'; el.classList.add('active');el.classList.remove('inactive');
                    const s=el.previousElementSibling; if(s?.classList.contains('tp-idiff-old')){s.classList.add('inactive');s.classList.remove('active');}
                }
            });
        }
        on('tp-diff-cancel','click',()=>{const ov=document.getElementById('tp-diff-overlay');if(ov)ov.style.display='none';});
        on('tp-diff-confirm','click',()=>{
            const final=assembleDiff(); currentResult=final;
            const re=document.getElementById('tp-result-content'); if(re){re.textContent=final;re.style.color='';}
            const ov=document.getElementById('tp-diff-overlay'); if(ov)ov.style.display='none';
            showToast('修改已应用','success');
        });
        on('tp-diff-reroll','click',async()=>{
            if(isStreaming||!lastRefineReq||!inputSnapshot) return;
            const old=inputSnapshot; await runPolish(buildRefinePrompt(old,lastRefineReq),null);
            if(currentResult) renderDiff(old,currentResult);
        });
    }

    // ── 弹窗 HTML ─────────────────────────────────────────────────────────────
    function buildPopupHtml(){
        let profileOpts='';
        (cfg.profiles||[]).forEach((p,i)=>{profileOpts+='<option value="'+i+'"'+(i===(cfg.activeProfile||0)?' selected':'')+'>'+_esc(p.name||'配置'+(i+1))+'</option>';});
        const prof=activeProf();
        let modelQuicks='';
        POPULAR_MODELS.forEach(g=>{ g.models.slice(0,2).forEach(m=>{modelQuicks+='<div class="tp-preset-tag tp-model-quick" data-model="'+m+'">'+m+'</div>';}); });
        return '<div class="tp-wrapper">'
            +'<div class="tp-tabs">'
            +'<div class="tp-tab active" data-tab="polish">✦ 润色</div>'
            +'<div class="tp-tab" data-tab="api">⚙ API</div>'
            +'<div class="tp-tab" data-tab="prompt">📝 Prompt</div>'
            +'<div class="tp-tab" data-tab="theme">🎨 主题</div>'
            +'</div>'
            +'<div class="tp-relative" style="flex:1;display:flex;flex-direction:column;overflow:hidden;">'

            // ── 润色 Tab ──
            +'<div id="tp-view-polish" class="tp-view active"><div class="tp-scroll">'
            +'<div class="tp-card"><div class="tp-card-title">润色风格</div>'
            +'<div class="tp-style-grid">'
            +'<div class="tp-chip active" data-style="literary"><span class="tp-chip-icon">🖋</span><span class="tp-chip-name">文学叙事</span></div>'
            +'<div class="tp-chip" data-style="poetic"><span class="tp-chip-icon">🌙</span><span class="tp-chip-name">诗意朦胧</span></div>'
            +'<div class="tp-chip" data-style="elegant"><span class="tp-chip-icon">🏛</span><span class="tp-chip-name">古典雅致</span></div>'
            +'<div class="tp-chip" data-style="romantic"><span class="tp-chip-icon">🌹</span><span class="tp-chip-name">浪漫细腻</span></div>'
            +'<div class="tp-chip" data-style="dramatic"><span class="tp-chip-icon">⚡</span><span class="tp-chip-name">戏剧张力</span></div>'
            +'<div class="tp-chip" data-style="minimalist"><span class="tp-chip-icon">◻</span><span class="tp-chip-name">极简冷峻</span></div>'
            +'<div class="tp-chip" data-style="fantasy"><span class="tp-chip-icon">✨</span><span class="tp-chip-name">奇幻绮丽</span></div>'
            +'<div class="tp-chip" data-style="dark"><span class="tp-chip-icon">🌑</span><span class="tp-chip-name">暗黑哥特</span></div>'
            +'<div class="tp-chip" data-style="custom"><span class="tp-chip-icon">🎨</span><span class="tp-chip-name">自定义</span></div>'
            +'</div>'
            +'<div id="tp-custom-style-box" style="display:none;margin-top:8px;"><input id="tp-custom-style" type="text" class="tp-input" placeholder="描述你想要的风格…"></div>'
            +'<div class="tp-divider"></div>'
            +'<div class="tp-card-title" style="margin-bottom:8px;">润色强度</div>'
            +'<div class="tp-intensity-row">'
            +'<span class="tp-intensity-tip">轻微</span>'
            +'<input id="tp-intensity" type="range" min="1" max="5" value="3" step="1">'
            +'<span class="tp-intensity-tip">重塑</span>'
            +'<span id="tp-intensity-label" class="tp-intensity-val">均衡</span>'
            +'</div></div>'

            +'<div class="tp-card"><div class="tp-card-title">快速预设 <span class="tp-hint">（可多选）</span></div>'
            +'<div class="tp-preset-row">'
            +'<div class="tp-preset-tag" data-preset="保留原有人称视角">保留人称视角</div>'
            +'<div class="tp-preset-tag" data-preset="增加感官细节描写">增加感官细节</div>'
            +'<div class="tp-preset-tag" data-preset="加强动作节奏感">加强动作节奏</div>'
            +'<div class="tp-preset-tag" data-preset="深化角色内心独白">深化内心独白</div>'
            +'<div class="tp-preset-tag" data-preset="使用更多修辞手法">增加修辞手法</div>'
            +'<div class="tp-preset-tag" data-preset="让结尾更有余韵">结尾有余韵</div>'
            +'<div class="tp-preset-tag" data-preset="控制在原文长度的1.5倍以内">控制篇幅</div>'
            +'<div class="tp-preset-tag" data-preset="适合小说正文风格">小说正文风</div>'
            +'</div>'
            +'<input id="tp-extra-note" type="text" class="tp-input" style="margin-top:8px;" placeholder="其他要求（可选）…"></div>'

            +'<div class="tp-card"><div class="tp-card-title">待润色文本</div>'
            +'<textarea id="tp-input" class="tp-textarea" rows="5" placeholder="在这里输入待润色的文字…"></textarea>'
            +'<div class="tp-row" style="margin-top:8px;flex-wrap:wrap;gap:6px;">'
            +'<span id="tp-char-count" class="tp-char-count">0 字</span>'
            +'<div style="display:flex;gap:6px;margin-left:auto;flex-wrap:wrap;">'
            +'<button id="tp-import-chat-btn" class="tp-btn tp-btn-ghost" title="导入 ST 当前输入框的文字"><i class="fa-solid fa-keyboard"></i> 导入输入框</button>'
            +'<button id="tp-import-btn" class="tp-btn tp-btn-ghost" title="导入最新 AI 消息"><i class="fa-solid fa-file-import"></i> 导入消息</button>'
            +'<button id="tp-clear-input-btn" class="tp-btn tp-btn-ghost"><i class="fa-solid fa-eraser"></i> 清空</button>'
            +'</div></div></div>'

            +'<div id="tp-result-section" style="display:none;"><div class="tp-card">'
            +'<div class="tp-result-header"><span class="tp-result-tag"><i class="fa-solid fa-wand-magic-sparkles"></i> 润色结果</span>'
            +'<div class="tp-result-actions">'
            +'<button id="tp-stop-btn" class="tp-btn tp-btn-danger" style="display:none;padding:5px 10px;font-size:0.8rem;"><i class="fa-solid fa-stop"></i> 停止</button>'
            +'<button id="tp-compare-btn" class="tp-btn tp-btn-ghost" style="padding:5px 10px;font-size:0.8rem;">对比</button>'
            +'<button id="tp-copy-btn" class="tp-btn tp-btn-ghost" style="padding:5px 10px;font-size:0.8rem;"><i class="fa-solid fa-copy"></i> 复制</button>'
            +'<button id="tp-send-btn" class="tp-btn tp-btn-ghost" style="padding:5px 10px;font-size:0.8rem;"><i class="fa-solid fa-arrow-up-from-bracket"></i> 发送</button>'
            +'</div></div>'
            +'<div id="tp-loading" class="tp-loading" style="display:none;"><span></span><span></span><span></span><em>AI 润色中…</em></div>'
            +'<div id="tp-result-content" class="tp-result-content"></div>'
            +'<div class="tp-divider"></div>'
            +'<div style="font-size:0.8rem;opacity:0.65;margin-bottom:5px;">对结果不满意？输入修改意见：</div>'
            +'<div class="tp-refine-area">'
            +'<textarea id="tp-refine-input" class="tp-textarea tp-refine-input" placeholder="例如：语气更强硬、去掉心理描写…"></textarea>'
            +'<button id="tp-refine-btn" class="tp-btn tp-btn-primary tp-btn-icon"><i class="fa-solid fa-magic"></i></button>'
            +'</div></div></div>'

            // 历史（折叠）
            +'<div class="tp-card" id="tp-history-card">'
            +'<div class="tp-history-toggle" id="tp-history-toggle">'
            +'<span class="tp-card-title" style="margin:0;"><i class="fa-solid fa-clock-rotate-left" style="font-size:0.8rem;"></i> 润色历史 <span class="tp-hint">（最近 '+MAX_HISTORY+' 条）</span></span>'
            +'<i class="fa-solid fa-chevron-down tp-history-arrow"></i>'
            +'</div>'
            +'<div id="tp-history-body" style="display:none;margin-top:10px;">'
            +'<div id="tp-history-list"></div>'
            +'<div id="tp-history-empty" class="tp-hint" style="text-align:center;padding:12px 0;">暂无历史记录</div>'
            +'</div></div>'

            +'</div>'// end tp-scroll
            +'<div class="tp-footer">'
            +'<div class="tp-footer-left"><button id="tp-reuse-btn" class="tp-btn tp-btn-ghost"><i class="fa-solid fa-rotate-left"></i> 再次润色</button></div>'
            +'<div class="tp-footer-right"><button id="tp-run-btn" class="tp-btn tp-btn-primary"><i class="fa-solid fa-wand-magic-sparkles"></i> 开始润色</button></div>'
            +'</div>'
            +'</div>'// end tp-view-polish

            // ── API Tab ──
            +'<div id="tp-view-api" class="tp-view"><div class="tp-scroll">'
            +'<div class="tp-card"><div class="tp-card-title">API 配置档位</div>'
            +'<div class="tp-row"><label class="tp-label">当前档位</label><select id="tp-profile-select" class="tp-select">'+profileOpts+'</select></div>'
            +'<div class="tp-row" style="gap:6px;">'
            +'<input id="tp-profile-name" type="text" class="tp-input" placeholder="档位名称" value="'+_esc(prof.name||'默认配置')+'">'
            +'<button id="tp-profile-save-btn" class="tp-btn tp-btn-primary tp-btn-icon" title="保存名称"><i class="fa-solid fa-floppy-disk"></i></button>'
            +'<button id="tp-profile-add-btn" class="tp-btn tp-btn-ghost tp-btn-icon" title="新建档位"><i class="fa-solid fa-plus"></i></button>'
            +'<button id="tp-profile-del-btn" class="tp-btn tp-btn-danger tp-btn-icon" title="删除档位"><i class="fa-solid fa-trash"></i></button>'
            +'</div>'
            +'<div class="tp-hint" style="margin-top:4px;">最多保存 '+MAX_PROFILES+' 个档位，切换后立即生效</div>'
            +'</div>'

            +'<div class="tp-card"><div class="tp-card-title">API 连接</div>'
            +'<div class="tp-row"><label class="tp-label">API 类型</label>'
            +'<select id="tp-api-type" class="tp-select">'
            +'<option value="openai"'+(prof.apiType!=='anthropic'?' selected':'')+'>OpenAI 兼容（中转 API）</option>'
            +'<option value="anthropic"'+(prof.apiType==='anthropic'?' selected':'')+'>Anthropic 原生</option>'
            +'</select></div>'
            +'<div class="tp-row"><label class="tp-label">API 地址</label><input id="tp-api-url" type="text" class="tp-input" placeholder="https://api.example.com" value="'+_esc(prof.apiUrl||'')+'"></div>'
            +'<div id="tp-url-hint" class="tp-hint" style="margin:-4px 0 6px 68px;">中转 API 填写服务商地址，无需加 /v1 后缀</div>'
            +'<div class="tp-row"><label class="tp-label">API 密钥</label><input id="tp-api-key" type="password" class="tp-input" placeholder="sk-…" autocomplete="off" value="'+_esc(prof.apiKey||'')+'"></div>'
            +'<div class="tp-row" style="justify-content:flex-end;"><button id="tp-connect-btn" class="tp-btn tp-btn-primary"><i class="fa-solid fa-plug"></i> 连接并获取模型</button></div>'
            +'<div id="tp-api-status" class="tp-api-status idle">● 未连接</div>'
            +'</div>'

            +'<div class="tp-card"><div class="tp-card-title">模型设置</div>'
            +'<div id="tp-model-card-fetched" style="display:none;">'
            +'<div class="tp-row"><label class="tp-label">在线模型</label><select id="tp-model-select" class="tp-select"></select></div>'
            +'<div id="tp-model-hint" style="font-size:0.76rem;opacity:0.5;margin:4px 0 8px;"></div>'
            +'<div class="tp-divider"></div>'
            +'</div>'
            +'<div class="tp-row"><label class="tp-label">当前模型</label><input id="tp-model-manual" type="text" class="tp-input" placeholder="直接输入模型 ID" value="'+_esc(prof.model||'')+'"></div>'
            +'<div style="margin-top:8px;"><div class="tp-hint" style="margin-bottom:6px;"><i class="fa-solid fa-bolt"></i> 常用模型快速填入：</div>'
            +'<div class="tp-preset-row">'+modelQuicks+'</div></div>'
            +'</div>'

            +'<div class="tp-card"><div class="tp-card-title">生成参数</div>'
            +'<div class="tp-row"><label class="tp-label">最大输出</label><input id="tp-max-tokens" type="number" class="tp-input" min="256" max="32768" step="256" value="'+(prof.maxTokens||4096)+'" style="max-width:120px;"><span class="tp-hint">tokens</span></div>'
            +'<div class="tp-row" style="margin-top:4px;"><label class="tp-label">温度</label><input id="tp-temperature" type="range" min="0" max="1.5" value="'+(prof.temperature??0.7)+'" step="0.1" style="flex:1;accent-color:var(--SmartThemeQuoteColor);"><span id="tp-temp-label" class="tp-intensity-val" style="min-width:36px;">'+(prof.temperature??0.7).toFixed(1)+'</span></div>'
            +'<div class="tp-hint" style="margin-top:2px;">低温度更稳定，高温度更有创意</div>'
            +'</div>'
            +'</div></div>'// end tp-view-api

            // ── Prompt Tab ──
            +'<div id="tp-view-prompt" class="tp-view"><div class="tp-scroll">'
            +'<div class="tp-card"><div class="tp-card-title">System Prompt 编辑</div>'
            +'<div class="tp-hint" style="margin-bottom:10px;line-height:1.6;">此处编辑发送给 AI 的系统提示词，影响所有润色请求。留空则使用默认提示词。</div>'
            +'<textarea id="tp-system-prompt" class="tp-textarea" rows="8" style="font-family:monospace;font-size:0.84rem;" placeholder="输入自定义 System Prompt…">'+_esc(cfg.systemPrompt||DEFAULT_SYSTEM_PROMPT)+'</textarea>'
            +'<div class="tp-row" style="margin-top:10px;justify-content:flex-end;gap:8px;">'
            +'<button id="tp-prompt-reset-btn" class="tp-btn tp-btn-ghost"><i class="fa-solid fa-rotate-left"></i> 恢复默认</button>'
            +'<button id="tp-prompt-save-btn" class="tp-btn tp-btn-primary"><i class="fa-solid fa-floppy-disk"></i> 保存</button>'
            +'</div></div>'
            +'<div class="tp-card"><div class="tp-card-title">使用说明</div>'
            +'<div class="tp-hint" style="line-height:2;">System Prompt 告诉 AI「你是谁」以及「输出规范」。<br>具体的风格/强度/预设要求会自动附加到 User 消息中，无需手动写入此处。</div>'
            +'</div>'
            +'</div></div>'// end tp-view-prompt

            // ── 主题 Tab ──
            +'<div id="tp-view-theme" class="tp-view"><div class="tp-scroll">'
            +'<div class="tp-card"><div class="tp-card-title">内置主题</div>'
            +'<div class="tp-preset-row" id="tp-builtin-themes">'
            +'<div class="tp-preset-tag tp-theme-chip active" data-theme="">默认</div>'
            +'<div class="tp-preset-tag tp-theme-chip" data-theme="dark-ink">暗墨</div>'
            +'<div class="tp-preset-tag tp-theme-chip" data-theme="warm-paper">暖纸</div>'
            +'<div class="tp-preset-tag tp-theme-chip" data-theme="forest">松风</div>'
            +'</div></div>'
            +'<div class="tp-card"><div class="tp-card-title">外部主题（URL 加载）</div>'
            +'<div class="tp-hint" style="margin-bottom:8px;line-height:1.6;">填写可访问的 CSS 文件 URL，点击加载后将注入当前页面。</div>'
            +'<div class="tp-row"><input id="tp-theme-url" type="text" class="tp-input" placeholder="https://example.com/my-theme.css" value="'+_esc(cfg.themeUrl||'')+'"></div>'
            +'<div class="tp-row" style="justify-content:flex-end;gap:8px;margin-top:4px;">'
            +'<button id="tp-theme-clear-btn" class="tp-btn tp-btn-ghost"><i class="fa-solid fa-xmark"></i> 清除</button>'
            +'<button id="tp-theme-load-btn" class="tp-btn tp-btn-primary"><i class="fa-solid fa-cloud-arrow-down"></i> 加载</button>'
            +'</div>'
            +'<div id="tp-theme-status" style="display:none;margin-top:8px;font-size:0.82rem;padding:6px 10px;border-radius:6px;"></div>'
            +'</div>'
            +'<div class="tp-card"><div class="tp-card-title">主题说明</div>'
            +'<div class="tp-hint" style="line-height:1.8;">外部 CSS 以 &lt;style&gt; 标签注入页面，支持任意 CSS 变量覆盖。<br>推荐覆盖 --SmartThemeQuoteColor、--SmartThemeBorderColor 等 ST 变量。</div>'
            +'</div>'
            +'</div></div>'// end tp-view-theme

            // Diff overlay
            +'<div id="tp-diff-overlay" class="tp-diff-overlay" style="display:none;">'
            +'<div class="tp-diff-toolbar">'
            +'<span class="tp-diff-hint" id="tp-diff-hint"><i class="fa-solid fa-circle-info"></i> 点击高亮文字切换保留版本</span>'
            +'<button class="tp-diff-mode-btn" data-mode="old"><i class="fa-solid fa-file-lines"></i> 原文</button>'
            +'<button class="tp-diff-mode-btn" data-mode="new"><i class="fa-solid fa-file-circle-plus"></i> 新版</button>'
            +'<button class="tp-diff-mode-btn" data-mode="final"><i class="fa-solid fa-eye"></i> 最终</button>'
            +'</div>'
            +'<div class="tp-diff-content"><div id="tp-diff-merge" class="tp-diff-merge-view" contenteditable="false"></div></div>'
            +'<div class="tp-diff-actions">'
            +'<button id="tp-diff-reroll" class="tp-btn tp-btn-ghost"><i class="fa-solid fa-rotate-right"></i> 重新生成</button>'
            +'<div style="flex:1;"></div>'
            +'<button id="tp-diff-cancel" class="tp-btn tp-btn-danger"><i class="fa-solid fa-xmark"></i> 放弃</button>'
            +'<button id="tp-diff-confirm" class="tp-btn tp-btn-primary"><i class="fa-solid fa-check"></i> 应用</button>'
            +'</div></div>'

            +'</div>'// end tp-relative
            +'</div>';// end tp-wrapper
    }

    // ── 打开弹窗 ──────────────────────────────────────────────────────────────
    async function openPopup(){
        loadSettings();
        document.getElementById('tp-fallback-overlay')?.remove();
        const html=buildPopupHtml();
        if(typeof callPopup==='function'){
            callPopup(html,'text','',{wide:true,large:true,okButton:'Close'});
        } else {
            const ov=document.createElement('div'); ov.id='tp-fallback-overlay';
            ov.style.cssText='position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;';
            const box=document.createElement('div');
            box.style.cssText='width:90%;max-width:700px;max-height:90vh;background:var(--SmartThemeBodyColor2,#1e1e2e);border-radius:12px;overflow:hidden;display:flex;flex-direction:column;position:relative;';
            box.innerHTML=html;
            const cb=document.createElement('button'); cb.textContent='关闭';
            cb.style.cssText='margin:8px 16px 12px;padding:7px;border-radius:6px;border:1px solid var(--SmartThemeBorderColor,#555);cursor:pointer;background:transparent;color:inherit;';
            cb.onclick=()=>{abortController?.abort();ov.remove();};
            box.appendChild(cb); ov.appendChild(box);
            ov.addEventListener('click',e=>{if(e.target===ov){abortController?.abort();ov.remove();}});
            document.body.appendChild(ov);
        }
        await new Promise(r=>setTimeout(r,80));
        restoreUI(); bindPopupEvents(); updateCharCount();
    }

    // ── 魔棒按钮 ─────────────────────────────────────────────────────────────
    function addWandButton(){
        if(document.getElementById(WAND_BTN_ID)) return;
        const btn=document.createElement('div'); btn.id=WAND_BTN_ID;
        btn.innerHTML='<i class="fa-solid fa-wand-magic-sparkles"></i> 文字润色';
        btn.title='打开文字润色工坊'; btn.addEventListener('click',openPopup);
        const targets=['#send_form','#chat_input_area','#rightSendForm','#send_textarea'];
        let mounted=false;
        for(const sel of targets){const c=document.querySelector(sel);if(c){c.parentNode.insertBefore(btn,c);mounted=true;break;}}
        if(!mounted) document.body.appendChild(btn);
    }

    function bindGlobalEvents(){
        if(evBound) return; evBound=true;
        if(typeof SillyTavern!=='undefined'&&SillyTavern.getContext){
            try{const ctx=SillyTavern.getContext();if(ctx?.eventSource&&ctx?.eventTypes){ctx.eventSource.on(ctx.eventTypes.APP_READY,addWandButton);ctx.eventSource.on(ctx.eventTypes.MOVABLE_PANELS_RESET,addWandButton);}}catch(_){}
        }
    }

    function init(){loadSettings();addWandButton();bindGlobalEvents();console.log('[文字润色工坊] v2.3 加载完成 ✓');}

    if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',()=>setTimeout(init,600));}
    else{setTimeout(init,600);}

})();
