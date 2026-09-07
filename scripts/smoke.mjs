/**
 * End-to-end smoke test.
 *
 * Drives a production build in a real browser: loads a template, checks the
 * diagram renders with correct containment, edits a field and asserts the
 * generated Terraform changes, and visits every tab. Catches the class of
 * breakage that unit tests cannot — layout, stacking, and wiring between the
 * store and the canvas.
 *
 *   npm run build && npm run preview &
 *   npm run smoke
 */

import { existsSync, readdirSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.env.SMOKE_URL ?? 'http://localhost:4173/';

/**
 * Prefers a pre-installed Chromium when one is present (CI images and this
 * project's dev container ship one), otherwise falls back to whatever
 * Playwright manages itself.
 */
function findChromium() {
  if (process.env.CHROMIUM_PATH && existsSync(process.env.CHROMIUM_PATH)) {
    return process.env.CHROMIUM_PATH;
  }
  const root = '/opt/pw-browsers';
  if (!existsSync(root)) return undefined;
  for (const entry of readdirSync(root)) {
    if (!entry.startsWith('chromium-')) continue;
    const candidate = `${root}/${entry}/chrome-linux/chrome`;
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

const failures = [];
const check = (label, condition, detail = '') => {
  if (condition) {
    console.log(`  ok    ${label}`);
  } else {
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
    failures.push(label);
  }
};

const executablePath = findChromium();
const browser = await chromium.launch(executablePath ? { executablePath } : {});
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });

const consoleErrors = [];
page.on('console', (message) => {
  if (message.type() === 'error') consoleErrors.push(message.text());
});
page.on('pageerror', (error) => consoleErrors.push(error.message));

await page.goto(BASE, { waitUntil: 'networkidle' });

console.log('\nloading a template');
await page.getByRole('button', { name: 'Templates' }).click();
await page.getByText('Three-tier network').click();
await page.waitForTimeout(1200);

const nodeCount = await page.locator('.react-flow__node').count();
check('every resource renders on the canvas', nodeCount === 11, `saw ${nodeCount}`);

console.log('\ncontainment');
const containment = await page.evaluate(() => {
  const elements = new Map(
    [...document.querySelectorAll('.react-flow__node')].map((el) => [el.dataset.id, el]),
  );
  const { design } = JSON.parse(localStorage.getItem('terraform-builder:design:v1'));
  return design.nodes
    .filter((node) => node.parentId)
    .map((node) => {
      const child = elements.get(node.id).getBoundingClientRect();
      const parent = elements.get(node.parentId).getBoundingClientRect();
      return {
        name: node.name,
        inside:
          child.left >= parent.left - 1 &&
          child.top >= parent.top - 1 &&
          child.right <= parent.right + 1 &&
          child.bottom <= parent.bottom + 1,
      };
    });
});
check(
  'nested resources sit inside their containers',
  containment.length > 0 && containment.every((entry) => entry.inside),
  containment.filter((entry) => !entry.inside).map((entry) => entry.name).join(', '),
);

console.log('\ninspector and live code');
await page.locator('.node__name', { hasText: 'web-01' }).first().click();
await page.waitForTimeout(400);
check(
  'selecting a resource opens it in the inspector',
  (await page.locator('.inspector__resource-sub').innerText()) === 'azurerm_linux_virtual_machine',
);

const initial = await page.locator('.code__body pre').innerText();
check('containment supplies the resource group', initial.includes('azurerm_resource_group.rg-platform.name'));
check('the machine gets its own network interface', initial.includes('azurerm_network_interface.web-01.id'));

await page.locator('.inspector__section select').first().selectOption('Standard_D4s_v5');
await page.waitForTimeout(400);
const edited = await page.locator('.code__body pre').innerText();
check('editing a field rewrites the code', edited !== initial && edited.includes('Standard_D4s_v5'));

console.log('\nvalidation');
await page.locator('.status .btn').first().click();
await page.waitForTimeout(300);
const problems = await page.locator('.issues__item').allInnerTexts();
check(
  'missing required fields are reported',
  problems.some((text) => text.includes('SSH public key is required')),
  problems.join(' | '),
);
check(
  'arguments supplied by a link are not reported missing',
  !problems.some((text) => text.includes('SQL server is required')),
);
await page.keyboard.press('Escape');

console.log('\nimport');
await page.getByRole('button', { name: 'Canvas', exact: true }).click();
await page.waitForTimeout(300);
await page.getByRole('button', { name: 'Import Terraform' }).click();
await page.locator('.modal textarea').fill(`
resource "azurerm_resource_group" "main" {
  name     = "rg-imported"
  location = "uksouth"
}

resource "azurerm_virtual_network" "core" {
  name                = "vnet-imported"
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location
  address_space       = ["10.90.0.0/16"]
}

resource "azurerm_signalr_service" "chat" {
  name                = "signalr-chat"
  resource_group_name = azurerm_resource_group.main.name
  sku_capacity        = 2
}
`);
await page.getByRole('button', { name: 'Analyse' }).click();
await page.waitForTimeout(500);
const summary = await page.locator('.note--ok').innerText();
check('import reports what it found', summary.includes('3 resources'), summary);
check('unknown types are reconstructed', summary.includes('reconstructed from your code'), summary);

await page.getByRole('button', { name: /Open \d+ resources/ }).click();
await page.waitForTimeout(900);
check('imported design lands on the canvas', (await page.locator('.react-flow__node').count()) === 3);

await page
  .locator('.react-flow__node-container')
  .filter({ hasText: 'vnet-imported' })
  .first()
  .click();
await page.waitForTimeout(400);
const importedCode = await page.locator('.code__body pre').innerText();
check(
  'an imported resource regenerates correctly',
  importedCode.includes('resource "azurerm_virtual_network" "vnet-imported"') &&
    importedCode.includes('azurerm_resource_group.rg-imported.name'),
  importedCode.slice(0, 160),
);

console.log('\nexport');
await page.getByRole('button', { name: 'Download Terraform' }).click();
await page.waitForTimeout(400);
const listed = await page.locator('.file-list__item').allInnerTexts();
check(
  'the bundle contains a module and a pipeline',
  ['providers.tf', 'main.tf', 'azure-pipelines.yml', 'README.md'].every((file) =>
    listed.some((entry) => entry.includes(file)),
  ),
  listed.join(', '),
);

const download = page.waitForEvent('download', { timeout: 15000 });
await page.getByRole('button', { name: /Download \d+ files/ }).click();
const file = await download;
check('the zip downloads', (await file.path()) !== null, file.suggestedFilename());
await page.keyboard.press('Escape');

console.log('\ntabs');
for (const [tab, heading] of [
  ['Deploy', 'Deploy'],
  ['State', 'State'],
  ['Settings', 'Settings'],
]) {
  await page.getByRole('button', { name: tab, exact: true }).click();
  await page.waitForTimeout(300);
  check(`${tab} renders`, (await page.locator('.page h2').innerText()) === heading);
}

console.log('\nconsole');
check('no console errors', consoleErrors.length === 0, consoleErrors.join(' | '));

await browser.close();

console.log(
  failures.length === 0
    ? '\nall smoke checks passed\n'
    : `\n${failures.length} smoke check(s) failed\n`,
);
process.exit(failures.length === 0 ? 0 : 1);
