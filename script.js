document.querySelectorAll('[data-lang]').forEach(button => {
  button.addEventListener('click', () => {
    const language = button.dataset.lang;
    document.documentElement.lang = language;
    document.title = language === 'sr' ? 'Srpska dijaspora u UAE' : 'Serbian Diaspora in the UAE';
    document.querySelectorAll('[data-en][data-sr]').forEach(element => {
      element.innerHTML = element.dataset[language];
    });
    document.querySelectorAll('[data-lang]').forEach(item => {
      const selected = item.dataset.lang === language;
      item.classList.toggle('selected', selected);
      item.setAttribute('aria-pressed', String(selected));
    });
    renderSurveyStatus();
    renderResults();
    newsletterRenderers.forEach(render => render());
  });
});

// Survey: answers go to the Cloudflare Worker in worker/ (see worker/README.txt).
const survey = document.querySelector('#voting-survey');
const surveyNewsletter = document.querySelector('.survey-newsletter');
const confirmation = document.querySelector('#confirmation-question');
const submitArea = document.querySelector('.survey-submit');
const submitButton = survey.querySelector('[type="submit"]');
const statusText = document.querySelector('#survey-status');
const resultsText = document.querySelector('#survey-results');
const { api, sitekey } = survey.dataset;
const submittedKey = 'srbsuae-voting-survey-submitted-v1';
let surveyStatus = '';
let surveyResults = null;
let captchaToken = '';
let captchaWidget = null;
let sending = false;
let captchaFailed = false;
let captchaTimer = null;
const messages = {
  saved: {
    sr: 'Hvala, vaš odgovor je primljen.',
    en: 'Thank you, your response has been received.'
  },
  failed: {
    sr: 'Odgovor nije poslat. Pokušajte ponovo za nekoliko minuta.',
    en: 'Your response was not sent. Please try again in a few minutes.'
  },
  rate_limited: {
    sr: 'Previše pokušaja. Pokušajte ponovo za nekoliko minuta.',
    en: 'Too many attempts. Please try again in a few minutes.'
  },
  too_soon: {
    sr: 'Sa ove mreže je odgovor poslat pre manje od 5 minuta. Pokušajte kasnije.',
    en: 'A response was sent from this network less than 5 minutes ago. Please try again later.'
  },
  already_voted: {
    sr: 'Sa ove mreže je već primljen odgovor. Hvala.',
    en: 'A response from this network has already been received. Thank you.'
  },
  captcha: {
    sr: 'Provera nije uspela. Pokušajte ponovo.',
    en: 'Verification failed. Please try again.'
  },
  verifying: {
    sr: 'Provera u toku, sačekajte nekoliko sekundi…',
    en: 'Verifying, please wait a few seconds…'
  },
  captcha_unavailable: {
    sr: 'Provera nije uspela. Osvežite stranicu ili isključite blokator sadržaja i pokušajte ponovo.',
    en: 'Verification did not complete. Refresh the page or turn off content blockers and try again.'
  },
  busy: {
    sr: 'Anketa je trenutno preopterećena. Pokušajte kasnije.',
    en: 'The survey is currently busy. Please try again later.'
  }
};
function renderSurveyStatus() {
  surveyNewsletter.hidden = !['saved', 'already_voted'].includes(surveyStatus);
  statusText.hidden = !surveyStatus;
  statusText.classList.toggle('is-loading', surveyStatus === 'verifying');
  statusText.textContent = surveyStatus ? messages[surveyStatus][document.documentElement.lang] : '';
}
function renderResults() {
  const r = surveyResults;
  resultsText.hidden = !r?.visible;
  if (!r?.visible) return;
  resultsText.textContent = document.documentElement.lang === 'sr'
    ? `Do sada: ${r.total} odgovora. Prijavu je podnelo ${r.applied}, a potvrdu Ambasade je dobilo ${r.confirmed} od njih. Uzorak onih koji su odgovorili, nije reprezentativan.`
    : `So far: ${r.total} responses. ${r.applied} applied, and ${r.confirmed} of them received the Embassy confirmation. A sample of those who responded, not representative.`;
}
async function loadResults() {
  try {
    const response = await fetch(`${api}/results`);
    if (response.ok) { surveyResults = await response.json(); renderResults(); }
  } catch { /* Results are optional. */ }
}
async function checkAlreadyVoted() {
  try {
    const response = await fetch(`${api}/status`);
    if (response.ok && (await response.json()).voted) {
      surveyStatus = 'already_voted';
      lockForm();
      renderSurveyStatus();
    }
  } catch { /* The check is a convenience; /vote enforces the limit. */ }
}
function lockForm() {
  survey.querySelectorAll('input').forEach(input => { input.disabled = true; });
  submitArea.hidden = true;
}
function updateSurvey() {
  const applied = survey.querySelector('[name="applied"]:checked')?.value;
  const needsConfirmation = applied === 'yes';
  confirmation.hidden = !needsConfirmation;
  confirmation.disabled = !needsConfirmation;
  if (!needsConfirmation) {
    survey.querySelectorAll('[name="confirmed"]').forEach(input => { input.checked = false; });
  }
  const locked = survey.querySelector('input').disabled;
  submitArea.hidden = !applied || locked;
  if (applied && !locked) renderCaptcha();
  if (!surveyStatus || surveyStatus === 'verifying' || surveyStatus === 'captcha_unavailable') {
    const waiting = applied && !captchaToken && !sending;
    if (waiting && !captchaFailed && captchaTimer === null) {
      captchaTimer = setTimeout(() => { captchaFailed = true; updateSurvey(); }, 15000);
    }
    if (!waiting && captchaTimer !== null) { clearTimeout(captchaTimer); captchaTimer = null; }
    const wanted = waiting ? (captchaFailed ? 'captcha_unavailable' : 'verifying') : '';
    if (wanted !== surveyStatus) { surveyStatus = wanted; renderSurveyStatus(); }
  }
  submitButton.disabled = sending || !captchaToken || !applied ||
    (needsConfirmation && !survey.querySelector('[name="confirmed"]:checked'));
}
// Turnstile does not run in hidden containers, so the widget is created only
// once the submit area is visible (after the first answer).
let captchaRetried = false;
function renderCaptcha() {
  if (captchaWidget !== null || !window.turnstile || submitArea.hidden) return;
  captchaWidget = window.turnstile.render('#turnstile', {
    sitekey,
    callback: token => { captchaToken = token; captchaFailed = false; updateSurvey(); },
    'expired-callback': () => { captchaToken = ''; updateSurvey(); },
    'error-callback': () => {
      captchaToken = '';
      if (!captchaRetried) {
        captchaRetried = true;
        setTimeout(() => window.turnstile.reset(captchaWidget), 1500);
      } else {
        captchaFailed = true;
      }
      updateSurvey();
    },
    'unsupported-callback': () => { captchaToken = ''; captchaFailed = true; updateSurvey(); }
  });
}
function resetCaptcha() {
  captchaToken = '';
  if (captchaWidget !== null) window.turnstile.reset(captchaWidget);
}
survey.addEventListener('change', () => {
  surveyStatus = '';
  renderSurveyStatus();
  updateSurvey();
});
survey.addEventListener('submit', async event => {
  event.preventDefault();
  if (!survey.reportValidity() || submitButton.disabled) return;
  sending = true;
  updateSurvey();
  const payload = {
    applied: survey.querySelector('[name="applied"]:checked').value,
    confirmed: survey.querySelector('[name="confirmed"]:checked')?.value ?? null,
    token: captchaToken
  };
  try {
    const response = await fetch(`${api}/vote`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (response.ok) {
      surveyStatus = 'saved';
      try { localStorage.setItem(submittedKey, '1'); } catch { /* Marker is a convenience only. */ }
      lockForm();
      loadResults();
if (surveyStatus !== 'saved') checkAlreadyVoted();
    } else {
      const { error } = await response.json().catch(() => ({}));
      surveyStatus = messages[error] ? error : 'failed';
      if (error === 'already_voted') lockForm();
    }
  } catch {
    surveyStatus = 'failed';
  }
  sending = false;
  if (surveyStatus !== 'saved') resetCaptcha();
  renderSurveyStatus();
  updateSurvey();
});
try {
  if (localStorage.getItem(submittedKey)) {
    surveyStatus = 'saved';
    lockForm();
  }
} catch { /* The survey still works when storage is blocked. */ }
if (surveyStatus !== 'saved') {
  const waitForCaptcha = setInterval(() => {
    if (window.turnstile) { clearInterval(waitForCaptcha); updateSurvey(); }
  }, 200);
}
updateSurvey();
renderSurveyStatus();
loadResults();
if (surveyStatus !== 'saved') checkAlreadyVoted();

// Newsletter: the email goes to the Worker, which forwards it to MailerLite.
// Never linked to survey answers. One setup per form (page section and survey card).
const nlMessages = {
  verifying: { sr: 'Provera u toku, sačekajte nekoliko sekundi…', en: 'Verifying, please wait a few seconds…' },
  captcha_unavailable: {
    sr: 'Provera nije uspela. Osvežite stranicu ili isključite blokator sadržaja i pokušajte ponovo.',
    en: 'Verification did not complete. Refresh the page or turn off content blockers and try again.'
  },
  saved: {
    sr: 'Još samo jedan korak! Poslali smo mejl od „Srpska dijaspora u UAE“ (info@srbsuae.com) sa naslovom „Confirmation email“. Kliknite na zeleno dugme u mejlu da potvrdite prijavu. Bez potvrde newsletter vam neće stizati. Ako mejl ne vidite, proverite Spam i Promotions, a info@srbsuae.com dodajte u kontakte.',
    en: 'One more step! We sent an email from “Srpska dijaspora u UAE” (info@srbsuae.com) with the subject “Confirmation email”. Click the green button in the email to confirm. Without confirmation you will not receive the newsletter. If you do not see it, check Spam and Promotions, and add info@srbsuae.com to your contacts.'
  },
  bad_email: { sr: 'Proverite adresu mejla i pokušajte ponovo.', en: 'Check the email address and try again.' },
  rate_limited: { sr: 'Previše pokušaja. Pokušajte ponovo za nekoliko minuta.', en: 'Too many attempts. Please try again in a few minutes.' },
  captcha: { sr: 'Provera nije uspela. Pokušajte ponovo.', en: 'Verification failed. Please try again.' },
  failed: { sr: 'Prijava nije poslata. Pokušajte ponovo za nekoliko minuta.', en: 'Your signup was not sent. Please try again in a few minutes.' }
};
const newsletterRenderers = [];
function setupNewsletter(form) {
  const email = form.querySelector('input[type="email"]');
  const button = form.querySelector('[type="submit"]');
  const statusEl = form.querySelector('.newsletter-status');
  const captchaEl = form.querySelector('.newsletter-captcha');
  let status = '';
  let token = '';
  let widget = null;
  let failed = false;
  let sending = false;
  let started = false;
  let timer = null;
  function render() {
    statusEl.hidden = !status;
    statusEl.classList.toggle('is-loading', status === 'verifying');
    statusEl.textContent = status ? nlMessages[status][document.documentElement.lang] : '';
  }
  function update() {
    const typed = email.value.trim() !== '';
    if (['', 'verifying', 'captcha_unavailable'].includes(status)) {
      const waiting = typed && !token && !sending;
      if (waiting && !failed && timer === null) timer = setTimeout(() => { failed = true; update(); }, 15000);
      if (!waiting && timer !== null) { clearTimeout(timer); timer = null; }
      const wanted = waiting ? (failed ? 'captcha_unavailable' : 'verifying') : '';
      if (wanted !== status) { status = wanted; render(); }
    }
    button.disabled = sending || !token || !typed || status === 'saved';
  }
  // The widget is created on first focus, when the form is visible: Turnstile
  // does not run in hidden or off-screen containers.
  function startCheck() {
    if (!window.turnstile) return;
    if (widget === null) {
      started = true;
      widget = window.turnstile.render(captchaEl, {
        sitekey: form.dataset.sitekey,
        appearance: 'interaction-only',
        callback: value => { token = value; failed = false; update(); },
        'expired-callback': () => { token = ''; started = false; update(); },
        'error-callback': () => { token = ''; failed = true; started = false; update(); },
        'unsupported-callback': () => { token = ''; failed = true; started = false; update(); }
      });
    } else if (!started && !token) {
      started = true;
      failed = false;
      window.turnstile.reset(widget);
    }
  }
  form.addEventListener('focusin', startCheck);
  form.addEventListener('input', () => {
    startCheck();
    if (status === 'saved') return;
    if (!['verifying', 'captcha_unavailable'].includes(status)) { status = ''; render(); }
    update();
  });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!email.checkValidity() || button.disabled) { status = 'bad_email'; render(); return; }
    sending = true;
    status = '';
    update();
    try {
      const response = await fetch(`${form.dataset.api}/subscribe`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: email.value.trim(), lang: document.documentElement.lang, token })
      });
      if (response.ok) {
        status = 'saved';
        email.value = '';
      } else {
        const { error } = await response.json().catch(() => ({}));
        status = nlMessages[error] ? error : 'failed';
      }
    } catch {
      status = 'failed';
    }
    sending = false;
    token = '';
    started = false;
    if (widget !== null) window.turnstile.reset(widget);
    render();
    update();
  });
  newsletterRenderers.push(render);
  update();
}
document.querySelectorAll('[data-newsletter]').forEach(setupNewsletter);

// Letter to RIK: opens the visitor's own email app with the text filled in.
// Nothing is sent to or stored by this site.
const rikSubject = document.querySelector('#rik-subject');
const rikBody = document.querySelector('#rik-body');
const rikTo = 'ozabi@mfa.rs,okp@mfa.rs,consular.abudhabi@mfa.rs,srb.emb.uae@mfa.rs';
const rikCc = 'sekretarijat.mduls@mduls.gov.rs,rik@parlament.rs,izbori@parlament.rs';
const rikStatus = document.querySelector('#rik-status');
const rikCopied = { sr: 'Tekst je kopiran.', en: 'Text copied.' };
function rikLink() {
  const body = rikBody.value.replace(/\r?\n/g, '\r\n');
  document.querySelector('#rik-mailto').href =
    `mailto:${rikTo}?cc=${rikCc}&subject=${encodeURIComponent(rikSubject.value)}&body=${encodeURIComponent(body)}`;
}
rikSubject.addEventListener('input', rikLink);
rikBody.addEventListener('input', rikLink);
rikLink();
const rikCountEl = document.querySelector('#rik-count');
let rikCountTotal = null;
function renderRikCount() {
  rikCountEl.hidden = rikCountTotal === null;
  if (rikCountTotal === null) return;
  rikCountEl.textContent = document.documentElement.lang === 'sr'
    ? `Pismo je do sada iskoristilo ${rikCountTotal} ljudi.`
    : `${rikCountTotal} people have used this letter so far.`;
}
async function loadRikCount() {
  try {
    const response = await fetch(`${rikPoll.dataset.api}/letter-count`);
    const data = response.ok ? await response.json() : null;
    rikCountTotal = data?.visible ? data.total : null;
    renderRikCount();
  } catch { /* Counter is optional. */ }
}
// Anonymous: the server counts one use per network; failures are ignored.
function countRikUse(kind) {
  fetch(`${rikPoll.dataset.api}/letter`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ kind }),
    keepalive: true
  }).then(() => loadRikCount()).catch(() => {});
}
document.querySelector('#rik-mailto').addEventListener('click', () => countRikUse('mail'));
loadRikCount();
document.querySelector('#rik-copy').addEventListener('click', async () => {
  countRikUse('copy');
  const text = `${rikTo}\nCC: ${rikCc}\n${rikSubject.value}\n\n${rikBody.value}`;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    rikBody.select();
    document.execCommand('copy');
  }
  rikStatus.textContent = rikCopied[document.documentElement.lang];
  rikStatus.hidden = false;
});

// Second poll: did the visitor send the email to the commission? Answers go to
// the Worker (/zahtev), anonymous, no link to the survey or to the newsletter.
const rikPoll = document.querySelector('#rik-poll');
const rikPollSubmitArea = rikPoll.querySelector('.rik-poll-submit');
const rikPollButton = rikPoll.querySelector('[type="submit"]');
const rikPollStatusEl = rikPoll.querySelector('.rik-poll-status');
const rikPollResultsEl = rikPoll.querySelector('.rik-poll-results');
const rikPollKey = 'srbsuae-zahtev-poll-v1';
const rikPollMessages = {
  verifying: { sr: 'Provera u toku, sačekajte nekoliko sekundi…', en: 'Verifying, please wait a few seconds…' },
  captcha_unavailable: {
    sr: 'Provera nije uspela. Osvežite stranicu ili isključite blokator sadržaja i pokušajte ponovo.',
    en: 'Verification did not complete. Refresh the page or turn off content blockers and try again.'
  },
  saved: { sr: 'Hvala, vaš odgovor je primljen.', en: 'Thank you, your response has been received.' },
  already_voted: { sr: 'Sa ove mreže je već primljen odgovor. Hvala.', en: 'A response from this network has already been received. Thank you.' },
  rate_limited: { sr: 'Previše pokušaja. Pokušajte ponovo za nekoliko minuta.', en: 'Too many attempts. Please try again in a few minutes.' },
  captcha: { sr: 'Provera nije uspela. Pokušajte ponovo.', en: 'Verification failed. Please try again.' },
  busy: { sr: 'Anketa je trenutno preopterećena. Pokušajte kasnije.', en: 'The survey is currently busy. Please try again later.' },
  failed: { sr: 'Odgovor nije poslat. Pokušajte ponovo za nekoliko minuta.', en: 'Your response was not sent. Please try again in a few minutes.' }
};
let rikPollStatus = '';
let rikPollResults = null;
let rikPollToken = '';
let rikPollWidget = null;
let rikPollFailed = false;
let rikPollSending = false;
let rikPollTimer = null;
function renderRikPollStatus() {
  rikPollStatusEl.hidden = !rikPollStatus;
  rikPollStatusEl.classList.toggle('is-loading', rikPollStatus === 'verifying');
  rikPollStatusEl.textContent = rikPollStatus ? rikPollMessages[rikPollStatus][document.documentElement.lang] : '';
}
function renderRikPollResults() {
  const r = rikPollResults;
  rikPollResultsEl.hidden = !r?.visible;
  if (!r?.visible) return;
  rikPollResultsEl.textContent = document.documentElement.lang === 'sr'
    ? `Do sada: ${r.total} odgovora. Zahtev je poslalo ${r.sent}. Uzorak onih koji su odgovorili, nije reprezentativan.`
    : `So far: ${r.total} responses. ${r.sent} sent the request. A sample of those who responded, not representative.`;
}
async function loadRikPollResults() {
  try {
    const response = await fetch(`${rikPoll.dataset.api}/zahtev-results`);
    if (response.ok) { rikPollResults = await response.json(); renderRikPollResults(); }
  } catch { /* Results are optional. */ }
}
function lockRikPoll() {
  rikPoll.querySelectorAll('input').forEach(input => { input.disabled = true; });
  rikPollSubmitArea.hidden = true;
}
// The widget is created on the first answer, when its container is visible.
function renderRikPollCaptcha() {
  if (rikPollWidget !== null || !window.turnstile || rikPollSubmitArea.hidden) return;
  rikPollWidget = window.turnstile.render(rikPoll.querySelector('.rik-poll-captcha'), {
    sitekey: rikPoll.dataset.sitekey,
    appearance: 'interaction-only',
    callback: value => { rikPollToken = value; rikPollFailed = false; updateRikPoll(); },
    'expired-callback': () => { rikPollToken = ''; updateRikPoll(); },
    'error-callback': () => { rikPollToken = ''; rikPollFailed = true; updateRikPoll(); },
    'unsupported-callback': () => { rikPollToken = ''; rikPollFailed = true; updateRikPoll(); }
  });
}
function updateRikPoll() {
  const answer = rikPoll.querySelector('[name="sent"]:checked');
  const locked = rikPoll.querySelector('input').disabled;
  rikPollSubmitArea.hidden = !answer || locked;
  if (locked) return;
  if (answer) renderRikPollCaptcha();
  if (['', 'verifying', 'captcha_unavailable'].includes(rikPollStatus)) {
    const waiting = answer && !rikPollToken && !rikPollSending;
    if (waiting && !rikPollFailed && rikPollTimer === null) rikPollTimer = setTimeout(() => { rikPollFailed = true; updateRikPoll(); }, 15000);
    if (!waiting && rikPollTimer !== null) { clearTimeout(rikPollTimer); rikPollTimer = null; }
    const wanted = waiting ? (rikPollFailed ? 'captcha_unavailable' : 'verifying') : '';
    if (wanted !== rikPollStatus) { rikPollStatus = wanted; renderRikPollStatus(); }
  }
  rikPollButton.disabled = rikPollSending || !rikPollToken || !answer;
}
rikPoll.addEventListener('change', () => {
  if (['', 'verifying', 'captcha_unavailable'].includes(rikPollStatus)) rikPollStatus = '';
  renderRikPollStatus();
  updateRikPoll();
});
rikPoll.addEventListener('submit', async event => {
  event.preventDefault();
  if (rikPollButton.disabled) return;
  rikPollSending = true;
  rikPollStatus = '';
  updateRikPoll();
  try {
    const response = await fetch(`${rikPoll.dataset.api}/zahtev`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sent: rikPoll.querySelector('[name="sent"]:checked').value, token: rikPollToken })
    });
    if (response.ok) {
      rikPollStatus = 'saved';
      try { localStorage.setItem(rikPollKey, '1'); } catch { /* Marker is a convenience only. */ }
      lockRikPoll();
      loadRikPollResults();
    } else {
      const { error } = await response.json().catch(() => ({}));
      rikPollStatus = rikPollMessages[error] ? error : 'failed';
      if (error === 'already_voted') lockRikPoll();
    }
  } catch {
    rikPollStatus = 'failed';
  }
  rikPollSending = false;
  rikPollToken = '';
  if (rikPollStatus !== 'saved' && rikPollWidget !== null) window.turnstile.reset(rikPollWidget);
  renderRikPollStatus();
  updateRikPoll();
});
try {
  if (localStorage.getItem(rikPollKey)) { rikPollStatus = 'saved'; lockRikPoll(); }
} catch { /* The poll still works when storage is blocked. */ }
const waitForRikPollCaptcha = setInterval(() => {
  if (window.turnstile) { clearInterval(waitForRikPollCaptcha); updateRikPoll(); }
}, 200);
newsletterRenderers.push(renderRikPollStatus, renderRikPollResults);
renderRikPollStatus();
loadRikPollResults();
updateRikPoll();
