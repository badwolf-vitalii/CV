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
    addWork: ['Add work experience', 'Add new work experience'],
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

async function fieldByLabel(scope, labels) {
  for (const label of labels) {
    const locator = scope.getByLabel(label, { exact: false });
    if (await visible(locator)) return locator.first();
  }

  for (const label of labels) {
    const labelNode = scope.locator('label').filter({ hasText: label }).first();
    if (!(await visible(labelNode))) continue;
    const forId = await labelNode.getAttribute('for');
    if (forId) {
      const escapedId = forId.replaceAll('"', '\\"');
      const byId = scope.locator(`[id="${escapedId}"]`);
      if (await visible(byId)) return byId.first();
    }
    const nearby = labelNode.locator('xpath=following::*[self::input or self::textarea or @contenteditable="true"][1]');
    if (await visible(nearby)) return nearby.first();
  }

  return null;
}

async function fillAny(scope, labels, value, { optional = false } = {}) {
  if (value === undefined || value === null || normalize(value) === '') return false;
  const field = await fieldByLabel(scope, labels);
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
  const field = await fieldByLabel(scope, labels);
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
  await fillAny(scope, ['Phone', 'Phone number', 'Telefono'], data.contact.phone, { optional: true });
  await fillAny(scope, ['City', 'Town', 'Città', 'Comune'], data.contact.location.city, { optional: true });
  await fillAny(scope, ['Region', 'Province', 'Regione', 'Provincia'], data.contact.location.region, { optional: true });
  await selectOrFill(scope, ['Country', 'Paese'], data.contact.location.country, { optional: true });
  await fillAny(scope, ['Website', 'LinkedIn', 'Sito web'], data.contact.linkedin, { optional: true });

  if (data.contact.showPhoto && data.contact.photoPath && fs.existsSync(data.contact.photoPath)) {
    const fileInput = scope.locator('input[type="file"]').first();
    if (await visible(fileInput)) {
      await fileInput.setInputFiles(data.contact.photoPath).catch(() => {});
    }
  }

  await clickSave(page);

  const aboutField = await fieldByLabel(page, T.about);
  if (aboutField) {
    await aboutField.fill(data.summary).catch(async () => {
      await aboutField.click();
      await aboutField.press('Control+A');
      await aboutField.press('Backspace');
      await aboutField.type(data.summary);
    });
  } else {
    const opened = await clickText(page, T.about);
    if (opened) {
      await page.waitForTimeout(400);
      const aboutScope = await currentScope(page);
      await fillAny(aboutScope, [...T.about, 'Description', 'Descrizione'], data.summary, { optional: true });
      await clickSave(page);
    } else {
      console.log('  ! About me was not auto-located. You can paste it later if Europass hides this section until a later step.');
    }
  }
}

async function fillWork(page) {
  console.log(`\n[2/6] Work experience (${data.work.length} entries)`);
  for (const [index, job] of data.work.entries()) {
    console.log(`  ${index + 1}. ${job.title} - ${job.company}`);
    await ensureFormOpen(
      page,
      T.addWork,
      `Open "${T.workSection[0]}" and choose Add for: ${job.title} - ${job.company}.`,
    );
    const scope = await currentScope(page);
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
