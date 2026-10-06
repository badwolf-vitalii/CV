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

async function dismissAutocomplete(page, field = null) {
  if (field) {
    await field.press('Escape', { timeout: 1000 }).catch(() => {});
    await field.evaluate((el) => el.blur()).catch(() => {});
  }

  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(100);

  let overlays = page.locator('.p-autocomplete-overlay:visible');
  if (await overlays.count()) {
    await page.locator('body').click({
      position: { x: 8, y: 8 },
      force: true,
      timeout: 1000,
    }).catch(() => {});
    await page.waitForTimeout(120);
  }

  overlays = page.locator('.p-autocomplete-overlay:visible');
  if (await overlays.count()) {
    await page.evaluate(() => {
      const active = document.activeElement;
      if (active instanceof HTMLElement) active.blur();
      document.body.dispatchEvent(new MouseEvent('mousedown', {
        bubbles: true,
        clientX: 8,
        clientY: 8,
      }));
      document.body.dispatchEvent(new MouseEvent('mouseup', {
        bubbles: true,
        clientX: 8,
        clientY: 8,
      }));
      document.body.dispatchEvent(new MouseEvent('click', {
        bubbles: true,
        clientX: 8,
        clientY: 8,
      }));
    }).catch(() => {});
    await page.waitForTimeout(150);
  }
}

async function fillFreeText(page, field, value) {
  await field.fill(String(value));
  const insideAutocomplete = await field.locator(
    'xpath=ancestor::*[contains(@class,"p-autocomplete")][1]',
  ).count();

  if (insideAutocomplete) {
    await dismissAutocomplete(page, field);
  } else {
    await field.press('Escape', { timeout: 1000 }).catch(() => {});
  }
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

async function fillAny(scope, labels, value, { optional = false, page = null } = {}) {
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
    if (page) {
      await fillFreeText(page, field, value);
    } else {
      await field.fill(String(value));
      await field.press('Escape', { timeout: 1000 }).catch(() => {});
    }
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

async function lastVisibleOverlay(page) {
  // Prefer the outer PrimeNG overlay. It contains both the filter input and
  // the listbox. Returning the inner [role="listbox"] loses access to the
  // filter and breaks virtualised country lists such as Italy.
  for (const selector of [
    '.p-select-overlay',
    '.p-dropdown-panel',
    '.p-autocomplete-overlay',
  ]) {
    const overlays = page.locator(selector);
    const count = await overlays.count();

    for (let i = count - 1; i >= 0; i -= 1) {
      const overlay = overlays.nth(i);
      if (await visible(overlay)) return overlay;
    }
  }

  const listboxes = page.locator('[role="listbox"]');
  const count = await listboxes.count();
  for (let i = count - 1; i >= 0; i -= 1) {
    const listbox = listboxes.nth(i);
    if (await visible(listbox)) return listbox;
  }

  return null;
}

async function closeOpenOverlays(page) {
  for (let i = 0; i < 3; i += 1) {
    const overlay = await lastVisibleOverlay(page);
    if (!overlay) return;
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(80);
  }
}

async function selectPrimeNgText(page, control, values) {
  if (!(await visible(control))) return false;

  const candidates = Array.isArray(values) ? values : [values];

  for (const value of candidates) {
    await dismissAutocomplete(page);
    await closeOpenOverlays(page);
    await control.scrollIntoViewIfNeeded().catch(() => {});
    await control.click({ force: true, timeout: 3000 });
    await page.waitForTimeout(200);

    // Europass currently renders country dropdowns as PrimeNG p-dropdown
    // controls. Their filter input lives in an overlay attached to <body>,
    // not necessarily inside the logical dropdown subtree.
    const filter = await firstVisibleCandidate(
      page.locator([
        'input[placeholder*="France" i]',
        'input.p-select-filter',
        'input.p-dropdown-filter',
        '.p-select-overlay input[type="text"]',
        '.p-dropdown-panel input[type="text"]',
      ].join(', ')),
    );

    if (filter) {
      await filter.fill(String(value));
      await page.waitForTimeout(250);
    } else {
      // Some PrimeNG builds focus the filter without exposing a stable class.
      // Typing through the keyboard still filters the opened dropdown.
      await page.keyboard.type(String(value)).catch(() => {});
      await page.waitForTimeout(250);
    }

    const option = await firstVisibleCandidate(
      page.getByRole('option', {
        name: new RegExp(`^\\s*${escapeRegex(value)}(?:\\s|$)`, 'i'),
      }),
    );

    if (option) {
      await option.click({ force: true });
      await page.waitForTimeout(150);
      return true;
    } else {
      // Virtualised lists may not expose the option node until keyboard
      // navigation. After filtering, the first real result is the target.
      if (filter) {
        await filter.press('ArrowDown').catch(() => {});
        await filter.press('Enter').catch(() => {});
      } else {
        await page.keyboard.press('ArrowDown').catch(() => {});
        await page.keyboard.press('Enter').catch(() => {});
      }
      await page.waitForTimeout(200);
    }

    const selectedState = [
      normalize(await control.textContent().catch(() => '')),
      normalize(await control.inputValue().catch(() => '')),
      normalize(await control.getAttribute('value').catch(() => '')),
      normalize(await control.getAttribute('aria-label').catch(() => '')),
    ].join(' ').toLowerCase();

    if (selectedState.includes(String(value).toLowerCase())) return true;

    await closeOpenOverlays(page);
  }

  await closeOpenOverlays(page);
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

async function selectPersonalAddressCountry(page, scope, country) {
  const control = scope.locator('#perso-info-country-0').first();
  if (!(await visible(control))) {
    console.log('  ! Address country control was not found.');
    return false;
  }

  const targetName = country.toLowerCase() === 'italy'
    ? (lang === 'it' ? 'Italia' : 'Italy')
    : country;

  const searchText = country.toLowerCase() === 'italy'
    ? 'Ital'
    : String(country);

  const dropdown = control.locator('xpath=ancestor::p-dropdown[1]');
  const trigger = dropdown.locator(
    '[role="button"][aria-label="dropdown trigger"]',
  ).first();

  console.log('  - Opening address country dropdown');
  await closeOpenOverlays(page);

  if (await visible(trigger)) {
    await trigger.click({ timeout: 3000 });
  } else {
    await control.click({ timeout: 3000 });
  }

  const filter = page.locator(
    '.p-select-overlay:visible input[type="text"], ' +
    '.p-dropdown-panel:visible input[type="text"], ' +
    'input[placeholder*="France" i]:visible',
  ).last();

  try {
    await filter.waitFor({ state: 'visible', timeout: 5000 });
  } catch {
    console.log('  ! Country search field did not appear.');
    return false;
  }

  console.log(`  - Typing country filter: ${searchText}`);
  await filter.click();
  await filter.fill('');
  await filter.type(searchText, { delay: 80 });
  await page.waitForTimeout(300);

  const option = page.getByRole('option', {
    name: targetName,
    exact: true,
  }).last();

  try {
    await option.waitFor({ state: 'visible', timeout: 5000 });
  } catch {
    console.log(`  ! Country option was not found: ${targetName}`);
    return false;
  }

  console.log(`  - Selecting address country: ${targetName}`);
  await option.click({ timeout: 3000 });
  await page.waitForTimeout(200);

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const selectedText = normalize(await control.textContent());
    if (selectedText.toLowerCase().includes(targetName.toLowerCase())) {
      console.log(`  - Address country: ${targetName}`);
      return true;
    }
    await page.waitForTimeout(100);
  }

  console.log(`  ! Country selection did not stick: ${targetName}`);
  return false;
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

  if (location.country) {
    const selected = await selectPersonalAddressCountry(page, scope, location.country);
    if (!selected) {
      console.log(`  ! Could not select address country: ${location.country}`);
    } else {
      console.log(`  - Address country: ${location.country}`);
    }
  }
}

async function selectCountry(page, scope, value, { optional = true } = {}) {
  if (!value) return false;

  const labels = ['Country', 'Paese'];
  const field = await fieldByLabel(scope, labels);
  if (!field) {
    if (!optional) console.log('  ! Country field not found.');
    return false;
  }

  const tag = await field.evaluate((el) => el.tagName.toLowerCase());

  if (tag === 'select') {
    for (const label of value.toLowerCase() === 'italy'
      ? ['Italy', 'Italia']
      : [String(value)]) {
      try {
        await field.selectOption({ label });
        return true;
      } catch {
        // Try the next alias.
      }
    }
    return false;
  }

  const names = value.toLowerCase() === 'italy'
    ? ['Italy', 'Italia']
    : [String(value)];

  return selectPrimeNgText(page, field, names);
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
    const button = scope.getByRole('button', { name: candidate, exact: false }).first();
    if (!(await visible(button))) continue;

    const disabled = await button.isDisabled().catch(() => false);
    if (disabled) return false;

    await button.click({ timeout: 3000 });
    await page.waitForTimeout(700);
    return true;
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

async function closeProfilePictureEditor(page) {
  const cancel = page.getByRole('button', { name: /^Cancel$|^Annulla$/i }).last();
  if (await visible(cancel)) {
    await cancel.click().catch(() => {});
    await page.waitForTimeout(200);
    return;
  }

  const close = page.getByRole('button', {
    name: /Close|Chiudi/i,
  }).last();
  if (await visible(close)) {
    await close.click().catch(() => {});
    await page.waitForTimeout(200);
    return;
  }

  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(200);
}

async function uploadProfilePhoto(page) {
  if (!data.contact.showPhoto || !data.contact.photoPath) return true;

  if (!fs.existsSync(data.contact.photoPath)) {
    console.log(`  ! Photo file not found: ${data.contact.photoPath}`);
    return false;
  }

  const editButton = page.locator('#edit-profile-picture').first();
  if (!(await visible(editButton))) {
    console.log('  ! Profile picture Edit button was not found.');
    return false;
  }

  console.log('  - Opening profile picture editor');
  await editButton.click();

  // Europass renders "Select file" as a custom upload control, not as a
  // normal button. The reliable target is the hidden file input created when
  // the editor opens.
  const fileInput = page.locator('input[type="file"]').last();

  try {
    await fileInput.waitFor({ state: 'attached', timeout: 5000 });
  } catch {
    console.log('  ! Profile picture file input did not appear.');
    await closeProfilePictureEditor(page);
    return false;
  }

  console.log(`  - Uploading profile photo: ${path.basename(data.contact.photoPath)}`);

  try {
    await fileInput.setInputFiles(data.contact.photoPath);
  } catch (error) {
    console.log(`  ! Could not upload the profile photo: ${error.message}`);
    await closeProfilePictureEditor(page);
    return false;
  }

  // Find the visible Save belonging to the photo editor. The Personal
  // information Save remains elsewhere on the page, so use the last visible
  // matching button after the editor has opened.
  const saveButtons = page.getByRole('button', { name: /^Save$|^Salva$/i });
  let saveButton = null;

  for (let attempt = 0; attempt < 50; attempt += 1) {
    const count = await saveButtons.count();

    for (let i = count - 1; i >= 0; i -= 1) {
      const candidate = saveButtons.nth(i);
      if (!(await visible(candidate))) continue;

      saveButton = candidate;
      if (!(await candidate.isDisabled().catch(() => true))) break;
      saveButton = null;
    }

    if (saveButton) break;
    await page.waitForTimeout(100);
  }

  if (!saveButton) {
    console.log('  ! Profile picture Save button did not become enabled.');
    await closeProfilePictureEditor(page);
    return false;
  }

  console.log('  - Saving profile photo');
  await saveButton.click();
  await page.waitForTimeout(300);

  try {
    await fileInput.waitFor({ state: 'detached', timeout: 5000 });
  } catch {
    // Some builds keep the input node but hide the dialog. Verify that the
    // upload editor is no longer interactable before treating this as failure.
    const stillVisible = await page.getByText(
      /Edit profile picture|Modifica immagine del profilo/i,
      { exact: true },
    ).isVisible().catch(() => false);

    if (stillVisible) {
      console.log('  ! Profile picture dialog did not close after Save.');
      await closeProfilePictureEditor(page);
      return false;
    }
  }

  console.log('  - Profile photo saved');
  return true;
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

  await uploadProfilePhoto(page);

  if (!(await clickSave(page))) {
    await pressEnter(
      'Personal information is still invalid. Complete any red required field shown by Europass, then press Enter here.',
    );

    if (!(await clickSave(page))) {
      throw new Error('Personal information is still invalid after the manual correction.');
    }
  }
}

async function openWorkForm(page, job) {
  const editButton = await existingRecordEditButton(
    page,
    job.company,
    ['Work experience', 'Esperienza lavorativa', 'Esperienze lavorative'],
  );

  if (editButton) {
    await editButton.click();
    await page.waitForTimeout(500);
    return;
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
    console.log('     - Job title');
    await fillAny(
      scope,
      ['Job title', 'Occupation or position held', 'Position', 'Titolo professionale', 'Posizione ricoperta'],
      job.title,
      { page },
    );

    console.log('     - Employer');
    await fillAny(
      scope,
      ['Employer', 'Employer name', 'Organisation', 'Company', 'Datore di lavoro', 'Nome del datore di lavoro', 'Organizzazione'],
      job.company,
      { page },
    );

    console.log('     - City');
    await fillAny(
      scope,
      ['City', 'Town', 'Città', 'Comune'],
      job.location.city,
      { optional: true, page },
    );

    await dismissAutocomplete(page);
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
      { optional: true, page },
    );
    await dismissAutocomplete(page);
    if (!(await clickSave(page))) {
      await pressEnter('Save this work-experience entry in Europass, then return here.');
    }
  }
}

async function sectionCard(page, titles) {
  for (const title of titles) {
    const headings = page.getByText(title, { exact: true });
    const count = await headings.count();

    for (let i = 0; i < count; i += 1) {
      const heading = headings.nth(i);
      if (!(await visible(heading))) continue;

      for (const xpath of [
        'ancestor::eprofile-section-card[1]',
        'ancestor::*[contains(@class,"card")][1]',
        'ancestor::*[.//button[contains(normalize-space(.),"Add new") or contains(normalize-space(.),"Aggiungi")]][1]',
      ]) {
        const container = heading.locator(`xpath=${xpath}`);
        if (await visible(container)) return container;
      }
    }
  }

  return null;
}

async function existingRecordEditButton(page, recordText, sectionNames) {
  const nodes = page.getByText(recordText, { exact: false });
  const count = await nodes.count();

  for (let i = 0; i < count; i += 1) {
    const node = nodes.nth(i);
    if (!(await visible(node))) continue;

    const record = node.locator(
      'xpath=ancestor::*[.//button[contains(@aria-label,"Edit the record of the section")]][1]',
    );
    if (!(await visible(record))) continue;

    const buttons = record.locator('button[aria-label*="Edit the record of the section" i]');
    const buttonCount = await buttons.count();

    for (let j = 0; j < buttonCount; j += 1) {
      const button = buttons.nth(j);
      if (!(await visible(button))) continue;
      const aria = normalize(await button.getAttribute('aria-label')).toLowerCase();
      if (sectionNames.some((name) => aria.includes(name.toLowerCase()))) return button;
    }
  }

  return null;
}

async function waitForEducationForm(page, item) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const qualification = await fieldByLabel(
      page,
      ['Qualification', 'Title of qualification awarded', 'Degree', 'Qualifica', 'Titolo della qualifica rilasciata'],
      { textEntryOnly: true },
    );
    const organisation = await fieldByLabel(
      page,
      ['Organisation', 'Institution', 'Education provider', 'Organizzazione', 'Istituto', 'Ente di istruzione'],
      { textEntryOnly: true },
    );

    if (qualification && organisation) return await currentScope(page);

    await pressEnter(
      `Open the Education and training form for: ${item.qualification}. Do not just expand the section; open the actual Add/Edit form.`,
    );
  }

  return null;
}

async function openEducationForm(page, item) {
  const editButton = await existingRecordEditButton(
    page,
    item.institution,
    ['Education', 'Istruzione', 'Formazione'],
  );

  if (editButton) {
    await editButton.click();
    await page.waitForTimeout(500);
    return await waitForEducationForm(page, item);
  }

  const section = await sectionCard(page, T.educationSection);
  if (section) {
    const addButton = section.getByRole('button', { name: /^Add new$|^Aggiungi$/i }).first();
    if (await visible(addButton)) {
      await addButton.click();
      await page.waitForTimeout(500);
      const scope = await waitForEducationForm(page, item);
      if (scope) return scope;
    }

    const ariaAddButton = section.locator(
      'button[aria-label*="Add new" i], button[aria-label*="Aggiungi" i]',
    ).first();
    if (await visible(ariaAddButton)) {
      await ariaAddButton.click();
      await page.waitForTimeout(500);
      const scope = await waitForEducationForm(page, item);
      if (scope) return scope;
    }
  }

  return await waitForEducationForm(page, item);
}

async function fillEducation(page) {
  console.log(`\n[3/6] Education (${data.education.length} entries)`);
  for (const [index, item] of data.education.entries()) {
    console.log(`  ${index + 1}. ${item.qualification}`);
    const scope = await openEducationForm(page, item);
    if (!scope) {
      console.log(`  ! Education form was not detected for: ${item.qualification}. Skipping this entry.`);
      continue;
    }
    await fillAny(
      scope,
      ['Qualification', 'Title of qualification awarded', 'Degree', 'Qualifica', 'Titolo della qualifica rilasciata'],
      item.qualification,
      { page },
    );
    await fillAny(
      scope,
      ['Organisation', 'Institution', 'Education provider', 'Organizzazione', 'Istituto', 'Ente di istruzione'],
      item.institution,
      { page },
    );
    // Country intentionally omitted: Europass uses the same fragile custom dropdown here.
    await fillDate(scope, ['Start date', 'From', 'Data di inizio', 'Da'], item.start, { optional: true });
    await fillDate(scope, ['End date', 'To', 'Data di fine', 'A'], item.end, { optional: true });
    if (!(await clickSave(page))) {
      await pressEnter('Save this education entry in Europass, then return here.');
    }
  }
}

async function exactLabeledControl(scope, labels, index = 0) {
  for (const label of labels) {
    const controls = scope.getByLabel(label, { exact: true });
    const count = await controls.count();
    let visibleIndex = 0;

    for (let i = 0; i < count; i += 1) {
      const control = controls.nth(i);
      if (!(await visible(control))) continue;
      if (visibleIndex === index) return control;
      visibleIndex += 1;
    }
  }

  for (const label of labels) {
    const labelNodes = scope.locator('label').filter({ hasText: label });
    const count = await labelNodes.count();
    let visibleIndex = 0;

    for (let i = 0; i < count; i += 1) {
      const labelNode = labelNodes.nth(i);
      if (!(await visible(labelNode))) continue;
      if (normalize(await labelNode.textContent()) !== label) continue;

      const forId = await labelNode.getAttribute('for');
      if (!forId) continue;

      const control = scope.locator(`[id="${forId.replaceAll('"', '\\"')}"]`).first();
      if (!(await visible(control))) continue;

      if (visibleIndex === index) return control;
      visibleIndex += 1;
    }
  }

  for (const label of labels) {
    const textNodes = scope.getByText(label, { exact: true });
    const count = await textNodes.count();
    let visibleIndex = 0;

    for (let i = 0; i < count; i += 1) {
      const textNode = textNodes.nth(i);
      if (!(await visible(textNode))) continue;

      const nearby = textNode.locator(
        'xpath=following::*[self::select or @role="combobox"][1]',
      );
      const control = await firstVisibleCandidate(nearby);
      if (!control) continue;

      if (visibleIndex === index) return control;
      visibleIndex += 1;
    }
  }

  return null;
}

async function languageSectionScope(page) {
  const section = await sectionCard(page, T.languageSection);
  if (section) {
    const motherText = section.getByText(/Mother tongue|Lingua madre/i, { exact: true });
    const otherText = section.getByText(/Other language|Altra lingua/i, { exact: true });
    if (await visible(motherText) && await visible(otherText)) return section;
  }

  const motherText = page.getByText(/Mother tongue|Lingua madre/i, { exact: true });
  const otherText = page.getByText(/Other language|Altra lingua/i, { exact: true });
  if (await visible(motherText) && await visible(otherText)) return page;

  return null;
}

function languageNames(name) {
  const labels = {
    Ukrainian: { en: 'Ukrainian', it: 'ucraino' },
    Italian: { en: 'Italian', it: 'italiano' },
    English: { en: 'English', it: 'inglese' },
    Russian: { en: 'Russian', it: 'russo' },
  };

  return [labels[name]?.[lang] || name];
}

async function selectLabeledChoiceAt(page, scope, labels, index, values) {
  const control = await exactLabeledControl(scope, labels, index);
  if (!control) return false;

  const tag = await control.evaluate((el) => el.tagName.toLowerCase());
  if (tag === 'select') {
    for (const value of values) {
      try {
        await control.selectOption({ label: String(value) });
        return true;
      } catch {
        // Try the next label.
      }
    }
    return false;
  }

  if (tag === 'input' || tag === 'textarea') {
    await control.click().catch(() => {});
    await control.fill('').catch(() => {});
    await page.waitForTimeout(100);
  }

  return selectPrimeNgText(page, control, values);
}

async function languageEntryScope(scope, index) {
  const languageControl = await exactLabeledControl(
    scope,
    ['Other language', 'Altra lingua'],
    index,
  );

  if (!languageControl) return scope;

  const entry = languageControl.locator(
    'xpath=ancestor::*[.//*[normalize-space(.)="Listening" or normalize-space(.)="Ascolto"] and .//*[normalize-space(.)="Reading" or normalize-space(.)="Lettura"] and .//*[contains(normalize-space(.),"Spoken interaction") or contains(normalize-space(.),"Interazione orale")]][1]',
  );

  if (await visible(entry)) return entry;
  return scope;
}

async function openLanguageSkillsForm(page) {
  let scope = await languageSectionScope(page);
  if (scope) return scope;

  const section = await sectionCard(page, T.languageSection);
  if (section) {
    const editButton = section.locator(
      'button[aria-label*="Edit the content of the section Language skills" i], button[aria-label*="Edit the content of the section Competenze linguistiche" i]',
    ).first();

    if (await visible(editButton)) {
      await editButton.click();
      await page.waitForTimeout(500);
      scope = await languageSectionScope(page);
      if (scope) return scope;
    }
  }

  await pressEnter(
    `Open "${T.languageSection[0]}" so that the Mother tongue and Other language fields are visible.`,
  );

  return await languageSectionScope(page);
}

async function fillLanguages(page) {
  console.log(`\n[4/6] Languages (${data.languages.length} entries)`);

  const languageScope = await openLanguageSkillsForm(page);
  if (!languageScope) {
    console.log('  ! Language skills form was not detected. Skipping automatic language filling.');
    return;
  }

  const nativeLanguage = data.languages.find((item) => /native/i.test(item.level));
  const otherLanguages = data.languages.filter((item) => !/native/i.test(item.level));

  if (nativeLanguage) {
    console.log(`  Mother tongue: ${nativeLanguage.language}`);
    const selected = await selectLabeledChoiceAt(
      page,
      languageScope,
      ['Mother tongue', 'Lingua madre'],
      0,
      languageNames(nativeLanguage.language),
    );
    if (!selected) {
      console.log(`  ! Could not select mother tongue: ${nativeLanguage.language}`);
    }
  }

  for (const [index, item] of otherLanguages.entries()) {
    console.log(`  Other language ${index + 1}: ${item.language} - ${item.level}`);

    if (index > 0) {
      const addButton = languageScope.getByRole('button', {
        name: /Add another language|Aggiungi un'altra lingua/i,
      }).first();

      if (await visible(addButton)) {
        await addButton.click();
        await page.waitForTimeout(300);
      } else {
        console.log('  ! "Add another language" button was not found.');
        break;
      }
    }

    const selected = await selectLabeledChoiceAt(
      page,
      languageScope,
      ['Other language', 'Altra lingua'],
      index,
      languageNames(item.language),
    );

    if (!selected) {
      console.log(`  ! Could not select language: ${item.language}`);
      continue;
    }

    await page.waitForTimeout(250);

    const entryScope = await languageEntryScope(languageScope, index);
    const skillLevels = [
      { key: 'listening', labels: ['Listening', 'Ascolto'] },
      { key: 'reading', labels: ['Reading', 'Lettura'] },
      { key: 'spokenInteraction', labels: ['Spoken interaction', 'Interazione orale'] },
      { key: 'spokenProduction', labels: ['Spoken production', 'Produzione orale'] },
      { key: 'writing', labels: ['Writing', 'Scrittura'] },
    ];

    for (const skill of skillLevels) {
      const level = item.skills?.[skill.key] || item.level;
      console.log(`    - ${skill.labels[0]}: ${level}`);

      const levelSelected = await selectLabeledChoiceAt(
        page,
        entryScope,
        skill.labels,
        0,
        [level],
      );

      if (!levelSelected) {
        console.log(`      ! Could not select ${skill.labels[0]} level: ${level}`);
      }
    }
  }

  if (!(await clickSave(page))) {
    await pressEnter('Save the Language skills section in Europass, then return here.');
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

async function ensureProjectsSection(page) {
  let section = await sectionCard(page, T.projectSection);
  if (section) return section;

  const addSection = page.locator('#profile-add-section').first();
  if (!(await visible(addSection))) {
    console.log('  ! Add new section button was not found.');
    return null;
  }

  console.log('  - Creating Projects section');
  await addSection.click();
  await page.waitForTimeout(300);

  const dialog = page.getByRole('dialog').filter({
    hasText: /Create a new section|Crea una nuova sezione/i,
  }).last();

  if (!(await visible(dialog))) {
    console.log('  ! Create a new section dialog did not open.');
    return null;
  }

  // This dialog uses a native <select> with stable IDs.
  // Prefer those IDs over accessible-label lookup because the Europass
  // overlay currently does not expose the label relationship reliably.
  const sectionType = page.locator('#new-section-banner-select').last();

  try {
    await sectionType.waitFor({ state: 'visible', timeout: 5000 });
  } catch {
    console.log('  ! Section type selector was not found.');
    return null;
  }

  try {
    await sectionType.selectOption({ value: '9: projects' });
  } catch {
    try {
      await sectionType.selectOption({ label: 'Projects' });
    } catch {
      console.log('  ! Projects option was not found in the section type selector.');
      return null;
    }
  }

  const addSectionButton = page.locator('#add-section').last();

  try {
    await addSectionButton.waitFor({ state: 'visible', timeout: 5000 });

    for (let attempt = 0; attempt < 30; attempt += 1) {
      if (!(await addSectionButton.isDisabled().catch(() => true))) break;
      await page.waitForTimeout(100);
    }

    if (await addSectionButton.isDisabled().catch(() => true)) {
      console.log('  ! Add section button did not become enabled.');
      return null;
    }

    console.log('  - Adding Projects section');
    await addSectionButton.click();
    await page.waitForTimeout(600);
  } catch {
    console.log('  ! Add section button was not found.');
    return null;
  }

  section = await sectionCard(page, T.projectSection);
  if (section) return section;

  await pressEnter(
    'Projects is selected in the "Create a new section" dialog. Finish creating the section in Europass, then return here.',
  );

  return await sectionCard(page, T.projectSection);
}

async function openProjectForm(page, project) {
  const editButton = await existingRecordEditButton(
    page,
    project.name,
    ['Projects', 'Project', 'Progetti', 'Progetto'],
  );

  if (editButton) {
    await editButton.click();
    await page.waitForTimeout(400);
    return await currentScope(page);
  }

  const section = await ensureProjectsSection(page);
  if (!section) return null;

  const addButton = section.getByRole('button', {
    name: /^Add new$|^Add project$|^Aggiungi$|^Aggiungi progetto$/i,
  }).first();

  if (await visible(addButton)) {
    await addButton.click();
    await page.waitForTimeout(400);
    return await currentScope(page);
  }

  const ariaAddButton = section.locator(
    'button[aria-label*="Add new" i], button[aria-label*="Add project" i], button[aria-label*="Aggiungi" i]',
  ).first();

  if (await visible(ariaAddButton)) {
    await ariaAddButton.click();
    await page.waitForTimeout(400);
    return await currentScope(page);
  }

  await pressEnter(
    `Open the Projects section and choose Add new for: ${project.name}.`,
  );

  return await currentScope(page);
}

async function fillProjects(page) {
  console.log(`\n[6/6] Projects (${data.projects.length} entries)`);

  const section = await ensureProjectsSection(page);
  if (!section) {
    console.log('  ! Projects section could not be created.');
    return;
  }

  for (const [index, project] of data.projects.entries()) {
    console.log(`  ${index + 1}. ${project.name}`);

    const scope = await openProjectForm(page, project);
    if (!scope) {
      console.log(`  ! Project form could not be opened for: ${project.name}`);
      continue;
    }

    const nameFilled = await fillAny(
      scope,
      ['Project name', 'Name', 'Title', 'Titolo del progetto', 'Nome', 'Titolo'],
      project.name,
      { optional: true, page },
    );

    const descriptionFilled = await fillAny(
      scope,
      ['Description', 'Descrizione'],
      `${project.description}\nTech: ${project.tech}`,
      { optional: true, page },
    );

    await fillAny(
      scope,
      ['Website', 'URL', 'Link', 'Sito web'],
      project.url,
      { optional: true, page },
    );

    if (!nameFilled && !descriptionFilled) {
      await pressEnter(
        `The project form for "${project.name}" is open, but its fields were not recognised. Fill or inspect this form, then press Enter.`,
      );
    }

    if (!(await clickSave(page))) {
      await pressEnter(
        `Save the project "${project.name}" in Europass, then return here.`,
      );
    }
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
  page.setDefaultTimeout(8000);
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
