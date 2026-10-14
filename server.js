const http = require('node:http');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');

const HOST = '127.0.0.1';
const PORT = Number(process.env.PORT || 8000);
const ROOT = __dirname;
const DATABASE = path.join(ROOT, 'data', 'timeline.json');
const TEAM_DATABASE = path.join(ROOT, 'data', 'team-runs.json');
const TEAM_AGENTS_DATABASE = path.join(ROOT, 'data', 'team-agents.json');
const CREW_RUNNER = path.join(ROOT, 'crewai', 'marketing_team.py');
const MAX_BODY_BYTES = 1_000_000;
const MAX_TEAM_RUNS = 30;
const TEAM_RUN_TIMEOUT_MS = 900_000;

function loadLocalEnvironment() {
  try {
    const lines = fsSync.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/);
    for (const line of lines) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (!match || match[1] in process.env) continue;
      process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
    }
  } catch (error) {
    if (error.code !== 'ENOENT') console.warn('Could not read local .env file:', error.message);
  }
}

loadLocalEnvironment();
const CREW_PYTHON = process.env.CREWAI_PYTHON || path.join(ROOT, '.crew-env', 'bin', 'python');
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.md': 'text/markdown; charset=utf-8',
  '.ico': 'image/x-icon'
};

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  response.end(JSON.stringify(payload));
}

function isText(value, maxLength = 2000) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maxLength;
}

function isIsoDate(value, year) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value && date.getUTCFullYear() === year;
}

function validRecordBase(record) {
  return record && typeof record === 'object' && isText(record.id, 100) && isText(record.title, 120) && isText(record.description, 2000);
}

function validateTimeline(data) {
  if (!data || typeof data !== 'object' || !Number.isInteger(data.year) || data.year < 2000 || data.year > 2100) {
    return 'The timeline year is invalid.';
  }
  if (!Array.isArray(data.themes) || data.themes.length !== 4) return 'Please provide exactly four seasonal themes.';
  if (!Array.isArray(data.launches) || !Array.isArray(data.campaigns) || !Array.isArray(data.events)) {
    return 'The launches, campaigns, or events list is missing.';
  }
  if (!data.alwaysOn || typeof data.alwaysOn !== 'object') return 'The year-round Always On entry is missing.';
  if (!validRecordBase(data.alwaysOn) || !isIsoDate(data.alwaysOn.start, data.year) || !isIsoDate(data.alwaysOn.end, data.year) || data.alwaysOn.start > data.alwaysOn.end) {
    return 'Check the Always On title, description, and dates.';
  }

  for (const theme of data.themes) {
    if (!theme || !isText(theme.id, 100) || !isText(theme.period, 40) || !isText(theme.name, 80)) {
      return 'Each seasonal theme needs a label and name.';
    }
  }

  const ids = new Set();
  const records = [data.alwaysOn, ...data.launches, ...data.campaigns, ...data.events];
  for (const record of records) {
    if (!validRecordBase(record)) return 'Every entry needs a title and description.';
    if (ids.has(record.id)) return 'Entry IDs must be unique.';
    ids.add(record.id);
  }

  for (const launch of data.launches) {
    if (!isIsoDate(launch.date, data.year) || !isText(launch.subtitle, 180)) return 'Check each launch date and short description.';
    if (!Array.isArray(launch.activities) || launch.activities.length > 20 || launch.activities.some((activity) => !isText(activity, 180))) {
      return 'Launch activities must be a list of up to 20 non-empty items.';
    }
  }

  for (const campaign of data.campaigns) {
    if (!['branding', 'selling'].includes(campaign.lane) || !isIsoDate(campaign.start, data.year) || !isIsoDate(campaign.end, data.year) || campaign.start > campaign.end) {
      return 'Check each campaign lane and date range. Campaign dates must be within the timeline year.';
    }
  }

  for (const event of data.events) {
    if (!isIsoDate(event.date, data.year) || !isText(event.subtitle, 180)) return 'Check each event date and short description.';
  }

  return null;
}

async function readTimeline() {
  return JSON.parse(await fs.readFile(DATABASE, 'utf8'));
}

async function readRequestBody(request) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error('Request is too large.');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function writeTimeline(data) {
  const temporaryPath = `${DATABASE}.tmp`;
  await fs.writeFile(temporaryPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  await fs.rename(temporaryPath, DATABASE);
}

function runCrewProcess(args, input, timeoutMs = 240_000, onProgress = () => {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(CREW_PYTHON, [CREW_RUNNER, ...args], { cwd: ROOT, env: process.env, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stdoutBuffer = '';
    let stderr = '';
    let settled = false;
    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      if (!settled) {
        settled = true;
        reject(new Error('The marketing team run took too long. Please try again with a shorter brief.'));
      }
    }, timeoutMs);

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout = `${stdout}${chunk}`.slice(-1_500_000);
      stdoutBuffer += chunk;
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.startsWith('__CREWAI_EVENT__')) continue;
        try { onProgress(JSON.parse(line.slice('__CREWAI_EVENT__'.length))); } catch {}
      }
    });
    child.stderr.on('data', (chunk) => { stderr = `${stderr}${chunk}`.slice(-12_000); });
    child.on('error', (error) => {
      clearTimeout(timeout);
      if (settled) return;
      settled = true;
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timeout);
      if (settled) return;
      settled = true;
      const resultLine = stdout.split(/\r?\n/).findLast((line) => line.startsWith('__CREWAI_RESULT__'));
      if (!resultLine) {
        reject(new Error(stderr.trim() || `CrewAI process exited with code ${code}.`));
        return;
      }
      try {
        const result = JSON.parse(resultLine.slice('__CREWAI_RESULT__'.length));
        if (result.error) reject(new Error(result.error));
        else resolve(result);
      } catch (error) {
        reject(new Error(`Could not read the CrewAI response: ${error.message}`));
      }
    });
    if (input !== undefined) child.stdin.end(input);
    else child.stdin.end();
  });
}

async function readTeamRuns() {
  try {
    const runs = JSON.parse(await fs.readFile(TEAM_DATABASE, 'utf8'));
    return Array.isArray(runs) ? runs : [];
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function writeTeamRuns(runs) {
  const temporaryPath = `${TEAM_DATABASE}.tmp`;
  await fs.writeFile(temporaryPath, `${JSON.stringify(runs.slice(0, MAX_TEAM_RUNS), null, 2)}\n`, 'utf8');
  await fs.rename(temporaryPath, TEAM_DATABASE);
}

async function readTeamAgents() {
  return JSON.parse(await fs.readFile(TEAM_AGENTS_DATABASE, 'utf8'));
}

async function writeTeamAgents(agents) {
  const temporaryPath = `${TEAM_AGENTS_DATABASE}.tmp`;
  await fs.writeFile(temporaryPath, `${JSON.stringify(agents, null, 2)}\n`, 'utf8');
  await fs.rename(temporaryPath, TEAM_AGENTS_DATABASE);
}

function validateTeamAgents(agents) {
  const expectedIds = ['researcher', 'strategist', 'planner', 'creative', 'copywriter', 'gtm'];
  const fields = { name: 80, specialty: 80, summary: 240, role: 180, goal: 700, backstory: 1000 };
  if (!Array.isArray(agents) || agents.length !== expectedIds.length) return 'The team must contain five specialists and one Go-To-Market Lead.';
  for (const [index, agent] of agents.entries()) {
    if (!agent || agent.id !== expectedIds[index]) return 'Keep the five specialists in their workflow order.';
    for (const [field, maxLength] of Object.entries(fields)) {
      if (!isText(agent[field], maxLength)) return `Complete the ${field} field for ${agent.id}.`;
    }
  }
  return null;
}

function sendEventStream(response, type, payload) {
  response.write(`event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`);
}

function validateTeamBrief(brief) {
  const fields = {
    brand: 120,
    objective: 120,
    audience: 500,
    market: 500,
    offer: 500,
    channels: 300,
    tone: 180,
    constraints: 2000,
    timelineContext: 1800
  };
  if (!brief || typeof brief !== 'object' || Array.isArray(brief)) return 'Please submit a valid campaign brief.';
  for (const [field, maxLength] of Object.entries(fields)) {
    const value = brief[field] ?? '';
    if (typeof value !== 'string' || value.length > maxLength) return `The ${field} field is too long or invalid.`;
    if (['brand', 'objective', 'audience'].includes(field) && !value.trim()) return `Please complete the ${field} field.`;
  }
  return null;
}

async function teamRuntimeStatus() {
  if (!fsSync.existsSync(CREW_PYTHON)) {
    return {
      ready: false,
      pythonReady: false,
      configured: Boolean(process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY !== 'your_openai_api_key_here'),
      model: process.env.OPENAI_MODEL || 'openai/gpt-4o-mini',
      setupGuide: '/CREWAI_SETUP.md'
    };
  }
  try {
    const result = await runCrewProcess(['--status'], undefined, 15_000);
    const configured = Boolean(process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY !== 'your_openai_api_key_here');
    return {
      ready: result.installed === true && configured,
      pythonReady: result.installed === true,
      python: result.python,
      crewaiVersion: result.crewaiVersion,
      configured,
      model: process.env.OPENAI_MODEL || 'openai/gpt-4o-mini',
      setupGuide: '/CREWAI_SETUP.md',
      error: result.error
    };
  } catch (error) {
    return {
      ready: false,
      pythonReady: false,
      configured: Boolean(process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY !== 'your_openai_api_key_here'),
      model: process.env.OPENAI_MODEL || 'openai/gpt-4o-mini',
      setupGuide: '/CREWAI_SETUP.md',
      error: error.message
    };
  }
}

async function serveStatic(pathname, response) {
  const routePath = pathname === '/' ? '/index.html' : pathname === '/admin' ? '/admin.html' : pathname === '/team' ? '/team.html' : pathname;
  const filePath = path.resolve(ROOT, `.${routePath}`);
  if (!filePath.startsWith(`${ROOT}${path.sep}`)) {
    sendJson(response, 403, { error: 'Forbidden.' });
    return;
  }

  const extension = path.extname(filePath).toLowerCase();
  if (!MIME_TYPES[extension] || path.basename(filePath).startsWith('.')) {
    sendJson(response, 404, { error: 'Not found.' });
    return;
  }

  try {
    const contents = await fs.readFile(filePath);
    response.writeHead(200, {
      'Content-Type': MIME_TYPES[extension],
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff'
    });
    response.end(contents);
  } catch {
    sendJson(response, 404, { error: 'Not found.' });
  }
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${HOST}:${PORT}`);
  if (url.pathname === '/api/team/status') {
    if (request.method !== 'GET') {
      response.setHeader('Allow', 'GET');
      sendJson(response, 405, { error: 'Method not allowed.' });
      return;
    }
    sendJson(response, 200, await teamRuntimeStatus());
    return;
  }

  if (url.pathname === '/api/team/agents') {
    if (request.method === 'GET') {
      try {
        sendJson(response, 200, await readTeamAgents());
      } catch (error) {
        console.error('Unable to read marketing team profiles:', error);
        sendJson(response, 500, { error: 'Agent details could not be loaded.' });
      }
      return;
    }
    if (request.method === 'PUT') {
      try {
        const agents = await readRequestBody(request);
        const validationError = validateTeamAgents(agents);
        if (validationError) {
          sendJson(response, 400, { error: validationError });
          return;
        }
        await writeTeamAgents(agents);
        sendJson(response, 200, { saved: true, agents });
      } catch (error) {
        const status = error instanceof SyntaxError || error.message === 'Request is too large.' ? 400 : 500;
        sendJson(response, status, { error: status === 400 ? 'The submitted agent details are invalid or too large.' : 'Agent details could not be saved.' });
      }
      return;
    }
    response.setHeader('Allow', 'GET, PUT');
    sendJson(response, 405, { error: 'Method not allowed.' });
    return;
  }

  if (url.pathname === '/api/team/runs') {
    if (request.method === 'GET') {
      try {
        sendJson(response, 200, await readTeamRuns());
      } catch (error) {
        console.error('Unable to read marketing team history:', error);
        sendJson(response, 500, { error: 'Saved team runs could not be loaded.' });
      }
      return;
    }
    if (request.method === 'POST') {
      try {
        const run = await readRequestBody(request);
        const validationError = validateTeamBrief(run?.brief);
        if (validationError || !Array.isArray(run?.outputs) || run.outputs.length > 10 || run.outputs.some((output) => !output || typeof output.agent !== 'string' || output.agent.length > 120 || typeof output.content !== 'string' || output.content.length > 40_000) || (run.reviewHistory !== undefined && (!Array.isArray(run.reviewHistory) || run.reviewHistory.length > 80))) {
          sendJson(response, 400, { error: validationError || 'The marketing team output is invalid or too large.' });
          return;
        }
        const runs = await readTeamRuns();
        const savedRun = {
          id: randomUUID(),
          createdAt: new Date().toISOString(),
          brief: run.brief,
          outputs: run.outputs,
          reviewHistory: Array.isArray(run.reviewHistory) ? run.reviewHistory : [],
          status: run.status === 'needs_review' ? 'needs_review' : 'approved'
        };
        const updatedRuns = [savedRun, ...runs].slice(0, MAX_TEAM_RUNS);
        await writeTeamRuns(updatedRuns);
        sendJson(response, 201, { saved: true, run: savedRun, runs: updatedRuns });
      } catch (error) {
        const status = error instanceof SyntaxError || error.message === 'Request is too large.' ? 400 : 500;
        sendJson(response, status, { error: status === 400 ? 'The submitted run is invalid or too large.' : 'The marketing team run could not be saved.' });
      }
      return;
    }
    response.setHeader('Allow', 'GET, POST');
    sendJson(response, 405, { error: 'Method not allowed.' });
    return;
  }

  const approvalMatch = url.pathname.match(/^\/api\/team\/runs\/([0-9a-f-]{36})\/approval$/i);
  if (approvalMatch) {
    if (request.method !== 'POST') {
      response.setHeader('Allow', 'POST');
      sendJson(response, 405, { error: 'Method not allowed.' });
      return;
    }
    try {
      const runs = await readTeamRuns();
      const runIndex = runs.findIndex((run) => run.id === approvalMatch[1]);
      if (runIndex === -1) {
        sendJson(response, 404, { error: 'That saved run could not be found.' });
        return;
      }
      const run = runs[runIndex];
      if (run.status !== 'needs_review' && !(run.outputs || []).some((output) => output.reviewStatus === 'needs_review')) {
        sendJson(response, 409, { error: 'Only a run awaiting human review can be approved here.' });
        return;
      }
      if (run.humanApproval?.approvedAt) {
        sendJson(response, 409, { error: 'This run has already been approved.' });
        return;
      }
      run.humanApproval = { approvedAt: new Date().toISOString() };
      run.status = 'human_approved';
      runs[runIndex] = run;
      await writeTeamRuns(runs);
      sendJson(response, 200, { saved: true, run });
    } catch (error) {
      console.error('Unable to record human campaign approval:', error);
      sendJson(response, 500, { error: 'Your approval could not be saved locally.' });
    }
    return;
  }

  if (url.pathname === '/api/team/run') {
    if (request.method !== 'POST') {
      response.setHeader('Allow', 'POST');
      sendJson(response, 405, { error: 'Method not allowed.' });
      return;
    }
    try {
      const brief = await readRequestBody(request);
      const validationError = validateTeamBrief(brief);
      if (validationError) {
        sendJson(response, 400, { error: validationError });
        return;
      }
      if (!process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY === 'your_openai_api_key_here') {
        sendJson(response, 503, { error: 'CrewAI needs an LLM key. Add OPENAI_API_KEY to .env, then restart the app.' });
        return;
      }
      if (!fsSync.existsSync(CREW_PYTHON)) {
        sendJson(response, 503, { error: 'CrewAI is not installed yet. Follow CREWAI_SETUP.md to install its Python environment.' });
        return;
      }
      response.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
        'X-Content-Type-Options': 'nosniff'
      });
      response.write(': crew connected\n\n');
      const result = await runCrewProcess([], JSON.stringify(brief), TEAM_RUN_TIMEOUT_MS, (event) => {
        if (!response.destroyed) sendEventStream(response, 'progress', event);
      });
      if (!response.destroyed) sendEventStream(response, 'complete', {
        id: randomUUID(),
        createdAt: new Date().toISOString(),
        brief,
        outputs: result.outputs,
        reviewHistory: result.reviewHistory || [],
        status: result.status || 'approved',
        model: result.model
      });
      if (!response.destroyed) response.end();
    } catch (error) {
      console.error('Marketing team run failed:', error.message);
      if (response.headersSent) {
        if (!response.destroyed) sendEventStream(response, 'error', { error: error.message || 'The marketing team could not complete this run.' });
        if (!response.destroyed) response.end();
      } else {
        sendJson(response, 502, { error: error.message || 'The marketing team could not complete this run.' });
      }
    }
    return;
  }

  if (url.pathname === '/api/timeline') {
    if (request.method === 'GET') {
      try {
        sendJson(response, 200, await readTimeline());
      } catch (error) {
        console.error('Unable to read timeline data:', error);
        sendJson(response, 500, { error: 'Timeline data could not be loaded.' });
      }
      return;
    }

    if (request.method === 'PUT') {
      try {
        const data = await readRequestBody(request);
        const validationError = validateTimeline(data);
        if (validationError) {
          sendJson(response, 400, { error: validationError });
          return;
        }
        await writeTimeline(data);
        sendJson(response, 200, { saved: true, updatedAt: new Date().toISOString() });
      } catch (error) {
        const status = error instanceof SyntaxError || error.message === 'Request is too large.' ? 400 : 500;
        sendJson(response, status, { error: status === 400 ? 'The submitted data is not valid JSON or is too large.' : 'Timeline data could not be saved.' });
      }
      return;
    }

    response.setHeader('Allow', 'GET, PUT');
    sendJson(response, 405, { error: 'Method not allowed.' });
    return;
  }

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.setHeader('Allow', 'GET, HEAD');
    sendJson(response, 405, { error: 'Method not allowed.' });
    return;
  }

  await serveStatic(decodeURIComponent(url.pathname), response);
});

server.listen(PORT, HOST, () => {
  console.log(`Timeline app running at http://${HOST}:${PORT}`);
  console.log(`Editor: http://${HOST}:${PORT}/admin.html`);
  console.log('This local editor has no sign-in; the server is bound to localhost only.');
});
