const entryForm = document.querySelector('#entry-form');
const entryType = document.querySelector('#entry-type');
const entryId = document.querySelector('#entry-id');
const entryList = document.querySelector('#entry-list');
const statusMessage = document.querySelector('#admin-status');
let timelineData;
let statusTimer;

const fields = {
  lane: document.querySelector('#lane-field'),
  date: document.querySelector('#date-field'),
  start: document.querySelector('#start-date-field'),
  end: document.querySelector('#end-date-field'),
  subtitle: document.querySelector('#subtitle-field'),
  activities: document.querySelector('#activities-field')
};

function setStatus(message, isError = false) {
  statusMessage.textContent = message;
  statusMessage.classList.toggle('error', isError);
  statusMessage.hidden = false;
  window.clearTimeout(statusTimer);
  statusTimer = window.setTimeout(() => { statusMessage.hidden = true; }, 6000);
}

function makeId() {
  return window.crypto?.randomUUID?.() || `entry-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function createElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function formatDate(value) {
  if (!value) return 'No date';
  return new Date(`${value}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function syncFields() {
  const type = entryType.value;
  const isCampaign = type === 'campaign';
  const isLaunch = type === 'launch';
  fields.lane.hidden = !isCampaign;
  fields.date.hidden = isCampaign;
  fields.start.hidden = !isCampaign;
  fields.end.hidden = !isCampaign;
  fields.subtitle.hidden = isCampaign;
  fields.activities.hidden = !isLaunch;
  document.querySelector('#entry-date').required = !isCampaign;
  document.querySelector('#entry-start').required = isCampaign;
  document.querySelector('#entry-end').required = isCampaign;
  document.querySelector('#entry-subtitle').required = !isCampaign;
  document.querySelector('#entry-date').max = `${(timelineData?.year || 2026) + (isLaunch ? 1 : 0)}-12-31`;
  document.querySelector('#entry-date').min = `${timelineData?.year || 2026}-01-01`;
  for (const selector of ['#entry-start', '#entry-end']) {
    document.querySelector(selector).min = `${timelineData?.year || 2026}-01-01`;
    document.querySelector(selector).max = `${timelineData?.year || 2026}-12-31`;
  }
  document.querySelector('#date-label').textContent = isLaunch ? 'Launch date' : 'Event date';
}

function resetEntryForm() {
  entryForm.reset();
  entryId.value = '';
  entryType.value = 'launch';
  document.querySelector('#entry-heading').textContent = 'Add an entry';
  document.querySelector('#entry-submit').textContent = 'Save entry';
  document.querySelector('#entry-cancel').hidden = true;
  syncFields();
}

function entryPeriod(entry, type) {
  if (type === 'campaign') return `${formatDate(entry.start)} – ${formatDate(entry.end)}`;
  return formatDate(type === 'launch' || type === 'event' ? entry.date : entry.start);
}

function renderEntryGroup(label, entries, type) {
  if (!entries.length) return;
  entryList.append(createElement('h3', 'entry-group-label', label));
  entries.forEach((entry) => {
    const card = createElement('article', 'entry-card');
    const copy = createElement('div', 'entry-card-copy');
    copy.append(
      createElement('div', 'entry-card-title', entry.title),
      createElement('div', 'entry-card-meta', `${entryPeriod(entry, type)}${type === 'campaign' ? ` · ${entry.lane}` : ''}`)
    );
    const actions = createElement('div', 'entry-card-actions');
    const editButton = createElement('button', 'entry-action', 'Edit');
    editButton.type = 'button';
    editButton.addEventListener('click', () => editEntry(type, entry.id));
    const deleteButton = createElement('button', 'entry-action delete', type === 'launch' ? 'Remove' : 'Delete');
    deleteButton.type = 'button';
    deleteButton.setAttribute('aria-label', `${type === 'launch' ? 'Remove launch' : 'Delete entry'}: ${entry.title}`);
    deleteButton.addEventListener('click', () => deleteEntry(type, entry.id));
    actions.append(editButton, deleteButton);
    card.append(copy, actions);
    entryList.append(card);
  });
}

function renderEntries() {
  entryList.replaceChildren();
  renderEntryGroup('Product launches', timelineData.launches, 'launch');
  renderEntryGroup('Branding campaigns', timelineData.campaigns.filter((item) => item.lane === 'branding'), 'campaign');
  renderEntryGroup('Selling campaigns', timelineData.campaigns.filter((item) => item.lane === 'selling'), 'campaign');
  renderEntryGroup('Events', timelineData.events, 'event');
  document.querySelector('#entry-count').textContent = String(timelineData.launches.length + timelineData.campaigns.length + timelineData.events.length);
  if (!entryList.children.length) entryList.append(createElement('p', 'empty-state', 'No entries yet. Add your first launch, campaign, or event.'));
}

function findEntry(type, id) {
  const collection = type === 'launch' ? timelineData.launches : type === 'campaign' ? timelineData.campaigns : timelineData.events;
  return collection.find((item) => item.id === id);
}

function editEntry(type, id) {
  const entry = findEntry(type, id);
  if (!entry) return;
  entryId.value = entry.id;
  entryType.value = type;
  syncFields();
  document.querySelector('#entry-title').value = entry.title;
  document.querySelector('#entry-description').value = entry.description;
  if (type === 'campaign') {
    document.querySelector('#entry-lane').value = entry.lane;
    document.querySelector('#entry-start').value = entry.start;
    document.querySelector('#entry-end').value = entry.end;
  } else {
    document.querySelector('#entry-date').value = entry.date;
    document.querySelector('#entry-subtitle').value = entry.subtitle;
    if (type === 'launch') document.querySelector('#entry-activities').value = entry.activities.join('\n');
  }
  document.querySelector('#entry-heading').textContent = 'Edit entry';
  document.querySelector('#entry-submit').textContent = 'Save changes';
  document.querySelector('#entry-cancel').hidden = false;
  document.querySelector('#entry-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
  document.querySelector('#entry-title').focus({ preventScroll: true });
}

async function persistData(successMessage) {
  const response = await fetch('/api/timeline', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(timelineData)
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Could not save timeline data.');
  renderEntries();
  setStatus(`${successMessage} Refresh the timeline view to see the changes.`);
}

async function deleteEntry(type, id) {
  const entry = findEntry(type, id);
  const action = type === 'launch' ? 'Remove launch' : 'Delete entry';
  if (!entry || !window.confirm(`${action} “${entry.title}”? This cannot be undone.`)) return;
  const collection = type === 'launch' ? timelineData.launches : type === 'campaign' ? timelineData.campaigns : timelineData.events;
  const previous = [...collection];
  collection.splice(collection.findIndex((item) => item.id === id), 1);
  try {
    await persistData('Entry deleted.');
  } catch (error) {
    collection.splice(0, collection.length, ...previous);
    renderEntries();
    setStatus(error.message, true);
  }
}

function renderThemeFields() {
  const container = document.querySelector('#theme-fields');
  container.replaceChildren();
  timelineData.themes.forEach((theme) => {
    const label = createElement('label', 'field');
    const caption = createElement('span', 'theme-period', theme.period);
    const input = document.createElement('input');
    input.type = 'text';
    input.maxLength = 80;
    input.required = true;
    input.value = theme.name;
    input.dataset.themeId = theme.id;
    input.setAttribute('aria-label', `${theme.period} theme`);
    label.append(caption, input);
    container.append(label);
  });
}

function renderAlwaysOn() {
  document.querySelector('#always-on-title').value = timelineData.alwaysOn.title;
  document.querySelector('#always-on-start').value = timelineData.alwaysOn.start;
  document.querySelector('#always-on-end').value = timelineData.alwaysOn.end;
  document.querySelector('#always-on-description').value = timelineData.alwaysOn.description;
  document.querySelector('#always-on-start').min = `${timelineData.year}-01-01`;
  document.querySelector('#always-on-start').max = `${timelineData.year}-12-31`;
  document.querySelector('#always-on-end').min = `${timelineData.year}-01-01`;
  document.querySelector('#always-on-end').max = `${timelineData.year}-12-31`;
}

entryType.addEventListener('change', syncFields);
document.querySelector('#entry-cancel').addEventListener('click', resetEntryForm);

document.querySelector('#entry-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const type = entryType.value;
  const id = entryId.value || makeId();
  const title = document.querySelector('#entry-title').value.trim();
  const description = document.querySelector('#entry-description').value.trim();
  const subtitle = document.querySelector('#entry-subtitle').value.trim();
  const previousState = structuredClone(timelineData);
  const record = { id, title, description };

  if (type === 'campaign') {
    record.lane = document.querySelector('#entry-lane').value;
    record.start = document.querySelector('#entry-start').value;
    record.end = document.querySelector('#entry-end').value;
  } else {
    record.date = document.querySelector('#entry-date').value;
    record.subtitle = subtitle;
    if (type === 'launch') {
      record.activities = document.querySelector('#entry-activities').value.split('\n').map((item) => item.trim()).filter(Boolean);
    }
  }

  for (const key of ['launches', 'campaigns', 'events']) {
    timelineData[key] = timelineData[key].filter((item) => item.id !== id);
  }
  const destination = type === 'launch' ? timelineData.launches : type === 'campaign' ? timelineData.campaigns : timelineData.events;
  destination.push(record);

  try {
    await persistData(entryId.value ? 'Entry updated.' : 'Entry added.');
    resetEntryForm();
  } catch (error) {
    timelineData = previousState;
    renderEntries();
    setStatus(error.message, true);
  }
});

document.querySelector('#themes-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const previousState = structuredClone(timelineData);
  timelineData.themes = [...document.querySelectorAll('[data-theme-id]')].map((input) => {
    const previousTheme = previousState.themes.find((theme) => theme.id === input.dataset.themeId);
    return { ...previousTheme, name: input.value.trim() };
  });
  try {
    await persistData('Seasonal themes saved.');
  } catch (error) {
    timelineData = previousState;
    renderThemeFields();
    setStatus(error.message, true);
  }
});

document.querySelector('#always-on-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const previousState = structuredClone(timelineData);
  timelineData.alwaysOn = {
    ...timelineData.alwaysOn,
    title: document.querySelector('#always-on-title').value.trim(),
    start: document.querySelector('#always-on-start').value,
    end: document.querySelector('#always-on-end').value,
    description: document.querySelector('#always-on-description').value.trim()
  };
  try {
    await persistData('Always On bar saved.');
  } catch (error) {
    timelineData = previousState;
    renderAlwaysOn();
    setStatus(error.message, true);
  }
});

async function loadData() {
  try {
    const response = await fetch('/api/timeline', { cache: 'no-store' });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not load timeline data.');
    timelineData = result;
    syncFields();
    renderEntries();
    renderThemeFields();
    renderAlwaysOn();
  } catch (error) {
    setStatus(`${error.message} Start the app with npm start and reload this page.`, true);
  }
}

loadData();
