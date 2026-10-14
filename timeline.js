const yearScroll = document.querySelector('#year-scroll');
const detailDialog = document.querySelector('#timeline-detail-dialog');
const detailType = document.querySelector('#detail-type');
const detailTitle = document.querySelector('#detail-title');
const detailDate = document.querySelector('#detail-date');
const detailDescription = document.querySelector('#detail-description');
const activitySection = document.querySelector('#detail-activities');
const activityList = document.querySelector('#detail-activities-list');
const yearStage = document.querySelector('.year-stage');
const zoomLevelLabel = document.querySelector('#zoom-level');
const zoomOutButton = document.querySelector('#zoom-out');
const zoomInButton = document.querySelector('#zoom-in');
const zoomResetButton = document.querySelector('#zoom-reset');
const MIN_ZOOM = 0.75;
const MAX_ZOOM = 2.5;
const ZOOM_STEP = 0.25;
let zoomLevel = 1;
let timelineData = null;
yearScroll.scrollLeft = 0;

function baseStageWidth() {
  return Math.max(window.innerWidth * 1.6, 2200);
}

function updateZoomControls() {
  zoomLevelLabel.textContent = `${Math.round(zoomLevel * 100)}%`;
  zoomOutButton.disabled = zoomLevel <= MIN_ZOOM;
  zoomInButton.disabled = zoomLevel >= MAX_ZOOM;
}

function renderTimelineItems() {
  if (!timelineData) return;
  renderLaunches(timelineData);
  renderThemes(timelineData.themes);
  renderCampaigns(timelineData);
  renderEvents(timelineData);
}

function setZoom(nextZoom, preserveCenter = true) {
  const nextLevel = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, nextZoom));
  const nextWidth = baseStageWidth() * nextLevel;
  if (nextLevel === zoomLevel && Math.abs(yearStage.clientWidth - nextWidth) < 1) return;

  const oldAxisWidth = Math.max(1, yearStage.clientWidth - 250);
  const centerFraction = preserveCenter
    ? Math.max(0, Math.min(1, (yearScroll.scrollLeft + yearScroll.clientWidth / 2 - 250) / oldAxisWidth))
    : null;
  zoomLevel = nextLevel;
  const width = baseStageWidth() * zoomLevel;
  yearStage.style.width = `${width}px`;
  yearStage.style.minWidth = `${width}px`;
  updateZoomControls();
  renderTimelineItems();

  if (centerFraction !== null) {
    const newAxisWidth = Math.max(1, yearStage.clientWidth - 250);
    const nextScrollLeft = 250 + centerFraction * newAxisWidth - yearScroll.clientWidth / 2;
    yearScroll.style.scrollBehavior = 'auto';
    yearScroll.scrollLeft = Math.max(0, Math.min(yearScroll.scrollWidth - yearScroll.clientWidth, nextScrollLeft));
    requestAnimationFrame(() => yearScroll.style.removeProperty('scroll-behavior'));
  }
}

zoomOutButton.addEventListener('click', () => setZoom(zoomLevel - ZOOM_STEP));
zoomInButton.addEventListener('click', () => setZoom(zoomLevel + ZOOM_STEP));
zoomResetButton.addEventListener('click', () => setZoom(1));
updateZoomControls();

function keepLaunchLabelsInView() {
  const scrollRect = yearScroll.getBoundingClientRect();
  const laneEnds = [];
  document.querySelectorAll('.launch-moment').forEach((moment) => {
    const copy = moment.querySelector('.moment-copy');
    const momentLeft = moment.getBoundingClientRect().left - scrollRect.left;
    const markerX = momentLeft + moment.offsetWidth / 2;
    const copyWidth = copy.getBoundingClientRect().width;
    if (markerX < 0 || markerX > yearScroll.clientWidth) {
      copy.style.left = '50%';
      copy.style.visibility = 'hidden';
      moment.style.setProperty('--launch-lane', moment.dataset.baseLane);
      return;
    }
    copy.style.visibility = 'visible';
    const minimumLeft = 8;
    const maximumLeft = Math.max(minimumLeft, yearScroll.clientWidth - copyWidth - 8);
    const desiredLeft = Math.min(maximumLeft, Math.max(minimumLeft, markerX - copyWidth / 2));
    let lane = laneEnds.findIndex((end) => end <= desiredLeft);
    if (lane === -1) lane = laneEnds.length;
    laneEnds[lane] = desiredLeft + copyWidth + 16;
    moment.style.setProperty('--launch-lane', lane);
    copy.style.left = `${desiredLeft - momentLeft + copyWidth / 2}px`;
  });
}

yearScroll.addEventListener('scroll', keepLaunchLabelsInView, { passive: true });

yearScroll.addEventListener('wheel', (event) => {
  if (Math.abs(event.deltaY) > Math.abs(event.deltaX)) {
    yearScroll.scrollLeft += event.deltaY;
    event.preventDefault();
  }
}, { passive: false });

document.querySelector('.detail-dialog-close').addEventListener('click', () => {
  detailDialog.close();
});

detailDialog.addEventListener('click', (event) => {
  if (event.target === detailDialog) {
    detailDialog.close();
  }
});

const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const zoneClasses = ['spring-zone', 'summer-zone', 'autumn-zone', 'winter-zone'];

function parseDate(value) {
  return new Date(`${value}T12:00:00`);
}

function dateFraction(value, year, includeEndDay = false) {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (includeEndDay) date.setUTCDate(date.getUTCDate() + 1);
  const yearStart = Date.UTC(year, 0, 1);
  const yearEnd = Date.UTC(year + 1, 0, 1);
  return Math.max(0, Math.min(1, (date.getTime() - yearStart) / (yearEnd - yearStart)));
}

function formatDate(value, includeYear = true) {
  const date = parseDate(value);
  const month = months[date.getMonth()].slice(0, 3).toUpperCase();
  const day = String(date.getDate()).padStart(2, '0');
  return `${month} ${day}${includeYear ? ` · ${date.getFullYear()}` : ''}`;
}

function formatLongDate(value) {
  return parseDate(value).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

function setDetailData(button, type, title, date, description, activities = []) {
  button.dataset.detailType = type;
  button.dataset.detailTitle = title;
  button.dataset.detailDate = date;
  button.dataset.detailDescription = description;
  button.addEventListener('click', () => {
    detailType.textContent = type;
    detailTitle.textContent = title;
    detailDate.textContent = date;
    detailDescription.textContent = description;
    activityList.replaceChildren(...activities.map((activity) => {
      const listItem = document.createElement('li');
      listItem.textContent = activity;
      return listItem;
    }));
    activitySection.hidden = activities.length === 0;
    detailDialog.showModal();
  });
}

function createElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function renderLaunches(data) {
  const container = document.querySelector('#launch-items');
  container.replaceChildren();
  const stageWidth = document.querySelector('.year-stage').clientWidth;
  const timelineWidth = stageWidth - 250;
  const collisionWidth = 236;
  const laneEnds = [];
  const launches = data.launches
    .map((launch, originalIndex) => ({
      launch,
      originalIndex,
      position: 250 + dateFraction(launch.date, data.year) * timelineWidth
    }))
    .sort((first, second) => first.position - second.position || first.originalIndex - second.originalIndex);

  launches.forEach(({ launch, position }) => {
    let lane = laneEnds.findIndex((end) => end <= position);
    if (lane === -1) lane = laneEnds.length;
    laneEnds[lane] = position + collisionWidth;

    const moment = createElement('button', 'launch-moment');
    moment.style.setProperty('--launch-lane', lane);
    moment.dataset.baseLane = String(lane);
    moment.type = 'button';
    moment.setAttribute('aria-pressed', 'false');
    moment.setAttribute('aria-label', `${formatLongDate(launch.date)} · ${launch.title} · ${launch.subtitle}`);
    moment.style.left = `${position}px`;

    const copy = createElement('span', 'moment-copy');
    copy.append(
      createElement('span', 'moment-date', formatDate(launch.date)),
      createElement('span', 'moment-title', launch.title)
    );
    if (launch.subtitle && launch.subtitle !== 'Product launch') {
      copy.append(createElement('span', 'moment-subtitle', launch.subtitle));
    }
    moment.append(copy, createElement('span', 'moment-stem'), createElement('span', 'moment-node'));

    moment.addEventListener('click', () => {
      const wasSelected = moment.getAttribute('aria-pressed') === 'true';
      container.querySelectorAll('.launch-moment').forEach((item) => {
        item.setAttribute('aria-pressed', 'false');
        item.classList.remove('selected');
      });
      if (!wasSelected) {
        moment.setAttribute('aria-pressed', 'true');
        moment.classList.add('selected');
      }
    });
    setDetailData(moment, 'Product launch', launch.title, formatLongDate(launch.date), launch.description, launch.activities);
    container.append(moment);
  });
  keepLaunchLabelsInView();
}

function renderThemes(themes) {
  const container = document.querySelector('#campaign-zones');
  container.replaceChildren();
  themes.forEach((theme, index) => {
    const zone = createElement('div', `campaign-zone ${zoneClasses[index] || ''}`);
    zone.append(createElement('span', 'zone-period', theme.period), createElement('span', 'zone-theme', theme.name));
    container.append(zone);
  });
}

function renderCampaigns(data) {
  const stageWidth = document.querySelector('.year-stage').clientWidth;
  const containers = {
    branding: document.querySelector('#branding-campaigns'),
    selling: document.querySelector('#selling-campaigns')
  };
  Object.values(containers).forEach((container) => container.replaceChildren());

  data.campaigns.forEach((campaign) => {
    const container = containers[campaign.lane];
    if (!container) return;
    const start = dateFraction(campaign.start, data.year);
    const end = dateFraction(campaign.end, data.year, true);
    const button = createElement('button', `campaign-item ${campaign.lane}-campaign`);
    button.type = 'button';
    button.style.setProperty('--start', `${start * 100}%`);
    button.style.setProperty('--duration', `${Math.max(0.005, end - start) * 100}%`);
    button.setAttribute('aria-label', `${campaign.title}, ${formatLongDate(campaign.start)} to ${formatLongDate(campaign.end)}`);
    button.append(
      createElement('span', 'campaign-name', campaign.title),
      createElement('span', 'campaign-dates', `${formatDate(campaign.start, false)} — ${formatDate(campaign.end, false)}`)
    );
    setDetailData(button, campaign.lane === 'branding' ? 'Brand campaign' : 'Selling campaign', campaign.title, `${formatLongDate(campaign.start)} – ${formatLongDate(campaign.end)}`, campaign.description);
    container.append(button);
  });

  const alwaysOn = data.alwaysOn;
  const alwaysOnContainer = document.querySelector('#always-on-campaign');
  alwaysOnContainer.replaceChildren();
  const alwaysOnButton = createElement('button', 'always-on-yearline');
  alwaysOnButton.type = 'button';
  alwaysOnButton.setAttribute('aria-label', `${alwaysOn.title}, ${formatLongDate(alwaysOn.start)} to ${formatLongDate(alwaysOn.end)}`);
  alwaysOnButton.append(
    createElement('span', '', alwaysOn.title.toUpperCase()),
    createElement('span', '', `${formatDate(alwaysOn.start, false)} — ${formatDate(alwaysOn.end, false)}`)
  );
  const alwaysOnStart = dateFraction(alwaysOn.start, data.year);
  const alwaysOnEnd = dateFraction(alwaysOn.end, data.year, true);
  alwaysOnButton.style.left = `${alwaysOnStart * 100}%`;
  alwaysOnButton.style.width = `${Math.max(0.005, alwaysOnEnd - alwaysOnStart) * 100}%`;
  setDetailData(alwaysOnButton, 'Year-round activity', alwaysOn.title, `${formatLongDate(alwaysOn.start)} – ${formatLongDate(alwaysOn.end)}`, alwaysOn.description);
  alwaysOnContainer.append(alwaysOnButton);
}

function renderEvents(data) {
  const container = document.querySelector('#event-markers');
  container.replaceChildren();
  data.events.forEach((event, index) => {
    const marker = createElement('article', `event-marker${index % 2 === 0 ? ' event-marker-raised' : ''}`);
    marker.style.left = `${dateFraction(event.date, data.year) * 100}%`;
    marker.setAttribute('aria-label', `${formatLongDate(event.date)}, ${event.title}, ${event.subtitle}`);
    const copy = createElement('button', 'event-copy');
    copy.type = 'button';
    copy.append(
      createElement('span', 'event-date', formatDate(event.date)),
      createElement('span', 'event-name', event.title),
      createElement('span', 'event-detail', event.subtitle)
    );
    marker.append(createElement('span', 'event-node'), createElement('span', 'event-stem'), copy);
    setDetailData(copy, 'Brand event', event.title, formatLongDate(event.date), event.description);
    container.append(marker);
  });
}

function renderTimeline(data) {
  timelineData = data;
  const stageWidth = baseStageWidth() * zoomLevel;
  yearStage.style.width = `${stageWidth}px`;
  yearStage.style.minWidth = `${stageWidth}px`;
  renderTimelineItems();
  const today = new Date();
  const currentDate = `${data.year}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const currentPosition = 250 + dateFraction(currentDate, data.year) * (yearStage.clientWidth - 250);
  const initialScroll = Math.max(0, Math.min(yearScroll.scrollWidth - yearScroll.clientWidth, currentPosition - yearScroll.clientWidth * 0.5));
  yearScroll.style.scrollBehavior = 'auto';
  yearScroll.scrollLeft = initialScroll;
  requestAnimationFrame(() => yearScroll.style.removeProperty('scroll-behavior'));
}

async function loadTimeline() {
  const status = document.querySelector('#timeline-load-error');
  try {
    const response = await fetch('/api/timeline', { cache: 'no-store' });
    if (!response.ok) throw new Error('Could not load the timeline data.');
    renderTimeline(await response.json());
    status.hidden = true;
  } catch (error) {
    status.textContent = `${error.message} Start the local app with npm start, then reload this page.`;
    status.hidden = false;
  }
}

loadTimeline();
window.addEventListener('resize', () => {
  window.clearTimeout(window.timelineResizeTimer);
  window.timelineResizeTimer = window.setTimeout(() => {
    if (!timelineData) {
      loadTimeline();
      return;
    }
    setZoom(zoomLevel);
  }, 150);
});