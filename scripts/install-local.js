#!/usr/bin/env node

const fs = require('fs');
const os = require('os');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const homeDir = os.homedir();
const dryRun = process.argv.includes('--dry-run');

const commands = {
  capture: `node ${path.join(projectRoot, 'hooks', 'capture.js')}`,
  inject: `node ${path.join(projectRoot, 'hooks', 'pretool_inject.js')}`,
  sessionStart: `node ${path.join(projectRoot, 'hooks', 'sessionstart.js')}`
};

function readJson(filepath) {
  try {
    return JSON.parse(fs.readFileSync(filepath, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return {};
    throw new Error(`無法解析 ${filepath}: ${err.message}`);
  }
}

function addHook(settings, eventName, command) {
  settings.hooks ||= {};
  settings.hooks[eventName] ||= [];
  const exists = settings.hooks[eventName].some(group =>
    Array.isArray(group.hooks) && group.hooks.some(hook => hook.command === command)
  );
  if (!exists) {
    settings.hooks[eventName].push({
      hooks: [{ type: 'command', command }]
    });
  }
  return !exists;
}

function writeJson(filepath, data) {
  const rendered = JSON.stringify(data, null, 2) + '\n';
  const previous = fs.existsSync(filepath) ? fs.readFileSync(filepath, 'utf8') : null;
  if (previous === rendered) return false;
  if (dryRun) return true;

  fs.mkdirSync(path.dirname(filepath), { recursive: true });
  if (previous !== null) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    fs.copyFileSync(filepath, `${filepath}.bak-secret-cheeragent-${stamp}`);
  }
  const temporary = `${filepath}.tmp-secret-cheeragent-${process.pid}`;
  fs.writeFileSync(temporary, rendered, { mode: 0o600 });
  fs.renameSync(temporary, filepath);
  return true;
}

function configure(name, filepath, definitions, mutate) {
  const settings = readJson(filepath);
  const added = definitions.filter(([eventName, command]) =>
    addHook(settings, eventName, command)
  ).length;
  mutate?.(settings);
  const changed = writeJson(filepath, settings);
  console.log(`${name}: ${changed ? (dryRun ? '將更新' : '已更新') : '已是最新'}，新增 hooks=${added}`);
}

configure('Claude Code', path.join(homeDir, '.claude', 'settings.json'), [
  ['Stop', commands.capture],
  ['PreToolUse', commands.inject],
  ['SessionStart', commands.sessionStart]
]);

configure('Codex CLI', path.join(homeDir, '.codex', 'hooks.json'), [
  ['Stop', commands.capture],
  ['PreToolUse', commands.inject],
  ['SessionStart', commands.sessionStart]
]);

configure('Gemini CLI', path.join(homeDir, '.gemini', 'settings.json'), [
  ['AfterAgent', commands.capture],
  ['BeforeAgent', commands.inject]
], settings => {
  settings.hooksConfig ||= {};
  settings.hooksConfig.enabled = true;
  settings.hooksConfig.notifications = false;
});

console.log(dryRun ? 'dry-run 完成，未寫入。' : '三模型 hooks 安裝完成。');
