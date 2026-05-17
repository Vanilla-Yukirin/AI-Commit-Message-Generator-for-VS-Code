import { spawn } from 'child_process';
import * as path from 'path';

// 关闭 core.quotepath，让 git 输出 UTF-8 文件名而非 \xxx\xxx 八进制转义；仅本次调用生效
const GIT_BASE_ARGS = ['-c', 'core.quotepath=false'];
const GIT_SPAWN_OPTS = (cwd: string) => ({ cwd, env: { ...process.env, LC_ALL: 'C.UTF-8' } });

export async function getGitDiff(folderPath: string): Promise<string> {
    return new Promise((resolve, reject) => {
        // First try to get staged changes
        const staged = spawn('git', [...GIT_BASE_ARGS, 'diff', '--cached'], GIT_SPAWN_OPTS(folderPath));
        let stdout = '';
        let stderr = '';

        staged.stdout.on('data', (data) => stdout += data);
        staged.stderr.on('data', (data) => stderr += data);

        staged.on('close', (code) => {
            if (code === 0 && stdout.trim().length > 0) {
                resolve(stdout);
            } else {
                // If no staged changes, try to get all changes (optional, based on requirement "next intended commit")
                // For now, let's stick to staged changes or if empty, maybe warn?
                // The original requirement says: "targeting exclusively the staged changes when any files are staged,
                // or otherwise targeting what would be included in the next intended commit"
                // So if staged is empty, we check unstaged.

                const unstaged = spawn('git', [...GIT_BASE_ARGS, 'diff'], GIT_SPAWN_OPTS(folderPath));
                let uStdout = '';
                let uStderr = '';

                unstaged.stdout.on('data', (data) => uStdout += data);
                unstaged.stderr.on('data', (data) => uStderr += data);

                unstaged.on('close', (uCode) => {
                    if (uCode === 0 && uStdout.trim().length > 0) {
                        resolve(uStdout);
                    } else {
                        resolve(''); // No changes found
                    }
                });
            }
        });

        staged.on('error', (err) => {
            reject(err);
        });
    });
}

/**
 * 截断 Git Diff 内容，每个文件保留前 maxLinesPerFile 行
 * @param diff 完整的 Git Diff 字符串
 * @param maxLinesPerFile 每个文件保留的最大行数，默认 10
 * @returns 截断后的 Diff 字符串
 */
export function truncateDiff(diff: string, maxLinesPerFile: number = 10): string {
    // 按文件分割 diff（以 "diff --git" 开头）
    const fileDiffs = diff.split(/(?=diff --git)/);

    const truncatedDiffs = fileDiffs.map(fileDiff => {
        if (!fileDiff.trim()) {
            return '';
        }

        const lines = fileDiff.split('\n');

        if (lines.length <= maxLinesPerFile) {
            return fileDiff;
        }

        // 保留前 maxLinesPerFile 行，并添加截断提示
        const truncatedLines = lines.slice(0, maxLinesPerFile);
        const remainingLines = lines.length - maxLinesPerFile;
        truncatedLines.push(`... (${remainingLines} more lines truncated)`);

        return truncatedLines.join('\n');
    });

    return truncatedDiffs.join('\n');
}
