const os = require('os');
const path = require('path');

const HOME = os.homedir();
const CLAUDE_DIR = path.join(HOME, '.claude');
const STATE_DIR = path.join(CLAUDE_DIR, 'state');
const QUEUE_DIR = path.join(STATE_DIR, 'cheer_queue');
const LOG_DIR = path.join(CLAUDE_DIR, 'logs');
const LOG_FILE = path.join(LOG_DIR, 'cheerleader.log');
const BUDGET_FILE = path.join(STATE_DIR, 'budget.json');
const LAST_INJECTED_FILE = path.join(STATE_DIR, 'last_injected_at.txt');

const PLUGIN_ROOT = path.resolve(__dirname, '..');
const CORPUS_FILE = path.join(PLUGIN_ROOT, 'skills', 'secret-cheeragent', 'corpus.json');

module.exports = {
  HOME, CLAUDE_DIR, STATE_DIR, QUEUE_DIR, LOG_DIR, LOG_FILE,
  BUDGET_FILE, LAST_INJECTED_FILE, PLUGIN_ROOT, CORPUS_FILE
};
