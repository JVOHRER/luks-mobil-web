const STORE_KEY = "luks-mobil-protocols-v1";

function iso(date = new Date()) { return date.toISOString().slice(0, 10); }
function today() { return iso(); }
function daysAgo(days) { return iso(new Date(Date.now() - days * 86400000)); }
function toDate(value) { return new Date(`${value}T12:00:00`); }
function hours(value) { return `${new Intl.NumberFormat("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 2 }).format(Number(value || 0))} Std.`; }
function displayDate(value) { return value ? new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" }).format(toDate(value)) : "—"; }

const seed = {
  protocols: [
    {
      id: "ap-001", project: "Pflege Gewann Tälesteich", customer: "Zweckverband Starzel-Eyach", location: "Owingen", date: today(),
      team: "Rick Schuler, Max Mustermann", work: "Freischneiden und Pflegearbeiten an der Wassertrasse.", hours: 4.5,
      machine: "Raupe", material: "Kraftstoff", notes: "Abschnitt Nord fertiggestellt.", status: "draft", updated: today()
    },
    {
      id: "ap-002", project: "Mulchen Hutzeltour", customer: "Stadt Hechingen", location: "Hechingen", date: daysAgo(2),
      team: "Rick Schuler", work: "Mulchen und Ausmähen der Wegeränder.", hours: 8, machine: "Lindtrac", material: "—", notes: "Arbeiten ohne Besonderheiten abgeschlossen.", status: "complete", updated: daysAgo(1)
    },
    {
      id: "ap-003", project: "Reinigung Zellerbach", customer: "Stadtverwaltung Hechingen", location: "Boll", date: daysAgo(4),
      team: "Rick Schuler, Max Mustermann", work: "Bäume und Schwemmgut aus dem Bachbett entfernt.", hours: 7.5, machine: "Bagger, Lkw", material: "Sicherungsmaterial", notes: "Zufahrt freigegeben.", status: "complete", updated: daysAgo(4)
    }
  ],
  timer: { startedAt: null, pendingSeconds: 0 },
  appointments: []
};

let data = readData();
let protocolFilter = "all";
let timerRefresh;
let pendingPhotos = [];
let photosBeingProcessed = false;
let customers = [];
let activities = [];
let calendarCursor = toDate(today());
let calendarSelected = today();
let deferredInstallPrompt = null;

const $ = (selector, parent = document) => parent.querySelector(selector);
const $$ = (selector, parent = document) => [...parent.querySelectorAll(selector)];

function readData() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY));
    if (saved && Array.isArray(saved.protocols) && saved.timer) {
      const protocols = normaliseProtocols(saved.protocols);
      const appointments = normaliseAppointments(saved.appointments);
      const needsAppointmentMigration = !Array.isArray(saved.appointments) || saved.appointments.some((appointment) => !appointment.dateFrom || !appointment.dateTo);
      if (saved.protocols.some((protocol) => "preOffer" in protocol) || needsAppointmentMigration) {
        localStorage.setItem(STORE_KEY, JSON.stringify({ ...saved, protocols, appointments }));
      }
      return { ...saved, protocols, appointments };
    }
  } catch (_) { /* A corrupt local backup is replaced with the sample data. */ }
  return { ...structuredClone(seed), protocols: normaliseProtocols(seed.protocols) };
}

function normaliseAppointments(appointments) {
  if (!Array.isArray(appointments)) return [];
  return appointments.map((appointment) => {
    const dateFrom = appointment.dateFrom || appointment.date || today();
    const dateTo = appointment.dateTo || appointment.date || dateFrom;
    return { ...appointment, date: dateFrom, dateFrom, dateTo };
  });
}

function stripPreOffers(protocols) {
  return protocols.map(({ preOffer, ...protocol }) => protocol);
}

function normaliseProtocols(protocols) {
  return stripPreOffers(protocols).map((protocol) => {
    const sourcePositions = Array.isArray(protocol.positions) && protocol.positions.length
      ? protocol.positions
      : [{ id: "position-1", description: protocol.work || "", hours: protocol.hours || 0, machine: protocol.machine || "", material: protocol.material || "" }];
    const positions = mergeSameActivities(sourcePositions.map((position, index) => ({
      id: position.id || `position-${index + 1}`,
      description: position.description || "",
      hours: Number(position.hours || 0),
      machine: position.machine || "",
      material: position.material || ""
    })));
    const dateFrom = protocol.dateFrom || protocol.date || today();
    const dateTo = protocol.dateTo || protocol.date || dateFrom;
    return {
      ...protocol,
      date: dateFrom,
      dateFrom,
      dateTo,
      positions,
      hours: positions.reduce((sum, position) => sum + position.hours, 0),
      work: positions.map((position) => position.description).filter(Boolean).join("; "),
      machine: positions.map((position) => position.machine).filter(Boolean).join(", "),
      material: positions.map((position) => position.material).filter(Boolean).join(", ")
    };
  });
}

function mergeSameActivities(positions) {
  const grouped = new Map();
  positions.forEach((position, index) => {
    const description = String(position.description || "").trim();
    const key = description ? description.toLocaleLowerCase("de") : `empty-${index}`;
    const existing = grouped.get(key);
    if (!existing) {
      grouped.set(key, { ...position, description });
      return;
    }
    existing.hours += Number(position.hours || 0);
    existing.machine = joinPositionValue(existing.machine, position.machine);
    existing.material = joinPositionValue(existing.material, position.material);
  });
  return [...grouped.values()];
}

function joinPositionValue(first, second) {
  const values = [...String(first || "").split(","), ...String(second || "").split(",")]
    .map((value) => value.trim())
    .filter(Boolean);
  return [...new Set(values)].join(", ");
}

function protocolPeriod(protocol) {
  const from = protocol.dateFrom || protocol.date;
  const to = protocol.dateTo || from;
  return from === to ? displayDate(from) : `${displayDate(from)} – ${displayDate(to)}`;
}

function protocolIsCurrent(protocol) {
  const from = protocol.dateFrom || protocol.date;
  const to = protocol.dateTo || from;
  return from <= today() && to >= today();
}

function saveData(message) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(data));
  } catch (_) {
    showToast("Der Gerätespeicher ist voll – bitte weniger Fotos speichern");
    return false;
  }
  render();
  if (message) showToast(message);
  return true;
}

function protocolStatus(protocol) {
  return protocol.status === "complete"
    ? { label: "Abgeschlossen", className: "paid" }
    : { label: "Entwurf", className: "open" };
}

function totalHours(rows) { return rows.reduce((sum, row) => sum + Number(row.hours || 0), 0); }

async function loadCustomers() {
  try {
    customers = await CustomerDb.list();
    renderCustomers();
  } catch (_) {
    showToast("Der Kundenstamm konnte nicht geöffnet werden");
  }
}

function renderCustomers() {
  const search = $("#customer-search");
  if (!search) return;
  const needle = search.value.trim().toLocaleLowerCase("de");
  const matching = customers.filter((customer) => [customer.name, customer.contact, customer.street, customer.city, customer.email, customer.phone].join(" ").toLocaleLowerCase("de").includes(needle));
  $("#customer-result-summary").textContent = `${matching.length} ${matching.length === 1 ? "Kunde" : "Kunden"} im Kundenstamm`;
  $("#customer-list").innerHTML = matching.map(customerRow).join("") || emptyState(needle ? "Kein Kunde gefunden." : "Noch keine Kunden angelegt.");
}

function customerRow(customer) {
  const secondary = [customer.contact, customer.city].filter(Boolean).join(" · ") || "Keine Kontaktdaten";
  return `<button class="list-row list-row--button" type="button" data-action="customer-detail" data-id="${customer.id}">
    <span class="row-icon row-icon--customer" aria-hidden="true">K</span>
    <span class="row-main"><span class="row-title">${escapeHtml(customer.name)}</span><span class="row-subtitle">${escapeHtml(secondary)}</span></span>
    <span class="row-side"><span class="row-date">${escapeHtml(customer.phone || customer.email || "Stammdaten")}</span></span>
  </button>`;
}

function customerOptions() {
  return `<datalist id="customer-options">${customers.map((customer) => `<option value="${escapeHtml(customer.name)}">${escapeHtml([customer.city, customer.contact].filter(Boolean).join(" · "))}</option>`).join("")}</datalist>`;
}

async function loadActivities() {
  try {
    activities = await ActivityDb.list();
    renderActivities();
  } catch (_) {
    showToast("Der Tätigkeitenstamm konnte nicht geöffnet werden");
  }
}

function renderActivities() {
  const search = $("#activity-search");
  if (!search) return;
  const needle = search.value.trim().toLocaleLowerCase("de");
  const matching = activities.filter((activity) => [activity.name, activity.defaultMachine, activity.defaultMaterial].join(" ").toLocaleLowerCase("de").includes(needle));
  $("#activity-result-summary").textContent = `${matching.length} ${matching.length === 1 ? "Tätigkeit" : "Tätigkeiten"} im Stamm`;
  $("#activity-list").innerHTML = matching.map(activityRow).join("") || emptyState(needle ? "Keine Tätigkeit gefunden." : "Noch keine Tätigkeiten angelegt.");
}

function activityRow(activity) {
  const defaults = [activity.defaultMachine, activity.defaultMaterial].filter(Boolean).join(" · ") || "Keine Vorgaben";
  return `<button class="list-row list-row--button" type="button" data-action="activity-detail" data-id="${activity.id}">
    <span class="row-icon row-icon--activity" aria-hidden="true">T</span>
    <span class="row-main"><span class="row-title">${escapeHtml(activity.name)}</span><span class="row-subtitle">${escapeHtml(defaults)}</span></span>
    <span class="row-side"><span class="row-date">Stammdaten</span></span>
  </button>`;
}

function activityOptions() {
  return `<datalist id="activity-options">${activities.map((activity) => `<option value="${escapeHtml(activity.name)}">${escapeHtml([activity.defaultMachine, activity.defaultMaterial].filter(Boolean).join(" · "))}</option>`).join("")}</datalist>`;
}

function render() {
  const dateLabel = new Intl.DateTimeFormat("de-DE", { weekday: "long", day: "numeric", month: "long" }).format(new Date());
  $("#today-label").textContent = dateLabel;
  renderDashboard();
  renderProtocols();
  renderTimer();
  renderCustomers();
  renderActivities();
  renderCalendar();
}

function renderDashboard() {
  const todayProtocols = data.protocols.filter(protocolIsCurrent);
  const drafts = data.protocols.filter((protocol) => protocol.status === "draft");
  const todayDrafts = todayProtocols.filter((protocol) => protocol.status === "draft");
  $("#today-hours").textContent = todayProtocols.length;
  $("#today-projects").textContent = `${hours(totalHours(todayProtocols))} Gesamtstunden`;
  $("#draft-count").textContent = drafts.length;
  $("#draft-hours").textContent = hours(totalHours(drafts));
  $("#attention-title").textContent = todayDrafts.length ? `${todayDrafts.length} Protokoll${todayDrafts.length === 1 ? "" : "e"} abschließen` : "Alles abgeschlossen";
  $("#attention-text").textContent = todayDrafts.length ? "Bitte Positionen und Angaben prüfen, dann abschließen." : "Für den heutigen Zeitraum liegen keine offenen Arbeitsprotokolle vor.";
  $("#notification-dot").classList.toggle("is-hidden", drafts.length === 0);
  const recent = [...data.protocols].sort((a, b) => `${b.updated}${b.id}`.localeCompare(`${a.updated}${a.id}`)).slice(0, 3);
  $("#recent-list").innerHTML = recent.map(protocolRow).join("") || emptyState("Noch keine Arbeitsprotokolle angelegt.");
}

function protocolRow(protocol) {
  const status = protocolStatus(protocol);
  return `<button class="list-row list-row--button" type="button" data-action="protocol-detail" data-id="${escapeHtml(protocol.id)}">
    <span class="row-icon" aria-hidden="true">AP</span>
    <span class="row-main"><span class="row-title">${escapeHtml(protocol.project || "Ohne Baustelle")}</span><span class="row-subtitle">${escapeHtml(protocol.location || protocol.customer || "Ohne Ort")} · ${protocolPeriod(protocol)}</span></span>
    <span class="row-side"><span class="row-amount">${hours(protocol.hours)}</span><span class="status status--${status.className}">${status.label}</span></span>
  </button>`;
}

function appointmentStatus(appointment) {
  return appointment.protocolId ? "Protokoll erstellt" : "Geplant";
}

function appointmentRow(appointment) {
  const detail = [appointmentPeriod(appointment), appointment.customer, appointment.location].filter(Boolean).join(" · ") || "Ohne weitere Angaben";
  return '<button class="list-row list-row--button appointment-row" type="button" data-action="appointment-detail" data-id="' + escapeHtml(appointment.id) + '">' +
    '<span class="row-icon row-icon--appointment" aria-hidden="true">T</span>' +
    '<span class="row-main"><span class="row-title">' + escapeHtml(appointment.title || "Termin") + '</span><span class="row-subtitle">' + escapeHtml(detail) + '</span></span>' +
    '<span class="row-side"><span class="row-date">' + escapeHtml(appointmentStatus(appointment)) + '</span></span></button>';
}

function renderProtocols() {
  const needle = $("#protocol-search").value.trim().toLocaleLowerCase("de");
  const protocols = [...data.protocols]
    .filter((protocol) => protocolFilter === "all" || protocol.status === protocolFilter)
    .filter((protocol) => [protocol.project, protocol.customer, protocol.location, ...protocol.positions.flatMap((position) => [position.description, position.machine, position.material])].join(" ").toLocaleLowerCase("de").includes(needle))
    .sort((a, b) => `${b.dateTo}${b.updated}`.localeCompare(`${a.dateTo}${a.updated}`));
  $("#protocol-result-summary").textContent = `${protocols.length} ${protocols.length === 1 ? "Protokoll" : "Protokolle"} · ${hours(totalHours(protocols))}`;
  $("#protocol-list").innerHTML = protocols.map(protocolRow).join("") || emptyState("Kein Arbeitsprotokoll gefunden.");
}

function timerSeconds() {
  const stored = Number(data.timer.pendingSeconds || 0);
  return data.timer.startedAt ? stored + Math.max(0, Math.floor((Date.now() - Number(data.timer.startedAt)) / 1000)) : stored;
}

function formatDuration(seconds) {
  const h = String(Math.floor(seconds / 3600)).padStart(2, "0");
  const m = String(Math.floor((seconds % 3600) / 60)).padStart(2, "0");
  const s = String(seconds % 60).padStart(2, "0");
  return `${h}:${m}:${s}`;
}

function renderTimer() {
  const running = Boolean(data.timer.startedAt);
  const seconds = timerSeconds();
  $("#timer-display").textContent = formatDuration(seconds);
  $("#timer-state").textContent = running ? "Läuft" : seconds ? "Gestoppt" : "Bereit";
  $("#timer-state").classList.toggle("timer-state--running", running);
  $("#timer-description").textContent = running ? "Die Arbeitszeit wird lokal auf diesem Gerät erfasst." : seconds ? "Die gestoppte Zeit kannst du jetzt einem Arbeitsprotokoll zuordnen." : "Starte die Zeit direkt beim Arbeitsbeginn.";
  $("#timer-button").textContent = running ? "Arbeitszeit stoppen" : "Arbeitszeit starten";
  $("#timer-button").classList.toggle("timer-button--stop", running);
  $("#timer-note").textContent = seconds ? `${hours(seconds / 3600)} stehen zur Übernahme bereit.` : "Gestoppte Zeiten kannst du beim nächsten Arbeitsprotokoll übernehmen.";
  window.clearInterval(timerRefresh);
  if (running) timerRefresh = window.setInterval(renderTimer, 1000);
}

function emptyState(text) { return `<div class="empty-state">${escapeHtml(text)}</div>`; }
function escapeHtml(value) { return String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", "\"": "&quot;" })[character]); }

const holidayCache = new Map();

function calendarIso(date) {
  return date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0") + "-" + String(date.getDate()).padStart(2, "0");
}

function easterSunday(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = (h + l - 7 * m + 114) % 31 + 1;
  return new Date(year, month - 1, day, 12);
}

function offsetCalendarDate(date, days) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function badenWuerttembergHolidays(year) {
  if (holidayCache.has(year)) return holidayCache.get(year);
  const easter = easterSunday(year);
  const holidayRows = [
    [calendarIso(new Date(year, 0, 1, 12)), "Neujahr"],
    [calendarIso(new Date(year, 0, 6, 12)), "Heilige Drei Könige"],
    [calendarIso(offsetCalendarDate(easter, -2)), "Karfreitag"],
    [calendarIso(offsetCalendarDate(easter, 1)), "Ostermontag"],
    [calendarIso(new Date(year, 4, 1, 12)), "Tag der Arbeit"],
    [calendarIso(offsetCalendarDate(easter, 39)), "Christi Himmelfahrt"],
    [calendarIso(offsetCalendarDate(easter, 50)), "Pfingstmontag"],
    [calendarIso(offsetCalendarDate(easter, 60)), "Fronleichnam"],
    [calendarIso(new Date(year, 9, 3, 12)), "Tag der Deutschen Einheit"],
    [calendarIso(new Date(year, 10, 1, 12)), "Allerheiligen"],
    [calendarIso(new Date(year, 11, 25, 12)), "1. Weihnachtstag"],
    [calendarIso(new Date(year, 11, 26, 12)), "2. Weihnachtstag"]
  ];
  const holidays = new Map(holidayRows);
  holidayCache.set(year, holidays);
  return holidays;
}

function calendarHoliday(date) {
  return badenWuerttembergHolidays(Number(date.slice(0, 4))).get(date) || "";
}

function protocolsOnCalendarDate(date) {
  return data.protocols.filter((protocol) => {
    const from = protocol.dateFrom || protocol.date;
    const to = protocol.dateTo || from;
    return from <= date && to >= date;
  });
}

function appointmentsOnCalendarDate(date) {
  return (data.appointments || []).filter((appointment) => {
    const from = appointment.dateFrom || appointment.date;
    const to = appointment.dateTo || from;
    return from <= date && to >= date;
  });
}

function calendarProtocolLabel(protocol) {
  return protocol.project || protocol.positions?.[0]?.description || "Arbeitsprotokoll";
}

function calendarAppointmentLabel(appointment) {
  return appointment.title || "Termin";
}

function appointmentPeriod(appointment) {
  const from = appointment.dateFrom || appointment.date;
  const to = appointment.dateTo || from;
  return from === to ? displayDate(from) : displayDate(from) + " - " + displayDate(to);
}

function moveCalendarMonth(months) {
  calendarCursor = new Date(calendarCursor.getFullYear(), calendarCursor.getMonth() + months, 1, 12);
  calendarSelected = calendarIso(calendarCursor);
  renderCalendar();
}

function selectCalendarDay(date) {
  calendarSelected = date;
  renderCalendar();
}

function renderCalendar() {
  const grid = $("#calendar-grid");
  if (!grid) return;
  const year = calendarCursor.getFullYear();
  const month = calendarCursor.getMonth();
  const monthStart = new Date(year, month, 1, 12);
  const monthEnd = new Date(year, month + 1, 0, 12);
  const monthPrefix = calendarIso(monthStart).slice(0, 7);
  if (!calendarSelected.startsWith(monthPrefix)) calendarSelected = monthPrefix + "-01";
  $("#calendar-month-label").textContent = new Intl.DateTimeFormat("de-DE", { month: "long", year: "numeric" }).format(monthStart);
  const firstWeekday = (monthStart.getDay() + 6) % 7;
  const cellMarkup = [];
  for (let index = 0; index < firstWeekday; index += 1) cellMarkup.push('<span class="calendar-day calendar-day--empty" aria-hidden="true"></span>');
  for (let day = 1; day <= monthEnd.getDate(); day += 1) {
    const date = calendarIso(new Date(year, month, day, 12));
    const protocols = protocolsOnCalendarDate(date);
    const appointments = appointmentsOnCalendarDate(date);
    const calendarItems = [...appointments.map((appointment) => ({ type: "appointment", label: calendarAppointmentLabel(appointment) })), ...protocols.map((protocol) => ({ type: "protocol", label: calendarProtocolLabel(protocol) }))];
    const primaryItem = calendarItems[0];
    const holiday = calendarHoliday(date);
    const classes = ["calendar-day"];
    if (date === today()) classes.push("calendar-day--today");
    if (date === calendarSelected) classes.push("calendar-day--selected");
    if (new Date(year, month, day, 12).getDay() === 0) classes.push("calendar-day--sunday");
    if (holiday) classes.push("calendar-day--holiday");
    if (calendarItems.length) classes.push("calendar-day--occupied");
    if (protocols.length) classes.push("calendar-day--protocol");
    if (appointments.length) classes.push("calendar-day--appointment");
    if (protocols.length && appointments.length) classes.push("calendar-day--mixed");
    const entries = primaryItem
      ? '<span class="calendar-entry calendar-entry--' + primaryItem.type + '">' + escapeHtml(primaryItem.label) + '</span>' + (calendarItems.length > 1 ? '<span class="calendar-more">+' + (calendarItems.length - 1) + '</span>' : "")
      : holiday ? '<span class="calendar-holiday-label">' + escapeHtml(holiday) + '</span>' : "";
    const holidayMarker = holiday && primaryItem ? '<span class="calendar-holiday-flag" title="' + escapeHtml(holiday) + '">F</span>' : "";
    const label = date + ": " + (holiday ? holiday + (calendarItems.length ? ", " : "") : "") + (calendarItems.length ? calendarItems.map((item) => item.label).join(", ") : "frei");
    cellMarkup.push('<button class="' + classes.join(" ") + '" type="button" data-action="calendar-day" data-date="' + date + '" aria-label="' + escapeHtml(label) + '"><time datetime="' + date + '">' + day + '</time>' + holidayMarker + entries + '</button>');
  }
  grid.innerHTML = cellMarkup.join("");
  const selectedAppointments = appointmentsOnCalendarDate(calendarSelected);
  const selectedProtocols = protocolsOnCalendarDate(calendarSelected);
  $("#calendar-selected-title").textContent = new Intl.DateTimeFormat("de-DE", { weekday: "long", day: "numeric", month: "long" }).format(toDate(calendarSelected));
  $("#calendar-day-list").innerHTML = selectedAppointments.map(appointmentRow).join("") + selectedProtocols.map(protocolRow).join("") || emptyState("Für diesen Tag sind keine Termine oder Arbeitsprotokolle eingetragen.");
  const monthFrom = calendarIso(monthStart);
  const monthTo = calendarIso(monthEnd);
  const monthProtocols = data.protocols.filter((protocol) => (protocol.dateFrom || protocol.date) <= monthTo && (protocol.dateTo || protocol.dateFrom || protocol.date) >= monthFrom);
  const monthAppointments = (data.appointments || []).filter((appointment) => (appointment.dateFrom || appointment.date) <= monthTo && (appointment.dateTo || appointment.dateFrom || appointment.date) >= monthFrom);
  const bookedDays = Array.from({ length: monthEnd.getDate() }, (_, index) => monthFrom.slice(0, 8) + String(index + 1).padStart(2, "0")).filter((date) => protocolsOnCalendarDate(date).length || appointmentsOnCalendarDate(date).length).length;
  const summary = [];
  if (monthAppointments.length) summary.push(monthAppointments.length + " " + (monthAppointments.length === 1 ? "Termin" : "Termine"));
  if (monthProtocols.length) summary.push(monthProtocols.length + " " + (monthProtocols.length === 1 ? "Auftrag" : "Aufträge"));
  $("#calendar-result-summary").textContent = (summary.length ? summary.join(" · ") + " · " : "Keine Einträge · ") + bookedDays + " belegte" + (bookedDays === 1 ? "r Tag" : " Tage");
}

function setView(view) {
  $$(".view").forEach((section) => { section.hidden = section.dataset.view !== view; });
  $$(".nav-item").forEach((button) => {
    const active = button.dataset.nav === view || ((view === "activities" || view === "customers") && button.dataset.nav === "more");
    button.classList.toggle("is-active", active);
    if (active) button.setAttribute("aria-current", "page"); else button.removeAttribute("aria-current");
  });
  if (view === "calendar") renderCalendar();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function showDialog({ eyebrow = "LUKS Mobil", title, content }) {
  $("#dialog-eyebrow").textContent = eyebrow;
  $("#dialog-title").textContent = title;
  $("#dialog-content").innerHTML = content;
  $("#app-dialog").showModal();
}

function closeDialog() {
  const dialog = $("#app-dialog");
  if (dialog.open) dialog.close();
}

function positionEditorMarkup(index, initial = {}) {
  const value = (name) => escapeHtml(initial[name] || "");
  const hourValue = initial.hours === "" || initial.hours == null ? "" : Number(initial.hours).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `<section class="position-editor" data-position>
    <div class="position-editor-heading"><strong>Position ${index}</strong><button type="button" class="text-button" data-action="remove-position">Entfernen</button></div>
    <label class="form-field">Tätigkeit<input class="position-activity" list="activity-options" value="${value("description")}" placeholder="Tätigkeit aus dem Stamm wählen"></label>
    <div class="form-two-columns"><label class="form-field">Stunden<input class="position-hours" type="text" inputmode="decimal" value="${hourValue}" placeholder="0,00"></label><label class="form-field">Maschine<input class="position-machine" value="${value("machine")}" placeholder="Maschine"></label></div>
    <label class="form-field">Material<input class="position-material" value="${value("material")}" placeholder="Material"></label>
  </section>`;
}

function bindPositionList() {
  const list = $("#position-list");
  if (!list) return;
  list.addEventListener("change", (event) => {
    if (event.target.matches(".position-activity")) applyActivityDefaults(event.target);
  });
  list.addEventListener("focusout", (event) => {
    if (!event.target.matches(".position-hours")) return;
    const formattedHours = formatHoursInput(event.target.value);
    if (formattedHours) event.target.value = formattedHours;
  });
}

function applyActivityDefaults(input) {
  const activity = activities.find((entry) => entry.name.toLocaleLowerCase("de") === input.value.trim().toLocaleLowerCase("de"));
  if (!activity) return;
  const position = input.closest("[data-position]");
  const machine = $(".position-machine", position);
  const material = $(".position-material", position);
  if (!machine.value) machine.value = activity.defaultMachine || "";
  if (!material.value) material.value = activity.defaultMaterial || "";
}

function addPosition() {
  const list = $("#position-list");
  if (!list) return;
  list.insertAdjacentHTML("beforeend", positionEditorMarkup(list.querySelectorAll("[data-position]").length + 1));
  updatePositionLabels();
}

function removePosition(position) {
  const list = $("#position-list");
  if (!list || list.querySelectorAll("[data-position]").length === 1) {
    showToast("Mindestens eine Position wird benötigt");
    return;
  }
  position?.remove();
  updatePositionLabels();
}

function updatePositionLabels() {
  $$("#position-list [data-position]").forEach((position, index) => {
    $(".position-editor-heading strong", position).textContent = `Position ${index + 1}`;
  });
}

function parseHoursInput(value) {
  const input = String(value || "").trim().replace(/\s/g, "");
  if (!input) return Number.NaN;
  const normalized = input.includes(",") ? input.replace(/\./g, "").replace(",", ".") : input;
  return Number(normalized);
}

function formatHoursInput(value) {
  const hours = parseHoursInput(value);
  if (!Number.isFinite(hours)) return "";
  return hours.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function collectPositions() {
  const positions = $$("#position-list [data-position]").map((position, index) => ({
    id: `position-${crypto.randomUUID()}`,
    description: $(".position-activity", position).value.trim(),
    hours: parseHoursInput($(".position-hours", position).value),
    machine: $(".position-machine", position).value.trim(),
    material: $(".position-material", position).value.trim()
  }));
  if (!positions.length || positions.some((position) => !position.description || !Number.isFinite(position.hours) || position.hours <= 0)) {
    showToast("Bitte für jede Position Tätigkeit und Stunden eintragen");
    return null;
  }
  return mergeSameActivities(positions);
}

function openNewAppointment(date = calendarSelected) {
  showDialog({
    eyebrow: "Neuer Termin",
    title: "Einsatz planen",
    content: [
      '<div class="dialog-body"><div class="form-grid">',
      '<label class="form-field">Tätigkeit / Termin<input name="appointment-title" placeholder="z. B. Mähen" required autofocus></label>',
      '<div class="form-two-columns"><label class="form-field">Von<input name="appointment-date-from" type="date" value="', escapeHtml(date), '" required></label><label class="form-field">Bis<input name="appointment-date-to" type="date" value="', escapeHtml(date), '" required></label></div>',
      '<label class="form-field">Kunde<input name="appointment-customer" list="customer-options" placeholder="Kundenname oder Auftraggeber"></label>', customerOptions(),
      '<label class="form-field">Ort / Baustelle<input name="appointment-location" placeholder="Ort oder Bereich"></label>',
      '<label class="form-field">Mitarbeiter<input name="appointment-team" placeholder="z. B. Rick Schuler"></label>',
      '<label class="form-field">Hinweis<textarea name="appointment-notes" rows="2" placeholder="z. B. Fläche am Regenüberlaufbecken mähen"></textarea></label>',
      '</div><div class="dialog-actions"><button class="button" type="submit" value="cancel" formnovalidate>Abbrechen</button><button class="button button--primary" type="button" data-dialog-action="save-appointment">Termin speichern</button></div></div>'
    ].join("")
  });
}

function saveAppointment() {
  const form = $("#dialog-form");
  if (!form.reportValidity()) return;
  const values = new FormData(form);
  const dateFrom = values.get("appointment-date-from");
  const dateTo = values.get("appointment-date-to");
  if (dateTo < dateFrom) {
    showToast("Das Bis-Datum darf nicht vor dem Von-Datum liegen");
    return;
  }
  const appointment = {
    id: "termin-" + crypto.randomUUID(),
    title: values.get("appointment-title").trim(),
    date: dateFrom,
    dateFrom,
    dateTo,
    customer: values.get("appointment-customer").trim(),
    location: values.get("appointment-location").trim(),
    team: values.get("appointment-team").trim(),
    notes: values.get("appointment-notes").trim(),
    created: today()
  };
  data.appointments = data.appointments || [];
  data.appointments.push(appointment);
  calendarSelected = appointment.dateFrom;
  calendarCursor = toDate(appointment.dateFrom);
  closeDialog();
  saveData("Termin gespeichert");
  setView("calendar");
}

function openAppointmentDetail(id) {
  const appointment = (data.appointments || []).find((entry) => entry.id === id);
  if (!appointment) return;
  const linkedProtocol = appointment.protocolId ? data.protocols.find((protocol) => protocol.id === appointment.protocolId) : null;
  const action = linkedProtocol
    ? '<button class="button button--primary" type="button" data-dialog-action="open-linked-protocol" data-id="' + escapeHtml(linkedProtocol.id) + '">Protokoll öffnen</button>'
    : '<button class="button button--primary" type="button" data-dialog-action="create-protocol-from-appointment" data-id="' + escapeHtml(appointment.id) + '">Arbeitsprotokoll erstellen</button>';
  showDialog({
    eyebrow: appointmentPeriod(appointment),
    title: appointment.title || "Termin",
    content: '<div class="dialog-body"><span class="status status--open">' + escapeHtml(appointmentStatus(appointment)) + '</span><div class="detail-grid"><div><span>Kunde</span><strong>' + escapeHtml(appointment.customer || "—") + '</strong></div><div><span>Ort</span><strong>' + escapeHtml(appointment.location || "—") + '</strong></div><div><span>Mitarbeiter</span><strong>' + escapeHtml(appointment.team || "—") + '</strong></div><div><span>Zeitraum</span><strong>' + escapeHtml(appointmentPeriod(appointment)) + '</strong></div></div>' + (appointment.notes ? '<section class="protocol-detail-section"><span>Hinweis</span><p>' + escapeHtml(appointment.notes) + '</p></section>' : "") + '<div class="dialog-actions"><button class="button danger-button" type="button" data-dialog-action="delete-appointment" data-id="' + escapeHtml(appointment.id) + '">Löschen</button>' + action + '</div></div>'
  });
}

function deleteAppointment(id) {
  if (!confirm("Diesen Termin wirklich löschen?")) return;
  data.appointments = (data.appointments || []).filter((appointment) => appointment.id !== id);
  closeDialog();
  saveData("Termin gelöscht");
}

function openNewProtocol(date = today(), appointment = null) {
  const seconds = timerSeconds();
  const suggestedHours = seconds ? Math.max(.01, seconds / 3600).toFixed(2) : "";
  const dateFrom = appointment?.dateFrom || appointment?.date || date;
  const dateTo = appointment?.dateTo || appointment?.date || dateFrom;
  const initial = (field) => escapeHtml(appointment?.[field] || "");
  const initialTitle = escapeHtml(appointment?.title || "");
  pendingPhotos = [];
  photosBeingProcessed = false;
  showDialog({
    eyebrow: "Neues Arbeitsprotokoll",
    title: "Auftrag erfassen",
    content: `<div class="dialog-body"><div class="form-grid">
      <input type="hidden" name="source-appointment" value="${escapeHtml(appointment?.id || "")}">
      <label class="form-field">Baustelle / Projekt<input name="project" value="${initialTitle}" placeholder="z. B. Pflege Gewann Tälesteich" required autofocus></label>
      <label class="form-field">Kunde<input name="customer" list="customer-options" value="${initial("customer")}" placeholder="Kundenname oder Auftraggeber"></label>${customerOptions()}
      <label class="form-field">Ort / Baustelle<input name="location" value="${initial("location")}" placeholder="Ort oder Bereich" required></label>
      <div class="form-two-columns"><label class="form-field">Von<input name="date-from" type="date" value="${dateFrom}" required></label><label class="form-field">Bis<input name="date-to" type="date" value="${dateTo}" required></label></div>
      <label class="form-field">Mitarbeiter<input name="team" value="${initial("team")}" placeholder="z. B. Rick Schuler, Max Mustermann"></label>
      <section class="position-section"><div class="section-heading"><h3>Positionen</h3><button type="button" class="text-button" data-action="add-position">+ Position</button></div>${activityOptions()}<div id="position-list">${positionEditorMarkup(1, { hours: suggestedHours, description: appointment?.title || "" })}</div></section>
      <label class="form-field">Bemerkung<textarea name="notes" rows="2" placeholder="Besonderheiten, Schäden oder Hinweise">${initial("notes")}</textarea></label>
      <div class="photo-capture"><input id="protocol-photos" name="photos" type="file" accept="image/*" capture="environment" multiple><label for="protocol-photos" class="photo-capture-button"><span aria-hidden="true">◉</span> Foto aufnehmen</label><p>Bis zu 4 Fotos werden verkleinert und nur auf diesem Gerät gespeichert.</p></div>
      <div class="photo-preview" id="photo-preview" aria-live="polite"></div>
    </div><div class="dialog-actions"><button class="button" type="submit" value="cancel" formnovalidate>Abbrechen</button><button class="button button--primary" type="button" data-dialog-action="save-protocol">Als Entwurf speichern</button></div></div>`
  });
  bindPhotoInput();
  bindPositionList();
}

function openProtocolEditor(id) {
  const protocol = data.protocols.find((entry) => entry.id === id);
  if (!protocol) return;
  const value = (field) => escapeHtml(protocol[field] || "");
  const positions = protocol.positions.length ? protocol.positions.map((position, index) => positionEditorMarkup(index + 1, position)).join("") : positionEditorMarkup(1);
  pendingPhotos = Array.isArray(protocol.photos) ? protocol.photos.filter((photo) => safePhotoSrc(photo)) : [];
  photosBeingProcessed = false;
  showDialog({
    eyebrow: "Arbeitsprotokoll bearbeiten",
    title: protocol.project || "Arbeitsprotokoll",
    content: [
      '<div class="dialog-body"><p class="local-note">Die Stammdaten und bisherigen Positionen bleiben erhalten. Ergänze nur neue Tage, Stunden, Positionen oder Fotos.</p><div class="form-grid">',
      '<label class="form-field">Baustelle / Projekt<input name="project" value="' + value("project") + '" required autofocus></label>',
      '<label class="form-field">Kunde<input name="customer" list="customer-options" value="' + value("customer") + '" placeholder="Kundenname oder Auftraggeber"></label>', customerOptions(),
      '<label class="form-field">Ort / Baustelle<input name="location" value="' + value("location") + '" required></label>',
      '<div class="form-two-columns"><label class="form-field">Von<input name="date-from" type="date" value="' + escapeHtml(protocol.dateFrom || protocol.date || today()) + '" required></label><label class="form-field">Bis<input name="date-to" type="date" value="' + escapeHtml(protocol.dateTo || protocol.date || today()) + '" required></label></div>',
      '<label class="form-field">Mitarbeiter<input name="team" value="' + value("team") + '"></label>',
      '<section class="position-section"><div class="section-heading"><h3>Positionen</h3><button type="button" class="text-button" data-action="add-position">+ Position</button></div>', activityOptions(), '<div id="position-list">', positions, '</div></section>',
      '<label class="form-field">Bemerkung<textarea name="notes" rows="2" placeholder="Besonderheiten, Schäden oder Hinweise">', value("notes"), '</textarea></label>',
      '<div class="photo-capture"><input id="protocol-photos" name="photos" type="file" accept="image/*" capture="environment" multiple><label for="protocol-photos" class="photo-capture-button"><span aria-hidden="true">◉</span> Foto aufnehmen</label><p>Bis zu 4 Fotos werden verkleinert und nur auf diesem Gerät gespeichert.</p></div>',
      '<div class="photo-preview" id="photo-preview" aria-live="polite"></div>',
      '</div><div class="dialog-actions"><button class="button" type="submit" value="cancel" formnovalidate>Abbrechen</button><button class="button button--primary" type="button" data-dialog-action="save-protocol" data-id="', escapeHtml(protocol.id), '">Änderungen speichern</button></div></div>'
    ].join("")
  });
  bindPhotoInput();
  bindPositionList();
  renderPhotoPreview();
}

function openNewCustomer() {
  openCustomerEditor();
}

function openCustomerEditor(id) {
  const customer = id == null ? null : customers.find((entry) => Number(entry.id) === Number(id));
  if (id != null && !customer) return showToast("Kunde nicht gefunden");
  const value = (field) => escapeHtml(customer?.[field] || "");
  showDialog({
    eyebrow: customer ? "Kundenstamm bearbeiten" : "Neuer Kunde",
    title: customer ? customer.name : "Kunden anlegen",
    content: `<div class="dialog-body"><div class="form-grid">
      <label class="form-field">Firmen- / Kundenname<input name="customer-name" value="${value("name")}" placeholder="Name des Kunden" required autofocus></label>
      <label class="form-field">Ansprechpartner<input name="customer-contact" value="${value("contact")}" placeholder="Vor- und Nachname"></label>
      <label class="form-field">Straße / Hausnummer<input name="customer-street" value="${value("street")}" placeholder="Straße und Hausnummer"></label>
      <div class="form-two-columns"><label class="form-field">PLZ<input name="customer-postal-code" value="${value("postalCode")}" inputmode="numeric" placeholder="PLZ"></label><label class="form-field">Ort<input name="customer-city" value="${value("city")}" placeholder="Ort"></label></div>
      <label class="form-field">Telefon<input name="customer-phone" value="${value("phone")}" type="tel" placeholder="Telefonnummer"></label>
      <label class="form-field">E-Mail<input name="customer-email" value="${value("email")}" type="email" placeholder="E-Mail-Adresse"></label>
    </div><div class="dialog-actions">${customer ? `<button class="button danger-button" type="button" data-dialog-action="delete-customer" data-id="${customer.id}">Löschen</button>` : ""}<button class="button" type="submit" value="cancel" formnovalidate>Abbrechen</button><button class="button button--primary" type="button" data-dialog-action="save-customer" data-id="${customer?.id || ""}">Speichern</button></div></div>`
  });
}

async function saveCustomer(id) {
  const form = $("#dialog-form");
  if (!form.reportValidity()) return;
  const values = new FormData(form);
  const customer = {
    name: values.get("customer-name").trim(), contact: values.get("customer-contact").trim(), street: values.get("customer-street").trim(),
    postalCode: values.get("customer-postal-code").trim(), city: values.get("customer-city").trim(), phone: values.get("customer-phone").trim(),
    email: values.get("customer-email").trim(), updatedAt: new Date().toISOString()
  };
  if (id) customer.id = Number(id);
  try {
    await CustomerDb.save(customer);
    closeDialog();
    await loadCustomers();
    showToast(id ? "Kundenstamm aktualisiert" : "Kunde angelegt");
  } catch (_) {
    showToast("Kunde konnte nicht gespeichert werden");
  }
}

async function deleteCustomer(id) {
  if (!confirm("Diesen Kunden wirklich aus dem Kundenstamm löschen?")) return;
  try {
    await CustomerDb.remove(id);
    closeDialog();
    await loadCustomers();
    showToast("Kunde gelöscht");
  } catch (_) {
    showToast("Kunde konnte nicht gelöscht werden");
  }
}

function openNewActivity() {
  openActivityEditor();
}

function openActivityEditor(id) {
  const activity = id == null ? null : activities.find((entry) => Number(entry.id) === Number(id));
  if (id != null && !activity) return showToast("Tätigkeit nicht gefunden");
  const value = (field) => escapeHtml(activity?.[field] || "");
  showDialog({
    eyebrow: activity ? "Tätigkeit bearbeiten" : "Neue Tätigkeit",
    title: activity ? activity.name : "Tätigkeit anlegen",
    content: `<div class="dialog-body"><div class="form-grid">
      <label class="form-field">Tätigkeit<input name="activity-name" value="${value("name")}" placeholder="z. B. Mulchen" required autofocus></label>
      <label class="form-field">Standardmaschine<input name="activity-machine" value="${value("defaultMachine")}" placeholder="z. B. Raupe"></label>
      <label class="form-field">Standardmaterial<input name="activity-material" value="${value("defaultMaterial")}" placeholder="z. B. Kraftstoff"></label>
    </div><div class="dialog-actions">${activity ? `<button class="button danger-button" type="button" data-dialog-action="delete-activity" data-id="${activity.id}">Löschen</button>` : ""}<button class="button" type="submit" value="cancel" formnovalidate>Abbrechen</button><button class="button button--primary" type="button" data-dialog-action="save-activity" data-id="${activity?.id || ""}">Speichern</button></div></div>`
  });
}

async function saveActivity(id) {
  const form = $("#dialog-form");
  if (!form.reportValidity()) return;
  const values = new FormData(form);
  const activity = {
    name: values.get("activity-name").trim(), defaultMachine: values.get("activity-machine").trim(),
    defaultMaterial: values.get("activity-material").trim(), updatedAt: new Date().toISOString()
  };
  if (id) activity.id = Number(id);
  try {
    await ActivityDb.save(activity);
    closeDialog();
    await loadActivities();
    showToast(id ? "Tätigkeit aktualisiert" : "Tätigkeit angelegt");
  } catch (_) {
    showToast("Tätigkeit konnte nicht gespeichert werden");
  }
}

async function deleteActivity(id) {
  if (!confirm("Diese Tätigkeit wirklich aus dem Stamm löschen?")) return;
  try {
    await ActivityDb.remove(id);
    closeDialog();
    await loadActivities();
    showToast("Tätigkeit gelöscht");
  } catch (_) {
    showToast("Tätigkeit konnte nicht gelöscht werden");
  }
}

function protocolPositionDetails(protocol) {
  return `<section class="protocol-detail-section"><span>Positionen (${protocol.positions.length})</span><div class="protocol-position-list">${protocol.positions.map((position) => `<div class="protocol-position"><strong>${escapeHtml(position.description)}</strong><b>${hours(position.hours)}</b>${position.machine ? `<small>Maschine: ${escapeHtml(position.machine)}</small>` : ""}${position.material ? `<small>Material: ${escapeHtml(position.material)}</small>` : ""}</div>`).join("")}</div></section>`;
}

function openProtocolDetail(id) {
  const protocol = data.protocols.find((row) => row.id === id);
  if (!protocol) return;
  const status = protocolStatus(protocol);
  showDialog({
    eyebrow: protocolPeriod(protocol),
    title: protocol.project || "Arbeitsprotokoll",
    content: `<div class="dialog-body"><span class="status status--${status.className}">${status.label}</span><p class="detail-amount">${hours(protocol.hours)}</p>
      <div class="detail-grid"><div><span>Auftraggeber</span><strong>${escapeHtml(protocol.customer || "—")}</strong></div><div><span>Ort</span><strong>${escapeHtml(protocol.location || "—")}</strong></div><div><span>Zeitraum</span><strong>${protocolPeriod(protocol)}</strong></div><div><span>Mitarbeiter</span><strong>${escapeHtml(protocol.team || "—")}</strong></div></div>
      ${protocolPositionDetails(protocol)}
      ${protocol.notes ? `<section class="protocol-detail-section"><span>Bemerkung</span><p>${escapeHtml(protocol.notes)}</p></section>` : ""}
      ${protocolPhotos(protocol)}
      ${protocol.invoiceReleasedAt ? `<p class="invoice-release-state">Für Rechnung freigegeben am ${displayDate(protocol.invoiceReleasedAt)}</p>` : ""}
      <div class="invoice-transfer-actions"><button class="button button--primary" type="button" data-dialog-action="export-for-invoice" data-id="${escapeHtml(id)}">${protocol.invoiceReleasedAt ? "PDF erneut exportieren" : "Für Rechnung als PDF exportieren"}</button><button class="button" type="button" data-dialog-action="share-for-invoice" data-id="${escapeHtml(id)}">PDF teilen</button></div>
      <div class="dialog-actions"><button class="button" type="button" data-dialog-action="edit-protocol" data-id="${escapeHtml(id)}">Bearbeiten</button><button class="button danger-button" type="button" data-dialog-action="delete-protocol" data-id="${escapeHtml(id)}">Löschen</button>${protocol.status === "draft" ? `<button class="button button--primary" type="button" data-dialog-action="complete-protocol" data-id="${escapeHtml(id)}">Abschließen</button>` : ""}</div></div>`
  });
}

function bindPhotoInput() {
  const input = $("#protocol-photos");
  if (!input) return;
  input.addEventListener("change", () => addPhotos([...input.files]));
}

async function addPhotos(files) {
  const available = Math.max(0, 4 - pendingPhotos.length);
  const selected = files.filter((file) => file.type.startsWith("image/")).slice(0, available);
  if (!selected.length) {
    showToast(pendingPhotos.length >= 4 ? "Es können höchstens 4 Fotos gespeichert werden" : "Bitte ein Bild auswählen");
    return;
  }
  photosBeingProcessed = true;
  showToast("Foto wird vorbereitet …");
  try {
    const photos = await Promise.all(selected.map(compressPhoto));
    pendingPhotos.push(...photos);
    renderPhotoPreview();
  } catch (_) {
    showToast("Das Foto konnte nicht verarbeitet werden");
  } finally {
    photosBeingProcessed = false;
  }
}

function compressPhoto(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error("image-load-failed"));
      image.onload = () => {
        const largestSide = Math.max(image.naturalWidth, image.naturalHeight);
        const scale = largestSide > 1280 ? 1280 / largestSide : 1;
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
        canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", .76));
      };
      image.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function renderPhotoPreview() {
  const preview = $("#photo-preview");
  if (!preview) return;
  preview.innerHTML = pendingPhotos.map((photo, index) => `<div class="photo-thumb"><img src="${safePhotoSrc(photo)}" alt="Aufgenommenes Foto ${index + 1}"><button type="button" data-action="remove-pending-photo" data-index="${index}" aria-label="Foto ${index + 1} entfernen">×</button></div>`).join("");
}

function removePendingPhoto(index) {
  pendingPhotos.splice(Number(index), 1);
  renderPhotoPreview();
}

function safePhotoSrc(value) {
  return typeof value === "string" && /^data:image\/(jpeg|png|webp);base64,/i.test(value) ? escapeHtml(value) : "";
}

function protocolPhotos(protocol) {
  const photos = Array.isArray(protocol.photos) ? protocol.photos.map(safePhotoSrc).filter(Boolean) : [];
  if (!photos.length) return "";
  return `<section class="protocol-detail-section"><span>Fotos (${photos.length})</span><div class="photo-gallery">${photos.map((photo, index) => `<img src="${photo}" alt="Baustellenfoto ${index + 1}">`).join("")}</div></section>`;
}

function protocolPdfFilename(protocol) {
  const safeName = `${protocol.dateFrom || protocol.date || today()}-${protocol.project || "arbeitsprotokoll"}`
    .replace(/[^a-z0-9äöüß]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();
  return `luks-arbeitsprotokoll-${safeName || "arbeitsprotokoll"}.pdf`;
}

function protocolPdfPeriod(protocol) {
  const from = protocol.dateFrom || protocol.date;
  const to = protocol.dateTo || from;
  return from === to ? displayDate(from) : `${displayDate(from)} - ${displayDate(to)}`;
}

function protocolPrintDocument(protocol) {
  const customer = customers.find((entry) => entry.name === protocol.customer);
  const customerAddress = customer ? [customer.street, [customer.postalCode, customer.city].filter(Boolean).join(" ")].filter(Boolean) : [];
  const logoUrl = escapeHtml(new URL("luks-logo.png", window.location.href).href);
  const positionRows = protocol.positions.map((position) => {
    const details = [position.machine && `Maschine: ${position.machine}`, position.material && `Material: ${position.material}`].filter(Boolean).join(" | ");
    return `<tr><td><strong>${escapeHtml(position.description)}</strong>${details ? `<small>${escapeHtml(details)}</small>` : ""}</td><td>${escapeHtml(hours(position.hours))}</td></tr>`;
  }).join("");
  const photos = Array.isArray(protocol.photos) ? protocol.photos.map(safePhotoSrc).filter(Boolean) : [];
  const photoSection = photos.length ? `<section><h2>Fotos</h2><div class="photos">${photos.map((photo, index) => `<img src="${photo}" alt="Foto ${index + 1}">`).join("")}</div></section>` : "";
  const notes = protocol.notes ? `<section><h2>Bemerkung</h2><p class="notes">${escapeHtml(protocol.notes).replace(/\r?\n/g, "<br>")}</p></section>` : "";
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(protocolPdfFilename(protocol))}</title><style>
    @page { size: A4; margin: 14mm; }
    * { box-sizing: border-box; } body { margin: 0; color: #102b3a; font-family: Arial, Helvetica, sans-serif; font-size: 10.5pt; line-height: 1.4; }
    header { display: flex; align-items: center; justify-content: space-between; gap: 20px; padding-bottom: 15px; border-bottom: 3px solid #164d6b; }
    .brand { display: flex; align-items: center; gap: 10px; color: #164d6b; font-size: 15pt; font-weight: 700; } .brand img { width: 40px; height: 40px; object-fit: contain; background: #000; border-radius: 6px; }
    .document-type { color: #55717f; font-size: 8pt; font-weight: 700; letter-spacing: .08em; text-align: right; text-transform: uppercase; }
    h1 { margin: 22px 0 14px; color: #123e57; font-size: 21pt; line-height: 1.18; } h2 { margin: 0 0 7px; color: #164d6b; font-size: 10pt; text-transform: uppercase; letter-spacing: .04em; }
    .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 16px; } .meta div, section { break-inside: avoid; } .meta div { min-height: 57px; padding: 10px; border: 1px solid #d7e2e7; border-radius: 5px; background: #f5f8f9; }
    .label { display: block; margin-bottom: 3px; color: #55717f; font-size: 8pt; font-weight: 700; text-transform: uppercase; } .meta strong { display: block; color: #102b3a; font-size: 10.5pt; }
    section { margin-top: 16px; } table { width: 100%; border-collapse: collapse; } th { padding: 8px 9px; color: #fff; background: #164d6b; font-size: 8.5pt; text-align: left; text-transform: uppercase; } th:last-child, td:last-child { width: 29%; text-align: right; } td { padding: 9px; vertical-align: top; border-bottom: 1px solid #d7e2e7; } td strong, td small { display: block; } td small { margin-top: 2px; color: #55717f; font-size: 8.5pt; }
    .total { display: flex; justify-content: flex-end; margin-top: 10px; color: #123e57; font-size: 13pt; font-weight: 700; } .total span { margin-left: 20px; } .notes { margin: 0; padding: 10px; border-radius: 5px; background: #f5f8f9; white-space: normal; }
    .photos { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; } .photos img { width: 100%; max-height: 96mm; object-fit: cover; border: 1px solid #d7e2e7; border-radius: 4px; }
    footer { margin-top: 24px; padding-top: 9px; border-top: 1px solid #d7e2e7; color: #55717f; font-size: 8pt; } @media print { body { print-color-adjust: exact; -webkit-print-color-adjust: exact; } }
  </style></head><body><header><div class="brand"><img src="${logoUrl}" alt="LUKS">LUKS Mobil</div><div class="document-type">Arbeitsprotokoll<br>${escapeHtml(protocolPdfPeriod(protocol))}</div></header>
  <h1>${escapeHtml(protocol.project || "Arbeitsprotokoll")}</h1><div class="meta"><div><span class="label">Auftraggeber</span><strong>${escapeHtml(protocol.customer || "-")}</strong>${customerAddress.map((line) => `<span>${escapeHtml(line)}</span>`).join("")}</div><div><span class="label">Einsatzort</span><strong>${escapeHtml(protocol.location || "-")}</strong></div><div><span class="label">Zeitraum</span><strong>${escapeHtml(protocolPdfPeriod(protocol))}</strong></div><div><span class="label">Mitarbeiter</span><strong>${escapeHtml(protocol.team || "-")}</strong></div></div>
  <section><h2>Leistungen</h2><table><thead><tr><th>Tätigkeit</th><th>Stunden</th></tr></thead><tbody>${positionRows}</tbody></table><div class="total">Gesamtstunden <span>${escapeHtml(hours(protocol.hours))}</span></div></section>${notes}${photoSection}<footer>Erstellt mit LUKS Mobil am ${escapeHtml(new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date()))}</footer>
  <script>window.addEventListener("load", function () { window.setTimeout(function () { window.focus(); window.print(); }, 250); });</script></body></html>`;
}

function printProtocolPdf(id) {
  const protocol = data.protocols.find((entry) => entry.id === id);
  if (!protocol) return;
  const printWindow = window.open("", "_blank");
  if (!printWindow) {
    showToast("Bitte erlaube Pop-ups, um das PDF zu speichern");
    return;
  }
  printWindow.document.open();
  printWindow.document.write(protocolPrintDocument(protocol));
  printWindow.document.close();
}

function pdfEscape(value) {
  const replacements = { "€": "\x80", "‚": "\x82", "ƒ": "\x83", "„": "\x84", "…": "\x85", "†": "\x86", "‡": "\x87", "ˆ": "\x88", "‰": "\x89", "Š": "\x8A", "‹": "\x8B", "Œ": "\x8C", "Ž": "\x8E", "‘": "\x91", "’": "\x92", "“": "\x93", "”": "\x94", "•": "\x95", "–": "\x96", "—": "\x97", "™": "\x99", "š": "\x9A", "›": "\x9B", "œ": "\x9C", "ž": "\x9E", "Ÿ": "\x9F" };
  const latin1 = [...String(value ?? "")].map((character) => {
    const code = character.charCodeAt(0);
    return code <= 255 ? character : (replacements[character] || "?");
  }).join("");
  return latin1.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)").replace(/\r?\n/g, " ");
}

function pdfWrap(value, maxLength = 76) {
  return String(value ?? "").replace(/\r/g, "").split("\n").flatMap((paragraph) => {
    const words = paragraph.trim().split(/\s+/).filter(Boolean);
    if (!words.length) return [""];
    const lines = [];
    let line = "";
    words.forEach((word) => {
      const candidate = line ? line + " " + word : word;
      if (candidate.length > maxLength && line) {
        lines.push(line);
        line = word;
      } else {
        line = candidate;
      }
    });
    if (line) lines.push(line);
    return lines;
  });
}

function protocolPdfLines(protocol) {
  const customer = customers.find((entry) => entry.name === protocol.customer);
  const customerAddress = customer ? [customer.street, [customer.postalCode, customer.city].filter(Boolean).join(" ")].filter(Boolean) : [];
  const lines = [];
  const add = (text, options = {}) => lines.push({ text, font: "F1", size: 10, gap: 0, right: "", rightX: 479, machine: "", material: "", type: "", ...options });
  const issuedOn = new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date());
  const recipientLines = [protocol.customer || "Auftraggeber"];
  customerAddress.forEach((addressLine) => pdfWrap(addressLine, 55).forEach((line) => recipientLines.push(line)));
  recipientLines.slice(0, 4).forEach((line) => add(line, { size: 12 }));
  const recipientGap = Math.max(24, 665 - recipientLines.slice(0, 4).length * 17 - 536);
  add("Hechingen, den " + issuedOn, { size: 12, gap: recipientGap, type: "issue-date" });
  pdfWrap("Arbeitsprotokoll - " + (protocol.project || "Arbeitsleistung"), 63).forEach((line, index) => add(line, { font: "F2", size: 16, gap: index === 0 ? 28 : 0 }));
  add("Leistungsdatum: " + protocolPdfPeriod(protocol), { size: 12 });
  add("Bitte bei Rückfragen angeben.", { size: 10, gap: 23 });
  const deployment = ["Einsatzort: " + (protocol.location || "-"), "Mitarbeiter: " + (protocol.team || "-")].join("  |  ");
  pdfWrap(deployment, 78).forEach((line, index) => add(line, { font: index === 0 ? "F2" : "F1", size: 11, gap: index === 0 ? 16 : 0 }));
  add("Tätigkeit", { font: "F2", size: 10, gap: 2, machine: "Maschine", material: "Material", right: "Stunden", rightX: 478, type: "table-heading" });
  protocol.positions.forEach((position, index) => {
    const descriptions = pdfWrap((index + 1) + ". " + (position.description || "Tätigkeit"), 36);
    const machines = pdfWrap(position.machine || "-", 13);
    const materials = pdfWrap(position.material || "-", 13);
    const rowLength = Math.max(descriptions.length, machines.length, materials.length);
    for (let lineIndex = 0; lineIndex < rowLength; lineIndex += 1) {
      add(descriptions[lineIndex] || "", {
        size: 10,
        gap: lineIndex === 0 ? 3 : 0,
        machine: machines[lineIndex] || "",
        material: materials[lineIndex] || "",
        right: lineIndex === 0 ? hours(position.hours) : "",
        rightX: 478,
        type: "position"
      });
    }
  });
  add("Gesamtstunden", { font: "F2", size: 11, gap: 12, right: hours(protocol.hours), rightX: 478, type: "total" });
  if (protocol.notes) {
    add("Bemerkung", { font: "F2", size: 10, gap: 18 });
    pdfWrap(protocol.notes, 76).forEach((line) => add(line, { size: 10 }));
  }
  const photoCount = Array.isArray(protocol.photos) ? protocol.photos.length : 0;
  if (photoCount) {
    add("Fotos", { font: "F2", size: 10, gap: 18 });
    add(photoCount + " Foto" + (photoCount === 1 ? "" : "s") + " sind im Arbeitsprotokoll in LUKS Mobil hinterlegt.", { size: 9 });
  }
  return lines;
}

let pdfLogoPromise;

function jpegDimensions(binary) {
  if (binary.charCodeAt(0) !== 0xFF || binary.charCodeAt(1) !== 0xD8) return null;
  let offset = 2;
  while (offset < binary.length) {
    if (binary.charCodeAt(offset) !== 0xFF) { offset += 1; continue; }
    const marker = binary.charCodeAt(offset + 1);
    offset += 2;
    if (marker === 0xD8 || marker === 0xD9 || (marker >= 0xD0 && marker <= 0xD7)) continue;
    const length = (binary.charCodeAt(offset) << 8) + binary.charCodeAt(offset + 1);
    if (length < 2) return null;
    if ((marker >= 0xC0 && marker <= 0xC3) || (marker >= 0xC5 && marker <= 0xC7) || (marker >= 0xC9 && marker <= 0xCB) || (marker >= 0xCD && marker <= 0xCF)) {
      return { width: (binary.charCodeAt(offset + 5) << 8) + binary.charCodeAt(offset + 6), height: (binary.charCodeAt(offset + 3) << 8) + binary.charCodeAt(offset + 4), binary };
    }
    offset += length;
  }
  return null;
}

function pdfLogoImage() {
  if (pdfLogoPromise) return pdfLogoPromise;
  pdfLogoPromise = new Promise((resolve) => {
    if (typeof Image === "undefined" || typeof document === "undefined" || !document.createElement) { resolve(null); return; }
    const image = new Image();
    image.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = image.naturalWidth || image.width;
        canvas.height = image.naturalHeight || image.height;
        const context = canvas.getContext("2d");
        context.fillStyle = "#000000";
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(image, 0, 0);
        const binary = atob(canvas.toDataURL("image/jpeg", 0.94).split(",")[1]);
        resolve(jpegDimensions(binary));
      } catch (error) {
        resolve(null);
      }
    };
    image.onerror = () => resolve(null);
    image.src = "luks-logo.png";
  });
  return pdfLogoPromise;
}

function pdfPageContent(lines, pageNumber, pageCount, hasLogo) {
  const logoCommand = hasLogo
    ? "q 557 742 m 557 767 537 787 512 787 c 487 787 467 767 467 742 c 467 717 487 697 512 697 c 537 697 557 717 557 742 c h W n 90 0 0 90 467 697 cm /Logo Do Q"
    : "q 0 0 0 rg 512 787 m 537 787 557 767 557 742 c 557 717 537 697 512 697 c 487 697 467 717 467 742 c 467 767 487 787 512 787 c h f Q";
  const commands = [
    logoCommand,
    hasLogo ? "" : "1 0.94 0 rg BT /F2 18 Tf 1 0 0 1 490 732 Tm (LUKS) Tj ET",
    "0.12 0.12 0.12 rg BT /F1 8 Tf 1 0 0 1 78 703 Tm (Landschaft und Kommunalservice Schuler - 72379 Hechingen) Tj ET",
    "0.12 0.12 0.12 rg 0.4 w 78 700 m 255 700 l S",
    "0 0 0 rg BT /F1 12 Tf 1 0 0 1 385 675 Tm (Landschaft und Kommunalservice) Tj ET",
    "0 0 0 rg BT /F1 12 Tf 1 0 0 1 512 660 Tm (Schuler) Tj ET",
    "0 0 0 rg BT /F1 12 Tf 1 0 0 1 483 645 Tm (Neubergstr. 7) Tj ET",
    "0 0 0 rg BT /F1 12 Tf 1 0 0 1 463 631 Tm (72379 Hechingen) Tj ET",
    "0 0 0 rg BT /F1 12 Tf 1 0 0 1 441 616 Tm (Tel.: +49 162 5319003) Tj ET",
    "0 0 0 rg BT /F1 12 Tf 1 0 0 1 423 601 Tm (E-Mail: info-luks@web.de) Tj ET"
  ];
  let y = pageNumber === 1 ? 665 : 720;
  lines.forEach((line) => {
    y -= Number(line.gap || 0);
    if (line.type === "table-heading") {
      commands.push("0 G 0.5 w 74 " + (y - 4) + " m 525 " + (y - 4) + " l S");
    }
    const color = line.font === "F2" ? "0 0 0" : "0.13 0.13 0.13";
    const x = line.type === "issue-date" ? 391 : 74;
    commands.push("BT /" + line.font + " " + line.size + " Tf " + color + " rg 1 0 0 1 " + x + " " + y + " Tm (" + pdfEscape(line.text) + ") Tj ET");
    if (line.machine) commands.push("BT /" + line.font + " " + line.size + " Tf " + color + " rg 1 0 0 1 307 " + y + " Tm (" + pdfEscape(line.machine) + ") Tj ET");
    if (line.material) commands.push("BT /" + line.font + " " + line.size + " Tf " + color + " rg 1 0 0 1 390 " + y + " Tm (" + pdfEscape(line.material) + ") Tj ET");
    if (line.right) commands.push("BT /" + (line.font === "F2" ? "F2" : "F1") + " " + line.size + " Tf " + color + " rg 1 0 0 1 " + line.rightX + " " + y + " Tm (" + pdfEscape(line.right) + ") Tj ET");
    if (line.type === "total") commands.push("0 G 0.7 w 74 " + (y + Number(line.size) + 5) + " m 525 " + (y + Number(line.size) + 5) + " l S");
    y -= Number(line.size) + 5;
  });
  commands.push("0.6 G 0.35 w 74 115 m 525 115 l S");
  commands.push("0.1 0.1 0.1 rg BT /F1 10 Tf 1 0 0 1 76 89 Tm (Kontakt) Tj ET");
  commands.push("0.1 0.1 0.1 rg BT /F1 10 Tf 1 0 0 1 252 89 Tm (Bankverbindung) Tj ET");
  commands.push("0.1 0.1 0.1 rg BT /F1 10 Tf 1 0 0 1 402 89 Tm (Steuer-Nr.: 53845/40010) Tj ET");
  commands.push("0.1 0.1 0.1 rg BT /F1 10 Tf 1 0 0 1 76 77 Tm (Rick Schuler) Tj ET");
  commands.push("0.1 0.1 0.1 rg BT /F1 10 Tf 1 0 0 1 252 77 Tm (Sparkasse Zollernalb) Tj ET");
  commands.push("0.1 0.1 0.1 rg BT /F1 10 Tf 1 0 0 1 402 77 Tm (USt.IdNr.: DE461645921) Tj ET");
  commands.push("0.1 0.1 0.1 rg BT /F1 10 Tf 1 0 0 1 76 65 Tm (Tel.: +49 162 5319003) Tj ET");
  commands.push("0.1 0.1 0.1 rg BT /F1 10 Tf 1 0 0 1 252 65 Tm (IBAN: DE38653512600134081593) Tj ET");
  commands.push("0.1 0.1 0.1 rg BT /F1 10 Tf 1 0 0 1 76 53 Tm (E-Mail: info-luks@web.de) Tj ET");
  commands.push("0.1 0.1 0.1 rg BT /F1 10 Tf 1 0 0 1 252 53 Tm (BIC: SOLADES1BAL) Tj ET");
  commands.push("0.45 0.45 0.45 rg BT /F1 8 Tf 1 0 0 1 508 29 Tm (Seite " + pageNumber + " von " + pageCount + ") Tj ET");
  return commands.join("\n");
}

function pdfBytes(value) {
  return Uint8Array.from(String(value), (character) => character.charCodeAt(0) & 255);
}

function createPdfDocument(pageContents, logoImage = null) {
  const objects = [];
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = "";
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
  objects[4] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>";
  const pageObjects = pageContents.map((content, index) => 5 + index * 2);
  const logoObject = logoImage ? 5 + pageContents.length * 2 : 0;
  objects[2] = "<< /Type /Pages /Kids [" + pageObjects.map((objectNumber) => objectNumber + " 0 R").join(" ") + "] /Count " + pageContents.length + " >>";
  pageContents.forEach((content, index) => {
    const pageObject = pageObjects[index];
    const contentObject = pageObject + 1;
    const logoResource = logoObject ? " /XObject << /Logo " + logoObject + " 0 R >>" : "";
    objects[pageObject] = "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R /F2 4 0 R >>" + logoResource + " >> /Contents " + contentObject + " 0 R >>";
    objects[contentObject] = "<< /Length " + pdfBytes(content).length + " >>\nstream\n" + content + "\nendstream";
  });
  if (logoImage) {
    objects[logoObject] = {
      header: "<< /Type /XObject /Subtype /Image /Width " + logoImage.width + " /Height " + logoImage.height + " /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length " + pdfBytes(logoImage.binary).length + " >>\nstream\n",
      binary: logoImage.binary,
      trailer: "\nendstream"
    };
  }
  const chunks = [];
  const offsets = [0];
  let length = 0;
  const append = (value) => {
    const bytes = pdfBytes(value);
    chunks.push(bytes);
    length += bytes.length;
  };
  append("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");
  for (let index = 1; index < objects.length; index += 1) {
    offsets[index] = length;
    append(index + " 0 obj\n");
    if (typeof objects[index] === "string") {
      append(objects[index]);
    } else {
      append(objects[index].header);
      append(objects[index].binary);
      append(objects[index].trailer);
    }
    append("\nendobj\n");
  }
  const xrefOffset = length;
  append("xref\n0 " + objects.length + "\n0000000000 65535 f \n");
  for (let index = 1; index < objects.length; index += 1) append(String(offsets[index]).padStart(10, "0") + " 00000 n \n");
  append("trailer\n<< /Size " + objects.length + " /Root 1 0 R >>\nstartxref\n" + xrefOffset + "\n%%EOF");
  const bytes = new Uint8Array(length);
  let offset = 0;
  chunks.forEach((chunk) => { bytes.set(chunk, offset); offset += chunk.length; });
  return bytes;
}

function paginatePdfLines(lines) {
  const pages = [];
  let page = [];
  let remaining = 665 - 118;
  lines.forEach((line) => {
    const height = Number(line.gap || 0) + Number(line.size || 10) + 5;
    if (page.length && height > remaining) {
      pages.push(page);
      page = [];
      remaining = 720 - 118;
    }
    page.push(line);
    remaining -= height;
  });
  if (page.length) pages.push(page);
  return pages;
}

async function protocolPdfFile(protocol) {
  const lines = protocolPdfLines(protocol);
  const pages = paginatePdfLines(lines);
  const logoImage = await pdfLogoImage();
  const pageContents = pages.map((page, index) => pdfPageContent(page, index + 1, pages.length, Boolean(logoImage)));
  return new File([createPdfDocument(pageContents, logoImage)], protocolPdfFilename(protocol), { type: "application/pdf" });
}

async function downloadProtocolPdf(protocol) {
  const file = await protocolPdfFile(protocol);
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = file.name;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function invoiceTransferPayload(protocol) {
  const masterCustomer = customers.find((customer) => customer.name === protocol.customer);
  return {
    format: "LUKS-Arbeitsprotokoll-Rechnungsuebergabe",
    version: 1,
    exportedAt: new Date().toISOString(),
    source: { protocolId: protocol.id, status: protocol.status },
    customer: masterCustomer ? {
      name: masterCustomer.name, contact: masterCustomer.contact, street: masterCustomer.street,
      postalCode: masterCustomer.postalCode, city: masterCustomer.city, email: masterCustomer.email, phone: masterCustomer.phone
    } : { name: protocol.customer || "" },
    invoice: {
      title: protocol.project || "Arbeitsleistung",
      serviceFrom: protocol.dateFrom || protocol.date,
      serviceTo: protocol.dateTo || protocol.date,
      location: protocol.location || "",
      hours: Number(protocol.hours || 0),
      team: protocol.team || "",
      positions: protocol.positions.map((position) => ({
        description: position.description,
        hours: Number(position.hours || 0),
        machine: position.machine || "",
        material: position.material || ""
      })),
      notes: protocol.notes || "",
      photoCount: Array.isArray(protocol.photos) ? protocol.photos.length : 0
    }
  };
}

function transferFile(protocol) {
  const payload = JSON.stringify(invoiceTransferPayload(protocol), null, 2);
  const safeName = `${protocol.date || today()}-${protocol.project || "arbeitsprotokoll"}`.replace(/[^a-z0-9äöüß]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();
  return new File([payload], `luks-rechnungsuebergabe-${safeName || "arbeitsprotokoll"}.json`, { type: "application/json" });
}

function markReleasedForInvoice(protocol) {
  protocol.invoiceReleasedAt = today();
  protocol.updated = today();
}

function downloadInvoiceTransfer(protocol) {
  const file = transferFile(protocol);
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = file.name;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function exportForInvoice(id) {
  const protocol = data.protocols.find((entry) => entry.id === id);
  if (!protocol) return;
  await downloadProtocolPdf(protocol);
  markReleasedForInvoice(protocol);
  closeDialog();
  saveData("Arbeitsprotokoll als PDF exportiert");
}

async function shareForInvoice(id) {
  const protocol = data.protocols.find((entry) => entry.id === id);
  if (!protocol) return;
  const file = await protocolPdfFile(protocol);
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ title: "LUKS Rechnungsübergabe", text: `Arbeitsprotokoll: ${protocol.project || "Arbeitsleistung"}`, files: [file] });
      markReleasedForInvoice(protocol);
      closeDialog();
      saveData("Arbeitsprotokoll als PDF geteilt");
    } else {
      await downloadProtocolPdf(protocol);
      markReleasedForInvoice(protocol);
      closeDialog();
      saveData("Teilen wird nicht unterstützt - PDF exportiert");
    }
  } catch (error) {
    if (error?.name !== "AbortError") showToast("PDF konnte nicht geteilt werden");
  }
}

function saveProtocol(id = "") {
  const form = $("#dialog-form");
  if (!form.reportValidity()) return;
  if (photosBeingProcessed) {
    showToast("Bitte warte, bis das Foto vorbereitet ist");
    return;
  }
  const values = new FormData(form);
  const dateFrom = values.get("date-from");
  const dateTo = values.get("date-to");
  if (dateTo < dateFrom) {
    showToast("Das Bis-Datum darf nicht vor dem Von-Datum liegen");
    return;
  }
  const positions = collectPositions();
  if (!positions) return;
  const sourceAppointmentId = String(values.get("source-appointment") || "");
  const existing = id ? data.protocols.find((entry) => entry.id === id) : null;
  const existingData = existing ? { ...existing } : {};
  delete existingData.invoiceReleasedAt;
  const protocol = normaliseProtocols([{
    ...existingData,
    id: existing ? existing.id : "ap-" + crypto.randomUUID(),
    project: values.get("project").trim(), customer: values.get("customer").trim(), location: values.get("location").trim(),
    dateFrom, dateTo, team: values.get("team").trim(), positions, notes: values.get("notes").trim(), photos: pendingPhotos,
    status: "draft", updated: today()
  }])[0];
  if (existing) {
    data.protocols = data.protocols.map((entry) => entry.id === existing.id ? protocol : entry);
  } else {
    data.protocols.unshift(protocol);
  }
  const sourceAppointment = !existing && sourceAppointmentId ? (data.appointments || []).find((appointment) => appointment.id === sourceAppointmentId) : null;
  if (sourceAppointment) {
    sourceAppointment.protocolId = protocol.id;
    sourceAppointment.updated = today();
  }
  if (timerSeconds()) data.timer = { startedAt: null, pendingSeconds: 0 };
  closeDialog();
  saveData(existing ? "Arbeitsprotokoll aktualisiert" : sourceAppointment ? "Arbeitsprotokoll zum Termin gespeichert" : "Arbeitsprotokoll als Entwurf gespeichert");
  setView(sourceAppointment ? "calendar" : "protocols");
}

function toggleTimer() {
  if (data.timer.startedAt) {
    data.timer.pendingSeconds = timerSeconds();
    data.timer.startedAt = null;
    saveData("Arbeitszeit gestoppt");
  } else {
    data.timer.startedAt = Date.now();
    saveData("Arbeitszeit gestartet");
  }
}

function resetTimer() {
  if (!timerSeconds()) {
    showToast("Es ist keine Arbeitszeit zum Zurücksetzen vorhanden");
    return;
  }
  if (!confirm("Die erfasste Arbeitszeit wirklich zurücksetzen?")) return;
  data.timer = { startedAt: null, pendingSeconds: 0 };
  saveData("Arbeitszeit zurückgesetzt");
}

async function openInstallGuide() {
  const standalone = window.matchMedia?.("(display-mode: standalone)")?.matches || navigator.standalone === true;
  if (standalone) {
    showToast("LUKS Mobil ist bereits installiert");
    return;
  }
  if (deferredInstallPrompt) {
    deferredInstallPrompt.prompt();
    const choice = await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    showToast(choice.outcome === "accepted" ? "Installation gestartet" : "Installation abgebrochen");
    return;
  }
  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const instruction = isIos
    ? "Öffne diese Seite in Safari. Tippe auf Teilen und danach auf <strong>Zum Home-Bildschirm</strong>. Danach startet LUKS Mobil wie eine normale App."
    : "Öffne diese Seite in Chrome oder Edge. Tippe im Browsermenü auf <strong>App installieren</strong> oder <strong>Zum Startbildschirm hinzufügen</strong>.";
  showDialog({
    eyebrow: "Handy-Installation",
    title: "LUKS Mobil installieren",
    content: '<div class="dialog-body"><p class="local-note">' + instruction + '</p><p class="local-note">Die App muss dafür über eine sichere Internetadresse (https) geöffnet werden, nicht direkt als Datei.</p><div class="dialog-actions"><button class="button button--primary" type="button" data-action="close-dialog">Verstanden</button></div></div>'
  });
}

async function exportBackup() {
  const backup = JSON.stringify({ version: 4, createdAt: new Date().toISOString(), data, customers: await CustomerDb.list(), activities: await ActivityDb.list() }, null, 2);
  const url = URL.createObjectURL(new Blob([backup], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `luks-arbeitsprotokolle-${today()}.json`;
  link.click();
  URL.revokeObjectURL(url);
  showToast("Sicherung wurde heruntergeladen");
}

function importBackup(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const backup = JSON.parse(reader.result);
      const imported = backup.data || backup;
      if (!Array.isArray(imported.protocols)) throw new Error("invalid");
      data = { protocols: normaliseProtocols(imported.protocols), timer: imported.timer || { startedAt: null, pendingSeconds: 0 }, appointments: normaliseAppointments(imported.appointments) };
      if (Array.isArray(backup.customers)) {
        await CustomerDb.replaceAll(backup.customers);
        await loadCustomers();
      }
      if (Array.isArray(backup.activities)) {
        await ActivityDb.replaceAll(backup.activities);
        await loadActivities();
      }
      saveData("Sicherung eingespielt");
    } catch (_) { showToast("Diese Datei ist keine gültige LUKS-Sicherung"); }
  };
  reader.readAsText(file);
}

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("is-visible");
  clearTimeout(showToast.timeout);
  showToast.timeout = setTimeout(() => toast.classList.remove("is-visible"), 2600);
}

document.addEventListener("click", (event) => {
  const nav = event.target.closest("[data-nav]");
  if (nav) return setView(nav.dataset.nav);
  const filter = event.target.closest("[data-filter]");
  if (filter) {
    protocolFilter = filter.dataset.filter;
    $$("[data-filter]").forEach((button) => { const active = button === filter; button.classList.toggle("is-active", active); button.setAttribute("aria-pressed", String(active)); });
    return renderProtocols();
  }
  const action = event.target.closest("[data-action]");
  if (action) {
    const handlers = {
      "new-protocol": openNewProtocol, "new-appointment-from-calendar": () => openNewAppointment(calendarSelected), "open-timer": () => setView("timer"), "open-protocols": () => setView("protocols"), "open-customers": () => setView("customers"), "open-calendar": () => setView("calendar"), "calendar-previous": () => moveCalendarMonth(-1), "calendar-next": () => moveCalendarMonth(1), "calendar-day": () => selectCalendarDay(action.dataset.date), "protocol-detail": () => openProtocolDetail(action.dataset.id), "appointment-detail": () => openAppointmentDetail(action.dataset.id), "new-customer": openNewCustomer, "customer-detail": () => openCustomerEditor(action.dataset.id), "open-activities": () => setView("activities"), "new-activity": openNewActivity, "activity-detail": () => openActivityEditor(action.dataset.id), "add-position": addPosition, "remove-position": () => removePosition(action.closest("[data-position]")), "close-dialog": closeDialog, "remove-pending-photo": () => removePendingPhoto(action.dataset.index),
      "toggle-timer": toggleTimer, "reset-timer": resetTimer, "install-app": openInstallGuide, "backup": exportBackup,
      "about": () => showDialog({ title: "Über LUKS Mobil", content: `<div class="dialog-body"><p class="local-note">LUKS Mobil ist die Baustellen-App für Arbeitsprotokolle und mobile Zeiterfassung.</p><div class="dialog-actions"><button class="button button--primary" type="submit" value="close">Schließen</button></div></div>` })
    };
    return handlers[action.dataset.action]?.();
  }
  const dialogAction = event.target.closest("[data-dialog-action]");
  if (!dialogAction) return;
  const id = dialogAction.dataset.id;
  if (dialogAction.dataset.dialogAction === "save-protocol") return saveProtocol(id);
  if (dialogAction.dataset.dialogAction === "save-appointment") return saveAppointment();
  if (dialogAction.dataset.dialogAction === "create-protocol-from-appointment") {
    const appointment = (data.appointments || []).find((entry) => entry.id === id);
    if (appointment) {
      closeDialog();
      return openNewProtocol(appointment.date, appointment);
    }
  }
  if (dialogAction.dataset.dialogAction === "open-linked-protocol") {
    closeDialog();
    return openProtocolDetail(id);
  }
  if (dialogAction.dataset.dialogAction === "delete-appointment") return deleteAppointment(id);
  if (dialogAction.dataset.dialogAction === "save-customer") return saveCustomer(id);
  if (dialogAction.dataset.dialogAction === "delete-customer") return deleteCustomer(id);
  if (dialogAction.dataset.dialogAction === "save-activity") return saveActivity(id);
  if (dialogAction.dataset.dialogAction === "delete-activity") return deleteActivity(id);
  if (dialogAction.dataset.dialogAction === "edit-protocol") return openProtocolEditor(id);
  if (dialogAction.dataset.dialogAction === "export-for-invoice") return exportForInvoice(id);
  if (dialogAction.dataset.dialogAction === "share-for-invoice") return shareForInvoice(id);
  if (dialogAction.dataset.dialogAction === "complete-protocol") {
    const protocol = data.protocols.find((row) => row.id === id);
    if (protocol) { protocol.status = "complete"; protocol.updated = today(); }
    closeDialog();
    return saveData("Arbeitsprotokoll abgeschlossen");
  }
  if (dialogAction.dataset.dialogAction === "delete-protocol" && confirm("Dieses Arbeitsprotokoll wirklich löschen?")) {
    data.protocols = data.protocols.filter((row) => row.id !== id);
    closeDialog();
    return saveData("Arbeitsprotokoll gelöscht");
  }
});

$("#notification-button").addEventListener("click", () => setView("protocols"));
$("#profile-button").addEventListener("click", () => setView("more"));
$("#protocol-search").addEventListener("input", renderProtocols);
$("#customer-search").addEventListener("input", renderCustomers);
$("#activity-search").addEventListener("input", renderActivities);
$("#import-input").addEventListener("change", (event) => importBackup(event.target.files[0]));
$("#app-dialog").addEventListener("click", (event) => {
  if (event.target === event.currentTarget) closeDialog();
});
if ("serviceWorker" in navigator) window.addEventListener("load", () => navigator.serviceWorker.register("service-worker.js").catch(() => {}));
window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
});
window.addEventListener("appinstalled", () => {
  deferredInstallPrompt = null;
  showToast("LUKS Mobil wurde installiert");
});

render();
loadCustomers();
loadActivities();
