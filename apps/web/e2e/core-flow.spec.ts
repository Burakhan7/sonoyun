import { expect, test, type Browser, type Page } from '@playwright/test';

async function enter(browser: Browser) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('/');
  await page.getByRole('button', { name: /18 yaşından büyüğüm/ }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  const nickname = await page.locator('header button span.truncate').textContent();
  return { page, nickname: nickname ?? '' };
}

async function playUntilCards(page: Page) {
  const pickButton = page.getByRole('button', { name: /^Seç \(/ });
  const answers = page.locator('section[aria-label="Cevaplar"]');

  await expect(async () => {
    if (await pickButton.isVisible()) return;
    if (await answers.count()) {
      const input = answers.locator('input:enabled');
      if (await input.count()) {
        await input.fill('42');
        await answers.getByRole('button', { name: 'Gönder' }).click({ timeout: 500 });
      } else if (await answers.locator('button:enabled').count()) {
        await answers.locator('button:enabled').first().click({ timeout: 500 });
      }
    }
    throw new Error('Still playing');
  }).toPass({ timeout: 100_000, intervals: [150] });
}

async function pickCards(page: Page) {
  const label = await page.getByRole('button', { name: /^Seç \(/ }).textContent();
  const count = Number(label?.match(/\/(\d)\)/)?.[1]);
  const cards = page.locator('main ul button');
  for (let index = 0; index < count; index += 1) await cards.nth(index).click();
  await page.getByRole('button', { name: /^Seç \(/ }).click();
}

test('two strangers play, chat and become friends', async ({ browser }) => {
  const first = await enter(browser);
  const second = await enter(browser);

  await first.page.getByRole('link', { name: 'Oyna' }).click();
  await expect(first.page.getByRole('heading', { name: 'Rakip aranıyor…' })).toBeVisible();
  await second.page.getByRole('link', { name: 'Oyna' }).click();

  await Promise.all([playUntilCards(first.page), playUntilCards(second.page)]);
  await pickCards(first.page);
  await pickCards(second.page);

  const composer = first.page.getByPlaceholder('Mesaj yaz…');
  await expect(composer).toBeVisible();
  await expect(first.page.locator('[aria-label="Seçilen kartlar"] li')).toHaveCount(3);

  await composer.fill('Merhaba!');
  await first.page.getByRole('button', { name: 'Gönder' }).click();
  await expect(second.page.getByText('Merhaba!')).toBeVisible();

  await first.page.waitForTimeout(1_100);
  await composer.fill('siteme gel ornek.com');
  await first.page.getByRole('button', { name: 'Gönder' }).click();
  await expect(first.page.getByText('Link ve iletişim bilgisi paylaşılamaz.')).toBeVisible();
  await expect(second.page.getByText('ornek.com')).toHaveCount(0);

  await first.page.getByRole('button', { name: 'Sohbet menüsü' }).click();
  await first.page.getByRole('button', { name: 'Arkadaş ekle' }).click();
  await second.page.getByRole('button', { name: /seni eklemek istiyor → Kabul et/ }).click();

  await first.page.getByRole('button', { name: 'Sohbet menüsü' }).click();
  await first.page.getByRole('button', { name: 'Sohbetten çık' }).click();
  await expect(second.page.getByRole('link', { name: /Arkadaşsınız ✓/ })).toBeVisible();

  await second.page.getByRole('link', { name: /Arkadaşsınız ✓/ }).click();
  await expect(second.page.getByText('⏳ Mesajlar 24 saat sonra kaybolur.')).toBeVisible();
  await expect(second.page.getByText('Merhaba!')).toHaveCount(0);
});
