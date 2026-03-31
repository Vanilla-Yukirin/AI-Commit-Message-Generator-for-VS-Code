import * as vscode from 'vscode';

// API 提供者类型
export type APIProvider = 'openai' | 'claude' | 'azure' | 'custom';

// API 提供者配置接口
interface APIProviderConfig {
    provider: APIProvider;
    apiUrl: string;
    model: string;
    apiKey: string;
}

// 中文提示词 - 严格单条版
const PROMPT_ZH = `将 git diff 中的所有修改**合并**为**唯一一条**符合 Conventional Commits 规范的提交信息。

核心原则: 无论修改了多少文件，最终输出**只能有一个 Header 和一个 Body**。

要求:
- Header: <type>(<scope>): <中文描述，50字内，祈使语气，无句号>
- Scope 选择: 必须将所有修改归纳为一个最主要的 scope，或使用 "project"、"refactor" 等通用词。**严禁**输出多个 Header。
- Body: 必须包含，用 - 列表说明，按逻辑功能归类（如"修复构建问题"、"优化 UI"）。
- **严禁**按文件分段（如 "feat(A): ... feat(B): ..." 是错误的）。
- 忽略纯格式化变动（除非是 style 类型）
- 仅输出提交信息，不要代码块或解释`;

// 英文提示词 - 严格单条版
const PROMPT_EN = `Consolidate ALL changes in the git diff into **A SINGLE** Conventional Commits message.

CORE PRINCIPLE: Regardless of how many files are changed, output **ONLY ONE Header and ONE Body**.

Requirements:
- Header: <type>(<scope>): <English, max 50 chars, imperative, no period>
- Scope: Summarize all changes into one primary scope, or use generic ones like "project", "refactor". **DO NOT** output multiple headers.
- Body: Required, use - bullets, grouped by logical functionality (e.g., "Fix build issues", "Optimize UI").
- **STRICTLY FORBIDDEN** to split by file (e.g., "feat(A): ... feat(B): ..." is WRONG).
- Ignore whitespace-only changes (unless style type)
- Output ONLY the commit message, no code blocks or explanation`;

// 获取 API 提供者配置
function getAPIProviderConfig(): APIProviderConfig {
    const config = vscode.workspace.getConfiguration('ai-commit-message');
    const provider = config.get<string>('apiProvider', 'openai') as APIProvider;
    const apiUrl = config.get<string>('apiUrl', getDefaultApiUrl(provider));
    const model = config.get<string>('model', getDefaultModel(provider));
    const apiKey = config.get<string>('apiKey', '');

    return { provider, apiUrl, model, apiKey };
}

// 获取默认 API URL
function getDefaultApiUrl(provider: APIProvider): string {
    const defaultUrls: Record<APIProvider, string> = {
        'openai': 'https://api.openai.com/v1/chat/completions',
        'claude': 'https://api.anthropic.com/v1/messages',
        'azure': 'https://{resource-name}.openai.azure.com/openai/deployments/{deployment-id}/chat/completions',
        'custom': ''
    };
    return defaultUrls[provider];
}

// 获取默认模型
function getDefaultModel(provider: APIProvider): string {
    const defaultModels: Record<APIProvider, string> = {
        'openai': 'gpt-3.5-turbo',
        'claude': 'claude-3-5-sonnet-20241022',
        'azure': 'gpt-3.5-turbo',
        'custom': ''
    };
    return defaultModels[provider];
}

// 清理可能的代码块标记
function cleanCodeBlock(text: string): string {
    let clean = text.trim();
    if (clean.startsWith('```')) {
        clean = clean.replace(/^```[\w]*\n?/, '').replace(/\n?```$/, '');
    }
    return clean.trim();
}

// 解析 SSE 行，提取文本 chunk（OpenAI/Azure 格式）
function parseOpenAIChunk(line: string): string {
    if (!line.startsWith('data: ')) { return ''; }
    const data = line.slice(6);
    if (data === '[DONE]') { return ''; }
    try {
        const json = JSON.parse(data);
        return json.choices?.[0]?.delta?.content || '';
    } catch {
        return '';
    }
}

// 解析 SSE 行，提取文本 chunk（Claude 格式）
function parseClaudeChunk(line: string): string {
    if (!line.startsWith('data: ')) { return ''; }
    try {
        const json = JSON.parse(line.slice(6));
        if (json.type === 'content_block_delta' && json.delta?.type === 'text_delta') {
            return json.delta.text || '';
        }
    } catch {
        // ignore
    }
    return '';
}

// 读取 SSE 流，通用逻辑
async function readSSEStream(
    body: ReadableStream<Uint8Array>,
    parseChunk: (line: string) => string,
    onChunk: (chunk: string) => void
): Promise<string> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let fullText = '';
    let buffer = '';

    while (true) {
        const { done, value } = await reader.read();
        if (done) { break; }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
            const chunk = parseChunk(line.trimEnd());
            if (chunk) {
                fullText += chunk;
                onChunk(chunk);
            }
        }
    }

    // 处理 buffer 中剩余内容
    if (buffer) {
        const chunk = parseChunk(buffer.trimEnd());
        if (chunk) {
            fullText += chunk;
            onChunk(chunk);
        }
    }

    return cleanCodeBlock(fullText);
}

// 调用 Claude API（流式）
async function callClaudeAPI(
    systemPrompt: string,
    userMessage: string,
    apiUrl: string,
    model: string,
    apiKey: string,
    onChunk: (chunk: string) => void
): Promise<string> {
    const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
            model,
            max_tokens: 1024,
            stream: true,
            system: systemPrompt,
            messages: [{ role: 'user', content: userMessage }]
        })
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Claude API Error: ${response.status} ${response.statusText} - ${errorText}`);
    }

    return readSSEStream(response.body!, parseClaudeChunk, onChunk);
}

// 调用 OpenAI/Azure API（流式）
async function callOpenAICompatibleAPI(
    systemPrompt: string,
    userMessage: string,
    apiUrl: string,
    model: string,
    apiKey: string,
    provider: APIProvider,
    onChunk: (chunk: string) => void
): Promise<string> {
    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
    };

    if (provider === 'azure') {
        headers['api-key'] = apiKey;
    } else {
        headers['Authorization'] = `Bearer ${apiKey}`;
    }

    const response = await fetch(apiUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
            model,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: `Git Diff:\n${userMessage}` }
            ],
            temperature: 0.7,
            stream: true
        })
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API Request Failed: ${response.status} ${response.statusText} - ${errorText}`);
    }

    return readSSEStream(response.body!, parseOpenAIChunk, onChunk);
}

export async function generateCommitMessage(
    diff: string,
    locale: string,
    apiKey: string,
    customInstructions?: string,
    onChunk?: (chunk: string) => void
): Promise<string> {
    const config = vscode.workspace.getConfiguration('ai-commit-message');
    const provider = config.get<string>('apiProvider', 'openai') as APIProvider;
    const apiUrl = config.get<string>('apiUrl', getDefaultApiUrl(provider));
    const model = config.get<string>('model', getDefaultModel(provider));

    if (!apiKey) {
        throw new Error(locale === 'zh'
            ? 'API Key 未提供。'
            : 'API Key is not provided.');
    }

    const systemPrompt = locale === 'zh'
        ? (config.get<string>('promptZH') || PROMPT_ZH)
        : (config.get<string>('promptEN') || PROMPT_EN);

    let userMessage = `Git Diff:\n${diff}`;
    if (customInstructions && customInstructions.trim()) {
        userMessage += `\n\nAdditional Instructions:\n${customInstructions.trim()}`;
    }

    const chunk = onChunk ?? (() => { });

    try {
        if (provider === 'claude') {
            return await callClaudeAPI(systemPrompt, userMessage, apiUrl, model, apiKey, chunk);
        } else {
            return await callOpenAICompatibleAPI(systemPrompt, userMessage, apiUrl, model, apiKey, provider, chunk);
        }
    } catch (error: any) {
        throw new Error(locale === 'zh'
            ? `生成提交消息失败: ${error.message}`
            : `Failed to generate commit message: ${error.message}`);
    }
}
