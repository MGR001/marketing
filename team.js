const form = document.querySelector('#brief-form');
const runButton = document.querySelector('#run-crew');
const statusBadge = document.querySelector('#crew-status');
const statusText = document.querySelector('#crew-status-text');
const setupLink = document.querySelector('#setup-link');
const emptyState = document.querySelector('#empty-state');
const progress = document.querySelector('#run-progress');
const progressText = document.querySelector('#progress-text');
const errorBox = document.querySelector('#run-error');
const outputList = document.querySelector('#output-list');
const reportFooter = document.querySelector('#report-footer');
const reportMeta = document.querySelector('#report-meta');
const copyButton = document.querySelector('#copy-output');
const historyList = document.querySelector('#history-list');
const historyCount = document.querySelector('#history-count');
const timelineSelect = document.querySelector('#timeline-context');
const downloadButton = document.querySelector('#download-output');
const crewRoster = document.querySelector('#crew-roster');
const reviewActivity = document.querySelector('#review-activity');
const structuredOutputLink = document.querySelector('#open-structured-output');
const agentDialog = document.querySelector('#agent-dialog');
const agentForm = document.querySelector('#agent-form');
const agentSaveStatus = document.querySelector('#agent-save-status');
const crewFlow = document.querySelector('#crew-flow');
let latestRun = null;
let agents = [];
const agentIcons = { researcher: '✳', strategist: '◈', planner: '⌁', creative: '✎', copywriter: '▤', gtm: '◇' };
const agentStates = new Map();

function setStatus(message, state = '') {
  statusText.textContent = message;
  statusBadge.classList.toggle('is-ready', state === 'ready');
  statusBadge.classList.toggle('is-error', state === 'error');
}

function renderAgents() {
  crewRoster.replaceChildren();
  for (const [index, agent] of agents.entries()) {
    const card = document.createElement('button');
    card.className = `agent-card${agent.id === 'gtm' ? ' is-supervisor' : ''}`;
    card.type = 'button';
    card.dataset.agentId = agent.id;
    card.setAttribute('aria-label', `Edit ${agent.name} details`);
    const number = document.createElement('span');
    number.className = 'agent-index';
    number.textContent = String(index + 1).padStart(2, '0');
    const icon = document.createElement('span');
    icon.className = 'agent-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = agentIcons[agent.id] || '✳';
    const name = document.createElement('span');
    name.className = 'agent-card-title';
    name.textContent = agent.name;
    const summary = document.createElement('span');
    summary.className = 'agent-card-summary';
    summary.textContent = agent.summary;
    const specialty = document.createElement('span');
    specialty.className = 'agent-specialty';
    specialty.textContent = agent.specialty;
    const edit = document.createElement('span');
    edit.className = 'agent-edit-hint';
    edit.textContent = 'EDIT DETAILS ↗';
    card.append(number, icon, name, summary, specialty, edit);
    crewRoster.append(card);
  }
}

function renderFlow() {
  crewFlow.replaceChildren();
  for (const [index, agent] of agents.entries()) {
    const state = agentStates.get(agent.id) || 'waiting';
    const stage = document.createElement('div');
    stage.className = `flow-agent${agent.id === 'gtm' ? ' is-supervisor' : ''} is-${state}`;
    const node = document.createElement('span');
    node.className = 'flow-node';
    node.setAttribute('aria-hidden', 'true');
    node.textContent = state === 'done' ? '✓' : state === 'revision' ? '↺' : state === 'needs-review' ? '!' : String(index + 1).padStart(2, '0');
    const name = document.createElement('strong');
    name.textContent = agent.name;
    const label = document.createElement('small');
    label.textContent = state === 'done' ? (agent.id === 'gtm' ? 'GATE PASSED' : 'APPROVED')
      : state === 'running' ? (agent.id === 'gtm' ? 'REVIEWING' : 'WORKING')
        : state === 'revision' ? 'REVISING' : state === 'needs-review' ? 'HUMAN CHECK' : agent.id === 'gtm' ? 'QUALITY GATE' : 'QUEUED';
    stage.append(node, name, label);
    crewFlow.append(stage);
  }
}

async function loadAgents() {
  try {
    const response = await fetch('/api/team/agents', { cache: 'no-store' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not load the team roster.');
    agents = data;
    renderAgents();
  } catch (error) {
    setStatus(error.message, 'error');
  }
}

async function loadStatus() {
  try {
    const response = await fetch('/api/team/status', { cache: 'no-store' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not check CrewAI setup.');
    if (data.ready) {
      setStatus(`CrewAI ready · ${data.model}`, 'ready');
      runButton.disabled = false;
      setupLink.hidden = true;
    } else {
      const message = data.pythonReady
        ? 'Add an LLM API key to enable runs'
        : 'CrewAI setup needed · see setup guide';
      setStatus(message, 'error');
      runButton.disabled = true;
      setupLink.hidden = false;
    }
  } catch {
    setStatus('Could not reach the local CrewAI service', 'error');
    runButton.disabled = true;
    setupLink.hidden = false;
  }
}

function addTimelineOption(label, description, date) {
  const option = document.createElement('option');
  option.textContent = `${date} · ${label}`;
  option.value = `${label}\n${date}\n${description}`.slice(0, 1800);
  timelineSelect.append(option);
}

async function loadTimelineContext() {
  try {
    const response = await fetch('/api/timeline', { cache: 'no-store' });
    if (!response.ok) return;
    const data = await response.json();
    for (const launch of data.launches || []) addTimelineOption(launch.title, launch.description, launch.date);
    for (const campaign of data.campaigns || []) addTimelineOption(campaign.title, campaign.description, `${campaign.start} — ${campaign.end}`);
    for (const event of data.events || []) addTimelineOption(event.title, event.description, event.date);
  } catch {
    // The team workspace can still run without timeline context.
  }
}

function getOutputText(run = latestRun) {
  if (!run) return '';
  return (run.outputs || []).map((output) => `## ${output.agent}\n\n${output.content}`).join('\n\n---\n\n');
}

function renderOutputs(run) {
  latestRun = run;
  outputList.replaceChildren();
  for (const [index, output] of (run.outputs || []).entries()) {
    const card = document.createElement('details');
    card.className = 'output-card';
    card.open = index === 0;
    const summary = document.createElement('summary');
    const title = document.createElement('strong');
    title.textContent = output.agent;
    const tag = document.createElement('span');
    const reviewStatus = output.reviewStatus || 'legacy';
    tag.className = `output-review-tag is-${reviewStatus}`;
    tag.textContent = reviewStatus === 'approved' ? `GTM APPROVED · ${output.reviewIterations?.length || 1} CHECK${(output.reviewIterations?.length || 1) === 1 ? '' : 'S'}`
      : reviewStatus === 'needs_review' ? 'HUMAN REVIEW NEEDED' : `SPECIALIST ${String(index + 1).padStart(2, '0')}`;
    summary.append(title, tag);
    const content = document.createElement('div');
    content.className = 'output-content';
    content.textContent = output.content;
    card.append(summary, content);
    outputList.append(card);
  }
  emptyState.hidden = (run.outputs || []).length > 0;
  reportFooter.hidden = (run.outputs || []).length === 0;
  copyButton.disabled = (run.outputs || []).length === 0;
  reportMeta.textContent = `${run.outputs.length} TEAM DELIVERABLES · ${new Date(run.createdAt).toLocaleString()}`;
  structuredOutputLink.hidden = !run.id;
  if (run.id) structuredOutputLink.href = `/team-output.html?id=${encodeURIComponent(run.id)}`;
  if (run.humanApproval?.approvedAt) {
    errorBox.textContent = `Human sign-off recorded locally on ${new Date(run.humanApproval.approvedAt).toLocaleString()}. The Go-To-Market review remains open; paused specialist work has not resumed.`;
    errorBox.hidden = false;
  } else if (run.status === 'needs_review') {
    errorBox.textContent = 'The Go-To-Market Lead could not approve a deliverable after three automatic corrections. Later stages were paused; open the structured report to review the outstanding feedback.';
    errorBox.hidden = false;
  } else {
    errorBox.hidden = true;
  }
}

function renderHistory(runs) {
  historyList.replaceChildren();
  historyCount.textContent = String(runs.length);
  if (!runs.length) {
    const empty = document.createElement('p');
    empty.className = 'history-empty';
    empty.textContent = 'Completed plans will be saved here on this computer.';
    historyList.append(empty);
    return;
  }
  for (const run of runs) {
    const button = document.createElement('button');
    button.className = 'history-item';
    button.type = 'button';
    const title = document.createElement('strong');
    title.textContent = run.brief?.brand || 'Marketing plan';
    const date = document.createElement('span');
    date.textContent = new Date(run.createdAt).toLocaleDateString();
    button.append(title, date);
    button.addEventListener('click', () => {
      renderOutputs(run);
      document.querySelector('#output-title').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    historyList.append(button);
  }
}

async function loadHistory() {
  try {
    const response = await fetch('/api/team/runs', { cache: 'no-store' });
    if (response.ok) renderHistory(await response.json());
  } catch {
    // History is an enhancement; new plans can still be generated if the service is available.
  }
}

async function saveRun(run) {
  const response = await fetch('/api/team/runs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(run)
  });
  if (!response.ok) throw new Error('The plan was generated, but could not be saved locally.');
  return response.json();
}

crewRoster.addEventListener('click', (event) => {
  const card = event.target.closest('.agent-card');
  if (!card) return;
  const agent = agents.find((item) => item.id === card.dataset.agentId);
  if (!agent) return;
  for (const [key, value] of Object.entries(agent)) {
    const input = agentForm.elements.namedItem(key);
    if (input) input.value = value;
  }
  document.querySelector('#agent-dialog-title').textContent = `Edit ${agent.name}`;
  agentSaveStatus.textContent = '';
  agentDialog.showModal();
});

document.querySelector('.agent-dialog-close').addEventListener('click', () => agentDialog.close());
document.querySelector('#agent-cancel').addEventListener('click', () => agentDialog.close());
agentDialog.addEventListener('click', (event) => {
  if (event.target === agentDialog) agentDialog.close();
});

agentForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const profile = Object.fromEntries(new FormData(agentForm).entries());
  const updatedAgents = agents.map((agent) => agent.id === profile.id ? { ...agent, ...profile } : agent);
  const saveButton = agentForm.querySelector('[type="submit"]');
  saveButton.disabled = true;
  agentSaveStatus.textContent = 'Saving these agent instructions…';
  try {
    const response = await fetch('/api/team/agents', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updatedAgents)
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Agent details could not be saved.');
    agents = data.agents;
    renderAgents();
    agentSaveStatus.textContent = 'Saved. New runs will use these instructions.';
    window.setTimeout(() => agentDialog.close(), 450);
  } catch (error) {
    agentSaveStatus.textContent = error.message;
  } finally {
    saveButton.disabled = false;
  }
});

function appendReviewActivity(event, state, heading) {
  const item = document.createElement('article');
  item.className = `review-event is-${state}`;
  const header = document.createElement('div');
  header.className = 'review-event-heading';
  const title = document.createElement('strong');
  title.textContent = `${event.targetName || 'Deliverable'} · ${heading}`;
  const iteration = document.createElement('span');
  iteration.textContent = `PASS ${event.iteration || 1}`;
  header.append(title, iteration);
  item.append(header);
  for (const issue of event.issues || []) {
    const issueText = document.createElement('p');
    issueText.className = 'review-issue';
    issueText.textContent = issue;
    item.append(issueText);
  }
  for (const check of event.changeChecks || []) {
    const checkText = document.createElement('p');
    checkText.className = `review-check${check.addressed ? ' is-addressed' : ' is-open'}`;
    checkText.textContent = `${check.addressed ? 'Verified' : 'Still open'} · ${check.text}${check.evidence ? ` — “${check.evidence}”` : ''}`;
    item.append(checkText);
  }
  for (const suggestion of event.suggestions || []) {
    const suggestionText = document.createElement('p');
    suggestionText.className = 'review-suggestion';
    suggestionText.textContent = `Suggestion · ${suggestion}`;
    item.append(suggestionText);
  }
  if (event.feedback || event.message) {
    const feedback = document.createElement('p');
    feedback.className = 'review-feedback';
    feedback.textContent = event.feedback || event.message;
    item.append(feedback);
  }
  reviewActivity.append(item);
  reviewActivity.hidden = false;
}

function applyCrewProgress(event) {
  const agent = agents.find((profile) => profile.id === event.agentId);
  if (event.type === 'agent_started' && agent) {
    agentStates.set(agent.id, event.isRevision ? 'revision' : 'running');
    progressText.textContent = event.isRevision
      ? `${agent.name} is applying the Go-To-Market Lead’s corrections (revision ${event.iteration})…`
      : `${agent.name} is preparing their deliverable…`;
  } else if (event.type === 'agent_completed' && agent) {
    agentStates.set(agent.id, 'reviewing');
    progressText.textContent = `${agent.name} submitted pass ${event.iteration}; the Go-To-Market Lead is checking it…`;
  } else if (event.type === 'review_started') {
    agentStates.set('gtm', 'running');
    progressText.textContent = `Go-To-Market Lead is reviewing ${event.targetName} · pass ${event.iteration}…`;
  } else if (event.type === 'review_completed') {
    agentStates.set('gtm', event.approved ? 'done' : 'reviewing');
    if (event.approved) {
      agentStates.set(event.targetAgentId, 'done');
      progressText.textContent = `Go-To-Market Lead approved ${event.targetName} after ${event.iteration} pass${event.iteration === 1 ? '' : 'es'}.`;
      appendReviewActivity(event, 'approved', 'Approved');
    } else {
      progressText.textContent = `Go-To-Market Lead requested corrections to ${event.targetName}.`;
      appendReviewActivity(event, 'changes', 'Changes requested');
    }
  } else if (event.type === 'correction_requested' && agent) {
    agentStates.set(agent.id, 'revision');
  } else if (event.type === 'workflow_paused') {
    agentStates.set('gtm', 'needs-review');
    agentStates.set(event.targetAgentId, 'needs-review');
    progressText.textContent = 'Workflow paused · a deliverable needs human review.';
    appendReviewActivity(event, 'blocked', 'Human review required');
  }
  renderFlow();
}

async function readCrewEvents(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let completedRun = null;
  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    let boundary;
    while ((boundary = buffer.indexOf('\n\n')) !== -1) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      let eventName = 'message';
      const dataLines = [];
      for (const line of frame.split(/\r?\n/)) {
        if (line.startsWith('event:')) eventName = line.slice(6).trim();
        if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
      }
      if (!dataLines.length) continue;
      const payload = JSON.parse(dataLines.join('\n'));
      if (eventName === 'progress') applyCrewProgress(payload);
      if (eventName === 'complete') completedRun = payload;
      if (eventName === 'error') throw new Error(payload.error || 'The team run failed.');
    }
    if (done) break;
  }
  if (!completedRun) throw new Error('The CrewAI connection ended before the team finished.');
  return completedRun;
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!form.reportValidity()) return;

  const formData = new FormData(form);
  const brief = Object.fromEntries(formData.entries());
  runButton.disabled = true;
  progress.hidden = false;
  crewFlow.hidden = false;
  agentStates.clear();
  renderFlow();
  errorBox.hidden = true;
  emptyState.hidden = true;
  reportFooter.hidden = true;
  outputList.replaceChildren();
  structuredOutputLink.hidden = true;
  reviewActivity.replaceChildren();
  reviewActivity.hidden = true;
  errorBox.hidden = true;
  progressText.textContent = 'Waiting for the first CrewAI task to start…';

  try {
    const response = await fetch('/api/team/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(brief)
    });
    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || 'The marketing team could not complete this brief.');
    }
    const data = await readCrewEvents(response);
    try {
      const history = await saveRun(data);
      const savedRun = history.run || history.runs?.[0];
      if (savedRun) {
        data.id = savedRun.id;
        data.createdAt = savedRun.createdAt;
      }
      renderOutputs(data);
      renderHistory(history.runs);
    } catch (saveError) {
      delete data.id;
      renderOutputs(data);
      errorBox.textContent = saveError.message;
      errorBox.hidden = false;
    }
  } catch (error) {
    emptyState.hidden = true;
    errorBox.textContent = error.message;
    errorBox.hidden = false;
  } finally {
    progress.hidden = true;
    runButton.disabled = !statusBadge.classList.contains('is-ready');
  }
});

copyButton.addEventListener('click', async () => {
  if (!latestRun) return;
  try {
    await navigator.clipboard.writeText(`# ${latestRun.brief?.brand || 'Marketing plan'}\n\n${getOutputText()}`);
    copyButton.textContent = 'Copied';
    window.setTimeout(() => { copyButton.textContent = 'Copy plan'; }, 1400);
  } catch {
    copyButton.textContent = 'Clipboard unavailable';
    window.setTimeout(() => { copyButton.textContent = 'Copy plan'; }, 1800);
  }
});

downloadButton.addEventListener('click', () => {
  if (!latestRun) return;
  const markdown = `# ${latestRun.brief?.brand || 'Marketing plan'}\n\n**Generated:** ${new Date(latestRun.createdAt).toLocaleString()}\n\n${getOutputText()}\n`;
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([markdown], { type: 'text/markdown;charset=utf-8' }));
  link.download = `${(latestRun.brief?.brand || 'marketing-plan').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'marketing-plan'}.md`;
  link.click();
  URL.revokeObjectURL(link.href);
});

loadStatus();
loadTimelineContext();
loadHistory();
loadAgents();
