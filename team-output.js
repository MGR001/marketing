const title = document.querySelector('#report-title');
const subtitle = document.querySelector('#report-subtitle');
const status = document.querySelector('#report-status');
const errorBox = document.querySelector('#report-error');
const briefDate = document.querySelector('#brief-date');
const briefGrid = document.querySelector('#brief-grid');
const gateSummary = document.querySelector('#gate-summary');
const gateList = document.querySelector('#gate-list');
const deliverableCount = document.querySelector('#deliverable-count');
const deliverableList = document.querySelector('#deliverable-list');
const downloadButton = document.querySelector('#download-report');
const humanApproval = document.querySelector('#human-approval');
const approvalCopy = document.querySelector('#human-approval-copy');
const approvalMeta = document.querySelector('#human-approval-meta');
const approveButton = document.querySelector('#approve-run');
let currentRun = null;

const briefFields = [
  ['Brand / campaign', 'brand'],
  ['Objective', 'objective'],
  ['Audience', 'audience'],
  ['Market & context', 'market'],
  ['Offer / benefit', 'offer'],
  ['Priority channels', 'channels'],
  ['Tone', 'tone'],
  ['Timeline context', 'timelineContext'],
  ['Constraints & proof points', 'constraints']
];

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function renderBrief(run) {
  briefGrid.replaceChildren();
  for (const [label, key] of briefFields) {
    const item = element('div', 'brief-field');
    const term = element('dt', '', label);
    const value = element('dd', run.brief?.[key] ? '' : 'brief-empty', run.brief?.[key] || 'Not provided');
    item.append(term, value);
    briefGrid.append(item);
  }
  briefDate.textContent = new Date(run.createdAt).toLocaleString();
}

function renderReviewCard(review) {
  const reviewCard = element('article', `gate-card is-${review.approved ? 'approved' : 'changes'}`);
  const header = element('div', 'gate-card-head');
  header.append(
    element('strong', '', `${review.agent || review.targetName || 'Specialist'} · GTM check ${review.iteration || '—'}`),
    element('span', '', review.approved ? 'APPROVED' : 'CORRECTIONS REQUESTED')
  );
  reviewCard.append(header);
  if (review.issues?.length) {
    const issues = element('ul', 'gate-issues');
    for (const issue of review.issues) issues.append(element('li', '', issue));
    reviewCard.append(issues);
  }
  if (review.changeChecks?.length) {
    const checks = element('ul', 'gate-checks');
    for (const check of review.changeChecks) {
      const item = element('li', check.addressed ? 'is-addressed' : 'is-open');
      item.append(element('strong', '', `${check.addressed ? 'Verified' : 'Still open'} · ${check.id}`));
      item.append(document.createTextNode(` ${check.text}`));
      if (check.evidence) item.append(element('blockquote', '', `“${check.evidence}”`));
      checks.append(item);
    }
    reviewCard.append(checks);
  }
  if (review.suggestions?.length) {
    const suggestions = element('ul', 'gate-suggestions');
    for (const suggestion of review.suggestions) suggestions.append(element('li', '', suggestion));
    reviewCard.append(suggestions);
  }
  if (review.feedback) reviewCard.append(element('p', '', review.feedback));
  return reviewCard;
}

function appendInlineText(parent, value) {
  const pattern = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g;
  let cursor = 0;
  for (const match of value.matchAll(pattern)) {
    if (match.index > cursor) parent.append(document.createTextNode(value.slice(cursor, match.index)));
    const token = match[0];
    const tag = token.startsWith('**') ? 'strong' : token.startsWith('*') ? 'em' : 'code';
    const content = token.startsWith('**') ? token.slice(2, -2) : token.slice(1, -1);
    parent.append(element(tag, '', content));
    cursor = match.index + token.length;
  }
  if (cursor < value.length) parent.append(document.createTextNode(value.slice(cursor)));
}

function renderMarkdown(markdown) {
  const container = element('div', 'markdown-content');
  const lines = String(markdown || '').split(/\r?\n/);
  let index = 0;
  while (index < lines.length) {
    const line = lines[index].trim();
    if (!line) { index += 1; continue; }
    const heading = line.match(/^(#{1,5})\s+(.+)$/);
    if (heading) {
      const node = element(`h${Math.min(4, heading[1].length + 1)}`);
      appendInlineText(node, heading[2]);
      container.append(node);
      index += 1;
      continue;
    }
    if (/^([-*_])\1\1+\s*$/.test(line)) {
      container.append(document.createElement('hr'));
      index += 1;
      continue;
    }
    if (line.startsWith('|') && index + 1 < lines.length && /^\s*\|?\s*:?-{3,}/.test(lines[index + 1])) {
      const table = element('div', 'markdown-table-wrap');
      const tableNode = document.createElement('table');
      const splitRow = (value) => value.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim());
      const head = document.createElement('thead');
      const headerRow = document.createElement('tr');
      for (const value of splitRow(line)) {
        const cell = document.createElement('th');
        appendInlineText(cell, value);
        headerRow.append(cell);
      }
      head.append(headerRow);
      tableNode.append(head);
      const rows = document.createElement('tbody');
      index += 2;
      while (index < lines.length && lines[index].trim().startsWith('|')) {
        const row = document.createElement('tr');
        for (const value of splitRow(lines[index])) {
          const cell = document.createElement('td');
          appendInlineText(cell, value);
          row.append(cell);
        }
        rows.append(row);
        index += 1;
      }
      tableNode.append(rows);
      table.append(tableNode);
      container.append(table);
      continue;
    }
    const listMatch = line.match(/^([-*+] |\d+[.)] )(.*)$/);
    if (listMatch) {
      const ordered = /^\d/.test(listMatch[1]);
      const list = document.createElement(ordered ? 'ol' : 'ul');
      const marker = ordered ? /^\d+[.)] / : /^[-*+] /;
      while (index < lines.length && marker.test(lines[index].trim())) {
        const item = document.createElement('li');
        appendInlineText(item, lines[index].trim().replace(marker, ''));
        list.append(item);
        index += 1;
      }
      container.append(list);
      continue;
    }
    const paragraph = element('p');
    const paragraphLines = [line];
    index += 1;
    while (index < lines.length && lines[index].trim() && !/^(#{1,5}\s|[-*_]{3,}\s*$|\s*\||[-*+] |\d+[.)] )/.test(lines[index].trim())) {
      paragraphLines.push(lines[index].trim());
      index += 1;
    }
    appendInlineText(paragraph, paragraphLines.join(' '));
    container.append(paragraph);
  }
  return container;
}

function renderGateTrail(run) {
  gateList.replaceChildren();
  const reviews = run.reviewHistory || [];
  const approved = reviews.filter((review) => review.approved).length;
  gateSummary.textContent = reviews.length ? `${approved} APPROVED · ${reviews.length - approved} REVISION${reviews.length - approved === 1 ? '' : 'S'}` : 'LEGACY RUN';
  if (!reviews.length) {
    gateList.append(element('p', 'gate-empty', 'This saved run predates automatic Go-To-Market review; there is no review history to display.'));
    return;
  }
  for (const review of reviews) gateList.append(renderReviewCard(review));
}

function renderDeliverables(run) {
  deliverableList.replaceChildren();
  const outputs = run.outputs || [];
  deliverableCount.textContent = `${outputs.length} SPECIALIST OUTPUT${outputs.length === 1 ? '' : 'S'}`;
  outputs.forEach((output, index) => {
    const card = element('article', 'deliverable-card');
    const header = element('header', 'deliverable-head');
    const heading = element('div', 'deliverable-heading');
    const id = element('span', 'deliverable-index', String(index + 1).padStart(2, '0'));
    const label = element('div');
    label.append(element('h3', '', output.agent || `Specialist ${index + 1}`));
    label.append(element('div', 'deliverable-specialty', output.id === 'copywriter' ? 'CONTENT & CHANNEL ASSETS' : output.id === 'gtm' ? 'QUALITY & CONSISTENCY' : 'APPROVED WORKSTREAM'));
    heading.append(id, label);
    const reviewStatus = output.reviewStatus;
    const badge = element('span', `deliverable-status${reviewStatus === 'needs_review' ? ' is-needs_review' : ''}`,
      reviewStatus === 'approved' ? `GTM APPROVED · ${output.reviewIterations?.length || 1} CHECK${(output.reviewIterations?.length || 1) === 1 ? '' : 'S'}`
        : reviewStatus === 'needs_review' ? 'HUMAN REVIEW REQUIRED' : 'HISTORICAL OUTPUT');
    header.append(heading, badge);
    const body = element('div', 'deliverable-body');
    if (!run.reviewHistory?.length) body.append(element('p', 'legacy-note', 'Historical output · generated before the GTM review workflow was introduced.'));
    body.append(renderMarkdown(output.content || 'No content was saved for this specialist.'));
    if (output.reviewIterations?.length) {
      const reviews = element('section', 'deliverable-reviews');
      reviews.append(element('h4', '', 'Review and correction history'));
      for (const review of output.reviewIterations) {
        const reviewItem = element('article', 'deliverable-review');
        reviewItem.append(element('strong', '', `Pass ${review.iteration} · ${review.approved ? 'Approved' : 'Feedback sent to agent'}`));
        if (review.feedback) reviewItem.append(element('p', '', review.feedback));
        if (review.issues?.length) {
          const issues = element('ul');
          for (const issue of review.issues) issues.append(element('li', '', issue));
          reviewItem.append(issues);
        }
        if (review.changeChecks?.length) {
          const checks = element('ul', 'gate-checks');
          for (const check of review.changeChecks) {
            const item = element('li', check.addressed ? 'is-addressed' : 'is-open');
            item.append(element('strong', '', `${check.addressed ? 'Verified' : 'Still open'} · ${check.id}`));
            item.append(document.createTextNode(` ${check.text}`));
            if (check.evidence) item.append(element('blockquote', '', `“${check.evidence}”`));
            checks.append(item);
          }
          reviewItem.append(checks);
        }
        if (review.suggestions?.length) {
          const suggestions = element('ul', 'gate-suggestions');
          for (const suggestion of review.suggestions) suggestions.append(element('li', '', suggestion));
          reviewItem.append(suggestions);
        }
        reviews.append(reviewItem);
      }
      body.append(reviews);
    }
    card.append(header, body);
    deliverableList.append(card);
  });
}

function markdownReport(run) {
  const lines = [`# ${run.brief?.brand || 'Marketing plan'}`, '', `Generated: ${new Date(run.createdAt).toLocaleString()}`, `Status: ${run.status === 'needs_review' ? 'Needs human review' : 'GTM approved'}`, '', '## Campaign brief', ''];
  for (const [label, key] of briefFields) lines.push(`- **${label}:** ${run.brief?.[key] || 'Not provided'}`);
  lines.push('', '## Go-To-Market review trail', '');
  for (const review of run.reviewHistory || []) {
    lines.push(`### ${review.agent} · pass ${review.iteration} · ${review.approved ? 'Approved' : 'Corrections requested'}`);
    if (review.feedback) lines.push('', review.feedback);
    for (const issue of review.issues || []) lines.push(`- ${issue}`);
    for (const suggestion of review.suggestions || []) lines.push(`- Suggestion (non-blocking): ${suggestion}`);
    for (const check of review.changeChecks || []) {
      lines.push(`- ${check.addressed ? 'Verified' : 'Still open'} · ${check.id}: ${check.text}`);
      if (check.evidence) lines.push(`  - Evidence: “${check.evidence}”`);
    }
    lines.push('');
  }
  lines.push('## Deliverables by specialist', '');
  for (const output of run.outputs || []) {
    lines.push(`### ${output.agent} · ${output.reviewStatus || 'historical output'}`, '', output.content || '', '');
  }
  return lines.join('\n');
}

function showRun(run) {
  currentRun = run;
  title.textContent = run.brief?.brand || 'Campaign report';
  subtitle.textContent = `${(run.outputs || []).length} deliverables · ${new Date(run.createdAt).toLocaleString()}`;
  const isReview = run.status === 'needs_review' || (run.outputs || []).some((output) => output.reviewStatus === 'needs_review');
  const humanApproved = Boolean(run.humanApproval?.approvedAt);
  status.textContent = humanApproved ? 'HUMAN APPROVED · GTM REVIEW OPEN' : isReview ? 'HUMAN REVIEW REQUIRED' : run.reviewHistory?.length ? 'GO-TO-MARKET APPROVED' : 'HISTORICAL RUN';
  status.classList.toggle('is-review', isReview && !humanApproved);
  status.classList.toggle('is-human-approved', humanApproved);
  humanApproval.hidden = !isReview;
  approveButton.hidden = !isReview || humanApproved;
  approveButton.disabled = false;
  approvalMeta.classList.remove('is-error');
  approvalCopy.textContent = 'Your approval is recorded locally as your sign-off. It does not change the Go-To-Market Lead’s review or resume paused specialist work.';
  approvalMeta.textContent = humanApproved
    ? `Approved locally on ${new Date(run.humanApproval.approvedAt).toLocaleString()}. GTM review remains open.`
    : 'Read the review trail and deliverables below before approving this saved run.';
  renderBrief(run);
  renderGateTrail(run);
  renderDeliverables(run);
  downloadButton.disabled = false;
  document.title = `${run.brief?.brand || 'Campaign'} · Structured report`;
}

approveButton.addEventListener('click', async () => {
  if (!currentRun?.id || approveButton.disabled) return;
  const confirmed = window.confirm(
    `Approve “${currentRun.brief?.brand || 'this campaign'}” for use? This records your local sign-off; it does not change the GTM review or resume paused work.`
  );
  if (!confirmed) return;

  approveButton.disabled = true;
  approvalMeta.textContent = 'Recording your approval…';
  try {
    const response = await fetch(`/api/team/runs/${encodeURIComponent(currentRun.id)}/approval`, { method: 'POST' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Your approval could not be saved.');
    showRun(data.run);
  } catch (error) {
    approveButton.disabled = false;
    approvalMeta.textContent = error.message;
    approvalMeta.classList.add('is-error');
  }
});

async function loadRun() {
  try {
    const response = await fetch('/api/team/runs', { cache: 'no-store' });
    const runs = await response.json();
    if (!response.ok) throw new Error(runs.error || 'Saved reports could not be loaded.');
    const requestedId = new URLSearchParams(location.search).get('id');
    const run = requestedId ? runs.find((item) => item.id === requestedId) : runs[0];
    if (!run) throw new Error(requestedId ? 'That saved run could not be found on this computer.' : 'There are no saved runs yet. Generate a plan in the workbench first.');
    showRun(run);
  } catch (error) {
    errorBox.textContent = error.message;
    errorBox.hidden = false;
    status.textContent = 'REPORT UNAVAILABLE';
    title.textContent = 'Report unavailable';
    subtitle.textContent = 'Return to the workbench and select a saved run.';
  }
}

downloadButton.addEventListener('click', () => {
  if (!currentRun) return;
  const file = new Blob([markdownReport(currentRun)], { type: 'text/markdown;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(file);
  link.download = `${(currentRun.brief?.brand || 'campaign-report').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'campaign-report'}-report.md`;
  link.click();
  URL.revokeObjectURL(link.href);
});

loadRun();
