import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import readline from 'node:readline/promises';
import process from 'node:process';
import { chromium } from 'playwright-core';
import { loadCvData } from './read-cv-data.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const profileDir = path.join(root, '.europass-browser-profile');
const debugDir = path.join(root, '.europass-debug');
const lang = (process.env.EUROPASS_LANG || 'en').toLowerCase() === 'it' ? 'it' : 'en';
const editorUrl = `https://europa.eu/europass/eportfolio/screen/cv-editor?lang=${lang}`;
const data = loadCvData(root);
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

const T = {
  en: {
    continue: ['Continue', 'Next'],
    save: ['Save', 'Add', 'Done'],
    about: ['About me', 'About myself', 'Personal statement'],
    workSection: ['Work experience'],
    addWork: ['Add new Work experience', 'Add work experience', 'Add new work experience'],
    educationSection: ['Education and training', 'Education'],
    addEducation: ['Add education and training', 'Add education'],
    languageSection: ['Language skills', 'Languages'],
    addLanguage: ['Add language', 'Add a language'],
    projectSection: ['Projects'],
    addProject: ['Add project', 'Add a project'],
    digitalSection: ['Digital skills', 'Skills'],
  },
  it: {
    continue: ['Continua', 'Avanti'],
    save: ['Salva', 'Aggiungi', 'Fatto'],
    about: ['Qualcosa su di me', 'Su di me', 'Presentazione personale'],
    workSection: ['Esperienza lavorativa', 'Esperienze lavorative'],
    addWork: ['Aggiungi esperienza lavorativa', 'Aggiungi una esperienza lavorativa'],
    educationSection: ['Istruzione e formazione', 'Formazione'],
    addEducation: ['Aggiungi istruzione e formazione', 'Aggiungi formazione'],
    languageSection: ['Competenze linguistiche', 'Lingue'],
    addLanguage: ['Aggiungi lingua', 'Aggiungi una lingua'],
    projectSection: ['Progetti'],
    addProject: ['Aggiungi progetto', 'Aggiungi un progetto'],
    digitalSection: ['Competenze digitali', 'Competenze'],
  },
}[lang];

function normalize(text) {
  return String(text ?? '').replace(/\s+/g, ' ').trim();
}

async function pressEnter(message) {
  await rl.question(`\n${message}\nPress Enter when ready... `);
}

async function visible(locator) {
  try {
    return await locator.first().isVisible({ timeout: 800 });
  } catch {
    return false;
  }
}

async function clickText(page, candidates) {
  for (const candidate of candidates) {
    for (const role of ['button', 'link']) {
      const locator = page.getByRole(role, { name: candidate, exact: false });
      if (await visible(locator)) {
        await locator.first().click();
        return true;
      }
    }
    const text = page.getByText(candidate, { exact: false });
    if (await visible(text)) {
      await text.first().click();
      return true;
    }
  }
  return false;
}

async function currentScope(page) {
  const dialogs = page.getByRole('dialog');
  const count = await dialogs.count();
  for (let i = count - 1; i >= 0; i -= 1) {
    if (await visible(dialogs.nth(i))) return dialogs.nth(i);
  }
  return page;
}

async function isTextEntry(locator) {
  try {
    const tag = await locator.evaluate((el) => el.tagName.toLowerCase());
    const type = ((await locator.getAttribute('type')) || '').toLowerCase();
    const contentEditable = await locator.getAttribute('contenteditable');

    if (tag === 'textarea' || contentEditable === 'true') return true;
    if (tag !== 'input') return false;

    return !['checkbox', 'radio', 'file', 'button', 'submit', 'reset', 'hidden'].includes(type);
  } catch {
    return false;
  }
}

async function firstVisibleCandidate(locator, predicate = null) {
  const count = Math.min(await locator.count(), 20);
  for (let i = 0; i < count; i += 1) {
    const candidate = locator.nth(i);
    if (!(await visible(candidate))) continue;
    if (!predicate || await predicate(candidate)) return candidate;
  }
  return null;
}

async function fieldByLabel(scope, labels, { textEntryOnly = false } = {}) {
  const predicate = textEntryOnly ? isTextEntry : null;

  // Prefer exact accessible labels. Partial matching can accidentally resolve
  // "Phone" to the phone-prefix combobox instead of the actual number input.
  for (const label of labels) {
    const candidate = await firstVisibleCandidate(
      scope.getByLabel(label, { exact: true }),
      predicate,
    );
    if (candidate) return candidate;
  }

  for (const label of labels.filter((value) => normalize(value).length >= 5)) {
    const candidate = await firstVisibleCandidate(
      scope.getByLabel(label, { exact: false }),
      predicate,
    );
    if (candidate) return candidate;
  }

  for (const label of labels.filter((value) => normalize(value).length >= 3)) {
    const labelNodes = scope.locator('label').filter({ hasText: label });
    const labelCount = Math.min(await labelNodes.count(), 20);
    for (let i = 0; i < labelCount; i += 1) {
      const labelNode = labelNodes.nth(i);
      if (!(await visible(labelNode))) continue;

      const forId = await labelNode.getAttribute('for');
      if (forId) {
        const escapedId = forId.replaceAll('"', '\\"');
        const candidate = await firstVisibleCandidate(
          scope.locator(`[id="${escapedId}"]`),
          predicate,
        );
        if (candidate) return candidate;
      }

      const nearby = labelNode.locator(
        'xpath=following::*[self::input or self::textarea or @contenteditable="true"][1]',
      );
      const candidate = await firstVisibleCandidate(nearby, predicate);
      if (candidate) return candidate;
    }
  }

  // Europass sometimes renders a group heading as plain text rather than a
  // <label>. In that case the first text-entry control after the heading is
  // still a much safer fallback than a partially matching combobox.
  if (textEntryOnly) {
    for (const label of labels) {
      const textNodes = scope.getByText(label, { exact: true });
      const count = Math.min(await textNodes.count(), 20);
      for (let i = 0; i < count; i += 1) {
        const textNode = textNodes.nth(i);
        if (!(await visible(textNode))) continue;
        const nearby = textNode.locator(
          'xpath=following::*[self::input or self::textarea or @contenteditable="true"][1]',
        );
        const candidate = await firstVisibleCandidate(nearby, isTextEntry);
        if (candidate) return candidate;
      }
    }
  }

  return null;
}

async function fillAny(scope, labels, value, { optional = false } = {}) {
  if (value === undefined || value === null || normalize(value) === '') return false;
  const field = await fieldByLabel(scope, labels, { textEntryOnly: true });
  if (!field) {
    if (!optional) console.log(`  ! Field not found: ${labels[0]}`);
    return false;
  }

  const tag = await field.evaluate((el) => el.tagName.toLowerCase());
  const type = (await field.getAttribute('type')) || '';
  if (tag === 'select') {
    await field.selectOption({ label: String(value) }).catch(async () => {
      await field.selectOption(String(value));
    });
  } else if (type === 'checkbox') {
    if (value) await field.check(); else await field.uncheck();
  } else if ((await field.getAttribute('contenteditable')) === 'true') {
    await field.click();
    await field.fill(String(value));
  } else {
    await field.fill(String(value));
  }
  return true;
}

async function selectNativeCode(scope, selector, code, fallbackLabels = []) {
  const field = scope.locator(selector).first();
  if (!(await visible(field))) return false;

  const options = await field.locator('option').evaluateAll((items) =>
    items.map((option) => ({
      value: option.value,
      label: (option.textContent || '').trim(),
    })),
  );

  const normalizedCode = String(code).toLowerCase();
  const match = options.find((option) =>
    option.value.toLowerCase().includes(normalizedCode),
  ) || options.find((option) =>
    fallbackLabels.some((label) => option.label.toLowerCase() === label.toLowerCase()),
  );

  if (!match) return false;
  await field.selectOption(match.value);
  return true;
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^$()|[\]\\]/g, '\\$&');
}

async function selectPrimeNgText(page, control, values) {
  if (!(await visible(control))) return false;

  const candidates = Array.isArray(values) ? values : [values];
  await control.click();

  const filter = await firstVisibleCandidate(
    page.locator(
      '.p-select-overlay input, .p-dropdown-panel input, input.p-select-filter, input[role="searchbox"]',
    ),
  );

  for (const value of candidates) {
    if (filter) {
      await filter.fill(String(value));
      await page.waitForTimeout(150);
    }

    const exactOption = page.getByRole('option', {
      name: new RegExp(`^\\s*${escapeRegex(value)}\\s*$`, 'i'),
    });
    const option = await firstVisibleCandidate(exactOption);
    if (option) {
      await option.click();
      return true;
    }

    const fallback = await firstVisibleCandidate(
      page.locator('li[role="option"], .p-select-option, .p-dropdown-item')
        .filter({ hasText: String(value) }),
    );
    if (fallback) {
      await fallback.click();
      return true;
    }
  }

  await page.keyboard.press('Escape').catch(() => {});
  return false;
}

async function fillPhoneNumber(page, scope, value) {
  if (!value) return false;

  const match = String(value).trim().match(/^(\+\d{1,3})\s*(.*)$/);
  const prefix = match?.[1] || '';
  const localNumber = (match?.[2] || String(value)).replace(/\D/g, '');

  await selectNativeCode(
    scope,
    '#perso-info-phone-type-input-0',
    'mobile',
    ['Mobile', 'Cellulare'],
  );

  if (prefix) {
    const prefixControl = scope.locator(
      '#perso-info-phone-form-0-prefix [role="combobox"], [role="combobox"][aria-label*="phone prefix" i]',
    ).first();

    if (await visible(prefixControl)) {
      const selected = await selectPrimeNgText(page, prefixControl, prefix);
      if (!selected) {
        console.log(`  ! Could not select phone prefix ${prefix}.`);
      }
    }
  }

  const numberField = scope.locator('#perso-info-phone-form-0').first();
  if (await visible(numberField)) {
    await numberField.fill(localNumber);
    return true;
  }

  return fillAny(
    scope,
    ['Phone number', 'Telefono'],
    localNumber,
    { optional: true },
  );
}

async function fillAddress(page, scope) {
  const location = data.contact.location;
  if (!location?.city && !location?.country) return;

  await selectNativeCode(
    scope,
    '#perso-info-address-type-0',
    'home',
    ['Home', 'Casa'],
  );

  const cityField = scope.locator('#perso-info-city-0').first();
  if (location.city && await visible(cityField)) {
    await cityField.fill(location.city);
  }

  const countryControl = scope.locator('#perso-info-country-0').first();
  if (location.country && await visible(countryControl)) {
    const countryNames = location.country.toLowerCase() === 'italy'
      ? ['Italy', 'Italia']
      : [location.country];

    const selected = await selectPrimeNgText(page, countryControl, countryNames);
    if (!selected) {
      console.log(`  ! Could not select address country: ${location.country}`);
    }
  }
}

async function selectOrFill(scope, labels, value, { optional = false } = {}) {
  if (!value) return false;
  const field = await fieldByLabel(scope, labels);
  if (!field) {
    if (!optional) console.log(`  ! Field not found: ${labels[0]}`);
    return false;
  }

  const tag = await field.evaluate((el) => el.tagName.toLowerCase());
  const role = await field.getAttribute('role');
  if (tag === 'select') {
    try {
      await field.selectOption({ label: String(value) });
      return true;
    } catch {
      // fall through to keyboard-driven combobox behaviour
    }
  }

  await field.click();
  if (tag === 'input' || role === 'combobox') {
    await field.fill(String(value)).catch(() => {});
    await field.press('ArrowDown').catch(() => {});
    await field.press('Enter').catch(() => {});
    return true;
  }

  return false;
}

function dateValueForType(isoMonth, type) {
  if (!isoMonth) return '';
  if (type === 'date') return `${isoMonth}-01`;
  if (type === 'month') return isoMonth;
  const [year, month] = isoMonth.split('-');
  return `${month}/${year}`;
}

async function fillDate(scope, labels, isoMonth, { optional = false } = {}) {
  if (!isoMonth) return false;
  const field = await fieldByLabel(scope, labels, { textEntryOnly: true });
  if (!field) {
    if (!optional) console.log(`  ! Date field not found: ${labels[0]}`);
    return false;
  }
  const type = (await field.getAttribute('type')) || '';
  await field.fill(dateValueForType(isoMonth, type));
  return true;
}

async function checkAny(scope, labels, { optional = true } = {}) {
  const field = await fieldByLabel(scope, labels);
  if (!field) {
    if (!optional) console.log(`  ! Checkbox not found: ${labels[0]}`);
    return false;
  }
  await field.check().catch(async () => field.click());
  return true;
}

async function clickSave(page) {
  const scope = await currentScope(page);
  for (const candidate of T.save) {
    const button = scope.getByRole('button', { name: candidate, exact: false });
    if (await visible(button)) {
      await button.first().click();
      await page.waitForTimeout(700);
      return true;
    }
  }
  return false;
}

async function ensureFormOpen(page, autoButtons, manualMessage) {
  if (await clickText(page, autoButtons)) {
    await page.waitForTimeout(600);
    return;
  }
  await pressEnter(manualMessage);
}

async function fillPersonal(page) {
  console.log('\n[1/6] Personal information and About me');
  let scope = await currentScope(page);

  const didName = await fillAny(scope, ['First name', 'Nome'], data.firstName, { optional: true });
  await fillAny(scope, ['Last name', 'Surname', 'Cognome'], data.lastName, { optional: true });

  if (!didName) {
    await pressEnter('Open the Personal information editor in Europass.');
    scope = await currentScope(page);
    await fillAny(scope, ['First name', 'Nome'], data.firstName, { optional: true });
    await fillAny(scope, ['Last name', 'Surname', 'Cognome'], data.lastName, { optional: true });
  }

  await fillAny(scope, ['Email', 'Email address', 'Indirizzo e-mail'], data.contact.email, { optional: true });
  await fillPhoneNumber(page, scope, data.contact.phone);
  await fillAddress(page, scope);
  await fillAny(scope, ['Website', 'LinkedIn', 'Sito web'], data.contact.linkedin, { optional: true });

  const aboutEditor = scope.locator(
    '#perso-info-personalDescription .ql-editor[contenteditable="true"]',
  ).first();
  if (await visible(aboutEditor)) {
    await aboutEditor.fill(data.summary);
  } else {
    console.log('  ! About me editor was not found in Personal information.');
  }

  if (data.contact.showPhoto && data.contact.photoPath && fs.existsSync(data.contact.photoPath)) {
    const fileInput = scope.locator('input[type="file"]').first();
    if (await visible(fileInput)) {
      await fileInput.setInputFiles(data.contact.photoPath).catch(() => {});
    }
  }

  await clickSave(page);
}

async function openWorkForm(page, job) {
  const existingRecord = page.locator('.record-container').filter({
    hasText: job.company,
  }).first();

  if (await visible(existingRecord)) {
    const editButton = existingRecord.locator(
      'button[aria-label*="Edit the record of the section Work experience" i]',
    ).first();
    if (await visible(editButton)) {
      await editButton.click();
      await page.waitForTimeout(500);
      return;
    }
  }

  const addButton = page.locator('#section-add-record-workexperience').first();
  if (await visible(addButton)) {
    await addButton.click();
    await page.waitForTimeout(500);
    return;
  }

  await pressEnter(
    `Open "${T.workSection[0]}" and choose Add for: ${job.title} - ${job.company}.`,
  );
}

async function workFormScope(page) {
  const employerLabels = [
    'Employer',
    'Employer name',
    'Organisation',
    'Company',
    'Datore di lavoro',
    'Nome del datore di lavoro',
    'Organizzazione',
  ];

  const employer = await fieldByLabel(page, employerLabels, { textEntryOnly: true });
  if (!employer) return await currentScope(page);

  const form = employer.locator('xpath=ancestor::form[1]');
  if (await visible(form)) return form;
  return await currentScope(page);
}

async function fillWork(page) {
  console.log(`\n[2/6] Work experience (${data.work.length} entries)`);
  for (const [index, job] of data.work.entries()) {
    console.log(`  ${index + 1}. ${job.title} - ${job.company}`);
    await openWorkForm(page, job);
    const scope = await workFormScope(page);
    await fillAny(scope, ['Job title', 'Occupation or position held', 'Position', 'Titolo professionale', 'Posizione ricoperta'], job.title);
    await fillAny(scope, ['Employer', 'Employer name', 'Organisation', 'Company', 'Datore di lavoro', 'Nome del datore di lavoro', 'Organizzazione'], job.company);
    await fillAny(scope, ['City', 'Town', 'Città', 'Comune'], job.location.city, { optional: true });
    await selectOrFill(scope, ['Country', 'Paese'], job.location.country, { optional: true });
    await fillDate(scope, ['Start date', 'From', 'Data di inizio', 'Da'], job.start, { optional: true });
    if (job.end) {
      await fillDate(scope, ['End date', 'To', 'Data di fine', 'A'], job.end, { optional: true });
    } else {
      await checkAny(scope, ['I currently work here', 'Current', 'Ongoing', 'Attualmente lavoro qui', 'In corso'], { optional: true });
    }
    await fillAny(
      scope,
      ['Main activities and responsibilities', 'Description', 'Activities', 'Principali attività e responsabilità', 'Descrizione'],
      job.bullets.map((x) => `• ${x}`).join('\n'),
      { optional: true },
    );
    if (!(await clickSave(page))) {
      await pressEnter('Save this work-experience entry in Europass, then return here.');
    }
  }
}

async function fillEducation(page) {
  console.log(`\n[3/6] Education (${data.education.length} entries)`);
  for (const [index, item] of data.education.entries()) {
    console.log(`  ${index + 1}. ${item.qualification}`);
    await ensureFormOpen(
      page,
      T.addEducation,
      `Open "${T.educationSection[0]}" and choose Add for: ${item.qualification}.`,
    );
    const scope = await currentScope(page);
    await fillAny(scope, ['Qualification', 'Title of qualification awarded', 'Degree', 'Qualifica', 'Titolo della qualifica rilasciata'], item.qualification);
    await fillAny(scope, ['Organisation', 'Institution', 'Education provider', 'Organizzazione', 'Istituto', 'Ente di istruzione'], item.institution);
    await selectOrFill(scope, ['Country', 'Paese'], item.country, { optional: true });
    await fillDate(scope, ['Start date', 'From', 'Data di inizio', 'Da'], item.start, { optional: true });
    await fillDate(scope, ['End date', 'To', 'Data di fine', 'A'], item.end, { optional: true });
    if (!(await clickSave(page))) {
      await pressEnter('Save this education entry in Europass, then return here.');
    }
  }
}

async function fillLanguages(page) {
  console.log(`\n[4/6] Languages (${data.languages.length} entries)`);
  for (const [index, item] of data.languages.entries()) {
    console.log(`  ${index + 1}. ${item.language} - ${item.level}`);
    await ensureFormOpen(
      page,
      T.addLanguage,
      `Open "${T.languageSection[0]}" and choose Add for: ${item.language}.`,
    );
    const scope = await currentScope(page);
    await selectOrFill(scope, ['Language', 'Lingua'], item.language, { optional: true });

    if (/native/i.test(item.level)) {
      await checkAny(scope, ['Mother tongue', 'Native language', 'Lingua madre'], { optional: true });
    } else {
      for (const labels of [
        ['Listening', 'Ascolto'],
        ['Reading', 'Lettura'],
        ['Spoken interaction', 'Interazione orale'],
        ['Spoken production', 'Produzione orale'],
        ['Writing', 'Scrittura'],
        ['Level', 'Livello'],
      ]) {
        await selectOrFill(scope, labels, item.level, { optional: true });
      }
    }

    if (!(await clickSave(page))) {
      await pressEnter('Save this language entry in Europass, then return here.');
    }
  }
}

async function fillSkills(page) {
  console.log('\n[5/6] Technical / digital skills');
  const skillsText = data.skills.map((x) => `${x.category}: ${x.value}`).join('\n');
  if (await clickText(page, T.digitalSection)) {
    await page.waitForTimeout(400);
    const scope = await currentScope(page);
    const filled = await fillAny(scope, ['Description', 'Digital skills', 'Skills', 'Descrizione', 'Competenze digitali', 'Competenze'], skillsText, { optional: true });
    if (filled) await clickSave(page);
  } else {
    console.log('  ! Skills section was not auto-opened. Europass may use the profile skill picker here.');
    console.log('  ! No typing is required: the script will keep the exact skills text in the console for copy/paste if needed.');
    console.log(`\n${skillsText}\n`);
  }
}

async function fillProjects(page) {
  console.log(`\n[6/6] Projects (${data.projects.length} entries)`);
  for (const project of data.projects) {
    const opened = await clickText(page, T.addProject);
    if (!opened) {
      console.log('  ! Projects section is not available on this screen. Skipping automatic project insertion.');
      break;
    }
    await page.waitForTimeout(400);
    const scope = await currentScope(page);
    await fillAny(scope, ['Project name', 'Name', 'Titolo del progetto', 'Nome'], project.name, { optional: true });
    await fillAny(scope, ['Description', 'Descrizione'], `${project.description}\nTech: ${project.tech}`, { optional: true });
    await fillAny(scope, ['Website', 'URL', 'Link', 'Sito web'], project.url, { optional: true });
    await clickSave(page);
  }
}

async function saveDebug(page, reason) {
  fs.mkdirSync(debugDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const screenshot = path.join(debugDir, `${stamp}.png`);
  const html = path.join(debugDir, `${stamp}.html`);
  await page.screenshot({ path: screenshot, fullPage: true }).catch(() => {});
  fs.writeFileSync(html, await page.content().catch(() => ''), 'utf8');
  console.error(`\nAutomation stopped: ${reason}`);
  console.error(`Debug files: ${screenshot} and ${html}`);
}

let context;
try {
  fs.mkdirSync(profileDir, { recursive: true });

  context = await chromium.launchPersistentContext(profileDir, {
    channel: 'msedge',
    headless: false,
    viewport: null,
    chromiumSandbox: true,
    args: ['--start-maximized'],
  });

  const pages = context.pages();
  const page = pages[0] ?? await context.newPage();
  await page.goto(editorUrl, { waitUntil: 'domcontentloaded' });

  console.log('Europass automation started in Microsoft Edge.');
  console.log('The browser profile is stored locally in .europass-browser-profile and is ignored by Git.');
  console.log('No password or EU Login credential is read by the script.');
  console.log(`CV data loaded from cv.typ and personal.yaml for ${data.name}.`);

  await pressEnter(
    'Log in if Europass asks you to. Create/open a blank CV and stay on the content-editing step. The script will fill fields from there.',
  );

  await fillPersonal(page);
  await fillWork(page);
  await fillEducation(page);
  await fillLanguages(page);
  await fillSkills(page);
  await fillProjects(page);

  console.log('\nAutomatic filling pass completed.');
  console.log('Review the CV in Europass, choose the official template, and let Europass generate the PDF.');
  await pressEnter('Keep the browser open for review. Press Enter here only when you are finished.');
} catch (error) {
  const page = context?.pages()?.[0];
  if (page) await saveDebug(page, error?.stack || error?.message || String(error));
  else console.error(error);
  process.exitCode = 1;
} finally {
  await context?.close().catch(() => {});
  rl.close();
}
